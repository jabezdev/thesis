// ── Project Sipat Banwa — Advanced OTA Base Firmware (Sensor Merged) ───────
// Block average logic: 1s sample -> 1-min avg -> 5-min batch upload

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

const String FIRMWARE_VERSION = "v1.0-ota-initial";
const String NODE_ID_OVERRIDE = "ota_initial_node_1"; // "" = use MAC address

// PINS
#define SD_CS          5
#define RS485_RX       16
#define RS485_TX       17
#define RAIN_RX        25
#define RAIN_TX        26
#define WIFI_POWER_PIN 13 // Optional power save MOSFET

// ── Hardware Objects ───────────────────────────────────────────────────────────
ModbusMaster     node;
HardwareSerial   RainSerial(2);
DFRobot_RainfallSensor_UART RainSensor(&RainSerial);
INA226_WE        ina_batt = INA226_WE(0x40);
INA226_WE        ina_solar = INA226_WE(0x41);

// OTA State
String NODE_ID = "";
String rtdb_target_version = "";
String rtdb_target_url     = "";
String rtdb_target_md5     = "";

enum OTAState { OTA_IDLE, OTA_START_DOWNLOAD, OTA_DOWNLOADING, OTA_FLASHING };
volatile OTAState current_ota_state = OTA_IDLE;

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
    int valid_reading;
};

struct MinuteBlock {
    char timestamp[20];
    float temp_avg;
    float hum_avg;
    float rain_sum;
    float batt_v_avg;
    float batt_i_avg;
    float solar_v_avg;
    float solar_i_avg;
    int sample_count; // Expected 60
};

// Queue for MinuteBlocks (Cap 60 for up to 30 mins)
MinuteBlock tx_queue[60];
int tx_queue_count = 0;

SemaphoreHandle_t g_i2c_mutex;
SemaphoreHandle_t g_queue_mutex;
SemaphoreHandle_t g_sd_mutex;

int current_op_mode = 2; // 1: High Alert, 2: Nominal, 3: Power Saving
bool is_modem_on = true; // State tracker for WIFI_POWER_PIN

// Telemetry state
uint32_t g_send_success = 0;
uint32_t g_send_fail = 0;
uint32_t g_http_errors = 0;
uint32_t g_sd_failures = 0;

// Advanced Telemetry State
uint32_t g_i2c_error_count = 0;
uint32_t g_modbus_crc_error_count = 0;
uint32_t g_dongle_power_cycles = 0;
uint32_t g_http_2xx_count = 0;
uint32_t g_http_transport_error_count = 0;
uint32_t g_upload_latency_ms = 0;
uint32_t g_sd_max_write_latency_ms = 0;

// NTP Time setup
const long GMT_OFFSET_SEC = 28800; // UTC+8
const int DAYLIGHT_OFFSET_SEC = 0;
const char* NTP_SERVER = "pool.ntp.org";

void getTimeStamp(char* buf, size_t len) {
  time_t now;
  time(&now);
  struct tm* timeinfo = localtime(&now);
  if (timeinfo->tm_year < 120) { // If before 2020 (i.e., not synced)
    strncpy(buf, "WAITING_SYNC", len);
    return;
  }
  snprintf(buf, len, "%04d-%02d-%02d %02d:%02d:%02d",
           timeinfo->tm_year + 1900, timeinfo->tm_mon + 1, timeinfo->tm_mday,
           timeinfo->tm_hour, timeinfo->tm_min, timeinfo->tm_sec);
}

void setupNTP() {
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[NTP] Syncing...");
    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER, "time.google.com");
    struct tm timeinfo;
    int retry = 0;
    while (!getLocalTime(&timeinfo, 1000) && retry < 10) {
      Serial.print(".");
      retry++;
    }
    if (retry < 10) Serial.println("\n[NTP] System Time Synced.");
    else Serial.println("\n[NTP] Sync Timeout.");
  }
}

// ── OTA Support Logic ─────────────────────────────────────────────────────────
void reportStatusToRTDB(String ota_status, String details = "") {
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  String url = String(DATABASE_URL) + "nodes/" + NODE_ID + "/status.json?auth=" + API_KEY;
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  doc["current_version"] = FIRMWARE_VERSION;
  doc["ota_status"] = ota_status;
  doc["last_boot_ms"] = (int)millis();
  if (details != "") doc["ota_details"] = details;

  String payload;
  serializeJson(doc, payload);
  http.PUT(payload);
  http.end();
}

