import { NavLink, Outlet } from "react-router-dom";
import { Button } from "@panahon/ui";
import { LayoutDashboard, Radio, Activity, Users, Settings, LogOut, ShieldCheck } from "lucide-react";
import { useClerk, useUser } from "@clerk/clerk-react";

export function Layout() {
  const { signOut } = useClerk();
  const { user } = useUser();

  const navItems = [
    { label: "Overview", icon: <LayoutDashboard size={18} />, to: "/" },
    { label: "Node Setup", icon: <Radio size={18} />, to: "/nodes" },
    { label: "Calibration", icon: <Activity size={18} />, to: "/calibration" },
    { label: "User Access", icon: <Users size={18} />, to: "/users" },
    { label: "Alerts", icon: <ShieldCheck size={18} />, to: "/alerts" },
  ];

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans">
      {/* Sidebar */}
      <aside className="w-72 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 flex flex-col gap-6 shadow-xl shadow-slate-200/50 dark:shadow-none z-50">
        <div className="flex items-center gap-3 px-2 mb-4">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-blue-500/20">P</div>
          <div>
             <h1 className="text-xl font-bold tracking-tight">Panahon</h1>
             <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Admin Console</p>
          </div>
        </div>
        
        <nav className="flex flex-col gap-1.5 flex-1 overflow-y-auto pr-1">
          {navItems.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium ${
                  isActive
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20"
                    : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-white"
                }`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto border-t border-slate-100 dark:border-slate-800 pt-6 flex flex-col gap-4">
          <div className="px-4 flex items-center gap-3">
            <img src={user?.imageUrl} className="w-10 h-10 rounded-full border border-slate-200 dark:border-slate-700" alt="Avatar" />
            <div className="overflow-hidden">
               <p className="text-sm font-bold truncate">{user?.fullName || "Admin User"}</p>
               <p className="text-[10px] text-slate-500 truncate">{user?.primaryEmailAddress?.emailAddress}</p>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all font-medium ${
                  isActive
                    ? "bg-slate-100 dark:bg-slate-800"
                    : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
                }`
              }
            >
              <Settings size={18} /> Settings
            </NavLink>
            <button
              onClick={() => signOut()}
              className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-rose-500 font-medium hover:bg-rose-50 dark:hover:bg-rose-900/10 transition-all text-left"
            >
              <LogOut size={18} /> Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto relative scroll-smooth bg-slate-50 dark:bg-slate-950">
        <div className="max-w-7xl mx-auto p-10 mt-4 h-full">
           <Outlet />
        </div>
      </main>
    </div>
  );
}
