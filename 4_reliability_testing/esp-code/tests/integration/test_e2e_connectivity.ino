/*
  Test: E2E Connectivity (Integration)
  Description: Connects to WiFi, reads temp/humidity from Modbus sensor, and uploads to Firestore.
  Folder: tests/integration/
*/

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ModbusMaster.h>
#include <ArduinoJson.h>

// ── Configuration (from reliability_test.ino) ─────────────────────────────────
const char* WIFI_SSID     = "SIPAT-BANWA";
const char* WIFI_PASSWORD = "BSECE4B1";

const char* FIREBASE_PROJECT_ID = "panahon-live";
const char* FIREBASE_API_KEY    = "AIzaSyCDsUNnLZuK8EyBa1XRfKrgxVkykFK-WVg";
const char* FIRESTORE_BASE      = "https://firestore.googleapis.com/v1/projects/panahon-live/databases/(default)/documents";
const char* STATION_ID          = "e2e_test_station";

// Pins
#define RS485_RX       16
#define RS485_TX       17
#define WIFI_POWER_PIN 13

// ── Objects ──────────────────────────────────────────────────────────────────
ModbusMaster node;
WiFiClientSecure client;

// ── Functions ────────────────────────────────────────────────────────────────

void powerOnDongle() {
  Serial.println("[Power] Powering on WiFi Dongle...");
  pinMode(WIFI_POWER_PIN, OUTPUT);
  digitalWrite(WIFI_POWER_PIN, HIGH);
  delay(6000); // Wait for dongle to boot
}

bool connectWiFi() {
  Serial.printf("[WiFi] Connecting to %s...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(500);
    Serial.print(".");
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected!");
    Serial.print("[WiFi] IP Address: ");
    Serial.println(WiFi.localIP());
    return true;
  } else {
    Serial.println("\n[WiFi] Connection Failed.");
    return false;
  }
}

String firestoreUrl(const char* collection, const char* docId) {
  return String(FIRESTORE_BASE) + "/" + collection + "/" + docId + "?key=" + FIREBASE_API_KEY;
}

bool uploadToFirestore(float temp, float hum) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  client.setInsecure();
  
  String url = firestoreUrl("readings", STATION_ID);
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  JsonObject fields = doc["fields"].to<JsonObject>();
  
  // Add values using Firestore REST API format
  fields["temperature"]["doubleValue"] = temp;
  fields["humidity"]["doubleValue"] = hum;
  fields["test_tag"]["stringValue"] = "E2E_INTEGRATION_TEST";
  
  // Add a simple ISO timestamp (simulated since we don't sync RTC here for simplicity)
  fields["timestamp"]["stringValue"] = "2026-03-18T10:10:00Z"; 

  String payload;
  serializeJson(doc, payload);

  Serial.println("[HTTP] Patching to Firestore...");
  int code = http.PATCH(payload);
  http.end();

  if (code >= 200 && code < 300) {
    Serial.printf("[HTTP] Success! Code: %d\n", code);
    return true;
  } else {
    Serial.printf("[HTTP] Failed. Code: %d\n", code);
    return false;
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- E2E Connectivity & Firestore Test ---");

  // Initialize Modbus
  Serial1.begin(9600, SERIAL_8N1, RS485_RX, RS485_TX);
  node.begin(1, Serial1);
  Serial.println("[Modbus] Initialized.");

  // Power on WiFi Dongle
  powerOnDongle();

  // Connect to WiFi
  if (!connectWiFi()) {
    Serial.println("FATAL: Could not connect to WiFi. Restarting...");
    delay(5000);
    ESP.restart();
  }
}

void loop() {
  Serial.println("\n--- Starting Test Cycle ---");

  // 1. Read Sensor
  float temperature = 0.0;
  float humidity = 0.0;
  
  uint8_t result = node.readHoldingRegisters(0x0000, 2);
  if (result == node.ku8MBSuccess) {
    humidity = node.getResponseBuffer(0) / 10.0f;
    temperature = node.getResponseBuffer(1) / 10.0f;
    Serial.printf("[Sensor] Temp: %.1f C, Hum: %.1f %%\n", temperature, humidity);
  } else {
    Serial.printf("[Sensor] Error reading Modbus: 0x%02X\n", result);
  }

  // 2. Upload to Firestore
  if (temperature != 0.0 || humidity != 0.0) {
    uploadToFirestore(temperature, humidity);
  } else {
    Serial.println("[Test] Skipping upload due to invalid sensor data.");
  }

  Serial.println("--- Cycle Complete. Waiting 30 seconds ---");
  delay(30000);
}
