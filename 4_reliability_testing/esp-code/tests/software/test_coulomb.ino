/*
  Test: Coulomb Counting Logic
  Description: Simulate current over time and verify Ah and Wh integration accuracy.
  
  Instructions:
  1. This test is pure software logic verification.
  2. Monitor Serial for integrated values.
*/

#include <Arduino.h>

const float CAPACITY_AH = 30.0;
const int SENSOR_INTERVAL_MS = 1000;

float g_batt_used_Ah = 0.0;
float g_batt_total_energy_Wh = 0.0;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- Coulomb Counting Simulation ---");
}

void loop() {
  // Simulate a constant 2A load
  float simulated_current_A = 2.0; 
  float simulated_voltage_V = 12.5;
  float simulated_power_W = simulated_current_A * simulated_voltage_V;

  // Logic from reliability_test.ino
  g_batt_used_Ah += simulated_current_A * (SENSOR_INTERVAL_MS / 3600000.0f);
  g_batt_total_energy_Wh += simulated_power_W * (SENSOR_INTERVAL_MS / 3600000.0f);

  float remaining_Ah = CAPACITY_AH - g_batt_used_Ah;
  float soc = (remaining_Ah / CAPACITY_AH) * 100.0f;

  Serial.printf("Current: %.2fA | Used: %.6fAh | Total: %.6fWh | SoC: %.2f%%\n",
                simulated_current_A, g_batt_used_Ah, g_batt_total_energy_Wh, soc);

  delay(1000);
}
