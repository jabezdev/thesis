// ── Project Sipat Banwa — Advanced Firebase OTA Base Firmware ────────────────
// This file serves as the core template for all fleet nodes.
// It handles WiFi connectivity, Firebase RTDB config synchronization, and
// seamless OTA updates (upgrades/rollbacks) via HTTPUpdate.
//
// ⚠️ DO NOT MODIFY THE CORE OTA LOGIC ⚠️
// Place your custom application logic in the designated sections below.

#include <WiFi.h>
#include <WiFiClientSecure.h>      // Required for HTTPS downloads (Firebase Storage)
#include <Firebase_ESP_Client.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

// ── Configuration ─────────────────────────────────────────────────────────────
#define WIFI_SSID     "steve jabz"
#define WIFI_PASSWORD "12345678"

#define API_KEY      "AIzaSyCDsUNnLZuK8EyBa1XRfKrgxVkykFK-WVg"
#define DATABASE_URL "https://panahon-live-default-rtdb.asia-southeast1.firebasedatabase.app/"

// ── Node Identity ─────────────────────────────────────────────────────────────
// FIRMWARE_VERSION: Update this string every time you compile a new version.
// NODE_ID_OVERRIDE: Leave "" to auto-generate a unique ID from the MAC address.
//                   Set to a fixed string like "weather_node_001" if you need
//                   a human-readable name that survives re-flashing.
const String FIRMWARE_VERSION = "v1.0";
const String NODE_ID_OVERRIDE = "simulated_node_01"; // "" = use MAC address

// ── Firebase Core Objects ─────────────────────────────────────────────────────
FirebaseData stream;
FirebaseData fbdo;    // For one-shot reads/writes (status reporting, boot config)
FirebaseAuth auth;
FirebaseConfig config;

// ── Runtime Identity ──────────────────────────────────────────────────────────
String NODE_ID = "";

// ── Online Configuration State ────────────────────────────────────────────────
// Initialised to "" so the boot-time fetch drives the first comparison cleanly.
String rtdb_target_version = "";
String rtdb_target_url     = "";
bool   pending_ota_update  = false;

// ── Example custom business config fetched from RTDB ──────────────────────────
int online_blink_interval = 1000;


// ==============================================================================
// ── CUSTOM GLOBAL VARIABLES ───────────────────────────────────────────────────
// Declare any sensors, pins, and custom global variables here.
// ==============================================================================

const int LED_PIN = 2;
unsigned long previousBlinkMillis = 0;


// ==============================================================================
//  CORE OTA FUNCTIONS (DO NOT MODIFY)
// ==============================================================================

// Writes the node's running version and OTA status to RTDB so the dashboard
// can confirm what is actually running on each node.
void reportStatusToRTDB(String ota_status, String details = "") {
  if (!Firebase.ready()) return;
  String path = "/nodes/" + NODE_ID + "/status";
  FirebaseJson statusJson;
  statusJson.set("current_version", FIRMWARE_VERSION);
  statusJson.set("ota_status",      ota_status);         // "idle" | "updating" | "failed"
  statusJson.set("last_boot_ms",    (int)millis());
  if (details != "") statusJson.set("ota_details", details);
  if (!Firebase.RTDB.updateNode(&fbdo, path.c_str(), &statusJson)) {
    Serial.printf("[RTDB] Status report failed: %s\n", fbdo.errorReason().c_str());
  }
}

