import React from 'react';
import { Icon } from './Icon.jsx';

const TONES = {
  brand: ['var(--pi-blue-50)', 'var(--pi-blue-700)'],
  accent: ['var(--pi-red-50)', 'var(--pi-red-700)'],
  neutral: ['var(--pi-neutral-100)', 'var(--pi-neutral-700)'],
  success: ['var(--state-success-soft)', 'var(--state-success)'],
  warning: ['var(--state-warning-soft)', '#8a4d00'],
  info: ['var(--state-info-soft)', 'var(--state-info)'],
};

export function Badge({ tone = 'brand', solid = false, icon, children, style, ...rest }) {
  const [bg, fg] = TONES[tone] || TONES.brand;
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '4px 10px', borderRadius: 'var(--radius-pill)',
        background: solid ? fg : bg, color: solid ? '#fff' : fg,
        font: 'var(--type-eyebrow)', letterSpacing: 'var(--ls-wide)', textTransform: 'uppercase',
        ...style,
      }}
      {...rest}
    >
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}
