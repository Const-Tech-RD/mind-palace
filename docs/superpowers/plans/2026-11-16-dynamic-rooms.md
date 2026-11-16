# Dynamic Rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rooms become areas of the person's life, found from their chats: the palace starts with only the Mail room and grows a room each time the person materialises a suggested area.

**Architecture:** Rooms move from `catalog/rooms/*.json` into a `rooms` table; the engine keeps taking a `Catalog`, now built at runtime from the Mail room file plus the table (`catalogWithRooms`). Earned unlocks are protected by per-room high-water marks (`room_progress`). The classifier also tags each chat's area; pure functions turn tagged Mail-room chats into suggestions, and a main-process room service materialises them. The floor becomes a grid of cells that grows behind and beside the Mail room.

**Tech Stack:** Electron + electron-vite, React 19, Zustand, PixiJS 8, Drizzle + better-sqlite3 (Electron ABI: no DB unit tests), zod 4, Vitest, Haiku through `askJson`.

**Spec:** `docs/superpowers/specs/2026-11-16-dynamic-rooms-design.md`

## Global Constraints

- Nothing becomes a room without the person's click (Materialize). No automatic room creation, ever.
- A materialised room never changes cell, look or items on its own. The engine never moves, hides or removes what the user placed (phase 4 rule).
- Earned stays earned: moving chats out of a room never removes an unlock it already had.
- Threshold: 3 Mail-room chats with the same area and no room. A dismissed area returns after 5 more chats.
- Up to 5 signature items per room, from `catalog/library.json`, in order; list position is `n`; n=1 unlocks at start, n=2–5 at streak days 3, 8, 21, 34 (the existing base ladder).
- Accents come from tokens `--mp-room-accent-0` … `--mp-room-accent-7`; a new room takes the lowest unused index. No hex in `src/renderer` (the existing test enforces it).
- Placeholder blocks only; no new sprite art; paintings are never used to build rooms.
- Every model answer is JSON validated with zod; an invalid answer changes nothing.
- `import/` stays git-ignored and is never committed.
- Ask before anything hard to undo (applying the import to the real database, pushing).

## Rulings made while planning (deviations from the spec's wording)

- **Kept progress is two high-water marks per room** (`room_progress.best_streak`, `room_progress.goal_count`), not a per-step `room_unlocks` table. Every ladder step unlocks at a threshold of best streak or goal count, so the marks give exactly the same unlocks, and they survive signature edits by construction. Reopening a goal (a deliberate undo) lowers the goal mark back to the derived count.
- **A missing signature step gives nothing.** The base ladder has no item at the signature steps (3, 8, 21, 34), so "the base set covers the gap" means the base furniture still furnishes the room. The step stays empty.
- **No `npm run import:areas`.** Plain Node can't open the database (better-sqlite3 is built for Electron). "Find my rooms" in the app is the only batch path.
- **Eval keeps room accuracy against fixture rooms.** `scripts/eval-rooms.json` holds Software, Music and Art rooms (the old classifier text); the sample's `coding` becomes `software`. This keeps the 0.85 target meaningful, and area agreement (pairwise) is added on top.
- **Walkers' paths** go door → lobby → door, using `FloorView.doors` and `FloorView.lobby` (the hallway crossing behind the Mail room). Paths across far cells may cut corners; fine for placeholders.
- **Placeholder rooms survive in tests only**: `tests/fixtures/rooms.ts` rebuilds Coding, Music and Art from library items, at cells that reproduce today's origins, so the existing tests keep their meaning.

## Review Focus

1. **Double Materialize** (a double click, or two windows): a second call for an area that already has a room must be refused, not create a twin room.
2. **Bad model picks**: an unknown item id, a slot that doesn't fit, two picks on one slot, more than five picks. Each bad pick is dropped; the room is still created.
3. **Area spelling variants** ("3D printing", "3d-printing", " 3D Printing "): one area key, one suggestion.
4. **Rows for rooms that no longer exist** (old `coding` chats, placements, seen settings, goal rows): nothing crashes; the migration moves them to the Mail room; `buildPalace` ignores unknown room ids.
5. **Progress not recorded before a move**: every chat or project move (classifier, user move, materialise) records the marks first, so the Mail room keeps what it earned.

