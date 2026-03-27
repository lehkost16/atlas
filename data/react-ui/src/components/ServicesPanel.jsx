import { useEffect, useState, useMemo, useCallback } from "react";
import { apiGet, apiPatch, apiDelete, apiPost } from "../api";
import { AddDeviceModal } from "./AddDeviceModal";
import { AddServiceModal } from "./AddServiceModal";
import { PortConfigModal } from "./PortConfigModal";

// ── 服务类型配置 ──────────────────────────────────────────────────────────────
const SVC = {
  http:       { bg: "bg-blue-500",    text: "text-blue-600 dark:text-blue-400",    label: "HTTP" },
  https:      { bg: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", label: "HTTPS" },
  ssh:        { bg: "bg-amber-500",   text: "text-amber-600 dark:text-amber-400",  label: "SSH" },
  mysql:      { bg: "bg-orange-500",  text: "text-orange-600 dark:text-orange-400",label: "MySQL" },
  postgresql: { bg: "bg-violet-500",  text: "text-violet-600 dark:text-violet-400",label: "PgSQL" },
  redis:      { bg: "bg-red-500",     text: "text-red-600 dark:text-red-400",      label: "Redis" },
  dns:        { bg: "bg-slate-500",   text: "text-slate-600 dark:text-slate-400",  label: "DNS" },
  ftp:        { bg: "bg-pink-500",    text: "text-pink-600 dark:text-pink-400",    label: "FTP" },
  smtp:       { bg: "bg-cyan-500",    text: "text-cyan-600 dark:text-cyan-400",    label: "SMTP" },
  unknown:    { bg: "bg-gray-400",    text: "text-gray-500 dark:text-gray-400",    label: "?" },
};
const svcMeta = t => SVC[t] || SVC.unknown;

// ── Tag 颜色 ──────────────────────────────────────────────────────────────────
const TAG_COLORS = [
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
];
function tagColor(tag) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) & 0xffff;
  return TAG_COLORS[h % TAG_COLORS.length];
}

// ── 服务卡片 ──────────────────────────────────────────────────────────────────
function ServiceTile({ svc, ip, onDelete }) {
  const meta = svcMeta(svc.type);
  const isWeb = svc.type === "http" || svc.type === "https";
  const url = isWeb ? `${svc.type}://${ip}:${svc.port}` : null;
  const [confirm, setConfirm] = useState(false);

  const card = (
    <div className={`group relative rounded-xl border p-3 flex flex-col gap-1.5 transition-all
      ${isWeb
        ? "border-blue-100 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-900/10 hover:shadow-md hover:-translate-y-0.5 cursor-pointer"
        : "border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800/80"
      }`}>

      {/* 标题优先，端口降级 */}
      <div className="flex items-start justify-between gap-1 min-h-[2.5rem]">
        <p className="flex-1 text-sm font-semibold text-gray-800 dark:text-gray-100 leading-snug line-clamp-2"
          title={svc.title || svc.banner || ""}>
          {svc.title || svc.banner || (
            <span className="font-normal text-gray-400 dark:text-gray-500 italic">无标题</span>
          )}
        </p>
        <span className={`shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded-md text-white ${meta.bg}`}>
          {meta.label}
        </span>
      </div>

      {/* 端口 — 次要信息 */}
      <span className={`font-mono text-xs font-medium ${meta.text} opacity-70`}>
        :{svc.port}
      </span>

      {/* 删除按钮 */}
      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10"
        onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
        {confirm ? (
          <div className="flex gap-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border dark:border-gray-700 px-2 py-1">
            <button onClick={() => onDelete(svc.id)}
              className="text-xs text-red-600 hover:text-red-800 font-semibold">删除</button>
            <span className="text-gray-300">|</span>
            <button onClick={() => setConfirm(false)}
              className="text-xs text-gray-400 hover:text-gray-600">取消</button>
          </div>
        ) : (
          <button onClick={() => setConfirm(true)}
            className="w-5 h-5 flex items-center justify-center rounded-full bg-white dark:bg-gray-700 shadow border dark:border-gray-600 text-gray-300 hover:text-red-500 text-xs leading-none">
            ✕
          </button>
        )}
      </div>

      {isWeb && !confirm && (
        <span className="absolute bottom-2 right-2 text-blue-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity">↗</span>
      )}
    </div>
  );

  return url
    ? <a href={url} target="_blank" rel="noopener noreferrer" className="block no-underline">{card}</a>
    : card;
}

