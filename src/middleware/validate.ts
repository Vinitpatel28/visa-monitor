// ============================================================
// Zod Validation Middleware — Request body/params/query validation
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';

/**
 * Validates request body, params, and query against a Zod schema.
 * Usage: router.post('/endpoint', validate(schema), handler)
 */
export function validate(schema: z.ZodType<any>) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(error); // Will be caught by errorHandler
      } else {
        next(error);
      }
    }
  };
}