void performOTAUpdate(String url) {
  Serial.print("\n=== STARTING INTERNET OTA UPDATE ===\nDownloading firmware from: ");
  Serial.println(url);

  reportStatusToRTDB("updating", url);

  // WiFiClientSecure is required — Firebase Storage serves over HTTPS only.
  // setInsecure() skips certificate verification, which is acceptable for
  // firmware downloads on a private fleet (the URL itself is the secret).
  WiFiClientSecure secureClient;
  secureClient.setInsecure();

  httpUpdate.setLedPin(LED_PIN, LOW); // Flash the LED during download
  t_httpUpdate_return ret = httpUpdate.update(secureClient, url);

  switch (ret) {
    case HTTP_UPDATE_FAILED:
      Serial.printf("[OTA] FAILED Error (%d): %s\n",
                    httpUpdate.getLastError(),
                    httpUpdate.getLastErrorString().c_str());
      reportStatusToRTDB("failed", httpUpdate.getLastErrorString());
      break;
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("[OTA] Server says no update available.");
      reportStatusToRTDB("idle");
      break;
    case HTTP_UPDATE_OK:
      // Device reboots automatically here; the new firmware will call
      // reportStatusToRTDB("idle") on its own boot, confirming the version change.
      Serial.println("[OTA] Download OK — rebooting into new firmware...");
      break;
  }
}

void streamCallback(FirebaseStream data) {
  Serial.printf("[RTDB] Config change at path: %s\n", data.dataPath().c_str());

  if (data.dataType() == "json") {
    FirebaseJson *json = data.jsonObjectPtr();
    FirebaseJsonData result;

    if (json->get(result, "target_url"))     rtdb_target_url       = result.to<String>();
    if (json->get(result, "target_version")) rtdb_target_version   = result.to<String>();
    if (json->get(result, "blink_interval")) {
      online_blink_interval = result.to<int>();
      Serial.printf("[RTDB] Updated blink_interval: %d\n", online_blink_interval);
    }
  } else {
    String path = data.dataPath();
    if      (path == "/target_url")     rtdb_target_url     = data.stringData();
    else if (path == "/target_version") rtdb_target_version = data.stringData();
    else if (path == "/blink_interval") {
      online_blink_interval = data.intData();
      Serial.printf("[RTDB] Updated blink_interval: %d\n", online_blink_interval);
    }
  }

  // Using != ensures the node always converges to whatever version Firebase says,
  // which enables clean rollbacks — just set target_version to an older version.
  if (rtdb_target_version != ""        &&
      rtdb_target_version != FIRMWARE_VERSION &&
      rtdb_target_url     != ""        &&
      rtdb_target_url     != "null") {
    Serial.printf("[OTA] Version mismatch! Current: %s → Target: %s\n",
                  FIRMWARE_VERSION.c_str(), rtdb_target_version.c_str());
    // Flag the loop to execute the OTA update outside the callback context.
    // Calling HTTPUpdate inside an RTDB callback thread can crash the device.
    pending_ota_update = true;
  }
}

void streamTimeoutCallback(bool timeout) {
  if (timeout) Serial.println("[RTDB] Stream timeout, resuming...");
}

// Performs a one-shot RTDB GET at boot to pick up any config that was already
// set before this node connected — the stream only fires on future *changes*.
void fetchInitialConfig() {
  String configPath = "/nodes/" + NODE_ID + "/config";
  Serial.println("[RTDB] Fetching initial config from: " + configPath);

  if (Firebase.RTDB.getJSON(&fbdo, configPath.c_str())) {
    FirebaseJson *json = fbdo.jsonObjectPtr();
    FirebaseJsonData result;

    if (json->get(result, "target_url"))     rtdb_target_url       = result.to<String>();
    if (json->get(result, "target_version")) rtdb_target_version   = result.to<String>();
    if (json->get(result, "blink_interval")) online_blink_interval = result.to<int>();

    Serial.printf("[RTDB] Initial config — target: %s, url: %s, blink: %d\n",
                  rtdb_target_version.c_str(), rtdb_target_url.c_str(), online_blink_interval);

    if (rtdb_target_version != ""        &&
        rtdb_target_version != FIRMWARE_VERSION &&
        rtdb_target_url     != ""        &&
        rtdb_target_url     != "null") {
      Serial.printf("[OTA] Boot-time version mismatch! Current: %s → Target: %s\n",
                    FIRMWARE_VERSION.c_str(), rtdb_target_version.c_str());
      pending_ota_update = true;
    }
  } else {
    // Node is new or config path doesn't exist yet — that's fine.
    Serial.printf("[RTDB] No initial config found (%s)\n", fbdo.errorReason().c_str());
  }
}

