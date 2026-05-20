"use client";
import { useEffect, useState } from "react";
import { Users, Plus, Search, RefreshCw, Trash2, X } from "lucide-react";
import { passengersAPI } from "@/lib/api";

export default function PassengersPage() {
  const [passengers, setPassengers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    fullName: "", passportNumber: "", nationality: "",
    dateOfBirth: "", sponsorCompany: "", fileNumber: "",
  });

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await passengersAPI.getAll();
      setPassengers(res.data.data || []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await passengersAPI.create(form);
      setShowForm(false);
      setForm({ fullName: "", passportNumber: "", nationality: "", dateOfBirth: "", sponsorCompany: "", fileNumber: "" });
      load();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || "Failed to create passenger");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this passenger?")) return;
    try {
      await passengersAPI.delete(id);
      load();
    } catch { /* ignore */ }
  };

  const filtered = passengers.filter((p) =>
    p.fullName?.toLowerCase().includes(search.toLowerCase()) ||
    p.passportNumber?.toLowerCase().includes(search.toLowerCase()) ||
    p.nationality?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}>
            <Users size={24} color="var(--accent-blue)" /> Passengers
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 4 }}>
            Manage passport holders and sponsored individuals
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={load} className="btn btn-outline" style={{ padding: "8px 14px" }}>
            <RefreshCw size={16} />
          </button>
          <button onClick={() => setShowForm(true)} className="btn btn-primary">
            <Plus size={16} /> Add Passenger
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={{ position: "relative", marginBottom: 20 }}>
        <Search size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
        <input
          className="input-field"
          placeholder="Search by name, passport, or nationality..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ paddingLeft: 40 }}
        />
      </div>

      {/* Table */}
      <div className="glass-card" style={{ overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 60, textAlign: "center" }}><div className="spinner" style={{ margin: "0 auto" }} /></div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>
            No passengers found
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Passport</th>
                <th>Nationality</th>
                <th>File Number</th>
                <th>Sponsor</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p: any) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.fullName}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 13 }}>{p.passportNumber}</td>
                  <td>{p.nationality}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 13 }}>{p.visaApplications?.[0]?.visaNumber || "—"}</td>
                  <td>{p.sponsorCompany || "—"}</td>
                  <td>
                    <span className={`badge badge-${
                      p.visaApplications?.[0]?.status === "IN_COUNTRY" || p.visaApplications?.[0]?.status === "ACTIVE" ? "active"
                        : p.visaApplications?.[0]?.status === "EXITED" ? "expired"
                          : "medium"
                    }`}>
                      {p.visaApplications?.[0]?.status || "PENDING"}
                    </span>
                  </td>
                  <td>
                    <button onClick={() => handleDelete(p.id)} style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: "var(--accent-red)", padding: 4,
                    }}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal: Add Passenger */}
      {showForm && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
        }}>
          <div className="glass-card fade-in" style={{ width: 460, padding: 32 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700 }}>Add New Passenger</h2>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreate}>
              {[
                { key: "fullName", label: "Full Name", ph: "Fatima Hassan", required: true },
                { key: "passportNumber", label: "Passport Number", ph: "AB1234567", required: true },
                { key: "nationality", label: "Nationality", ph: "Egypt", required: true },
                { key: "dateOfBirth", label: "Date of Birth", ph: "1990-01-15", required: false },
                { key: "sponsorCompany", label: "Sponsor Company", ph: "Dubai Corp LLC", required: false },
                { key: "fileNumber", label: "ICP File Number", ph: "201/2024/1234567", required: false },
              ].map(({ key, label, ph, required }) => (
                <div key={key} style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 6 }}>
                    {label} {required && <span style={{ color: "var(--accent-red)" }}>*</span>}
                  </label>
                  <input
                    className="input-field"
                    placeholder={ph}
                    value={(form as any)[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    required={required}
                  />
                </div>
              ))}
              <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
                <button type="button" onClick={() => setShowForm(false)} className="btn btn-outline" style={{ flex: 1 }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  <Plus size={16} /> Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
