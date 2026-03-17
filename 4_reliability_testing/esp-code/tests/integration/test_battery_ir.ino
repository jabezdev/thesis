/*
  Test: Battery Internal Resistance Calculation (Integration)
  Description: Measure voltage drop when MOSFET powers on to calculate mOhm.
  
  Instructions:
  1. Open Serial Monitor at 115200 baud.
  2. This requires the INA219 (Battery) and the MOSFET to be wired correctly.
  3. The internal resistance is calculated as (V_no_load - V_loaded) / I_load.
*/

#include <Wire.h>
#include <Adafruit_INA219.h>

#define WIFI_POWER_PIN 13
Adafruit_INA219 ina219_batt(0x40);

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- Battery IR Calculation Test ---");

  if (!ina219_batt.begin()) {
    Serial.println("INA219 not found.");
    while (1) delay(10);
  }
  ina219_batt.setCalibration_32V_2A();

  pinMode(WIFI_POWER_PIN, OUTPUT);
  digitalWrite(WIFI_POWER_PIN, LOW);
}

void loop() {
  Serial.println("--- Starting Measurement ---");
  
  // Step 1: Measure No-Load Voltage
  float v_pre = ina219_batt.getBusVoltage_V();
  Serial.printf("V No-Load: %.3f V\n", v_pre);

  // Step 2: Apply Load (Turn on Dongle)
  Serial.println("Turning ON Dongle (Load)...");
  digitalWrite(WIFI_POWER_PIN, HIGH);
  delay(2000); // Wait for current to stabilize

  // Step 3: Measure Loaded Voltage and Current
  float v_load = ina219_batt.getBusVoltage_V();
  float i_load_A = ina219_batt.getCurrent_mA() / 1000.0f;
  
  Serial.printf("V Loaded:  %.3f V\n", v_load);
  Serial.printf("I Load:    %.3f A\n", i_load_A);

  // Step 4: Calculate IR
  if (i_load_A > 0.05f) { // Need at least 50mA to get a meaningful reading
    float dv = v_pre - v_load;
    if (dv > 0) {
      float ir_mohm = (dv / i_load_A) * 1000.0f;
      Serial.printf(">>> Calculated Internal Resistance: %.2f mOhm\n", ir_mohm);
    } else {
      Serial.println("Error: No voltage drop detected. Is the load connected?");
    }
  } else {
    Serial.println("Error: Load current too low for calculation.");
  }

  // Turn off load
  digitalWrite(WIFI_POWER_PIN, LOW);
  Serial.println("Turning OFF Load.");
  
  Serial.println("Waiting 10s...\n");
  delay(10000);
}
