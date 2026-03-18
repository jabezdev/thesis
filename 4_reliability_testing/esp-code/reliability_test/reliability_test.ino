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
#include <esp_system.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/semphr.h>
#include <Preferences.h>      // NVS — persistent boot_count across reboots
#include <ArduinoJson.h>      // For robust JSON serialization
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
const uint32_t NTP_SYNC_INTERVAL_MS = 6UL * 60UL * 60UL * 1000UL;  // 6h
const uint32_t NTP_BACKOFF_MIN_MS   = 10UL * 60UL * 1000UL;         // 10m
const uint32_t NTP_BACKOFF_MAX_MS   = 6UL * 60UL * 60UL * 1000UL;   // 6h
const uint32_t SD_REMOUNT_INTERVAL_MS = 30000UL;


// SD & Serial pins
#define SD_CS          5
#define LOG_FILE       "/datalog.csv"
#define LOG_BIN_FILE   "/datalog.bin"
#define PENDING_FILE   "/pending.csv"
#define PENDING_BIN    "/pending.bin"

#define RS485_RX       16
#define RS485_TX       17

#define RAIN_RX        25
#define RAIN_TX        26

// WiFi MOSFET power control (IRFz44n)
// Gate driven HIGH = dongle powered ON, LOW = dongle powered OFF
#define WIFI_POWER_PIN       13
#define WIFI_DONGLE_BOOT_MS  6000   // ms to wait after power-on for dongle to connect
#define LOW_V_THRESHOLD      11.5f  // V
#define RECOVERY_V_THRESHOLD 12.0f  // V
#define LOW_V_COUNT_LIMIT    6      // 6 * 5s = 30s
#define RECOVERY_COUNT_LIMIT 5      // 5 * 5s = 25s

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
  char      sensor_status[16];
  char      reset_reason[24];
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
  int32_t  last_http_code;
  uint32_t http_transport_error_count;
  bool     sd_available;
  bool     sd_fault;
  uint32_t sd_remount_attempts;
  uint32_t sd_remount_success;
  float    net_throughput_kbps;        // kbps during active windows
  int32_t  ntp_drift_s;                // last RTC vs NTP delta
  uint32_t ntp_backoff_ms;
  uint32_t current_upload_interval_s;  // active UPLOAD_INTERVAL_S
};

// ── Binary Packet (Packed, No Padding) ─────────────────────────
struct __attribute__((packed)) WeatherPacketFull {
  uint32_t  ts;                // 4
  int16_t   temp_s10;          // 2
  uint16_t  hum_s10;           // 2 
  uint16_t  rain_s100;         // 2
  uint16_t  rain_1h_s100;      // 2
  uint32_t  rain_raw;          // 4
  uint16_t  v_batt_s100;       // 2
  int16_t   i_batt_s1000;      // 2
  uint16_t  p_batt_s100;       // 2
  uint8_t   soc_pct;           // 1
  uint16_t  rem_ah_s1000;      // 2
  uint16_t  e_wh_s10;          // 2
  int16_t   i_peak_s1000;      // 2
  uint16_t  v_min_s100;        // 2
  uint16_t  v_sol_s100;        // 2
  uint16_t  i_sol_s1000;       // 2
  uint16_t  p_sol_s100;        // 2
  uint16_t  e_sol_wh_s10;      // 2
  uint16_t  i_sol_peak_s1000;  // 2
  uint8_t   int_temp;          // 1
  uint32_t  min_heap;          // 4
  uint32_t  log_count;         // 4
  uint32_t  sd_free_mb;        // 4
  uint16_t  up_lat_ms;         // 2
  int8_t    rssi;              // 1
  uint8_t   flags;             // 1 (wifi_con, has_crash)
  uint16_t  reconn_count;      // 2
  uint16_t  fail_streak;       // 2
  uint16_t  max_fail;          // 2
  uint32_t  uptime_s;          // 4
  uint16_t  uptime_h_s10;      // 2
  uint32_t  free_heap;         // 4
  uint8_t   heap_frag;         // 1
  uint8_t   sensor_stat;       // 1
  uint8_t   reset_rc;          // 1
  uint32_t  boot_count;        // 4
  uint32_t  send_success;      // 4
  uint32_t  send_fail;         // 4
  uint16_t  sd_fail;           // 2
  uint32_t  total_read;        // 4
  uint16_t  mod_err_s100;      // 2
  uint16_t  consec_mb_fail;    // 2
  uint16_t  max_mb_fail;       // 2
  uint16_t  mb_latency;        // 2
  uint32_t  wifi_off_total;    // 4
  uint32_t  long_off_streak;   // 4
  uint16_t  dongle_pc;         // 2
  uint16_t  pending_rows;      // 2
  uint16_t  avg_ul_lat;        // 2
  uint16_t  sd_w_lat;          // 2
  uint16_t  s_stack_hwm;       // 2
  uint16_t  u_stack_hwm;       // 2
  uint32_t  sd_used_mb;        // 4
  uint16_t  loop_jitter;       // 2
  uint16_t  brownouts;         // 2
  uint16_t  i2c_errs;          // 2
  uint16_t  sd_max_lat;        // 2
  uint16_t  batt_ir_s10;       // 2
  uint16_t  mt_count;          // 2
  uint16_t  mc_count;          // 2
  uint16_t  h2xx;              // 2
  uint16_t  h4xx;              // 2
  uint16_t  h5xx;              // 2
  int16_t   last_http;         // 2
  uint16_t  hte_count;         // 2
  uint8_t   sd_flags;          // 1 (sd_ok, sd_fault)
  uint16_t  sd_remount_try;    // 2
  uint16_t  sd_remount_ok;     // 2
  uint16_t  net_kbps_s10;      // 2
  int32_t   ntp_drift;         // 4
  uint16_t  ntp_backoff_s;     // 2
  uint16_t  up_interval;       // 2
};

