import type { Db } from '../db';
import { num0 } from '../http/serialize';
import { currentUnitCost } from './cost';

/**
 * Parse a pasted cost table (spec 13). Supported separators: tab, semicolon,
 * comma. Decimal comma ("510,5") is supported. Format per line: <article> <cost>.
 * The rule is explicit and documented so behaviour is predictable, not magic.
 */
export interface ParsedCostRow {
  article: string;
  cost: number;
}
export interface CostParseError {
  line: string;
  reason: string;
}
export interface CostParseResult {
  recognized: ParsedCostRow[];
  errors: CostParseError[];
  totalLines: number;
}

export function parseCostTable(text: string): CostParseResult {
  const recognized: ParsedCostRow[] = [];
  const errors: CostParseError[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  for (const line of lines) {
    let parts: string[];
    if (line.includes('\t')) {
      parts = line.split('\t');
    } else if (line.includes(';')) {
      parts = line.split(';');
    } else {
      // Comma mode: protect a decimal comma between digits, then split.
      parts = line.replace(/(\d),(\d)/g, '$1.$2').split(',');
    }
    parts = parts.map((p) => p.trim()).filter((p) => p.length > 0);

    if (parts.length < 2) {
      errors.push({ line, reason: 'Не найдены артикул и себестоимость' });
      continue;
    }
    const article = parts[0];
    const costRaw = parts[parts.length - 1].replace(/\s+/g, '').replace(',', '.');
    const cost = Number(costRaw);

    if (!Number.isFinite(cost)) {
      // Likely a header row ("Артикул Себестоимость") — report, don't crash.
      errors.push({ line, reason: 'Себестоимость не распознана как число' });
      continue;
    }
    if (cost <= 0) {
      errors.push({ line, reason: 'Себестоимость должна быть больше 0' });
      continue;
    }
    recognized.push({ article, cost });
  }

  return { recognized, errors, totalLines: lines.length };
}

export interface CostApplyResult {
  updated: number;
  skippedUnknown: number;
  skippedUnchanged: number;
  unknownArticles: string[];
}

/**
 * Apply parsed costs: match by supplierArticle, skip unknown articles, skip
 * unchanged costs, and write a NEW cost row (preserving history, spec 4.8).
 */
export async function applyCostImport(
  prisma: Db,
  userId: string,
  rows: ParsedCostRow[],
  now = new Date(),
): Promise<CostApplyResult> {
  const products = await prisma.product.findMany({ where: { userId }, select: { nmId: true, supplierArticle: true } });
  const byArticle = new Map<string, number[]>();
  for (const p of products) {
    const list = byArticle.get(p.supplierArticle) ?? [];
    list.push(p.nmId);
    byArticle.set(p.supplierArticle, list);
  }

  let updated = 0;
  let skippedUnknown = 0;
  let skippedUnchanged = 0;
  const unknownArticles: string[] = [];

  for (const row of rows) {
    const nmIds = byArticle.get(row.article);
    if (!nmIds || nmIds.length === 0) {
      skippedUnknown++;
      unknownArticles.push(row.article);
      continue;
    }
    for (const nmId of nmIds) {
      const costs = await prisma.productCost.findMany({ where: { userId, nmId } });
      const current = currentUnitCost(
        costs.map((c) => ({ unitCost: num0(c.unitCost), effectiveFrom: c.effectiveFrom })),
        now,
      );
      if (current != null && Math.abs(current - row.cost) < 0.005) {
        skippedUnchanged++;
        continue;
      }
      await prisma.productCost.create({
        data: { userId, nmId, unitCost: row.cost, effectiveFrom: now },
      });
      updated++;
    }
  }

  return { updated, skippedUnknown, skippedUnchanged, unknownArticles };
}