// ── 设备卡片 ──────────────────────────────────────────────────────────────────
function DeviceCard({ device, onIgnore, onTagSaved, onAddService, onDelete, onRefreshed, onDeleteService }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasVal, setAliasVal] = useState(device.alias || "");
  const [editingTags, setEditingTags] = useState(false);
  const [tagsVal, setTagsVal] = useState(device.tags || "");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const isOnline = device.online_status === "online";
  const openServices = (device.services || []).filter(s => s.status === "open");
  const tags = device.tags ? device.tags.split(",").map(t => t.trim()).filter(Boolean) : [];
  const displayName = device.alias || device.hostname || device.mac;

  const saveAlias = async () => {
    setSaving(true);
    try {
      await apiPatch(`/devices/${device.mac}`, { json: { alias: aliasVal } });
      onTagSaved(device.mac, device.tags, aliasVal);
      setEditingAlias(false);
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const saveTags = async () => {
    setSaving(true);
    try {
      await apiPatch(`/devices/${device.mac}`, { json: { tags: tagsVal } });
      onTagSaved(device.mac, tagsVal, device.alias);
      setEditingTags(false);
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await apiPost(`/devices/${device.mac}/refresh`);
      setTimeout(() => { onRefreshed(device.mac); setRefreshing(false); }, 2000);
    } catch (e) { console.error(e); setRefreshing(false); }
  };

  return (
    <div className={`rounded-2xl border transition-all
      ${isOnline
        ? "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm"
        : "border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30 opacity-70"
      }`}>

      {/* ── 设备头部 ── */}
      <div className="px-4 pt-3 pb-2 flex items-start gap-3">

        {/* 在线状态 */}
        <div className="mt-2 shrink-0">
          <span className={`block w-2.5 h-2.5 rounded-full
            ${isOnline ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" : "bg-gray-300 dark:bg-gray-600"}`} />
        </div>

        {/* 主信息 */}
        <div className="flex-1 min-w-0">

          {/* 第一行：别名（大字）+ IP */}
          <div className="flex items-center gap-2 flex-wrap">
            {editingAlias ? (
              <div className="flex items-center gap-1.5">
                <input autoFocus value={aliasVal} onChange={e => setAliasVal(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveAlias(); if (e.key === "Escape") setEditingAlias(false); }}
                  placeholder="输入别名…"
                  className="text-sm px-2 py-0.5 rounded-lg border border-blue-400 bg-white dark:bg-gray-700 dark:text-white w-40 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button onClick={saveAlias} disabled={saving}
                  className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white disabled:opacity-50">
                  {saving ? "…" : "保存"}
                </button>
                <button onClick={() => setEditingAlias(false)}
                  className="text-xs px-2 py-0.5 rounded border dark:border-gray-600 dark:text-gray-300">取消</button>
              </div>
            ) : (
              <button onClick={() => setEditingAlias(true)}
                className="group flex items-center gap-1 text-left">
                <span className={`font-bold text-lg leading-tight transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400
                  ${isOnline ? "text-gray-900 dark:text-white" : "text-gray-400 dark:text-gray-500"}`}>
                  {displayName}
                </span>
                <span className="text-gray-300 dark:text-gray-600 text-xs opacity-0 group-hover:opacity-100 transition-opacity">✏️</span>
              </button>
            )}
            <span className="font-mono text-sm font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-md">
              {device.current_ip || "—"}
            </span>
          </div>

          {/* 第二行：Tags（始终显示） */}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap min-h-[1.5rem]">
            {editingTags ? (
              <div className="flex items-center gap-1.5">
                <input autoFocus value={tagsVal} onChange={e => setTagsVal(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveTags(); if (e.key === "Escape") setEditingTags(false); }}
                  placeholder="生产, 服务器…"
                  className="text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white w-44 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button onClick={saveTags} disabled={saving}
                  className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white disabled:opacity-50">
                  {saving ? "…" : "保存"}
                </button>
                <button onClick={() => setEditingTags(false)}
                  className="text-xs px-2 py-0.5 rounded border dark:border-gray-600 dark:text-gray-300">取消</button>
              </div>
            ) : (
              <>
                {tags.map(t => (
                  <span key={t} className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${tagColor(t)}`}>{t}</span>
                ))}
                <button onClick={() => setEditingTags(true)}
                  className="text-xs text-gray-300 dark:text-gray-600 hover:text-blue-500 dark:hover:text-blue-400 transition-colors">
                  {tags.length ? "✏️" : "+ 标签"}
                </button>
              </>
            )}
          </div>

          {/* 第三行：MAC + OS（次要信息，小字灰色） */}
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {device.mac && (
              <span className="font-mono text-xs text-gray-300 dark:text-gray-600 select-all">{device.mac}</span>
            )}
            {device.os_details && device.os_details !== "Unknown" && (
              <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-xs">{device.os_details}</span>
            )}
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={handleRefresh} disabled={refreshing} title="重新扫描"
            className={`p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors ${refreshing ? "animate-spin" : ""}`}>
            ↻
          </button>
          <button onClick={() => onAddService(device.mac)} title="添加服务"
            className="px-2 py-1 rounded-lg text-xs font-semibold bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors">
            + 服务
          </button>
          <button onClick={() => onIgnore(device.mac, true)} title="隐藏"
            className="p-1.5 rounded-lg text-gray-300 dark:text-gray-600 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors text-sm">
            🙈
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1 bg-red-50 dark:bg-red-900/20 rounded-lg px-2 py-1">
              <span className="text-xs text-red-500">确认?</span>
              <button onClick={() => onDelete(device.mac)}
                className="text-xs text-red-600 font-semibold hover:text-red-800">删除</button>
              <button onClick={() => setConfirmDelete(false)}
                className="text-xs text-gray-400">取消</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} title="删除设备"
              className="p-1.5 rounded-lg text-gray-300 dark:text-gray-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm">
              🗑
            </button>
          )}
        </div>
      </div>

      {/* ── 服务网格 ── */}
      {openServices.length > 0 ? (
        <div className="px-4 pb-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 border-t border-gray-100 dark:border-gray-700/50 pt-2">
          {openServices.map(svc => (
            <ServiceTile key={`${svc.port}-${svc.proto}`} svc={svc} ip={device.current_ip}
              onDelete={id => onDeleteService(device.mac, id)} />
          ))}
        </div>
      ) : (
        <div className="px-4 pb-3 pt-2 border-t border-gray-100 dark:border-gray-700/50">
          <p className="text-xs text-gray-300 dark:text-gray-600 italic">
            未发现服务 — 点击 ↻ 重新扫描或手动添加
          </p>
        </div>
      )}
    </div>
  );
}

// ── 隐藏设备行 ────────────────────────────────────────────────────────────────
function IgnoredRow({ device, onRestore }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-400 dark:text-gray-600">
      <span className="flex-1 truncate">{device.alias || device.hostname || device.mac} · {device.current_ip}</span>
      <button onClick={() => onRestore(device.mac)}
        className="text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors shrink-0">
        恢复
      </button>
    </div>
  );
}

// ── 主面板 ────────────────────────────────────────────────────────────────────
export function ServicesPanel() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQ, setSearchQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("");
  const [showIgnored, setShowIgnored] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [showAddService, setShowAddService] = useState(false);
  const [addServiceMac, setAddServiceMac] = useState("");
  const [showPortConfig, setShowPortConfig] = useState(false);

  const fetchDevices = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const data = await apiGet("/devices?show_ignored=true");
      const withServices = await Promise.all(
        data.map(async d => {
          try { return { ...d, services: await apiGet(`/devices/${d.mac}/services`) }; }
          catch { return { ...d, services: [] }; }
        })
      );
      setDevices(withServices);
      setLastRefresh(new Date());
      setError(null);
    } catch { setError("加载失败，请检查后端服务。"); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    fetchDevices(true);
    const t = setInterval(() => fetchDevices(true), 60000);
    return () => clearInterval(t);
  }, [fetchDevices]);

  const handleIgnore = useCallback(async (mac, ignored) => {
    await apiPatch(`/devices/${mac}`, { json: { ignored } });
    setDevices(ds => ds.map(d => d.mac === mac ? { ...d, ignored: ignored ? 1 : 0 } : d));
  }, []);

  const handleDelete = useCallback(async (mac) => {
    try {
      await apiDelete(`/devices/${mac}`);
      setDevices(ds => ds.filter(d => d.mac !== mac));
    } catch (e) { console.error(e); }
  }, []);

  const handleTagSaved = useCallback((mac, tags, alias) => {
    setDevices(ds => ds.map(d => d.mac === mac ? { ...d, tags, alias: alias ?? d.alias } : d));
  }, []);

  const handleRefreshed = useCallback(async (mac) => {
    try {
      const [svcs, info] = await Promise.all([
        apiGet(`/devices/${mac}/services`),
        apiGet(`/devices/${mac}`),
      ]);
      setDevices(ds => ds.map(d => d.mac === mac ? { ...d, ...info, services: svcs } : d));
    } catch (e) { console.error(e); }
  }, []);

  const handleDeleteService = useCallback(async (mac, serviceId) => {
    try {
      await apiDelete(`/services/${serviceId}`);
      setDevices(ds => ds.map(d =>
        d.mac === mac
          ? { ...d, services: (d.services || []).filter(s => s.id !== serviceId) }
          : d
      ));
    } catch (e) { console.error(e); }
  }, []);

  const handleRefreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await apiGet("/devices?show_ignored=true");
      const withServices = await Promise.all(
        data.map(async d => {
          try { return { ...d, services: await apiGet(`/devices/${d.mac}/services`) }; }
          catch { return { ...d, services: [] }; }
        })
      );
      setDevices(withServices);
      setLastRefresh(new Date());
    } catch { setError("刷新失败"); }
    finally { setRefreshing(false); }
  }, []);

  const allTags = useMemo(() => {
    const s = new Set();
    devices.forEach(d => { if (d.tags) d.tags.split(",").forEach(t => { if (t.trim()) s.add(t.trim()); }); });
    return Array.from(s).sort();
  }, [devices]);

  const { visible, ignored } = useMemo(() => {
    const visible = [], ignored = [];
    for (const d of devices) {
      if (d.ignored) { ignored.push(d); continue; }
      if (statusFilter !== "all" && d.online_status !== statusFilter) continue;
      if (tagFilter && !(d.tags || "").toLowerCase().includes(tagFilter.toLowerCase())) continue;
      if (searchQ) {
        const q = searchQ.toLowerCase();
        const hit =
          (d.alias || "").toLowerCase().includes(q) ||
          (d.hostname || "").toLowerCase().includes(q) ||
          (d.mac || "").toLowerCase().includes(q) ||
          (d.current_ip || "").toLowerCase().includes(q) ||
          (d.tags || "").toLowerCase().includes(q) ||
          (d.services || []).some(s =>
            s.type.includes(q) || (s.title || "").toLowerCase().includes(q) || String(s.port).includes(q)
          );
        if (!hit) continue;
      }
      visible.push(d);
    }
    return { visible, ignored };
  }, [devices, searchQ, statusFilter, tagFilter]);

  const onlineCount = devices.filter(d => !d.ignored && d.online_status === "online").length;
  const totalSvc = devices.filter(d => !d.ignored)
    .reduce((n, d) => n + (d.services || []).filter(s => s.status === "open").length, 0);

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">

      {/* ── 顶部工具栏 ── */}
      <div className="shrink-0 px-5 pt-3 pb-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-2.5 flex-wrap gap-2">

          {/* 统计数字 */}
          <div className="flex items-center gap-4 text-sm">
            <span className="font-bold text-gray-900 dark:text-white">
              {devices.filter(d => !d.ignored).length}
              <span className="font-normal text-gray-400 dark:text-gray-500 ml-1">台设备</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981]" />
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{onlineCount}</span>
              <span className="text-gray-400 dark:text-gray-500">在线</span>
            </span>
            <span className="text-gray-400 dark:text-gray-500">
              <span className="font-semibold text-gray-700 dark:text-gray-300">{totalSvc}</span> 个服务
            </span>
            {lastRefresh && (
              <span className="text-xs text-gray-300 dark:text-gray-600 hidden md:inline">
                {lastRefresh.toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-2">
            <button onClick={() => setShowAddService(true)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">
              + 服务
            </button>
            <button onClick={() => setShowAddDevice(true)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors">
              + 设备
            </button>
            <button onClick={() => setShowPortConfig(true)}
              title="配置扫描端口"
              className="px-3 py-1.5 rounded-lg text-sm border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              ⚙ 端口
            </button>
            <button onClick={handleRefreshAll} disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50">
              <span className={refreshing ? "animate-spin inline-block" : ""}>↻</span>
              全部刷新
            </button>
          </div>
        </div>

        {/* 筛选栏 */}
        <div className="flex flex-wrap gap-2">
          <input type="text" placeholder="搜索设备名、IP、端口、服务…"
            value={searchQ} onChange={e => setSearchQ(e.target.value)}
            className="flex-1 min-w-48 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">全部状态</option>
            <option value="online">在线</option>
            <option value="offline">离线</option>
          </select>
          {allTags.length > 0 && (
            <select value={tagFilter} onChange={e => setTagFilter(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">全部标签</option>
              {allTags.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* ── 设备列表 ── */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-24 text-gray-400 dark:text-gray-600 gap-3">
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            加载中…
          </div>
        )}
        {error && <div className="text-center py-24 text-red-500">{error}</div>}
        {!loading && !error && visible.length === 0 && (
          <div className="text-center py-24 text-gray-400 dark:text-gray-600">
            <p className="text-3xl mb-3">🔍</p>
            <p className="font-semibold text-base">暂无设备</p>
            <p className="text-sm mt-1">运行扫描或手动添加设备</p>
          </div>
        )}

        {visible.map(d => (
          <DeviceCard key={d.mac} device={d}
            onIgnore={handleIgnore}
            onTagSaved={handleTagSaved}
            onAddService={mac => { setAddServiceMac(mac); setShowAddService(true); }}
            onDelete={handleDelete}
            onRefreshed={handleRefreshed}
            onDeleteService={handleDeleteService}
          />
        ))}

        {ignored.length > 0 && (
          <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
            <button onClick={() => setShowIgnored(v => !v)}
              className="text-xs text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400 mb-2 transition-colors">
              {showIgnored ? "▲" : "▼"} {ignored.length} 个隐藏设备
            </button>
            {showIgnored && (
              <div className="space-y-1">
                {ignored.map(d => (
                  <IgnoredRow key={d.mac} device={d} onRestore={mac => handleIgnore(mac, false)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showAddDevice && (
        <AddDeviceModal onClose={() => setShowAddDevice(false)} onAdded={() => fetchDevices()} />
      )}
      {showAddService && (
        <AddServiceModal
          devices={devices.filter(d => !d.ignored)}
          preselectedMac={addServiceMac}
          onClose={() => { setShowAddService(false); setAddServiceMac(""); }}
          onAdded={() => fetchDevices()}
        />
      )}
      {showPortConfig && (
        <PortConfigModal onClose={() => setShowPortConfig(false)} />
      )}
    </div>
  );
}
