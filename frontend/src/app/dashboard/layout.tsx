"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard, Users, FileText, AlertTriangle,
  BarChart3, LogOut, Shield, ChevronRight, Menu, X, Upload, Zap, ScrollText, Settings,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/passengers", label: "Passengers", icon: Users },
  { href: "/dashboard/applications", label: "Applications", icon: FileText },
  { href: "/dashboard/ghosts", label: "Ghost Alerts", icon: AlertTriangle },
  { href: "/dashboard/reconciliation", label: "Reconciliation", icon: Zap },
  { href: "/dashboard/import", label: "Import Data", icon: Upload },
  { href: "/dashboard/reports", label: "Reports", icon: BarChart3 },
  { href: "/dashboard/audit", label: "Audit Log", icon: ScrollText },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const stored = localStorage.getItem("user");
    if (!token) {
      router.replace("/login");
      return;
    }
    if (stored) setUser(JSON.parse(stored));
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    router.replace("/login");
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar */}
      <aside
        className="sidebar"
        style={{ transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)" }}
      >
        {/* Logo */}
        <div style={{
          padding: "24px 20px", borderBottom: "1px solid var(--border-color)",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "var(--gradient-primary)", display: "flex",
            alignItems: "center", justifyContent: "center",
          }}>
            <Shield size={20} color="white" />
          </div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Visa Monitor</p>
            <p style={{ fontSize: 11, color: "var(--text-muted)" }}>Enterprise Dashboard</p>
          </div>
        </div>

        {/* Nav links */}
        <nav style={{ flex: 1, padding: "12px 0" }}>
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link ${isActive ? "active" : ""}`}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
                {isActive && <ChevronRight size={14} style={{ marginLeft: "auto" }} />}
              </Link>
            );
          })}
        </nav>

        {/* User info & logout */}
        <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border-color)" }}>
          {user && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                {user.email?.split("@")[0]}
              </p>
              <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {user.role || "ADMIN"}
              </p>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="btn btn-outline"
            style={{ width: "100%", fontSize: 13, padding: "8px 16px" }}
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={{
        flex: 1,
        marginLeft: sidebarOpen ? 260 : 0,
        transition: "margin-left 0.3s ease",
        padding: "24px 32px",
        minHeight: "100vh",
      }}>
        {/* Top bar */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 28,
        }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{
              background: "var(--bg-card)", border: "1px solid var(--border-color)",
              borderRadius: 8, padding: 8, cursor: "pointer", color: "var(--text-secondary)",
            }}
          >
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {new Date().toLocaleDateString("en-AE", {
                weekday: "long", year: "numeric", month: "long", day: "numeric",
              })}
            </span>
          </div>
        </div>

        <div className="fade-in">{children}</div>
      </main>
    </div>
  );
}