void otaTask(void *pvParams) {
    while (true) {
        if (current_ota_state == OTA_START_DOWNLOAD) {
            Serial.print("\n=== STARTING BACKGROUND OTA ===\nDownloading from: ");
            Serial.println(rtdb_target_url);
            reportStatusToRTDB("downloading_to_sd", rtdb_target_url);
            
            WiFiClientSecure client;
            client.setInsecure();
            HTTPClient http;
            if (http.begin(client, rtdb_target_url)) {
                int httpCode = http.GET();
                if (httpCode == HTTP_CODE_OK) {
                    int len = http.getSize();
                    WiFiClient *stream = http.getStreamPtr();
                    if (xSemaphoreTake(g_sd_mutex, portMAX_DELAY) == pdTRUE) {
                        File file = SD.open("/update.bin", FILE_WRITE);
                        if (file) {
                            uint8_t buff[2048] = { 0 };
                            int total_written = 0;
                            bool download_success = true;
                            
                            current_ota_state = OTA_DOWNLOADING;
                            while (http.connected() && (len > 0 || len == -1)) {
                                size_t size = stream->available();
                                if (size > 0) {
                                    int c = stream->readBytes(buff, ((size > sizeof(buff)) ? sizeof(buff) : size));
                                    file.write(buff, c);
                                    total_written += c;
                                    if (len > 0) len -= c;
                                } else {
                                    vTaskDelay(pdMS_TO_TICKS(100)); // Yield while waiting for network
                                }
                                vTaskDelay(pdMS_TO_TICKS(50)); // Yield CPU to other tasks
                            }
                            file.close();
                            xSemaphoreGive(g_sd_mutex);
                            
                            // Wait briefly before flashing
                            vTaskDelay(pdMS_TO_TICKS(500));
                            
                            if (download_success && total_written > 0) {
                                current_ota_state = OTA_FLASHING;
                            } else {
                                reportStatusToRTDB("failed", "Download interrupted");
                                current_ota_state = OTA_IDLE;
                                failed_ota_version = rtdb_target_version;
                                pending_ota_update = false; // Reset flags
                            }
                        } else {
                            xSemaphoreGive(g_sd_mutex);
                            reportStatusToRTDB("failed", "SD Write Error");
                            current_ota_state = OTA_IDLE;
                            failed_ota_version = rtdb_target_version;
                            pending_ota_update = false;
                        }
                    } else {
                        reportStatusToRTDB("failed", "SD Mutex Timeout");
                        current_ota_state = OTA_IDLE;
                        failed_ota_version = rtdb_target_version;
                        pending_ota_update = false;
                    }
                } else {
                    reportStatusToRTDB("failed", "HTTP Code " + String(httpCode));
                    current_ota_state = OTA_IDLE;
                    failed_ota_version = rtdb_target_version;
                    pending_ota_update = false;
                }
                http.end();
            } else {
                reportStatusToRTDB("failed", "HTTP Begin Failed");
                current_ota_state = OTA_IDLE;
                failed_ota_version = rtdb_target_version;
                pending_ota_update = false;
            }
        } else if (current_ota_state == OTA_FLASHING) {
            reportStatusToRTDB("flashing", "Local SD Update");
            if (xSemaphoreTake(g_sd_mutex, portMAX_DELAY) == pdTRUE) {
                File updateFile = SD.open("/update.bin");
                if (updateFile) {
                    size_t updateSize = updateFile.size();
                    if (rtdb_target_md5.length() > 0) {
                        Update.setMD5(rtdb_target_md5.c_str());
                    }
                    
                    if (Update.begin(updateSize)) {
                        Serial.println("Writing to OTA partition...");
                        size_t written = Update.writeStream(updateFile);
                        if (written == updateSize) {
                            if (Update.end()) {
                                Serial.println("OTA Success! Rebooting...");
                                reportStatusToRTDB("idle");
                                delay(1000);
                                ESP.restart();
                            } else {
                                reportStatusToRTDB("failed", "Update end error: " + String(Update.getError()));
                                failed_ota_version = rtdb_target_version;
                            }
                        } else {
                            reportStatusToRTDB("failed", "Written only " + String(written) + "/" + String(updateSize));
                            failed_ota_version = rtdb_target_version;
                        }
                    } else {
                        reportStatusToRTDB("failed", "Not enough space to begin OTA");
                        failed_ota_version = rtdb_target_version;
                    }
                    updateFile.close();
                } else {
                    reportStatusToRTDB("failed", "Failed to open SD bin for update");
                    failed_ota_version = rtdb_target_version;
                }
                xSemaphoreGive(g_sd_mutex);
            } else {
                reportStatusToRTDB("failed", "SD Mutex Timeout on Flash");
                failed_ota_version = rtdb_target_version;
            }
            current_ota_state = OTA_IDLE;
            pending_ota_update = false;
        }
        vTaskDelay(pdMS_TO_TICKS(2000)); // Low priority poll
    }
}

