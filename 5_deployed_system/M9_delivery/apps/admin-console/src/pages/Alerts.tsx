import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Card, Button, Badge } from "@panahon/ui";
import { ShieldAlert, CheckCircle2, History, AlertCircle, Clock, Trash2 } from "lucide-react";

export default function Alerts() {
  const alerts = useQuery(api.alerts.list);
  const resolveAlert = useMutation(api.alerts.resolve);
  const deleteAlert = useMutation(api.alerts.deleteAlert);

  const unresolved = alerts?.filter(a => !a.resolved) || [];
  const resolved = alerts?.filter(a => a.resolved) || [];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex justify-between items-end">
        <div>
           <h2 className="text-3xl font-bold tracking-tight text-slate-800 dark:text-slate-100 italic">Incident Log</h2>
           <p className="text-slate-500 mt-1 max-w-xl">Monitor and acknowledge system-wide anomalies. All interventions are timestamped for DRRM archival purposes.</p>
        </div>
      </header>

      <section className="flex flex-col gap-6">
         <h3 className="text-lg font-bold flex items-center gap-2">
            <AlertCircle size={20} className="text-rose-500" />
            Unresolved Incidents ({unresolved.length})
         </h3>
         {unresolved.length > 0 ? (
           <div className="grid grid-cols-1 gap-4">
              {unresolved.map(alert => (
                 <Card key={alert._id} className="p-6 border-l-4 border-l-rose-500 bg-rose-50/20 dark:bg-rose-900/10 flex flex-col md:flex-row justify-between items-center transition-all shadow-lg shadow-rose-200/20 dark:shadow-none animate-in slide-in-from-top-4 duration-300">
                    <div className="flex items-start gap-4">
                       <div className={`p-3 rounded-xl ${
                          alert.severity === 'critical' ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'
                       }`}>
                          <ShieldAlert size={24} />
                       </div>
                       <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                             <h4 className="font-bold text-lg">{alert.node_id} — {alert.type.replace('_', ' ')}</h4>
                             <Badge variant={alert.severity === 'critical' ? 'error' : 'warning'}>{alert.severity}</Badge>
                          </div>
                          <p className="text-sm text-slate-600 dark:text-slate-400 font-medium">{alert.message}</p>
                          <p className="text-xs text-slate-400 flex items-center gap-1 mt-1">
                             <Clock size={12} /> {new Date(alert.triggered_at).toLocaleString()}
                          </p>
                       </div>
                    </div>
                    <Button onClick={() => resolveAlert({ alertId: alert._id })} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xl shadow-emerald-200/50">
                       <CheckCircle2 size={18} /> Acknowledge & Resolve
                    </Button>
                 </Card>
              ))}
           </div>
         ) : (
           <div className="h-40 flex flex-col items-center justify-center border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-2xl italic text-slate-400 gap-2">
              <CheckCircle2 size={32} className="text-emerald-500/30" />
              There are no unresolved system incidents.
           </div>
         )}
      </section>

      <section className="flex flex-col gap-6 mt-4">
         <h3 className="text-lg font-bold flex items-center gap-2 text-slate-400">
            <History size={20} />
            Resolved History
         </h3>
         <Card className="divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden opacity-60 hover:opacity-100 transition-opacity">
            {resolved.map(alert => (
               <div key={alert._id} className="p-6 flex flex-col md:flex-row justify-between items-center group bg-white dark:bg-slate-900/50">
                  <div className="flex items-center gap-4">
                     <div className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-lg">
                        <CheckCircle2 size={20} />
                     </div>
                     <div className="flex flex-col">
                        <h4 className="font-bold text-slate-600 dark:text-slate-300">{alert.node_id}: {alert.type}</h4>
                        <p className="text-xs text-slate-400">Triggered: {new Date(alert.triggered_at).toLocaleTimeString()} | Resolved: {new Date(alert.resolved_at!).toLocaleTimeString()} </p>
                     </div>
                  </div>
                  <Button variant="secondary" onClick={() => deleteAlert({ alertId: alert._id })} className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/10"><Trash2 size={16} /></Button>
               </div>
            ))}
            {resolved.length === 0 && (
               <div className="p-10 text-center text-xs italic text-slate-400">Historical archive is empty.</div>
            )}
         </Card>
      </section>
    </div>
  );
}
