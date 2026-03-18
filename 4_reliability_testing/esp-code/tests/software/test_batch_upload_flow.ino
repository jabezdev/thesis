/*
  Test: Batch Upload / Backlog Flow (Software)
  Description: Simulates "WiFi Down" to stack rows in pending.csv, then "WiFi Up" to flush them.
  
  Instructions:
  1. Ensure SD card is inserted.
  2. Open Serial Monitor at 115200 baud.
  3. The test will automatically generate 10 rows while "offline", then attempt to "upload" them.
*/

#include <SPI.h>
#include <SD.h>

#define SD_CS 5
#define PENDING_FILE "/pending_test_batch.csv"

struct MockReading {
  char timestamp[20];
  float value;
};

// Simplified version of the firmware's row-counting logic
uint32_t countFileRows(const char* path) {
  if (!SD.exists(path)) return 0;
  File f = SD.open(path, FILE_READ);
  if (!f) return 0;
  uint32_t count = 0;
  bool firstLine = true;
  while (f.available()) {
    if (f.read() == '\n') {
      if (firstLine) firstLine = false;
      else count++;
    }
  }
  f.close();
  return count;
}

void sdWriteHeader(const char* path) {
  if (SD.exists(path)) return;
  File f = SD.open(path, FILE_WRITE);
  if (f) {
    f.println("timestamp,value");
    f.close();
  }
}

void sdAppendRow(const char* path, MockReading r) {
  File f = SD.open(path, FILE_APPEND);
  if (f) {
    f.printf("%s,%.2f\n", r.timestamp, r.value);
    f.close();
  }
}

// Mock of the flushPending function
void mockFlushPending() {
  if (!SD.exists(PENDING_FILE)) return;

  File f = SD.open(PENDING_FILE, FILE_READ);
  if (!f) return;

  Serial.println("[MockUpload] Starting flush...");
  if (f.available()) f.readStringUntil('\n'); // skip header

  int uploaded = 0;
  while (f.available()) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (line.length() > 0) {
      Serial.printf("[MockUpload] UPLOADING: %s\n", line.c_str());
      uploaded++;
      delay(100); // Simulate network latency
    }
  }
  f.close();

  Serial.printf("[MockUpload] Done. Total: %d\n", uploaded);
  SD.remove(PENDING_FILE);
  Serial.println("[MockUpload] Pending file cleared.");
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- Batch Upload Logic Test ---");

  if (!SD.begin(SD_CS)) {
    Serial.println("SD Init Failed!");
    return;
  }

  SD.remove(PENDING_FILE);
  sdWriteHeader(PENDING_FILE);

  Serial.println("Step 1: Simulating WiFi DOWN. Logging 10 samples to SD...");
  for (int i = 0; i < 10; i++) {
    MockReading r;
    snprintf(r.timestamp, sizeof(r.timestamp), "2026-03-18 08:00:%02d", i);
    r.value = (float)i * 1.5f;
    sdAppendRow(PENDING_FILE, r);
    Serial.printf("  Logged sample %d\n", i);
  }

  uint32_t pendingCount = countFileRows(PENDING_FILE);
  Serial.printf("Step 2: Pending rows verified: %u\n", pendingCount);

  if (pendingCount == 10) {
    Serial.println("Step 3: Simulating WiFi UP. Flushing backlog...");
    mockFlushPending();
    
    if (!SD.exists(PENDING_FILE)) {
      Serial.println("\nFINAL RESULT: PASS - All rows processed and file cleared.");
    } else {
      Serial.println("\nFINAL RESULT: FAIL - Pending file still exists.");
    }
  } else {
    Serial.println("\nFINAL RESULT: FAIL - Incorrect pending row count.");
  }
}

void loop() {}
