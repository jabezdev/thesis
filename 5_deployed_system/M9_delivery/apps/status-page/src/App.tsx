import { useState, useEffect } from 'react'
import { Card, Badge, Stats } from '@panahon/ui'
import { Server, Activity, AlertTriangle, Wifi, Cpu } from 'lucide-react'
import { collection, query, limit, getDocs, orderBy } from 'firebase/firestore'
import { db } from './firebase'
import type { RawSensorData } from '@panahon/shared'

export default function App() {
  const [latestHeartbeat, setHeartbeat] = useState<RawSensorData | null>(null);

  useEffect(() => {
    // Fetch the most recent heartbeat for system status
    const fetchStatus = async () => {
      try {
        const historyRef = collection(db, 'm6_node_data');
        const q = query(historyRef, orderBy('ts', 'desc'), limit(1));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          setHeartbeat(snapshot.docs[0].data() as RawSensorData);
        }
      } catch (err) {
        console.error("Status fetch error", err);
      }
    };
    fetchStatus();
    // Refresh every 60 seconds
    const interval = setInterval(fetchStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
      <header className="border-b border-slate-800 p-6 flex justify-between items-center bg-slate-950">
        <h1 className="text-xl font-bold flex items-center gap-3">
          <Server size={24} className="text-emerald-500" />
          Panahon Fleet Status
        </h1>
        <Badge variant={latestHeartbeat ? "success" : "warning"}>
          {latestHeartbeat ? "Operational" : "Degraded"}
        </Badge>
      </header>

      <main className="p-8 max-w-5xl mx-auto flex flex-col gap-8">
        <Card className="bg-slate-800 border-slate-700">
          <div className="p-6 flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-700">
             <div>
                <h2 className="text-lg font-bold flex items-center gap-2 mb-1">
                  <Activity size={18} className="text-blue-400" /> node_1 (Pilot Module)
                </h2>
                <p className="text-sm text-slate-400">Node ID: {latestHeartbeat?.node_id || '...'}</p>
             </div>
             <div className="text-right mt-4 md:mt-0">
               <p className="text-sm text-slate-400">Last Seen</p>
               <p className="font-bold">{latestHeartbeat ? new Date(latestHeartbeat.ts).toLocaleString() : 'Waiting...'}</p>
             </div>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6">
             <div className="flex flex-col gap-1">
               <span className="text-xs text-slate-500 uppercase font-bold flex items-center gap-1"><Cpu size={14}/> Node Uptime</span>
               <span className="text-xl">{latestHeartbeat ? (latestHeartbeat.uptime_ms / 3600000).toFixed(2) : '--'} <span className="text-sm text-slate-500">hrs</span></span>
             </div>
             <div className="flex flex-col gap-1">
               <span className="text-xs text-slate-500 uppercase font-bold flex items-center gap-1"><Wifi size={14}/> Connection Quality</span>
               <span className="text-xl">Stable <span className="text-sm text-slate-500">Ping N/A</span></span>
             </div>
             <div className="flex flex-col gap-1">
               <span className="text-xs uppercase font-bold text-amber-500 flex items-center gap-1"><AlertTriangle size={14}/> Dropped Packets</span>
               <span className="text-xl">0 <span className="text-sm text-slate-500">packets</span></span>
             </div>
             <div className="flex flex-col gap-1">
               <span className="text-xs text-slate-500 uppercase font-bold flex items-center gap-1"><Activity size={14}/> Battery Level</span>
               <span className="text-xl">{latestHeartbeat ? (latestHeartbeat.batt_v / 1000).toFixed(2) : '--'} <span className="text-sm text-slate-500">Volts</span></span>
             </div>
          </div>
        </Card>
      </main>
    </div>
  )
}
