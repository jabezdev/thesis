/*
  Test: RTC (DS3231)
  Description: Verify I2C communication, set/read time, and check oscillator.
  
  Instructions:
  1. Open Serial Monitor at 115200 baud.
  2. The test will initialize the RTC and print the current time every second.
  3. If "RTC is NOT running" appears, it means the battery might be dead or the oscillator is off.
*/

#include <Wire.h>
#include "RTClib.h"

RTC_DS3231 rtc;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- RTC Unit Test + I2C Scan ---");

  // Explicitly initialize I2C on pins 21 and 22
  Serial.println("Initialzing I2C on SDA=21, SCL=22...");
  Wire.begin(21, 22);

  // Quick I2C Scan
  Serial.println("Scanning I2C bus...");
  byte error, address;
  int nDevices = 0;
  for(address = 1; address < 127; address++ ) {
    Wire.beginTransmission(address);
    error = Wire.endTransmission();
    if (error == 0) {
      Serial.print("I2C device found at address 0x");
      if (address<16) Serial.print("0");
      Serial.print(address,HEX);
      Serial.println("  !");
      nDevices++;
    }
  }
  if (nDevices == 0) Serial.println("No I2C devices found\n");
  else Serial.println("Scan done\n");

  if (!rtc.begin()) {
    Serial.println("Couldn't find RTC. Check wiring!");
    while (1) delay(10);
  }
}

void loop() {
  DateTime now = rtc.now();

  Serial.print(now.year(), DEC);
  Serial.print('/');
  Serial.print(now.month(), DEC);
  Serial.print('/');
  Serial.print(now.day(), DEC);
  Serial.print(" ");
  Serial.print(now.hour(), DEC);
  Serial.print(':');
  Serial.print(now.minute(), DEC);
  Serial.print(':');
  Serial.print(now.second(), DEC);
  Serial.println();

  Serial.print(" Temperature: ");
  Serial.print(rtc.getTemperature());
  Serial.println(" C");

  delay(1000);
}
