"use client";
import { useEffect, useState } from "react";
import {
  Users, FileText, AlertTriangle, CheckCircle,
  TrendingUp, Clock, ShieldAlert, Globe, Upload, Database,
} from "lucide-react";
import { passengersAPI, applicationsAPI, ghostsAPI, adminAPI } from "@/lib/api";

interface DashboardStats {
  totalPassengers: number;
  totalApplications: number;
  ghostAlerts: number;
  activeVisas: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalPassengers: 0, totalApplications: 0, ghostAlerts: 0, activeVisas: 0,
  });
  const [passengers, setPassengers] = useState<any[]>([]);
  const [ghosts, setGhosts] = useState<any[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      const [passRes, appRes, ghostRes, healthRes] = await Promise.allSettled([
        passengersAPI.getAll(),
        applicationsAPI.getAll(),
        ghostsAPI.getAll(),
        adminAPI.getSystemHealth(),
      ]);

      const pass = passRes.status === "fulfilled" ? passRes.value.data.data : [];
      const apps = appRes.status === "fulfilled" ? appRes.value.data.data : [];
      const gho = ghostRes.status === "fulfilled" ? ghostRes.value.data.data : [];
      if (healthRes.status === "fulfilled") setHealth(healthRes.value.data.data);

      setPassengers(pass.slice(0, 5));
      setGhosts(gho);

      setStats({
        totalPassengers: pass.length,
        totalApplications: apps.length,
        ghostAlerts: gho.length,
        activeVisas: apps.filter((a: any) => a.status === "APPROVED" || a.status === "ACTIVE").length,
      });
    } catch { /* silently handle */ }
    setLoading(false);
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
        <div className="spinner" style={{ width: 40, height: 40 }} />
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Dashboard</h1>
      <p style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 28 }}>
        Welcome back — here is your visa operations summary.
      </p>

      {/* Stat cards */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 20, marginBottom: 32,
      }}>
        <StatCard
          icon={<Users size={22} />}
          label="Total Passengers"
          value={stats.totalPassengers}
          color="blue"
        />
        <StatCard
          icon={<FileText size={22} />}
          label="Visa Applications"
          value={stats.totalApplications}
          color="purple"
        />
        <StatCard
          icon={<CheckCircle size={22} />}
          label="Active Visas"
          value={stats.activeVisas}
          color="green"
        />
        <StatCard
          icon={<AlertTriangle size={22} />}
          label="Ghost Alerts"
          value={stats.ghostAlerts}
          color="red"
          pulse={stats.ghostAlerts > 0}
        />
      </div>

      {/* Two-column layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Recent Passengers */}
        <div className="glass-card" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <Globe size={18} color="var(--accent-cyan)" />
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>Recent Passengers</h2>
          </div>

          {passengers.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: 14 }}>No passengers found</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {passengers.map((p: any) => (
                <div key={p.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "12px 16px", background: "var(--bg-secondary)",
                  borderRadius: 10, border: "1px solid var(--border-color)",
                }}>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600 }}>{p.fullName}</p>
                    <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {p.nationality} · {p.passportNumber?.substring(0, 3)}***
                    </p>
                  </div>
                  <span className={`badge badge-${
                    p.visaApplications?.[0]?.status === "IN_COUNTRY" || p.visaApplications?.[0]?.status === "ACTIVE" ? "active"
                      : p.visaApplications?.[0]?.status === "EXITED" ? "expired"
                        : "medium"
                  }`}>
                    {p.visaApplications?.[0]?.status || "PENDING"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Ghost Alerts */}
        <div className="glass-card" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <ShieldAlert size={18} color="var(--accent-red)" />
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>Ghost Alerts</h2>
            {ghosts.length > 0 && (
              <span className="badge badge-critical" style={{ marginLeft: "auto" }}>
                {ghosts.length} Active
              </span>
            )}
          </div>

          {ghosts.length === 0 ? (
            <div style={{
              textAlign: "center", padding: 40, color: "var(--text-muted)", fontSize: 14,
            }}>
              <CheckCircle size={40} color="var(--accent-emerald)" style={{ margin: "0 auto 12px" }} />
              <p>No ghost passengers detected</p>
              <p style={{ fontSize: 12, marginTop: 4 }}>All records are reconciled</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {ghosts.slice(0, 5).map((g: any) => (
                <div
                  key={g.id}
                  className={g.riskLevel === "CRITICAL" ? "alert-pulse" : ""}
                  style={{
                    padding: "12px 16px",
                    background: g.riskLevel === "CRITICAL"
                      ? "rgba(239, 68, 68, 0.08)"
                      : "var(--bg-secondary)",
                    borderRadius: 10,
                    border: `1px solid ${g.riskLevel === "CRITICAL" ? "rgba(239, 68, 68, 0.3)" : "var(--border-color)"}`,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <p style={{ fontSize: 13, fontWeight: 600 }}>
                      {g.application?.passenger?.fullName || g.application?.id?.substring(0, 8)}
                    </p>
                    <span className={`badge badge-${g.riskLevel?.toLowerCase() || "medium"}`}>
                      {g.riskLevel || "MEDIUM"}
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                    {g.suggestedAction || "Status mismatch detected"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* System Health & Data Freshness Bar */}
      <div className="glass-card" style={{
        marginTop: 24, padding: 20,
        display: "flex", alignItems: "center", justifyContent: "space-around",
      }}>
        <QuickStat icon={<TrendingUp size={16} />} label="System Status" value={health?.status === "healthy" ? "Online" : "Degraded"} color={health?.status === "healthy" ? "var(--accent-emerald)" : "#f59e0b"} />
        <div style={{ width: 1, height: 32, background: "var(--border-color)" }} />
        <QuickStat icon={<Database size={16} />} label="Data Freshness" value={health?.dataFreshness ? `${health.dataFreshness.freshnessScore}%` : "—"} color="var(--accent-blue)" />
        <div style={{ width: 1, height: 32, background: "var(--border-color)" }} />
        <QuickStat icon={<Upload size={16} />} label="Last Import" value={health?.lastImport ? new Date(health.lastImport.createdAt).toLocaleDateString("en-AE", { month: "short", day: "numeric" }) : "None"} color="var(--accent-cyan)" />
        <div style={{ width: 1, height: 32, background: "var(--border-color)" }} />
        <QuickStat icon={<Globe size={16} />} label="Portal" value="ICP Smart Services" color="var(--accent-purple)" />
      </div>
    </div>
  );
}

// ========================
// SUB-COMPONENTS
// ========================
function StatCard({ icon, label, value, color, pulse }: any) {
  return (
    <div className={`stat-card ${color} ${pulse ? "alert-pulse" : ""}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>{label}</p>
          <p style={{ fontSize: 32, fontWeight: 800, lineHeight: 1 }}>{value}</p>
        </div>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: `color-mix(in srgb, var(--accent-${color}) 15%, transparent)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: `var(--accent-${color})`,
        }}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function QuickStat({ icon, label, value, color }: any) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ color }}>{icon}</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
      </div>
      <p style={{ fontSize: 14, fontWeight: 600, color }}>{value}</p>
    </div>
  );
}
