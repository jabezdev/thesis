// ── Project Sipat Banwa — Reliability Testing Firmware ─────────────────────────
// ESP32 soaking firmware for stability and power telemetry.
// Dual-core FreeRTOS: Core 1 (sensors), Core 0 (upload + heartbeat).

// ── Includes ──────────────────────────────────────────────────────────────────
#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ModbusMaster.h>
#include "RTClib.h"
#include <time.h>             // NTP time support
#include "DFRobot_RainfallSensor.h"
#include <Adafruit_INA219.h>
#include <esp_task_wdt.h>
#include <esp_system.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/semphr.h>
#include <Preferences.h>      // NVS — persistent boot_count across reboots
#include <ArduinoJson.h>      // For robust JSON serialization
#include <esp_exception.h>    // For backtrace handling
#include <rom/rtc.h>          // For rtc_get_reset_reason


// ── Configuration ─────────────────────────────────────────────────────────────

// Wi-Fi
const char* WIFI_SSID     = "SIPAT-BANWA";
const char* WIFI_PASSWORD = "BSECE4B1";

// Firebase Firestore (REST API)
const char* FIREBASE_PROJECT_ID = "panahon-live";
const char* FIREBASE_API_KEY    = "AIzaSyCDsUNnLZuK8EyBa1XRfKrgxVkykFK-WVg";
const char* FIRESTORE_BASE      = "https://firestore.googleapis.com/v1/projects/panahon-live/databases/(default)/documents";

// Station identity
const char* STATION_ID = "reliability_station_1";

// Battery
const float CAPACITY_AH    = 30.0;   // Ah — adjust to your actual battery
const float CUTOFF_VOLTAGE = 11.0;   // V  — halt below this threshold

// Timing
const int   SENSOR_INTERVAL_MS   = 1000;  // 1s sampling (for energy integration)
const int   LOG_INTERVAL_S       = 30;    // Log to SD every 30s
const int   UPLOAD_INTERVAL_S    = 60;
const int   HEARTBEAT_INTERVAL_S = 60;
const char* NTP_SERVER           = "pool.ntp.org";
const long  GMT_OFFSET_SEC       = 28800; // UTC+8 (Manila)
const int   DAYLIGHT_OFFSET_SEC  = 0;
const int   WIFI_TIMEOUT_MS     = 20000;
const int   WATCHDOG_TIMEOUT_S  = 30;


// SD & Serial pins
#define SD_CS          5
#define LOG_FILE       "/datalog.csv"
#define PENDING_FILE   "/pending.csv"

#define RS485_RX       16
#define RS485_TX       17

#define RAIN_RX        25
#define RAIN_TX        26

// WiFi MOSFET power control (IRFz44n)
// Gate driven HIGH = dongle powered ON, LOW = dongle powered OFF
#define WIFI_POWER_PIN       13
#define WIFI_DONGLE_BOOT_MS  6000   // ms to wait after power-on for dongle to connect

// Sensor validation thresholds
#define TEMP_MIN       -40.0
#define TEMP_MAX        85.0
#define HUM_MIN          0.0
#define HUM_MAX        100.0


// ── Hardware Objects ───────────────────────────────────────────────────────────
RTC_DS3231       rtc;
ModbusMaster     node;
Adafruit_INA219  ina219_batt(0x40);
Adafruit_INA219  ina219_solar(0x41);
Preferences      prefs;
HardwareSerial   RainSerial(2);
DFRobot_RainfallSensor_UART RainSensor(&RainSerial);


// ── Shared Sensor Data (protected by mutex) ────────────────────────────────────
struct SensorReading {
  // RTC timestamp
  char      timestamp[20];      // "YYYY-MM-DD HH:MM:SS"

  // Atmospheric sensors
  // Atmospheric & Rain
  float     temperature;
  float     humidity;
  float     rainfall_mm;
  float     rainfall_1h_mm;
  uint32_t  rain_raw;

  // Power (INA219)
  float     batt_voltage;       // V
  float     batt_current_A;     // A
  float     batt_power_W;       // W
  float     batt_soc_pct;       // %
  float     batt_remaining_Ah;  // Ah
  float     batt_total_energy_Wh; // Wh — cumulative consumed
  float     batt_peak_current_A;  // A  — session maximum
  float     batt_min_voltage;   // V  — session minimum

  // Solar Power (INA219 #2)
  float     solar_voltage;      // V
  float     solar_current_A;    // A
  float     solar_power_W;      // W
  float     solar_energy_Wh;    // Wh — cumulative generated
  float     solar_peak_current_A; // A — session maximum

  // System health
  uint32_t  internal_temp_c;    // °C — ESP32 die temperature
  uint32_t  min_heap;           // bytes — heap low-water mark
  uint32_t  log_count;          // total SD rows written
  uint32_t  sd_free_mb;         // MB remaining on SD card
  uint32_t  upload_latency_ms;  // last PATCH round-trip ms

  // Connectivity
  int       wifi_rssi;          // dBm
  bool      wifi_connected;
  uint32_t  wifi_reconnect_count;     // link-drop + reconnect events
  uint32_t  consecutive_fail_streak;  // current upload fail run
  uint32_t  max_fail_streak;          // worst fail run this session

  // System diagnostics
  uint32_t  uptime_s;
  float     uptime_h;                  // hours (convenient for long soaks)
  uint32_t  free_heap;
  float     heap_frag_pct;             // (1 - maxAlloc/freeHeap) × 100
  String    sensor_status;
  String    reset_reason;
  uint32_t  boot_count;
  uint32_t  send_success;
  uint32_t  send_fail;
  uint32_t  sd_fail;

  // Extended software reliability metrics
  uint32_t  total_read_count;           // total Modbus read attempts
  float     modbus_error_rate_pct;      // sensor_fail / total_reads × 100
  uint32_t  consec_modbus_fail;         // current consecutive Modbus fails
  uint32_t  max_modbus_fail_streak;     // worst Modbus fail run
  uint32_t  sensor_read_latency_ms;     // last readHoldingRegisters() ms
  uint32_t  wifi_offline_total_s;       // cumulative WiFi-down seconds
  uint32_t  longest_offline_streak_s;   // worst continuous offline span
  uint32_t  dongle_power_cycles;        // MOSFET ON/OFF toggle count
  uint32_t  pending_row_count;          // rows buffered in pending.csv
  uint32_t  avg_upload_latency_ms;      // running mean of PATCH latency
  uint32_t  sd_write_latency_ms;        // last SD row-write duration ms
  uint32_t  sensor_stack_hwm;           // sensorTask stack words remaining
  uint32_t  upload_stack_hwm;           // uploadTask stack words remaining
  uint32_t  sd_used_mb;                 // SD card used space MB

