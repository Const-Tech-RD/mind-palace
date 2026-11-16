# Furniture Sprites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the 44 furniture items as hand-drawn sprites instead of blocks.

**Architecture:** Gemini sheets on magenta are cut and fitted to spec canvases by a Python script that also writes a manifest. A pure `spritePlacement` turns a floor block plus a manifest entry into where and how the canvas draws the sprite. Blocks remain for anything without a sprite.

**Tech Stack:** Python 3 + Pillow, numpy and scipy (already used by `cut_sprites.py`); PixiJS 8; Vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-furniture-sprites-design.md` (art rules: `docs/asset-spec.md` §1–3)

## Global Constraints
- Canvas width = (w + d) × 32 logical px, exported at 2×; anchor = front corner of the footprint on the bottom edge, w × 32 from the left (asset spec §3).
- Wall items: footprint [width, 0]; drawn for the right wall, mirrored for the left.
- No hex colours in `src/renderer` (existing test).
- Sheets stay outside the repo, in `C:\Users\Claudio Sanchez\Apps\mind-palace-art\sheets\`.

## Review Focus
1. A sheet where Gemini drew the wrong number of pieces: the fitter must refuse the sheet (count mismatch), never mislabel pieces.
2. Faint stray specks on the key colour: only connected shapes larger than 0.5 % of the sheet area count as pieces.
3. A floor item standing turned (slot footprint swapped): mirrored, still anchored at its front corner.
4. A surface item on a desk: drawn at the block's inset size and lifted by the desk's height, as the block was.
5. A manifest naming a file that failed to load: the canvas falls back to the block, with no crash.

---

### Task 1: Sprite placement (pure)
**Files:** Create `src/shared/sprites.ts`. Test: `tests/sprites.test.ts`.
**Produces:** `interface SpriteEntry { id: string; file: string; footprint: [number, number]; canvas: [number, number]; anchor: [number, number]; scale: number }` (canvas and anchor in file px); `spritePlacement(block: Pick<FloorBlock,'x'|'y'|'w'|'d'|'z'|'layer'>, entry: SpriteEntry, wall: 'left'|'right'|null): { x: number; y: number; anchorX: number; anchorY: number; scaleX: number; scaleY: number }`. The position is `iso(x + w, y + d, z)`; anchor = entry.anchor / entry.canvas; base scale = 1 / entry.scale × (drawn width ÷ footprint width), where the drawn width is the block's `w + d` (walls use the run length); `scaleX` is negative when wall is `'left'`, or when a floor block's (w, d) is the entry's footprint swapped.
- [ ] Tests: a 1×1 chair block at (3,1) is placed at `iso(4,2,0)`, anchor (0.5, 1), scale 0.5; a 3×1 desk at (2,0): `iso(5,1,0)`, anchorX 0.75; a desk-top laptop block (w 0.6, z 1): scale 0.3 and lifted by z; a right-wall poster: scaleX > 0; the same on the left wall: scaleX < 0; a [2,1] keyboard in a [1,2] slot: mirrored.
- [ ] Run `npx vitest run tests/sprites.test.ts` → FAIL, implement, → PASS. Commit `feat(sprites): where a sprite stands on its block`.

### Task 2: The fitter
**Files:** Create `scripts/fit_sprites.py` and `scripts/sprite-sheets.json` (`{ "sheets": [{ "file": "s01.png", "items": ["base_desk", …] }] }`). Output `src/renderer/src/assets/items/<id>.png` and `src/renderer/src/assets/items/manifest.json` (`SpriteEntry[]`).
- `python scripts/fit_sprites.py --self-test` builds a synthetic magenta sheet with 3 rectangles and one speck, and checks 3 pieces, the speck dropped, canvas widths per footprint, anchors, and a count mismatch refused. Footprints and heights come from `catalog/items.json`, `catalog/library.json` and `catalog/rooms/mailroom.json`.
- [ ] Self-test first (fails: no fitter), then implement, then the self-test passes. Commit `feat(sprites): fit Gemini sheets to spec canvases`.

### Task 3: Draw sprites
**Files:** Modify `src/renderer/src/components/PalaceCanvas.tsx` (load the manifest's textures with the others; in `drawRoom`, a block whose item has an entry becomes a `Sprite` placed by `spritePlacement`, otherwise drawn as now). The selection highlight and `isNew` glow stay as an outline under the sprite.
- [ ] `npm run typecheck`, `npm test`, then `npm run shots`: look at alone, furnished, grown and a focused room. Commit `feat(palace): draw furniture sprites`.

### Task 4: Generate the art (browser)
13 sheets in one Gemini chat, per `scripts/sprite-sheets.json`; download each, run the fitter, look at each piece, and regenerate up to 2 times. Commit the sprites, the manifest and the sheet map: `art: furniture sprites`.
