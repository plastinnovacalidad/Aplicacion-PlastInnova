import React from 'react';

export function Switch({ label, checked, defaultChecked, onChange, disabled = false, style, ...rest }) {
  const controlled = checked !== undefined;
  const [inner, setInner] = React.useState(!!defaultChecked);
  const on = controlled ? checked : inner;
  const toggle = () => { if (disabled) return; if (!controlled) setInner(!on); onChange && onChange(!on); };
  return (
    <label onClick={toggle} style={{ display: 'inline-flex', alignItems: 'center', gap: '12px', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, ...style }} {...rest}>
      <span style={{
        position: 'relative', width: '44px', height: '24px', flex: 'none',
        borderRadius: 'var(--radius-pill)', background: on ? 'var(--pi-blue-600)' : 'var(--pi-neutral-300)',
        transition: 'background-color var(--dur-fast) var(--ease-standard)',
      }}>
        <span style={{
          position: 'absolute', top: '3px', left: on ? '23px' : '3px', width: '18px', height: '18px',
          borderRadius: 'var(--radius-pill)', background: '#fff', boxShadow: 'var(--shadow-sm)',
          transition: 'left var(--dur-fast) var(--ease-out)',
        }} />
      </span>
      {label ? <span style={{ font: 'var(--type-body-sm)', color: 'var(--text-body)' }}>{label}</span> : null}
    </label>
  );
}
