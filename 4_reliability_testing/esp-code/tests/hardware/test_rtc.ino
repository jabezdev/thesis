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
  Serial.println("\n--- RTC Unit Test ---");

  if (!rtc.begin()) {
    Serial.println("Couldn't find RTC. Check wiring!");
    while (1) delay(10);
  }

  if (rtc.lostPower()) {
    Serial.println("RTC lost power, let's set the time!");
    // Following line sets the RTC to the date & time this sketch was compiled
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
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