SensorReading     g_reading;
SemaphoreHandle_t g_mutex;
SemaphoreHandle_t g_i2c_mutex;


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

// Reset reason + boot count populated once at boot
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
volatile int32_t  g_last_http_code           = 0;
volatile uint32_t g_http_transport_error_count = 0;
uint32_t g_total_bytes_sent                  = 0;
int32_t  g_ntp_drift_s                       = 0;
uint32_t g_current_upload_interval_s         = UPLOAD_INTERVAL_S;
uint32_t g_last_ntp_sync_ms                  = 0;
uint32_t g_last_ntp_attempt_ms               = 0;
uint32_t g_ntp_backoff_ms                    = NTP_BACKOFF_MIN_MS;

uint32_t g_avg_upload_latency_ms  = 0;
uint32_t g_upload_latency_count   = 0;
uint32_t g_sd_write_latency_ms    = 0;
uint32_t g_pending_row_count      = 0;
uint32_t g_radio_start_ms         = 0;

uint32_t g_low_voltage_counter    = 0;
uint32_t g_recovery_counter       = 0;
bool     g_power_save_mode        = false;
bool     g_sd_available           = false;
bool     g_sd_fault               = false;
uint32_t g_sd_remount_attempts    = 0;
uint32_t g_sd_remount_success     = 0;
uint32_t g_last_sd_remount_try_ms = 0;

// Task handles
TaskHandle_t g_sensorTaskHandle  = NULL;
TaskHandle_t g_uploadTaskHandle  = NULL;

// MOSFET dongle power state
volatile bool g_dongle_on = false;
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

// ── LiFePO4 SoC Estimation (12.8V 4-cell) ──────────────────────────────────
float socByVoltage(float v) {
  if (v >= 13.40f) return 100.0f;
  if (v >= 13.30f) return 90.0f + (v - 13.30f) * 100.0f;
  if (v >= 13.25f) return 70.0f + (v - 13.25f) * 400.0f;
  if (v >= 13.20f) return 40.0f + (v - 13.20f) * 600.0f;
  if (v >= 13.10f) return 30.0f + (v - 13.10f) * 100.0f;
  if (v >= 13.00f) return 20.0f + (v - 13.00f) * 100.0f;
  if (v >= 12.80f) return 10.0f + (v - 12.80f) * 50.0f;
  if (v >= 11.00f) return 0.0f  + (v - 11.00f) * 5.5f;
  return 0.0f;
}

// ── RTC Sync with NTP ─────────────────────────────────────────────────────────
bool syncRTCWithNTP() {
  if (WiFi.status() != WL_CONNECTED) return false;
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER, "time.google.com", "time.nist.gov");
  struct tm timeinfo;
  bool synced = false;
  for (int i = 0; i < 60; i++) {
    if (getLocalTime(&timeinfo)) {
      synced = true;
      break;
    }
    vTaskDelay(pdMS_TO_TICKS(500));
    if (i % 10 == 0) Serial.print(".");
  }
  if (synced) {
    uint32_t rtc_before = rtc.now().unixtime();
    rtc.adjust(DateTime(timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
                        timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec));
    uint32_t ntp_now = rtc.now().unixtime();
    g_ntp_drift_s = (int32_t)ntp_now - (int32_t)rtc_before;
    // During first boot or large drift, don't clamp drift to 0 so we can see it in metrics
    // if (abs(g_ntp_drift_s) > 3600) g_ntp_drift_s = 0; 
    g_last_ntp_sync_ms = millis();
    g_ntp_backoff_ms = NTP_BACKOFF_MIN_MS;
    Serial.printf("[RTC] Synced. Drift: %ld s\n", (long)g_ntp_drift_s);
    return true;
  } else {
    g_ntp_backoff_ms = min(g_ntp_backoff_ms * 2U, NTP_BACKOFF_MAX_MS);
    Serial.println("[RTC] NTP Sync Failed.");
    return false;
  }
}

bool shouldAttemptNtpSync(uint32_t nowMs) {
  if (g_last_ntp_sync_ms != 0 && (uint32_t)(nowMs - g_last_ntp_sync_ms) < NTP_SYNC_INTERVAL_MS) {
    return false;
  }
  return (uint32_t)(nowMs - g_last_ntp_attempt_ms) >= g_ntp_backoff_ms;
}

// ── Persistent Energy State ───────────────────────────────────────────────────
void saveEnergyState() {
  prefs.begin("soak", false);
  prefs.putFloat("used_ah", g_batt_used_Ah);
  prefs.putFloat("total_wh", g_batt_total_energy_Wh);
  prefs.putFloat("sol_wh", g_solar_total_energy_Wh);
  prefs.end();
  // Serial.println("[NVS] Energy state saved.");
}

