// ============================================================
// Zod Validation Schemas — Runtime type-safe request validation
// ============================================================

import { z } from 'zod';

// ======================== AUTH ========================

export const sendOtpSchema = z.object({
  body: z.object({
    identifier: z.string().min(3).max(255), // email or phone
    method: z.enum(['email', 'sms']).default('email'),
  }),
});

export const verifyOtpSchema = z.object({
  body: z.object({
    identifier: z.string().min(3).max(255),
    otp: z.string().length(6),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8).max(128),
  }),
});

export const registerSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8).max(128),
    role: z.enum(['ADMIN', 'OPERATOR', 'VIEWER']).default('OPERATOR'),
  }),
});

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1),
  }),
});

// ======================== PASSENGERS ========================

export const createPassengerSchema = z.object({
  body: z.object({
    passportNumber: z.string().min(5).max(20),
    fullName: z.string().min(2).max(255),
    nationality: z.string().max(100).optional(),
    dateOfBirth: z.string().datetime().optional(),
    sponsorCompany: z.string().max(255).optional(),
    department: z.string().max(255).optional(),
  }),
});

export const updatePassengerSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    fullName: z.string().min(2).max(255).optional(),
    nationality: z.string().max(100).optional(),
    dateOfBirth: z.string().datetime().optional(),
    sponsorCompany: z.string().max(255).optional(),
    department: z.string().max(255).optional(),
  }),
});

// ======================== VISA APPLICATIONS ========================

export const createApplicationSchema = z.object({
  body: z.object({
    passengerId: z.string().uuid(),
    visaNumber: z.string().max(50).optional(),
    visaType: z.enum(['EMPLOYMENT', 'VISIT', 'TRANSIT', 'TOURIST', 'RESIDENCE']).optional(),
    issuedDate: z.string().datetime().optional(),
    expiryDate: z.string().datetime().optional(),
  }),
});

export const updateStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    status: z.enum([
      'PENDING', 'APPROVED', 'REJECTED', 'ACTIVE',
      'EXPIRED', 'CANCELLED', 'IN_COUNTRY', 'EXITED',
    ]),
    notes: z.string().max(500).optional(),
  }),
});

export const statusByPassportSchema = z.object({
  params: z.object({
    passport: z.string().min(5).max(20),
  }),
});

// ======================== BORDER EVENTS ========================

export const entryEventSchema = z.object({
  body: z.object({
    applicationId: z.string().uuid(),
    eventDatetime: z.string().datetime(),
    portOfEntry: z.string().max(100).optional(),
    idempotencyKey: z.string().min(1).max(255),
    source: z.enum(['MANUAL', 'AUTOMATION', 'WEBHOOK']).default('MANUAL'),
  }),
});

export const exitEventSchema = z.object({
  body: z.object({
    applicationId: z.string().uuid(),
    eventDatetime: z.string().datetime(),
    portOfEntry: z.string().max(100).optional(),
    idempotencyKey: z.string().min(1).max(255),
    source: z.enum(['MANUAL', 'AUTOMATION', 'WEBHOOK']).default('MANUAL'),
  }),
});

// ======================== RECONCILIATION ========================

export const triggerReconciliationSchema = z.object({
  body: z.object({
    jobType: z.enum(['FULL', 'TARGETED', 'TRIGGERED']).default('FULL'),
    passportNumbers: z.array(z.string()).optional(), // For TARGETED jobs
  }),
});

export const resolveMismatchSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    resolutionNotes: z.string().max(1000),
    autoResolved: z.boolean().default(false),
  }),
});

// ======================== GHOST ALERTS ========================

export const acknowledgeGhostSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const resolveGhostSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    resolutionNotes: z.string().max(1000).optional(),
  }),
});

export const falsePositiveGhostSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    reason: z.string().max(500).optional(),
  }),
});

// ======================== PAGINATION ========================

export const paginationSchema = z.object({
  query: z.object({
    page: z.string().default('1').transform(Number),
    limit: z.string().default('20').transform(Number),
    sortBy: z.string().default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  }),
});

// ======================== REPORTS ========================

export const generateReportSchema = z.object({
  body: z.object({
    type: z.enum(['ghost', 'reconciliation', 'compliance']),
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
    format: z.enum(['excel', 'pdf']).default('excel'),
  }),
});

// Type exports for use in route handlers
export type SendOtpInput = z.infer<typeof sendOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreatePassengerInput = z.infer<typeof createPassengerSchema>;
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export type EntryEventInput = z.infer<typeof entryEventSchema>;
export type ExitEventInput = z.infer<typeof exitEventSchema>;
