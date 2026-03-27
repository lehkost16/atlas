import { useEffect, useState, useMemo, useCallback } from "react";
import { apiGet, apiPatch, apiDelete, apiPost } from "../api";
import { AddDeviceModal } from "./AddDeviceModal";
import { AddServiceModal } from "./AddServiceModal";
import { PortConfigModal } from "./PortConfigModal";

const SVC = {
  http:       { bg: "bg-blue-500",    text: "text-blue-600 dark:text-blue-400",    label: "HTTP",  web: true },
  https:      { bg: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", label: "HTTPS", web: true },
  ssh:        { bg: "bg-amber-500",   text: "text-amber-600 dark:text-amber-400",  label: "SSH",   web: false },
  mysql:      { bg: "bg-orange-500",  text: "text-orange-600 dark:text-orange-400",label: "MySQL", web: false },
  postgresql: { bg: "bg-violet-500",  text: "text-violet-600 dark:text-violet-400",label: "PgSQL", web: false },
  redis:      { bg: "bg-red-500",     text: "text-red-600 dark:text-red-400",      label: "Redis", web: false },
  dns:        { bg: "bg-slate-500",   text: "text-slate-600 dark:text-slate-400",  label: "DNS",   web: false },
  ftp:        { bg: "bg-pink-500",    text: "text-pink-600 dark:text-pink-400",    label: "FTP",   web: false },
  smtp:       { bg: "bg-cyan-500",    text: "text-cyan-600 dark:text-cyan-400",    label: "SMTP",  web: false },
  unknown:    { bg: "bg-gray-400",    text: "text-gray-500 dark:text-gray-400",    label: "?",     web: false },
};
const svcMeta = t => SVC[t] || SVC.unknown;

const TAG_COLORS = [
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
];
function tagColor(tag) {
  if (tag === "其他") return "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400";
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) & 0xffff;
  return TAG_COLORS[h % TAG_COLORS.length];
}

