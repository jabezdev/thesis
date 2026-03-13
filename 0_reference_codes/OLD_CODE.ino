#include <Arduino.h>
#include <FirebaseClient.h>
#include "ExampleFunctions.h"
#include <ModbusMaster.h>
#include <Wire.h>
#include "RTClib.h"
#include <SPI.h>
#include <SD.h>
#include <WiFi.h>
#include <WiFiUdp.h>

// Wi-Fi Configurations
#define WIFI_SSID ""
#define WIFI_PASSWORD ""
#define API_KEY ""
#define USER_EMAIL ""
#define USER_PASSWORD ""
#define DATABASE_URL ""
#define FIREBASE_PROJECT_ID ""

void processData(AsyncResult &aResult);
void create_document_await(Document<Values::Value> &doc, const String &documentPath);
void push_async();
void create_docu();
void show_status(const String &name);

RTC_DS3231 rtc;
File myFile;
const int CS = 5;
WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP);
SSL_CLIENT ssl_client;
using AsyncClient = AsyncClientClass;
AsyncClient aClient(ssl_client);
UserAuth user_auth(API_KEY, USER_EMAIL, USER_PASSWORD, 3000 /* expire period in seconds (<3600) */);
FirebaseApp app;
RealtimeDatabase Database;
AsyncResult databaseResult;
Firestore::Documents Docs;
AsyncResult firestoreResult;
ModbusMaster node;
bool task_complete = false;

// data
float temperature = 0;
float humidity = 0;
float precipitation = 0;
float heat_index = 0;
int temp_time = 0;
String timestamp = "";
String datestamp = "";

// Day and Month name arrays
const char* daysOfWeek[] = {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"};
const char* months[] = {"January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"};

void setup() {
  // Serial.begin(9600);
  Serial1.begin(9600, SERIAL_8N1, 16, 17); // RX=18, TX=19
  node.begin(1, Serial1); // Modbus address 1
  // Serial.println("Modbus initialized...");

  // Wi-Fi Initialization
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    // Serial.print(".");
    delay(300);
  }
  // Serial.print("Connected with IP: ");
  // Serial.println(WiFi.localIP());
  // Serial.println();

  // Firebase Database Initialization
  Firebase.printf("Firebase Client v%s\n", FIREBASE_CLIENT_VERSION);
  set_ssl_client_insecure_and_buffer(ssl_client);
  initializeApp(aClient, app, getAuth(user_auth), auth_debug_print, "🔐 authTask");
  app.getApp<RealtimeDatabase>(Database);
  Database.url(DATABASE_URL);
  app.getApp<Firestore::Documents>(Docs);

  if (!rtc.begin()) {
    // Serial.println("Couldn't find RTC. Please check the wiring.");
    while (1);
  }
  if (rtc.lostPower()) {
    // Serial.println("RTC lost power, please set the time.");
    rtc.adjust(DateTime(2025, 5, 22, 12, 5, 0));
  }
  if (!SD.begin(CS)) {
    Serial.println("SD Initialization failed!");
    return;
  }
}

void loop() {
  app.loop();
  if (app.ready()) {
    read_sensor();
    heat_index = compute_heat_index(temperature, humidity);
    getTime();
    push_async();
    create_docu();
    myFile = SD.open("/datetime.txt", FILE_APPEND); // FILE_APPEND to keep old data
    if (myFile) {
      myFile.printf("%s, %.2f, %.2f, %.2f\n", String(temp_time).c_str(), temperature, humidity, heat_index);
      myFile.close();
      // Serial.println("Data logged to SD card.");
    } else {
      // Serial.println("Error opening datetime.txt");
    }
  }
}

void read_sensor() {
  // Serial.println("Reading Registers...");
  uint8_t result = node.readHoldingRegisters(0x0000, 2); // humidity & temp
  // Serial.print("Result = ");
  // Serial.println(result);
  if (result == node.ku8MBSuccess) {
    humidity = node.getResponseBuffer(0) / 10.0;
    temperature = node.getResponseBuffer(1) / 10.0;
  } else {
    // Serial.println("Failed to read registers");
  }
  // Serial.println();
}

