/*
 * Project Sipat Banwa: Full 67-Metric Compression Benchmark
 * Corrected version: No field omissions, no 32-bit overflows.
 */

#include <ArduinoJson.h>
#include <SD.h>
#include <SPI.h>

#define SD_CS 5

// ── Full SensorReading (to match reliability_test.ino) ────────────────────────
struct SensorReading {
  uint32_t  unix_time;
  float     temperature;
  float     humidity;
  float     rainfall_mm;
  float     rainfall_1h_mm;
  uint32_t  rain_raw;
  float     batt_voltage;
  float     batt_current_A;
  float     batt_power_W;
  float     batt_soc_pct;
  float     batt_remaining_Ah;
  float     batt_total_energy_Wh;
  float     batt_peak_current_A;
  float     batt_min_voltage;
  float     solar_voltage;
  float     solar_current_A;
  float     solar_power_W;
  float     solar_energy_Wh;
  float     solar_peak_current_A;
  uint32_t  internal_temp_c;
  uint32_t  min_heap;
  uint32_t  log_count;
  uint32_t  sd_free_mb;
  uint32_t  upload_latency_ms;
  int       wifi_rssi;
  bool      wifi_connected;
  uint32_t  wifi_reconnect_count;
  uint32_t  consecutive_fail_streak;
  uint32_t  max_fail_streak;
  uint32_t  uptime_s;
  float     uptime_h;
  uint32_t  free_heap;
  float     heap_frag_pct;
  uint8_t   sensor_status_code;
  uint8_t   reset_reason_code;
  uint32_t  boot_count;
  uint32_t  send_success;
  uint32_t  send_fail;
  uint32_t  sd_fail;
  uint32_t  total_read_count;
  float     modbus_error_rate_pct;
  uint32_t  consec_modbus_fail;
  uint32_t  max_modbus_fail_streak;
  uint32_t  sensor_read_latency_ms;
  uint32_t  wifi_offline_total_s;
  uint32_t  longest_offline_streak_s;
  uint32_t  dongle_power_cycles;
  uint32_t  pending_row_count;
  uint32_t  avg_upload_latency_ms;
  uint32_t  sd_write_latency_ms;
  uint32_t  sensor_stack_hwm;
  uint32_t  upload_stack_hwm;
  uint32_t  sd_used_mb;
  uint32_t  loop_jitter_max_ms;
  uint32_t  brownout_count;
  bool      has_crash_log;
  uint32_t  i2c_error_count;
  uint32_t  sd_max_write_latency_ms;
  float     batt_internal_resistance;
  uint32_t  modbus_timeout_count;
  uint32_t  modbus_crc_error_count;
  uint32_t  http_2xx_count;
  uint32_t  http_4xx_count;
  uint32_t  http_5xx_count;
  float     net_throughput_kbps;
  int32_t   ntp_drift_s;
  uint32_t  current_upload_interval_s;
};

// ── Binary Packet (Packed, No Padding) ───────────────────────────────────────
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
  uint32_t  sd_free_mb;        // 4 (Expanded from 16-bit to avoid 64GB limit)
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
  uint16_t  net_kbps_s10;      // 2
  int32_t   ntp_drift;         // 4
  uint16_t  up_interval;       // 2
}; // Binary size should now be slightly larger (~140-150 bytes) but still small.