  // ── NEW PROGNOSTICS ─────────────────────────────────────────
  uint32_t loop_jitter_max_ms;         // worst sensorTask delay
  uint32_t brownout_count;             // total brownout resets in life
  bool     has_crash_log;              // true if /crashlog.txt exists
  uint32_t i2c_error_count;            // total I2C NACKs/timeouts
  uint32_t sd_max_write_latency_ms;    // session peak SD latency
  float    batt_internal_resistance;   // calculated mΩ
  uint32_t modbus_timeout_count;       // specific modbus error category
  uint32_t modbus_crc_error_count;     // specific modbus error category
  uint32_t http_2xx_count;
  uint32_t http_4xx_count;
  uint32_t http_5xx_count;
  float    net_throughput_kbps;        // kbps during active windows
  int32_t  ntp_drift_s;                // last RTC vs NTP delta
  uint32_t current_upload_interval_s;  // active UPLOAD_INTERVAL_S
};

SensorReading     g_reading;
SemaphoreHandle_t g_mutex;


// ── Coulomb Counting & Energy State ───────────────────────────────────────────
float    g_batt_used_Ah         = 0.0;
float    g_batt_total_energy_Wh = 0.0;
float    g_batt_peak_current_A  = 0.0;
float    g_batt_min_voltage     = 99.0;   // sentinel; set to first real reading

float    g_solar_total_energy_Wh = 0.0;
float    g_solar_peak_current_A  = 0.0;


// ── System Health State ────────────────────────────────────────────────────────
uint32_t g_min_heap   = UINT32_MAX;
uint32_t g_log_count  = 0;


// ── Diagnostic Counters ────────────────────────────────────────────────────────
volatile uint32_t g_send_success            = 0;
volatile uint32_t g_send_fail               = 0;
volatile uint32_t g_sd_fail                 = 0;
volatile uint32_t g_sensor_fail             = 0;
volatile uint32_t g_wifi_reconnect_count    = 0;
volatile uint32_t g_consecutive_fail_streak = 0;
volatile uint32_t g_max_fail_streak         = 0;

// Reset reason + boot count (populated once at boot)
String   g_reset_reason = "UNKNOWN";
uint32_t g_boot_count   = 0;

// Extended counters
volatile uint32_t g_total_read_count          = 0;
volatile uint32_t g_consec_modbus_fail        = 0;
volatile uint32_t g_max_modbus_fail_streak    = 0;
volatile uint32_t g_wifi_offline_total_s      = 0;
volatile uint32_t g_longest_offline_streak_s  = 0;
volatile uint32_t g_current_offline_s         = 0;  // live streak acc.
volatile uint32_t g_dongle_power_cycles       = 0;

// New Prognostic Globals
volatile uint32_t g_loop_jitter_max_ms       = 0;
uint32_t g_brownout_count                    = 0;
volatile uint32_t g_i2c_error_count          = 0;
volatile uint32_t g_sd_max_write_latency_ms  = 0;
float    g_batt_internal_resistance          = 0;
volatile uint32_t g_modbus_timeout_count     = 0;
volatile uint32_t g_modbus_crc_error_count   = 0;
volatile uint32_t g_http_2xx_count           = 0;
volatile uint32_t g_http_4xx_count           = 0;
volatile uint32_t g_http_5xx_count           = 0;
uint32_t g_total_bytes_sent                  = 0;
uint32_t g_radio_on_duration_ms              = 0;
int32_t  g_ntp_drift_s                       = 0;
uint32_t g_current_upload_interval_s         = UPLOAD_INTERVAL_S;

uint32_t g_avg_upload_latency_ms  = 0;
uint32_t g_upload_latency_count   = 0;
uint32_t g_sd_write_latency_ms    = 0;
uint32_t g_pending_row_count      = 0;
uint32_t g_radio_start_ms         = 0; // Fixed: missing variable

// Task handles (for cross-task stack HWM queries)
TaskHandle_t g_sensorTaskHandle  = NULL;
TaskHandle_t g_uploadTaskHandle  = NULL;

// MOSFET dongle power state — shared between uploadTask and heartbeatTask
// uploadTask sets true before powering on and false after powering off;
// heartbeatTask gates on this so it only fires inside the active window.
volatile bool g_dongle_on = false;
SemaphoreHandle_t g_i2c_mutex;
volatile float g_v_pre_load = 0;
volatile bool  g_capture_ir = false;




// =============================================================================
//  UTILITY FUNCTIONS
// =============================================================================

// ── Reset Reason String ───────────────────────────────────────────────────────
String resetReasonString() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:  return "POWERON_RESET";
    case ESP_RST_EXT:      return "EXT_RESET";
    case ESP_RST_SW:       return "SW_RESET";
    case ESP_RST_PANIC:    return "PANIC_RESET";
    case ESP_RST_INT_WDT:  return "INT_WDT_RESET";
    case ESP_RST_TASK_WDT: return "TASK_WDT_RESET";
    case ESP_RST_WDT:      return "WDT_RESET";
    case ESP_RST_DEEPSLEEP:return "DEEPSLEEP_RESET";
    case ESP_RST_BROWNOUT: return "BROWNOUT_RESET";
    case ESP_RST_SDIO:     return "SDIO_RESET";
    default:               return "UNKNOWN_RESET";
  }
}

