// ── Project Sipat Banwa — Node Firmware v0.2 ────────────────────────────────
// Block average logic: 1s sample -> 1-min avg -> 5-min batch upload
//
// Changes from v0.1 (ota_initial):
//   - SD logs now include uptime_ms column for cold-boot epoch reconciliation
//   - Critical battery shutdown (flush SD, transmit SHUTDOWN packet, deep sleep)
//   - OTA download: detect partial/interrupted download correctly
//   - g_i2c_error_count now actually incremented on I2C mutex timeout
//   - Upload timer resets on empty queue to prevent infinite upload spam
//   - current_ota_state protected by its own mutex (was bare volatile)
//   - resetOTAFailed() helper removes 5x duplicated OTA failure state reset
//   - NTP sync is time-based (6h wall-clock) not upload-count based

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

const String FIRMWARE_VERSION = "v0.2.1";
const String NODE_ID_OVERRIDE = "node_1"; // "" = use MAC address

// PINS
#define SD_CS          5
#define RS485_RX       16
#define RS485_TX       17
#define RAIN_RX        25
#define RAIN_TX        26
#define WIFI_POWER_PIN 13

// Battery thresholds
#define BATT_POWERSAVE_V  11.5f  // Trigger Mode 3 below this
#define BATT_CRITICAL_V   11.0f  // Trigger shutdown below this

// NTP sync interval (wall-clock based)
const uint32_t NTP_SYNC_INTERVAL_MS = 6UL * 60UL * 60UL * 1000UL; // 6 hours
const uint32_t OTA_READ_IDLE_TIMEOUT_MS = 30000UL; // abort stalled OTA read after 30s without progress

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
    uint32_t uptime_ms;       // monotonic millis() at block close — for epoch reconciliation
    float    temp_avg;
    float    hum_avg;
    float    rain_sum;
    float    batt_v_avg;
    float    batt_i_avg;
    float    solar_v_avg;
    float    solar_i_avg;
    int      sample_count;
};

// Queue for MinuteBlocks (cap 60 = up to 30 mins of backlog)
MinuteBlock tx_queue[60];
int tx_queue_count = 0;

SemaphoreHandle_t g_i2c_mutex;
SemaphoreHandle_t g_queue_mutex;
SemaphoreHandle_t g_sd_mutex;
SemaphoreHandle_t g_ota_mutex;   // protects current_ota_state read/write

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

// NTP time tracking
const long  GMT_OFFSET_SEC      = 28800; // UTC+8
const int   DAYLIGHT_OFFSET_SEC = 0;
const char* NTP_SERVER          = "pool.ntp.org";
uint32_t    g_last_ntp_sync_ms  = 0;     // millis() at last successful NTP sync

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

// Consolidated OTA failure reset — called from any failure path in otaTask
void resetOTAFailed(const String& reason) {
    Serial.printf("[OTA] FAILED: %s\n", reason.c_str());
    setOTAState(OTA_IDLE);
    failed_ota_version = rtdb_target_version;
    pending_ota_update = false;
}

