import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Card, Button, Badge } from "@panahon/ui";
import { Radio, Plus, MoreVertical, MapPin, Cpu, Calendar } from "lucide-react";
import { useState } from "react";

export default function Nodes() {
  const nodes = useQuery(api.nodes.list);
  const createNode = useMutation(api.nodes.create);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newNode, setNewNode] = useState({
     node_id: "",
     mac_address: "",
     name: "",
     location: { lat: 16.4023, lng: 120.5960, description: "" }
  });

  const handleAddNode = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createNode(newNode);
      setIsModalOpen(false);
      setNewNode({ node_id: "", mac_address: "", name: "", location: { lat: 16.4023, lng: 120.5960, description: "" } });
    } catch (err) {
      console.error(err);
      alert("Failed to create node. Check logs.");
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Node Inventory</h2>
          <p className="text-slate-500 mt-1">Manage physical sensor hardware across the Panahon network.</p>
        </div>
        <Button onClick={() => setIsModalOpen(true)} className="gap-2">
            <Plus size={18} />
            Add New Node
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-4">
        {nodes?.map((node) => (
          <Card key={node._id} className="p-6 flex flex-col md:flex-row justify-between items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl hover:shadow-xl hover:shadow-slate-200/50 dark:hover:shadow-none transition-all group overflow-hidden relative">
            <div className="absolute top-0 left-0 w-1 h-full bg-blue-600 opacity-0 group-hover:opacity-100 transition-all"></div>
            <div className="flex items-center gap-6">
               <div className="p-4 bg-blue-50 dark:bg-blue-900/20 text-blue-600 rounded-2xl">
                  <Radio size={32} />
               </div>
               <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-3">
                     <h4 className="font-bold text-xl">{node.node_id}</h4>
                     <Badge variant={node.status === "active" ? "success" : "warning"}>{node.status}</Badge>
                  </div>
                  <p className="text-sm font-medium text-slate-500 flex items-center gap-2">
                     <Cpu size={14} /> {node.mac_address}
                  </p>
                  <p className="text-sm text-slate-400 flex items-center gap-2">
                     <MapPin size={14} /> {node.location.description || "No description provided"}
                  </p>
               </div>
            </div>

            <div className="flex items-center gap-12 mt-6 md:mt-0">
               <div className="text-right hidden sm:block">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Deployed On</p>
                  <p className="text-sm font-medium flex items-center justify-end gap-2 text-slate-600 dark:text-slate-300">
                     <Calendar size={14} />
                     {new Date(node.installed_at).toLocaleDateString()}
                  </p>
               </div>
               <div className="flex items-center gap-2">
                  <Button variant="outline" className="px-4">Configure</Button>
                  <Button variant="secondary" className="p-2"><MoreVertical size={18} /></Button>
               </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Add Node Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-6 transition-all duration-300">
          <Card className="max-w-xl w-full p-8 shadow-2xl relative animate-in fade-in zoom-in duration-300 dark:bg-slate-900 border-slate-700">
             <header className="mb-6">
                <h3 className="text-2xl font-bold">Register New Node</h3>
                <p className="text-slate-500 sm:max-w-xs mt-1">Assign unique IDs and physical locations for new deployments.</p>
             </header>
             <form onSubmit={handleAddNode} className="flex flex-col gap-5">
                <div className="grid grid-cols-2 gap-4">
                   <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Node ID</label>
                      <input 
                        required
                        className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 outline-none focus:border-blue-500 transition-all text-sm"
                        placeholder="e.g. node_2"
                        value={newNode.node_id}
                        onChange={(e) => setNewNode({...newNode, node_id: e.target.value})}
                      />
                   </div>
                   <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-bold text-slate-700 dark:text-slate-300">MAC Address</label>
                      <input 
                        required
                        className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 outline-none focus:border-blue-500 transition-all text-sm"
                        placeholder="AA:BB:CC:DD:EE:FF"
                        value={newNode.mac_address}
                        onChange={(e) => setNewNode({...newNode, mac_address: e.target.value})}
                      />
                   </div>
                </div>

                <div className="flex flex-col gap-1.5">
                   <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Location Description</label>
                   <textarea 
                     required
                     rows={3}
                     className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 outline-none focus:border-blue-500 transition-all text-sm resize-none"
                     placeholder="e.g. Mount Sto. Tomas Southern Slope"
                     value={newNode.location.description}
                     onChange={(e) => setNewNode({...newNode, location: {...newNode.location, description: e.target.value}})}
                   />
                </div>

                <div className="grid grid-cols-2 gap-4">
                   <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Latitude</label>
                      <input 
                        type="number" step="any"
                        className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 outline-none focus:border-blue-500 transition-all text-sm"
                        value={newNode.location.lat}
                        onChange={(e) => setNewNode({...newNode, location: {...newNode.location, lat: parseFloat(e.target.value)}})}
                      />
                   </div>
                   <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Longitude</label>
                      <input 
                         type="number" step="any"
                         className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 outline-none focus:border-blue-500 transition-all text-sm"
                         value={newNode.location.lng}
                         onChange={(e) => setNewNode({...newNode, location: {...newNode.location, lng: parseFloat(e.target.value)}})}
                      />
                   </div>
                </div>

                <div className="flex gap-3 mt-4">
                   <Button type="button" variant="outline" className="flex-1" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                   <Button type="submit" className="flex-1">Register Node</Button>
                </div>
             </form>
          </Card>
        </div>
      )}
    </div>
  );
}
