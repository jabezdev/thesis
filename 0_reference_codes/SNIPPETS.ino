// =============================================================================
// SNIPPETS.ino
// Consolidated reference snippets for Project Sipat Banwa (ESP32 AWS)
//
// Sources:
//   - CODE_1.ino  (batch upload, SD logging, rain sensor, RTC, Modbus)
//   - CODE_2.ino  (WiFi MOSFET power control, RTC serial update, SD logging)
//   - INA219.ino  (battery voltage/current monitoring, coulomb counting)
//   - esp-demo.ino (single-reading upload, improved error reporting)
// =============================================================================


/* =============================================================================
   SECTION 1: INCLUDES
   All libraries used across the reference files.
   ============================================================================= */

#include <Wire.h>           // I2C bus (RTC, INA219)
#include <SPI.h>            // SPI bus (SD card)
#include <SD.h>             // SD card filesystem
#include <WiFi.h>           // ESP32 WiFi
#include <HTTPClient.h>     // HTTP POST to backend
#include <ModbusMaster.h>   // RS485 Modbus RTU (temp/humidity sensor)
#include "RTClib.h"         // RTC DS3231
#include "DFRobot_RainfallSensor.h"  // DFRobot UART rainfall sensor
#include <Adafruit_INA219.h>         // INA219 current/voltage sensor


/* =============================================================================
   SECTION 2: CONFIG — WiFi & Server
   Placeholders — update before deployment.
   ============================================================================= */

const char* WIFI_SSID   = "YOUR_SSID";
const char* WIFI_PASS   = "YOUR_PASSWORD";
// Single-reading endpoint (esp-demo style)
const char* SERVER_URL  = "http://<SERVER_IP>:<PORT>/api/weather";
// Batch endpoint (CODE_1 style)
const char* BATCH_URL   = "http://<SERVER_IP>:<PORT>/upload";


/* =============================================================================
   SECTION 3: PIN DEFINITIONS
   ============================================================================= */

// RS485 / Modbus (temp+humidity sensor)
#define RS485_RX 16
#define RS485_TX 17

// Rain sensor (DFRobot, UART)
#define RAIN_RX  25
#define RAIN_TX  26

// SD card (SPI)
#define SD_CS    5

// WiFi power switch via MOSFET (CODE_2)
// Connect MOSFET gate to this pin to cut WiFi module power during sleep
#define WIFI_POWER_PIN 13

// INA219 uses I2C — default ESP32 I2C pins
// Wire.begin(21, 22);   ← call this in setup() if not using default Wire pins


/* =============================================================================
   SECTION 4: HARDWARE OBJECTS
   ============================================================================= */

RTC_DS3231 rtc;

// Modbus node (RS485)
ModbusMaster node;

// Rain sensor (second hardware UART)
HardwareSerial RainSerial(2);
DFRobot_RainfallSensor_UART RainSensor(&RainSerial);

// SD file handle
File myFile;

// INA219 (battery monitor)
Adafruit_INA219 ina219;


/* =============================================================================
   SECTION 5: DATA STRUCTURES
   ============================================================================= */

// Used for batching readings before upload (CODE_1 pattern)
struct Sample {
  String   ts;        // ISO-ish timestamp: "YYYY-MM-DD HH:MM:SS"
  float    t;         // Temperature (°C)
  float    h;         // Humidity (%)
  float    hi;        // Heat index (°C)
  float    rain;      // Cumulative rainfall (mm)
  float    rain1h;    // Rainfall last 1 hour (mm)
  uint32_t raw;       // Raw rain sensor tick count
};

#define BATCH_SIZE 10
Sample batch[BATCH_SIZE];
int batchIndex = 0;


/* =============================================================================
   SECTION 6: COUNTERS / DIAGNOSTICS
   ============================================================================= */

uint32_t failSensor  = 0;   // Modbus read failures
uint32_t failSD      = 0;   // SD write failures
uint32_t failUpload  = 0;   // HTTP POST failures
int      uploadCounter = 0; // Total successful uploads