uint32_t packetHash32(const WeatherPacketFull& p) {
  const uint8_t* data = (const uint8_t*)&p;
  uint32_t hash = 2166136261UL;
  for (size_t i = 0; i < sizeof(WeatherPacketFull); i++) {
    hash ^= data[i];
    hash *= 16777619UL;
  }
  return hash;
}

String makeReadingDocId(const WeatherPacketFull& p) {
  uint32_t h = packetHash32(p);
  char buf[96];
  snprintf(buf, sizeof(buf), "%s_%lu_%08lx", STATION_ID, (unsigned long)p.ts, (unsigned long)h);
  return String(buf);
}

// ── Binary Pack Function ──────────────────────────────────────────────────────
void packReading(const SensorReading& r, WeatherPacketFull& p) {
  p.ts = (uint32_t)rtc.now().unixtime();
  p.temp_s10 = (int16_t)(r.temperature * 10);
  p.hum_s10 = (uint16_t)(r.humidity * 10);
  p.rain_s100 = (uint16_t)(r.rainfall_mm * 100);
  p.rain_1h_s100 = (uint16_t)(r.rainfall_1h_mm * 100);
  p.rain_raw = r.rain_raw;
  p.v_batt_s100 = (uint16_t)(r.batt_voltage * 100);
  p.i_batt_s1000 = (int16_t)(r.batt_current_A * 1000);
  p.p_batt_s100 = (uint16_t)(r.batt_power_W * 100);
  p.soc_pct = (uint8_t)r.batt_soc_pct;
  p.rem_ah_s1000 = (uint16_t)(r.batt_remaining_Ah * 1000);
  p.e_wh_s10 = (uint16_t)(r.batt_total_energy_Wh * 10);
  p.i_peak_s1000 = (int16_t)(r.batt_peak_current_A * 1000);
  p.v_min_s100 = (uint16_t)(r.batt_min_voltage * 100);
  p.v_sol_s100 = (uint16_t)(r.solar_voltage * 100);
  p.i_sol_s1000 = (uint16_t)(r.solar_current_A * 1000);
  p.p_sol_s100 = (uint16_t)(r.solar_power_W * 100);
  p.e_sol_wh_s10 = (uint16_t)(r.solar_energy_Wh * 10);
  p.i_sol_peak_s1000 = (uint16_t)(r.solar_peak_current_A * 1000);
  p.int_temp = (uint8_t)r.internal_temp_c;
  p.min_heap = r.min_heap;
  p.log_count = r.log_count;
  p.sd_free_mb = r.sd_free_mb;
  p.up_lat_ms = (uint16_t)r.upload_latency_ms;
  p.rssi = (int8_t)r.wifi_rssi;
  p.flags = (r.wifi_connected ? 0x01 : 0x00) | (r.has_crash_log ? 0x02 : 0x00);
  p.reconn_count = (uint16_t)r.wifi_reconnect_count;
  p.fail_streak = (uint16_t)r.consecutive_fail_streak;
  p.max_fail = (uint16_t)r.max_fail_streak;
  p.uptime_s = r.uptime_s;
  p.uptime_h_s10 = (uint16_t)(r.uptime_h * 10);
  p.free_heap = r.free_heap;
  p.heap_frag = (uint8_t)r.heap_frag_pct;
  p.sensor_stat = (strcmp(r.sensor_status, "OK") == 0) ? 1 : 0;
  p.reset_rc = (uint8_t)esp_reset_reason();
  p.boot_count = r.boot_count;
  p.send_success = r.send_success;
  p.send_fail = r.send_fail;
  p.sd_fail = (uint16_t)r.sd_fail;
  p.total_read = r.total_read_count;
  p.mod_err_s100 = (uint16_t)(r.modbus_error_rate_pct * 100);
  p.consec_mb_fail = (uint16_t)r.consec_modbus_fail;
  p.max_mb_fail = (uint16_t)r.max_modbus_fail_streak;
  p.mb_latency = (uint16_t)r.sensor_read_latency_ms;
  p.wifi_off_total = r.wifi_offline_total_s;
  p.long_off_streak = r.longest_offline_streak_s;
  p.dongle_pc = (uint16_t)r.dongle_power_cycles;
  p.pending_rows = (uint16_t)r.pending_row_count;
  p.avg_ul_lat = (uint16_t)r.avg_upload_latency_ms;
  p.sd_w_lat = (uint16_t)r.sd_write_latency_ms;
  p.s_stack_hwm = (uint16_t)r.sensor_stack_hwm;
  p.u_stack_hwm = (uint16_t)r.upload_stack_hwm;
  p.sd_used_mb = r.sd_used_mb;
  p.loop_jitter = (uint16_t)r.loop_jitter_max_ms;
  p.brownouts = (uint16_t)r.brownout_count;
  p.i2c_errs = (uint16_t)r.i2c_error_count;
  p.sd_max_lat = (uint16_t)r.sd_max_write_latency_ms;
  p.batt_ir_s10 = (uint16_t)(r.batt_internal_resistance * 10);
  p.mt_count = (uint16_t)r.modbus_timeout_count;
  p.mc_count = (uint16_t)r.modbus_crc_error_count;
  p.h2xx = (uint16_t)r.http_2xx_count;
  p.h4xx = (uint16_t)r.http_4xx_count;
  p.h5xx = (uint16_t)r.http_5xx_count;
  p.last_http = (int16_t)r.last_http_code;
  p.hte_count = (uint16_t)r.http_transport_error_count;
  p.sd_flags = (r.sd_available ? 0x01 : 0x00) | (r.sd_fault ? 0x02 : 0x00);
  p.sd_remount_try = (uint16_t)r.sd_remount_attempts;
  p.sd_remount_ok = (uint16_t)r.sd_remount_success;
  p.net_kbps_s10 = (uint16_t)(r.net_throughput_kbps * 10);
  p.ntp_drift = r.ntp_drift_s;
  p.ntp_backoff_s = (uint16_t)(r.ntp_backoff_ms / 1000UL);
  p.up_interval = (uint16_t)r.current_upload_interval_s;
}

