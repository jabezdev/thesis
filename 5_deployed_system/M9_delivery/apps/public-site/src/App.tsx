import { useState, useEffect } from 'react'
import { ref, onValue } from 'firebase/database'
import { rtdb } from './firebase'
import { applyCalibration, DEFAULT_CALIBRATION, type RawSensorData, type ProcessedData } from '@panahon/shared'
import { CloudRain, Droplets, Thermometer, MapPin, Wifi, WifiOff, Moon, Sun, Flame, Cloud, Info } from 'lucide-react'

// ── Heat Index ────────────────────────────────────────────────────────────────
function heatIndex(t: number, rh: number): number | null {
  if (t < 27 || rh < 40) return null
  return (
    -8.78469475556 + 1.61139411 * t + 2.33854883889 * rh
    - 0.14611605 * t * rh - 0.012308094 * t * t
    - 0.0164248277778 * rh * rh + 0.002211732 * t * t * rh
    + 0.00072546 * t * rh * rh - 0.000003582 * t * t * rh * rh
  )
}

const fmt = (v: number | null | undefined) => (v == null ? '--' : v.toFixed(1))

type Cond = { label: string; lightBg: string; darkBg: string; Icon: typeof Sun }
function getCondition(rain: number, temp: number): Cond {
  if (rain > 50) return { label: 'Heavy Rain', lightBg: 'from-blue-700 to-slate-800', darkBg: 'dark:from-blue-950 dark:to-slate-950', Icon: CloudRain }
  if (rain > 20) return { label: 'Moderate Rain', lightBg: 'from-blue-600 to-slate-700', darkBg: 'dark:from-blue-900 dark:to-slate-900', Icon: CloudRain }
  if (rain > 2)  return { label: 'Light Rain', lightBg: 'from-sky-600 to-blue-700', darkBg: 'dark:from-sky-900 dark:to-blue-950', Icon: Cloud }
  if (temp > 35) return { label: 'Hot & Sunny', lightBg: 'from-orange-400 to-amber-600', darkBg: 'dark:from-orange-800 dark:to-amber-950', Icon: Sun }
  if (temp > 28) return { label: 'Warm & Fair', lightBg: 'from-sky-400 to-blue-500', darkBg: 'dark:from-sky-800 dark:to-blue-900', Icon: Sun }
  return { label: 'Fair', lightBg: 'from-sky-500 to-blue-600', darkBg: 'dark:from-sky-900 dark:to-blue-950', Icon: Sun }
}

function hiLevel(hi: number) {
  if (hi >= 54) return { label: 'Extreme Danger', color: 'text-rose-200' }
  if (hi >= 41) return { label: 'Danger', color: 'text-orange-200' }
  if (hi >= 33) return { label: 'Extreme Caution', color: 'text-yellow-200' }
  if (hi >= 27) return { label: 'Caution', color: 'text-lime-200' }
  return { label: 'Normal', color: 'text-emerald-200' }
}

