import 'dotenv/config';
import { z } from 'zod';

/**
 * Single, validated source of configuration. The app refuses to start with an
 * invalid/missing critical env var (fail loud, not silent — see spec 0.4).
 */
const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  JWT_SECRET: z
    .string()
    .min(16, 'JWT_SECRET must be at least 16 characters (use a long random string)'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  ENCRYPTION_KEY: z
    .string()
    .min(1, 'ENCRYPTION_KEY is required (32-byte base64, see .env.example)'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // 'lax' for same-origin (incl. Vercel /api proxy). 'none' for cross-site
  // frontend↔backend (requires HTTPS; secure is forced on automatically).
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WB_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(60_000),
  WB_MAX_PAGES: z.coerce.number().int().positive().default(200),
  WB_HISTORY_DAYS: z.coerce.number().int().positive().max(90).default(90),
});

function loadConfig() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(
      `\n[config] Invalid environment configuration:\n${issues}\n\n` +
        `Fix your .env (see backend/.env.example and SETUP_GUIDE.md) and restart.\n`,
    );
    process.exit(1);
  }

  const env = parsed.data;

  // Validate ENCRYPTION_KEY decodes to exactly 32 bytes (AES-256).
  const keyBytes = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  if (keyBytes.length !== 32) {
    // eslint-disable-next-line no-console
    console.error(
      `\n[config] ENCRYPTION_KEY must decode to exactly 32 bytes (got ${keyBytes.length}).\n` +
        `Generate one: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"\n`,
    );
    process.exit(1);
  }

  return {
    ...env,
    corsOrigins: env.CORS_ORIGIN.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    encryptionKey: keyBytes,
    isProd: env.NODE_ENV === 'production',
  };
}

export const config = loadConfig();
export type AppConfig = typeof config;
