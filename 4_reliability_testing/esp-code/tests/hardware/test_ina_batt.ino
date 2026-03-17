/*
  Test: INA219 (Battery)
  Description: Verify voltage and current readings from the battery sensor at address 0x40.
  
  Instructions:
  1. Open Serial Monitor at 115200 baud.
  2. The test will read bus voltage, shunt voltage, current, and power.
  3. Ensure the battery is connected correctly to the INA219.
*/

#include <Wire.h>
#include <Adafruit_INA219.h>

Adafruit_INA219 ina219_batt(0x40);

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- INA219 Battery Unit Test ---");

  if (!ina219_batt.begin()) {
    Serial.println("Failed to find INA219 (Battery) chip at 0x40");
    while (1) { delay(10); }
  }
  ina219_batt.setCalibration_32V_2A();
  Serial.println("INA219 (Battery) Found.");
}

void loop() {
  float busvoltage = 0;
  float shuntvoltage = 0;
  float loadvoltage = 0;
  float current_mA = 0;
  float power_mW = 0;

  busvoltage = ina219_batt.getBusVoltage_V();
  shuntvoltage = ina219_batt.getShuntVoltage_mV();
  current_mA = ina219_batt.getCurrent_mA();
  power_mW = ina219_batt.getPower_mW();
  loadvoltage = busvoltage + (shuntvoltage / 1000);
  
  Serial.print("Bus Voltage:   "); Serial.print(busvoltage); Serial.println(" V");
  Serial.print("Shunt Voltage: "); Serial.print(shuntvoltage); Serial.println(" mV");
  Serial.print("Load Voltage:  "); Serial.print(loadvoltage); Serial.println(" V");
  Serial.print("Current:       "); Serial.print(current_mA); Serial.println(" mA");
  Serial.print("Power:         "); Serial.print(power_mW); Serial.println(" mW");
  Serial.println("");

  delay(2000);
}
