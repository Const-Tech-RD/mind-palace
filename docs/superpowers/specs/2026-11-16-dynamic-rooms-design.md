# Dynamic rooms: design

Date: 2026-11-16 · Builds on: phase 4 (`feat/phase4-palace`, PR #4) · Supersedes plan v2's fixed four rooms

## Intent

A room is an **area of the person's life**, not a project. The four rooms in the repo (Coding room, Music studio, Art workshop, Mail room) were placeholders to build against. A person's palace should hold the areas they actually spend time on, discovered from their own chats. For example, Claudio's history gives Software, Finance and 3D printing. Projects live inside rooms: ContractOS, the ONI app, Dr Samir, RD Local Leads and Mind Palace are all projects in one Software room.

Why: the palace is meant to be a picture of your life that grows with it. Fixed rooms leave some rooms empty (Claudio has no music or art chats) and cram unrelated areas into others.

## Goals

- A palace starts with **only the Mail room**, the permanent catch-all.
- **First import** looks at the whole history at once and proposes the areas it finds as rooms.
- **Afterwards**, when **3** chats in the Mail room share an area that has no room, an **ethereal room** appears next to the palace with a **Materialize** button. Nothing becomes a room without the person's click.
- Rooms keep everything phase 4 built: the 8 × 8 slot layout, streaks, goals, decay, placements and the room editor.
- Each room gets up to **five signature items picked from a library** of hand-drawn items tagged by area. The base set fills in when the library has nothing that fits.
- The palace **grows**: new rooms take the next free spot, and hallways extend to reach them.

## Non-goals (this round)

- Merging rooms that drift together, or splitting a room. Noted for "the distant future".
- Fancy layouts. A plain growing grid is enough.
- New sprite art. Library items are placeholder blocks until drawn, like everything else today.
- Rooms per project. A project is always inside a room.

## Anti-goals (would be a failure even if it works)

- A room appearing without the person's say-so.
- The palace reshuffling: an existing room moving to another spot, or a materialised room changing its look or items on its own.
- Every chat spawning a new area name ("3D printing", "3D printer setup", "Bambu"): area drift that fragments the Mail room.
- Losing the phase 4 rule: the engine never moves, hides or removes what the user placed.

## Decisions taken in conversation

| Topic | Decision |
|---|---|
| What a room is | An area of life. Projects live inside. Areas that each exist without the other are separate rooms (Finance and 3D printing are two). |
| Unmatched chats | Go to the Mail room. |
| When a room is suggested | 3 Mail-room chats tagged with the same area that has no room. |
| Who creates it | The person, with the Materialize button on an ethereal room. The first import works the same way. |
| Signature items | Picked by the model from a library tagged by area (option 2). Base set only when nothing fits. |
| Noticing areas (live) | The classifier call that files each chat also names its area, reusing an existing area name when it fits. |
| Noticing areas (first import) | One batch call over the whole history groups sessions into areas. |
| Layout | Simple; hallways extend to new rooms. |
| Earned items | **Earned stays earned.** An unlock is stored when it happens. Moving chats out of a room (materialising, or the classifier refining) never takes away what that room already earned. The receiving room builds its own streak from the chats it gets. |

## Approaches considered for noticing areas

1. **Tag each chat as it is filed** (chosen for live use). The existing Haiku classifier call also returns an `area`. It is cheap and immediate. Naming drift is the risk; it is handled by showing the call the known area names first.
2. **Regroup the Mail room periodically.** Better groupings, but slower and costlier per run. Chosen **only for the first import**, where the whole history arrives at once.
3. **Local embeddings and clustering.** Rejected: it ships an embedding model and still needs names.

## Calls I made (Claude). Correct any of these.

- **Threshold:** 3 unmatched chats. A **dismissed** ethereal room stays hidden until **5 more** chats arrive in that area.
- **Naming:** the model proposes a short room name (e.g. "3D printing"). The person can rename it before materialising and at any time after.
- **Colour:** accents come from a fixed, ordered palette of `--mp-room-accent-N` tokens (8 to start). A new room takes the next unused one. Themes swap the tokens, never per-room hex.
- **Growth:** the Mail room is the front door: the cell nearest the viewer. New rooms only fill cells **behind and beside it** (toward the back corner in today's `floor.ts`, i.e. lower x or y), in a fixed order, so nothing ever stands in front of the Mail room and front walls never need new rules. Every cell is 8 × 8 and cells are 2 tiles apart. Hallway tiles run between neighbouring occupied cells. Walls facing a hallway are low, as now. A room never changes cell once materialised.
- **Signature steps:** the materialise call returns up to five library items **in order**; list position is `n`. Each keeps the base ladder's unlock (n=1 at start, n=2–5 at streak days 3, 8, 21, 34). A missing step gets the base item for that step. The model never sets `replaces`. Library items join `Catalog.items` as global items, so `heightOf` and the editor find them.
- **Area is sticky:** once a chat has an area it keeps it. The live classifier only fills an empty area; the batch grouping fills and can rewrite areas only for chats still in the Mail room. Moving a chat by hand doesn't change its area.
- **First import uses the same threshold:** an area the batch call finds with fewer than 3 chats stays in the Mail room as a tag, like any other. "Find my rooms" can be run again; it only touches Mail-room chats.
- **Which projects move:** a project moves with the new room when most of its chats are now in it. Its finished goals (`goal_completions.room_id`) move with it.
- **Eval:** I hand-label an area key on each case in `scripts/eval-sample.jsonl`. Area agreement is scored on pairs (two cases in the same labelled area should get the same model area, and vice versa), so naming doesn't matter, only grouping. `roomAccuracy` and its 0.85 target are dropped with the old rooms; the eval reports Mail room vs. not-Mail-room instead.
- **Ethereal room:** drawn in the next free cell as a translucent outline with its proposed name, area summary and chat count, plus Materialize and Dismiss. Only the top suggestion shows in the palace at once; others wait in a short list.
- **When it materialises:** the chats that earned it move into it (`room_source = model`, so the classifier may refine later), along with their projects. The new room starts with their streak days and finished goals.
- **Placeholder rooms:** the Coding room, Music studio and Art workshop go away. Their signature items move into the library, tagged `software`, `music` and `art`. The Mail room keeps its own file and items.
- **Existing databases** (dev only so far): chats in removed rooms go back to the Mail room with their area unset, and the next classifier pass tags them.

## The design

### Data

- **`rooms` table** (new): `id` (slug), `name`, `area` (the area key it was made from), `accent` (palette index), `cell_x`, `cell_y`, `signature` (JSON: up to five `{n, item, slot | slots, replaces?}` entries, same shape as today's room files), `classifier` (JSON: `belongs`, `not_here`, `examples`, written by the model at materialise time, editable later), `created_at`. The Mail room is seeded from `catalog/rooms/mailroom.json` at first start.
- **`room_unlocks`** (new): `room_id`, `n` (signature step) or base step, `unlocked_at`. Written when the engine first finds a step earned. `computeRoomState` unions stored unlocks with what the room's current chats earn, so a room's items never shrink. Streak numbers shown (current, best) are still derived from the room's current chats; only the unlocks are kept. This lands first, before rooms move to the database.
- **`chats.area`** (new, nullable): the area name the classifier gave the chat. Stored normalised as a lower-case key plus the display name.
- **`area_suggestions`** (new): `area`, `display_name`, `dismissed_at`, `dismissed_count` (chats in the area when dismissed). It exists only to remember dismissals; counts are always derived from `chats`.
- **Catalog:** `catalog/rooms/` keeps only `mailroom.json`. The library is `catalog/library.json`: items with layer, footprint or width, height, slot kinds and variants (the `items.json` shape) plus `areas: string[]` tags and an optional `slot` hint. `rules.json` keeps the base ladder and the shared 8 × 8 slot layout.
- `Catalog.rooms` is no longer read from files alone. A `RoomDef` comes from a `rooms` row (plus the Mail room file), so `computeRoomState`, `buildPalace` and the classifier take the rooms from the database.

### Classifier

- The prompt lists the materialised rooms (from their `classifier` text) and the **known area names** (from `chats.area` plus the rooms' areas).
- The answer gains `area` and `area_name`: reuse a known area key when it fits, else coin a short new one. `room_id` falls back to the Mail room as today.
- A chat in the Mail room whose area matches a room's area is **not** moved automatically; the room's classifier text should catch it. Revisit if that misses too often.
- The eval (`npm run eval`) gains an area-agreement number on the import set.

### Suggesting rooms (pure)

`suggestRooms(chats, rooms, suggestions): Suggestion[]` returns the areas with at least 3 Mail-room chats and no room. It leaves out dismissed areas until their count grows by 5, and sorts by chat count, then recency. Tested without a database.

### Materialising (main process)

1. A Haiku call takes the area's chats (titles and first user messages) and returns: room name, `belongs`/`not_here`/`examples`, and up to five library item ids with slots. The ids are validated against the library and the slot layout. A pick that doesn't fit is dropped, and the base set covers the gap.
2. Insert the `rooms` row with the next accent and the next cell.
3. Move the area's Mail-room chats and their projects to the new room.
4. Refresh the palace; the room appears with a short "materialised" moment.

### First import

`import-into-app.py` keeps doing the extraction and insertion, with all chats going into the Mail room. A new batch step (in the app, from a "Find my rooms" action, or as `npm run import:areas`) sends all imported sessions to the model at once. The model returns areas with their sessions and names; these are written into `chats.area`. The rooms then show as ethereal suggestions (all of them, as a list) for the person to materialise one by one.

### Palace

- `floor.ts`: `ROOM_ORIGIN` is replaced by `cellOrigin(cell)`, and the hallway tiles are computed from the occupied cells. Bounds come from the occupied cells. The camera already fits any bounds.
- Low-wall rules stay: a wall is full height only where no cell neighbours it, so it's an outer wall; otherwise it's low. Focus still raises a room's back walls.
- The ethereal room is drawn in the canvas (outline, translucent floor, name pill). Its buttons are HTML over the canvas, like the labels.

## Left to the builder

- Spiral order details and the hallway tile algorithm, within "grid cells 2 tiles apart; nothing moves once placed".
- Exact prompts for the area tag, the batch grouping and the materialise call. They must return JSON validated with zod, like today's classifier.
- How the "materialised" moment looks, using the style-guide tokens.
- Initial library contents beyond the moved signature items. At minimum add a few for finance and 3D printing so Claudio's rooms aren't bare (placeholders, no art needed).

## Risks

- **Area drift.** Mitigated by listing known areas in every call and by the 3-chat threshold. Measure it with the eval set.
- **Cost.** One extra field on an existing call; the materialise and batch calls are rare.
- **Stored unlocks vs. a changed signature.** If a room's signature is edited later, a stored step points at the new item for that step. Keyed by step, not item id, for that reason.
- **The engine assumes catalog rooms.** `computeRoomState` reads `rules.rooms[roomId]`. Moving rooms to the database touches every caller, so do it first, behind tests, with the Mail room alone.
