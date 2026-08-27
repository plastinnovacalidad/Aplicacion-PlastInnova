import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { IconButton } from '../core/IconButton.jsx';

const TONES = {
  success: { icon: 'circle-check', color: 'var(--state-success)' },
  danger: { icon: 'circle-exclamation', color: 'var(--state-danger)' },
  info: { icon: 'circle-info', color: 'var(--state-info)' },
  warning: { icon: 'triangle-exclamation', color: 'var(--state-warning)' },
};

export function Toast({ tone = 'success', title, message, onClose, style, ...rest }) {
  const t = TONES[tone] || TONES.info;
  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)',
        minWidth: '300px', maxWidth: '420px', padding: 'var(--space-4)',
        background: 'var(--surface-card)', border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', ...style,
      }}
      {...rest}
    >
      <Icon name={t.icon} size={20} style={{ color: t.color, marginTop: '1px' }} />
      <div style={{ flex: 1 }}>
        {title ? <div style={{ font: 'var(--type-label)', color: 'var(--text-heading)' }}>{title}</div> : null}
        {message ? <div style={{ font: 'var(--type-body-sm)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: '2px' }}>{message}</div> : null}
      </div>
      {onClose ? <IconButton icon="xmark" label="Cerrar" size="sm" onClick={onClose} /> : null}
    </div>
  );
}
