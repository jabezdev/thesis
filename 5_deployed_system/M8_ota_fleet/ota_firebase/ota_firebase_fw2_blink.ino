// ── OTA Firebase Test — Firmware 2 (OTA Update Target) ───────────────────────
// This is the firmware you upload to Firebase Storage and OTA into.
// Architecture mirrors m3_v0.1.ino exactly (raw HTTPClient REST, SD staging).
//
// After flashing ota_firebase_fw1_blink.ino and setting the RTDB config,
// the device OTAs itself into THIS firmware and reboots.
// The FAST blink (150 ms) visually confirms the update succeeded.
//
// RTDB Node Path : nodes_test/ota_test_node_1/
// Node ID        : ota_test_node_1  (same as fw1 — same physical device)
// FIRMWARE       : v2.0-blink-fast  (FAST 150 ms blink)
//
// HOW TO USE:
//   1. Compile this sketch → export .bin (Sketch > Export Compiled Binary).
//   2. Upload the .bin to Firebase Storage.
//   3. Get its download URL (signed or public).
//   4. In RTDB set nodes_test/ota_test_node_1/config :
//         {
//           "target_version": "v2.0-blink-fast",
//           "target_url":     "<URL from step 3>",
//           "target_md5":     "<optional MD5>"
//         }
//   5. Device running fw1 picks this up within 60 s, OTAs, reboots.
//   6. Board now shows FAST blink — v2 confirmed.
//
// NOTE: Do NOT flash this directly; let fw1 OTA into it.
//       (You CAN flash it directly to test that it also checks for OTA back.)

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Update.h>
#include <SD.h>
#include <SPI.h>
#include <ArduinoJson.h>
#include <esp_system.h>

// ── WiFi ──────────────────────────────────────────────────────────────────────
#define WIFI_SSID     "onsay"
#define WIFI_PASSWORD "11111111"

// ── Firebase RTDB REST ────────────────────────────────────────────────────────
#define API_KEY      "AIzaSyCDsUNnLZuK8EyBa1XRfKrgxVkykFK-WVg"
#define DATABASE_URL "https://panahon-live-default-rtdb.asia-southeast1.firebasedatabase.app/"

// ── Node Identity ─────────────────────────────────────────────────────────────
// Same NODE_ID as fw1 — same physical board, just updated firmware version.
const String FIRMWARE_VERSION = "v2.0-blink-fast";
const String NODE_ID_OVERRIDE = "ota_test_node_1";

// ── RTDB root — same isolated path as fw1 ────────────────────────────────────
const String RTDB_ROOT = "nodes_test/";

// ── Pins ──────────────────────────────────────────────────────────────────────
#define LED_PIN  2
#define SD_CS    5

// ── OTA State ─────────────────────────────────────────────────────────────────
String NODE_ID             = "";
String rtdb_target_version = "";
String rtdb_target_url     = "";
String rtdb_target_md5     = "";

enum OTAState { OTA_IDLE, OTA_DOWNLOADING, OTA_FLASHING };
OTAState ota_state = OTA_IDLE;

bool   pending_ota_update = false;
String failed_ota_version = "";

// ── App State ─────────────────────────────────────────────────────────────────
unsigned long previousBlinkMillis = 0;
unsigned long config_poll_millis  = 0;
const unsigned long CONFIG_POLL_MS = 60000UL;

