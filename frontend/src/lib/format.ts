/**
 * Number/money/date formatting — SINGLE SOURCE for display (DESIGN_CODE §15).
 * Russian locale: space thousands separator, comma decimals, ₽ suffix.
 */

const EMPTY = '—';

export function formatMoney(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return EMPTY;
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(v))} ₽`;
}

export function formatMoneyShort(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return EMPTY;
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.', ',')} млн ₽`;
  if (abs >= 10_000) return `${Math.round(v / 1000)} тыс ₽`;
  return formatMoney(v);
}

export function formatNum(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return EMPTY;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
}

export function formatUnits(v: number | null | undefined): string {
  if (v == null) return EMPTY;
  return `${formatNum(v)} шт`;
}

export function formatDays(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return EMPTY;
  return `${formatNum(v, v < 10 ? 1 : 0)} дн`;
}

export function formatPercent(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return EMPTY;
  return `${formatNum(v, 1)}%`;
}

/** "2026-06-30" or ISO → "30.06". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(d);
}

export function formatDateFull(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

/** Relative "last sync" label from an ISO timestamp. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'никогда';
  const d = new Date(iso);
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH} ч назад`;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}