// ── OTA Support Logic ─────────────────────────────────────────────────────────
void reportStatusToRTDB(const String& ota_status, const String& details = "") {
    WiFiClientSecure client; client.setInsecure();
    HTTPClient http;
    String url = String(DATABASE_URL) + "nodes/" + NODE_ID + "/status.json?auth=" + API_KEY;
    http.begin(client, url);
    http.addHeader("Content-Type", "application/json");

    JsonDocument doc;
    doc["current_version"] = FIRMWARE_VERSION;
    doc["ota_status"]      = ota_status;
    doc["last_boot_ms"]    = (int)millis();
    if (details != "") doc["ota_details"] = details;

    String payload;
    serializeJson(doc, payload);
    int code = http.PUT(payload);
    if (code < 0) {
        Serial.printf("[RTDB] reportStatus failed (err=%d)\n", code);
    }
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
                http.end();
                reportStatusToRTDB("failed", "HTTP Begin Failed");
                resetOTAFailed("HTTP Begin Failed");
                vTaskDelay(pdMS_TO_TICKS(2000));
                continue;
            }

            int httpCode = http.GET();
            if (httpCode != HTTP_CODE_OK) {
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

            if (xSemaphoreTake(g_sd_mutex, portMAX_DELAY) == pdTRUE) {
                if (SD.exists("/update.bin")) {
                    SD.remove("/update.bin");
                }
                File file = SD.open("/update.bin", FILE_WRITE);
                if (!file) {
                    xSemaphoreGive(g_sd_mutex);
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
                        if (c <= 0) break;  // stream error
                        if (file.write(buff, c) != (size_t)c) {
                            // SD write failure mid-download
                            Serial.println("[OTA] SD write failed mid-download.");
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
                file.close();
                xSemaphoreGive(g_sd_mutex);

                // Validate download completeness
                bool size_ok = (content_len == -1) ? (total_written > 0)
                                                    : (total_written == content_len);
                write_ok = (total_written > 0) && size_ok;
            } else {
                http.end();
                reportStatusToRTDB("failed", "SD Mutex Timeout");
                resetOTAFailed("SD Mutex Timeout");
                vTaskDelay(pdMS_TO_TICKS(2000));
                continue;
            }

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

            if (xSemaphoreTake(g_sd_mutex, portMAX_DELAY) == pdTRUE) {
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

void fetchOTAConfig() {
    if (getOTAState() != OTA_IDLE) return;

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
    http.end();
}

void setupOTA() {
    if (NODE_ID_OVERRIDE != "") NODE_ID = NODE_ID_OVERRIDE;
    else {
        NODE_ID = WiFi.macAddress(); NODE_ID.replace(":", ""); NODE_ID.toLowerCase();
    }
    reportStatusToRTDB("idle");
    fetchOTAConfig();
}

// ── Critical Shutdown ─────────────────────────────────────────────────────────
// Called when battery drops below BATT_CRITICAL_V.
// Flushes SD, transmits a SHUTDOWN health packet, then deep sleeps indefinitely.
void criticalShutdown(float batt_v) {
    Serial.printf("[SHUTDOWN] Battery critical (%.2fV). Flushing and sleeping.\n", batt_v);

    // Best-effort SHUTDOWN packet to cloud
    if (WiFi.status() == WL_CONNECTED) {
        WiFiClientSecure client; client.setInsecure();
        HTTPClient http;
        time_t now_stamp; time(&now_stamp);
        String docId = NODE_ID + "_shutdown_" + String((long)now_stamp);
        String url = String(FIRESTORE_BASE) + "/shutdown_events/" + docId + "?key=" + API_KEY;
        http.begin(client, url);
        http.addHeader("Content-Type", "application/json");

        JsonDocument doc;
        JsonObject fields = doc["fields"].to<JsonObject>();
        fields["node_id"]["stringValue"]   = NODE_ID;
        fields["firmware"]["stringValue"]  = FIRMWARE_VERSION;
        fields["batt_v"]["doubleValue"]    = batt_v;
        fields["uptime_ms"]["integerValue"] = String(millis());
        fields["event"]["stringValue"]     = "CRITICAL_SHUTDOWN";

        String payload; serializeJson(doc, payload);
        http.PATCH(payload);
        http.end();
    }

    // Flush SD card buffers by force-closing (SD library closes on SD.end())
    SD.end();

    Serial.println("[SHUTDOWN] Entering deep sleep.");
    esp_deep_sleep_start();  // No wakeup source configured — indefinite sleep
}

// ── SD Card Append Logic ──────────────────────────────────────────────────────
// Each row now includes uptime_ms for cold-boot epoch reconciliation.
void appendToSD(const char* path, const MinuteBlock& b) {
    if (!SD.exists(path)) {
        File fHeader = SD.open(path, FILE_WRITE);
        if (fHeader) {
            fHeader.println("timestamp,uptime_ms,temp_avg,hum_avg,rain_sum,batt_v,batt_i,solar_v,solar_i,sample_count");
            fHeader.close();
        }
    }
    File f = SD.open(path, FILE_APPEND);
    if (!f) { g_sd_failures++; return; }
    f.printf("%s,%lu,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%d\n",
             b.timestamp, b.uptime_ms,
             b.temp_avg, b.hum_avg, b.rain_sum,
             b.batt_v_avg, b.batt_i_avg, b.solar_v_avg, b.solar_i_avg,
             b.sample_count);
    f.close();
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
        val["ts"]["stringValue"]     = queue[i].timestamp;
        val["uptime_ms"]["integerValue"] = String(queue[i].uptime_ms);
        val["temp"]["doubleValue"]   = queue[i].temp_avg;
        val["hum"]["doubleValue"]    = queue[i].hum_avg;
        val["rain"]["doubleValue"]   = queue[i].rain_sum;
        val["batt_v"]["doubleValue"] = queue[i].batt_v_avg;
        val["batt_i"]["doubleValue"] = queue[i].batt_i_avg;
        val["solar_v"]["doubleValue"]= queue[i].solar_v_avg;
        val["solar_i"]["doubleValue"]= queue[i].solar_i_avg;
        val["samples"]["integerValue"] = String(queue[i].sample_count);
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

    String payload;
    serializeJson(doc, payload);

    uint32_t t_start = millis();
    int code = http.PATCH(payload);
    g_upload_latency_ms = millis() - t_start;
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
void sensorTask(void *pvParams) {
    float sum_temp=0, sum_hum=0, sum_rain=0;
    float sum_batt_v=0, sum_batt_i=0, sum_solar_v=0, sum_solar_i=0;
    int   samples = 0;

    TickType_t xLastWakeTime = xTaskGetTickCount();
    Serial.println("[SENSOR] Task started.");

    while (true) {
        int mode_sample_rate_ms   = (current_op_mode == 3) ? 10000 : 1000;
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
            g_i2c_error_count++;  // mutex timeout = I2C bus likely stuck
        }

        // Critical battery check — every sample
        if (bv > 0.1f && bv < BATT_CRITICAL_V) {
            criticalShutdown(bv);
            // Does not return — ESP enters deep sleep
        }

        // Mode transitions based on battery voltage
        if (bv > 0.1f) {
            if (bv < BATT_POWERSAVE_V && current_op_mode != 3) {
                current_op_mode = 3;
                Serial.printf("[MODE] Battery low (%.2fV) -> Mode 3 (Power Saving)\n", bv);
            } else if (bv >= BATT_POWERSAVE_V && current_op_mode == 3) {
                current_op_mode = 2;
                Serial.println("[MODE] Battery recovered -> Mode 2 (Nominal)");
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
            if (samples % 60 == 0) {  // throttle log spam
                Serial.printf("[MODBUS] Error 0x%02X (total=%d)\n", res, g_modbus_crc_error_count);
            }
        }

        float rain = RainSensor.getRainfall();

        sum_temp   += temp; sum_hum    += hum;  sum_rain   += rain;
        sum_batt_v += bv;   sum_batt_i += bi;
        sum_solar_v+= sv;   sum_solar_i+= si;
        samples++;

        if (samples % 10 == 0) {
            Serial.printf("[SENSOR] %d/%d | T=%.1f H=%.1f | mb_err=%d i2c_err=%d | stack=%d\n",
                          samples, mode_samples_per_block, temp, hum,
                          g_modbus_crc_error_count, g_i2c_error_count,
                          uxTaskGetStackHighWaterMark(NULL));
        }

        if (samples >= mode_samples_per_block) {
            MinuteBlock b;
            getTimeStamp(b.timestamp, sizeof(b.timestamp));
            b.uptime_ms   = millis();
            b.temp_avg    = sum_temp   / samples;
            b.hum_avg     = sum_hum    / samples;
            b.rain_sum    = sum_rain;
            b.batt_v_avg  = sum_batt_v / samples;
            b.batt_i_avg  = sum_batt_i / samples;
            b.solar_v_avg = sum_solar_v/ samples;
            b.solar_i_avg = sum_solar_i/ samples;
            b.sample_count= samples;

            Serial.printf("[SENSOR] Block: T=%.1f H=%.1f R=%.2f ts=%s n=%d\n",
                          b.temp_avg, b.hum_avg, b.rain_sum, b.timestamp, b.sample_count);

            // SD log — skip during OTA to avoid SD contention
            if (getOTAState() == OTA_IDLE) {
                if (xSemaphoreTake(g_sd_mutex, pdMS_TO_TICKS(500)) == pdTRUE) {
                    uint32_t sd_start = millis();
                    appendToSD("/node_1min.csv", b);
                    uint32_t sd_lat = millis() - sd_start;
                    if (sd_lat > g_sd_max_write_latency_ms) g_sd_max_write_latency_ms = sd_lat;
                    xSemaphoreGive(g_sd_mutex);
                }
            }

            // Enqueue for upload
            if (xSemaphoreTake(g_queue_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
                if (tx_queue_count < 60) {
                    tx_queue[tx_queue_count++] = b;
                    Serial.printf("[SENSOR] Queued. Queue: %d\n", tx_queue_count);
                } else {
                    Serial.println("[SENSOR] WARNING: Queue full — block dropped.");
                }
                xSemaphoreGive(g_queue_mutex);
            } else {
                Serial.println("[SENSOR] WARNING: Queue mutex timeout — block dropped.");
            }

            sum_temp=0; sum_hum=0; sum_rain=0;
            sum_batt_v=0; sum_batt_i=0; sum_solar_v=0; sum_solar_i=0;
            samples = 0;
        }

        vTaskDelayUntil(&xLastWakeTime, pdMS_TO_TICKS(mode_sample_rate_ms));
    }
}

// ── Upload Task ───────────────────────────────────────────────────────────────
void uploadTask(void *pvParams) {
    TickType_t xLastWakeTime       = xTaskGetTickCount();
    const TickType_t xFrequency    = pdMS_TO_TICKS(10 * 1000); // tick every 10s
    int ticksPassedSinceUpload     = 0;

    Serial.println("[UPLOAD] Task started.");

    while (true) {
        vTaskDelayUntil(&xLastWakeTime, xFrequency);
        ticksPassedSinceUpload++;

        int mode_blocks_per_upload  = (current_op_mode == 1) ? 6  : (current_op_mode == 3) ? 30 : 5;
        int mode_time_limit_ticks   = (current_op_mode == 1) ? 6  : (current_op_mode == 3) ? 180 : 30;

        if (ticksPassedSinceUpload % 6 == 0) {
            int qc = 0;
            if (xSemaphoreTake(g_queue_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
                qc = tx_queue_count; xSemaphoreGive(g_queue_mutex);
            }
            Serial.printf("[UPLOAD] tick=%d/%d queue=%d wifi=%s\n",
                          ticksPassedSinceUpload, mode_time_limit_ticks, qc,
                          WiFi.status() == WL_CONNECTED ? "OK" : "DOWN");
        }

        // Modem power management
        bool need_modem = (current_op_mode != 3) ||
                          (mode_time_limit_ticks - ticksPassedSinceUpload <= 18) ||
                          (getOTAState() != OTA_IDLE);

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
        }

        bool shouldUpload = false;
        if (getOTAState() == OTA_IDLE) {
            if (xSemaphoreTake(g_queue_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
                if (tx_queue_count >= mode_blocks_per_upload ||
                    ticksPassedSinceUpload >= mode_time_limit_ticks) {
                    shouldUpload = true;
                }
                xSemaphoreGive(g_queue_mutex);
            }
        }

        // WiFi reconnection
        if (is_modem_on && WiFi.status() != WL_CONNECTED) {
            static int wifi_retry_ticks = 0;
            if (wifi_retry_ticks++ % 3 == 0) {
                Serial.println("[WIFI] Reconnecting...");
                WiFi.disconnect();
                WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
            }
        }

        // OTA config poll when idle (roughly every 30s)
        if (is_modem_on && WiFi.status() == WL_CONNECTED &&
            !shouldUpload && (ticksPassedSinceUpload % 3 == 0)) {
            fetchOTAConfig();
        }

        if (shouldUpload && is_modem_on && WiFi.status() == WL_CONNECTED &&
            getOTAState() == OTA_IDLE) {

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
                // Queue was empty — reset timer so we stop hammering upload
                Serial.println("[UPLOAD] Queue empty at upload time. Resetting timer.");
                ticksPassedSinceUpload = 0;
            } else {
                Serial.printf("[UPLOAD] Uploading %d blocks (queued=%d)...\n", send_count, c);
                bool success = uploadFiveMinPayload(copy_q, send_count, "node_data_v1");

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

                    // Trigger OTA if pending and upload just confirmed connectivity
                    if (pending_ota_update && rtdb_target_url != "" &&
                        rtdb_target_url != "null" && getOTAState() == OTA_IDLE) {
                        setOTAState(OTA_START_DOWNLOAD);
                    }
                } else {
                    Serial.println("[UPLOAD] Failed. Retaining queue, retrying next tick.");
                    // Do not reset ticksPassedSinceUpload — retry next tick
                }
            }

            // NTP sync: wall-clock based every 6 hours
            uint32_t now_ms = millis();
            if (g_last_ntp_sync_ms == 0 ||
                (now_ms - g_last_ntp_sync_ms) >= NTP_SYNC_INTERVAL_MS) {
                setupNTP();
            }
        }
    }
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);

    pinMode(WIFI_POWER_PIN, OUTPUT);
    digitalWrite(WIFI_POWER_PIN, HIGH);
    delay(2000);

    g_i2c_mutex   = xSemaphoreCreateMutex();
    g_queue_mutex = xSemaphoreCreateMutex();
    g_sd_mutex    = xSemaphoreCreateMutex();
    g_ota_mutex   = xSemaphoreCreateMutex();

    Wire.begin(21, 22);
    if (!ina_batt.init())  Serial.println("[INA226] Batt init fail");
    else ina_batt.setResistorRange(0.1, 2.0);

    if (!ina_solar.init()) Serial.println("[INA226] Solar init fail");
    else ina_solar.setResistorRange(0.1, 2.0);

    Serial1.begin(9600, SERIAL_8N1, RS485_RX, RS485_TX);
    node.begin(1, Serial1);

    RainSerial.begin(9600, SERIAL_8N1, RAIN_RX, RAIN_TX);
    RainSensor.begin();

    SPI.begin(18, 19, 23, SD_CS);
    SD.begin(SD_CS);

    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
    Serial.println("\n[WIFI] Connected");

    setupNTP();
    setupOTA();

    // Initial startup packet
    Serial.println("[Startup] Sending initial packet...");
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
    r  = RainSensor.getRainfall();
    bv = ina_batt.getBusVoltage_V();
    bi = ina_batt.getCurrent_mA();
    sv = ina_solar.getBusVoltage_V();
    si = ina_solar.getCurrent_mA();

    initial_b.temp_avg    = t;  initial_b.hum_avg    = h;
    initial_b.rain_sum    = r;  initial_b.batt_v_avg = bv;
    initial_b.batt_i_avg  = bi; initial_b.solar_v_avg= sv;
    initial_b.solar_i_avg = si; initial_b.sample_count = 1;

    MinuteBlock initial_q[1]; initial_q[0] = initial_b;
    uploadFiveMinPayload(initial_q, 1, "startup");

    xTaskCreatePinnedToCore(sensorTask, "SensorTsk", 12288, NULL, 3, NULL, 1);
    xTaskCreatePinnedToCore(uploadTask, "UploadTsk", 16384, NULL, 2, NULL, 0);
    xTaskCreatePinnedToCore(otaTask,   "OtaTsk",    8192,  NULL, 1, NULL, 0);
}

void loop() {
    vTaskDelay(pdMS_TO_TICKS(3000));
}
