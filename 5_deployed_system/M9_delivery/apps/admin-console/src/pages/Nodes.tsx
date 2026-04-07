import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Card, Button, Badge } from "@panahon/ui";
import { Radio, Plus, MapPin, Cpu, Calendar, Pencil, Trash2, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";

type NodeForm = {
  node_id: string;
  mac_address: string;
  name: string;
  location: { lat: number; lng: number; description: string };
};

const emptyForm: NodeForm = {
  node_id: "", mac_address: "", name: "",
  location: { lat: 16.4023, lng: 120.596, description: "" },
};

export default function Nodes() {
  const nodes = useQuery(api.nodes.list);
  const createNode = useMutation(api.nodes.create);
  const updateNode = useMutation(api.nodes.updateNode);
  const updateStatus = useMutation(api.nodes.updateStatus);
  const deleteNode = useMutation(api.nodes.deleteNode);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editNode, setEditNode] = useState<(typeof nodes)[0] | null>(null);
  const [form, setForm] = useState<NodeForm>(emptyForm);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const openAdd = () => { setForm(emptyForm); setIsAddOpen(true); };
  const openEdit = (node: NonNullable<typeof nodes>[0]) => {
    setForm({ node_id: node.node_id, mac_address: node.mac_address, name: node.name, location: { ...node.location } });
    setEditNode(node);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await createNode(form);
    setIsAddOpen(false);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editNode) return;
    await updateNode({ nodeId: editNode._id, name: form.name, mac_address: form.mac_address, location: form.location });
    setEditNode(null);
  };

  const handleDelete = async (nodeId: string) => {
    await deleteNode({ nodeId: nodeId as any });
    setDeleteConfirm(null);
  };

  const field = (label: string, value: string, onChange: (v: string) => void, placeholder = "", required = false) => (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-bold text-slate-700 dark:text-slate-300">{label}</label>
      <input
        required={required}
        className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 outline-none focus:border-blue-500 transition-all text-sm"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );

  const NodeForm = ({ onSubmit, submitLabel }: { onSubmit: (e: React.FormEvent) => Promise<void>; submitLabel: string }) => (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4">
        {field("Node ID", form.node_id, (v) => setForm({ ...form, node_id: v }), "node_2", true)}
        {field("Display Name", form.name, (v) => setForm({ ...form, name: v }), "Summit Station", true)}
      </div>
      {field("MAC Address", form.mac_address, (v) => setForm({ ...form, mac_address: v }), "AA:BB:CC:DD:EE:FF", true)}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Location Description</label>
        <textarea
          required rows={2}
          className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 outline-none focus:border-blue-500 transition-all text-sm resize-none"
          placeholder="e.g. Mount Sto. Tomas Southern Slope"
          value={form.location.description}
          onChange={(e) => setForm({ ...form, location: { ...form.location, description: e.target.value } })}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Latitude</label>
          <input type="number" step="any"
            className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 outline-none focus:border-blue-500 transition-all text-sm"
            value={form.location.lat}
            onChange={(e) => setForm({ ...form, location: { ...form.location, lat: parseFloat(e.target.value) } })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Longitude</label>
          <input type="number" step="any"
            className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 outline-none focus:border-blue-500 transition-all text-sm"
            value={form.location.lng}
            onChange={(e) => setForm({ ...form, location: { ...form.location, lng: parseFloat(e.target.value) } })}
          />
        </div>
      </div>
      <div className="flex gap-3 mt-2">
        <Button type="button" variant="outline" className="flex-1"
          onClick={() => { setIsAddOpen(false); setEditNode(null); }}>Cancel</Button>
        <Button type="submit" className="flex-1">{submitLabel}</Button>
      </div>
    </form>
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Node Inventory</h2>
          <p className="text-slate-500 mt-1">Manage physical sensor hardware across the Panahon network.</p>
        </div>
        <Button onClick={openAdd} className="gap-2"><Plus size={18} /> Add New Node</Button>
      </header>

      <div className="grid grid-cols-1 gap-4">
        {nodes?.map((node) => (
          <Card key={node._id} className="p-6 flex flex-col md:flex-row justify-between items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl hover:shadow-xl hover:shadow-slate-200/50 dark:hover:shadow-none transition-all group overflow-hidden relative">
            <div className="absolute top-0 left-0 w-1 h-full bg-blue-600 opacity-0 group-hover:opacity-100 transition-all" />
            <div className="flex items-center gap-6">
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 text-blue-600 rounded-2xl"><Radio size={32} /></div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-3">
                  <h4 className="font-bold text-xl">{node.name || node.node_id}</h4>
                  <span className="text-xs text-slate-400 font-mono">{node.node_id}</span>
                  <Badge variant={node.status === "active" ? "success" : node.status === "maintenance" ? "warning" : "error"}>{node.status}</Badge>
                </div>
                <p className="text-sm font-medium text-slate-500 flex items-center gap-2"><Cpu size={14} /> {node.mac_address}</p>
                <p className="text-sm text-slate-400 flex items-center gap-2"><MapPin size={14} /> {node.location.description || "No description"}</p>
              </div>
            </div>

            <div className="flex items-center gap-4 mt-6 md:mt-0">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Deployed</p>
                <p className="text-sm font-medium flex items-center justify-end gap-2 text-slate-600 dark:text-slate-300">
                  <Calendar size={14} /> {new Date(node.installed_at).toLocaleDateString()}
                </p>
              </div>
              <Button variant="outline" className="gap-2" onClick={() => openEdit(node)}><Pencil size={15} /> Edit</Button>

              {/* Status / Delete dropdown */}
              <div className="relative" ref={menuOpen === node._id ? menuRef : undefined}>
                <Button variant="secondary" className="p-2" onClick={() => setMenuOpen(menuOpen === node._id ? null : node._id)}>
                  <ChevronDown size={18} />
                </Button>
                {menuOpen === node._id && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 overflow-hidden">
                    {(["active", "maintenance", "offline"] as const).filter(s => s !== node.status).map(s => (
                      <button key={s} onClick={() => { updateStatus({ nodeId: node._id, status: s }); setMenuOpen(null); }}
                        className="w-full text-left px-4 py-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 font-medium capitalize">
                        Set {s}
                      </button>
                    ))}
                    <div className="h-px bg-slate-100 dark:bg-slate-800" />
                    <button onClick={() => { setDeleteConfirm(node._id); setMenuOpen(null); }}
                      className="w-full text-left px-4 py-3 text-sm text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/10 font-medium flex items-center gap-2">
                      <Trash2 size={14} /> Delete Node
                    </button>
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}
        {nodes?.length === 0 && (
          <div className="h-48 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-slate-400 gap-2">
            <Radio size={32} className="opacity-30" />
            <p className="text-sm italic">No nodes registered. Add the first one.</p>
          </div>
        )}
      </div>

      {/* Add Node Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-6">
          <Card className="max-w-xl w-full p-8 shadow-2xl animate-in fade-in zoom-in duration-300 dark:bg-slate-900 border-slate-700">
            <h3 className="text-2xl font-bold mb-1">Register New Node</h3>
            <p className="text-slate-500 text-sm mb-6">Assign unique IDs and physical locations for new deployments.</p>
            <NodeForm onSubmit={handleAdd} submitLabel="Register Node" />
          </Card>
        </div>
      )}

      {/* Edit Node Modal */}
      {editNode && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-6">
          <Card className="max-w-xl w-full p-8 shadow-2xl animate-in fade-in zoom-in duration-300 dark:bg-slate-900 border-slate-700">
            <h3 className="text-2xl font-bold mb-1">Edit Node</h3>
            <p className="text-slate-500 text-sm mb-6">Updating <b>{editNode.node_id}</b></p>
            <NodeForm onSubmit={handleEdit} submitLabel="Save Changes" />
          </Card>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-6">
          <Card className="max-w-sm w-full p-8 shadow-2xl animate-in fade-in zoom-in duration-200 dark:bg-slate-900 border-slate-700">
            <Trash2 size={32} className="text-rose-500 mb-4" />
            <h3 className="text-xl font-bold mb-2">Delete Node?</h3>
            <p className="text-slate-500 text-sm mb-6">This is irreversible. All associated calibration data will be lost.</p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button className="flex-1 bg-rose-600 hover:bg-rose-700" onClick={() => handleDelete(deleteConfirm)}>Delete</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
