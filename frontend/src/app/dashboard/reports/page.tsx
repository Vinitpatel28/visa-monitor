"use client";
import { useState } from "react";
import {
  BarChart3, FileSpreadsheet, FileText, Download,
  CheckCircle, AlertTriangle, Loader,
} from "lucide-react";
import { reportsAPI } from "@/lib/api";

interface ReportCard {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  type: "excel" | "pdf";
  fetcher: () => Promise<any>;
  filename: string;
}

export default function ReportsPage() {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const reports: ReportCard[] = [
    {
      id: "visa-status-excel",
      title: "Visa Status Report",
      description: "Complete list of all passengers with their current visa status, expiry dates, and sponsor information.",
      icon: <FileSpreadsheet size={24} />,
      color: "var(--accent-emerald)",
      type: "excel",
      fetcher: reportsAPI.downloadVisaStatus,
      filename: "visa-status-report.xlsx",
    },
    {
      id: "ghost-excel",
      title: "Ghost Passenger Report",
      description: "Detailed list of all ghost passengers with discrepancy analysis, severity levels, and recommended actions.",
      icon: <AlertTriangle size={24} />,
      color: "var(--accent-red)",
      type: "excel",
      fetcher: reportsAPI.downloadGhostReport,
      filename: "ghost-passenger-report.xlsx",
    },
    {
      id: "compliance-pdf",
      title: "Compliance Summary (PDF)",
      description: "Executive summary PDF with compliance metrics, visa statistics, and ghost detection overview for management.",
      icon: <FileText size={24} />,
      color: "var(--accent-blue)",
      type: "pdf",
      fetcher: reportsAPI.downloadCompliancePDF,
      filename: "compliance-summary.pdf",
    },
    {
      id: "ghost-pdf",
      title: "Ghost Alert Summary (PDF)",
      description: "Printable PDF report of all critical and high-severity ghost alerts for compliance officers.",
      icon: <FileText size={24} />,
      color: "var(--accent-amber)",
      type: "pdf",
      fetcher: reportsAPI.downloadGhostPDF,
      filename: "ghost-alert-summary.pdf",
    },
    {
      id: "reconciliation-pdf",
      title: "Reconciliation Report (PDF)",
      description: "Executive summary of all reconciliation jobs, mismatch history, open items, and resolution rates.",
      icon: <FileText size={24} />,
      color: "var(--accent-purple)",
      type: "pdf",
      fetcher: reportsAPI.downloadReconciliationPDF,
      filename: "reconciliation-report.pdf",
    },
    {
      id: "import-activity-pdf",
      title: "Import Activity (PDF)",
      description: "Audit trail of all CSV/Excel imports — records processed, match rates, and error summary.",
      icon: <FileText size={24} />,
      color: "var(--accent-cyan)",
      type: "pdf",
      fetcher: reportsAPI.downloadImportActivityPDF,
      filename: "import-activity-report.pdf",
    },
  ];

  const handleDownload = async (report: ReportCard) => {
    setDownloading(report.id);
    setSuccess(null);

    try {
      const res = await report.fetcher();
      const blob = new Blob([res.data], {
        type: report.type === "excel"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/pdf",
      });

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = report.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      setSuccess(report.id);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      alert("Download failed. Make sure the backend server is running.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}>
          <BarChart3 size={24} color="var(--accent-cyan)" /> Reports
        </h1>
        <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 4 }}>
          Generate and download Excel & PDF reports for compliance and management
        </p>
      </div>

      {/* Report cards grid */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
        gap: 20,
      }}>
        {reports.map((report) => (
          <div key={report.id} className="glass-card" style={{ padding: 28, display: "flex", flexDirection: "column" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 12,
                background: `${report.color}15`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: report.color,
              }}>
                {report.icon}
              </div>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 600 }}>{report.title}</h3>
                <span style={{
                  display: "inline-block", marginTop: 4,
                  padding: "2px 8px", borderRadius: 4, fontSize: 11,
                  background: "var(--bg-secondary)", color: "var(--text-muted)",
                  textTransform: "uppercase", fontWeight: 600,
                }}>
                  {report.type}
                </span>
              </div>
            </div>

            {/* Description */}
            <p style={{
              fontSize: 13, color: "var(--text-secondary)",
              lineHeight: 1.6, flex: 1, marginBottom: 20,
            }}>
              {report.description}
            </p>

            {/* Download button */}
            <button
              onClick={() => handleDownload(report)}
              disabled={downloading === report.id}
              className={`btn ${success === report.id ? "" : "btn-primary"}`}
              style={{
                width: "100%",
                background: success === report.id ? "var(--accent-emerald)" : undefined,
                color: success === report.id ? "white" : undefined,
              }}
            >
              {downloading === report.id ? (
                <>
                  <Loader size={16} className="spinner" style={{ border: "none", animation: "spin 0.8s linear infinite" }} />
                  Generating...
                </>
              ) : success === report.id ? (
                <>
                  <CheckCircle size={16} />
                  Downloaded!
                </>
              ) : (
                <>
                  <Download size={16} />
                  Download {report.type.toUpperCase()}
                </>
              )}
            </button>
          </div>
        ))}
      </div>

      {/* Info bar */}
      <div className="glass-card" style={{
        marginTop: 28, padding: 20,
        display: "flex", alignItems: "center", gap: 12,
        fontSize: 13, color: "var(--text-muted)",
      }}>
        <AlertTriangle size={16} color="var(--accent-amber)" />
        Reports are generated from live database data. Make sure the backend API is running at{" "}
        <code style={{
          background: "var(--bg-secondary)", padding: "2px 8px",
          borderRadius: 4, fontSize: 12, color: "var(--accent-cyan)",
        }}>
          localhost:3000
        </code>{" "}
        before downloading.
      </div>
    </div>
  );
}
