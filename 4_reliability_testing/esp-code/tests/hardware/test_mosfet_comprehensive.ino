#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// Pins
#define WIFI_POWER_PIN 13

// WiFi Credentials
const char* WIFI_SSID     = "SIPAT-BANWA";
const char* WIFI_PASSWORD = "BSECE4B1";

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- Continuous LTE Connectivity Test ---");

  // Power on the LTE Dongle and KEEP IT ON
  pinMode(WIFI_POWER_PIN, OUTPUT);
  digitalWrite(WIFI_POWER_PIN, HIGH);
  Serial.println("MOSFET: ON (LTE Powered)");
  
  // Wait for initial boot
  Serial.println("Initial wait 30s for dongle boot...");
  delay(30000);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connecting to %s...\n", WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - start < 20000)) {
      delay(500);
      Serial.print(".");
    }
    
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\n[WiFi] Connected!");
      Serial.print("IP: "); Serial.println(WiFi.localIP());
      Serial.print("GW: "); Serial.println(WiFi.gatewayIP());
    } else {
      Serial.println("\n[WiFi] Connection timeout. Retrying...");
      return;
    }
  }

  // Once connected, verify Internet
  Serial.println("[Internet] Verifying connectivity...");
  
  HTTPClient http;
  // Use a variety of checks if needed, but start with the standard 204
  http.begin("http://clients3.google.com/generate_204");
  http.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0.4472.124 Safari/537.36");
  
  int code = http.GET();
  if (code > 0) {
    if (code == 204 || code == 200) {
      Serial.printf(">>> SUCCESS: Internet Reachable! (Code: %d, RSSI: %d dBm) <<<\n", code, WiFi.RSSI());
    } else {
      Serial.printf(">>> WARNING: Connected but got Code: %d <<<\n", code);
    }
  } else {
    Serial.printf(">>> FAILED: Internet unreachable. Error: %s (%d) <<<\n", http.errorToString(code).c_str(), code);
    
    // Check if we can still see the gateway
    WiFiClient client;
    if (client.connect(WiFi.gatewayIP(), 80)) {
      Serial.println("[Diag] Gateway (192.168.100.1) is reachable. WAN is blocked.");
      client.stop();
    } else {
      Serial.println("[Diag] Gateway unreachable. Local link issue.");
    }
  }
  http.end();

  Serial.println("Waiting 10s before next check...");
  delay(10000);
}