// ── RTC Sync with NTP ─────────────────────────────────────────────────────────
void syncRTCWithNTP() {
  if (WiFi.status() != WL_CONNECTED) return;
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
  struct tm timeinfo;
  if (getLocalTime(&timeinfo)) {
    uint32_t rtc_before = rtc.now().unixtime();
    
    rtc.adjust(DateTime(timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
                        timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec));
    
    uint32_t ntp_now = rtc.now().unixtime(); // After adjustment, RTC matches NTP
    g_ntp_drift_s = (int32_t)ntp_now - (int32_t)rtc_before;
    
    if (abs(g_ntp_drift_s) > 3600) g_ntp_drift_s = 0; // Ignore large jumps
    Serial.printf("[RTC] Synced. Drift: %ld s\n", (long)g_ntp_drift_s);
  }
}

// ── RTC Timestamp ─────────────────────────────────────────────────────────────
void rtcNow(char* buf, size_t len) {
  if (!rtc.begin()) {
    snprintf(buf, len, "0000-00-00 00:00:00");
    return;
  }
  DateTime n = rtc.now();
  snprintf(buf, len, "%04d-%02d-%02d %02d:%02d:%02d",
           n.year(), n.month(), n.day(),
           n.hour(), n.minute(), n.second());
}

// ── Manual RTC Update ─────────────────────────────────────────────────────────
void checkSerialRTCUpdate() {
  if (!Serial.available()) return;
  String s = Serial.readStringUntil('\n'); s.trim();
  if (s.length() != 19) return;
  rtc.adjust(DateTime(
    s.substring(0, 4).toInt(), s.substring(5, 7).toInt(), s.substring(8, 10).toInt(),
    s.substring(11, 13).toInt(), s.substring(14, 16).toInt(), s.substring(17, 19).toInt()
  ));
  Serial.println("[RTC] Manual update OK.");
}


// =============================================================================
//  WIFI MOSFET HELPERS
// =============================================================================

// Drive the IRFz44n gate HIGH/LOW to physically power the LTE dongle on or off.
// Always pair wifiDongleOn() with a later wifiDongleOff() to avoid leaving the
// dongle unpowered unintentionally (e.g. across unexpected reboots).
inline void wifiDongleOn() {
  if (g_i2c_mutex != NULL && xSemaphoreTake(g_i2c_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
    g_v_pre_load = ina219_batt.getBusVoltage_V();
    xSemaphoreGive(g_i2c_mutex);
  }
  digitalWrite(WIFI_POWER_PIN, HIGH);
  g_dongle_on = true;
  g_radio_start_ms = millis(); // Track start time
  g_capture_ir = true; // Trigger sensorTask to calc IR next second
  g_dongle_power_cycles++;
  Serial.printf("[WiFi] Dongle ON (cycle #%lu, V_pre: %.2fV).\n", 
                (unsigned long)g_dongle_power_cycles, g_v_pre_load);
}

inline void wifiDongleOff() {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  delay(100);
  digitalWrite(WIFI_POWER_PIN, LOW);
  g_dongle_on = false;
  Serial.println("[WiFi] Dongle powered OFF (power save).");
}


// =============================================================================
//  WIFI
// =============================================================================

bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  Serial.printf("\n[WiFi] Connecting to SSID: \"%s\"\n", WIFI_SSID);

  // Full radio reset — helps with phone hotspots and stale connections
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  delay(300);
  WiFi.mode(WIFI_STA);
  delay(100);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > WIFI_TIMEOUT_MS) {
      Serial.println("\n[WiFi] Timeout — will retry next cycle.");
      return false;
    }
    delay(500);
    Serial.print(".");
  }

  g_wifi_reconnect_count++;   // count every successful (re)connect
  Serial.printf("\n[WiFi] Connected! IP: %s  RSSI: %d dBm  (reconnects: %lu)\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI(),
                (unsigned long)g_wifi_reconnect_count);
  return true;
}


// =============================================================================
//  FIREBASE (Firestore REST API — HTTPS)
// =============================================================================

// Build Firestore document URL
String firestoreUrl(const char* collection, const char* docId) {
  return String(FIRESTORE_BASE) + "/" + collection + "/" + docId
         + "?key=" + FIREBASE_API_KEY;
}

// Helpers: append Firestore typed fields
// Firestore helper removed — using ArduinoJson lambda instead

// ── Upload full reading → Firestore: readings/{STATION_ID} ───────────────────
bool uploadReading(const SensorReading& r) {
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  http.begin(client, firestoreUrl("readings", STATION_ID));
  http.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  JsonObject fields = doc["fields"].to<JsonObject>();

  auto fsVal = [&](const char* k, auto v, const char* type) {
    if (strcmp(type, "double") == 0) fields[k]["doubleValue"] = v;
    else if (strcmp(type, "int") == 0) fields[k]["integerValue"] = String(v);
    else if (strcmp(type, "str") == 0) fields[k]["stringValue"] = String(v);
    else if (strcmp(type, "bool") == 0) fields[k]["booleanValue"] = v;
  };

  fsVal("timestamp", r.timestamp, "str");
  fsVal("temperature", r.temperature, "double");
  fsVal("humidity", r.humidity, "double");
  fsVal("rainfall_mm", r.rainfall_mm, "double");      // Added
  fsVal("rainfall_1h_mm", r.rainfall_1h_mm, "double"); // Added
  fsVal("rain_raw", (long)r.rain_raw, "int");         // Added
  fsVal("batt_voltage", r.batt_voltage, "double");
  fsVal("batt_current_A", r.batt_current_A, "double");
  fsVal("batt_soc_pct", r.batt_soc_pct, "double");
  fsVal("batt_internal_resistance", r.batt_internal_resistance, "double");
  fsVal("loop_jitter_max_ms", r.loop_jitter_max_ms, "int");
  fsVal("brownout_count", r.brownout_count, "int");
  fsVal("i2c_error_count", r.i2c_error_count, "int");
  fsVal("modbus_timeout_count", r.modbus_timeout_count, "int");
  fsVal("modbus_crc_error_count", r.modbus_crc_error_count, "int");
  fsVal("http_2xx", g_http_2xx_count, "int");
  fsVal("http_4xx", g_http_4xx_count, "int");
  fsVal("http_5xx", g_http_5xx_count, "int");
  fsVal("ntp_drift_s", g_ntp_drift_s, "int");
  fsVal("uptime_h", r.uptime_h, "double");
  fsVal("reset_reason", r.reset_reason.c_str(), "str");
  fsVal("boot_count", r.boot_count, "int");

  String payload;
  serializeJson(doc, payload);
  
  unsigned long t0 = millis();
  int code = http.PATCH(payload);
  uint32_t latency = (uint32_t)(millis() - t0);
  http.end();

  if (code >= 200 && code < 300) {
    g_http_2xx_count++; g_send_success++; g_consecutive_fail_streak = 0;
    g_upload_latency_count++;
    g_avg_upload_latency_ms += (latency - g_avg_upload_latency_ms) / g_upload_latency_count;
    g_total_bytes_sent += payload.length();
    return true;
  } else {
    if (code >= 400 && code < 500) g_http_4xx_count++;
    else if (code >= 500) g_http_5xx_count++;
    g_send_fail++; g_consecutive_fail_streak++;
    if (g_consecutive_fail_streak > g_max_fail_streak) g_max_fail_streak = g_consecutive_fail_streak;
    return false;
  }
}

