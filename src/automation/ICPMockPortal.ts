// ============================================================
// Mock ICP Portal — Simulates smartservices.icp.gov.ae
// File Validity page with CAPTCHA, form fields, and results
// Run: npx tsx src/automation/ICPMockPortal.ts
// URL: http://localhost:4001/#/fileValidity
// ============================================================

import express from 'express';
import { logger } from '../lib/logger';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mock passenger data — matches seeded test data
const MOCK_DATA: Record<string, {
  status: string;
  fileNumber: string;
  holderName: string;
  nationality: string;
  expiryDate: string;
  permitType: string;
}> = {
  'P1234567': {
    status: 'Valid',
    fileNumber: 'ICP-2024-001',
    holderName: 'Ahmed Al Mansouri',
    nationality: 'UAE',
    expiryDate: '2026-01-01',
    permitType: 'Residency',
  },
  'P2345678': {
    status: 'Expired',
    fileNumber: 'ICP-2024-002',
    holderName: 'Rajesh Kumar',
    nationality: 'India',
    expiryDate: '2024-02-15',
    permitType: 'Visa',
  },
  'P3456789': {
    status: 'Valid',
    fileNumber: 'ICP-2024-003',
    holderName: 'Maria Santos',
    nationality: 'Philippines',
    expiryDate: '2026-03-01',
    permitType: 'Residency',
  },
  'P4567890': {
    status: 'Cancelled',
    fileNumber: 'ICP-2024-004',
    holderName: 'John Smith',
    nationality: 'United Kingdom',
    expiryDate: '2024-09-01',
    permitType: 'Visa',
  },
  'P5678901': {
    status: 'Under Process',
    fileNumber: 'ICP-2024-005',
    holderName: 'Fatima Hassan',
    nationality: 'Egypt',
    expiryDate: '2024-04-01',
    permitType: 'Residency',
  },
  'P6789012': {
    status: 'Closed',
    fileNumber: 'ICP-2024-006',
    holderName: 'Chen Wei',
    nationality: 'China',
    expiryDate: '2023-12-01',
    permitType: 'Visa',
  },
};

// Fixed CAPTCHA answer for testing
const CAPTCHA_ANSWER = 'ABC123';

// === MAIN PAGE — Mimics AngularJS SPA ===
app.get('/', (_req, res) => {
  res.send(getMainPageHTML());
});

// Catch hash routes (AngularJS style)
app.get('/echannels/web/client/default.html', (_req, res) => {
  res.send(getMainPageHTML());
});