/* =============================================================================
   SECTION 7: TRANSMISSION MODES
   Switch to adjust how often data is uploaded (CODE_1).
   ============================================================================= */

enum TxMode {
  MODE_EXTREME,    // Every 15 sec — severe weather
  MODE_NORMAL,     // Every 60 sec — standard operation
  MODE_NIGHT_SAVE, // Every  5 min — power saving at night
  MODE_CRITICAL    // Every 15 min — critically low battery
};

TxMode currentMode = MODE_NORMAL;


/* =============================================================================
   SECTION 8: UTILITY FUNCTIONS
   ============================================================================= */

// ---- Heat Index (NOAA formula) ----
// Returns input tempC unchanged if below threshold (< 26.7°C or humidity < 40%)
float heatIndex(float tempC, float humidity) {
  if (tempC < 26.7 || humidity < 40.0) return tempC;

  float T  = tempC * 9.0 / 5.0 + 32.0;  // convert to °F
  float R  = humidity;
  float HI = -42.379
    + 2.04901523  * T
    + 10.14333127 * R
    - 0.22475541  * T * R
    - 0.00683783  * T * T
    - 0.05481717  * R * R
    + 0.00122874  * T * T * R
    + 0.00085282  * T * R * R
    - 0.00000199  * T * T * R * R;

  return (HI - 32.0) * 5.0 / 9.0;  // back to °C
}

// ---- RTC Timestamp (zero-padded, ISO-like) ----
// Preferred format — uses sprintf for reliable zero-padding (CODE_1 / esp-demo)
String rtcNow() {
  DateTime n = rtc.now();
  char buf[20];
  sprintf(buf, "%04d-%02d-%02d %02d:%02d:%02d",
          n.year(), n.month(), n.day(),
          n.hour(), n.minute(), n.second());
  return String(buf);
}

// ---- Serial RTC Update ----
// Allows setting the RTC from Serial Monitor by typing: YYYY-MM-DD HH:MM:SS
// Best practice: validate format before parsing (CODE_2 adds character checks)
void checkSerialForRTCUpdate() {
  if (!Serial.available()) return;

  String s = Serial.readStringUntil('\n');
  s.trim();

  // Validate length and delimiter positions
  if (s.length() != 19 ||
      s.charAt(4)  != '-' || s.charAt(7)  != '-' ||
      s.charAt(10) != ' ' || s.charAt(13) != ':' || s.charAt(16) != ':') {
    Serial.println("Invalid format. Use: YYYY-MM-DD HH:MM:SS");
    return;
  }

  int yr = s.substring(0,  4).toInt();
  int mo = s.substring(5,  7).toInt();
  int dy = s.substring(8,  10).toInt();
  int hr = s.substring(11, 13).toInt();
  int mi = s.substring(14, 16).toInt();
  int se = s.substring(17, 19).toInt();

  rtc.adjust(DateTime(yr, mo, dy, hr, mi, se));
  Serial.println("RTC updated successfully.");
}


/* =============================================================================
   SECTION 9: INITIALIZATION (setup snippets)
   ============================================================================= */

void initSerial() {
  Serial.begin(115200);
}

void initRTC() {
  Wire.begin();   // Use Wire.begin(21, 22) to specify SDA/SCL if needed
  if (!rtc.begin()) {
    Serial.println("Couldn't find RTC.");
    while (1);
  }
  if (rtc.lostPower()) {
    Serial.println("RTC lost power — set time before use.");
    // rtc.adjust(DateTime(F(__DATE__), F(__TIME__))); // compile-time fallback
    // rtc.adjust(DateTime(2025, 6, 8, 12, 0, 0));    // manual fallback
  }
  Serial.println("RTC OK");
}

