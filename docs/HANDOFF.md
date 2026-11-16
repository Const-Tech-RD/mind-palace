# Handoff: Mind Palace plan v2 → this repo

Read this first, then `plan-v2.md`. The plan is the source of truth for scope and phases; this file says what to change in the code you already have and where.

## Decisions

1. **Connected palace, rendered in PixiJS.** Four 8 × 8 rooms in a 2 × 2 grid joined by 2-tile hallways, with characters walking between them. It replaces `PalaceHub.tsx`, `PalaceView.tsx` and `roomArt.ts`.
2. **Hand-drawn sprites, separate per object,** per `asset-spec.md` v0.2. The existing paintings in `assets/rooms/*.jpg` stay as the style reference and as the room header image; they are not the room view.
3. **Customization is the selling point.** Unlocked items go to an inventory. The user places them in any compatible slot, moves, swaps variants or hides them. Placements are persisted. The engine never moves or removes what the user placed.
4. **Keep:** palace-as-home, the Cmd+K bar, the import scripts, the eval set, `NOTES.md`.
5. **Placeholder blocks first.** Everything must work before a single sprite exists.

## Where to look

| Area | Files | Change |
|---|---|---|
| Theme | `src/renderer/src/styles.css` | Replace the purple theme with the tokens in `style-guide.md` (bg `#2A1D16`, surface `#3B2A20`, parchment `#F3E6C8`, gold `#E8B84A`, room accents). Fonts: Fraunces, Nunito Sans, JetBrains Mono. |
| Palace renderer | new `PalaceCanvas` (PixiJS), new `src/shared/palace.ts` | `buildPalace(rooms, placements, sessions)` is pure and returns tiles, walls, items and characters with screen positions; the canvas only draws. |
| Layout | `catalog/rules.json` (`layout.slots`), `src/shared/catalog/schema.ts`, new `catalog/items.json` | Slots per room with kind (`floor`, `wall`, `desk_surface`…), footprint limits. Items list `slots`, `variants`, footprint, height (mirror the manifest). Validate with zod. |
| Placement | `src/shared/engine/unlocks.ts`, new `placements` table | Unlocks add to inventory; a default placement is suggested only for slots the user hasn't touched. |
| Decay | `decayLevel` in `src/shared/engine/roomState.ts` | Drives the overlay layer and room darkening (mostly dark, occasional flicker at the top level). |
| Sessions | a runner next to `src/main/chat/claude.ts` | Agent SDK `query()` per session; map the stream to the event contract in plan phases 6 and 9. |
| Data | `src/main/db/schema.ts` | New tables: `sessions`, `agents`, `approvals`, `events`, `placements`. |
| Characters | currently in `PalaceHub.tsx` | Move into the canvas: Nato per session, walnut-egg robot per sub-agent; status dots only on active characters; tooltips only on room hover. |

## Fixes found in review

- Sign-in command is `claude auth login --claudeai`.
- Don't leak the app's environment variables into the SDK child process; pass an explicit allow-list.
- Drop the `counted` column; derive counts from events.
- About 38k tokens per chat turn: trim the system prompt and tool list before adding features.
- Store the user's local day at write time (streaks and grace weekends depend on it).

## Bundle contents

- `plan-v2.md` and `plan-diagrams/` — the full plan.
- `mockups/` — 14 standalone HTML screens; open `mockups/index.html`. These are the visual target.
- `asset-spec.md` — sprite contract v0.2.
- `style-guide.md` — tokens and components.
- `research-borrow.md` — what we take from StarNet, Pixel Agents and OpenClaw Office, with source paths.
- `themes/sandstone-sanctum.md` — a designed, unscheduled theme; keep colours as tokens so themes can swap them.
