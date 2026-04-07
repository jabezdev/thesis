import { Card, Button, Stats, Badge } from '@panahon/ui'
import { LayoutDashboard, Radio, Settings, Users, Activity } from 'lucide-react'

function App() {
  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 flex flex-col gap-8">
        <div className="flex items-center gap-2 px-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">P</div>
          <h1 className="text-xl font-bold tracking-tight">Panahon Admin</h1>
        </div>
        
        <nav className="flex flex-col gap-2">
          <Button variant="secondary" className="justify-start gap-3"><LayoutDashboard size={18} /> Overview</Button>
          <Button variant="outline" className="justify-start gap-3 border-transparent"><Radio size={18} /> Node Setup</Button>
          <Button variant="outline" className="justify-start gap-3 border-transparent"><Activity size={18} /> Calibration</Button>
          <Button variant="outline" className="justify-start gap-3 border-transparent"><Users size={18} /> User Access</Button>
          <Button variant="outline" className="justify-start gap-3 border-transparent mt-auto"><Settings size={18} /> Settings</Button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-12">
        <div className="max-w-6xl mx-auto flex flex-col gap-8">
          <header className="flex justify-between items-end">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">System Overview</h2>
              <p className="text-slate-500 mt-1">Manage nodes, calibration, and researcher access.</p>
            </div>
            <Button>Add New Node</Button>
          </header>

          <section className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card><Stats label="Active Nodes" value="1" trend="+0" /></Card>
            <Card><Stats label="Daily Samples" value="1,440" trend="+12%" /></Card>
            <Card><Stats label="Avg Latency" value="2.4" unit="s" /></Card>
            <Card><Stats label="System Health" value="100" unit="%" /></Card>
          </section>

          <section>
            <h3 className="text-xl font-semibold mb-4">Node Inventory</h3>
            <Card className="divide-y divide-slate-100 dark:divide-slate-800">
              <div className="p-4 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/10">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-xl">
                    <Radio size={24} />
                  </div>
                  <div>
                    <h4 className="font-bold">node_1</h4>
                    <p className="text-xs text-slate-500 lowercase">00:1B:44:11:3A:B7</p>
                  </div>
                </div>
                <div className="flex items-center gap-8">
                  <div className="text-right">
                    <p className="text-sm font-medium">Firmware</p>
                    <p className="text-xs text-slate-500">v0.3.5</p>
                  </div>
                  <Badge variant="success">Online</Badge>
                  <Button variant="outline" className="px-3 py-1">Configure</Button>
                </div>
              </div>
            </Card>
          </section>
        </div>
      </main>
    </div>
  )
}

export default App
