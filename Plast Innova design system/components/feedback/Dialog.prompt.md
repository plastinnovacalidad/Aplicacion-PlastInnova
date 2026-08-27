One-line: modal for confirmations and short forms (añadir al carrito, solicitar cotización).

```jsx
<Dialog open title="Producto añadido" description="Ya está en tu carrito." onClose={close}
  footer={<><Button variant="ghost" onClick={close}>Seguir viendo</Button><Button variant="accent">Ir al carrito</Button></>} />
```
