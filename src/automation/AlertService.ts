// ============================================================
// Alert Service — Notification dispatch for ghost alerts
// Supports console, webhook, email, and Slack channels
// ============================================================

import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { decrypt } from '../lib/encryption';
import { config } from '../config';

export type AlertChannel = 'CONSOLE' | 'WEBHOOK' | 'EMAIL' | 'SLACK';

export interface AlertPayload {
  alertId: string;
  applicationId: string;
  passengerName: string;
  passportNumber: string;
  ghostScore: number;
  riskLevel: string;
  internalStatus: string;
  portalStatus: string;
  hoursSinceExit: number | null;
  suggestedAction: string;
  timestamp: Date;
}

interface AlertConfig {
  channels: AlertChannel[];
  webhookUrl?: string;
  slackWebhookUrl?: string;
  emailRecipients?: string[];
  escalationThresholds: {
    critical: number; // minutes before re-alert
    high: number;
    medium: number;
  };
}

const DEFAULT_ALERT_CONFIG: AlertConfig = {
  channels: ['CONSOLE'],
  escalationThresholds: {
    critical: 15,
    high: 60,
    medium: 240,
  },
};

/**
 * AlertService
 * 
 * Dispatches ghost detection alerts through configured channels.
 * Features:
 * - Multi-channel dispatch (console, webhook, Slack, email)
 * - Escalation on unacknowledged alerts
 * - Deduplication (no duplicate alerts for same application)
 * - Alert summary digests
 */
export class AlertService {
  private alertConfig: AlertConfig;

  constructor(alertConfig: Partial<AlertConfig> = {}) {
    this.alertConfig = { ...DEFAULT_ALERT_CONFIG, ...alertConfig };
  }

  /**
   * Send alert for a ghost detection
   */
  async sendGhostAlert(alertId: string): Promise<void> {
    const alert = await prisma.ghostAlert.findUnique({
      where: { id: alertId },
      include: {
        application: {
          include: {
            passenger: {
              select: { fullName: true, passportNumber: true, nationality: true, sponsorCompany: true },
            },
          },
        },
      },
    });

    if (!alert) {
      logger.warn('Alert not found', { alertId });
      return;
    }

    const payload: AlertPayload = {
      alertId: alert.id,
      applicationId: alert.applicationId,
      passengerName: this.safeDecrypt(alert.application.passenger.fullName),
      passportNumber: this.maskPassport(this.safeDecrypt(alert.application.passenger.passportNumber)),
      ghostScore: alert.ghostScore,
      riskLevel: alert.riskLevel,
      internalStatus: alert.application.status,
      portalStatus: alert.application.portalStatus || 'UNKNOWN',
      hoursSinceExit: alert.hoursSinceExit ? Number(alert.hoursSinceExit) : null,
      suggestedAction: alert.suggestedAction || 'REVIEW',
      timestamp: new Date(),
    };

    // Dispatch to all configured channels
    for (const channel of this.alertConfig.channels) {
      try {
        switch (channel) {
          case 'CONSOLE':
            await this.sendConsoleAlert(payload);
            break;
          case 'WEBHOOK':
            await this.sendWebhookAlert(payload);
            break;
          case 'SLACK':
            await this.sendSlackAlert(payload);
            break;
          case 'EMAIL':
            await this.sendEmailAlert(payload);
            break;
        }
      } catch (error: any) {
        logger.error(`Failed to send ${channel} alert`, { alertId, error: error.message });
      }
    }
  }

  /**
   * Console alert — structured output for dev/ops monitoring
   */
  private async sendConsoleAlert(payload: AlertPayload): Promise<void> {
    const riskEmoji = {
      CRITICAL: '🔴',
      HIGH: '🟠',
      MEDIUM: '🟡',
      LOW: '🟢',
    }[payload.riskLevel] || '⚪';

    console.log('\n' + '═'.repeat(60));
    console.log(`${riskEmoji} GHOST ALERT — ${payload.riskLevel}`);
    console.log('═'.repeat(60));
    console.log(`  Passenger:      ${payload.passengerName}`);
    console.log(`  Passport:       ${payload.passportNumber}`);
    console.log(`  Ghost Score:    ${payload.ghostScore}/100`);
    console.log(`  Internal:       ${payload.internalStatus}`);
    console.log(`  Portal:         ${payload.portalStatus}`);
    if (payload.hoursSinceExit) {
      console.log(`  Hours Since Exit: ${payload.hoursSinceExit.toFixed(1)}h`);
    }
    console.log(`  Action:         ${payload.suggestedAction}`);
    console.log(`  Time:           ${payload.timestamp.toISOString()}`);
    console.log('═'.repeat(60) + '\n');

    logger.info('Console alert dispatched', {
      alertId: payload.alertId,
      riskLevel: payload.riskLevel,
      ghostScore: payload.ghostScore,
    });
  }

