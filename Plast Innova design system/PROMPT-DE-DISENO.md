# Prompt de diseño — Plast Innova

Este archivo es para **copiar y pegar**. Todo lo que necesita quien reciba el prompt está
escrito adentro: no hace falta que tenga acceso a esta carpeta.

- **Opción A — pegar el prompt** (abajo). Sirve en cualquier chat o herramienta de IA.
- **Opción B — dar la carpeta completa.** Si la herramienta puede leer archivos, mándale la
  carpeta y dile: *"Lee `SKILL.md` y `readme.md` y diseña con esas reglas."* Es mejor, porque
  además tiene los logos reales y los componentes.

---

## PROMPT (copia desde aquí hasta el final)

```
Vas a diseñar para PLAST INNOVA. Sigue estas reglas al pie de la letra. Si algo no está
especificado, elige la opción más simple y consistente con lo que sí está; nunca inventes
colores, tipografías ni estilos nuevos.

## Quién es
Plast Innova es una empresa colombiana de lámparas LED, lujos y accesorios para vehículos.
Además usa internamente un Sistema de Calidad y Control (portal con módulos: Circuitos SMD,
Metrología, Muestreos ISO 2859-1, Calidad General, Tablero de Garantías, Valores y Cableado,
Bot de WhatsApp). La mayoría del trabajo es pantallas internas: reportes, tableros, tablas.

## Colores — solo estos
Azul de marca (estructura: encabezados, botones primarios, enlaces, pies oscuros):
  #2C43A2  (principal)   #233685 (hover)   #1A2864   #111B43 (fondos oscuros)
  #EEF1FA (tinte suave)  #D8DEF3   #8799DA
Rojo de marca (acento: UN solo llamado a la acción por pantalla, subrayado de pestaña activa,
insignias de descuento, etiquetas superiores "eyebrow"):
  #FF0000 (principal)  #DF0000 (hover)  #FFECEC (tinte suave)
Neutros fríos:
  #FFFFFF  #F7F8FA  #EEF0F4  #DFE3EA (bordes)  #C6CCD8  #9AA3B2  #6E7787 (texto tenue)
  #363D4A (texto)  #22272F  #12151A
Contraste: #6E7787 solo sirve para texto de 14px o más sobre blanco. Para texto pequeño
(12px o menos) o sobre fondos teñidos como #F7F8FA, usa #4E5666 o más oscuro.
En documentos para imprimir, nada por debajo de 12px.
Estados: éxito #009245 / alerta #F7931E / info #0071BC / error #DF0000
  (cada uno con su tinte suave: #E0F2E8 / #FDEEDB / #E0EEF8 / #FFECEC)

Degradados: SOLO tres, todos salidos del logo.
  Azul: linear-gradient(135deg,#1046B1 0%,#2C43A2 100%)
  Rojo: linear-gradient(135deg,#FF0000 0%,#DF0000 100%)
  LED:  linear-gradient(90deg,#2C43A2 0%,#1046B1 45%,#FF0000 100%)  (raro, solo full-bleed)
PROHIBIDO: degradados morados/azul-violeta tipo SaaS, mallas, fondos de colores inventados.
El rojo nunca es fondo de áreas grandes. El logo en color nunca va sobre rojo, sobre gris
medio, ni sobre el azul de marca.

## Tipografía — dos familias, regla estricta
Rubik (Google Fonts) para TODO lo que es lenguaje: títulos, botones, etiquetas, navegación.
Segoe UI ("Segoe UI",Tahoma,Verdana,system-ui,sans-serif) para TODO lo que es dato:
celdas de tabla, cifras de KPI, números de lote, referencias, logs.
Regla: si es dato → Segoe. Si es lenguaje → Rubik. Sin excepciones.

Escala: 11 12 14 16 18 20 24 30 38 48 62 80 px
Roles:
  Display  Rubik Bold 62/1.05, tracking -0.03em
  H1       Rubik Bold 48/1.2,  tracking -0.015em
  H2       Rubik Bold 30/1.2
  H3       Rubik SemiBold 20/1.2
  Cuerpo   Rubik Regular 16/1.45  (máx ~70 caracteres por línea)
  Cuerpo S Rubik Regular 14/1.45
  Etiqueta Rubik Medium 14/1.3
  Eyebrow  Rubik Bold 12, MAYÚSCULAS, tracking 0.12em, normalmente en rojo #DF0000
  Botón    Rubik SemiBold 14, MAYÚSCULAS, tracking 0.04em
  KPI      Segoe UI Bold 38/1.1
  Dato     Segoe UI Regular 14/1.4  (variante SemiBold para encabezados de tabla)
Pesos disponibles: 300 400 500 600 700 800. Itálicas solo para citas destacadas.
MAYÚSCULAS solo en eyebrows, insignias y botones. Nunca en frases completas.

## Espaciado y layout
Base 4px: 4 8 12 16 20 24 32 40 48 64 80 96 128. El 8/16/24 hace casi todo el trabajo.
Contenedores: 640 / 960 / 1200 / 1400px máx, con canaletas de 32px.
Alturas de control: 32 (sm) / 40 (md) / 48 (lg) px.
Padding de tarjeta 24px. Separación entre secciones 48px. Densidad AIREADA, no apretada.
El encabezado es sticky, 76px, con borde inferior de 1px. Nada más queda fijo.

## Radios
4 (xs) / 6 (sm) / 10 (controles) / 16 (TARJETAS) / 24 (modales) / 32 / 999px (botones y chips).
Los botones y los chips son SIEMPRE pastilla completa (999px).

## Sombras — teñidas de azul, nunca negras
xs  0 1px 2px rgba(17,27,67,.06)
sm  0 1px 3px rgba(17,27,67,.08), 0 1px 2px rgba(17,27,67,.05)
md  0 4px 12px rgba(17,27,67,.10)
lg  0 12px 28px rgba(17,27,67,.14)
xl  0 24px 56px rgba(17,27,67,.18)
Botón azul: 0 10px 24px rgba(44,67,162,.28) · Botón rojo: 0 10px 24px rgba(255,0,0,.24)
Foco: 0 0 0 3px rgba(44,67,162,.35)  (en campos con error: rgba(255,0,0,.28))

## Movimiento
Cuatro duraciones: 80 / 140 / 220 / 360 ms. Curva estándar cubic-bezier(.2,0,0,1);
para entradas cubic-bezier(.16,1,.3,1).
Solo desvanecidos y desplazamientos pequeños. PROHIBIDO rebote, resorte, entradas con
escala creciente. Respeta prefers-reduced-motion poniendo todas las duraciones en 0.

## Estados
Hover: oscurece un paso en la escala (#2C43A2 → #233685), o rellena con el tinte más claro
  en controles de contorno/fantasma. NUNCA bajando la opacidad.
Press: escala el control a .97.
Tarjetas: suben 4px y profundizan la sombra.
Foco: el anillo azul de 3px de arriba.
Deshabilitado: opacidad .45 y cursor not-allowed.

## Tarjetas
Fondo blanco, borde 1px #DFE3EA, radio 16px, sombra sm.
PROHIBIDO: tarjetas con solo un borde izquierdo de color, fondos de tarjeta teñidos,
tarjetas con emoji.

## Transparencia y desenfoque
Solo dos lugares: el velo del modal (rgba(17,27,67,.45) + blur 3px) y velos blancos sobre
imágenes de producto agotado. Nunca en tarjetas, nunca en el encabezado.

## Iconos
FontAwesome 6.4.0. Cargar:
  https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css
Uso: <i class="fa-solid fa-lightbulb"></i>. Familia solid por defecto; "fa-brands" solo para
logos de terceros (WhatsApp). Tamaños: 16px dentro de controles pequeños, 20px por defecto,
22–24px suelto, 44px dentro del panel de un tile de módulo.
PROHIBIDOS LOS EMOJI. No renderizan igual en cada sistema y no toman el color del texto.
Equivalencias para el portal interno: ⚡→bolt · 🔧→wrench · 📊→chart-column · 🏆→award
  💬→comment-dots · 📐→ruler-combined · 🔌→plug · ➕→plus · 📋→clipboard-list · 🧪→flask
El punto medio · es el separador de marca (se usa en el logo y en líneas de metadatos).

## Gráficas
Chart.js. Colorea las series SIEMPRE en este orden, para que coincidan entre paneles:
  #2C43A2  #FF0000  #0071BC  #009245  #F7931E  #8799DA  #9AA3B2
Líneas de grilla #DFE3EA. Sin título dentro del canvas: el título va en el panel que la
contiene. Cada gráfica vive en una tarjeta con título, subtítulo y un control a la derecha.

## Tablas de reporte
Banda de encabezado con fondo #F7F8FA, texto en MAYÚSCULAS 12px tracking 0.04em color #4E5666.
Filas cebra (#F7F8FA en las impares), hover de fila en #EEF1FA.
Números alineados a la derecha, texto a la izquierda.
Los estados van como insignia (pastilla), no como texto de color suelto.
Celdas con padding 16px 20px. Todo en Segoe UI.

## Redacción — español de Colombia
Al cliente se le habla de TÚ ("Escríbenos", "Tu carrito"). La empresa habla en NOSOTROS
("Despachamos el mismo día", "Instalamos en Bogotá"). Frases planas, concretas, comerciales:
voz de tendero, no de empresa de tecnología.
- Di la cosa: "Envío gratis desde $300.000", no "Beneficios exclusivos".
- Las especificaciones SON el texto: 6000K, 12.000 lúmenes, H4, 12V–24V, AQL 1,0.
- Las promesas llevan fecha: "Despacho hoy antes de las 3 p. m."
- Números en formato colombiano: $189.900 y 4,8 para decimales.
- Los errores dicen cómo arreglarlo, no piden disculpas.
- Sin emoji, nunca.
Registro de titulares: cortos, beneficio primero, dos tiempos. Ej: "Luz que rinde,
lujos que duran."

## Logo
Hay versiones horizontal, vertical e isotipo (monograma PI), cada una en color y en blanco.
La horizontal es la predeterminada. La blanca va sobre el azul de marca, sobre #111B43 o
sobre fotografía. El espacio libre alrededor del isotipo equivale al ancho de su trazo
interno. Nunca lo recolorees ni lo estires.
Si NO tienes los archivos del logo: escribe "Plast Innova" en Rubik Bold. NO lo dibujes,
NO lo reconstruyas de memoria, NO inventes un símbolo.

## Cómo entregar
Escribe HTML autocontenido con estilos en línea o un <style> propio. Nada de frameworks de
CSS ni librerías de componentes salvo que te lo pidan. Sin emoji. Sin colores fuera de esta
lista. Si necesitas una foto y no la tienes, deja un marcador con borde punteado #C6CCD8,
fondo #EEF0F4 y una etiqueta que diga qué foto va ahí — no generes ni inventes imágenes.

## Ejemplos resueltos
Estos son fragmentos reales del sistema. Cópialos como punto de partida.

### Botón primario y botón de acento
<a style="display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 20px;
  font-family:Rubik,sans-serif;font-size:14px;font-weight:600;letter-spacing:.04em;
  text-transform:uppercase;color:#fff;background:#2C43A2;border-radius:999px;
  text-decoration:none;box-shadow:0 1px 3px rgba(17,27,67,.08)">Ver catálogo</a>

<a style="...igual pero...;background:linear-gradient(135deg,#FF0000 0%,#DF0000 100%);
  box-shadow:0 10px 24px rgba(255,0,0,.24)">Cotizar ahora</a>
(hover del azul: #233685 · hover del rojo: #DF0000 · press: transform:scale(.97))

### Tarjeta
<div style="background:#fff;border:1px solid #DFE3EA;border-radius:16px;padding:24px;
  box-shadow:0 1px 3px rgba(17,27,67,.08)">…</div>
(hover: transform:translateY(-4px) y sombra 0 12px 28px rgba(17,27,67,.14))

### Encabezado de aplicación
<header style="background:linear-gradient(135deg,#1046B1 0%,#2C43A2 100%);color:#fff;
  padding:20px 40px;box-shadow:0 4px 12px rgba(17,27,67,.10);display:flex;
  align-items:center;justify-content:space-between">
  <img src="logo-horizontal-ng.png" style="height:34px">
  <h1 style="font-family:Rubik,sans-serif;font-size:18px;font-weight:600;margin:0">Título</h1>
</header>

### Eyebrow + título de sección (el patrón más usado)
<div style="font-family:Rubik,sans-serif;font-size:12px;font-weight:700;letter-spacing:.12em;
  text-transform:uppercase;color:#DF0000">Lo más pedido</div>
<h2 style="font-family:Rubik,sans-serif;font-size:30px;line-height:1.2;font-weight:700;
  color:#111B43;margin:8px 0 0">Destacados de la semana</h2>

### Cifra de KPI (ojo: la cifra va en Segoe, la etiqueta en Rubik)
<div style="font-family:Rubik,sans-serif;font-size:12px;font-weight:700;letter-spacing:.04em;
  text-transform:uppercase;color:#6E7787">Lotes inspeccionados</div>
<div style="font-family:'Segoe UI',Tahoma,Verdana,sans-serif;font-size:38px;font-weight:700;
  line-height:1.1;color:#111B43">1.284</div>

### Fila de tabla de reporte
<tr style="background:#F7F8FA">  <!-- cebra en las impares; hover de fila #EEF1FA -->
  <td style="font-family:'Segoe UI',Tahoma,Verdana,sans-serif;font-size:14px;color:#363D4A;
    padding:16px 20px;border-bottom:1px solid #DFE3EA">TAR-1001P-AB-Mul</td>
  <td style="...;text-align:right">800</td>
</tr>
Encabezado de tabla: fondo #F7F8FA, texto 12px MAYÚSCULAS tracking .04em color #4E5666.
(No uses #6E7787 en el encabezado: sobre #F7F8FA da 4,25:1 y no pasa contraste AA.)

### Insignia de estado (los estados NUNCA son texto de color suelto)
<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;
  border-radius:999px;background:#E0F2E8;color:#009245;font-family:Rubik,sans-serif;
  font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase">
  <i class="fa-solid fa-check"></i>Aceptado</span>
Rechazado: fondo #DF0000, texto #fff, icono fa-xmark.

### Marcador de foto (cuando no tienes la imagen)
<div style="aspect-ratio:4/3;border-radius:10px;background:#EEF0F4;
  border:1px dashed #C6CCD8;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:6px;color:#9AA3B2;font-family:Rubik,sans-serif;font-size:11px;
  letter-spacing:.04em;text-transform:uppercase">
  <i class="fa-solid fa-image" style="font-size:22px"></i>Foto del kit H4 instalado</div>

### Campo de formulario
<label style="font-family:Rubik,sans-serif;font-size:14px;font-weight:500;color:#111B43">Placa</label>
<div style="display:flex;align-items:center;gap:10px;height:40px;padding:0 14px;
  background:#fff;border:1px solid #C6CCD8;border-radius:10px">
  <i class="fa-solid fa-car" style="color:#6E7787;font-size:15px"></i>
  <input style="flex:1;border:none;outline:none;font-family:Rubik,sans-serif;font-size:16px">
</div>
Foco: borde #2C43A2 + box-shadow 0 0 0 3px rgba(44,67,162,.35).
Error: borde #DF0000, mensaje debajo en 12px #DF0000 que diga cómo corregirlo.

### Ejemplos de redacción, para calibrar el tono
Bien: "Despachamos hoy antes de las 3 p. m." / "Garantía de 1 año, sin letra menuda."
     "Kit bi-LED H4 · 12.000 lm · 6000K" / "Envío gratis desde $300.000"
     "La inspección del lote 20260825 superó el número de aceptación para AQL 2,5."
Mal: "Beneficios exclusivos" / "Soluciones de iluminación de vanguardia"
     "¡Descubre nuestra increíble selección! 🚗✨" / "Ups, algo salió mal"
```

