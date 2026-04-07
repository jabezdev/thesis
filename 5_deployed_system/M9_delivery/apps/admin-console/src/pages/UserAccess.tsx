import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Card, Button, Badge } from "@panahon/ui";
import { Users, Shield, MapPin, Edit, Search, UserCheck } from "lucide-react";
import { useState } from "react";

export default function UserAccess() {
  const users = useQuery(api.users.list);
  const updateRole = useMutation(api.users.updateRole);

  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [role, setRole] = useState<string>("");
  const [region, setRegion] = useState<string>("");

  const handleUpdate = async () => {
    if (!selectedUser) return;
    try {
      await updateRole({ 
        userId: selectedUser._id, 
        role: role as any, 
        lgu_region: region || undefined 
      });
      setSelectedUser(null);
    } catch (err) {
      console.error(err);
      alert("Failed to update user role.");
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <header className="flex justify-between items-end">
        <div>
           <h2 className="text-3xl font-bold tracking-tight">Access Governance</h2>
           <p className="text-slate-500 mt-1">Control researcher and LGU official access permissions.</p>
        </div>
        <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 shadow-sm">
           <Search size={18} className="text-slate-400" />
           <input className="bg-transparent outline-none text-sm placeholder:text-slate-400" placeholder="Search by email..." />
        </div>
      </header>

      <Card className="divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
         {users?.map(user => (
           <div key={user._id} className="p-6 flex flex-col md:flex-row justify-between items-center group transition-all hover:bg-slate-50 dark:hover:bg-slate-800/10">
              <div className="flex items-center gap-4">
                 <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-500 font-bold border border-slate-200 dark:border-slate-700">
                    {user.name.charAt(0)}
                 </div>
                 <div className="flex flex-col">
                    <h4 className="font-bold">{user.name}</h4>
                    <p className="text-xs text-slate-500">{user.email}</p>
                 </div>
              </div>

              <div className="flex items-center gap-12 mt-6 md:mt-0">
                 <div className="flex flex-col gap-1 items-end min-w-[120px]">
                    <div className="flex items-center gap-2">
                       <Shield size={14} className="text-blue-500" />
                       <Badge variant={user.role === 'admin' ? 'success' : 'info'}>{user.role}</Badge>
                    </div>
                    {user.lgu_region && (
                       <p className="text-[10px] uppercase tracking-widest text-slate-400 flex items-center gap-1">
                          <MapPin size={10} /> {user.lgu_region}
                       </p>
                    )}
                 </div>
                 <Button 
                   variant="outline" 
                   onClick={() => {
                     setSelectedUser(user);
                     setRole(user.role);
                     setRegion(user.lgu_region || "");
                   }}
                   className="gap-2"
                 >
                    <Edit size={16} /> Edit Role
                 </Button>
              </div>
           </div>
         ))}
      </Card>

      {/* Edit Role Modal */}
      {selectedUser && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-6 transition-all duration-300">
           <Card className="max-w-md w-full p-8 shadow-2xl animate-in zoom-in-95 duration-300 border-slate-800">
              <header className="mb-6 flex flex-col gap-2">
                 <UserCheck className="text-blue-600 mb-2" size={32} />
                 <h3 className="text-2xl font-bold">Permissions Override</h3>
                 <p className="text-slate-500 text-sm">Modifying access for <b>{selectedUser.name}</b></p>
              </header>

              <div className="flex flex-col gap-6">
                 <div className="flex flex-col gap-2">
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Assign Role</label>
                    <div className="grid grid-cols-3 gap-2">
                       {['admin', 'lgu', 'viewer'].map(r => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setRole(r)}
                            className={`px-3 py-2 rounded-lg text-xs font-bold uppercase transition-all ${
                              role === r 
                               ? 'bg-blue-600 text-white shadow-lg' 
                               : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                            }`}
                          >
                             {r}
                          </button>
                       ))}
                    </div>
                 </div>

                 {role === 'lgu' && (
                    <div className="flex flex-col gap-2 animate-in slide-in-from-top-2">
                       <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Target Region / District</label>
                       <input 
                         className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 outline-none focus:border-blue-500 transition-all text-sm"
                         placeholder="e.g. Baguio, District 1"
                         value={region}
                         onChange={(e) => setRegion(e.target.value)}
                       />
                       <p className="text-[10px] text-slate-400 italic">LGUs only see sensors within their assigned region.</p>
                    </div>
                 )}

                 <div className="flex gap-3 mt-4">
                    <Button variant="outline" className="flex-1" onClick={() => setSelectedUser(null)}>Cancel</Button>
                    <Button className="flex-1" onClick={handleUpdate}>Apply Changes</Button>
                 </div>
              </div>
           </Card>
        </div>
      )}
    </div>
  );
}
