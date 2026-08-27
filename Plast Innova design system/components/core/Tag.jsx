import React from 'react';
import { Icon } from './Icon.jsx';

export function Tag({ children, selected = false, onRemove, onClick, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  return (
    <span
      onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '8px',
        height: '32px', padding: '0 14px', borderRadius: 'var(--radius-pill)',
        font: 'var(--type-label)',
        background: selected ? 'var(--pi-blue-600)' : hover ? 'var(--pi-neutral-100)' : 'var(--pi-white)',
        color: selected ? '#fff' : 'var(--text-body)',
        border: `1px solid ${selected ? 'var(--pi-blue-600)' : 'var(--border-default)'}`,
        cursor: onClick ? 'pointer' : 'default', transition: 'var(--transition-control)', ...style,
      }}
      {...rest}
    >
      {children}
      {onRemove ? (
        <span onClick={(e) => { e.stopPropagation(); onRemove(e); }} style={{ display: 'inline-flex', cursor: 'pointer', opacity: 0.7 }}>
          <Icon name="xmark" size={13} />
        </span>
      ) : null}
    </span>
  );
}
