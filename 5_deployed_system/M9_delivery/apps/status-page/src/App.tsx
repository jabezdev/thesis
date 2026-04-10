import { useState, useEffect, useMemo } from 'react'
import { Card, Badge, Stats } from '@panahon/ui'
import { Server, Activity, Wifi, Cpu, Sun, Zap, CloudOff } from 'lucide-react'
import { ref, onValue } from 'firebase/database'
import { rtdb } from './firebase'
import { applyCalibration, DEFAULT_CALIBRATION, type RawSensorData, type ProcessedData } from '@panahon/shared'

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
              const processed = data && meta?.calibration ? applyCalibration(data, meta.calibration) : null;
              
              if (!meta) return null;

              const ageSeconds = data ? (Date.now() - new Date(data.ts).getTime()) / 1000 : Infinity;
              const isOffline = ageSeconds > 600; // 10 mins
              const isCharging = data && data.solar_i > 50;

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
