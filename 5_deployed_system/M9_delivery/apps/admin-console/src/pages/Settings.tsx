import { Card, Button, Badge } from "@panahon/ui";
import { Settings as SettingsIcon, Database, Terminal, Shield, RefreshCw, Layers } from "lucide-react";

export default function Settings() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h2 className="text-3xl font-bold tracking-tight">System Settings</h2>
        <p className="text-slate-500 mt-1 italic font-medium max-w-xl">Configure administrative parameters and monitor platform-level diagnostic health.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* App Config */}
        <section className="flex flex-col gap-6">
           <Card className="p-6 flex flex-col gap-6 bg-white dark:bg-slate-900 shadow-xl shadow-slate-200/50 dark:shadow-none border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-3">
                 <Shield className="text-blue-600" size={24} />
                 <h3 className="font-bold text-lg">Infrastructure Keys</h3>
              </div>
              <div className="grid grid-cols-1 gap-4">
                 <div className="flex flex-col gap-1.5 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Convex Project ID</label>
                    <p className="text-xs font-mono text-slate-600 dark:text-slate-400 truncate">{import.meta.env.VITE_CONVEX_URL}</p>
                 </div>
                 <div className="flex flex-col gap-1.5 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Clerk Publishable Key</label>
                    <p className="text-xs font-mono text-slate-600 dark:text-slate-400 truncate tracking-tighter">pk_test_...{import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.slice(-8)}</p>
                 </div>
              </div>
              <Button variant="secondary" className="gap-2 self-start"><Terminal size={14} /> Open Debug Shell</Button>
           </Card>

           <Card className="p-6 flex flex-col gap-6 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-3">
                 <Layers className="text-blue-600" size={24} />
                 <h3 className="font-bold text-lg">Feature Toggles</h3>
              </div>
              <div className="flex flex-col gap-4">
                 <div className="flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-800/20 rounded-xl transition-all">
                    <div>
                       <p className="text-sm font-bold">Maintenance Mode</p>
                       <p className="text-[10px] text-slate-500 italic max-w-[200px]">Disable public site visualization while repairing hardware.</p>
                    </div>
                    <div className="w-10 h-5 bg-slate-200 dark:bg-slate-800 rounded-full relative">
                       <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-all"></div>
                    </div>
                 </div>
                 <div className="flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-800/20 rounded-xl transition-all">
                    <div>
                       <p className="text-sm font-bold">Push Notifications</p>
                       <p className="text-[10px] text-slate-500 italic max-w-[200px]">Send system alerts directly to mobile devices via WebPush.</p>
                    </div>
                    <div className="w-10 h-5 bg-blue-600 rounded-full relative shadow-lg shadow-blue-500/30">
                       <div className="absolute right-1 top-1 w-3 h-3 bg-white rounded-full transition-all"></div>
                    </div>
                 </div>
              </div>
           </Card>
        </section>

        {/* Database Health */}
        <section className="flex flex-col gap-6">
           <Card className="p-6 flex flex-col gap-6 bg-slate-900 text-white shadow-2xl shadow-blue-900/10 border-blue-900/30">
              <div className="flex justify-between items-center">
                 <div className="flex items-center gap-3">
                    <Database className="text-blue-400" size={24} />
                    <h3 className="font-bold text-lg">Persistence Metrics</h3>
                 </div>
                 <Badge variant="success">Operational</Badge>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                 <div className="flex flex-col p-4 bg-slate-800 rounded-2xl">
                    <p className="text-[10px] font-bold uppercase text-slate-500 tracking-widest">Storage Used</p>
                    <p className="text-3xl font-black mt-1">14.2<span className="text-sm font-normal text-slate-500 ml-1">MB</span></p>
                 </div>
                 <div className="flex flex-col p-4 bg-slate-800 rounded-2xl">
                    <p className="text-[10px] font-bold uppercase text-slate-500 tracking-widest">Queries / 24h</p>
                    <p className="text-3xl font-black mt-1">8,421</p>
                 </div>
              </div>

              <div className="flex flex-col gap-1.5 p-4 bg-slate-800 rounded-2xl border border-slate-700">
                 <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">
                    <span>Document Limit</span>
                    <span>84% Capacity</span>
                 </div>
                 <div className="h-2 w-full bg-slate-700 rounded-full overflow-hidden shadow-inner">
                    <div className="h-full w-[84%] bg-gradient-to-r from-blue-600 to-blue-400 shadow-xl shadow-blue-500/50"></div>
                 </div>
              </div>

              <Button variant="outline" className="gap-2 border-blue-900/50 text-blue-400 hover:bg-blue-900/20"><RefreshCw size={14} /> Clear System Cache</Button>
           </Card>

           <div className="p-6 border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-3xl flex flex-col gap-3">
              <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                 <Terminal size={14} /> Diagnostic Logs
              </h4>
              <div className="font-mono text-[10px] text-slate-500 flex flex-col gap-1 italic">
                 <p>[03:22:41] — Authentication handshake verified with Clerk.</p>
                 <p>[03:25:02] — Node Pilot_1 heartbeat received (100% telemetry fidelity).</p>
                 <p>[03:30:15] — Automated backup of Convex 'm6_node_data' completed.</p>
              </div>
           </div>
        </section>
      </div>
    </div>
  );
}
