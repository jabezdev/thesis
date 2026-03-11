#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <time.h>
#include <ModbusMaster.h>
#include "RTClib.h"
#include "DFRobot_RainfallSensor.h"

/* ================= CONFIG ================= */
const char* WIFI_SSID = "onsay";
const char* WIFI_PASS = "11112222";
// Endpoint expects port 3001 and /api/weather. IP is standard local assignment, update if needed.
const char* SERVER_URL = "http://192.168.99.101:3001/api/weather"; 
const long GMT_OFFSET_SECONDS = 8 * 60 * 60;
const int DAYLIGHT_OFFSET_SECONDS = 0;

const uint32_t SAMPLE_INTERVAL_MS = 1000;
const uint32_t WIFI_RETRY_INTERVAL_MS = 10000;
const uint32_t NTP_RETRY_INTERVAL_MS = 30000;
const uint32_t NTP_RESYNC_INTERVAL_MS = 6UL * 60UL * 60UL * 1000UL;
const uint32_t UPLOAD_RETRY_DELAY_MS = 1500;
const uint32_t BATCH_FLUSH_INTERVAL_MS = 3000;
const uint16_t HTTP_CONNECT_TIMEOUT_MS = 2000;
const uint16_t HTTP_READ_TIMEOUT_MS = 4000;
const uint8_t MAX_UPLOAD_RETRIES = 3;
const uint8_t BATCH_MAX_SIZE = 8;
const size_t SAMPLE_QUEUE_LENGTH = 60;

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
uint32_t droppedSamples = 0;

SemaphoreHandle_t rtcMutex = nullptr;
QueueHandle_t sampleQueue = nullptr;

bool ntpSynchronized = false;
uint32_t lastNtpSyncAt = 0;

struct WeatherSample {
  char timestamp[20];
  float temperature;
  float humidity;
  float heatIndex;
  float rainfall;
  float rainfallHour;
  uint32_t rawRain;
  uint8_t retryCount;
  bool sdLogged;
};

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
  sprintf(buf, "%04d-%02d-%02dT%02d:%02d:%02d",
          n.year(), n.month(), n.day(),
          n.hour(), n.minute(), n.second());
  return String(buf);
}

DateTime readRtcNow() {
  if (rtcMutex != nullptr && xSemaphoreTake(rtcMutex, pdMS_TO_TICKS(25)) == pdTRUE) {
    DateTime now = rtc.now();
    xSemaphoreGive(rtcMutex);
    return now;
  }

  return rtc.now();
}