// ── Heartbeat → Firestore: heartbeats/{STATION_ID} ───────────────────────────
void uploadHeartbeat(const SensorReading& r) {
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  http.begin(client, firestoreUrl("heartbeats", STATION_ID));
  http.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  JsonObject fields = doc["fields"].to<JsonObject>();

  auto fsVal = [&](const char* k, auto v, const char* type) {
    if (strcmp(type, "double") == 0) fields[k]["doubleValue"] = v;
    else if (strcmp(type, "int") == 0) fields[k]["integerValue"] = String(v);
    else if (strcmp(type, "str") == 0) fields[k]["stringValue"] = String(v);
    else if (strcmp(type, "bool") == 0) fields[k]["booleanValue"] = v;
  };

  fsVal("station_id", STATION_ID, "str");
  fsVal("timestamp", r.timestamp, "str");
  fsVal("uptime_h", r.uptime_h, "double");
  fsVal("batt_voltage", r.batt_voltage, "double");
  fsVal("free_heap", r.free_heap, "int");
  fsVal("wifi_rssi", r.wifi_rssi, "int");
  fsVal("http_2xx", g_http_2xx_count, "int");
  fsVal("net_kbps", r.net_throughput_kbps, "double");

  String payload;
  serializeJson(doc, payload);
  int code = http.PATCH(payload);
  http.end();

  if (code >= 200 && code < 300) {
    g_total_bytes_sent += payload.length();
    Serial.printf("[Heartbeat] OK (%d)\n", code);
  } else Serial.printf("[Heartbeat] FAIL (%d)\n", code);
}


// =============================================================================
//  SD CARD LOGGING
// =============================================================================

void sdWriteHeader(const char* path) {
  if (SD.exists(path)) return;
  File f = SD.open(path, FILE_WRITE);
  if (!f) return;
  f.println("timestamp,temperature,humidity,"
            "rainfall_mm,rainfall_1h_mm,rain_raw,"
            "batt_voltage,batt_current_A,batt_power_W,batt_soc_pct,batt_remaining_Ah,"
            "batt_total_energy_Wh,batt_peak_current_A,batt_min_voltage,"
            "solar_voltage,solar_current_A,solar_power_W,solar_energy_Wh,solar_peak_current_A,"
            "internal_temp_c,min_heap,heap_frag_pct,log_count,sd_free_mb,sd_used_mb,upload_latency_ms,avg_upload_latency_ms,sd_write_latency_ms,"
            "wifi_rssi,wifi_connected,wifi_reconnect_count,wifi_offline_total_s,longest_offline_streak_s,dongle_power_cycles,consec_fail_streak,max_fail_streak,pending_row_count,"
            "total_read_count,modbus_error_rate_pct,consec_modbus_fail,max_modbus_fail_streak,sensor_read_latency_ms,"
            "uptime_s,uptime_h,free_heap,sensor_stack_hwm,upload_stack_hwm,"
            "sensor_status,reset_reason,boot_count,send_success,send_fail,sd_fail,"
            "loop_jitter_max_ms,brownout_count,has_crash_log,i2c_error_count,sd_max_write_latency_ms,"
            "batt_internal_resistance,modbus_timeout_count,modbus_crc_error_count,ntp_drift_s,upload_interval_s");
  f.close();
}

bool sdAppendRow(const char* path, const SensorReading& r) {
  unsigned long t0 = millis();
  File f = SD.open(path, FILE_APPEND);
  if (!f) {
    g_sd_fail++; Serial.printf("[SD] Write error: %s\n", path);
    return false;
  }
  char row[1024]; // Increased buffer for new metrics
  snprintf(row, sizeof(row),
    "%s,%.2f,%.2f,"
    "%.2f,%.2f,%lu,"
    "%.3f,%.4f,%.3f,%.1f,%.3f,"
    "%.4f,%.4f,%.3f,"
    "%.3f,%.4f,%.3f,%.4f,%.4f,"
    "%.1f,%lu,%.1f,%lu,%lu,%lu,%lu,%lu,%lu," 
    "%d,%d,%lu,%lu,%lu,%lu,%lu,%lu,"
    "%lu,%.2f,%lu,%lu,%lu,"
    "%lu,%.3f,%lu,%lu,%lu,"
    "%s,%s,%lu,%lu,%lu,%lu,"
    "%lu,%lu,%d,%lu,%lu,%.2f,%lu,%lu,%ld,%lu", // New Prognostics
    r.timestamp, r.temperature, r.humidity,
    r.rainfall_mm, r.rainfall_1h_mm, (unsigned long)r.rain_raw,
    r.batt_voltage, r.batt_current_A, r.batt_power_W, r.batt_soc_pct, r.batt_remaining_Ah,
    r.batt_total_energy_Wh, r.batt_peak_current_A, r.batt_min_voltage,
    r.solar_voltage, r.solar_current_A, r.solar_power_W, r.solar_energy_Wh, r.solar_peak_current_A,
    r.internal_temp_c, (unsigned long)r.min_heap, r.heap_frag_pct, (unsigned long)r.log_count,
    (unsigned long)r.sd_free_mb, (unsigned long)r.sd_used_mb, (unsigned long)r.upload_latency_ms, (unsigned long)r.avg_upload_latency_ms, (unsigned long)r.sd_write_latency_ms,
    r.wifi_rssi, (int)r.wifi_connected, (unsigned long)r.wifi_reconnect_count, (unsigned long)r.wifi_offline_total_s, (unsigned long)r.longest_offline_streak_s, (unsigned long)r.dongle_power_cycles, (unsigned long)r.consecutive_fail_streak, (unsigned long)r.max_fail_streak, (unsigned long)r.pending_row_count,
    (unsigned long)r.total_read_count, r.modbus_error_rate_pct, (unsigned long)r.consec_modbus_fail, (unsigned long)r.max_modbus_fail_streak, (unsigned long)r.sensor_read_latency_ms,
    (unsigned long)r.uptime_s, r.uptime_h, (unsigned long)r.free_heap, (unsigned long)r.sensor_stack_hwm, (unsigned long)r.upload_stack_hwm,
    r.sensor_status.c_str(), r.reset_reason.c_str(), (unsigned long)r.boot_count, (unsigned long)r.send_success, (unsigned long)r.send_fail, (unsigned long)r.sd_fail,
    (unsigned long)r.loop_jitter_max_ms, (unsigned long)r.brownout_count, (int)r.has_crash_log, (unsigned long)r.i2c_error_count, (unsigned long)r.sd_max_write_latency_ms,
    r.batt_internal_resistance, (unsigned long)r.modbus_timeout_count, (unsigned long)r.modbus_crc_error_count, (long)r.ntp_drift_s, (unsigned long)r.current_upload_interval_s
  );
  f.println(row);
  f.close();
  uint32_t lat = millis() - t0;
  if (lat > g_sd_max_write_latency_ms) g_sd_max_write_latency_ms = lat;
  g_sd_write_latency_ms = lat;
  return true;
}

