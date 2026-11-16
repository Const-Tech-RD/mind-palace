# Mind Palace — Guía de estilo visual

Para: Claudio · Versión 1 · 2026-11-15

**Mind Palace** es un cliente de chat de escritorio (Electron). Cada chat cae en una de cuatro salas: **Coding room**, **Music studio**, **Art workshop** y **Mail room**. Las salas son isométricas y se llenan de muebles a medida que el usuario mantiene rachas y cumple metas. Las pantallas son: lista de chats agrupada por sala, vista de chat, vista de palacio/sala y panel de proyectos/recordatorios.

Esta guía sirve para aplicar el estilo a tus mockups. Cada valor lleva una etiqueta de origen:

| Etiqueta | Significa |
|---|---|
| **[DECIDIDO]** | Viene del brief que eligió Natanael o de las reglas de la app. No se cambia. |
| **[MEDIDO]** | Extraído por k-means de las ilustraciones ya hechas. Describe el arte existente. |
| **[PROPUESTA]** | Lo inventé yo para rellenar un hueco. Está abierto: cámbialo si no te convence. |

---

## 1. Principios

1. **Un taller de madera, no un dashboard.** Nogal oscuro, latón, pergamino. Todo parece tallado o apoyado sobre una mesa. [DECIDIDO]
2. **La luz es de la sala.** La base es siempre nogal + pergamino + oro; el único color que cambia de una sala a otra es su acento, igual que cada ilustración está iluminada por una sola luz de color. [DECIDIDO]
3. **Dibujado a mano, nunca pixel art.** Contorno oscuro limpio, color plano con sombreado suave, textura de papel, tono de cuento. El pixel art fue descartado explícitamente. [DECIDIDO]
4. **El pergamino es para leer.** El contenido importante va en tinta oscura sobre pergamino; el nogal es el marco que lo rodea. [DECIDIDO en el brief; la regla de uso es PROPUESTA]
5. **El oro es escaso.** Una sola acción principal dorada por vista. [PROPUESTA]

---

## 2. Color

### 2.1 Tokens de UI

| Token | Hex | Uso | Origen |
|---|---|---|---|
| `--mp-bg` | `#2A1D16` | Fondo de la app (nogal oscuro) | DECIDIDO |
| `--mp-surface` | `#3B2A20` | Paneles, sidebar, burbuja del asistente | DECIDIDO |
| `--mp-parchment` | `#F3E6C8` | Tarjetas de pergamino; texto principal sobre oscuro | DECIDIDO |
| `--mp-ink` | `#1E1612` | Texto sobre pergamino y sobre oro; huecos hundidos (inputs, pistas de barra) | DECIDIDO |
| `--mp-gold` | `#E8B84A` | Acento primario: botón principal, foco, racha | DECIDIDO |
| `--mp-surface-raised` | `#4A3528` | Hover / elemento seleccionado sobre panel | PROPUESTA |
| `--mp-parchment-shade` | `#EBDCBE` | Hover y bandas dentro de una tarjeta de pergamino | PROPUESTA (tono medido en `room_mailroom`) |
| `--mp-brass` | `#B58956` | Bordes finos de latón | PROPUESTA (tono medido en el latón del robot) |
| `--mp-brass-light` | `#DDBF7C` | Brillo del latón, borde en hover | PROPUESTA (medido en el robot) |
| `--mp-text-muted` | `#CCAC82` | Texto secundario sobre oscuro | PROPUESTA (medido en `room_library`) |
| `--mp-ink-muted` | `#623D2A` | Texto secundario sobre pergamino | PROPUESTA (medido en `room_atrium`) |
| `--mp-gold-deep` | `#7A5310` | Enlaces/acentos y bordes de input **sobre pergamino** | PROPUESTA |
| `--mp-danger` / `--mp-danger-deep` | `#F08A72` / `#A33A22` | Error sobre oscuro / sobre pergamino | PROPUESTA |
| `--mp-success` / `--mp-success-deep` | `#9CC27A` / `#3F6B2A` | Éxito sobre oscuro / sobre pergamino | PROPUESTA |

