#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ModbusMaster.h>
#include "RTClib.h"
#include "DFRobot_RainfallSensor.h"

/* ================= CONFIG ================= */
const char* WIFI_SSID = "onsay";
const char* WIFI_PASS = "11112222";
// Endpoint expects port 3001 and /api/weather. IP is standard local assignment, update if needed.
const char* SERVER_URL = "http://192.168.99.101:3001/api/weather"; 

/* ================= HARDWARE ================= */
RTC_DS3231 rtc;
ModbusMaster node;
File myFile;

// RS485
#define RS485_RX 16
#define RS485_TX 17

// Rain sensor UART
HardwareSerial RainSerial(2);
#define RAIN_RX 25
#define RAIN_TX 26
DFRobot_RainfallSensor_UART RainSensor(&RainSerial);

// SD
#define SD_CS 5

/* ================= COUNTERS ================= */
uint32_t failSensor = 0;
uint32_t failSD = 0;
uint32_t failUpload = 0;
int uploadCounter = 0;

/* ================= UTILS ================= */
float heatIndex(float tempC, float humidity) {
  // Heat Index not defined under these conditions
  if (tempC < 26.7 || humidity < 40.0) {
    return tempC;
  }
  float T = tempC * 9.0 / 5.0 + 32.0;
  float R = humidity;
  float HI =
    -42.379 +
    2.04901523 * T +
    10.14333127 * R -
    0.22475541 * T * R -
    0.00683783 * T * T -
    0.05481717 * R * R +
    0.00122874 * T * T * R +
    0.00085282 * T * R * R -
    0.00000199 * T * T * R * R;

  return (HI - 32.0) * 5.0 / 9.0;
}

String rtcNow() {
  DateTime n = rtc.now();
  char buf[20];
  sprintf(buf, "%04d-%02d-%02d %02d:%02d:%02d",
          n.year(), n.month(), n.day(),
          n.hour(), n.minute(), n.second());
  return String(buf);
}

/* ================= SETUP ================= */
void setup() {
  Serial.begin(115200);

  Wire.begin();
  rtc.begin();

  Serial1.begin(9600, SERIAL_8N1, RS485_RX, RS485_TX);
  node.begin(1, Serial1);

  RainSerial.begin(9600, SERIAL_8N1, RAIN_RX, RAIN_TX);
  RainSensor.begin();

  SPI.begin(18, 19, 23, SD_CS);
  SD.begin(SD_CS);

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(500);

  Serial.println("System Ready");
}

void checkSerialForRTCUpdate() {
  if (!Serial.available()) return;

  String s = Serial.readStringUntil('\n');
  s.trim();

  // Expected: YYYY-MM-DD HH:MM:SS  (length = 19)
  if (s.length() != 19) {
    Serial.println("Invalid format. Use: YYYY-MM-DD HH:MM:SS");
    return;
  }

  int yr = s.substring(0,4).toInt();
  int mo = s.substring(5,7).toInt();
  int dy = s.substring(8,10).toInt();
  int hr = s.substring(11,13).toInt();
  int mi = s.substring(14,16).toInt();
  int se = s.substring(17,19).toInt();

  rtc.adjust(DateTime(yr, mo, dy, hr, mi, se));
  Serial.println("RTC updated successfully.");
}

/* ================= LOOP ================= */
void loop() {
  checkSerialForRTCUpdate();
  static int lastSecond = -1;
  DateTime now = rtc.now();

  if (now.second() == lastSecond) return;
  lastSecond = now.second();

  /* -------- SENSOR READ -------- */
  float t=0, h=0;
  uint8_t result = node.readHoldingRegisters(0,2);
  if (result == node.ku8MBSuccess) {
    h = node.getResponseBuffer(0)/10.0;
    t = node.getResponseBuffer(1)/10.0;
  } else {
    Serial.printf("Sensor Read Failed (Modbus Error: %02X)\n", result);
    failSensor++;
  }

  float hi = heatIndex(t,h);
  float rain = RainSensor.getRainfall();
  float rain1h = RainSensor.getRainfall(1);
  uint32_t raw = RainSensor.getRawData();

  String ts = rtcNow();

  /* -------- SD LOG (EVERY SECOND) -------- */
  myFile = SD.open("/datalog.csv", FILE_APPEND);
  if (myFile) {
    myFile.printf("%s,%.2f,%.2f,%.2f,%.2f,%.2f,%lu\n",
      ts.c_str(), t, h, hi, rain, rain1h, raw);
    myFile.close();
  } else {
    failSD++;
  }

  /* -------- PRINT GROUP -------- */
  Serial.printf("%s | T:%.2f H:%.2f HI:%.2f Rain:%.2f\n",
                ts.c_str(), t, h, hi, rain);

  /* -------- UPLOAD CONTINUOUSLY -------- */
  if(WiFi.status() == WL_CONNECTED) {
    Serial.println("---- UPLOADING JSON ----");

      HTTPClient http;
      http.begin(SERVER_URL);
      http.addHeader("Content-Type","application/json");

      // Construct native JSON mapping to Backend's Expected Body 
      // Requirement: { temperature: number, humidity: number, heat_index: number, rainfall: number }
      String payload = "{";
      payload += "\"temperature\":" + String(t) + ",";
      payload += "\"humidity\":" + String(h) + ",";
      payload += "\"heat_index\":" + String(hi) + ",";
      payload += "\"rainfall\":" + String(rain);
      payload += "}";

      Serial.print("Payload to send: ");
      Serial.println(payload);

      int code = http.POST(payload);
      if (code == 200) {
        Serial.println("Upload Success: Server responded with HTTP 200");
      } else {
        Serial.printf("Upload Failed: HTTP %d\n", code);
        String response = http.getString();
        Serial.print("Server Response: ");
        Serial.println(response);
        failUpload++;
      }

      http.end();
    } else {
      Serial.println("WiFi disconnected, skipping upload!");
    }
}