// ── RTC Timestamp ─────────────────────────────────────────────────────────────
void rtcNow(char* buf, size_t len) {
  DateTime n = rtc.now();
  snprintf(buf, len, "%04d-%02d-%02d %02d:%02d:%02d",
           n.year(), n.month(), n.day(),
           n.hour(), n.minute(), n.second());
}

// ── Manual RTC Update ─────────────────────────────────────────────────────────
// ── Non-blocking Serial RTC Update ───────────────────────────────────────────
void checkSerialRTCUpdate() {
  static String serialBuffer = "";
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      serialBuffer.trim();
      if (serialBuffer.length() == 19) {
        rtc.adjust(DateTime(
          serialBuffer.substring(0, 4).toInt(), serialBuffer.substring(5, 7).toInt(), serialBuffer.substring(8, 10).toInt(),
          serialBuffer.substring(11, 13).toInt(), serialBuffer.substring(14, 16).toInt(), serialBuffer.substring(17, 19).toInt()
        ));
        Serial.println("[RTC] Manual update OK.");
      }
      serialBuffer = "";
    } else {
      serialBuffer += c;
      if (serialBuffer.length() > 32) serialBuffer = ""; // Overflow protection
    }
  }
}


// =============================================================================
//  WIFI MOSFET HELPERS
// =============================================================================

inline void wifiDongleOn() {
  if (xSemaphoreTake(g_i2c_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
    g_v_pre_load = ina219_batt.getBusVoltage_V();
    xSemaphoreGive(g_i2c_mutex);
  }
  digitalWrite(WIFI_POWER_PIN, HIGH);
  g_dongle_on = true;
  g_radio_start_ms = millis();
  g_capture_ir = true;
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
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  delay(300);
  WiFi.mode(WIFI_STA);
  delay(100);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > WIFI_TIMEOUT_MS) {
      Serial.println("\n[WiFi] Timeout — retrying reset...");
      WiFi.disconnect(true); delay(500);
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      start = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_TIMEOUT_MS) {
        delay(500); Serial.print("!");
      }
      if (WiFi.status() != WL_CONNECTED) return false;
      break;
    }
    delay(500); Serial.print(".");
  }
  g_wifi_reconnect_count++;
  Serial.printf("\n[WiFi] Connected! IP: %s RSSI: %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  return true;
}


// =============================================================================
//  FIREBASE (Firestore REST API)
// =============================================================================

String firestoreUrl(const char* collection, const char* docId) {
  return String(FIRESTORE_BASE) + "/" + collection + "/" + docId + "?key=" + FIREBASE_API_KEY;
}

bool uploadPacket(const WeatherPacketFull& p, const char* collection, const char* docId) {
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  http.begin(client, firestoreUrl(collection, docId));
  http.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  JsonObject fields = doc["fields"].to<JsonObject>();
  auto fsVal = [&](const char* k, auto v, const char* type) {
    if (strcmp(type, "double") == 0) fields[k]["doubleValue"] = v;
    else if (strcmp(type, "int") == 0) fields[k]["integerValue"] = String(v);
  };
  fsVal("ts", p.ts, "int");
  fsVal("t", p.temp_s10 / 10.0, "double");
  fsVal("h", p.hum_s10 / 10.0, "double");
  fsVal("bv", p.v_batt_s100 / 100.0, "double");
  fsVal("bi", p.i_batt_s1000 / 1000.0, "double");
  fsVal("soc", p.soc_pct, "int");
  fsVal("ir", p.batt_ir_s10 / 10.0, "double");

  String payload;
  payload.reserve(768);
  serializeJson(doc, payload);
  int code = http.PATCH(payload);
  g_last_http_code = code;
  http.end();
  if (code >= 200 && code < 300) {
    g_http_2xx_count++; g_send_success++;
    g_total_bytes_sent += payload.length();
    return true;
  }
  if (code >= 400 && code < 500) g_http_4xx_count++;
  else if (code >= 500 && code < 600) g_http_5xx_count++;
  else g_http_transport_error_count++;
  g_send_fail++;
  return false;
}

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
  };
  fsVal("station_id", STATION_ID, "str");
  fsVal("timestamp", r.timestamp, "str");
  fsVal("uptime_h", r.uptime_h, "double");
  fsVal("batt_voltage", r.batt_voltage, "double");
  fsVal("http_2xx", g_http_2xx_count, "int");
  fsVal("http_4xx", g_http_4xx_count, "int");
  fsVal("http_5xx", g_http_5xx_count, "int");
  fsVal("http_transport", g_http_transport_error_count, "int");
  fsVal("last_http", g_last_http_code, "int");
  fsVal("pending_rows", g_pending_row_count, "int");
  fsVal("sd_fault", g_sd_fault ? 1 : 0, "int");
  fsVal("sd_ok", g_sd_available ? 1 : 0, "int");
  fsVal("sd_remount_attempts", g_sd_remount_attempts, "int");
  fsVal("sd_remount_success", g_sd_remount_success, "int");
  fsVal("ntp_backoff_s", g_ntp_backoff_ms / 1000UL, "int");

  String payload;
  payload.reserve(1024);
  serializeJson(doc, payload);
  int code = http.PATCH(payload);
  g_last_http_code = code;
  http.end();
  if (code >= 200 && code < 300) {
    g_http_2xx_count++;
    g_total_bytes_sent += payload.length();
    Serial.printf("[Heartbeat] OK (%d)\n", code);
  } else {
    if (code >= 400 && code < 500) g_http_4xx_count++;
    else if (code >= 500 && code < 600) g_http_5xx_count++;
    else g_http_transport_error_count++;
    Serial.printf("[Heartbeat] FAIL (%d)\n", code);
  }
}


