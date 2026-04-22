import { useState, useEffect, useMemo } from 'react'
import { Card, Badge } from '@panahon/ui'
import { Activity, Wifi, Cpu, Sun, Zap, CloudOff, Radio, Rocket, ListTree, Database } from 'lucide-react'
import { ref, onValue } from 'firebase/database'
import { collection, query, orderBy, limit, onSnapshot, documentId } from 'firebase/firestore'
import { rtdb } from './firebase'
import { db } from './firebase'
import { applyCalibration, type RawSensorData } from '@panahon/shared'

/**
 * @panahonStatus — Fleet Monitoring Engine
 */

export default function App() {
  const [nodeIds, setNodeIds] = useState<string[]>([]);
  const [nodesMetadata, setNodesMetadata] = useState<Record<string, any>>({});
  const [latestData, setLatestData] = useState<Record<string, RawSensorData>>({});
  const [latestWeatherPacket, setLatestWeatherPacket] = useState<Record<string, RawSensorData>>({});
  const [latestTelemetryPacket, setLatestTelemetryPacket] = useState<Record<string, Record<string, any>>>({});
  const [latestHeartbeatPacket, setLatestHeartbeatPacket] = useState<Record<string, Record<string, any>>>({});
  const [latestStartupPacket, setLatestStartupPacket] = useState<Record<string, Record<string, any>>>({});
  const [now, setNow] = useState(Date.now());

  const packetFieldOrder = [
    'ts', 'timestamp', 'node_id', 'firmware', 'uptime_ms', 'uptime_h', 'temp', 'hum', 'rain',
    'batt_v', 'batt_i', 'solar_v', 'solar_i', 'samples', 'wifi_rssi', 'free_heap', 'min_heap',
    'queue_depth', 'pending_backlog', 'send_ok', 'send_fail', 'sd_fail', 'mb_errs', 'i2c_errs',
    'wifi_reconn', 'pending_cursor', 'pending_total'
  ];

  const hasWeatherValues = (packet: any) => {
    return Number.isFinite(packet?.temp) && Number.isFinite(packet?.hum) && Number.isFinite(packet?.rain)
  }

  const heatIndex = (t: number, rh: number): number | null => {
    if (t < 27 || rh < 40) return null
    return (
      -8.78469475556 + 1.61139411 * t + 2.33854883889 * rh
      - 0.14611605 * t * rh - 0.012308094 * t * t
      - 0.0164248277778 * rh * rh + 0.002211732 * t * t * rh
      + 0.00072546 * t * rh * rh - 0.000003582 * t * t * rh * rh
    )
  }

  const formatPacketValue = (value: any): string => {
    if (value == null) return '--';
    if (typeof value === 'number') return Number.isInteger(value) ? `${value}` : value.toFixed(2);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value);
  }

  const decodeFirestoreTypedValue = (value: any): any => {
    if (!value || typeof value !== 'object') return value;
    if ('stringValue' in value) return value.stringValue;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return Number(value.doubleValue);
    if ('booleanValue' in value) return Boolean(value.booleanValue);
    if ('nullValue' in value) return null;
    if ('timestampValue' in value) return value.timestampValue;
    if ('mapValue' in value) {
      const fields = value.mapValue?.fields ?? {};
      return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeFirestoreTypedValue(v)]));
    }
    if ('arrayValue' in value) {
      const values = value.arrayValue?.values ?? [];
      return values.map((entry: any) => decodeFirestoreTypedValue(entry));
    }
    return value;
  }

  const normalizeFirestorePacket = (raw: Record<string, any>): Record<string, any> => {
    if (raw?.fields && typeof raw.fields === 'object') {
      return Object.fromEntries(
        Object.entries(raw.fields).map(([k, v]) => [k, decodeFirestoreTypedValue(v)])
      );
    }
    return raw;
  }

  const resolveNodeId = (packet: Record<string, any>, docId: string, kind: 'startup' | 'heartbeat'): string | undefined => {
    if (typeof packet?.node_id === 'string' && packet.node_id.length > 0) return packet.node_id;

    if (kind === 'heartbeat' && docId.includes('_hb_')) {
      return docId.split('_hb_')[0];
    }

    const startupLike = docId.match(/^(.*)_\d+$/);
    if (startupLike?.[1]) return startupLike[1];

    return undefined;
  }

  const flattenPacket = (packet: Record<string, any> | undefined, root = ''): Array<{ key: string; value: any }> => {
    if (!packet) return [];

    const flat: Array<{ key: string; value: any }> = [];
    const walk = (value: any, path: string) => {
      if (value == null) {
        flat.push({ key: path, value: null });
        return;
      }

      if (Array.isArray(value)) {
        if (value.length === 0) {
          flat.push({ key: path, value: '[]' });
          return;
        }
        value.forEach((item, idx) => {
          const childPath = `${path}[${idx}]`;
          if (item && typeof item === 'object') {
            walk(item, childPath);
          } else {
            flat.push({ key: childPath, value: item });
          }
        });
        return;
      }

      if (typeof value === 'object') {
        const entries = Object.entries(value);
        if (entries.length === 0) {
          flat.push({ key: path, value: '{}' });
          return;
        }
        entries.forEach(([k, v]) => {
          walk(v, path ? `${path}.${k}` : k);
        });
        return;
      }

      flat.push({ key: path || root, value });
    };

    walk(packet, root);

    const rank = (key: string) => {
      const top = key.split(/[.[]/)[0];
      const idx = packetFieldOrder.indexOf(top);
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    };

    return flat.sort((a, b) => {
      const byRank = rank(a.key) - rank(b.key);
      if (byRank !== 0) return byRank;
      return a.key.localeCompare(b.key);
    });
  }

  // Update "now" every minute for "last seen" relative time precision
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  // 1. Discover Nodes
  useEffect(() => {
    const registryRef = ref(rtdb, 'registry/nodes');
    return onValue(registryRef, (snapshot) => {
      if (snapshot.exists()) {
        setNodeIds(snapshot.val());
      }
    });
  }, []);

  // 2. Set up RTDB listeners for metadata and latest telemetry
  useEffect(() => {
    if (nodeIds.length === 0) return;

    const unsubs: (() => void)[] = [];
    
    nodeIds.forEach(id => {
      // Metadata listener
      const metaRef = ref(rtdb, `nodes/${id}/metadata`);
      const unsubMeta = onValue(metaRef, (snapshot) => {
        if (snapshot.exists()) {
          setNodesMetadata(prev => ({ ...prev, [id]: snapshot.val() }));
        }
      });
      unsubs.push(unsubMeta);

      // Latest telemetry listener
      const latestRef = ref(rtdb, `nodes/${id}/latest`);
      const unsubLatest = onValue(latestRef, (snapshot) => {
        if (snapshot.exists()) {
          const packet = snapshot.val();
          setLatestData(prev => ({ ...prev, [id]: packet }));
          if (hasWeatherValues(packet)) {
            setLatestWeatherPacket(prev => ({ ...prev, [id]: packet }));
          }
        }
      });
      unsubs.push(unsubLatest);

      // Last-hour telemetry listener for locating latest weather payload packet.
      const lastHourRef = ref(rtdb, `nodes/${id}/last_hour`);
      const unsubLastHour = onValue(lastHourRef, (snapshot) => {
        if (!snapshot.exists()) return;
        const packets = snapshot.val() as Record<string, RawSensorData>;
        const latestWeather = Object.entries(packets)
          .sort(([a], [b]) => Number(b) - Number(a))
          .map(([, packet]) => packet)
          .find((packet) => hasWeatherValues(packet));

        if (latestWeather) {
          setLatestWeatherPacket(prev => ({ ...prev, [id]: latestWeather }));
        }
      });
      unsubs.push(unsubLastHour);
    });

    return () => unsubs.forEach(u => u());
  }, [nodeIds]);

  // 3. Listen to startup packets from Firestore and keep latest per node.
  useEffect(() => {
    const startupQuery = query(collection(db, 'startup_0v3'), orderBy(documentId(), 'desc'), limit(3000));

    return onSnapshot(startupQuery, (snapshot) => {
      const latestByNode: Record<string, Record<string, any>> = {};

      snapshot.docs.forEach((docSnap) => {
        const normalized = normalizeFirestorePacket(docSnap.data() as Record<string, any>);
        const nodeId = resolveNodeId(normalized, docSnap.id, 'startup');
        if (!nodeId || latestByNode[nodeId]) return;
        latestByNode[nodeId] = { ...normalized, _doc_id: docSnap.id };
      });

      setLatestStartupPacket(latestByNode);
    });
  }, []);

  // 4. Listen to heartbeat packets from Firestore and keep latest per node.
  useEffect(() => {
    const heartbeatQuery = query(collection(db, 'heartbeat_0v3'), orderBy(documentId(), 'desc'), limit(3000));

    return onSnapshot(heartbeatQuery, (snapshot) => {
      const latestByNode: Record<string, Record<string, any>> = {};

      snapshot.docs.forEach((docSnap) => {
        const normalized = normalizeFirestorePacket(docSnap.data() as Record<string, any>);
        const nodeId = resolveNodeId(normalized, docSnap.id, 'heartbeat');
        if (!nodeId || latestByNode[nodeId]) return;
        latestByNode[nodeId] = { ...normalized, _doc_id: docSnap.id };
      });

      setLatestHeartbeatPacket(latestByNode);
    });
  }, []);

  // 5. Listen to latest node_data packets from Firestore and keep latest per node.
  useEffect(() => {
    const dataQuery = query(collection(db, 'node_data_0v3'), orderBy(documentId(), 'desc'), limit(3000));

    return onSnapshot(dataQuery, (snapshot) => {
      const latestByNode: Record<string, Record<string, any>> = {};

      snapshot.docs.forEach((docSnap) => {
        const normalized = normalizeFirestorePacket(docSnap.data() as Record<string, any>);
        const nodeId = resolveNodeId(normalized, docSnap.id, 'startup');
        if (!nodeId || latestByNode[nodeId]) return;
        latestByNode[nodeId] = { ...normalized, _doc_id: docSnap.id };
      });

      setLatestTelemetryPacket(latestByNode);
    });
  }, []);

  // Global Health Logic
  const systemStatus = useMemo(() => {
    if (nodeIds.length === 0) return 'loading';
    if (Object.keys(latestData).length === 0) return 'degraded';
    
    const mostRecentUpdate = Math.max(...Object.values(latestData).map(d => new Date(d.ts).getTime()));
    if (Date.now() - mostRecentUpdate > 60000) return 'critical';

    const hasOfflineNode = nodeIds.some(id => {
      const data = latestData[id];
      if (!data) return true;
      const age = Date.now() - new Date(data.ts).getTime();
      return age > 10 * 60000;
    });

    return hasOfflineNode ? 'degraded' : 'operational';
  }, [nodeIds, latestData, now]);

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 font-sans selection:bg-emerald-500/30 overflow-x-hidden relative">
      {/* Decorative Gradients */}
      <div className="fixed top-0 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-0 right-1/4 w-96 h-96 bg-emerald-600/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Header */}
      <header className="border-b border-slate-800/60 p-4 md:p-6 flex justify-between items-center sticky top-0 z-50 backdrop-blur-xl bg-[#020617]/70">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold shadow-lg shadow-blue-500/20 text-lg">P</div>
          <div>
            <h1 className="text-base md:text-lg font-bold tracking-tight flex items-center gap-2">
              Panahon <span className="text-blue-500">Fleet Status</span>
            </h1>
            <p className="text-[10px] uppercase tracking-[0.2em] font-black text-slate-500 leading-none">System Telemetry Engine</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden lg:flex flex-col items-end">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Global Heartbeat</span>
            <span className="text-xs font-mono text-slate-300">{new Date(now).toLocaleTimeString()}</span>
          </div>
          <Badge variant={
            systemStatus === 'operational' ? "success" : 
            systemStatus === 'degraded' ? "warning" : "error"
          } className="px-4 py-1.5 rounded-full text-[10px] font-black tracking-widest border-none shadow-lg shadow-current/10">
            {systemStatus.toUpperCase()}
          </Badge>
        </div>
      </header>

      <main className="p-4 md:p-10 max-w-6xl mx-auto relative">
        {nodeIds.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 gap-6">
            <div className="relative">
              <div className="absolute inset-0 bg-emerald-500/20 blur-xl rounded-full scale-150 animate-pulse" />
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-r-2 border-emerald-500 relative" />
            </div>
            <div className="text-center">
              <p className="font-bold text-slate-200 tracking-tight">Syncing Fleet Registry</p>
              <p className="text-sm text-slate-500">Connecting to Realtime Database...</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:gap-10">
            {nodeIds.map(id => {
              const meta = nodesMetadata[id];
              const data = latestData[id];
              const weatherPacket = latestWeatherPacket[id] || (hasWeatherValues(data) ? data : undefined);
              const telemetryPacket = latestTelemetryPacket[id];
              const startupPacket = latestStartupPacket[id];
              const heartbeatPacket = latestHeartbeatPacket[id];
              const processed = data && meta?.calibration ? applyCalibration(data, meta.calibration) : null;
              const processedWeather = weatherPacket && meta?.calibration ? applyCalibration(weatherPacket, meta.calibration) : null;
              const hi = processedWeather ? heatIndex(processedWeather.temp_corrected, processedWeather.hum_corrected) : null;
              
              if (!meta) return null;

              const ageSeconds = data ? (Date.now() - new Date(data.ts).getTime()) / 1000 : Infinity;
              const isOffline = ageSeconds > 600; // 10 mins
              const isCharging = data && data.solar_i > 50;
              const startupSeen = Boolean(startupPacket);
              const startupTime = startupPacket?.timestamp || startupPacket?.history?.[0]?.ts || '--';
              const weatherFields = flattenPacket(weatherPacket as Record<string, any> | undefined);
              const telemetryFields = flattenPacket(telemetryPacket);
              const heartbeatFields = flattenPacket(heartbeatPacket);
              const startupFields = flattenPacket(startupPacket);

              return (
                <Card key={id} className={`group overflow-hidden bg-slate-900/40 backdrop-blur-md border border-slate-800/50 hover:border-slate-700/80 transition-all duration-500 rounded-[2rem] shadow-2xl relative ${isOffline ? 'opacity-80 saturate-[0.25]' : ''}`}>
                  {/* Status Indicator Bar */}
                  <div className={`absolute top-0 left-0 w-full h-1.5 ${isOffline ? 'bg-rose-500/30' : 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.3)]'}`} />

                  {/* Node Header Section */}
                  <div className="p-6 md:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-white/[0.03]">
                    <div className="flex items-center gap-5">
                      <div className={`p-4 rounded-2xl bg-slate-800/50 border border-white/[0.05] transition-transform duration-500 group-hover:scale-110 ${isOffline ? 'text-slate-500' : 'text-blue-400'}`}>
                        <Cpu size={32} strokeWidth={1.5} />
                      </div>
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <h2 className="text-xl md:text-2xl font-bold tracking-tight text-white">
                            {meta.name}
                          </h2>
                          <Badge variant={isOffline ? "error" : "success"} className="rounded-md px-2 py-0.5 text-[9px] font-black tracking-widest uppercase">
                            {isOffline ? 'Offline' : 'Online'}
                          </Badge>
                        </div>
                        <p className="text-xs font-medium text-slate-500 flex items-center gap-2">
                          <span className="font-mono text-[10px] bg-white/5 px-2 py-0.5 rounded border border-white/5">{id.toUpperCase()}</span>
                          <span className="w-1 h-1 rounded-full bg-slate-700" />
                          {meta.location.description}
                        </p>
                      </div>
                    </div>

                    <div className="w-full md:w-auto grid grid-cols-2 gap-4 md:flex md:items-center md:gap-8">
                      <div className="text-left md:text-right">
                        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 mb-1">Connectivity</p>
                        <div className="flex items-center md:justify-end gap-2 text-white">
                           {isOffline ? <CloudOff size={16} className="text-rose-500" /> : <Wifi size={16} className="text-emerald-400 shadow-emerald-500/50" />}
                           <span className="font-bold text-sm">{isOffline ? 'LOST' : ageSeconds < 90 ? 'LATEST' : 'STALE'}</span>
                        </div>
                      </div>
                      <div className="text-left md:text-right border-l md:border-l-0 pl-4 md:pl-0 border-white/10">
                        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 mb-1">Startup Packet</p>
                        <div className="flex items-center md:justify-end gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${startupSeen ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]' : 'bg-rose-500'}`} />
                          <span className={`font-bold text-sm ${startupSeen ? 'text-emerald-300' : 'text-rose-400'}`}>
                            {startupSeen ? 'RECEIVED' : 'WAITING'}
                          </span>
                        </div>
                      </div>
                      <div className="text-left md:text-right border-l md:border-l-0 pl-4 md:pl-0 border-white/10">
                        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 mb-1">Last Update</p>
                        <p className="font-mono text-sm text-slate-300">
                          {data ? (ageSeconds < 60 ? 'Just now' : `${Math.floor(ageSeconds / 60)}m ago`) : 'No data'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Core Stats Grid */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-white/[0.03]">
                    <div className="p-8 flex flex-col gap-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                        <Activity size={12} className="text-blue-500" /> Uptime
                      </p>
                      <div className="flex items-baseline gap-1.5">
                        <h3 className="text-3xl font-black tracking-tighter text-white">
                          {data ? (data.uptime_ms / 3600000).toFixed(1) : '--'}
                        </h3>
                        <span className="text-xs font-bold text-slate-500 italic">HRS</span>
                      </div>
                    </div>

                    <div className="p-8 flex flex-col gap-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                        <Zap size={12} className="text-amber-400" /> Packet Health
                      </p>
                      <div className="flex items-baseline gap-1.5">
                        <h3 className="text-3xl font-black tracking-tighter text-white">
                          {data ? data.samples : '--'}
                        </h3>
                        <span className="text-xs font-bold text-slate-500 italic">PKTS/SEC</span>
                      </div>
                    </div>

                    <div className="p-8 flex flex-col gap-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                        <Zap size={12} className="text-emerald-400" /> Battery
                      </p>
                      <div className="flex items-baseline gap-1.5">
                        <h3 className="text-3xl font-black tracking-tighter text-white">
                          {processed ? processed.batt_v_corrected.toFixed(2) : '--'}
                        </h3>
                        <span className="text-xs font-bold text-slate-500 italic">V</span>
                      </div>
                      <div className="flex items-baseline gap-1.5 mt-1">
                        <span className="text-lg font-bold tracking-tighter text-slate-300">
                          {data ? data.batt_i.toFixed(1) : '--'}
                        </span>
                        <span className="text-[10px] font-bold text-slate-500 italic">mA</span>
                      </div>
                    </div>

                    <div className="p-8 flex flex-col gap-2 bg-white/[0.01]">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                        <Sun size={12} className={isCharging ? "text-amber-400" : "text-slate-600"} /> Solar
                      </p>
                      <div className="flex items-baseline gap-1.5">
                        <h3 className="text-3xl font-black tracking-tighter text-white">
                          {processed ? processed.solar_v_corrected.toFixed(2) : '--'}
                        </h3>
                        <span className="text-xs font-bold text-slate-500 italic">V</span>
                      </div>
                      <div className="flex items-baseline gap-1.5 mt-1">
                        <span className="text-lg font-bold tracking-tighter text-slate-300">
                          {data ? data.solar_i.toFixed(1) : '--'}
                        </span>
                        <span className="text-[10px] font-bold text-slate-500 italic">mA</span>
                      </div>
                      {isCharging && (
                        <div className="flex items-center gap-2 text-[10px] font-black text-amber-500 tracking-widest mt-1">
                          <Zap size={10} fill="currentColor" className="animate-pulse" />
                          CHARGING
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Latest Weather Packet */}
                  <div className="px-8 py-6 border-t border-white/[0.03] bg-white/[0.01]">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Latest Weather Packet</p>
                      <p className="text-[10px] font-mono text-slate-500">
                        {weatherPacket ? new Date(weatherPacket.ts).toLocaleString() : 'No weather packet yet'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      {[
                        { label: 'Air Temp', value: processedWeather?.temp_corrected, unit: '°C', color: 'text-orange-400' },
                        { label: 'Humidity', value: processedWeather?.hum_corrected, unit: '%', color: 'text-teal-400' },
                        { label: 'Precip', value: processedWeather?.rain_corrected, unit: 'mm', color: 'text-blue-400' },
                        { label: 'Heat Index', value: hi ?? processedWeather?.temp_corrected, unit: '°C', color: 'text-rose-400' },
                      ].map((metric) => (
                        <div key={metric.label} className="rounded-xl border border-white/[0.05] bg-slate-950/30 p-3">
                          <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">{metric.label}</p>
                          <p className={`text-xl font-black tracking-tight ${metric.color}`}>
                            {metric.value == null ? '--' : metric.value.toFixed(1)}
                            <span className="text-xs text-slate-500 ml-1">{metric.unit}</span>
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Whole Packet Inspector */}
                  <div className="px-8 py-6 border-t border-white/[0.03] bg-black/10">
                    <div className="flex items-center gap-2 mb-4">
                      <ListTree size={14} className="text-slate-400" />
                      <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Whole Packet Inspector</p>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-4 gap-4">
                      <div className="rounded-2xl border border-white/[0.05] bg-slate-950/40 overflow-hidden">
                        <div className="px-4 py-3 border-b border-white/[0.05] flex items-center justify-between">
                          <p className="text-[11px] font-black uppercase tracking-widest text-violet-300 flex items-center gap-2">
                            <Database size={12} /> Raw Data Packet
                          </p>
                          <span className="text-[10px] font-mono text-slate-500">{telemetryPacket?._doc_id || '--'}</span>
                        </div>
                        <div className="px-4 py-3 grid grid-cols-2 gap-2 border-b border-white/[0.05] bg-white/[0.01]">
                          <div className="rounded-lg border border-white/[0.05] p-2">
                            <p className="text-[9px] uppercase tracking-widest text-slate-500 font-black">Timestamp</p>
                            <p className="text-xs font-black text-violet-200 truncate">{telemetryPacket?.timestamp || '--'}</p>
                          </div>
                          <div className="rounded-lg border border-white/[0.05] p-2">
                            <p className="text-[9px] uppercase tracking-widest text-slate-500 font-black">Samples</p>
                            <p className="text-sm font-black text-violet-300">{telemetryPacket?.history?.length ?? '--'}</p>
                          </div>
                        </div>
                        <div className="max-h-72 overflow-auto">
                          {telemetryFields.length === 0 ? (
                            <p className="px-4 py-6 text-xs text-slate-500">No raw data packet available.</p>
                          ) : (
                            telemetryFields.map((field) => (
                              <div key={`data-${field.key}`} className="px-4 py-2 border-b border-white/[0.03] grid grid-cols-[1.2fr_1fr] gap-3 text-xs">
                                <span className="text-slate-400 break-all">{field.key}</span>
                                <span className="font-mono text-slate-200 text-right break-all">{formatPacketValue(field.value)}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/[0.05] bg-slate-950/40 overflow-hidden">
                        <div className="px-4 py-3 border-b border-white/[0.05] flex items-center justify-between">
                          <p className="text-[11px] font-black uppercase tracking-widest text-blue-300 flex items-center gap-2">
                            <Sun size={12} /> Weather Packet
                          </p>
                          <span className="text-[10px] font-mono text-slate-500">{weatherPacket?.ts || '--'}</span>
                        </div>
                        <div className="px-4 py-3 grid grid-cols-2 gap-2 border-b border-white/[0.05] bg-white/[0.01]">
                          <div className="rounded-lg border border-white/[0.05] p-2">
                            <p className="text-[9px] uppercase tracking-widest text-slate-500 font-black">Temp</p>
                            <p className="text-sm font-black text-orange-300">{processedWeather ? `${processedWeather.temp_corrected.toFixed(1)} °C` : '--'}</p>
                          </div>
                          <div className="rounded-lg border border-white/[0.05] p-2">
                            <p className="text-[9px] uppercase tracking-widest text-slate-500 font-black">Humidity</p>
                            <p className="text-sm font-black text-teal-300">{processedWeather ? `${processedWeather.hum_corrected.toFixed(1)} %` : '--'}</p>
                          </div>
                        </div>
                        <div className="max-h-72 overflow-auto">
                          {weatherFields.length === 0 ? (
                            <p className="px-4 py-6 text-xs text-slate-500">No weather packet available.</p>
                          ) : (
                            weatherFields.map((field) => (
                              <div key={`weather-${field.key}`} className="px-4 py-2 border-b border-white/[0.03] grid grid-cols-[1.2fr_1fr] gap-3 text-xs">
                                <span className="text-slate-400 break-all">{field.key}</span>
                                <span className="font-mono text-slate-200 text-right break-all">{formatPacketValue(field.value)}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/[0.05] bg-slate-950/40 overflow-hidden">
                        <div className="px-4 py-3 border-b border-white/[0.05] flex items-center justify-between">
                          <p className="text-[11px] font-black uppercase tracking-widest text-emerald-300 flex items-center gap-2">
                            <Radio size={12} /> Heartbeat Packet
                          </p>
                          <span className="text-[10px] font-mono text-slate-500">{heartbeatPacket?._doc_id || '--'}</span>
                        </div>
                        <div className="px-4 py-3 grid grid-cols-2 gap-2 border-b border-white/[0.05] bg-white/[0.01]">
                          <div className="rounded-lg border border-white/[0.05] p-2">
                            <p className="text-[9px] uppercase tracking-widest text-slate-500 font-black">RSSI</p>
                            <p className="text-sm font-black text-emerald-300">{heartbeatPacket?.wifi_rssi ?? '--'} dBm</p>
                          </div>
                          <div className="rounded-lg border border-white/[0.05] p-2">
                            <p className="text-[9px] uppercase tracking-widest text-slate-500 font-black">Queue Depth</p>
                            <p className="text-sm font-black text-emerald-200">{heartbeatPacket?.queue_depth ?? '--'}</p>
                          </div>
                        </div>
                        <div className="max-h-72 overflow-auto">
                          {heartbeatFields.length === 0 ? (
                            <p className="px-4 py-6 text-xs text-slate-500">No heartbeat packet available.</p>
                          ) : (
                            heartbeatFields.map((field) => (
                              <div key={`heartbeat-${field.key}`} className="px-4 py-2 border-b border-white/[0.03] grid grid-cols-[1.2fr_1fr] gap-3 text-xs">
                                <span className="text-slate-400 break-all">{field.key}</span>
                                <span className="font-mono text-slate-200 text-right break-all">{formatPacketValue(field.value)}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/[0.05] bg-slate-950/40 overflow-hidden">
                        <div className="px-4 py-3 border-b border-white/[0.05] flex items-center justify-between">
                          <p className="text-[11px] font-black uppercase tracking-widest text-amber-300 flex items-center gap-2">
                            <Rocket size={12} /> Startup Packet
                          </p>
                          <span className="text-[10px] font-mono text-slate-500">{startupTime}</span>
                        </div>
                        <div className="px-4 py-3 grid grid-cols-2 gap-2 border-b border-white/[0.05] bg-white/[0.01]">
                          <div className="rounded-lg border border-white/[0.05] p-2">
                            <p className="text-[9px] uppercase tracking-widest text-slate-500 font-black">Startup</p>
                            <p className={`text-sm font-black ${startupSeen ? 'text-amber-200' : 'text-rose-400'}`}>
                              {startupSeen ? 'Seen' : 'Not yet'}
                            </p>
                          </div>
                          <div className="rounded-lg border border-white/[0.05] p-2">
                            <p className="text-[9px] uppercase tracking-widest text-slate-500 font-black">Firmware</p>
                            <p className="text-sm font-black text-amber-300">{startupPacket?.health?.firmware || '--'}</p>
                          </div>
                        </div>
                        <div className="max-h-72 overflow-auto">
                          {startupFields.length === 0 ? (
                            <p className="px-4 py-6 text-xs text-slate-500">No startup packet available.</p>
                          ) : (
                            startupFields.map((field) => (
                              <div key={`startup-${field.key}`} className="px-4 py-2 border-b border-white/[0.03] grid grid-cols-[1.2fr_1fr] gap-3 text-xs">
                                <span className="text-slate-400 break-all">{field.key}</span>
                                <span className="font-mono text-slate-200 text-right break-all">{formatPacketValue(field.value)}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Calibration & Heartbeat Footer */}
                  <div className="px-8 py-4 bg-black/20 flex justify-between items-center text-[10px]">
                    <div className="flex items-center gap-4 text-slate-500 font-bold uppercase tracking-wider">
                      <span>Temp Correction: {meta.calibration.temp_scalar.toFixed(2)}x</span>
                      <span className="w-1 h-1 rounded-full bg-slate-800" />
                      <span>Batt Offset: {meta.calibration.batt_v_offset}mV</span>
                    </div>
                    <div className="flex gap-3">
                      {data?.batt_v < 3600 && (
                        <div className="px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-500 border border-rose-500/20 font-black">LOW BATT</div>
                      )}
                      {!isOffline && (
                        <div className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-black">ACTIVE FLOW</div>
                      )}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </main>
      
      <footer className="mt-20 border-t border-white/[0.03] py-8 px-6 text-center relative z-10">
        <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
          © 2026 Project Sipat Banwa — Observer of the Sky<br />
          <span className="text-slate-600">Electronics Engineering Department - Pampanga State University</span>
        </p>
      </footer>
    </div>
  )
}
