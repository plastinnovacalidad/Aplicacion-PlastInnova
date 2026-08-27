import React from 'react';
import { Icon } from '../core/Icon.jsx';

/** Dense report table. Columns: { key, label, align, width, render }. */
export function DataTable({ columns = [], rows = [], zebra = true, emptyLabel = 'Sin registros', style, ...rest }) {
  const [hover, setHover] = React.useState(-1);
  return (
    <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden', ...style }} {...rest}>
      <table style={{ width: '100%', borderCollapse: 'collapse', font: 'var(--type-data)' }}>
        <thead>
          <tr style={{ background: 'var(--surface-subtle)' }}>
            {columns.map((c) => (
              <th key={c.key} style={{
                font: 'var(--type-data-strong)', fontSize: 'var(--fs-xs)', letterSpacing: 'var(--ls-wide)',
                textTransform: 'uppercase', color: 'var(--pi-neutral-600)', textAlign: c.align || 'left',
                padding: 'var(--space-4) var(--space-5)', width: c.width,
                borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap',
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} style={{ padding: 'var(--space-12)', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Icon name="inbox" size={24} style={{ color: 'var(--pi-neutral-400)' }} />
              <div style={{ marginTop: 'var(--space-3)' }}>{emptyLabel}</div>
            </td></tr>
          ) : rows.map((r, i) => (
            <tr key={i}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)}
              style={{
                background: hover === i ? 'var(--pi-blue-50)' : zebra && i % 2 ? 'var(--pi-neutral-50)' : 'transparent',
                transition: 'background-color var(--dur-instant) var(--ease-standard)',
              }}>
              {columns.map((c) => (
                <td key={c.key} style={{
                  padding: 'var(--space-4) var(--space-5)', textAlign: c.align || 'left',
                  color: 'var(--text-body)', borderBottom: '1px solid var(--border-subtle)',
                }}>{c.render ? c.render(r[c.key], r) : r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
