// ============================================================
// Mock Government Portal — Test server for automation
// Simulates GDRFA-style portal with login, OTP, and status lookup
// ============================================================

import express from 'express';
import path from 'path';
import { logger } from '../lib/logger';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'portal-static')));

// Mock data store
const sessions = new Map<string, { user: string; expiresAt: number }>();
const OTP_CODE = '123456'; // Fixed OTP for testing

// Mock visa statuses
const visaStatuses: Record<string, any> = {
  P1234567: { status: 'IN_COUNTRY', visaNumber: 'V-2024-001', name: 'Ahmed Al Mansouri', expiryDate: '2026-01-01', entryDate: '2024-01-05' },
  P2345678: { status: 'EXITED', visaNumber: 'V-2024-002', name: 'Rajesh Kumar', expiryDate: '2026-02-15', entryDate: '2024-02-20', exitDate: '2024-05-10' },
  P3456789: { status: 'ACTIVE', visaNumber: 'V-2024-003', name: 'Maria Santos', expiryDate: '2026-03-01' },
  P4567890: { status: 'EXITED', visaNumber: 'V-2024-004', name: 'John Smith', expiryDate: '2024-09-01', exitDate: '2024-08-15' },
  P5678901: { status: 'IN_COUNTRY', visaNumber: 'V-2024-005', name: 'Fatima Hassan', expiryDate: '2024-04-01', entryDate: '2024-04-05' },
};

