One-line: one number per card, in a row of 3–5 across the top of a report dashboard.

```jsx
<KpiCard label="Total solicitudes" value="1.284" icon="clipboard-list" delta={12} deltaLabel="vs. mes anterior" />
```

The figure uses `--type-kpi` (Segoe UI) because it is data, not a heading. Omit `delta` when there is no comparable period — never show 0%.
