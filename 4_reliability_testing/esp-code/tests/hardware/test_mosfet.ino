/*
  Test: MOSFET (WiFi Power Control)
  Description: Toggle the IRFz44n MOSFET gate to verify power control for the LTE dongle.
  
  Instructions:
  1. Open Serial Monitor at 115200 baud.
  2. Pin 13 is the MOSFET Gate.
  3. The dongle should power ON for 10 seconds, then power OFF for 10 seconds.
  4. Observe any status LED on the LTE dongle to confirm power switching.
*/

#define WIFI_POWER_PIN 13

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- MOSFET Power Control Test ---");

  pinMode(WIFI_POWER_PIN, OUTPUT);
  digitalWrite(WIFI_POWER_PIN, LOW);
  Serial.println("Start State: OFF");
}

void loop() {
  Serial.println("Toggling ON...");
  digitalWrite(WIFI_POWER_PIN, HIGH);
  delay(10000);

  Serial.println("Toggling OFF...");
  digitalWrite(WIFI_POWER_PIN, LOW);
  delay(10000);
}
