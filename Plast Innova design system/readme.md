# Plast Innova — Design System

**Plast Innova®** is a Colombian retailer and installer of **lámparas LED, lujos y accesorios**
for vehicles — the tagline sits right in the logo: *LÁMPARAS LED · LUJOS · ACCESORIOS*.
The business sells at retail and wholesale, ships nationally from Bogotá, and installs in its
own shop. Everything here is derived from the brand package the client supplied; nothing about
the visual identity is invented.

## Sources used

| Source | What it gave us |
|---|---|
| `publicidad/MANUAL DE MARCA PLAST INNOVA_2.pdf` (attached local folder) | Corporate typeface (**Rubik**, Light→Bold + italics), spot-colour references **PANTONE 293 C** (azul) and **PANTONE 485 C** / **3517 C** (rojo), full Illustrator swatch library |
| `publicidad/PNG TRANSPARENCIAS/*.png` | All logo artwork — horizontal, vertical, isotipo, plus white (`_ng`) and alternative (`_PS_ALTERNATIVO`) versions. Copied into `assets/`. |
| `publicidad/LOGO PLAST INNOVA RGB.pdf` / `CMYK.pdf` | Vector master logos (outlined, no live text). Copied into `sources/`. |
| `publicidad/INTRO PI BLANCO HORIZONTAL.mp4` | Animated logo intro — not imported (video). |
| `app-circuitos-smd-v2/` (attached local folder) | **The real product.** Internal quality system: `Public/index.html` (portal + login), `Public/dashboard_garantias.html` (Chart.js + Bootstrap 5 dashboard), `css/comun.css` (shared header/login/tabs), plus `iso2859`, `metrologia`, `calidad`, `valores_cableado`, `whatsapp_bot`, `gestion` screens and a `data/` + `routes/` Node backend. `Public/img/logo.png` copied to `assets/app-logo.png`. |

**Caveat:** the brand manual PDF is larger than the file-transfer limit, so its *page layout*
could not be rasterised or read as prose. Its embedded metadata **was** read in full, which is
where the typeface and Pantone references come from. Exact hex values were sampled pixel-by-pixel
from the supplied logo PNGs. If the manual specifies clear-space ratios, minimum sizes or
secondary palettes beyond this, send a compressed copy and they'll be folded in.

---

## Visual foundations

**Colour.** Two brand colours, nothing else. **Azul Plast Innova `#2C43A2`** (sampled from the
isotipo; PANTONE 293 C reference) carries structure — *note:* the internal app ships
`#1B4FC4 → #1642AA` in `Public/css/comun.css`; the client confirmed the isotipo value wins, so
`#2C43A2` is canonical and the app's header gradient should migrate to `--pi-gradient-blue`. It — headers, primary buttons, links, the dark
footer. **Rojo Plast Innova `#FF0000`** with its shadow tone `#DF0000` (PANTONE 485 C reference)
is the accent: one CTA per screen, the active tab underline, discount badges, eyebrow labels.
Red is never a background for large areas and never sits under the colour logo. Neutrals are
cool-leaning greys (`#F7F8FA` → `#12151A`) so they sit under the blue without going muddy.
Semantic colours (`#009245` success, `#F7931E` warning, `#0071BC` info) are taken from the brand
document's own swatch library rather than invented.

**Contrast floor.** `--text-muted` (`#6E7787`) is only safe for 14px and up on white. For 12px
or smaller, or on a tinted band like `#F7F8FA`, step down to `--pi-neutral-600` (`#4E5666`,
≈7:1) — that is why table header bands use it. Printed documents never go below 12px.

**Gradients.** Only three, all lifted from the logo artwork: the isotipo's blue
(`#1046B1 → #2C43A2`), the wordmark's red (`#FF0000 → #DF0000`), and a blue→red "LED" sweep for
rare full-bleed moments. No purple-blue SaaS gradients, no mesh.

**Type.** Rubik on headings, buttons, labels and UI chrome — a slightly rounded geometric sans
that echoes the logo's rounded square. **Segoe UI (`--font-data`) on tables, KPI figures, lot
numbers and logs**, matching the stack the app already uses: it has tighter figure widths and
holds up better at 13–14px in a dense grid than Rubik does. The split is a rule, not a
preference — if it is data, it is Segoe; if it is language, it is Rubik. Display and H1 are Bold with tight tracking (`-0.03em` / `-0.015em`); H3 is SemiBold;
body is Regular 16/1.45. Eyebrows and button labels are uppercase with wide tracking
(`0.04em` – `0.12em`), matching the all-caps *LÁMPARAS LED · LUJOS · ACCESORIOS* line in the logo.
Italics exist in the family but are reserved for pull quotes.

