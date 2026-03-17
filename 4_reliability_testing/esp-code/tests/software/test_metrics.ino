/*
  Test: Reliability Metrics
  Description: Verify loop jitter tracking and NVS-based boot counting.
  
  Instructions:
  1. Open Serial Monitor at 115200 baud.
  2. Press the Reset button on the ESP32 to see the boot count increment (stored in NVS).
*/

#include <Preferences.h>

Preferences prefs;
uint32_t g_boot_count = 0;
uint32_t g_loop_jitter_max_ms = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- Reliability Metrics Test ---");

  // Boot count from NVS
  prefs.begin("sys", false);
  g_boot_count = prefs.getUInt("boot_count", 0) + 1;
  prefs.putUInt("boot_count", g_boot_count);
  prefs.end();

  Serial.printf("Current Boot Count: %u\n", g_boot_count);
}

void loop() {
  static uint32_t lastRun = millis();
  uint32_t nowMs = millis();
  
  // Calculate jitter (how much longer than 1000ms did we wait?)
  uint32_t jitter = (nowMs - lastRun > 1000) ? (nowMs - lastRun - 1000) : 0;
  if (jitter > g_loop_jitter_max_ms) g_loop_jitter_max_ms = jitter;
  lastRun = nowMs;

  Serial.printf("Loop Jitter: %u ms | Max Jitter: %u ms\n", jitter, g_loop_jitter_max_ms);

  // Introduce some artificial delay to cause jitter
  if (random(0, 100) > 90) {
    Serial.println("  [Simulating Jitter...]");
    delay(random(10, 50));
  }

  delay(1000);
}