El brief solo fija los cinco primeros. No define colores de estado, texto secundario ni hover.

### 2.2 Acentos de sala

Los cuatro hex están fijados por las reglas de la app (`catalog/rooms/*.json`). [DECIDIDO]
Las variantes `-deep` son mías, para poder usar el acento sobre pergamino. [PROPUESTA]

| Sala | Token | Acento | Variante para pergamino |
|---|---|---|---|
| Coding room | `--mp-room-coding` | `#5EEAD4` | `--mp-room-coding-deep` `#0F6B63` |
| Music studio | `--mp-room-music` | `#F0ABFC` | `--mp-room-music-deep` `#8E2A9C` |
| Art workshop | `--mp-room-art` | `#FB923C` | `--mp-room-art-deep` `#9A4209` |
| Mail room | `--mp-room-mail` | `#A9ADC6` | `--mp-room-mail-deep` `#50556F` |

Reglas de uso [PROPUESTA]:

- El acento **identifica** la sala: punto del badge, barra lateral del chat seleccionado, relleno de la barra de metas, halo de luz alrededor de la ilustración. Nunca es fondo de un panel entero.
- El oro es de la app (acciones, foco, racha); el acento es de la sala. No se intercambian.
- Sobre nogal o panel, los cuatro acentos sirven tal cual, también como texto.
- Sobre pergamino, **ningún acento sirve** como texto ni como relleno fino: usa la variante `-deep`.
- Como relleno (chip lleno), el texto encima va en `--mp-ink`.
- **Ojo:** `--mp-room-art` (`#FB923C`) y `--mp-gold` (`#E8B84A`) se parecen mucho (contraste entre ellos 1.23:1). En la sala de arte no pongas un control dorado pegado a uno naranja; distingue por forma o por texto.

### 2.3 Contraste (WCAG 2.x, calculado)

AA exige 4.5:1 para texto normal y 3:1 para texto grande y bordes de controles.

| Primer plano | Fondo | Ratio | Resultado |
|---|---|---|---|
| parchment `#F3E6C8` | bg `#2A1D16` | 13.19 | AA |
| parchment | surface `#3B2A20` | 11.03 | AA |
| parchment | surface-raised `#4A3528` | 9.26 | AA |
| ink `#1E1612` | parchment | 14.39 | AA |
| ink | parchment-shade `#EBDCBE` | 13.16 | AA |
| ink | gold `#E8B84A` | 9.66 | AA |
| gold | bg | 8.86 | AA |
| gold | surface | 7.40 | AA |
| **gold** | **parchment** | **1.49** | **FALLA** |
| gold-deep `#7A5310` | parchment | 5.52 | AA |
| text-muted `#CCAC82` | bg / surface / raised | 7.61 / 6.37 / 5.35 | AA |
| ink-muted `#623D2A` | parchment | 7.64 | AA |
| brass `#B58956` | bg | 5.19 | AA |
| brass | surface | 4.34 | Solo borde o texto grande |
| **brass** | **parchment** | **2.54** | **FALLA** (borde decorativo sí; borde de input no) |
| danger / success | surface | 5.58 / 6.77 | AA |
| danger-deep / success-deep | parchment | 5.33 / 5.07 | AA |

Acentos de sala:

| Acento | sobre bg | sobre surface | sobre parchment | ink encima | `-deep` sobre parchment |
|---|---|---|---|---|---|
| coding `#5EEAD4` | 11.04 | 9.23 | **1.19 FALLA** | 12.04 | 5.13 |
| music `#F0ABFC` | 9.28 | 7.76 | **1.42 FALLA** | 10.13 | 5.73 |
| art `#FB923C` | 7.22 | 6.03 | **1.83 FALLA** | 7.87 | 5.37 |
| mail `#A9ADC6` | 7.37 | 6.16 | **1.79 FALLA** | 8.04 | 5.91 |

Resumen de fallos: **oro sobre pergamino, latón sobre pergamino y los cuatro acentos sobre pergamino.** Todo lo demás pasa AA.

