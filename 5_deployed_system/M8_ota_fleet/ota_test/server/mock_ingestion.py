from flask import Flask, send_from_directory, request, jsonify
import os

app = Flask(__name__)

# Track the version the node is SUPPOSED to have.
# If the node reports something different, we will send the OTA command.
TARGET_VERSION = "v1.1"

@app.route('/api/v1/ingest', methods=['POST'])
def ingest():
    data = request.json or {}
    node_id = data.get('node_id', 'unknown')
    current_version = data.get('firmware_version', 'v1.0')
    
    print(f"\n[{node_id}] Heartbeat received!")
    print(f"[{node_id}] Current version: {current_version}")
    
    headers = {}
    if current_version != TARGET_VERSION:
        print(f"[{node_id}] Needs update to {TARGET_VERSION}. Sending OTA command...")
        
        # Dynamically get the server's IP based on the host the node used to connect
        server_ip = request.host.split(':')[0]
        ota_url = f"http://{server_ip}:8080/firmware.bin"
        
        headers['X-Cmd'] = f"ota={ota_url}"
    else:
        print(f"[{node_id}] Node is up to date.")
        
    return jsonify({"status": "success", "message": "data ingested"}), 200, headers

@app.route('/firmware.bin', methods=['GET'])
def get_firmware():
    print("Node is requesting firmware.bin...")
    # Serve the firmware binary from the same directory as this script
    if not os.path.exists('firmware.bin'):
        print("ERROR: firmware.bin not found in the directory! Please place it here.")
        return "File not found", 404
        
    return send_from_directory('.', 'firmware.bin')

if __name__ == '__main__':
    print("=======================================================")
    print("Mock Ingestion API & OTA Server Listens on port 8080...")
    print("=======================================================")
    print("INSTRUCTIONS:")
    print("1. Compile your ESP32 target script (e.g., fast blink).")
    print("   Make sure to change its firmwareVersion string to 'v1.1'!")
    print("2. Go to Sketch -> Export compiled Binary.")
    print("3. Rename the exported .bin to 'firmware.bin'.")
    print("4. Place 'firmware.bin' in this exact folder.")
    print("5. Run this python script: pip install flask && python mock_ingestion.py")
    print("=======================================================\n")
    
    # Listen on all interfaces so the ESP32 can connect
    app.run(host='0.0.0.0', port=8080)
