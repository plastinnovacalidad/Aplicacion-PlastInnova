import React from 'react';
import { Icon } from '../core/Icon.jsx';

const TONES = {
  brand: 'var(--pi-blue-600)', accent: 'var(--pi-red-600)',
  success: 'var(--state-success)', warning: 'var(--state-warning)', info: 'var(--state-info)',
};

/** Single headline figure for report dashboards. */
export function KpiCard({ label, value, unit, icon, tone = 'brand', delta, deltaLabel, style, ...rest }) {
  const c = TONES[tone] || TONES.brand;
  const up = typeof delta === 'number' && delta >= 0;
  return (
    <div
      style={{
        background: 'var(--surface-card)', border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)',
        padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', ...style,
      }}
      {...rest}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
        <span style={{ font: 'var(--type-eyebrow)', letterSpacing: 'var(--ls-wide)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</span>
        {icon ? (
          <span style={{ width: 34, height: 34, flex: 'none', borderRadius: 'var(--radius-md)', background: 'var(--pi-blue-50)', color: c, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={icon} size={17} />
          </span>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ font: 'var(--type-kpi)', color: 'var(--text-heading)' }}>{value}</span>
        {unit ? <span style={{ font: 'var(--type-data)', fontSize: 'var(--fs-md)', color: 'var(--text-muted)' }}>{unit}</span> : null}
      </div>
      {typeof delta === 'number' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: 'var(--type-data)', fontSize: 'var(--fs-xs)', color: up ? 'var(--state-success)' : 'var(--state-danger)' }}>
          <Icon name={up ? 'arrow-trend-up' : 'arrow-trend-down'} size={13} />
          {up ? '+' : ''}{delta}%
          {deltaLabel ? <span style={{ color: 'var(--text-muted)' }}>{deltaLabel}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