---

### Task 1: Earned stays earned (kept progress)

**Files:**
- Modify: `src/shared/engine/types.ts`, `src/shared/engine/roomState.ts`, `src/shared/engine/index.ts`
- Create: `src/shared/progress.ts`, `src/main/palace/progress.ts`
- Modify: `src/main/db/schema.ts` (+ `drizzle/0005_*.sql` via `npm run db:generate`), `src/main/palace/view.ts`, `src/main/palace/projects.ts`, `src/main/palace/classifier.ts`, `src/main/palace/repo.ts`, `src/shared/palace.ts`, `src/main/index.ts`
- Test: `tests/engine.test.ts`, `tests/progress.test.ts`, `tests/palace.test.ts`

**Interfaces:**
- Produces: `interface KeptProgress { bestStreak: number; goalCount: number }`; `computeRoomState(roomId, events, catalog, today, kept?: KeptProgress): RoomState`; `progressMarks(states: readonly RoomState[], kept: Readonly<Record<string, KeptProgress>>): Array<{ roomId: string } & KeptProgress>` (only rooms whose marks rise); `buildPalace({ …, kept?: Record<string, KeptProgress> })`; `createProgressKeeper({ store, catalog: () => Catalog, timeZone }) → { kept(): Record<string, KeptProgress>; record(): void; resetGoals(roomId: string): void }`; table `room_progress(room_id PK, best_streak int, goal_count int, updated_at)`.

- [ ] **Step 1: Write the failing engine tests** in `tests/engine.test.ts`:
  - `kept best streak keeps signature items after the chats move out`: `computeRoomState('coding', [], catalog, today, { bestStreak: 8, goalCount: 0 })` → `placed(state)` contains the n=2 and n=3 signature items; `state.streak.current === 0`; `state.streak.best === 8`.
  - `kept goal count keeps goal items and trophies`: kept `{ bestStreak: 0, goalCount: 3 }`, no events → contains `trophy_shelf`, `base_poster`, `base_floor_lamp`; `state.goals.trophies === 3`; `state.goals.count === 0` (shown count stays derived).
  - `derived progress above the kept marks wins`: 5-day run of chats, kept `{ bestStreak: 2, goalCount: 0 }` → `state.streak.best === 5`, shell `painted`.
  - `nextUnlock is measured from the kept marks`: kept best 8 → `state.nextUnlock.streak.at === 13`.
- [ ] **Step 2: Run** `npx vitest run tests/engine.test.ts` — Expected: the 4 new tests FAIL (extra argument ignored).
- [ ] **Step 3: Implement** `KeptProgress` in `types.ts`; in `computeRoomState` use `best = max(streak.best, kept.bestStreak)` and `unlockGoals = max(goalCount, kept.goalCount)` for `placeItems`, trophies, `milestonesReached` and `nextUnlock` reached-values; `goals.count` stays the derived count.
- [ ] **Step 4: Run** `npx vitest run tests/engine.test.ts` — Expected: PASS.
- [ ] **Step 5: Write failing tests** in `tests/progress.test.ts` for `progressMarks`: a room whose best streak rose returns one row with the new marks; a room at or below its marks returns nothing; a room with no kept entry returns its marks only if either is above 0. In `tests/palace.test.ts`: `buildPalace` with `kept: { coding: { bestStreak: 8, goalCount: 0 } }` and no rows shows the n=3 item in `rooms[coding].placed`.
- [ ] **Step 6: Run** `npx vitest run tests/progress.test.ts tests/palace.test.ts` — Expected: FAIL (module missing / kept ignored).
- [ ] **Step 7: Implement** `src/shared/progress.ts` (`progressMarks`) and pass `kept` through `buildPalace`.
- [ ] **Step 8: Run** the two files — Expected: PASS.
- [ ] **Step 9: Wire the database.** Add `roomProgress` to `schema.ts`; `npm run db:generate` → `drizzle/0005_*.sql`. `src/main/palace/progress.ts`: `kept()` reads the table; `record()` builds every room state (same inputs as `view()`) and upserts `progressMarks`; `resetGoals(roomId)` sets `goal_count` to the room's count of distinct `goal_completions.local_day`. `view()` passes `kept()` to `buildPalace` and calls `record()` after. Call `record()` at launch, in the classifier before `repo.setRoom` (inject `beforeMove: () => void` into `ClassifierDeps`), and in `projects.ts` before the user's chat move; call `resetGoals` after `removeCompletions` on reopen.
- [ ] **Step 10: Verify** `npm run typecheck` and `npm test` — Expected: clean, all pass. Run `npm run shots` — Expected: same screenshots as before (no visible change).
- [ ] **Step 11: Commit** `feat(engine): earned stays earned — kept progress marks per room`.

