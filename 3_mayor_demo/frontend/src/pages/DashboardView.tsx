import { useEffect, useState } from 'react';
import { useTranslation } from '../i18n/TranslationContext';
import { Link } from 'react-router-dom';
import { ArrowLeft, LayoutDashboard, Map as MapIcon, BarChart3, AlertTriangle, Loader2, SignalHigh, CloudRain, Battery, Activity, Settings } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, AreaChart, Area } from 'recharts';

import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
const DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

interface WeatherData {
    temperature: number;
    humidity: number;
    rainfall: number;
    timestamp: string;
    time?: string;
}

export default function DashboardView() {
    const { } = useTranslation();
    const [history, setHistory] = useState<WeatherData[]>([]);
    const [latest, setLatest] = useState<WeatherData | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'overview' | 'map' | 'analytics'>('overview');
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [mode, setMode] = useState<'none' | 'test' | 'demo'>('none');

    // New Bacolor pin: 14°59'51.2"N 120°39'04.4"E -> 14.997555, 120.651222
    const activePosition: [number, number] = [14.997555, 120.651222];

    // Inactive / Planned stations
    const inactivePositions: [number, number][] = [
        [15.0001, 120.6400], // Example west
        [14.9850, 120.6600], // Example south 
        [15.0150, 120.6500]  // Example north
    ];

    // Load initial history, then listen to SSE
    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const histRes = await fetch('/api/weather/history');
                if (histRes.ok) {
                    const histData = await histRes.json();
                    const formatted = histData.map((d: any) => ({
                        ...d,
                        time: new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    }));
                    setHistory(formatted);
                    setLoading(false);
                }
            } catch (e) {
                console.error("Failed to fetch history data", e);
                setLoading(false);
            }
        };

        fetchHistory();

        const eventSource = new EventSource('/api/weather/stream');
        eventSource.onmessage = (event) => {
            try {
                const newData = JSON.parse(event.data);
                const timeObj = new Date(newData.timestamp || new Date());
                newData.time = timeObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

                setLatest(newData);
                setHistory(prev => {
                    // If we already have this exact timestamp as latest, don't duplicate
                    if (prev.length > 0 && prev[prev.length - 1].timestamp === newData.timestamp) {
                        return prev;
                    }
                    // Only keep last 100 on frontend just like backend limits
                    return [...prev.slice(-99), newData];
                });
                setLoading(false);
            } catch (err) {
                console.error("Error parsing SSE data", err);
            }
        };

        return () => eventSource.close();
    }, []);

    // Simulation effect for Test / Demo modes
    useEffect(() => {
        let interval: ReturnType<typeof setInterval> | null = null;
        if (mode === 'test' || mode === 'demo') {
            interval = setInterval(() => {
                const temp = 25 + Math.random() * 10;
                const humidity = 50 + Math.random() * 40;
                const rain = Math.random() > 0.8 ? Math.random() * 5 : 0;

                const newData: any = {
                    temperature: Number(temp.toFixed(1)),
                    humidity: Number(humidity.toFixed(1)),
                    rainfall: Number(rain.toFixed(1)),
                    timestamp: new Date().toISOString()
                };

                if (mode === 'test') {
                    const timeObj = new Date(newData.timestamp);
                    newData.time = timeObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

                    setLatest(newData);
                    setHistory(prev => [...prev.slice(-99), newData]);
                } else if (mode === 'demo') {
                    fetch('/api/weather', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(newData)
                    }).catch(err => console.error("Demo mode upload failed", err));
                }
            }, 3000);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [mode]);

    // avgTemp is currently unused

    const totalRain = history.length
        ? history.reduce((a: number, b: WeatherData) => a + b.rainfall, 0).toFixed(1)
        : '--';

    const alerts: string[] = [];
    if (latest) {
        if (latest.temperature >= 35) alerts.push(`CRITICAL TEMP: Reading ${latest.temperature}°C.`);
        if (latest.rainfall >= 5) alerts.push(`HEAVY RAIN: ${latest.rainfall}mm detected.`);
    }

    // --- SUB-COMPONENTS --- //

    const renderOverview = () => (
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-6 p-6 overflow-hidden">
            {/* Huge Dashboard Blocks for Big Screens */}
            <div className="md:col-span-8 flex flex-col gap-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
                    <div className="bg-slate-800/80 backdrop-blur-md rounded-3xl border border-slate-700/50 p-8 flex flex-col justify-center items-center shadow-2xl relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/10 rounded-full blur-3xl group-hover:bg-orange-500/20 transition-all"></div>
                        <p className="text-slate-400 font-semibold uppercase tracking-widest text-sm mb-4">Live Temperature</p>
                        <p className="text-7xl lg:text-8xl font-black text-white drop-shadow-lg">{latest?.temperature ?? '--'}<span className="text-3xl lg:text-4xl text-slate-500 ml-2">°C</span></p>
                    </div>
                    <div className="bg-slate-800/80 backdrop-blur-md rounded-3xl border border-slate-700/50 p-8 flex flex-col justify-center items-center shadow-2xl relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl group-hover:bg-blue-500/20 transition-all"></div>
                        <p className="text-slate-400 font-semibold uppercase tracking-widest text-sm mb-4">Live Humidity</p>
                        <p className="text-7xl lg:text-8xl font-black text-white drop-shadow-lg">{latest?.humidity ?? '--'}<span className="text-3xl lg:text-4xl text-slate-500 ml-2">%</span></p>
                    </div>
                    <div className="bg-slate-800/80 backdrop-blur-md rounded-3xl border border-slate-700/50 p-8 flex flex-col justify-center items-center shadow-2xl relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-sky-500/10 rounded-full blur-3xl group-hover:bg-sky-500/20 transition-all"></div>
                        <p className="text-slate-400 font-semibold uppercase tracking-widest text-sm mb-4">Rainfall (Latest)</p>
                        <p className="text-7xl lg:text-8xl font-black text-white drop-shadow-lg">{latest?.rainfall ?? '--'}<span className="text-3xl lg:text-4xl text-slate-500 ml-2">mm</span></p>
                    </div>
                </div>

                {/* Rapid Mini-Chart */}
                <div className="bg-slate-800/80 backdrop-blur-md rounded-3xl border border-slate-700/50 p-6 flex-1 shadow-2xl flex flex-col h-[300px]">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Real-time Activity Stream</h2>
                    <div className="flex-1 w-full h-full min-h-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={history.slice(-30)} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                                <YAxis hide domain={['auto', 'auto']} />
                                <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '12px' }} />
                                <Area type="monotone" dataKey="temperature" stroke="#f97316" strokeWidth={3} fillOpacity={1} fill="url(#colorTemp)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Right Sidebar */}
            <div className="md:col-span-4 flex flex-col gap-6">
                {/* Alerts Panel */}
                <div className="bg-slate-800/80 backdrop-blur-md rounded-3xl border border-slate-700/50 p-6 shadow-2xl flex-[0.4] flex flex-col">
                    <div className="flex items-center gap-3 mb-6">
                        <div className={`p-2 rounded-xl ${alerts.length > 0 ? 'bg-red-500/20 text-red-500' : 'bg-emerald-500/20 text-emerald-400'}`}>
                            <AlertTriangle size={20} />
                        </div>
                        <h2 className="text-sm font-bold text-slate-100 uppercase tracking-widest">System Alerts</h2>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                        {alerts.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-700/50 p-6">
                                <p className="font-semibold text-sm">Optimal Weather Conditions</p>
                                <p className="text-xs text-slate-600 mt-1">No active alerts required.</p>
                            </div>
                        ) : (
                            alerts.map((msg, i) => (
                                <div key={i} className="bg-linear-to-r from-red-500/20 to-orange-500/10 border-l-4 border-l-red-500 border border-slate-700 p-4 rounded-xl text-sm font-medium text-red-200">
                                    {msg}
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Mini Map */}
                <div className="bg-slate-800/80 backdrop-blur-md rounded-3xl border border-slate-700/50 p-6 shadow-2xl flex-[0.6] flex flex-col">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Node Network Status</h2>
                    <div className="flex-1 rounded-2xl overflow-hidden border border-slate-700/50 relative z-0">
                        <MapContainer center={activePosition} zoom={13} style={{ height: '100%', width: '100%' }} zoomControl={false} dragging={false} scrollWheelZoom={false}>
                            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                            <CircleMarker center={activePosition} radius={8} pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.5 }}><Popup>Active Node</Popup></CircleMarker>
                        </MapContainer>
                        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-900 to-transparent pointer-events-none z-1000"></div>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderMap = () => (
        <div className="flex-1 flex overflow-hidden">
            {/* Map Sidebar */}
            <div className="w-80 bg-slate-900/50 backdrop-blur-xl border-r border-slate-700/50 flex flex-col hidden lg:flex">
                <div className="p-6 border-b border-slate-700/50">
                    <h2 className="text-sm font-black text-white uppercase tracking-widest">Sensor Registry</h2>
                    <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mt-1">Live Fleet Management</p>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                    {/* Active Node Card */}
                    <div className="bg-slate-800/80 border border-blue-500/30 rounded-2xl p-4 shadow-lg relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-16 h-16 bg-blue-500/10 rounded-full blur-2xl group-hover:bg-blue-500/20 transition-all"></div>
                        <div className="flex justify-between items-start mb-3">
                            <div>
                                <h3 className="text-sm font-bold text-white">Node #1</h3>
                                <p className="text-[10px] text-slate-400 font-medium">San Guillermo, Bacolor</p>
                            </div>
                            <div className="bg-emerald-500/20 text-emerald-400 text-[9px] font-black px-2 py-0.5 rounded-full border border-emerald-500/30 uppercase tracking-tighter">
                                Online
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 mb-4">
                            <div className="bg-slate-900/50 rounded-xl p-2 border border-slate-700/50">
                                <p className="text-[9px] text-slate-500 font-bold uppercase">Signal</p>
                                <div className="flex items-center gap-1 text-blue-400">
                                    <SignalHigh size={12} />
                                    <span className="text-xs font-bold">98%</span>
                                </div>
                            </div>
                            <div className="bg-slate-900/50 rounded-xl p-2 border border-slate-700/50">
                                <p className="text-[9px] text-slate-500 font-bold uppercase">Power</p>
                                <div className="flex items-center gap-1 text-emerald-400">
                                    <Battery size={12} />
                                    <span className="text-xs font-bold">85%</span>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex justify-between items-center text-[11px]">
                                <span className="text-slate-400 font-medium">Temperature</span>
                                <span className="text-white font-bold">{latest?.temperature ?? '--'}°C</span>
                            </div>
                            <div className="flex justify-between items-center text-[11px]">
                                <span className="text-slate-400 font-medium">Humidity</span>
                                <span className="text-white font-bold">{latest?.humidity ?? '--'}%</span>
                            </div>
                            <div className="flex justify-between items-center text-[11px]">
                                <span className="text-slate-400 font-medium">Rainfall</span>
                                <span className="text-white font-bold">{latest?.rainfall ?? '--'}mm</span>
                            </div>
                        </div>

                        <button className="w-full mt-4 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-black uppercase tracking-widest py-2 rounded-lg transition-colors shadow-lg shadow-blue-600/20">
                            Node Diagnostics
                        </button>
                    </div>

                    {/* Planned Nodes */}
                    <div className="space-y-4 pt-2">
                        <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Planned Expansions</h3>
                        {inactivePositions.map((_, idx) => (
                            <div key={idx} className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-4 opacity-60">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h3 className="text-sm font-bold text-slate-300">Node #{idx + 2}</h3>
                                        <p className="text-[10px] text-slate-500">Proposed Site Area</p>
                                    </div>
                                    <div className="bg-slate-700/50 text-slate-400 text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter">
                                        Pending
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="p-4 border-t border-slate-700/50 bg-slate-900/50">
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 flex items-center gap-3">
                        <Activity size={18} className="text-blue-400" />
                        <div>
                            <p className="text-[10px] text-white font-black uppercase tracking-widest">Network Health</p>
                            <p className="text-[9px] text-blue-400/80 font-bold uppercase tracking-tighter">1/4 Sensors Operations</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Map Area */}
            <div className="flex-1 flex flex-col relative">
                <div className="absolute top-6 left-6 z-1000 flex flex-col gap-2">
                    <div className="bg-slate-900/80 backdrop-blur-md border border-slate-700/50 rounded-2xl p-4 shadow-2xl">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400">
                                <MapIcon size={18} />
                            </div>
                            <div>
                                <h2 className="text-sm font-black text-white uppercase tracking-widest leading-none">Bacolor Spatial Overlay</h2>
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter mt-1">Geospatial Sensor Distribution</p>
                            </div>
                        </div>
                        <div className="flex gap-4">
                            <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]"></div><span className="text-[10px] text-slate-300 font-bold uppercase tracking-tighter">Active Node</span></div>
                            <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-slate-600"></div><span className="text-[10px] text-slate-300 font-bold uppercase tracking-tighter">Planned expansion</span></div>
                        </div>
                    </div>
                </div>

                <div className="flex-1 z-0">
                    <MapContainer center={activePosition} zoom={14} style={{ height: '100%', width: '100%' }}>
                        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                        <Marker position={activePosition}>
                            <Popup className="custom-popup">
                                <div className="p-1">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                                        <strong className="text-slate-800 font-black uppercase tracking-widest text-xs">Node #1 - San Guillermo</strong>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-2 mt-1">
                                        <div className="text-center">
                                            <p className="text-[8px] text-slate-500 font-bold uppercase">Temp</p>
                                            <p className="text-xs font-black text-slate-800">{latest?.temperature ?? '--'}°C</p>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-[8px] text-slate-500 font-bold uppercase">Hum</p>
                                            <p className="text-xs font-black text-slate-800">{latest?.humidity ?? '--'}%</p>
                                        </div>
                                        <div className="text-center border-r-0">
                                            <p className="text-[8px] text-slate-500 font-bold uppercase">Rain</p>
                                            <p className="text-xs font-black text-slate-800">{latest?.rainfall ?? '--'}mm</p>
                                        </div>
                                    </div>
                                    <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
                                        <span className="text-[9px] text-slate-400 font-bold italic">Last sync: {latest?.time ?? 'Live'}</span>
                                        <SignalHigh size={12} className="text-blue-500" />
                                    </div>
                                </div>
                            </Popup>
                        </Marker>

                        {inactivePositions.map((pos, idx) => (
                            <CircleMarker key={idx} center={pos} radius={6} pathOptions={{ color: '#475569', fillColor: '#475569', fillOpacity: 0.8 }}>
                                <Popup>
                                    <strong className="text-slate-800 font-bold">Planned Node #{idx + 2}</strong><br />
                                    <span className="text-slate-500 text-xs">Status: Pending Installation</span>
                                </Popup>
                            </CircleMarker>
                        ))}
                    </MapContainer>
                </div>
            </div>
        </div>
    );

    const renderAnalytics = () => (
        <div className="flex-1 flex flex-col p-6 overflow-y-auto custom-scrollbar">
            <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-800/80 rounded-3xl border border-slate-700/50 p-6 flex justify-between items-center shadow-lg">
                    <div>
                        <p className="text-slate-400 text-sm font-bold uppercase tracking-widest mb-1">Avg Data Rate</p>
                        <p className="text-2xl font-black text-white">Latest Only</p>
                    </div>
                    <BarChart3 size={32} className="text-emerald-500/50" />
                </div>
                <div className="bg-slate-800/80 rounded-3xl border border-slate-700/50 p-6 flex justify-between items-center shadow-lg">
                    <div>
                        <p className="text-slate-400 text-sm font-bold uppercase tracking-widest mb-1">Db Records Sync</p>
                        <p className="text-2xl font-black text-white">{history.length}</p>
                    </div>
                    <SignalHigh size={32} className="text-blue-500/50" />
                </div>
                <div className="bg-slate-800/80 rounded-3xl border border-slate-700/50 p-6 flex justify-between items-center shadow-lg">
                    <div>
                        <p className="text-slate-400 text-sm font-bold uppercase tracking-widest mb-1">Total Accumulated Rain</p>
                        <p className="text-2xl font-black text-white">{totalRain}mm</p>
                    </div>
                    <CloudRain size={32} className="text-sky-500/50" />
                </div>
            </div>

            <div className="bg-slate-800/80 backdrop-blur-md rounded-3xl border border-slate-700/50 shadow-2xl flex-1 flex flex-col min-h-[500px]">
                <div className="p-6 border-b border-slate-700/50">
                    <h2 className="text-lg font-bold text-white uppercase tracking-widest">Historical Trend Analytics</h2>
                    <p className="text-sm text-slate-400">Comprehensive view of all ingested datapoints from active sensors.</p>
                </div>
                <div className="flex-1 p-6 w-full h-[400px] min-h-0">
                    {history.length === 0 ? (
                        <div className="w-full h-full flex flex-col items-center justify-center text-slate-500">
                            <Loader2 className="animate-spin mb-4" size={32} />
                            <p className="font-medium tracking-wide">Awaiting data stream payload...</p>
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={history} margin={{ top: 20, right: 30, bottom: 20, left: 10 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                                <XAxis dataKey="time" stroke="#64748b" fontSize={12} tickMargin={15} />
                                <YAxis yAxisId="left" stroke="#64748b" fontSize={12} domain={['auto', 'auto']} />
                                <YAxis yAxisId="right" orientation="right" stroke="#64748b" fontSize={12} domain={[0, 'auto']} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', color: '#f8fafc', padding: '16px', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.5)' }}
                                    itemStyle={{ color: '#f1f5f9', fontWeight: 'bold' }}
                                />
                                <Legend wrapperStyle={{ paddingTop: '20px' }} iconType="circle" />
                                <Line yAxisId="left" type="monotone" dataKey="temperature" name="Temperature (°C)" stroke="#f97316" strokeWidth={3} dot={{ r: 3, strokeWidth: 0 }} activeDot={{ r: 8 }} />
                                <Line yAxisId="left" type="monotone" dataKey="humidity" name="Humidity (%)" stroke="#3b82f6" strokeWidth={3} dot={{ r: 3, strokeWidth: 0 }} />
                                <Line yAxisId="right" type="stepAfter" dataKey="rainfall" name="Rainfall (mm)" stroke="#0ea5e9" strokeWidth={3} dot={{ r: 3, strokeWidth: 0 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <div className="h-screen bg-slate-900 text-slate-100 flex flex-col font-sans overflow-hidden">
            {/* Premium Header */}
            <header className="bg-slate-900/80 backdrop-blur-xl border-b border-white/10 px-6 py-4 flex items-center justify-between shadow-2xl z-20">
                <div className="flex items-center gap-6">
                    <Link to="/" className="p-2.5 text-slate-400 hover:text-white transition bg-white/5 hover:bg-white/10 rounded-xl">
                        <ArrowLeft size={20} />
                    </Link>
                    <div className="flex items-center gap-4">
                        <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-2.5 rounded-xl shadow-lg shadow-blue-500/20">
                            <LayoutDashboard size={22} className="text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-black text-white tracking-widest uppercase">Panahon.live</h1>
                            <p className="text-xs text-blue-400 font-bold tracking-widest uppercase">Municipal Command Center</p>
                        </div>
                    </div>
                </div>

                {/* Navigation Tabs */}
                <div className="hidden lg:flex bg-slate-800/50 p-1 rounded-xl border border-slate-700/50">
                    <button
                        onClick={() => setActiveTab('overview')}
                        className={`px-5 py-2 text-sm font-bold uppercase tracking-widest rounded-lg transition-all ${activeTab === 'overview' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}
                    >
                        Big Screen
                    </button>
                    <button
                        onClick={() => setActiveTab('map')}
                        className={`px-5 py-2 text-sm font-bold uppercase tracking-widest rounded-lg transition-all ${activeTab === 'map' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}
                    >
                        Network Map
                    </button>
                    <button
                        onClick={() => setActiveTab('analytics')}
                        className={`px-5 py-2 text-sm font-bold uppercase tracking-widest rounded-lg transition-all ${activeTab === 'analytics' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}
                    >
                        Analytics
                    </button>
                </div>

                <div className="flex items-center gap-4">
                    {loading && <Loader2 size={16} className="animate-spin text-slate-400" />}
                    <div className="flex items-center gap-2 bg-emerald-500/10 text-emerald-400 px-4 py-2 rounded-full border border-emerald-500/20 shadow-lg shadow-emerald-500/5">
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.8)]"></div>
                        <span className="text-xs font-black tracking-widest uppercase flex items-center gap-1">
                            Live Stream
                            {mode !== 'none' && (
                                <span className={`ml-2 px-1.5 py-0.5 rounded text-[9px] ${mode === 'test' ? 'bg-emerald-500/20 border border-emerald-500/50' : 'bg-orange-500/20 border border-orange-500/50 text-orange-400'}`}>
                                    {mode.toUpperCase()}
                                </span>
                            )}
                        </span>
                    </div>

                    {/* Settings Popover */}
                    <div className="relative">
                        <button
                            onClick={() => setSettingsOpen(!settingsOpen)}
                            className={`p-2 rounded-xl transition-all ${settingsOpen ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-700'}`}
                        >
                            <Settings size={20} />
                        </button>

                        {settingsOpen && (
                            <div className="absolute top-full right-0 mt-4 w-64 bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 rounded-2xl shadow-2xl p-4 z-50 overflow-hidden">
                                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Simulation Mode</h3>

                                <div className="space-y-2">
                                    <button
                                        onClick={() => { setMode('none'); setSettingsOpen(false); }}
                                        className={`w-full flex items-center justify-between p-3 rounded-xl transition-all ${mode === 'none' ? 'bg-blue-500/20 border border-blue-500/50 text-blue-400' : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-white border border-transparent'}`}
                                    >
                                        <span className="text-sm font-bold">Real Data</span>
                                        {mode === 'none' && <div className="w-2 h-2 rounded-full bg-blue-500"></div>}
                                    </button>
                                    <button
                                        onClick={() => { setMode('test'); setSettingsOpen(false); }}
                                        className={`w-full flex items-center justify-between p-3 rounded-xl transition-all ${mode === 'test' ? 'bg-emerald-500/20 border border-emerald-500/50 text-emerald-400' : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-white border border-transparent'}`}
                                    >
                                        <div className="text-left">
                                            <span className="text-sm font-bold block">Test Mode</span>
                                            <span className="text-[10px] opacity-70 font-medium">Local UI injection</span>
                                        </div>
                                        {mode === 'test' && <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>}
                                    </button>
                                    <button
                                        onClick={() => { setMode('demo'); setSettingsOpen(false); }}
                                        className={`w-full flex items-center justify-between p-3 rounded-xl transition-all ${mode === 'demo' ? 'bg-orange-500/20 border border-orange-500/50 text-orange-400' : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-white border border-transparent'}`}
                                    >
                                        <div className="text-left">
                                            <span className="text-sm font-bold block">Demo Mode</span>
                                            <span className="text-[10px] opacity-70 font-medium">Backend broadcast</span>
                                        </div>
                                        {mode === 'demo' && <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></div>}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {/* Main Content Render */}
            <main className="flex-1 overflow-hidden relative bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-800 via-slate-900 to-black">
                {activeTab === 'overview' && renderOverview()}
                {activeTab === 'map' && renderMap()}
                {activeTab === 'analytics' && renderAnalytics()}
            </main>

            {/* Mobile Tab Fallback */}
            <div className="lg:hidden bg-slate-900 border-t border-slate-800 p-4 grid grid-cols-3 gap-2">
                <button onClick={() => setActiveTab('overview')} className={`p-3 rounded-xl flex justify-center ${activeTab === 'overview' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}><LayoutDashboard size={20} /></button>
                <button onClick={() => setActiveTab('map')} className={`p-3 rounded-xl flex justify-center ${activeTab === 'map' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}><MapIcon size={20} /></button>
                <button onClick={() => setActiveTab('analytics')} className={`p-3 rounded-xl flex justify-center ${activeTab === 'analytics' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}><BarChart3 size={20} /></button>
            </div>
        </div>
    );
}
