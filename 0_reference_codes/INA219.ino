#include <Wire.h>
#include <Adafruit_INA219.h>

Adafruit_INA219 ina219;

float capacity_Ah = 30.0;   // battery capacity
float used_Ah = 0.0;

unsigned long previousMillis = 0;

void setup()
{
  Serial.begin(115200);

  Wire.begin(21, 22);  // ESP32 I2C pins

  if (!ina219.begin())
  {
    Serial.println("INA219 not detected");
    while (1);
  }

  ina219.setCalibration_16V_5A();

  Serial.println("ESP32 Battery Discharge Test Started");
}

void loop()
{
  unsigned long currentMillis = millis();

  if (currentMillis - previousMillis >= 1000)
  {
    previousMillis = currentMillis;

    float voltage = ina219.getBusVoltage_V();
    float current_mA = ina219.getCurrent_mA();
    float current_A = current_mA / 1000.0;

    // Coulomb counting
    used_Ah += current_A / 3600.0;

    float remaining_Ah = capacity_Ah - used_Ah;
    float soc = (remaining_Ah / capacity_Ah) * 100.0;

    Serial.print("Voltage: ");
    Serial.print(voltage);
    Serial.print(" V | Current: ");
    Serial.print(current_A);
    Serial.print(" A | Used: ");
    Serial.print(used_Ah);
    Serial.print(" Ah | Battery: ");
    Serial.print(soc);
    Serial.println(" %");

    if (voltage <= 11.0)
    {
      Serial.println("Battery cutoff reached");
      while (1);
    }
  }
}