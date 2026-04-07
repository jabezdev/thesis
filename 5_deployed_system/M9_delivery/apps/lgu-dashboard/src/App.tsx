import { useState, useEffect } from 'react'
import { Card, Stats, Badge, Button } from '@panahon/ui'
import { Map as MapIcon, CloudRain, Thermometer, Wind, AlertTriangle, History } from 'lucide-react'
import { ref, onValue } from 'firebase/database'
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore'
import { rtdb, db } from './firebase'
import type { RawSensorData } from '@panahon/shared'
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip, YAxis, LineChart, Line, CartesianGrid } from 'recharts'

function App() {
  const [latestData, setLatestData] = useState<RawSensorData | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<string>('Connecting...');
  const [historicalData, setHistoricalData] = useState<RawSensorData[]>([]);

  useEffect(() => {
    // Listen to latest reading for node_1
    const latestRef = ref(rtdb, 'nodes/node_1/latest');
    const unsubscribe = onValue(latestRef, (snapshot) => {
      if (snapshot.exists()) {
        setLatestData(snapshot.val());
        setConnectionStatus('Online');
      } else {
        setConnectionStatus('No Data');
      }
    }, (error) => {
      console.error(error);
      setConnectionStatus('Error');
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // Fetch last 24 hours of historical data from Firestore
    const fetchHistory = async () => {
      try {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const historyRef = collection(db, 'm6_node_data');
        // Fetch up to 1440 samples (1 per minute for 24 hours)
        const q = query(
          historyRef, 
          where('node_id', '==', 'node_1'),
          where('ts', '>=', yesterday),
          orderBy('ts', 'asc'),
          limit(1440)
        );
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map(doc => {
          const d = doc.data() as RawSensorData;
          // Format date for chart X-axis
          const t = new Date(d.ts);
          return {
            ...d,
            timeLabel: `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}`
          };
        });
        setHistoricalData(data);
      } catch(err) {
        console.error("Firestore history error:", err);
      }
    };
    fetchHistory();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans">
      {/* Top Navigation */}
      <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md sticky top-0 z-50 px-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-blue-500/20">P</div>
          <h1 className="text-xl font-bold tracking-tight">Panahon <span className="text-blue-600">LGU</span></h1>
          <Badge variant="info">DRRM Command Center</Badge>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right mr-4 hidden md:block">
            <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Current Status</p>
            {connectionStatus === 'Online' ? (
              <p className="text-sm font-semibold text-emerald-500 flex items-center gap-2 justify-end">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                Node Connected
              </p>
            ) : (
               <p className="text-sm font-semibold text-rose-500 flex items-center gap-2 justify-end">
                <span className="w-2 h-2 bg-rose-500 rounded-full"></span>
                {connectionStatus}
              </p>
            )}
          </div>
          <Button variant="outline" className="gap-2"><History size={18}/> History</Button>
          <Button className="gap-2 bg-slate-900 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 hover:bg-slate-800"><MapIcon size={18}/> Live Map</Button>
        </div>
      </header>

      <main className="p-8 max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Stats & Alerts */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <section>
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <AlertTriangle className="text-amber-500" size={20} />
              Active Alerts
            </h3>
            <Card className="border-l-4 border-l-amber-500 bg-amber-50/30 dark:bg-amber-900/10 p-4">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-bold text-amber-700 dark:text-amber-400 text-sm">Heavy Rainfall Warning</h4>
                  <p className="text-xs text-amber-600 dark:text-amber-500/70 mt-1">Station 01-B is reporting {`>12mm/hr`}. Expect localized flooding.</p>
                </div>
                <Badge variant="warning">Alert</Badge>
              </div>
            </Card>
          </section>

          <section className="grid grid-cols-2 gap-4">
            <Card className="flex flex-col items-center justify-center py-6">
              <CloudRain className="text-blue-500 mb-2" size={32} />
              <Stats label="Rainfall" value={latestData?.rain !== undefined ? latestData.rain : '--'} unit="mm" />
            </Card>
            <Card className="flex flex-col items-center justify-center py-6">
              <Thermometer className="text-orange-500 mb-2" size={32} />
              <Stats label="Temperature" value={latestData?.temp !== undefined ? latestData.temp : '--'} unit="°C" />
            </Card>
            <Card className="flex flex-col items-center justify-center py-6">
              <Wind className="text-slate-400 mb-2" size={32} />
              <Stats label="Humidity" value={latestData?.hum !== undefined ? latestData.hum : '--'} unit="%" />
            </Card>
            <Card className="flex flex-col items-center justify-center py-6">
              <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded-full flex items-center justify-center mb-2">
                <Radio size={18} />
              </div>
              <Stats label="Uptime" value={latestData?.uptime_ms ? (latestData.uptime_ms / 3600000).toFixed(1) : '--'} unit="h" />
            </Card>
          </section>

          <section>
            <h3 className="text-lg font-bold mb-4">Quick Actions</h3>
            <div className="grid grid-cols-1 gap-2">
              <Button variant="secondary" className="justify-between">Export Daily Report <History size={16}/></Button>
              <Button variant="secondary" className="justify-between">Broadcast Warning <Radio size={16}/></Button>
            </div>
          </section>
        </div>

        {/* Right Column: Visualization & Map */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          <Card className="h-[500px] relative overflow-hidden bg-slate-200 dark:bg-slate-800 flex items-center justify-center border-slate-300 dark:border-slate-700">
            <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#4b5563_1px,transparent_1px)] [background-size:20px_20px] dark:bg-[radial-gradient(#94a3b8_1px,transparent_1px)]"></div>
            <div className="text-center z-10">
              <MapIcon size={64} className="text-slate-400 dark:text-slate-600 mx-auto mb-4" />
              <h4 className="text-xl font-bold text-slate-500 dark:text-slate-400">Map Service Not Initialized</h4>
              <p className="text-sm text-slate-400 dark:text-slate-500 max-w-xs mx-auto mt-2 italic">Connect Google Maps or Leaflet in admin console to enable real-time spatial oversight.</p>
            </div>
            
            {/* Mock Node on Map */}
            <div className="absolute top-1/4 left-1/3 group cursor-pointer">
              <div className="w-4 h-4 bg-blue-600 rounded-full border-2 border-white shadow-lg animate-ping absolute"></div>
              <div className="w-4 h-4 bg-blue-600 rounded-full border-2 border-white shadow-lg relative z-10"></div>
              <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-2 py-1 rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                <p className="text-[10px] font-bold">Node 1: Active</p>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="p-6">
              <h4 className="font-bold mb-4 flex items-center gap-2">
                <CloudRain size={18} className="text-blue-500" />
                Rainfall Trends (24h)
              </h4>
              <div className="h-48 w-full">
                {historicalData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={historicalData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                      <XAxis dataKey="timeLabel" tick={{fontSize: 10}} minTickGap={30} />
                      <YAxis tick={{fontSize: 10}} width={30} />
                      <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                      <Area type="monotone" dataKey="rain" stroke="#3b82f6" fill="#93c5fd" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full w-full bg-slate-50/50 dark:bg-slate-800/10 rounded-lg flex items-center justify-center">
                    <p className="text-xs text-slate-400 italic">No historical data available</p>
                  </div>
                )}
              </div>
            </Card>
            <Card className="p-6">
              <h4 className="font-bold mb-4 flex items-center gap-2">
                < Thermometer size={18} className="text-orange-500" />
                Temp Heatmap (24h)
              </h4>
               <div className="h-48 w-full">
                {historicalData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={historicalData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                      <XAxis dataKey="timeLabel" tick={{fontSize: 10}} minTickGap={30} />
                      <YAxis tick={{fontSize: 10}} width={30} domain={['dataMin - 2', 'dataMax + 2']} />
                      <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                      <Line type="monotone" dot={false} dataKey="temp" stroke="#f97316" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full w-full bg-slate-50/50 dark:bg-slate-800/10 rounded-lg flex items-center justify-center">
                    <p className="text-xs text-slate-400 italic">No historical data available</p>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}

function Radio({ size = 20, className = '' }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
      <path d="M7.8 16.2C5.4 13.8 5.4 10.2 7.8 7.8" />
      <circle cx="12" cy="12" r="2" />
      <path d="M16.2 7.8C18.6 10.2 18.6 13.8 16.2 16.2" />
      <path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1" />
    </svg>
  );
}

export default App
