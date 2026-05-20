# Visa Workflow Automation & Ghost Status Reconciliation System
## Complete Enterprise Implementation Plan
### GDRFA-Style Architecture — Production-Grade Guide

---

> **Scope:** Senior Solution Architect + Automation Engineer + Workflow Consultant + Enterprise Backend Engineer perspective  
> **Stack:** Node.js · Express · n8n · PostgreSQL · Redis · BullMQ · Playwright · Docker · Kubernetes

---

## SECTION 1 — PROJECT UNDERSTANDING

### 1.1 The Real Business Problem

Visa-issuing authorities and travel agencies managing large passenger volumes face a fundamental data synchronization challenge. When a person crosses a border, multiple systems must agree on that person's current status:

1. **Government portal** (GDRFA, ICA, immigration authority)
2. **Company/agency internal system** (CRM, HR system, travel management system)
3. **Airline manifest system**
4. **Border control system**

These systems do not always sync in real time. Each has its own update cycle, API rate limits, manual processes, and failure modes. The result is **status divergence** — the same person appears to be in two different states simultaneously across two different systems.

**Real-world business impact:**
- A company sponsoring 500+ workers cannot track who is legally inside the country
- Visa renewal applications get rejected because the system shows a person as "present" when they have already exited
- Overstay fines get incorrectly issued
- Legal compliance audits fail because internal records do not match government records
- Airline check-in is blocked for passengers who have already been cleared

### 1.2 The Ghost Status Problem — Deep Explanation

A **Ghost Passenger** or **Ghost Status** is a record where:

```
Government System  → Status: EXITED
Company System     → Status: IN_COUNTRY (IN_DUBAI)
```

The passenger physically left, but digitally they are still present.

**How Ghost Status gets created:**

| Root Cause | Explanation |
|---|---|
| Exit event not synced | Selenium script failed at the exact moment of exit scanning |
| Delayed government portal update | Government updates status in batches, not real-time |
| Session timeout mid-process | Automation was mid-way through a status pull when session expired |
| Manual override not reflected | Human operator updated one system but not the other |
| API rate limiting | Too many requests, some status pulls were skipped |
| CAPTCHA block | Bot detection broke automation mid-workflow |
| Network timeout | Status pull started but never completed |
| Duplicate records | Same passport number exists in two entries |

**Why it is dangerous:**
- Companies can be fined for misreporting presence of employees
- Ghost records block legitimate visa renewals
- HR and payroll systems make decisions on incorrect data
- Audit trails become unreliable

### 1.3 Why Reconciliation Systems Are Needed

A **reconciliation system** is a process that periodically compares two data sources and identifies, flags, and resolves discrepancies.

In financial systems, reconciliation compares bank records vs. internal ledgers.  
In visa systems, reconciliation compares government portal status vs. internal tracking status.

**Without reconciliation:**
- Discrepancies grow silently over time
- Ghost statuses accumulate
- No one knows which records are correct
- Manual correction becomes impossible at scale

**With reconciliation:**
- Every mismatch is detected automatically
- Alerts are fired before mismatches become compliance violations
- Audit logs record every correction with timestamps and source-of-truth attribution
- System self-heals by re-fetching authoritative data

### 1.4 How Enterprises Solve This

Leading enterprises use a **three-layer approach:**

```
Layer 1: Prevention       → Reliable event capture, retry logic, idempotency
Layer 2: Detection        → Scheduled reconciliation jobs comparing two sources
Layer 3: Resolution       → Automated correction + human escalation for edge cases
```

Real-world examples of reconciliation systems:
- **Banking:** SWIFT reconciliation, end-of-day settlement
- **Airlines:** Passenger Name Record (PNR) vs. boarding scan reconciliation
- **Immigration:** Visa On Arrival tracking vs. departure manifest comparison
- **HR:** Payroll system headcount vs. biometric attendance system

Your system applies the same enterprise pattern to visa status management.

---

## SECTION 2 — CURRENT SYSTEM ANALYSIS

### 2.1 Architecture Overview (What You Have)

```
Client Request
     │
     ▼
Express.js API Layer (Node.js)
     │
     ├── /send-otp
     ├── /verify-otp
     ├── /create-application
     ├── /status/:passport
     ├── /entry-event
     ├── /exit-event
     └── /ghost-check
     │
     ▼
n8n Workflow Engine
     │
     ├── Send OTP Workflow
     ├── Verify OTP Workflow
     ├── Create Visa Workflow
     ├── Status Check Workflow
     ├── Entry Event Workflow
     ├── Exit Event Workflow
     └── Ghost Check Workflow
     │
     ▼
Mock API / In-Memory Data Store
```

### 2.2 Strengths

| Strength | Explanation |
|---|---|
| **Clean API surface** | 7 well-defined endpoints covering the full lifecycle |
| **Event-driven thinking** | Entry/exit events are properly separated |
| **Ghost detection exists** | Logic is already present, even if basic |
| **n8n integration** | Workflow engine gives visual debuggability |
| **OTP flow** | Authentication flow is modeled correctly |
| **Separation of concerns** | API layer vs. workflow layer is clean |

### 2.3 Weaknesses

| Weakness | Risk Level |
|---|---|
| **No persistent database** | Critical — mock data lost on restart |
| **No retry mechanism** | High — failed workflows silently drop |
| **No queue system** | High — synchronous processing will break under load |
| **No session management** | High — OTP sessions not persisted |
| **No audit log** | Medium — no trace of who changed what and when |
| **Single point of failure** | High — no worker isolation |
| **No reconciliation scheduling** | High — ghost check is manual/on-demand only |
| **No alerting system** | Medium — mismatches not escalated |
| **Mock APIs, not real integration** | Critical for production |

### 2.4 Scalability Issues

1. **Express.js as synchronous handler** — Status checks are blocking. Under 100 concurrent requests, the event loop queues up.
2. **n8n single instance** — One n8n instance handles all workflows. Under load, workflows queue internally with no visibility.
3. **No horizontal scaling** — Cannot add more API servers without session affinity problems.
4. **Ghost check is synchronous** — `/ghost-check` triggers a full scan in-process. At 10,000 records, this blocks.

### 2.5 Production Risks

| Risk | Mitigation Needed |
|---|---|
| OTP session race conditions | Redis-backed session with TTL |
| Ghost check timing out | Move to background worker + queue |
| No idempotency on entry/exit events | Add idempotency keys |
| No input validation | Add Joi/Zod schema validation |
| No rate limiting | Add express-rate-limit |
| No authentication on APIs | Add JWT or API key middleware |

---

## SECTION 3 — REAL GDRFA INTEGRATION ARCHITECTURE

### 3.1 How Real GDRFA Workflows Likely Work

GDRFA (General Directorate of Residency and Foreigners Affairs) operates a web-based portal. Based on publicly documented workflow behavior:

