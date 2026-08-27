# CLAUDE.md — Plast Innova

Este proyecto **es** el design system de Plast Innova. Al diseñar cualquier cosa aquí o en
proyectos que lo consuman, sigue `readme.md` y `SKILL.md`.

Reglas que no se negocian:

1. **Dos colores de marca:** azul `#2C43A2` (estructura) y rojo `#FF0000` (acento, un solo CTA
   por pantalla). Nada de degradados morados ni colores inventados.
2. **Rubik para lenguaje, Segoe UI para datos.** Celdas de tabla, cifras de KPI, lotes y
   referencias van en Segoe (`--font-data`). Títulos, botones y etiquetas en Rubik.
3. **FontAwesome 6, cero emoji.**
4. **Nunca dibujar el logo.** Usar los PNG de `assets/`.
5. **Nunca inventar fotos de producto.** Dejar marcador punteado con etiqueta.
6. **Sombras teñidas de azul**, nunca negras. Tarjetas: blanco, borde 1px `#DFE3EA`, radio 16px.
7. **Movimiento:** desvanecidos y desplazamientos pequeños. Sin rebote ni resorte.
8. **Textos en español de Colombia**, tú al cliente, nosotros la empresa, `$189.900` y `4,8`.

El azul de la app interna (`#1B4FC4 → #1642AA` en `app-circuitos-smd-v2/Public/css/comun.css`)
está obsoleto: el canónico es `#2C43A2`.

Si el usuario pide un "template", va en `templates/<slug>/` con `dc_write`, nunca en la raíz.
