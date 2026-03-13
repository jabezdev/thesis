#include <Wire.h>
#include <Adafruit_INA219.h>

Adafruit_INA219 ina219;

// --- Battery Configuration ---
float capacity_Ah = 30.0;  // Full battery capacity in Ah
float used_Ah = 0.0;       // Accumulated charge used (resets on power cycle)

unsigned long previousMillis = 0;

void setup()
{
  Serial.begin(115200);

  Wire.begin(21, 22);  // ESP32 I2C pins (SDA=21, SCL=22)

  if (!ina219.begin())
  {
    Serial.println("ERROR: INA219 not detected. Check wiring.");
    while (1);
  }

  // INA219 is on the 12V battery side (before step-down converter)
  // 16V/5A range is appropriate for a 12V battery
  ina219.setCalibration_32V_2A();

  Serial.println("=== Battery Monitor Started ===");
  Serial.println("Placement: 12V battery -> INA219 -> Step Down (12V->5V) -> Load");
  Serial.println("-------------------------------------------------------------");
}

void loop()
{
  unsigned long currentMillis = millis();

  if (currentMillis - previousMillis >= 1000)
  {
    previousMillis = currentMillis;

    // --- Raw Readings ---
    float voltage    = ina219.getBusVoltage_V();   // Battery terminal voltage
    float current_mA = ina219.getCurrent_mA();     // Current drawn from battery
    float current_A  = current_mA / 1000.0;

    // --- Power Consumption (at 12V battery side) ---
    // Reflects true power drawn from battery, including step-down losses
    float power_mW = ina219.getPower_mW();
    float power_W  = power_mW / 1000.0;

    // --- Battery State of Charge (Coulomb Counting) ---
    used_Ah += current_A / 3600.0;  // Integrate current over 1-second interval
    float remaining_Ah = capacity_Ah - used_Ah;
    float soc = (remaining_Ah / capacity_Ah) * 100.0;
    soc = constrain(soc, 0.0, 100.0);  // Clamp to valid range

    // --- Serial Output ---
    Serial.print("Voltage: ");
    Serial.print(voltage, 2);
    Serial.print(" V  |  Current: ");
    Serial.print(current_A, 3);
    Serial.print(" A  |  Power: ");
    Serial.print(power_W, 2);
    Serial.print(" W (");
    Serial.print(power_mW, 1);
    Serial.print(" mW)  |  Battery: ");
    Serial.print(soc, 1);
    Serial.print(" %  (");
    Serial.print(remaining_Ah, 2);
    Serial.println(" Ah remaining)");

    // --- Low Battery Cutoff ---
    if (voltage <= 11.0)
    {
      Serial.println(">>> Battery cutoff reached (<=11V). Halting. <<<");
      while (1);
    }
  }
}