import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { arrow, cls, pct } from './format';

export function Panel({ title, actions, children, flush, scroll, className, style, bodyStyle, headerProps }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; scroll?: boolean; className?: string;
  style?: React.CSSProperties; bodyStyle?: React.CSSProperties; headerProps?: React.HTMLAttributes<HTMLDivElement>;
}) {
  return (
    <section className={`panel ${className ?? ''}`} style={style}>
      {(title || actions) && (
        <div className="panel-h" {...headerProps}>
          <h3>{title}</h3>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={`panel-b ${flush ? 'flush' : ''} ${scroll ? 'scroll' : ''}`} style={bodyStyle}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, valueClass, large, title }: { label: ReactNode; value: ReactNode; sub?: ReactNode; valueClass?: string; large?: boolean; title?: string }) {
  return (
    <div className="stat" title={title}>
      <span className="tiny">{label}</span>
      <span className={`v ${large ? 'lg' : ''} ${valueClass ?? ''}`}>{value}</span>
      {sub !== undefined && <span className="s">{sub}</span>}
    </div>
  );
}

/** Coloured change with an arrow so direction is not conveyed by colour alone. */
export function Change({ value, decimals = 2, showArrow = true }: { value: number; decimals?: number; showArrow?: boolean }) {
  return (
    <span className={`num ${cls(value)}`}>
      {showArrow && <span aria-hidden style={{ fontSize: '0.8em', marginRight: 3 }}>{arrow(value)}</span>}
      {pct(value, decimals)}
    </span>
  );
}

export function Badge({ children, tone, title }: { children: ReactNode; tone?: 'pos' | 'neg' | 'warn' | 'accent'; title?: string }) {
  return <span className={`badge ${tone ?? ''}`} title={title}>{children}</span>;
}

export function Bar({ value, max = 1, limit, tone }: { value: number; max?: number; limit?: number; tone?: 'pos' | 'neg' | 'warn' }) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="bar" role="meter" aria-valuenow={value} aria-valuemax={max}>
      <i className={tone} style={{ width: `${w}%` }} />
      {limit !== undefined && <span className="limit" style={{ left: `${Math.min(100, (limit / max) * 100)}%` }} />}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" className={o.id === value ? 'on' : ''} title={o.title} aria-pressed={o.id === value} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const a = f[0], b = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
        else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={ref}>
        <div className="modal-h">
          <h2>{title}</h2>
          <button className="btn ghost icon" data-close onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, text, confirmLabel = 'Confirm', danger, onConfirm, onCancel }: { title: string; text: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal title={title} onClose={onCancel} footer={<>
      <button className="btn" onClick={onCancel}>Cancel</button>
      <button className={`btn ${danger ? 'sell' : 'primary'}`} onClick={onConfirm}>{confirmLabel}</button>
    </>}>
      <div className="muted">{text}</div>
    </Modal>
  );
}

export interface Column<T> {
  key: string;
  label: ReactNode;
  num?: boolean;
  sort?: (r: T) => number | string;
  render: (r: T) => ReactNode;
  width?: number | string;
  title?: string;
  hideSm?: boolean;
}

export function DataTable<T>({ rows, columns, rowKey, onRowClick, selected, initialSort, initialDir = 'desc', empty = 'Nothing here yet.', maxHeight, limit }: {
  rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; selected?: string;
  initialSort?: string; initialDir?: 'asc' | 'desc'; empty?: ReactNode; maxHeight?: number | string; limit?: number;
}) {
  const [sort, setSort] = useState<{ key?: string; dir: 'asc' | 'desc' }>({ key: initialSort, dir: initialDir });
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const f = col.sort;
    const out = [...rows].sort((a, b) => {
      const x = f(a), y = f(b);
      const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
      return sort.dir === 'asc' ? c : -c;
    });
    return out;
  }, [rows, columns, sort]);
  const shown = limit ? sorted.slice(0, limit) : sorted;
  return (
    <div className="tbl-wrap" style={{ maxHeight }}>
      <table className="tbl">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`${c.num ? 'num' : ''} ${c.sort ? 'sortable' : ''}`} style={{ width: c.width }} title={c.title}
                aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                onClick={() => c.sort && setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === 'desc' ? 'asc' : 'desc' }))}>
                {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const k = rowKey(r);
            return (
              <tr key={k} className={`${onRowClick ? 'clickable' : ''} ${selected === k ? 'selected' : ''}`} onClick={onRowClick ? () => onRowClick(r) : undefined}
                tabIndex={onRowClick ? 0 : undefined} onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(r); } : undefined}>
                {columns.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render(r)}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && <div className="empty">{empty}</div>}
    </div>
  );
}