void adjustRtc(const DateTime& value) {
  if (rtcMutex != nullptr && xSemaphoreTake(rtcMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
    rtc.adjust(value);
    xSemaphoreGive(rtcMutex);
    return;
  }

  rtc.adjust(value);
}

void formatTimestamp(const DateTime& value, char* buffer, size_t bufferSize) {
  snprintf(buffer, bufferSize, "%04d-%02d-%02dT%02d:%02d:%02d",
           value.year(), value.month(), value.day(),
           value.hour(), value.minute(), value.second());
}

void connectWifiIfNeeded() {
  static uint32_t lastAttemptAt = 0;
  uint32_t now = millis();

  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  if (now - lastAttemptAt < WIFI_RETRY_INTERVAL_MS) {
    return;
  }

  lastAttemptAt = now;
  Serial.println("WiFi not connected. Starting reconnect attempt...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

bool syncRtcFromNtp() {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  configTime(GMT_OFFSET_SECONDS, DAYLIGHT_OFFSET_SECONDS, "pool.ntp.org", "time.nist.gov");

  struct tm timeInfo;
  if (!getLocalTime(&timeInfo, 5000)) {
    Serial.println("NTP sync failed. Continuing with RTC time.");
    return false;
  }

  DateTime synced(
    timeInfo.tm_year + 1900,
    timeInfo.tm_mon + 1,
    timeInfo.tm_mday,
    timeInfo.tm_hour,
    timeInfo.tm_min,
    timeInfo.tm_sec
  );

  adjustRtc(synced);
  ntpSynchronized = true;
  lastNtpSyncAt = millis();
  Serial.print("RTC synchronized from NTP: ");
  Serial.println(rtcNow());
  return true;
}

void maybeSyncRtcFromNtp() {
  static uint32_t lastAttemptAt = 0;
  uint32_t now = millis();

  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  if (ntpSynchronized && (now - lastNtpSyncAt) < NTP_RESYNC_INTERVAL_MS) {
    return;
  }

  if (now - lastAttemptAt < NTP_RETRY_INTERVAL_MS) {
    return;
  }

  lastAttemptAt = now;
  syncRtcFromNtp();
}

bool writeSampleToSd(const WeatherSample& sample) {
  myFile = SD.open("/datalog.csv", FILE_APPEND);
  if (!myFile) {
    failSD++;
    Serial.println("Failed to open SD log file.");
    return false;
  }

  myFile.printf("%s,%.2f,%.2f,%.2f,%.2f,%.2f,%lu\n",
                sample.timestamp,
                sample.temperature,
                sample.humidity,
                sample.heatIndex,
                sample.rainfall,
                sample.rainfallHour,
                sample.rawRain);
  myFile.close();
  return true;
}

bool uploadBatch(const WeatherSample* samples, size_t count) {
  if (count == 0) {
    return true;
  }

  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  HTTPClient http;
  http.begin(SERVER_URL);
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout(HTTP_READ_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");

  String payload = "{\"readings\":[";
  for (size_t i = 0; i < count; ++i) {
    if (i > 0) {
      payload += ",";
    }

    payload += "{";
    payload += "\"temperature\":" + String(samples[i].temperature, 2) + ",";
    payload += "\"humidity\":" + String(samples[i].humidity, 2) + ",";
    payload += "\"heat_index\":" + String(samples[i].heatIndex, 2) + ",";
    payload += "\"rainfall\":" + String(samples[i].rainfall, 2) + ",";
    payload += "\"timestamp\":\"" + String(samples[i].timestamp) + "\"";
    payload += "}";
  }
  payload += "]}";

  int code = http.POST(payload);
  bool success = code >= 200 && code < 300;

  if (success) {
    Serial.printf("Upload success for %u samples\n", static_cast<unsigned>(count));
  } else {
    failUpload++;
    Serial.printf("Upload failed for batch of %u samples with HTTP %d\n", static_cast<unsigned>(count), code);
    Serial.println(http.getString());
  }

  http.end();
  return success;
}

void enqueueSample(const WeatherSample& sample) {
  if (sampleQueue == nullptr) {
    return;
  }

  if (xQueueSend(sampleQueue, &sample, 0) == pdTRUE) {
    return;
  }

  WeatherSample discarded;
  if (xQueueReceive(sampleQueue, &discarded, 0) == pdTRUE) {
    droppedSamples++;
    Serial.println("Sample queue full. Dropping oldest pending sample.");
  }

  if (xQueueSend(sampleQueue, &sample, 0) != pdTRUE) {
    droppedSamples++;
    Serial.println("Failed to enqueue new sample after dropping oldest.");
  }
}

void sampleTask(void* parameter) {
  TickType_t lastWakeTime = xTaskGetTickCount();

  for (;;) {
    WeatherSample sample = {};

    float temperature = 0.0;
    float humidity = 0.0;
    uint8_t result = node.readHoldingRegisters(0, 2);
    if (result == node.ku8MBSuccess) {
      humidity = node.getResponseBuffer(0) / 10.0;
      temperature = node.getResponseBuffer(1) / 10.0;
    } else {
      failSensor++;
      Serial.printf("Sensor read failed (Modbus error %02X)\n", result);
      // Skip this cycle to avoid logging/uploading invalid zero values.
      vTaskDelayUntil(&lastWakeTime, pdMS_TO_TICKS(SAMPLE_INTERVAL_MS));
      continue;
    }

    DateTime now = readRtcNow();
    formatTimestamp(now, sample.timestamp, sizeof(sample.timestamp));

    sample.temperature = temperature;
    sample.humidity = humidity;
    sample.heatIndex = heatIndex(temperature, humidity);
    sample.rainfall = RainSensor.getRainfall();
    sample.rainfallHour = RainSensor.getRainfall(1);
    sample.rawRain = RainSensor.getRawData();
    sample.retryCount = 0;
    sample.sdLogged = false;

    Serial.printf("%s | T:%.2f H:%.2f HI:%.2f Rain:%.2f\n",
                  sample.timestamp,
                  sample.temperature,
                  sample.humidity,
                  sample.heatIndex,
                  sample.rainfall);

    enqueueSample(sample);
    vTaskDelayUntil(&lastWakeTime, pdMS_TO_TICKS(SAMPLE_INTERVAL_MS));
  }
}

void processTask(void* parameter) {
  WeatherSample pendingBatch[BATCH_MAX_SIZE];
  size_t pendingCount = 0;
  uint32_t lastFlushAt = millis();

  for (;;) {
    connectWifiIfNeeded();
    maybeSyncRtcFromNtp();

    if (sampleQueue == nullptr) {
      Serial.println("Sample queue is not available.");
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }

    WeatherSample sample;
    bool gotSample = xQueueReceive(sampleQueue, &sample, pdMS_TO_TICKS(250)) == pdTRUE;

    if (gotSample) {
      if (!sample.sdLogged) {
        sample.sdLogged = writeSampleToSd(sample);
      }

      if (pendingCount < BATCH_MAX_SIZE) {
        pendingBatch[pendingCount++] = sample;
      } else {
        // Keep queue moving by returning overflow sample for later retry.
        enqueueSample(sample);
      }
    }

    uint32_t now = millis();
    bool batchFull = pendingCount >= BATCH_MAX_SIZE;
    bool flushDue = pendingCount > 0 && (now - lastFlushAt >= BATCH_FLUSH_INTERVAL_MS);
    if (!batchFull && !flushDue) {
      continue;
    }

    if (uploadBatch(pendingBatch, pendingCount)) {
      pendingCount = 0;
      lastFlushAt = now;
      continue;
    }

    for (size_t i = 0; i < pendingCount; ++i) {
      if (pendingBatch[i].retryCount < MAX_UPLOAD_RETRIES) {
        pendingBatch[i].retryCount++;
        Serial.printf("Requeueing sample %s for retry %u\n", pendingBatch[i].timestamp, pendingBatch[i].retryCount);
        enqueueSample(pendingBatch[i]);
      } else {
        Serial.printf("Giving up on upload for %s after %u retries\n", pendingBatch[i].timestamp, pendingBatch[i].retryCount);
      }
    }

    pendingCount = 0;
    lastFlushAt = now;
    vTaskDelay(pdMS_TO_TICKS(UPLOAD_RETRY_DELAY_MS));
  }
}

/* ================= SETUP ================= */
void setup() {
  Serial.begin(115200);

  Wire.begin();
  rtcMutex = xSemaphoreCreateMutex();

  if (!rtc.begin()) {
    Serial.println("RTC initialization failed.");
  } else if (rtc.lostPower()) {
    Serial.println("RTC lost power. Seeding RTC with firmware build time.");
    adjustRtc(DateTime(F(__DATE__), F(__TIME__)));
  }

  Serial1.begin(9600, SERIAL_8N1, RS485_RX, RS485_TX);
  node.begin(1, Serial1);

  RainSerial.begin(9600, SERIAL_8N1, RAIN_RX, RAIN_TX);
  RainSensor.begin();

  SPI.begin(18, 19, 23, SD_CS);
  if (!SD.begin(SD_CS)) {
    Serial.println("SD initialization failed.");
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  sampleQueue = xQueueCreate(SAMPLE_QUEUE_LENGTH, sizeof(WeatherSample));
  if (sampleQueue == nullptr) {
    Serial.println("Failed to create sample queue. Halting startup.");
    for (;;) {
      delay(1000);
    }
  }

  BaseType_t sampleTaskStatus = xTaskCreatePinnedToCore(sampleTask, "sampleTask", 8192, nullptr, 2, nullptr, 1);
  if (sampleTaskStatus != pdPASS) {
    Serial.println("Failed to create sampleTask. Halting startup.");
    for (;;) {
      delay(1000);
    }
  }

  BaseType_t processTaskStatus = xTaskCreatePinnedToCore(processTask, "processTask", 12288, nullptr, 1, nullptr, 0);
  if (processTaskStatus != pdPASS) {
    Serial.println("Failed to create processTask. Halting startup.");
    for (;;) {
      delay(1000);
    }
  }

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

  adjustRtc(DateTime(yr, mo, dy, hr, mi, se));
  Serial.println("RTC updated successfully.");
}

/* ================= LOOP ================= */
void loop() {
  checkSerialForRTCUpdate();
  delay(20);
}
