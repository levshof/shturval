import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { encryptSecret, maskTail } from '../lib/crypto';
import { WbClient } from '../wb/client';
import { isWbAuthError } from '../wb/errors';
import { recomputeUser } from '../sync/recompute';
import { badRequest } from '../http/errors';
import { num0 } from '../http/serialize';

const ProfileSchema = z.object({ companyName: z.string().trim().max(200).nullable() });

const SupplySchema = z.object({
  leadTimeDays: z.number().int().min(0).max(365),
  orderBufferDays: z.number().int().min(0).max(365),
  orderQuantum: z.number().int().min(1).max(100000),
  targetStockDays: z.number().int().min(1).max(365),
  taxPercent: z.number().min(0).max(100),
});

const WbKeySchema = z.object({ key: z.string().trim().min(20, 'Ключ слишком короткий') });

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => {
    const [user, supply, wbKey] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId } }),
      prisma.supplySettings.findUnique({ where: { userId: req.userId } }),
      prisma.wbKey.findUnique({ where: { userId: req.userId } }),
    ]);
    return {
      profile: { companyName: user?.companyName ?? null, email: user?.email },
      supply: supply
        ? {
            leadTimeDays: supply.leadTimeDays,
            orderBufferDays: supply.orderBufferDays,
            orderQuantum: supply.orderQuantum,
            targetStockDays: supply.targetStockDays,
            taxPercent: num0(supply.taxPercent),
          }
        : null,
      wbKey: wbKey
        ? { connected: true, last4: wbKey.last4, isValid: wbKey.isValid, categories: wbKey.categories }
        : { connected: false },
    };
  });

  app.put('/profile', async (req) => {
    const body = ProfileSchema.parse(req.body);
    await prisma.user.update({ where: { id: req.userId }, data: { companyName: body.companyName } });
    return { ok: true };
  });

  app.put('/supply', async (req) => {
    const body = SupplySchema.parse(req.body);
    await prisma.supplySettings.upsert({
      where: { userId: req.userId },
      create: { userId: req.userId, ...body },
      update: body,
    });
    // Global settings affect every product's status/recommendation → recompute.
    await recomputeUser(prisma, req.userId);
    return { ok: true };
  });

  app.post('/wbkey', async (req) => {
    const body = WbKeySchema.parse(req.body);

    // Validate the key against WB before storing (fast 401 detection).
    const client = new WbClient({ apiKey: body.key, minIntervalMs: 0, maxPages: 1 });
    let verified = false;
    try {
      await client.validateKey();
      verified = true;
    } catch (err) {
      if (isWbAuthError(err)) {
        throw badRequest('Wildberries отклонил ключ (401). Проверьте, что ключ действующий и с правами «Статистика».');
      }
      // Network/other issue — store optimistically, mark to re-check on sync.
      verified = false;
    }

    const enc = encryptSecret(body.key);
    await prisma.wbKey.upsert({
      where: { userId: req.userId },
      create: {
        userId: req.userId,
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        last4: maskTail(body.key),
        isValid: true,
        lastCheckedAt: new Date(),
      },
      update: {
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        last4: maskTail(body.key),
        isValid: true,
        lastCheckedAt: new Date(),
      },
    });
    return { ok: true, connected: true, verified };
  });

  app.delete('/wbkey', async (req) => {
    await prisma.wbKey.deleteMany({ where: { userId: req.userId } });
    return { ok: true };
  });
};