void fillMock(SensorReading &r) {
  r.unix_time = 1710720000;
  r.temperature = 29.45; r.humidity = 78.2;
  r.rainfall_mm = 12.5; r.rainfall_1h_mm = 2.4; r.rain_raw = 450;
  r.batt_voltage = 13.25; r.batt_current_A = 0.450; r.batt_power_W = 5.96;
  r.batt_soc_pct = 85.5; r.batt_remaining_Ah = 25.65;
  r.batt_total_energy_Wh = 145.2; r.batt_peak_current_A = 1.250; r.batt_min_voltage = 12.1;
  r.solar_voltage = 18.5; r.solar_current_A = 2.1; r.solar_power_W = 38.8;
  r.solar_energy_Wh = 245.5; r.solar_peak_current_A = 3.5;
  r.internal_temp_c = 42; r.min_heap = 180000; r.log_count = 12500;
  r.sd_free_mb = 14500; r.upload_latency_ms = 450;
  r.wifi_rssi = -65; r.wifi_connected = true; r.wifi_reconnect_count = 5;
  r.consecutive_fail_streak = 0; r.max_fail_streak = 3;
  r.uptime_s = 86400; r.uptime_h = 24.0; r.free_heap = 195000; r.heap_frag_pct = 5.2;
  r.sensor_status_code = 1; r.reset_reason_code = 2;
  r.boot_count = 12; r.send_success = 1200; r.send_fail = 15; r.sd_fail = 0;
  r.total_read_count = 86400; r.modbus_error_rate_pct = 0.05;
  r.consec_modbus_fail = 0; r.max_modbus_fail_streak = 2; r.sensor_read_latency_ms = 45;
  r.wifi_offline_total_s = 120; r.longest_offline_streak_s = 45; r.dongle_power_cycles = 14;
  r.pending_row_count = 0; r.avg_upload_latency_ms = 445; r.sd_write_latency_ms = 12;
  r.sensor_stack_hwm = 2048; r.upload_stack_hwm = 1024; r.sd_used_mb = 500;
  r.loop_jitter_max_ms = 85; r.brownout_count = 1; r.has_crash_log = false;
  r.i2c_error_count = 5; r.sd_max_write_latency_ms = 150;
  r.batt_internal_resistance = 120.5; r.modbus_timeout_count = 2; r.modbus_crc_error_count = 1;
  r.http_2xx_count = 1200; r.http_4xx_count = 10; r.http_5xx_count = 5;
  r.net_throughput_kbps = 45.5; r.ntp_drift_s = -2; r.current_upload_interval_s = 60;
}

void pack(const SensorReading &r, WeatherPacketFull &p) {
  p.ts = r.unix_time;
  p.temp_s10 = (int16_t)(r.temperature * 10); p.hum_s10 = (uint16_t)(r.humidity * 10);
  p.rain_s100 = (uint16_t)(r.rainfall_mm * 100); p.rain_1h_s100 = (uint16_t)(r.rainfall_1h_mm * 100);
  p.rain_raw = r.rain_raw; p.v_batt_s100 = (uint16_t)(r.batt_voltage * 100);
  p.i_batt_s1000 = (int16_t)(r.batt_current_A * 1000); p.p_batt_s100 = (uint16_t)(r.batt_power_W * 100);
  p.soc_pct = (uint8_t)r.batt_soc_pct; p.rem_ah_s1000 = (uint16_t)(r.batt_remaining_Ah * 1000);
  p.e_wh_s10 = (uint16_t)(r.batt_total_energy_Wh * 10); p.i_peak_s1000 = (int16_t)(r.batt_peak_current_A * 1000);
  p.v_min_s100 = (uint16_t)(r.batt_min_voltage * 100); p.v_sol_s100 = (uint16_t)(r.solar_voltage * 100);
  p.i_sol_s1000 = (uint16_t)(r.solar_current_A * 1000); p.p_sol_s100 = (uint16_t)(r.solar_power_W * 100);
  p.e_sol_wh_s10 = (uint16_t)(r.solar_energy_Wh * 10); p.i_sol_peak_s1000 = (uint16_t)(r.solar_peak_current_A * 1000);
  p.int_temp = (uint8_t)r.internal_temp_c; p.min_heap = r.min_heap; p.log_count = r.log_count;
  p.sd_free_mb = r.sd_free_mb; p.up_lat_ms = (uint16_t)r.upload_latency_ms; p.rssi = (int8_t)r.wifi_rssi;
  p.flags = (r.wifi_connected ? 0x01 : 0x00) | (r.has_crash_log ? 0x02 : 0x00);
  p.reconn_count = (uint16_t)r.wifi_reconnect_count; p.fail_streak = (uint16_t)r.consecutive_fail_streak;
  p.max_fail = (uint16_t)r.max_fail_streak; p.uptime_s = r.uptime_s; p.uptime_h_s10 = (uint16_t)(r.uptime_h * 10);
  p.free_heap = r.free_heap; p.heap_frag = (uint8_t)r.heap_frag_pct;
  p.sensor_stat = r.sensor_status_code; p.reset_rc = r.reset_reason_code; p.boot_count = r.boot_count;
  p.send_success = r.send_success; p.send_fail = r.send_fail; p.sd_fail = (uint16_t)r.sd_fail;
  p.total_read = r.total_read_count; p.mod_err_s100 = (uint16_t)(r.modbus_error_rate_pct * 100);
  p.consec_mb_fail = (uint16_t)r.consec_modbus_fail; p.max_mb_fail = (uint16_t)r.max_modbus_fail_streak;
  p.mb_latency = (uint16_t)r.sensor_read_latency_ms; p.wifi_off_total = r.wifi_offline_total_s;
  p.long_off_streak = r.longest_offline_streak_s; p.dongle_pc = (uint16_t)r.dongle_power_cycles;
  p.pending_rows = (uint16_t)r.pending_row_count; p.avg_ul_lat = (uint16_t)r.avg_upload_latency_ms;
  p.sd_w_lat = (uint16_t)r.sd_write_latency_ms; p.s_stack_hwm = (uint16_t)r.sensor_stack_hwm;
  p.u_stack_hwm = (uint16_t)r.upload_stack_hwm; p.sd_used_mb = r.sd_used_mb;
  p.loop_jitter = (uint16_t)r.loop_jitter_max_ms; p.brownouts = (uint16_t)r.brownout_count;
  p.i2c_errs = (uint16_t)r.i2c_error_count; p.sd_max_lat = (uint16_t)r.sd_max_write_latency_ms;
  p.batt_ir_s10 = (uint16_t)(r.batt_internal_resistance * 10); p.mt_count = (uint16_t)r.modbus_timeout_count;
  p.mc_count = (uint16_t)r.modbus_crc_error_count; p.h2xx = (uint16_t)r.http_2xx_count;
  p.h4xx = (uint16_t)r.http_4xx_count; p.h5xx = (uint16_t)r.http_5xx_count;
  p.net_kbps_s10 = (uint16_t)(r.net_throughput_kbps * 10); p.ntp_drift = r.ntp_drift_s;
  p.up_interval = (uint16_t)r.current_upload_interval_s;
}

