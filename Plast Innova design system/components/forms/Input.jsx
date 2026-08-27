import React from 'react';
import { Icon } from '../core/Icon.jsx';

export function Input({
  label, hint, error, iconLeft, size = 'md', disabled = false, id,
  style, wrapperStyle, ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const uid = id || React.useId();
  const h = { sm: 'var(--control-h-sm)', md: 'var(--control-h-md)', lg: 'var(--control-h-lg)' }[size];
  const borderColor = error ? 'var(--state-danger)' : focus ? 'var(--pi-blue-600)' : 'var(--border-default)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', ...wrapperStyle }}>
      {label ? <label htmlFor={uid} style={{ font: 'var(--type-label)', color: 'var(--text-heading)' }}>{label}</label> : null}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px', height: h, padding: '0 14px',
        background: disabled ? 'var(--surface-sunken)' : 'var(--pi-white)',
        border: `1px solid ${borderColor}`, borderRadius: 'var(--radius-md)',
        boxShadow: focus ? (error ? 'var(--focus-ring-accent)' : 'var(--focus-ring)') : 'none',
        transition: 'var(--transition-control)', opacity: disabled ? 0.6 : 1,
      }}>
        {iconLeft ? <Icon name={iconLeft} size={16} style={{ color: 'var(--text-muted)' }} /> : null}
        <input
          id={uid} disabled={disabled}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          style={{
            flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
            font: 'var(--type-body)', fontSize: size === 'sm' ? 'var(--fs-sm)' : 'var(--fs-md)',
            color: 'var(--text-heading)', ...style,
          }}
          {...rest}
        />
      </div>
      {error || hint ? (
        <span style={{ font: 'var(--type-body-sm)', fontSize: 'var(--fs-xs)', color: error ? 'var(--state-danger)' : 'var(--text-muted)' }}>
          {error || hint}
        </span>
      ) : null}
    </div>
  );
}
