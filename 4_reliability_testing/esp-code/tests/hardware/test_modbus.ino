/*
  Test: Modbus (Atmospheric Sensor)
  Description: Test RS485 Modbus communication for temperature and humidity.
  
  Instructions:
  1. Open Serial Monitor at 115200 baud.
  2. RS485_RX = 16, RS485_TX = 17.
  3. Ensure the MAX485/equivalent module is connected correctly.
*/

#include <ModbusMaster.h>

#define RS485_RX 16
#define RS485_TX 17

ModbusMaster node;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- Modbus Atmospheric Sensor Test ---");

  Serial1.begin(9600, SERIAL_8N1, RS485_RX, RS485_TX);
  node.begin(1, Serial1); // Slave ID 1
}

void loop() {
  uint8_t result = node.readHoldingRegisters(0x0000, 2);

  if (result == node.ku8MBSuccess) {
    float humidity = node.getResponseBuffer(0) / 10.0f;
    float temperature = node.getResponseBuffer(1) / 10.0f;

    Serial.print("Temperature: "); Serial.print(temperature); Serial.println(" C");
    Serial.print("Humidity:    "); Serial.print(humidity); Serial.println(" %");
  } else {
    Serial.printf("Modbus Error: 0x%02X\n", result);
  }

  Serial.println("---");
  delay(3000);
}
