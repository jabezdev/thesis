#include <Arduino.h>
#include <FirebaseClient.h>
#include "ExampleFunctions.h"
#include <WiFi.h>
#include <WiFiUdp.h>

// Wi-Fi Configurations
#define WIFI_SSID ""
#define WIFI_PASSWORD ""

#define API_KEY "IzaSyBLY_GwHEC8I2YdfPlYt6O_b4CBThnFbpY"
#define USER_EMAIL "gab@maiii.net"
#define USER_PASSWORD "GABO1234"
#define DATABASE_URL "https://maiiinet-default-rtdb.asia-southeast1.firebasedatabase.app"

// Function declarations
void push_json();
void processData(AsyncResult &aResult);

// Objects
WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP);

SSL_CLIENT ssl_client;
using AsyncClient = AsyncClientClass;
AsyncClient aClient(ssl_client);

UserAuth user_auth(API_KEY, USER_EMAIL, USER_PASSWORD, 3000 /* expire period in seconds (<3600) */);
FirebaseApp app;
RealtimeDatabase Database;
AsyncResult databaseResult;

void setup()
{
  Serial.begin(115200);

  // Wi-Fi Initialization
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED){
      Serial.print(".");
      delay(300);
  }
  Serial.println();
  Serial.print("Connected with IP: ");
  Serial.println(WiFi.localIP());

  // Firebase Database Initialization
  Firebase.printf("Firebase Client v%s\n", FIREBASE_CLIENT_VERSION);
  set_ssl_client_insecure_and_buffer(ssl_client);
  initializeApp(aClient, app, getAuth(user_auth), auth_debug_print, "🔐 authTask");
  
  app.getApp<RealtimeDatabase>(Database);
  Database.url(DATABASE_URL);

  timeClient.begin();
}

void loop()
{
  // Maintain Firebase connection
  app.loop();

  // Update time
  timeClient.update();

  // Send data if Firebase is ready. 
  // NOTE: In a real app, use a timer to avoid spamming (e.g., every 10 seconds)
  static unsigned long lastTime = 0;
  if (app.ready() && (millis() - lastTime > 10000)){
    lastTime = millis();
    return push_json();
  }
}

void push_json()
{
    Serial.println("Pushing JSON...");

    // Create a JSON object using object_t
    object_t json_data;
    JsonWriter writer(json_data);
    
    // Add data to the JSON object
    // You can replace these with your actual variables
    writer.set("timestamp", (int)timeClient.getEpochTime());
    writer.set("status", "active");
    writer.set("message", "This is a JSON object");
    writer.set("random_val", random(100));

    // Send the JSON object to the defined path in Realtime Database
    // Path: /test_entry
    Database.set<object_t>(aClient, "/test_entry", json_data, processData, "pushTask");
}

void processData(AsyncResult &aResult)
{
    // Print the result of the database operation
    if (aResult.isEvent())
    {
        Firebase.printf("Event task: %s, msg: %s, code: %d\n", aResult.uid().c_str(), aResult.eventLog().message().c_str(), aResult.eventLog().code());
    }

    if (aResult.isDebug())
    {
        Firebase.printf("Debug task: %s, msg: %s\n", aResult.uid().c_str(), aResult.debug().c_str());
    }

    if (aResult.isError())
    {
        Firebase.printf("Error task: %s, msg: %s, code: %d\n", aResult.uid().c_str(), aResult.error().message().c_str(), aResult.error().code());
    }
}