**Spacing & layout.** 4px base scale; 8/16/24 do most of the work. Page container maxes at
1400px with 32px gutters. The header is sticky, 76px tall, on a hairline border — nothing else
is fixed. Product grids are 4-up on home, 3-up in the catalogue.

**Corners & cards.** The isotipo is a rounded square at roughly 18% of its side, and the system
follows: 10px on controls, **16px on cards**, 24px on modals, full pill on buttons and chips.
A card is white, a 1px `#DFE3EA` border, and a soft blue-tinted shadow — never a coloured
left border, never a tinted card background.

**Shadows.** All shadows are tinted with the brand blue (`rgba(17,27,67,…)`) rather than black,
which keeps them from looking grey against the palette. Five steps plus `--shadow-brand` /
`--shadow-accent` for buttons. `--glow-led` is a soft white halo, the one lighting-specific
effect — use it on a hero product shot, nowhere else.

**Motion.** Four durations (80/140/220/360ms) and one standard curve
`cubic-bezier(.2,0,0,1)`, with `--ease-out` for entrances. Fades and small translations only —
**no bounce, no spring, no scale-up entrances.** Reduced-motion zeroes every duration.

**Hover & press.** Hover darkens one step on the scale (blue-600 → blue-700), or fills with the
lightest tint on outline/ghost controls — never opacity fades. Press scales the control to
`.97`. Cards lift 2px and deepen their shadow. Focus is a 3px `rgba(44,67,162,.35)` ring, red
on error fields.

**Transparency & blur.** Only two places: the dialog scrim (`rgba(17,27,67,.45)` + 3px blur)
and white overlays on out-of-stock product images. Never on cards, never on the header.

**Imagery.** Product photography should be cool-neutral on white or dark grey, with the LED
output as the brightest thing in frame — no warm filters, no grain, no heavy vignette. Full-bleed
imagery is reserved for the hero. *No photography was supplied*, so every image in this system
is a labelled placeholder.

## Content fundamentals

Copy is **Spanish (Colombia)**, sentence case, and speaks to the customer as **tú**
("Escríbenos", "Tu carrito", "Mira las lámparas que más nos piden"). The brand speaks as
**nosotros** ("Despachamos el mismo día", "Instalamos en Bogotá"). It is plain, concrete and
commercial — a shopkeeper's voice, not a tech company's.

- **Say the thing.** "Envío gratis desde $300.000", not "Beneficios exclusivos".
- **Specs are copy.** 6000K, 12.000 lúmenes, H4, 12V–24V — the customer shops by these.
- **Promises are dated.** "Despacho hoy antes de las 3 p. m.", "Garantía de 1 año, sin letra menuda."
- **Uppercase** is for eyebrows, badges and buttons only (VER CATÁLOGO, NUEVO, -20%) — never for sentences.
- **No emoji.** The brand package contains none, and none belong in the UI.
- **Numbers** use Colombian formatting: `$189.900`, `4,8` for decimals.
- **Errors** name the fix: "Placa no válida" → tell them the format, don't apologise.

Headline register: short, benefit-first, two beats — *"Luz que rinde, lujos que duran."*

## Iconography

**FontAwesome 6.4.0** is the icon set, because it is already in production in
`app-circuitos-smd-v2/Public/dashboard_garantias.html`. It loads from cdnjs as part of the
`styles.css` closure, so consumers get icons for free. The `Icon` component renders
`fa-solid fa-<name>` — pass the slug without the `fa-` prefix.

Rules: 16px inside small controls, 20px default, 22–24px standalone, 44px inside a
`ModuleTile` panel. Solid family by default; `variant="brands"` only for third-party logos
(WhatsApp). An icon never appears without either a visible label or a Tooltip.