### 2.4 Paleta medida de las ilustraciones

Método: k-means (k = 8) sobre cada JPEG reducido a 160×90. Son promedios de zona, no muestras de tinta exactas; úsalos para que arte nuevo caiga en la misma gama. [MEDIDO]

| Ilustración | Sombra / fondo | Tonos medios | Luz de la sala |
|---|---|---|---|
| `room_palace_map` | `#3A2F2F` `#5B3526` | `#934E2A` `#CE7F3B` `#3F5D5A` `#519088` | `#EFC975` `#7DC9BF` |
| `room_atrium` | `#191212` `#2A1C19` `#392720` | `#623D2A` `#835435` `#BA7F45` | `#E0A95C` `#F8D077` |
| `room_natatech` | `#1D1D1E` `#292825` `#2A3C3B` | `#2A5959` `#346F6D` `#4B8F89` | `#5CB9AF` `#8DDCD4` |
| `room_medina` | `#131114` `#292624` `#433933` | `#40271E` `#5C3621` `#86441E` | `#B45821` `#E4812C` |
| `room_library` | `#171519` `#211614` `#2C1D19` | `#3A241E` `#4F2D21` `#6A3E2B` | `#945B38` `#CCAC82` |
| `room_mailroom` | `#171314` `#1F1818` `#2D201F` | `#472C25` `#68402F` `#8F6146` | `#BC9169` `#EBDCBE` |
| `room_mcaffi` | `#1F1C23` `#25141B` `#311C23` | `#412629` `#56303E` `#834B59` | `#C77970` |
| `room_workshop` | `#1F2025` `#25262C` `#1E141A` | `#342322` `#4A312B` `#644031` `#87553D` | `#BA6D3D` |

Otras medidas útiles:

- **Contorno de las salas:** casi negro cálido, mediana del 2 % más oscuro ≈ `#150E0F` (rango `#0A0C0C`–`#190B0C`). Nunca negro puro.
- **Personajes:** contorno marrón oscuro `#331C19`–`#41211C`; pelo de Nato `#3C231E`; piel `#D38E66` (sombra `#B26C51`); camiseta teal `#478D8E`; madera del robot `#976342` (sombra `#734935`); latón `#B58956` (brillo `#DDBF7C`); luz del pecho `#57D9C4`.
- La sombra de casi todas las salas cae en `#1F1818`–`#2C1D19`, es decir, al lado de `--mp-bg`. Por eso las ilustraciones se funden bien con el fondo de la app sin marco.

### 2.5 Arte existente frente a acentos de sala (hay que resolverlo)

Los acentos de las reglas **no coinciden** con la luz de las ilustraciones que hay hoy. La correspondencia entre archivos y salas es deducción mía por el nombre, no está confirmada:

| Sala de la app | Acento | Ilustración más parecida | Luz medida | ¿Coincide? |
|---|---|---|---|---|
| Coding room | `#5EEAD4` | `room_natatech` | teal `#5CB9AF`–`#8DDCD4` | Sí |
| Music studio | `#F0ABFC` (rosa-lila) | `room_medina` (estudio con instrumentos) | naranja `#E4812C` | **No** |
| Art workshop | `#FB923C` (naranja) | `room_workshop` (taller de herramientas, no de arte) | fragua `#BA6D3D` | Solo en el tono |
| Mail room | `#A9ADC6` (gris lavanda frío) | `room_mailroom` | crema cálido `#EBDCBE` | **No** |

Mientras no se decida, en los mockups el acento manda en la UI (badge, barras) y la ilustración se muestra tal cual. Ten presente que el naranja de la sala de música en el arte es hoy el color de *otra* sala en la UI.

---

## 3. Tipografía

El brief solo dice "serif redondeada para títulos, sans limpia para cuerpo" [DECIDIDO]. Nunca se eligieron fuentes concretas. **Todo lo que sigue es PROPUESTA.**