```
User → Portal Login (Emirates ID / Username + Password)
     → OTP sent to registered mobile
     → OTP verified → Session cookie issued
     → Dashboard loaded (AJAX-based, dynamic content)
     → Status lookups via internal API calls (XHR/Fetch)
     → Session maintained via cookie
     → Session expires after inactivity (~15-30 minutes)
```

**Technical reality:**
- The portal is not a static page. It uses dynamic JavaScript rendering.
- Status data is returned via internal XHR requests, not visible in the initial HTML.
- CAPTCHA is present on login and sometimes on repeated lookups.
- Session tokens have short TTL.
- Portal may detect automation via browser fingerprinting.

### 3.2 Login Flow Analysis

```
Step 1: GET /login → receive login page + CSRF token
Step 2: POST /login with credentials + CSRF token
Step 3: Receive OTP challenge page
Step 4: User enters OTP → POST /verify-otp
Step 5: Receive session cookie (HttpOnly, Secure)
Step 6: Use session cookie for all subsequent requests
Step 7: Periodic keep-alive ping to maintain session
Step 8: Detect session expiry → re-authenticate
```

### 3.3 CAPTCHA Problems

Real portals use several bot-detection layers:

| Layer | Detection Method | Mitigation |
|---|---|---|
| reCAPTCHA v2 | Image selection challenge | 2captcha / Anti-Captcha / human assist |
| reCAPTCHA v3 | Behavior scoring (invisible) | Stealth mode browsers, real mouse movement |
| Cloudflare | Browser fingerprinting + TLS | Playwright with stealth plugin |
| IP-based rate limiting | Too many requests from same IP | IP rotation / residential proxies |
| Honeypot fields | Hidden form fields | Inspect DOM carefully |

### 3.4 Browser Automation Tool Comparison

| Tool | Language | Headless | Anti-Bot | Ease | Recommendation |
|---|---|---|---|---|---|
| **Selenium** | Java/Python/JS | Yes | Poor | Medium | Legacy; avoid for new builds |
| **Playwright** | JS/Python/Java | Yes | Good (with stealth) | High | ✅ **Recommended** |
| **Puppeteer** | JS only | Yes | Medium | High | Good but Chrome-only |
| **Cypress** | JS only | Yes | Poor | High | E2E testing, not scraping |
| **Mechanize** | Python | No | None | Low | Only for simple HTML forms |

**Recommendation: Playwright with `playwright-extra` + `puppeteer-extra-plugin-stealth`**

Reasons:
- Cross-browser support (Chromium, Firefox, WebKit)
- Built-in network interception (capture XHR responses directly)
- Better at human-behavior simulation
- Active development by Microsoft
- Excellent TypeScript support

### 3.5 When to Use API vs. Browser Automation

```
IF official API exists and is authorized → Use API (always preferred)
IF no API exists but portal is public → Browser automation is the fallback
IF company has partnership/MOU with authority → Request API credentials
IF automation is for internal data → Fine ethically and legally
```

---

## SECTION 4 — LEGAL & COMPLIANCE ANALYSIS

### 4.1 Legal Landscape of Portal Automation

**Three categories of automation risk:**

1. **Fully authorized** — You have a signed API agreement or MOU with the government authority. Full legal cover.
2. **Gray zone** — You are automating a public portal using credentials your company legitimately holds. No API agreement, but no explicit prohibition either. Risk is moderate.
3. **Unauthorized scraping** — You are extracting data without any credentials or authorization. This is legally risky and can violate Computer Fraud and Abuse Act equivalents in UAE (Federal Decree-Law No. 34 of 2021 on Combating Rumours and Cybercrime).

**Your scenario (company automating its own visa status checks using its own credentials) falls into Category 2.**

### 4.2 Enterprise-Safe Architecture Principles

```
1. Always use official APIs when available — never scrape if an API exists
2. Rate-limit your own requests — do not hammer the portal
3. Store only necessary data — follow data minimization principles
4. Encrypt all stored passport numbers and personal data (AES-256)
5. Maintain an audit log of every data access
6. Use company-owned credentials only — never share or re-use credentials
7. Build a manual fallback — automation should assist humans, not replace oversight
8. Document your automation processes — legal protection if questioned
9. Get legal sign-off before deploying against government systems
10. Build a consent mechanism if collecting personal data on behalf of individuals
```

### 4.3 Data Protection Compliance (UAE Context)

UAE Federal Decree-Law No. 45 of 2021 (Personal Data Protection Law) applies:
- Personal data (passport numbers, visa numbers, names) must be stored securely
- Data subjects have rights of access and correction
- Cross-border data transfer restrictions apply
- Retention limits must be enforced (delete old records)

**Technical implementations required:**
- Encrypt PII at rest (AES-256)
- Encrypt PII in transit (TLS 1.3)
- Log all data access with user identity
- Implement data retention TTL policies
- Build a data deletion workflow

---

## SECTION 5 — ENTERPRISE WORKFLOW DESIGN

### 5.1 Complete Service Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                                │
│   Web Dashboard  │  Mobile App  │  Admin Panel  │  External APIs    │
└────────────────────────┬────────────────────────────────────────────┘
                         │ HTTPS / JWT
┌────────────────────────▼────────────────────────────────────────────┐
│                      API GATEWAY (Kong / Nginx)                      │
│         Rate Limiting · Auth · Routing · SSL Termination            │
└────────────────────────┬────────────────────────────────────────────┘
                         │
     ┌───────────────────┼───────────────────────┐
     ▼                   ▼                       ▼
┌─────────┐      ┌──────────────┐      ┌─────────────────┐
│  Auth   │      │  Visa API    │      │  Reconciliation │
│ Service │      │  Service     │      │  Service        │
│ (OTP,   │      │ (CRUD ops,   │      │  (Compare,      │
│  JWT)   │      │  status)     │      │   ghost detect) │
└────┬────┘      └──────┬───────┘      └────────┬────────┘
     │                  │                       │
     └──────────────────┼───────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────────────────┐
│                      MESSAGE QUEUE (BullMQ + Redis)                   │
│   visa_status_checks · reconciliation_jobs · alerts · reports        │
└───────────────────────┬──────────────────────────────────────────────┘
                        │
       ┌────────────────┼─────────────────────────┐
       ▼                ▼                         ▼
┌──────────────┐ ┌──────────────────┐ ┌───────────────────┐
│  Automation  │ │  Reconciliation  │ │  Reporting        │
│  Worker      │ │  Worker          │ │  Worker           │
│  (Playwright)│ │  (Compare +      │ │  (Generate        │
│              │ │   ghost detect)  │ │   PDF/Excel)      │
└──────┬───────┘ └──────┬───────────┘ └──────┬────────────┘
       │                │                    │
       └────────────────┼────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────────────────┐
