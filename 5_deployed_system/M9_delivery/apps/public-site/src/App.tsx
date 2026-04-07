import { useState, useEffect } from 'react'
import { Card, Stats, Badge } from '@panahon/ui'
import { CloudRain, Thermometer, Wind, Droplets } from 'lucide-react'
import { ref, onValue } from 'firebase/database'
import { rtdb } from './firebase'
import type { RawSensorData } from '@panahon/shared'
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip, YAxis, CartesianGrid } from 'recharts'

function App() {
  const [latestData, setLatestData] = useState<RawSensorData | null>(null);
  const [lastHourData, setLastHourData] = useState<RawSensorData[]>([]);

  useEffect(() => {
    // Latest
    const latestRef = ref(rtdb, 'nodes/node_1/latest');
    const unsubLatest = onValue(latestRef, (snapshot) => {
      if (snapshot.exists()) {
        setLatestData(snapshot.val());
      }
    });

    // Last Hour (RTDB Buffer)
    const hourRef = ref(rtdb, 'nodes/node_1/last_hour');
    const unsubHour = onValue(hourRef, (snapshot) => {
      if (snapshot.exists()) {
        const dataObj = snapshot.val();
        // Convert map of keys -> objects to sorted array
        const sortedData = Object.keys(dataObj)
          .sort()
          .map(key => {
            const d = dataObj[key] as RawSensorData;
            const t = new Date(d.ts);
            return {
              ...d,
              timeLabel: `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}`
            };
          });
        setLastHourData(sortedData);
      }
    });

    return () => {
      unsubLatest();
      unsubHour();
    };
  }, []);

  return (
    <div className="min-h-screen bg-sky-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans">
      <header className="bg-blue-600 text-white p-6 pb-12 shadow-sm text-center">
        <h1 className="text-3xl font-extrabold tracking-tight mb-2">Panahon.live</h1>
        <p className="text-blue-100 max-w-lg mx-auto">Real-time local weather observations from Sipat Banwa telemetry nodes.</p>
      </header>

      <main className="max-w-4xl mx-auto -mt-8 p-4 flex flex-col gap-6 relative z-10">
        <Card className="p-6 bg-white dark:bg-slate-900 shadow-xl border-none">
          <div className="flex justify-between items-center mb-6">
             <h2 className="text-xl font-bold">Current Conditions</h2>
             <Badge variant="success">Live</Badge>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="flex flex-col items-center">
               <Thermometer size={48} className="text-orange-500 mb-2 opacity-80" />
               <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Temperature</p>
               <p className="text-3xl font-bold">{latestData?.temp !== undefined ? latestData.temp : '--'}°C</p>
            </div>
            <div className="flex flex-col items-center">
               <CloudRain size={48} className="text-blue-500 mb-2 opacity-80" />
               <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Rainfall</p>
               <p className="text-3xl font-bold">{latestData?.rain !== undefined ? latestData.rain : '--'}mm</p>
            </div>
            <div className="flex flex-col items-center">
               <Wind size={48} className="text-slate-400 mb-2 opacity-80" />
               <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Wind</p>
               <p className="text-3xl font-bold">--<span className="text-lg">km/h</span></p>
            </div>
            <div className="flex flex-col items-center">
               <Droplets size={48} className="text-sky-400 mb-2 opacity-80" />
               <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Humidity</p>
               <p className="text-3xl font-bold">{latestData?.hum !== undefined ? latestData.hum : '--'}%</p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
           <h3 className="font-bold mb-4 flex items-center gap-2">
             Last 60 Minutes (Rainfall)
           </h3>
           <div className="h-48 w-full">
            {lastHourData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={lastHourData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                  <XAxis dataKey="timeLabel" tick={{fontSize: 10}} minTickGap={10} />
                  <YAxis tick={{fontSize: 10}} width={30} />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Area type="monotone" dataKey="rain" stroke="#3b82f6" fill="#93c5fd" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
               <div className="h-full w-full bg-slate-50/50 dark:bg-slate-800/10 rounded-lg flex items-center justify-center">
                 <p className="text-xs text-slate-400 italic">Waiting for RTDB buffer...</p>
               </div>
            )}
           </div>
        </Card>
      </main>

      <footer className="text-center p-8 text-slate-500 text-sm">
         <p>Data provided “as-is” from RAW telemetry. Subject to post-processing adjustments by researchers.</p>
         <p className="mt-2">© 2026 Project Sipat Banwa</p>
      </footer>
    </div>
  )
}

export default App
