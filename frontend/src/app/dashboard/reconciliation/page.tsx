"use client";
import { useEffect, useState, useCallback } from "react";
import {
  RefreshCw, Play, CheckCircle, AlertTriangle, Clock, XCircle,
  ArrowRight, Zap, BarChart3,
} from "lucide-react";
import { reconciliationAPI } from "@/lib/api";

export default function ReconciliationPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [mismatches, setMismatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [activeTab, setActiveTab] = useState<"jobs" | "mismatches">("jobs");
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [resolveNotes, setResolveNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [jobsRes, mismatchRes] = await Promise.allSettled([
        reconciliationAPI.getJobs(),
        reconciliationAPI.getMismatches(),
      ]);
      if (jobsRes.status === "fulfilled") setJobs(jobsRes.value.data.data || []);
      if (mismatchRes.status === "fulfilled") setMismatches(mismatchRes.value.data.data || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleTrigger = async () => {
    if (!confirm("Start a full reconciliation run? This compares all records against portal data.")) return;
    setTriggering(true);
    try {
      await reconciliationAPI.triggerFull();
      setTimeout(load, 2000); // reload after brief delay
    } catch { alert("Failed to trigger reconciliation"); }
    setTriggering(false);
  };

  const handleResolveMismatch = async () => {
    if (!resolveId || !resolveNotes.trim()) return;
    try {
      await reconciliationAPI.resolveMismatch(resolveId, resolveNotes);
      setResolveId(null);
      setResolveNotes("");
      load();
    } catch { alert("Failed to resolve mismatch"); }
  };

  const completedJobs = jobs.filter(j => j.status === "COMPLETED").length;
  const runningJobs = jobs.filter(j => j.status === "RUNNING").length;
  const totalMismatches = mismatches.length;
  const openMismatches = mismatches.filter((m: any) => !m.resolvedAt && !m.autoResolved).length;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}>
            <BarChart3 size={22} color="#6366f1" /> Reconciliation Engine
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>
            Compare internal records against ICP portal data — detect mismatches and ghost passengers
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} className="btn btn-outline" style={{ padding: "8px 14px", fontSize: 13 }}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={handleTrigger} className="btn btn-primary" style={{ padding: "8px 16px", fontSize: 13 }} disabled={triggering}>
            {triggering ? <><RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} /> Running...</> : <><Play size={14} /> Run Full Reconciliation</>}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
        <StatCard icon={<CheckCircle size={18} />} label="Completed Jobs" value={completedJobs} color="#22c55e" />
        <StatCard icon={<Clock size={18} />} label="Running" value={runningJobs} color="#f59e0b" />
        <StatCard icon={<AlertTriangle size={18} />} label="Total Mismatches" value={totalMismatches} color="#ef4444" />
        <StatCard icon={<XCircle size={18} />} label="Open Mismatches" value={openMismatches} color="#6366f1" />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "var(--bg-card)", borderRadius: 8, padding: 3, border: "1px solid var(--border-color)", width: "fit-content" }}>
        {[{ key: "jobs", label: "Job History" }, { key: "mismatches", label: "Mismatches" }].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key as any)}
            style={{
              padding: "7px 18px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
              background: activeTab === t.key ? "var(--accent-primary)" : "transparent",
              color: activeTab === t.key ? "#fff" : "var(--text-secondary)",
              transition: "all 0.2s",
            }}>{t.label}</button>
        ))}
      </div>

      {/* Content */}
      <div className="card" style={{ overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 60, textAlign: "center" }}><div className="spinner" style={{ margin: "0 auto" }} /></div>
        ) : activeTab === "jobs" ? (
          /* JOB HISTORY TABLE */
          jobs.length === 0 ? (
            <div style={{ padding: 60, textAlign: "center" }}>
              <Clock size={40} color="var(--text-muted)" style={{ margin: "0 auto 12px" }} />
              <p style={{ color: "var(--text-muted)", fontSize: 14 }}>No reconciliation jobs yet. Click "Run Full Reconciliation" to start.</p>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                  {["Status", "Type", "Total", "Checked", "Mismatches", "Ghosts", "Started", "Duration"].map(h => (
                    <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map((j: any) => (
                  <tr key={j.id} style={{ borderBottom: "1px solid var(--border-color)" }}>
                    <td style={{ padding: "12px" }}>
                      <span style={{
                        padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: j.status === "COMPLETED" ? "rgba(34,197,94,0.1)" : j.status === "RUNNING" ? "rgba(245,158,11,0.1)" : j.status === "FAILED" ? "rgba(239,68,68,0.1)" : "rgba(99,102,241,0.1)",
                        color: j.status === "COMPLETED" ? "#22c55e" : j.status === "RUNNING" ? "#f59e0b" : j.status === "FAILED" ? "#ef4444" : "#6366f1",
                      }}>{j.status}</span>
                    </td>
                    <td style={{ padding: "12px", fontWeight: 500 }}>{j.jobType || "FULL"}</td>
                    <td style={{ padding: "12px" }}>{j.totalRecords || 0}</td>
                    <td style={{ padding: "12px" }}>{j.checkedRecords || 0}</td>
                    <td style={{ padding: "12px", fontWeight: 600, color: (j.mismatchCount || 0) > 0 ? "#ef4444" : "inherit" }}>{j.mismatchCount || 0}</td>
                    <td style={{ padding: "12px", fontWeight: 600, color: (j.ghostCount || 0) > 0 ? "#f59e0b" : "inherit" }}>{j.ghostCount || 0}</td>
                    <td style={{ padding: "12px", fontSize: 11, color: "var(--text-muted)" }}>
                      {j.startedAt ? new Date(j.startedAt).toLocaleString("en-AE", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Pending"}
                    </td>
                    <td style={{ padding: "12px", fontSize: 11 }}>
                      {j.startedAt && j.completedAt ? `${Math.round((new Date(j.completedAt).getTime() - new Date(j.startedAt).getTime()) / 1000)}s` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          /* MISMATCHES TABLE */
          mismatches.length === 0 ? (
            <div style={{ padding: 60, textAlign: "center" }}>
              <CheckCircle size={40} color="#22c55e" style={{ margin: "0 auto 12px" }} />
              <p style={{ color: "var(--text-muted)", fontSize: 14 }}>No mismatches detected. All records are in sync.</p>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                  {["Risk", "Passport", "Internal", "Portal", "Type", "Score", "Status", "Action"].map(h => (
                    <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mismatches.map((m: any) => {
                  const isResolved = m.resolvedAt || m.autoResolved;
                  return (
                    <tr key={m.id} style={{ borderBottom: "1px solid var(--border-color)", opacity: isResolved ? 0.6 : 1 }}>
                      <td style={{ padding: "12px" }}>
                        <span style={{
                          padding: "3px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                          background: m.riskLevel === "CRITICAL" ? "rgba(239,68,68,0.12)" : m.riskLevel === "HIGH" ? "rgba(245,158,11,0.12)" : "rgba(99,102,241,0.1)",
                          color: m.riskLevel === "CRITICAL" ? "#ef4444" : m.riskLevel === "HIGH" ? "#f59e0b" : "#6366f1",
                        }}>{m.riskLevel}</span>
                      </td>
                      <td style={{ padding: "12px", fontSize: 12 }}>
                        {m.application?.passenger?.passportNumber?.substring(0, 3)}***
                        <br /><span style={{ fontSize: 11, color: "var(--text-muted)" }}>{m.application?.passenger?.fullName}</span>
                      </td>
                      <td style={{ padding: "12px", fontWeight: 600 }}>{m.internalStatus}</td>
                      <td style={{ padding: "12px", fontWeight: 600, color: "#ef4444" }}>{m.portalStatus}</td>
                      <td style={{ padding: "12px", fontSize: 11 }}>{m.mismatchType}</td>
                      <td style={{ padding: "12px" }}>
                        <span style={{ fontSize: 16, fontWeight: 700, color: (m.ghostScore || 0) >= 60 ? "#ef4444" : "#6366f1" }}>{m.ghostScore || 0}</span>
                      </td>
                      <td style={{ padding: "12px" }}>
                        <span style={{
                          padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                          background: isResolved ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                          color: isResolved ? "#22c55e" : "#ef4444",
                        }}>{isResolved ? (m.autoResolved ? "AUTO-RESOLVED" : "RESOLVED") : "OPEN"}</span>
                      </td>
                      <td style={{ padding: "12px" }}>
                        {!isResolved && (
                          <button
                            onClick={() => { setResolveId(m.id); setResolveNotes(""); }}
                            style={{ background: "none", border: "1px solid var(--border-color)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#22c55e" }}
                          >
                            Resolve
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}
      </div>

      {/* Resolve Modal */}
      {resolveId && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div className="card fade-in" style={{ width: 420, padding: 28 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
              <CheckCircle size={18} color="#22c55e" /> Resolve Mismatch
            </h2>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>Resolution Notes *</label>
            <textarea
              value={resolveNotes} onChange={(e) => setResolveNotes(e.target.value)}
              placeholder="e.g., Verified status with PRO, confirmed departure..."
              rows={3}
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border-color)",
                background: "var(--bg-body)", color: "var(--text-primary)", fontSize: 13, resize: "vertical", boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => setResolveId(null)} className="btn btn-outline" style={{ flex: 1, fontSize: 13 }}>Cancel</button>
              <button onClick={handleResolveMismatch} className="btn btn-primary" style={{ flex: 1, fontSize: 13 }} disabled={!resolveNotes.trim()}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "14px 18px",
      background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: 10,
    }}>
      <div style={{ color }}>{icon}</div>
      <div>
        <p style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</p>
        <p style={{ fontSize: 22, fontWeight: 700, color }}>{value}</p>
      </div>
    </div>
  );
}
