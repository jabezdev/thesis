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
  Serial.println("\n--- INA219 Solar Unit Test + I2C Scan ---");

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