│                    DATA LAYER                                         │
│   PostgreSQL (primary)  │  Redis (cache/sessions)  │  S3 (reports)  │
└───────────────────────────────────────────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────────────────┐
│                    ALERTING & MONITORING                              │
│   Slack Webhooks  │  Email (SendGrid)  │  PagerDuty  │  Grafana     │
└───────────────────────────────────────────────────────────────────────┘
```

### 5.2 Service Responsibilities

**Auth Service**
- Issue OTP via SMS (Twilio / AWS SNS)
- Verify OTP with 3-attempt limit and 5-minute TTL
- Issue JWT access tokens (15-minute expiry)
- Issue refresh tokens (7-day expiry, stored in Redis)
- Government portal session management (keep-alive logic)

**Visa API Service**
- CRUD for visa applications
- Passport-based status lookup
- Entry/exit event recording with idempotency
- Webhook receiver for external updates

**Reconciliation Service**
- Schedule and run reconciliation jobs
- Compare internal status vs. government portal status
- Detect ghost passengers
- Create reconciliation records
- Fire alerts on mismatch

**Automation Worker**
- Playwright-based browser automation
- Login and session management for government portal
- Status scraping with retry logic
- Screenshot capture on failure for debugging
- Report results back via queue

**Reporting Worker**
- Generate PDF/Excel ghost passenger reports
- Generate reconciliation summary reports
- Upload to S3, notify user with signed URL
- Schedule daily/weekly automated reports

### 5.3 Queue Architecture (BullMQ)

```javascript
// Queue definitions
const queues = {
  statusCheck: new Queue('visa_status_check'),       // Priority: HIGH
  reconciliation: new Queue('reconciliation'),        // Priority: MEDIUM
  ghostDetection: new Queue('ghost_detection'),       // Priority: HIGH
  reporting: new Queue('reporting'),                  // Priority: LOW
  alerting: new Queue('alerting'),                    // Priority: CRITICAL
  portalLogin: new Queue('portal_session'),           // Priority: HIGH
};

// Job scheduling
await queues.reconciliation.add('full-reconcile', {}, {
  repeat: { cron: '0 */6 * * *' }, // Every 6 hours
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
});
```

### 5.4 Retry & Failure Recovery

```
Attempt 1: Immediate
Attempt 2: After 5 seconds (exponential backoff)
Attempt 3: After 25 seconds
Attempt 4: After 125 seconds
Attempt 5: Move to Dead Letter Queue (DLQ)

DLQ → Alert fired → Human review → Manual re-queue or dismiss
```

---

## SECTION 6 — STEP-BY-STEP IMPLEMENTATION ROADMAP

### Phase 1 — Hardened Mock API System (Weeks 1–2)

**Objective:** Replace in-memory mock with a real PostgreSQL-backed API system with proper validation, error handling, and logging.

**Tools:** Node.js · Express.js · PostgreSQL · Prisma ORM · Joi (validation) · Winston (logging) · Jest (testing)

**Implementation Steps:**

```
Step 1: Set up PostgreSQL with Docker Compose
Step 2: Install Prisma, define schema (see Section 7)
Step 3: Add Joi validation middleware to all routes
Step 4: Replace mock data with Prisma queries
Step 5: Add Winston logger with structured JSON output
Step 6: Add express-rate-limit (100 req/15min per IP)
Step 7: Add helmet.js for security headers
Step 8: Add idempotency middleware for entry/exit events
Step 9: Write unit tests for all endpoints
Step 10: Document APIs with Swagger/OpenAPI
```

**Risks:** Prisma migration conflicts on schema changes  
**Mitigation:** Use migration files, never edit migrations after applying

---

### Phase 2 — Browser Automation Layer (Weeks 3–4)

**Objective:** Build a robust Playwright automation layer that can log into the government portal, handle OTP, manage sessions, and fetch visa statuses.

**Tools:** Playwright · playwright-extra · puppeteer-extra-plugin-stealth · TypeScript

**Implementation Steps:**

```
Step 1: Install Playwright + stealth plugin
   npm install playwright playwright-extra puppeteer-extra-plugin-stealth

Step 2: Create BrowserSessionManager class
   - Maintains a pool of authenticated browser contexts
   - Detects session expiry and re-authenticates
   - Rotates sessions to avoid detection

Step 3: Build LoginAutomation module
   - Navigate to portal
   - Fill username/password
   - Handle CAPTCHA (manual assist or 2captcha integration)
   - Enter OTP
   - Confirm session cookie received

Step 4: Build StatusFetcher module
   - Accept passport number as input
   - Navigate to status lookup page
   - Intercept XHR response containing status data
   - Parse and return structured status object

Step 5: Add screenshot capture on every failure
   - Save to /screenshots/{timestamp}-{passportHash}.png
   - Upload to S3 for later debugging

Step 6: Build retry wrapper (3 attempts before queuing for manual review)

Step 7: Integrate with BullMQ worker
   - Worker picks job from queue
   - Calls BrowserSessionManager
   - Returns result to Reconciliation Service
```

**Sample BrowserSessionManager structure:**

```typescript
class BrowserSessionManager {
  private sessions: Map<string, BrowserContext> = new Map();

  async getSession(accountId: string): Promise<BrowserContext> {
    const existing = this.sessions.get(accountId);
    if (existing && await this.isSessionAlive(existing)) {
      return existing;
    }
    return this.createSession(accountId);
  }

  private async createSession(accountId: string): Promise<BrowserContext> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ...stealthConfig });
    await this.loginToPortal(context, accountId);
    this.sessions.set(accountId, context);
    return context;
  }

  private async isSessionAlive(context: BrowserContext): Promise<boolean> {
    // Attempt a lightweight keep-alive ping
    const page = await context.newPage();
    const response = await page.goto('/session-check');
    await page.close();
    return response?.status() === 200;
  }
}
```

**Risks:** Government portal structure changes break selectors  
**Mitigation:** Use data-attribute selectors, not CSS classes; add visual regression tests

---

### Phase 3 — Session Handling & State Management (Week 5)

**Objective:** Centralize session state in Redis so sessions survive worker restarts.

**Implementation Steps:**

```
Step 1: Store browser cookies in Redis after login
   Key: session:{accountId}
   TTL: 25 minutes (slightly less than portal timeout)
   Value: JSON.stringify(await context.cookies())

Step 2: On worker startup, restore cookies from Redis before trying login

Step 3: Build keep-alive scheduler
   - Every 10 minutes, each active session sends a lightweight portal ping
   - Resets TTL in Redis
   - If ping fails, marks session as EXPIRED → triggers re-auth

Step 4: Build session pool for multiple portal accounts (if available)

Step 5: Implement session locking
   - Use Redis distributed lock (redlock library)
   - Prevent two workers from using the same session simultaneously
