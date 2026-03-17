/*
  Test: JSON Payload (Firestore)
  Description: Verify the JSON structure and scaling using ArduinoJson.
  
  Instructions:
  1. This test verifies that the JSON structure matches Firestore's expectation.
  2. Monitor Serial for the generated JSON string.
*/

#include <ArduinoJson.h>

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- JSON Payload Test ---");

  JsonDocument doc;
  JsonObject fields = doc["fields"].to<JsonObject>();

  // Mock data
  fields["timestamp"]["stringValue"] = "2026-03-17 07:30:00";
  fields["temperature"]["doubleValue"] = 25.5;
  fields["humidity"]["doubleValue"] = 80.0;
  fields["batt_voltage"]["doubleValue"] = 12.65;
  fields["boot_count"]["integerValue"] = "42";

  String payload;
  serializeJson(doc, payload);

  Serial.println("Generated Payload:");
  Serial.println(payload);
  Serial.print("Payload Size: ");
  Serial.println(payload.length());
}

void loop() {}