### Task 2: The item library, and rooms built at runtime

**Files:**
- Create: `catalog/library.json`, `src/shared/rooms.ts`, `tests/fixtures/rooms.ts`
- Delete: `catalog/rooms/coding.json`, `catalog/rooms/music.json`, `catalog/rooms/art.json`
- Modify: `src/shared/catalog/schema.ts`, `src/shared/catalog/validate.ts`, `src/main/catalog/loader.ts`, `catalog/rooms/mailroom.json`, `src/renderer/src/styles.css`, `src/renderer/src/theme.ts`, `src/renderer/src/components/PalaceCanvas.tsx` (`accentOf`), `ActivityStrip.tsx`, `ChatView.tsx`, `tests/helpers.ts`
- Test: `tests/catalog.test.ts`, `tests/rooms.test.ts`, `tests/theme.test.ts`

**Interfaces:**
- Produces: `libraryFileSchema` (items = the `items.json` shape plus `areas: string[]` (min 1, lower-case area keys) and optional `slot` hint); `LibraryItem = ItemDef & { areas: string[]; slot?: string }`; `Catalog.library: Record<string, LibraryItem>` (also merged into `Catalog.items`); `RoomDef` gains `cell: [number, number]` and `area: string | null`, and `accent` becomes a token name matching `/^mp-room-[a-z0-9-]+$/`; `catalogWithRooms(base: Catalog, rooms: readonly RoomDef[]): Catalog` (throws on a duplicate id or cell); `ROOM_ACCENTS = 8`; `accentToken(index: number): string` → `mp-room-accent-${index}`.

