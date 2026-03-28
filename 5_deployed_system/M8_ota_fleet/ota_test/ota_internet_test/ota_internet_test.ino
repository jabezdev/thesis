#include <WiFi.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <ArduinoJson.h> 

const char* ssid = "YOUR_SSID";
const char* password = "YOUR_PASSWORD";

// UPDATE THIS to the IP address of the local machine running the Python script
const char* serverUrl = "http://192.168.1.xxx:8080/api/v1/ingest"; 

const String nodeId = "simulated_node_01";

// The mock server expects this to be DIFFERENT than "v1.1" to trigger an update.
// When you compile the actual firmware.bin to upload, change this to "v1.1" so it doesn't loop!
const String firmwareVersion = "v1.0"; 

void setup() {
  Serial.begin(115200);
  Serial.println("\n--- Booting Internet OTA Client ---");
  Serial.print("Current Firmware Version: ");
  Serial.println(firmwareVersion);
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  
  Serial.print("Connecting to WiFi");
  while (WiFi.waitForConnectResult() != WL_CONNECTED) {
    Serial.println("Connection Failed! Rebooting...");
    delay(5000);
    ESP.restart();
  }
  Serial.println("\nConnected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());
}

void performOTAUpdate(String url) {
  Serial.print("\n=== STARTING INTERNET OTA UPDATE ===\nDownloading from: ");
  Serial.println(url);
  
  WiFiClient client;
  
  // You can set an LED to blink during the update process if you want
  // httpUpdate.setLedPin(2, LOW);
  
  t_httpUpdate_return ret = httpUpdate.update(client, url);
  
  switch (ret) {
    case HTTP_UPDATE_FAILED:
      Serial.printf("HTTP_UPDATE_FAILED Error (%d): %s\n", httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
      break;
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("HTTP_UPDATE_NO_UPDATES");
      break;
    case HTTP_UPDATE_OK:
      Serial.println("HTTP_UPDATE_OK - Rebooting into new firmware...");
      // The ESP32 will automatically restart into the new firmware here.
      break;
  }
}

void loop() {
  if(WiFi.status() == WL_CONNECTED) {
    WiFiClient client;
    HTTPClient http;
    
    Serial.println("\nSending heartbeat to backend...");
    http.begin(client, serverUrl);
    http.addHeader("Content-Type", "application/json");
    
    // We MUST tell the HTTPClient to capture the X-Cmd header BEFORE we send the request
    const char* headerKeys[] = {"X-Cmd"};
    http.collectHeaders(headerKeys, 1);
    
    // Create the JSON payload
    StaticJsonDocument<200> doc;
    doc["node_id"] = nodeId;
    doc["firmware_version"] = firmwareVersion;
    String requestBody;
    serializeJson(doc, requestBody);
    
    int httpResponseCode = http.POST(requestBody);
    
    if (httpResponseCode > 0) {
      Serial.print("HTTP Response code: ");
      Serial.println(httpResponseCode);
      
      // Check if the server sent back the X-Cmd header
      if (http.hasHeader("X-Cmd")) {
        String cmd = http.header("X-Cmd");
        Serial.print("Received X-Cmd: ");
        Serial.println(cmd);
        
        // Parse the OTA command
        if (cmd.startsWith("ota=")) {
          String otaUrl = cmd.substring(4); // Remove "ota="
          
          // CRITICAL: End the current HTTP request before starting the heavy OTA download
          http.end(); 
          
          performOTAUpdate(otaUrl);
        }
      } else {
         Serial.println("No X-Cmd header received.");
      }
    } else {
      Serial.print("HTTP Error code: ");
      Serial.println(httpResponseCode);
    }
    
    http.end();
  }
  
  // Wait 10 seconds before the next heartbeat
  delay(10000);
}
