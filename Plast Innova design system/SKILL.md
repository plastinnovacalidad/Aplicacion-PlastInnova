---
name: plast-innova-design
description: Use this skill to generate well-branded interfaces and assets for Plast Innova, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for protoyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Where things are

| Path | What it is |
|---|---|
| `readme.md` | The design guide: brand context, visual foundations, content fundamentals, iconography, index. **Read this first.** |
| `PROMPT-DE-DISENO.md` | The same rules condensed into a copy-pasteable prompt with every hex value inline — use it when you cannot read the other files, or hand it to another tool. |
| `styles.css` | Single entry point. Link this one file and every token, font and the FontAwesome icon set come with it. |
| `tokens/` | The CSS custom properties, one file per concern. |
| `assets/` | Real logo artwork — horizontal, vertical, isotipo; colour and white (`-ng`) versions. |
| `components/` | React primitives: `core/`, `forms/`, `navigation/`, `feedback/`, `app/`. Each has a `.d.ts` props contract and a `.prompt.md` with a usage example. |
| `ui_kits/portal/` | Click-through recreation of the internal Sistema de Calidad y Control. Read its `README.md` for what is and is not built. |
| `templates/tablero/` | Starting point for a new report/dashboard screen. |
| `guidelines/` | Specimen cards for colours, type, spacing and brand. Small HTML files, useful as visual reference. |
| `ejemplos/` | Three finished pieces to copy from: `reporte-semanal.html` (printable one-pager), `correo-interno.html` (HTML email), `pieza-redes.html` (1080×1080 social post). |

## Non-negotiables

1. **Two brand colours only** — azul `#2C43A2`, rojo `#FF0000`. Red is the accent: one CTA per
   screen. Never a large red area, never a purple-blue gradient.
2. **Rubik for language, Segoe UI for data.** Table cells, KPI figures, lot numbers and
   references are Segoe (`--font-data`). Headings, buttons and labels are Rubik. This is a rule.
3. **FontAwesome 6, no emoji.** `styles.css` already loads it. Every emoji has an equivalent —
   see the ICONOGRAPHY section of `readme.md`.
4. **Never draw the logo.** Use the PNGs in `assets/`. If they are unavailable, set the words
   "Plast Innova" in Rubik Bold and say so — do not reconstruct or approximate the mark.
5. **Never invent product photography.** Leave a labelled dashed placeholder saying what image
   belongs there.
6. **Shadows are blue-tinted** (`rgba(17,27,67,…)`), never black. Cards: white, 1px `#DFE3EA`,
   16px radius. No coloured left borders.
7. **Motion is fades and small moves.** No bounce, no spring, no scale-up entrances.
8. **Copy is Spanish (Colombia)**, tú to the customer, nosotros for the company, specs stated
   plainly, Colombian number formatting (`$189.900`, `4,8`).

## Working with the components

Load the compiled bundle and read components off the namespace:

```html
<link rel="stylesheet" href="styles.css">
<script src="_ds_bundle.js"></script>
<script type="text/babel">
  const { Button, KpiCard, DataTable, ChartPanel, CHART_COLORS } = window.PlastInnovaDesignSystem_ff345a;
</script>
```

Do not `<script src>` a `.jsx` file directly — its `export` is unreachable from inline script.
For a report screen, start from `templates/tablero/` rather than assembling from scratch.
Charts are Chart.js; colour every dataset from `CHART_COLORS` so series order matches across
panels.
