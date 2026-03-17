/*
  Test: SD Pending Row Count
  Description: Verify the logic for counting rows in a CSV file (used for pending uploads).
  
  Instructions:
  1. Ensure SD card is inserted.
  2. The test will create a mock /pending_test.csv and count its rows.
*/

#include <SPI.h>
#include <SD.h>

#define SD_CS 5

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

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- SD Pending Logic Test ---");

  if (!SD.begin(SD_CS)) {
    Serial.println("SD Initialisation failed!");
    return;
  }

  const char* path = "/pending_test.csv";
  SD.remove(path);

  Serial.println("Creating test file with 1 header and 5 data rows...");
  File f = SD.open(path, FILE_WRITE);
  if (f) {
    f.println("col1,col2"); // Header
    f.println("val1,val2"); // Row 1
    f.println("val3,val4"); // Row 2
    f.println("val5,val6"); // Row 3
    f.println("val7,val8"); // Row 4
    f.println("val9,val10"); // Row 5
    f.close();
  }

  uint32_t rows = countFileRows(path);
  Serial.printf("Rows detected (excluding header): %u\n", rows);
  
  if (rows == 5) Serial.println("PASS: Row count is correct.");
  else Serial.println("FAIL: Row count mismatch.");
}

void loop() {}
