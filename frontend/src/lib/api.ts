import axios from "axios";

const api = axios.create({
  baseURL: "/api/v1",
  headers: { "Content-Type": "application/json" },
});

// Attach token to every request
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auto-logout on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default api;

// ========================
// AUTH
// ========================
export const authAPI = {
  login: (email: string, password: string) =>
    api.post("/auth/login", { email, password }),
};

// ========================
// PASSENGERS
// ========================
export const passengersAPI = {
  getAll: () => api.get("/passengers"),
  getOne: (id: string) => api.get(`/passengers/${id}`),
  create: (data: any) => api.post("/passengers", data),
  update: (id: string, data: any) => api.patch(`/passengers/${id}`, data),
  delete: (id: string) => api.delete(`/passengers/${id}`),
};

// ========================
// APPLICATIONS
// ========================
export const applicationsAPI = {
  getAll: () => api.get("/applications"),
  getOne: (id: string) => api.get(`/applications/${id}`),
  create: (data: any) => api.post("/applications", data),
  updateStatus: (id: string, status: string) =>
    api.patch(`/applications/${id}/status`, { status }),
};

// ========================
// EVENTS
// ========================
export const eventsAPI = {
  getAll: () => api.get("/events"),
  create: (data: any) => api.post("/events", data),
};

// ========================
// GHOSTS
// ========================
export const ghostsAPI = {
  getAll: (params?: { status?: string; riskLevel?: string }) =>
    api.get("/ghosts", { params }),
  getStats: () => api.get("/ghosts/stats"),
  getScraperStatus: () => api.get("/ghosts/scraper-status"),
  acknowledge: (id: string) => api.patch(`/ghosts/${id}/acknowledge`),
  resolve: (id: string, resolution?: string, notes?: string) =>
    api.patch(`/ghosts/${id}/resolve`, { resolution, notes }),
  falsePositive: (id: string) => api.patch(`/ghosts/${id}/false-positive`),
  triggerSpotCheck: (id: string) => api.post(`/ghosts/${id}/spot-check`),
};

// ========================
// RECONCILIATION
// ========================
export const reconciliationAPI = {
  getJobs: (page?: number) => api.get("/reconciliation/jobs", { params: { page } }),
  getJobDetails: (id: string) => api.get(`/reconciliation/jobs/${id}`),
  triggerFull: () => api.post("/reconciliation/trigger", { jobType: "FULL" }),
  getMismatches: (params?: { status?: string; page?: number }) => api.get("/reconciliation/mismatches", { params }),
  resolveMismatch: (id: string, notes: string) => api.patch(`/reconciliation/mismatches/${id}/resolve`, { resolutionNotes: notes }),
};

// ========================
// REPORTS
// ========================
export const reportsAPI = {
  downloadVisaStatus: () =>
    api.get("/reports/excel/visa-status", { responseType: "blob" }),
  downloadGhostReport: () =>
    api.get("/reports/excel/ghost-alerts", { responseType: "blob" }),
  downloadCompliancePDF: () =>
    api.get("/reports/pdf/compliance", { responseType: "blob" }),
  downloadGhostPDF: () =>
    api.get("/reports/pdf/ghost-detection", { responseType: "blob" }),
  downloadReconciliationPDF: () =>
    api.get("/reports/pdf/reconciliation", { responseType: "blob" }),
  downloadImportActivityPDF: () =>
    api.get("/reports/pdf/import-activity", { responseType: "blob" }),
  listReports: () => api.get("/reports/list"),
};

// ========================
// ADMIN
// ========================
export const adminAPI = {
  getStats: () => api.get("/admin/stats"),
  getAuditLogs: (params?: { page?: number; action?: string; entityType?: string }) =>
    api.get("/admin/audit-logs", { params }),
  getAutomationLogs: (params?: { page?: number }) =>
    api.get("/admin/automation-logs", { params }),
  getSystemHealth: () => api.get("/admin/system/health"),
  getDashboard: () => api.get("/admin/dashboard"),
  getScraperStatus: () => api.get("/admin/scraper/status"),
  resetCircuitBreaker: () => api.post("/admin/scraper/reset"),
};

// ========================
// IMPORT (CSV/Excel + Manual Entry)
// ========================
export const importAPI = {
  uploadFile: (file: File, source: string = 'PRO_REPORT') => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/import/upload?source=${source}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000, // 2 min for large files
    });
  },
  manualEntry: (data: {
    passportNumber: string;
    portalStatus: string;
    fileNumber?: string;
    expiryDate?: string;
    notes?: string;
  }) => api.post('/import/manual', data),
  getHistory: (page: number = 1, limit: number = 20) =>
    api.get(`/import/history?page=${page}&limit=${limit}`),
  getImport: (id: string) => api.get(`/import/${id}`),
  downloadTemplate: () =>
    api.get('/import/template/download', { responseType: 'blob' }),
};

// ========================
// ICP PORTAL INTEGRATION
// ========================
export const icpAPI = {
  check: (data: {
    passportNumber: string;
    passportExpiry: string;
    nationality: string;
    permitType: 'RESIDENCY' | 'VISA';
    applicationId?: string;
  }) => api.post('/icp/check', data),
  checkBatch: (passports: Array<{
    passportNumber: string;
    passportExpiry: string;
    nationality: string;
    permitType: 'RESIDENCY' | 'VISA';
    applicationId?: string;
  }>) => api.post('/icp/check-batch', { passports }),
  getStatus: () => api.get('/icp/status'),
  getHistory: (params?: { page?: number; limit?: number }) => api.get('/icp/history', { params }),
  resetCircuitBreaker: () => api.post('/icp/reset'),
  shutdownBrowser: () => api.post('/icp/shutdown'),
};
