/*
  Test: Rain Sensor
  Description: Verify UART communication and data reading from the Tip-Bucket Rain Sensor.
  
  Instructions:
  1. Open Serial Monitor at 115200 baud.
  2. Pin 25 should be RX (connected to TX of sensor).
  3. Pin 26 should be TX (connected to RX of sensor).
*/

#include <Arduino.h>
#include "DFRobot_RainfallSensor.h"

#define RAIN_RX 25
#define RAIN_TX 26

HardwareSerial RainSerial(2);
DFRobot_RainfallSensor_UART RainSensor(&RainSerial);

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- Rain Sensor Unit Test ---");

  RainSerial.begin(9600, SERIAL_8N1, RAIN_RX, RAIN_TX);

  if (!RainSensor.begin()) {
    Serial.println("Rain Sensor not found! Check UART wiring.");
    while (1) delay(10);
  }
  Serial.println("Rain Sensor Initialized.");
}

void loop() {
  Serial.print("Rainfall (cumulative): ");
  Serial.print(RainSensor.getRainfall());
  Serial.println(" mm");

  Serial.print("Rainfall (last 1 hour): ");
  Serial.print(RainSensor.getRainfall(1));
  Serial.println(" mm");

  Serial.print("Raw Tipping Counts: ");
  Serial.println(RainSensor.getRawData());

  Serial.println("---");
  delay(3000);
}
