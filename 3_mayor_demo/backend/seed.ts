import { Database } from "bun:sqlite";

const db = new Database(process.env.DB_PATH || "weather.db");

console.log("🌱 Seeding database...");

db.run(`
  CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    temperature REAL NOT NULL,
    humidity REAL NOT NULL,
    rainfall REAL NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.run("DELETE FROM readings");

const insertReading = db.prepare(
  "INSERT INTO readings (temperature, humidity, rainfall, timestamp) VALUES ($temp, $humidity, $rainfall, $timestamp)"
);

const now = new Date();
for (let i = 0; i < 50; i++) {
  const timestamp = new Date(now.getTime() - (50 - i) * 60000).toISOString();
  insertReading.run({
    $temp: 25 + Math.random() * 10,
    $humidity: 60 + Math.random() * 20,
    $rainfall: Math.random() < 0.2 ? Math.random() * 5 : 0,
    $timestamp: timestamp
  });
}

console.log("✅ Seeded 50 records.");
db.close();
