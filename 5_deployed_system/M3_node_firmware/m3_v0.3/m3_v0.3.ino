// ── Project Sipat Banwa — Node Firmware v0.3 ────────────────────────────────
// Block average logic: 1s sample -> 1-min avg -> 5-min batch upload
//
// Changes from v0.2 → v0.3:
//   - WiFi connect timeout in setup() (30s max, then proceed without WiFi)
//   - SD.begin() failure check with g_sd_available flag
//   - RainSensor.begin() failure check
//   - JsonDocument overflow check before upload (prevents infinite retry on OOM)
//   - client.stop() before http.end() in all HTTP functions (TLS leak fix)
//   - Free-heap watchdog: ESP.restart() if heap drops below 10KB
//   - last_boot_ms cast fix (was int, now String for >24.8 day uptime)
//   - OTA config check reduced from every 30s to once per hour
//   - Heartbeat/ping function (configurable interval via RTDB, collection: heartbeat_v2)
//   - NTP sync moved outside upload-success block
//   - Sensor task + SD logging runs regardless of WiFi status (SD-first priority)
//   - WiFi reconnection attempts in upload task (non-blocking)
//
// Changes v0.3 → v0.3.5:
//   - FIX: SD logging no longer skipped during OTA (removed OTA_IDLE guard)
//   - FIX: OTA download uses per-chunk SD mutex instead of holding for entire download
//   - FIX: OTA flash mutex changed from portMAX_DELAY to 30s timeout
//   - FIX: wifi_retry_ticks reset on reconnect (was stale across disconnect cycles)
//   - FIX: parsePendingLine buffer increased from 128 to 256 bytes
//   - SD mutex timeout in sensorTask increased from 500ms to 10s for OTA coexistence

#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Update.h>
#include <ModbusMaster.h>
#include <ArduinoJson.h>
#include <INA226_WE.h>
#include <time.h>
#include "DFRobot_RainfallSensor.h"
#include <esp_system.h>
#include <esp_sleep.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/semphr.h>

// ── Configuration ─────────────────────────────────────────────────────────────
#define WIFI_SSID     "SIPAT-BANWA"
#define WIFI_PASSWORD "BSECE4B1"

// Firebase RTDB Core (OTA + Config)
#define API_KEY      "AIzaSyCDsUNnLZuK8EyBa1XRfKrgxVkykFK-WVg"
#define DATABASE_URL "https://panahon-live-default-rtdb.asia-southeast1.firebasedatabase.app/"

// Firebase Firestore (REST API - Telemetry)
const char* FIRESTORE_BASE = "https://firestore.googleapis.com/v1/projects/panahon-live/databases/(default)/documents";

const String FIRMWARE_VERSION = "v0.3.5";
const String NODE_ID_OVERRIDE = "node_1"; // "" = use MAC address

// PINS
#define SD_CS          5
#define RS485_RX       16
#define RS485_TX       17
#define RAIN_RX        25
#define RAIN_TX        26
#define WIFI_POWER_PIN 13

// Battery thresholds
#define BATT_POWERSAVE_V  11.5f
#define BATT_CRITICAL_V   11.0f

// Timing constants
const uint32_t NTP_SYNC_INTERVAL_MS       = 6UL * 60UL * 60UL * 1000UL;  // 6 hours
const uint32_t OTA_READ_IDLE_TIMEOUT_MS   = 30000UL;
const uint32_t OTA_CHECK_INTERVAL_MS      = 3600000UL;                    // 1 hour
const uint32_t WIFI_CONNECT_TIMEOUT_MS    = 30000UL;                      // 30 seconds
const uint32_t HEAP_CRITICAL_BYTES        = 10240UL;                      // 10KB - restart if below

// Heartbeat defaults (overridable via RTDB)
const int HEARTBEAT_DEFAULT_INTERVAL_MIN  = 30; // minutes, 0 = disabled (raised from 5→30 to reduce RTDB churn)

// ── Hardware Objects ───────────────────────────────────────────────────────────
ModbusMaster     node;
HardwareSerial   RainSerial(2);
DFRobot_RainfallSensor_UART RainSensor(&RainSerial);
INA226_WE        ina_batt  = INA226_WE(0x40);
INA226_WE        ina_solar = INA226_WE(0x41);

// OTA State
String NODE_ID = "";
String rtdb_target_version = "";
String rtdb_target_url     = "";
String rtdb_target_md5     = "";

enum OTAState { OTA_IDLE, OTA_START_DOWNLOAD, OTA_DOWNLOADING, OTA_FLASHING };
OTAState current_ota_state = OTA_IDLE;  // guarded by g_ota_mutex

bool   pending_ota_update  = false;
String failed_ota_version  = "";
bool   g_dongle_on = true;

// Hardware availability flags
bool   g_sd_available   = false;
bool   g_rain_available = false;

// Data Structs
struct SensorSnapshot {
    float temperature;
    float humidity;
    float rain_mm;
    float batt_v;
    float batt_i;
    float solar_v;
    float solar_i;
    int   valid_reading;
};

struct MinuteBlock {
    char     timestamp[20];
    uint32_t uptime_ms;
    float    temp_avg;
    float    hum_avg;
    float    rain_sum;
    float    batt_v_avg;
    float    batt_i_avg;
    float    solar_v_avg;
    float    solar_i_avg;
    int      sample_count;
    int      op_mode;    // operational mode at block close (1/2/3)
    int      wifi_rssi;  // WiFi RSSI at block close; 0 = disconnected
};

// Queue for MinuteBlocks (cap 60 = up to 30 mins of backlog)
MinuteBlock tx_queue[60];
int tx_queue_count = 0;

SemaphoreHandle_t g_i2c_mutex;
SemaphoreHandle_t g_queue_mutex;
SemaphoreHandle_t g_sd_mutex;
SemaphoreHandle_t g_ota_mutex;

int  current_op_mode = 2;       // 1: High Alert, 2: Nominal, 3: Power Saving
bool is_modem_on     = true;

// Telemetry counters
uint32_t g_send_success                = 0;
uint32_t g_send_fail                   = 0;
uint32_t g_http_errors                 = 0;
uint32_t g_sd_failures                 = 0;
uint32_t g_i2c_error_count             = 0;
uint32_t g_modbus_crc_error_count      = 0;
uint32_t g_dongle_power_cycles         = 0;
uint32_t g_http_2xx_count              = 0;
uint32_t g_http_transport_error_count  = 0;
uint32_t g_upload_latency_ms           = 0;
uint32_t g_sd_max_write_latency_ms     = 0;
uint32_t g_wifi_reconnect_count        = 0;  // NEW: track WiFi recovery events
uint32_t g_heap_restart_count          = 0;  // NEW: track heap-watchdog restarts (persisted in NVS if needed)

// Pending upload tracking (persistent outbox via /pending.csv)
uint32_t g_pending_cursor = 0;  // lines uploaded from pending.csv (excluding header)
uint32_t g_pending_total  = 0;  // total data lines in pending.csv
const int PENDING_BATCH_SIZE = 5;  // blocks to re-upload per catch-up cycle

// NTP time tracking
const long  GMT_OFFSET_SEC      = 28800; // UTC+8
const int   DAYLIGHT_OFFSET_SEC = 0;
const char* NTP_SERVER          = "pool.ntp.org";
uint32_t    g_last_ntp_sync_ms  = 0;

// OTA config check tracking
uint32_t    g_last_ota_check_ms = 0;

// Heartbeat tracking
int         g_heartbeat_interval_min = HEARTBEAT_DEFAULT_INTERVAL_MIN;  // 0 = disabled, from RTDB
uint32_t    g_last_heartbeat_ms      = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────
void getTimeStamp(char* buf, size_t len) {
    time_t now;
    time(&now);
    struct tm* ti = localtime(&now);
    if (ti->tm_year < 120) {
        strncpy(buf, "WAITING_SYNC", len);
        return;
    }
    snprintf(buf, len, "%04d-%02d-%02d %02d:%02d:%02d",
             ti->tm_year + 1900, ti->tm_mon + 1, ti->tm_mday,
             ti->tm_hour, ti->tm_min, ti->tm_sec);
}

