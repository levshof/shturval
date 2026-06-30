import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { getDashboard } from '../services/dashboard';

const HideSchema = z.object({ nmIds: z.array(z.number().int()).min(1).max(5000) });

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => {
    return getDashboard(prisma, req.userId);
  });

  app.post('/hide-task', async (req) => {
    const body = HideSchema.parse(req.body);
    for (const nmId of body.nmIds) {
      await prisma.hiddenTask.upsert({
        where: { userId_nmId: { userId: req.userId, nmId } },
        create: { userId: req.userId, nmId },
        update: {},
      });
    }
    return { ok: true, count: body.nmIds.length };
  });

  app.post('/unhide-task', async (req) => {
    const body = HideSchema.parse(req.body);
    await prisma.hiddenTask.deleteMany({ where: { userId: req.userId, nmId: { in: body.nmIds } } });
    return { ok: true, count: body.nmIds.length };
  });
};
