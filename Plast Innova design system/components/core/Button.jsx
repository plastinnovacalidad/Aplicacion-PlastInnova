import React from 'react';
import { Icon } from './Icon.jsx';

const SIZES = {
  sm: { h: 'var(--control-h-sm)', px: '14px', fs: 'var(--fs-xs)', icon: 14, gap: '6px' },
  md: { h: 'var(--control-h-md)', px: '20px', fs: 'var(--fs-sm)', icon: 16, gap: '8px' },
  lg: { h: 'var(--control-h-lg)', px: '28px', fs: 'var(--fs-md)', icon: 18, gap: '10px' },
};

const VARIANTS = {
  primary: { background: 'var(--pi-blue-600)', color: 'var(--text-on-brand)', border: '1px solid transparent', boxShadow: 'var(--shadow-sm)' },
  accent:  { background: 'var(--pi-gradient-red)', color: 'var(--text-on-accent)', border: '1px solid transparent', boxShadow: 'var(--shadow-accent)' },
  secondary: { background: 'transparent', color: 'var(--pi-blue-600)', border: '1.5px solid var(--pi-blue-600)', boxShadow: 'none' },
  subtle: { background: 'var(--pi-blue-50)', color: 'var(--pi-blue-700)', border: '1px solid transparent', boxShadow: 'none' },
  ghost: { background: 'transparent', color: 'var(--text-body)', border: '1px solid transparent', boxShadow: 'none' },
};

const HOVER = {
  primary: { background: 'var(--pi-blue-700)' },
  accent: { background: 'var(--pi-red-700)' },
  secondary: { background: 'var(--pi-blue-50)' },
  subtle: { background: 'var(--pi-blue-100)' },
  ghost: { background: 'var(--pi-neutral-100)' },
};

export function Button({
  variant = 'primary', size = 'md', iconLeft, iconRight, fullWidth = false,
  disabled = false, children, style, onClick, type = 'button', ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [down, setDown] = React.useState(false);
  const s = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.primary;
  return (
    <button
      type={type} disabled={disabled} onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); setDown(false); }}
      onMouseDown={() => setDown(true)} onMouseUp={() => setDown(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: s.gap,
        height: s.h, padding: `0 ${s.px}`, width: fullWidth ? '100%' : undefined,
        font: 'var(--type-button)', fontSize: s.fs, letterSpacing: 'var(--ls-wide)',
        textTransform: 'uppercase', borderRadius: 'var(--radius-pill)', cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'var(--transition-control)', whiteSpace: 'nowrap',
        opacity: disabled ? 0.45 : 1,
        transform: down && !disabled ? 'scale(.97)' : 'scale(1)',
        ...v,
        ...(hover && !disabled ? HOVER[variant] : null),
        ...style,
      }}
      {...rest}
    >
      {iconLeft ? <Icon name={iconLeft} size={s.icon} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={s.icon} /> : null}
    </button>
  );
}
