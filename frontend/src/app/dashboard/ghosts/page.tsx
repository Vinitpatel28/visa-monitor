"use client";
import { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle, ShieldAlert, CheckCircle, RefreshCw, Eye, ShieldCheck,
  Search, XCircle, Zap, Activity, Filter,
} from "lucide-react";
import { ghostsAPI } from "@/lib/api";

interface ScraperStatus {
  circuitBreaker: {
    state: string;
    failureCount: number;
    maxFailures: number;
    timeUntilRetry: string | null;
    stats: { totalRequests: number; totalSuccesses: number; totalFailures: number; totalRejected: number };
  };
  rateLimiter: {
    checksThisHour: number;
    maxPerHour: number;
    remaining: number;
  };
}

export default function GhostsPage() {
  const [ghosts, setGhosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGhost, setSelectedGhost] = useState<any>(null);
  const [scraperStatus, setScraperStatus] = useState<ScraperStatus | null>(null);
  const [filter, setFilter] = useState<string>("ALL");
  const [resolveModal, setResolveModal] = useState<any>(null);
  const [resolveNotes, setResolveNotes] = useState("");
  const [spotCheckLoading, setSpotCheckLoading] = useState<string | null>(null);
  const [spotCheckResult, setSpotCheckResult] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (filter === "OPEN") params.status = "OPEN";
      if (filter === "CRITICAL") { params.status = "OPEN"; params.riskLevel = "CRITICAL"; }
      if (filter === "RESOLVED") params.status = "RESOLVED";

      const [ghostRes, statusRes] = await Promise.allSettled([
        ghostsAPI.getAll(params),
        ghostsAPI.getScraperStatus(),
      ]);
      if (ghostRes.status === "fulfilled") setGhosts(ghostRes.value.data.data || []);
      if (statusRes.status === "fulfilled") setScraperStatus(statusRes.value.data.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  // ═══════ ACTIONS ═══════
  const handleAcknowledge = async (id: string) => {
    try {
      await ghostsAPI.acknowledge(id);
      load();
    } catch { alert("Failed to acknowledge"); }
  };

  const handleResolveSubmit = async () => {
    if (!resolveModal) return;
    try {
      await ghostsAPI.resolve(resolveModal.id, "Resolved", resolveNotes);
      setResolveModal(null);
      setResolveNotes("");
      load();
    } catch { alert("Failed to resolve"); }
  };

  const handleFalsePositive = async (id: string) => {
    if (!confirm("Mark this alert as a false positive? This cannot be undone.")) return;
    try {
      await ghostsAPI.falsePositive(id);
      load();
    } catch { alert("Failed to mark as false positive"); }
  };

  const handleSpotCheck = async (id: string) => {
    setSpotCheckLoading(id);
    setSpotCheckResult(null);
    try {
      const res = await ghostsAPI.triggerSpotCheck(id);
      setSpotCheckResult(res.data.data);
    } catch (err: any) {
      setSpotCheckResult({ status: "ERROR", message: err.response?.data?.error?.message || "Spot check failed" });
    }
    setSpotCheckLoading(null);
  };

  const criticalCount = ghosts.filter((g) => g.riskLevel === "CRITICAL" && g.status === "OPEN").length;
  const highCount = ghosts.filter((g) => g.riskLevel === "HIGH" && g.status === "OPEN").length;
  const openCount = ghosts.filter((g) => g.status === "OPEN").length;
  const resolvedCount = ghosts.filter((g) => g.status === "RESOLVED" || g.status === "FALSE_POSITIVE").length;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}>
            <AlertTriangle size={22} color="var(--accent-red)" /> Ghost Alerts
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>
            Passengers with mismatched portal vs local status — potential compliance risks
          </p>
        </div>
        <button onClick={load} className="btn btn-outline" style={{ padding: "8px 14px", fontSize: 13 }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Stats Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
        <StatMini icon={<ShieldAlert size={18} />} label="Critical" value={criticalCount} color="#ef4444" />
        <StatMini icon={<AlertTriangle size={18} />} label="High" value={highCount} color="#f59e0b" />
        <StatMini icon={<Eye size={18} />} label="Open" value={openCount} color="#6366f1" />
        <StatMini icon={<CheckCircle size={18} />} label="Resolved" value={resolvedCount} color="#22c55e" />
      </div>

      {/* Scraper Status Bar */}
      {scraperStatus && (
        <div style={{
          display: "flex", alignItems: "center", gap: 20, padding: "12px 20px",
          background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: 10, marginBottom: 20, fontSize: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Activity size={14} color={scraperStatus.circuitBreaker.state === "CLOSED" ? "#22c55e" : scraperStatus.circuitBreaker.state === "OPEN" ? "#ef4444" : "#f59e0b"} />
            <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>ICP Portal:</span>
            <span style={{
              padding: "2px 8px", borderRadius: 4, fontWeight: 600, fontSize: 11,
              background: scraperStatus.circuitBreaker.state === "CLOSED" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
              color: scraperStatus.circuitBreaker.state === "CLOSED" ? "#22c55e" : "#ef4444",
            }}>{scraperStatus.circuitBreaker.state}</span>
          </div>
          <span style={{ color: "var(--text-muted)" }}>|</span>
          <span style={{ color: "var(--text-muted)" }}>
            Spot-checks: <strong style={{ color: "var(--text-primary)" }}>{scraperStatus.rateLimiter.remaining}/{scraperStatus.rateLimiter.maxPerHour}</strong> remaining
          </span>
          <span style={{ color: "var(--text-muted)" }}>|</span>
          <span style={{ color: "var(--text-muted)" }}>
            Failures: {scraperStatus.circuitBreaker.failureCount}/{scraperStatus.circuitBreaker.maxFailures}
          </span>
          {scraperStatus.circuitBreaker.timeUntilRetry && (
            <>
              <span style={{ color: "var(--text-muted)" }}>|</span>
              <span style={{ color: "#f59e0b" }}>Retry in {scraperStatus.circuitBreaker.timeUntilRetry}</span>
            </>
          )}
        </div>
      )}

      {/* Filter Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "var(--bg-card)", borderRadius: 8, padding: 3, border: "1px solid var(--border-color)", width: "fit-content" }}>
        {["ALL", "OPEN", "CRITICAL", "RESOLVED"].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
              background: filter === f ? "var(--accent-primary)" : "transparent",
              color: filter === f ? "#fff" : "var(--text-secondary)",
              transition: "all 0.2s",
            }}>
            {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {/* Ghost Table */}
      <div className="card" style={{ overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 60, textAlign: "center" }}><div className="spinner" style={{ margin: "0 auto" }} /></div>
        ) : ghosts.length === 0 ? (
          <div style={{ padding: 80, textAlign: "center" }}>
            <ShieldCheck size={48} color="var(--accent-emerald)" style={{ margin: "0 auto 16px" }} />
            <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>All Clear!</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No ghost alerts match the current filter.</p>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                {["Severity", "Passenger", "Score", "Status", "Hours Since Exit", "Detected", "Actions"].map((h) => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ghosts.map((g) => (
                <tr key={g.id} style={{ borderBottom: "1px solid var(--border-color)", background: g.riskLevel === "CRITICAL" && g.status === "OPEN" ? "rgba(239,68,68,0.03)" : "transparent" }}>
                  <td style={{ padding: "12px" }}>
                    <span style={{
                      padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                      background: g.riskLevel === "CRITICAL" ? "rgba(239,68,68,0.12)" : g.riskLevel === "HIGH" ? "rgba(245,158,11,0.12)" : "rgba(99,102,241,0.12)",
                      color: g.riskLevel === "CRITICAL" ? "#ef4444" : g.riskLevel === "HIGH" ? "#f59e0b" : "#6366f1",
                    }}>{g.riskLevel}</span>
                  </td>
                  <td style={{ padding: "12px" }}>
                    <p style={{ fontWeight: 600, fontSize: 13 }}>{g.application?.passenger?.fullName || "Unknown"}</p>
                    <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {g.application?.passenger?.passportNumber?.substring(0, 3)}*** · {g.application?.passenger?.nationality}
                    </p>
                  </td>
                  <td style={{ padding: "12px" }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: g.ghostScore >= 80 ? "#ef4444" : g.ghostScore >= 60 ? "#f59e0b" : "#6366f1" }}>
                      {g.ghostScore || "—"}
                    </span>
                  </td>
                  <td style={{ padding: "12px" }}>
                    <span style={{
                      padding: "3px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                      background: g.status === "OPEN" ? "rgba(239,68,68,0.1)" : g.status === "ACKNOWLEDGED" ? "rgba(245,158,11,0.1)" : "rgba(34,197,94,0.1)",
                      color: g.status === "OPEN" ? "#ef4444" : g.status === "ACKNOWLEDGED" ? "#f59e0b" : "#22c55e",
                    }}>{g.status}</span>
                  </td>
                  <td style={{ padding: "12px", fontWeight: 600, color: g.hoursSinceExit > 72 ? "#ef4444" : "var(--text-primary)" }}>
                    {g.hoursSinceExit ? `${g.hoursSinceExit}h` : "—"}
                  </td>
                  <td style={{ padding: "12px", fontSize: 11, color: "var(--text-muted)" }}>
                    {g.createdAt ? new Date(g.createdAt).toLocaleDateString("en-AE", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </td>
                  <td style={{ padding: "12px" }}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <ActionBtn title="View Details" icon={<Eye size={14} />} color="var(--accent-blue)" onClick={() => setSelectedGhost(g)} />
                      {g.status === "OPEN" && (
                        <>
                          <ActionBtn title="Acknowledge" icon={<ShieldAlert size={14} />} color="#f59e0b" onClick={() => handleAcknowledge(g.id)} />
                          <ActionBtn title="Spot Check" icon={<Zap size={14} />} color="#6366f1"
                            onClick={() => handleSpotCheck(g.id)} loading={spotCheckLoading === g.id} />
                          <ActionBtn title="Resolve" icon={<CheckCircle size={14} />} color="#22c55e" onClick={() => { setResolveModal(g); setResolveNotes(""); }} />
                          <ActionBtn title="False Positive" icon={<XCircle size={14} />} color="var(--text-muted)" onClick={() => handleFalsePositive(g.id)} />
                        </>
                      )}
                      {g.status === "ACKNOWLEDGED" && (
                        <>
                          <ActionBtn title="Spot Check" icon={<Zap size={14} />} color="#6366f1"
                            onClick={() => handleSpotCheck(g.id)} loading={spotCheckLoading === g.id} />
                          <ActionBtn title="Resolve" icon={<CheckCircle size={14} />} color="#22c55e" onClick={() => { setResolveModal(g); setResolveNotes(""); }} />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Spot Check Result Toast */}
      {spotCheckResult && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, width: 400, padding: 20, borderRadius: 12, zIndex: 200,
          background: "var(--bg-card)", border: "1px solid var(--border-color)", boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
        }} className="fade-in">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h4 style={{ fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
              <Zap size={16} color="#6366f1" /> Spot Check Result
            </h4>
            <button onClick={() => setSpotCheckResult(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>✕</button>
          </div>
          <div style={{
            padding: "10px 14px", borderRadius: 8, fontSize: 13,
            background: spotCheckResult.status === "SUCCESS" ? "rgba(34,197,94,0.08)" : spotCheckResult.status === "CAPTCHA_REQUIRED" ? "rgba(245,158,11,0.08)" : "rgba(239,68,68,0.08)",
            border: `1px solid ${spotCheckResult.status === "SUCCESS" ? "rgba(34,197,94,0.2)" : spotCheckResult.status === "CAPTCHA_REQUIRED" ? "rgba(245,158,11,0.2)" : "rgba(239,68,68,0.2)"}`,
          }}>
            <p style={{ fontWeight: 600, marginBottom: 4, color: spotCheckResult.status === "SUCCESS" ? "#22c55e" : spotCheckResult.status === "CAPTCHA_REQUIRED" ? "#f59e0b" : "#ef4444" }}>
              {spotCheckResult.status}
            </p>
            <p style={{ color: "var(--text-secondary)", fontSize: 12 }}>{spotCheckResult.message}</p>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedGhost && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div className="card fade-in" style={{ width: 520, padding: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                <ShieldAlert size={18} color="var(--accent-red)" /> Ghost Alert Details
              </h2>
              <button onClick={() => setSelectedGhost(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 18 }}>✕</button>
            </div>
            {[
              ["Passenger", selectedGhost.application?.passenger?.fullName || "Unknown"],
              ["Passport", selectedGhost.application?.passenger?.passportNumber || "—"],
              ["Company", selectedGhost.application?.passenger?.sponsorCompany || "—"],
              ["Risk Level", selectedGhost.riskLevel],
              ["Ghost Score", `${selectedGhost.ghostScore || 0}/100`],
              ["Hours Since Exit", `${selectedGhost.hoursSinceExit || 0}h`],
              ["Last Known Location", selectedGhost.lastKnownLocation || "—"],
              ["Suggested Action", selectedGhost.suggestedAction || "Review required"],
              ["Status", selectedGhost.status],
              ["Detected", selectedGhost.createdAt ? new Date(selectedGhost.createdAt).toLocaleString() : "—"],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border-color)" }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, maxWidth: 260, textAlign: "right" }}>{value}</span>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              <button onClick={() => setSelectedGhost(null)} className="btn btn-outline" style={{ flex: 1, fontSize: 13 }}>Close</button>
              {selectedGhost.status !== "RESOLVED" && selectedGhost.status !== "FALSE_POSITIVE" && (
                <button onClick={() => { setResolveModal(selectedGhost); setSelectedGhost(null); }} className="btn btn-primary" style={{ flex: 1, fontSize: 13 }}>
                  <CheckCircle size={14} /> Resolve
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Resolve Modal */}
      {resolveModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div className="card fade-in" style={{ width: 440, padding: 28 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <CheckCircle size={18} color="#22c55e" /> Resolve Alert
            </h2>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
              Resolving alert for <strong>{resolveModal.application?.passenger?.fullName}</strong>
            </p>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>Resolution Notes *</label>
            <textarea
              value={resolveNotes} onChange={(e) => setResolveNotes(e.target.value)}
              placeholder="e.g., Confirmed exit via airport records, PRO verified departure..."
              rows={3}
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border-color)",
                background: "var(--bg-body)", color: "var(--text-primary)", fontSize: 13, resize: "vertical", boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => setResolveModal(null)} className="btn btn-outline" style={{ flex: 1, fontSize: 13 }}>Cancel</button>
              <button onClick={handleResolveSubmit} className="btn btn-primary" style={{ flex: 1, fontSize: 13 }} disabled={!resolveNotes.trim()}>
                <CheckCircle size={14} /> Confirm Resolve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════ SUB-COMPONENTS ═══════

function StatMini({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
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

function ActionBtn({ title, icon, color, onClick, loading }: { title: string; icon: React.ReactNode; color: string; onClick: () => void; loading?: boolean }) {
  return (
    <button
      title={title} onClick={onClick} disabled={loading}
      style={{
        background: "none", border: "1px solid var(--border-color)", borderRadius: 6, cursor: "pointer",
        color, padding: "4px 6px", display: "flex", alignItems: "center", opacity: loading ? 0.5 : 1,
        transition: "all 0.15s",
      }}
    >
      {loading ? <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} /> : icon}
    </button>
  );
}
