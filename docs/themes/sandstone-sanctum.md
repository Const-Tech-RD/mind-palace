# Theme: Sandstone sanctum

Status: designed, not scheduled. Build after the palace renders with placeholder blocks (plan v2, phase 4). The default theme stays the warm wood-and-brass look in `docs/style-guide.md`.

Feel: monumental, a night sky overhead, lanterns. It takes the mood of a desert temple without lifting real motifs.

## How themes work

- A theme is an asset pack plus tokens: the room shell in 3 tiers, hallways and doorways, light, decay overlays, and the UI colour tokens.
- Furniture, gear and characters are shared by all themes. Base items take the room accent (tint layer) and are lit neutrally, so they fit any theme.
- Components read tokens only; no hex values in components.
- Themes may override room accents when one clashes with the shell.
- Later: a theme per palace or per room, unlockable (for example at a long streak milestone).

## Tokens

These use the same names as the style guide, so swapping the theme changes no components.

| Token | Hex | Use |
|---|---|---|
| `bg` | `#141A33` | Night sky; app background |
| `surface` | `#1C2444` | Panels, chat column |
| `raised` | `#26305A` | Cards, popovers |
| `parchment` | `#F3E3C2` | Papyrus: reading surfaces, chat bubbles |
| `parchment-shade` | `#E6D2A8` | Alternate rows, inputs |
| `ink` | `#1A1408` | Text on papyrus |
| `ink-muted` | `#6B4E26` | Secondary text on papyrus |
| `text-muted` | `#B9B3CC` | Secondary text on night |
| `gold` | `#E0B04A` | The one primary action per view, trophies |
| `gold-deep` | `#7A5A12` | Text on gold, pressed state |
| `brass` → `sandstone` | `#C98E4E` | Borders, dividers, icon strokes |
| `brass-light` → `sandstone-light` | `#E2B57A` | Hover, focus ring |
| `lapis` (new) | `#1F3E7A` | Headers, selected tab, wall band |
| `lapis-light` (new) | `#3C64B0` | Links, active state on night |
| `turquoise` (new) | `#3FB2A6` | Success, "running" status |
| `night-veil` (new) | `#0E1226` | Decay overlay; rooms fade to night, not black |
| `outline-room` | `#2A1A0C` | Sprite outlines, rooms and furniture |
| `outline-char` | `#3A2410` | Sprite outlines, characters |

Room accents: coding `#5EEAD4`, music `#F0ABFC` and mail `#A9ADC6` carry over. Art changes from `#FB923C` to vermilion `#E8553D`, because orange gets lost against the sandstone.

Type: Fraunces for headings, but with high `opsz` and `SOFT` 0 so it feels carved rather than soft. Nunito Sans and JetBrains Mono stay as they are.

## Light

- Warm ambient light `#FFE2B0`, applied by multiplying.
- Point lights from the lanterns and the brazier.
- A faint blue rim light from the starlit ceiling.
- In the finished tier the brazier is the one warm hotspot.

## Glyph rule

The carved band uses an invented set only: rings, triangles and paired bars, in gold and turquoise. No real hieroglyphs, scarabs, ankhs or eyes.

## Shell tiers

| Tier | Walls | Floor | Fixtures |
|---|---|---|---|
| Bare | Rough-cut blocks with visible joints (`#B98447` / `#956434`) | Packed sand, speckled | One torch, plain doorway |
| Painted | Smoothed plaster (`#C98E4E` / `#A5703B`), lapis band along the top | Checker `#D9A962` / `#C29150` | Plain pillars at 3 corners, 2 lanterns, sandstone lintel |
| Finished | Glyph band with gold trim, recessed panels with turquoise inlay | Checker plus turquoise border inlay and a gold/turquoise centre diamond | Gilded pillars, gold lintel, brazier, starlit ceiling |

The doorway is a tapered opening, narrower at the top.

## Decay (weekdays since the quietest active project)

| Level | Days | Look | Dim (`night-veil`) |
|---|---|---|---|
| 0 | — | At rest | 0 |
| 1 | 7 | Lanterns dim; sand gathers in the corners | 8% |
| 2 | 14 | Drifts grow, the band fades, one lantern goes out | 18% |
| 3 | 21 | Walls crack, a block falls, the brazier goes out | 36% |
| 4 | 30 | Dark but for starlight; sand along every wall; a lantern flickers now and then | 64% |

Level 4 follows the agreed rule: the room is mostly dark, with an occasional random flicker (about a 10% chance every 500 ms, lasting 150–250 ms).

## Sprites for this theme (about 22)

- Shell: 3 tiers × (wall + 2 floor tiles). The finished glyph band is its own tileable strip.
- Doorway: tapered opening, plus a lintel in plain and gold.
- Pillar: plain and gilded, 1 × 1, height 3.4 units.
- Lights: torch, lantern (lit, dim and out frames), brazier.
- Decay: sand drifts in 4 sizes for corners, a sand strip for wall bases, 2 wall cracks, a fallen block, a faded-band overlay.
- Ceiling: a star field drawn behind the walls (finished tier, and decay level 4).

Grid, anchors, layers and manifest follow `docs/asset-spec.md` v0.2.

## Other directions explored

- Gilded hall: crimson velvet, gilt frames, chandelier; decays into tarnish and cracked gilt.
- Colonnade: pale stone, sea blue, arches open to daylight; decays into moss and fallen stone. It's a light theme, so it needs a real light-mode token set.