void fetchOTAConfig() {
  // Guard clause: do not fetch new config if already processing an update
  if (current_ota_state != OTA_IDLE) return;

  WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  String url = String(DATABASE_URL) + "nodes/" + NODE_ID + "/config.json?auth=" + API_KEY;
  http.begin(client, url);
  int httpCode = http.GET();
  if (httpCode == HTTP_CODE_OK) {
    String payload = http.getString();
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload);
    if (!error) {
      if (doc.containsKey("mode")) current_op_mode = doc["mode"].as<int>();
      if (doc.containsKey("target_url")) rtdb_target_url = doc["target_url"].as<String>();
      if (doc.containsKey("target_version")) rtdb_target_version = doc["target_version"].as<String>();
      if (doc.containsKey("target_md5")) rtdb_target_md5 = doc["target_md5"].as<String>();
      
      if (rtdb_target_version != "" && rtdb_target_version != FIRMWARE_VERSION &&
          rtdb_target_version != failed_ota_version &&
          rtdb_target_url != "" && rtdb_target_url != "null") {
        pending_ota_update = true;
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

// ── SD Card Append Logic ──────────────────────────────────────────────────────
void appendToSD(const char* path, const MinuteBlock& b) {
    if (!SD.exists(path)) {
        File fHeader = SD.open(path, FILE_WRITE);
        if (fHeader) {
        fHeader.println("timestamp,temp_avg,hum_avg,rain_sum,batt_v,batt_i,solar_v,solar_i,sample_count");
            fHeader.close();
        }
    }
    File f = SD.open(path, FILE_APPEND);
    if (!f) { g_sd_failures++; return; }
    f.printf("%s,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%d\n",
        b.timestamp, b.temp_avg, b.hum_avg, b.rain_sum, 
        b.batt_v_avg, b.batt_i_avg, b.solar_v_avg, b.solar_i_avg, b.sample_count);
    f.close();
}

// ── Firestore Upload Logic ──────────────────────────────────────────────────────
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

  JsonDocument doc; // Build payload
  JsonObject fields = doc["fields"].to<JsonObject>();
  
  fields["node_id"]["stringValue"] = NODE_ID;
  fields["timestamp"]["stringValue"] = queue[count-1].timestamp;

  JsonArray history = fields["history"]["arrayValue"]["values"].to<JsonArray>();
  for (int i=0; i<count; i++) {
    JsonObject val = history.add<JsonObject>()["mapValue"]["fields"].to<JsonObject>();
    val["ts"]["stringValue"] = queue[i].timestamp;
    val["temp"]["doubleValue"] = queue[i].temp_avg;
    val["hum"]["doubleValue"] = queue[i].hum_avg;
    val["rain"]["doubleValue"] = queue[i].rain_sum;
    val["batt_v"]["doubleValue"] = queue[i].batt_v_avg;
    val["batt_i"]["doubleValue"] = queue[i].batt_i_avg;
    val["solar_v"]["doubleValue"] = queue[i].solar_v_avg;
    val["solar_i"]["doubleValue"] = queue[i].solar_i_avg;
    val["samples"]["integerValue"] = String(queue[i].sample_count);
  }

  // Add Health metrics inside
  JsonObject health = fields["health"]["mapValue"]["fields"].to<JsonObject>();
  health["send_success"]["integerValue"] = String(g_send_success);
  health["send_fail"]["integerValue"] = String(g_send_fail);
  health["sd_fail"]["integerValue"] = String(g_sd_failures);
  health["uptime_h"]["doubleValue"] = millis() / 3600000.0;
  health["wifi_rssi"]["integerValue"] = String(WiFi.RSSI());
  health["firmware"]["stringValue"] = FIRMWARE_VERSION;

  // New prognostics
  health["i2c_errs"]["integerValue"] = String(g_i2c_error_count);
  health["mb_errs"]["integerValue"] = String(g_modbus_crc_error_count);
  health["dongle_cycles"]["integerValue"] = String(g_dongle_power_cycles);
  health["http_2xx"]["integerValue"] = String(g_http_2xx_count);
  health["http_errs"]["integerValue"] = String(g_http_transport_error_count);
  health["upload_lat_ms"]["integerValue"] = String(g_upload_latency_ms);
  health["sd_lat_ms"]["integerValue"] = String(g_sd_max_write_latency_ms);
  health["min_heap"]["integerValue"] = String(esp_get_minimum_free_heap_size());

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
  if (code < 0) {
      g_http_transport_error_count++;
  }
  g_send_fail++; return false;
}

// ── Tasks ──────────────────────────────────────────────────────
void sensorTask(void *pvParams) {
    float sum_temp=0, sum_hum=0, sum_rain=0;
    float sum_batt_v=0, sum_batt_i=0, sum_solar_v=0, sum_solar_i=0;
    int samples = 0;
    
    TickType_t xLastWakeTime = xTaskGetTickCount();

    while(true) {
        // Determine mode parameters
        int mode_sample_rate_ms = (current_op_mode == 3) ? 10000 : 1000;
        int mode_samples_per_block = (current_op_mode == 1) ? 10 : (current_op_mode == 3 ? 6 : 60);

        // Sample I2C Power
        float bv=0, bi=0, sv=0, si=0;
        if (xSemaphoreTake(g_i2c_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
            bv = ina_batt.getBusVoltage_V();
            bi = ina_batt.getCurrent_mA();
            sv = ina_solar.getBusVoltage_V();
            si = ina_solar.getCurrent_mA();
            xSemaphoreGive(g_i2c_mutex);
        }

        // ModBus RS485 Sampling
        float temp=0, hum=0;
        uint8_t res = node.readHoldingRegisters(0x0000, 2);
        if (res == node.ku8MBSuccess) {
            hum = node.getResponseBuffer(0) / 10.0f;
            temp = node.getResponseBuffer(1) / 10.0f;
        } else {
            g_modbus_crc_error_count++;
        }

        // Rain
        float rain = RainSensor.getRainfall();

        sum_temp += temp; sum_hum += hum; sum_rain += rain;
        sum_batt_v += bv; sum_batt_i += bi; sum_solar_v += sv; sum_solar_i += si;
        samples++;

        if (samples >= mode_samples_per_block) {
            MinuteBlock b;
            getTimeStamp(b.timestamp, sizeof(b.timestamp));
            b.temp_avg = sum_temp / samples;
            b.hum_avg = sum_hum / samples;
            b.rain_sum = sum_rain; 
            b.batt_v_avg  = sum_batt_v / samples;
            b.batt_i_avg  = sum_batt_i / samples;
            b.solar_v_avg = sum_solar_v / samples;
            b.solar_i_avg = sum_solar_i / samples;
            b.sample_count = samples;

            // Log securely using SD mutex, skip during OTA
            if (current_ota_state == OTA_IDLE) {
                if (xSemaphoreTake(g_sd_mutex, pdMS_TO_TICKS(500)) == pdTRUE) {
                    uint32_t sd_start = millis();
                    appendToSD("/ota_1min.csv", b);
                    uint32_t sd_lat = millis() - sd_start;
                    if (sd_lat > g_sd_max_write_latency_ms) g_sd_max_write_latency_ms = sd_lat;
                    xSemaphoreGive(g_sd_mutex);
                }
            }

            // Thread-safe enqueue
            if (xSemaphoreTake(g_queue_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
                if (tx_queue_count < 60) {
                    tx_queue[tx_queue_count++] = b;
                }
                xSemaphoreGive(g_queue_mutex);
            }

            sum_temp=0; sum_hum=0; sum_rain=0;
            sum_batt_v=0; sum_batt_i=0; sum_solar_v=0; sum_solar_i=0;
            samples = 0;
        }
        vTaskDelayUntil(&xLastWakeTime, pdMS_TO_TICKS(mode_sample_rate_ms));
    }
}

void uploadTask(void *pvParams) {
    TickType_t xLastWakeTime = xTaskGetTickCount();
    const TickType_t xFrequency = pdMS_TO_TICKS(10 * 1000); // Check every 10 seconds
    int ticksPassedSinceUpload = 0;

    while (true) {
        vTaskDelayUntil(&xLastWakeTime, xFrequency);
        ticksPassedSinceUpload++;

        // Mode 1: 6 blocks (1m), Mode 2: 5 blocks (5m), Mode 3: 30 blocks (30m)
        int mode_blocks_per_upload = (current_op_mode == 1) ? 6 : (current_op_mode == 3 ? 30 : 5);
        int mode_time_limit_ticks = (current_op_mode == 1) ? 6 : (current_op_mode == 3 ? 180 : 30); // 1m, 30m, 5m

        // Modem Power Management (Turn on 3 mins / 18 ticks before upload in Mode 3)
        bool need_modem = (current_op_mode != 3) || 
                          (mode_time_limit_ticks - ticksPassedSinceUpload <= 18) ||
                          (current_ota_state != OTA_IDLE);

        if (need_modem && !is_modem_on) {
            Serial.println("[POWER] Turning LTE Modem ON...");
            digitalWrite(WIFI_POWER_PIN, HIGH);
            is_modem_on = true;
            g_dongle_power_cycles++;
            // Delay a bit locally before forcing reconnect to avoid instant failure spam
            vTaskDelay(pdMS_TO_TICKS(2000));
        } else if (!need_modem && is_modem_on) {
            Serial.println("[POWER] Turning LTE Modem OFF (Power Save)...");
            WiFi.disconnect();
            digitalWrite(WIFI_POWER_PIN, LOW);
            is_modem_on = false;
        }

        bool shouldUpload = false;
        if (current_ota_state == OTA_IDLE && xSemaphoreTake(g_queue_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
             // Upload if queue reached threshold or time limit passed
            if (tx_queue_count >= mode_blocks_per_upload || ticksPassedSinceUpload >= mode_time_limit_ticks) {
                shouldUpload = true;
            }
            xSemaphoreGive(g_queue_mutex);
        }

        // Handle WiFi Reconnection if disconnected (only if modem is actively powered)
        if (is_modem_on && WiFi.status() != WL_CONNECTED) {
            static int wifi_retry_ticks = 0;
            if (wifi_retry_ticks++ % 3 == 0) { // Try every 30s
                Serial.println("[WIFI] Connection lost. Reconnecting...");
                WiFi.disconnect();
                WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
            }
        }

        if (is_modem_on && WiFi.status() == WL_CONNECTED && !shouldUpload && (ticksPassedSinceUpload % 3 == 0)) {
            fetchOTAConfig(); // Fallback polling if idle roughly every 30s
        }

        if (shouldUpload && is_modem_on && WiFi.status() == WL_CONNECTED && current_ota_state == OTA_IDLE) {
            MinuteBlock copy_q[60];
            int c = 0;
            if (xSemaphoreTake(g_queue_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
                c = tx_queue_count;
                for (int i=0; i<c; i++) copy_q[i] = tx_queue[i];
                // Do NOT clear queue yet to preserve data on failure
                xSemaphoreGive(g_queue_mutex);
            }

            bool is_upload_successful = true;
            if (c > 0) {
                bool success = uploadFiveMinPayload(copy_q, c, "ota_initial_data");
                if (success) {
                    if (xSemaphoreTake(g_queue_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
                        // Shift remaining items that were added during upload
                        int new_items = tx_queue_count - c;
                        if (new_items > 0) {
                            for (int i=0; i<new_items; i++) {
                                tx_queue[i] = tx_queue[c + i];
                            }
                        }
                        tx_queue_count = new_items > 0 ? new_items : 0;
                        xSemaphoreGive(g_queue_mutex);
                    }
                    ticksPassedSinceUpload = 0;
                } else {
                    is_upload_successful = false;
                    Serial.println("[UPLOAD] Firestore patch failed. Retaining queue for next tick.");
                    // DO NOT reset ticksPassedSinceUpload. Modem stays ON and retries immediately next tick.
                }
            } else {
                 ticksPassedSinceUpload = 0; // Empty queue, reset timer
            }

            if (is_upload_successful && pending_ota_update && rtdb_target_url != "" && rtdb_target_url != "null") {
                if (current_ota_state == OTA_IDLE) {
                    current_ota_state = OTA_START_DOWNLOAD;
                }
            }

            // Sync NTP every ~6 hours based on roughly calculated modes
            static int ntp_sync_upload_count = 0;
            if (++ntp_sync_upload_count >= 100) {
                setupNTP();
                ntp_sync_upload_count = 0;
            }
        }
    }
}

void setup() {
    Serial.begin(115200);

    // Power on the WiFi Dongle/Modem MOSFET
    pinMode(WIFI_POWER_PIN, OUTPUT);
    digitalWrite(WIFI_POWER_PIN, HIGH);
    delay(2000); // Allow modem to boot before connecting to WiFi

    g_i2c_mutex = xSemaphoreCreateMutex();
    g_queue_mutex = xSemaphoreCreateMutex();
    g_sd_mutex = xSemaphoreCreateMutex();

    // I2C devices
    Wire.begin(21, 22);
    if (!ina_batt.init()) Serial.println("[INA226] Batt Fail");
    else ina_batt.setResistorRange(0.1, 2.0);
    
    if (!ina_solar.init()) Serial.println("[INA226] Solar Fail");
    else ina_solar.setResistorRange(0.1, 2.0);
    
    Serial1.begin(9600, SERIAL_8N1, RS485_RX, RS485_TX);
    node.begin(1, Serial1);
    
    RainSerial.begin(9600, SERIAL_8N1, RAIN_RX, RAIN_TX);
    RainSensor.begin();

    SPI.begin(18, 19, 23, SD_CS);
    SD.begin(SD_CS);

    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    while(WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
    Serial.println("\n[WIFI] Connected");

    setupNTP();
    setupOTA();

    // --- Initial Startup Data Upload ---
    Serial.println("[Startup] Sending initial data packet...");
    MinuteBlock initial_b;
    getTimeStamp(initial_b.timestamp, sizeof(initial_b.timestamp));
    
    // Sample sensors once
    float t=0, h=0, r=0, bv=0, bi=0, sv=0, si=0;
    if (node.readHoldingRegisters(0x0000, 2) == node.ku8MBSuccess) {
        h = node.getResponseBuffer(0) / 10.0f;
        t = node.getResponseBuffer(1) / 10.0f;
    }
    r = RainSensor.getRainfall();
    bv = ina_batt.getBusVoltage_V();
    bi = ina_batt.getCurrent_mA();
    sv = ina_solar.getBusVoltage_V();
    si = ina_solar.getCurrent_mA();

    initial_b.temp_avg = t; 
    initial_b.hum_avg = h; 
    initial_b.rain_sum = r;
    initial_b.batt_v_avg = bv; 
    initial_b.batt_i_avg = bi;
    initial_b.solar_v_avg = sv; 
    initial_b.solar_i_avg = si;
    initial_b.sample_count = 1;

    MinuteBlock initial_q[1]; 
    initial_q[0] = initial_b;
    uploadFiveMinPayload(initial_q, 1, "startup");

    xTaskCreatePinnedToCore(sensorTask, "SensorTsk", 8192, NULL, 3, NULL, 1);
    xTaskCreatePinnedToCore(uploadTask, "UploadTsk", 16384, NULL, 2, NULL, 0);
    xTaskCreatePinnedToCore(otaTask, "OtaTsk", 8192, NULL, 1, NULL, 0);
}

void loop() {
    vTaskDelay(pdMS_TO_TICKS(3000));
}
