import { Database } from "bun:sqlite";

interface WeatherData {
    temperature: number;
    humidity: number;
    heat_index: number;
    rainfall: number;
    timestamp?: string;
}

let systemMode: 'none' | 'test' | 'demo' = 'none';
let testHistory: WeatherData[] = [];
let generatorInterval: ReturnType<typeof setInterval> | null = null;

const db = new Database(process.env.DB_PATH || "weather.db");

console.log("🌦  Initializing database...");

// Attempt to alter table safely if it already exists
try {
    db.run("ALTER TABLE readings ADD COLUMN heat_index REAL DEFAULT 0.0 NOT NULL");
} catch (e) {
    // Column already exists, safe to ignore
}

// Initialize table
db.run(`
  CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    temperature REAL NOT NULL,
    humidity REAL NOT NULL,
    heat_index REAL DEFAULT 0.0 NOT NULL,
    rainfall REAL NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const insertReading = db.prepare(
    "INSERT INTO readings (temperature, humidity, heat_index, rainfall) VALUES ($temp, $humidity, $heatIndex, $rainfall)"
);

const getLatestReading = db.prepare(
    "SELECT * FROM readings ORDER BY timestamp DESC LIMIT 1"
);

// Ensure there's at least one reading for the frontend to clear the loading state
const initialCheck = getLatestReading.get();
if (!initialCheck) {
    console.log("🌱 Database empty, inserting initial reading...");
    db.run("INSERT INTO readings (temperature, humidity, heat_index, rainfall) VALUES (25.0, 60.0, 26.0, 0.0)");
}

// Get the last 100 readings for the charts
const getHistory = db.prepare(
    "SELECT * FROM readings ORDER BY timestamp DESC LIMIT 100"
);

// Store active SSE connections
const clients = new Set<ReadableStreamDefaultController>();

function broadcast(data: any, eventType?: string) {
    let message = "";
    if (eventType) {
        message += `event: ${eventType}\n`;
    }
    message += `data: ${JSON.stringify(data)}\n\n`;
    const encoded = new TextEncoder().encode(message);
    for (const client of clients) {
        try {
            client.enqueue(encoded);
        } catch (e) {
            clients.delete(client);
        }
    }
}

function startGenerator() {
    if (generatorInterval) clearInterval(generatorInterval);
    if (systemMode === 'none') {
        return;
    }

    generatorInterval = setInterval(() => {
        const temp = 25 + Math.random() * 10;
        const humidity = 50 + Math.random() * 40;
        const rainChance = Math.random();
        const rain = rainChance > 0.8 ? Math.random() * 5 : 0;
        const heatIndex = temp + (humidity * 0.05);

        const reading = {
            temperature: Number(temp.toFixed(1)),
            humidity: Number(humidity.toFixed(1)),
            heat_index: Number(heatIndex.toFixed(1)),
            rainfall: Number(rain.toFixed(1)),
        };

        if (systemMode === 'demo') {
            try {
                insertReading.run({
                    $temp: reading.temperature,
                    $humidity: reading.humidity,
                    $heatIndex: reading.heat_index,
                    $rainfall: reading.rainfall,
                });
                const latestInfo = getLatestReading.get();
                broadcast(latestInfo);
            } catch (e) {
                console.error("Demo generation insert error:", e);
            }
        } else if (systemMode === 'test') {
            const newReading = {
                ...reading,
                timestamp: new Date().toISOString()
            };
            testHistory.push(newReading);
            if (testHistory.length > 100) testHistory.shift();
            broadcast(newReading);
        }
    }, 3000);
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
                    if (systemMode === 'test' && testHistory.length > 0) {
                        const latestTest = testHistory[testHistory.length - 1];
                        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(latestTest)}\n\n`));
                    } else {
                        const latest = getLatestReading.get();
                        if (latest) {
                            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(latest)}\n\n`));
                        }
                    }
                    
                    controller.enqueue(new TextEncoder().encode(`event: mode\ndata: "${systemMode}"\n\n`));

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
            console.log(`\n[INCOMING] POST request to /api/weather`);
            try {
                const rawText = await req.text();
                console.log(`[RAW PAYLOAD] ${rawText}`);
                
                const body = JSON.parse(rawText) as WeatherData;

                // Basic validation
                if (
                    typeof body.temperature !== "number" ||
                    typeof body.humidity !== "number" ||
                    typeof body.heat_index !== "number" ||
                    typeof body.rainfall !== "number"
                ) {
                    return new Response(JSON.stringify({ error: "Invalid data format" }), { status: 400, headers });
                }

                insertReading.run({
                    $temp: body.temperature,
                    $humidity: body.humidity,
                    $heatIndex: body.heat_index,
                    $rainfall: body.rainfall,
                });

                console.log(`[DATA IN] T:${body.temperature}°C, H:${body.humidity}%, HI:${body.heat_index}°C, R:${body.rainfall}mm`);

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

        if (req.method === "GET" && url.pathname === "/api/system/mode") {
            return new Response(JSON.stringify({ mode: systemMode }), { headers });
        }

        if (req.method === "POST" && url.pathname === "/api/system/mode") {
            try {
                const body = await req.json() as { mode: 'none' | 'test' | 'demo' };
                if (['none', 'test', 'demo'].includes(body.mode)) {
                    systemMode = body.mode;
                    startGenerator();
                    broadcast(systemMode, 'mode');
                    return new Response(JSON.stringify({ success: true, mode: systemMode }), { headers });
                }
                return new Response(JSON.stringify({ error: "Invalid mode" }), { status: 400, headers });
            } catch (e) {
                return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers });
            }
        }

        if (req.method === "GET" && url.pathname === "/api/weather/history") {
            if (systemMode === 'test') {
                return new Response(JSON.stringify(testHistory), { headers });
            }
            const historyItems = getHistory.all() as any[];
            // Reverse to chronological order (oldest to newest)
            const chronological = historyItems.reverse();
            return new Response(JSON.stringify(chronological), { headers });
        }

        return new Response("Not Found", { status: 404, headers });
    },
});

console.log("🌦  Weather API running on http://localhost:3001 with SSE capabilities");