// =============================================================================
//  SD CARD LOGGING
// =============================================================================

void sdWriteHeader(const char* path) {
  if (SD.exists(path)) return;
  File f = SD.open(path, FILE_WRITE);
  if (!f) return;
  f.println("timestamp,temperature,humidity,rainfall_mm,rainfall_1h_mm,rain_raw,"
            "batt_voltage,batt_current_A,batt_soc_pct,batt_total_energy_Wh,batt_peak_current_A,"
            "v_min,solar_voltage,solar_current_A,int_temp,min_heap,log_count,sd_free,"
            "up_lat,rssi,reconnects,fail_streak,max_fail,latency,uptime,wifi_offline,ir");
  f.close();
}

void markSdFault(const char* reason) {
  g_sd_fault = true;
  g_sd_available = false;
  Serial.printf("[SD] Fault: %s\n", reason);
}

bool ensureSdAvailable() {
  if (g_sd_available) return true;
  uint32_t now = millis();
  if ((uint32_t)(now - g_last_sd_remount_try_ms) < SD_REMOUNT_INTERVAL_MS) return false;

  g_last_sd_remount_try_ms = now;
  g_sd_remount_attempts++;
  if (SD.begin(SD_CS)) {
    g_sd_available = true;
    g_sd_fault = false;
    g_sd_remount_success++;
    sdWriteHeader(LOG_FILE);
    sdWriteHeader(PENDING_FILE);
    Serial.println("[SD] Remount OK.");
    return true;
  }

  markSdFault("remount failed");
  return false;
}

bool sdAppendRow(const char* path, const SensorReading& r) {
  if (!ensureSdAvailable()) { g_sd_fail++; return false; }
  unsigned long t0 = millis();
  File f = SD.open(path, FILE_APPEND);
  if (!f) { g_sd_fail++; markSdFault("open append csv failed"); return false; }
  f.printf("%s,%.2f,%.2f,%.2f,%.2f,%lu,%.2f,%.3f,%.1f,%.3f,%.3f,%.2f,%.2f,%.3f,%lu,%lu,%lu,%lu,%lu,%d,%lu,%lu,%lu,%lu,%lu,%lu,%.2f\n",
    r.timestamp, r.temperature, r.humidity, r.rainfall_mm, r.rainfall_1h_mm, (unsigned long)r.rain_raw,
    r.batt_voltage, r.batt_current_A, r.batt_soc_pct, r.batt_total_energy_Wh, r.batt_peak_current_A,
    r.batt_min_voltage, r.solar_voltage, r.solar_current_A, (unsigned long)r.internal_temp_c, (unsigned long)r.min_heap, (unsigned long)r.log_count,
    (unsigned long)r.sd_free_mb, (unsigned long)r.upload_latency_ms, r.wifi_rssi, (unsigned long)r.wifi_reconnect_count,
    (unsigned long)r.consecutive_fail_streak, (unsigned long)r.max_fail_streak, (unsigned long)r.sensor_read_latency_ms,
    (unsigned long)r.uptime_s, (unsigned long)r.wifi_offline_total_s, r.batt_internal_resistance);
  f.close();
  uint32_t lat = millis() - t0;
  g_sd_write_latency_ms = lat;
  if (lat > g_sd_max_write_latency_ms) g_sd_max_write_latency_ms = lat;
  return true;
}

bool sdAppendBinaryRow(const char* path, const WeatherPacketFull& p) {
  if (!ensureSdAvailable()) { g_sd_fail++; return false; }
  unsigned long t0 = millis();
  File f = SD.open(path, FILE_APPEND);
  if (!f) { g_sd_fail++; markSdFault("open append bin failed"); return false; }
  size_t written = f.write((const uint8_t*)&p, sizeof(p));
  f.close();
  uint32_t lat = millis() - t0;
  g_sd_write_latency_ms = lat;
  if (lat > g_sd_max_write_latency_ms) g_sd_max_write_latency_ms = lat;
  if (written != sizeof(p)) {
    g_sd_fail++;
    markSdFault("partial binary write");
    return false;
  }
  return true;
}

