/*
  Test: INA219 (Solar)
  Description: Verify voltage and current readings from the solar sensor at address 0x41.
  
  Instructions:
  1. Open Serial Monitor at 115200 baud.
  2. Ensure the solar panel/charger is connected to the second INA219.
*/

#include <Wire.h>
#include <Adafruit_INA219.h>

Adafruit_INA219 ina219_solar(0x41);

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- INA219 Solar Unit Test ---");

  if (!ina219_solar.begin()) {
    Serial.println("Failed to find INA219 (Solar) chip at 0x41");
    while (1) { delay(10); }
  }
  ina219_solar.setCalibration_32V_2A();
  Serial.println("INA219 (Solar) Found.");
}

void loop() {
  float busvoltage = ina219_solar.getBusVoltage_V();
  float current_mA = ina219_solar.getCurrent_mA();
  float power_mW = ina219_solar.getPower_mW();
  
  Serial.print("Solar Voltage: "); Serial.print(busvoltage); Serial.println(" V");
  Serial.print("Solar Current: "); Serial.print(current_mA); Serial.println(" mA");
  Serial.print("Solar Power:   "); Serial.print(power_mW); Serial.println(" mW");
  Serial.println("");

  delay(2000);
}
