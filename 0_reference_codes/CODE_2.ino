#include <Wire.h>
#include "RTClib.h"
#include <SPI.h>
#include <SD.h>
#include <ModbusMaster.h>

#define WIFI_POWER_PIN 13   // MOSFET gate for WiFi power

ModbusMaster node;

RTC_DS3231 rtc;
File myFile;

const int CS = 5;   // SD card CS

String currentDateTime;

float temperature = 0.0;
float humidity = 0.0;

void setup() {

  Serial.begin(115200);

  // WiFi MOSFET control
  pinMode(WIFI_POWER_PIN, OUTPUT);
  digitalWrite(WIFI_POWER_PIN, HIGH);   // turn WiFi ON

  Serial1.begin(9600, SERIAL_8N1, 16, 17); // RX=16, TX=17
  node.begin(1, Serial1);

  Serial.println("Modbus initialized...");
  while (!Serial);

  // RTC INIT
  if (!rtc.begin()) {
    Serial.println("Couldn't find RTC.");
    while (1);
  }

  if (rtc.lostPower()) {
    Serial.println("RTC lost power, set default time:");
    rtc.adjust(DateTime(2025, 6, 8, 17, 25, 0));
  }

  Serial.println("RTC Module Initialized.");

  // SD INIT
  Serial.println("Initializing SD card...");
  SPI.begin(18, 19, 23, CS);

  if (!SD.begin(CS)) {
    Serial.println("SD Initialization failed!");
    while (1);
  }

  Serial.println("SD Initialization done.");
  Serial.println("To set RTC via Serial, type: YYYY-MM-DD HH:MM:SS");
}

void read_sensor() {
  uint8_t result = node.readHoldingRegisters(0x0000, 2);

  if (result == node.ku8MBSuccess) {
    humidity = node.getResponseBuffer(0) / 10.0;
    temperature = node.getResponseBuffer(1) / 10.0;
  }
}

float compute_heat_index(float temperature, float humidity) {

  float tempF = (temperature * 9.0 / 5.0) + 32.0;

  float hiF = -42.379 + 2.04901523 * tempF + 10.14333127 * humidity
              - 0.22475541 * tempF * humidity
              - 0.00683783 * tempF * tempF
              - 0.05481717 * humidity * humidity
              + 0.00122874 * tempF * tempF * humidity
              + 0.00085282 * tempF * humidity * humidity
              - 0.00000199 * tempF * tempF * humidity * humidity;

  return (hiF - 32.0) * 5.0 / 9.0;
}

void getTime() {

  DateTime now = rtc.now();

  currentDateTime = String(now.year()) + "-" +
                    String(now.month()) + "-" +
                    String(now.day()) + " " +
                    String(now.hour()) + ":" +
                    String(now.minute()) + ":" +
                    String(now.second());
}

// Serial RTC update
void checkSerialForTime() {

  if (Serial.available()) {

    String input = Serial.readStringUntil('\n');
    input.trim();

    if (input.length() == 19 && input.charAt(4) == '-' && input.charAt(7) == '-' &&
        input.charAt(10) == ' ' && input.charAt(13) == ':' && input.charAt(16) == ':') {

      int year   = input.substring(0, 4).toInt();
      int month  = input.substring(5, 7).toInt();
      int day    = input.substring(8, 10).toInt();
      int hour   = input.substring(11, 13).toInt();
      int minute = input.substring(14, 16).toInt();
      int second = input.substring(17, 19).toInt();

      rtc.adjust(DateTime(year, month, day, hour, minute, second));
      Serial.println("RTC updated!");
    }
    else {
      Serial.println("Invalid format. Use: YYYY-MM-DD HH:MM:SS");
    }
  }
}

void loop() {

  read_sensor();

  float heat_index = compute_heat_index(temperature, humidity);

  getTime();

  Serial.printf("Date/Time: %s, Temp: %.2f °C, Humidity: %.2f %%, Heat Index: %.2f °C\n",
                currentDateTime.c_str(),
                temperature,
                humidity,
                heat_index);

  // SD Logging
  myFile = SD.open("/datetime.txt", FILE_WRITE);

  if (myFile) {

    myFile.seek(myFile.size());

    myFile.printf("%s, %.2f, %.2f, %.2f\n",
                  currentDateTime.c_str(),
                  temperature,
                  humidity,
                  heat_index);

    myFile.close();

    Serial.println("Data logged to SD card.");
  }
  else {
    Serial.println("Error opening datetime.txt");
  }

  checkSerialForTime();

  delay(1000);
}