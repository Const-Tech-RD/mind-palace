# What Mind Palace borrows from other visual agent harnesses

Source review of three MIT-licensed projects, cloned and read on 2026-11-15. Keep their copyright notice on anything copied. The decisions that came out of this are already written into `plan-v2.md`; this file is the reference behind them, with the file paths to read.

- StarNet: https://github.com/androoAGI/starnet (full harness, own agent loop)
- Pixel Agents: https://github.com/pablodelucca/pixel-agents (visualizer over coding CLIs)
- OpenClaw Office: https://github.com/WW-AI-Lab/openclaw-office (front end for the OpenClaw gateway; dormant since June 2026)

## Adopted in plan v2

| Idea | Source file | Where it lands in the plan |
| --- | --- | --- |
| Gear as a pure resolver: objects in a room grant tools; recomputed before every model call; grants are data `{tool, scope: read/write/execute, requiresConsent, network}` | StarNet `sidecar/capability/resolve.js`, `registry.js` | Phase 13, Gear |
| Always-on basics on one object every room has | StarNet `sidecar/capability/registry.js` (`computer`) | Phase 13 (the desk) |
| Shadow git checkpoints: git dir outside the work folder; snapshot = commit; autocrlf off; fail-open; pre-restore snapshot | StarNet `sidecar/checkpoint-store.js` | Phase 12, Undo |
| Consent ladder: hard deny, full access, remembered grants, read-only auto-allow; unattended runs deny | StarNet `sidecar/permissions.js` | Phase 6 |
| Standing grants panel with revoke; only local file writes are pre-grantable | StarNet `sidecar/permgrants.js` | Phase 6 |
| Emergency stop that aborts every run and records why | StarNet `sidecar/halt.js` | Phase 6 |
| Append-only ledger; unpriced runs stay "unsettled" | StarNet `sidecar/ledger.js` | Phase 10 (in tokens) |
| Earned autonomy: offers, never grants; demotes on bad streaks; hard ceilings | StarNet `frontend/app/trust.js` | Phase 14 |
| Frozen, additive-only, schema-checked event contract | StarNet `shared/events.js` | Phases 6 and 9 |
| Canonical event set: toolStart/End, subagentStart/End/TurnEnd, turnEnd (awaitingInput), permissionRequest, progress, sessionStart/End | Pixel Agents `core/src/provider.ts` | Phases 6 and 9 |
| Status vocabulary: active, or done / waiting for input / waiting on permission; permission bubble persists; wander only when done | Pixel Agents `CONTEXT.md` | Phase 7 |
| Plan usage windows (5-hour, 7-day) via a status-line script | Pixel Agents `server/src/providers/hook/claude/claudeUsageBridge.ts`, `server/src/usageLimits.ts` | Phase 10 (check the SDK first) |
| Event throttling: start/end/error immediate, rest batched per frame, queue capped 500 → 200 | OpenClaw Office `src/lib/event-throttle.ts` | Phase 4 |

## Reference for later (not scheduled)

| Idea | Source |
| --- | --- |
| Context gauge per session, read from the newest turn | Pixel Agents `CONTEXT.md` (Context gauge) |
| Silhouettes for characters behind walls | Pixel Agents `CONTEXT.md` (Silhouette, Diorama view) |
| Sub-agents stand near their parent; named teammates get seats | Pixel Agents `CONTEXT.md` (Sub-agent, Teammate) |
| Folder mapped to areas; agents prefer seats there | Pixel Agents `CONTEXT.md` (Area mapping) |
| Furniture catalog fields: footprint, desk, sits-on-surfaces, on-walls, mirrored | Pixel Agents `webview-ui/src/office/types.ts` |
| Collaborating agents gather at a table; links expire after 60 s | OpenClaw Office `src/store/meeting-manager.ts` |
| Positions and looks derived from a hash of the agent id | OpenClaw Office `src/lib/position-allocator.ts`, `avatar-generator.ts` |
| Activity heatmap (use as a calendar of room days for streaks) | OpenClaw Office `src/components/panels/ActivityHeatmap.tsx` |
| Mock mode flag for developing the UI on simulated events | OpenClaw Office (`VITE_MOCK`), README "Mock Mode" |

## Avoid

- StarNet's single 6,500-line `sidecar/index.js` and its no-build-step frontend.
- Pixel Agents' heuristic mode (status guessed from transcripts); we own the SDK stream.
- Any paid or pixel-art tileset (Pixel Agents' office tileset is third-party and not redistributable).
- Rendering many animated characters as React-driven SVG (OpenClaw Office); use PixiJS.
