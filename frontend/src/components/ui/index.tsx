import {
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import type { BadgeVariant, StatusView } from '../../lib/status';
import { Icon, type IconName } from './icons';

// ── Button ──────────────────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({
  variant = 'secondary',
  size,
  loading,
  block,
  children,
  className = '',
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'lg';
  loading?: boolean;
  block?: boolean;
}) {
  return (
    <button
      className={`btn btn--${variant} ${size ? `btn--${size}` : ''} ${block ? 'btn--block' : ''} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <span className="spinner" />}
      {children}
    </button>
  );
}

// ── Icon button / Chip ───────────────────────────────────────────────────────
export function IconButton({
  icon,
  label,
  onClick,
  danger,
  size = 17,
  className = '',
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  danger?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-btn ${danger ? 'icon-btn--danger' : ''} ${className}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Chip({ icon, onClick, children }: { icon?: IconName; onClick?: () => void; children: ReactNode }) {
  return (
    <button type="button" className="chip" onClick={onClick}>
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  );
}

// ── Badge / StatusBadge ──────────────────────────────────────────────────────
export function Badge({ variant, children }: { variant: BadgeVariant; children: ReactNode }) {
  return <span className={`badge badge--${variant}`}>{children}</span>;
}
export function StatusBadge({ view, dot = true }: { view: StatusView; dot?: boolean }) {
  return (
    <span className={`badge badge--${view.variant}`}>
      {dot && <span className="badge__dot" />}
      {view.label}
    </span>
  );
}

// ── Card / Metric ────────────────────────────────────────────────────────────
export function Card({
  title,
  actions,
  children,
  pad,
  className = '',
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  pad?: 'sm';
  className?: string;
}) {
  return (
    <section className={`card ${pad === 'sm' ? 'card--pad-sm' : ''} ${className}`}>
      {(title || actions) && (
        <div className="card__head">
          {title ? <h2 className="card__title" style={{ margin: 0 }}>{title}</h2> : <span />}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Metric({
  label,
  value,
  sub,
  trend,
  small,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  trend?: 'up' | 'down';
  small?: boolean;
}) {
  return (
    <div>
      <div className="metric__label">{label}</div>
      <div className={`metric__value ${small ? 'metric__value--sm' : ''} ${trend ? `trend-${trend}` : ''}`}>
        {value}
      </div>
      {sub && <div className="metric__label" style={{ marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Form fields ──────────────────────────────────────────────────────────────
export function Field({
  label,
  error,
  children,
  hint,
}: {
  label?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      {label && <label className="label">{label}</label>}
      {children}
      {hint && !error && <span className="field__error" style={{ color: 'var(--text-3)' }}>{hint}</span>}
      {error && <span className="field__error">{error}</span>}
    </div>
  );
}

export function Input({ className = '', error, ...props }: InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  return <input className={`input ${error ? 'is-error' : ''} ${className}`} {...props} />;
}

export function NumberInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input inputMode="decimal" className={`input input--num ${className}`} {...props} />;
}

export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`select ${className}`} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`textarea ${className}`} {...props} />;
}

// ── Modal ────────────────────────────────────────────────────────────────────
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
  headerActions,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  headerActions?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal--wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal__head">
          <h3 className="modal__title">{title}</h3>
          <div className="row" style={{ gap: 8 }}>
            {headerActions}
            <button className="icon-btn" aria-label="Закрыть" onClick={onClose}>
              <Icon name="x" size={18} />
            </button>
          </div>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

// ── Banner / Empty / loaders ─────────────────────────────────────────────────
export function Banner({
  variant,
  title,
  children,
  action,
}: {
  variant: 'warning' | 'danger' | 'info';
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`banner banner--${variant}`}>
      <div style={{ flex: 1 }}>
        {title && <div className="banner__title">{title}</div>}
        {children && <div>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon = <Icon name="box" size={30} />,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      <div className="empty__title">{title}</div>
      {description && <div className="muted" style={{ maxWidth: 420 }}>{description}</div>}
      {action}
    </div>
  );
}

export function Spinner({ brand }: { brand?: boolean }) {
  return <span className={`spinner ${brand ? 'spinner--brand' : ''}`} />;
}

export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: number | string }) {
  return <div className="skeleton" style={{ height, width }} />;
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={20} />
      ))}
    </div>
  );
}
