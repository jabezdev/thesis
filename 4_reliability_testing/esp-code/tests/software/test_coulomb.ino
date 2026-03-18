/*
  Test: Coulomb Counting Logic (Hardware Integrated)
  Description: Use real INA219 readings to track Ah and Wh for LiFePO4.
  
  Instructions:
  1. Connect INA219 at 0x40 (Battery line).
  2. Monitor Serial for integrated values and SoC estimation.
*/

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_INA219.h>

const float CAPACITY_AH = 30.0;
const int SENSOR_INTERVAL_MS = 1000;

Adafruit_INA219 ina219(0x40);

float g_batt_used_Ah = 0.0;
float g_batt_total_energy_Wh = 0.0;

// LiFePO4 (12.8V 4-cell) characteristic
float socByVoltage(float v) {
  if (v >= 13.40f) return 100.0f;
  if (v >= 13.30f) return 90.0f + (v - 13.30f) * 100.0f;
  if (v >= 13.25f) return 70.0f + (v - 13.25f) * 400.0f;
  if (v >= 13.20f) return 40.0f + (v - 13.20f) * 600.0f;
  if (v >= 13.10f) return 30.0f + (v - 13.10f) * 100.0f;
  if (v >= 13.00f) return 20.0f + (v - 13.00f) * 100.0f;
  if (v >= 12.80f) return 10.0f + (v - 12.80f) * 50.0f;
  if (v >= 11.00f) return 0.0f  + (v - 11.00f) * 5.5f;
  return 0.0f;
}

void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);
  
  if (!ina219.begin()) {
    Serial.println("FAILED to find INA219 chip at 0x40");
    while (1) { delay(10); }
  }
  ina219.setCalibration_32V_2A();

  Serial.println("\n--- Coulomb Counting (Hardware: INA219) ---");

  // Initial estimation
  float v_start = ina219.getBusVoltage_V();
  float initial_soc = socByVoltage(v_start);
  g_batt_used_Ah = CAPACITY_AH * (1.0f - (initial_soc / 100.0f));
  
  Serial.printf("[Init] Real Voltage: %.2fV | Estimated SoC: %.1f%% | Ah Used: %.3f\n", 
                v_start, initial_soc, g_batt_used_Ah);
}

void loop() {
  float current_A = ina219.getCurrent_mA() / 1000.0f;
  float voltage_V = ina219.getBusVoltage_V();
  float power_W = voltage_V * current_A;

  // Track Ah and Wh
  g_batt_used_Ah += current_A * (SENSOR_INTERVAL_MS / 3600000.0f);
  g_batt_total_energy_Wh += power_W * (SENSOR_INTERVAL_MS / 3600000.0f);

  float remaining_Ah = CAPACITY_AH - g_batt_used_Ah;
  float soc = (remaining_Ah / CAPACITY_AH) * 100.0f;

  Serial.printf("V: %.2fV | I: %.3fA | Used: %.6fAh | SoC: %.2f%%\n",
                voltage_V, current_A, g_batt_used_Ah, soc);

  delay(SENSOR_INTERVAL_MS);
}
