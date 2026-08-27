import React from 'react';
import { Icon } from '../core/Icon.jsx';

export function Checkbox({ label, checked, defaultChecked, onChange, disabled = false, style, ...rest }) {
  const controlled = checked !== undefined;
  const [inner, setInner] = React.useState(!!defaultChecked);
  const on = controlled ? checked : inner;
  const toggle = () => {
    if (disabled) return;
    if (!controlled) setInner(!on);
    onChange && onChange(!on);
  };
  return (
    <label
      onClick={toggle}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, ...style }}
      {...rest}
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: '20px', height: '20px', flex: 'none', borderRadius: 'var(--radius-xs)',
        background: on ? 'var(--pi-blue-600)' : 'var(--pi-white)',
        border: `1.5px solid ${on ? 'var(--pi-blue-600)' : 'var(--border-default)'}`,
        color: '#fff', transition: 'var(--transition-control)',
      }}>
        {on ? <Icon name="check" size={13} /> : null}
      </span>
      {label ? <span style={{ font: 'var(--type-body-sm)', color: 'var(--text-body)' }}>{label}</span> : null}
    </label>
  );
}