function App() {
  const [data, setData] = useState<RawSensorData | null>(null)
  const [meta, setMeta] = useState<any>(null)
  const [showHiInfo, setShowHiInfo] = useState(false)

  const processedData = data ? applyCalibration(data, meta?.calibration ?? DEFAULT_CALIBRATION) : null;

  // ── Dark mode: follow system, override on toggle ───────────────────────────
  const [isDark, setIsDark] = useState(() => {
    const stored = localStorage.getItem('panahon-public-theme')
    if (stored) return stored === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('panahon-public-theme')) setIsDark(e.matches)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => { document.documentElement.classList.toggle('dark', isDark) }, [isDark])

  const toggleDark = () => {
    setIsDark(d => {
      const next = !d
      localStorage.setItem('panahon-public-theme', next ? 'dark' : 'light')
      return next
    })
  }

  useEffect(() => {
    const u1 = onValue(ref(rtdb, 'nodes/node_1/latest'), s => { if (s.exists()) setData(s.val()) })
    const u2 = onValue(ref(rtdb, 'nodes/node_1/metadata'), s => { if (s.exists()) setMeta(s.val()) })
    return () => { u1(); u2() }
  }, [])

  const hi = processedData ? heatIndex(processedData.temp_corrected, processedData.hum_corrected) : null
  const cond = processedData
    ? getCondition(processedData.rain_corrected, processedData.temp_corrected)
    : { label: 'Loading…', lightBg: 'from-sky-600 to-blue-700', darkBg: 'dark:from-sky-900 dark:to-blue-950', Icon: Sun }
  const hiInfo = hi ? hiLevel(hi) : null
  const updatedAt = processedData
    ? new Date(processedData.ts).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className={`min-h-screen font-sans bg-gradient-to-br ${cond.lightBg} ${cond.darkBg} text-white transition-all duration-1000 relative overflow-hidden`}>
      {/* Ambient glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_25%_15%,rgba(255,255,255,0.1),transparent_55%)] pointer-events-none" />

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <nav className="relative flex items-center justify-between px-6 py-4">
        {/* Station name replaces logo */}
        <h1 className="text-lg font-extrabold tracking-tight text-white truncate max-w-[60%]">
          {meta?.name || 'Weather Station'}
        </h1>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border ${data ? 'bg-emerald-500/25 border-emerald-300/50 text-emerald-100' : 'bg-rose-500/25 border-rose-300/50 text-rose-100'}`}>
            {data ? <Wifi size={11} /> : <WifiOff size={11} />}
            {data ? 'Live' : 'Offline'}
          </div>
          <button onClick={toggleDark} className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 border border-white/25 flex items-center justify-center transition-all" aria-label="Toggle dark mode">
            {isDark ? <Sun size={15} className="text-yellow-200" /> : <Moon size={15} />}
          </button>
        </div>
      </nav>

      {/* ── Location ─────────────────────────────────────────────────────── */}
      <div className="relative text-center px-6 pt-1 pb-2">
        <div className="flex items-center justify-center gap-1.5 text-white/75 text-sm font-medium">
          <MapPin size={13} className="text-rose-300 shrink-0" />
          <span>{meta?.location?.description || 'Loading location…'}</span>
        </div>
      </div>

      {/* ── Weather icon + big temperature ───────────────────────────────── */}
      <div className="relative flex flex-col items-center pt-3 pb-1 px-6">
        <div className="mb-3 p-5 bg-white/15 rounded-full border border-white/20 shadow-2xl">
          <cond.Icon size={72} strokeWidth={1.1} className="text-white drop-shadow-xl" />
        </div>
        <p className="text-sm font-bold uppercase tracking-widest text-white/80 mb-1">{cond.label}</p>

        <div className="flex items-start justify-center">
          <span className="text-[6.5rem] sm:text-[8rem] font-black leading-none tracking-tighter text-white drop-shadow-xl">{fmt(processedData?.temp_corrected)}</span>
          <span className="text-3xl text-white/70 font-light mt-6 sm:mt-8">°C</span>
        </div>

        {/* Heat Index row — always shown, with info popover if N/A */}
        <div className="mt-2 flex flex-col items-center gap-1 relative">
          {hi ? (
            <>
              <div className="flex items-center gap-1.5 text-sm font-medium text-white/90">
                <Flame size={14} className="text-rose-300" />
                Heat Index <span className="font-extrabold text-white">{fmt(hi)}°C</span>
              </div>
              {hiInfo && <span className={`text-[11px] font-bold uppercase tracking-widest ${hiInfo.color}`}>{hiInfo.label}</span>}
            </>
          ) : (
            <div className="flex items-center gap-1.5 text-sm text-white/75">
              <Flame size={14} className="text-rose-300/60" />
              <span>Heat Index</span>
              <span className="font-bold text-white/60">N/A</span>
              <button onClick={() => setShowHiInfo(v => !v)} className="ml-0.5 text-white/50 hover:text-white/90 transition-colors" aria-label="Heat index info">
                <Info size={14} />
              </button>
              {showHiInfo && (
                <div className="absolute top-8 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 border border-white/15 rounded-xl p-3 w-64 shadow-2xl text-left" onClick={e => e.stopPropagation()}>
                  <p className="text-xs text-white/90 font-semibold mb-1">Heat Index Not Available</p>
                  <p className="text-[11px] text-white/65 leading-relaxed">Heat index is computed when air temperature ≥ 27°C and relative humidity ≥ 40%. Current conditions are below these thresholds.</p>
                  <button onClick={() => setShowHiInfo(false)} className="mt-2 text-[10px] text-white/50 hover:text-white/80 font-bold uppercase tracking-widest">Dismiss</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Conditions card ──────────────────────────────────────────────── */}
      <div className="relative px-4 max-w-sm mx-auto py-4" onClick={() => setShowHiInfo(false)}>
        <div className="bg-white/15 backdrop-blur-2xl rounded-3xl border border-white/25 p-6 shadow-2xl">
          <div className="grid grid-cols-3 gap-3 text-center">
            {/* Air Temperature */}
            <div className="flex flex-col items-center gap-2">
              <div className="p-2 bg-white/20 rounded-xl border border-white/15">
                <Thermometer size={20} className="text-white" />
              </div>
              <span className="text-2xl font-black text-white">{fmt(processedData?.temp_corrected)}<span className="text-sm text-white/70">°C</span></span>
              <span className="text-[10px] uppercase tracking-widest text-white/75 font-bold">Air Temp</span>
            </div>
            {/* Humidity */}
            <div className="flex flex-col items-center gap-2 border-x border-white/20 px-1">
              <div className="p-2 bg-white/20 rounded-xl border border-white/15">
                <Droplets size={20} className="text-white" />
              </div>
              <span className="text-2xl font-black text-white">{fmt(processedData?.hum_corrected)}<span className="text-sm text-white/70">%</span></span>
              <span className="text-[10px] uppercase tracking-widest text-white/75 font-bold">Humidity</span>
            </div>
            {/* Rainfall */}
            <div className="flex flex-col items-center gap-2">
              <div className="p-2 bg-white/20 rounded-xl border border-white/15">
                <CloudRain size={20} className="text-white" />
              </div>
              <span className="text-2xl font-black text-white">{fmt(processedData?.rain_corrected)}<span className="text-sm text-white/70">mm</span></span>
              <span className="text-[10px] uppercase tracking-widest text-white/75 font-bold">Rainfall</span>
            </div>
          </div>
          {updatedAt && (
            <div className="mt-5 pt-4 border-t border-white/20 text-center">
              <p className="text-[11px] text-white/70 font-medium">Last updated {updatedAt} (PHT)</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="relative text-center py-8 px-6">
        <p className="text-[11px] text-white/60 font-medium leading-relaxed">
          © 2026 Project Sipat Banwa — Observer of the Sky<br />
          <span className="text-white/50">Electronics Engineering Department - Pampanga State University</span>
        </p>
      </footer>
    </div>
  )
}

export default App
