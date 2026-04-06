// ── OTA Firebase Test — Firmware 1 (Initial Flash) ───────────────────────────
// Tests OTA via raw HTTPClient polling of Firebase RTDB REST endpoint.
// Architecture mirrors m3_v0.1.ino for WiFi + RTDB, but OTA streams the binary
// DIRECTLY into the ESP32 Update partition — no SD card required.
//
// This is the INITIAL firmware you flash to the device.
// When OTA succeeds, the device boots into ota_firebase_fw2_blink (FAST blink).
//
// RTDB Node Path : nodes_test/ota_test_node_1/
// Node ID        : ota_test_node_1 (fixed override)
// FIRMWARE       : v1.0-blink-slow  (SLOW 1000 ms blink)
//
// HOW TO TEST:
//   1. Flash this sketch to your ESP32. Observe SLOW blink (1 s).
//   2. Compile ota_firebase_fw2_blink.ino → Sketch > Export Compiled Binary.
//   3. Upload the .bin to Firebase Storage. Copy the download URL.
//   4. In RTDB set nodes_test/ota_test_node_1/config :
//         {
//           "target_version": "v2.0-blink-fast",
//           "target_url":     "<Firebase Storage download URL>"
//         }
//   5. Within ~60 s the node polls, detects the mismatch, streams the binary
//      directly into flash, and reboots.
//   6. After reboot you should see FAST blink (150 ms) — OTA successful.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Update.h>
#include <ArduinoJson.h>

// ── WiFi ──────────────────────────────────────────────────────────────────────
#define WIFI_SSID     "onsay"
#define WIFI_PASSWORD "11111111"

// ── Firebase RTDB REST ────────────────────────────────────────────────────────
#define API_KEY      "AIzaSyCDsUNnLZuK8EyBa1XRfKrgxVkykFK-WVg"
#define DATABASE_URL "https://panahon-live-default-rtdb.asia-southeast1.firebasedatabase.app/"

// ── Node Identity ─────────────────────────────────────────────────────────────
// v1.0-blink-slow  → initial flash (this file)
// v2.0-blink-fast  → target after OTA (ota_firebase_fw2_blink.ino)
const String FIRMWARE_VERSION = "v1.0-blink-slow";
const String NODE_ID_OVERRIDE = "ota_test_node_1"; // "" = use MAC address

// ── RTDB root — isolated from production /nodes/ paths ───────────────────────
const String RTDB_ROOT = "nodes_test/";

// ── Pins ──────────────────────────────────────────────────────────────────────
#define LED_PIN  2

// ── OTA State ─────────────────────────────────────────────────────────────────
String NODE_ID             = "";
String rtdb_target_version = "";
String rtdb_target_url     = "";
String rtdb_target_md5     = "";

bool   pending_ota_update = false;
String failed_ota_version = ""; // Guard against re-trying a broken version

// ── App State ─────────────────────────────────────────────────────────────────
unsigned long previousBlinkMillis = 0;
unsigned long config_poll_millis  = 0;
const unsigned long CONFIG_POLL_MS = 60000UL; // Poll every 60 s

// SLOW blink for v1 — visually distinguishable from v2 fast blink
const unsigned long BLINK_INTERVAL_MS = 1000UL;


// ==============================================================================
// FIREBASE RTDB REST HELPERS  (same pattern as m3_v0.1.ino)
// ==============================================================================

void reportStatusToRTDB(String ota_status, String details = "") {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;

  String url = String(DATABASE_URL) + RTDB_ROOT + NODE_ID + "/status.json?auth=" + API_KEY;
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  doc["current_version"] = FIRMWARE_VERSION;
  doc["ota_status"]      = ota_status;
  doc["last_boot_ms"]    = (int)millis();
  doc["wifi_rssi"]       = (int)WiFi.RSSI();
  if (details != "") doc["ota_details"] = details;

  String payload;
  serializeJson(doc, payload);
  int code = http.PUT(payload);
  Serial.printf("[RTDB] reportStatus(%s) → HTTP %d\n", ota_status.c_str(), code);
  http.end();
}

// One-shot RTDB GET for config — same as m3_v0.1 fetchOTAConfig()
void fetchOTAConfig() {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;

  String url = String(DATABASE_URL) + RTDB_ROOT + NODE_ID + "/config.json?auth=" + API_KEY;
  Serial.println("[RTDB] Polling: " + url);
  http.begin(client, url);
  int httpCode = http.GET();

  if (httpCode == HTTP_CODE_OK) {
    String payload = http.getString();
    Serial.println("[RTDB] Raw: " + payload);

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, payload);
    if (!err) {
      if (doc.containsKey("target_url"))     rtdb_target_url     = doc["target_url"].as<String>();
      if (doc.containsKey("target_version")) rtdb_target_version = doc["target_version"].as<String>();
      if (doc.containsKey("target_md5"))     rtdb_target_md5     = doc["target_md5"].as<String>();

      Serial.printf("[RTDB] Config — target=%s url=%s\n",
                    rtdb_target_version.c_str(), rtdb_target_url.c_str());

      if (rtdb_target_version != ""  &&
          rtdb_target_version != FIRMWARE_VERSION &&
          rtdb_target_version != failed_ota_version &&
          rtdb_target_url     != ""  &&
          rtdb_target_url     != "null") {
        Serial.printf("[OTA] Version mismatch: running=%s → target=%s\n",
                      FIRMWARE_VERSION.c_str(), rtdb_target_version.c_str());
        pending_ota_update = true;
      }
    } else {
      Serial.println("[RTDB] JSON parse error: " + String(err.c_str()));
    }
  } else if (httpCode == 404) {
    Serial.println("[RTDB] No config node yet — OK for first flash.");
  } else {
    Serial.printf("[RTDB] fetchOTAConfig HTTP error: %d\n", httpCode);
  }
  http.end();
}


