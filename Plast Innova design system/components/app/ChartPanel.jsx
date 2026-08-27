import React from 'react';
import { Icon } from '../core/Icon.jsx';

/** Titled panel that hosts a Chart.js canvas. */
export function ChartPanel({ title, subtitle, action, height = 260, children, style, ...rest }) {
  return (
    <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', padding: 'var(--space-6)', ...style }} {...rest}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
        <div>
          <h3 style={{ font: 'var(--type-h3)', fontSize: 'var(--fs-md)', color: 'var(--text-heading)' }}>{title}</h3>
          {subtitle ? <div style={{ font: 'var(--type-body-sm)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div> : null}
        </div>
        {action || null}
      </div>
      <div style={{ height, position: 'relative' }}>{children}</div>
    </div>
  );
}

/** Chart.js palette in brand order. Pass to `backgroundColor`. */
export const CHART_COLORS = ['#2c43a2', '#ff0000', '#0071bc', '#009245', '#f7931e', '#8799da', '#9aa3b2'];
