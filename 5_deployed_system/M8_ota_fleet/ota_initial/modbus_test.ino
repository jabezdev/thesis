// ── Modbus RS485 Temp/Humidity Diagnostic ──────────────────────────
// Standalone test — no WiFi, no SD, no I2C. Just Modbus on Serial1.
// Flash this, open Serial Monitor at 115200, and watch the output.

#include <ModbusMaster.h>

#define RS485_RX 16
#define RS485_TX 17

ModbusMaster node;

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("\n========================================");
    Serial.println("  Modbus RS485 Temp/Humidity Test");
    Serial.println("  RX=16  TX=17  Baud=9600  Addr=1");
    Serial.println("========================================\n");

    Serial1.begin(9600, SERIAL_8N1, RS485_RX, RS485_TX);
    node.begin(1, Serial1);

    // Try an initial read immediately
    Serial.println("[BOOT] Attempting first read...\n");
}

void loop() {
    static uint32_t count = 0;
    count++;

    Serial.printf("── Read #%lu ──────────────────────────\n", (unsigned long)count);

    // Attempt to read 2 holding registers starting at 0x0000
    unsigned long t0 = millis();
    uint8_t result = node.readHoldingRegisters(0x0000, 2);
    unsigned long elapsed = millis() - t0;

    if (result == node.ku8MBSuccess) {
        uint16_t raw_hum  = node.getResponseBuffer(0);
        uint16_t raw_temp = node.getResponseBuffer(1);
        float humidity    = raw_hum / 10.0f;
        float temperature = raw_temp / 10.0f;

        Serial.printf("  STATUS:  OK (0x%02X)\n", result);
        Serial.printf("  RAW[0]:  %u  (humidity * 10)\n", raw_hum);
        Serial.printf("  RAW[1]:  %u  (temperature * 10)\n", raw_temp);
        Serial.printf("  TEMP:    %.1f C\n", temperature);
        Serial.printf("  HUM:     %.1f %%\n", humidity);
    } else {
        Serial.printf("  STATUS:  FAIL (0x%02X) ", result);
        switch (result) {
            case node.ku8MBInvalidSlaveID:     Serial.println("- Invalid Slave ID"); break;
            case node.ku8MBInvalidFunction:    Serial.println("- Invalid Function"); break;
            case node.ku8MBResponseTimedOut:    Serial.println("- Response Timed Out"); break;
            case node.ku8MBInvalidCRC:          Serial.println("- Invalid CRC"); break;
            default:                            Serial.printf("- Unknown error\n"); break;
        }
    }
    Serial.printf("  LATENCY: %lu ms\n\n", elapsed);

    // Every 5th read, also try input registers and address scan
    if (count % 5 == 0) {
        Serial.println("── Trying Input Registers (0x0000, 2) ──");
        uint8_t r2 = node.readInputRegisters(0x0000, 2);
        if (r2 == node.ku8MBSuccess) {
            Serial.printf("  INPUT[0]: %u\n", node.getResponseBuffer(0));
            Serial.printf("  INPUT[1]: %u\n", node.getResponseBuffer(1));
        } else {
            Serial.printf("  FAIL (0x%02X)\n", r2);
        }

        // Quick scan addresses 1-5
        Serial.println("\n── Address Scan (1-5) ──");
        for (uint8_t addr = 1; addr <= 5; addr++) {
            ModbusMaster probe;
            probe.begin(addr, Serial1);
            uint8_t r = probe.readHoldingRegisters(0x0000, 2);
            if (r == probe.ku8MBSuccess) {
                Serial.printf("  ADDR %d: RESPONDED! H=%u T=%u\n", addr,
                              probe.getResponseBuffer(0), probe.getResponseBuffer(1));
            } else {
                Serial.printf("  ADDR %d: no response (0x%02X)\n", addr, r);
            }
            delay(100);
        }
        Serial.println();
    }

    delay(2000); // Read every 2 seconds
}
