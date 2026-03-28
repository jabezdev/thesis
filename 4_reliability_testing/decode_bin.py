import struct
import csv
import os
from datetime import datetime

# Struct definition from reliability_test.ino
# struct __attribute__((packed)) WeatherPacketFull { ... }
# Total size: 159 bytes
# 72 fields
fmt = '<I h H H H I H h H B H H h H H H H H H B I I I H b B H H H I H I B B B I I I H I H H H H I I H H H H H H I H H H H H H H H H H h H B H H H i H H'
struct_size = struct.calcsize(fmt)

fields = [
    ('ts', lambda x: datetime.fromtimestamp(x).strftime('%Y-%m-%d %H:%M:%S') if x > 0 else '0'),
    ('temp', lambda x: x / 10.0),
    ('hum', lambda x: x / 10.0),
    ('rain', lambda x: x / 100.0),
    ('rain_1h', lambda x: x / 100.0),
    ('rain_raw', lambda x: x),
    ('v_batt', lambda x: x / 100.0),
    ('i_batt', lambda x: x / 1000.0),
    ('p_batt', lambda x: x / 100.0),
    ('soc', lambda x: x),
    ('rem_ah', lambda x: x / 1000.0),
    ('e_wh', lambda x: x / 10.0),
    ('i_peak', lambda x: x / 1000.0),
    ('v_min', lambda x: x / 100.0),
    ('v_sol', lambda x: x / 100.0),
    ('i_sol', lambda x: x / 1000.0),
    ('p_sol', lambda x: x / 100.0),
    ('e_sol_wh', lambda x: x / 10.0),
    ('i_sol_peak', lambda x: x / 1000.0),
    ('int_temp', lambda x: x),
    ('min_heap', lambda x: x),
    ('log_count', lambda x: x),
    ('sd_free_mb', lambda x: x),
    ('up_lat_ms', lambda x: x),
    ('rssi', lambda x: x),
    ('flags', lambda x: bin(x)),
    ('reconn_count', lambda x: x),
    ('fail_streak', lambda x: x),
    ('max_fail', lambda x: x),
    ('uptime_s', lambda x: x),
    ('uptime_h_s10', lambda x: x / 10.0),
    ('free_heap', lambda x: x),
    ('heap_frag', lambda x: x),
    ('sensor_stat', lambda x: x),
    ('reset_rc', lambda x: x),
    ('boot_count', lambda x: x),
    ('send_success', lambda x: x),
    ('send_fail', lambda x: x),
    ('sd_fail', lambda x: x),
    ('total_read', lambda x: x),
    ('mod_err_s100', lambda x: x / 100.0),
    ('consec_mb_fail', lambda x: x),
    ('max_mb_fail', lambda x: x),
    ('mb_latency', lambda x: x),
    ('wifi_off_total', lambda x: x),
    ('long_off_streak', lambda x: x),
    ('dongle_pc', lambda x: x),
    ('pending_rows', lambda x: x),
    ('avg_ul_lat', lambda x: x),
    ('sd_w_lat', lambda x: x),
    ('s_stack_hwm', lambda x: x),
    ('u_stack_hwm', lambda x: x),
    ('sd_used_mb', lambda x: x),
    ('loop_jitter', lambda x: x),
    ('brownouts', lambda x: x),
    ('i2c_errs', lambda x: x),
    ('sd_max_lat', lambda x: x),
    ('batt_ir_s10', lambda x: x / 10.0),
    ('mt_count', lambda x: x),
    ('mc_count', lambda x: x),
    ('h2xx', lambda x: x),
    ('h4xx', lambda x: x),
    ('h5xx', lambda x: x),
    ('last_http', lambda x: x),
    ('hte_count', lambda x: x),
    ('sd_flags', lambda x: bin(x)),
    ('sd_remount_try', lambda x: x),
    ('sd_remount_ok', lambda x: x),
    ('net_kbps_s10', lambda x: x / 10.0),
    ('ntp_drift', lambda x: x),
    ('ntp_backoff_s', lambda x: x),
    ('up_interval', lambda x: x),
]

def decode():
    bin_path = 'data/datalog.bin'
    csv_path = 'data/datalog_decoded.csv'
    
    if not os.path.exists(bin_path):
        print(f"Error: {bin_path} not found.")
        return

    with open(bin_path, 'rb') as f_bin, open(csv_path, 'w', newline='') as f_csv:
        writer = csv.writer(f_csv)
        # Write header
        writer.writerow([field[0] for field in fields])
        
        count = 0
        while True:
            data = f_bin.read(struct_size)
            if len(data) < struct_size:
                break
            
            try:
                values = struct.unpack(fmt, data)
                decoded_row = []
                for i, val in enumerate(values):
                    decoded_row.append(fields[i][1](val))
                writer.writerow(decoded_row)
                count += 1
            except Exception as e:
                print(f"Error unpacking at record {count}: {e}")
                break
        
        print(f"Successfully decoded {count} records to {csv_path}")

if __name__ == '__main__':
    decode()
