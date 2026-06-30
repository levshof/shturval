/**
 * Supply (in-transit) tracking — SINGLE SOURCE OF TRUTH (spec section 8).
 *
 * Pure functions over supply records and observed stock changes. The sync
 * engine assembles inputs and persists outputs; all the rules live here.
 */

export type SupplyStatus =
  | 'IN_TRANSIT'
  | 'PARTIAL'
  | 'DELAYED'
  | 'ZERO_NOT_FOUND'
  | 'WAIT_AFTER_ZERO'
  | 'DELIVERED'
  | 'CANCELLED';

/** Statuses that still represent goods we expect to receive. */
export const ACTIVE_SUPPLY_STATUSES: SupplyStatus[] = [
  'IN_TRANSIT',
  'PARTIAL',
  'DELAYED',
  'WAIT_AFTER_ZERO',
];

export interface SupplyState {
  id: string;
  quantity: number;
  acceptedQty: number;
  /** "YYYY-MM-DD". */
  expectedDate: string;
  /** "YYYY-MM-DD" — used as a tie-breaker when distributing arrivals. */
  orderDate: string;
  status: SupplyStatus;
  watchAfterZero: boolean;
}

export function isActive(status: SupplyStatus): boolean {
  return ACTIVE_SUPPLY_STATUSES.includes(status);
}

export function remainingQty(s: SupplyState): number {
  return Math.max(s.quantity - s.acceptedQty, 0);
}

/**
 * In-transit quantity counted toward reorder recommendations. Excludes
 * DELIVERED/CANCELLED and excludes ZERO_NOT_FOUND (that supply did not show up
 * and stock is 0 — it must NOT suppress a reorder). WAIT_AFTER_ZERO counts,
 * because the user explicitly chose to keep waiting for it.
 */
export function inTransitQty(supplies: SupplyState[]): number {
  return supplies
    .filter((s) => isActive(s.status))
    .reduce((sum, s) => sum + remainingQty(s), 0);
}

/**
 * Spec 8.2 — arrival increment from observed stock movement.
 *   arrival_increment = max(0, current_stock - previous_stock + sales_since_last_check)
 */
export function arrivalIncrement(
  currentStock: number,
  previousStock: number,
  salesSinceLastCheck: number,
): number {
  return Math.max(0, currentStock - previousStock + salesSinceLastCheck);
}

/**
 * Spec 8.2 — distribute an arrival increment across active supplies of one
 * product. Order: earliest expected date first, then earliest order date.
 * Returns the amount to add to each supply's acceptedQty.
 */
export function distributeArrival(
  supplies: SupplyState[],
  increment: number,
): Array<{ id: string; addAccepted: number }> {
  const result: Array<{ id: string; addAccepted: number }> = [];
  let left = Math.max(0, Math.floor(increment));
  if (left === 0) return result;

  const ordered = supplies
    .filter((s) => isActive(s.status))
    .sort((a, b) =>
      a.expectedDate !== b.expectedDate
        ? a.expectedDate.localeCompare(b.expectedDate)
        : a.orderDate.localeCompare(b.orderDate),
    );

  for (const s of ordered) {
    if (left <= 0) break;
    const room = remainingQty(s);
    if (room <= 0) continue;
    const add = Math.min(room, left);
    result.push({ id: s.id, addAccepted: add });
    left -= add;
  }
  return result;
}

/** 80%-of-quantity threshold used for on-deadline success (spec 8.3). */
export function deadlineThreshold(quantity: number): number {
  return Math.ceil(quantity * 0.8);
}

/**
 * Spec 8.3–8.4 — next status for a supply given the latest accepted quantity,
 * the calendar, and current stock. Pure; does not mutate input.
 */
export function nextSupplyStatus(args: {
  supply: SupplyState;
  today: string;
  currentStock: number;
}): SupplyStatus {
  const { supply, today, currentStock } = args;

  // Terminal states are not changed automatically.
  if (supply.status === 'CANCELLED') return 'CANCELLED';

  // Spec 8.3 — fully accepted at any time.
  if (supply.acceptedQty >= supply.quantity) return 'DELIVERED';

  const dueReached = today >= supply.expectedDate;

  if (dueReached) {
    // Spec 8.3 — on/after deadline, >= 80% counts as delivered.
    if (supply.acceptedQty >= deadlineThreshold(supply.quantity)) return 'DELIVERED';

    // Spec 8.4 — overdue with < 80% accepted.
    if (supply.watchAfterZero) return 'WAIT_AFTER_ZERO';
    if (currentStock <= 0) return 'ZERO_NOT_FOUND';
    return 'DELAYED';
  }

  // Not due yet.
  return supply.acceptedQty > 0 ? 'PARTIAL' : 'IN_TRANSIT';
}

/** Earliest expected arrival among active supplies, or null. */
export function earliestActiveArrival(supplies: SupplyState[]): string | null {
  const dates = supplies.filter((s) => isActive(s.status)).map((s) => s.expectedDate);
  if (dates.length === 0) return null;
  return dates.sort((a, b) => a.localeCompare(b))[0];
}
