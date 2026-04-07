import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Card, Stats } from "@panahon/ui";
import { Activity, Radio, ShieldAlert, Cpu } from "lucide-react";

export default function Overview() {
  const nodes = useQuery(api.nodes.list);
  const alerts = useQuery(api.alerts.list);

  const activeNodes = nodes?.filter(n => n.status === "active").length || 0;
  const criticalAlerts = alerts?.filter(a => !a.resolved && a.severity === "critical").length || 0;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h2 className="text-3xl font-bold tracking-tight">System Overview</h2>
        <p className="text-slate-500 mt-1">Real-time health and telemetry metrics for the Panahon network.</p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <div className="p-4 flex items-center gap-4">
             <div className="p-3 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-xl">
                <Radio size={24} />
             </div>
             <Stats label="Connected Nodes" value={nodes?.length || 0} trend={nodes?.length ? "+0" : "--"} />
          </div>
        </Card>
        <Card>
           <div className="p-4 flex items-center gap-4">
             <div className="p-3 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded-xl">
                <Activity size={24} />
             </div>
             <Stats label="Active Now" value={activeNodes} unit="online" />
          </div>
        </Card>
        <Card>
           <div className="p-4 flex items-center gap-4">
             <div className="p-3 bg-rose-100 dark:bg-rose-900/30 text-rose-600 rounded-xl">
                <ShieldAlert size={24} />
             </div>
             <Stats label="Critical Alerts" value={criticalAlerts} trend="unresolved" />
          </div>
        </Card>
        <Card>
           <div className="p-4 flex items-center gap-4">
             <div className="p-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl">
                <Cpu size={24} />
             </div>
             <Stats label="Daily Samples" value="1,440" unit="msg" />
          </div>
        </Card>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
         <Card className="p-6">
            <h3 className="font-bold mb-4 flex items-center gap-2 text-slate-700 dark:text-slate-300">
               <ShieldAlert size={18} className="text-rose-500" />
               Recent Incidents
            </h3>
            {alerts?.filter(a => !a.resolved).slice(0, 3).length ? (
               <div className="flex flex-col gap-3">
                 {alerts.filter(a => !a.resolved).slice(0, 3).map(alert => (
                    <div key={alert._id} className="p-3 border border-slate-100 dark:border-slate-800 rounded-lg flex justify-between items-center text-sm bg-slate-50/50 dark:bg-slate-900/50">
                       <div>
                          <p className="font-bold">{alert.message}</p>
                          <p className="text-xs text-slate-400">{new Date(alert.triggered_at).toLocaleTimeString()}</p>
                       </div>
                       <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          alert.severity === 'critical' ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'
                       }`}>
                          {alert.severity}
                       </span>
                    </div>
                 ))}
               </div>
            ) : (
               <div className="h-32 flex items-center justify-center border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-xl italic text-slate-400 text-sm">
                  No active incidents reported
               </div>
            )}
         </Card>

         <Card className="p-6">
            <h3 className="font-bold mb-4 flex items-center gap-2 text-slate-700 dark:text-slate-300">
               <Activity size={18} className="text-blue-500" />
               Node Performance
            </h3>
            <div className="h-32 flex flex-col justify-center items-center gap-2 italic text-slate-400 text-sm border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-xl">
               <p>Real-time performance graph placeholder</p>
               <p className="text-[10px] uppercase tracking-widest font-bold text-slate-300 dark:text-slate-600">Waiting for data streams</p>
            </div>
         </Card>
      </section>
    </div>
  );
}