void flushPending() {
  if (!ensureSdAvailable()) return;
  if (!SD.exists(PENDING_BIN)) {
    g_pending_row_count = 0;
    return;
  }

  const char* TMP_PENDING_BIN = "/pending_tmp.bin";
  SD.remove(TMP_PENDING_BIN);

  File f = SD.open(PENDING_BIN, FILE_READ);
  if (!f) { markSdFault("open pending read failed"); return; }
  File remaining = SD.open(TMP_PENDING_BIN, FILE_WRITE);
  if (!remaining) {
    f.close();
    markSdFault("open pending tmp failed");
    return;
  }

  Serial.printf("[Pending] Flushing %s\n", PENDING_BIN);
  int uploaded = 0, failed = 0;
  while (f.available() >= sizeof(WeatherPacketFull)) {
    WeatherPacketFull p;
    size_t n = f.read((uint8_t*)&p, sizeof(p));
    if (n != sizeof(p)) {
      failed++;
      break;
    }
    String docId = makeReadingDocId(p);
    if (uploadPacket(p, "readings", docId.c_str())) {
      uploaded++;
    } else {
      size_t wn = remaining.write((const uint8_t*)&p, sizeof(p));
      if (wn != sizeof(p)) {
        g_sd_fail++;
        markSdFault("pending compact write failed");
        failed++;
        break;
      }
      failed++;
    }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
  f.close();
  remaining.close();

  const char* OLD_PENDING_BIN = "/pending_old.bin";
  SD.remove(OLD_PENDING_BIN);
  if (failed == 0) {
    SD.remove(PENDING_BIN);
    SD.remove(TMP_PENDING_BIN);
  } else {
    if (!SD.rename(PENDING_BIN, OLD_PENDING_BIN)) {
      markSdFault("pending backup rename failed");
    }
    if (!SD.rename(TMP_PENDING_BIN, PENDING_BIN)) {
      if (SD.exists(OLD_PENDING_BIN)) SD.rename(OLD_PENDING_BIN, PENDING_BIN);
      markSdFault("pending rename failed");
    } else {
      SD.remove(OLD_PENDING_BIN);
    }
  }

  g_pending_row_count = failed;
  Serial.printf("[Pending] Uploaded=%d Remaining=%d\n", uploaded, failed);
}

uint32_t countFileRows(const char* path) {
  if (!SD.exists(path)) return 0;
  File f = SD.open(path, FILE_READ);
  if (!f) return 0;
  uint32_t count = 0;
  bool firstLine = true;
  while (f.available()) {
    if (f.read() == '\n') {
      if (firstLine) firstLine = false; else count++;
    }
  }
  f.close();
  return count;
}


// =============================================================================
//  FREERTOS TASKS
// =============================================================================

void sensorTask(void* pvParams) {
  uint32_t lastRun = millis();
  while (true) {
    uint32_t nowMs = millis();
    uint32_t jitter = (nowMs - lastRun > 1000) ? (nowMs - lastRun - 1000) : 0;
    if (jitter > g_loop_jitter_max_ms) g_loop_jitter_max_ms = jitter;
    lastRun = nowMs;
    checkSerialRTCUpdate();

    if (xSemaphoreTake(g_i2c_mutex, pdMS_TO_TICKS(800)) == pdTRUE) {
      g_total_read_count++;
      float temperature = 0.0, humidity = 0.0;
      uint8_t result = 0;
      for (int retry = 0; retry < 3; retry++) {
        unsigned long mb_t0 = millis();
        result = node.readHoldingRegisters(0x0000, 2);
        g_reading.sensor_read_latency_ms = (uint32_t)(millis() - mb_t0);
        if (result == node.ku8MBSuccess) {
          humidity = node.getResponseBuffer(0) / 10.0f;
          temperature = node.getResponseBuffer(1) / 10.0f;
          g_consec_modbus_fail = 0;
          strncpy(g_reading.sensor_status, "OK", sizeof(g_reading.sensor_status));
          break;
        } else {
          g_sensor_fail++; g_consec_modbus_fail++;
          if (result == node.ku8MBResponseTimedOut) g_modbus_timeout_count++;
          else if (result == node.ku8MBInvalidCRC) g_modbus_crc_error_count++;
          strncpy(g_reading.sensor_status, "ERROR", sizeof(g_reading.sensor_status));
          if (retry < 2) vTaskDelay(pdMS_TO_TICKS(100)); // Short wait before retry
        }
      }
      
      float voltage = ina219_batt.getBusVoltage_V();
      float current_A = ina219_batt.getCurrent_mA() / 1000.0f;
      float sol_voltage = ina219_solar.getBusVoltage_V();
      float sol_current_A = ina219_solar.getCurrent_mA() / 1000.0f;

      if (g_capture_ir && current_A > 0.1f) {
        float dv = g_v_pre_load - voltage;
        if (dv > 0) g_batt_internal_resistance = (dv / current_A) * 1000.0f;
        g_capture_ir = false;
      }
      xSemaphoreGive(g_i2c_mutex);

      g_batt_used_Ah += abs(current_A) * (SENSOR_INTERVAL_MS / 3600000.0f);
      g_batt_total_energy_Wh += (voltage * abs(current_A)) * (SENSOR_INTERVAL_MS / 3600000.0f);
      g_solar_total_energy_Wh += (sol_voltage * abs(sol_current_A)) * (SENSOR_INTERVAL_MS / 3600000.0f);
      float soc = constrain((1.0f - (g_batt_used_Ah / CAPACITY_AH)) * 100.0f, 0.0f, 100.0f);
      if (voltage < g_batt_min_voltage) g_batt_min_voltage = voltage;

      static uint32_t lastEnergySaveMs = 0;
      if (millis() - lastEnergySaveMs >= (300 * 1000)) { // Every 5 minutes
        saveEnergyState();
        lastEnergySaveMs = millis();
      }

      char ts[20]; rtcNow(ts, sizeof(ts));
      if (xSemaphoreTake(g_mutex, pdMS_TO_TICKS(500)) == pdTRUE) {
        strncpy(g_reading.timestamp, ts, sizeof(g_reading.timestamp));
        g_reading.timestamp[sizeof(g_reading.timestamp)-1] = '\0';
        g_reading.temperature = temperature; g_reading.humidity = humidity;
        g_reading.rainfall_mm = RainSensor.getRainfall();
        g_reading.rainfall_1h_mm = RainSensor.getRainfall(1);
        g_reading.rain_raw = RainSensor.getRawData();
        g_reading.batt_voltage = voltage; g_reading.batt_current_A = current_A;
        g_reading.batt_soc_pct = soc; g_reading.solar_voltage = sol_voltage;
        g_reading.solar_current_A = sol_current_A; 
        g_reading.batt_total_energy_Wh = g_batt_total_energy_Wh;
        g_reading.solar_energy_Wh = g_solar_total_energy_Wh;
        g_reading.internal_temp_c = (uint32_t)temperatureRead();
        g_reading.min_heap = ESP.getMinFreeHeap(); g_reading.uptime_s = millis()/1000;
        g_reading.uptime_h = g_reading.uptime_s/3600.0f;
        g_reading.batt_internal_resistance = g_batt_internal_resistance;
        g_reading.loop_jitter_max_ms = g_loop_jitter_max_ms;
        g_reading.pending_row_count = g_pending_row_count;
        g_reading.sd_write_latency_ms = g_sd_write_latency_ms;
        g_reading.sd_max_write_latency_ms = g_sd_max_write_latency_ms;
        g_reading.http_2xx_count = g_http_2xx_count;
        g_reading.http_4xx_count = g_http_4xx_count;
        g_reading.http_5xx_count = g_http_5xx_count;
        g_reading.last_http_code = g_last_http_code;
        g_reading.http_transport_error_count = g_http_transport_error_count;
        g_reading.send_success = g_send_success;
        g_reading.send_fail = g_send_fail;
        g_reading.sd_fail = g_sd_fail;
        g_reading.sd_available = g_sd_available;
        g_reading.sd_fault = g_sd_fault;
        g_reading.sd_remount_attempts = g_sd_remount_attempts;
        g_reading.sd_remount_success = g_sd_remount_success;
        g_reading.ntp_backoff_ms = g_ntp_backoff_ms;
        g_reading.ntp_drift_s = g_ntp_drift_s;
        g_reading.current_upload_interval_s = g_current_upload_interval_s;
        strncpy(g_reading.reset_reason, g_reset_reason.c_str(), sizeof(g_reading.reset_reason));
        g_reading.reset_reason[sizeof(g_reading.reset_reason)-1] = '\0';
        xSemaphoreGive(g_mutex);
      }
    }

    static uint32_t lastLogMs = 0;
    if (millis() - lastLogMs >= (LOG_INTERVAL_S * 1000)) {
      SensorReading snap;
      if (xSemaphoreTake(g_mutex, pdMS_TO_TICKS(300)) == pdTRUE) { snap = g_reading; xSemaphoreGive(g_mutex); }
      bool csvOk = sdAppendRow(LOG_FILE, snap);
      WeatherPacketFull p; packReading(snap, p);
      bool binOk = sdAppendBinaryRow(LOG_BIN_FILE, p);
      if (!csvOk || !binOk) {
        markSdFault("periodic log write failed");
      }
      lastLogMs = millis(); g_log_count++;
    }

    vTaskDelay(pdMS_TO_TICKS(SENSOR_INTERVAL_MS));
  }
}

void uploadTask(void* pvParams) {
  uint32_t lastUploadMs = 0;
  vTaskDelay(pdMS_TO_TICKS(5000));
  while (true) {
    SensorReading snap;
    bool hasSnap = false;
    if (xSemaphoreTake(g_mutex, pdMS_TO_TICKS(300)) == pdTRUE) {
      snap = g_reading;
      xSemaphoreGive(g_mutex);
      hasSnap = true;
    }
    float voltage = hasSnap ? snap.batt_voltage : 0.0f;

    ensureSdAvailable();

    if (g_dongle_on) {
      if (voltage < LOW_V_THRESHOLD && voltage > 1.0f) {
        if (++g_low_voltage_counter >= LOW_V_COUNT_LIMIT) { wifiDongleOff(); g_low_voltage_counter = 0; g_power_save_mode = true; }
      } else g_low_voltage_counter = 0;
    } else {
      if (voltage >= RECOVERY_V_THRESHOLD) {
        if (++g_recovery_counter >= RECOVERY_COUNT_LIMIT) { wifiDongleOn(); g_recovery_counter = 0; g_power_save_mode = false; }
      } else g_recovery_counter = 0;
    }

    uint32_t now = millis();
    if (g_dongle_on && (now - lastUploadMs >= (g_current_upload_interval_s * 1000))) {
      if (connectWiFi()) {
        if (shouldAttemptNtpSync(now)) {
          g_last_ntp_attempt_ms = now;
          syncRTCWithNTP();
        }
        flushPending();
        if (xSemaphoreTake(g_mutex, pdMS_TO_TICKS(300)) == pdTRUE) { snap = g_reading; xSemaphoreGive(g_mutex); }
        snap.wifi_rssi = WiFi.RSSI(); snap.wifi_connected = true;
        if (!uploadReading(snap)) { // We still use uploadReading for live data or uploadPacket
          WeatherPacketFull p; packReading(snap, p);
          if (!sdAppendBinaryRow(PENDING_BIN, p)) {
            markSdFault("failed to queue pending row");
          } else {
            g_pending_row_count++;
          }
        }
        lastUploadMs = now;
      }
    }
    // Only throttle if voltage is in the "low but valid" range (1.0V to 11.6V).
    // If it's 0V, we assume a sensor error and don't throttle upload diagnostics.
    g_current_upload_interval_s = (voltage < 11.6f && voltage > 1.0f) ? UPLOAD_INTERVAL_S * 5 : UPLOAD_INTERVAL_S;
    vTaskDelay(pdMS_TO_TICKS(5000));
  }
}

// Wrapper for live upload
bool uploadReading(const SensorReading& r) {
  WeatherPacketFull p; packReading(r, p);
  String docId = makeReadingDocId(p);
  return uploadPacket(p, "readings", docId.c_str());
}

void heartbeatTask(void* pvParams) {
  vTaskDelay(pdMS_TO_TICKS(15000));
  while (true) {
    if (g_dongle_on && WiFi.status() == WL_CONNECTED) {
      SensorReading snap;
      if (xSemaphoreTake(g_mutex, pdMS_TO_TICKS(300)) == pdTRUE) { snap = g_reading; xSemaphoreGive(g_mutex); }
      uploadHeartbeat(snap);
    }
    vTaskDelay(pdMS_TO_TICKS(HEARTBEAT_INTERVAL_S * 1000));
  }
}


void setup() {
  g_mutex = xSemaphoreCreateMutex();
  g_i2c_mutex = xSemaphoreCreateMutex();
  pinMode(WIFI_POWER_PIN, OUTPUT);
  digitalWrite(WIFI_POWER_PIN, HIGH);
  g_dongle_on = true;

  Serial.begin(115200); delay(300);
  Serial.println("\n=== Sipat Banwa — Reliability Test Firmware ===");

  g_reset_reason = resetReasonString();
  prefs.begin("soak", false);
  g_boot_count = prefs.getUInt("boot_count", 0) + 1;
  prefs.putUInt("boot_count", g_boot_count);
  g_brownout_count = prefs.getUInt("brown_count", 0);
  if (esp_reset_reason() == ESP_RST_BROWNOUT) { g_brownout_count++; prefs.putUInt("brown_count", g_brownout_count); }
  prefs.end();

  Wire.begin(21, 22);
  if (rtc.begin()) {
    if (rtc.lostPower()) Serial.println("[RTC] Lost power!");
  } else {
    Serial.println("[RTC] FAILED to initialize!");
  }

  if (ina219_batt.begin()) {
    ina219_batt.setCalibration_32V_2A();
  } else {
    Serial.println("[INA219] Battery sensor FAILED!");
  }

  if (ina219_solar.begin()) {
    ina219_solar.setCalibration_32V_2A();
  } else {
    Serial.println("[INA219] Solar sensor FAILED!");
  }

  prefs.begin("soak", false);
  g_batt_used_Ah = prefs.getFloat("used_ah", -1.0f);
  g_batt_total_energy_Wh = prefs.getFloat("total_wh", 0.0f);
  g_solar_total_energy_Wh = prefs.getFloat("sol_wh", 0.0f);
  
  if (g_batt_used_Ah < 0) {
    float v = ina219_batt.getBusVoltage_V();
    if (v < 5.0f) v = 13.1f;
    g_batt_used_Ah = CAPACITY_AH * (1.0f - (socByVoltage(v) / 100.0f));
  }
  prefs.end();

  Serial1.begin(9600, SERIAL_8N1, RS485_RX, RS485_TX);
  node.begin(1, Serial1);

  SPI.begin(18, 19, 23, SD_CS);
  g_sd_available = SD.begin(SD_CS);
  if (g_sd_available) {
    sdWriteHeader(LOG_FILE);
    sdWriteHeader(PENDING_FILE);
    if (SD.exists(PENDING_BIN)) {
      File pf = SD.open(PENDING_BIN, FILE_READ);
      if (pf) {
        g_pending_row_count = pf.size() / sizeof(WeatherPacketFull);
        pf.close();
      }
    }
  } else {
    markSdFault("initial mount failed");
  }

  RainSerial.begin(9600, SERIAL_8N1, RAIN_RX, RAIN_TX);
  RainSensor.begin();

  connectWiFi();
  g_last_ntp_attempt_ms = millis();
  syncRTCWithNTP();

  xTaskCreatePinnedToCore(sensorTask, "SensorTask", 8192, NULL, 3, &g_sensorTaskHandle, 1);
  xTaskCreatePinnedToCore(uploadTask, "UploadTask", 16384, NULL, 2, &g_uploadTaskHandle, 0);
  xTaskCreatePinnedToCore(heartbeatTask, "HeartbeatTask", 8192, NULL, 1, NULL, 0);
}

void loop() { vTaskDelay(pdMS_TO_TICKS(10000)); }