float compute_heat_index(float temperature, float humidity) {
  // Convert temperature from Celsius to Fahrenheit
  float tempF = (temperature * 9.0 / 5.0) + 32.0;

  // Calculate Heat Index in Fahrenheit using NWS formula
  float hiF = -42.379 + 2.04901523 * tempF + 10.14333127 * humidity
              - 0.22475541 * tempF * humidity - 0.00683783 * tempF * tempF
              - 0.05481717 * humidity * humidity + 0.00122874 * tempF * tempF * humidity
              + 0.00085282 * tempF * humidity * humidity
              - 0.00000199 * tempF * tempF * humidity * humidity;

  // Convert back to Celsius
  float hiC = (hiF - 32.0) * 5.0 / 9.0;
  return hiC;
}

// Create Firestore Document
void create_docu() {
  String documentPath = "san_fernando/";
  // temp_time = timeClient.getEpochTime();
  documentPath += String(temp_time);
  Values::DoubleValue tempV(number_t(temperature, 2));
  Values::DoubleValue humiV(number_t(humidity, 2));
  // Values::DoubleValue precipV(number_t(data_count, 2));
  Values::DoubleValue heat_indexV(number_t(heat_index, 2));
  Values::IntegerValue timeV(temp_time);

  Document<Values::Value> doc("temp", Values::Value(tempV));
  doc.add("humi", Values::Value(humiV)); //.add("precip", Values::Value(precipV));
  doc.add("heat_index", Values::Value(heat_indexV)).add("time", Values::Value(timeV));
  create_document_await(doc, documentPath);
}

void create_document_await(Document<Values::Value> &doc, const String &documentPath) {
  //Serial.println("Creating a document... ");
  // Sync call which waits until the payload was received.
  String payload = Docs.createDocument(aClient, Firestore::Parent(FIREBASE_PROJECT_ID), documentPath, DocumentMask(), doc);
  if (aClient.lastError().code() == 0)
    Serial.println(payload);
  else
    Firebase.printf("Error, msg: %s, code: %d\n", aClient.lastError().message().c_str(), aClient.lastError().code());
}

// Push data to Firebase
void push_async() {
  // Serial.println("Pushing the temperature value... ");
  Database.set<float>(aClient, "/san_fernando/temp", temperature);
  // Serial.println("Pushing the humidity value... ");
  Database.set<float>(aClient, "/san_fernando/humi", humidity);
  // Serial.println("Pushing the heat_index value... ");
  Database.set<float>(aClient, "/san_fernando/heat_index", heat_index);
  // Serial.println("Pushing the timestamp value... ");
  Database.set<String>(aClient, "/san_fernando/time", timestamp);
  // Serial.println("Pushing the datestamp value... ");
  Database.set<String>(aClient, "/san_fernando/date", datestamp);
}

void getTime() {
  DateTime now = rtc.now();
  temp_time = now.unixtime();

  // --- Date string: "Friday | May 2, 2025" ---
  int dayOfWeek = now.dayOfTheWeek(); // 0 = Sunday, 6 = Saturday
  String dayName = String(daysOfWeek[dayOfWeek]);
  String monthName = String(months[now.month() - 1]); // month() is 1-indexed
  int dayNum = now.day();
  int year = now.year();
  datestamp = dayName + " | " + monthName + " " + dayNum + ", " + year;

  // --- Time string: "5:24:07 PM" ---
  int hour = now.hour();
  int minute = now.minute();
  int second = now.second();
  String meridian = "AM";
  if (hour >= 12) {
    meridian = "PM";
    if (hour > 12) hour -= 12;
  }
  if (hour == 0) hour = 12; // Midnight edge case

  timestamp = String(hour) + ":" + (minute < 10 ? "0" : "") + String(minute) + ":" + (second < 10 ? "0" : "") + String(second) + " " + meridian;
}

