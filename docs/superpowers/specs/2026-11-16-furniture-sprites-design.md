# Furniture sprites: design (short)

Date: 2026-11-16 · Builds on `feat/dynamic-rooms` · Spec for the art: `docs/asset-spec.md` v0.2

## Intent
Replace the placeholder blocks with hand-drawn sprites, one per piece of furniture (44: 16 base and shared, 25 library, 3 Mail room), so rooms look like the paintings while every piece can still be moved, hidden and swapped.

## Approaches
1. **Gemini sheets, cut and fitted by a script** (chosen). The same route that made Nato, the helpers and the lobby piece. Claude drives Gemini in the in-app browser, signed in to Claudio's account.
2. Claudio runs the prompts himself. Rejected by Claudio: Claude drives.
3. Procedural or vector art drawn by code. Rejected: it can't reach the painterly look the spec asks for.

## Decisions
- About 13 sheets of 4–5 pieces, grouped by type (floor, desk-top, wall, rug), all in one Gemini chat for a consistent style. Flat magenta background, 2:1 isometric, neutral light, no shadows, no text.
- Sheets are downloaded (approved) to `C:\Users\Claudio Sanchez\Apps\mind-palace-art\sheets\`, outside the repo.
- `scripts/fit_sprites.py` keys out magenta (reusing `cut_sprites.py`) and splits each sheet into pieces, mapped left to right to the item ids in `scripts/sprite-sheets.json`. It scales each piece to its spec canvas width ((w+d) × 32 × 2 px), keeping the aspect ratio, and puts the bottom on the canvas's bottom edge; the canvas grows upward when a piece is taller than the spec. Output: `src/renderer/src/assets/items/<id>.png`, plus `src/renderer/src/assets/items/manifest.json` (file, footprint, anchor, scale 2).
- The canvas draws a sprite for every item in the manifest, anchored at the front corner of its block. Items without a sprite stay blocks. Room light, decay and the editor are unchanged.
- Wall items are drawn for the right wall and mirrored on the left. A floor item standing turned (its footprint swapped) is mirrored.

## Calls (Claude)
- No variants and no accent-tint layers this round.
- No shell (wall and floor) sprites this round.
- Up to 2 regenerations per sheet. A piece that is still wrong after that stays a block and is listed for Claudio.

## Risk
Gemini's angle is close to, not exactly, the spec's 2:1. Some pieces may look slightly skewed next to each other.
