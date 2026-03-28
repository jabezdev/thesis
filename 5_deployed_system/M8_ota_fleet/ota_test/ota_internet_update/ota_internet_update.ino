#include <WiFi.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <ArduinoJson.h> 

const char* ssid = "steve jabz";
const char* password = "12345678";

// UPDATE THIS to the IP address of the local machine running the Python script
const char* serverUrl = "http://10.126.49.101:8080/api/v1/ingest"; 

const String nodeId = "simulated_node_01";
// This is the UPDATED version. The server sees "v1.1" and stops asking it to update.
const String firmwareVersion = "v1.1"; 

const int LED_PIN = 2; // Built-in LED
unsigned long previousBlinkMillis = 0;
const long blinkInterval = 100; // FAST BLINK: 100 milliseconds

unsigned long previousHeartbeatMillis = 0;
const long heartbeatInterval = 10000; // Heartbeat every 10 seconds

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("\n--- Booting Internet OTA Client (UPDATED VERSION) ---");
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
      break;
  }
}

void loop() {
  unsigned long currentMillis = millis();

  // 1. Non-blocking LED BLINK logic (FAST)
  if (currentMillis - previousBlinkMillis >= blinkInterval) {
    previousBlinkMillis = currentMillis;
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
  }

  // 2. Non-blocking Heartbeat & OTA check
  if (WiFi.status() == WL_CONNECTED && (currentMillis - previousHeartbeatMillis >= heartbeatInterval)) {
    previousHeartbeatMillis = currentMillis;
    
    WiFiClient client;
    HTTPClient http;
    
    Serial.println("\nSending heartbeat to backend...");
    http.begin(client, serverUrl);
    http.addHeader("Content-Type", "application/json");
    
    const char* headerKeys[] = {"X-Cmd"};
    http.collectHeaders(headerKeys, 1);
    
    StaticJsonDocument<200> doc;
    doc["node_id"] = nodeId;
    doc["firmware_version"] = firmwareVersion;
    String requestBody;
    serializeJson(doc, requestBody);
    
    int httpResponseCode = http.POST(requestBody);
    
    if (httpResponseCode > 0) {
      Serial.print("HTTP Response code: ");
      Serial.println(httpResponseCode);
      
      if (http.hasHeader("X-Cmd")) {
        String cmd = http.header("X-Cmd");
        Serial.print("Received X-Cmd: ");
        Serial.println(cmd);
        
        if (cmd.startsWith("ota=")) {
          String otaUrl = cmd.substring(4);
          http.end(); 
          performOTAUpdate(otaUrl);
        }
      } else {
         Serial.println("No X-Cmd header received. Node is up to date.");
      }
    } else {
      Serial.print("HTTP Error code: ");
      Serial.println(httpResponseCode);
    }
    http.end();
  }
}