void setupCoreWifiAndFirebase() {
  Serial.begin(115200);

  // Resolve Node ID — MAC address gives each node a unique, stable identity
  // without any manual configuration when flashing a fleet.
  if (NODE_ID_OVERRIDE != "") {
    NODE_ID = NODE_ID_OVERRIDE;
  } else {
    NODE_ID = WiFi.macAddress();
    NODE_ID.replace(":", "");  // e.g. "a1b2c3d4e5f6"
    NODE_ID.toLowerCase();
  }

  Serial.println("\n-------------------------------------------");
  Serial.println("  Sipat Banwa - Firebase Base Node  ");
  Serial.printf("  Node ID: %s | Firmware: %s\n", NODE_ID.c_str(), FIRMWARE_VERSION.c_str());
  Serial.println("-------------------------------------------\n");

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WiFi] Connecting");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(500);
  }
  Serial.printf("\n[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());

  config.api_key    = API_KEY;
  config.database_url = DATABASE_URL;

  if (Firebase.signUp(&config, &auth, "", "")) {
    Serial.println("[Firebase] Auth OK (Anonymous)");
  } else {
    Serial.printf("[Firebase] Auth FAILED: %s\n", config.signer.signupError.message.c_str());
  }

  config.token_status_callback = tokenStatusCallback;
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  // Wait for the token before making any RTDB calls.
  Serial.print("[Firebase] Waiting for token");
  while (!Firebase.ready()) {
    Serial.print(".");
    delay(300);
  }
  Serial.println(" OK");

  // 1. Report this node's current running version to RTDB immediately on boot.
  reportStatusToRTDB("idle");

  // 2. Read any config already in RTDB (handles boot after a crash or power cycle).
  fetchInitialConfig();

  // 3. Subscribe to live config changes for real-time updates and rollbacks.
  String streamPath = "/nodes/" + NODE_ID + "/config";
  Serial.println("[RTDB] Mounting config listener on: " + streamPath);
  if (!Firebase.RTDB.beginStream(&stream, streamPath.c_str())) {
    Serial.printf("[RTDB] Stream begin error: %s\n\n", stream.errorReason().c_str());
  } else {
    Firebase.RTDB.setStreamCallback(&stream, streamCallback, streamTimeoutCallback);
  }
}

void handleCoreOTA() {
  // Reconnect WiFi silently if the connection drops.
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Disconnected — reconnecting...");
    WiFi.reconnect();
    unsigned long t = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t < 10000) delay(500);
    if (WiFi.status() == WL_CONNECTED) Serial.println("[WiFi] Reconnected.");
  }

  // Execute a pending OTA update safely outside the RTDB callback thread.
  if (pending_ota_update && rtdb_target_url != "" && rtdb_target_url != "null") {
    pending_ota_update = false;
    Serial.println("\n[OTA] Halting custom application logic, initiating download...");
    performOTAUpdate(rtdb_target_url);
  }
}


// ==============================================================================
// ── CUSTOM APPLICATION LOGIC ──────────────────────────────────────────────────
// Implement your specific sensors, data logging, and business logic below.
// ==============================================================================

void setupCustomApplication() {
  // Setup your sensors, pins, ModBus, SD cards, etc.
  pinMode(LED_PIN, OUTPUT);
}

void loopCustomApplication() {
  // Your main loop logic goes here!
  // Example: simple non-blocking blink driven by the RTDB blink_interval config.
  unsigned long currentMillis = millis();
  if (currentMillis - previousBlinkMillis >= (unsigned long)online_blink_interval) {
    previousBlinkMillis = currentMillis;
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
  }
}


// ==============================================================================
// ── MAIN ARDUINO ENTRY ────────────────────────────────────────────────────────
// ==============================================================================

void setup() {
  setupCoreWifiAndFirebase();
  setupCustomApplication();
}

void loop() {
  // 1. Maintain connectivity, check for OTA updates in the background.
  handleCoreOTA();

  // 2. Run your dedicated application logic.
  loopCustomApplication();
}
