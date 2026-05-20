// ============================================================
// Express Request Helpers
// Normalizes Express v5 types where req.params and req.ip
// return string | string[] instead of plain string
// ============================================================

import { Request } from 'express';

/** Safely extract a route param as a string */
export function param(req: Request, key: string): string {
  const val = (req.params as Record<string, string | string[]>)[key];
  return Array.isArray(val) ? val[0] : (val as string);
}

/** Safely extract req.ip as a string */
export function clientIp(req: Request): string {
  const ip = req.ip;
  return Array.isArray(ip) ? ip[0] : (ip as string) || req.socket?.remoteAddress || 'unknown';
}
