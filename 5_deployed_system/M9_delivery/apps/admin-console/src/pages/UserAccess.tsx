import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Card, Button, Badge } from "@panahon/ui";
import { Users, Shield, MapPin, Pencil, Search, UserCheck, Trash2 } from "lucide-react";
import { useState } from "react";

export default function UserAccess() {
  const users = useQuery(api.users.list);
  const updateRole = useMutation(api.users.updateRole);
  const deleteUser = useMutation(api.users.deleteUser);

  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [role, setRole] = useState<string>("");
  const [region, setRegion] = useState<string>("");
  const [search, setSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<any>(null);

  const filtered = users?.filter((u: any) =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  const handleUpdate = async () => {
    if (!selectedUser) return;
    await updateRole({ userId: selectedUser._id, role: role as any, lgu_region: region || undefined });
    setSelectedUser(null);
  };

  const roleVariant: Record<string, "success" | "info" | "warning"> = {
    admin: "success", lgu: "info", viewer: "warning"
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
          <input
            className="bg-transparent outline-none text-sm placeholder:text-slate-400"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </header>

      <Card className="divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
        {filtered?.map((user: any) => (
          <div key={user._id} className="p-6 flex flex-col md:flex-row justify-between items-center group hover:bg-slate-50 dark:hover:bg-slate-800/10 transition-all">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-700 rounded-full flex items-center justify-center text-white font-bold text-lg shadow">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h4 className="font-bold">{user.name}</h4>
                <p className="text-xs text-slate-500">{user.email}</p>
              </div>
            </div>

            <div className="flex items-center gap-8 mt-6 md:mt-0">
              <div className="flex flex-col gap-1 items-end">
                <div className="flex items-center gap-2">
                  <Shield size={14} className="text-blue-500" />
                  <Badge variant={roleVariant[user.role] ?? "info"}>{user.role}</Badge>
                </div>
                {user.lgu_region && (
                  <p className="text-[10px] uppercase tracking-widest text-slate-400 flex items-center gap-1">
                    <MapPin size={10} /> {user.lgu_region}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setSelectedUser(user); setRole(user.role); setRegion(user.lgu_region || ""); }} className="gap-2">
                  <Pencil size={15} /> Edit Role
                </Button>
                <Button variant="secondary" onClick={() => setDeleteConfirm(user)} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/10">
                  <Trash2 size={16} />
                </Button>
              </div>
            </div>
          </div>
        ))}
        {filtered?.length === 0 && (
          <div className="p-10 text-center text-sm italic text-slate-400 flex flex-col items-center gap-2">
            <Users size={32} className="opacity-20" />
            {search ? `No users matching "${search}"` : "No users registered yet."}
          </div>
        )}
      </Card>

      {/* Edit Role Modal */}
      {selectedUser && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-6">
          <Card className="max-w-md w-full p-8 shadow-2xl animate-in zoom-in-95 duration-300 border-slate-800 dark:bg-slate-900">
            <UserCheck className="text-blue-600 mb-4" size={32} />
            <h3 className="text-2xl font-bold mb-1">Permissions Override</h3>
            <p className="text-slate-500 text-sm mb-6">Modifying access for <b>{selectedUser.name}</b></p>
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Assign Role</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['admin', 'lgu', 'viewer'] as const).map(r => (
                    <button key={r} type="button" onClick={() => setRole(r)}
                      className={`px-3 py-2 rounded-lg text-xs font-bold uppercase transition-all ${role === r ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              {role === 'lgu' && (
                <div className="flex flex-col gap-2">
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
              <div className="flex gap-3 mt-2">
                <Button variant="outline" className="flex-1" onClick={() => setSelectedUser(null)}>Cancel</Button>
                <Button className="flex-1" onClick={handleUpdate}>Apply Changes</Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-6">
          <Card className="max-w-sm w-full p-8 shadow-2xl animate-in zoom-in-95 duration-200 dark:bg-slate-900 border-slate-800">
            <Trash2 size={32} className="text-rose-500 mb-4" />
            <h3 className="text-xl font-bold mb-2">Remove User?</h3>
            <p className="text-slate-500 text-sm mb-6">
              This will remove <b>{deleteConfirm.name}</b> ({deleteConfirm.email}) from the system. They can re-register by signing in again.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button className="flex-1 bg-rose-600 hover:bg-rose-700"
                onClick={async () => { await deleteUser({ userId: deleteConfirm._id }); setDeleteConfirm(null); }}>
                Remove
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
