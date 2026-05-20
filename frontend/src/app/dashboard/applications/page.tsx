"use client";
import { useEffect, useState } from "react";
import { FileText, Search, RefreshCw, Clock, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { applicationsAPI } from "@/lib/api";

const statusColors: Record<string, string> = {
  PENDING: "pending", SUBMITTED: "pending", APPROVED: "active",
  ACTIVE: "active", REJECTED: "expired", EXPIRED: "expired", CANCELLED: "cancelled",
};

export default function ApplicationsPage() {
  const [apps, setApps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await applicationsAPI.getAll();
      setApps(res.data.data || []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const filtered = apps.filter((a) => {
    const matchSearch =
      a.passenger?.fullName?.toLowerCase().includes(search.toLowerCase()) ||
      a.visaType?.toLowerCase().includes(search.toLowerCase()) ||
      a.applicationNumber?.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "ALL" || a.status === filter;
    return matchSearch && matchFilter;
  });

  const statusIcon = (status: string) => {
    switch (status) {
      case "APPROVED": case "ACTIVE": return <CheckCircle size={14} />;
      case "REJECTED": case "EXPIRED": return <XCircle size={14} />;
      case "PENDING": case "SUBMITTED": return <Clock size={14} />;
      default: return <AlertCircle size={14} />;
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}>
            <FileText size={24} color="var(--accent-purple)" /> Visa Applications
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 4 }}>
            Track all visa applications and their processing status
          </p>
        </div>
        <button onClick={load} className="btn btn-outline" style={{ padding: "8px 14px" }}>
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 240 }}>
          <Search size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
          <input className="input-field" placeholder="Search applications..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 40 }} />
        </div>
        {["ALL", "PENDING", "APPROVED", "ACTIVE", "REJECTED", "EXPIRED"].map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`btn ${filter === s ? "btn-primary" : "btn-outline"}`}
            style={{ padding: "8px 16px", fontSize: 12 }}>
            {s}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="glass-card" style={{ overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 60, textAlign: "center" }}><div className="spinner" style={{ margin: "0 auto" }} /></div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>No applications found</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Application #</th>
                <th>Passenger</th>
                <th>Visa Type</th>
                <th>Submitted</th>
                <th>Expiry</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a: any) => (
                <tr key={a.id}>
                  <td style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 600 }}>
                    {a.applicationNumber || a.id?.substring(0, 8)}
                  </td>
                  <td>{a.passenger?.fullName || "—"}</td>
                  <td>
                    <span style={{
                      padding: "4px 10px", borderRadius: 6, fontSize: 12,
                      background: "var(--bg-secondary)", color: "var(--text-secondary)",
                    }}>
                      {a.visaType || "Standard"}
                    </span>
                  </td>
                  <td style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    {a.submittedAt ? new Date(a.submittedAt).toLocaleDateString() : "—"}
                  </td>
                  <td style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    {a.expiryDate ? new Date(a.expiryDate).toLocaleDateString() : "—"}
                  </td>
                  <td>
                    <span className={`badge badge-${statusColors[a.status] || "pending"}`}
                      style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      {statusIcon(a.status)}
                      {a.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
