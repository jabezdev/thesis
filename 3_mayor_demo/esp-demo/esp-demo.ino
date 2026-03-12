#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <ModbusMaster.h>
#include "RTClib.h"
#include "DFRobot_RainfallSensor.h"

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

  Serial.println("System Ready");
}

/* 
 * Checks if the backend sent a command over USB Serial.
 * Currently supports RTC sync: expects "YYYY-MM-DD HH:MM:SS" (length 19).
 */
void checkSerialForCommands() {
  if (!Serial.available()) return;

  String s = Serial.readStringUntil('\n');
  s.trim();

  // RTC update command: YYYY-MM-DD HH:MM:SS  (length = 19)
  if (s.length() == 19) {
    int yr = s.substring(0,4).toInt();
    int mo = s.substring(5,7).toInt();
    int dy = s.substring(8,10).toInt();
    int hr = s.substring(11,13).toInt();
    int mi = s.substring(14,16).toInt();
    int se = s.substring(17,19).toInt();

    rtc.adjust(DateTime(yr, mo, dy, hr, mi, se));
    Serial.println("{\"rtc\":\"updated\"}");
    return;
  }

  Serial.println("{\"error\":\"unknown command\"}");
}

/* ================= LOOP ================= */
void loop() {
  checkSerialForCommands();
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

  /* -------- SEND JSON OVER USB SERIAL (to backend via COM port) -------- */
  // One compact JSON line per second — backend reads and inserts into DB
  Serial.print("{");
  Serial.print("\"temperature\":");   Serial.print(t, 2);
  Serial.print(",\"humidity\":");     Serial.print(h, 2);
  Serial.print(",\"heat_index\":");   Serial.print(hi, 2);
  Serial.print(",\"rainfall\":");     Serial.print(rain, 2);
  Serial.print(",\"timestamp\":\"");  Serial.print(ts);
  Serial.println("\"}");
}
