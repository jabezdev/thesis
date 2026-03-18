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
  unsigned long startConnect = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startConnect < 20000) {
    delay(500);
    Serial.print(".");
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nConnected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("RSSI: ");
    Serial.println(WiFi.RSSI());
    
    // DNS Check
    IPAddress ntpIP;
    if (WiFi.hostByName(NTP_SERVER, ntpIP)) {
      Serial.printf("DNS OK: %s resolved to %s\n", NTP_SERVER, ntpIP.toString().c_str());
    } else {
      Serial.printf("DNS FAILED: Could not resolve %s\n", NTP_SERVER);
    }
  } else {
    Serial.println("\nWiFi Connection Failed.");
    return;
  }

  // Use multiple NTP servers for redundancy
  configTime(GMT_OFFSET_SEC, 0, NTP_SERVER, "time.google.com", "time.nist.gov");
  
  Serial.println("Waiting for NTP sync...");
  struct tm timeinfo;
  bool synced = false;
  for (int i = 0; i < 30; i++) { // 15 seconds total (30 * 500ms)
    if (getLocalTime(&timeinfo)) {
      synced = true;
      break;
    }
    delay(500);
    Serial.print(".");
  }

  if (synced) {
    Serial.println("\nNTP Sync Successful.");
    rtc.adjust(DateTime(timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
                        timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec));
    Serial.println("RTC Adjusted to NTP time.");
  } else {
    Serial.println("\nNTP Sync Failed after multiple retries.");
  }

  DateTime now = rtc.now();
  Serial.printf("RTC Time: %04d-%02d-%02d %02d:%02d:%02d\n",
                now.year(), now.month(), now.day(),
                now.hour(), now.minute(), now.second());
}

void loop() {}
