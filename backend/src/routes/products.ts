import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { num0 } from '../http/serialize';
import { unitCostFromComponents } from '../domain/finance';
import { currentUnitCost } from '../services/cost';
import { recomputeUser } from '../sync/recompute';
import {
  listProducts,
  getProductCard,
  type ProductFilter,
  type ProductSort,
} from '../services/products';
import { parseCostTable, applyCostImport } from '../services/costImport';
import { badRequest, notFound } from '../http/errors';

const ListQuery = z.object({
  filter: z
    .enum(['all', 'no_stock', 'critical', 'order', 'normal', 'overstock', 'archive'])
    .default('all'),
  sort: z.enum(['article', 'stock', 'perDay', 'days', 'profit', 'status']).default('status'),
  search: z.string().trim().optional(),
});

const ParamsSchema = z.object({
  unitCost: z.number().positive().optional(),
  purchaseCost: z.number().min(0).optional(),
  inboundLogisticsCost: z.number().min(0).optional(),
  packagingCost: z.number().min(0).optional(),
  labelingCost: z.number().min(0).optional(),
  customsCertificationCost: z.number().min(0).optional(),
  otherPreWbCost: z.number().min(0).optional(),
  taxPercent: z.number().min(0).max(100).optional(),
  leadTimeDays: z.number().int().min(0).max(365).optional(),
  orderBufferDays: z.number().int().min(0).max(365).optional(),
  orderQuantum: z.number().int().min(1).max(100000).optional(),
  targetStockDays: z.number().int().min(1).max(365).optional(),
  active: z.boolean().optional(),
});

const BulkArchiveSchema = z.object({
  nmIds: z.array(z.number().int()).min(1).max(5000),
  archived: z.boolean(),
});

function parseNmId(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest('Некорректный nmId');
  return n;
}

export const productRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => {
    const q = ListQuery.parse(req.query);
    return listProducts(prisma, req.userId, {
      filter: q.filter as ProductFilter,
      sort: q.sort as ProductSort,
      search: q.search,
    });
  });

  // Cost import (spec 13). Declared before /:nmId to avoid route capture.
  app.post('/cost-import', async (req) => {
    const body = z.object({ text: z.string().min(1) }).parse(req.body);
    const parsed = parseCostTable(body.text);
    const applied = await applyCostImport(prisma, req.userId, parsed.recognized);
    if (applied.updated > 0) await recomputeUser(prisma, req.userId);
    return {
      recognized: parsed.recognized.length,
      errors: parsed.errors,
      totalLines: parsed.totalLines,
      ...applied,
    };
  });

  app.post('/bulk-archive', async (req) => {
    const body = BulkArchiveSchema.parse(req.body);
    await prisma.product.updateMany({
      where: { userId: req.userId, nmId: { in: body.nmIds } },
      data: { archived: body.archived, archivedAt: body.archived ? new Date() : null },
    });
    return { ok: true, count: body.nmIds.length };
  });

  app.get('/:nmId', async (req) => {
    const nmId = parseNmId((req.params as { nmId: string }).nmId);
    const card = await getProductCard(prisma, req.userId, nmId);
    if (!card) throw notFound('Товар не найден');
    return card;
  });

  app.put('/:nmId/params', async (req) => {
    const nmId = parseNmId((req.params as { nmId: string }).nmId);
    const body = ParamsSchema.parse(req.body);

    const product = await prisma.product.findUnique({ where: { userId_nmId: { userId: req.userId, nmId } } });
    if (!product) throw notFound('Товар не найден');

    // ── cost ────────────────────────────────────────────────────────────
    const componentKeys = [
      'purchaseCost',
      'inboundLogisticsCost',
      'packagingCost',
      'labelingCost',
      'customsCertificationCost',
      'otherPreWbCost',
    ] as const;
    const hasComponents = componentKeys.some((k) => body[k] !== undefined);
    let newUnitCost: number | null = null;
    if (body.unitCost !== undefined) newUnitCost = body.unitCost;
    else if (hasComponents) newUnitCost = unitCostFromComponents(body);

    if (newUnitCost != null && newUnitCost > 0) {
      const existing = await prisma.productCost.findMany({ where: { userId: req.userId, nmId } });
      const current = currentUnitCost(
        existing.map((c) => ({ unitCost: num0(c.unitCost), effectiveFrom: c.effectiveFrom })),
        new Date(),
      );
      if (current == null || Math.abs(current - newUnitCost) >= 0.005) {
        await prisma.productCost.create({
          data: {
            userId: req.userId,
            nmId,
            unitCost: newUnitCost,
            purchaseCost: body.purchaseCost ?? null,
            inboundLogisticsCost: body.inboundLogisticsCost ?? null,
            packagingCost: body.packagingCost ?? null,
            labelingCost: body.labelingCost ?? null,
            customsCertificationCost: body.customsCertificationCost ?? null,
            otherPreWbCost: body.otherPreWbCost ?? null,
          },
        });
      }
    }

    // ── supply override / tax / active ───────────────────────────────────
    const overrideData: Record<string, unknown> = {};
    if (body.leadTimeDays !== undefined) overrideData.leadTimeDays = body.leadTimeDays;
    if (body.orderBufferDays !== undefined) overrideData.orderBufferDays = body.orderBufferDays;
    if (body.orderQuantum !== undefined) overrideData.orderQuantum = body.orderQuantum;
    if (body.targetStockDays !== undefined) overrideData.targetStockDays = body.targetStockDays;
    if (body.taxPercent !== undefined) overrideData.taxPercent = body.taxPercent;
    if (body.active !== undefined) overrideData.active = body.active;

    if (Object.keys(overrideData).length > 0) {
      await prisma.productSettings.upsert({
        where: { userId_nmId: { userId: req.userId, nmId } },
        create: { userId: req.userId, nmId, ...overrideData },
        update: overrideData,
      });
    }

    await recomputeUser(prisma, req.userId);
    const card = await getProductCard(prisma, req.userId, nmId);
    return card;
  });

  app.post('/:nmId/archive', async (req) => {
    const nmId = parseNmId((req.params as { nmId: string }).nmId);
    await prisma.product.updateMany({
      where: { userId: req.userId, nmId },
      data: { archived: true, archivedAt: new Date() },
    });
    return { ok: true };
  });

  app.post('/:nmId/unarchive', async (req) => {
    const nmId = parseNmId((req.params as { nmId: string }).nmId);
    await prisma.product.updateMany({
      where: { userId: req.userId, nmId },
      data: { archived: false, archivedAt: null },
    });
    return { ok: true };
  });
};
