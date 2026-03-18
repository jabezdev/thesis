/*
  Test: Task Isolation (Integration)
  Description: Validates that a hung Core 0 (Network) does not stall Core 1 (Sensors).
  
  Instructions:
  1. Open Serial Monitor at 115200 baud.
  2. Core 1 will report loop jitter every second.
  3. After 10 seconds, Core 0 will "Hang" in a while(1) loop.
  4. Observe if Core 1 continues to run and report jitter.
*/

#include <Arduino.h>

volatile bool g_should_hang = false;
volatile uint32_t g_core1_iterations = 0;
uint32_t g_max_jitter = 0;

void core0Task(void* pvParameters) {
  Serial.println("[Core 0] Task Started.");
  uint32_t start = millis();
  
  while (true) {
    if (g_should_hang) {
      Serial.println("!!! [Core 0] EMULATING FATAL HANG (while(1)) !!!");
      while(1) {
        // Starve the CPU on Core 0
        yield(); // Still allow some background tasks if necessary, or remove for total hang
      }
    }
    
    if (millis() - start > 10000) {
      g_should_hang = true;
    }
    
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- Task Isolation & Jitter Test ---");
  Serial.println("Core 1 (Main) handles sensors. Core 0 handles comms.");
  Serial.println("In 10 seconds, Core 0 will hang. Core 1 should stay alive.\n");

  xTaskCreatePinnedToCore(
    core0Task,
    "Core0Task",
    2048,
    NULL,
    1,
    NULL,
    0
  );
}

void loop() {
  static uint32_t lastRun = millis();
  uint32_t nowMs = millis();
  
  // Logic from reliability_test.ino
  uint32_t jitter = (nowMs - lastRun > 1000) ? (nowMs - lastRun - 1000) : 0;
  if (jitter > g_max_jitter) g_max_jitter = jitter;
  lastRun = nowMs;

  g_core1_iterations++;
  
  Serial.printf("[Core 1] Iteration: %lu | Jitter: %u ms | Max Jitter: %u ms | Core 0 Status: %s\n", 
                g_core1_iterations, jitter, g_max_jitter, g_should_hang ? "HUNG" : "OK");

  if (g_should_hang && g_core1_iterations % 5 == 0) {
    Serial.println("  >> SUCCESS: Core 1 is still running despite Core 0 hang.");
  }

  delay(1000);
}
