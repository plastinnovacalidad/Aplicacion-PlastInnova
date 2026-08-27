One-line: the portal's module launcher — a square icon panel over a two-line label, lifting 4px on hover.

```jsx
<ModuleTile icon="bolt" label="Módulo Circuitos SMD" tone="var(--pi-gradient-blue)" onClick={go} />
```

Tiles are gated by permission in the real app — render nothing rather than a disabled tile. Keep `tone` to the brand gradients or a blue/neutral step; one tile per module, never a tile for a sub-action.
