/**
 * Supply formulas — SINGLE SOURCE OF TRUTH (spec sections 6 and 7).
 *
 * Pure functions only: no DB, no network, no UI. Inputs are assembled by the
 * service layer; results are stored/served as-is. Every formula here is covered
 * by supply.test.ts. Do NOT re-implement any of these formulas elsewhere.
 */

import { addDaysStr } from './dates';

export type SupplyHealth = 'NO_STOCK' | 'CRITICAL' | 'ORDER' | 'NORMAL' | 'OVERSTOCK';

/** One calendar day of a product's history (MSK). */
export interface DayPoint {
  /** "YYYY-MM-DD" in MSK. */
  date: string;
  /** Units sold that day (returns and cancellations already excluded upstream). */
  sales: number;
  /**
   * Known stock that day, or null if we have no snapshot for it. We only treat a
   * day as out-of-stock when we have POSITIVE evidence (snapshot shows 0). When
   * stock is unknown we do not exclude the day (honest, non-inflating choice).
   */
  stock: number | null;
}

export interface ResolvedSupplySettings {
  leadTimeDays: number;
  orderBufferDays: number;
  orderQuantum: number;
  targetStockDays: number;
}

export interface VelocityResult {
  v7: number;
  v14: number;
  v30: number;
  avgDailySales: number;
}

export interface SupplyMetrics extends VelocityResult {
  currentStock: number;
  inTransitQty: number;
  daysOfStock: number | null;
  daysUntilOrder: number | null;
  recommendedQty: number;
  overstockQty: number;
  deficitDate: string | null;
  health: SupplyHealth;
}

export const OVERSTOCK_THRESHOLD_DAYS = 90;

/**
 * Spec 6.1 — a day is "available" for selling if there were sales OR positive
 * stock. Unknown stock (no snapshot) does not exclude the day.
 */
export function isDayAvailable(p: DayPoint): boolean {
  return p.sales > 0 || p.stock === null || p.stock > 0;
}

/**
 * Spec 6.2 — sales velocity over the most recent `windowN` complete days
 * (ending yesterday in MSK; today is excluded because it is partial — see
 * DECISIONS / final summary). Days earlier than the product's first observed
 * day are not counted (a brand-new product is not penalised for not existing).
 *
 *   V_N = sales over N available days / number of available days
 *   V_N = 0 when there are no available days.
 */
export function velocityForWindow(points: DayPoint[], windowN: number, today: string): number {
  if (points.length === 0 || windowN <= 0) return 0;

  const byDate = new Map<string, DayPoint>();
  let earliest = points[0].date;
  for (const p of points) {
    byDate.set(p.date, p);
    if (p.date < earliest) earliest = p.date;
  }

  let sumSales = 0;
  let availableDays = 0;

  // Window = [today-windowN .. today-1] (last N complete days).
  for (let offset = 1; offset <= windowN; offset++) {
    const d = addDaysStr(today, -offset);
    if (d < earliest) continue; // product had no data yet → don't count this day

    const p = byDate.get(d);
    if (!p) {
      // Gap after the product's first data point: no sale recorded, stock
      // unknown → counts as an available day with 0 sales (does not inflate).
      availableDays += 1;
      continue;
    }
    if (isDayAvailable(p)) {
      availableDays += 1;
      sumSales += p.sales;
    }
  }

  return availableDays > 0 ? sumSales / availableDays : 0;
}

/** Spec 6.3 — weighted average daily sales (recent days weigh more). */
export function computeVelocity(points: DayPoint[], today: string): VelocityResult {
  const v7 = velocityForWindow(points, 7, today);
  const v14 = velocityForWindow(points, 14, today);
  const v30 = velocityForWindow(points, 30, today);
  const avgDailySales = 0.5 * v7 + 0.3 * v14 + 0.2 * v30;
  return { v7, v14, v30, avgDailySales };
}

/** Spec 6.4 — days of stock. Null when velocity is 0 (cannot divide). */
export function daysOfStock(currentStock: number, avgDailySales: number): number | null {
  if (avgDailySales <= 0) return null;
  return currentStock / avgDailySales;
}

