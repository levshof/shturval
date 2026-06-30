import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { mskDateString, addDaysStr, parseDateStr, todayMsk } from '../domain/dates';
import { recomputeUser } from '../sync/recompute';
import { notFound } from '../http/errors';

const CreateSchema = z
  .object({
    nmId: z.number().int(),
    quantity: z.number().int().positive(),
    expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    expectedInDays: z.number().int().min(0).max(365).optional(),
  })
  .refine((d) => d.expectedDate || d.expectedInDays != null, {
    message: 'Укажите ожидаемую дату или срок в днях',
  });

const PatchSchema = z
  .object({
    expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    expectedInDays: z.number().int().min(0).max(365).optional(),
  })
  .refine((d) => d.expectedDate || d.expectedInDays != null, { message: 'Укажите новую дату' });

export const supplyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => {
    const supplies = await prisma.supply.findMany({
      where: { userId: req.userId, status: { not: 'CANCELLED' } },
      orderBy: [{ status: 'asc' }, { expectedDate: 'asc' }],
    });
    const nmIds = [...new Set(supplies.map((s) => s.nmId))];
    const products = await prisma.product.findMany({
      where: { userId: req.userId, nmId: { in: nmIds } },
      select: { nmId: true, supplierArticle: true, title: true },
    });
    const byNm = new Map(products.map((p) => [p.nmId, p]));
    return {
      supplies: supplies.map((s) => ({
        id: s.id,
        nmId: s.nmId,
        supplierArticle: byNm.get(s.nmId)?.supplierArticle ?? String(s.nmId),
        title: byNm.get(s.nmId)?.title ?? null,
        quantity: s.quantity,
        acceptedQty: s.acceptedQty,
        remaining: Math.max(s.quantity - s.acceptedQty, 0),
        expectedDate: mskDateString(s.expectedDate),
        status: s.status,
        watchAfterZero: s.watchAfterZero,
      })),
    };
  });

  app.post('/', async (req) => {
    const body = CreateSchema.parse(req.body);
    const product = await prisma.product.findUnique({
      where: { userId_nmId: { userId: req.userId, nmId: body.nmId } },
    });
    if (!product) throw notFound('Товар не найден');

    const expected = body.expectedDate ?? addDaysStr(todayMsk(), body.expectedInDays ?? 0);

    // Baseline current stock so the first arrival increment is measured correctly.
    const latest = await prisma.stockSnapshot.findFirst({
      where: { userId: req.userId, nmId: body.nmId },
      orderBy: { date: 'desc' },
    });

    const supply = await prisma.supply.create({
      data: {
        userId: req.userId,
        nmId: body.nmId,
        quantity: body.quantity,
        expectedDate: parseDateStr(expected),
        status: 'IN_TRANSIT',
        lastCheckedStock: latest?.quantity ?? null,
      },
    });
    await recomputeUser(prisma, req.userId);
    return { id: supply.id, ok: true };
  });

  app.patch('/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    const body = PatchSchema.parse(req.body);
    const supply = await prisma.supply.findFirst({ where: { id, userId: req.userId } });
    if (!supply) throw notFound('Поставка не найдена');
    const expected = body.expectedDate ?? addDaysStr(todayMsk(), body.expectedInDays ?? 0);
    await prisma.supply.update({ where: { id }, data: { expectedDate: parseDateStr(expected) } });
    return { ok: true };
  });

  app.delete('/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    const supply = await prisma.supply.findFirst({ where: { id, userId: req.userId } });
    if (!supply) throw notFound('Поставка не найдена');
    await prisma.supply.delete({ where: { id } });
    await recomputeUser(prisma, req.userId);
    return { ok: true };
  });

  app.post('/:id/watch-after-zero', async (req) => {
    const id = (req.params as { id: string }).id;
    const supply = await prisma.supply.findFirst({ where: { id, userId: req.userId } });
    if (!supply) throw notFound('Поставка не найдена');
    await prisma.supply.update({
      where: { id },
      data: {
        watchAfterZero: true,
        status: supply.status === 'ZERO_NOT_FOUND' ? 'WAIT_AFTER_ZERO' : supply.status,
      },
    });
    return { ok: true };
  });
};
