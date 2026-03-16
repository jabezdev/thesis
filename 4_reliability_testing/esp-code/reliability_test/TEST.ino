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

// Debounce (rain gauge — hardware disabled, kept for future use)
const unsigned long RAIN_DEBOUNCE_MS = 150;

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
  float     internal_temp_c;    // °C — ESP32 die temperature ← NEW
  uint32_t  min_heap;           // bytes — heap low-water mark← NEW
  uint32_t  log_count;          // total SD rows written      ← NEW
  uint32_t  sd_free_mb;         // MB remaining on SD card    ← NEW
  uint32_t  upload_latency_ms;  // last PATCH round-trip ms   ← NEW

  // Connectivity
  int       wifi_rssi;          // dBm
  bool      wifi_connected;
  uint32_t  wifi_reconnect_count;     // link-drop + reconnect events ← NEW
  uint32_t  consecutive_fail_streak;  // current upload fail run      ← NEW
  uint32_t  max_fail_streak;          // worst fail run this session  ← NEW

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
uint32_t g_avg_upload_latency_ms  = 0;
uint32_t g_upload_latency_count   = 0;
uint32_t g_sd_write_latency_ms    = 0;
uint32_t g_pending_row_count      = 0;

// Task handles (for cross-task stack HWM queries)
TaskHandle_t g_sensorTaskHandle  = NULL;
TaskHandle_t g_uploadTaskHandle  = NULL;

// MOSFET dongle power state — shared between uploadTask and heartbeatTask
// uploadTask sets true before powering on and false after powering off;
// heartbeatTask gates on this so it only fires inside the active window.
volatile bool g_dongle_on = false;


// ── Rain Interrupt State (DISABLED — kept for future) ─────────────────────────
// volatile uint32_t      g_rain_count = 0;
// volatile unsigned long g_last_tip_ms = 0;
// void IRAM_ATTR rainISR() {
//   unsigned long now = millis();
//   if (now - g_last_tip_ms > RAIN_DEBOUNCE_MS) {
//     g_rain_count++;
//     g_last_tip_ms = now;
//   }
// }


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
    rtc.adjust(DateTime(timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
                        timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec));
    Serial.println("[RTC] Synced with NTP.");
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
  digitalWrite(WIFI_POWER_PIN, HIGH);
  g_dongle_on = true;
  g_dongle_power_cycles++;
  Serial.printf("[WiFi] Dongle powered ON (cycle #%lu).\n", (unsigned long)g_dongle_power_cycles);
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
void fsDouble(String& s, const char* name, float v, bool comma = true) {
  s += String('"') + name + "\":{\"doubleValue\":" + String(v, 4) + "}";
  if (comma) s += ',';
}
void fsInt(String& s, const char* name, long v, bool comma = true) {
  s += String('"') + name + "\":{\"integerValue\":" + String(v) + "}";
  if (comma) s += ',';
}
void fsStr(String& s, const char* name, const char* v, bool comma = true) {
  s += String('"') + name + "\":{\"stringValue\":\"" + String(v) + "\"}";
  if (comma) s += ',';
}
void fsBool(String& s, const char* name, bool v, bool comma = true) {
  s += String('"') + name + "\":{\"booleanValue\":" + (v ? "true" : "false") + "}";
  if (comma) s += ',';
}

