"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  Globe, Shield, Play, RefreshCw, AlertTriangle, ShieldCheck,
  Power, Clock, History, CheckCircle, XCircle, Search, HelpCircle
} from "lucide-react";
import { icpAPI } from "@/lib/api";

export default function ICPPage() {
  // Scraper status state
  const [scraperStatus, setScraperStatus] = useState<any>(null);
  // Logs history state
  const [history, setHistory] = useState<any[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Form input state
  const [passportNumber, setPassportNumber] = useState("");
  const [passportExpiry, setPassportExpiry] = useState("");
  const [nationality, setNationality] = useState("India");
  const [permitType, setPermitType] = useState<"RESIDENCY" | "VISA">("RESIDENCY");

  // Checking state
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<any>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(60);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Actions loading state
  const [resetting, setResetting] = useState(false);
  const [shuttingDown, setShuttingDown] = useState(false);

  // Common Nationalities
  const NATIONALITIES = [
    { label: "India", value: "India" },
    { label: "Egypt", value: "Egypt" },
    { label: "Pakistan", value: "Pakistan" },
    { label: "Bangladesh", value: "Bangladesh" },
    { label: "Philippines", value: "Philippines" },
    { label: "United Kingdom", value: "United Kingdom" },
    { label: "United States", value: "United States" },
    { label: "China", value: "China" },
    { label: "United Arab Emirates", value: "UAE" }
  ];

  // Load scraper status
  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await icpAPI.getStatus();
      if (res.data && res.data.success) {
        setScraperStatus(res.data.data);
      }
    } catch (err) {
      console.error("Failed to load ICP status", err);
    }
    setLoadingStatus(false);
  }, []);

  // Load check history
  const loadHistory = useCallback(async (page: number) => {
    setLoadingHistory(true);
    try {
      const res = await icpAPI.getHistory({ page, limit: 10 });
      if (res.data && res.data.success) {
        setHistory(res.data.data || []);
        if (res.data.pagination) {
          setTotalPages(res.data.pagination.totalPages || 1);
        }
      }
    } catch (err) {
      console.error("Failed to load ICP history", err);
    }
    setLoadingHistory(false);
  }, []);

  useEffect(() => {
    loadStatus();
    loadHistory(currentPage);
  }, [loadStatus, loadHistory, currentPage]);

  // Handle Reset Circuit Breaker
  const handleReset = async () => {
    setResetting(true);
    try {
      const res = await icpAPI.resetCircuitBreaker();
      if (res.data && res.data.success) {
        alert("Circuit breaker has been reset successfully!");
        loadStatus();
      }
    } catch (err) {
      alert("Failed to reset circuit breaker");
    }
    setResetting(false);
  };

  // Handle Shutdown Scraper Browser Session
  const handleShutdown = async () => {
    if (!confirm("Are you sure you want to close the active browser session? Any pending checks will fail.")) return;
    setShuttingDown(true);
    try {
      const res = await icpAPI.shutdownBrowser();
      if (res.data && res.data.success) {
        alert("ICP browser session closed successfully.");
        loadStatus();
      }
    } catch (err) {
      alert("Failed to shut down browser");
    }
    setShuttingDown(false);
  };

  // Start check countdown
  const startCountdown = () => {
    setCountdown(60);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Stop check countdown
  const stopCountdown = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopCountdown();
  }, []);

  // Handle Run Status Check
  const handleRunCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passportNumber.trim()) {
      alert("Please enter a passport number.");
      return;
    }
    if (!passportExpiry) {
      alert("Please select a passport expiry date.");
      return;
    }

    setChecking(true);
    setCheckResult(null);
    setCheckError(null);
    startCountdown();

    try {
      const res = await icpAPI.check({
        passportNumber: passportNumber.trim(),
        passportExpiry,
        nationality,
        permitType
      });

      stopCountdown();

      if (res.data && res.data.success) {
        const checkData = res.data.data;
        setCheckResult(checkData);
        if (!checkData.success) {
          setCheckError(checkData.errorMessage || "Check failed due to an unknown issue.");
        }
      } else {
        setCheckError(res.data?.error?.message || "Failed to complete ICP check.");
      }
    } catch (err: any) {
      stopCountdown();
      const errMsg = err.response?.data?.error?.message || err.message || "Failed to communicate with the scraper API.";
      setCheckError(errMsg);
    } finally {
      setChecking(false);
      loadStatus();
      loadHistory(currentPage);
    }
  };

  // Get status class for style mapping
  const getStatusClass = (status: string) => {
    if (!status) return "pending";
    const lower = status.toLowerCase();
    if (lower === "active" || lower === "valid") return "active";
    if (lower === "expired" || lower === "used") return "expired";
    if (lower === "cancelled" || lower === "canceled") return "cancelled";
    if (lower === "under_process" || lower === "pending" || lower === "under process") return "pending";
    return "cancelled";
  };

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}>
            <Globe size={24} color="var(--accent-cyan)" /> ICP Portal Check
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 4 }}>
            Verify live residency and visa files directly on the UAE ICP Smart Services system.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => { loadStatus(); loadHistory(currentPage); }} className="btn btn-outline" style={{ padding: "8px 14px", fontSize: 13 }}>
            <RefreshCw size={14} /> Refresh Panel
          </button>
        </div>
      </div>

      {/* Scraper Status Panel */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 24 }}>
        {/* Scraper Session State */}
        <div className="glass-card" style={{ padding: 20, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Browser Session</p>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: scraperStatus?.session?.isInitialized ? "var(--accent-emerald)" : "var(--text-secondary)" }}>
                {scraperStatus?.session?.isInitialized ? "ACTIVE" : "STANDBY"}
              </h3>
            </div>
            <div style={{
              width: 38, height: 38, borderRadius: 10,
              background: scraperStatus?.session?.isInitialized ? "rgba(16, 185, 129, 0.12)" : "rgba(100, 116, 139, 0.12)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: scraperStatus?.session?.isInitialized ? "var(--accent-emerald)" : "var(--text-muted)"
            }}>
              <Power size={18} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
            <span>Active Pages: {scraperStatus?.session?.activePagesCount || 0}</span>
            {scraperStatus?.session?.isInitialized && (
              <button 
                onClick={handleShutdown} 
                disabled={shuttingDown} 
                style={{ background: "none", border: "none", color: "var(--accent-red)", cursor: "pointer", fontWeight: 600, padding: 0 }}
              >
                {shuttingDown ? "Closing..." : "Shutdown"}
              </button>
            )}
          </div>
        </div>

        {/* Circuit Breaker State */}
        <div className="glass-card" style={{ padding: 20, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Circuit Breaker</p>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: scraperStatus?.circuitBreaker?.state === "OPEN" ? "var(--accent-red)" : "var(--accent-emerald)" }}>
                {scraperStatus?.circuitBreaker?.state || "CLOSED"}
              </h3>
            </div>
            <div style={{
              width: 38, height: 38, borderRadius: 10,
              background: scraperStatus?.circuitBreaker?.state === "OPEN" ? "rgba(239, 68, 68, 0.12)" : "rgba(16, 185, 129, 0.12)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: scraperStatus?.circuitBreaker?.state === "OPEN" ? "var(--accent-red)" : "var(--accent-emerald)"
            }}>
              <Shield size={18} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
            <span>Failures: {scraperStatus?.circuitBreaker?.failures || 0}/{scraperStatus?.circuitBreaker?.threshold || 3}</span>
            {scraperStatus?.circuitBreaker?.state === "OPEN" && (
              <button 
                onClick={handleReset} 
                disabled={resetting} 
                style={{ background: "none", border: "none", color: "var(--accent-blue)", cursor: "pointer", fontWeight: 600, padding: 0 }}
              >
                {resetting ? "Resetting..." : "Reset"}
              </button>
            )}
          </div>
        </div>

        {/* Rate Limits */}
        <div className="glass-card" style={{ padding: 20, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Hourly Rate Limit</p>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>
                {scraperStatus?.rateLimit?.checksThisHour || 0} / {scraperStatus?.rateLimit?.maxPerHour || 20}
              </h3>
            </div>
            <div style={{
              width: 38, height: 38, borderRadius: 10,
              background: "rgba(6, 182, 212, 0.12)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--accent-cyan)"
            }}>
              <Clock size={18} />
            </div>
          </div>
          <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Last check: {scraperStatus?.rateLimit?.lastCheck ? new Date(scraperStatus.rateLimit.lastCheck).toLocaleTimeString("en-AE") : "No checks yet"}
          </p>
        </div>
      </div>

      {/* Main Checking Workspace */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 20, marginBottom: 32 }}>
        {/* Single-Check Form Card */}
        <div className="glass-card" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
            <Play size={18} color="var(--accent-blue)" />
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>Run Live Portal Check</h2>
          </div>

          <form onSubmit={handleRunCheck} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>Passport Number *</label>
              <input
                type="text"
                className="input-field"
                value={passportNumber}
                onChange={(e) => setPassportNumber(e.target.value)}
                placeholder="e.g. P1234567"
                disabled={checking}
                required
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>Expiry Date *</label>
                <input
                  type="date"
                  className="input-field"
                  value={passportExpiry}
                  onChange={(e) => setPassportExpiry(e.target.value)}
                  disabled={checking}
                  required
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>Permit Type *</label>
                <select
                  className="input-field"
                  value={permitType}
                  onChange={(e) => setPermitType(e.target.value as any)}
                  disabled={checking}
                >
                  <option value="RESIDENCY">Residency</option>
                  <option value="VISA">Visa</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>Nationality *</label>
              <select
                className="input-field"
                value={nationality}
                onChange={(e) => setNationality(e.target.value)}
                disabled={checking}
              >
                {NATIONALITIES.map((n) => (
                  <option key={n.value} value={n.value}>{n.label}</option>
                ))}
              </select>
            </div>

            <button 
              type="submit" 
              className="btn btn-primary" 
              style={{ width: "100%", marginTop: 8 }}
              disabled={checking}
            >
              {checking ? (
                <>
                  <RefreshCw size={16} style={{ animation: "spin 1s linear infinite" }} />
                  Processing Check...
                </>
              ) : (
                <>
                  <Search size={16} />
                  Query ICP Portal
                </>
              )}
            </button>
          </form>
        </div>

        {/* Live Scraper Output / Results Card */}
        <div className="glass-card" style={{ padding: 24, display: "flex", flexDirection: "column", minHeight: 320 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
            <Globe size={18} color="var(--accent-cyan)" />
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>Session Execution Console</h2>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            {checking && (
              <div style={{ textAlign: "center", padding: 20 }}>
                <div className="spinner alert-pulse" style={{ width: 44, height: 44, margin: "0 auto 16px", borderWidth: 4 }} />
                <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--accent-blue)", marginBottom: 6 }}>
                  Scraper Launched (Headful Mode)
                </h3>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", maxWidth: 360, margin: "0 auto 16px", lineHeight: 1.5 }}>
                  The browser is filling the passport details.
                  Please switch to the browser window, <strong style={{ color: "var(--accent-amber)" }}>solve the CAPTCHA manually</strong>, and click search.
                </p>
                <div style={{ 
                  display: "inline-flex", alignItems: "center", gap: 8, 
                  background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.3)",
                  padding: "8px 16px", borderRadius: 8, color: "var(--accent-amber)", fontSize: 13, fontWeight: 700 
                }}>
                  <Clock size={16} />
                  Time remaining to solve: {countdown}s
                </div>
              </div>
            )}

            {!checking && !checkResult && !checkError && (
              <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                <HelpCircle size={44} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
                <p style={{ fontSize: 14 }}>Ready for Query</p>
                <p style={{ fontSize: 12, marginTop: 4 }}>Enter details on the left to start a status verification.</p>
              </div>
            )}

            {checkError && (
              <div style={{ padding: 16, background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: 12 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 12 }}>
                  <XCircle size={18} color="var(--accent-red)" style={{ marginTop: 2 }} />
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Verification Failed</h3>
                    <p style={{ fontSize: 12, color: "var(--accent-red)", marginTop: 2, lineHeight: 1.4 }}>{checkError}</p>
                  </div>
                </div>
                <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: 10, fontSize: 11, color: "var(--text-muted)" }}>
                  Hint: Make sure you solved the CAPTCHA within the 60s timeout limit. If the portal blocked your IP, try restarting the server browser.
                </div>
              </div>
            )}

            {checkResult && checkResult.success && (
              <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ 
                  display: "flex", alignItems: "center", gap: 10, 
                  background: checkResult.status === "NOT_FOUND" ? "rgba(245, 158, 11, 0.08)" : "rgba(16, 185, 129, 0.08)", 
                  border: `1px solid ${checkResult.status === "NOT_FOUND" ? "rgba(245, 158, 11, 0.2)" : "rgba(16, 185, 129, 0.2)"}`,
                  padding: "12px 16px", borderRadius: 10 
                }}>
                  {checkResult.status === "NOT_FOUND" ? (
                    <AlertTriangle size={18} color="var(--accent-amber)" />
                  ) : (
                    <ShieldCheck size={18} color="var(--accent-emerald)" />
                  )}
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 700 }}>
                      {checkResult.status === "NOT_FOUND" ? "Record Not Found" : "Status Check Successful"}
                    </h3>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                      Checked in {Math.round(checkResult.durationMs / 100) / 10}s
                    </p>
                  </div>
                </div>

                <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: 10, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <tbody>
                      <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                        <td style={{ padding: "10px 14px", color: "var(--text-muted)", width: "35%" }}>Passport</td>
                        <td style={{ padding: "10px 14px", fontWeight: 600 }}>{checkResult.passportNumber}</td>
                      </tr>
                      <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                        <td style={{ padding: "10px 14px", color: "var(--text-muted)" }}>Portal Status</td>
                        <td style={{ padding: "10px 14px" }}>
                          <span className={`badge badge-${getStatusClass(checkResult.status)}`}>
                            {checkResult.status || "UNKNOWN"}
                          </span>
                        </td>
                      </tr>
                      {checkResult.holderName && (
                        <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                          <td style={{ padding: "10px 14px", color: "var(--text-muted)" }}>Holder Name</td>
                          <td style={{ padding: "10px 14px", fontWeight: 600 }}>{checkResult.holderName}</td>
                        </tr>
                      )}
                      {checkResult.icpFileNumber && (
                        <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                          <td style={{ padding: "10px 14px", color: "var(--text-muted)" }}>File Number</td>
                          <td style={{ padding: "10px 14px", fontWeight: 600, color: "var(--accent-blue)" }}>{checkResult.icpFileNumber}</td>
                        </tr>
                      )}
                      {checkResult.expiryDate && (
                        <tr>
                          <td style={{ padding: "10px 14px", color: "var(--text-muted)" }}>Expiry Date</td>
                          <td style={{ padding: "10px 14px", fontWeight: 600 }}>{checkResult.expiryDate}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {checkResult.screenshotPath && (
                  <p style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "right", fontStyle: "italic" }}>
                    Screenshot captured: {checkResult.screenshotPath.split(/[\\/]/).pop()}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* History Log Card */}
      <div className="glass-card" style={{ padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
          <History size={18} color="var(--accent-purple)" />
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Recent Check Activity</h2>
        </div>

        {loadingHistory ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <div className="spinner" style={{ margin: "0 auto" }} />
          </div>
        ) : history.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
            <Clock size={32} style={{ margin: "0 auto 10px", opacity: 0.5 }} />
            <p>No activity logs found for ICP status checks.</p>
          </div>
        ) : (
          <div>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Passport</th>
                    <th>Action</th>
                    <th>Duration</th>
                    <th>Outcome</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h: any) => (
                    <tr key={h.id}>
                      <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        {new Date(h.createdAt).toLocaleString("en-AE", {
                          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit"
                        })}
                      </td>
                      <td style={{ fontWeight: 600 }}>{h.passportHash || "—"}</td>
                      <td style={{ fontSize: 13 }}>{h.action || "ICP_STATUS_CHECK"}</td>
                      <td style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                        {h.durationMs ? `${Math.round(h.durationMs / 100) / 10}s` : "—"}
                      </td>
                      <td>
                        <span className={`badge badge-${h.status === "SUCCESS" ? "active" : "expired"}`}>
                          {h.status === "SUCCESS" ? "SUCCESS" : "FAILED"}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: h.errorMessage ? "var(--accent-red)" : "var(--text-muted)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {h.errorMessage || "Completed successfully"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 20 }}>
                <button
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  disabled={currentPage === 1}
                  className="btn btn-outline"
                  style={{ padding: "6px 12px", fontSize: 12 }}
                >
                  Prev
                </button>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="btn btn-outline"
                  style={{ padding: "6px 12px", fontSize: 12 }}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
