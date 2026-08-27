import React from 'react';
import { Icon } from '../core/Icon.jsx';

/** Square module launcher used on the portal home. */
export function ModuleTile({ icon = 'circle', label, tone = 'var(--pi-gradient-blue)', size = 150, onClick, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  return (
    <a
      onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        width: size, background: 'var(--surface-card)', border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)', overflow: 'hidden', cursor: 'pointer', textDecoration: 'none',
        display: 'flex', flexDirection: 'column',
        boxShadow: hover ? 'var(--shadow-lg)' : 'var(--shadow-sm)',
        transform: hover ? 'translateY(-4px)' : 'none',
        transition: 'box-shadow var(--dur-base) var(--ease-out),transform var(--dur-base) var(--ease-out)',
        ...style,
      }}
      {...rest}
    >
      <div style={{ height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', background: tone, color: '#fff' }}>
        <Icon name={icon} size={44} />
      </div>
      <div style={{ padding: 'var(--space-3) var(--space-2)', minHeight: 52, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ font: 'var(--type-label)', fontSize: 'var(--fs-xs)', color: 'var(--text-heading)', textAlign: 'center', lineHeight: 1.3 }}>{label}</span>
      </div>
    </a>
  );
}
