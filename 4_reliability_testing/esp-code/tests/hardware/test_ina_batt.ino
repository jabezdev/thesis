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
  Serial.println("\n--- INA219 Battery Unit Test + I2C Scan ---");

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