| Rol | Fuente propuesta | Licencia | Por qué |
|---|---|---|---|
| Títulos | **Fraunces** (variable; eje `SOFT` a 100, `WONK` a 0) | OFL, Google Fonts | Serif con terminales redondeadas, aire de libro ilustrado |
| Cuerpo y UI | **Nunito Sans** | OFL, Google Fonts | Sans limpia y cálida, legible a 13–15 px |
| Código | **JetBrains Mono** | OFL | El chat muestra código; el brief no lo contempla |

Alternativas si no encajan: Young Serif (títulos), Figtree o Inter (cuerpo).

| Rol | Fuente | Tamaño / interlínea | Peso |
|---|---|---|---|
| Título de vista (nombre de sala) | Fraunces | 28 / 34 px | 600 |
| Título de sección o tarjeta | Fraunces | 20 / 26 px | 600 |
| Subtítulo, título de chat | Fraunces | 16 / 22 px | 600 |
| Cuerpo (mensajes) | Nunito Sans | 15 / 24 px | 400 |
| UI (botones, lista, inputs) | Nunito Sans | 14 / 20 px | 400; 600 en botones y elemento activo |
| Auxiliar (hora, contadores) | Nunito Sans | 12 / 16 px | 400 |
| Etiqueta (cabecera de grupo, badge) | Nunito Sans | 11 / 16 px, mayúsculas, tracking 0.06em | 700 |
| Código | JetBrains Mono | 13 / 20 px | 400 |

Fraunces solo en títulos; nunca en botones, inputs ni texto corrido.

---

## 4. Forma y profundidad

| Aspecto | Valor | Origen |
|---|---|---|
| Radio estándar | `12px` (tarjetas, paneles, burbujas, botones, inputs) | DECIDIDO |
| Radio pequeño | `6px` (bloques de código en línea, miniaturas) | PROPUESTA |
| Radio píldora | `999px` (chips, badges, barras de progreso) | PROPUESTA |
| Borde | `1px` color latón `--mp-brass` | DECIDIDO que sea fino y de latón; el hex es PROPUESTA |
| Borde de input sobre pergamino | `1px` `--mp-gold-deep` (el latón no llega a 3:1) | PROPUESTA |
| Sombra interior "madera tallada" | `inset 0 1px 0 rgba(255,225,170,.08), inset 0 -2px 6px rgba(0,0,0,.35)` | DECIDIDO el efecto; los valores son PROPUESTA |
| Sombra de hueco (inputs, pistas) | `inset 0 2px 4px rgba(0,0,0,.5)` | PROPUESTA |
| Sombra de elevación (pergamino, modales) | `0 4px 14px rgba(0,0,0,.35)` | PROPUESTA |
| Halo de sala | `0 0 24px` del acento al 35 % de opacidad, solo alrededor de la ilustración o del avatar del robot | PROPUESTA |
| Foco de teclado | anillo `2px` `--mp-gold`, separación `2px` | PROPUESTA |
| Escala de espaciado | `4, 8, 12, 16, 24, 32, 48 px` | PROPUESTA |

Relleno interior: 16 px en tarjetas y paneles, 12 px en burbujas, 8×12 px en filas de lista. Solo tres niveles de profundidad: hundido (ink), plano (bg/surface), elevado (pergamino con sombra).

---

## 5. Componentes

Todo este apartado es **PROPUESTA**, construido con los tokens de arriba.

**Botones** — altura 36 px, radio 12, texto UI 14/600, relleno horizontal 16.
- Primario: fondo `gold`, texto `ink`, sombra tallada. Hover: fondo `brass-light`. Uno por vista.
- Secundario: fondo `surface`, borde `brass`, texto `parchment`. Hover: fondo `surface-raised`, borde `brass-light`.
- Fantasma: sin fondo, texto `gold` (sobre pergamino, `gold-deep`).
- Peligro: fondo `danger-deep`, texto `parchment`.
- Deshabilitado: opacidad 45 %, sin sombra.

**Tarjetas**
- De pergamino: fondo `parchment`, texto `ink`, secundario `ink-muted`, borde `brass`, radio 12, sombra de elevación. Para contenido que se lee: proyectos, recordatorios, metas.
- De panel: fondo `surface`, texto `parchment`, secundario `text-muted`, borde `brass`, sombra tallada. Para agrupar controles.
- No anides pergamino dentro de pergamino; dentro usa bandas `parchment-shade`.

