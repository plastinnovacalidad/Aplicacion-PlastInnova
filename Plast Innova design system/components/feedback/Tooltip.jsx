import React from 'react';

export function Tooltip({ content, placement = 'top', children, style, ...rest }) {
  const [open, setOpen] = React.useState(false);
  const pos = {
    top: { bottom: '100%', left: '50%', transform: 'translate(-50%,-8px)' },
    bottom: { top: '100%', left: '50%', transform: 'translate(-50%,8px)' },
    left: { right: '100%', top: '50%', transform: 'translate(-8px,-50%)' },
    right: { left: '100%', top: '50%', transform: 'translate(8px,-50%)' },
  }[placement];
  return (
    <span
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      style={{ position: 'relative', display: 'inline-flex', ...style }}
      {...rest}
    >
      {children}
      <span style={{
        position: 'absolute', ...pos, zIndex: 50, pointerEvents: 'none', whiteSpace: 'nowrap',
        padding: '6px 10px', borderRadius: 'var(--radius-sm)',
        background: 'var(--pi-blue-900)', color: '#fff',
        font: 'var(--type-body-sm)', fontSize: 'var(--fs-xs)',
        boxShadow: 'var(--shadow-md)',
        opacity: open ? 1 : 0, transition: 'opacity var(--dur-fast) var(--ease-standard)',
      }}>{content}</span>
    </span>
  );
}
