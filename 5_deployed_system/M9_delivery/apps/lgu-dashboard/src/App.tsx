import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Card, Badge, Button } from '@panahon/ui'
import { UserButton } from '@clerk/clerk-react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { ref, onValue } from 'firebase/database'
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc } from 'firebase/firestore'
import { rtdb, db } from './firebase'
import {
  applyCalibration, DEFAULT_CALIBRATION,
  type RawSensorData, type ProcessedData, type NodeCalibration,
} from '@panahon/shared'
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'
import {
  CloudRain, Thermometer, Droplets, Flame,
  Download, AlertTriangle, CheckCircle2, Radio,
  Activity, Zap, X,
} from 'lucide-react'

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

// ── Custom Tooltip ────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload
    const isDark = document.documentElement.classList.contains('dark')
    const bg = isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
    const mute = isDark ? 'text-slate-400' : 'text-slate-500'

    let dateStr = '--'
    if (data.ts_epoch) {
      const d = new Date(data.ts_epoch)
      dateStr = `${(d.getMonth() + 1)}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }

    return (
      <div className={`p-3 rounded-xl border shadow-xl ${bg} text-xs min-w-[140px]`}>
        <p className={`font-bold mb-2 pb-1 border-b ${isDark ? 'border-slate-800' : 'border-slate-100'} ${mute}`}>{dateStr}</p>
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between gap-4">
            <span className="text-orange-500 font-medium">Temp:</span>
            <span className="font-bold">{fmt(data.temp_corrected)}°C</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-teal-500 font-medium">Humidity:</span>
            <span className="font-bold">{fmt(data.hum_corrected)}%</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-blue-500 font-medium">Rain:</span>
            <span className="font-bold">{fmt(data.rain_corrected)}mm</span>
          </div>
          {data.hi != null && (
            <div className="flex justify-between gap-4">
              <span className="text-rose-500 font-medium">Heat Idx:</span>
              <span className="font-bold">{fmt(data.hi)}°C</span>
            </div>
          )}
        </div>
      </div>
    )
  }
  return null
}

// ── Sparkline (live — minimal x ticks, fills card) ───────────────────────────
function Sparkline({ data, dataKey, color, domain }: { data: any[]; dataKey: string; color: string; domain?: any[] }) {
  if (!data.length) return (
    <div className="flex-1 flex items-center justify-center text-xs text-slate-400 dark:text-slate-600 italic">Awaiting data…</div>
  )
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
        <XAxis 
          dataKey="ts_epoch" 
          type="number" 
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(ep) => {
            const d = new Date(ep);
            return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
          }}
          tick={{ fontSize: 9, fill: '#94a3b8' }} 
          tickLine={false} axisLine={false} 
          minTickGap={60} 
        />
        <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={28} tickCount={3} domain={domain || ['auto', 'auto']} tickFormatter={(v) => typeof v === 'number' ? v.toFixed(1) : v} />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '3 3' }} />
        <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

type HistPt = RawSensorData & { timeLabel: string; ts_epoch: number; temp_corrected: number; hum_corrected: number; rain_corrected: number; batt_v_corrected: number; solar_v_corrected: number; is_extreme_weather: boolean }
type Page = 'live' | 'records' | 'history'
type MetricRow = 'hi' | 'temp_corrected' | 'hum_corrected' | 'rain_corrected'

type StoredMetricStats = {
  min: number | null
  max: number | null
  avg: number | null
  count: number
  min_ts: string | null
  max_ts: string | null
}

type StoredDailyRecord = {
  node_id: string
  day_key: string
  timezone?: string
  metrics?: Partial<Record<MetricRow, StoredMetricStats>>
}

type MetricStats = {
  min: number | null
  max: number | null
  avg: number | null
  minTs: number | null
  maxTs: number | null
  count: number
}

type DayRecordStats = {
  key: string
  label: string
  isToday: boolean
  stats: Record<MetricRow, MetricStats>
}

const MANILA_TZ = 'Asia/Manila'

function manilaDayKey(epoch: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epoch))
}

function dayLabelFromKey(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00+08:00`)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: MANILA_TZ,
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function formatStamp(epoch: number | null): string {
  if (epoch == null) return '--'
  const d = new Date(epoch)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: MANILA_TZ,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

function emptyStats(): MetricStats {
  return { min: null, max: null, avg: null, minTs: null, maxTs: null, count: 0 }
}

function fromStoredMetricStats(stored?: StoredMetricStats): MetricStats {
  if (!stored || !stored.count) return emptyStats()
  return {
    min: stored.min ?? null,
    max: stored.max ?? null,
    avg: stored.avg ?? null,
    minTs: stored.min_ts ? new Date(stored.min_ts).getTime() : null,
    maxTs: stored.max_ts ? new Date(stored.max_ts).getTime() : null,
    count: stored.count,
  }
}

function applyLivePoint(base: MetricStats, value: number | null | undefined, tsEpoch: number): MetricStats {
  if (value == null || Number.isNaN(value)) return base
  const next: MetricStats = { ...base }
  if (next.count === 0 || next.min == null || value < next.min) {
    next.min = value
    next.minTs = tsEpoch
  }
  if (next.count === 0 || next.max == null || value > next.max) {
    next.max = value
    next.maxTs = tsEpoch
  }
  const prevSum = (next.avg ?? 0) * next.count
  next.count += 1
  next.avg = (prevSum + value) / next.count
  return next
}


function App() {
  // ── Dark mode ──────────────────────────────────────────────────────────────
  const [darkMode, setDarkMode] = useState(() => {
    const s = localStorage.getItem('panahon-dark')
    return s !== null ? s === 'true' : window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    localStorage.setItem('panahon-dark', String(darkMode))
  }, [darkMode])

  const [page, setPage] = useState<Page>('live')

  // ── Convex ─────────────────────────────────────────────────────────────────
  const nodes = useQuery(api.nodes.list)
  const allAlerts = useQuery(api.alerts.list)
  const resolveAlert = useMutation(api.alerts.resolve)
  const activeAlerts = allAlerts?.filter(a => !a.resolved) ?? []

  // ── Node selection ─────────────────────────────────────────────────────────
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  useEffect(() => {
    if (nodes?.length && !selectedNodeId) setSelectedNodeId(nodes[0].node_id)
  }, [nodes, selectedNodeId])
  const selectedNode = nodes?.find(n => n.node_id === selectedNodeId)
  const calRef = useRef<NodeCalibration>(DEFAULT_CALIBRATION)
  calRef.current = selectedNode?.calibration ?? DEFAULT_CALIBRATION

  // ── RTDB latest ────────────────────────────────────────────────────────────
  const [latestData, setLatestData] = useState<ProcessedData | null>(null)
  const [connStatus, setConnStatus] = useState('Connecting…')

  // ── Broadcast Modal ────────────────────────────────────────────────────────
  const createAlert = useMutation(api.alerts.create)
  const [isBroadcastOpen, setIsBroadcastOpen] = useState(false)
  const [broadcastForm, setBroadcastForm] = useState({
    type: 'manual' as const,
    severity: 'info' as 'info' | 'warning' | 'critical',
    message: '',
    node_id: 'GLOBAL'
  })

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!broadcastForm.message) return
    await createAlert(broadcastForm)
    setIsBroadcastOpen(false)
    setBroadcastForm(prev => ({ ...prev, message: '' }))
  }

  useEffect(() => {
    if (!selectedNodeId) return
    setLatestData(null); setConnStatus('Connecting…')
    return onValue(ref(rtdb, `nodes/${selectedNodeId}/latest`), snap => {
      if (snap.exists()) {
        setLatestData(applyCalibration(snap.val() as RawSensorData, calRef.current))
        setConnStatus('Online')
      } else setConnStatus('No Data')
    }, () => setConnStatus('Error'))
  }, [selectedNodeId])

  // ── RTDB last_hour (true 60-min, using raw data + apply calibration) ────────
  const [hourData, setHourData] = useState<HistPt[]>([])
  useEffect(() => {
    if (!selectedNodeId) return
    return onValue(ref(rtdb, `nodes/${selectedNodeId}/last_hour`), snap => {
      if (!snap.exists()) { setHourData([]); return }
      const raw = snap.val() as Record<string, RawSensorData>
      const cutoff = Date.now() - 3_600_000
      const sorted = Object.entries(raw)
        .filter(([ep]) => parseInt(ep) > cutoff)
        .sort(([a], [b]) => parseInt(a) - parseInt(b))

      const withGaps: HistPt[] = []
      for (let i = 0; i < sorted.length; i++) {
        const currT = parseInt(sorted[i][0])
        if (i > 0) {
          const prevT = parseInt(sorted[i-1][0])
          if (currT - prevT > 10 * 60000) {
            withGaps.push({ timeLabel: '', ts_epoch: prevT + 1000, temp_corrected: null, hum_corrected: null, rain_corrected: null } as any)
          }
        }
        const t = new Date(currT)
        const processed = applyCalibration(sorted[i][1], calRef.current)
        withGaps.push({
          ...processed,
          ts_epoch: currT,
          timeLabel: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`,
        } as HistPt)
      }
      setHourData(withGaps)
    })
  }, [selectedNodeId])

  // ── Firestore 24h analytics ────────────────────────────────────────────────
  // m6_node_data stores raw fields (temp, hum, rain, etc.) + node_id.
  // We query by node_id only (no composite index needed) then filter ts in JS.
  // ── Firestore analytics ───────────────────────────────────────────────────
  // IMPORTANT: where('node_id') + orderBy('ts') requires a composite Firestore
  // index. To avoid that, we query orderBy('ts') only (single-field auto-index)
  // then filter by node_id and date client-side.
  const [histData, setHistData] = useState<HistPt[]>([])
  const [histLoading, setHistLoading] = useState(false)
  const [recordsDaily, setRecordsDaily] = useState<Record<string, StoredDailyRecord>>({})
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [timeRange, setTimeRange] = useState({
    start: new Date(Date.now() - 24 * 3_600_000).toISOString().slice(0, 16),
    end: new Date().toISOString().slice(0, 16)
  })

  const fetchHist = useCallback(async (nodeId: string | null, range: { start: string, end: string }) => {
    if (!nodeId) return
    setHistLoading(true)
    try {
      const startIso = new Date(range.start).toISOString()
      const endIso = new Date(range.end).toISOString()
      const diffMins = Math.max(1, Math.ceil((new Date(range.end).getTime() - new Date(range.start).getTime()) / 60000))

      // Single-field index on 'ts' supports where + orderBy on the same field natively without composite index.
      // We filter by node_id client-side.
      const snap = await getDocs(query(
        collection(db, 'm6_node_data'),
        where('ts', '>=', startIso),
        where('ts', '<=', endIso),
        orderBy('ts', 'asc'),
        limit(Math.min(diffMins + 60, 10000)), // added slight buffer
      ))
      const rawDocs = snap.docs
        .map(doc => doc.data() as RawSensorData & { node_id: string })
        .filter(d => d.node_id === nodeId)
        

      const withGaps: HistPt[] = []
      for (let i = 0; i < rawDocs.length; i++) {
        const currT = new Date(rawDocs[i].ts).getTime()
        if (i > 0) {
          const prevT = new Date(rawDocs[i-1].ts).getTime()
          if (currT - prevT > 10 * 60000) {
            withGaps.push({ timeLabel: '', ts_epoch: prevT + 1000, temp_corrected: null, hum_corrected: null, rain_corrected: null } as any)
          }
        }
        const t = new Date(currT)
        const processed = applyCalibration(rawDocs[i], calRef.current)
        withGaps.push({
          ...processed,
          ts_epoch: currT,
          timeLabel: `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`
        } as HistPt)
      }
      setHistData(withGaps)
      console.log(`[Firestore] Loaded ${rawDocs.length} records for ${nodeId} (${range.start} to ${range.end})`)
    } catch (e) {
      console.error('[Firestore query failed — check composite index or collection name]', e)
    } finally {
      setHistLoading(false)
    }
  }, [])
  // Only fetch automatically when the selected node changes, not when the user is modifying the time range inputs
  useEffect(() => { fetchHist(selectedNodeId, timeRange) }, [selectedNodeId, fetchHist])

  const fetchRecords = useCallback(async (nodeId: string | null) => {
    if (!nodeId) {
      setRecordsDaily({})
      return
    }
    setRecordsLoading(true)
    try {
      const dayKeys = Array.from({ length: 7 }, (_, i) => manilaDayKey(Date.now() - (6 - i) * 24 * 3_600_000))
      const ids = dayKeys.map((k) => `${nodeId}_${k}`)
      const docs = await Promise.all(ids.map((id) => getDoc(doc(db, 'm6_daily_records', id))))
      const byDay: Record<string, StoredDailyRecord> = {}
      for (const snap of docs) {
        if (!snap.exists()) continue
        const data = snap.data() as StoredDailyRecord
        if (!data?.day_key) continue
        byDay[data.day_key] = data
      }
      setRecordsDaily(byDay)
    } catch (e) {
      console.error('[Firestore records query failed]', e)
      setRecordsDaily({})
    } finally {
      setRecordsLoading(false)
    }
  }, [])

  useEffect(() => { fetchRecords(selectedNodeId) }, [selectedNodeId, fetchRecords])

  // ── Derived ────────────────────────────────────────────────────────────────
  const hi = latestData ? heatIndex(latestData.temp_corrected, latestData.hum_corrected) : null

  const hourWithHI = hourData.map(d => ({
    ...d,
    hi: heatIndex(d.temp_corrected, d.hum_corrected) ?? d.temp_corrected,
  }))
  const histWithHI = histData.map(d => ({
    ...d,
    hi: heatIndex(d.temp_corrected, d.hum_corrected) ?? d.temp_corrected,
  }))

  const recordsByDay = useMemo<DayRecordStats[]>(() => {
    const keys = Array.from({ length: 7 }, (_, i) => manilaDayKey(Date.now() - (6 - i) * 24 * 3_600_000))
    const todayKey = manilaDayKey(Date.now())
    return keys.map((key) => {
      const doc = recordsDaily[key]
      let stats: Record<MetricRow, MetricStats> = {
        hi: fromStoredMetricStats(doc?.metrics?.hi),
        temp_corrected: fromStoredMetricStats(doc?.metrics?.temp_corrected),
        hum_corrected: fromStoredMetricStats(doc?.metrics?.hum_corrected),
        rain_corrected: fromStoredMetricStats(doc?.metrics?.rain_corrected),
      }

      // Keep today's column live while waiting for processor rollup refresh.
      if (key === todayKey && latestData) {
        const tsEpoch = new Date(latestData.ts).getTime()
        const latestHi = heatIndex(latestData.temp_corrected, latestData.hum_corrected) ?? latestData.temp_corrected
        stats = {
          hi: applyLivePoint(stats.hi, latestHi, tsEpoch),
          temp_corrected: applyLivePoint(stats.temp_corrected, latestData.temp_corrected, tsEpoch),
          hum_corrected: applyLivePoint(stats.hum_corrected, latestData.hum_corrected, tsEpoch),
          rain_corrected: applyLivePoint(stats.rain_corrected, latestData.rain_corrected, tsEpoch),
        }
      }

      return {
        key,
        label: key === todayKey ? 'Today' : dayLabelFromKey(key),
        isToday: key === todayKey,
        stats,
      }
    })
  }, [recordsDaily, latestData])

  const todayStats = useMemo(() => recordsByDay.find(d => d.isToday)?.stats ?? {
    hi: emptyStats(),
    temp_corrected: emptyStats(),
    hum_corrected: emptyStats(),
    rain_corrected: emptyStats(),
  }, [recordsByDay])

  // ── CSV export ─────────────────────────────────────────────────────────────
  const handleExport = () => {
    if (!histData.length) return
    const cols = ['ts', 'temp_corrected', 'hum_corrected', 'rain_corrected', 'batt_v_corrected', 'solar_v_corrected']
    const csv = [cols.join(','), ...histData.map(d => cols.map(c => (d as any)[c] ?? '').join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `panahon_${selectedNodeId}_${timeRange.start}_to_${timeRange.end}.csv`
    a.click()
  }

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-50 px-5 flex items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold shadow-lg shadow-blue-500/25 text-sm select-none">P</div>
          <div className="hidden sm:block leading-none">
            <p className="text-sm font-bold text-slate-900 dark:text-white">Panahon <span className="text-blue-600">LGU</span></p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">DRRM Internal</p>
          </div>
        </div>

        {/* Fleet Awareness Bar (Minimal) */}
        <div className="hidden lg:flex items-center gap-6 bg-slate-50 dark:bg-slate-800/50 px-4 py-1.5 rounded-full border border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
            <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
              {nodes?.filter(n => n.status === 'active').length || 0} / {nodes?.length || 0} Stations Online
            </span>
          </div>
          <div className="w-px h-3 bg-slate-200 dark:bg-slate-700" />
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider whitespace-nowrap">
              {activeAlerts.length} Active Warnings
            </span>
          </div>
        </div>

        {/* Page tabs */}
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl gap-0.5">
          {([
            { key: 'live', label: 'Live Monitor', Icon: Activity },
            { key: 'records', label: 'Records', Icon: Radio },
            { key: 'history', label: 'History', Icon: Zap },
          ] as const).map(({ key, label, Icon }) => (
            <button key={key} onClick={() => setPage(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                page === key
                  ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
              }`}>
              <Icon size={12} />{label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {activeAlerts.length > 0 && (
            <span className="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
              <AlertTriangle size={9} />{activeAlerts.length}
            </span>
          )}
          <UserButton afterSignOutUrl="/" appearance={{ elements: { avatarBox: 'w-8 h-8' } }} />
        </div>
      </header>

      {/* ── PAGE 1: Live Monitor ─────────────────────────────────────────── */}
      {page === 'live' && (
        <main className="h-[calc(100vh-3.5rem)] flex overflow-hidden">

          {/* Left: metric cards */}
          <div className="flex-1 p-5 flex flex-col gap-4 overflow-y-auto">
            {/* Status strip */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-sm">
                <span className={`w-2.5 h-2.5 rounded-full ${connStatus === 'Online' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-400'}`} />
                <span className={connStatus === 'Online' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-rose-500 font-bold'}>{connStatus}</span>
                <span className="text-slate-500 dark:text-slate-400 font-medium">— {selectedNode?.name || selectedNodeId || 'No station'}</span>
              </div>
              {/* Station selector */}
              {nodes && nodes.length > 1 && (
                <select value={selectedNodeId ?? ''} onChange={e => setSelectedNodeId(e.target.value)}
                  className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs font-medium outline-none text-slate-800 dark:text-slate-100">
                  {nodes.map(n => <option key={n._id} value={n.node_id}>{n.name || n.node_id}</option>)}
                </select>
              )}
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{latestData ? new Date(latestData.ts).toLocaleTimeString() : '--'}</span>
            </div>

            {/* 2×2 metric grid — fills remaining height */}
            <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
              {[
                { label: 'Temperature', unit: '°C', value: latestData?.temp_corrected, dataKey: 'temp_corrected', color: '#f97316', Icon: Thermometer, accent: 'text-orange-500', ring: 'ring-orange-200 dark:ring-orange-900/40', data: hourData, domain: [15, 40] },
                { label: 'Humidity', unit: '%', value: latestData?.hum_corrected, dataKey: 'hum_corrected', color: '#14b8a6', Icon: Droplets, accent: 'text-teal-500', ring: 'ring-teal-200 dark:ring-teal-900/40', data: hourData, domain: [0, 100] },
                { label: 'Precipitation', unit: 'mm', value: latestData?.rain_corrected, dataKey: 'rain_corrected', color: '#3b82f6', Icon: CloudRain, accent: 'text-blue-500', ring: 'ring-blue-200 dark:ring-blue-900/40', data: hourData },
                { label: 'Heat Index', unit: '°C', value: hi ?? latestData?.temp_corrected, dataKey: 'hi', color: '#ef4444', Icon: Flame, accent: 'text-rose-500', ring: 'ring-rose-200 dark:ring-rose-900/40', data: hourWithHI, domain: [15, 60] },
              ].map(({ label, unit, value, dataKey, color, Icon, accent, ring, data, domain }) => {
                const isHI = label === 'Heat Index'
                const maxMetricByDataKey: Record<string, MetricStats> = {
                  temp_corrected: todayStats.temp_corrected,
                  hum_corrected: todayStats.hum_corrected,
                  rain_corrected: todayStats.rain_corrected,
                  hi: todayStats.hi,
                }
                const maxForCard = maxMetricByDataKey[dataKey]
                return (
                  <Card key={label} className={`flex flex-col bg-white dark:bg-slate-900 ring-1 ${ring} p-5 overflow-hidden`}>
                    {/* Label row */}
                    <div className="flex items-center gap-2 mb-2 shrink-0">
                      <Icon size={24} className={accent} />
                      <span className={`text-xl font-black uppercase tracking-wide ${accent}`}>{label}</span>
                      {maxForCard.max != null && maxForCard.maxTs != null && (
                        <div className="ml-auto text-right leading-tight">
                          <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Max Today</p>
                          <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{fmt(maxForCard.max)}{unit}</p>
                          <p className="text-[10px] text-slate-400">{formatStamp(maxForCard.maxTs)}</p>
                        </div>
                      )}
                      {isHI && !hi && (
                        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400 italic font-medium">using temp</span>
                      )}
                    </div>
                    {/* Value */}
                    <div className="flex items-baseline gap-2 mb-1 shrink-0">
                      <span className={`text-[5.5rem] font-black tracking-tighter leading-none ${value != null ? accent : 'text-slate-400 dark:text-slate-500'} drop-shadow-sm`}>
                        {fmt(value)}
                      </span>
                      <span className="text-3xl text-slate-600 dark:text-slate-400 font-bold">{unit}</span>
                    </div>
                    {/* Chart fills REMAINING space */}
                    <div className="flex-1 w-full mt-2 -ml-2">
                      <Sparkline data={data} dataKey={dataKey} color={color} domain={domain} />
                    </div>
                  </Card>
                )
              })}
            </div>
          </div>

          {/* Right: alerts sidebar */}
          <aside className="w-72 shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 shrink-0">
              <AlertTriangle size={15} className="text-amber-500" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Active Alerts</h2>
              {activeAlerts.length > 0 && (
                <span className="ml-auto text-[10px] bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 font-bold px-2 py-0.5 rounded-full">{activeAlerts.length}</span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
              {activeAlerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <CheckCircle2 size={36} className="text-emerald-400/30" />
                  <p className="text-sm font-bold text-slate-600 dark:text-slate-300">All Clear</p>
                  <p className="text-xs text-center text-slate-400 dark:text-slate-500">No active alerts across the network.</p>
                </div>
              ) : (
                activeAlerts.map(a => (
                  <div key={a._id} className={`rounded-xl p-3 border-l-4 ${a.severity === 'critical' ? 'bg-rose-50 dark:bg-rose-950/40 border-l-rose-500' : 'bg-amber-50 dark:bg-amber-950/40 border-l-amber-500'}`}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className={`font-bold text-xs leading-snug ${a.severity === 'critical' ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'}`}>
                        {a.type.replace(/_/g, ' ')}
                      </p>
                      <Badge variant={a.severity === 'critical' ? 'error' : 'warning'}>{a.severity}</Badge>
                    </div>
                    <p className="text-[10px] text-slate-600 dark:text-slate-400">{a.message}</p>
                    <p className="text-[10px] text-slate-400 font-mono mt-0.5">{a.node_id}</p>
                    <button onClick={() => resolveAlert({ alertId: a._id })}
                      className="mt-2 text-[10px] font-bold text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 flex items-center gap-1 transition-colors">
                      <CheckCircle2 size={10} /> Resolve
                    </button>
                  </div>
                ))
              )}
            </div>

            {nodes && nodes.length > 0 && (
              <div className="border-t border-slate-100 dark:border-slate-800 p-3 shrink-0 flex flex-col gap-3">
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1.5 font-bold">Station Focus</p>
                  <select value={selectedNodeId ?? ''} onChange={e => setSelectedNodeId(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-xs font-medium outline-none text-slate-800 dark:text-slate-100">
                    {nodes.map(n => <option key={n._id} value={n.node_id}>{n.name || n.node_id}</option>)}
                  </select>
                </div>
                <Button onClick={() => setIsBroadcastOpen(true)} className="w-full gap-2 bg-rose-600 hover:bg-rose-700 text-white border-transparent text-[11px] h-9 rounded-xl font-bold py-0 shadow-lg shadow-rose-500/20">
                  <AlertTriangle size={14} /> Broadcast Warning
                </Button>
              </div>
            )}
          </aside>
        </main>
      )}

      {/* ── PAGE 2: Records ─────────────────────────────────────────────── */}
      {page === 'records' && (
        <main className="p-5 max-w-[1280px] mx-auto flex flex-col gap-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Radio size={20} className="text-indigo-500" /> Records
              </h2>
              <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mt-0.5">
                {selectedNode?.name || selectedNodeId} - Daily min, max, and average for the last 7 days (Asia/Manila)
              </p>
            </div>
            <Button onClick={() => fetchRecords(selectedNodeId)} variant="outline" className="text-xs font-bold">
              <Radio size={13} className="mr-1" /> Refresh Records
            </Button>
          </div>

          {recordsLoading ? (
            <div className="flex items-center justify-center py-16 gap-3 text-slate-500">
              <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-medium">Loading 7-day records...</span>
            </div>
          ) : (
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 md:p-5 overflow-x-auto">
              <div className="min-w-[980px] flex flex-col gap-3">
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: 'repeat(6, minmax(120px, 1fr)) minmax(180px, 1.5fr)' }}
                >
                  {recordsByDay.map((day) => (
                    <div
                      key={`head-${day.key}`}
                      className={`rounded-xl px-3 py-2 border text-center ${day.isToday
                        ? 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-300 dark:border-indigo-700'
                        : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <p className={`text-xs font-black uppercase tracking-wider ${day.isToday ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'}`}>
                        {day.label}
                      </p>
                      <p className="text-[10px] text-slate-400">{day.key}</p>
                    </div>
                  ))}
                </div>

                {([
                  { key: 'hi' as const, label: 'Heat Index', unit: '°C', accent: 'text-rose-500' },
                  { key: 'temp_corrected' as const, label: 'Air Temp', unit: '°C', accent: 'text-orange-500' },
                  { key: 'hum_corrected' as const, label: 'Humidity', unit: '%', accent: 'text-teal-500' },
                  { key: 'rain_corrected' as const, label: 'Precipitation', unit: 'mm', accent: 'text-blue-500' },
                ]).map((row) => (
                  <div key={row.key} className="flex flex-col gap-1.5">
                    <p className={`text-sm font-black uppercase tracking-wide ${row.accent}`}>{row.label}</p>
                    <div
                      className="grid gap-3"
                      style={{ gridTemplateColumns: 'repeat(6, minmax(120px, 1fr)) minmax(180px, 1.5fr)' }}
                    >
                      {recordsByDay.map((day) => {
                        const s = day.stats[row.key]
                        return (
                          <div
                            key={`${row.key}-${day.key}`}
                            className={`rounded-xl p-3 border ${day.isToday
                              ? 'bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/40 dark:to-slate-900 border-indigo-300/90 dark:border-indigo-700 shadow-sm'
                              : 'bg-slate-50/70 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'
                            }`}
                          >
                            {s.count === 0 ? (
                              <div className="h-full flex items-center justify-center text-xs text-slate-400 italic">No data</div>
                            ) : (
                              <div className="space-y-1.5">
                                <p className="text-xs text-slate-600 dark:text-slate-300">
                                  <span className="font-bold">Min:</span> {fmt(s.min)}{row.unit}
                                </p>
                                <p className="text-[10px] text-slate-400">{formatStamp(s.minTs)}</p>
                                <p className="text-xs text-slate-600 dark:text-slate-300">
                                  <span className="font-bold">Max:</span> {fmt(s.max)}{row.unit}
                                </p>
                                <p className="text-[10px] text-slate-400">{formatStamp(s.maxTs)}</p>
                                <p className="text-xs text-slate-600 dark:text-slate-300">
                                  <span className="font-bold">Avg:</span> {fmt(s.avg)}{row.unit}
                                </p>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>
      )}

      {/* ── PAGE 3: History ─────────────────────────────────────────────── */}
      {page === 'history' && (
        <main className="p-5 max-w-5xl mx-auto flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Activity size={20} className="text-blue-500 shrink-0" /> History
              </h2>
              <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mt-0.5 truncate">
                {selectedNode?.name || selectedNodeId} — {histLoading ? 'Loading…' : `${histData.length} records`}
              </p>
            </div>
            <div className="flex flex-none flex-wrap items-center gap-3 shrink-0 bg-white dark:bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Range</span>
                <input 
                  type="datetime-local" 
                  value={timeRange.start}
                  max={timeRange.end}
                  onChange={e => setTimeRange(r => ({ ...r, start: e.target.value }))}
                  className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-400">to</span>
                <input 
                  type="datetime-local" 
                  value={timeRange.end}
                  min={timeRange.start}
                  onChange={e => setTimeRange(r => ({ ...r, end: e.target.value }))}
                  className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1 border-hidden" />
              <div className="flex gap-2">
                <Button onClick={() => fetchHist(selectedNodeId, timeRange)} variant="outline" className="flex items-center justify-center gap-2 text-xs px-3 py-1.5 h-auto rounded-lg font-bold hover:bg-slate-50 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                  <Radio size={13} /> Refresh
                </Button>
                <Button onClick={handleExport} disabled={!histData.length} className="flex items-center justify-center gap-2 text-xs px-3 py-1.5 h-auto rounded-lg font-bold bg-slate-800 dark:bg-white text-white dark:text-slate-900 border-transparent hover:bg-slate-900 dark:hover:bg-slate-100">
                  <Download size={13} /> Export CSV
                </Button>
              </div>
            </div>
          </div>

          {histLoading && (
            <div className="flex items-center justify-center py-16 gap-3 text-slate-500">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-medium">Fetching 24h records from Firestore…</span>
            </div>
          )}

          {!histLoading && histData.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
              <Activity size={32} className="opacity-30" />
              <p className="text-sm italic">No records found in the last 24 hours for this station.</p>
              <p className="text-xs text-slate-400">Check the processor is running and writing to Firestore collection <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">m6_node_data</code></p>
            </div>
          )}

          {!histLoading && [
            { label: 'Temperature', unit: '°C', key: 'temp_corrected', color: '#f97316', data: histData, area: false, domain: [15, 40] },
            { label: 'Humidity', unit: '%', key: 'hum_corrected', color: '#14b8a6', data: histData, area: false, domain: [0, 100] },
            { label: 'Precipitation', unit: 'mm', key: 'rain_corrected', color: '#3b82f6', data: histData, area: true },
            { label: 'Heat Index', unit: '°C', key: 'hi', color: '#ef4444', data: histWithHI, area: false, note: 'Interpolated with temperature where HI threshold is not met', domain: [15, 60] },
          ].map(({ label, unit, key, color, data, area, note, domain }) => (
            data.length > 0 && (
              <Card key={key} className="p-6 bg-white dark:bg-slate-900">
                <div className="flex items-baseline gap-2 mb-4">
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{label}</h3>
                  <span className="text-xs text-slate-400">({unit})</span>
                  {note && <span className="text-[10px] text-slate-400 italic ml-auto">{note}</span>}
                </div>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    {area ? (
                      <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.15} />
                        <XAxis 
                          dataKey="ts_epoch" 
                          type="number" 
                          scale="time"
                          allowDataOverflow={true}
                          domain={[new Date(timeRange.start).getTime(), new Date(timeRange.end).getTime()]} 
                          tickFormatter={(ep) => {
                            const d = new Date(ep);
                            return `${(d.getMonth()+1)}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                          }}
                          tick={{ fontSize: 10 }} 
                          minTickGap={60} 
                        />
                        <YAxis tick={{ fontSize: 10 }} width={48} unit={` ${unit}`} domain={domain || ['auto', 'auto']} tickFormatter={(v) => typeof v === 'number' ? v.toFixed(1) : v} />
                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '3 3' }} />
                        <Legend iconType="line" wrapperStyle={{ fontSize: 11 }} />
                        <Area type="monotone" dataKey={key} name={label} stroke={color} fill={color} fillOpacity={0.12} strokeWidth={2} dot={false} />
                      </AreaChart>
                    ) : (
                      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.15} />
                        <XAxis 
                          dataKey="ts_epoch" 
                          type="number" 
                          scale="time"
                          allowDataOverflow={true}
                          domain={[new Date(timeRange.start).getTime(), new Date(timeRange.end).getTime()]} 
                          tickFormatter={(ep) => {
                            const d = new Date(ep);
                            return `${(d.getMonth()+1)}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                          }}
                          tick={{ fontSize: 10 }} 
                          minTickGap={60} 
                        />
                        <YAxis tick={{ fontSize: 10 }} width={48} domain={domain || ['dataMin - 1', 'dataMax + 1']} unit={` ${unit}`} tickFormatter={(v) => typeof v === 'number' ? v.toFixed(1) : v} />
                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '3 3' }} />
                        <Legend iconType="line" wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey={key} name={label} stroke={color} strokeWidth={2} dot={false} />
                      </LineChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </Card>
            )
          ))}
        </main>
      )}
      {/* ── Broadcast Warning Modal ─────────────────────────────────────── */}
      {isBroadcastOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <header className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-rose-100 dark:bg-rose-900/30 rounded-lg flex items-center justify-center text-rose-600">
                  <AlertTriangle size={18} />
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white text-lg">Broadcast Warning</h3>
              </div>
              <button onClick={() => setIsBroadcastOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <X size={20} />
              </button>
            </header>
            
            <form onSubmit={handleBroadcast} className="p-6 flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Severity</label>
                <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-xl gap-1">
                  {(['info', 'warning', 'critical'] as const).map(s => (
                    <button key={s} type="button" onClick={() => setBroadcastForm(f => ({ ...f, severity: s }))}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold capitalize transition-all ${
                        broadcastForm.severity === s 
                          ? s === 'critical' ? 'bg-rose-600 text-white shadow-lg shadow-rose-500/20' : 
                            s === 'warning' ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' : 
                            'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                          : 'text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Station / Scope</label>
                <select value={broadcastForm.node_id} onChange={e => setBroadcastForm(f => ({ ...f, node_id: e.target.value }))}
                  className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 outline-none text-sm font-medium">
                  <option value="GLOBAL">Network-Wide Broadcast</option>
                  {nodes?.map(n => <option key={n._id} value={n.node_id}>{n.name || n.node_id}</option>)}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Warning Message</label>
                <textarea 
                  required rows={3}
                  value={broadcastForm.message}
                  onChange={e => setBroadcastForm(f => ({ ...f, message: e.target.value }))}
                  placeholder="e.g. Heavy rainfall expected in the next 2 hours. Take precaution."
                  className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 outline-none text-sm resize-none focus:border-blue-500 transition-all"
                ></textarea>
              </div>

              <footer className="flex gap-3 mt-2">
                <Button type="button" variant="outline" className="flex-1 rounded-2xl h-11" onClick={() => setIsBroadcastOpen(false)}>Cancel</Button>
                <Button type="submit" className="flex-1 rounded-2xl h-11 bg-slate-900 dark:bg-white dark:text-slate-950">Post Alert</Button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}


export default App