```

---

### Phase 4 — Status Reconciliation Engine (Weeks 6–7)

**Objective:** Build the core reconciliation engine that compares internal status vs. portal status and generates mismatch records.

**Implementation Steps:**

```
Step 1: Define reconciliation job data model (see Section 7)

Step 2: Build ReconciliationEngine class
   async reconcile(passportList: string[]) {
     for (const passport of passportList) {
       const internalStatus = await db.getStatus(passport);
       const portalStatus = await portalFetcher.fetch(passport);
       
       if (internalStatus !== portalStatus) {
         await db.createMismatch({
           passport,
           internalStatus,
           portalStatus,
           detectedAt: new Date(),
           resolved: false,
         });
         await alertQueue.add('mismatch-alert', { passport, internalStatus, portalStatus });
       }
     }
   }

Step 3: Schedule reconciliation via BullMQ cron
   - Full reconciliation: every 6 hours (all active visas)
   - Targeted reconciliation: every 30 minutes (flagged records only)
   - Immediate reconciliation: triggered by entry/exit event webhook

Step 4: Build resolution workflow
   - Auto-resolve if portal status is authoritative and difference is < 24 hours
   - Escalate to human if > 24 hours or passport shows overstay risk

Step 5: Update internal record when portal status is confirmed
   - Log the correction in audit_log table
   - Mark reconciliation record as RESOLVED
```

---

### Phase 5 — Ghost Detection Engine (Week 8)

**Objective:** Automated ghost passenger identification with risk scoring.

**Ghost Detection Algorithm:**

```javascript
async function detectGhosts(records) {
  const ghosts = [];
  
  for (const record of records) {
    const score = calculateGhostScore(record);
    
    if (score >= GHOST_THRESHOLD) {
      ghosts.push({
        passportNumber: record.passport,
        name: record.name,
        internalStatus: record.status,
        lastExitScan: record.lastExitScan,
        lastPortalSync: record.lastPortalSync,
        ghostScore: score,
        riskLevel: getRiskLevel(score),
        suggestedAction: getSuggestedAction(record),
      });
    }
  }
  
  return ghosts;
}

function calculateGhostScore(record) {
  let score = 0;
  
  // Internal says IN_COUNTRY but exit scanned > 24h ago
  if (record.status === 'IN_COUNTRY' && record.lastExitScan) {
    const hoursSinceExit = hoursDiff(record.lastExitScan, now());
    if (hoursSinceExit > 24) score += 40;
    if (hoursSinceExit > 72) score += 30;
  }
  
  // Portal status mismatches
  if (record.portalStatus !== record.internalStatus) score += 25;
  
  // No portal sync in > 12 hours for active record
  const hoursSinceSync = hoursDiff(record.lastPortalSync, now());
  if (hoursSinceSync > 12) score += 20;
  
  // Visa expired but showing as active
  if (record.visaExpiry < now() && record.status === 'ACTIVE') score += 30;
  
  return Math.min(score, 100);
}

function getRiskLevel(score) {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}
```

---

### Phase 6 — Reporting System (Week 9)

**Objective:** Automated generation of ghost reports, reconciliation summaries, and compliance reports.

**Implementation Steps:**

```
Step 1: Install report generation libraries
   npm install exceljs pdfkit @sendgrid/mail

Step 2: Build GhostPassengerReport
   - Query all ghost alerts from last N days
   - Group by risk level, department, sponsor
   - Generate Excel with color-coded rows
   - Generate PDF summary with charts

Step 3: Build ReconciliationReport
   - Total records checked
   - Mismatches found
   - Mismatches auto-resolved
   - Mismatches escalated
   - Trend vs. previous period

Step 4: Schedule automated report delivery
   - Daily: Ghost passenger summary → Operations team
   - Weekly: Full reconciliation report → Management
   - Monthly: Compliance report → Legal/HR

Step 5: Upload reports to S3
   - Generate pre-signed URL (valid 7 days)
   - Send URL via email/Slack
```

---

### Phase 7 — Production Deployment (Weeks 10–12)

**Objective:** Deploy to production with zero-downtime, monitoring, and disaster recovery.

**Infrastructure:**

```yaml
# docker-compose.production.yml
services:
  api:
    image: visa-api:latest
    replicas: 3
    resources:
      limits:
        cpus: '1'
        memory: 512M

  automation-worker:
    image: visa-automation-worker:latest
    replicas: 2  # Each worker = one browser context
    resources:
      limits:
        cpus: '2'
        memory: 2G  # Playwright needs more memory

  reconciliation-worker:
    image: visa-reconciliation-worker:latest
    replicas: 2

  n8n:
    image: n8nio/n8n
    environment:
      - DB_TYPE=postgresdb
      - EXECUTIONS_PROCESS=main

  postgres:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes

  nginx:
    image: nginx:alpine
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
```

**Deployment checklist:**
- [ ] Environment variables via Kubernetes Secrets / AWS Secrets Manager
- [ ] Database migrations run before pod startup
- [ ] Readiness probe on `/health` endpoint
- [ ] Liveness probe on `/ping` endpoint
- [ ] Horizontal Pod Autoscaler (scale on CPU > 70%)
- [ ] PodDisruptionBudget (minimum 1 replica always running)
- [ ] Automated DB backups every 6 hours to S3
- [ ] Prometheus + Grafana monitoring dashboard
- [ ] PagerDuty integration for critical alerts

---

## SECTION 7 — DATABASE DESIGN

### 7.1 Recommendation: PostgreSQL + Redis

**PostgreSQL** for:
- All persistent business data
- ACID transactions for status updates
- Complex queries with JOINs
- Audit logs with immutable writes

**Redis** for:
- OTP session storage (TTL: 5 minutes)
- Browser session cookie cache (TTL: 25 minutes)
- JWT refresh token blacklist
- BullMQ queue backend
- Real-time dashboard counters

**MongoDB is NOT recommended here** because:
- Reconciliation requires complex multi-table JOINs
- ACID compliance is critical for status updates
- PostgreSQL's JSONB column gives you flexibility if needed

### 7.2 Complete Database Schema

```sql
-- Users & Authentication
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  role            VARCHAR(50) NOT NULL DEFAULT 'operator',  -- admin, operator, viewer
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Passport Holders
CREATE TABLE passengers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passport_number VARCHAR(20) UNIQUE NOT NULL,  -- ENCRYPTED at application layer
  full_name       TEXT NOT NULL,                -- ENCRYPTED
  nationality     VARCHAR(100),
  date_of_birth   DATE,
  sponsor_company VARCHAR(255),
  department      VARCHAR(255),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Visa Applications
