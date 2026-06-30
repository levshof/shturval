/** Typed Wildberries client errors so callers can react explicitly (spec 0.4). */

export type WbErrorCode =
  | 'AUTH' // 401 — invalid/expired token or missing category
  | 'RATE_LIMIT' // 429 — exceeded after our retries
  | 'BAD_REQUEST' // 400 — bad params
  | 'SERVER' // 5xx — WB server error after retries
  | 'NETWORK' // fetch failed
  | 'PARSE'; // unexpected body

export class WbError extends Error {
  constructor(
    public readonly code: WbErrorCode,
    message: string,
    public readonly status?: number,
    public readonly endpoint?: string,
  ) {
    super(message);
    this.name = 'WbError';
  }
}

export function isWbAuthError(e: unknown): e is WbError {
  return e instanceof WbError && e.code === 'AUTH';
}
