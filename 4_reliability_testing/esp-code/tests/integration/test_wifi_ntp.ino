/*
  Test: WiFi + NTP Sync
  Description: Verify WiFi connectivity and RTC synchronization via NTP.
  
  Instructions:
  1. Open Serial Monitor at 115200 baud.
  2. Ensure the WiFi SSID/Password matches your setup.
*/

#include <WiFi.h>
#include "RTClib.h"
#include <time.h>

const char* SSID = "SIPAT-BANWA";
const char* PASS = "BSECE4B1";
const char* NTP_SERVER = "pool.ntp.org";
const long GMT_OFFSET_SEC = 28800; // UTC+8

RTC_DS3231 rtc;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- WiFi + NTP Sync Test ---");

  if (!rtc.begin()) {
    Serial.println("RTC error.");
  }

  WiFi.begin(SSID, PASS);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected!");

  configTime(GMT_OFFSET_SEC, 0, NTP_SERVER);
  
  Serial.println("Waiting for NTP sync...");
  struct tm timeinfo;
  if (getLocalTime(&timeinfo)) {
    rtc.adjust(DateTime(timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
                        timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec));
    Serial.println("RTC Adjusted to NTP time.");
  } else {
    Serial.println("NTP Sync Failed.");
  }

  DateTime now = rtc.now();
  Serial.printf("RTC Time: %04d-%02d-%02d %02d:%02d:%02d\n",
                now.year(), now.month(), now.day(),
                now.hour(), now.minute(), now.second());
}

void loop() {}
