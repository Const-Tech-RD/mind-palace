# Phase 4 · Connected Palace Implementation Plan (rev. 2, on the first pass)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish phase 4 on top of Natanael's first pass (`af75504`): a palace of four 8 × 8 rooms joined by **2-tile** hallways, drawn only from per-item placeholder blocks, where the user places, moves, swaps variants of and hides unlocked items, and placements persist. Decay shows in each room.

**Architecture:** `src/shared/floor.ts` (from the first pass) stays the pure scene model. `buildPalace()` in `src/shared/palace.ts` feeds it resolved placements, decay and focus. `PalaceCanvas.tsx` only draws `FloorView` and reads every colour from `--mp-*` CSS tokens. The main process adds a `placements` table and IPC to change it.

**Tech Stack:** Electron + electron-vite, React 19, Zustand, PixiJS (as installed by the first pass), zod 4, Drizzle + better-sqlite3, Vitest.

**Spec:** `docs/plan-v2.md` (phase 4, "The palace", "Decay"), `docs/HANDOFF.md`, `docs/asset-spec.md` v0.2, `docs/style-guide.md` §2, mockups `Palace-Three.html`, `Room-*.html`, `Status-Decay.html`. Base: branch `feat/phase4-palace` = first pass + PR #2 merged.

## Decisions (approved 2026-11-15, option 1)

1. **Undo the first pass's two departures:** rooms are never drawn from the cut-out paintings (`ROOM_CUT`, `assets/rooms/cut/`), and hallways go back to 2 tiles (`HALL_TILES = 2`, palace 18 × 18). The paintings stay as the header picture beside a room (`ROOM_IMAGE`). Nato, the helpers, the lobby piece and the helper states stay.
2. **Wall items on low walls:** in the whole-palace view, items on a low wall are not drawn, and the room's label shows "+N on the walls". With a room focused, its two back walls are full height and everything on them shows.
3. **Host items don't move:** the desk and the trophy shelf can be hidden or switch variants, not moved. Hiding one sends what stands on it to the inventory (`needs_host`).
4. **Carried over:** `decayLevel` (phase 3). The tokens and fonts are done in the first pass; only the no-hex rule and the palace's own colours remain.
5. **Deferred:** background-session characters and status dots (phase 7), the event throttle (phase 6), real sprites, and the component set and contrast page (phase 0).

## Global Constraints

- Geometry (asset spec §1): 2:1 isometric; `TILE = { w: 64, h: 32, unit: 32 }`; room 8 × 8; hallway 2 tiles; full wall 4 units; low wall 1 unit; max item height 3 units. `iso(x, y, z)` from `floor.ts` is the only projection.
- Room origins: `coding [0,0]`, `art [10,0]`, `music [0,10]`, `mailroom [10,10]`.
- Placeholder faces: top 100 %, left 82 %, right 62 % of the layer colour.
- Decay thresholds in weekdays since the quietest active project's last activity: 0–6 → 0, 7 → 1, 14 → 2, 21 → 3 (flicker every 20–60 s), 30 → 4.
- No hex colour literal (`#rrggbb` or `0xrrggbb`) in any `.ts` or `.tsx` under `src/renderer`. Colours are `--mp-*` CSS variables.
- The engine never moves, hides or removes an item that has a `placements` row.
- Pure functions take `today` and their inputs, and never read the clock.

## Review Focus