// ── Helper: Count rows in a CSV (excluding header) ────────────────────────────
uint32_t countFileRows(const char* path) {
  if (!SD.exists(path)) return 0;
  File f = SD.open(path, FILE_READ);
  if (!f) return 0;
  uint32_t count = 0;
  bool firstLine = true;
  while (f.available()) {
    if (f.read() == '\n') {
      if (firstLine) firstLine = false;
      else count++;
    }
  }
  f.close();
  return count;
}

// Upload pending CSV rows to Firestore, then clear the file
void flushPending() {
  if (!SD.exists(PENDING_FILE)) return;

  File f = SD.open(PENDING_FILE, FILE_READ);
  if (!f) return;

  Serial.printf("[Pending] Flushing %s to Firestore...\n", PENDING_FILE);

  if (f.available()) f.readStringUntil('\n');  // skip header

  int uploaded = 0;
  int failed   = 0;

  while (f.available()) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (line.length() < 10) continue;

    int    comma = line.indexOf(',');
    String ts    = (comma > 0) ? line.substring(0, comma) : "unknown";
    ts.replace(' ', 'T');  // URL-safe

    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    // Each pending row gets its own backlog document keyed by station+timestamp
    String url = firestoreUrl("readings_backlog",
                              (String(STATION_ID) + "_" + ts).c_str());
    http.begin(client, url);
    http.addHeader("Content-Type", "application/json");
    String payload = "{\"fields\":{\"csv_row\":{\"stringValue\":\"" + line + "\"}}}";
    int code = http.PATCH(payload);
    http.end();

    if (code > 0 && code < 300) uploaded++;
    else failed++;

    vTaskDelay(pdMS_TO_TICKS(200));  // gentle on the network
  }
  f.close();

  Serial.printf("[Pending] Done: %d uploaded, %d failed\n", uploaded, failed);

  if (failed == 0) {
    SD.remove(PENDING_FILE);
    sdWriteHeader(PENDING_FILE);
    Serial.println("[Pending] Cleared.");
  }
}


// =============================================================================
//  FREERTOS TASKS
// =============================================================================

