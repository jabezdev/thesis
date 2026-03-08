import { Database } from "bun:sqlite";

interface WeatherData {
    temperature: number;
    humidity: number;
    rainfall: number;
}

const db = new Database(process.env.DB_PATH || "weather.db");

console.log("🌦  Initializing database...");

// Initialize table
db.run(`
  CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    temperature REAL NOT NULL,
    humidity REAL NOT NULL,
    rainfall REAL NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const insertReading = db.prepare(
    "INSERT INTO readings (temperature, humidity, rainfall) VALUES ($temp, $humidity, $rainfall)"
);

const getLatestReading = db.prepare(
    "SELECT * FROM readings ORDER BY timestamp DESC LIMIT 1"
);

// Ensure there's at least one reading for the frontend to clear the loading state
const initialCheck = getLatestReading.get();
if (!initialCheck) {
    console.log("🌱 Database empty, inserting initial reading...");
    db.run("INSERT INTO readings (temperature, humidity, rainfall) VALUES (25.0, 60.0, 0.0)");
}

// Get the last 100 readings for the charts
const getHistory = db.prepare(
    "SELECT * FROM readings ORDER BY timestamp DESC LIMIT 100"
);

// Store active SSE connections
const clients = new Set<ReadableStreamDefaultController>();

function broadcast(data: any) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
        try {
            client.enqueue(new TextEncoder().encode(message));
        } catch (e) {
            clients.delete(client);
        }
    }
}

Bun.serve({
    port: 3001,
    hostname: "0.0.0.0",
    idleTimeout: 60, // 60 seconds
    async fetch(req) {
        const url = new URL(req.url);

        // CORS preflight
        if (req.method === "OPTIONS") {
            return new Response(null, {
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type",
                },
            });
        }

        const headers = {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
        };

        // Server-Sent Events endpoint
        if (req.method === "GET" && url.pathname === "/api/weather/stream") {
            const stream = new ReadableStream({
                start(controller) {
                    clients.add(controller);

                    // Send initial payload so client has immediate latest data upon connection
                    const latest = getLatestReading.get();
                    if (latest) {
                        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(latest)}\n\n`));
                    }

                    // Handle client disconnect
                    const heartbeat = setInterval(() => {
                        try {
                            controller.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
                        } catch (e) {
                            clearInterval(heartbeat);
                            clients.delete(controller);
                        }
                    }, 30000);

                    req.signal.addEventListener("abort", () => {
                        clearInterval(heartbeat);
                        clients.delete(controller);
                    });
                },
                cancel(controller) {
                    clients.delete(controller);
                }
            });

            return new Response(stream, {
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
            });
        }

        if (req.method === "POST" && url.pathname === "/api/weather") {
            try {
                const body = (await req.json()) as WeatherData;

                // Basic validation
                if (
                    typeof body.temperature !== "number" ||
                    typeof body.humidity !== "number" ||
                    typeof body.rainfall !== "number"
                ) {
                    return new Response(JSON.stringify({ error: "Invalid data format" }), { status: 400, headers });
                }

                insertReading.run({
                    $temp: body.temperature,
                    $humidity: body.humidity,
                    $rainfall: body.rainfall,
                });

                console.log(`[DATA IN] T:${body.temperature}°C, H:${body.humidity}%, R:${body.rainfall}mm`);

                // Get inserted row to ensure timestamp is exact
                const latestInfo = getLatestReading.get();
                // Broadcast the real-time event
                broadcast(latestInfo);

                return new Response(JSON.stringify({ success: true }), { headers });
            } catch (e) {
                console.error("Error inserting data:", e);
                return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers });
            }
        }

        if (req.method === "GET" && url.pathname === "/api/weather/latest") {
            const latest = getLatestReading.get() || null;
            return new Response(JSON.stringify(latest), { headers });
        }

        if (req.method === "GET" && url.pathname === "/api/weather/history") {
            const historyItems = getHistory.all();
            // Reverse to chronological order (oldest to newest)
            const chronological = historyItems.reverse();
            return new Response(JSON.stringify(chronological), { headers });
        }

        return new Response("Not Found", { status: 404, headers });
    },
});

console.log("🌦  Weather API running on http://localhost:3001 with SSE capabilities");
