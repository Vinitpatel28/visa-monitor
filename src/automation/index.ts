// ============================================================
// Automation Module — Barrel export
// ============================================================

export { BrowserSessionManager, sessionManager } from './BrowserSessionManager';
export { StatusFetcher } from './StatusFetcher';
export { AutomationWorker, queues, calculateGhostScore } from './AutomationWorker';
export { startMockPortal } from './MockPortal';
export { SessionPool, sessionPool } from './SessionPool';
export { ReconciliationEngine, reconciliationEngine } from './ReconciliationEngine';
export { AlertService, alertService } from './AlertService';
export { JobScheduler, scheduler } from './Scheduler';

// ICP Portal scraper exports
export { ICPSessionManager, icpSessionManager } from './ICPSessionManager';
export { ICPStatusFetcher, icpStatusFetcher } from './ICPStatusFetcher';
export { startICPMockPortal } from './ICPMockPortal';

export type { PortalCredentials, SessionInfo } from './BrowserSessionManager';
export type { PortalStatusResult, StatusFetchOptions } from './StatusFetcher';
export type { StatusCheckJob, ReconciliationJobData } from './AutomationWorker';
export type { ICPCheckInput, ICPCheckResult } from './ICPStatusFetcher';
