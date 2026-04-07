/**
 * @panahonCore - Shared Physics & Types
 */

export interface RawSensorData {
  ts: string;
  node_id?: string;
  uptime_ms: number;
  temp: number;
  hum: number;
  rain: number;
  batt_v: number;
  batt_i: number;
  solar_v: number;
  solar_i: number;
  samples: number;
  processed_at?: string;
}

export interface NodeCalibration {
  temp_offset: number;
  temp_scalar: number;
  hum_offset: number;
  hum_scalar: number;
  rain_scalar: number; // Rain is usually additive for mm, but often need a scalar for tip-bucket calibration
  batt_v_offset: number;
  solar_v_offset: number;
  // TODO(future): These basic scalar/offset constants will likely be replaced
  // by more complex mapping functions (e.g., polynomials) customized per sensor.
}

export interface ProcessedData extends RawSensorData {
  temp_corrected: number;
  hum_corrected: number;
  rain_corrected: number;
  batt_v_corrected: number;
  solar_v_corrected: number;
  is_extreme_weather: boolean;
}

/**
 * Apply calibration coefficients to raw sensor data.
 * y = (x * scalar) + offset
 */
export function applyCalibration(
  raw: RawSensorData,
  cal: NodeCalibration
): ProcessedData {
  const temp_corrected = (raw.temp * cal.temp_scalar) + cal.temp_offset;
  const hum_corrected = (raw.hum * cal.hum_scalar) + cal.hum_offset;
  const rain_corrected = raw.rain * cal.rain_scalar;
  const batt_v_corrected = raw.batt_v + cal.batt_v_offset;
  const solar_v_corrected = raw.solar_v + cal.solar_v_offset;

  // Simple heuristic for "extreme" weather (can be refined per LGU)
  const is_extreme_weather = rain_corrected > 50 || temp_corrected > 40 || temp_corrected < 15;

  return {
    ...raw,
    temp_corrected,
    hum_corrected,
    rain_corrected,
    batt_v_corrected,
    solar_v_corrected,
    is_extreme_weather,
  };
}

/**
 * Default calibration (1.0 scalar, 0.0 offset)
 */
export const DEFAULT_CALIBRATION: NodeCalibration = {
  temp_offset: 0,
  temp_scalar: 1,
  hum_offset: 0,
  hum_scalar: 1,
  rain_scalar: 1,
  batt_v_offset: 0,
  solar_v_offset: 0,
};
