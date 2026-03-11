import { useEffect, useState } from 'react';
import { useTranslation } from '../i18n/TranslationContext';
import { Link } from 'react-router-dom';
import { CloudRain, Droplets, ThermometerSun, Loader2, Settings, ChevronRight, Info, Flame } from 'lucide-react';

interface WeatherData {
    temperature: number;
    humidity: number;
    heat_index: number;
    rainfall: number;
    timestamp: string;
}

function parseTimestamp(timestamp?: string) {
    if (!timestamp) {
        return null;
    }

    const parsed = new Date(timestamp.replace(' ', 'T'));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatTimestamp(timestamp?: string) {
    const parsed = parseTimestamp(timestamp);
    if (!parsed) {
        return timestamp ?? '--';
    }

    return parsed.toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

export default function PublicView() {
    const { t, language, setLanguage } = useTranslation();
    const [data, setData] = useState<WeatherData | null>(null);
    const [loading, setLoading] = useState(true);
    const [showSettings, setShowSettings] = useState(false);

    useEffect(() => {
        const fetchLatest = async () => {
            try {
                const res = await fetch('/api/weather/latest');
                if (res.ok) {
                    const latestData = await res.json();
                    if (latestData) {
                        setData(latestData);
                        setLoading(false);
                    }
                }
            } catch (e) {
                console.error("Failed to fetch latest data", e);
            }
        };

        fetchLatest();

        const eventSource = new EventSource('/api/weather/stream');

        eventSource.onmessage = (event) => {
            try {
                const newData = JSON.parse(event.data);
                setData(newData);
                setLoading(false);
            } catch (err) {
                console.error("Error parsing SSE data", err);
            }
        };

        eventSource.onerror = (err) => {
            console.error("SSE Error", err);
            // Wait a bit, it auto-reconnects in most browsers, but we can manage UI state
        };

        return () => {
            eventSource.close();
        };
    }, []);

    const getTip = () => {
        if (!data) return "Waiting for live weather data...";
        if (data.temperature > 35) return "Extreme heat detected. Stay hydrated and avoid direct sunlight.";
        if (data.temperature > 32) return "It's quite hot. Wear light clothing and drink water.";
        if (data.rainfall > 5) return "Heavy rain detected. Bring an umbrella and expect potential flooding in low areas.";
        if (data.rainfall > 0) return "Light rain detected. A raincoat or umbrella might be handy.";
        if (data.humidity > 80) return "High humidity makes it feel hotter than it is. Stay cool.";
        return "Weather looks fair. Enjoy your day!";
    };

    const sensorTimestamp = formatTimestamp(data?.timestamp);

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex flex-col items-center pt-8 pb-12 px-5 selection:bg-blue-300 font-sans text-slate-100 overflow-hidden relative">

            {/* Background Orbs */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none opacity-40">
                <div className="absolute -top-[10%] -left-[10%] w-[50%] h-[40%] bg-blue-500 rounded-full blur-[120px]"></div>
                <div className="absolute top-[40%] -right-[10%] w-[40%] h-[50%] bg-indigo-500 rounded-full blur-[100px]"></div>
            </div>

            <div className="w-full max-w-md relative z-10 flex flex-col h-full flex-1">

                {/* Header */}
                <div className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-2xl font-black text-white tracking-tight drop-shadow-md">
                            {t('app_title')}
                        </h1>
                        <p className="text-blue-200/80 text-sm font-medium tracking-wide">Bacolor, Pampanga</p>
                    </div>

                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        className="p-2.5 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full border border-white/10 transition shadow-lg shrink-0"
                    >
                        <Settings size={20} className="text-blue-100" />
                    </button>
                </div>

                {/* Settings Dropdown */}
                {showSettings && (
                    <div className="mb-6 bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-4 shadow-2xl animate-in slide-in-from-top-2">
                        <p className="text-xs text-blue-200 uppercase tracking-wider font-semibold mb-3">Language</p>
                        <div className="flex gap-2">
                            {(['pam', 'tl', 'en'] as const).map((lang) => (
                                <button
                                    key={lang}
                                    onClick={() => setLanguage(lang)}
                                    className={`flex-1 py-2 text-sm font-semibold rounded-xl transition-all duration-200 ${language === lang
                                        ? 'bg-blue-500 text-white shadow-md'
                                        : 'bg-black/20 text-blue-100 hover:bg-black/30'
                                        }`}
                                >
                                    {lang === 'pam' ? 'PAM' : lang === 'tl' ? 'TL' : 'EN'}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Dynamic Tip Card */}
                <div className="mb-8 bg-black/20 backdrop-blur-md border border-white/10 rounded-2xl p-4 shadow-lg flex items-start gap-4">
                    <div className="bg-blue-500/20 p-2.5 rounded-full mt-0.5 shrink-0">
                        <Info size={20} className="text-blue-300" />
                    </div>
                    <p className="text-sm text-blue-100 leading-relaxed font-medium">
                        {getTip()}
                    </p>
                </div>

                <div className="mb-8 bg-white/10 backdrop-blur-md border border-white/10 rounded-2xl p-4 shadow-lg">
                    <p className="text-[11px] text-blue-200/70 font-semibold uppercase tracking-[0.25em] mb-2">Sensor Timestamp</p>
                    <p className="text-lg font-bold text-white tracking-wide">{sensorTimestamp}</p>
                </div>

                {/* Weather Cards */}
                <div className="space-y-4 mb-10 flex-1">
                    {loading && !data ? (
                        <div className="flex flex-col items-center justify-center py-20 text-blue-200/60">
                            <Loader2 className="animate-spin mb-4" size={36} />
                            <p className="text-sm font-medium tracking-wide">Connecting to Live Stream...</p>
                        </div>
                    ) : !data ? (
                        <div className="bg-white/5 backdrop-blur-xl rounded-3xl p-8 text-center border border-white/10 text-slate-300">
                            {t('no_data')}
                        </div>
                    ) : (
                        <>
                            {/* Temperature */}
                            <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-6 shadow-2xl border border-white/20 flex items-center justify-between transform transition-all duration-300 hover:scale-[1.02] hover:bg-white-[0.15]">
                                <div className="flex items-center gap-5">
                                    <div className="bg-gradient-to-br from-orange-400 to-red-500 p-4 rounded-2xl shadow-inner shadow-white/20">
                                        <ThermometerSun size={28} className="text-white" strokeWidth={2.5} />
                                    </div>
                                    <div className="text-left">
                                        <p className="text-blue-100/80 font-medium text-sm mb-0.5 tracking-wide">{t('temperature')}</p>
                                        <div className="flex items-baseline gap-1">
                                            <p className="text-4xl font-extrabold text-white drop-shadow-sm">{data.temperature.toFixed(1)}</p>
                                            <span className="text-xl text-blue-200 font-bold">°C</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Heat Index */}
                            <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-6 shadow-2xl border border-white/20 flex items-center justify-between transform transition-all duration-300 hover:scale-[1.02] hover:bg-white-[0.15]">
                                <div className="flex items-center gap-5">
                                    <div className="bg-gradient-to-br from-red-500 to-rose-600 p-4 rounded-2xl shadow-inner shadow-white/20">
                                        <Flame size={28} className="text-white" strokeWidth={2.5} />
                                    </div>
                                    <div className="text-left">
                                        <p className="text-blue-100/80 font-medium text-sm mb-0.5 tracking-wide">Heat Index</p>
                                        <div className="flex items-baseline gap-1">
                                            <p className="text-4xl font-extrabold text-white drop-shadow-sm">{data.heat_index?.toFixed(1) || '--'}</p>
                                            <span className="text-xl text-blue-200 font-bold">°C</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Humidity */}
                            <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-6 shadow-2xl border border-white/20 flex items-center justify-between transform transition-all duration-300 hover:scale-[1.02] hover:bg-white-[0.15]">
                                <div className="flex items-center gap-5">
                                    <div className="bg-gradient-to-br from-blue-400 to-indigo-500 p-4 rounded-2xl shadow-inner shadow-white/20">
                                        <Droplets size={28} className="text-white" strokeWidth={2.5} />
                                    </div>
                                    <div className="text-left">
                                        <p className="text-blue-100/80 font-medium text-sm mb-0.5 tracking-wide">{t('humidity')}</p>
                                        <div className="flex items-baseline gap-1">
                                            <p className="text-4xl font-extrabold text-white drop-shadow-sm">{data.humidity.toFixed(1)}</p>
                                            <span className="text-xl text-blue-200 font-bold">%</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Rainfall */}
                            <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-6 shadow-2xl border border-white/20 flex items-center justify-between transform transition-all duration-300 hover:scale-[1.02] hover:bg-white-[0.15]">
                                <div className="flex items-center gap-5">
                                    <div className="bg-gradient-to-br from-sky-400 to-cyan-500 p-4 rounded-2xl shadow-inner shadow-white/20">
                                        <CloudRain size={28} className="text-white" strokeWidth={2.5} />
                                    </div>
                                    <div className="text-left">
                                        <p className="text-blue-100/80 font-medium text-sm mb-0.5 tracking-wide">{t('rainfall')}</p>
                                        <div className="flex items-baseline gap-1">
                                            <p className="text-4xl font-extrabold text-white drop-shadow-sm">{data.rainfall.toFixed(1)}</p>
                                            <span className="text-xl text-blue-200 font-bold">mm</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Footer info & Link */}
                <div className="mt-auto">
                    <div className="flex items-center justify-center gap-2 text-xs font-semibold tracking-wide text-blue-200/60 mb-6 bg-black/20 py-2 px-4 rounded-full mx-auto w-max border border-white/5">
                        {loading && data ? (
                            <Loader2 size={12} className="animate-spin text-blue-300" />
                        ) : (
                            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                        )}
                        <span className="uppercase tracking-widest">{t('last_updated')}: {sensorTimestamp}</span>
                    </div>

                    <Link
                        to="/dashboard"
                        className="group flex items-center justify-center gap-2 w-full py-4 bg-white text-blue-900 text-sm font-bold uppercase tracking-widest rounded-2xl shadow-xl hover:bg-blue-50 transition-colors"
                    >
                        {t('view_dashboard')}
                        <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </Link>
                </div>
            </div>
        </div>
    );
}