- [ ] **Step 1: Write failing tests.** `tests/catalog.test.ts`: the loader returns `library` with every former coding/music/art asset tagged `software`/`music`/`art`, and at least 4 items tagged `finance` and 4 tagged `3d_printing`; a library item with an unknown slot kind, an empty `areas`, or an id clashing with `items.json` is an error naming `library.json` and the field; `catalog.rooms` holds only `mailroom`, with `cell [0,0]`, `area null`, `accent 'mp-room-mailroom'`. `tests/rooms.test.ts`: `catalogWithRooms` adds a room so `computeRoomState` works on it; rejects a duplicate id and a duplicate cell; `accentToken(3) === 'mp-room-accent-3'`. `tests/theme.test.ts`: every `mp-room-accent-0..7` token is defined in `styles.css`, light and dark.
- [ ] **Step 2: Run** `npx vitest run tests/catalog.test.ts tests/rooms.test.ts tests/theme.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Move the three rooms' assets into `library.json` with their area tag and a `slot` hint (their old slot), and add placeholder items for finance (e.g. ledger book on the desk, safe, wall chart, coin jar, calculator) and 3D printing (printer, filament wall rack, spool bin, calipers, print shelf), each with `layer`, footprint/width, `height`, `slots`. Loader reads `library.json`; `crossValidateCatalog` checks library ids, kinds and clashes. `roomSchema.accent` becomes the token regex; `mailroom.json` gets `"accent": "mp-room-mailroom"`, `"cell": [0, 0]`. `styles.css` replaces `--mp-room-coding/music/art` with `--mp-room-accent-0..7` (keep the three old colours as 0–2), in both themes. Renderer reads `var(--${accent})` / `readToken(accent)`; drop the hex fallback.
- [ ] **Step 4: Rebuild the test catalog.** `tests/fixtures/rooms.ts` exports `CODING`, `MUSIC`, `ART` `RoomDef`s with the old signatures (using library ids), classifier text, accents `mp-room-accent-0..2`, and cells `CODING [-1,-1]`, `ART [0,-1]`, `MUSIC [-1,0]`. `tests/helpers.ts` exports `catalog = catalogWithRooms(loadCatalog(CATALOG_DIR), [CODING, MUSIC, ART])`.
- [ ] **Step 5: Run** `npm test` — Expected: PASS, including all existing tests that name `coding`.
- [ ] **Step 6: Commit** `feat(catalog): item library tagged by area; placeholder rooms leave the catalog`.

### Task 3: Rooms in the database

**Files:**
- Modify: `src/main/db/schema.ts` (+ `drizzle/0006_*.sql`), `src/main/index.ts`, `src/main/palace/view.ts`, `src/main/palace/projects.ts`, `src/main/palace/classifier.ts`, `src/shared/agents.ts` (only if it lists room ids), `src/shared/palace.ts`
- Create: `src/main/palace/roomsRepo.ts`
- Modify: `src/shared/rooms.ts`
- Test: `tests/rooms.test.ts`, `tests/palace.test.ts`

**Interfaces:**
- Consumes: `catalogWithRooms`, `RoomDef` (Task 2).
- Produces: tables `rooms(id PK, name, area, accent int, cell_x, cell_y, signature json, classifier json, created_at)`, `area_suggestions(area PK, display_name, dismissed_at, dismissed_count)`; columns `chats.area`, `chats.area_name` (nullable). `RoomRow` type; `roomDefFromRow(row: RoomRow): RoomDef` (signature entries `{ item, slots }[]` in order → `n = index + 1`, `unlock = n === 1 ? 'start' : 'streak'`; `accent` index → `accentToken(index)`; `cell = [cell_x, cell_y]`). `createRoomsRepo(db) → { rows(): RoomRow[]; insert(row: RoomRow): void; rename(id: string, name: string): void; dismissed(): Array<{ area: string; dismissedCount: number }>; dismiss(area: string, displayName: string, count: number, at: string): void }`. In `index.ts`: `currentCatalog(): Catalog` = `catalogWithRooms(fileCatalog, roomsRepo.rows().map(roomDefFromRow))`; every consumer takes a function, not a snapshot (`createPalaceView({ catalog: currentCatalog })`, classifier `rooms: () => ClassifierRoom[]`, projects `roomIds: () => string[]`, `status()`).

- [ ] **Step 1: Write failing tests.** `tests/rooms.test.ts`: `roomDefFromRow` makes n=1 `start` and n=2.. `streak`; keeps `slots` arrays; a row with 0 signature entries is valid (base furniture only); `classifier` JSON becomes `belongs/not_here/examples`. `tests/palace.test.ts`: `buildPalace` with a chat row whose `roomId` is `'gone'` (no such room) does not throw and that chat counts for no room.
- [ ] **Step 2: Run** `npx vitest run tests/rooms.test.ts tests/palace.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `roomDefFromRow`; make `buildRoomEvents`/`buildPalace` skip rooms not in the catalog (check that `computeRoomState` is only called for catalog rooms; events for unknown rooms are simply never read).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Migration.** Add the tables/columns; `npm run db:generate`; then append to `0006_*.sql` the data fix: chats, projects and `goal_completions` with `room_id` in `('coding','music','art')` → `'mailroom'` (chats keep `area` NULL); delete their `placements` and `room_progress` rows and `palace.seen.*` settings for those ids.
- [ ] **Step 6: Wire** `roomsRepo` and `currentCatalog()` through `index.ts`, `view.ts`, `classifier.ts`, `projects.ts`.
- [ ] **Step 7: Verify** `npm run typecheck`, `npm test`; then migrate a copy of the dev DB (`--user-data-dir` to a temp copy, as in phase 4's migration check) and confirm with `node:sqlite` that no row references `coding|music|art`. Expected: 0 rows. `npm run shots` — Expected: the empty palace shows the Mail room alone.
- [ ] **Step 8: Commit** `feat(rooms): rooms live in the database; Mail room is the only seeded room`.

### Task 4: A palace that grows on a grid

**Files:**
- Modify: `src/shared/floor.ts`, `src/shared/palace.ts`, `src/renderer/src/components/PalaceCanvas.tsx`
- Test: `tests/floor.test.ts`, `tests/camera.test.ts`

**Interfaces:**
- Consumes: `RoomDef.cell` (Task 2).
- Produces: `type Cell = readonly [number, number]`; `nextCell(occupied: readonly Cell[]): Cell`; `buildFloor(catalog, rooms, focus, ethereal?: { cell: Cell; name: string } | null)`; `FloorRoom.cell`; `FloorView.halls` from neighbour pairs; `FloorView.ethereal: { origin: readonly [number, number]; name: string } | null`; `FloorView.lobby: readonly [number, number]`; `FloorView.doors: Record<string, readonly [number, number]>`; `roomAt(floor: FloorView, x, y): string | null`. `ROOM_ORIGIN` and `PALACE_TILES` are removed. Cell → origin: `((cx - minCx) * 10, (cy - minCy) * 10)` over the occupied cells plus the ethereal cell.

`nextCell` order (cells behind and beside the Mail room only, all `cx ≤ 0, cy ≤ 0`): by ring `k = max(-cx, -cy)` ascending, then `-(cx + cy)` ascending, then `cx` descending; the first unoccupied cell that touches an occupied one. From `[[0,0]]` that gives `[-1,0]`, `[0,-1]`, `[-1,-1]`, `[-2,0]`, `[0,-2]`, `[-2,-1]`, `[-1,-2]`, `[-2,-2]`.

- [ ] **Step 1: Write failing tests** in `tests/floor.test.ts`: the `nextCell` sequence above; with only the Mail room the floor is 8×8, `halls` is empty and the Mail room's back walls are full height; with the test catalog's 4 rooms each room's `origin` equals today's (`coding [0,0]`, `art [10,0]`, `music [0,10]`, `mailroom [10,10]`) and walls match today's; a back wall is low exactly when a cell neighbours it on that side; a front wall exists only toward a neighbour and is low; adding a fifth room (cell `[-2,0]`) doesn't change any existing room's cell, and shifts every origin by the same amount; each neighbour pair has one hall rectangle 2 tiles wide between them; `ethereal` gets the origin of its cell and grows the bounds; `roomAt(floor, …)` finds each room and returns null in a hall.
- [ ] **Step 2: Run** `npx vitest run tests/floor.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** in `floor.ts`; `buildPalace` passes each room's cell and the top suggestion's cell (from Task 6; pass `null` until then).
- [ ] **Step 4: Run** `npx vitest run tests/floor.test.ts tests/camera.test.ts` — Expected: PASS.
- [ ] **Step 5: Canvas.** Draw halls from `floor.halls`; the lobby piece at `floor.lobby` only when there are halls; walkers use `doors` and `lobby`; `roomAt(floor, …)`; the ethereal room as a translucent floor plus outline in the accent it would get, with a name pill (tokens only).
- [ ] **Step 6: Verify** `npm run typecheck`, `npm test`, `npm run shots` — Expected: the furnished 4-room fixture looks as before; a 5-room fixture shows the new room at the back left, joined by a hallway.
- [ ] **Step 7: Commit** `feat(floor): grid of cells growing behind the Mail room`.

### Task 5: The classifier tags each chat's area

**Files:**
- Modify: `src/shared/classify.ts`, `src/main/palace/classifier.ts`, `src/main/palace/repo.ts`
- Test: `tests/palace.test.ts` (classifier section)

**Interfaces:**
- Consumes: `rooms: () => ClassifierRoom[]` (Task 3).
- Produces: `areaKey(name: string): string` (trim, lower-case, runs of non-alphanumerics → `_`, strip edge `_`; `"3D printing"`, `"3d-printing"`, `" 3D Printing "` → `3d_printing`); `classificationSchema` and its JSON schema gain `area: string` and `area_name: string`; `buildClassifierPrompt({ …, knownAreas: Array<{ key: string; name: string }> })`; `Classification.area: { key: string; name: string } | null` (null when the key normalises to empty); `areaChange(chat: { area: string | null }, result): { key; name } | null` (only when the chat has none). Repo: `setArea(chatId, key, name)`, `knownAreas(): Array<{ key; name }>` (distinct from chats plus rooms' areas, rooms first); `ChatClassificationRow.area`.

- [ ] **Step 1: Write failing tests:** `areaKey` on the three variants above → `3d_printing`; `areaKey('  ')` → `''`; the prompt lists each known area as `key — name` and tells the model to reuse one when it fits; `interpretClassification` maps `area`/`area_name` to `{ key, name }`, and to null for an empty key; `areaChange` returns null when the chat already has an area and the area otherwise; a raw answer missing `area` fails `classificationSchema`.
- [ ] **Step 2: Run** `npx vitest run tests/palace.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** in `classify.ts`; in `classifier.ts` pass `knownAreas: repo.knownAreas()` and, inside the existing transaction, `repo.setArea` when `areaChange` returns one.
- [ ] **Step 4: Run** — Expected: PASS. `npm run typecheck` clean.
- [ ] **Step 5: Commit** `feat(classifier): tag every chat with its area of life`.

### Task 6: Suggesting, materialising and finding rooms

**Files:**
- Create: `src/shared/suggest.ts`, `src/shared/roomPrompts.ts`, `src/main/palace/roomService.ts`
- Modify: `src/main/palace/roomsRepo.ts`, `src/main/palace/repo.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`, `src/main/index.ts`, `src/shared/palace.ts`
- Test: `tests/suggest.test.ts`, `tests/roomPrompts.test.ts`

**Interfaces:**
- Consumes: `areaKey` (Task 5), `nextCell` (Task 4), `accentToken`, `roomDefFromRow`, `RoomRow` (Tasks 2–3), keeper `record()` (Task 1).
- Produces:
  - `SUGGEST_AT = 3`, `RETURN_AFTER = 5`; `suggestRooms(chats: ReadonlyArray<{ roomId: string | null; area: string | null; areaName: string | null; lastMessageAt: string | null }>, roomAreas: readonly string[], dismissed: ReadonlyArray<{ area: string; dismissedCount: number }>, mailRoomId: string): Suggestion[]`, `Suggestion = { area: string; name: string; chats: number; lastAt: string | null }`, sorted by `chats` desc then `lastAt` desc; `name` = most common `areaName`.
  - `projectsToMove(projects: ReadonlyArray<{ id: string; chatIds: string[] }>, roomOfChat: (chatId) => string | null, roomId: string): string[]` — projects with more than half their chats in `roomId`.
  - `buildMaterializePrompt({ area, name, chats: Array<{ title; firstMessage }>, library: LibraryItem[] })`, `materializeSchema` (`name`, `belongs`, `not_here`, `examples: string[] (1–4)`, `items: Array<{ item: string; slot: string }>`), `interpretMaterialize(raw, catalog): { name; classifier; signature: Array<{ item; slots: [string] }> }` — keeps at most 5 picks, in order, dropping any unknown item, slot not in the layout, slot that doesn't `fits`, host slot, or slot already used.
  - `buildGroupingPrompt({ sessions: Array<{ id; title; firstMessage }>, knownAreas })`, `groupingSchema` (`areas: Array<{ key; name; session_ids: string[] }>`), `interpretGrouping(raw, sessionIds): Map<chatId, { key; name }>` — unknown ids dropped, a session in two areas keeps the first.
  - `PalaceView.suggestions: Suggestion[]` and `PalaceView.ethereal: { area; name; chats; cell } | null` (the top suggestion at `nextCell`).
  - `createRoomService({ store, roomsRepo, palaceRepo, keeper, catalog: () => Catalog, askModel, onChanged }) → { materialize(area: string, name?: string): Promise<string /* roomId */>; dismiss(area: string): void; rename(roomId: string, name: string): void; findAreas(): Promise<number /* chats tagged */> }`.
  - IPC: `rooms:materialize {area, name?} → PalaceView`, `rooms:dismiss {area} → PalaceView`, `rooms:rename {roomId, name} → PalaceView`, `rooms:find {} → { tagged: number; view: PalaceView }`.

- [ ] **Step 1: Write failing tests** in `tests/suggest.test.ts`: 2 Mail-room chats in an area → no suggestion, 3 → one; chats outside the Mail room don't count; an area that already has a room is left out; dismissed at 3 → hidden at 7, shown at 8; spelling variants count as one area (keys come pre-normalised; the name is the most common display name); sort order; `projectsToMove` moves at 2 of 3 chats, not at 1 of 2.
  `tests/roomPrompts.test.ts`: `interpretMaterialize` keeps valid picks in order; drops an unknown id, a wrong-kind slot, a host slot (`desk`), a repeated slot; caps at 5; returns an empty signature when nothing is valid; `interpretGrouping` drops unknown session ids and double assignments; the grouping prompt lists the known areas; both schemas reject a missing field.
- [ ] **Step 2: Run** `npx vitest run tests/suggest.test.ts tests/roomPrompts.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `suggest.ts` and `roomPrompts.ts`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Implement `roomService.ts`.** `materialize`: refuse if a room with that area exists (throw "There is already a room for …"); ask Haiku once (titles + first user message of up to 20 of the area's chats); on an invalid answer throw and change nothing; then in one transaction: `keeper.record()`, insert the room (id = `areaKey(name)` with a numeric suffix if taken, accent = lowest unused index mod 8, cell = `nextCell`), move the area's Mail-room chats (`room_source = 'model'`), move `projectsToMove` projects and their `goal_completions`. `dismiss`: upsert `area_suggestions` with the current count. `rename`: trims, 1–40 chars. `findAreas`: chunks of 60 Mail-room chats, passing known areas forward; writes `area` only for Mail-room chats (the batch may rewrite them).
- [ ] **Step 6: Wire** IPC + preload + `buildPalace` suggestions/ethereal.
- [ ] **Step 7: Verify** `npm run typecheck`, `npm test` — Expected: clean, all pass.
- [ ] **Step 8: Commit** `feat(rooms): suggest, materialise, dismiss, rename and find rooms`.

### Task 7: Palace UI for suggestions

**Files:**
- Modify: `src/renderer/src/components/PalaceView.tsx`, `PalaceCanvas.tsx`, `PalaceList.tsx`, `roomArt.ts`, `src/renderer/src/store.ts`, `scripts/palace-shots.mjs`
- Test: `tests/palaceView.test.ts`

**Interfaces:**
- Consumes: `PalaceView.suggestions`, `PalaceView.ethereal`, `rooms:*` IPC (Task 6), `FloorView.ethereal` (Task 4).

- [ ] **Step 1: Write failing tests** in `tests/palaceView.test.ts` for the pure helpers this task adds to `src/shared/palace.ts`: `suggestionText(s)` → `"3D printing · 4 chats"`; `etherealLabel(view)` is null without suggestions.
- [ ] **Step 2: Run** — Expected: FAIL. **Step 3: Implement** — **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: UI.** Over the ethereal room (HTML positioned like the labels): name (editable text field), "4 chats about this", **Materialize** and **Dismiss**; a busy state while the model call runs; the error text if it fails. A "Possible rooms" list (other suggestions, each with the same two buttons). A **Find my rooms** button in the palace header (shown when the Mail room has untagged chats), with a busy state and "Tagged N chats". **Rename** on a focused room. A just-materialised room plays the existing lights-on fade (reduced motion: none). `roomArt.ts`: rooms without a painting use `atrium.jpg` as header; helpers fall back to the Mail room helper. List view shows suggestions as "Possible room".
- [ ] **Step 6: Shots.** Add a `dynamic` fixture to `palace-shots.mjs`: Mail room + Software + Finance + an ethereal 3D printing suggestion; and an `materialize` drive that clicks Materialize with a stubbed model answer (set `MP_FAKE_MODEL` — if the app has no stub hook, add one in `askJson` read only when `NODE_ENV !== 'production'`). Expected: a screenshot with the ethereal room, then one with it solid, and the room survives a restart.
- [ ] **Step 7: Verify** `npm run typecheck`, `npm test`, `node scripts/palace-shots.mjs dynamic` — Expected: clean, pass, screenshots look right.
- [ ] **Step 8: Commit** `feat(palace): ethereal rooms with Materialize, Find my rooms, rename`.

### Task 8: First import and the eval

**Files:**
- Modify: `scripts/import-into-app.py`, `scripts/eval.ts`, `src/shared/evalMetrics.ts`, `scripts/eval-sample.jsonl`
- Create: `scripts/eval-rooms.json`
- Test: `tests/palace.test.ts` (eval metrics section)

**Interfaces:**
- Produces: `EvalCase.area: string`; `areaAgreement(outcomes): number` — share of case pairs where "same expected area" equals "same model area key" (failed calls count as disagreeing); `EvalScore.areaAgreement`.

- [ ] **Step 1: Write failing tests:** `parseEvalLine` requires `area`; `areaAgreement` is 1 when the model groups exactly as labelled under different names, 0.5-ish on a known mixed case (write the exact fraction for a 4-case fixture), and counts a failed call as disagreeing.
- [ ] **Step 2: Run** — Expected: FAIL. **Step 3: Implement** — **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Data.** `eval-rooms.json`: Software, Music, Art rooms with the old classifier text; `eval.ts` builds the classifier rooms from it plus the Mail room. In `eval-sample.jsonl`, `coding` → `software`, add `area` to all 12 cases. `import-into-app.py`: every chat goes to `mailroom` with `room_source 'model'`, `classified_at` = now (so the quiet pass doesn't re-run 21 classifications), `area` NULL; projects and completions go to `mailroom`; ignore `labels.jsonl` rooms.
- [ ] **Step 6: Verify** `npm test`; `PYTHONUTF8=1 python scripts/import-into-app.py --dry-run` — Expected: "chats per room: {'mailroom': 21}".
- [ ] **Step 7: Commit** `feat(import): first import lands in the Mail room; eval scores areas`.

### Task 9: Notes and the end-to-end check

**Files:**
- Modify: `NOTES.md`, `docs/HANDOFF.md` (only the rooms paragraph)

- [ ] **Step 1:** Run the import into a **temporary copy** of the database (not the real one), open the app on it, press **Find my rooms**, and check the suggestions: Software, Finance and 3D printing expected, smaller topics left in the Mail room. Materialise one; check its chats moved and the Mail room kept its items. This makes real Haiku calls (about 2).
- [ ] **Step 2:** `npm run eval` — Expected: room accuracy ≥ 0.85; record area agreement in NOTES.
- [ ] **Step 3:** Update NOTES.md (what changed, the rulings above, deferred items) and commit `docs: dynamic rooms notes`.
- [ ] **Step 4:** Ask Claudio before applying the import to the real database (quit the app first) and before pushing.
