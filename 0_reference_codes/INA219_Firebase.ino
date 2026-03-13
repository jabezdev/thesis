// ============================================================
//  INA219 Battery Monitor — Firebase Realtime DB (HTTPS)
//  Board  : ESP32
//  Sensor : INA219 (I2C, SDA=21, SCL=22)
//  Cloud  : Firebase Realtime Database via HTTPS REST
// ============================================================

#include <Wire.h>
#include <Adafruit_INA219.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Arduino.h>

// ── Wi-Fi credentials ────────────────────────────────────────
const char* WIFI_SSID     = "onsay";
const char* WIFI_PASSWORD = "11112222";

// ── Firebase project settings ────────────────────────────────
// Database URL  : https://<project-id>-default-rtdb.firebaseio.com
// Node path     : /battery.json  (creates/overwrites the node each update)
const char* FIREBASE_HOST = "panahon-live-default-rtdb.asia-southeast1.firebasedatabase.app";
const char* FIREBASE_PATH = "/battery.json";   // change path as needed
// Firebase API key (from your project's web config)
const char* FIREBASE_API_KEY = "AIzaSyCDsUNnLZuK8EyBa1XRfKrgxVkykFK-WVg";

// ── Interval ─────────────────────────────────────────────────
const unsigned long UPLOAD_INTERVAL_MS = 1000;  // 1 second

// ── Battery configuration ────────────────────────────────────
const float CAPACITY_AH   = 30.0;   // Full capacity in Ah
const float CUTOFF_VOLTAGE = 11.0;  // Low-voltage cutoff (V)

// ── Globals ──────────────────────────────────────────────────
Adafruit_INA219 ina219;
float           used_Ah       = 0.0;
unsigned long   previousMillis = 0;

// ─────────────────────────────────────────────────────────────
//  Wi-Fi helpers
// ─────────────────────────────────────────────────────────────
void connectWiFi() {
  Serial.printf("\nConnecting to Wi-Fi SSID: \"%s\"\n", WIFI_SSID);

  // Full reset before connecting — helps with phone hotspots
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  delay(300);
  WiFi.mode(WIFI_STA);
  delay(100);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > 20000) {           // 20-second timeout
      Serial.println("\n[WiFi] Timeout — restarting ESP...");
      ESP.restart();
    }
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\n[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
}

// ─────────────────────────────────────────────────────────────
//  Firebase HTTPS upload (REST API, PATCH)
//  PATCH merges fields; use PUT to overwrite the whole node.
// ─────────────────────────────────────────────────────────────
void uploadToFirebase(float voltage, float current_A, float power_W,
                      float soc, float remaining_Ah) {

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[Firebase] Wi-Fi lost — reconnecting...");
    connectWiFi();
  }

  // Build the HTTPS URL
  // ?auth=<API_KEY> authenticates via the legacy database secret / API key.
  // For production, use Firebase Auth ID tokens or Admin SDK instead.
  String url = String("https://") + FIREBASE_HOST + FIREBASE_PATH
             + "?auth=" + FIREBASE_API_KEY;

  // Build JSON payload
  String payload = "{";
  payload += "\"voltage_V\":"       + String(voltage,      3) + ",";
  payload += "\"current_A\":"       + String(current_A,    4) + ",";
  payload += "\"power_W\":"         + String(power_W,      3) + ",";
  payload += "\"soc_pct\":"         + String(soc,          2) + ",";
  payload += "\"remaining_Ah\":"    + String(remaining_Ah, 3) + ",";
  payload += "\"timestamp_ms\":"    + String(millis());
  payload += "}";

  WiFiClientSecure client;
  client.setInsecure();  // Skip SSL cert verification (acceptable for dev)

  HTTPClient http;
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");

  // PATCH — merge fields so other sibling nodes are not erased
  int httpCode = http.PATCH(payload);

  if (httpCode > 0) {
    Serial.printf("[Firebase] HTTP %d — OK\n", httpCode);
  } else {
    Serial.printf("[Firebase] Error: %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();
}

// ─────────────────────────────────────────────────────────────
//  Setup
// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(200);

  // I2C — ESP32 default I2C pins
  Wire.begin(21, 22);  // SDA=21, SCL=22

  // INA219 init
  if (!ina219.begin()) {
    Serial.println("ERROR: INA219 not detected. Check wiring.");
    while (1) delay(10);
  }
  // 32 V / 2 A calibration — suitable for a 12 V battery
  ina219.setCalibration_32V_2A();
  Serial.println("INA219 ready.");

  // Wi-Fi
  connectWiFi();

  Serial.println("=== Battery Monitor + Firebase Started ===");
  Serial.println("Placement: 12V battery → INA219 → Step-Down (12V→5V) → Load");
  Serial.println("----------------------------------------------------------");
}

// ─────────────────────────────────────────────────────────────
//  Loop
// ─────────────────────────────────────────────────────────────
void loop() {
  unsigned long currentMillis = millis();

  if (currentMillis - previousMillis >= UPLOAD_INTERVAL_MS) {
    previousMillis = currentMillis;

    // ── Read sensor ──────────────────────────────────────────
    float voltage    = ina219.getBusVoltage_V();   // Battery terminal voltage (V)
    float current_mA = ina219.getCurrent_mA();     // Current from battery (mA)
    float current_A  = current_mA / 1000.0;
    float power_mW   = ina219.getPower_mW();       // Power at battery side (mW)
    float power_W    = power_mW / 1000.0;

    // ── Coulomb counting ─────────────────────────────────────
    used_Ah += current_A / 3600.0;                 // Integrate over 1-second
    float remaining_Ah = CAPACITY_AH - used_Ah;
    float soc          = (remaining_Ah / CAPACITY_AH) * 100.0;
    soc = constrain(soc, 0.0, 100.0);

    // ── Serial output ─────────────────────────────────────────
    Serial.printf(
      "V: %.2f V | I: %.3f A | P: %.2f W (%.1f mW) | SoC: %.1f %% (%.2f Ah)\n",
      voltage, current_A, power_W, power_mW, soc, remaining_Ah
    );

    // ── Upload to Firebase ───────────────────────────────────
    uploadToFirebase(voltage, current_A, power_W, soc, remaining_Ah);

    // ── Low-voltage cutoff ───────────────────────────────────
    if (voltage <= CUTOFF_VOLTAGE) {
      Serial.println(">>> Battery cutoff reached (<=11V). Halting. <<<");
      while (1) delay(10);
    }
  }
}
