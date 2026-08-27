import React from 'react';

export function Radio({ label, checked = false, onChange, name, value, disabled = false, style, ...rest }) {
  return (
    <label
      onClick={() => !disabled && onChange && onChange(value)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, ...style }}
      {...rest}
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: '20px', height: '20px', flex: 'none', borderRadius: 'var(--radius-pill)',
        background: 'var(--pi-white)',
        border: `1.5px solid ${checked ? 'var(--pi-blue-600)' : 'var(--border-default)'}`,
        transition: 'var(--transition-control)',
      }}>
        <span style={{
          width: '10px', height: '10px', borderRadius: 'var(--radius-pill)',
          background: 'var(--pi-blue-600)', transform: checked ? 'scale(1)' : 'scale(0)',
          transition: 'transform var(--dur-fast) var(--ease-out)',
        }} />
      </span>
      {label ? <span style={{ font: 'var(--type-body-sm)', color: 'var(--text-body)' }}>{label}</span> : null}
      <input type="radio" name={name} value={value} checked={checked} readOnly style={{ display: 'none' }} />
    </label>
  );
}
