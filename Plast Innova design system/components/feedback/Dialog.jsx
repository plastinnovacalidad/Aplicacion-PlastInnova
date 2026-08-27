import React from 'react';
import { IconButton } from '../core/IconButton.jsx';

export function Dialog({ open = false, title, description, onClose, footer, width = 460, children, style, ...rest }) {
  if (!open) return null;
  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(17,27,67,.45)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', padding: 'var(--space-6)',
      }}
      onClick={onClose}
    >
      <div
        role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: width, background: 'var(--surface-card)',
          borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden', ...style,
        }}
        {...rest}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)', padding: 'var(--space-6) var(--space-6) var(--space-4)' }}>
          <div style={{ flex: 1 }}>
            {title ? <h3 style={{ font: 'var(--type-h3)', color: 'var(--text-heading)' }}>{title}</h3> : null}
            {description ? <p style={{ margin: '6px 0 0', font: 'var(--type-body-sm)', color: 'var(--text-muted)' }}>{description}</p> : null}
          </div>
          <IconButton icon="xmark" label="Cerrar" size="sm" onClick={onClose} />
        </div>
        {children ? <div style={{ padding: '0 var(--space-6)' }}>{children}</div> : null}
        {footer ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', padding: 'var(--space-6)', marginTop: 'var(--space-2)' }}>{footer}</div>
        ) : <div style={{ height: 'var(--space-6)' }} />}
      </div>
    </div>
  );
}