/** Spec 6.5 — whole days until the product enters the order window. */
export function daysUntilOrder(
  dos: number | null,
  settings: ResolvedSupplySettings,
): number | null {
  if (dos === null) return null;
  return Math.floor(dos - (settings.leadTimeDays + settings.orderBufferDays));
}

/** Spec 6.6 — recommended order quantity, rounded up to the order quantum. */
export function recommendedQty(
  currentStock: number,
  inTransitQty: number,
  avgDailySales: number,
  settings: ResolvedSupplySettings,
): number {
  const quantum = settings.orderQuantum > 0 ? settings.orderQuantum : 1;
  const need = avgDailySales * settings.targetStockDays - currentStock - inTransitQty;
  if (need <= 0) return 0;
  return Math.ceil(need / quantum) * quantum;
}

/** Spec 6.7 — overstock quantity. */
export function overstockQty(currentStock: number, avgDailySales: number): number {
  if (currentStock <= 0) return 0;
  if (avgDailySales <= 0) return currentStock;
  return Math.max(currentStock - avgDailySales * OVERSTOCK_THRESHOLD_DAYS, 0);
}

/** Spec 6.8 — projected deficit date. Null when velocity is 0. */
export function deficitDate(today: string, dos: number | null): string | null {
  if (dos === null) return null;
  return addDaysStr(today, Math.floor(dos));
}

/**
 * Spec 7 — supply health status. Order of checks matters:
 *  1) stock == 0           → NO_STOCK
 *  2) stock > 0, velocity 0 → OVERSTOCK (days of stock undefined)
 *  3) dos <= lead          → CRITICAL
 *  4) dos <= lead + buffer  → ORDER
 *  5) dos <= 90            → NORMAL
 *  6) dos > 90             → OVERSTOCK
 */
export function supplyHealth(
  currentStock: number,
  avgDailySales: number,
  dos: number | null,
  settings: ResolvedSupplySettings,
): SupplyHealth {
  if (currentStock <= 0) return 'NO_STOCK';
  if (avgDailySales <= 0 || dos === null) return 'OVERSTOCK';
  if (dos <= settings.leadTimeDays) return 'CRITICAL';
  if (dos <= settings.leadTimeDays + settings.orderBufferDays) return 'ORDER';
  if (dos <= OVERSTOCK_THRESHOLD_DAYS) return 'NORMAL';
  return 'OVERSTOCK';
}

/** Full per-product supply metrics, assembled from the formulas above. */
export function computeSupplyMetrics(args: {
  points: DayPoint[];
  today: string;
  currentStock: number;
  inTransitQty: number;
  settings: ResolvedSupplySettings;
}): SupplyMetrics {
  const { points, today, currentStock, inTransitQty, settings } = args;
  const vel = computeVelocity(points, today);
  const dos = daysOfStock(currentStock, vel.avgDailySales);
  return {
    ...vel,
    currentStock,
    inTransitQty,
    daysOfStock: dos,
    daysUntilOrder: daysUntilOrder(dos, settings),
    recommendedQty: recommendedQty(currentStock, inTransitQty, vel.avgDailySales, settings),
    overstockQty: overstockQty(currentStock, vel.avgDailySales),
    deficitDate: deficitDate(today, dos),
    health: supplyHealth(currentStock, vel.avgDailySales, dos, settings),
  };
}

/**
 * Spec 7.6 — does this product need an order *now*, taking an in-transit supply
 * into account? If a supply is expected to arrive before the current stock runs
 * out, the product is not urgent. If the expected arrival is after the deficit
 * date (or there is no supply), urgency stands.
 */
export function needsOrderNow(args: {
  health: SupplyHealth;
  deficitDate: string | null;
  earliestSupplyArrival: string | null;
}): boolean {
  const { health, deficitDate: dDate, earliestSupplyArrival } = args;
  const urgentHealth = health === 'NO_STOCK' || health === 'CRITICAL' || health === 'ORDER';
  if (!urgentHealth) return false;
  if (earliestSupplyArrival && dDate && earliestSupplyArrival <= dDate) {
    // Supply arrives before we run out → not urgent.
    return false;
  }
  return true;
}
