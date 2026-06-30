import type { Db } from '../db';
import { config } from '../config';
import { runSync } from '../sync/syncEngine';

/**
 * In-process coordination for the background sync (DECISIONS.md D-0002).
 * The SyncRun table is the source of truth for status; this set just prevents
 * launching a second concurrent run within the same process.
 */
const STALE_MINUTES = 30;
const running = new Set<string>();

export interface SyncTriggerResult {
  started: boolean;
  reason?: string;
}

function ageMinutes(d: Date): number {
  return (Date.now() - d.getTime()) / 60000;
}

export async function triggerSync(
  prisma: Db,
  userId: string,
  log: (msg: string, extra?: Record<string, unknown>) => void,
): Promise<SyncTriggerResult> {
  if (running.has(userId)) return { started: false, reason: 'Синхронизация уже идёт' };

  const active = await prisma.syncRun.findFirst({
    where: { userId, status: 'RUNNING' },
    orderBy: { startedAt: 'desc' },
  });
  if (active) {
    if (ageMinutes(active.startedAt) < STALE_MINUTES) {
      return { started: false, reason: 'Синхронизация уже идёт' };
    }
    // Auto-reset a stale RUNNING row before starting a fresh run.
    await prisma.syncRun.update({
      where: { id: active.id },
      data: { status: 'STALE_RESET', finishedAt: new Date(), error: 'Сброшена зависшая синхронизация' },
    });
  }

  running.add(userId);
  // Fire-and-forget background run (long-running, spaced by WB rate limits).
  void runSync(prisma, userId, {
    minIntervalMs: config.WB_MIN_INTERVAL_MS,
    maxPages: config.WB_MAX_PAGES,
    historyDays: config.WB_HISTORY_DAYS,
    logger: log,
  })
    .catch((e) => log('sync crashed', { error: String(e) }))
    .finally(() => running.delete(userId));

  return { started: true };
}

/** Reset a stuck synchronization (spec 5.2 — "сбросить зависшую синхронизацию"). */
export async function resetStuckSync(prisma: Db, userId: string): Promise<boolean> {
  running.delete(userId);
  const res = await prisma.syncRun.updateMany({
    where: { userId, status: 'RUNNING' },
    data: { status: 'STALE_RESET', finishedAt: new Date(), error: 'Сброшено пользователем' },
  });
  return res.count > 0;
}
