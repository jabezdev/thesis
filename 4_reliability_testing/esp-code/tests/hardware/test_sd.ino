/*
  Test: SD Card
  Description: Verify SPI initialization, file creation, writing, and reading.
  
  Instructions:
  1. Open Serial Monitor at 115200 baud.
  2. Pin SD_CS = 5.
  3. Ensure a microSD card (FAT32) is inserted.
*/

#include <SPI.h>
#include <SD.h>

#define SD_CS 5

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- SD Card Unit Test ---");
  
  SPI.begin(18, 19, 23, SD_CS);  // SCK=18, MISO=19, MOSI=23, CS=5
  if (!SD.begin(SD_CS)) {
    Serial.println("SD Card Initialization Failed!");
    return;
  }
  Serial.println("SD Card Initialized.");

  uint8_t cardType = SD.cardType();
  if (cardType == CARD_NONE) {
    Serial.println("No SD card attached");
    return;
  }

  Serial.print("SD Card Type: ");
  if (cardType == CARD_MMC) Serial.println("MMC");
  else if (cardType == CARD_SD) Serial.println("SDSC");
  else if (cardType == CARD_SDHC) Serial.println("SDHC");
  else Serial.println("UNKNOWN");

  uint64_t cardSize = SD.cardSize() / (1024 * 1024);
  Serial.printf("SD Card Size: %lluMB\n", cardSize);

  // Write Test
  Serial.println("Writing to /test.txt...");
  File file = SD.open("/test.txt", FILE_WRITE);
  if (file) {
    file.println("Sipat Banwa SD Test OK");
    file.close();
    Serial.println("Write Success.");
  } else {
    Serial.println("Write Failed.");
  }

  // Read Test
  Serial.println("Reading from /test.txt...");
  file = SD.open("/test.txt");
  if (file) {
    while (file.available()) {
      Serial.write(file.read());
    }
    file.close();
    Serial.println("\nRead Success.");
  } else {
    Serial.println("Read Failed.");
  }
}

void loop() {}
