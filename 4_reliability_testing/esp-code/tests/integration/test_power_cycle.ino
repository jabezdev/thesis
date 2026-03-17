/*
  Test: Power Cycle Loop (Integration)
  Description: MOSFET ON -> Wait for WiFi -> Connect -> MOSFET OFF.
  
  Instructions:
  1. Open Serial Monitor at 115200 baud.
  2. This test simulates the full radio-on/radio-off cycle used in the main firmware.
  3. Ensure WiFi credentials are correct.
*/

#include <WiFi.h>

#define WIFI_POWER_PIN 13
#define WIFI_DONGLE_BOOT_MS 6000
#define WIFI_TIMEOUT_MS 20000

const char* SSID = "SIPAT-BANWA";
const char* PASS = "BSECE4B1";

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- Power Cycle Integration Test ---");
  pinMode(WIFI_POWER_PIN, OUTPUT);
}

void loop() {
  Serial.println(">>> [Cycle Start] Powering Dongle ON...");
  digitalWrite(WIFI_POWER_PIN, HIGH);
  
  Serial.printf("Waiting %u ms for dongle boot...\n", WIFI_DONGLE_BOOT_MS);
  delay(WIFI_DONGLE_BOOT_MS);

  WiFi.begin(SSID, PASS);
  Serial.print("Connecting ESP32 to Dongle WiFi");
  unsigned long start = millis();
  bool connected = false;
  
  while (millis() - start < WIFI_TIMEOUT_MS) {
    if (WiFi.status() == WL_CONNECTED) {
      connected = true;
      break;
    }
    delay(500);
    Serial.print(".");
  }

  if (connected) {
    Serial.printf("\nCONNECTED! RSSI: %d dBm\n", WiFi.RSSI());
    Serial.println("Simulating 5s upload window...");
    delay(5000);
  } else {
    Serial.println("\nTIMEOUT: Could not connect to WiFi.");
  }

  Serial.println("<<< [Cycle End] Powering Dongle OFF...");
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  digitalWrite(WIFI_POWER_PIN, LOW);

  Serial.println("Waiting 30 seconds before next cycle...");
  delay(30000);
}
