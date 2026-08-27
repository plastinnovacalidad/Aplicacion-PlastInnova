import React from 'react';
import { Icon } from '../core/Icon.jsx';

export function Select({ label, hint, options = [], size = 'md', disabled = false, id, style, wrapperStyle, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const uid = id || React.useId();
  const h = { sm: 'var(--control-h-sm)', md: 'var(--control-h-md)', lg: 'var(--control-h-lg)' }[size];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', ...wrapperStyle }}>
      {label ? <label htmlFor={uid} style={{ font: 'var(--type-label)', color: 'var(--text-heading)' }}>{label}</label> : null}
      <div style={{
        position: 'relative', display: 'flex', alignItems: 'center', height: h,
        border: `1px solid ${focus ? 'var(--pi-blue-600)' : 'var(--border-default)'}`,
        borderRadius: 'var(--radius-md)', background: disabled ? 'var(--surface-sunken)' : 'var(--pi-white)',
        boxShadow: focus ? 'var(--focus-ring)' : 'none', transition: 'var(--transition-control)', opacity: disabled ? 0.6 : 1,
      }}>
        <select
          id={uid} disabled={disabled}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          style={{
            appearance: 'none', WebkitAppearance: 'none', flex: 1, height: '100%',
            padding: '0 38px 0 14px', border: 'none', outline: 'none', background: 'transparent',
            font: 'var(--type-body)', fontSize: size === 'sm' ? 'var(--fs-sm)' : 'var(--fs-md)',
            color: 'var(--text-heading)', cursor: disabled ? 'not-allowed' : 'pointer', ...style,
          }}
          {...rest}
        >
          {options.map((o) => {
            const value = typeof o === 'string' ? o : o.value;
            const lab = typeof o === 'string' ? o : o.label;
            return <option key={value} value={value}>{lab}</option>;
          })}
        </select>
        <Icon name="chevron-down" size={16} style={{ position: 'absolute', right: '14px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
      </div>
      {hint ? <span style={{ font: 'var(--type-body-sm)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{hint}</span> : null}
    </div>
  );
}