**Chips y badges** — píldora, altura 22 px, texto de etiqueta 11/700.
- Neutro: fondo `surface-raised`, texto `parchment` (sobre pergamino: fondo `parchment-shade`, texto `ink`).
- **Badge de sala:** punto de 8 px en el acento de la sala + nombre de la sala en el color de texto normal del fondo. Así funciona igual sobre oscuro y sobre pergamino. Variante llena para cabeceras: fondo acento, texto `ink`.
- Contador (sin leer): fondo `gold`, texto `ink`.

**Inputs** — altura 36 px (el compositor del chat crece hasta 6 líneas), radio 12.
- Sobre oscuro: fondo `ink`, borde `brass`, texto `parchment`, placeholder `text-muted`, sombra de hueco.
- Sobre pergamino: fondo `parchment-shade`, borde `gold-deep`, texto `ink`, placeholder `ink-muted`.
- Foco: anillo dorado. Error: borde `danger` (o `danger-deep`) y mensaje de 12 px debajo.

**Burbujas de chat** — radio 12, relleno 12×16, ancho máximo 720 px, separación 12 px.
- Usuario: a la derecha, fondo `parchment`, texto `ink`; la esquina inferior derecha con radio 4. Avatar de Nato opcional.
- Asistente: a la izquierda, fondo `surface`, borde `brass`, texto `parchment`; avatar del robot (32 px) con halo de sala.
- Bloque de código: fondo `ink`, texto `parchment`, JetBrains Mono, radio 6, borde `brass` al 40 %.
- Hora y metadatos: 12 px en `text-muted` / `ink-muted`.

**Lista lateral (sidebar)** — ancho 280 px, fondo `surface`, borde derecho `brass`.
- Cabecera de grupo: badge de sala + contador; texto de etiqueta en `text-muted`.
- Fila de chat: 36 px, título UI 14 en `parchment`, una línea con elipsis. Hover: `surface-raised`.
- Fila seleccionada: fondo `surface-raised`, barra izquierda de 3 px en el acento de la sala, título en 600.

**Barras de progreso** — altura 8 px, píldora.
- Pista: `ink` con sombra de hueco (sobre pergamino: `parchment-shade` con borde `gold-deep`).
- **Racha:** relleno `gold` (sobre pergamino `gold-deep`). Es de la app, igual en todas las salas.
- **Metas:** relleno en el acento de la sala (sobre pergamino, su `-deep`).
- Siempre con el número al lado ("4 / 7") en texto auxiliar; el color no lleva solo la información.

---

## 6. Reglas de ilustración

**Lo que define el arte existente** [DECIDIDO + MEDIDO]:

- **Proyección:** isométrica clásica, vista 3/4 desde arriba; la sala es una caja abierta (suelo y dos paredes del fondo, las dos de delante cortadas) con una esquina hacia el espectador. Sin perspectiva con fuga.
- **Contorno:** línea oscura limpia, de grosor casi uniforme con un leve temblor de mano; más gruesa en la silueta de la sala y de los muebles, más fina en los detalles. Color casi negro cálido (≈ `#150E0F`) en salas y marrón oscuro (≈ `#331C19`) en personajes. Nunca negro puro.
- **Color y sombreado:** colores planos con una o dos capas de sombra de borde suave. En las salas la luz añade un resplandor difuso alrededor de la fuente (lámpara, pantalla, fragua).
- **Iluminación:** una sola luz de color dominante por sala, que tiñe paredes y suelo; el resto cae a penumbra cálida. Fuera de la sala, el entorno es una biblioteca en sombra de muy bajo contraste (`#1F1818`–`#2C1D19`) que no compite.
- **Textura:** grano de papel sutil sobre todo; veta visible en la madera.
- **Tono:** cálido, de cuento, acogedor; objetos algo regordetes y simplificados.

**Personajes:**