CREATE TABLE visa_applications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id        UUID NOT NULL REFERENCES passengers(id),
  visa_number         VARCHAR(50) UNIQUE,
  visa_type           VARCHAR(50),   -- employment, visit, transit
  status              VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    -- PENDING, APPROVED, REJECTED, ACTIVE, EXPIRED, CANCELLED
  portal_status       VARCHAR(50),   -- Status as returned by government portal
  issued_date         DATE,
  expiry_date         DATE,
  last_portal_sync    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Status History (immutable, append-only)
CREATE TABLE status_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES visa_applications(id),
  old_status      VARCHAR(50),
  new_status      VARCHAR(50) NOT NULL,
  changed_by      UUID REFERENCES users(id),  -- NULL if system-automated
  source          VARCHAR(50) NOT NULL,  -- MANUAL, PORTAL_SYNC, ENTRY_EVENT, EXIT_EVENT, RECONCILIATION
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Entry/Exit Events
CREATE TABLE border_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES visa_applications(id),
  event_type      VARCHAR(10) NOT NULL,  -- ENTRY, EXIT
  event_datetime  TIMESTAMPTZ NOT NULL,
  port_of_entry   VARCHAR(100),
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  source          VARCHAR(50),  -- MANUAL, AUTOMATION, WEBHOOK
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_border_events_application ON border_events(application_id);
CREATE INDEX idx_border_events_datetime ON border_events(event_datetime);

-- Reconciliation Jobs
CREATE TABLE reconciliation_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type        VARCHAR(50) NOT NULL,  -- FULL, TARGETED, TRIGGERED
  status          VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    -- PENDING, RUNNING, COMPLETED, FAILED
  total_records   INTEGER,
  checked_records INTEGER DEFAULT 0,
  mismatch_count  INTEGER DEFAULT 0,
  ghost_count     INTEGER DEFAULT 0,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reconciliation Mismatches
CREATE TABLE reconciliation_mismatches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              UUID NOT NULL REFERENCES reconciliation_jobs(id),
  application_id      UUID NOT NULL REFERENCES visa_applications(id),
  internal_status     VARCHAR(50) NOT NULL,
  portal_status       VARCHAR(50) NOT NULL,
  mismatch_type       VARCHAR(50),  -- STATUS_MISMATCH, GHOST_PASSENGER, MISSING_RECORD
  risk_level          VARCHAR(20),  -- LOW, MEDIUM, HIGH, CRITICAL
  ghost_score         INTEGER,      -- 0-100
  auto_resolved       BOOLEAN DEFAULT false,
  resolved_at         TIMESTAMPTZ,
  resolved_by         UUID REFERENCES users(id),
  resolution_notes    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ghost Alerts
CREATE TABLE ghost_alerts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id      UUID NOT NULL REFERENCES visa_applications(id),
  mismatch_id         UUID REFERENCES reconciliation_mismatches(id),
  ghost_score         INTEGER NOT NULL,
  risk_level          VARCHAR(20) NOT NULL,
  status              VARCHAR(50) NOT NULL DEFAULT 'OPEN',
    -- OPEN, ACKNOWLEDGED, INVESTIGATING, RESOLVED, FALSE_POSITIVE
  last_known_location VARCHAR(100),
  hours_since_exit    NUMERIC,
  suggested_action    TEXT,
  acknowledged_by     UUID REFERENCES users(id),
  acknowledged_at     TIMESTAMPTZ,
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- OTP Sessions
CREATE TABLE otp_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier      VARCHAR(255) NOT NULL,  -- phone or email (hashed)
  otp_hash        TEXT NOT NULL,          -- hashed OTP
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  expires_at      TIMESTAMPTZ NOT NULL,
  verified        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Note: Also cache in Redis with TTL for fast lookup

-- Audit Logs (immutable)
CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),
  action      VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100),
  entity_id   UUID,
  old_values  JSONB,
  new_values  JSONB,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

-- Automation Run Logs
CREATE TABLE automation_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id       VARCHAR(100),
  job_queue       VARCHAR(100),
  job_id          VARCHAR(255),
  passport_hash   TEXT,   -- hashed passport for log reference without storing PII
  action          VARCHAR(100),
  status          VARCHAR(50),   -- SUCCESS, FAILED, RETRY
  attempts        INTEGER DEFAULT 1,
  duration_ms     INTEGER,
  error_message   TEXT,
  screenshot_url  TEXT,   -- S3 URL if screenshot captured on failure
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 7.3 Redis Key Design

```
otp:{identifier_hash}           → { otp_hash, attempts, expires_at }   TTL: 300s
session:{accountId}             → { cookies: [...] }                    TTL: 1500s
session_lock:{accountId}        → 1                                     TTL: 60s (redlock)
jwt_blacklist:{jti}             → 1                                     TTL: token_ttl
dashboard:ghost_count           → integer                               TTL: 30s
dashboard:reconciliation_stats  → { checked, mismatches, resolved }     TTL: 60s
```

---

## SECTION 8 — n8n AUTOMATION STRATEGY

### 8.1 Best Practices for n8n in Production

```
1. Use n8n as the ORCHESTRATOR, not the executor
   - n8n triggers workers via webhooks/queues
   - Workers do the heavy lifting (Playwright, DB queries)
   - n8n handles branching, scheduling, notifications

2. One workflow = one business process
   - Do not combine visa status check + reconciliation in one workflow
   - Separate workflows = easier debugging, independent deployment

3. Always use Error Trigger node
   - Every workflow must have an error branch
   - On error: log to DB, send Slack alert, retry or escalate

4. Use environment variables for all credentials
   - Never hardcode URLs, API keys, or credentials in n8n nodes

5. Use n8n's built-in execution data for audit trail
   - Enable data saving for failed executions
   - Store execution IDs in your DB for cross-referencing
```

### 8.2 Recommended n8n Workflow Architecture

```
Orchestrator Workflows (n8n manages)
├── Schedule Trigger → HTTP Request (trigger reconciliation API)
├── Webhook (receive failure alert) → Slack notification
├── Cron → HTTP Request (trigger daily report generation)
├── Webhook (receive ghost alert) → Email + Slack + DB log
└── Schedule Trigger → HTTP Request (trigger portal session refresh)

Execution Workflows (n8n triggers, workers execute)
├── Visa Status Check Worker (BullMQ)
├── Reconciliation Worker (BullMQ)
├── Ghost Detection Worker (BullMQ)
└── Report Generation Worker (BullMQ)
```

### 8.3 n8n Webhook Architecture

```
POST /webhook/reconciliation-trigger
→ n8n validates payload
→ n8n calls internal API: POST /api/reconciliation/start
→ API enqueues reconciliation job
→ Returns job_id to n8n
→ n8n stores job_id
→ n8n sets up polling or waits for completion webhook

POST /webhook/job-complete (called by worker when done)
→ n8n receives completion
→ n8n calls reporting API
→ n8n sends Slack notification with report URL
```

### 8.4 n8n Error Handling Pattern