// ── Upload full reading → Firestore: readings/{STATION_ID} ───────────────────
bool uploadReading(const SensorReading& r) {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  String url = firestoreUrl("readings", STATION_ID);
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");

  String p = "{\"fields\":{";

  // Environmental
  fsStr(p,    "timestamp",                r.timestamp);
  fsDouble(p, "temperature",              r.temperature);
  fsDouble(p, "humidity",                 r.humidity);
  fsDouble(p, "rainfall_mm",              r.rainfall_mm);
  fsDouble(p, "rainfall_1h_mm",           r.rainfall_1h_mm);
  fsInt(p,    "rain_raw",                 (long)r.rain_raw);

  // Power
  fsDouble(p, "batt_voltage",             r.batt_voltage);
  fsDouble(p, "batt_current_A",           r.batt_current_A);
  fsDouble(p, "batt_power_W",             r.batt_power_W);
  fsDouble(p, "batt_soc_pct",             r.batt_soc_pct);
  fsDouble(p, "batt_remaining_Ah",        r.batt_remaining_Ah);
  fsDouble(p, "batt_total_energy_Wh",     r.batt_total_energy_Wh);
  fsDouble(p, "batt_peak_current_A",      r.batt_peak_current_A);
  fsDouble(p, "batt_min_voltage",         r.batt_min_voltage);

  // Solar Power
  fsDouble(p, "solar_voltage",            r.solar_voltage);
  fsDouble(p, "solar_current_A",          r.solar_current_A);
  fsDouble(p, "solar_power_W",            r.solar_power_W);
  fsDouble(p, "solar_energy_Wh",          r.solar_energy_Wh);
  fsDouble(p, "solar_peak_current_A",     r.solar_peak_current_A);

  // System health
  fsDouble(p, "internal_temp_c",          r.internal_temp_c);
  fsInt(p,    "free_heap",                (long)r.free_heap);
  fsDouble(p, "heap_frag_pct",            r.heap_frag_pct);
  fsInt(p,    "min_heap",                 (long)r.min_heap);
  fsInt(p,    "log_count",                (long)r.log_count);
  fsInt(p,    "sd_free_mb",               (long)r.sd_free_mb);
  fsInt(p,    "sd_used_mb",               (long)r.sd_used_mb);
  fsInt(p,    "upload_latency_ms",        (long)r.upload_latency_ms);
  fsInt(p,    "avg_upload_latency_ms",    (long)r.avg_upload_latency_ms);
  fsInt(p,    "sd_write_latency_ms",      (long)r.sd_write_latency_ms);
  fsInt(p,    "sensor_stack_hwm",         (long)r.sensor_stack_hwm);
  fsInt(p,    "upload_stack_hwm",         (long)r.upload_stack_hwm);

  // Connectivity
  fsInt(p,    "wifi_rssi",                (long)r.wifi_rssi);
  fsBool(p,   "wifi_connected",           r.wifi_connected);
  fsInt(p,    "wifi_reconnect_count",     (long)r.wifi_reconnect_count);
  fsInt(p,    "wifi_offline_total_s",     (long)r.wifi_offline_total_s);
  fsInt(p,    "longest_offline_streak_s", (long)r.longest_offline_streak_s);
  fsInt(p,    "dongle_power_cycles",      (long)r.dongle_power_cycles);
  fsInt(p,    "consec_fail_streak",       (long)r.consecutive_fail_streak);
  fsInt(p,    "max_fail_streak",          (long)r.max_fail_streak);
  fsInt(p,    "pending_row_count",        (long)r.pending_row_count);

  // Modbus reliability
  fsInt(p,    "total_read_count",         (long)r.total_read_count);
  fsDouble(p, "modbus_error_rate_pct",    r.modbus_error_rate_pct);
  fsInt(p,    "consec_modbus_fail",       (long)r.consec_modbus_fail);
  fsInt(p,    "max_modbus_fail_streak",   (long)r.max_modbus_fail_streak);
  fsInt(p,    "sensor_read_latency_ms",   (long)r.sensor_read_latency_ms);

  // System diagnostics
  fsInt(p,    "uptime_s",                 (long)r.uptime_s);
  fsDouble(p, "uptime_h",                 r.uptime_h);
  fsStr(p,    "sensor_status",            r.sensor_status.c_str());
  fsStr(p,    "reset_reason",             r.reset_reason.c_str());
  fsInt(p,    "boot_count",               (long)r.boot_count);
  fsInt(p,    "send_success",             (long)r.send_success);
  fsInt(p,    "send_fail",                (long)r.send_fail);
  fsInt(p,    "sd_fail",                  (long)r.sd_fail, false);
  p += "}}";

  unsigned long t0   = millis();
  int  code          = http.PATCH(p);
  uint32_t latency   = (uint32_t)(millis() - t0);
  http.end();

  if (code > 0 && code < 300) {
    g_send_success++;
    g_consecutive_fail_streak = 0;
    // Running mean of upload latency
    g_upload_latency_count++;
    g_avg_upload_latency_ms += (latency - g_avg_upload_latency_ms) / g_upload_latency_count;
    // Write back both latencies to shared struct
    if (xSemaphoreTake(g_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
      g_reading.upload_latency_ms     = latency;
      g_reading.avg_upload_latency_ms = g_avg_upload_latency_ms;
      xSemaphoreGive(g_mutex);
    }
    Serial.printf("[Firestore] OK (HTTP %d, %lu ms, avg %lu ms) — %s\n",
                  code, latency, g_avg_upload_latency_ms, r.timestamp);
    return true;
  } else {
    g_send_fail++;
    g_consecutive_fail_streak++;
    if (g_consecutive_fail_streak > g_max_fail_streak)
      g_max_fail_streak = g_consecutive_fail_streak;
    Serial.printf("[Firestore] FAIL (HTTP %d, %lu ms) — streak: %lu\n",
                  code, latency, (unsigned long)g_consecutive_fail_streak);
    return false;
  }
}

// ── Heartbeat → Firestore: heartbeats/{STATION_ID} ───────────────────────────
void uploadHeartbeat(const SensorReading& r) {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  String url = firestoreUrl("heartbeats", STATION_ID);
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");

  String p = "{\"fields\":{";
  fsStr(p,    "station_id",               STATION_ID);
  fsStr(p,    "timestamp",                r.timestamp);
  fsDouble(p, "uptime_h",                 r.uptime_h);
  fsInt(p,    "uptime_s",                 (long)r.uptime_s);
  fsInt(p,    "boot_count",               (long)r.boot_count);
  fsDouble(p, "batt_voltage",             r.batt_voltage);
  fsDouble(p, "batt_soc_pct",             r.batt_soc_pct);
  fsDouble(p, "batt_total_energy_Wh",     r.batt_total_energy_Wh);
  fsDouble(p, "solar_energy_Wh",          r.solar_energy_Wh);
  fsDouble(p, "internal_temp_c",          r.internal_temp_c);
  fsInt(p,    "free_heap",                (long)r.free_heap);
  fsDouble(p, "heap_frag_pct",            r.heap_frag_pct);
  fsInt(p,    "min_heap",                 (long)r.min_heap);
  fsInt(p,    "sensor_stack_hwm",         (long)r.sensor_stack_hwm);
  fsInt(p,    "upload_stack_hwm",         (long)r.upload_stack_hwm);
  fsInt(p,    "wifi_rssi",                (long)r.wifi_rssi);
  fsInt(p,    "wifi_reconnect_count",     (long)r.wifi_reconnect_count);
  fsInt(p,    "wifi_offline_total_s",     (long)r.wifi_offline_total_s);
  fsInt(p,    "longest_offline_streak_s", (long)r.longest_offline_streak_s);
  fsInt(p,    "dongle_power_cycles",      (long)r.dongle_power_cycles);
  fsInt(p,    "avg_upload_latency_ms",    (long)r.avg_upload_latency_ms);
  fsInt(p,    "sd_write_latency_ms",      (long)r.sd_write_latency_ms);
  fsInt(p,    "pending_row_count",        (long)r.pending_row_count);
  fsDouble(p, "modbus_error_rate_pct",    r.modbus_error_rate_pct);
  fsInt(p,    "max_modbus_fail_streak",   (long)r.max_modbus_fail_streak);
  fsInt(p,    "send_success",             (long)r.send_success);
  fsInt(p,    "send_fail",               (long)r.send_fail);
  fsInt(p,    "max_fail_streak",          (long)r.max_fail_streak);
  fsStr(p,    "sensor_status",            r.sensor_status.c_str());
  fsStr(p,    "reset_reason",             r.reset_reason.c_str(), false);
  p += "}}";

  int code = http.PATCH(p);
  http.end();

  if (code > 0 && code < 300) {
    Serial.printf("[Heartbeat] OK (HTTP %d)\n", code);
  } else {
    Serial.printf("[Heartbeat] FAIL (HTTP %d)\n", code);
  }
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
            "sensor_status,reset_reason,boot_count,send_success,send_fail,sd_fail");
  f.close();
}