void initModbus() {
  Serial1.begin(9600, SERIAL_8N1, RS485_RX, RS485_TX);
  node.begin(1, Serial1);  // Modbus slave ID = 1
  Serial.println("Modbus OK");
}

void initRainSensor() {
  RainSerial.begin(9600, SERIAL_8N1, RAIN_RX, RAIN_TX);
  RainSensor.begin();
  Serial.println("Rain sensor OK");
}

void initSD() {
  SPI.begin(18, 19, 23, SD_CS);  // SCK=18, MISO=19, MOSI=23, CS=SD_CS
  if (!SD.begin(SD_CS)) {
    Serial.println("SD init failed!");
    while (1);
  }
  Serial.println("SD OK");
}

void initWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected: " + WiFi.localIP().toString());
}

void initINA219() {
  Wire.begin(21, 22);  // explicit I2C pins for ESP32
  if (!ina219.begin()) {
    Serial.println("INA219 not detected");
    while (1);
  }
  ina219.setCalibration_16V_5A();  // calibrate for 16V / 5A range
  Serial.println("INA219 OK");
}

// WiFi MOSFET power control (CODE_2)
void initWiFiPowerPin() {
  pinMode(WIFI_POWER_PIN, OUTPUT);
  digitalWrite(WIFI_POWER_PIN, HIGH);  // HIGH = WiFi module powered ON
}


/* =============================================================================
   SECTION 10: SENSOR READ SNIPPETS
   ============================================================================= */

// ---- Modbus Temp + Humidity (RS485, register 0x0000 x2) ----
float temperature = 0.0;
float humidity    = 0.0;

void readModbusSensor() {
  uint8_t result = node.readHoldingRegisters(0x0000, 2);
  if (result == node.ku8MBSuccess) {
    humidity    = node.getResponseBuffer(0) / 10.0;
    temperature = node.getResponseBuffer(1) / 10.0;
  } else {
    Serial.printf("Sensor Read Failed (Modbus Error: %02X)\n", result);
    failSensor++;
  }
}

// ---- DFRobot Rainfall Sensor ----
float readRainfall()     { return RainSensor.getRainfall();    }    // cumulative mm
float readRainfall1h()   { return RainSensor.getRainfall(1);  }    // last 1 hour mm
uint32_t readRainRaw()   { return RainSensor.getRawData();    }    // raw tick count

// ---- INA219 Battery Monitor ----
float capacity_Ah    = 30.0;  // set to your actual battery capacity
float used_Ah        = 0.0;
unsigned long prevMillis = 0;

void readINA219() {
  unsigned long now = millis();
  if (now - prevMillis >= 1000) {
    prevMillis = now;

    float voltage    = ina219.getBusVoltage_V();
    float current_mA = ina219.getCurrent_mA();
    float current_A  = current_mA / 1000.0;

    // Coulomb counting (Ah)
    used_Ah += current_A / 3600.0;

    float remaining_Ah = capacity_Ah - used_Ah;
    float soc          = (remaining_Ah / capacity_Ah) * 100.0;

    Serial.printf("Batt: %.2fV | %.3fA | %.4f Ah used | SoC: %.1f%%\n",
                  voltage, current_A, used_Ah, soc);

    // Low-battery cutoff
    if (voltage <= 11.0) {
      Serial.println("Battery cutoff reached — halting.");
      while (1);
    }
  }
}


/* =============================================================================
   SECTION 11: SD CARD LOGGING
   ============================================================================= */

// Append a CSV row (one reading per second pattern)
void logToSD(String ts, float t, float h, float hi, float rain, float rain1h, uint32_t raw) {
  myFile = SD.open("/datalog.csv", FILE_APPEND);
  if (myFile) {
    myFile.printf("%s,%.2f,%.2f,%.2f,%.2f,%.2f,%lu\n",
                  ts.c_str(), t, h, hi, rain, rain1h, raw);
    myFile.close();
  } else {
    Serial.println("SD write error");
    failSD++;
  }
}