```javascript
// In every n8n workflow's "Execute Command" / "HTTP Request" node,
// always add an output for errors and connect it to:
//   1. DB logging node (HTTP Request to your /api/logs endpoint)
//   2. Slack alert node
//   3. Optional: retry node with delay
```

---

## SECTION 9 — PLAYWRIGHT AUTOMATION STRATEGY

### 9.1 Login Automation with Anti-Bot Handling

```typescript
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

async function loginToPortal(credentials: PortalCredentials): Promise<Page> {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
    timezoneId: 'Asia/Dubai',
  });

  const page = await context.newPage();

  // Simulate human-like navigation
  await page.goto(PORTAL_URL, { waitUntil: 'networkidle' });
  await humanDelay(1500, 2500);

  // Fill credentials with human-like typing speed
  await page.type('#username', credentials.username, { delay: randomBetween(50, 150) });
  await humanDelay(500, 1000);
  await page.type('#password', credentials.password, { delay: randomBetween(50, 150) });
  await humanDelay(300, 800);

  // Handle CAPTCHA if present
  if (await page.$('.g-recaptcha')) {
    await handleCaptcha(page); // 2captcha integration or pause for manual entry
  }

  await page.click('[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 15000 });

  return page;
}

// Human-like delay simulation
function humanDelay(min: number, max: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, randomBetween(min, max)));
}
```

### 9.2 OTP Handling Strategies

```
Strategy 1: SMS Interception via company phone number
   - Company owns the SIM card registered to the portal account
   - Integrate with SMS gateway that exposes received SMS via API
   - Poll SMS API for OTP code
   - Auto-fill OTP

Strategy 2: Email OTP
   - Use Gmail API or IMAP to read latest OTP email
   - Parse OTP via regex
   - Auto-fill

Strategy 3: Human-in-the-loop (most reliable for sensitive portals)
   - Automation pauses and sends WhatsApp/Slack message to human operator
   - Human reads OTP from phone and enters in a web form
   - Automation receives OTP via webhook and continues
```

### 9.3 Network Interception for Status Data

```typescript
// Instead of scraping HTML, intercept the XHR API calls the portal makes
page.on('response', async (response) => {
  const url = response.url();
  if (url.includes('/api/visa/status') || url.includes('/visaStatus')) {
    const json = await response.json();
    // Extract status from the actual API response — more reliable than HTML parsing
    return parseStatusFromPortalResponse(json);
  }
});

await page.goto(`${PORTAL_URL}/status-check?passport=${passportNumber}`);
await page.waitForTimeout(3000); // Wait for XHR to complete
```

This approach is **much more reliable** than HTML scraping because:
- You get structured JSON, not HTML to parse
- Layout changes don't break your extractor
- Data is clean and typed

### 9.4 Browser Scaling Architecture

```
For 100 passport checks/hour:
  - 2 Playwright worker instances
  - Each worker processes 1 passport at a time (serial)
  - With 30s per check → 2 workers × 120 checks/hour = sufficient

For 1,000 passport checks/hour:
  - 10 Playwright worker instances
  - Consider Playwright's browser context pooling
  - Run on dedicated EC2 instances with higher memory (4GB+)
  - Use Kubernetes for auto-scaling based on queue depth

For 10,000+ checks/hour:
  - Consider Browserless.io (managed browser fleet)
  - Or self-hosted Playwright Grid
  - Combine with caching (don't re-check if synced < 1 hour ago)
```

---

## SECTION 10 — REPORTING SYSTEM

### 10.1 Report Types & Design

**Ghost Passenger Report**

```
Report: Ghost Passenger Summary
Generated: 2024-01-15 08:00 UTC
Period: Last 24 Hours

SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Passengers Tracked:    1,247
Active Visas:                  892
Ghosts Detected:                23
  ├── CRITICAL (score > 80):     4
  ├── HIGH (score 60-80):        9
  └── MEDIUM (score 40-60):     10

CRITICAL GHOST PASSENGERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Passport    | Name        | Ghost Score | Hours Since Exit | Action Required
P-XXXXX1    | ████ ████   | 95          | 96 hours         | IMMEDIATE REVIEW
P-XXXXX2    | ████ ████   | 88          | 72 hours         | VERIFY WITH PORTAL
...

TREND ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
vs. Yesterday:   +3 ghosts (+15%)
vs. Last Week:   -8 ghosts (-26%)
vs. Last Month:  -31 ghosts (-57%)  [System improving ✓]
```

### 10.2 Report Implementation

```javascript
async function generateGhostReport(dateRange) {
  const workbook = new ExcelJS.Workbook();
  
  // Summary sheet
  const summary = workbook.addWorksheet('Summary');
  summary.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 20 },
  ];
  
  const stats = await db.getGhostStats(dateRange);
  summary.addRows([
    { metric: 'Total Passengers Tracked', value: stats.total },
    { metric: 'Ghosts Detected', value: stats.ghostCount },
    { metric: 'Critical Risk', value: stats.critical },
    { metric: 'Auto-Resolved', value: stats.autoResolved },
  ]);
  
  // Ghost detail sheet
  const ghosts = workbook.addWorksheet('Ghost Passengers');
  const ghostData = await db.getGhostAlerts({ status: 'OPEN', dateRange });
  
  ghostData.forEach(ghost => {
    const row = ghosts.addRow({...ghost});
    // Color-code by risk level
    if (ghost.riskLevel === 'CRITICAL') row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
    if (ghost.riskLevel === 'HIGH') row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFA500' } };
  });
  
  // Save to buffer and upload to S3
  const buffer = await workbook.xlsx.writeBuffer();
  const s3Key = `reports/ghost-${Date.now()}.xlsx`;
  await s3.upload({ Bucket: BUCKET, Key: s3Key, Body: buffer }).promise();
  
  return s3.getSignedUrl('getObject', { Bucket: BUCKET, Key: s3Key, Expires: 604800 });
}
```

### 10.3 All Report Types

| Report | Trigger | Audience | Format |
|---|---|---|---|
| Ghost Passenger Summary | Daily 8am | Operations | Excel + Email |
| Reconciliation Summary | After each reconciliation run | System Admin | PDF |
| Automation Failure Report | On failure | Engineering | Slack alert |
| Compliance Report | Monthly | Legal / HR | PDF |
| Status Mismatch Report | On detection | Operations | Email + Dashboard |
| Portal Session Health | Every hour | Engineering | Dashboard only |

---

## SECTION 11 — AI/ML POSSIBILITIES

### 11.1 Anomaly Detection

```
Model: Isolation Forest or Autoencoder on time-series data
Features:
  - Time since last sync
  - Historical sync reliability per passport
  - Time of day patterns
  - Entry/exit frequency patterns
  - Number of status changes in last 30 days

Output: Anomaly score (0-1)
Action: Prioritize high-anomaly records for next reconciliation cycle
```