bool sdAppendRow(const char* path, const SensorReading& r) {
  File f = SD.open(path, FILE_APPEND);
  if (!f) {
    g_sd_fail++;
    Serial.printf("[SD] Write error: %s\n", path);
    return false;
  }
  char row[768];
  snprintf(row, sizeof(row),
    "%s,%.2f,%.2f,"       // env: ts, temp, hum
    "%.2f,%.2f,%lu,"                         // rain: mm, 1h, raw
    "%.3f,%.4f,%.3f,%.1f,%.3f,"             // power: v, i, p, soc, ah
    "%.4f,%.4f,%.3f,"                        // batt ext: wh, peak_i, min_v
    "%.3f,%.4f,%.3f,%.4f,%.4f,"              // solar: v, i, p, wh, peak_i
    "%.1f,%lu,%.1f,%lu,%lu,%lu,%lu,%lu,%lu," // health: int_temp, min_h, frag, lc, free, used, lat, avg_lat, sd_lat
    "%d,%d,%lu,%lu,%lu,%lu,%lu,%lu,"         // wifi: rssi, conn, recon, off_tot, long_off, dongle, streak, max_streak, pending
    "%lu,%.2f,%lu,%lu,%lu,"                  // modbus: total, err_rate, consec, max, lat
    "%lu,%.3f,%lu,%lu,%lu,"                  // sys: uptime_s, uptime_h, free, s_hwm, u_hwm
    "%s,%s,%lu,%lu,%lu,%lu",                // meta: status, reset, boot, succ, fail, sd_fail
    r.timestamp,
    r.temperature, r.humidity,
    r.rainfall_mm, r.rainfall_1h_mm, (unsigned long)r.rain_raw,
    r.batt_voltage, r.batt_current_A, r.batt_power_W,
    r.batt_soc_pct, r.batt_remaining_Ah,
    r.batt_total_energy_Wh, r.batt_peak_current_A, r.batt_min_voltage,
    r.solar_voltage, r.solar_current_A, r.solar_power_W, r.solar_energy_Wh, r.solar_peak_current_A,
    r.internal_temp_c, (unsigned long)r.min_heap, r.heap_frag_pct, (unsigned long)r.log_count,
    (unsigned long)r.sd_free_mb, (unsigned long)r.sd_used_mb, (unsigned long)r.upload_latency_ms, (unsigned long)r.avg_upload_latency_ms, (unsigned long)r.sd_write_latency_ms,
    r.wifi_rssi, (int)r.wifi_connected, (unsigned long)r.wifi_reconnect_count, (unsigned long)r.wifi_offline_total_s, (unsigned long)r.longest_offline_streak_s, (unsigned long)r.dongle_power_cycles, (unsigned long)r.consecutive_fail_streak, (unsigned long)r.max_fail_streak, (unsigned long)r.pending_row_count,
    (unsigned long)r.total_read_count, r.modbus_error_rate_pct, (unsigned long)r.consec_modbus_fail, (unsigned long)r.max_modbus_fail_streak, (unsigned long)r.sensor_read_latency_ms,
    (unsigned long)r.uptime_s, r.uptime_h, (unsigned long)r.free_heap, (unsigned long)r.sensor_stack_hwm, (unsigned long)r.upload_stack_hwm,
    r.sensor_status.c_str(), r.reset_reason.c_str(), (unsigned long)r.boot_count, (unsigned long)r.send_success, (unsigned long)r.send_fail, (unsigned long)r.sd_fail
  );
  f.println(row);
  f.close();
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

  Serial.println("[SensorTask] Started on Core 1");

  while (true) {
    esp_task_wdt_reset();

    checkSerialRTCUpdate();

    // ── Read Modbus (temp/humidity) ─────────────────────────────
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

      bool tempOK = (!isnan(temperature) && temperature >= TEMP_MIN && temperature <= TEMP_MAX);
      bool humOK  = (!isnan(humidity)    && humidity    >= HUM_MIN  && humidity    <= HUM_MAX);
      sensorStatus = (tempOK && humOK) ? "OK" : "ERROR";

      if (tempOK && humOK) {
        g_consec_modbus_fail = 0;
      } else {
        g_consec_modbus_fail++;
        if (g_consec_modbus_fail > g_max_modbus_fail_streak)
          g_max_modbus_fail_streak = g_consec_modbus_fail;
      }
      if (!tempOK) Serial.printf("[Sensor] WARN: invalid temperature = %.2f\n", temperature);
      if (!humOK)  Serial.printf("[Sensor] WARN: invalid humidity = %.2f\n",    humidity);
    } else {
      g_sensor_fail++;
      g_consec_modbus_fail++;
      if (g_consec_modbus_fail > g_max_modbus_fail_streak)
        g_max_modbus_fail_streak = g_consec_modbus_fail;
      Serial.printf("[Sensor] Modbus FAIL (err 0x%02X) fail#%lu streak:%lu\n",
                    result, (unsigned long)g_sensor_fail, (unsigned long)g_consec_modbus_fail);
    }

    // ── Read Rain Sensor (UART) ────────────────────────────────
    float rainfall_mm    = RainSensor.getRainfall();
    float rainfall_1h_mm = RainSensor.getRainfall(1);
    uint32_t rain_raw    = RainSensor.getRawData();

    // ── Read INA219 Battery ─────────────────────────────────────────
    float voltage    = ina219_batt.getBusVoltage_V();
    float current_mA = ina219_batt.getCurrent_mA();
    float current_A  = current_mA / 1000.0f;
    float power_mW   = ina219_batt.getPower_mW();
    float power_W    = power_mW / 1000.0f;

    // Battery: Coulomb counting + cumulative energy
    g_batt_used_Ah         += current_A * (SENSOR_INTERVAL_MS / 3600000.0f);
    g_batt_total_energy_Wh += power_W   * (SENSOR_INTERVAL_MS / 3600000.0f);

    float remaining_Ah = CAPACITY_AH - g_batt_used_Ah;
    float soc          = constrain((remaining_Ah / CAPACITY_AH) * 100.0f, 0.0f, 100.0f);

    // Battery: Peak / session-minimum tracking
    if (current_A > g_batt_peak_current_A) g_batt_peak_current_A = current_A;
    if (voltage   < g_batt_min_voltage)    g_batt_min_voltage    = voltage;

    // ── Read INA219 Solar ──────────────────────────────────────
    float sol_voltage    = ina219_solar.getBusVoltage_V();
    float sol_current_mA = ina219_solar.getCurrent_mA();
    float sol_current_A  = sol_current_mA / 1000.0f;
    float sol_power_mW   = ina219_solar.getPower_mW();
    float sol_power_W    = sol_power_mW / 1000.0f;

    // Solar: cumulative energy + peak tracking
    g_solar_total_energy_Wh += sol_power_W * (SENSOR_INTERVAL_MS / 3600000.0f);
    if (sol_current_A > g_solar_peak_current_A) g_solar_peak_current_A = sol_current_A;

    // Heap low-water mark + fragmentation
    uint32_t heap     = ESP.getFreeHeap();
    uint32_t maxAlloc = ESP.getMaxAllocHeap();
    float    heapFrag = (heap > 0) ? (1.0f - (float)maxAlloc / (float)heap) * 100.0f : 0.0f;
    if (heap < g_min_heap) g_min_heap = heap;

    // ESP32 internal die temperature
    float int_temp = temperatureRead();

    // WiFi offline tracking (updated every second)
    if (WiFi.status() != WL_CONNECTED) {
      g_current_offline_s++;
      g_wifi_offline_total_s++;
      if (g_current_offline_s > g_longest_offline_streak_s)
        g_longest_offline_streak_s = g_current_offline_s;
    } else {
      g_current_offline_s = 0;
    }

    // Task stack high-water marks
    uint32_t sensor_hwm = uxTaskGetStackHighWaterMark(NULL);
    uint32_t upload_hwm = g_uploadTaskHandle ? uxTaskGetStackHighWaterMark(g_uploadTaskHandle) : 0;

    // Low-voltage cutoff
    if (voltage <= CUTOFF_VOLTAGE) {
      Serial.printf("[Power] CUTOFF: voltage %.2fV <= %.1fV — halting safely.\n",
                    voltage, CUTOFF_VOLTAGE);
      esp_task_wdt_delete(NULL);
      vTaskDelay(pdMS_TO_TICKS(3000));
      esp_restart();
    }

    // ── Build timestamp ────────────────────────────────────────
    char ts[20];
    rtcNow(ts, sizeof(ts));

    // ── Pack into shared struct ────────────────────────────────
    if (xSemaphoreTake(g_mutex, pdMS_TO_TICKS(500)) == pdTRUE) {
      strncpy(g_reading.timestamp, ts, sizeof(g_reading.timestamp));
      g_reading.temperature              = temperature;
      g_reading.humidity                 = humidity;
      g_reading.rainfall_mm              = rainfall_mm;
      g_reading.rainfall_1h_mm           = rainfall_1h_mm;
      g_reading.rain_raw                 = rain_raw;
      g_reading.batt_voltage             = voltage;
      g_reading.batt_current_A           = current_A;
      g_reading.batt_power_W             = power_W;
      g_reading.batt_soc_pct             = soc;
      g_reading.batt_remaining_Ah        = remaining_Ah;
      g_reading.batt_total_energy_Wh     = g_batt_total_energy_Wh;
      g_reading.batt_peak_current_A      = g_batt_peak_current_A;
      g_reading.batt_min_voltage         = g_batt_min_voltage;

      g_reading.solar_voltage            = sol_voltage;
      g_reading.solar_current_A          = sol_current_A;
      g_reading.solar_power_W            = sol_power_W;
      g_reading.solar_energy_Wh          = g_solar_total_energy_Wh;
      g_reading.solar_peak_current_A     = g_solar_peak_current_A;
      g_reading.internal_temp_c          = int_temp;
      g_reading.min_heap                 = g_min_heap;
      g_reading.log_count                = g_log_count;
      g_reading.sd_free_mb               = (uint32_t)((SD.totalBytes() - SD.usedBytes()) / (1024UL * 1024UL));
      g_reading.sd_used_mb               = (uint32_t)(SD.usedBytes() / (1024UL * 1024UL));
      // upload_latency_ms / avg / sd_write_latency written back by upload/sdAppend
      g_reading.wifi_rssi                = WiFi.RSSI();
      g_reading.wifi_connected           = (WiFi.status() == WL_CONNECTED);
      g_reading.wifi_reconnect_count     = g_wifi_reconnect_count;
      g_reading.consecutive_fail_streak  = g_consecutive_fail_streak;
      g_reading.max_fail_streak          = g_max_fail_streak;
      g_reading.uptime_s                 = millis() / 1000;
      g_reading.uptime_h                 = millis() / 3600000.0f;
      g_reading.free_heap                = heap;
      g_reading.heap_frag_pct            = heapFrag;
      g_reading.sensor_status            = sensorStatus;
      g_reading.reset_reason             = g_reset_reason;
      g_reading.boot_count               = g_boot_count;
      g_reading.send_success             = g_send_success;
      g_reading.send_fail                = g_send_fail;
      g_reading.sd_fail                  = g_sd_fail;
      // Extended metrics
      g_reading.total_read_count         = g_total_read_count;
      g_reading.modbus_error_rate_pct    = g_total_read_count > 0
                                           ? (float)g_sensor_fail / g_total_read_count * 100.0f : 0.0f;
      g_reading.consec_modbus_fail       = g_consec_modbus_fail;
      g_reading.max_modbus_fail_streak   = g_max_modbus_fail_streak;
      g_reading.sensor_read_latency_ms   = readLatency;
      g_reading.wifi_offline_total_s     = g_wifi_offline_total_s;
      g_reading.longest_offline_streak_s = g_longest_offline_streak_s;
      g_reading.dongle_power_cycles      = g_dongle_power_cycles;
      g_reading.pending_row_count        = g_pending_row_count;
      g_reading.avg_upload_latency_ms    = g_avg_upload_latency_ms;
      g_reading.sd_write_latency_ms      = g_sd_write_latency_ms;
      g_reading.sensor_stack_hwm         = sensor_hwm;
      g_reading.upload_stack_hwm         = upload_hwm;
      xSemaphoreGive(g_mutex);
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

    // Sleep for the rest of the upload interval
    // (interval - dongle boot - heartbeat grace = ~60s - 6s - 20s = ~34s)
    const uint32_t sleepMs = (UPLOAD_INTERVAL_S * 1000)
                             - WIFI_DONGLE_BOOT_MS
                             - 20000;
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
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== Sipat Banwa — Reliability Test Firmware ===");

  // ── Reset reason & persistent boot count ──────────────────
  g_reset_reason = resetReasonString();
  Serial.printf("[Boot] Reset reason: %s\n", g_reset_reason.c_str());

  prefs.begin("soak", false);                          // NVS namespace "soak"
  g_boot_count = prefs.getUInt("boot_count", 0) + 1;
  prefs.putUInt("boot_count", g_boot_count);
  prefs.end();
  Serial.printf("[Boot] Boot count: %lu\n", (unsigned long)g_boot_count);

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

  // ── Mutex ──────────────────────────────────────────────────
  g_mutex = xSemaphoreCreateMutex();
  configASSERT(g_mutex);

  // ── Initialize shared reading with safe defaults ───────────
  memset(&g_reading, 0, sizeof(g_reading));
  g_reading.sensor_status = "INIT";
  g_reading.reset_reason  = g_reset_reason;
  g_reading.boot_count    = g_boot_count;
  g_batt_min_voltage      = 99.0f;   // sentinel before first INA219 read

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