// FAST blink for v2 — visually distinguishable from v1 slow blink
const unsigned long BLINK_INTERVAL_MS = 150UL;


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
  if (ota_state != OTA_IDLE) return;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;

  String url = String(DATABASE_URL) + RTDB_ROOT + NODE_ID + "/config.json?auth=" + API_KEY;
  http.begin(client, url);
  int httpCode = http.GET();

  if (httpCode == HTTP_CODE_OK) {
    String payload = http.getString();
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
// OTA — SD STAGE + ESP32 UPDATE  (same pattern as m3_v0.1.ino)
// ==============================================================================

void runOTAUpdate() {
  Serial.println("\n=== OTA: Downloading to SD → Flashing ===");
  Serial.println("URL: " + rtdb_target_url);

  reportStatusToRTDB("downloading_to_sd", rtdb_target_url);
  ota_state = OTA_DOWNLOADING;

  // ── Step 1: Download binary to SD ────────────────────────────────────────
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;

  bool download_ok = false;

  if (http.begin(client, rtdb_target_url)) {
    int httpCode = http.GET();
    if (httpCode == HTTP_CODE_OK) {
      int contentLen = http.getSize();
      WiFiClient* stream = http.getStreamPtr();

      File file = SD.open("/update_test.bin", FILE_WRITE);
      if (file) {
        uint8_t buf[2048];
        int total_written = 0;

        while (http.connected() && (contentLen > 0 || contentLen == -1)) {
          size_t avail = stream->available();
          if (avail > 0) {
            int c = stream->readBytes(buf, min(avail, sizeof(buf)));
            file.write(buf, c);
            total_written += c;
            if (contentLen > 0) contentLen -= c;
          } else {
            delay(100);
          }
        }
        file.close();

        if (total_written > 0) {
          Serial.printf("[OTA] Downloaded %d bytes to /update_test.bin\n", total_written);
          download_ok = true;
        } else {
          Serial.println("[OTA] 0 bytes written — aborting.");
          reportStatusToRTDB("failed", "Download 0 bytes");
        }
      } else {
        Serial.println("[OTA] Failed to open /update_test.bin on SD.");
        reportStatusToRTDB("failed", "SD open error");
      }
    } else {
      Serial.printf("[OTA] HTTP GET error: %d\n", httpCode);
      reportStatusToRTDB("failed", "HTTP " + String(httpCode));
    }
    http.end();
  } else {
    Serial.println("[OTA] http.begin() failed.");
    reportStatusToRTDB("failed", "http.begin failed");
  }

  if (!download_ok) {
    failed_ota_version = rtdb_target_version;
    pending_ota_update = false;
    ota_state = OTA_IDLE;
    return;
  }

  // ── Step 2: Flash from SD ────────────────────────────────────────────────
  ota_state = OTA_FLASHING;
  reportStatusToRTDB("flashing", "SD local update");
  delay(500);

  File updateFile = SD.open("/update_test.bin");
  if (!updateFile) {
    Serial.println("[OTA] Cannot open /update_test.bin for flashing.");
    reportStatusToRTDB("failed", "SD open error on flash");
    failed_ota_version = rtdb_target_version;
    ota_state = OTA_IDLE;
    pending_ota_update = false;
    return;
  }

  size_t updateSize = updateFile.size();
  if (rtdb_target_md5.length() > 0) Update.setMD5(rtdb_target_md5.c_str());

  if (Update.begin(updateSize)) {
    Serial.printf("[OTA] Writing %d bytes to OTA partition...\n", (int)updateSize);
    size_t written = Update.writeStream(updateFile);
    updateFile.close();

    if (written == updateSize && Update.end()) {
      Serial.println("[OTA] Flash SUCCESS — rebooting...");
      reportStatusToRTDB("idle");
      delay(1000);
      ESP.restart();
    } else {
      Serial.printf("[OTA] Flash error: written=%d/%d err=%d\n",
                    (int)written, (int)updateSize, (int)Update.getError());
      reportStatusToRTDB("failed", "Write error " + String(Update.getError()));
      failed_ota_version = rtdb_target_version;
    }
  } else {
    updateFile.close();
    Serial.println("[OTA] Update.begin() failed — not enough partition space?");
    reportStatusToRTDB("failed", "Update.begin failed");
    failed_ota_version = rtdb_target_version;
  }

  ota_state = OTA_IDLE;
  pending_ota_update = false;
}


// ==============================================================================
// CUSTOM APPLICATION LOGIC — FAST Blink (v2 identity)
// ==============================================================================

void setupCustomApplication() {
  pinMode(LED_PIN, OUTPUT);
  Serial.printf("[APP] FW2 ready — FAST blink (%lu ms)\n", BLINK_INTERVAL_MS);
}

void loopCustomApplication() {
  // FAST blink — 150 ms, confirms this is v2 after successful OTA
  unsigned long now = millis();
  if (now - previousBlinkMillis >= BLINK_INTERVAL_MS) {
    previousBlinkMillis = now;
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    Serial.printf("[BLINK] v2 FAST @ %lu ms\n", now);
  }

  // Periodic RTDB config poll (supports rollback: set target back to v1.0-blink-slow)
  if (WiFi.status() == WL_CONNECTED && now - config_poll_millis >= CONFIG_POLL_MS) {
    config_poll_millis = now;
    fetchOTAConfig();
  }

  // Execute pending OTA
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
  Serial.println("  FW2 Blink Test — FAST (v2)  ");
  Serial.printf ("  Node: %s | Version: %s\n", NODE_ID.c_str(), FIRMWARE_VERSION.c_str());
  Serial.println("==========================================\n");

  SPI.begin(18, 19, 23, SD_CS);
  if (!SD.begin(SD_CS)) {
    Serial.println("[SD] WARN: SD card not found — OTA staging will fail.");
  } else {
    Serial.println("[SD] OK");
  }

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