- **Nato:** niño de pelo largo, rizado y castaño oscuro, camiseta teal, pantalón corto cargo y zapatillas; sonrisa tranquila, ojos grandes y sencillos. Proporción de dibujo animado (cabeza grande).
- **Robots ayudantes:** pequeños y redondos, cuerpo en forma de huevo de madera de nogal con veta, piezas de latón (collar, hombreras, auriculares, cinturón), ojos redondos de lente y una luz que brilla en el pecho. En el robot que existe la luz es teal, igual que la sala de código; que cada robot lleve la luz del acento de su sala es PROPUESTA.
- Existen dos encuadres por personaje: `avatar` (busto, cuadrado) e `idle` (cuerpo entero), en PNG transparente.

**Para que arte nuevo encaje** [PROPUESTA, derivada de lo anterior]:

- Muebles y objetos: mismo ángulo isométrico que la sala, contorno del mismo grosor relativo, sombra del lado opuesto a la luz de la sala, fondo transparente y sin sombra proyectada pintada (la pone la app).
- Paleta: parte de la fila de la sala en la tabla 2.4; los materiales comunes (madera, latón, papel) usan los mismos tonos en todas las salas.
- Los personajes son más planos y de línea más gruesa que las salas. Al colocarlos dentro de una sala, tíñelos ligeramente con la luz de la sala para que no parezcan pegados.

**Evitar:**

- Pixel art, voxels o bordes dentados. [DECIDIDO]
- Fotorrealismo, render 3D, reflejos especulares duros.
- Degradados como decoración (fondos arcoíris, botones con degradado). El único degradado admitido es el resplandor de una fuente de luz.
- Texto legible dentro del arte: pantallas, pizarras, notas y carteles llevan garabatos o quedan en blanco. El texto real lo pone la UI.
- Negro puro, blanco puro y colores neón fuera de la luz de la sala.
- Más de una luz de color dominante por sala.

---

## 7. Tokens listos para pegar

### CSS

```css
:root {
  /* Base — DECIDIDO */
  --mp-bg: #2A1D16;
  --mp-surface: #3B2A20;
  --mp-parchment: #F3E6C8;
  --mp-ink: #1E1612;
  --mp-gold: #E8B84A;

  /* Base — PROPUESTA */
  --mp-surface-raised: #4A3528;
  --mp-parchment-shade: #EBDCBE;
  --mp-brass: #B58956;
  --mp-brass-light: #DDBF7C;
  --mp-text-muted: #CCAC82;
  --mp-ink-muted: #623D2A;
  --mp-gold-deep: #7A5310;
  --mp-danger: #F08A72;
  --mp-danger-deep: #A33A22;
  --mp-success: #9CC27A;
  --mp-success-deep: #3F6B2A;

  /* Salas — DECIDIDO */
  --mp-room-coding: #5EEAD4;
  --mp-room-music: #F0ABFC;
  --mp-room-art: #FB923C;
  --mp-room-mail: #A9ADC6;

  /* Salas sobre pergamino — PROPUESTA */
  --mp-room-coding-deep: #0F6B63;
  --mp-room-music-deep: #8E2A9C;
  --mp-room-art-deep: #9A4209;
  --mp-room-mail-deep: #50556F;

  /* Tipografía — PROPUESTA */
  --mp-font-heading: 'Fraunces', Georgia, serif;
  --mp-font-body: 'Nunito Sans', system-ui, sans-serif;
  --mp-font-mono: 'JetBrains Mono', ui-monospace, monospace;
  --mp-text-xs: 11px;
  --mp-text-sm: 12px;
  --mp-text-ui: 14px;
  --mp-text-body: 15px;
  --mp-text-h3: 16px;
  --mp-text-h2: 20px;
  --mp-text-h1: 28px;

  /* Forma — radio 12 DECIDIDO, resto PROPUESTA */
  --mp-radius: 12px;
  --mp-radius-sm: 6px;
  --mp-radius-pill: 999px;
  --mp-border: 1px solid var(--mp-brass);

  /* Profundidad — PROPUESTA */
  --mp-shadow-carved: inset 0 1px 0 rgba(255, 225, 170, 0.08), inset 0 -2px 6px rgba(0, 0, 0, 0.35);
  --mp-shadow-well: inset 0 2px 4px rgba(0, 0, 0, 0.5);
  --mp-shadow-raised: 0 4px 14px rgba(0, 0, 0, 0.35);
  --mp-focus-ring: 0 0 0 2px var(--mp-bg), 0 0 0 4px var(--mp-gold);

  /* Espaciado — PROPUESTA */
  --mp-space-1: 4px;
  --mp-space-2: 8px;
  --mp-space-3: 12px;
  --mp-space-4: 16px;
  --mp-space-5: 24px;
  --mp-space-6: 32px;
  --mp-space-7: 48px;
}
```

