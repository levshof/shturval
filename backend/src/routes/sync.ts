import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db';
import { triggerSync, resetStuckSync } from '../services/syncManager';

const STALE_MINUTES = 30;

export const syncRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.post('/', async (req, reply) => {
    const result = await triggerSync(prisma, req.userId, (msg, extra) => req.log.info({ ...extra }, msg));
    if (!result.started) return reply.code(409).send({ error: 'SYNC_RUNNING', message: result.reason });
    return { started: true };
  });

  app.get('/status', async (req) => {
    const [latest, lastSuccess] = await Promise.all([
      prisma.syncRun.findFirst({ where: { userId: req.userId }, orderBy: { startedAt: 'desc' } }),
      prisma.syncRun.findFirst({ where: { userId: req.userId, status: 'SUCCESS' }, orderBy: { startedAt: 'desc' } }),
    ]);
    const isRunning =
      latest?.status === 'RUNNING' && (Date.now() - latest.startedAt.getTime()) / 60000 < STALE_MINUTES;
    return {
      isRunning,
      lastSyncAt: lastSuccess?.finishedAt?.toISOString() ?? null,
      latest: latest
        ? {
            id: latest.id,
            status: latest.status,
            startedAt: latest.startedAt.toISOString(),
            finishedAt: latest.finishedAt?.toISOString() ?? null,
            steps: latest.steps,
            stats: latest.stats,
            error: latest.error,
          }
        : null,
    };
  });

  app.post('/reset', async (req) => {
    const reset = await resetStuckSync(prisma, req.userId);
    return { ok: true, reset };
  });
};
