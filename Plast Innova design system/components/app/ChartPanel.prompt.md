One-line: the frame every chart sits in — Chart.js is the charting library for this brand (already in production in `dashboard_garantias.html`).

```jsx
<ChartPanel title="Garantías por mes" subtitle="Últimos 12 meses" action={<Select options={['2026','2025']} size="sm"/>}>
  <canvas ref={ref} />
</ChartPanel>
```

Always colour datasets from `CHART_COLORS` so series order matches across panels. Grid lines `#dfe3ea`, no chart title inside the canvas — the panel owns it.
