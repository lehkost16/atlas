import { useState, useEffect } from "react";
import { apiGet, apiPut, apiDelete } from "../api";

const DEFAULT_PORTS = [21, 22, 23, 25, 53, 80, 443, 3000, 3306, 5173, 5432, 6379, 8080, 8443, 8888, 9090];

export function PortConfigModal({ onClose }) {
  const [ports, setPorts] = useState([]);
  const [source, setSource] = useState("default");
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    apiGet("/config/service-ports")
      .then(d => { setPorts(d.ports || []); setSource(d.source || "default"); })
      .catch(() => setPorts(DEFAULT_PORTS));
  }, []);

  const addPort = () => {
    const nums = input.split(/[,\s]+/).map(s => parseInt(s.trim())).filter(n => n > 0 && n <= 65535);
    if (!nums.length) { setErr("请输入有效端口号（1-65535）"); return; }
    setPorts(prev => Array.from(new Set([...prev, ...nums])).sort((a, b) => a - b));
    setInput(""); setErr("");
  };

  const removePort = (p) => setPorts(prev => prev.filter(x => x !== p));

  const save = async () => {
    setSaving(true); setErr(""); setMsg("");
    try {
      await apiPut("/config/service-ports", { json: { ports } });
      setSource("custom");
      setMsg("已保存，下次扫描生效");
    } catch (e) { setErr(e.message || "保存失败"); }
    setSaving(false);
  };

  const reset = async () => {
    setSaving(true);
    try {
      const d = await apiDelete("/config/service-ports");
      setPorts(d.ports || DEFAULT_PORTS);
      setSource("default");
      setMsg("已恢复默认端口");
    } catch (e) { setErr(e.message || "重置失败"); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b dark:border-gray-700 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white">扫描端口配置</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              {source === "custom" ? "当前使用自定义端口" : "当前使用默认端口"}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl">✕</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* 添加端口 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              添加端口（支持逗号分隔多个）
            </label>
            <div className="flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addPort()}
                placeholder="如：8080, 9000, 3000"
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button onClick={addPort}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700">
                添加
              </button>
            </div>
            {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
          </div>

          {/* 端口列表 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                当前端口列表（{ports.length} 个）
              </span>
              <button onClick={reset} disabled={saving}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 underline">
                恢复默认
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-700">
              {ports.map(p => (
                <span key={p}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-xs font-mono text-gray-700 dark:text-gray-300 shadow-sm">
                  {p}
                  <button onClick={() => removePort(p)}
                    className="text-gray-300 hover:text-red-500 leading-none ml-0.5">✕</button>
                </span>
              ))}
              {ports.length === 0 && (
                <span className="text-xs text-gray-400 italic">暂无端口</span>
              )}
            </div>
          </div>

          {msg && <p className="text-xs text-emerald-600 dark:text-emerald-400">{msg}</p>}
        </div>

        <div className="px-6 py-4 border-t dark:border-gray-700 flex gap-2 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
            关闭
          </button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {saving ? "保存中…" : "保存配置"}
          </button>
        </div>
      </div>
    </div>
  );
}
