import { Database } from "bun:sqlite";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";

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

// Smooth-walk state for test/demo generators
let genTemp = 27.5;
let genHumidity = 30.0;

/** Steadman / NWS Heat Index (°C in, °C out). Valid for T ≥ 27 °C and RH ≥ 40 %.
 *  Falls back to a simple approximation outside that range. */
function calcHeatIndex(tempC: number, rh: number): number {
    const T = tempC * 9 / 5 + 32; // °F for formula
    if (T < 80 || rh < 40) {
        // Simple Rothfusz shortcut for cooler / drier conditions
        const hi = -42.379 + 2.04901523 * T + 10.14333127 * rh
            - 0.22475541 * T * rh - 0.00683783 * T * T
            - 0.05481717 * rh * rh + 0.00122874 * T * T * rh
            + 0.00085282 * T * rh * rh - 0.00000199 * T * T * rh * rh;
        return Number(((hi - 32) * 5 / 9).toFixed(1));
    }
    const hi = -42.379 + 2.04901523 * T + 10.14333127 * rh
        - 0.22475541 * T * rh - 0.00683783 * T * T
        - 0.05481717 * rh * rh + 0.00122874 * T * T * rh
        + 0.00085282 * T * rh * rh - 0.00000199 * T * T * rh * rh;
    return Number(((hi - 32) * 5 / 9).toFixed(1));
}

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

function insertAndBroadcast(data: WeatherData) {
    insertReading.run({
        $temp: data.temperature,
        $humidity: data.humidity,
        $heatIndex: data.heat_index,
        $rainfall: data.rainfall,
    });
    console.log(`[DATA IN] T:${data.temperature}°C, H:${data.humidity}%, HI:${data.heat_index}°C, R:${data.rainfall}mm`);
    const latestInfo = getLatestReading.get();
    broadcast(latestInfo);
}

