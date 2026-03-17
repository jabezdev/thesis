/*
  Test: Firestore Single POST/PATCH
  Description: Verify communication with Firebase Firestore REST API.
  
  Instructions:
  1. Ensure WiFi is working and SSID/PASS are correct.
  2. Observe Serial for HTTP response codes (200 OK or 400+ for errors).
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* SSID = "SIPAT-BANWA";
const char* PASS = "BSECE4B1";
const char* API_KEY = "AIzaSyCDsUNnLZuK8EyBa1XRfKrgxVkykFK-WVg";
const char* URL = "https://firestore.googleapis.com/v1/projects/panahon-live/databases/(default)/documents/test_collection/test_doc?key=";

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- Firestore POST/PATCH Test ---");

  WiFi.begin(SSID, PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\nConnected.");

  WiFiClientSecure client;
  client.setInsecure(); // No certificate verification for simplicity
  HTTPClient http;

  String fullUrl = String(URL) + API_KEY;
  http.begin(client, fullUrl);
  http.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  doc["fields"]["test_value"]["stringValue"] = "Hello from ESP32 Integration Test";
  doc["fields"]["uptime"]["integerValue"] = String(millis());

  String payload;
  serializeJson(doc, payload);

  Serial.println("Sending PATCH request...");
  int code = http.PATCH(payload);
  Serial.printf("HTTP Code: %d\n", code);

  if (code > 0) {
    String resp = http.getString();
    Serial.println("Response:");
    Serial.println(resp);
  }
  http.end();
}

void loop() {}
