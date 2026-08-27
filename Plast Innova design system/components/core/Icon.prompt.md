One-line: renders a FontAwesome 6 glyph — the icon primitive every other Plast Innova component uses. FontAwesome is already loaded by `styles.css`.

```jsx
<Icon name="shield-halved" size={20} />
<Icon name="whatsapp" variant="brands" size={18} />
```

Notes: `name` drops the `fa-` prefix. 16px inside small controls, 20px default, 22–24px standalone. Never pass a colour — set `color` on the wrapper.
