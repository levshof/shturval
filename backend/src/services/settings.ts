import type { ResolvedSupplySettings } from '../domain/supply';

/**
 * Resolve effective supply settings = global defaults overridden per product.
 * One place only — both recompute and the product card use this (anti-duplication).
 */

export interface GlobalSupplyDefaults {
  leadTimeDays: number;
  orderBufferDays: number;
  orderQuantum: number;
  targetStockDays: number;
  taxPercent: number;
}

export interface ProductSupplyOverride {
  leadTimeDays?: number | null;
  orderBufferDays?: number | null;
  orderQuantum?: number | null;
  targetStockDays?: number | null;
  taxPercent?: number | null;
  active?: boolean;
}

export function resolveSupplySettings(
  global: GlobalSupplyDefaults,
  override?: ProductSupplyOverride | null,
): ResolvedSupplySettings {
  return {
    leadTimeDays: override?.leadTimeDays ?? global.leadTimeDays,
    orderBufferDays: override?.orderBufferDays ?? global.orderBufferDays,
    orderQuantum: override?.orderQuantum ?? global.orderQuantum,
    targetStockDays: override?.targetStockDays ?? global.targetStockDays,
  };
}

export function resolveTaxPercent(
  global: GlobalSupplyDefaults,
  override?: ProductSupplyOverride | null,
): number {
  return override?.taxPercent ?? global.taxPercent;
}

export const DEFAULT_SUPPLY_DEFAULTS: GlobalSupplyDefaults = {
  leadTimeDays: 14,
  orderBufferDays: 7,
  orderQuantum: 1,
  targetStockDays: 45,
  taxPercent: 0,
};
