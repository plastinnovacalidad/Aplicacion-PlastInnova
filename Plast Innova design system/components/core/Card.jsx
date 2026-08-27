import React from 'react';

export function Card({ padding = 'var(--space-6)', interactive = false, elevation = 'sm', bordered = true, children, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const shadow = { none: 'none', sm: 'var(--shadow-sm)', md: 'var(--shadow-md)', lg: 'var(--shadow-lg)' }[elevation];
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background: 'var(--surface-card)',
        border: bordered ? '1px solid var(--border-subtle)' : 'none',
        borderRadius: 'var(--radius-lg)', padding,
        boxShadow: interactive && hover ? 'var(--shadow-lg)' : shadow,
        transform: interactive && hover ? 'translateY(-2px)' : 'none',
        transition: 'box-shadow var(--dur-base) var(--ease-out),transform var(--dur-base) var(--ease-out)',
        cursor: interactive ? 'pointer' : undefined,
        ...style,
      }}
      {...rest}
    >{children}</div>
  );
}
