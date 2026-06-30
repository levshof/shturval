import { PrismaClient } from '@prisma/client';
import { config } from './config';

/**
 * JSON serialization policy for BigInt (rrdId / realizationReportId).
 * These values are well within Number's safe integer range, and we never need
 * BigInt precision on the wire. This is an explicit, documented policy — not a
 * silent fallback (spec 0.4).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

export const prisma = new PrismaClient({
  log: config.isProd ? ['error'] : ['warn', 'error'],
});

export type Db = typeof prisma;
