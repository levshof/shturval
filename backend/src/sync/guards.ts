/**
 * Sync safety guards (spec 12). The principle: better to show a sync error than
 * to silently publish a suspiciously incomplete export over good data. The
 * caller decides what to do with a failed guard; guards themselves are pure.
 */

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

/** Stocks export looks empty or collapsed compared to the previous snapshot. */
export function guardStocks(newCount: number, prevCount: number): GuardResult {
  if (prevCount > 0 && newCount === 0) {
    return { ok: false, reason: 'Остатки не загрузились (пустая выгрузка). Прошлый снимок сохранён.' };
  }
  if (prevCount >= 20 && newCount < prevCount * 0.5) {
    return {
      ok: false,
      reason: `Резкое падение числа позиций остатков: было ${prevCount}, стало ${newCount}. Снимок не обновлён.`,
    };
  }
  return { ok: true };
}

/** Export did not reach its final page (hit the safety page cap). */
export function guardTruncated(source: string, truncated: boolean): GuardResult {
  if (truncated) {
    return { ok: false, reason: `Выгрузка «${source}» не дошла до конца (достигнут лимит страниц).` };
  }
  return { ok: true };
}

/** A sharp drop in the number of distinct articles vs the previous run. */
export function guardArticleDrop(source: string, newUnique: number, prevUnique: number): GuardResult {
  if (prevUnique >= 20 && newUnique < prevUnique * 0.4) {
    return {
      ok: false,
      reason: `Резко меньше уникальных артикулов в «${source}»: было ${prevUnique}, стало ${newUnique}.`,
    };
  }
  return { ok: true };
}