void setupNTP() {
    if (WiFi.status() != WL_CONNECTED) return;
    Serial.print("[NTP] Syncing...");
    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER, "time.google.com");
    struct tm timeinfo;
    int retry = 0;
    while (!getLocalTime(&timeinfo, 1000) && retry < 10) {
        Serial.print(".");
        retry++;
    }
    if (retry < 10) {
        Serial.println("\n[NTP] Synced.");
        g_last_ntp_sync_ms = millis();
    } else {
        Serial.println("\n[NTP] Sync timeout — using last-known RTC.");
    }
}

// ── Heap Watchdog ─────────────────────────────────────────────────────────────
// Call periodically. If free heap drops dangerously low, force restart.
void checkHeapHealth() {
    uint32_t free_heap = esp_get_free_heap_size();
    uint32_t min_heap  = esp_get_minimum_free_heap_size();
    if (free_heap < HEAP_CRITICAL_BYTES) {
        Serial.printf("[HEAP] CRITICAL: free=%u min=%u — RESTARTING\n", free_heap, min_heap);
        // Best-effort: flush SD
        if (g_sd_available) {
            SD.end();
        }
        delay(500);
        ESP.restart();
    }
}

// Read current OTA state safely from any task/core
OTAState getOTAState() {
    OTAState s = OTA_IDLE;
    if (xSemaphoreTake(g_ota_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        s = current_ota_state;
        xSemaphoreGive(g_ota_mutex);
    }
    return s;
}

void setOTAState(OTAState s) {
    if (xSemaphoreTake(g_ota_mutex, portMAX_DELAY) == pdTRUE) {
        current_ota_state = s;
        xSemaphoreGive(g_ota_mutex);
    }
}

// Consolidated OTA failure reset
void resetOTAFailed(const String& reason) {
    Serial.printf("[OTA] FAILED: %s\n", reason.c_str());
    setOTAState(OTA_IDLE);
    failed_ota_version = rtdb_target_version;
    pending_ota_update = false;
}

// ── OTA Support Logic ─────────────────────────────────────────────────────────
void reportStatusToRTDB(const String& ota_status, const String& details = "") {
    if (WiFi.status() != WL_CONNECTED) return;  // Don't attempt if no WiFi

    WiFiClientSecure client; client.setInsecure();
    HTTPClient http;
    String url = String(DATABASE_URL) + "nodes/" + NODE_ID + "/status.json?auth=" + API_KEY;
    http.begin(client, url);
    http.addHeader("Content-Type", "application/json");

    JsonDocument doc;
    doc["current_version"] = FIRMWARE_VERSION;
    doc["ota_status"]      = ota_status;
    doc["last_boot_ms"]    = String(millis());  // FIX: was (int)millis() which overflows at ~24.8 days
    if (details != "") doc["ota_details"] = details;

    String payload;
    serializeJson(doc, payload);
    int code = http.PUT(payload);
    if (code < 0) {
        Serial.printf("[RTDB] reportStatus failed (err=%d)\n", code);
    }
    client.stop();  // FIX: explicit TLS cleanup
    http.end();
}

void otaTask(void *pvParams) {
    while (true) {
        OTAState state = getOTAState();

        if (state == OTA_START_DOWNLOAD) {
            Serial.printf("\n=== STARTING BACKGROUND OTA ===\nURL: %s\n", rtdb_target_url.c_str());
            reportStatusToRTDB("downloading_to_sd", rtdb_target_url);

            WiFiClientSecure client;
            client.setInsecure();
            HTTPClient http;

            if (!http.begin(client, rtdb_target_url)) {
                client.stop();
                http.end();
                reportStatusToRTDB("failed", "HTTP Begin Failed");
                resetOTAFailed("HTTP Begin Failed");
                vTaskDelay(pdMS_TO_TICKS(2000));
                continue;
            }

            int httpCode = http.GET();
            if (httpCode != HTTP_CODE_OK) {
                client.stop();
                http.end();
                reportStatusToRTDB("failed", "HTTP Code " + String(httpCode));
                resetOTAFailed("HTTP Code " + String(httpCode));
                vTaskDelay(pdMS_TO_TICKS(2000));
                continue;
            }

            int    content_len   = http.getSize();
            WiFiClient* stream   = http.getStreamPtr();
            bool   write_ok      = false;
            int    total_written = 0;

            // FIX v0.3.5: Per-chunk SD mutex — sensor SD writes can interleave during OTA.
            {
                File file;
                bool open_ok = false;
                if (xSemaphoreTake(g_sd_mutex, pdMS_TO_TICKS(5000)) == pdTRUE) {
                    if (SD.exists("/update.bin")) SD.remove("/update.bin");
                    file = SD.open("/update.bin", FILE_WRITE);
                    open_ok = (bool)file;
                    xSemaphoreGive(g_sd_mutex);
                }
                if (!open_ok) {
                    client.stop();
                    http.end();
                    reportStatusToRTDB("failed", "SD Write Error");
                    resetOTAFailed("SD Write Error");
                    vTaskDelay(pdMS_TO_TICKS(2000));
                    continue;
                }

                uint8_t buff[2048];
                int     remaining = content_len;
                uint32_t last_progress_ms = millis();
                setOTAState(OTA_DOWNLOADING);

                while (http.connected() && (remaining > 0 || content_len == -1)) {
                    size_t avail = stream->available();
                    if (avail > 0) {
                        int c = stream->readBytes(buff, min((size_t)sizeof(buff), avail));
                        if (c <= 0) break;
                        // Brief mutex hold per chunk — sensor SD writes can interleave
                        if (xSemaphoreTake(g_sd_mutex, pdMS_TO_TICKS(5000)) == pdTRUE) {
                            bool wr_ok = (file.write(buff, c) == (size_t)c);
                            xSemaphoreGive(g_sd_mutex);
                            if (!wr_ok) {
                                Serial.println("[OTA] SD write failed mid-download.");
                                total_written = -1;
                                break;
                            }
                        } else {
                            Serial.println("[OTA] SD mutex timeout mid-download.");
                            total_written = -1;
                            break;
                        }
                        total_written += c;
                        last_progress_ms = millis();
                        if (content_len > 0) remaining -= c;
                    } else {
                        if ((millis() - last_progress_ms) > OTA_READ_IDLE_TIMEOUT_MS) {
                            Serial.println("[OTA] Download idle timeout.");
                            break;
                        }
                        vTaskDelay(pdMS_TO_TICKS(50));
                    }
                }
                // Close file under mutex
                if (xSemaphoreTake(g_sd_mutex, pdMS_TO_TICKS(5000)) == pdTRUE) {
                    file.close();
                    xSemaphoreGive(g_sd_mutex);
                } else {
                    file.close();  // close anyway to prevent file handle leak
                }

                bool size_ok = (content_len == -1) ? (total_written > 0)
                                                    : (total_written == content_len);
                write_ok = (total_written > 0) && size_ok;
            }

            client.stop();  // FIX: explicit TLS cleanup
            http.end();
            vTaskDelay(pdMS_TO_TICKS(500));

            if (write_ok) {
                setOTAState(OTA_FLASHING);
            } else {
                reportStatusToRTDB("failed", "Download incomplete or interrupted");
                resetOTAFailed("Download incomplete");
            }

        } else if (state == OTA_FLASHING) {
            reportStatusToRTDB("flashing", "Local SD Update");

            // FIX v0.3.5: 30s timeout instead of portMAX_DELAY
            if (xSemaphoreTake(g_sd_mutex, pdMS_TO_TICKS(30000)) == pdTRUE) {
                File updateFile = SD.open("/update.bin");
                if (!updateFile) {
                    xSemaphoreGive(g_sd_mutex);
                    reportStatusToRTDB("failed", "Failed to open SD bin");
                    resetOTAFailed("SD open failed");
                    vTaskDelay(pdMS_TO_TICKS(2000));
                    continue;
                }

                size_t updateSize = updateFile.size();
                if (rtdb_target_md5.length() > 0) {
                    Update.setMD5(rtdb_target_md5.c_str());
                }

                if (Update.begin(updateSize)) {
                    size_t written = Update.writeStream(updateFile);
                    if (written == updateSize && Update.end()) {
                        Serial.println("[OTA] Flash success. Rebooting...");
                        updateFile.close();
                        xSemaphoreGive(g_sd_mutex);
                        reportStatusToRTDB("idle");
                        delay(1000);
                        ESP.restart();
                    } else {
                        String err = Update.hasError()
                            ? String(Update.getError())
                            : "Written " + String(written) + "/" + String(updateSize);
                        updateFile.close();
                        xSemaphoreGive(g_sd_mutex);
                        reportStatusToRTDB("failed", err);
                        resetOTAFailed(err);
                    }
                } else {
                    updateFile.close();
                    xSemaphoreGive(g_sd_mutex);
                    reportStatusToRTDB("failed", "Not enough space to begin OTA");
                    resetOTAFailed("No OTA space");
                }
            } else {
                reportStatusToRTDB("failed", "SD Mutex Timeout on Flash");
                resetOTAFailed("SD Mutex Timeout on Flash");
            }
        }

        vTaskDelay(pdMS_TO_TICKS(2000));
    }
}

// ── RTDB Config Fetch ─────────────────────────────────────────────────────────
// Now also reads heartbeat_interval_min from RTDB config.
void fetchOTAConfig() {
    if (getOTAState() != OTA_IDLE) return;
    if (WiFi.status() != WL_CONNECTED) return;

    WiFiClientSecure client; client.setInsecure();
    HTTPClient http;
    String url = String(DATABASE_URL) + "nodes/" + NODE_ID + "/config.json?auth=" + API_KEY;
    http.begin(client, url);
    int httpCode = http.GET();
    if (httpCode == HTTP_CODE_OK) {
        String payload = http.getString();
        JsonDocument doc;
        if (!deserializeJson(doc, payload)) {
            if (doc.containsKey("mode"))           current_op_mode      = doc["mode"].as<int>();
            if (doc.containsKey("target_url"))     rtdb_target_url      = doc["target_url"].as<String>();
            if (doc.containsKey("target_version")) rtdb_target_version  = doc["target_version"].as<String>();
            if (doc.containsKey("target_md5"))     rtdb_target_md5      = doc["target_md5"].as<String>();

            // Heartbeat interval: 0 = disabled, >0 = minutes between pings
            if (doc.containsKey("heartbeat_interval_min")) {
                g_heartbeat_interval_min = doc["heartbeat_interval_min"].as<int>();
                if (g_heartbeat_interval_min < 0) g_heartbeat_interval_min = 0;
            }

            if (current_op_mode < 1 || current_op_mode > 3) {
                current_op_mode = 2;
            }

            if (rtdb_target_version != "" && rtdb_target_version != FIRMWARE_VERSION &&
                rtdb_target_version != failed_ota_version &&
                rtdb_target_url != "" && rtdb_target_url != "null") {
                pending_ota_update = true;
            } else {
                pending_ota_update = false;
            }
        }
    }
    client.stop();  // FIX: explicit TLS cleanup
    http.end();
    g_last_ota_check_ms = millis();

    Serial.printf("[CONFIG] mode=%d hb_interval=%dmin ota_pending=%s\n",
                  current_op_mode, g_heartbeat_interval_min,
                  pending_ota_update ? "YES" : "no");
}

void setupOTA() {
    if (NODE_ID_OVERRIDE != "") NODE_ID = NODE_ID_OVERRIDE;
    else {
        NODE_ID = WiFi.macAddress(); NODE_ID.replace(":", ""); NODE_ID.toLowerCase();
    }
    if (WiFi.status() == WL_CONNECTED) {
        reportStatusToRTDB("idle");
        fetchOTAConfig();
    }
}

// ── Heartbeat / Ping ──────────────────────────────────────────────────────────
// Lightweight ping to Firestore heartbeat_v2 collection.
// Configurable interval via RTDB (heartbeat_interval_min). 0 = disabled.
// After sending, re-fetches RTDB config to pick up any changes.
void sendHeartbeat() {
    if (WiFi.status() != WL_CONNECTED) return;
    if (g_heartbeat_interval_min <= 0) return;  // disabled

    WiFiClientSecure client; client.setInsecure();
    HTTPClient http;
    time_t now_stamp; time(&now_stamp);
    String docId = NODE_ID + "_hb_" + String((long)now_stamp);
    String url = String(FIRESTORE_BASE) + "/heartbeat_0v3/" + docId + "?key=" + API_KEY;
    http.begin(client, url);
    http.addHeader("Content-Type", "application/json");

    int qc = 0;
    if (xSemaphoreTake(g_queue_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        qc = tx_queue_count;
        xSemaphoreGive(g_queue_mutex);
    }

    JsonDocument doc;
    JsonObject fields = doc["fields"].to<JsonObject>();
    fields["node_id"]["stringValue"]    = NODE_ID;
    fields["firmware"]["stringValue"]   = FIRMWARE_VERSION;
    fields["uptime_ms"]["integerValue"] = String(millis());
    fields["uptime_h"]["doubleValue"]   = millis() / 3600000.0;
    fields["wifi_rssi"]["integerValue"] = String(WiFi.RSSI());
    fields["free_heap"]["integerValue"] = String(esp_get_free_heap_size());
    fields["min_heap"]["integerValue"]  = String(esp_get_minimum_free_heap_size());
    fields["queue_depth"]["integerValue"] = String(qc);
    fields["op_mode"]["integerValue"]   = String(current_op_mode);
    fields["send_ok"]["integerValue"]   = String(g_send_success);
    fields["send_fail"]["integerValue"] = String(g_send_fail);
    fields["sd_fail"]["integerValue"]   = String(g_sd_failures);
    fields["mb_errs"]["integerValue"]   = String(g_modbus_crc_error_count);
    fields["i2c_errs"]["integerValue"]  = String(g_i2c_error_count);
    fields["wifi_reconn"]["integerValue"] = String(g_wifi_reconnect_count);
    fields["pending_cursor"]["integerValue"] = String(g_pending_cursor);
    fields["pending_total"]["integerValue"]  = String(g_pending_total);
    fields["pending_backlog"]["integerValue"] = String(
        g_pending_total > g_pending_cursor ? g_pending_total - g_pending_cursor : 0);

    // Check for overflow before sending
    if (doc.overflowed()) {
        Serial.println("[HEARTBEAT] JSON overflow — skipping.");
        client.stop();
        http.end();
        return;
    }

    String payload;
    serializeJson(doc, payload);

    int code = http.PATCH(payload);
    client.stop();  // FIX: explicit TLS cleanup
    http.end();

    if (code >= 200 && code < 300) {
        Serial.printf("[HEARTBEAT] Sent OK (heap=%u)\n", esp_get_free_heap_size());
    } else {
        Serial.printf("[HEARTBEAT] Failed (code=%d)\n", code);
    }

    g_last_heartbeat_ms = millis();
    // Config is fetched by the standalone hourly OTA poll — no need to double-fetch here.
}

// ── Critical Shutdown ─────────────────────────────────────────────────────────
void criticalShutdown(float batt_v) {
    Serial.printf("[SHUTDOWN] Battery critical (%.2fV). Flushing and sleeping.\n", batt_v);

    if (WiFi.status() == WL_CONNECTED) {
        WiFiClientSecure client; client.setInsecure();
        HTTPClient http;
        time_t now_stamp; time(&now_stamp);
        String docId = NODE_ID + "_shutdown_" + String((long)now_stamp);
        String url = String(FIRESTORE_BASE) + "/shutdown_events_0v3/" + docId + "?key=" + API_KEY;
        http.begin(client, url);
        http.addHeader("Content-Type", "application/json");

        JsonDocument doc;
        JsonObject fields = doc["fields"].to<JsonObject>();
        fields["node_id"]["stringValue"]    = NODE_ID;
        fields["firmware"]["stringValue"]   = FIRMWARE_VERSION;
        fields["batt_v"]["doubleValue"]     = batt_v;
        fields["uptime_ms"]["integerValue"] = String(millis());
        fields["event"]["stringValue"]      = "CRITICAL_SHUTDOWN";
        fields["min_heap"]["integerValue"]  = String(esp_get_minimum_free_heap_size());

        String payload; serializeJson(doc, payload);
        http.PATCH(payload);
        client.stop();
        http.end();
    }

    if (g_sd_available) {
        SD.end();
    }

    Serial.println("[SHUTDOWN] Entering deep sleep.");
    esp_deep_sleep_start();
}

// ── SD Card Append Logic ──────────────────────────────────────────────────────
void appendToSD(const char* path, const MinuteBlock& b) {
    if (!g_sd_available) { g_sd_failures++; return; }  // FIX: check SD availability

    if (!SD.exists(path)) {
        File fHeader = SD.open(path, FILE_WRITE);
        if (fHeader) {
            fHeader.println("timestamp,uptime_ms,temp_avg,hum_avg,rain_sum,batt_v,batt_i,solar_v,solar_i,sample_count,op_mode,wifi_rssi");
            fHeader.close();
        }
    }
    File f = SD.open(path, FILE_APPEND);
    if (!f) { g_sd_failures++; return; }
    f.printf("%s,%lu,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%d,%d,%d\n",
             b.timestamp, b.uptime_ms,
             b.temp_avg, b.hum_avg, b.rain_sum,
             b.batt_v_avg, b.batt_i_avg, b.solar_v_avg, b.solar_i_avg,
             b.sample_count, b.op_mode, b.wifi_rssi);
    f.close();
}

// ── Health Snapshot Log ───────────────────────────────────────────────────────
// Written to /node_health.csv after every upload attempt.
// Captures all cumulative counters so post-hoc analysis can spot degradation trends.
void appendHealthToSD(bool upload_ok, int queue_depth) {
    if (!g_sd_available) return;
    if (xSemaphoreTake(g_sd_mutex, pdMS_TO_TICKS(500)) != pdTRUE) {
        g_sd_failures++; return;
    }
    const char* path = "/node_health.csv";
    if (!SD.exists(path)) {
        File fh = SD.open(path, FILE_WRITE);
        if (fh) {
            fh.println("timestamp,uptime_ms,op_mode,wifi_rssi,free_heap,min_heap,"
                       "send_ok,send_fail,sd_fail,mb_errs,i2c_errs,"
                       "http_2xx,http_errs,upload_lat_ms,sd_lat_ms,"
                       "wifi_reconn,queue_depth,upload_result");
            fh.close();
        }
    }
    File f = SD.open(path, FILE_APPEND);
    if (f) {
        char ts[20]; getTimeStamp(ts, sizeof(ts));
        int rssi = (WiFi.status() == WL_CONNECTED) ? (int)WiFi.RSSI() : 0;
        f.printf("%s,%lu,%d,%d,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%d,%s\n",
                 ts, millis(), current_op_mode, rssi,
                 esp_get_free_heap_size(), esp_get_minimum_free_heap_size(),
                 g_send_success, g_send_fail, g_sd_failures,
                 g_modbus_crc_error_count, g_i2c_error_count,
                 g_http_2xx_count, g_http_transport_error_count,
                 g_upload_latency_ms, g_sd_max_write_latency_ms,
                 g_wifi_reconnect_count, queue_depth,
                 upload_ok ? "OK" : "FAIL");
        f.close();
    } else {
        g_sd_failures++;
    }
    xSemaphoreGive(g_sd_mutex);
}

// ── Event Log ─────────────────────────────────────────────────────────────────
// Written to /node_events.csv on significant state transitions.
// Events: BOOT, WIFI_UP, WIFI_DOWN, UPLOAD_OK, UPLOAD_FAIL, MODE_CHANGE, OTA_*
void appendEventToSD(const char* event, const char* detail = "") {
    if (!g_sd_available) return;
    if (xSemaphoreTake(g_sd_mutex, pdMS_TO_TICKS(500)) != pdTRUE) {
        g_sd_failures++; return;
    }
    const char* path = "/node_events.csv";
    if (!SD.exists(path)) {
        File fh = SD.open(path, FILE_WRITE);
        if (fh) {
            fh.println("timestamp,uptime_ms,event,detail");
            fh.close();
        }
    }
    File f = SD.open(path, FILE_APPEND);
    if (f) {
        char ts[20]; getTimeStamp(ts, sizeof(ts));
        f.printf("%s,%lu,%s,%s\n", ts, millis(), event, detail);
        f.close();
    } else {
        g_sd_failures++;
    }
    xSemaphoreGive(g_sd_mutex);
}

// ── Pending Upload Outbox ─────────────────────────────────────────────────────
// /pending.csv = persistent outbox of blocks waiting to be uploaded.
// Survives reboots — the system re-uploads missed blocks automatically after reconnect.
// /pending_cursor.txt = number of lines already uploaded from pending.csv.
//
// SD PRIORITY: appendToPendingSD() is called inside sensorTask's SD mutex block,
// BEFORE the in-memory tx_queue enqueue. SD writes can never be starved by uploads.

// Called with g_sd_mutex ALREADY HELD by caller (sensorTask).
void appendToPendingSD(const MinuteBlock& b) {
    if (!g_sd_available) return;
    const char* path = "/pending.csv";
    if (!SD.exists(path)) {
        File fh = SD.open(path, FILE_WRITE);
        if (fh) {
            fh.println("timestamp,uptime_ms,temp_avg,hum_avg,rain_sum,batt_v,batt_i,solar_v,solar_i,sample_count,op_mode,wifi_rssi");
            fh.close();
        }
    }
    File f = SD.open(path, FILE_APPEND);
    if (f) {
        f.printf("%s,%lu,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%d,%d,%d\n",
                 b.timestamp, b.uptime_ms,
                 b.temp_avg, b.hum_avg, b.rain_sum,
                 b.batt_v_avg, b.batt_i_avg, b.solar_v_avg, b.solar_i_avg,
                 b.sample_count, b.op_mode, b.wifi_rssi);
        f.close();
        g_pending_total++;
    } else {
        g_sd_failures++;
    }
}

// Parse a CSV line from pending.csv back into a MinuteBlock.
// Uses a stack buffer — no heap allocation.
bool parsePendingLine(const String& line, MinuteBlock& b) {
    if (line.length() == 0 || line.startsWith("t")) return false;  // skip blank/header
    char buf[256];  // FIX v0.3.5: was 128, too small for lines with full-precision floats
    if (line.length() >= sizeof(buf)) return false;
    line.toCharArray(buf, sizeof(buf));
    memset(&b, 0, sizeof(b));
    int field = 0;
    char* token = strtok(buf, ",");
    while (token && field < 12) {
        switch (field) {
            case 0:  strncpy(b.timestamp, token, sizeof(b.timestamp)-1); break;
            case 1:  b.uptime_ms    = strtoul(token, nullptr, 10); break;
            case 2:  b.temp_avg     = atof(token); break;
            case 3:  b.hum_avg      = atof(token); break;
            case 4:  b.rain_sum     = atof(token); break;
            case 5:  b.batt_v_avg   = atof(token); break;
            case 6:  b.batt_i_avg   = atof(token); break;
            case 7:  b.solar_v_avg  = atof(token); break;
            case 8:  b.solar_i_avg  = atof(token); break;
            case 9:  b.sample_count = atoi(token); break;
            case 10: b.op_mode      = atoi(token); break;
            case 11: b.wifi_rssi    = atoi(token); break;
        }
        token = strtok(nullptr, ",");
        field++;
    }
    return (field >= 10);
}

// Load pending cursor on boot (restore after reboot).
void loadPendingCursor() {
    if (!g_sd_available) return;
    // Restore cursor from file
    File fc = SD.open("/pending_cursor.txt", FILE_READ);
    if (fc) {
        g_pending_cursor = (uint32_t)fc.readStringUntil('\n').toInt();
        fc.close();
    }
    // Count total data lines in pending.csv
    g_pending_total = 0;
    File csv = SD.open("/pending.csv", FILE_READ);
    if (csv) {
        while (csv.available()) {
            csv.readStringUntil('\n');
            g_pending_total++;
        }
        csv.close();
        if (g_pending_total > 0) g_pending_total--;  // subtract header line
    }
    // Clamp cursor in case file shrank
    if (g_pending_cursor > g_pending_total) g_pending_cursor = g_pending_total;
    uint32_t backlog = g_pending_total - g_pending_cursor;
    Serial.printf("[PENDING] Loaded: cursor=%lu total=%lu backlog=%lu\n",
                  g_pending_cursor, g_pending_total, backlog);
    if (backlog > 0) appendEventToSD("BOOT_BACKLOG", String(backlog).c_str());
}

// Persist cursor to /pending_cursor.txt. Call with g_sd_mutex held.
void savePendingCursor() {
    if (!g_sd_available) return;
    File f = SD.open("/pending_cursor.txt", FILE_WRITE);  // overwrite, not append
    if (f) { f.printf("%lu\n", g_pending_cursor); f.close(); }
}

// Re-upload one batch of missed blocks from pending.csv.
// Uses a deterministic docId based on first block timestamp so the same batch
// produces the same Firestore document (idempotent on retry — no duplicates).
// Returns: true if more backlog remains after this call.
bool uploadPendingBlocks() {
    if (!g_sd_available || g_pending_cursor >= g_pending_total) return false;
    if (WiFi.status() != WL_CONNECTED) return true;  // more pending, but no WiFi

    // Read the batch under SD mutex — keeps the mutex held for the entire file read
    // to prevent sensorTask from concurrently opening pending.csv for APPEND while
    // we have it open for READ (concurrent FAT handles on same file = undefined behavior).
    // The read of up to PENDING_BATCH_SIZE lines is fast (< 100ms even for large cursors).
    MinuteBlock batch[PENDING_BATCH_SIZE];
    int count = 0;

    if (xSemaphoreTake(g_sd_mutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
        File f = SD.open("/pending.csv", FILE_READ);
        if (f) {
            f.readStringUntil('\n');  // skip header
            for (uint32_t i = 0; i < g_pending_cursor; i++) {
                if (!f.available()) break;
                f.readStringUntil('\n');  // seek past already-uploaded lines
            }
            while (f.available() && count < PENDING_BATCH_SIZE) {
                String line = f.readStringUntil('\n');
                line.trim();
                if (line.length() > 0 && parsePendingLine(line, batch[count])) count++;
            }
            f.close();
        }
        xSemaphoreGive(g_sd_mutex);  // release AFTER close — no open file handles remain
    }

    if (count == 0) return false;

    // Build deterministic docId from first block's timestamp
    // so re-uploading the same blocks always PATCHes the same Firestore document.
    String ts0 = String(batch[0].timestamp);
    ts0.replace(" ", "_"); ts0.replace(":", "-");
    if (ts0 == "WAITING_SYNC" || ts0.length() < 10)
        ts0 = "u" + String(batch[0].uptime_ms);  // fallback if NTP not synced
    String docId = NODE_ID + "_r_" + ts0;

    Serial.printf("[PENDING] Re-uploading %d blocks from cursor=%lu (doc=%s)\n",
                  count, g_pending_cursor, docId.c_str());

    // Use a separate Firestore collection to keep backlog data distinct
    WiFiClientSecure client; client.setInsecure();
    HTTPClient http;
    http.begin(client, firestoreUrl("node_pending_0v3", docId.c_str()));
    http.addHeader("Content-Type", "application/json");

    JsonDocument doc;
    JsonObject fields = doc["fields"].to<JsonObject>();
    fields["node_id"]["stringValue"]   = NODE_ID;
    fields["timestamp"]["stringValue"] = batch[count-1].timestamp;
    fields["is_reupload"]["booleanValue"] = true;
    fields["reupload_cursor"]["integerValue"] = String(g_pending_cursor);

    JsonArray history = fields["history"]["arrayValue"]["values"].to<JsonArray>();
    for (int i = 0; i < count; i++) {
        JsonObject val = history.add<JsonObject>()["mapValue"]["fields"].to<JsonObject>();
        val["ts"]["stringValue"]         = batch[i].timestamp;
        val["uptime_ms"]["integerValue"] = String(batch[i].uptime_ms);
        val["temp"]["doubleValue"]       = batch[i].temp_avg;
        val["hum"]["doubleValue"]        = batch[i].hum_avg;
        val["rain"]["doubleValue"]       = batch[i].rain_sum;
        val["batt_v"]["doubleValue"]     = batch[i].batt_v_avg;
        val["batt_i"]["doubleValue"]     = batch[i].batt_i_avg;
        val["solar_v"]["doubleValue"]    = batch[i].solar_v_avg;
        val["solar_i"]["doubleValue"]    = batch[i].solar_i_avg;
        val["samples"]["integerValue"]   = String(batch[i].sample_count);
    }

    if (doc.overflowed()) {
        Serial.println("[PENDING] JSON overflow — skipping batch, advancing cursor.");
        client.stop(); http.end();
        g_pending_cursor = min(g_pending_cursor + (uint32_t)count, g_pending_total);
        if (xSemaphoreTake(g_sd_mutex, pdMS_TO_TICKS(500)) == pdTRUE) {
            savePendingCursor(); xSemaphoreGive(g_sd_mutex);
        }
        return (g_pending_cursor < g_pending_total);
    }

    String payload; serializeJson(doc, payload);
    int code = http.PATCH(payload);
    client.stop(); http.end();

    if (code >= 200 && code < 300) {
        g_pending_cursor = min(g_pending_cursor + (uint32_t)count, g_pending_total);
        if (xSemaphoreTake(g_sd_mutex, pdMS_TO_TICKS(500)) == pdTRUE) {
            savePendingCursor();
            // Clean up if all uploaded
            if (g_pending_cursor >= g_pending_total) {
                SD.remove("/pending.csv");
                SD.remove("/pending_cursor.txt");
                g_pending_cursor = 0;
                g_pending_total  = 0;
                Serial.println("[PENDING] All blocks uploaded — outbox cleared.");
            }
            xSemaphoreGive(g_sd_mutex);
        }
        Serial.printf("[PENDING] OK cursor=%lu/%lu remaining=%lu\n",
                      g_pending_cursor, g_pending_total,
                      g_pending_total > g_pending_cursor ? g_pending_total - g_pending_cursor : 0);
        if (g_pending_cursor >= g_pending_total)
            appendEventToSD("PENDING_CLEARED", "");
        return (g_pending_cursor < g_pending_total);
    } else {
        Serial.printf("[PENDING] Re-upload failed (code=%d). Will retry next cycle.\n", code);
        return true;
    }
}

// ── Firestore Upload Logic ─────────────────────────────────────────────────────
String firestoreUrl(const char* collection, const char* docId) {
    return String(FIRESTORE_BASE) + "/" + collection + "/" + docId + "?key=" + API_KEY;
}

bool uploadFiveMinPayload(const MinuteBlock* queue, int count, const char* collection) {
    if (count == 0) return true;
    WiFiClientSecure client; client.setInsecure();
    HTTPClient http;
    time_t now_stamp; time(&now_stamp);
    String docId = NODE_ID + "_" + String((long)now_stamp);
    http.begin(client, firestoreUrl(collection, docId.c_str()));
    http.addHeader("Content-Type", "application/json");

    JsonDocument doc;
    JsonObject fields = doc["fields"].to<JsonObject>();

    fields["node_id"]["stringValue"]   = NODE_ID;
    fields["timestamp"]["stringValue"] = queue[count-1].timestamp;

    JsonArray history = fields["history"]["arrayValue"]["values"].to<JsonArray>();
    for (int i = 0; i < count; i++) {
        JsonObject val = history.add<JsonObject>()["mapValue"]["fields"].to<JsonObject>();
        val["ts"]["stringValue"]         = queue[i].timestamp;
        val["uptime_ms"]["integerValue"] = String(queue[i].uptime_ms);
        val["temp"]["doubleValue"]       = queue[i].temp_avg;
        val["hum"]["doubleValue"]        = queue[i].hum_avg;
        val["rain"]["doubleValue"]       = queue[i].rain_sum;
        val["batt_v"]["doubleValue"]     = queue[i].batt_v_avg;
        val["batt_i"]["doubleValue"]     = queue[i].batt_i_avg;
        val["solar_v"]["doubleValue"]    = queue[i].solar_v_avg;
        val["solar_i"]["doubleValue"]    = queue[i].solar_i_avg;
        val["samples"]["integerValue"]   = String(queue[i].sample_count);
    }

    JsonObject health = fields["health"]["mapValue"]["fields"].to<JsonObject>();
    health["send_success"]["integerValue"]   = String(g_send_success);
    health["send_fail"]["integerValue"]      = String(g_send_fail);
    health["sd_fail"]["integerValue"]        = String(g_sd_failures);
    health["uptime_h"]["doubleValue"]        = millis() / 3600000.0;
    health["wifi_rssi"]["integerValue"]      = String(WiFi.RSSI());
    health["firmware"]["stringValue"]        = FIRMWARE_VERSION;
    health["i2c_errs"]["integerValue"]       = String(g_i2c_error_count);
    health["mb_errs"]["integerValue"]        = String(g_modbus_crc_error_count);
    health["dongle_cycles"]["integerValue"]  = String(g_dongle_power_cycles);
    health["http_2xx"]["integerValue"]       = String(g_http_2xx_count);
    health["http_errs"]["integerValue"]      = String(g_http_transport_error_count);
    health["upload_lat_ms"]["integerValue"]  = String(g_upload_latency_ms);
    health["sd_lat_ms"]["integerValue"]      = String(g_sd_max_write_latency_ms);
    health["min_heap"]["integerValue"]       = String(esp_get_minimum_free_heap_size());
    health["wifi_reconn"]["integerValue"]    = String(g_wifi_reconnect_count);

    // FIX: Check for JsonDocument overflow before sending
    if (doc.overflowed()) {
        Serial.printf("[UPLOAD] JSON overflow with %d blocks — dropping batch\n", count);
        client.stop();
        http.end();
        return true;  // Return true to clear queue (data is on SD card)
    }

    String payload;
    serializeJson(doc, payload);

    uint32_t t_start = millis();
    int code = http.PATCH(payload);
    g_upload_latency_ms = millis() - t_start;
    client.stop();  // FIX: explicit TLS cleanup
    http.end();

    if (code >= 200 && code < 300) {
        g_send_success++;
        g_http_2xx_count++;
        return true;
    }
    if (code < 0) g_http_transport_error_count++;
    g_send_fail++;
    return false;
}

// ── Sensor Task ───────────────────────────────────────────────────────────────
// Runs regardless of WiFi status. SD logging is the #1 priority.
void sensorTask(void *pvParams) {
    float sum_temp=0, sum_hum=0, sum_rain=0;
    float sum_batt_v=0, sum_batt_i=0, sum_solar_v=0, sum_solar_i=0;
    int   samples = 0;

    TickType_t xLastWakeTime = xTaskGetTickCount();
    Serial.println("[SENSOR] Task started.");

    while (true) {
        int mode_sample_rate_ms    = (current_op_mode == 3) ? 10000 : 1000;
        int mode_samples_per_block = (current_op_mode == 1) ? 10
                                   : (current_op_mode == 3) ? 6 : 60;

        // Sample I2C power monitors
        float bv=0, bi=0, sv=0, si=0;
        if (xSemaphoreTake(g_i2c_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
            bv = ina_batt.getBusVoltage_V();
            bi = ina_batt.getCurrent_mA();
            sv = ina_solar.getBusVoltage_V();
            si = ina_solar.getCurrent_mA();
            xSemaphoreGive(g_i2c_mutex);
        } else {
            g_i2c_error_count++;
        }

        // Critical battery check
        if (bv > 0.1f && bv < BATT_CRITICAL_V) {
            criticalShutdown(bv);
        }

        // Mode transitions based on battery voltage
        if (bv > 0.1f) {
            if (bv < BATT_POWERSAVE_V && current_op_mode != 3) {
                current_op_mode = 3;
                Serial.printf("[MODE] Battery low (%.2fV) -> Mode 3 (Power Saving)\n", bv);
                char det[32]; snprintf(det, sizeof(det), "bv=%.2f", bv);
                appendEventToSD("MODE3_POWERSAVE", det);
            } else if (bv >= BATT_POWERSAVE_V && current_op_mode == 3) {
                current_op_mode = 2;
                Serial.println("[MODE] Battery recovered -> Mode 2 (Nominal)");
                char det[32]; snprintf(det, sizeof(det), "bv=%.2f", bv);
                appendEventToSD("MODE2_NOMINAL", det);
            }
        }

        // Modbus RS485 sampling
        static float last_temp = 0.0f, last_hum = 0.0f;
        float temp = last_temp, hum = last_hum;
        uint8_t res = 0xFF;

        for (int retry = 0; retry < 3; retry++) {
            res = node.readHoldingRegisters(0x0000, 2);
            if (res == node.ku8MBSuccess) {
                hum       = node.getResponseBuffer(0) / 10.0f;
                temp      = node.getResponseBuffer(1) / 10.0f;
                last_hum  = hum;
                last_temp = temp;
                break;
            }
            vTaskDelay(pdMS_TO_TICKS(100));
        }
        if (res != node.ku8MBSuccess) {
            g_modbus_crc_error_count++;
            if (samples % 60 == 0) {
                Serial.printf("[MODBUS] Error 0x%02X (total=%d)\n", res, g_modbus_crc_error_count);
            }
        }

        // Rain sensor
        float rain = g_rain_available ? RainSensor.getRainfall() : 0.0f;

        sum_temp   += temp; sum_hum    += hum;  sum_rain   += rain;
        sum_batt_v += bv;   sum_batt_i += bi;
        sum_solar_v+= sv;   sum_solar_i+= si;
        samples++;

        if (samples % 10 == 0) {
            Serial.printf("[SENSOR] %d/%d | T=%.1f H=%.1f | mb=%d i2c=%d | heap=%u stk=%d\n",
                          samples, mode_samples_per_block, temp, hum,
                          g_modbus_crc_error_count, g_i2c_error_count,
                          esp_get_free_heap_size(),
                          uxTaskGetStackHighWaterMark(NULL));
        }

        if (samples >= mode_samples_per_block) {
            MinuteBlock b;
            getTimeStamp(b.timestamp, sizeof(b.timestamp));
            b.uptime_ms    = millis();
            b.temp_avg     = sum_temp   / samples;
            b.hum_avg      = sum_hum    / samples;
            b.rain_sum     = sum_rain;
            b.batt_v_avg   = sum_batt_v / samples;
            b.batt_i_avg   = sum_batt_i / samples;
            b.solar_v_avg  = sum_solar_v/ samples;
            b.solar_i_avg  = sum_solar_i/ samples;
            b.sample_count = samples;
            b.op_mode      = current_op_mode;
            b.wifi_rssi    = (WiFi.status() == WL_CONNECTED) ? (int)WiFi.RSSI() : 0;

            Serial.printf("[SENSOR] Block: T=%.1f H=%.1f R=%.2f ts=%s n=%d\n",
                          b.temp_avg, b.hum_avg, b.rain_sum, b.timestamp, b.sample_count);

            // SD log — ALWAYS first, before queue enqueue. SD is the ground truth.
            // FIX v0.3.5: Removed OTA_IDLE guard — SD writes must NEVER be skipped.
            // OTA now uses per-chunk mutex, so 10s timeout is sufficient.
            if (xSemaphoreTake(g_sd_mutex, pdMS_TO_TICKS(10000)) == pdTRUE) {
                uint32_t sd_start = millis();
                appendToSD("/node_1min.csv", b);    // permanent record — never deleted
                appendToPendingSD(b);               // upload outbox — consumed as uploaded
                uint32_t sd_lat = millis() - sd_start;
                if (sd_lat > g_sd_max_write_latency_ms) g_sd_max_write_latency_ms = sd_lat;
                xSemaphoreGive(g_sd_mutex);
            } else {
                g_sd_failures++;
                Serial.println("[SENSOR] WARNING: SD mutex timeout — block NOT written to SD!");
            }

            // Enqueue for upload
            if (xSemaphoreTake(g_queue_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
                if (tx_queue_count < 60) {
                    tx_queue[tx_queue_count++] = b;
                    Serial.printf("[SENSOR] Queued. Queue: %d\n", tx_queue_count);
                } else {
                    Serial.println("[SENSOR] WARNING: Queue full — block dropped (still on SD).");
                }
                xSemaphoreGive(g_queue_mutex);
            } else {
                Serial.println("[SENSOR] WARNING: Queue mutex timeout — block dropped (still on SD).");
            }

            sum_temp=0; sum_hum=0; sum_rain=0;
            sum_batt_v=0; sum_batt_i=0; sum_solar_v=0; sum_solar_i=0;
            samples = 0;
        }

        // Heap watchdog — check every sample cycle
        checkHeapHealth();

        vTaskDelayUntil(&xLastWakeTime, pdMS_TO_TICKS(mode_sample_rate_ms));
    }
}

// ── Upload Task ───────────────────────────────────────────────────────────────
void uploadTask(void *pvParams) {
    TickType_t xLastWakeTime       = xTaskGetTickCount();
    const TickType_t xFrequency    = pdMS_TO_TICKS(10 * 1000); // tick every 10s
    int ticksPassedSinceUpload     = 0;
    bool was_wifi_connected        = false;  // track WiFi state transitions
    int64_t last_upload_slot       = -1;     // wall-clock upload slot; -1 = not yet initialized

    Serial.println("[UPLOAD] Task started.");

    while (true) {
        vTaskDelayUntil(&xLastWakeTime, xFrequency);
        ticksPassedSinceUpload++;

        int mode_blocks_per_upload  = (current_op_mode == 1) ? 6  : (current_op_mode == 3) ? 30 : 5;
        int mode_time_limit_ticks   = (current_op_mode == 1) ? 6  : (current_op_mode == 3) ? 180 : 30;
        bool wifi_connected         = (WiFi.status() == WL_CONNECTED);

        // ── Wall-clock slot for aligned uploads ──
        // Slot = epoch / upload_period. Upload fires when slot number advances.
        time_t now_wc; time(&now_wc);
        struct tm* ti_wc       = localtime(&now_wc);
        bool   time_valid      = (ti_wc->tm_year >= 120);  // year >= 2020
        int    upload_period_s = (current_op_mode == 1) ? 60
                               : (current_op_mode == 3) ? 1800 : 300;
        int64_t current_slot   = time_valid ? ((int64_t)now_wc / upload_period_s) : -1;
        int  secs_to_next_slot = time_valid
                                 ? (upload_period_s - (int)((int64_t)now_wc % upload_period_s))
                                 : 9999;
        // First valid NTP: anchor slot to now so we wait for the NEXT boundary.
        if (last_upload_slot == -1 && time_valid) {
            last_upload_slot = current_slot;
            Serial.printf("[UPLOAD] Slot anchor: slot=%lld secs_to_next=%d\n",
                          (long long)current_slot, secs_to_next_slot);
        }

        // Status log every 60s
        if (ticksPassedSinceUpload % 6 == 0) {
            int qc = 0;
            if (xSemaphoreTake(g_queue_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
                qc = tx_queue_count; xSemaphoreGive(g_queue_mutex);
            }
            Serial.printf("[UPLOAD] tick=%d/%d queue=%d wifi=%s heap=%u\n",
                          ticksPassedSinceUpload, mode_time_limit_ticks, qc,
                          wifi_connected ? "OK" : "DOWN",
                          esp_get_free_heap_size());
        }

        // ── Modem power management ──
        // Wake modem 3 min before upload slot in Mode 3; fall back to ticks if time invalid.
        bool near_upload = time_valid ? (secs_to_next_slot <= 180)
                                      : (mode_time_limit_ticks - ticksPassedSinceUpload <= 18);
        bool need_modem  = (current_op_mode != 3) || near_upload || (getOTAState() != OTA_IDLE);

        if (need_modem && !is_modem_on) {
            Serial.println("[POWER] LTE Modem ON");
            digitalWrite(WIFI_POWER_PIN, HIGH);
            is_modem_on = true;
            g_dongle_power_cycles++;
            vTaskDelay(pdMS_TO_TICKS(2000));
        } else if (!need_modem && is_modem_on) {
            Serial.println("[POWER] LTE Modem OFF (Power Save)");
            WiFi.disconnect();
            digitalWrite(WIFI_POWER_PIN, LOW);
            is_modem_on = false;
            was_wifi_connected = false;
        }

        // ── WiFi reconnection (non-blocking) ──
        // FIX v0.3.5: moved static declaration out of if-block so we can reset on reconnect
        static int wifi_retry_ticks = 0;
        if (is_modem_on && !wifi_connected) {
            wifi_retry_ticks++;
            if (wifi_retry_ticks % 6 == 1) {  // Try every ~60s (was 30s — reduce churn)
                Serial.println("[WIFI] Reconnecting...");
                WiFi.disconnect();
                WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
            }
        }

        // Detect WiFi reconnection event
        wifi_connected = (WiFi.status() == WL_CONNECTED);  // re-read after possible reconnect
        if (!wifi_connected && was_wifi_connected) {
            Serial.println("[WIFI] Connection lost.");
            appendEventToSD("WIFI_DOWN", "");
        }
        if (wifi_connected && !was_wifi_connected) {
            wifi_retry_ticks = 0;  // FIX v0.3.5: reset so next disconnect retries immediately
            g_wifi_reconnect_count++;
            Serial.printf("[WIFI] Reconnected! (total reconn=%d)\n", g_wifi_reconnect_count);
            char det[16]; snprintf(det, sizeof(det), "rssi=%d", (int)WiFi.RSSI());
            appendEventToSD("WIFI_UP", det);
            // Try NTP immediately on reconnect if we haven't synced recently
            if (g_last_ntp_sync_ms == 0 || (millis() - g_last_ntp_sync_ms) >= NTP_SYNC_INTERVAL_MS) {
                setupNTP();
            }
        }
        was_wifi_connected = wifi_connected;

        // ── Heartbeat ──
        if (wifi_connected && is_modem_on && g_heartbeat_interval_min > 0) {
            uint32_t hb_interval_ms = (uint32_t)g_heartbeat_interval_min * 60UL * 1000UL;
            if (g_last_heartbeat_ms == 0 || (millis() - g_last_heartbeat_ms) >= hb_interval_ms) {
                sendHeartbeat();  // also re-fetches RTDB config after sending
            }
        }

        // ── OTA config poll — once per hour (reduced from every 30s) ──
        if (wifi_connected && is_modem_on && getOTAState() == OTA_IDLE) {
            if (g_last_ota_check_ms == 0 || (millis() - g_last_ota_check_ms) >= OTA_CHECK_INTERVAL_MS) {
                fetchOTAConfig();  // once per hour; heartbeat no longer re-fetches this
            }
        }

        // ── Upload decision ──
        bool shouldUpload = false;
        if (getOTAState() == OTA_IDLE) {
            if (xSemaphoreTake(g_queue_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
                // Primary: fire when wall-clock slot advances (aligned to 1:00, 1:05, …)
                bool slot_advanced  = (time_valid && current_slot > last_upload_slot);
                // Fallback: tick-based when NTP hasn't synced yet
                bool fallback_ticks = (!time_valid && ticksPassedSinceUpload >= mode_time_limit_ticks);
                // Safety: flush if queue is overflowing regardless of timing
                bool queue_overflow = (tx_queue_count >= mode_blocks_per_upload);
                if ((slot_advanced || fallback_ticks || queue_overflow) && tx_queue_count > 0) {
                    shouldUpload = true;
                }
                xSemaphoreGive(g_queue_mutex);
            }
        }

        if (shouldUpload && is_modem_on && wifi_connected && getOTAState() == OTA_IDLE) {

            MinuteBlock copy_q[60];
            int c = 0;
            int send_count = 0;
            if (xSemaphoreTake(g_queue_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
                c = tx_queue_count;
                send_count = (c > mode_blocks_per_upload) ? mode_blocks_per_upload : c;
                for (int i = 0; i < send_count; i++) copy_q[i] = tx_queue[i];
                xSemaphoreGive(g_queue_mutex);
            }

            if (send_count == 0) {
                Serial.println("[UPLOAD] Queue empty at upload time. Resetting timer.");
                ticksPassedSinceUpload = 0;
            } else {
                Serial.printf("[UPLOAD] Uploading %d blocks (queued=%d)...\n", send_count, c);
                bool success = uploadFiveMinPayload(copy_q, send_count, "node_data_0v3");

                if (success) {
                    Serial.printf("[UPLOAD] SUCCESS: %d blocks sent.\n", send_count);
                    if (xSemaphoreTake(g_queue_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
                        int new_items = tx_queue_count - send_count;
                        if (new_items > 0) {
                            for (int i = 0; i < new_items; i++) {
                                tx_queue[i] = tx_queue[send_count + i];
                            }
                        }
                        tx_queue_count = (new_items > 0) ? new_items : 0;
                        xSemaphoreGive(g_queue_mutex);
                    }
                    ticksPassedSinceUpload = 0;
                    last_upload_slot = current_slot;  // advance slot so we wait for the next boundary

                    // Health snapshot + event log on success
                    {
                        int qd = 0;
                        if (xSemaphoreTake(g_queue_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
                            qd = tx_queue_count; xSemaphoreGive(g_queue_mutex);
                        }
                        appendHealthToSD(true, qd);
                        char det[24]; snprintf(det, sizeof(det), "sent=%d", send_count);
                        appendEventToSD("UPLOAD_OK", det);
                    }

                    // Trigger OTA if pending
                    if (pending_ota_update && rtdb_target_url != "" &&
                        rtdb_target_url != "null" && getOTAState() == OTA_IDLE) {
                        setOTAState(OTA_START_DOWNLOAD);
                    }
                } else {
                    Serial.println("[UPLOAD] Failed. Retaining queue, retrying next tick.");
                    // Health snapshot + event log on failure
                    int qd = 0;
                    if (xSemaphoreTake(g_queue_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
                        qd = tx_queue_count; xSemaphoreGive(g_queue_mutex);
                    }
                    appendHealthToSD(false, qd);
                    appendEventToSD("UPLOAD_FAIL", "");
                }
            }
        }

        // ── Pending backlog re-upload — gradual catch-up after outage ──
        // Runs after the regular upload block, one batch per tick (every 10s).
        // Uses node_pending_0v3 collection with deterministic docId (idempotent).
        if (wifi_connected && is_modem_on && getOTAState() == OTA_IDLE) {
            if (g_pending_cursor < g_pending_total) {
                uploadPendingBlocks();
            }
        }

        // ── NTP sync — wall-clock based, outside upload block ──
        if (wifi_connected && is_modem_on) {
            uint32_t now_ms = millis();
            if (g_last_ntp_sync_ms == 0 ||
                (now_ms - g_last_ntp_sync_ms) >= NTP_SYNC_INTERVAL_MS) {
                setupNTP();
            }
        }

        // Heap watchdog in upload task too
        checkHeapHealth();
    }
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    Serial.printf("\n\n=== Sipat Banwa Node Firmware %s ===\n", FIRMWARE_VERSION.c_str());

    // Power on the WiFi Dongle/Modem MOSFET
    pinMode(WIFI_POWER_PIN, OUTPUT);
    digitalWrite(WIFI_POWER_PIN, HIGH);
    delay(2000);

    g_i2c_mutex   = xSemaphoreCreateMutex();
    g_queue_mutex = xSemaphoreCreateMutex();
    g_sd_mutex    = xSemaphoreCreateMutex();
    g_ota_mutex   = xSemaphoreCreateMutex();

    // I2C devices
    Wire.begin(21, 22);
    if (!ina_batt.init())  Serial.println("[INA226] Batt init fail");
    else ina_batt.setResistorRange(0.1, 2.0);

    if (!ina_solar.init()) Serial.println("[INA226] Solar init fail");
    else ina_solar.setResistorRange(0.1, 2.0);

    // Modbus
    Serial1.begin(9600, SERIAL_8N1, RS485_RX, RS485_TX);
    node.begin(1, Serial1);

    // Rain sensor — check init
    RainSerial.begin(9600, SERIAL_8N1, RAIN_RX, RAIN_TX);
    g_rain_available = RainSensor.begin();
    if (!g_rain_available) {
        Serial.println("[RAIN] Sensor init failed — rainfall will read 0.");
    } else {
        Serial.println("[RAIN] Sensor OK.");
    }

    // SD Card — check init
    SPI.begin(18, 19, 23, SD_CS);
    g_sd_available = SD.begin(SD_CS);
    if (!g_sd_available) {
        Serial.println("[SD] *** INIT FAILED — data will NOT be logged to SD ***");
    } else {
        Serial.println("[SD] Card OK.");
    }

    // Log BOOT first — must be the first event in the event log.
    appendEventToSD("BOOT", FIRMWARE_VERSION.c_str());

    // Restore pending upload state (may log BOOT_BACKLOG after BOOT — correct order).
    if (g_sd_available) loadPendingCursor();

    // ── WiFi connect with timeout (30s max) ──
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print("[WIFI] Connecting");
    uint32_t wifi_start = millis();
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
        if ((millis() - wifi_start) >= WIFI_CONNECT_TIMEOUT_MS) {
            Serial.println("\n[WIFI] Connect timeout — proceeding without WiFi.");
            Serial.println("[WIFI] Upload task will retry connection periodically.");
            break;
        }
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n[WIFI] Connected!");
        setupNTP();
        setupOTA();
    } else {
        // Still set NODE_ID even without WiFi
        if (NODE_ID_OVERRIDE != "") NODE_ID = NODE_ID_OVERRIDE;
        else {
            NODE_ID = WiFi.macAddress(); NODE_ID.replace(":", ""); NODE_ID.toLowerCase();
        }
    }

    // Initial startup packet (only if WiFi is connected)
    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("[Startup] Sending initial packet...");

        // FIX: configTime() is async — wait until RTC is actually valid before
        // grabbing the startup timestamp, otherwise we get "WAITING_SYNC".
        // Retry NTP and poll up to 20s total.
        {
            uint32_t ntp_deadline = millis() + 20000UL;
            struct tm ti;
            while (millis() < ntp_deadline) {
                if (getLocalTime(&ti, 1000) && ti.tm_year >= 120) break;
                Serial.print("[NTP] Waiting for clock...\n");
                // If still not synced halfway through, re-trigger configTime
                if (millis() > ntp_deadline - 10000UL) {
                    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER, "time.google.com");
                }
            }
            if (ti.tm_year < 120) {
                Serial.println("[NTP] Clock not synced before startup packet — timestamp will show WAITING_SYNC.");
            } else {
                g_last_ntp_sync_ms = millis();
                Serial.println("[NTP] Clock confirmed valid for startup packet.");
            }
        }

        MinuteBlock initial_b;
        getTimeStamp(initial_b.timestamp, sizeof(initial_b.timestamp));
        initial_b.uptime_ms = millis();

        float t=0, h=0, r=0, bv=0, bi=0, sv=0, si=0;
        for (int retry = 0; retry < 3; retry++) {
            if (node.readHoldingRegisters(0x0000, 2) == node.ku8MBSuccess) {
                h = node.getResponseBuffer(0) / 10.0f;
                t = node.getResponseBuffer(1) / 10.0f;
                break;
            }
            delay(100);
        }
        if (g_rain_available) r = RainSensor.getRainfall();
        bv = ina_batt.getBusVoltage_V();
        bi = ina_batt.getCurrent_mA();
        sv = ina_solar.getBusVoltage_V();
        si = ina_solar.getCurrent_mA();

        initial_b.temp_avg    = t;  initial_b.hum_avg    = h;
        initial_b.rain_sum    = r;  initial_b.batt_v_avg = bv;
        initial_b.batt_i_avg  = bi; initial_b.solar_v_avg= sv;
        initial_b.solar_i_avg = si; initial_b.sample_count = 1;

        MinuteBlock initial_q[1]; initial_q[0] = initial_b;
        uploadFiveMinPayload(initial_q, 1, "startup_0v3");
    } else {
        Serial.println("[Startup] No WiFi — skipping initial packet (sensor task will start logging to SD).");
    }

    Serial.printf("[SETUP] Free heap: %u | Min heap: %u\n",
                  esp_get_free_heap_size(), esp_get_minimum_free_heap_size());

    // Start tasks — these run regardless of WiFi status
    xTaskCreatePinnedToCore(sensorTask, "SensorTsk", 12288, NULL, 3, NULL, 1);
    xTaskCreatePinnedToCore(uploadTask, "UploadTsk", 16384, NULL, 2, NULL, 0);
    xTaskCreatePinnedToCore(otaTask,    "OtaTsk",    8192,  NULL, 1, NULL, 0);
}

void loop() {
    vTaskDelay(pdMS_TO_TICKS(3000));
}