**Emoji are not used.** The portal currently ships emoji as module icons
(`⚡ 🔧 📊 🏆 💬 📐 🔌 ➕ 📋 🧪`); every one has a FontAwesome equivalent and the UI kit
replaces them — `bolt`, `wrench`, `chart-column`, `award`, `comment-dots`, `ruler-combined`,
`plug`, `plus`, `clipboard-list`, `flask`. Emoji render differently on every OS, cannot take
`currentColor`, and are the single biggest reason the portal reads as informal. The `·` middot
is the one typographic mark with brand meaning — it separates the logo's tagline and every
metadata line in the UI.

No brand-drawn icon set was supplied. If Plast Innova has one, send it and FontAwesome comes out.

## Logo usage

`assets/` holds every supplied lockup. Default is **`logo-horizontal.png`**. Use `*-ng.png`
(white) on the brand blue, on blue-900, or over photography. `isotipo*.png` is the PI monogram
for avatars, favicons and tight spaces. Clear space around the isotipo equals the width of its
inner stroke. Never recolour, stretch, or place the colour logo on red, on mid-grey, or on the
brand blue.

---

## Index

**Root**
- `styles.css` — the single entry point consumers link; `@import`s only.
- `PROMPT-DE-DISENO.md` — **the portable prompt.** Every rule condensed with hex values inline, in Spanish, ready to paste into any AI tool that cannot read this folder.
- `thumbnail.html` — homepage tile.
- `SKILL.md` — Agent-Skills wrapper: where things are, plus the eight non-negotiables.
- `readme.md` — this file.

**`tokens/`** — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `radius.css`, `elevation.css`, `motion.css`, `base.css`

**`assets/`** — `logo-horizontal{,-ng,-alt}.png`, `logo-vertical{,-ng,-alt}.png`, `isotipo{,-ng,-alt,-alt-ng}.png`

**`sources/`** — `logo-rgb.pdf`, `logo-cmyk.pdf` (vector masters)

**`guidelines/`** — 21 specimen cards feeding the Design System tab (Colors, Type, Spacing, Brand)

**`ejemplos/`** — three finished reference pieces (group "Ejemplos" in the Design System tab):
`reporte-semanal.html` (printable letter one-pager), `correo-interno.html` (send-ready HTML
email), `pieza-redes.html` (1080×1080 social post). These are what to copy from when starting
a new piece of the same kind.

### Components

Reachable as `window.PlastInnovaDesignSystem_ff345a.<Name>`. Each has a sibling `.d.ts` and `.prompt.md`.

- **`components/core/`** — `Button`, `IconButton`, `Icon`, `Card`, `Badge`, `Tag`
- **`components/forms/`** — `Input`, `Select`, `Checkbox`, `Radio`, `Switch`
- **`components/navigation/`** — `Tabs`, `Breadcrumb`
- **`components/feedback/`** — `Dialog`, `Toast`, `Tooltip`
- **`components/app/`** — `ModuleTile`, `KpiCard`, `DataTable`, `ChartPanel` (+ `CHART_COLORS`)

**Where the inventory came from.** The brand package is a logo + colour + type manual and
defined no components. The `app/` group is drawn directly from the real app's screens:
`ModuleTile` is the portal's `.portal-card`, `DataTable` and `KpiCard` are the warranty
dashboard's table and stat cards, `ChartPanel` is its Chart.js container. `core/`, `forms/`,
`navigation/` and `feedback/` are the standard set those screens need — `Tabs` matches the
app's own `.tab-btn`, `Dialog` its `.login-overlay` pattern. `Icon` is a deliberate addition:
a thin FontAwesome wrapper so glyphs size and colour consistently instead of being pasted as
raw `<i class="fa-...">`.

**Charting.** Chart.js, already in production in `dashboard_garantias.html`. Colour every
dataset from `CHART_COLORS` so series order matches across panels.

### Templates

- **`templates/tablero/Tablero.dc.html`** — "Tablero de reportes": brand header, KPI row,
  bar + donut charts and the inspection detail table. This is what consuming projects pick from
  the template picker to start a new report screen.

### UI kits

- **`ui_kits/portal/`** — **Portal de Calidad y Control**: login → portal de módulos →
  tablero de garantías. Click-through recreation of `app-circuitos-smd-v2/Public/`. Its
  `README.md` lists exactly what changed from production and why, plus which modules are not
  yet built.

An earlier storefront kit and `templates/tienda/` were removed once the real product turned out
to be the internal system.
