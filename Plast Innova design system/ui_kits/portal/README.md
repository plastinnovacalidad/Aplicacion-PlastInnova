# UI kit — Portal de Calidad y Control

Recreation of the internal Plast Innova quality system in `app-circuitos-smd-v2/Public/`,
rebuilt on this design system's primitives (`window.PlastInnovaDesignSystem_ff345a`).

Open `index.html`. Flow: **Login → Portal de módulos → Tablero de Garantías**.

| File | Surface | Source screen |
|---|---|---|
| `index.html` | Shell + routing + login gate | `Public/index.html` |
| `Chrome.jsx` | `AppHeader` (brand gradient bar, user chip, logout), `Login` overlay | `Public/css/comun.css` `.header`, `.login-overlay` |
| `Portal.jsx` | Five permission-gated sections of module tiles | `Public/index.html` `.portal-sections` |
| `Dashboard.jsx` | KPI row, bar + donut charts, filter bar, inspection table | `Public/dashboard_garantias.html` |

## What changed from production, and why

The brief was *"se siente visualmente muy sencilla y poco entendible"*, so this is a
recreation of the **structure** with the brand's foundations applied — not a pixel copy:

1. **Blue is now `#2C43A2`** (your call), replacing the app's `#1B4FC4 → #1642AA`.
2. **Emoji are gone.** `⚡📊🏆💬📐🔧` became FontAwesome glyphs (`bolt`, `chart-column`,
   `award`, `whatsapp`, `ruler-combined`, `plug`) so they render identically on every machine
   and inherit colour.
3. **Density opened up.** Tiles go 130px → 150px, section gaps 18px → 48px, header padding
   20/40 → 20/40 with a real brand divider. The portal now breathes instead of packing.
4. **Sections explain themselves.** Each section header gained an icon chip, a one-line
   description and a module count — previously it was a bare uppercase label on a rule, which
   is the main reason the portal read as "poco entendible".
5. **Type is split by role.** Rubik on headings and chrome; Segoe UI (`--font-data`) on every
   table cell, KPI figure and lot number, matching the app's existing data font.
6. **Purple/orange tile gradients kept** where they carry meaning (garantías = red, ISO = green,
   WhatsApp = its own brand green) but re-based on the brand palette; the `#667eea → #764ba2`
   purple on the SMD tile was replaced with the brand blue gradient.

## Honest gaps

Charts are static CSS stand-ins (bars + conic-gradient donut) so the card renders without a
network dependency; **production should use Chart.js**, already in `dashboard_garantias.html` —
see `ChartPanel.prompt.md` and `CHART_COLORS`. All figures, references, lot numbers and
inspector names are plausible placeholders, not real data. Only the portal and the warranty
dashboard are built; ISO 2859, metrología, calidad general, valores y cableado, cargar
garantías, bot de WhatsApp and gestión/permisos are **not yet recreated**.
