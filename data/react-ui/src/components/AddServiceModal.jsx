import { useState } from "react";
import { apiPost } from "../api";

const SERVICE_TYPES = ["http", "https", "ssh", "mysql", "postgresql", "redis", "dns", "ftp", "smtp", "unknown"];

export function AddServiceModal({ devices = [], preselectedMac = "", onClose, onAdded }) {
  const [form, setForm] = useState({
    device_mac: preselectedMac || (devices[0]?.mac || ""),
    port: "",
    proto: "tcp",
    type: "http",
    title: "",
    banner: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    const port = parseInt(form.port);
    if (!form.device_mac) { setErr("Select a device."); return; }
    if (!port || port < 1 || port > 65535) { setErr("Enter a valid port (1–65535)."); return; }
    setSaving(true); setErr("");
    try {
      await apiPost("/services", { json: { ...form, port } });
      onAdded();
      onClose();
    } catch (e) {
      setErr(e.message || "Failed to add service.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b dark:border-gray-700 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 dark:text-white">Add Service</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">✕</button>
        </div>
        <form onSubmit={submit} className="px-6 py-4 space-y-3">

          {/* Device selector */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Device *</label>
            <select value={form.device_mac} onChange={e => set("device_mac", e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— select device —</option>
              {devices.map(d => (
                <option key={d.mac} value={d.mac}>
                  {d.hostname || d.mac} {d.current_ip ? `(${d.current_ip})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Port + proto */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Port *</label>
              <input type="number" min="1" max="65535"
                value={form.port} onChange={e => set("port", e.target.value)}
                placeholder="8080"
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="w-24">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Proto</label>
              <select value={form.proto} onChange={e => set("proto", e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option>tcp</option>
                <option>udp</option>
              </select>
            </div>
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Service Type</label>
            <select value={form.type} onChange={e => set("type", e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              {SERVICE_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Title / Description</label>
            <input value={form.title} onChange={e => set("title", e.target.value)}
              placeholder="My App"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {err && <p className="text-xs text-red-500">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Adding…" : "Add Service"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