// ==============================================================================
// OTA — DIRECT HTTP STREAM INTO UPDATE PARTITION (no SD card)
// ==============================================================================

void runOTAUpdate() {
  Serial.println("\n=== OTA: Streaming directly into flash partition ===");
  Serial.println("URL: " + rtdb_target_url);

  reportStatusToRTDB("updating", rtdb_target_url);

  WiFiClientSecure client;
  client.setInsecure();

  // Increase timeout — large binaries take time over HTTPS
  client.setTimeout(20000);

  HTTPClient http;
  if (!http.begin(client, rtdb_target_url)) {
    Serial.println("[OTA] http.begin() failed.");
    reportStatusToRTDB("failed", "http.begin failed");
    failed_ota_version = rtdb_target_version;
    pending_ota_update = false;
    return;
  }

  int httpCode = http.GET();
  if (httpCode != HTTP_CODE_OK) {
    Serial.printf("[OTA] HTTP GET error: %d\n", httpCode);
    reportStatusToRTDB("failed", "HTTP " + String(httpCode));
    http.end();
    failed_ota_version = rtdb_target_version;
    pending_ota_update = false;
    return;
  }

  int contentLen = http.getSize();
  Serial.printf("[OTA] Content-Length: %d bytes\n", contentLen);

  if (contentLen <= 0) {
    // Firebase Storage URLs sometimes omit Content-Length — proceed anyway
    Serial.println("[OTA] WARN: Unknown content length, proceeding...");
  }

  WiFiClient* stream = http.getStreamPtr();

  // Use UPDATE_SIZE_UNKNOWN if server doesn't send Content-Length
  size_t updateSize = (contentLen > 0) ? (size_t)contentLen : UPDATE_SIZE_UNKNOWN;

  if (!Update.begin(updateSize)) {
    Serial.printf("[OTA] Update.begin() failed — error %d\n", (int)Update.getError());
    reportStatusToRTDB("failed", "Update.begin error " + String(Update.getError()));
    http.end();
    failed_ota_version = rtdb_target_version;
    pending_ota_update = false;
    return;
  }

  if (rtdb_target_md5.length() > 0) {
    Update.setMD5(rtdb_target_md5.c_str());
    Serial.println("[OTA] MD5 set: " + rtdb_target_md5);
  }

  Serial.println("[OTA] Streaming into OTA partition...");
  size_t written = Update.writeStream(*stream);
  Serial.printf("[OTA] Written: %d bytes\n", (int)written);

  http.end();

  if (Update.end()) {
    if (Update.isFinished()) {
      Serial.println("[OTA] Flash SUCCESS — rebooting into new firmware...");
      reportStatusToRTDB("idle");
      delay(500);
      ESP.restart();
    } else {
      Serial.println("[OTA] Update not finished — incomplete download?");
      reportStatusToRTDB("failed", "Update not finished");
      failed_ota_version = rtdb_target_version;
    }
  } else {
    Serial.printf("[OTA] Update.end() error: %d\n", (int)Update.getError());
    reportStatusToRTDB("failed", "Update.end error " + String(Update.getError()));
    failed_ota_version = rtdb_target_version;
  }

  pending_ota_update = false;
}


// ==============================================================================
// CUSTOM APPLICATION LOGIC — SLOW Blink (v1 identity)
// ==============================================================================

void setupCustomApplication() {
  pinMode(LED_PIN, OUTPUT);
  Serial.printf("[APP] FW1 ready — SLOW blink (%lu ms)\n", BLINK_INTERVAL_MS);
}

void loopCustomApplication() {
  unsigned long now = millis();

  // SLOW blink — 1 second, visually confirms this is still v1
  if (now - previousBlinkMillis >= BLINK_INTERVAL_MS) {
    previousBlinkMillis = now;
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    Serial.printf("[BLINK] v1 SLOW @ %lu ms\n", now);
  }

  // Periodic RTDB config poll
  if (WiFi.status() == WL_CONNECTED && now - config_poll_millis >= CONFIG_POLL_MS) {
    config_poll_millis = now;
    fetchOTAConfig();
  }

  // Execute pending OTA (halts blink loop during update)
  if (pending_ota_update) {
    runOTAUpdate();
  }
}


// ==============================================================================
// ARDUINO ENTRY POINTS
// ==============================================================================

void setup() {
  Serial.begin(115200);

  NODE_ID = (NODE_ID_OVERRIDE != "") ? NODE_ID_OVERRIDE : String(WiFi.macAddress());
  if (NODE_ID_OVERRIDE == "") { NODE_ID.replace(":", ""); NODE_ID.toLowerCase(); }

  Serial.println("\n==========================================");
  Serial.println("  FW1 Blink Test — SLOW (v1)  ");
  Serial.printf ("  Node: %s | Version: %s\n", NODE_ID.c_str(), FIRMWARE_VERSION.c_str());
  Serial.println("==========================================\n");

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WiFi] Connecting");
  while (WiFi.status() != WL_CONNECTED) { Serial.print("."); delay(500); }
  Serial.printf("\n[WiFi] Connected — IP: %s\n", WiFi.localIP().toString().c_str());

  reportStatusToRTDB("idle");
  fetchOTAConfig();
  config_poll_millis = millis();

  setupCustomApplication();

  // Apply any OTA triggered at boot immediately
  if (pending_ota_update) runOTAUpdate();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Lost — reconnecting...");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    unsigned long t = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t < 10000) delay(500);
    if (WiFi.status() == WL_CONNECTED) Serial.println("[WiFi] Reconnected.");
  }

  loopCustomApplication();
}