void setup() {
  Serial.begin(115200);
  while(!Serial);
  Serial.println("\n--- Sipat Banwa: Comprehensive Benchmark (Phase 2) ---");

  SensorReading r;
  fillMock(r);

  // 1. JSON CPU Time (67 Fields)
  unsigned long t0 = micros();
  JsonDocument doc;
  doc["ts"] = r.unix_time;
  doc["t"] = r.temperature; doc["h"] = r.humidity; doc["rm"] = r.rainfall_mm; 
  doc["rh"] = r.rainfall_1h_mm; doc["rr"] = r.rain_raw; doc["bv"] = r.batt_voltage; 
  doc["bi"] = r.batt_current_A; doc["bp"] = r.batt_power_W; doc["bs"] = r.batt_soc_pct; 
  doc["ra"] = r.batt_remaining_Ah; doc["be"] = r.batt_total_energy_Wh; doc["bpk"] = r.batt_peak_current_A; 
  doc["bmv"] = r.batt_min_voltage; doc["sv"] = r.solar_voltage; doc["si"] = r.solar_current_A; 
  doc["sp"] = r.solar_power_W; doc["se"] = r.solar_energy_Wh; doc["spk"] = r.solar_peak_current_A; 
  doc["it"] = r.internal_temp_c; doc["mh"] = r.min_heap; doc["lc"] = r.log_count; 
  doc["sf"] = r.sd_free_mb; doc["ul"] = r.upload_latency_ms; doc["r"] = r.wifi_rssi; 
  doc["wc"] = r.wifi_connected; doc["wr"] = r.wifi_reconnect_count; doc["cs"] = r.consecutive_fail_streak; 
  doc["ms"] = r.max_fail_streak; doc["us"] = r.uptime_s; doc["uh"] = r.uptime_h; 
  doc["fh"] = r.free_heap; doc["hf"] = r.heap_frag_pct; doc["sc"] = r.sensor_status_code; 
  doc["rc"] = r.reset_reason_code; doc["bc"] = r.boot_count; doc["su"] = r.send_success; 
  doc["fa"] = r.send_fail; doc["sd"] = r.sd_fail; doc["tr"] = r.total_read_count; 
  doc["er"] = r.modbus_error_rate_pct; doc["cm"] = r.consec_modbus_fail; doc["mf"] = r.max_modbus_fail_streak; 
  doc["rl"] = r.sensor_read_latency_ms; doc["ot"] = r.wifi_offline_total_s; doc["ls"] = r.longest_offline_streak_s; 
  doc["dp"] = r.dongle_power_cycles; doc["pr"] = r.pending_row_count; doc["al"] = r.avg_upload_latency_ms; 
  doc["wl"] = r.sd_write_latency_ms; doc["sh"] = r.sensor_stack_hwm; doc["u_h"] = r.upload_stack_hwm; 
  doc["su_m"] = r.sd_used_mb; doc["lj"] = r.loop_jitter_max_ms; doc["br"] = r.brownout_count; 
  doc["cl"] = r.has_crash_log; doc["ic"] = r.i2c_error_count; doc["sl"] = r.sd_max_write_latency_ms; 
  doc["ir"] = r.batt_internal_resistance; doc["mt"] = r.modbus_timeout_count; doc["mc"] = r.modbus_crc_error_count; 
  doc["h2"] = r.http_2xx_count; doc["h4"] = r.http_4xx_count; doc["h5"] = r.http_5xx_count; 
  doc["nt"] = r.net_throughput_kbps; doc["nd"] = r.ntp_drift_s; doc["ui"] = r.current_upload_interval_s;

  String j; serializeJson(doc, j);
  unsigned long t_json = micros() - t0;
  size_t s_json = j.length();

  // 2. Binary CPU Time (67 Fields)
  t0 = micros();
  WeatherPacketFull p;
  pack(r, p);
  unsigned long t_blob = micros() - t0;
  size_t s_blob = sizeof(p);

  Serial.println("\n--- CPU Processing Time ---");
  Serial.print("JSON (67 fields):          "); Serial.print(t_json); Serial.println(" us");
  Serial.print("Binary (67 fields):        "); Serial.print(t_blob); Serial.println(" us");
  Serial.print("Speed Increase:            "); Serial.print((float)t_json/t_blob); Serial.println("x");

  Serial.println("\n--- Size Comparison ---");
  Serial.print("JSON Size:                 "); Serial.print(s_json); Serial.println(" bytes");
  Serial.print("Binary Size:               "); Serial.print(s_blob); Serial.println(" bytes");
  Serial.print("Reduction:                 "); Serial.print(100.0f * (1.0f - (float)s_blob/s_json)); Serial.println("%");

  Serial.println("\n--- Impact Analysis (Monthly/Yearly) ---");
  double m_json = ((double)s_json * 60 * 24 * 30.4) / 1048576.0;
  double m_blob = ((double)s_blob * 60 * 24 * 30.4) / 1048576.0;
  Serial.print("LTE/Month (JSON):          "); Serial.print(m_json); Serial.println(" MB");
  Serial.print("LTE/Month (Blob):          "); Serial.print(m_blob); Serial.println(" MB");

  double y_json = ((double)s_json * 3600 * 24 * 365) / 1073741824.0;
  double y_blob = ((double)s_blob * 3600 * 24 * 365) / 1073741824.0;
  Serial.print("SD/Year (JSON):            "); Serial.print(y_json); Serial.println(" GB");
  Serial.print("SD/Year (Blob):            "); Serial.print(y_blob); Serial.println(" GB");

  Serial.println("\nTesting SD Write speed...");
  if (!SD.begin(SD_CS)) {
    Serial.println("SD Error.");
  } else {
    t0 = micros(); 
    File f = SD.open("/f.txt", FILE_WRITE); f.println(j); f.close();
    Serial.print("SD Write (JSON):           "); Serial.print(micros() - t0); Serial.println(" us");

    t0 = micros();
    f = SD.open("/f.bin", FILE_WRITE); f.write((uint8_t*)&p, s_blob); f.close();
    Serial.print("SD Write (Blob):           "); Serial.print(micros() - t0); Serial.println(" us");
    Serial.println("-------------------------------------------");
  }
}
void loop() {}