### 11.2 Ghost Prediction (Before It Happens)

```
Model: Random Forest Classifier
Training data: Historical records that became ghosts vs. those that didn't

Features:
  - Days since last successful sync
  - Exit port (some ports have higher failure rates)
  - Time of exit (peak hours have higher system load = more failures)
  - Worker that processed the exit event (some have higher failure rates)
  - Visa type and sponsor category

Output: Probability of becoming a ghost (0-1)
Action: Proactively reconcile high-probability records
```

### 11.3 Smart Reconciliation Prioritization

Instead of reconciling all records every 6 hours, use the model to prioritize:

```
Priority 1 (reconcile every 30 min): ghost_probability > 0.8
Priority 2 (reconcile every 2 hrs):  ghost_probability 0.5-0.8
Priority 3 (reconcile every 6 hrs):  ghost_probability 0.2-0.5
Priority 4 (reconcile every 24 hrs): ghost_probability < 0.2
```

This reduces portal API calls by ~70% while increasing detection speed for high-risk records.

### 11.4 Automation Health Monitoring

```
Model: Simple threshold + trend detection on:
  - Worker success rate (should be > 95%)
  - Session expiry frequency (spike = portal changed something)
  - Average check duration (spike = portal is slow or adding new CAPTCHA)
  - Selector failure rate (spike = portal HTML structure changed)

Alert: If any metric deviates > 2 standard deviations from 7-day rolling average
```

### 11.5 NLP for Unstructured Portal Data

Some government portal pages return status in free text.

```
Input: "The visa holder has departed the country. Exit recorded on 14 Jan 2024."
NLP extraction:
  - Status: EXITED
  - Date: 2024-01-14
  - Confidence: 0.97

Tools: spaCy + custom NER model, or GPT-4 with structured output prompting
```

---

## SECTION 12 — INTERVIEW & MEETING EXPLANATION

### 12.1 Business Explanation (For Non-Technical Audience)

> "We've built an automated system that continuously monitors the travel status of our employees and visa holders against the government portal. When someone exits the UAE, multiple systems need to agree on that fact — our internal system, the government's records, and HR. Sometimes these systems get out of sync, creating what we call 'ghost passengers' — people who have physically left but are still showing as present in our system. Our system automatically detects these mismatches, alerts the relevant teams, and corrects the records — preventing compliance violations, processing delays, and incorrect reporting."

### 12.2 Technical Explanation (For Engineering Audience)

> "The core of the system is an event-driven reconciliation engine. We have an Express.js API layer that handles entry/exit events and writes to PostgreSQL. A scheduled BullMQ worker runs reconciliation jobs every 6 hours, comparing our internal visa status table against the government portal's live data, which we fetch via Playwright browser automation with session management backed by Redis. Any mismatch generates a reconciliation record and fires an alert via the queue. Ghost passengers are identified via a scoring algorithm that considers status mismatch, time since exit scan, and sync freshness. n8n orchestrates the scheduling and notification workflows, while the core processing runs in isolated worker services."

### 12.3 Architecture Explanation (For a Whiteboard Session)

```
Draw these layers:

[Client] → [API Gateway] → [Three services: Auth, Visa, Reconciliation]
                                        ↓
                              [BullMQ Queue on Redis]
                                        ↓
                    [Three workers: Automation, Reconciliation, Reporting]
                                        ↓
                              [PostgreSQL + Redis + S3]
                                        ↓
                              [Alerting: Slack + Email + Dashboard]
```

Then explain: "The key insight is separating the API layer from the processing layer via a message queue. This gives us retry logic, backpressure handling, and independent scaling."

### 12.4 Why This Can Become a Product

> "This system is designed as a white-label B2B SaaS product. Any company managing large numbers of sponsored visa holders in the UAE faces this exact problem. We can offer this as a subscription service — they connect their employee data to our system, we run the reconciliation and deliver daily ghost passenger reports. The automation layer is designed to be portal-agnostic, so we can adapt it for GDRFA, MOL, ICA, and similar authorities across GCC countries. The AI layer would allow us to sell predictive compliance monitoring as a premium tier."

---

## SECTION 13 — FINAL ENTERPRISE ARCHITECTURE

### 13.1 Complete System Architecture Diagram

```
╔══════════════════════════════════════════════════════════════════════╗
║                     VISA WORKFLOW AUTOMATION SYSTEM                  ║
║                         Production Architecture                      ║
╚══════════════════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────────────┐
│                          PRESENTATION LAYER                          │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │  Web Dashboard│  │  Admin Panel │  │  Mobile App  │             │
│  │  (React.js)  │  │  (Next.js)   │  │  (React Native│             │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘             │
└─────────┼─────────────────┼─────────────────┼───────────────────────┘
          │                 │                 │
          └─────────────────┼─────────────────┘
                            │ HTTPS + JWT
┌───────────────────────────▼──────────────────────────────────────────┐
│                        API GATEWAY LAYER                             │
│              Nginx / Kong · Rate Limiting · Auth · SSL               │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
    ┌───────────────────────┼───────────────────┐
    │                       │                   │
    ▼                       ▼                   ▼
┌─────────┐         ┌─────────────┐     ┌──────────────┐
│  Auth   │         │  Visa API   │     │  Recon API   │
│ Service │         │  Service    │     │  Service     │
│         │         │             │     │              │
│ /send-  │         │ /create-app │     │ /reconcile   │
│  otp    │         │ /status     │     │ /ghost-check │
│ /verify │         │ /entry-evt  │     │ /mismatches  │
│ /auth   │         │ /exit-evt   │     │ /resolve     │
└────┬────┘         └──────┬──────┘     └──────┬───────┘
     │                     │                   │
     └─────────────────────┼───────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│              MESSAGE QUEUE LAYER (BullMQ on Redis)                  │
│                                                                     │
│  [visa_status_check]  [reconciliation]  [ghost_detection]          │
│  [report_generation]  [alerting]        [portal_session]           │
└────────────────────────┬────────────────────────────────────────────┘
                         │
       ┌─────────────────┼────────────────────┐
       │                 │                    │
       ▼                 ▼                    ▼
┌────────────┐   ┌────────────────┐   ┌────────────────┐
│ AUTOMATION │   │ RECONCILIATION │   │   REPORTING    │
│  WORKER    │   │    WORKER      │   │    WORKER      │
│            │   │                │   │                │
│ Playwright │   │ Compare status │   │ Excel / PDF    │
│ Session Mgr│   │ Ghost detection│   │ S3 upload      │
│ Portal auth│   │ Auto-resolve   │   │ Email delivery │
│ XHR capture│   │ Alert firing   │   │                │
└─────┬──────┘   └───────┬────────┘   └───────┬────────┘
      │                  │                    │
      └──────────────────┼────────────────────┘
                         │
┌────────────────────────▼──────────────────────────────────────────┐
│                      DATA LAYER                                    │
│                                                                   │
│  ┌───────────────┐  ┌─────────────────┐  ┌──────────────────┐   │
│  │  PostgreSQL   │  │      Redis       │  │   AWS S3         │   │
│  │  (Primary DB) │  │ (Cache, Queue,   │  │ (Reports,        │   │
│  │               │  │  Sessions)       │  │  Screenshots)    │   │
│  └───────────────┘  └─────────────────┘  └──────────────────┘   │
└────────────────────────┬──────────────────────────────────────────┘
                         │
┌────────────────────────▼──────────────────────────────────────────┐
│                  EXTERNAL INTEGRATIONS                             │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  GDRFA Portal│  │  Twilio SMS  │  │  SendGrid Email      │   │
│  │  (Playwright)│  │  (OTP)       │  │  (Reports + Alerts)  │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  Slack API   │  │  n8n Engine  │  │  PagerDuty           │   │
│  │  (Alerts)    │  │  (Orchestrate│  │  (Critical Alerts)   │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└────────────────────────┬──────────────────────────────────────────┘
                         │
┌────────────────────────▼──────────────────────────────────────────┐
│                  MONITORING & OBSERVABILITY                        │
│                                                                   │
│  Prometheus (metrics) · Grafana (dashboards) · Loki (logs)       │
│  Sentry (error tracking) · OpenTelemetry (distributed tracing)   │
└────────────────────────────────────────────────────────────────────┘
```

