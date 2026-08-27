One-line: the report table — every list of inspections, lots, warranties or measurements uses this.

```jsx
<DataTable
  columns={[{key:'ref',label:'Referencia'},{key:'aql',label:'AQL',align:'right'},
            {key:'estado',label:'Resultado',render:v => <Badge tone={v==='Aceptado'?'success':'accent'}>{v}</Badge>}]}
  rows={rows} />
```

Numbers right-aligned, text left. Use `render` to put a Badge in a status column rather than colouring raw text. Abbreviate to ~10 rows in mocks.
