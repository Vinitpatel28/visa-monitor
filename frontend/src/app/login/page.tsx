"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authAPI } from "@/lib/api";
import { Shield, Eye, EyeOff, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await authAPI.login(email, password);
      const token = res.data.data.token || res.data.data.accessToken;
      const user = res.data.data.user;
      localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify(user));
      router.push("/dashboard");
    } catch (err: any) {
      if (err.response) {
        // Server responded with an error status
        setError(err.response.data?.error?.message || `Server error: ${err.response.status}`);
      } else if (err.request) {
        // No response received — network/proxy/CORS issue
        setError("Cannot reach server. Please check your connection.");
      } else {
        setError("Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #0a0e1a 0%, #111827 50%, #0f172a 100%)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Animated background orbs */}
      <div style={{
        position: "absolute", width: 400, height: 400, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)",
        top: -100, right: -100, animation: "pulse-glow 4s ease-in-out infinite",
      }} />
      <div style={{
        position: "absolute", width: 300, height: 300, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(6,182,212,0.06) 0%, transparent 70%)",
        bottom: -50, left: -50,
      }} />

      <div className="fade-in" style={{ width: "100%", maxWidth: 420, padding: 20 }}>
        {/* Logo & branding */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16, margin: "0 auto 16px",
            background: "var(--gradient-primary)", display: "flex",
            alignItems: "center", justifyContent: "center",
            boxShadow: "0 8px 30px rgba(59, 130, 246, 0.3)",
          }}>
            <Shield size={32} color="white" />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>
            Visa Monitor
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 4 }}>
            Enterprise Monitoring & Reconciliation
          </p>
        </div>

        {/* Login form */}
        <div className="glass-card" style={{ padding: 32 }}>
          <form onSubmit={handleLogin}>
            {error && (
              <div style={{
                display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
                background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: 10, marginBottom: 20, fontSize: 13, color: "#f87171",
              }}>
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 6 }}>
                Email Address
              </label>
              <input
                type="email"
                className="input-field"
                placeholder="admin@visaworkflow.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 6 }}>
                Password
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  className="input-field"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  style={{ paddingRight: 44 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)",
                  }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ width: "100%", padding: "14px 20px", fontSize: 15 }}
            >
              {loading ? (
                <>
                  <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          <div style={{ textAlign: "center", marginTop: 20 }}>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Test: admin@visaworkflow.com / admin12345
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
