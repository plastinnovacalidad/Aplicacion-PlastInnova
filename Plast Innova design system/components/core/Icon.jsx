import React from 'react';

/** FontAwesome 6 glyph. `name` is the icon slug without the `fa-` prefix. */
export function Icon({ name = 'circle', size = 20, variant = 'solid', style, className = '', ...rest }) {
  return (
    <i
      aria-hidden="true"
      className={`fa-${variant} fa-${name} ${className}`}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size, height: size, fontSize: Math.round(size * 0.88),
        lineHeight: 1, flex: 'none', ...style,
      }}
      {...rest}
    />
  );
}
