"use client";
import { useEffect, useState, useCallback } from "react";
import {
  ScrollText, RefreshCw, Filter, User, Clock, Shield, ChevronLeft, ChevronRight,
} from "lucide-react";
import { adminAPI } from "@/lib/api";

const ACTION_COLORS: Record<string, string> = {
  LOGIN_SUCCESS: "#22c55e",
  LOGOUT: "#6366f1",
  PASSENGER_CREATED: "#3b82f6",
  APPLICATION_CREATED: "#3b82f6",
  STATUS_UPDATED: "#f59e0b",
  GHOST_ACKNOWLEDGED: "#f59e0b",
  GHOST_RESOLVED: "#22c55e",
  GHOST_FALSE_POSITIVE: "#8b5cf6",
  SPOT_CHECK_TRIGGERED: "#6366f1",
  RECONCILIATION_TRIGGERED: "#0ea5e9",
  MISMATCH_RESOLVED: "#22c55e",
  REPORT_GENERATED: "#14b8a6",
  REPORT_DELETED: "#ef4444",
  CIRCUIT_BREAKER_RESET: "#f59e0b",
  ENTRY_EVENT_RECORDED: "#22c55e",
  EXIT_EVENT_RECORDED: "#ef4444",
  IMPORT_COMPLETED: "#3b82f6",
};

export default function AuditLogPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filterAction, setFilterAction] = useState("");
  const [filterEntity, setFilterEntity] = useState("");
  const [selectedLog, setSelectedLog] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page };
      if (filterAction) params.action = filterAction;
      if (filterEntity) params.entityType = filterEntity;
      const res = await adminAPI.getAuditLogs(params);
      setLogs(res.data.data || []);
      setTotalPages(res.data.pagination?.totalPages || 1);
    } catch { /* ignore */ }
    setLoading(false);
  }, [page, filterAction, filterEntity]);

  useEffect(() => { load(); }, [load]);

  const uniqueActions = [...new Set(logs.map(l => l.action))].sort();
  const uniqueEntities = [...new Set(logs.map(l => l.entityType).filter(Boolean))].sort();

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}>
            <ScrollText size={22} color="#6366f1" /> Audit Log
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>
            Complete trail of all system actions — logins, status changes, ghost alerts, imports
          </p>
        </div>
        <button onClick={load} className="btn btn-outline" style={{ padding: "8px 14px", fontSize: 13 }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <select
          value={filterAction} onChange={(e) => { setFilterAction(e.target.value); setPage(1); }}
          style={{
            padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border-color)",
            background: "var(--bg-card)", color: "var(--text-primary)", fontSize: 12,
          }}
        >
          <option value="">All Actions</option>
          {Object.keys(ACTION_COLORS).map(a => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}
        </select>
        <select
          value={filterEntity} onChange={(e) => { setFilterEntity(e.target.value); setPage(1); }}
          style={{
            padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border-color)",
            background: "var(--bg-card)", color: "var(--text-primary)", fontSize: 12,
          }}
        >
          <option value="">All Entities</option>
          {["User", "Passenger", "VisaApplication", "GhostAlert", "ReconciliationJob", "ReconciliationMismatch", "BorderEvent", "Report", "System"].map(e =>
            <option key={e} value={e}>{e}</option>
          )}
        </select>
      </div>

      {/* Log Table */}
      <div className="card" style={{ overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 60, textAlign: "center" }}><div className="spinner" style={{ margin: "0 auto" }} /></div>
        ) : logs.length === 0 ? (
          <div style={{ padding: 60, textAlign: "center" }}>
            <ScrollText size={40} color="var(--text-muted)" style={{ margin: "0 auto 12px" }} />
            <p style={{ color: "var(--text-muted)", fontSize: 14 }}>No audit logs match the current filter.</p>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                {["Time", "User", "Action", "Entity", "Details", "IP"].map(h => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log: any) => (
                <tr key={log.id} style={{ borderBottom: "1px solid var(--border-color)", cursor: "pointer" }}
                  onClick={() => setSelectedLog(log)}>
                  <td style={{ padding: "10px 12px", fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                    {new Date(log.createdAt).toLocaleString("en-AE", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <User size={12} color="var(--text-muted)" />
                      <span style={{ fontSize: 12 }}>{log.user?.email || "System"}</span>
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{
                      padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                      background: `${ACTION_COLORS[log.action] || "#6366f1"}15`,
                      color: ACTION_COLORS[log.action] || "#6366f1",
                    }}>{log.action?.replace(/_/g, " ")}</span>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-secondary)" }}>
                    {log.entityType || "—"}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 11, color: "var(--text-muted)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {log.entityId ? `ID: ${log.entityId.substring(0, 8)}...` : "—"}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
                    {log.ipAddress || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 16 }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            style={{ background: "none", border: "1px solid var(--border-color)", borderRadius: 6, padding: "6px 10px", cursor: "pointer", color: "var(--text-secondary)" }}
          ><ChevronLeft size={16} /></button>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            style={{ background: "none", border: "1px solid var(--border-color)", borderRadius: 6, padding: "6px 10px", cursor: "pointer", color: "var(--text-secondary)" }}
          ><ChevronRight size={16} /></button>
        </div>
      )}

      {/* Detail Modal */}
      {selectedLog && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div className="card fade-in" style={{ width: 520, padding: 28, maxHeight: "80vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                <ScrollText size={18} color="#6366f1" /> Audit Entry Details
              </h2>
              <button onClick={() => setSelectedLog(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 18 }}>✕</button>
            </div>
            {[
              ["Timestamp", new Date(selectedLog.createdAt).toLocaleString()],
              ["User", selectedLog.user?.email || "System"],
              ["Role", selectedLog.user?.role || "—"],
              ["Action", selectedLog.action],
              ["Entity Type", selectedLog.entityType || "—"],
              ["Entity ID", selectedLog.entityId || "—"],
              ["IP Address", selectedLog.ipAddress || "—"],
              ["User Agent", selectedLog.userAgent?.substring(0, 60) || "—"],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border-color)" }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</span>
                <span style={{ fontSize: 12, fontWeight: 500, maxWidth: 280, textAlign: "right", wordBreak: "break-all" }}>{value}</span>
              </div>
            ))}
            {selectedLog.oldValues && (
              <div style={{ marginTop: 14 }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>OLD VALUES</p>
                <pre style={{ padding: 10, borderRadius: 6, background: "rgba(239,68,68,0.06)", fontSize: 11, overflow: "auto", border: "1px solid rgba(239,68,68,0.1)" }}>
                  {typeof selectedLog.oldValues === "string" ? selectedLog.oldValues : JSON.stringify(selectedLog.oldValues, null, 2)}
                </pre>
              </div>
            )}
            {selectedLog.newValues && (
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>NEW VALUES</p>
                <pre style={{ padding: 10, borderRadius: 6, background: "rgba(34,197,94,0.06)", fontSize: 11, overflow: "auto", border: "1px solid rgba(34,197,94,0.1)" }}>
                  {typeof selectedLog.newValues === "string" ? selectedLog.newValues : JSON.stringify(selectedLog.newValues, null, 2)}
                </pre>
              </div>
            )}
            <button onClick={() => setSelectedLog(null)} className="btn btn-outline" style={{ width: "100%", marginTop: 16, fontSize: 13 }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
