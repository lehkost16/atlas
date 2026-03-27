import { useState } from "react";
import { apiPost } from "../api";

export function AddDeviceModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ hostname: "", current_ip: "", tags: "", os_details: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [scanMsg, setScanMsg] = useState("");

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.current_ip) { setErr("IP 地址为必填项。"); return; }
    if (!form.hostname)   { setErr("主机名为必填项。"); return; }
    setSaving(true); setErr(""); setScanMsg("");
    try {
      const res = await apiPost("/devices", { json: form });
      setScanMsg("设备已添加，正在后台扫描服务，请稍后刷新…");
      setTimeout(() => { onAdded(); onClose(); }, 1500);
    } catch (e) {
      setErr(e.message || "添加失败，请重试。");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b dark:border-gray-700 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 dark:text-white">添加设备</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">✕</button>
        </div>

        <form onSubmit={submit} className="px-6 py-4 space-y-3">
          {/* IP — required */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              IP 地址 <span className="text-red-500">*</span>
            </label>
            <input
              value={form.current_ip}
              onChange={e => set("current_ip", e.target.value)}
              placeholder="192.168.1.100"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Hostname — required */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              主机名 <span className="text-red-500">*</span>
            </label>
            <input
              value={form.hostname}
              onChange={e => set("hostname", e.target.value)}
              placeholder="my-server"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Tags — optional */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">标签（可选）</label>
            <input
              value={form.tags}
              onChange={e => set("tags", e.target.value)}
              placeholder="生产, 服务器"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* OS — optional */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">操作系统（可选）</label>
            <input
              value={form.os_details}
              onChange={e => set("os_details", e.target.value)}
              placeholder="Ubuntu 22.04"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {err && <p className="text-xs text-red-500">{err}</p>}
          {scanMsg && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              {scanMsg}
            </p>
          )}

          <p className="text-xs text-gray-400 dark:text-gray-600">
            MAC 地址将自动生成，添加后系统会立即扫描该 IP 上的服务。
          </p>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
              取消
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {saving ? "添加中…" : "确认添加"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
