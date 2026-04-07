import { useState, useEffect, useMemo } from 'react'
import { Card, Badge, Stats } from '@panahon/ui'
import { Server, Activity, Wifi, Cpu, Sun, Zap, CloudOff } from 'lucide-react'
import { ref, onValue } from 'firebase/database'
import { rtdb } from './firebase'
import type { RawSensorData } from '@panahon/shared'

/**
 * @panahonStatus — Fleet Monitoring Engine
 */

export default function App() {
  const [nodeIds, setNodeIds] = useState<string[]>([]);
  const [nodesMetadata, setNodesMetadata] = useState<Record<string, any>>({});
  const [latestData, setLatestData] = useState<Record<string, RawSensorData>>({});
  const [now, setNow] = useState(Date.now());

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
          setLatestData(prev => ({ ...prev, [id]: snapshot.val() }));
        }
      });
      unsubs.push(unsubLatest);
    });

    return () => unsubs.forEach(u => u());
  }, [nodeIds]);

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
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-emerald-500/30">
      {/* Header with Global Health Badge */}
      <header className="border-b border-slate-800 p-6 flex justify-between items-center bg-slate-950 sticky top-0 z-50 backdrop-blur-md bg-slate-950/80">
        <h1 className="text-xl font-bold flex items-center gap-3">
          <Server size={24} className={systemStatus === 'operational' ? 'text-emerald-500' : 'text-rose-500'} />
          Panahon Fleet Status
        </h1>
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-500 hidden md:inline">Last Global Check: {new Date(now).toLocaleTimeString()}</span>
          <Badge variant={
            systemStatus === 'operational' ? "success" : 
            systemStatus === 'degraded' ? "warning" : "error"
          }>
            {systemStatus.toUpperCase()}
          </Badge>
        </div>
      </header>

      <main className="p-8 max-w-6xl mx-auto">
        {nodeIds.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-500">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
            <p>Fetching Fleet Registry...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-8">
            {nodeIds.map(id => {
              const meta = nodesMetadata[id];
              const data = latestData[id];
              
              if (!meta) return null;

              const ageMinutes = data ? (Date.now() - new Date(data.ts).getTime()) / 60000 : Infinity;
              const isOffline = ageMinutes > 10;
              const isCharging = data && data.solar_i > 50;

              return (
                <Card key={id} className={`bg-slate-800 border-slate-700 transition-all duration-500 ${isOffline ? 'opacity-75 grayscale' : 'hover:border-slate-600 shadow-lg'}`}>
                  {/* Node Header */}
                  <div className="p-6 flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-700 bg-slate-800/50">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <div className={`h-2.5 w-2.5 rounded-full ${isOffline ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]'}`}></div>
                        <h2 className="text-lg font-bold flex items-center gap-2">
                           {meta.name}
                        </h2>
                      </div>
                      <p className="text-xs font-mono text-slate-500">UID: {id.toUpperCase()} • {meta.location.description}</p>
                    </div>
                    <div className="text-right mt-4 md:mt-0 flex flex-col items-end">
                      <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1">Connection State</p>
                      <div className="flex items-center gap-2">
                        {isOffline ? (
                          <span className="flex items-center gap-1.5 text-rose-400 font-bold text-sm">
                            <CloudOff size={14} /> DISCONNECTED
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-emerald-400 font-bold text-sm">
                            <Wifi size={14} /> {ageMinutes < 2 ? 'EXCELLENT' : 'STABLE'}
                          </span>
                        )}
                        <span className="text-xs text-slate-400 border-l border-slate-700 pl-2">
                          {data ? `${Math.floor(ageMinutes)}m ago` : 'Waiting...'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Node Metrics Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-slate-700 border-collapse">
                    <Stats 
                      label="System Uptime"
                      value={data ? (data.uptime_ms / 3600000).toFixed(1) : '--'}
                      unit="HRS"
                    />
                    <Stats 
                      label="Packet Health"
                      value={data ? data.samples : '--'}
                      unit="PKTS"
                      trend={data && data.samples >= 6 ? "+Healthy" : undefined}
                    />
                    <Stats 
                      label="Battery Status"
                      value={data ? (data.batt_v / 1000).toFixed(2) : '--'}
                      unit="V"
                    />
                    <div className="p-4 flex flex-col justify-center gap-1">
                      <p className="text-sm font-medium text-slate-400 flex items-center gap-1.5">
                        <Sun size={14} className={isCharging ? "text-amber-400 animate-spin-slow" : "text-slate-600"} /> Solar Power
                      </p>
                      <div className="flex items-baseline gap-1 mt-1">
                        <h3 className="text-2xl font-bold tracking-tight">
                          {data ? (data.solar_v / 1000).toFixed(2) : '--'}
                        </h3>
                        <span className="text-xs text-slate-400">V</span>
                      </div>
                      {isCharging && (
                        <p className="text-[10px] text-amber-500 font-bold flex items-center gap-1">
                          <Zap size={10} fill="currentColor" /> CHARGING ({data.solar_i}mA)
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Calibration & Logic Footer */}
                  <div className="px-6 py-3 bg-slate-900/30 border-t border-slate-700/50 flex justify-between items-center">
                    <span className="text-[10px] text-slate-500 uppercase tracking-tighter">
                      Calibration: {meta.calibration.temp_scalar.toFixed(2)}x / {meta.calibration.temp_offset} offset
                    </span>
                    <div className="flex gap-2">
                       {data?.batt_v < 3500 && <Badge variant="warning">Low Battery</Badge>}
                       {!isOffline && <Badge variant="info">Active</Badge>}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </main>
      
      <footer className="mt-20 border-t border-slate-800 p-8 text-center text-slate-600 text-sm">
        <p>© {new Date().getFullYear()} Panahon.live Ecosystem • Automated Status Monitoring</p>
      </footer>
    </div>
  )
}
