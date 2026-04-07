import { useState, useEffect, useRef, useCallback } from 'react'
import { Card, Stats, Badge, Button } from '@panahon/ui'
import { UserButton } from '@clerk/clerk-react'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { ref, onValue } from 'firebase/database'
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore'
import { rtdb, db } from './firebase'
import {
  applyCalibration, DEFAULT_CALIBRATION,
  type RawSensorData, type ProcessedData, type NodeCalibration,
} from '@panahon/shared'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, Tooltip, YAxis,
  LineChart, Line, CartesianGrid,
} from 'recharts'
import {
  CloudRain, Thermometer, Droplets, AlertTriangle, History,
  Sun, Moon, Download, Radio, Map as MapIcon, X, CheckCircle2,
} from 'lucide-react'

type HistoryPoint = ProcessedData & { timeLabel: string }

function App() {
  // ── Dark mode ────────────────────────────────────────────────────────
  const [darkMode, setDarkMode] = useState(() => {
    const s = localStorage.getItem('panahon-dark')
    return s !== null ? s === 'true' : window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    localStorage.setItem('panahon-dark', String(darkMode))
  }, [darkMode])

  // ── Convex data ──────────────────────────────────────────────────────
  const nodes = useQuery(api.nodes.list)
  const allAlerts = useQuery(api.alerts.list)
  const activeAlerts = allAlerts?.filter(a => !a.resolved) ?? []

  // ── Node selection ───────────────────────────────────────────────────
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  useEffect(() => {
    if (nodes && nodes.length > 0 && !selectedNodeId) {
      setSelectedNodeId(nodes[0].node_id)
    }
  }, [nodes, selectedNodeId])
  const selectedNode = nodes?.find(n => n.node_id === selectedNodeId)

  // Keep calibration in a ref so RTDB listener always has latest value
  // without needing to re-subscribe
  const calRef = useRef<NodeCalibration>(DEFAULT_CALIBRATION)
  calRef.current = selectedNode?.calibration ?? DEFAULT_CALIBRATION

  // ── Live data (RTDB) ─────────────────────────────────────────────────
  const [latestData, setLatestData] = useState<ProcessedData | null>(null)
  const [connectionStatus, setConnectionStatus] = useState('Connecting...')

  useEffect(() => {
    if (!selectedNodeId) return
    setLatestData(null)
    setConnectionStatus('Connecting...')
    const latestRef = ref(rtdb, `nodes/${selectedNodeId}/latest`)
    return onValue(latestRef, (snap) => {
      if (snap.exists()) {
        setLatestData(applyCalibration(snap.val() as RawSensorData, calRef.current))
        setConnectionStatus('Online')
      } else {
        setConnectionStatus('No Data')
      }
    }, () => setConnectionStatus('Error'))
  }, [selectedNodeId])

  // ── Historical data (Firestore) ──────────────────────────────────────
  const [historicalData, setHistoricalData] = useState<HistoryPoint[]>([])

  const fetchHistory = useCallback(async (nodeId: string | null) => {
    if (!nodeId) return
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const q = query(
        collection(db, 'm6_node_data'),
        where('node_id', '==', nodeId),
        where('ts', '>=', yesterday),
        orderBy('ts', 'asc'),
        limit(1440)
      )
      const snap = await getDocs(q)
      setHistoricalData(snap.docs.map(doc => {
        const d = doc.data() as RawSensorData
        const t = new Date(d.ts)
        return {
          ...applyCalibration(d, calRef.current),
          timeLabel: `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}`,
        }
      }))
    } catch (err) {
      console.error('Firestore history error:', err)
    }
  }, [])

  useEffect(() => { fetchHistory(selectedNodeId) }, [selectedNodeId, fetchHistory])

  // ── UI state ─────────────────────────────────────────────────────────
  const [showExport, setShowExport] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // ── CSV Export ───────────────────────────────────────────────────────
  const handleExport = () => {
    if (!historicalData.length) return
    const headers = ['ts', 'temp_corrected', 'hum_corrected', 'rain_corrected', 'batt_v_corrected', 'solar_v_corrected']
    const rows = historicalData.map(d => headers.map(h => (d as any)[h] ?? '').join(','))
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `panahon_${selectedNodeId}_24h.csv`
    a.click()
    setShowExport(false)
  }

  // ── Chart tooltip style ──────────────────────────────────────────────
  const tooltipStyle = {
    contentStyle: { borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0/0.1)', fontSize: 11 },
  }

  const val = (v: number | undefined, fallback = '--') =>
    v !== undefined ? v.toFixed(1) : fallback

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans">

      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md sticky top-0 z-50 px-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-blue-500/20">P</div>
          <div>
            <h1 className="text-lg font-bold tracking-tight leading-none">Panahon <span className="text-blue-600">LGU</span></h1>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 leading-none mt-0.5">DRRM Command Center</p>
          </div>
          {activeAlerts.length > 0 && (
            <span className="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
              {activeAlerts.length} Alert{activeAlerts.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Node selector */}
          {nodes && nodes.length > 0 && (
            <select
              value={selectedNodeId ?? ''}
              onChange={(e) => setSelectedNodeId(e.target.value)}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:border-blue-500 transition-all"
            >
              {nodes.map(n => (
                <option key={n._id} value={n.node_id}>
                  {n.name || n.node_id} ({n.status})
                </option>
              ))}
            </select>
          )}

          {/* Connection status */}
          <div className="text-right hidden md:block">
            {connectionStatus === 'Online' ? (
              <p className="text-xs font-semibold text-emerald-500 flex items-center gap-1.5">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" /> Online
              </p>
            ) : (
              <p className="text-xs font-semibold text-rose-400 flex items-center gap-1.5">
                <span className="w-2 h-2 bg-rose-400 rounded-full" /> {connectionStatus}
              </p>
            )}
          </div>

          <button onClick={() => setShowHistory(true)} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-all">
            <History size={16} /> History
          </button>
          <button onClick={() => setDarkMode(d => !d)} className="w-9 h-9 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-800 transition-all">
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <UserButton afterSignOutUrl="/" appearance={{ elements: { avatarBox: 'w-9 h-9' } }} />
        </div>
      </header>

      {/* ── Main ─────────────────────────────────────────────────────── */}
      <main className="p-6 max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 mt-2">

        {/* Left column */}
        <div className="lg:col-span-4 flex flex-col gap-6">

          {/* Active Alerts */}
          <section>
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2">
              <AlertTriangle size={14} /> Active Alerts
            </h3>
            {activeAlerts.length > 0 ? (
              <div className="flex flex-col gap-3">
                {activeAlerts.slice(0, 5).map(alert => (
                  <Card key={alert._id} className={`p-4 border-l-4 ${alert.severity === 'critical' ? 'border-l-rose-500 bg-rose-50/30 dark:bg-rose-900/10' : 'border-l-amber-500 bg-amber-50/30 dark:bg-amber-900/10'}`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <p className={`font-bold text-sm ${alert.severity === 'critical' ? 'text-rose-700 dark:text-rose-400' : 'text-amber-700 dark:text-amber-400'}`}>
                          {alert.type.replace(/_/g, ' ')} — {alert.node_id}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{alert.message}</p>
                      </div>
                      <Badge variant={alert.severity === 'critical' ? 'error' : 'warning'}>{alert.severity}</Badge>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="p-4 flex items-center gap-3 text-sm text-slate-400">
                <CheckCircle2 size={20} className="text-emerald-500/50" />
                No active alerts
              </Card>
            )}
          </section>

          {/* Stat cards */}
          <section className="grid grid-cols-2 gap-4">
            <Card className="flex flex-col items-center justify-center py-6">
              <CloudRain className="text-blue-500 mb-2" size={28} />
              <Stats label="Rainfall" value={latestData ? latestData.rain_corrected.toFixed(1) : '--'} unit="mm" />
            </Card>
            <Card className="flex flex-col items-center justify-center py-6">
              <Thermometer className="text-orange-500 mb-2" size={28} />
              <Stats label="Temperature" value={latestData ? latestData.temp_corrected.toFixed(1) : '--'} unit="°C" />
            </Card>
            <Card className="flex flex-col items-center justify-center py-6">
              <Droplets className="text-teal-500 mb-2" size={28} />
              <Stats label="Humidity" value={latestData ? latestData.hum_corrected.toFixed(1) : '--'} unit="%" />
            </Card>
            <Card className="flex flex-col items-center justify-center py-6">
              <Radio className="text-emerald-500 mb-2" size={28} />
              <Stats label="Uptime" value={latestData ? (latestData.uptime_ms / 3600000).toFixed(1) : '--'} unit="h" />
            </Card>
          </section>

          {/* Quick Actions */}
          <section>
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-3">Quick Actions</h3>
            <div className="flex flex-col gap-2">
              <button onClick={() => setShowExport(true)}
                className="flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all">
                Export Daily Report <Download size={15} className="text-slate-400" />
              </button>
            </div>
          </section>
        </div>

        {/* Right column */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {/* Map placeholder */}
          <Card className="h-[340px] relative overflow-hidden bg-slate-200 dark:bg-slate-800 flex items-center justify-center border-slate-300 dark:border-slate-700">
            <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#4b5563_1px,transparent_1px)] [background-size:20px_20px]" />
            <div className="text-center z-10">
              <MapIcon size={48} className="text-slate-400 dark:text-slate-600 mx-auto mb-3" />
              <h4 className="text-lg font-bold text-slate-500 dark:text-slate-400">Live Map</h4>
              <p className="text-xs text-slate-400 max-w-xs mx-auto mt-1 italic">MapLibre GL integration planned for next iteration.</p>
            </div>
            {selectedNode && (
              <div className="absolute top-1/3 left-1/3 group cursor-pointer">
                <div className="w-4 h-4 bg-blue-600 rounded-full border-2 border-white shadow-lg animate-ping absolute" />
                <div className="w-4 h-4 bg-blue-600 rounded-full border-2 border-white shadow-lg relative z-10" />
                <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-2 py-1 rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  <p className="text-[10px] font-bold">{selectedNode.name}: {connectionStatus}</p>
                </div>
              </div>
            )}
          </Card>

          {/* Charts — 3 columns */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { label: 'Rainfall (24h)', dataKey: 'rain_corrected', color: '#3b82f6', fill: '#93c5fd', Icon: CloudRain },
              { label: 'Temperature (24h)', dataKey: 'temp_corrected', color: '#f97316', fill: 'none', Icon: Thermometer },
              { label: 'Humidity (24h)', dataKey: 'hum_corrected', color: '#14b8a6', fill: 'none', Icon: Droplets },
            ].map(({ label, dataKey, color, fill, Icon }) => (
              <Card key={dataKey} className="p-5">
                <h4 className="font-bold text-sm mb-3 flex items-center gap-2">
                  <Icon size={16} style={{ color }} /> {label}
                </h4>
                <div className="h-36 w-full">
                  {historicalData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      {fill !== 'none' ? (
                        <AreaChart data={historicalData}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.15} />
                          <XAxis dataKey="timeLabel" tick={{ fontSize: 9 }} minTickGap={40} />
                          <YAxis tick={{ fontSize: 9 }} width={28} />
                          <Tooltip {...tooltipStyle} />
                          <Area type="monotone" dataKey={dataKey} stroke={color} fill={fill} strokeWidth={2} />
                        </AreaChart>
                      ) : (
                        <LineChart data={historicalData}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.15} />
                          <XAxis dataKey="timeLabel" tick={{ fontSize: 9 }} minTickGap={40} />
                          <YAxis tick={{ fontSize: 9 }} width={28} domain={['dataMin - 1', 'dataMax + 1']} />
                          <Tooltip {...tooltipStyle} />
                          <Line type="monotone" dot={false} dataKey={dataKey} stroke={color} strokeWidth={2} />
                        </LineChart>
                      )}
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center">
                      <p className="text-xs text-slate-400 italic">No data for last 24h</p>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      </main>

      {/* ── Export Modal ──────────────────────────────────────────────── */}
      {showExport && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 max-w-sm w-full shadow-2xl flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg">Export CSV</h3>
              <button onClick={() => setShowExport(false)} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
            </div>
            <p className="text-sm text-slate-500">
              Exports last 24h of calibrated data for <b>{selectedNode?.name || selectedNodeId}</b>.
            </p>
            <p className="text-xs text-slate-400 italic">{historicalData.length} records available.</p>
            <div className="flex gap-3 mt-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowExport(false)}>Cancel</Button>
              <Button className="flex-1 gap-2" onClick={handleExport} disabled={!historicalData.length}>
                <Download size={16} /> Download
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── History Drawer ────────────────────────────────────────────── */}
      {showHistory && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[9999] flex items-end md:items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 w-full max-w-2xl shadow-2xl flex flex-col gap-4 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg flex items-center gap-2"><History size={18} /> Historical Data</h3>
              <button onClick={() => setShowHistory(false)} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
            </div>
            <p className="text-sm text-slate-500">Showing last 24h for <b>{selectedNode?.name || selectedNodeId}</b>. Date range picker coming in next iteration.</p>
            <div className="h-48 w-full">
              {historicalData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={historicalData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.15} />
                    <XAxis dataKey="timeLabel" tick={{ fontSize: 9 }} minTickGap={40} />
                    <YAxis tick={{ fontSize: 9 }} width={28} />
                    <Tooltip {...tooltipStyle} />
                    <Area type="monotone" dataKey="rain_corrected" stroke="#3b82f6" fill="#93c5fd" strokeWidth={2} name="Rain (mm)" />
                    <Area type="monotone" dataKey="temp_corrected" stroke="#f97316" fill="none" strokeWidth={2} name="Temp (°C)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-slate-400 italic">No historical data</div>
              )}
            </div>
            <Button className="self-end gap-2" onClick={handleExport} disabled={!historicalData.length}>
              <Download size={15} /> Export as CSV
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