function startGenerator() {
    if (generatorInterval) clearInterval(generatorInterval);
    if (systemMode === 'none') {
        return;
    }

    // Reset smooth-walk state when generator (re)starts
    if (systemMode === 'test') {
        genTemp = 23 + Math.random();      // 23.0 – 24.0 °C
        genHumidity = 25 + Math.random() * 10; // 25 – 35 %
    } else {
        genTemp = 25 + Math.random() * 10;
        genHumidity = 50 + Math.random() * 40;
    }

    generatorInterval = setInterval(() => {
        let temp: number;
        let humidity: number;
        let rain: number;

        if (systemMode === 'test') {
            // Smooth random walk — small step each tick, clamped to target range
            const tempStep = (Math.random() - 0.5) * 0.3;   // ±0.15 °C per tick
            const rhStep   = (Math.random() - 0.5) * 1.0;   // ±0.5 % RH per tick
            genTemp     = Math.min(24.0, Math.max(23.0, genTemp + tempStep));
            genHumidity = Math.min(35.0, Math.max(25.0, genHumidity + rhStep));
            temp     = genTemp;
            humidity = genHumidity;
            rain     = 0; // no precipitation in test mode
        } else {
            // Demo mode keeps the wider random range
            const tempStep = (Math.random() - 0.5) * 1.0;
            const rhStep   = (Math.random() - 0.5) * 3.0;
            genTemp     = Math.min(35.0, Math.max(25.0, genTemp + tempStep));
            genHumidity = Math.min(90.0, Math.max(50.0, genHumidity + rhStep));
            temp     = genTemp;
            humidity = genHumidity;
            const rainChance = Math.random();
            rain     = rainChance > 0.8 ? Math.random() * 5 : 0;
        }

        const heatIndex = calcHeatIndex(temp, humidity);

        const reading = {
            temperature: Number(temp.toFixed(1)),
            humidity:    Number(humidity.toFixed(1)),
            heat_index:  heatIndex,
            rainfall:    Number(rain.toFixed(1)),
        };

        if (systemMode === 'demo') {
            try {
                insertAndBroadcast(reading);
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

/* ===================== SERIAL PORT ===================== */

let activePort: SerialPort | null = null;
let activePortPath: string = "";
let serialStatus: "disconnected" | "connected" | "error" = "disconnected";
let serialError: string = "";

function processSerialLine(line: string) {
    line = line.trim();
    if (!line || !line.startsWith("{")) return;
    try {
        const data = JSON.parse(line) as any;

        // Handle RTC ack / error responses from ESP — just log them
        if (data.rtc || data.error) {
            console.log(`[SERIAL] ESP response: ${line}`);
            return;
        }

        const weather: WeatherData = {
            temperature: Number(data.temperature),
            humidity: Number(data.humidity),
            heat_index: Number(data.heat_index),
            rainfall: Number(data.rainfall),
        };

        if (
            isNaN(weather.temperature) ||
            isNaN(weather.humidity) ||
            isNaN(weather.heat_index) ||
            isNaN(weather.rainfall)
        ) {
            return;
        }

        insertAndBroadcast(weather);
    } catch (e) {
        console.warn(`[SERIAL] Could not parse line: ${line}`);
    }
}

function openSerialPort(portPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (activePort && activePort.isOpen) {
            activePort.close();
            activePort = null;
            activePortPath = "";
            serialStatus = "disconnected";
        }

        const port = new SerialPort({ path: portPath, baudRate: 115200 });
        const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

        port.on("open", () => {
            activePort = port;
            activePortPath = portPath;
            serialStatus = "connected";
            serialError = "";
            console.log(`[SERIAL] Connected to ${portPath} at 115200 baud`);
            resolve();
        });

        port.on("error", (err) => {
            serialStatus = "error";
            serialError = err.message;
            console.error(`[SERIAL] Error on ${portPath}: ${err.message}`);
            activePort = null;
            activePortPath = "";
            reject(err);
        });

        port.on("close", () => {
            if (serialStatus !== "error") {
                serialStatus = "disconnected";
            }
            console.log(`[SERIAL] Port ${portPath} closed`);
            activePort = null;
            activePortPath = "";
        });

        parser.on("data", (line: string) => {
            processSerialLine(line);
        });
    });
}

function closeSerialPort(): Promise<void> {
    return new Promise((resolve) => {
        if (!activePort || !activePort.isOpen) {
            serialStatus = "disconnected";
            activePort = null;
            activePortPath = "";
            resolve();
            return;
        }
        activePort.close((err) => {
            if (err) console.warn(`[SERIAL] Close error: ${err.message}`);
            activePort = null;
            activePortPath = "";
            serialStatus = "disconnected";
            resolve();
        });
    });
}

/* ===================== HTTP SERVER ===================== */

Bun.serve({
    port: 3001,
    hostname: "0.0.0.0",
    idleTimeout: 60,
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

                    // Send serial status on connection
                    controller.enqueue(new TextEncoder().encode(
                        `event: serial\ndata: ${JSON.stringify({ status: serialStatus, port: activePortPath })}\n\n`
                    ));

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

        // ── POST /api/weather  (keep for backward-compat / manual ingest) ──
        if (req.method === "POST" && url.pathname === "/api/weather") {
            console.log(`\n[INCOMING] POST request to /api/weather`);
            try {
                const rawText = await req.text();
                console.log(`[RAW PAYLOAD] ${rawText}`);
                const body = JSON.parse(rawText) as WeatherData;

                if (
                    typeof body.temperature !== "number" ||
                    typeof body.humidity !== "number" ||
                    typeof body.heat_index !== "number" ||
                    typeof body.rainfall !== "number"
                ) {
                    return new Response(JSON.stringify({ error: "Invalid data format" }), { status: 400, headers });
                }

                insertAndBroadcast(body);
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
            const chronological = historyItems.reverse();
            return new Response(JSON.stringify(chronological), { headers });
        }

        // ── SERIAL PORT ENDPOINTS ──

        // GET /api/serial/ports  — list available COM ports
        if (req.method === "GET" && url.pathname === "/api/serial/ports") {
            try {
                const ports = await SerialPort.list();
                return new Response(JSON.stringify(ports), { headers });
            } catch (e: any) {
                return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
            }
        }

        // GET /api/serial/status  — current port + connection state
        if (req.method === "GET" && url.pathname === "/api/serial/status") {
            return new Response(JSON.stringify({
                status: serialStatus,
                port: activePortPath,
                error: serialError || undefined,
            }), { headers });
        }

        // POST /api/serial/connect  { port: "COM3" }
        if (req.method === "POST" && url.pathname === "/api/serial/connect") {
            try {
                const body = await req.json() as { port: string };
                if (!body.port) {
                    return new Response(JSON.stringify({ error: "port is required" }), { status: 400, headers });
                }
                await openSerialPort(body.port);
                // Broadcast serial status update to all SSE clients
                broadcast({ status: serialStatus, port: activePortPath }, 'serial');
                return new Response(JSON.stringify({ success: true, port: activePortPath, status: serialStatus }), { headers });
            } catch (e: any) {
                broadcast({ status: serialStatus, port: activePortPath }, 'serial');
                return new Response(JSON.stringify({ error: e.message, status: serialStatus }), { status: 500, headers });
            }
        }

        // POST /api/serial/disconnect
        if (req.method === "POST" && url.pathname === "/api/serial/disconnect") {
            await closeSerialPort();
            broadcast({ status: serialStatus, port: activePortPath }, 'serial');
            return new Response(JSON.stringify({ success: true, status: serialStatus }), { headers });
        }

        // POST /api/serial/send  { data: "2026-03-12 09:00:00" }  — send RTC sync command
        if (req.method === "POST" && url.pathname === "/api/serial/send") {
            if (!activePort || !activePort.isOpen) {
                return new Response(JSON.stringify({ error: "No serial port connected" }), { status: 400, headers });
            }
            try {
                const body = await req.json() as { data: string };
                activePort.write(body.data + "\n");
                return new Response(JSON.stringify({ success: true }), { headers });
            } catch (e: any) {
                return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
            }
        }

        return new Response("Not Found", { status: 404, headers });
    },
});

console.log("🌦  Weather API running on http://localhost:3001 with SSE + COM port capabilities");
