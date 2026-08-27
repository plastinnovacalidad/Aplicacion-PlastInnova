import React from 'react';
import { Icon } from './Icon.jsx';

const SIZES = { sm: [32, 16], md: [40, 18], lg: [48, 22] };

export function IconButton({ icon = 'circle', size = 'md', variant = 'ghost', label, disabled = false, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const [box, glyph] = SIZES[size] || SIZES.md;
  const base = {
    ghost: { background: 'transparent', color: 'var(--text-body)', hover: 'var(--pi-neutral-100)' },
    solid: { background: 'var(--pi-blue-600)', color: '#fff', hover: 'var(--pi-blue-700)' },
    accent: { background: 'var(--pi-red-600)', color: '#fff', hover: 'var(--pi-red-700)' },
    outline: { background: 'transparent', color: 'var(--pi-blue-600)', hover: 'var(--pi-blue-50)', border: '1.5px solid var(--border-subtle)' },
  }[variant];
  return (
    <button
      type="button" aria-label={label} disabled={disabled} title={label}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: box, height: box, borderRadius: 'var(--radius-pill)',
        border: base.border || '1px solid transparent',
        background: hover && !disabled ? base.hover : base.background,
        color: base.color, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1, transition: 'var(--transition-control)', ...style,
      }}
      {...rest}
    >
      <Icon name={icon} size={glyph} />
    </button>
  );
}