// === CAPTCHA IMAGE ===
app.get('/captcha/image', (_req, res) => {
  // Return a simple SVG captcha image
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60" viewBox="0 0 200 60">
    <rect width="200" height="60" fill="#f0f0f0" stroke="#ccc"/>
    <line x1="0" y1="15" x2="200" y2="45" stroke="#ddd" stroke-width="1"/>
    <line x1="0" y1="35" x2="200" y2="10" stroke="#ddd" stroke-width="1"/>
    <line x1="50" y1="0" x2="150" y2="60" stroke="#eee" stroke-width="1"/>
    <text x="100" y="40" font-family="Arial" font-size="28" font-weight="bold" fill="#333"
          text-anchor="middle" letter-spacing="8">${CAPTCHA_ANSWER}</text>
  </svg>`;
  res.type('image/svg+xml').send(svg);
});

// === SEARCH API — Returns results ===
app.post('/api/search', (req, res) => {
  const { passportNumber, captcha } = req.body;

  // Validate CAPTCHA
  if (!captcha || captcha.toUpperCase() !== CAPTCHA_ANSWER) {
    return res.json({ success: false, error: 'Invalid CAPTCHA. Please try again.' });
  }

  // Look up passport
  const data = MOCK_DATA[passportNumber?.toUpperCase()];
  if (!data) {
    return res.json({ success: true, noRecord: true, message: 'No record found for the given passport information.' });
  }

  return res.json({
    success: true,
    noRecord: false,
    result: data,
  });
});

// === MAIN HTML — AngularJS-style SPA ===
function getMainPageHTML(): string {
  return `<!DOCTYPE html>
<html lang="en" ng-app="icpApp">
<head>
  <meta charset="UTF-8">
  <title>ICP Smart Services - File Validity</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f7fa; color: #333; }

    .header {
      background: linear-gradient(135deg, #006847 0%, #004d35 100%);
      color: white; padding: 15px 30px;
      display: flex; align-items: center; gap: 15px;
    }
    .header img { height: 40px; }
    .header h1 { font-size: 1.2rem; font-weight: 500; }
    .header .subtitle { font-size: 0.8rem; opacity: 0.8; }

    .nav-tabs {
      background: #fff; border-bottom: 2px solid #e0e0e0;
      display: flex; padding: 0 30px;
    }
    .nav-tabs a {
      padding: 12px 20px; text-decoration: none; color: #666;
      border-bottom: 3px solid transparent; font-size: 0.9rem;
    }
    .nav-tabs a.active { color: #006847; border-bottom-color: #006847; font-weight: 600; }

    .container { max-width: 800px; margin: 30px auto; padding: 0 20px; }

    .search-card {
      background: white; border-radius: 8px; padding: 30px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.08);
    }
    .search-card h2 { color: #006847; margin-bottom: 20px; font-size: 1.1rem; }

    .search-type {
      display: flex; gap: 20px; margin-bottom: 25px;
      padding-bottom: 15px; border-bottom: 1px solid #eee;
    }
    .search-type label {
      display: flex; align-items: center; gap: 6px;
      cursor: pointer; font-size: 0.9rem;
    }
    .search-type input[type="radio"] { accent-color: #006847; }

    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }

    .form-group { display: flex; flex-direction: column; gap: 5px; }
    .form-group label { font-size: 0.85rem; color: #555; font-weight: 500; }
    .form-group input, .form-group select {
      padding: 10px 12px; border: 1px solid #ddd; border-radius: 6px;
      font-size: 0.9rem; transition: border-color 0.2s;
    }
    .form-group input:focus, .form-group select:focus {
      outline: none; border-color: #006847;
    }

    .captcha-section {
      margin-top: 20px; padding: 15px; background: #f9f9f9;
      border-radius: 6px; display: flex; align-items: center; gap: 15px;
    }
    .captcha-section img { border: 1px solid #ddd; border-radius: 4px; }
    .captcha-section input { flex: 1; }

    .submit-row { margin-top: 20px; display: flex; justify-content: center; }
    .submit-row button {
      padding: 12px 40px; background: #006847; color: white;
      border: none; border-radius: 6px; font-size: 1rem;
      cursor: pointer; font-weight: 500; transition: background 0.2s;
    }
    .submit-row button:hover { background: #005539; }

    .result-container {
      margin-top: 25px; padding: 20px; border-radius: 6px;
      display: none;
    }
    .result-container.show { display: block; }
    .result-container.success { background: #e8f5e9; border: 1px solid #a5d6a7; }
    .result-container.not-found { background: #fff3e0; border: 1px solid #ffcc80; }
    .result-container.error { background: #fce4ec; border: 1px solid #ef9a9a; }

    .result-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    .result-table td {
      padding: 8px 12px; border-bottom: 1px solid #e0e0e0; font-size: 0.9rem;
    }
    .result-table td:first-child { font-weight: 500; color: #555; width: 40%; }
    .result-table td.status { font-weight: 700; }
    .result-table td.status.valid { color: #2e7d32; }
    .result-table td.status.expired { color: #c62828; }
    .result-table td.status.cancelled { color: #d84315; }
    .result-table td.status.process { color: #f57f17; }

    .no-record { text-align: center; padding: 20px; color: #e65100; font-weight: 500; }

    .loading-overlay {
      display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(255,255,255,0.7); z-index: 100;
      justify-content: center; align-items: center;
    }
    .loading-overlay.show { display: flex; }
    .spinner {
      width: 40px; height: 40px; border: 4px solid #e0e0e0;
      border-top-color: #006847; border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div>
      <h1>🏛️ ICP Smart Services</h1>
      <div class="subtitle">Federal Authority for Identity, Citizenship, Customs & Port Security</div>
    </div>
  </div>

  <!-- Navigation Tabs -->
  <div class="nav-tabs">
    <a href="#" class="active">File Validity</a>
    <a href="#">Visa Inquiry</a>
    <a href="#">Entry Permit</a>
  </div>

  <!-- Main Content -->
  <div class="container">
    <div class="search-card">
      <h2>📋 File Validity Check</h2>

      <!-- Search Type Radio -->
      <div class="search-type">
        <label>
          <input type="radio" name="searchType" ng-model="searchType" value="fileNumber"> File Number
        </label>
        <label>
          <input type="radio" name="searchType" ng-model="searchType" value="passport" checked> Passport Information
        </label>
      </div>

      <!-- Passport Search Form -->
      <div id="passportForm">
        <div class="form-grid">
          <div class="form-group">
            <label for="permitType">Permit Type *</label>
            <select id="permitType" ng-model="permitType" name="permitType">
              <option value="">-- Select --</option>
              <option value="RESIDENCY">Residency</option>
              <option value="VISA">Visa</option>
            </select>
          </div>
          <div class="form-group">
            <label for="passportNumber">Passport Number *</label>
            <input type="text" id="passportNumber" ng-model="passportNumber" name="passportNumber"
                   placeholder="e.g. P1234567">
          </div>
          <div class="form-group">
            <label for="passportExpiry">Passport Expiry Date *</label>
            <input type="date" id="passportExpiry" ng-model="passportExpiry" name="passportExpiry">
          </div>
          <div class="form-group">
            <label for="nationality">Nationality *</label>
            <select id="nationality" ng-model="nationality" name="nationality">
              <option value="">-- Select --</option>
              <option value="UAE">United Arab Emirates</option>
              <option value="India">India</option>
              <option value="Philippines">Philippines</option>
              <option value="Pakistan">Pakistan</option>
              <option value="Bangladesh">Bangladesh</option>
              <option value="Egypt">Egypt</option>
              <option value="United Kingdom">United Kingdom</option>
              <option value="United States">United States</option>
              <option value="China">China</option>
              <option value="Other">Other</option>
            </select>
          </div>
        </div>

        <!-- CAPTCHA -->
        <div class="captcha-section">
          <img src="/captcha/image" alt="CAPTCHA" class="captcha-image" id="captchaImg">
          <div class="form-group" style="flex:1">
            <label for="captchaInput">Enter CAPTCHA *</label>
            <input type="text" id="captchaInput" ng-model="captchaCode" name="captcha"
                   placeholder="Type the code shown">
          </div>
          <button type="button" onclick="document.getElementById('captchaImg').src='/captcha/image?t='+Date.now()"
                  style="padding:8px 12px;background:#eee;border:1px solid #ddd;border-radius:4px;cursor:pointer;"
                  title="Refresh CAPTCHA">🔄</button>
        </div>

        <!-- Submit -->
        <div class="submit-row">
          <button type="button" id="searchBtn" ng-click="search()" onclick="doSearch()">
            🔍 Search
          </button>
        </div>
      </div>

      <!-- Loading Overlay -->
      <div class="loading-overlay" id="loadingOverlay">
        <div class="spinner"></div>
      </div>

      <!-- Result Container -->
      <div class="result-container" id="resultContainer"></div>
    </div>
  </div>

  <script>
    // Simulate AngularJS presence (for waitForFunction checks)
    window.angular = {
      element: function(el) {
        return {
          injector: function() {
            return {
              get: function(name) {
                if (name === '$http') return { pendingRequests: [] };
                return null;
              }
            };
          }
        };
      }
    };

    async function doSearch() {
      const passport = document.getElementById('passportNumber').value.trim();
      const captcha = document.getElementById('captchaInput').value.trim();
      const permitType = document.getElementById('permitType').value;
      const expiry = document.getElementById('passportExpiry').value;
      const nationality = document.getElementById('nationality').value;
      const resultDiv = document.getElementById('resultContainer');

      // Validate
      if (!passport || !captcha || !permitType || !nationality) {
        resultDiv.className = 'result-container show error';
        resultDiv.innerHTML = '<p style="color:#c62828;font-weight:500;">⚠️ Please fill in all required fields.</p>';
        return;
      }

      // Show loading
      document.getElementById('loadingOverlay').classList.add('show');

      // Simulate network delay (1-2 seconds like real portal)
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));

      try {
        const resp = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passportNumber: passport, captcha, permitType, expiry, nationality }),
        });
        const data = await resp.json();

        document.getElementById('loadingOverlay').classList.remove('show');

        if (!data.success) {
          resultDiv.className = 'result-container show error';
          resultDiv.innerHTML = '<p style="color:#c62828;font-weight:500;">❌ ' + data.error + '</p>';
          return;
        }

        if (data.noRecord) {
          resultDiv.className = 'result-container show not-found';
          resultDiv.innerHTML = '<div class="no-record" ng-show="noRecord">📭 ' + data.message + '</div>';
          return;
        }

        const r = data.result;
        const statusClass = r.status.toLowerCase().includes('valid') ? 'valid'
          : r.status.toLowerCase().includes('expired') ? 'expired'
          : r.status.toLowerCase().includes('cancel') ? 'cancelled'
          : 'process';

        resultDiv.className = 'result-container show success';
        resultDiv.setAttribute('ng-show', 'result');
        resultDiv.innerHTML = \`
          <h3 style="color:#2e7d32;margin-bottom:12px;">✅ Record Found</h3>
          <table class="result-table">
            <tr><td>File Number</td><td ng-bind="result.fileNumber" class="file-number-value">\${r.fileNumber}</td></tr>
            <tr><td>Status</td><td ng-bind="result.status" class="status \${statusClass} status-value">\${r.status}</td></tr>
            <tr><td>Holder Name</td><td ng-bind="result.holderName" class="name-value">\${r.holderName}</td></tr>
            <tr><td>Nationality</td><td>\${r.nationality}</td></tr>
            <tr><td>Permit Type</td><td>\${r.permitType}</td></tr>
            <tr><td>Expiry Date</td><td ng-bind="result.expiryDate" class="expiry-value">\${r.expiryDate}</td></tr>
          </table>
        \`;
      } catch (err) {
        document.getElementById('loadingOverlay').classList.remove('show');
        resultDiv.className = 'result-container show error';
        resultDiv.innerHTML = '<p style="color:#c62828;">❌ Connection error. Please try again.</p>';
      }
    }
  </script>
</body>
</html>`;
}

// === Start Mock ICP Portal Server ===
export function startICPMockPortal(port = 4001): void {
  app.listen(port, () => {
    logger.info(`🏛️  Mock ICP Portal running at http://localhost:${port}`);
    logger.info(`📋 File Validity page: http://localhost:${port}/#/fileValidity`);
    logger.info(`🔑 Test CAPTCHA answer: ${CAPTCHA_ANSWER}`);
    logger.info(`📝 Test passports: ${Object.keys(MOCK_DATA).join(', ')}`);
  });
}

// Direct execution
if (require.main === module || process.argv[1]?.includes('ICPMockPortal')) {
  startICPMockPortal();
}

export { MOCK_DATA, CAPTCHA_ANSWER };