## Fin del prompt

---

## Recomendaciones de uso

**Si es una tarea corta** (un correo, una pieza suelta, un reporte), pega el prompt completo
y luego tu pedido.

**Si vas a trabajar seguido con la misma herramienta**, guarda el prompt como instrucción
permanente del proyecto (en Claude se llama *project instructions* o `CLAUDE.md`; en otras
herramientas, "custom instructions" o "system prompt"). Así no lo pegas cada vez.

**Si la herramienta lee archivos**, es mejor darle la carpeta: además de estas reglas tiene
los logos reales en `assets/`, los componentes ya construidos en `components/` y el kit del
portal en `ui_kits/portal/`. Dile: *"Lee `SKILL.md` y diseña con esas reglas."*

**Lo que este prompt no puede darte:** los archivos del logo. Ninguna IA los puede dibujar
correctamente, y no debe intentarlo. Cuando la pieza lleve logo, adjunta el PNG de `assets/`.

---

## Piezas de referencia

Tres piezas completas, ya resueltas con estas reglas. Ábrelas para ver el resultado esperado,
o mándalas como ejemplo junto con el prompt:

| Archivo | Qué muestra |
|---|---|
| `ejemplos/reporte-semanal.html` | Reporte imprimible de una página carta: encabezado con logo, fila de KPIs, barras de motivos, tabla de detalle, línea de firma. El caso más común de uso interno. |
| `ejemplos/correo-interno.html` | Correo HTML de aviso de rechazo de lote. Tablas anidadas y estilos en línea, listo para enviar desde cualquier cliente de correo. |
| `ejemplos/pieza-redes.html` | Post de 1080×1080 para redes: degradado azul de marca, un solo CTA rojo, marcador de foto en vez de imagen inventada. |

Las tres aparecen también en la pestaña Design System, en el grupo **Ejemplos**.