### 13.2 Ghost Detection Event Flow

```
EXIT EVENT RECEIVED
      │
      ▼
API records exit in border_events (with idempotency key)
      │
      ▼
Updates visa_applications.status = 'EXITED'
      │
      ▼
Enqueues reconciliation job (TRIGGERED type, immediate)
      │
      ▼
Worker picks up job → calls BrowserSessionManager
      │
      ▼
Playwright fetches portal status for this passport
      │
      ├─── Portal says EXITED → Match! Log success. Done.
      │
      └─── Portal says IN_COUNTRY → MISMATCH DETECTED
                  │
                  ▼
           Creates reconciliation_mismatches record
                  │
                  ▼
           Calculates ghost_score (e.g., 75)
                  │
                  ▼
           Creates ghost_alerts record (risk: HIGH)
                  │
                  ▼
           Fires alert to Slack + Email + Dashboard
                  │
                  ▼
           Schedules follow-up check in 2 hours
                  │
                  ├─── 2hr check: Portal now says EXITED
                  │    → Auto-resolve ghost, log RESOLVED
                  │
                  └─── 2hr check: Still IN_COUNTRY
                       → Escalate to human + create support ticket
```

### 13.3 API Architecture

```
Public API (JWT protected):

AUTH
POST   /api/v1/auth/send-otp           Send OTP to phone/email
POST   /api/v1/auth/verify-otp         Verify OTP, return JWT
POST   /api/v1/auth/refresh            Refresh access token
POST   /api/v1/auth/logout             Revoke refresh token

APPLICATIONS
POST   /api/v1/applications            Create visa application
GET    /api/v1/applications            List applications (paginated)
GET    /api/v1/applications/:id        Get single application
PATCH  /api/v1/applications/:id/status Update status (manual)
GET    /api/v1/status/:passport        Status by passport number

EVENTS
POST   /api/v1/events/entry            Record entry event
POST   /api/v1/events/exit             Record exit event
GET    /api/v1/events/:applicationId   Get event history

RECONCILIATION
POST   /api/v1/reconciliation/trigger  Trigger manual reconciliation
GET    /api/v1/reconciliation/jobs     List reconciliation jobs
GET    /api/v1/reconciliation/jobs/:id Get job status + results
GET    /api/v1/reconciliation/mismatches List mismatches

GHOST MANAGEMENT
GET    /api/v1/ghosts                  List ghost alerts (filterable)
PATCH  /api/v1/ghosts/:id/acknowledge  Acknowledge ghost alert
PATCH  /api/v1/ghosts/:id/resolve      Resolve ghost alert
PATCH  /api/v1/ghosts/:id/false-positive Mark as false positive

REPORTS
POST   /api/v1/reports/ghost           Generate ghost report
POST   /api/v1/reports/reconciliation  Generate reconciliation report
GET    /api/v1/reports/:id/download    Download report (signed URL)

ADMIN (admin role only)
GET    /api/v1/audit-logs              View audit logs
GET    /api/v1/automation-logs         View automation run logs
GET    /api/v1/system/health           System health check
```

### 13.4 Scalability Roadmap

```
Phase A: Single server (Current PoC)
  → Works for < 100 passports, manual triggering
  → Good for demo and validation

Phase B: Multi-service (Production v1)
  → Separate API, Worker, DB servers
  → BullMQ queue with Redis
  → Handles 1,000-5,000 passports
  → Auto-reconciliation every 6 hours

Phase C: Kubernetes deployment (Production v2)
  → All services containerized and auto-scaled
  → Handles 10,000-50,000 passports
  → Multi-tenant with tenant isolation
  → SLA-grade availability (99.9%)

Phase D: SaaS platform
  → Multi-customer architecture with separate schemas
  → API for third-party integrations
  → Marketplace listing
  → GCC region expansion (Saudi Arabia, Qatar, Kuwait)
```

---

## APPENDIX — TECHNOLOGY STACK SUMMARY

| Layer | Technology | Purpose |
|---|---|---|
| API Framework | Node.js + Express.js | HTTP API server |
| ORM | Prisma | Database abstraction |
| Primary DB | PostgreSQL 16 | Persistent data storage |
| Cache/Queue Backend | Redis 7 | Sessions, BullMQ, caching |
| Queue System | BullMQ | Job queue with retries |
| Workflow Engine | n8n | Visual workflow orchestration |
| Browser Automation | Playwright + Stealth | Portal automation |
| API Validation | Zod | Runtime schema validation |
| Authentication | JWT + bcrypt | Auth tokens |
| Logging | Winston + Pino | Structured logging |
| Monitoring | Prometheus + Grafana | Metrics and dashboards |
| Error Tracking | Sentry | Exception monitoring |
| Container | Docker + Kubernetes | Deployment |
| File Storage | AWS S3 | Reports, screenshots |
| SMS OTP | Twilio | OTP delivery |
| Email | SendGrid | Notifications, reports |
| Testing | Jest + Supertest | Unit + integration tests |
| Documentation | Swagger/OpenAPI | API docs |

---

*This document represents a complete enterprise implementation blueprint. Begin with Section 6 Phase 1, validate each phase in staging before promoting to production, and maintain a risk log for every integration point with the government portal.*

---
**Version:** 1.0 | **Architecture Level:** Enterprise Production | **Reviewed by:** Senior Solution Architect Perspective