- **A catalog change orphans a placement** (a slot id removed): the app still starts, and the item goes to the inventory as `invalid_slot`. Pinned in Task 4.
- **Two copies of one item** (the Mail room's cardboard boxes) are moved and hidden independently. Pinned in Task 4.
- **An upgrade lands on a slot the user filled:** the user's item stays, and the new item goes to the inventory as `no_free_slot`. Pinned in Task 4.
- **Reduced motion:** no flicker and no camera tween; level 3 darkness still shows. Pinned in Task 7.
- **Resize, or the chat panel opening:** the canvas refits and keeps the focused room. Pinned in Task 6.

---

### Task 1: Palace colour tokens and the no-hex rule

**Files:** create `src/renderer/src/theme.ts`, `tests/theme.test.ts`; modify `src/renderer/src/styles.css` (palace tokens), `PalaceCanvas.tsx`, `PalaceView.tsx`, `ActivityStrip.tsx` (replace literals).

**Interfaces:** `parseCssColor(value: string): number` (throws `/missing token/` on empty) and `readToken(name: string, root?: Element): number` in `theme.ts`. Tokens `--mp-outline` (#150E0F), `--mp-ph-floor`, `--mp-ph-floor-alt`, `--mp-ph-hallway`, `--mp-ph-wall`, `--mp-ph-rug`, `--mp-ph-floor-item`, `--mp-ph-surface-item`, `--mp-ph-wall-item`, `--mp-dark`, `--mp-dust`, `--mp-cobweb`, plus `--mp-room-<id>` for each of the 4 rooms if not already defined.

- [ ] Failing tests: `parseCssColor('#2A1D16') === 0x2a1d16`, `parseCssColor(' #e8b84a ') === 0xe8b84a`, `parseCssColor('')` throws; a scan of `src/renderer/src/**/*.{ts,tsx}` finds no `/#[0-9a-fA-F]{6}\b|0x[0-9a-fA-F]{6}\b/`.
- [ ] Run → FAIL (17 literals today). Implement; move every literal to a token, choosing values from the style guide.
- [ ] `npm test`, `npm run typecheck` pass. Commit `feat(theme): palace colours as tokens; no hex literals in the renderer`.

### Task 2: `decayLevel` in the engine

**Files:** modify `src/shared/engine/{types,roomState,events,days}.ts`, `src/main/palace/view.ts`; test `tests/engine.test.ts`.

**Interfaces:** `type DecayLevel = 0|1|2|3|4`; `RoomState.decay: { level; weekdaysQuiet: number; projectId: string | null }`; `weekdaysBetween(from: LocalDay, to: LocalDay): number` (Mon–Fri after `from`, up to and including `to`); `HistoryRows.projects?: { id; roomId; state; lastActivityDay: LocalDay | null }[]`, with `view.ts` deriving the day in the settings timezone. `DECAY_THRESHOLDS = [7, 14, 21, 30]`.

- [ ] Failing table tests: no active project → 0; quietest active project at 6/7/14/21/30 weekdays → 0/1/2/3/4; Fri→next Fri = 5 weekdays; paused, done and dropped are ignored; with two active projects the quieter one wins and sets `projectId`.
- [ ] Implement; `npm test` passes. Commit `feat(engine): room decay level from the quietest active project`.

### Task 3: `catalog/items.json` and slot kinds

**Files:** create `catalog/items.json`; modify `catalog/rules.json` (`kind` on every slot), `src/shared/catalog/{schema,validate}.ts`, `src/main/catalog/loader.ts`, `src/shared/floor.ts` (drop `BASE_HEIGHT`, read heights from the registry), `tests/catalog.test.ts`, `tests/floor.test.ts`.

**Interfaces:** `Catalog.items: Record<string, ItemDef>` merges `items.json` (base and shared) with every room's `assets`; a duplicate id is an error. `ItemDef = { id; layer; footprint?: [w,d]; width?; height; slots: SlotKind[]; variants: string[]; mirrorable: boolean }`. `SlotKind = 'desk'|'desk_surface'|'floor'|'rug'|'wall'|'trophy_shelf'`. Room `assets` entries default `slots` from their default slot's kind.

Values (heights from the first pass's `BASE_HEIGHT` where they exist): `base_desk` [3,1] h1 [desk] · `base_crate` [1,1] h0.7 [floor] · `base_chair` [1,1] h1.5 · `base_bookshelf_low` [1,2] h1.5 · `base_bookshelf_tall` [1,2] h3 · `base_couch` [1,3] h1 · `base_side_table` [1,1] h1 · `base_floor_lamp` [1,1] h2.5 · `base_plant_small` [1,1] h1 · `base_plant_large` [1,1] h2 (all [floor]) · `base_rug` rug [3,3] h0.04 [rug] · `base_poster` wall w1 h1.4 · `window` wall w2 h1.6 · `trophy_shelf` wall w2 h0.25 (all [wall]) · `trophy` surface [1,1] h0.45 [trophy_shelf] · `cardboard_box` [1,1] h1 [floor]. Slot kinds: `desk`→desk, `desk_*`→desk_surface, `rug`→rug, `wall_*`→wall, `trophy_shelf`→trophy_shelf, the rest→floor.

- [ ] Failing tests: the bundled catalog's `items` covers every ladder and signature item; broken copies fail with path and field for: a ladder item with no definition (`has no item definition`), an item whose default slot kind is not in its `slots`, a duplicate id between `items.json` and a room. NOTES item 8 is closed.
- [ ] Implement; `npm test` passes, including the floor tests on the new heights. Commit `feat(catalog): item registry and slot kinds`.

### Task 4: Placements table and resolver

**Files:** create `src/shared/placements.ts`, `tests/placements.test.ts`, migration `drizzle/0004_*`; modify `src/main/db/schema.ts`, `src/main/palace/repo.ts`, `src/shared/ipc.ts`, `src/main/index.ts` (handlers).

**Interfaces:**
- Table `placements(room_id, instance, slot null, variant null, hidden bool default false, updated_at)`, PK `(room_id, instance)`. `instance` is the engine key `item@defaultSlot#index` (`itemKey`).
- `Placement = { roomId; instance; slot: string|null; variant: string|null; hidden: boolean }`.
- `resolvePlacements(state: RoomState, rows: Placement[], catalog: Catalog): { placed: ResolvedItem[]; inventory: InventoryItem[] }`, where `ResolvedItem = PlacedItem & { instance: string; variant: string|null; userPlaced: boolean }` and `slot` is the current slot; `InventoryItem = { instance; item; reason: 'hidden'|'replaced'|'no_free_slot'|'needs_host'|'invalid_slot' }`.
- `fits(item: ItemDef, slot: SlotDef): boolean`: same kind; floor and rug footprint fits (mirrored too when `mirrorable`); wall `width ≤ slot.width`.
- `checkPlacement(change, state, rows, catalog): {ok:true}|{ok:false; reason}` rejects moving a host item (`/cannot be moved/`), a misfit, or a full slot.
- IPC `'palace:place'` `{ roomId; instance; slot?; variant?; hidden? }` → `PalaceView`; `'palace:reset'` `{ roomId; instance }` → `PalaceView`.
- Order: rows first (hidden → `hidden`; unknown or unfit slot → `invalid_slot`; else placed). Then items without a row, in unlock order: to their default slot if it is free and its host is placed, else `no_free_slot`/`needs_host`. `state.replaced` → `replaced`.

- [ ] Failing tests: no rows equals `state.items` (and the crate is `replaced` after the chair); laptop moved to `desk_left`, then the monitor lands on `desk_center`; crate placed by the user on `seat`, then the chair is `no_free_slot`; the two Mail boxes are independent; hiding `base_desk` makes desk items `needs_host`; a row on slot `ceiling` → `invalid_slot`, nothing throws; `checkPlacement` rejects moving the desk, the couch onto `seat`, the window onto `wall_left_a`; a new unlock with five items moved changes only the new item.
- [ ] Implement, plus `npm run db:generate`; `npm test` and `npm run typecheck` pass; a smoke run on a temp user-data folder lists `placements` in `tables`. Commit `feat(palace): placements and resolver; the engine never moves what you placed`.

### Task 5: Floor model: 2-tile hallways, no painted rooms, focus, placements

**Files:** modify `src/shared/floor.ts`, `src/shared/palace.ts`, `src/main/palace/view.ts`, `src/shared/ipc.ts` (`'palace:view'` takes `{ focus?: string|null }`), `tests/floor.test.ts`, `tests/palace.test.ts`, `tests/palaceView.test.ts`.

**Interfaces:**
- `HALL_TILES = 2`, `PALACE_TILES = 18`. Remove `PAINTED_WALL`; bounds use `WALL_FULL`.
- `buildFloor(catalog, rooms: Array<{ id; name; accent; state; newItems; placed: ResolvedItem[]; decay: RoomState['decay'] }>, itemKey, focus: string|null)`. Blocks come from `placed` (current slot), and `FloorBlock` gains `instance`, `variant` and `onLowWall: boolean`. With `focus !== id`, wall blocks on a low wall are left out and counted in `FloorRoom.hiddenWallItems`; with `focus === id`, that room's back walls are `WALL_FULL`.
- `FloorRoom` gains `decay: DecayLevel`, `hiddenWallItems: number`, `lightAt: [x, y]` (the `desk_center` block, else the room centre).
- `buildPalace(input & { placements: Placement[]; focus: string|null })`; `PalaceRoom` gains `inventory`, `decay`.

- [ ] Failing tests: the floor is 18 × 18 and the halls are 2 wide; the old "wide enough for painted walls" test is replaced by "front walls are low, so no wall reaches another room's floor"; Art's trophy shelf is absent with `focus: null` (`hiddenWallItems ≥ 1`) and present with `focus: 'art'`, where Art's `along: 'y'` back wall has height 4; a moved item appears at its new slot; placements and decay flow through `buildPalace`.
- [ ] Implement; `npm test` passes. Commit `feat(palace): 2-tile hallways, focus walls and placements in the floor model`.

### Task 6: Canvas: placeholders only, tokens, camera refit, fixtures

**Files:** modify `PalaceCanvas.tsx`, `roomArt.ts` (remove `ROOM_CUT`, keep `ROOM_IMAGE` and the characters), `PalaceView.tsx`, `App.tsx` (`#fixtures` dev route); delete `src/renderer/src/assets/rooms/cut/`; create `src/shared/camera.ts`, `tests/camera.test.ts`, `src/renderer/src/dev/PalaceFixtures.tsx`, `tests/fixtures/palace.ts`.

**Interfaces:** `fitCamera(bounds, viewport, padding = 24): { scale; x; y }` and `focusCamera(room: FloorRoom, viewport)`, both pure with scale clamped to `[0.4, 3]`. `faceShades(colour): [top, left, right]` at 100/82/62 %. Characters' spots come from `FloorRoom.seat`/`helperSpots`, not `ROOM_CUT`. Labels stay HTML and show "+N on the walls". `fixtures: Record<'empty'|'furnished'|'decay1'|'decay2'|'decay3'|'decay4', PalaceView>`.

- [ ] Failing tests: `fitCamera` keeps the 18 × 18 bounds inside 800 × 600 with 24 px padding; `focusCamera` centres the mail room; `faceShades(0xffffff)` returns `[0xffffff, 0xd1d1d1, 0x9e9e9e]`.
- [ ] Implement; a `ResizeObserver` refits and keeps the focus. Check `npm run dev` at `http://localhost:5173/#fixtures` against `Palace-Three.html`. `npm test` passes. Commit `feat(palace): draw placeholder blocks only; camera fit and focus`.

### Task 7: Decay visuals

**Files:** create `src/shared/flicker.ts`, `tests/flicker.test.ts`; modify `PalaceCanvas.tsx`.

**Interfaces:** `nextFlickerDelay(random: () => number): number` in `[20_000, 60_000]`; `flickerOn(level, reducedMotion): boolean`, true only for level 3 without reduced motion. Per level: 1 dust plus desaturate; 2 adds cobwebs in the back corners; 3 darkness at 0.75 plus flicker (0.2 for 300 ms); 4 darkness at 0.92. When a level drops, the darkness fades out over 600 ms (instant with reduced motion).

- [ ] Failing tests for both functions (`() => 0` → 20 000; `() => 0.9999` < 60 000; `flickerOn(3,false)` true; `(3,true)`, `(4,false)`, `(2,false)` false). Implement; check the `decay1–4` fixtures against `Status-Decay.html`. Commit `feat(palace): decay overlays, darkness and flicker`.

### Task 8: Tooltips, plain list view, reduced motion

**Files:** create `src/renderer/src/components/PalaceList.tsx`; modify `PalaceCanvas.tsx`, `PalaceView.tsx`, `store.ts` (`palaceMode: 'scene'|'list'`, kept in localStorage), `src/shared/palace.ts` (`decayText`), `tests/palace.test.ts`.

**Interfaces:** `decayText(decay, projectTitle: string|null): string|null` ("Dusty: 9 quiet weekdays on Pantry app"; level 0 → null). The hover tooltip shows the name, both track progress bars and `decayText`. The list view shows the same per room, reachable by keyboard.

- [ ] Failing `decayText` test, one case per level → implement → `npm test` → keyboard check in the fixtures page → commit `feat(palace): room tooltips and a plain list view`.

### Task 9: Room editor and inventory

**Files:** create `src/renderer/src/components/InventoryDrawer.tsx`, `src/shared/editMode.ts`, `tests/editMode.test.ts`; modify `PalaceCanvas.tsx`, `store.ts` (`place`, `resetPlacement`), `tests/e2e/run.mjs` (case V8).

**Interfaces:** `dropTargets(instance, room: PalaceRoom, catalog): string[]` (free slots where `fits`; `[]` for host items); `slotBox(roomId, slotId, catalog)` in `floor.ts` (tile box for highlights). Edit mode works only in a focused room: the drawer lists the inventory with each reason in words, dragging highlights `dropTargets`, dropping calls `palace:place`, and the item menu offers Variant, Hide/Show and Reset. A rejection shows its reason as a toast.

- [ ] Failing `dropTargets` tests (chair → free floor slots that fit, no `rug` or walls; desk → `[]`) → implement → by hand: move the chair, hide the plant, restart, and both persist; then a new unlock lands in its default slot with nothing else moving → commit `feat(palace): room editor and inventory`.

### Task 10: Clean-up and notes

**Files:** `scripts/cut_rooms.py` (keep; note in NOTES that its output is no longer used by the app), `tests/e2e/run.mjs` selectors, `NOTES.md` (phase 4 section: what exists, decisions 1–3, what was verified and what was not).

- [ ] `npm run typecheck`, `npm test`, `npm run build` pass; `npm run dev` shows the palace on real data. Commit `docs(notes): phase 4, connected palace`.