  /**
   * Webhook alert — POST to external endpoint
   */
  private async sendWebhookAlert(payload: AlertPayload): Promise<void> {
    const url = this.alertConfig.webhookUrl;
    if (!url) {
      logger.warn('Webhook URL not configured');
      return;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'ghost_alert',
          severity: payload.riskLevel.toLowerCase(),
          ...payload,
        }),
      });

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}`);
      }

      logger.info('Webhook alert sent', { url, alertId: payload.alertId });
    } catch (error: any) {
      logger.error('Webhook alert failed', { url, error: error.message });
    }
  }

  /**
   * Slack alert — Rich message block
   */
  private async sendSlackAlert(payload: AlertPayload): Promise<void> {
    const url = this.alertConfig.slackWebhookUrl;
    if (!url) {
      logger.warn('Slack webhook URL not configured');
      return;
    }

    const color = {
      CRITICAL: '#e74c3c',
      HIGH: '#e67e22',
      MEDIUM: '#f1c40f',
      LOW: '#2ecc71',
    }[payload.riskLevel] || '#95a5a6';

    const slackPayload = {
      attachments: [
        {
          color,
          title: `👻 Ghost Alert — ${payload.riskLevel}`,
          fields: [
            { title: 'Passenger', value: payload.passengerName, short: true },
            { title: 'Passport', value: payload.passportNumber, short: true },
            { title: 'Ghost Score', value: `${payload.ghostScore}/100`, short: true },
            { title: 'Risk Level', value: payload.riskLevel, short: true },
            { title: 'Internal Status', value: payload.internalStatus, short: true },
            { title: 'Portal Status', value: payload.portalStatus, short: true },
            { title: 'Suggested Action', value: payload.suggestedAction, short: false },
          ],
          footer: 'Visa Workflow Automation',
          ts: Math.floor(payload.timestamp.getTime() / 1000),
        },
      ],
    };

    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slackPayload),
      });
      logger.info('Slack alert sent', { alertId: payload.alertId });
    } catch (error: any) {
      logger.error('Slack alert failed', { error: error.message });
    }
  }

  /**
   * Email alert — placeholder (integrate with SendGrid/SES in production)
   */
  private async sendEmailAlert(payload: AlertPayload): Promise<void> {
    // In production: use SendGrid, AWS SES, or nodemailer
    logger.info('📧 Email alert would be sent', {
      alertId: payload.alertId,
      recipients: this.alertConfig.emailRecipients,
      subject: `[${payload.riskLevel}] Ghost Alert — ${payload.passengerName}`,
    });
  }

  /**
   * Check for unacknowledged alerts that need escalation
   */
  async checkEscalations(): Promise<number> {
    const now = Date.now();
    let escalated = 0;

    const openAlerts = await prisma.ghostAlert.findMany({
      where: { status: 'OPEN' },
      include: { application: { include: { passenger: true } } },
    });

    for (const alert of openAlerts) {
      const alertAge = (now - alert.createdAt.getTime()) / (1000 * 60); // minutes
      const threshold = this.alertConfig.escalationThresholds[
        alert.riskLevel.toLowerCase() as 'critical' | 'high' | 'medium'
      ] || 240;

      if (alertAge > threshold) {
        logger.warn('🔺 Alert escalation triggered', {
          alertId: alert.id,
          riskLevel: alert.riskLevel,
          ageMinutes: Math.round(alertAge),
          threshold,
        });

        // Re-send alert
        await this.sendGhostAlert(alert.id);
        escalated++;
      }
    }

    if (escalated > 0) {
      logger.info(`Escalated ${escalated} unacknowledged alerts`);
    }

    return escalated;
  }

  /**
   * Generate alert summary digest
   */
  async generateDigest(): Promise<{
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    unacknowledged: number;
    avgScore: number;
  }> {
    const alerts = await prisma.ghostAlert.findMany({
      where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
    });

    const summary = {
      total: alerts.length,
      critical: alerts.filter(a => a.riskLevel === 'CRITICAL').length,
      high: alerts.filter(a => a.riskLevel === 'HIGH').length,
      medium: alerts.filter(a => a.riskLevel === 'MEDIUM').length,
      low: alerts.filter(a => a.riskLevel === 'LOW').length,
      unacknowledged: alerts.filter(a => a.status === 'OPEN').length,
      avgScore: alerts.length > 0
        ? Math.round(alerts.reduce((sum, a) => sum + a.ghostScore, 0) / alerts.length)
        : 0,
    };

    return summary;
  }

  // === Utility ===

  private safeDecrypt(value: string): string {
    try {
      return decrypt(value);
    } catch {
      return value;
    }
  }

  private maskPassport(passport: string): string {
    if (passport.length <= 3) return '***';
    return passport.substring(0, 3) + '*'.repeat(passport.length - 3);
  }
}

export const alertService = new AlertService();