// ── TASK 1: Sensor Task (Core 1, every 1 second) ──────────────────────────────
void sensorTask(void* pvParams) {
  esp_task_wdt_add(NULL);
  uint32_t lastRun = millis();

  while (true) {
    esp_task_wdt_reset();
    uint32_t nowMs = millis();
    uint32_t jitter = (nowMs - lastRun > 1000) ? (nowMs - lastRun - 1000) : 0;
    if (jitter > g_loop_jitter_max_ms) g_loop_jitter_max_ms = jitter;
    lastRun = nowMs;

    checkSerialRTCUpdate();

    // ── Safe Sensor Reading (I2C Mutex) ─────────────────────────
    if (xSemaphoreTake(g_i2c_mutex, pdMS_TO_TICKS(800)) == pdTRUE) {
      // ── Modbus (temp/humidity) ─────────────────────────────
      float  temperature  = 0.0f;
      float  humidity     = 0.0f;
      String sensorStatus = "ERROR";

      g_total_read_count++;
      unsigned long mb_t0  = millis();
      uint8_t result = node.readHoldingRegisters(0x0000, 2);
      uint32_t readLatency = (uint32_t)(millis() - mb_t0);

      if (result == node.ku8MBSuccess) {
        humidity    = node.getResponseBuffer(0) / 10.0f;
        temperature = node.getResponseBuffer(1) / 10.0f;
        // Validation...
        bool tempOK = (!isnan(temperature) && temperature >= TEMP_MIN && temperature <= TEMP_MAX);
        bool humOK  = (!isnan(humidity)    && humidity    >= HUM_MIN  && humidity    <= HUM_MAX);
        sensorStatus = (tempOK && humOK) ? "OK" : "ERROR";
        if (tempOK && humOK) g_consec_modbus_fail = 0;
        else {
          g_consec_modbus_fail++;
          if (g_consec_modbus_fail > g_max_modbus_fail_streak) g_max_modbus_fail_streak = g_consec_modbus_fail;
        }
      } else {
        g_sensor_fail++;
        g_consec_modbus_fail++;
        if (result == node.ku8MBResponseTimedOut) g_modbus_timeout_count++;
        else if (result == node.ku8MBInvalidCRC) g_modbus_crc_error_count++;
        if (g_consec_modbus_fail > g_max_modbus_fail_streak) g_max_modbus_fail_streak = g_consec_modbus_fail;
      }

      // ── Rain Sensor ──────────────────────────────────────────
      float rainfall_mm    = RainSensor.getRainfall();
      float rainfall_1h_mm = RainSensor.getRainfall(1);
      uint32_t rain_raw    = RainSensor.getRawData();

      // ── Battery & Solar (INA219) ─────────────────────────────
      float voltage    = ina219_batt.getBusVoltage_V();
      float current_A  = ina219_batt.getCurrent_mA() / 1000.0f;
      float power_W    = ina219_batt.getPower_mW() / 1000.0f;

      float sol_voltage    = ina219_solar.getBusVoltage_V();
      float sol_current_A  = ina219_solar.getCurrent_mA() / 1000.0f;
      float sol_power_W    = ina219_solar.getPower_mW() / 1000.0f;

      // ── Battery IR Calculation ──────────────────────────────
      if (g_capture_ir && current_A > 0.1f) { 
        // IR = (V_pre - V_loaded) / I_load
        float dv = g_v_pre_load - voltage;
        if (dv > 0) g_batt_internal_resistance = (dv / current_A) * 1000.0f; // mΩ
        g_capture_ir = false;
      }

      xSemaphoreGive(g_i2c_mutex);

      g_batt_used_Ah         += current_A * (SENSOR_INTERVAL_MS / 3600000.0f);
      g_batt_total_energy_Wh += power_W   * (SENSOR_INTERVAL_MS / 3600000.0f);
      float remaining_Ah = CAPACITY_AH - g_batt_used_Ah;
      float soc          = constrain((remaining_Ah / CAPACITY_AH) * 100.0f, 0.0f, 100.0f);
      if (current_A > g_batt_peak_current_A) g_batt_peak_current_A = current_A;
      if (voltage   < g_batt_min_voltage)    g_batt_min_voltage    = voltage;

      g_solar_total_energy_Wh += sol_power_W * (SENSOR_INTERVAL_MS / 3600000.0f);
      if (sol_current_A > g_solar_peak_current_A) g_solar_peak_current_A = sol_current_A;

      // Heap & Temp
      uint32_t heap     = ESP.getFreeHeap();
      float    heapFrag = (heap > 0) ? (1.0f - (float)ESP.getMaxAllocHeap() / (float)heap) * 100.0f : 0.0f;
      if (heap < g_min_heap) g_min_heap = heap;
      float int_temp = temperatureRead();

      // WiFi tracking...
      if (WiFi.status() != WL_CONNECTED) {
        g_current_offline_s++; g_wifi_offline_total_s++;
        if (g_current_offline_s > g_longest_offline_streak_s) g_longest_offline_streak_s = g_current_offline_s;
      } else g_current_offline_s = 0;

      // Low-voltage cutoff
      if (voltage <= CUTOFF_VOLTAGE) {
        Serial.printf("[Power] CUTOFF @ %.2fV\n", voltage);
        esp_restart();
      }

      // ── Build timestamp & Update Shared Reading ────────────────
      char ts[20]; rtcNow(ts, sizeof(ts));
      if (xSemaphoreTake(g_mutex, pdMS_TO_TICKS(500)) == pdTRUE) {
        strncpy(g_reading.timestamp, ts, sizeof(g_reading.timestamp));
        g_reading.temperature = temperature; g_reading.humidity = humidity;
        g_reading.rainfall_mm = rainfall_mm; g_reading.rainfall_1h_mm = rainfall_1h_mm;
        g_reading.rain_raw = rain_raw; // Fixed: was missing
        g_reading.batt_voltage = voltage; g_reading.batt_current_A = current_A;
        g_reading.batt_soc_pct = soc; g_reading.batt_total_energy_Wh = g_batt_total_energy_Wh;
        g_reading.solar_voltage = sol_voltage; g_reading.solar_current_A = sol_current_A;
        g_reading.internal_temp_c = int_temp; g_reading.min_heap = g_min_heap;
        g_reading.loop_jitter_max_ms = g_loop_jitter_max_ms;
        g_reading.brownout_count = g_brownout_count;
        g_reading.i2c_error_count = g_i2c_error_count;
        g_reading.batt_internal_resistance = g_batt_internal_resistance;
        g_reading.modbus_timeout_count = g_modbus_timeout_count;
        g_reading.modbus_crc_error_count = g_modbus_crc_error_count;
        g_reading.current_upload_interval_s = g_current_upload_interval_s;
        xSemaphoreGive(g_mutex);
      }
    } else {
      g_i2c_error_count++;
    }

    // ── Log to SD (conditional frequency) ──────────────────────
    static uint32_t lastLogMs = 0;
    if (millis() - lastLogMs >= (LOG_INTERVAL_S * 1000) || sensorStatus == "ERROR") {
      SensorReading snap;
      if (xSemaphoreTake(g_mutex, pdMS_TO_TICKS(300)) == pdTRUE) {
        snap = g_reading;
        xSemaphoreGive(g_mutex);
      }
      unsigned long sd_t0 = millis();
      bool sdOK = sdAppendRow(LOG_FILE, snap);
      g_sd_write_latency_ms = (uint32_t)(millis() - sd_t0);
      if (sdOK) {
        g_log_count++;
        lastLogMs = millis();
        if (xSemaphoreTake(g_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
          g_reading.sd_write_latency_ms = g_sd_write_latency_ms;
          xSemaphoreGive(g_mutex);
        }
      }
    }

    // ── Serial debug (every second) ────────────────────────────
    Serial.printf("[%s] T:%.1f H:%.1f | Batt:%.2fV %.3fA | Solar:%.2fV %.3fA | %s\n",
                  ts, temperature, humidity, voltage, current_A, sol_voltage, sol_current_A, sensorStatus.c_str());

    vTaskDelay(pdMS_TO_TICKS(SENSOR_INTERVAL_MS));
  }
}


// ── TASK 2: Upload Task (Core 0, every UPLOAD_INTERVAL_S seconds) ─────────────
//
// Power cycle pattern:
//   1. Power dongle ON  (wifiDongleOn)
//   2. Wait WIFI_DONGLE_BOOT_MS for dongle to join hotspot
//   3. Connect ESP32 WiFi stack → upload → flush pending
//   4. Power dongle OFF (wifiDongleOff) → saves ~200–500 mA between cycles
//
// heartbeatTask gates on g_dongle_on, so the heartbeat fires inside this
// window before the dongle is cut off.
void uploadTask(void* pvParams) {
  esp_task_wdt_add(NULL);

  Serial.println("[UploadTask] Started on Core 0");

  // Give sensor task a head start; dongle is already ON from setup()
  vTaskDelay(pdMS_TO_TICKS(5000));

  while (true) {
    esp_task_wdt_reset();

    // ── 0. Check pending buffer depth ─────────────────────────
    g_pending_row_count = countFileRows(PENDING_FILE);
    if (g_pending_row_count > 0) {
      Serial.printf("[Upload] Pending rows detected: %lu\n", (unsigned long)g_pending_row_count);
    }

    // ── 1. Power the dongle ON and wait for it to boot ────────
    wifiDongleOn();
    vTaskDelay(pdMS_TO_TICKS(WIFI_DONGLE_BOOT_MS));
    esp_task_wdt_reset();  // keep watchdog happy during dongle boot wait

    // ── 2. Connect WiFi ───────────────────────────────────────
    bool wifiOK = connectWiFi();

    if (wifiOK) {
      syncRTCWithNTP();
      flushPending();

      SensorReading snap;
      if (xSemaphoreTake(g_mutex, pdMS_TO_TICKS(500)) == pdTRUE) {
        snap = g_reading;
        xSemaphoreGive(g_mutex);
      }
      snap.wifi_rssi               = WiFi.RSSI();
      snap.wifi_connected          = true;
      snap.send_success            = g_send_success;
      snap.send_fail               = g_send_fail;
      snap.sd_fail                 = g_sd_fail;
      snap.wifi_reconnect_count    = g_wifi_reconnect_count;
      snap.consecutive_fail_streak = g_consecutive_fail_streak;
      snap.max_fail_streak         = g_max_fail_streak;

      if (!uploadReading(snap)) {
        sdAppendRow(PENDING_FILE, snap);
        Serial.println("[Upload] Saved to pending buffer.");
      }

      // ── 3. Brief window for heartbeatTask to fire ─────────
      // heartbeatTask is staggered 15 s after uploadTask; give it time
      // to complete before we cut power (max 20 s grace period).
      vTaskDelay(pdMS_TO_TICKS(20000));
      esp_task_wdt_reset();
    } else {
      SensorReading snap;
      if (xSemaphoreTake(g_mutex, pdMS_TO_TICKS(300)) == pdTRUE) {
        snap = g_reading;
        xSemaphoreGive(g_mutex);
      }
      snap.wifi_connected = false;
      snap.wifi_rssi      = -999;
      sdAppendRow(PENDING_FILE, snap);
      Serial.println("[Upload] WiFi down — buffered to pending.");
    }

    // ── 4. Power the dongle OFF ───────────────────────────────
    wifiDongleOff();
    uint32_t activeWindowMs = millis() - g_radio_start_ms;
    g_radio_on_duration_ms += activeWindowMs;
    
    // Throughput (kbps) = (Total Bytes / 1024) / (Duration / 1000)
    float kbps = (activeWindowMs > 0) ? ((g_total_bytes_sent / 1024.0f) / (activeWindowMs / 1000.0f)) : 0.0f;
    g_total_bytes_sent = 0; // Reset for next window

    if (xSemaphoreTake(g_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
      g_reading.net_throughput_kbps = kbps;
      g_reading.sd_max_write_latency_ms = g_sd_max_write_latency_ms;
      xSemaphoreGive(g_mutex);
    }

    // Safe Adaptive Low Power mode: spacing out uploads if battery < 11.5V
    float voltage = g_reading.batt_voltage;
    if (voltage < 11.5f) {
      g_current_upload_interval_s = UPLOAD_INTERVAL_S * 5; // upload every 5 mins
      Serial.println("[Power] Low battery — spacing records to 5 min.");
    } else {
      g_current_upload_interval_s = UPLOAD_INTERVAL_S;
    }

    uint32_t sleepMs = (g_current_upload_interval_s * 1000) - WIFI_DONGLE_BOOT_MS - 20000;
    vTaskDelay(pdMS_TO_TICKS(sleepMs > 1000 ? sleepMs : 1000));
  }
}


// ── TASK 3: Heartbeat Task (Core 0, every HEARTBEAT_INTERVAL_S seconds) ───────
//
// Fires 15 s after uploadTask starts its window. Gates on g_dongle_on so it
// never attempts an upload while the dongle is physically powered off.
void heartbeatTask(void* pvParams) {
  esp_task_wdt_add(NULL);

  Serial.println("[HeartbeatTask] Started on Core 0");

  // Stagger 15 s behind uploadTask — dongle will already be ON by then
  vTaskDelay(pdMS_TO_TICKS(15000));

  while (true) {
    esp_task_wdt_reset();

    if (!g_dongle_on) {
      // Dongle is off (power-save gap) — wait until next window
      Serial.println("[Heartbeat] Skipped — dongle off (power save).");
    } else if (WiFi.status() == WL_CONNECTED) {
      SensorReading snap;
      if (xSemaphoreTake(g_mutex, pdMS_TO_TICKS(300)) == pdTRUE) {
        snap = g_reading;
        xSemaphoreGive(g_mutex);
      }
      uploadHeartbeat(snap);
    } else {
      Serial.println("[Heartbeat] Skipped — WiFi down.");
    }

    vTaskDelay(pdMS_TO_TICKS(HEARTBEAT_INTERVAL_S * 1000));
  }
}


// =============================================================================
//  SETUP
// =============================================================================

void setup() {
  // ── Mutexes (Initialized FIRST to prevent early task/helper crashes) ──
  g_mutex = xSemaphoreCreateMutex();
  g_i2c_mutex = xSemaphoreCreateMutex();
  
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== Sipat Banwa — Reliability Test Firmware ===");

  // ── Reset reason & persistent boot count ──────────────────
  g_reset_reason = resetReasonString();
  Serial.printf("[Boot] Reset reason: %s\n", g_reset_reason.c_str());

  prefs.begin("soak", false);
  g_boot_count = prefs.getUInt("boot_count", 0) + 1;
  prefs.putUInt("boot_count", g_boot_count);
  
  // Track brownouts separately
  g_brownout_count = prefs.getUInt("brown_count", 0);
  if (esp_reset_reason() == ESP_RST_BROWNOUT) {
    g_brownout_count++;
    prefs.putUInt("brown_count", g_brownout_count);
  }
  
  // Crash Logging: If reset was panic/WDT, write to /crashlog.txt
  esp_reset_reason_t reason = esp_reset_reason();
  if (reason == ESP_RST_PANIC || reason == ESP_RST_INT_WDT || reason == ESP_RST_TASK_WDT || reason == ESP_RST_WDT) {
    if (SD.begin(SD_CS)) {
      File f = SD.open("/crashlog.txt", FILE_APPEND);
      if (f) {
        char ts[20]; rtcNow(ts, sizeof(ts));
        f.printf("[%s] CRASH DETECTED: %s (Boot #%lu)\n", ts, g_reset_reason.c_str(), g_boot_count);
        f.close();
      }
    }
  }
  prefs.end();
  
  // Check if crash log exists for g_reading
  bool hasCrash = SD.exists("/crashlog.txt");
  if (xSemaphoreTake(g_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
    g_reading.has_crash_log = hasCrash;
    xSemaphoreGive(g_mutex);
  }
  Serial.printf("[Boot] Boot count: %lu, Brownouts: %lu\n", 
                (unsigned long)g_boot_count, (unsigned long)g_brownout_count);

  // ── Watchdog Timer ─────────────────────────────────────────
  esp_task_wdt_init(WATCHDOG_TIMEOUT_S, true);
  esp_task_wdt_add(NULL);                              // register setup task

  // ── I2C (RTC + INA219) ────────────────────────────────────
  Wire.begin(21, 22);  // SDA=21, SCL=22

  // ── RTC ────────────────────────────────────────────────────
  if (!rtc.begin()) {
    Serial.println("[RTC] ERROR: not detected. Check wiring.");
  } else {
    if (rtc.lostPower()) {
      Serial.println("[RTC] Lost power — send 'YYYY-MM-DD HH:MM:SS' via Serial to update.");
    }
    char ts[20];
    rtcNow(ts, sizeof(ts));
    Serial.printf("[RTC] Time: %s\n", ts);
  }

  // ── INA219 (Battery + Solar) ─────────────────────────────
  if (!ina219_batt.begin()) {
    Serial.println("[INA219-BATT] ERROR: not detected. Check wiring (0x40).");
  } else {
    ina219_batt.setCalibration_32V_2A();
    Serial.println("[INA219-BATT] OK — calibrated at 32V/2A (0x40)");
  }

  if (!ina219_solar.begin()) {
    Serial.println("[INA219-SOLAR] ERROR: not detected. Check wiring (0x41).");
  } else {
    ina219_solar.setCalibration_32V_2A();
    Serial.println("[INA219-SOLAR] OK — calibrated at 32V/2A (0x41)");
  }

  // ── Modbus RS485 ───────────────────────────────────────────
  Serial1.begin(9600, SERIAL_8N1, RS485_RX, RS485_TX);
  node.begin(1, Serial1);  // Modbus slave ID 1
  Serial.println("[Modbus] RS485 OK");

  // ── SD Card ────────────────────────────────────────────────
  SPI.begin(18, 19, 23, SD_CS);  // SCK=18, MISO=19, MOSI=23, CS=5
  if (!SD.begin(SD_CS)) {
    Serial.println("[SD] ERROR: init failed — no SD card? Continuing without SD.");
  } else {
    Serial.printf("[SD] OK — %.1f MB free\n",
                  (SD.totalBytes() - SD.usedBytes()) / (1024.0f * 1024.0f));
    sdWriteHeader(LOG_FILE);
    sdWriteHeader(PENDING_FILE);
  }

  // ── Rain Sensor ─────────────────────────────────────────────
  RainSerial.begin(9600, SERIAL_8N1, RAIN_RX, RAIN_TX);
  RainSensor.begin();
  Serial.println("[Rain] UART Sensor OK");

  // ── WiFi MOSFET ──
  pinMode(WIFI_POWER_PIN, OUTPUT);
  wifiDongleOn();                              // ensure dongle is ON at boot
  delay(WIFI_DONGLE_BOOT_MS);                  // wait for dongle to register

  // ── WiFi (initial connect) ─────────────────────────────────
  connectWiFi();
  g_wifi_reconnect_count = 0;   // boot connect doesn't count as a "reconnect"

  // ── Initialize shared reading with safe defaults ───────────
  memset(&g_reading, 0, sizeof(g_reading));
  g_reading.sensor_status = "INIT";
  g_reading.reset_reason  = g_reset_reason;
  g_reading.boot_count    = g_boot_count;
  g_batt_min_voltage      = 99.0f;   // sentinel before first INA219 read

  configASSERT(g_mutex);
  configASSERT(g_i2c_mutex);

  // ── Watchdog: done with setup ──────────────────────────────
  esp_task_wdt_delete(NULL);

  // ── Start FreeRTOS Tasks ───────────────────────────────────
  //  sensorTask    → Core 1, priority 3
  //  uploadTask    → Core 0, priority 2
  //  heartbeatTask → Core 0, priority 1
  xTaskCreatePinnedToCore(sensorTask,    "SensorTask",    8192,  NULL, 3, &g_sensorTaskHandle, 1);
  xTaskCreatePinnedToCore(uploadTask,    "UploadTask",   16384,  NULL, 2, &g_uploadTaskHandle, 0);
  xTaskCreatePinnedToCore(heartbeatTask, "HeartbeatTask", 8192,  NULL, 1, NULL, 0);

  Serial.println("[Setup] All tasks launched. System running.\n");
}


// =============================================================================
//  LOOP (unused — all work is in FreeRTOS tasks)
// =============================================================================

void loop() {
  // Yield to FreeRTOS scheduler — do not block here
  vTaskDelay(pdMS_TO_TICKS(10000));
}
