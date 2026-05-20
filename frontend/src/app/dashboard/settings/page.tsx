"use client";
import { useEffect, useState } from "react";
import {
  Settings, Shield, Activity, RefreshCw, Database,
  Wifi, WifiOff, CheckCircle, AlertTriangle, Clock, Server,
} from "lucide-react";
import { adminAPI } from "@/lib/api";

export default function SettingsPage() {
  const [health, setHealth] = useState<any>(null);
  const [scraperStatus, setScraperStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [healthRes, scraperRes] = await Promise.allSettled([
        adminAPI.getSystemHealth(),
        adminAPI.getScraperStatus(),
      ]);
      if (healthRes.status === "fulfilled") setHealth(healthRes.value.data.data || healthRes.value.data);
      if (scraperRes.status === "fulfilled") setScraperStatus(scraperRes.value.data.data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleResetBreaker = async () => {
    if (!confirm("Reset the ICP portal circuit breaker? This will re-enable portal spot-checks.")) return;
    setResetting(true);
    try {
      await adminAPI.resetCircuitBreaker();
      await load();
    } catch { alert("Failed to reset circuit breaker"); }
    setResetting(false);
  };

  if (loading) {
    return (
      <div style={{ padding: 80, textAlign: "center" }}>
        <div className="spinner" style={{ margin: "0 auto" }} />
        <p style={{ marginTop: 16, color: "var(--text-muted)", fontSize: 14 }}>Loading system status...</p>
      </div>
    );
  }

  const db = health?.services?.database;
  const redis = health?.services?.redis;
  const freshness = health?.dataFreshness;
  const cb = scraperStatus?.circuitBreaker;
  const rl = scraperStatus?.rateLimiter;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}>
          <Settings size={22} color="#6366f1" /> System Settings
        </h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>
          Infrastructure health, ICP portal status, and system configuration
        </p>
      </div>

      {/* Infrastructure Health */}
      <SectionTitle icon={<Server size={16} />} title="Infrastructure Health" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 28 }}>
        <HealthCard
          title="PostgreSQL" status={db === "UP" ? "healthy" : "down"}
          icon={<Database size={18} />}
          details={db === "UP" ? "Connected & responsive" : "Connection failed"}
        />
        <HealthCard
          title="Redis Cache" status={redis === "UP" ? "healthy" : redis === "MEMORY_FALLBACK" ? "degraded" : "down"}
          icon={redis === "UP" ? <Wifi size={18} /> : <WifiOff size={18} />}
          details={redis === "UP" ? "Connected & responsive" : redis === "MEMORY_FALLBACK" ? "Using in-memory fallback" : "Unavailable"}
        />
        <HealthCard
          title="API Server" status="healthy"
          icon={<Activity size={18} />}
          details={`Uptime: ${health?.uptime ? Math.round(health.uptime / 60) + "m" : "—"}`}
        />
      </div>

      {/* Data Freshness */}
      <SectionTitle icon={<Clock size={16} />} title="Data Freshness" />
      <div className="card" style={{ padding: 20, marginBottom: 28 }}>
        {freshness ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
            <FreshnessItem label="Freshness Score" value={`${freshness.freshnessPercent || 0}%`} color={
              (freshness.freshnessPercent || 0) >= 80 ? "#22c55e" : (freshness.freshnessPercent || 0) >= 50 ? "#f59e0b" : "#ef4444"
            } />
            <FreshnessItem label="Total Records" value={String(freshness.totalRecords || 0)} color="#6366f1" />
            <FreshnessItem label="Verified (7d)" value={String(freshness.verifiedRecent || 0)} color="#22c55e" />
          </div>
        ) : (
          <p style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>No freshness data available</p>
        )}
      </div>

      {/* ICP Portal / Circuit Breaker */}
      <SectionTitle icon={<Shield size={16} />} title="ICP Portal — Circuit Breaker" />
      <div className="card" style={{ padding: 20, marginBottom: 28 }}>
        {cb ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}>
              <div>
                <p style={{ fontSize: 11, color: "var(--text-muted)" }}>State</p>
                <p style={{
                  fontSize: 16, fontWeight: 700, marginTop: 4,
                  color: cb.state === "CLOSED" ? "#22c55e" : cb.state === "OPEN" ? "#ef4444" : "#f59e0b",
                }}>{cb.state}</p>
              </div>
              <div>
                <p style={{ fontSize: 11, color: "var(--text-muted)" }}>Failures</p>
                <p style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>{cb.failureCount}/{cb.maxFailures}</p>
              </div>
              <div>
                <p style={{ fontSize: 11, color: "var(--text-muted)" }}>Retry In</p>
                <p style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>{cb.timeUntilRetry || "N/A"}</p>
              </div>
              <div>
                <p style={{ fontSize: 11, color: "var(--text-muted)" }}>Total Requests</p>
                <p style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>{cb.stats?.totalRequests || 0}</p>
              </div>
            </div>
            {rl && (
              <div style={{ display: "flex", gap: 20, padding: "12px 0", borderTop: "1px solid var(--border-color)", fontSize: 12, color: "var(--text-muted)" }}>
                <span>Spot-checks this hour: <strong style={{ color: "var(--text-primary)" }}>{rl.checksThisHour}/{rl.maxPerHour}</strong></span>
                <span>Remaining: <strong style={{ color: "var(--text-primary)" }}>{rl.remaining}</strong></span>
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <button onClick={handleResetBreaker} className="btn btn-outline" style={{ fontSize: 12, padding: "6px 14px" }} disabled={resetting || cb.state === "CLOSED"}>
                {resetting ? <><RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} /> Resetting...</> : <><RefreshCw size={12} /> Reset Circuit Breaker</>}
              </button>
              {cb.state === "CLOSED" && <span style={{ marginLeft: 10, fontSize: 11, color: "#22c55e" }}>✓ Portal healthy, no reset needed</span>}
            </div>
          </>
        ) : (
          <p style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>Scraper status unavailable</p>
        )}
      </div>

      {/* System Info */}
      <SectionTitle icon={<Settings size={16} />} title="System Configuration" />
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
          {[
            ["Environment", process.env.NODE_ENV || "production"],
            ["API Base URL", "http://localhost:3000/api/v1"],
            ["Frontend Port", "3001"],
            ["Database", "PostgreSQL (Prisma ORM)"],
            ["Cache Layer", "Redis + In-Memory Fallback"],
            ["Queue System", "BullMQ + Scheduler"],
            ["Scraper Engine", "Playwright (ICP Portal)"],
            ["Report Format", "PDF (pdfkit) + Excel (exceljs)"],
            ["Auth", "JWT (Access + Refresh tokens)"],
            ["Encryption", "AES-256-CBC (PII at rest)"],
          ].map(([key, value]) => (
            <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid var(--border-color)" }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{key}</span>
              <span style={{ fontSize: 12, fontWeight: 500, fontFamily: "monospace", color: "var(--text-primary)" }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Refresh */}
      <div style={{ textAlign: "center", marginTop: 20 }}>
        <button onClick={load} className="btn btn-outline" style={{ fontSize: 12, padding: "6px 14px" }}>
          <RefreshCw size={12} /> Refresh All Status
        </button>
      </div>
    </div>
  );
}

// ═══════ SUB-COMPONENTS ═══════

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14, display: "flex", alignItems: "center", gap: 8, color: "var(--text-primary)" }}>
      {icon} {title}
    </h2>
  );
}

function HealthCard({ title, status, icon, details }: { title: string; status: "healthy" | "degraded" | "down"; icon: React.ReactNode; details: string }) {
  const colors = { healthy: "#22c55e", degraded: "#f59e0b", down: "#ef4444" };
  const c = colors[status];
  return (
    <div style={{
      padding: "16px 20px", borderRadius: 10, border: "1px solid var(--border-color)",
      background: "var(--bg-card)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ color: c }}>{icon}</div>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: c }} />
        <span style={{ fontSize: 12, color: c, fontWeight: 600, textTransform: "uppercase" }}>{status}</span>
      </div>
      <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>{details}</p>
    </div>
  );
}

function FreshnessItem({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <p style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 700, color, marginTop: 4 }}>{value}</p>
    </div>
  );
}
