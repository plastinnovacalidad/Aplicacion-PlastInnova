import React from 'react';

export function Tabs({ items = [], value, defaultValue, onChange, variant = 'underline', style, ...rest }) {
  const controlled = value !== undefined;
  const first = items[0] && (items[0].value || items[0]);
  const [inner, setInner] = React.useState(defaultValue ?? first);
  const active = controlled ? value : inner;
  const pick = (v) => { if (!controlled) setInner(v); onChange && onChange(v); };
  const pill = variant === 'pill';
  return (
    <div
      role="tablist"
      style={{
        display: 'flex', alignItems: 'center', gap: pill ? '6px' : 'var(--space-6)',
        padding: pill ? '4px' : 0, background: pill ? 'var(--surface-sunken)' : 'transparent',
        borderRadius: pill ? 'var(--radius-pill)' : 0,
        borderBottom: pill ? 'none' : '1px solid var(--border-subtle)', ...style,
      }}
      {...rest}
    >
      {items.map((it) => {
        const v = it.value || it;
        const label = it.label || it;
        const on = v === active;
        return (
          <button
            key={v} role="tab" aria-selected={on} onClick={() => pick(v)}
            style={{
              appearance: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              font: 'var(--type-label)', fontSize: 'var(--fs-sm)',
              padding: pill ? '8px 18px' : '0 0 12px',
              border: 'none', background: pill && on ? 'var(--pi-white)' : 'transparent',
              borderRadius: pill ? 'var(--radius-pill)' : 0,
              boxShadow: pill && on ? 'var(--shadow-sm)' : 'none',
              color: on ? 'var(--pi-blue-700)' : 'var(--text-muted)',
              borderBottom: pill ? 'none' : `2px solid ${on ? 'var(--pi-red-600)' : 'transparent'}`,
              marginBottom: pill ? 0 : '-1px',
              transition: 'var(--transition-control)',
            }}
          >{label}</button>
        );
      })}
    </div>
  );
}
