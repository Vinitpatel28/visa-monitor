"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { importAPI } from "@/lib/api";
import {
  Upload, FileSpreadsheet, CheckCircle, AlertTriangle,
  XCircle, Clock, Download, RefreshCw, Clipboard, Search,
} from "lucide-react";

interface ImportRecord {
  id: string;
  fileName: string;
  fileType: string;
  source: string;
  totalRecords: number;
  processedCount: number;
  matchedCount: number;
  mismatchedCount: number;
  newRecordCount: number;
  errorCount: number;
  status: string;
  createdAt: string;
  importedByUser?: { email: string };
}

interface ImportResult {
  importId: string;
  fileName: string;
  totalRecords: number;
  processed: number;
  matched: number;
  mismatched: number;
  newRecords: number;
  errors: number;
  errorDetails: string[];
  duration: string;
}

export default function ImportPage() {
  const [activeTab, setActiveTab] = useState<"upload" | "manual" | "history">("upload");
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Manual entry state
  const [manualForm, setManualForm] = useState({
    passportNumber: "", portalStatus: "Valid", fileNumber: "", expiryDate: "", notes: "",
  });
  const [manualResult, setManualResult] = useState<any>(null);
  const [manualLoading, setManualLoading] = useState(false);

  // History state
  const [history, setHistory] = useState<ImportRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await importAPI.getHistory(1, 50);
      setHistory(res.data.data.imports || []);
    } catch { /* ignore */ }
    setHistoryLoading(false);
  }, []);

  useEffect(() => {
    if (activeTab === "history") loadHistory();
  }, [activeTab, loadHistory]);

  // ═══════ FILE UPLOAD ═══════
  const handleUpload = async (file: File) => {
    setUploading(true);
    setError("");
    setUploadResult(null);
    try {
      const res = await importAPI.uploadFile(file);
      setUploadResult(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.message || "Upload failed");
    }
    setUploading(false);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  };

  // ═══════ MANUAL ENTRY ═══════
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setManualLoading(true);
    setManualResult(null);
    setError("");
    try {
      const res = await importAPI.manualEntry(manualForm);
      setManualResult(res.data.data);
      setManualForm({ passportNumber: "", portalStatus: "Valid", fileNumber: "", expiryDate: "", notes: "" });
    } catch (err: any) {
      setError(err.response?.data?.error?.message || "Manual entry failed");
    }
    setManualLoading(false);
  };

  const downloadTemplate = async () => {
    try {
      const res = await importAPI.downloadTemplate();
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = "visa_status_template.csv";
      a.click();
    } catch { /* ignore */ }
  };

  // ═══════ RENDER ═══════
  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
          Import Data
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Upload PRO status reports or manually enter ICP portal status for passengers
        </p>
      </div>

      {/* Tab Navigation */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, background: "var(--bg-card)", borderRadius: 10, padding: 4, border: "1px solid var(--border-color)", width: "fit-content" }}>
        {[
          { key: "upload" as const, label: "Upload File", icon: Upload },
          { key: "manual" as const, label: "Manual Entry", icon: Clipboard },
          { key: "history" as const, label: "Import History", icon: Clock },
        ].map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "10px 20px",
              borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
              background: activeTab === tab.key ? "var(--accent-primary)" : "transparent",
              color: activeTab === tab.key ? "#fff" : "var(--text-secondary)",
              transition: "all 0.2s",
            }}>
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══════ UPLOAD TAB ═══════ */}
      {activeTab === "upload" && (
        <div className="card" style={{ padding: 32 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>
              Upload PRO Status Report
            </h2>
            <button onClick={downloadTemplate} className="btn btn-outline" style={{ fontSize: 12, padding: "6px 14px" }}>
              <Download size={14} /> Download Template
            </button>
          </div>

          {/* Drag & Drop Zone */}
          <div
            onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed ${dragActive ? "var(--accent-primary)" : "var(--border-color)"}`,
              borderRadius: 12, padding: "48px 32px", textAlign: "center", cursor: "pointer",
              background: dragActive ? "rgba(99, 102, 241, 0.05)" : "var(--bg-body)",
              transition: "all 0.2s",
            }}>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFileChange} style={{ display: "none" }} />
            {uploading ? (
              <div>
                <RefreshCw size={40} color="var(--accent-primary)" style={{ animation: "spin 1s linear infinite", marginBottom: 12 }} />
                <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>Processing file...</p>
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Parsing records and running reconciliation</p>
              </div>
            ) : (
              <div>
                <FileSpreadsheet size={40} color="var(--accent-primary)" style={{ marginBottom: 12 }} />
                <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
                  Drop CSV/Excel file here or click to browse
                </p>
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Supports .xlsx, .xls, .csv — Max 10MB — Auto-detects columns
                </p>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div style={{ marginTop: 16, padding: 14, borderRadius: 8, background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.2)", display: "flex", gap: 10, alignItems: "center" }}>
              <XCircle size={18} color="#ef4444" />
              <span style={{ fontSize: 13, color: "#ef4444" }}>{error}</span>
            </div>
          )}

          {/* Upload Results */}
          {uploadResult && (
            <div style={{ marginTop: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <CheckCircle size={22} color="#22c55e" />
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
                  Import Complete — {uploadResult.duration}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
                {[
                  { label: "Total Records", value: uploadResult.totalRecords, color: "var(--accent-primary)" },
                  { label: "Matched", value: uploadResult.matched, color: "#22c55e" },
                  { label: "Mismatched", value: uploadResult.mismatched, color: "#f59e0b" },
                  { label: "New Records", value: uploadResult.newRecords, color: "#6366f1" },
                  { label: "Errors", value: uploadResult.errors, color: "#ef4444" },
                ].map((stat) => (
                  <div key={stat.label} style={{ background: "var(--bg-body)", borderRadius: 10, padding: 16, textAlign: "center", border: "1px solid var(--border-color)" }}>
                    <p style={{ fontSize: 24, fontWeight: 700, color: stat.color }}>{stat.value}</p>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{stat.label}</p>
                  </div>
                ))}
              </div>

              {uploadResult.mismatched > 0 && (
                <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.2)" }}>
                  <p style={{ fontSize: 13, color: "#f59e0b", fontWeight: 600 }}>
                    ⚠️ {uploadResult.mismatched} status mismatches detected — check Ghost Alerts page
                  </p>
                </div>
              )}

              {uploadResult.errorDetails.length > 0 && (
                <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: "rgba(239, 68, 68, 0.05)", border: "1px solid rgba(239, 68, 68, 0.15)" }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "#ef4444", marginBottom: 6 }}>Errors:</p>
                  {uploadResult.errorDetails.map((e, i) => (
                    <p key={i} style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>{e}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════ MANUAL ENTRY TAB ═══════ */}
      {activeTab === "manual" && (
        <div className="card" style={{ padding: 32, maxWidth: 560 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", marginBottom: 20 }}>
            Manual ICP Status Entry
          </h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
            Enter the status as shown on the ICP File Validity page for a specific passenger
          </p>

          <form onSubmit={handleManualSubmit}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={labelStyle}>Passport Number *</label>
                <input required value={manualForm.passportNumber} onChange={(e) => setManualForm({ ...manualForm, passportNumber: e.target.value })}
                  placeholder="e.g. A12345678" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>ICP Portal Status *</label>
                <select value={manualForm.portalStatus} onChange={(e) => setManualForm({ ...manualForm, portalStatus: e.target.value })} style={inputStyle}>
                  <option value="Valid">Valid</option>
                  <option value="Expired">Expired</option>
                  <option value="Cancelled">Cancelled</option>
                  <option value="Closed">Closed</option>
                  <option value="Used">Used</option>
                  <option value="Under Process">Under Process</option>
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>ICP File Number</label>
                  <input value={manualForm.fileNumber} onChange={(e) => setManualForm({ ...manualForm, fileNumber: e.target.value })}
                    placeholder="201/2024/..." style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Visa Expiry Date</label>
                  <input type="date" value={manualForm.expiryDate} onChange={(e) => setManualForm({ ...manualForm, expiryDate: e.target.value })} style={inputStyle} />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Notes</label>
                <input value={manualForm.notes} onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })}
                  placeholder="Optional notes..." style={inputStyle} />
              </div>
              <button type="submit" className="btn btn-primary" disabled={manualLoading}
                style={{ marginTop: 8, padding: "12px 24px", fontSize: 14 }}>
                <Search size={16} />
                {manualLoading ? "Saving..." : "Save ICP Status"}
              </button>
            </div>
          </form>

          {error && activeTab === "manual" && (
            <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: "rgba(239, 68, 68, 0.1)", display: "flex", gap: 8 }}>
              <XCircle size={16} color="#ef4444" />
              <span style={{ fontSize: 12, color: "#ef4444" }}>{error}</span>
            </div>
          )}

          {manualResult && (
            <div style={{ marginTop: 16, padding: 14, borderRadius: 8, border: "1px solid var(--border-color)", background: manualResult.mismatch ? "rgba(245, 158, 11, 0.06)" : "rgba(34, 197, 94, 0.06)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {manualResult.mismatch ? <AlertTriangle size={18} color="#f59e0b" /> : <CheckCircle size={18} color="#22c55e" />}
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{manualResult.message}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════ HISTORY TAB ═══════ */}
      {activeTab === "history" && (
        <div className="card" style={{ padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>Import History</h2>
            <button onClick={loadHistory} className="btn btn-outline" style={{ fontSize: 12, padding: "6px 14px" }}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>

          {historyLoading ? (
            <p style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading...</p>
          ) : history.length === 0 ? (
            <p style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No imports yet. Upload your first CSV/Excel file.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                    {["File", "Type", "Records", "Matched", "Mismatched", "New", "Errors", "Status", "Date", "By"].map((h) => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: "var(--text-muted)", fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((imp) => (
                    <tr key={imp.id} style={{ borderBottom: "1px solid var(--border-color)" }}>
                      <td style={cellStyle}>{imp.fileName}</td>
                      <td style={cellStyle}>
                        <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: imp.fileType === "CSV" ? "rgba(99, 102, 241, 0.1)" : "rgba(34, 197, 94, 0.1)", color: imp.fileType === "CSV" ? "#6366f1" : "#22c55e" }}>
                          {imp.fileType}
                        </span>
                      </td>
                      <td style={cellStyle}>{imp.totalRecords}</td>
                      <td style={{ ...cellStyle, color: "#22c55e" }}>{imp.matchedCount}</td>
                      <td style={{ ...cellStyle, color: imp.mismatchedCount > 0 ? "#f59e0b" : "var(--text-muted)" }}>{imp.mismatchedCount}</td>
                      <td style={{ ...cellStyle, color: "#6366f1" }}>{imp.newRecordCount}</td>
                      <td style={{ ...cellStyle, color: imp.errorCount > 0 ? "#ef4444" : "var(--text-muted)" }}>{imp.errorCount}</td>
                      <td style={cellStyle}>
                        <span style={{
                          padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                          background: imp.status === "COMPLETED" ? "rgba(34, 197, 94, 0.1)" : imp.status === "FAILED" ? "rgba(239, 68, 68, 0.1)" : "rgba(245, 158, 11, 0.1)",
                          color: imp.status === "COMPLETED" ? "#22c55e" : imp.status === "FAILED" ? "#ef4444" : "#f59e0b",
                        }}>{imp.status}</span>
                      </td>
                      <td style={{ ...cellStyle, fontSize: 11 }}>
                        {new Date(imp.createdAt).toLocaleDateString("en-AE", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td style={{ ...cellStyle, fontSize: 11 }}>{imp.importedByUser?.email?.split("@")[0] || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* CSS for spinner */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ═══════ SHARED STYLES ═══════
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 600,
  color: "var(--text-secondary)", marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 14px", borderRadius: 8,
  border: "1px solid var(--border-color)", background: "var(--bg-body)",
  color: "var(--text-primary)", fontSize: 13, boxSizing: "border-box",
};

const cellStyle: React.CSSProperties = {
  padding: "10px 12px", color: "var(--text-primary)",
};