/* =============================================================================
   SECTION 12: HTTP UPLOAD PATTERNS
   ============================================================================= */

// ---- Pattern A: Single Reading Upload (esp-demo style) ----
// Payload: { "temperature": N, "humidity": N, "heat_index": N, "rainfall": N }
void uploadSingleReading(float t, float h, float hi, float rain) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected, skipping upload.");
    return;
  }

  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");

  String payload = "{";
  payload += "\"temperature\":" + String(t) + ",";
  payload += "\"humidity\":"    + String(h) + ",";
  payload += "\"heat_index\":"  + String(hi) + ",";
  payload += "\"rainfall\":"    + String(rain);
  payload += "}";

  Serial.print("Payload: "); Serial.println(payload);

  int code = http.POST(payload);
  if (code == 200) {
    Serial.println("Upload OK (HTTP 200)");
    uploadCounter++;
  } else {
    Serial.printf("Upload Failed: HTTP %d\n", code);
    Serial.println("Server: " + http.getString());
    failUpload++;
  }
  http.end();
}

// ---- Pattern B: Batch Upload (CODE_1 style) ----
// Collects BATCH_SIZE samples then POSTs them all at once.
// Also includes diagnostic counters (failSensor, failSD) in payload.
void storeToBatch(String ts, float t, float h, float hi, float rain, float rain1h, uint32_t raw) {
  batch[batchIndex++] = {ts, t, h, hi, rain, rain1h, raw};

  if (batchIndex == BATCH_SIZE) {
    HTTPClient http;
    http.begin(BATCH_URL);
    http.addHeader("Content-Type", "application/json");

    String payload = "{ \"samples\": [";
    for (int i = 0; i < BATCH_SIZE; i++) {
      payload += "{";
      payload += "\"ts\":\""   + batch[i].ts           + "\",";
      payload += "\"t\":"      + String(batch[i].t)     + ",";
      payload += "\"h\":"      + String(batch[i].h)     + ",";
      payload += "\"hi\":"     + String(batch[i].hi)    + ",";
      payload += "\"rain\":"   + String(batch[i].rain)  + ",";
      payload += "\"rain1h\":" + String(batch[i].rain1h)+ ",";
      payload += "\"raw\":"    + String(batch[i].raw)   + "}";
      if (i < BATCH_SIZE - 1) payload += ",";
    }
    payload += "],";
    payload += "\"failSensor\":" + String(failSensor) + ",";
    payload += "\"failSD\":"     + String(failSD)     + "}";

    int code = http.POST(payload);
    if (code != 200) failUpload++;
    http.end();

    batchIndex = 0;
  }
}


/* =============================================================================
   SECTION 13: LOOP SKELETON
   Reference loop pattern showing RTC-tick gating (run once per second).
   ============================================================================= */

void loop() {
  // Check for serial RTC update command
  checkSerialForRTCUpdate();

  // Gate execution to once per RTC second-tick
  static int lastSecond = -1;
  DateTime now = rtc.now();
  if (now.second() == lastSecond) return;
  lastSecond = now.second();

  // --- Read sensors ---
  readModbusSensor();
  float hi    = heatIndex(temperature, humidity);
  float rain  = readRainfall();
  float rain1h= readRainfall1h();
  uint32_t raw= readRainRaw();
  String ts   = rtcNow();

  // --- Log to SD ---
  logToSD(ts, temperature, humidity, hi, rain, rain1h, raw);

  // --- Serial debug print ---
  Serial.printf("%s | T:%.2f H:%.2f HI:%.2f Rain:%.2f\n",
                ts.c_str(), temperature, humidity, hi, rain);

  // --- Upload (choose one pattern) ---
  uploadSingleReading(temperature, humidity, hi, rain);   // Pattern A
  // storeToBatch(ts, temperature, humidity, hi, rain, rain1h, raw); // Pattern B

  // --- Battery monitoring (non-blocking) ---
  readINA219();
}