// ── 服务卡片 ──────────────────────────────────────────────────────────────────
function ServiceTile({ svc, ip, onDelete }) {
  const meta = svcMeta(svc.type);
  const url = meta.web ? `${svc.type}://${ip}:${svc.port}` : null;
  const [confirm, setConfirm] = useState(false);

  const card = (
    <div className={`group relative rounded-xl border p-3.5 flex flex-col gap-2 transition-all
      ${meta.web
        ? "border-blue-100 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-900/10 hover:shadow-lg hover:-translate-y-0.5 cursor-pointer"
        : "border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800/80"
      }`}>
      <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-snug line-clamp-2 min-h-[2.5rem]"
        title={svc.title || svc.banner || ""}>
        {svc.title || svc.banner || <span className="font-normal text-gray-400 dark:text-gray-500 italic">无标题</span>}
      </p>
      <div className="flex items-center justify-between">
        <span className={`font-mono text-xs font-bold ${meta.text}`}>:{svc.port}</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full text-white ${meta.bg}`}>{meta.label}</span>
      </div>
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10"
        onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
        {confirm ? (
          <div className="flex gap-1.5 bg-white dark:bg-gray-800 rounded-lg shadow-lg border dark:border-gray-700 px-2 py-1">
            <button onClick={() => onDelete(svc.id)} className="text-xs text-red-600 font-semibold">删除</button>
            <span className="text-gray-300">|</span>
            <button onClick={() => setConfirm(false)} className="text-xs text-gray-400">取消</button>
          </div>
        ) : (
          <button onClick={() => setConfirm(true)}
            className="w-5 h-5 flex items-center justify-center rounded-full bg-white dark:bg-gray-700 shadow border dark:border-gray-600 text-gray-300 hover:text-red-500 text-xs">✕</button>
        )}
      </div>
      {meta.web && !confirm && (
        <span className="absolute bottom-2 right-2 text-blue-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity">↗</span>
      )}
    </div>
  );
  return url ? <a href={url} target="_blank" rel="noopener noreferrer" className="block no-underline">{card}</a> : card;
}

// ── 设备卡片 ──────────────────────────────────────────────────────────────────
function DeviceCard({ device, onIgnore, onTagSaved, onAddService, onDelete, onRefreshed, onDeleteService }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasVal, setAliasVal] = useState(device.alias || "");
  const [tagInput, setTagInput] = useState("");
  const [tagList, setTagList] = useState(
    device.tags ? device.tags.split(",").map(t => t.trim()).filter(Boolean) : []
  );
  const [editingTags, setEditingTags] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const isOnline = device.online_status === "online";
  const allSvcs = (device.services || []).filter(s => s.status === "open");
  const openServices = [
    ...allSvcs.filter(s => s.type === "http" || s.type === "https"),
    ...allSvcs.filter(s => s.type !== "http" && s.type !== "https"),
  ];
  const tags = device.tags ? device.tags.split(",").map(t => t.trim()).filter(Boolean) : [];
  const displayName = device.alias || device.hostname || device.mac;

  const saveAlias = async () => {
    setSaving(true);
    try { await apiPatch(`/devices/${device.mac}`, { json: { alias: aliasVal } }); onTagSaved(device.mac, device.tags, aliasVal); setEditingAlias(false); }
    catch (e) { console.error(e); }
    setSaving(false);
  };
  const saveTags = async () => {
    setSaving(true);
    const val = tagList.join(",");
    try { await apiPatch(`/devices/${device.mac}`, { json: { tags: val } }); onTagSaved(device.mac, val, device.alias); setEditingTags(false); }
    catch (e) { console.error(e); }
    setSaving(false);
  };
  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tagList.includes(t)) setTagList(prev => [...prev, t]);
    setTagInput("");
  };
  const removeTag = (t) => setTagList(prev => prev.filter(x => x !== t));
  const handleRefresh = async () => {
    setRefreshing(true);
    try { await apiPost(`/devices/${device.mac}/refresh`); setTimeout(() => { onRefreshed(device.mac); setRefreshing(false); }, 2000); }
    catch (e) { console.error(e); setRefreshing(false); }
  };

  return (
    <div className={`rounded-2xl border transition-all
      ${isOnline ? "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm" : "border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30 opacity-60"}`}>
      <div className="px-5 pt-4 pb-3 flex items-start gap-3">
        <div className="mt-2 shrink-0">
          <span className={`block w-3 h-3 rounded-full ${isOnline ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" : "bg-gray-300 dark:bg-gray-600"}`} />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          {/* 别名 */}
          <div className="flex items-center gap-2 flex-wrap">
            {editingAlias ? (
              <div className="flex items-center gap-2">
                <input autoFocus value={aliasVal} onChange={e => setAliasVal(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveAlias(); if (e.key === "Escape") setEditingAlias(false); }}
                  className="text-base px-3 py-1 rounded-lg border border-blue-400 bg-white dark:bg-gray-700 dark:text-white w-48 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button onClick={saveAlias} disabled={saving} className="px-3 py-1 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50">{saving ? "…" : "保存"}</button>
                <button onClick={() => setEditingAlias(false)} className="px-3 py-1 rounded-lg border dark:border-gray-600 text-sm dark:text-gray-300">取消</button>
              </div>
            ) : (
              <button onClick={() => setEditingAlias(true)} className="group flex items-center gap-2 text-left">
                <span className={`font-bold text-xl leading-tight transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400 ${isOnline ? "text-gray-900 dark:text-white" : "text-gray-400 dark:text-gray-500"}`}>{displayName}</span>
                <span className="text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity text-sm">✏️</span>
              </button>
            )}
            <span className="font-mono text-sm font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2.5 py-0.5 rounded-lg">{device.current_ip || "—"}</span>
          </div>
          {/* Tags */}
          <div className="flex items-center gap-2 flex-wrap min-h-[1.75rem]">
            {editingTags ? (
              <div className="flex flex-col gap-2 w-full">
                {/* 已有标签 chip（点击删除） */}
                <div className="flex flex-wrap gap-1.5">
                  {tagList.map(t => (
                    <span key={t} className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-sm font-medium cursor-pointer hover:opacity-70 ${tagColor(t)}`}
                      onClick={() => removeTag(t)} title="点击删除">
                      {t} <span className="text-xs">✕</span>
                    </span>
                  ))}
                </div>
                {/* 输入新标签 */}
                <div className="flex items-center gap-2">
                  <input autoFocus value={tagInput} onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") { e.preventDefault(); addTag(); }
                      if (e.key === "Escape") setEditingTags(false);
                    }}
                    placeholder="输入标签，回车添加…"
                    className="text-sm px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white w-44 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <button onClick={addTag} className="px-3 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 text-sm dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600">+ 添加</button>
                  <button onClick={saveTags} disabled={saving} className="px-3 py-1 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50">{saving ? "…" : "保存"}</button>
                  <button onClick={() => setEditingTags(false)} className="px-3 py-1 rounded-lg border dark:border-gray-600 text-sm dark:text-gray-300">取消</button>
                </div>
              </div>
            ) : (
              <>
                {tags.map(t => <span key={t} className={`inline-block px-2.5 py-0.5 rounded-full text-sm font-medium ${tagColor(t)}`}>{t}</span>)}
                <button onClick={() => { setTagList(tags); setEditingTags(true); }}
                  className="text-sm text-gray-300 dark:text-gray-600 hover:text-blue-500 dark:hover:text-blue-400 transition-colors">{tags.length ? "✏️" : "+ 标签"}</button>
              </>
            )}
          </div>
          {/* MAC + OS */}
          <div className="flex items-center gap-3 flex-wrap">
            {device.mac && <span className="font-mono text-xs text-gray-300 dark:text-gray-600 select-all">{device.mac}</span>}
            {device.os_details && device.os_details !== "Unknown" && <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-xs">{device.os_details}</span>}
          </div>
        </div>
        {/* 操作 */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={handleRefresh} disabled={refreshing} title="重新扫描"
            className={`p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-base ${refreshing ? "animate-spin" : ""}`}>↻</button>
          <button onClick={() => onAddService(device.mac)} className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 transition-colors">+ 服务</button>
          <button onClick={() => onIgnore(device.mac, true)} className="p-2 rounded-lg text-gray-300 dark:text-gray-600 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">🙈</button>
          {confirmDelete ? (
            <div className="flex items-center gap-1.5 bg-red-50 dark:bg-red-900/20 rounded-lg px-2.5 py-1.5">
              <span className="text-sm text-red-500">确认?</span>
              <button onClick={() => onDelete(device.mac)} className="text-sm text-red-600 font-semibold">删除</button>
              <button onClick={() => setConfirmDelete(false)} className="text-sm text-gray-400">取消</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="p-2 rounded-lg text-gray-300 dark:text-gray-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">🗑</button>
          )}
        </div>
      </div>
      {/* 服务网格 */}
      {openServices.length > 0 ? (
        <div className="px-5 pb-4 pt-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 border-t border-gray-100 dark:border-gray-700/50">
          {openServices.map(svc => (
            <ServiceTile key={`${svc.port}-${svc.proto}`} svc={svc} ip={device.current_ip}
              onDelete={id => onDeleteService(device.mac, id)} />
          ))}
        </div>
      ) : (
        <div className="px-5 pb-4 pt-2 border-t border-gray-100 dark:border-gray-700/50">
          <p className="text-sm text-gray-300 dark:text-gray-600 italic">未发现服务 — 点击 ↻ 重新扫描或手动添加</p>
        </div>
      )}
    </div>
  );
}

// ── 分组组件（可展开收起 + 排序模式） ────────────────────────────────────────
function DeviceGroup({ groupName, devices, collapsed, onToggle, sortMode, onMoveUp, onMoveDown, isFirst, isLast, cardProps }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800 shadow-sm">
      <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">

        {/* 排序按钮 */}
        {sortMode && (
          <div className="flex flex-col gap-0.5 shrink-0">
            <button onClick={onMoveUp} disabled={isFirst}
              className="text-xs text-gray-400 hover:text-blue-600 disabled:opacity-20 leading-none px-1">▲</button>
            <button onClick={onMoveDown} disabled={isLast}
              className="text-xs text-gray-400 hover:text-blue-600 disabled:opacity-20 leading-none px-1">▼</button>
          </div>
        )}

        {/* 展开/收起 */}
        <div className="flex items-center gap-3 flex-1 cursor-pointer select-none" onClick={onToggle}>
          <span className="text-gray-400 dark:text-gray-500 text-sm transition-transform duration-200"
            style={{ display: "inline-block", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▼</span>
          <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${tagColor(groupName)}`}>
            {groupName}
          </span>
          <span className="text-sm text-gray-400 dark:text-gray-500">{devices.length} 台</span>
        </div>
      </div>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-100 dark:border-gray-700/50 pt-3">
          {devices.map(d => <DeviceCard key={d.mac} device={d} {...cardProps(d)} />)}
        </div>
      )}
    </div>
  );
}

// ── 隐藏设备行 ────────────────────────────────────────────────────────────────
function IgnoredRow({ device, onRestore }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/50 text-sm text-gray-400 dark:text-gray-600">
      <span className="flex-1 truncate">{device.alias || device.hostname || device.mac} · {device.current_ip}</span>
      <button onClick={() => onRestore(device.mac)} className="text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors shrink-0">恢复</button>
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
  const [showIgnored, setShowIgnored] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [showAddService, setShowAddService] = useState(false);
  const [addServiceMac, setAddServiceMac] = useState("");
  const [showPortConfig, setShowPortConfig] = useState(false);
  // 分组折叠状态: { [groupName]: bool }
  const [collapsed, setCollapsed] = useState({});
  // 分组顺序
  const [groupOrder, setGroupOrder] = useState([]);
  const [sortMode, setSortMode] = useState(false);

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
    try { await apiDelete(`/devices/${mac}`); setDevices(ds => ds.filter(d => d.mac !== mac)); }
    catch (e) { console.error(e); }
  }, []);
  const handleTagSaved = useCallback((mac, tags, alias) => {
    setDevices(ds => ds.map(d => d.mac === mac ? { ...d, tags, alias: alias ?? d.alias } : d));
  }, []);
  const handleRefreshed = useCallback(async (mac) => {
    try {
      const [svcs, info] = await Promise.all([apiGet(`/devices/${mac}/services`), apiGet(`/devices/${mac}`)]);
      setDevices(ds => ds.map(d => d.mac === mac ? { ...d, ...info, services: svcs } : d));
    } catch (e) { console.error(e); }
  }, []);
  const handleDeleteService = useCallback(async (mac, serviceId) => {
    try {
      await apiDelete(`/services/${serviceId}`);
      setDevices(ds => ds.map(d =>
        d.mac === mac ? { ...d, services: (d.services || []).filter(s => s.id !== serviceId) } : d
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

  // 按 tag 分组
  const { groups, ignored } = useMemo(() => {
    const groupMap = {}; // tag -> devices[]
    const ignored = [];

    for (const d of devices) {
      if (d.ignored) { ignored.push(d); continue; }
      if (statusFilter !== "all" && d.online_status !== statusFilter) continue;
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

      // 取第一个 tag 作为分组键，无 tag 归入"未分组"
      const tags = d.tags ? d.tags.split(",").map(t => t.trim()).filter(Boolean) : [];
      const groupKey = tags[0] || "未分组";
      if (!groupMap[groupKey]) groupMap[groupKey] = [];
      groupMap[groupKey].push(d);
    }

    // 每组内按别名排序，有别名/tag的排前
    for (const key of Object.keys(groupMap)) {
      groupMap[key].sort((a, b) => {
        const aHas = !!(a.alias || (a.tags && a.tags !== key));
        const bHas = !!(b.alias || (b.tags && b.tags !== key));
        if (aHas !== bHas) return aHas ? -1 : 1;
        return (a.alias || a.hostname || a.mac || "").localeCompare(b.alias || b.hostname || b.mac || "");
      });
    }

    return { groups: groupMap, ignored };
  }, [devices, searchQ, statusFilter]);

  // 初始化/更新分组顺序：新分组追加到末尾，"其他"和"未分组"始终在最后
  useEffect(() => {
    const keys = Object.keys(groups);
    setGroupOrder(prev => {
      const existing = prev.filter(k => keys.includes(k));
      const newKeys = keys.filter(k => !prev.includes(k) && k !== "其他" && k !== "未分组");
      const tail = keys.filter(k => !prev.includes(k) && (k === "其他" || k === "未分组"));
      return [...existing, ...newKeys, ...tail];
    });
  }, [groups]);

  const orderedGroups = groupOrder.filter(k => groups[k]);

  const onlineCount = devices.filter(d => !d.ignored && d.online_status === "online").length;
  const totalSvc = devices.filter(d => !d.ignored)
    .reduce((n, d) => n + (d.services || []).filter(s => s.status === "open").length, 0);

  const cardProps = useCallback((d) => ({
    onIgnore: handleIgnore,
    onTagSaved: handleTagSaved,
    onAddService: mac => { setAddServiceMac(mac); setShowAddService(true); },
    onDelete: handleDelete,
    onRefreshed: handleRefreshed,
    onDeleteService: handleDeleteService,
  }), [handleIgnore, handleTagSaved, handleDelete, handleRefreshed, handleDeleteService]);

  // 分组排序
  const moveGroup = (groupName, dir) => {
    setGroupOrder(prev => {
      const arr = [...prev];
      const idx = arr.indexOf(groupName);
      if (idx === -1) return arr;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= arr.length) return arr;
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* 顶部工具栏 */}
      <div className="shrink-0 px-6 pt-4 pb-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-5 text-base">
            <span className="font-bold text-gray-900 dark:text-white text-lg">
              {orderedGroups.reduce((n, k) => n + (groups[k]?.length || 0), 0)}
              <span className="font-normal text-gray-400 dark:text-gray-500 ml-1.5 text-base">台设备</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981]" />
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{onlineCount}</span>
              <span className="text-gray-400 dark:text-gray-500">在线</span>
            </span>
            <span className="text-gray-400 dark:text-gray-500">
              <span className="font-semibold text-gray-700 dark:text-gray-300">{totalSvc}</span> 个服务
            </span>
            {lastRefresh && <span className="text-sm text-gray-300 dark:text-gray-600 hidden md:inline">{lastRefresh.toLocaleTimeString()}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowAddService(true)} className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">+ 服务</button>
            <button onClick={() => setShowAddDevice(true)} className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors">+ 设备</button>
            <button onClick={() => setShowPortConfig(true)} className="px-4 py-2 rounded-lg text-sm border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">⚙ 端口</button>
            <button onClick={() => setSortMode(v => !v)}
              className={`px-4 py-2 rounded-lg text-sm border transition-colors ${sortMode ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400" : "border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"}`}>
              {sortMode ? "✓ 排序中" : "⇅ 排序"}
            </button>
            <button onClick={handleRefreshAll} disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50">
              <span className={refreshing ? "animate-spin inline-block" : ""}>↻</span>全部刷新
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <input type="text" placeholder="搜索设备名、IP、端口、服务…"
            value={searchQ} onChange={e => setSearchQ(e.target.value)}
            className="flex-1 min-w-48 px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">全部状态</option>
            <option value="online">在线</option>
            <option value="offline">离线</option>
          </select>
        </div>
      </div>

      {/* 分组列表 */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {loading && (
          <div className="flex items-center justify-center py-24 text-gray-400 gap-3">
            <svg className="animate-spin w-6 h-6" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            <span className="text-base">加载中…</span>
          </div>
        )}
        {error && <div className="text-center py-24 text-red-500 text-base">{error}</div>}
        {!loading && !error && orderedGroups.length === 0 && (
          <div className="text-center py-24 text-gray-400 dark:text-gray-600">
            <p className="text-4xl mb-3">🔍</p>
            <p className="font-semibold text-lg">暂无设备</p>
            <p className="text-base mt-1">运行扫描或手动添加设备</p>
          </div>
        )}

        {orderedGroups.map((groupName, idx) => (
          <DeviceGroup
            key={groupName}
            groupName={groupName}
            devices={groups[groupName]}
            collapsed={!!collapsed[groupName]}
            onToggle={() => setCollapsed(c => ({ ...c, [groupName]: !c[groupName] }))}
            sortMode={sortMode}
            onMoveUp={() => moveGroup(groupName, -1)}
            onMoveDown={() => moveGroup(groupName, 1)}
            isFirst={idx === 0}
            isLast={idx === orderedGroups.length - 1}
            cardProps={cardProps}
          />
        ))}

        {ignored.length > 0 && (
          <div className="pt-5 border-t border-gray-200 dark:border-gray-700">
            <button onClick={() => setShowIgnored(v => !v)}
              className="text-sm text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400 mb-2 transition-colors">
              {showIgnored ? "▲" : "▼"} {ignored.length} 个隐藏设备
            </button>
            {showIgnored && (
              <div className="space-y-1.5">
                {ignored.map(d => <IgnoredRow key={d.mac} device={d} onRestore={mac => handleIgnore(mac, false)} />)}
              </div>
            )}
          </div>
        )}
      </div>

      {showAddDevice && <AddDeviceModal onClose={() => setShowAddDevice(false)} onAdded={() => fetchDevices()} />}
      {showAddService && (
        <AddServiceModal
          devices={devices.filter(d => !d.ignored)}
          preselectedMac={addServiceMac}
          onClose={() => { setShowAddService(false); setAddServiceMac(""); }}
          onAdded={() => fetchDevices()}
        />
      )}
      {showPortConfig && <PortConfigModal onClose={() => setShowPortConfig(false)} />}
    </div>
  );
}
