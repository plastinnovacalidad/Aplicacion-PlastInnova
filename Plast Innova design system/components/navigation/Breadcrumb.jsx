import React from 'react';
import { Icon } from '../core/Icon.jsx';

export function Breadcrumb({ items = [], style, ...rest }) {
  return (
    <nav aria-label="Ruta" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', ...style }} {...rest}>
      {items.map((it, i) => {
        const label = it.label || it;
        const last = i === items.length - 1;
        return (
          <React.Fragment key={label}>
            <span style={{
              font: 'var(--type-body-sm)', fontSize: 'var(--fs-xs)',
              color: last ? 'var(--text-heading)' : 'var(--text-muted)',
              fontWeight: last ? 'var(--fw-medium)' : 'var(--fw-regular)',
              cursor: last ? 'default' : 'pointer',
            }}>{label}</span>
            {last ? null : <Icon name="chevron-right" size={12} style={{ color: 'var(--pi-neutral-400)' }} />}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