export function Sparkline({ values, width = 80, height = 22, color }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return <svg width={width} height={height} className="spark" />;
  const min = Math.min(...values), max = Math.max(...values);
  const rng = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / rng) * (height - 4)).toFixed(1)}`).join(' ');
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={width} height={height} className="spark" aria-hidden>
      <polyline points={pts} fill="none" stroke={color ?? (up ? 'var(--pos)' : 'var(--neg)')} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export const LOGO_MARKS = ['TF', 'monogram', 'bars', 'diamond', 'arc', 'grid'] as const;
export const LOGO_COLORS = ['#4c8dff', '#2ebd85', '#f2b33d', '#e2627c', '#9d86d6', '#5fb6b0', '#e38c5a', '#c9d1d9'];

export function FundLogo({ logo, name, size = 28 }: { logo: { mark: string; color: string; accent: string }; name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || 'TF';
  const s = size;
  const c = logo.color, a = logo.accent;
  let inner: ReactNode;
  switch (logo.mark) {
    case 'bars':
      inner = <g fill={a}>{[0.25, 0.5, 0.75].map((h, i) => <rect key={i} x={s * (0.22 + i * 0.2)} y={s * (0.78 - h * 0.7)} width={s * 0.13} height={s * h * 0.7} rx={1} />)}</g>;
      break;
    case 'diamond':
      inner = <path d={`M${s / 2} ${s * 0.18} L${s * 0.82} ${s / 2} L${s / 2} ${s * 0.82} L${s * 0.18} ${s / 2} Z`} fill="none" stroke={a} strokeWidth={s * 0.08} />;
      break;
    case 'arc':
      inner = <path d={`M${s * 0.22} ${s * 0.72} A ${s * 0.3} ${s * 0.3} 0 0 1 ${s * 0.78} ${s * 0.72}`} fill="none" stroke={a} strokeWidth={s * 0.1} strokeLinecap="round" />;
      break;
    case 'grid':
      inner = <g fill={a}>{[0, 1].flatMap((x) => [0, 1].map((y) => <rect key={`${x}${y}`} x={s * (0.26 + x * 0.27)} y={s * (0.26 + y * 0.27)} width={s * 0.2} height={s * 0.2} rx={1.5} opacity={x === y ? 1 : 0.55} />))}</g>;
      break;
    case 'monogram':
      inner = <text x="50%" y="54%" dominantBaseline="middle" textAnchor="middle" fill={a} fontSize={s * 0.42} fontWeight={700} fontFamily="Inter, sans-serif">{initials}</text>;
      break;
    default:
      inner = <text x="50%" y="54%" dominantBaseline="middle" textAnchor="middle" fill={a} fontSize={s * 0.42} fontWeight={700} fontFamily="Inter, sans-serif">{initials.slice(0, 2)}</text>;
  }
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-label={`${name} logo`} style={{ flex: 'none' }}>
      <rect width={s} height={s} rx={s * 0.22} fill={c} />
      {inner}
    </svg>
  );
}

/** Trading Floor brand mark: a geometric "TF" built from a rising bar chart. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden style={{ flex: 'none' }}>
      <rect width="32" height="32" rx="7" fill="#4c8dff" />
      <rect x="7" y="8" width="18" height="3.4" rx="1" fill="#fff" />
      <rect x="14.3" y="8" width="3.4" height="17" rx="1" fill="#fff" />
      <rect x="20.5" y="15" width="3.4" height="10" rx="1" fill="#fff" opacity="0.7" />
      <rect x="20.5" y="15" width="6" height="3" rx="1" fill="#fff" opacity="0.7" />
    </svg>
  );
}

export function Wordmark({ size = 15 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      <BrandMark size={size * 1.75} />
      <span>Trading<span style={{ color: 'var(--accent)' }}>Floor</span></span>
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { id: T; label: ReactNode }[]; onChange: (t: T) => void }) {
  return (
    <div className="row" role="tablist" style={{ borderBottom: '1px solid var(--border)', gap: 0, marginBottom: 12 }}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} className="btn ghost" onClick={() => onChange(t.id)}
          style={{ borderRadius: 0, borderBottom: `2px solid ${t.id === value ? 'var(--accent)' : 'transparent'}`, color: t.id === value ? 'var(--text)' : undefined, height: 34 }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
