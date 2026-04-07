import { useState, useEffect } from 'react'
import { Card, Stats, Badge, Button } from '@panahon/ui'
import { CloudRain, Thermometer, Droplets, Moon, Sun, MapPin, Activity, Info } from 'lucide-react'
import { ref, onValue } from 'firebase/database'
import { rtdb } from './firebase'
import type { RawSensorData } from '@panahon/shared'
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip, YAxis, CartesianGrid } from 'recharts'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'

type MetricType = 'temp' | 'hum' | 'rain';

function App() {
  const [latestData, setLatestData] = useState<RawSensorData | null>(null);
  const [lastHourData, setLastHourData] = useState<(RawSensorData & { timeLabel: string })[]>([]);
  const [activeMetric, setActiveMetric] = useState<MetricType>('rain');
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark' || 
        (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });

  // Convex: Fetch node metadata
  const nodeMetadata = useQuery(api.nodes.getNodeByNodeId, { node_id: 'node_1' });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

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

  const metricConfig = {
    temp: {
      label: 'Temperature',
      unit: '°C',
      icon: <Thermometer className="text-orange-500" />,
      color: '#f97316',
      fill: 'url(#colorTemp)'
    },
    hum: {
      label: 'Humidity',
      unit: '%',
      icon: <Droplets className="text-sky-500" />,
      color: '#0ea5e9',
      fill: 'url(#colorHum)'
    },
    rain: {
      label: 'Rainfall',
      unit: 'mm',
      icon: <CloudRain className="text-blue-500" />,
      color: '#3b82f6',
      fill: 'url(#colorRain)'
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors duration-300">
      {/* Premium Navigation */}
      <nav className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md sticky top-0 z-50 px-4 md:px-8 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center text-white font-black text-xl shadow-lg shadow-blue-500/20">P</div>
          <div>
            <h1 className="text-lg font-bold tracking-tight leading-none">Panahon<span className="text-blue-600">.live</span></h1>
            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-0.5">Sipat Banwa Network</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Badge variant={latestData ? 'success' : 'warning'}>
            {latestData ? 'Live Data' : 'Offline'}
          </Badge>
          <button 
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-500 dark:text-slate-400"
            aria-label="Toggle Dark Mode"
          >
            {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <header className="py-12 px-6 text-center max-w-4xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-full text-xs font-bold mb-4 border border-blue-100 dark:border-blue-800/50">
          <Activity size={14} className="animate-pulse" />
          Primary Pilot Station
        </div>
        <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-4 text-slate-900 dark:text-white">
          {nodeMetadata?.name || 'Monitoring Node 01'}
        </h2>
        <p className="text-slate-500 dark:text-slate-400 max-w-xl mx-auto flex items-center justify-center gap-1.5 flex-wrap">
          <MapPin size={16} className="text-rose-500" />
          {nodeMetadata?.location?.description || 'Loading location...'}
        </p>
      </header>

      <main className="max-w-5xl mx-auto p-4 md:p-8 flex flex-col gap-8">
        {/* Current Conditions Grid */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="relative overflow-hidden group hover:ring-2 transition-all ring-orange-500/20">
            <Stats 
              label="Temperature" 
              value={latestData?.temp !== undefined ? latestData.temp : '--'} 
              unit="°C" 
              trend={"+0.2"} // Mock trend for now
            />
            <div className="absolute right-4 top-4 opacity-10 group-hover:opacity-20 transform scale-150 transition-all group-hover:rotate-12">
               <Thermometer size={48} className="text-orange-500" />
            </div>
          </Card>
          <Card className="relative overflow-hidden group hover:ring-2 transition-all ring-blue-500/20">
            <Stats 
              label="Rainfall" 
              value={latestData?.rain !== undefined ? latestData.rain : '--'} 
              unit="mm" 
              trend={"-1.1"}
            />
            <div className="absolute right-4 top-4 opacity-10 group-hover:opacity-20 transform scale-150 transition-all group-hover:-rotate-12">
               <CloudRain size={48} className="text-blue-500" />
            </div>
          </Card>
          <Card className="relative overflow-hidden group hover:ring-2 transition-all ring-sky-500/20">
            <Stats 
              label="Humidity" 
              value={latestData?.hum !== undefined ? latestData.hum : '--'} 
              unit="%" 
            />
             <div className="absolute right-4 top-4 opacity-10 group-hover:opacity-20 transform scale-150 transition-all group-hover:rotate-12">
               <Droplets size={48} className="text-sky-500" />
            </div>
          </Card>
        </section>

        {/* Dynamic Chart Section */}
        <Card className="p-6 md:p-8 bg-white dark:bg-slate-900 shadow-xl border-none">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
            <div>
              <h3 className="text-xl font-bold flex items-center gap-2">
                {metricConfig[activeMetric].icon}
                Historical Trend (1h)
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Real-time RTDB buffer observations.</p>
            </div>
            
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl w-full md:w-auto">
              {(Object.keys(metricConfig) as MetricType[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setActiveMetric(m)}
                  className={`flex-1 md:px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                    activeMetric === m 
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >
                  {metricConfig[m].label}
                </button>
              ))}
            </div>
          </div>

          <div className="h-72 w-full">
            {lastHourData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={lastHourData}>
                  <defs>
                    <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorHum" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorRain" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={isDarkMode ? 0.05 : 0.2} />
                  <XAxis 
                    dataKey="timeLabel" 
                    axisLine={false}
                    tickLine={false}
                    tick={{fontSize: 10, fill: isDarkMode ? '#94a3b8' : '#64748b'}} 
                    minTickGap={10} 
                  />
                  <YAxis 
                    axisLine={false}
                    tickLine={false}
                    tick={{fontSize: 10, fill: isDarkMode ? '#94a3b8' : '#64748b'}} 
                    width={30} 
                  />
                  <Tooltip 
                    contentStyle={{ 
                      borderRadius: '12px', 
                      border: 'none', 
                      backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
                      boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                      color: isDarkMode ? '#f1f5f9' : '#0f172a'
                    }} 
                    itemStyle={{ fontWeight: 'bold' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey={activeMetric} 
                    stroke={metricConfig[activeMetric].color} 
                    fill={metricConfig[activeMetric].fill} 
                    strokeWidth={3} 
                    animationDuration={1000}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
               <div className="h-full w-full bg-slate-50/50 dark:bg-slate-800/10 rounded-xl flex flex-col items-center justify-center border-2 border-dashed border-slate-200 dark:border-slate-800">
                 <Activity size={32} className="text-slate-300 dark:text-slate-700 animate-pulse mb-3" />
                 <p className="text-sm text-slate-400 italic">Synchronizing with telemetry stream...</p>
               </div>
            )}
          </div>
        </Card>

        {/* Info Banner */}
        <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/50 rounded-2xl p-4 flex items-start gap-4">
           <Info className="text-amber-500 mt-0.5 shrink-0" size={20} />
           <p className="text-sm text-amber-800 dark:text-amber-300/80">
             <strong>Research Context:</strong> These values are RAW telemetry data provided “as-is” for the Panahon.live research project. Data is subject to calibration adjustments in post-processing.
           </p>
        </div>
      </main>

      <footer className="text-center p-12 text-slate-400 dark:text-slate-600 text-sm border-t border-slate-200 dark:border-slate-900 mt-12 bg-white dark:bg-slate-900/30">
          <p>© 2026 Project Sipat Banwa — Disaster Resilience Research Platform</p>
          <div className="flex justify-center gap-6 mt-4 font-bold text-[10px] uppercase tracking-widest">
             <a href="#" className="hover:text-blue-600 transition-colors">Documentation</a>
             <a href="#" className="hover:text-blue-600 transition-colors">API Access</a>
             <a href="#" className="hover:text-blue-600 transition-colors">LGU Portal</a>
          </div>
      </footer>
    </div>
  )
}

export default App
