/**
 * Status → label + badge variant. SINGLE SOURCE for status display
 * (DESIGN_CODE §9). Components never hardcode status colors.
 */

export type BadgeVariant = 'danger' | 'critical' | 'warning' | 'success' | 'info' | 'neutral' | 'muted';

export interface StatusView {
  label: string;
  variant: BadgeVariant;
}

export const HEALTH: Record<string, StatusView> = {
  NO_STOCK: { label: 'Нет остатка', variant: 'danger' },
  CRITICAL: { label: 'Критично', variant: 'critical' },
  ORDER: { label: 'Заказать', variant: 'warning' },
  NORMAL: { label: 'Норма', variant: 'success' },
  OVERSTOCK: { label: 'Избыток', variant: 'neutral' },
};

export const SUPPLY_STATUS: Record<string, StatusView> = {
  IN_TRANSIT: { label: 'В пути', variant: 'info' },
  PARTIAL: { label: 'Частично приехала', variant: 'info' },
  DELAYED: { label: 'Задерживается', variant: 'warning' },
  ZERO_NOT_FOUND: { label: 'Остаток 0, не обнаружена', variant: 'danger' },
  WAIT_AFTER_ZERO: { label: 'Ждём после нуля', variant: 'neutral' },
  DELIVERED: { label: 'Доставлена', variant: 'success' },
  CANCELLED: { label: 'Отменена', variant: 'muted' },
};

export const DATA_QUALITY: Record<string, StatusView> = {
  VERIFIED: { label: 'Проверенные', variant: 'success' },
  VERIFIED_BUFFER: { label: 'Проверенные + буфер', variant: 'info' },
  PARTIAL: { label: 'Частичная оценка', variant: 'warning' },
  NONE: { label: 'Нет данных', variant: 'muted' },
};

export const PROFIT_STATUS: Record<string, StatusView> = {
  full: { label: 'Полная', variant: 'success' },
  partial: { label: 'Частичная', variant: 'warning' },
  none: { label: 'Нет данных', variant: 'muted' },
};

export function healthView(h: string | null | undefined): StatusView {
  return HEALTH[h ?? ''] ?? HEALTH.OVERSTOCK;
}
export function supplyStatusView(s: string | null | undefined): StatusView {
  return SUPPLY_STATUS[s ?? ''] ?? SUPPLY_STATUS.IN_TRANSIT;
}
export function dataQualityView(q: string | null | undefined): StatusView {
  return DATA_QUALITY[q ?? ''] ?? DATA_QUALITY.NONE;
}
