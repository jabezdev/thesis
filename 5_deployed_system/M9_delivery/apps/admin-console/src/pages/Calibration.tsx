import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Card, Button, Badge } from "@panahon/ui";
import { Sliders, Save, RefreshCcw, Info, Activity } from "lucide-react";
import { useState, useEffect } from "react";
import { ref, onValue } from "firebase/database";
import { rtdb } from "../firebase";
import { applyCalibration, type RawSensorData } from "@panahon/shared";

export default function Calibration() {
  const nodes = useQuery(api.nodes.list);
  const updateCalibration = useMutation(api.nodes.updateCalibration);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [calValues, setCalValues] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [liveRaw, setLiveRaw] = useState<RawSensorData | null>(null);

  const selectedNode = nodes?.find(n => n._id === selectedNodeId);

  useEffect(() => {
    if (selectedNode) {
      setCalValues(selectedNode.calibration);
    }
  }, [selectedNode]);

  // Subscribe to live sensor data for the selected node
  useEffect(() => {
    if (!selectedNode) { setLiveRaw(null); return; }
    const unsub = onValue(ref(rtdb, `nodes/${selectedNode.node_id}/latest`), snap => {
      if (snap.exists()) setLiveRaw(snap.val());
    });
    return () => unsub();
  }, [selectedNode?.node_id]);

  const livePreview = liveRaw && calValues ? applyCalibration(liveRaw, calValues) : null;

  const handleSave = async () => {
    if (!selectedNodeId || !calValues) return;
    const invalid = Object.entries(calValues).filter(([, v]) => !Number.isFinite(v as number));
    if (invalid.length > 0) {
      alert(`Invalid value for: ${invalid.map(([k]) => k).join(", ")}. All fields must be filled with valid numbers.`);
      return;
    }
    setIsSaving(true);
    try {
      await updateCalibration({ nodeId: selectedNodeId as any, calibration: calValues });
      alert("Calibration saved successfully!");
    } catch (err) {
      console.error(err);
      alert("Failed to save calibration.");
    } finally {
      setIsSaving(false);
    }
  };

  const sensors = [
    { key: "temp", label: "Temperature", unit: "°C" },
    { key: "hum", label: "Humidity", unit: "%" },
    { key: "rain", label: "Rainfall", unit: "mm/hr", excludeOffset: true },
    { key: "batt_v", label: "Battery Voltage", unit: "V", excludeScalar: true },
    { key: "solar_v", label: "Solar Voltage", unit: "V", excludeScalar: true },
  ];

  const previewRows = livePreview ? [
    { label: "Temperature", raw: liveRaw!.temp.toFixed(2), corrected: livePreview.temp_corrected.toFixed(2), unit: "°C" },
    { label: "Humidity",    raw: liveRaw!.hum.toFixed(2),  corrected: livePreview.hum_corrected.toFixed(2),  unit: "%" },
    { label: "Rainfall",   raw: liveRaw!.rain.toFixed(2), corrected: livePreview.rain_corrected.toFixed(2), unit: "mm/hr" },
    { label: "Battery",    raw: liveRaw!.batt_v.toFixed(3), corrected: livePreview.batt_v_corrected.toFixed(3), unit: "V" },
    { label: "Solar",      raw: liveRaw!.solar_v.toFixed(3), corrected: livePreview.solar_v_corrected.toFixed(3), unit: "V" },
  ] : [];

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h2 className="text-3xl font-bold tracking-tight text-slate-800 dark:text-slate-100 italic">Core Calibration</h2>
        <p className="text-slate-500 mt-1 max-w-2xl">Adjust scientific coefficients to correct sensor drift. All corrections are applied dynamically during visualization (Projected Raw is maintained).</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Node Selector */}
        <div className="lg:col-span-4 flex flex-col gap-3">
           <h4 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-2">Select Target Hardware</h4>
           {nodes?.map(node => (
             <button
               key={node._id}
               onClick={() => setSelectedNodeId(node._id)}
               className={`p-5 rounded-2xl flex flex-col gap-1 border transition-all text-left ${
                 selectedNodeId === node._id
                  ? "bg-blue-600 border-blue-600 text-white shadow-xl shadow-blue-500/20"
                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-blue-400"
               }`}
             >
               <div className="flex justify-between items-center w-full">
                  <span className="font-bold text-lg">{node.node_id}</span>
                  <Badge variant={selectedNodeId === node._id ? "info" : "info" as any}>{node.status}</Badge>
               </div>
               <span className={`text-xs ${selectedNodeId === node._id ? "text-blue-100" : "text-slate-400"}`}>
                  Last Maintenance: {new Date(node.last_maintained_at).toLocaleDateString()}
               </span>
             </button>
           ))}
        </div>

        {/* Calibration Controls + Live Preview */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {selectedNodeId && calValues ? (
            <>
              {/* Live Preview Panel */}
              <Card className="p-6 flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <Activity size={18} className={liveRaw ? "text-emerald-500 animate-pulse" : "text-slate-400"} />
                  <h4 className="font-bold text-slate-700 dark:text-slate-200">Live Reading Preview</h4>
                  {liveRaw
                    ? <span className="ml-auto text-[10px] font-bold uppercase tracking-widest text-emerald-500">Live</span>
                    : <span className="ml-auto text-[10px] font-bold uppercase tracking-widest text-slate-400">Waiting for data…</span>
                  }
                </div>
                {livePreview ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          <th className="text-left pb-2">Sensor</th>
                          <th className="text-right pb-2">Raw</th>
                          <th className="text-right pb-2">Corrected</th>
                          <th className="text-right pb-2">Delta</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {previewRows.map(row => {
                          const delta = parseFloat(row.corrected) - parseFloat(row.raw);
                          const deltaStr = (delta >= 0 ? "+" : "") + delta.toFixed(3);
                          const deltaColor = Math.abs(delta) < 0.001 ? "text-slate-400" : delta > 0 ? "text-blue-500" : "text-rose-500";
                          return (
                            <tr key={row.label}>
                              <td className="py-2 font-medium text-slate-600 dark:text-slate-400">{row.label}</td>
                              <td className="py-2 text-right font-mono text-slate-500">{row.raw} <span className="text-slate-300 text-xs">{row.unit}</span></td>
                              <td className="py-2 text-right font-mono font-bold text-slate-800 dark:text-slate-100">{row.corrected} <span className="text-slate-300 text-xs">{row.unit}</span></td>
                              <td className={`py-2 text-right font-mono text-xs font-bold ${deltaColor}`}>{deltaStr}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 text-center py-4">No live data available for {selectedNode?.node_id}.</p>
                )}
              </Card>

              {/* Coefficient Editor */}
              <Card className="p-8 flex flex-col gap-6 animate-in slide-in-from-right-4 duration-300">
                <div className="flex justify-between items-center pb-4 border-b border-slate-100 dark:border-slate-800">
                   <div className="flex items-center gap-3">
                      <Sliders className="text-blue-600" size={24} />
                      <div>
                         <h3 className="text-xl font-bold">Correction Matrix: {selectedNode?.node_id}</h3>
                         <p className="text-xs text-slate-400 font-medium">Applied Equation: <span className="text-blue-600 font-bold italic">y = (x * scalar) + offset</span></p>
                      </div>
                   </div>
                   <Button onClick={handleSave} disabled={isSaving} className="gap-2 px-6">
                      <Save size={18} />
                      {isSaving ? "Saving..." : "Save Configuration"}
                   </Button>
                </div>

                <div className="grid grid-cols-1 gap-8 py-4">
                   {sensors.map(sensor => (
                     <div key={sensor.key} className="flex flex-col gap-4 group">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-700 dark:text-slate-300">{sensor.label}</span>
                          <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800"></div>
                          <span className="text-xs font-bold text-slate-400">{sensor.unit}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-6">
                           {!sensor.excludeOffset && (
                             <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase text-slate-400">Offset Addition</label>
                                <div className="relative">
                                   <input
                                     type="number" step="0.001"
                                     className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 outline-none focus:border-blue-500 transition-all font-mono"
                                     value={calValues[`${sensor.key}_offset`]}
                                     onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setCalValues({...calValues, [`${sensor.key}_offset`]: v}); }}
                                   />
                                   <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none">+</div>
                                </div>
                             </div>
                           )}
                           {!sensor.excludeScalar && (
                              <div className="flex flex-col gap-1.5">
                                 <label className="text-[10px] font-bold uppercase text-slate-400">Scaling Coefficient</label>
                                 <div className="relative">
                                    <input
                                      type="number" step="0.001"
                                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 outline-none focus:border-blue-500 transition-all font-mono"
                                      value={calValues[`${sensor.key}_scalar`]}
                                      onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setCalValues({...calValues, [`${sensor.key}_scalar`]: v}); }}
                                    />
                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none">×</div>
                                 </div>
                              </div>
                           )}
                        </div>
                     </div>
                   ))}
                </div>

                <div className="p-4 bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 rounded-xl flex gap-3 text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                   <Info size={18} className="shrink-0" />
                   <p><b>Note:</b> These values are sensitive. Incorrect calibration will cause inaccurate DRRM reporting on the LGU dashboard and public site.</p>
                </div>

                <div className="flex justify-end gap-2">
                   <Button variant="outline" onClick={() => setCalValues(selectedNode?.calibration)} className="gap-2">
                      <RefreshCcw size={16} /> Reset
                   </Button>
                </div>
              </Card>
            </>
          ) : (
            <div className="h-full flex items-center justify-center p-20 border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-3xl text-center">
               <div className="flex flex-col items-center gap-4 text-slate-400">
                  <Sliders size={48} className="opacity-20" />
                  <p>Select a node from the left to begin scientific calibration.</p>
               </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