// === LOGIN PAGE ===
app.get('/login', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>GDRFA Portal - Login</title>
<style>
  body { font-family: Arial; background: #1a1a2e; color: #e0e0e0; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
  .login-card { background: #16213e; padding: 40px; border-radius: 12px; width: 380px; box-shadow: 0 8px 32px rgba(0,0,0,.3); }
  h1 { color: #00b4d8; text-align: center; margin-bottom: 30px; font-size: 1.4rem; }
  .logo { text-align: center; font-size: 2.5rem; margin-bottom: 10px; }
  label { display: block; margin-bottom: 6px; font-size: .9rem; color: #90caf9; }
  input { width: 100%; padding: 12px; border: 1px solid #0f3460; border-radius: 8px; background: #0f3460; color: #fff; font-size: 1rem; box-sizing: border-box; margin-bottom: 16px; }
  input:focus { outline: none; border-color: #00b4d8; }
  button[type="submit"] { width: 100%; padding: 14px; background: #00b4d8; color: #fff; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; font-weight: bold; }
  button:hover { background: #0096c7; }
  .error { color: #ef5350; text-align: center; margin-bottom: 10px; display: none; }
</style></head><body>
<div class="login-card">
  <div class="logo">🏛️</div>
  <h1>GDRFA Portal - Login</h1>
  <div class="error" id="errorMsg"></div>
  <form action="/login" method="POST">
    <label for="username">Emirates ID / Username</label>
    <input type="text" id="username" name="username" placeholder="Enter username" required>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" placeholder="Enter password" required>
    <button type="submit">Sign In</button>
  </form>
</div></body></html>`);
});

// === LOGIN POST ===
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'portal_admin' && password === 'portal123') {
    // Send OTP page
    res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>GDRFA - OTP Verification</title>
<style>
  body { font-family: Arial; background: #1a1a2e; color: #e0e0e0; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
  .card { background: #16213e; padding: 40px; border-radius: 12px; width: 380px; box-shadow: 0 8px 32px rgba(0,0,0,.3); text-align: center; }
  h2 { color: #00b4d8; margin-bottom: 20px; }
  p { color: #90caf9; margin-bottom: 20px; }
  input { width: 200px; padding: 16px; text-align: center; font-size: 1.5rem; letter-spacing: 8px; border: 2px solid #0f3460; border-radius: 8px; background: #0f3460; color: #fff; }
  input:focus { outline: none; border-color: #00b4d8; }
  button { margin-top: 20px; padding: 14px 40px; background: #00b4d8; color: #fff; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; }
</style></head><body>
<div class="card">
  <h2>🔐 OTP Verification</h2>
  <p>Enter the 6-digit code sent to your registered mobile</p>
  <form action="/verify-otp" method="POST">
    <input type="hidden" name="username" value="${username}">
    <input type="text" name="otp" maxlength="6" placeholder="000000" required>
    <br><button type="submit">Verify</button>
  </form>
  <p style="font-size:.8rem;margin-top:20px;">Dev OTP: <strong>123456</strong></p>
</div></body></html>`);
  } else {
    res.redirect('/login?error=invalid');
  }
});

// === OTP VERIFY ===
app.post('/verify-otp', (req, res) => {
  const { username, otp } = req.body;
  if (otp === OTP_CODE) {
    const sessionId = Math.random().toString(36).substring(2);
    sessions.set(sessionId, { user: username, expiresAt: Date.now() + 30 * 60 * 1000 });
    res.cookie('session_id', sessionId, { httpOnly: true });
    res.redirect('/dashboard');
  } else {
    res.status(401).send('Invalid OTP');
  }
});

// === SESSION CHECK ===
function checkSession(req: express.Request): boolean {
  const sessionId = req.cookies?.session_id || req.headers['x-session-id'];
  if (!sessionId) return false;
  const session = sessions.get(sessionId as string);
  return !!(session && session.expiresAt > Date.now());
}

app.use(require('cookie-parser')());

// === DASHBOARD ===
app.get('/dashboard', (req, res) => {
  if (!checkSession(req)) return res.redirect('/login');
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>GDRFA - Dashboard</title>
<style>
  body { font-family: Arial; background: #1a1a2e; color: #e0e0e0; margin: 0; }
  .navbar { background: #16213e; padding: 16px 40px; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #00b4d8; }
  .navbar h1 { color: #00b4d8; font-size: 1.2rem; margin: 0; }
  .content { max-width: 1000px; margin: 40px auto; padding: 0 20px; }
  .stats { display: grid; grid-template-columns: repeat(3,1fr); gap: 20px; margin-bottom: 40px; }
  .stat-card { background: #16213e; padding: 24px; border-radius: 12px; text-align: center; }
  .stat-card h3 { color: #90caf9; font-size: .9rem; margin: 0 0 8px; }
  .stat-card .num { font-size: 2rem; font-weight: bold; color: #00b4d8; }
  a { color: #00b4d8; text-decoration: none; padding: 10px 24px; border: 1px solid #00b4d8; border-radius: 8px; }
</style></head><body>
<div class="navbar"><h1>🏛️ GDRFA Portal</h1><span data-page="dashboard">Welcome, Admin</span></div>
<div class="content">
  <div class="stats">
    <div class="stat-card"><h3>Total Visas</h3><div class="num">5</div></div>
    <div class="stat-card"><h3>Active</h3><div class="num">3</div></div>
    <div class="stat-card"><h3>Exited</h3><div class="num">2</div></div>
  </div>
  <a href="/status-check">📋 Visa Status Check</a>
</div></body></html>`);
});

// === STATUS CHECK PAGE ===
app.get('/status-check', (req, res) => {
  if (!checkSession(req)) return res.redirect('/login');
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>GDRFA - Status Check</title>
<style>
  body { font-family: Arial; background: #1a1a2e; color: #e0e0e0; margin: 0; }
  .navbar { background: #16213e; padding: 16px 40px; border-bottom: 2px solid #00b4d8; }
  .navbar h1 { color: #00b4d8; font-size: 1.2rem; margin: 0; }
  .content { max-width: 600px; margin: 40px auto; }
  .search-box { background: #16213e; padding: 30px; border-radius: 12px; }
  input[name="passport"] { width: 100%; padding: 14px; border: 1px solid #0f3460; border-radius: 8px; background: #0f3460; color: #fff; font-size: 1.1rem; box-sizing: border-box; margin-bottom: 16px; }
  .search-btn { width: 100%; padding: 14px; background: #00b4d8; color: #fff; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; }
  .status-result { margin-top: 20px; padding: 20px; background: #0f3460; border-radius: 8px; display: none; }
  .status-result h3 { color: #00b4d8; margin-top: 0; }
  .status-result .field { margin-bottom: 8px; }
  .status-result .label { color: #90caf9; font-size: .85rem; }
  .status-result .value { font-weight: bold; font-size: 1.1rem; }
</style></head><body>
<div class="navbar"><h1>🏛️ GDRFA Portal — Visa Status Check</h1></div>
<div class="content">
  <div class="search-box">
    <h2>Check Visa Status</h2>
    <input type="text" name="passport" id="passportNumber" data-field="passport" placeholder="Enter Passport Number (e.g., P1234567)">
    <button class="search-btn" onclick="checkStatus()">Search</button>
    <div class="status-result" id="statusResult"></div>
  </div>
</div>
<script>
async function checkStatus() {
  const passport = document.getElementById('passportNumber').value;
  const res = await fetch('/api/visa/status?passport=' + passport);
  const data = await res.json();
  const el = document.getElementById('statusResult');
  if (data.found) {
    el.innerHTML = '<h3>Visa Status</h3>' +
      '<div class="field"><span class="label">Name:</span> <span class="value">' + data.name + '</span></div>' +
      '<div class="field"><span class="label">Passport:</span> <span class="value">' + data.passport + '</span></div>' +
      '<div class="field"><span class="label">Visa Number:</span> <span class="value">' + data.visaNumber + '</span></div>' +
      '<div class="field"><span class="label">Status:</span> <span class="value" data-status="' + data.status + '">' + data.status + '</span></div>' +
      '<div class="field"><span class="label">Expiry:</span> <span class="value">' + data.expiryDate + '</span></div>';
  } else {
    el.innerHTML = '<h3 style="color:#ef5350">Not Found</h3><p>No visa record found for passport: ' + passport + '</p>';
  }
  el.style.display = 'block';
}
</script></body></html>`);
});

// === STATUS API (XHR endpoint that automation intercepts) ===
app.get('/api/visa/status', (req, res) => {
  const passport = req.query.passport as string;
  const record = visaStatuses[passport];

  if (record) {
    res.json({
      found: true,
      passport,
      ...record,
    });
  } else {
    res.json({ found: false, passport });
  }
});

// === SESSION CHECK API ===
app.head('/api/session-check', (req, res) => {
  if (checkSession(req)) {
    res.sendStatus(200);
  } else {
    res.sendStatus(401);
  }
});

// === START MOCK PORTAL ===
export function startMockPortal(port: number = 4000): Promise<void> {
  return new Promise((resolve) => {
    app.listen(port, () => {
      logger.info(`🏛️  Mock GDRFA Portal running on http://localhost:${port}`);
      logger.info(`    Login: portal_admin / portal123`);
      logger.info(`    OTP:   123456`);
      resolve();
    });
  });
}

export default app;
