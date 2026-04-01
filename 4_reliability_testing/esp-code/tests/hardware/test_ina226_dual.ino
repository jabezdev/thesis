/*
  Test: Dual INA226 (Current/Voltage Sensor)
  Description: Verify high-precision voltage and current from two INA226 modules.
  Addresses: 0x40 (Ref: Battery), 0x41 (Ref: Solar)
  
  Instructions:
  1. Install "INA226_WE" through Library Manager.
  2. Open Serial Monitor (115200).
  3. Ensure Pin 13 is used for MOSFET power (this script enables it).
*/

#include <Wire.h>
#include <INA226_WE.h>

INA226_WE ina_batt = INA226_WE(0x40);
INA226_WE ina_solar = INA226_WE(0x41);

// Configuration
#define POWER_ENABLE_PIN 13
#define SDA_PIN 21
#define SCL_PIN 22

void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);
  Serial.println("\n--- Dual INA226 Diagnostic Test (INA226_WE) ---");

  // 1. Power up sensor rail
  Serial.println("Enabling sensor power rail (Pin 13)...");
  pinMode(POWER_ENABLE_PIN, OUTPUT);
  digitalWrite(POWER_ENABLE_PIN, HIGH);
  delay(500); // Allow sensors to stabilize

  // 2. Initialize I2C
  Serial.println("Initializing I2C on Pins 21, 22...");
  Wire.begin(SDA_PIN, SCL_PIN);

  // 3. I2C Scanner
  Serial.println("Scanning for INA226 addresses...");
  for (byte address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      Serial.print("Found device at 0x");
      Serial.println(address, HEX);
    }
  }

  // 4. Initialize INA226 - Battery (0x40)
  if (!ina_batt.init()) {
    Serial.println("FAILED to find INA226 - Battery (0x40). Check wiring!");
  } else {
    ina_batt.setResistorRange(0.1, 2.0); // 0.1 Ohm shunt, 2A expected max
    Serial.println("INA226 - Battery (0x40) OK.");
  }

  // 5. Initialize INA226 - Solar (0x41)
  if (!ina_solar.init()) {
    Serial.println("FAILED to find INA226 - Solar (0x41). Check A0/VCC bridge!");
  } else {
    ina_solar.setResistorRange(0.1, 2.0); // 0.1 Ohm shunt, 2A expected max
    Serial.println("INA226 - Solar (0x41) OK.");
  }

  Serial.println("\nStarting monitoring loop...\n");
}

void loop() {
  Serial.println("--- Reading ---");
  
  // Battery Readings
  Serial.print("[Battery 0x40] Bus-V: "); 
  Serial.print(ina_batt.getBusVoltage_V()); Serial.print(" V, ");
  Serial.print("Current: "); 
  Serial.print(ina_batt.getCurrent_mA()); Serial.print(" mA, ");
  Serial.print("Shunt-V: "); 
  Serial.print(ina_batt.getShuntVoltage_mV()); Serial.print(" mV, ");
  Serial.print("Power: "); 
  Serial.print(ina_batt.getBusPower() * 1000.0); Serial.println(" mW");

  // Solar Readings
  Serial.print("[Solar   0x41] Bus-V: "); 
  Serial.print(ina_solar.getBusVoltage_V()); Serial.print(" V, ");
  Serial.print("Current: "); 
  Serial.print(ina_solar.getCurrent_mA()); Serial.print(" mA, ");
  Serial.print("Shunt-V: "); 
  Serial.print(ina_solar.getShuntVoltage_mV()); Serial.print(" mV, ");
  Serial.print("Power: "); 
  Serial.print(ina_solar.getBusPower() * 1000.0); Serial.println(" mW");

  Serial.println();
  delay(2000);
}