### JSON

```json
{
  "color": {
    "bg": "#2A1D16",
    "surface": "#3B2A20",
    "parchment": "#F3E6C8",
    "ink": "#1E1612",
    "gold": "#E8B84A",
    "surfaceRaised": "#4A3528",
    "parchmentShade": "#EBDCBE",
    "brass": "#B58956",
    "brassLight": "#DDBF7C",
    "textMuted": "#CCAC82",
    "inkMuted": "#623D2A",
    "goldDeep": "#7A5310",
    "danger": "#F08A72",
    "dangerDeep": "#A33A22",
    "success": "#9CC27A",
    "successDeep": "#3F6B2A"
  },
  "room": {
    "coding": { "accent": "#5EEAD4", "deep": "#0F6B63" },
    "music": { "accent": "#F0ABFC", "deep": "#8E2A9C" },
    "art": { "accent": "#FB923C", "deep": "#9A4209" },
    "mail": { "accent": "#A9ADC6", "deep": "#50556F" }
  },
  "font": {
    "heading": "Fraunces",
    "body": "Nunito Sans",
    "mono": "JetBrains Mono",
    "size": { "xs": 11, "sm": 12, "ui": 14, "body": 15, "h3": 16, "h2": 20, "h1": 28 }
  },
  "radius": { "default": 12, "sm": 6, "pill": 999 },
  "border": { "width": 1, "color": "#B58956" },
  "shadow": {
    "carved": "inset 0 1px 0 rgba(255,225,170,0.08), inset 0 -2px 6px rgba(0,0,0,0.35)",
    "well": "inset 0 2px 4px rgba(0,0,0,0.5)",
    "raised": "0 4px 14px rgba(0,0,0,0.35)"
  },
  "space": [4, 8, 12, 16, 24, 32, 48]
}
```

Decididos en este bloque: `bg`, `surface`, `parchment`, `ink`, `gold`, los cuatro `accent` y el radio 12. El resto es propuesta.

---

## 8. Sí / No

**Sí**

- Fondo nogal, paneles un tono más claros, contenido de lectura en pergamino.
- Un solo botón dorado por vista.
- Acento de sala en detalles pequeños: punto, barra de 3 px, relleno de progreso, halo.
- Variante `-deep` o `gold-deep` para cualquier color sobre pergamino.
- Borde de latón de 1 px y radio 12 en todo contenedor.
- Ilustraciones sin marco, fundidas con el fondo.

**No**

- Pixel art, en ninguna forma.
- Texto dorado, de latón o del acento de sala sobre pergamino (falla AA).
- Acento de sala como fondo de un panel o de una pantalla entera.
- Negro puro, blanco puro, grises fríos o el morado del tema antiguo.
- Degradados decorativos, sombras difusas grandes, efecto cristal.
- Texto legible dentro de las ilustraciones.
- Serif en botones, inputs o texto corrido.

---

## Notas

- El tema actual del código (`src/renderer/src/styles.css`, morado oscuro) es un esqueleto anterior a esta decisión y **se sustituye por esta guía**; no lo tomes como referencia.
- De las pantallas generadas con el brief solo existe una captura muy reducida. Confirma la impresión general (lienzo nogal, tarjetas de pergamino, acentos dorados), pero no permite leer tipografías ni medidas; por eso los tamaños y los componentes son propuesta.
