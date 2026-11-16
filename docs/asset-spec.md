# Mind Palace — Asset Spec v0.2

For the artist and for the code that places sprites. Rooms: Coding room, Music studio, Art workshop, plus the Mail room for everything else, joined into one palace (2 × 2 grid of 8 × 8 rooms with 2-tile hallways).

**What changed from v0.1:** pixel art is out. Sprites are hand-drawn in the style of the existing room paintings (`assets/rooms/*.jpg`) and the style guide (`docs/style-guide.md`). The grid, anchors, layers and manifest stay the same, so the code that places sprites doesn't change. Every piece of furniture and gear is a separate sprite because users place, move, hide and swap them — customization is the point.

## 1. Grid and projection (unchanged)

| Property | Value |
|---|---|
| Projection | 2:1 isometric (dimetric) |
| Floor tile | 64 × 32 px diamond (logical) |
| Height unit | 32 px |
| Room floor | 8 × 8 tiles |
| Hallway | 2 tiles wide between rooms |
| Wall height | 4 units = 128 px; front walls never drawn; inner walls between rooms drawn low (1 unit) with doorways |
| Max item height | 3 units (96 px) |
| Camera | Looking at the back corner of the palace |

Axes: **x** down-right along the right wall, **y** down-left along the left wall, **z** up.

## 2. File format

- PNG, 32-bit with transparency, sRGB.
- **Export at 2× the logical size** (a 64 × 32 tile is 128 × 64 px). The app downsamples with smooth scaling; anti-aliasing and soft edges are fine.
- No baked floor shadows and no baked room light. Items are lit **neutrally**; the app applies each room's light and its decay darkening.
- Export the full canvas from section 3. Don't trim, or the anchor moves.

## 3. Canvas size and anchor (unchanged, logical px; double for export)

Footprint **w × d** tiles, height **h** units.

- Canvas width = (w + d) × 32
- Canvas height = (w + d) × 16 + h × 32
- **Anchor** = front corner of the footprint, on the bottom edge, w × 32 from the left.

| Example | Footprint | Height | Canvas | Anchor |
|---|---|---|---|---|
| Chair | 1 × 1 | 1.5 | 64 × 80 | 32, 80 |
| Desk | 3 × 1 | 1 | 128 × 96 | 96, 96 |
| Bookshelf | 1 × 2 | 3 | 96 × 144 | 32, 144 |
| Couch | 1 × 3 | 1 | 128 × 96 | 32, 96 |

## 4. Style

- Hand-drawn, warm, painterly, matching the room paintings. No pixel art, no photo textures.
- Outlines: `#150E0F` for room pieces and furniture, `#331C19` for characters. Weight scaled so it reads at 1×.
- Shading direction: top faces lightest, left faces mid, right faces darkest (about 100 / 82 / 62 %). Keep it soft.
- Palette anchored on the style guide: wood and brass browns, parchment, gold `#E8B84A` only for things that matter (trophies, the active item). Room accents: coding `#5EEAD4`, music `#F0ABFC`, art `#FB923C`, mail `#A9ADC6`.
- No readable text inside sprites; labels come from the app.

## 5. Layers (unchanged)

| Layer | What |
|---|---|
| `shell_wall` | Wall segments, right-wall version; left is the mirror |
| `shell_floor` | Floor tiles, 2 variants per tier |
| `hallway` | Hallway floor tiles and low walls with doorways |
| `wall_item` | Posters, windows, shelves, signs |
| `rug` | Rugs, floor decals |
| `floor_item` | Furniture on the floor |
| `surface_item` | Things on a desk or shelf; lifted by the host surface height (1 unit) |
| `decay` | Overlays: dust, cobwebs, cracks, a dead plant swap |
| `character` | Nato and the robots, drawn above everything in their tile |

## 6. Facing and tinting

- One facing per item; the app may mirror it, so avoid asymmetric details (text, clocks).
- Base-set items come as `_fixed.png` plus `_tint.png` (greyscale parts that take the room accent). Signature items and gear are single PNGs.

## 7. Variants (new, for customization)

An item may ship variants (colour, material, style) with **identical canvas and anchor**: `<id>__<variant>.png`, listed under `variants` in the manifest. The user picks one in the room editor.

## 8. Naming and manifest

- Base: `base_<item>_fixed.png`, `base_<item>_tint.png`
- Signature: `<room>_<item>.png`
- Gear: `gear_<item>.png`
- Shell: `shell_<tier>_wall.png`, `shell_<tier>_floor_a.png`, `shell_<tier>_floor_b.png`
- Decay: `decay_<level>_<kind>.png`
- Characters: `nato_<anim>_<frame>.png`, `robot_<anim>_<frame>.png`

`assets/manifest.json`, one entry per sprite:

```json
{
  "id": "coding_mic",
  "file": "coding_mic.png",
  "layer": "surface_item",
  "footprint": [1, 1],
  "height": 1,
  "anchor": [32, 64],
  "scale": 2,
  "tintable": false,
  "mirrorable": true,
  "variants": ["brass", "black"],
  "slots": ["desk_surface"]
}
```

`anchor` is in logical px; `scale` says the file is 2×. `slots` lists the slot kinds this item may go in (see `catalog/rules.json` `layout.slots`); the room editor only offers compatible slots.

## 9. Deliverables

- **Shell:** 3 tiers (`bare`, `painted`, `finished`): wall segment and 2 floor tiles each. An empty room of each tier must look complete with nothing in it.
- **Hallways:** floor tile, low wall, doorway (1 tile wide, 2 units high).
- **Base set (12, tintable):** desk, chair, stool or crate, low bookshelf, tall bookshelf, couch, side table, floor lamp, small plant, large plant, 3 × 3 rug, poster frame.
- **Shared extras:** trophy, trophy shelf (2 wide), window (2 wide), cardboard box.
- **Signature packs:** 5 each for Coding, Music, Art; 3 for Mail (lists in `catalog/rooms/*.json`).
- **Gear:** one sprite per gear item in the gear catalog (plan v2 phase 13), including the always-on desk.
- **Decay overlays:** 4 levels (7, 14, 21, 30 weekdays): dust, cobwebs, cracked wall, dimmed or dead plant.
- **Characters:** Nato (session) and the walnut-egg robot (sub-agent). Animations: idle (2 frames), walk (4 frames, 2 directions, mirrored for the others), work (2), waiting (2), done (1). Use the mockups for proportions.

## 10. Placeholders

Until sprites exist, the app draws flat blocks at the right footprint and height, coloured by layer. Everything in this spec must work with placeholders first.

## 11. Acceptance checklist

- [ ] Canvas matches section 3 (at 2×).
- [ ] Anchor is the front corner of the footprint.
- [ ] Nothing drawn outside the footprint at floor level.
- [ ] Neutral light, no baked shadow.
- [ ] Variants share canvas and anchor.
- [ ] Manifest entry present, including `slots`.
- [ ] Looks right next to the desk and chair, in a lit room and a decayed room.

## 12. Reference

- `docs/mockups/` — palace, rooms, status and harness screens on this grid (placeholder furniture, final palette).
- `assets/rooms/*.jpg` in the repo — style reference for the hand-drawn look.
- `docs/style-guide.md` — colours, type, components.
