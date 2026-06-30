import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from './config';
import { authPlugin } from './http/auth';
import { registerErrorHandler } from './http/errors';
import { authRoutes } from './routes/auth';
import { settingsRoutes } from './routes/settings';
import { syncRoutes } from './routes/sync';
import { productRoutes } from './routes/products';
import { supplyRoutes } from './routes/supplies';
import { dashboardRoutes } from './routes/dashboard';

export async function buildServer() {
  const app = Fastify({
    trustProxy: true,
    logger: config.isProd
      ? { level: 'info' }
      : { level: 'info', transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } },
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: config.corsOrigins, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(authPlugin);

  registerErrorHandler(app);

  app.get('/health', async () => ({ status: 'ok', service: 'wb-shturval', time: new Date().toISOString() }));

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });
  await app.register(syncRoutes, { prefix: '/api/sync' });
  await app.register(productRoutes, { prefix: '/api/products' });
  await app.register(supplyRoutes, { prefix: '/api/supplies' });
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' });

  return app;
}
