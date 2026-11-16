# Mind Palace: notes for phases 0 and 3

Scope built so far: phase 0 (skeleton) and phase 3 (progression engine) of the
implementation plan. No chat, Agent SDK, classifier, reminders, palace renderer
or packaging yet.

Commands: `npm install`, `npm run dev`, `npm run typecheck`, `npm test`,
`npm run build`, `npm run db:generate` (after changing `src/main/db/schema.ts`).

The catalog files under `catalog/` are byte-for-byte copies of the source rules
files. Nothing in them was edited; every disagreement below is handled in code.

## Decisions where the plan and the JSON disagree

The plan's "Core logic" wins in every case.

1. **Trophy shelf at 1 goal, but goal milestones are 2, 3, 5, 8, 13.**
   The shelf is treated as the fixture the first trophy stands on, not as a
   milestone. It unlocks at 1 counted goal, `goals.milestonesReached` stays
   `[]` until 2, and the "next unlock" for a room with 0 goals is
   `{ at: 1, milestone: false }`. The loader logs a warning for the step; a
   streak-ladder step off its milestone list is an error instead.

2. **Weekend grace is not in `rules.json`.** The plan's risk table says it is.
   The schema accepts an optional `tracks.streak.grace_weekdays` (weekday
   names) and defaults it to `["saturday", "sunday"]`, so today's file behaves
   as the plan describes and widening it is a one-line edit to the JSON. The
   engine reads only that field; nothing about weekends is hard-coded.

3. **`music.json` uses `"slots"` (array) for the speakers; everything else uses
   `"slot"`.** Both spellings are accepted (exactly one of them per step) and
   normalised to an array at load. The speakers are placed twice, in
   `desk_left` and `desk_right`.

4. **Mail room signature steps 1 and 2 are both `cardboard_box`.** Both copies
   are placed (`corner_right` at the start, `beside_seat` at a 3-day streak).
   Items are identified by item + slot, never by item alone, so the two boxes
   do not collide. Logged as a warning.

5. **Trophy shelf holds 5 trophies on a 2-tile-wide shelf.** Layout only. The
   engine places trophies as `trophy@trophy_shelf` with `index` 0 to 4 and
   leaves the spacing to the renderer. The count is capped by the smaller of
   `every_completion.max` and the slot's `capacity`.

## Other inconsistencies found

6. **Plant order.** `base_plant_large` (13 goals) replaces `base_plant_small`
   (13-day streak), both in slot `plant`. If the goals come first, a literal
   reading would put the small plant on top of the large one later. A
   replacement now wins in whichever order the tracks were climbed, and the
   small plant is never announced as a new item in that case.

7. **Footprints that do not match their slot.** `coding_arcade` and
   `art_pottery_wheel` are 1 x 1 but sit in `floor_right`, which is 2 x 1.
   Warning only; the renderer has to decide where in the slot they stand.

8. ~~**Base and shared items are not declared anywhere in the catalog.**~~ Closed in phase 4: `catalog/items.json` declares them, and every slot has a `kind`.
   `base_*`, `trophy`, `trophy_shelf` and `window` appear in `rules.json` by
   name only; their layer, footprint and height exist only in the asset spec's
   tables. Signature items are checked against the slot's layer; these cannot
   be.

9. **`trophy_shelf` is both an item id and a slot id** (the item goes in slot
   `wall_left_b`; trophies go in slot `trophy_shelf`, whose `host` is
   `wall_left_b`). Harmless, but easy to misread.

10. **Asset spec leftovers.** Its manifest example uses `coding_mic`, which is
    not an item (the mic is `music_mic`). "Bookshelf, tall" and "Side table"
    are in the base set but on no ladder. A door frame is a deliverable while
    doors between rooms are out of scope in the plan.

11. **`goal_completions.counted` can go stale.** If two projects are finished
    on one day and the counted one is reopened, its row is deleted and the
    other row still says `counted = false`. The engine therefore ignores the
    stored flag and counts distinct local days itself. Whoever writes the
    Projects panel (phase 2) should either drop the column or re-flag the
    remaining row on reopen.

12. **"Permanently" versus "recomputed".** Streak milestones are permanent
    against a broken streak (unlocks are judged on the longest run ever). They
    are not permanent against a change of history: moving a chat out of a room
    or changing the timezone can shorten that room's longest run, and the
    furniture goes with it. The plan asks for both properties; this follows
    "the palace just redraws".

## Interpretations in the engine

- `computeRoomState(roomId, events, rules, today)`: `rules` is the whole
  catalog (`rules.json` plus the rooms), because signature items live in the
  room files. `today` is a `YYYY-MM-DD` local day.
- Events are a snapshot of the current rows, already attributed to each chat's
  current room, with a local day on each. `buildRoomEvents(rows, timeZone)`
  makes them from `chats`, `messages` and `goal_completions` rows; it is pure
  too. A reopened goal is simply absent (`reopenGoal` removes it).
- Timezone change: messages and goal completions keep the `local_day` stored
  when they were written, so a new zone never rewrites past room days (changed
  in the review fixes below; before that, message days were re-derived).
  Events dated after `today` are left out.
- `nextUnlock.streak.remaining` is measured from the current run, not from the
  longest one: after a break at a best of 3, the next unlock is 5 days away.
- A weekend chat counts toward the streak (the plan's open question, answered
  the way the plan currently assumes).
- `diffRoomStates(previous, next)` reports gains only. Lost items, and an old
  item coming back into view because its replacement was lost, produce no
  event.

## Interpretations in the shell

- **Start at login** is on by default, stored in `settings.start_at_login` and
  toggled from the tray. It is only registered with the OS in a packaged app;
  in dev the executable is the bare Electron binary, and registering that
  would leave a broken login item. So it has not been exercised yet.
- **Quit only from the tray.** Closing the window, Cmd+W and Cmd+Q all hide the
  window, and the Dock icon is hidden with it. OS shutdown or logout still
  stops the app, and so does Dock > Quit while the window is open: blocking
  those would mean blocking shutdown.
- `MIND_PALACE_USER_DATA=<dir>` moves the user-data folder and
  `MIND_PALACE_SMOKE=1` starts everything, prints one status line and quits.
  Both are off by default and exist for automated checks.
- The tray icon in `resources/` is a generated placeholder
  (`scripts/make-tray-icons.mjs`).
- Database timestamps are UTC ISO-8601 text. `messages.role` allows `user`,
  `assistant` and `system`; the plan does not list the values.
- A `timezone` setting is seeded from the system zone on first launch.

## Open questions

- Should the trophy shelf appear at 1 goal (as built) or wait for the first
  milestone at 2, leaving the first trophy without a shelf?
- ~~Should a timezone change be allowed to rewrite past room days?~~ No: each
  message stores its local day (review fixes).
- Should furniture disappear from a room when a chat is moved out of it?
- ~~Keep `goal_completions.counted`, or derive it?~~ Derived; the column is gone (review fixes).
- Where do the layer and footprint of base and shared items live: a new
  `catalog/base.json`, or only the art manifest?

## For later phases

- Packaging has to ship `catalog/`, `drizzle/` and `resources/` next to the
  code (they are read from the app path at run time) and unpack
  `better-sqlite3` from the asar.
- `better-sqlite3` is rebuilt for Electron's ABI by the `postinstall` script,
  so it cannot be loaded from plain Node. Vitest therefore covers the engine
  and the catalog loader, not the database; database tests would need to run
  under Electron or a second Node-ABI build.
- Zustand and PixiJS from the plan's table are not installed yet; nothing in
  this slice uses them.
- `npm install` reports 4 moderate advisories, all in dev tooling. Not
  addressed.

## Phase 1 · Chat (2026-11-15)

What exists:

- `src/main/chat/claude.ts` is the only module that talks to Claude (Agent SDK, `query()`). Moving to an API key later is a change to this file.
- Tools: `tools: ['WebSearch']`, `allowedTools: ['WebSearch']`, `permissionMode: 'dontAsk'`, `settingSources: []`, `mcpServers: {}`. The model sees one tool; nothing else can run, and none of the user's Claude Code settings, CLAUDE.md, hooks, skills or MCP servers are loaded.
- Chat model: setting `model.chat`, default `claude-sonnet-5-5` (the plan assumes Sonnet).
- SDK session transcripts live under `<userData>/claude-sessions`; `chats.sdk_session_id` is passed back as `resume`.
- The answer streams to the renderer as `ChatEvent`s on the one-way `chat:event` channel; requests stay on the typed `invoke` contract.

Decisions (my interpretation where the plan was silent):

- **Login check** is a presence check only (env vars, `~/.claude/.credentials.json`, or the macOS Keychain item `Claude Code-credentials`, never reading the secret). A login that exists but is refused shows up on the first message; the app then shows the reason and offers a way back to the chat.
- **Sources** are read from the answer text (markdown links, then bare URLs), not stored separately. An answer that searched but cited nothing shows no sources.
- **Stop** keeps the text written so far as the assistant message, without token counts.
- **A session that cannot be resumed** (transcript deleted) is replaced by a new one, with the last 30 messages replayed as text.
- **Tokens**: `tokens_in` is input plus cache-read plus cache-creation tokens of the main loop, from the SDK result.
- Extra channels beyond the plan: `chat:delete`, `auth:retry`.

Verified live on 2026-11-15, signed in with a Claude Max subscription (`claude auth login --claudeai`):

- A question that needs a web search streams its answer and shows its sources (Sonnet 5.5, about 38k input tokens for the turn, mostly the SDK's own system prompt and tool definitions).
- Stop in the middle of a long answer keeps the partial text and ends the Claude subprocess.
- After restarting the app, the chat resumes through the SDK session id and Claude answers from the earlier context.
- With an API-account login that has no credit, the app shows Claude's reason and a way back to the chat.

Known gaps:

- **A stopped answer is not in Claude's memory.** The partial text is saved and shown, but the SDK session does not keep an aborted turn, so on the next message Claude does not know what it had written.
- **The trailing "Sources:" list** the web search tool makes the model write is hidden from the body and shown as chips (`splitSources`). The stored content keeps it.
- ~~The sign-in screen says `claude login`~~: it shows `claude auth login --claudeai` (checked in the review fixes).
- ~~Launching from inside a Claude Code session leaks its variables to the SDK~~: fixed in the review fixes (allow-listed environment).
- Not exercised by hand: deleting a chat from the sidebar, and the "no login at all" screen (this machine always had one).

## Phase 2 · Rooms and projects (2026-11-15)

What exists:

- **Classifier** on Haiku (`model.small`, default `claude-haiku-5-5`) with structured JSON output. The prompt is built from the catalog text (`src/shared/classify.ts`), so editing a room's `belongs`, `not_here` or `examples` changes the classifier with no code change.
- **When it runs:** after the second user message, and once more when a chat has been quiet for 30 minutes (checked every 5 minutes and 10 seconds after launch). Below 0.6 confidence, or an unknown room id, the chat goes to the Mail room.
- **Move to room** in the chat header sets `room_source = user`; the classifier never moves that chat again.
- **Track it? card** with Track and Just a question. The classifier is given the open (active or paused) projects and may answer with one of their ids; the card then offers to add the chat to that project instead of making a new one.
- **Projects panel** by state with Done, Snooze 2 weeks, Pause, Drop, Reopen. Done writes a `goal_completions` row on the local day (`counted = false` for a second completion that day in the room); Reopen deletes it.
- **`npm run eval`** runs the real classifier over `eval/*.jsonl` and prints room accuracy, project precision and recall, and the misses. `scripts/eval-sample.jsonl` is a made-up set for trying it out.

Schema change: migration `0001` adds `chats.suggested_project_id` and `chats.project_dismissed_at`. The plan's table does not list them; they hold the pending card and the "Just a question" answer.

Decisions (my interpretation where the plan was silent):

- A chat with a single message is first classified at its quiet check, since the plan only starts after the second message.
- The quiet check always stamps `classified_at`, so a chat is checked once per quiet period. It only moves the chat on a confident answer that names a different room.
- A failed classification is retried after 30 minutes, not on every tick.
- The classifier sees all open projects with their rooms (the room is not known before classifying) and a recognised project is only offered when it is in the room the chat ends up in.
- A suggested project is a `projects` row in state `suggested`. It is not listed in the panel until tracked, and is deleted on "Just a question" or when its chat is deleted.
- A chat that answered "Just a question", or that already belongs to a tracked project, is never offered again.
- A project keeps the room it started in when its chat is moved (the plan's open question; this follows the plan's default).
- Project activity is a new user message in a linked chat.

Verified live on 2026-11-15:

- Eval on the made-up sample: 12 of 12 rooms, project precision and recall 100%, about 2,600 tokens per chat. This says the pipeline works, not that the classifier meets the targets: the sample is 12 easy invented chats, not anyone's real ones.
- In the app: a two-message chat about an inventory app was placed in the Coding room and offered "Hardware store inventory app"; Track, Done (completion row written, counted), Reopen and Move to room all behaved as described.

Not verified:

- **The eval on real chats.** No one has labelled their own chats yet (`eval/<name>.jsonl`), so the 85% and 70% targets are untested.
- **The 30-minute quiet re-check in the running app.** Its logic is covered by tests with a fake clock; nobody has waited 30 minutes.
- **Recognising an existing project** ("this is the Pantry app again") and **Just a question**, **Snooze**, **Pause**, **Drop** in the running app. All are covered by tests against an in-memory repo.
- The database layer itself (`src/main/palace/repo.ts`) has no automated tests, for the same reason as phase 0: better-sqlite3 is built for Electron.

Worth knowing:

- The stored `timezone` setting on the development machine is `America/La_Paz` (what macOS reports), which is the same offset as Santo Domingo. It only matters across a daylight-saving boundary, which neither zone has.

## Phase 5 · Reminders (2026-11-15)

What exists:

- **Rules** in `src/shared/reminders.ts`: a reminder is due 3, 7 and 14 days after the last activity, then every 14 days; only active projects; a snooze holds it back until it ends.
- **Scheduler**: 5 seconds after launch and every 15 minutes. After a long absence a project gets one reminder, with every cadence point already in the past counted as sent, so there is no burst.
- **Text** from Haiku over the project's chats (project name plus one small next step), stored on the reminder row. If the model fails, the text is the project title and its stored next step.
- **Notifications**: at most two a day across all projects, counted on the local day; the rest go to the inbox only. Clicking opens the project's chat; on macOS the notification also carries Done and Snooze 2 weeks. A switch in the inbox turns notifications off (setting `notifications`).
- **Inbox** (Reminders in the sidebar, with a count): every reminder not reacted to yet, with Open, Done, Snooze 2 weeks, Pause and Drop.
- **Outcomes** in `reminders.action`: `opened`, `done`, `snoozed`, `paused`, `dropped`, `ignored`.

Decisions (my interpretation where the plan was silent):

- **`ignored`** is set when the next reminder for the same project comes due with no reaction to the previous one.
- **An action taken in the projects panel**, not through the reminder, still answers that project's waiting reminder with the matching outcome. Reopen answers nothing.
- **A new message in a linked chat** counts as `opened` (the person came back on their own) and restarts the cadence (`reminders_sent = 0`).
- **A reminder over the daily cap is never notified later.** It stays in the inbox, which is how the plan words it.
- **`due_at`** is when the reminder came due, which can be days before it was created if the machine was off.
- **A notification that could not be shown** is not counted against the daily cap.
- Reminders, the inbox count and notifications use two new one-way events on `app:event`; no schema change.

Verified live on 2026-11-15 (E2E cases N1 to N5 in `tests/e2e/run.mjs`):

- At launch, three seeded quiet projects each got one reminder with model-written text; the fresh and the paused project got none; the 20-day project ended with `reminders_sent = 3`.
- Two of the three were marked notified, the two longest overdue.
- Done, Snooze and Open from the inbox acted on the project and logged `done`, `snoozed`, `opened`.
- The notifications switch stored `off`; a new message reset the cadence.

Not verified:

- **Whether macOS actually displayed the notifications**, and their Done and Snooze buttons. The app issued them and recorded them as sent; nobody looked at Notification Centre. Unsigned development builds may show them without buttons.
- **Clicking a notification** to open the project.
- **The 15-minute timer** and reminders arriving as real days pass: tested with seeded dates and a fake clock only.
- **Windows.**

## Phase 4 · Palace view, with illustrated rooms (2026-11-15)

This phase departs from the plan on purpose. The plan draws each room from sprites on the asset spec's grid with PixiJS; no such sprites exist, and the owner chose whole illustrated rooms instead. PixiJS is not used.

What exists:

- **Palace** in the sidebar, with a tab per room. Each room shows its illustration, the shell tier, the trophies, the furniture earned, and a bar each for the streak and for finished projects with what the next milestone gives.
- **The shell tier is shown in the picture**: a bare room is dim and almost colourless, a painted one has part of its colour, a finished one all of it (`SHELL_FILTER` in `PalaceView.tsx`).
- **Furniture is a list of labels under the picture**, not objects drawn in it. Labels come from the catalog ids (`itemLabel`).
- **What is new**: finishing a project or extending a streak marks the Palace button "New"; opening the room announces and highlights the new items once. What a room held at the last visit is stored in the setting `palace.seen.<room>`.
- **Model** in `src/shared/palace.ts` (`buildPalace`), fed by the same engine as before; unlocks are still never stored.
- **Pictures**: `src/renderer/src/assets/rooms/{coding,music,art,mailroom}.jpg`, 1600 px wide copies of the generated rooms.

Decisions (my interpretation):

- **Progress bars** show the value out of the next milestone ("5 days of 8" is five eighths full). An earlier version measured from the last milestone reached, which left the bar empty right after each milestone.
- **A room never visited announces nothing**: its starting furniture is not news.
- **The streak bar shows the current run**, while milestones stay judged on the best run, as the engine does.
- **Room pictures**: Coding uses the NataTech studio, Music the rehearsal room, Mail the mailroom. **Art uses the tinkerer's workshop**, which is the closest picture available and does not look like an art studio.

Verified live on 2026-11-15 (E2E cases V1 to V4): a five-day streak with two finished projects, an unused room, a 21-day streak, and the announcement after finishing a third project.

Not verified, or known gaps:

- **Not what the spec describes.** No grid, no sprites, no tinting, no depth sorting, no slots. The asset spec and `rules.json` layout are unused by this view.
- **Painted and finished look alike at a glance**; only the bare room is clearly different.
- **Streaks were seeded with dated messages**, not earned over real days.
- **The unlock toast "when it happens"** (the plan's diff of yesterday against today) is done as "new since the room was last opened", not as a pop-up at the moment of unlocking.
- The view was looked at in one window size only.

## Real history: import, room texts and draft eval (2026-11-15)

The plan lists "importing chats from other apps" as out of scope. This was done anyway at the owner's request, with scripts outside the app.

What exists:

- `scripts/extract-claude-code.py` reads the Claude Code transcripts under `~/.claude/projects` (read-only) and writes `import/sessions.jsonl`: per session, only what the person typed, with timestamps. Tool output, slash-command wrappers, hand-over briefs and side chains are dropped, and sensitive values are replaced with placeholders.
- `import/labels.jsonl`: a room, a project name and a confidence per session. **Written by a model** from the folder and a sample of each session, not by the person.
- `scripts/import-into-app.py` turns sessions into chats in the app database (ids `cc-…`, projects `ccp-…`), backing the database up first. Re-running replaces the earlier import and never touches chats made in the app.
- `scripts/build-eval.py` writes `eval/<name>.jsonl` from the sessions and labels.
- `import/` and `eval/` are git-ignored: they hold private conversations.
- The four room texts in `catalog/rooms/*.json` (`belongs`, `not_here`, `examples`) were rewritten from what the sessions are really about. Examples are generic paraphrases with no names.

No project is imported as done, so no trophies are invented. Sessions that are scheduled-task runs or tests are left out.

Draft eval (Haiku, first two messages of each chat): room agreement 81.5% against a target of 85%; project precision 76.6% (target above 70%); project recall 34.3%. It cost about three times the token estimate made from the invented sample.

Read these numbers with care:

- **It measures agreement with model-written labels, not accuracy.** The labeller saw the folder and more of each session; the classifier sees two messages. Half of the room disagreements are coding against mailroom in either direction, which is where that difference bites.
- **Low project recall is partly by design**: the classifier is told to be conservative, and many sessions only become a project later on.
- The room texts were rewritten from the same sessions the eval uses, so this is not a held-out test.

Known gaps:

- Imported chats hold only the person's side; answers were not imported, and such a chat has no SDK session, so continuing it replays the typed messages as context.
- One label per session loses topic changes inside long sessions.
- The redaction is pattern-based, so it can miss things. That is why `import/` and `eval/` must never be committed.
- Claude.ai chats were not imported (the owner's choice).

## Palace hub (2026-11-15)

Asked for: the character visible, animations, rooms connected, the palace as the central dashboard, clickable actions inside it.

- `PalaceHub.tsx`: "All rooms" is now the Palace's first screen. Four rooms around the atrium, joined by paths; a path is lit and flowing when its room has a chat day today. Nato walks to the room of the most recently used chat (`currentRoomOf`), and walks to a room before it opens. The helper robot appears in a room while Claude is answering a chat filed there.
- Atrium shortcuts: New chat, reminders waiting, active projects.
- Room view: Nato inside, "Chat here" (the new chat is moved to that room after the first send, as a user move, so the classifier leaves it there), "← Palace", "Projects here" with Done, "Recent chats".
- Departs from the plan: the plan has no hub and no character. Illustrated rooms were already a departure.

Verified: typecheck; 224 unit tests (4 new for `activeToday`, `currentRoomOf`); E2E S5 6/6 with new cases V5 (hub) and V6 (Chat here shows the filing hint, ← Palace returns). Looked at the hub and a room on real data.

Not verified: that a chat sent after "Chat here" really lands in that room (needs a real model call; V6 stops at the hint). The helper robot during a live answer. Reduced-motion behaviour. S1–S4 were not rerun after these changes; the PDF report is not regenerated.

## Stage 1 of "make it alive": the palace is home (2026-11-15)

- The app opens on the palace (`view: 'palace'`), not on an empty chat.
- `Sidebar.tsx` is a rail: icons only (New chat, Palace, Projects, Reminders, Search, Show chats). "Show chats" expands it to the old chat list; the choice is kept in localStorage.
- A chat opens as a panel beside the palace (`App.tsx`, `data-testid="chat-panel"`), and the palace switches to the chat's room. The panel has "whole window" and "close" buttons; Esc closes it when the draft is empty. When the classifier files the open chat, the room behind follows.
- `CommandBar.tsx` + `src/shared/commands.ts`: Cmd/Ctrl+K searches actions, rooms, open projects and chats (accent-insensitive).
- The room layout uses a container query (`@4xl:`) so it stacks when the chat panel is open.
- Departs from the plan: the plan's shell is sidebar + chat. Claudio should know.

Verified: typecheck; 231 unit tests (7 new for the search); full E2E run 35 pass, 1 fail (R1, a test selector), 1 skipped (L3, as before); R1 fixed and S1 rerun 12/12. New cases V6 (panel beside the room) and V7 (starts on the palace; Cmd+K). The E2E `launch()` helper now expands the rail and opens New chat so the older cases start where they used to.

Not verified: S2 was not rerun after one selector in it was scoped to the chat panel (line ~682). `report.pdf` is not regenerated and `results.json` now holds only the last partial run. Narrow windows (under ~900px). Screen-reader behaviour of the command bar.

## Review fixes from plan v2's handoff (2026-11-15)

From `docs/HANDOFF.md`, "Fixes found in review". Windows 11 dev machine.

- **Sign-in command.** Already right: `Login.tsx` shows `claude auth login --claudeai` and E2E L1 checks for it. Only these notes were stale.
- **Environment.** `src/main/chat/env.ts` builds the SDK child's environment from an allow-list (paths, home, locale, Windows basics, proxies, `CLAUDE_CONFIG_DIR`). The SDK's `env` replaces the child environment, so nothing else gets through. A Claude Code shell on this machine carried `ANTHROPIC_BASE_URL` and about 30 `CLAUDE_CODE_*` variables; with the fix the SDK starts with `apiKeySource: none` (the user's own OAuth login). The login check no longer accepts a token in the environment, since it is never passed on. E2E L1 now fakes a refused login with a throwaway `CLAUDE_CONFIG_DIR` (not run yet, see below).
- **`counted`.** Dropped (migration 0002). Done stores every completion; the engine counts one per room per local day, as it already did.
- **Local day.** `messages.local_day` (migration 0003) is stamped in the settings timezone at write time and preferred by the engine. At launch, older rows are stamped once with the current zone. Checked on a database rolled back to migration 0001: both migrations apply, a completion row survives, a 03:30Z message gets 2026-11-02 in Santo Domingo.
- **Windows.** 11 catalog tests failed on `\` path separators; they now normalise to `/`. `npm install` did not download the Electron binary here (`Error: Electron uninstall` on `npm run dev`); `node node_modules/electron/install.js` fixed it.

### The 38k tokens per turn are web search results, not the prompt

Measured with SDK 0.3.325, Sonnet 5.5, the app's exact options, per API call:

| Turn | Calls | Input per call | Notes |
| --- | --- | --- | --- |
| "Reply with ok" (no search) | 1 | 1,664 (all cache creation) | System prompt + the one tool + the CLI's base. |
| One factual question (2 searches) | 6 | ~1.7k, then ~38.5k | Each search's results add ~36,800 tokens, re-read on every later call. |

So the SDK's own prompt and tool list are already about 1.7k; trimming them saves almost nothing. The cost is the search result payload, and the stored `tokens_in` (input + cache read + cache creation, summed over calls) shows a two-search turn as ~78k. Not changed yet: what to do about it is an open decision (fewer searches per answer, a fetch-based tool with smaller pages, or showing cache reads separately in the ledger).

E2E on Windows: `node tests/e2e/run.mjs --only S3` passes L1 with the new fake login. L2 fails only because the harness calls the `sqlite3` CLI (not installed here), and the report step then crashes on macOS's `sw_vers`: the E2E harness is macOS-only for now. S1, S2, S4 and S5 were not run, so P6's new completion check is unverified.

## Stage 2 of "make it alive": living helpers (2026-11-15)

- `src/shared/agents.ts` (pure, tested): each room has a helper whose state follows the answer being written for a chat filed there: idle, thinking, searching, writing, done. A chat with no room yet is handled by the Mail room's helper. Also the activity log and what counts as a change to a chat.
- `Agent.tsx`: the helper is always in its room, on the map and inside the room. Its state shows in its movement, a badge, and a bubble: a short label on the map, the live tail of the answer inside the room. Inside the room a "Watch the answer" / "Read the answer" button opens that chat.
- Filing: when a chat gets a room, a scroll travels on the map from the Mail room through the atrium to that room (`Scroll` in `PalaceHub.tsx`).
- `ActivityStrip.tsx`: a strip under the palace with what just happened (asked, searching, answered, stopped, filed or moved, project suggested or tracked, failed). Click a line to open its chat. It lives in memory only and starts empty each launch.
- All four helpers use the same picture; only the glow colour differs per room. Per-room characters and poses need new art.

Verified: typecheck; 247 unit tests (16 new); E2E S1 12/12 against the real model, including new checks that the Mail room helper is `writing` while an unsorted chat is answered and that the strip reports the answer and the filing; S5 7/7.

Not verified: how the busy states and the bubble look (the test checks the state, and its screenshot was overwritten by the next run). The filing scroll has no test and was not seen: when a chat is filed while it is open, the palace beside it switches to the room view, where the map is not drawn, so the scroll only shows when the map is on screen. S2–S4 not rerun. `report.pdf` not regenerated.

## Plan v2, first pass (2026-11-15)

Claudio's plan v2 is in `docs/` (PR #1, merged). This pass follows `docs/HANDOFF.md`. What was done, and what was not:

Done:

- **Environment fix.** Superseded: this pass had its own `src/shared/sdkEnv.ts` (a deny-list that kept API keys). Claudio's allow-list in `src/main/chat/env.ts` (PR #2) replaced it when the two were merged, and `sdkEnv.ts` was removed. With his version a key in the environment is no longer a way to sign in.
- **Theme.** `styles.css` uses the style guide's tokens (walnut, parchment, brass, gold). The three fonts are bundled through `@fontsource-variable/*`. The old utility names (`ink-soft`, `paper`, `muted`) are kept and point at the guide's values; `bg-walnut`, `bg-raised`, `gold`, `brass` are new. Primary buttons are gold. The CSP now allows `font-src 'self' data:` because the font packages inline small subsets.
- **Connected palace model.** `src/shared/floor.ts`, pure and tested: 18 x 18 tiles, four rooms at fixed origins, two hallways, back walls full height on the outside and low with a doorway onto a hallway, low front walls only where a hallway is, every placed item as a block at its slot. `buildPalace` now returns it as `floor`.
- **PixiJS canvas.** `PalaceCanvas.tsx` draws the floor with placeholder blocks, the room glow, Nato and one helper per room, with fit, zoom into a room, wheel zoom, drag to pan, hover outline and Esc to go back. It needs `import 'pixi.js/unsafe-eval'` because the CSP forbids eval, and loads textures through `<img>` to avoid workers.
- **One palace screen.** `PalaceView.tsx` keeps a single canvas and shows the room's details beside it when a room is chosen. The painting is the header picture of that side panel. `PalaceHub.tsx` and `Agent.tsx` are gone; `roomArt.ts` only maps paintings now.
- Nato walks through the doorways and the lobby when the room in view changes. Helper states from stage 2 drive the helper's movement, a dot over it, and the label's bubble.

Not done from HANDOFF and the plan:

- `catalog/items.json`. Heights of base items are a table inside `floor.ts` (`BASE_HEIGHT`); footprints come from the slot.
- Placements, the inventory and the room editor (the selling point). No `placements` table yet.
- Decay.
- Background sessions, approvals, the new tables, the event contract.
- Dropping `goal_completions.counted` and storing each message's local day were not part of this pass; Claudio did both in PR #2 (see "Review fixes" above).
- The ~38k tokens per turn was not measured in this pass; Claudio measured it in PR #2.
- The guide's component set as components; the theme is applied through tokens and existing classes. No automated contrast check.
- The plain list view for screen readers is only an aria-label on the canvas plus the room buttons.
- The filing scroll from stage 2 was removed with the old map and not rebuilt on the canvas.

Verified: typecheck; 261 unit tests at the time (floor 11, sdkEnv 3 new; the sdkEnv tests left with the file); full E2E 36 passed, 0 failed, 1 skipped (L3, as before), against the real model for S1 to S4. Looked at the hub, a zoomed room and a streaming answer in the E2E screenshots.

Not verified: wheel zoom and drag (no test, not tried by hand); Windows; how the canvas behaves on a display without WebGL; the look at narrow widths, where the room labels overlap the shortcut buttons. `report.pdf` is not regenerated.

## Painted rooms on the connected floor (2026-11-15)

Asked for by Nato after seeing the placeholder blocks: "put the rooms with the real design we already have", the character with movement, and a general polish. This departs from plan v2, which keeps the paintings as a style reference only.

- `scripts/cut_rooms.py` (the original paintings are kept outside the repo) cuts each room out of its painting along its six corners, measured by hand, and maps the three floor corners onto the 8 x 8 room diamond. Output: `src/renderer/src/assets/rooms/cut/<room>.webp` at 2x, and the anchor numbers copied into `roomArt.ts` (`ROOM_CUT`).
- `PalaceCanvas.tsx` draws a room as its cut-out when it has one, and as placeholder blocks when it does not, so the sprite path of plan v2 still works for a room without a painting.
- The shell tier is a colour filter on the painting: bare is dim and nearly grey, painted has some colour, finished has all of it. Individual unlocked items are not visible in a painted room; they are still listed under "In this room".
- **Hallways are 5 tiles, not the plan's 2** (`HALL_TILES` in `floor.ts`). The painted back walls are about 4.8 units tall; with 2-tile hallways a front room's walls cover the floor of the room behind. Five is the narrowest that avoids it, and a test pins that. The palace is 21 x 21 tiles.
- Zoomed into a room, the other rooms fade to 16% so their walls do not crowd the view.
- Nato: turns to face the way he walks, hops and leans while walking, breathes while standing, has a shadow, and takes a few slow steps around his spot every few seconds. It is one still picture moved by code; there are no walk frames yet.
- Per room, where Nato and the helper stand on the painted floor was picked by eye (`ROOM_CUT[...].nato` / `.helper`).
- The Art workshop still uses the tinkerer's workshop painting.

Verified: typecheck, 262 unit tests, E2E S5 7/7, and screenshots of the map and each room. Not verified: S1 to S4 after this change; the strolling and walking as motion (only still frames were looked at).

## New art from Gemini (2026-11-15)

Generated in one Gemini chat (image tool) with the existing paintings and characters attached as references, then cut by `scripts/cut_rooms.py` and `scripts/cut_sprites.py`. The full-size sources are kept outside the repo.

- **Art workshop**: a real artist's studio painting replaces the tinkerer's workshop, as the header picture (`assets/rooms/art.jpg`) and as the cut-out on the floor.
- **Nato**: four walk frames and a seated pose (`assets/characters/nato_walk_1..4.png`, `nato_sit.png`). The canvas plays the frames while he walks or strolls, uses frame 4 (feet together) when he stands, and seats him while the helper of his room is busy with an answer. The earlier single picture `nato.png` is no longer used by the canvas.
- **Helpers**: one per room (`helper_coding`, `helper_music`, `helper_art`, `helper_mailroom`), each with its chest light in the room's colour and one accessory.
- **Lobby centrepiece** (`assets/items/lobby.png`): a plinth with a glowing map and a signpost. It stands towards the back of the lobby; the Mail room's walls and label still hide part of it.
- `scripts/cut_sprites.py` removes the key colour, keeps each figure's largest connected shape (the generator leaves faint stray pieces on the key colour), and writes every figure of a set on the same canvas with the feet on the bottom edge.
- Room labels now sit on the top of the back wall instead of above it.

Verified: typecheck, 262 unit tests, E2E S5 7/7, screenshots of the map and each room. Not verified: the walk frames in motion and the seated pose during a real answer (only still frames were looked at); S1 to S4 after these changes.

## Merging with PR #2 (2026-11-16)

PR #2 (Claudio's review fixes) went into main first; this branch was then merged with it.

- `src/main/chat/claude.ts`: his `./env` allow-list is used; this branch's `src/shared/sdkEnv.ts` and its test were removed.
- `tests/e2e/run.mjs`: the palace session's seed still wrote `goal_completions.counted`, which migration 0002 drops, so S5 aborted on his branch (he could not run S5 on Windows). The column is no longer written.
- Before the merged code ran on the owner's real database, it was copied to `mind-palace.sqlite.bak-before-pr2-20261116` beside it.

## Stage 3: a clickable world (2026-11-16)

- **Things in a room** (`roomHotspots.ts`): each painted room has four to six things that can be clicked, shown as small dots that name themselves on hover. Their positions were read off the cut-outs by eye. In every room: one starts a chat filed there, one lists projects in progress (with Done), one lists finished projects (with Reopen), one lists the room's chats. The Mail room adds the pigeonholes (chats with no room, with "Keep here"), the bell (reminders) and the door (back to the palace).
- **Cards** (`RoomPanel.tsx`): a parchment card pinned by the thing clicked. Esc closes the card first, the room second.
- **Reminders on the spot**: the reminders button on the map and the Mail room's bell open a card where each reminder can be answered (Open, Done, Snooze, Pause, Drop) without leaving the palace. The button pulses gold while any are waiting. This replaces the plan's idea of a character walking up to Nato.
- **Drag to file**: a chat dragged from the list onto a room on the floor, or onto a room's tab, is moved there as a move made by the person.
- `PalaceCanvas` now reports its camera (`onCamera`), and the view pins labels, dots and cards over the floor itself.

Verified: typecheck, unit tests, E2E S5 9/9 with new cases V8 (click the jacket, Esc, click the desk) and V9 (reminders card on the map; drag a chat onto a room's tab). Not verified: dropping a chat on a room on the canvas itself (the test drops on the tab); the reminders card with real reminders in it. The full E2E run afterwards passed 38 of 38 with L3 skipped. The dots were looked at in all four rooms and sit on their things.

## Review fixes from plan v2's handoff (2026-11-15)

From `docs/HANDOFF.md`, "Fixes found in review". Windows 11 dev machine.

- **Sign-in command.** Already right: `Login.tsx` shows `claude auth login --claudeai` and E2E L1 checks for it. Only these notes were stale.
- **Environment.** Supersedes `src/shared/sdkEnv.ts` from the first pass above (removed when the branches were merged): the handoff asks for an explicit allow-list, and API-key sign-in is left for the later "switch to an API key" config change. `src/main/chat/env.ts` builds the SDK child's environment from an allow-list (paths, home, locale, Windows basics, proxies, `CLAUDE_CONFIG_DIR`). The SDK's `env` replaces the child environment, so nothing else gets through. A Claude Code shell on this machine carried `ANTHROPIC_BASE_URL` and about 30 `CLAUDE_CODE_*` variables; with the fix the SDK starts with `apiKeySource: none` (the user's own OAuth login). The login check no longer accepts a token in the environment, since it is never passed on. E2E L1 now fakes a refused login with a throwaway `CLAUDE_CONFIG_DIR` (not run yet, see below).
- **`counted`.** Dropped (migration 0002). Done stores every completion; the engine counts one per room per local day, as it already did.
- **Local day.** `messages.local_day` (migration 0003) is stamped in the settings timezone at write time and preferred by the engine. At launch, older rows are stamped once with the current zone. Checked on a database rolled back to migration 0001: both migrations apply, a completion row survives, a 03:30Z message gets 2026-11-02 in Santo Domingo.
- **Windows.** 11 catalog tests failed on `\` path separators; they now normalise to `/`. `npm install` did not download the Electron binary here (`Error: Electron uninstall` on `npm run dev`); `node node_modules/electron/install.js` fixed it.

### The 38k tokens per turn are web search results, not the prompt

Measured with SDK 0.3.325, Sonnet 5.5, the app's exact options, per API call:

| Turn | Calls | Input per call | Notes |
| --- | --- | --- | --- |
| "Reply with ok" (no search) | 1 | 1,664 (all cache creation) | System prompt + the one tool + the CLI's base. |
| One factual question (2 searches) | 6 | ~1.7k, then ~38.5k | Each search's results add ~36,800 tokens, re-read on every later call. |

So the SDK's own prompt and tool list are already about 1.7k; trimming them saves almost nothing. The cost is the search result payload, and the stored `tokens_in` (input + cache read + cache creation, summed over calls) shows a two-search turn as ~78k. Not changed yet: what to do about it is an open decision (fewer searches per answer, a fetch-based tool with smaller pages, or showing cache reads separately in the ledger).

E2E on Windows: `node tests/e2e/run.mjs --only S3` passes L1 with the new fake login. L2 fails only because the harness calls the `sqlite3` CLI (not installed here), and the report step then crashes on macOS's `sw_vers`: the E2E harness is macOS-only for now. S1, S2, S4 and S5 were not run, so P6's new completion check is unverified.


## Phase 4 · Connected palace, on top of the first pass (2026-11-15)

Built on Nato's first pass (`af75504`) with the review fixes merged; plan in `docs/superpowers/plans/2026-11-15-phase4-connected-palace.md`. Claudio chose to keep plan v2's rules, so two departures of the first pass are undone:

- **Rooms are never drawn from the paintings.** `ROOM_CUT` and `assets/rooms/cut/` are gone; every item is a placeholder block (faces 100/82/62 %) until its sprite exists. The paintings stay as the header picture beside a room. `scripts/cut_rooms.py` is kept, but its output is no longer used by the app.
- **Hallways are 2 tiles** (palace 18 x 18). Walls that face a hallway are low, so none hides a room behind it.

What exists:

- **Theme tokens for the canvas.** Every colour is a `--mp-*` CSS variable (`styles.css`), read by `src/renderer/src/theme.ts`; a test fails on any `#rrggbb` / `0xrrggbb` in `src/renderer`. The CSS build writes `#000` for `#000000`; the parser accepts both.
- **Decay** (`RoomState.decay`): weekdays since the quietest active project's last activity; levels at 7/14/21/30. Drawn as dust, cobwebs, a grey-and-dim filter on the room's own layer, a flicker every 20-60 s at level 3, and a 600 ms "lights back on" when the level drops. Reduced motion turns off flicker and fades.
- **`catalog/items.json`** declares the base and shared items (closes NOTES 8); every slot in `rules.json` has a `kind`. `cardboard_box` moved there from the Mail room's assets.
- **Placements** (`placements` table, migration 0004; `src/shared/placements.ts`): a row moves an item, picks a variant or hides it, and always wins. Items without a row go to their catalog slot when it is free; otherwise they wait in the inventory with a reason. The desk and the trophy shelf can be hidden or re-skinned, not moved.
- **Low walls.** In the whole-palace view, items on a low wall are not drawn; the label says "+N on the walls". With a room focused, its back walls rise to full height and show them.
- **Room editor.** In a focused room, Arrange room: choose Move, then a spot from the list or an outlined spot on the floor; Hide/Show, variant, Reset.
- **Tooltips and a plain list view** (List view button; remembered per viewer; reduced motion starts on the list).
- **`npm run shots`** (`scripts/palace-shots.mjs`): seeds fixture databases with Node's built-in SQLite and screenshots the real app into `test-report/palace/`. `node scripts/palace-shots.mjs editor` drives the editor through the UI and a restart and checks the result.

Verified on Windows 11: typecheck; 328 unit tests; `npm run shots` (empty, furnished, decay, hover, list, focused rooms) looked at; the editor run passes 4/4 (a moved chair and a re-placed crate survive a restart; a new unlock lands on the desk with nothing else moved).

Not verified:

- Flicker and "lights back on" in motion (only still frames); reduced motion by hand; a screen reader on the list view.
- `tests/e2e/run.mjs` was not run after these changes (it needs macOS for its report and the `sqlite3` CLI); some of its palace selectors (V1-V7, e.g. "Finished room" captions) may need updating.
- Wheel zoom and drag-to-pan were not tried by hand after the camera change.
- Variants: no item has variants yet, so the picker has not been seen.

## Two looks for a room: merging phase 4 with the painted rooms (2026-11-16)

Claudio's phase 4 (PR #4) put the palace back on plan v2's rules: no paintings in the palace, 2-tile hallways, everything a placeholder block. Nato wanted his paintings as the rooms. The owner's decision was to keep both, as two looks of the same room:

- **Painting, day to day.** On the map and when a room is opened, a room that has a painting (`ROOM_CUT`) is drawn as it. Its shell tier is a colour filter on the painting, phase 4's decay filter, dust and cobwebs apply on top, and the clickable things of stage 3 sit on it.
- **Pieces, while arranging.** "Arrange room" passes the room to the canvas as `arranging`; that room is then drawn from its pieces exactly as in phase 4 (blocks, low walls rising, slot outlines, the inventory drawer), and the clickable things are hidden. A room without a painting is always drawn this way.
- **Hallways are 5 tiles again** (`HALL_TILES`), because the painted walls are about 4.8 units tall. Phase 4's low-wall logic is unchanged; the floor tests are updated for the 21 x 21 palace.
- `boxOfRoom` takes an optional wall height so the camera frames a painted room; the canvas keeps phase 4's `onLabels`, `onHover`, `highlights` and `onSlot`, and adds `arranging`, `onCamera` and `onDropChat`.
- `assets/rooms/cut/` and `ROOM_CUT` in `roomArt.ts`, removed by phase 4, are back.

What this costs: a room has two appearances, and what you arrange in the piece view is not visible in the painting. In a painted room the items on low walls that phase 4 hides on the map are not drawn at all; the "+N on the walls" note on the label still counts them.

## Painted rooms: no distortion, sharper (2026-11-16)

Nato reported the rooms looked bent and pixelated. Two causes, both mine:

- **Bent.** `cut_rooms.py` mapped three floor corners of each painting onto the grid's room diamond with an affine transform, which squashed the painting vertically and skewed it. It now only scales: the painting keeps its proportions, sized so its floor is as wide as the room diamond. The painted floor is a little deeper than the grid's, and its corners are not exactly the grid's; `ROOM_CUT[...].floor` and `.top` carry the real ones, used for the hover outline, the camera frame and the label height.
- **Pixelated.** The cut-outs were exported at 2x logical, below the paintings' own resolution, and PixiJS filters draw at resolution 1 unless told otherwise, so the shell and decay filters blurred everything on a dense display. Cut-outs are now 3x (about the paintings' resolution), the filters use `resolution = 'inherit'`, and the textures have mipmaps for the small map view.
- Undistorted walls are taller (up to 202 logical px), so **hallways are 7 tiles** and the palace 23 x 23. The test that pins the hallway width to the wall height still holds.
- The spots for Nato, the helpers and the clickable things were converted to the new cut-outs by composing the old and new transforms, then checked on screenshots.

Verified: typecheck, 334 unit tests, E2E S5 9/9, the editor check 4/4, screenshots of the map and a room on a 2x display. Not verified on a 1x display.

## The spaces between the rooms (2026-11-16)

Nato asked for the places the avatar walks to be designed, and for a tidier map.

- **Walkways** (`walkways()` and `wayOut()` in `floor.ts`, pure and tested): boarded hallways with a brass edge; a carpet down the middle of each, reaching as far as the outermost room entrance; a mat in each room's colour from its hallway side to the carpet; a plaza with a round rug and four lanterns where the hallways cross. They are drawn along the same points the character's route uses, so he walks on them. Colours are new `--mp-walk-*` tokens.
- **The lobby is visible.** On the map the front room (Mail room) stands in front of the lobby. Its painting is now drawn with the top of its back corner dissolved away (`loadOpenedTexture`), so the plaza and its centrepiece show through. The room is drawn whole as soon as it is opened. Its label moved onto its left wall.
- **The map's buttons** (New chat, List view, reminders, active projects) moved from over the map to the Palace header, where they no longer cover the Coding room's label.

Verified: typecheck, 338 unit tests (4 new for the walkways), E2E S5 9/9, the editor check 4/4, a screenshot of the map. Not verified: S1 to S4 after this change; how the opened corner looks while the Mail room is in decay.

## Five of seven polish items (2026-11-16)

Nato asked for seven improvements one by one. Items 1 (painted walkways) and 7 (a painted surround) need new art from Gemini and are not done: neither Chrome window connected at the time was the profile used for generation.

- **2. Dim rooms.** A painted room takes 55% of decay's grey and darkness (`PAINTED_DECAY`), so it still reads as that room. A decayed room shows a note above it naming the quiet project and for how long, with Open it, Pause, Done and Drop; its label on the map says "dusty". The block view keeps phase 4's full decay.
- **3. Walls cover Nato.** He is no longer drawn over everything. Each frame he is placed among the room layers: after the room he is in, or just before the first room whose back walls he is behind. The paintings' front sides are open (they are cutaways), and the Mail room's painted door is where its mat arrives, so no doorway had to be painted.
- **4. Mail room corner.** The soft dissolve is replaced by a clean notch cut down the two walls towards the corner, with an outlined edge, like a section drawing (`NOTCH`).
- **5. Nato walks to what is clicked.** Clicking a thing in a room sends him to the nearest floor spot in front of it (`walkTo`), and the thing opens 450 ms later (at once with reduced motion). He waits there a while before strolling again.
- **6. First-run tour.** Four short tips in a corner card the first time the palace is opened (`PalaceGuide.tsx`), kept in localStorage, reopened with the "?" button in the header. It blocks nothing; Esc or Skip closes it. The E2E and screenshot scripts skip it; V7 checks it returns after the store is cleared.

Verified: typecheck, 338 unit tests, full E2E 38 of 38 with L3 skipped, the editor check 4/4, screenshots of a dusty room and of the tour. Not verified: Nato being covered by a wall and walking to a clicked thing, as motion (stills only).

## Painted walkways and surround (2026-11-16)

Items 1 and 7 of the polish list, with art from one Gemini chat.

- **Flat pictures laid on the floor.** The floor boards, the carpet and the round rug are painted as seen from straight above. `onFloor()` in `PalaceCanvas.tsx` is the matrix that lays such a picture onto the isometric floor, so one picture serves any hallway, in either direction. Boards and carpet are `TilingSprite`s; `scripts/cut_ground.py` mirrors each tile beside itself so it repeats without a seam.
- **Walkways**: boards on both hallways (tinted darker by `--mp-walk-tint`) and untinted on the plaza, the carpet along the route, a mat tinted with each room's colour, the rug in the lobby, and four lantern sprites. The brass edges are still drawn lines. The ground is built once per layout (`buildGround`), not on every redraw.
- **Surround**: a painted library fills the stage around the palace (`ground/surround.jpg`), in the same style as the original paintings' backgrounds.
- Gemini's "full size" download of the carpet and the lantern came back as different pictures from the previews (a room painted behind the carpet, ground under the lantern). Those two are captures of the correct previews, so they are lower resolution (carpet band 128 px tall, lantern 239 px tall). The others are the full-size downloads.

Verified: typecheck, 338 unit tests, E2E S5 9/9, the editor check 4/4, a screenshot of the map. Not verified: S1 to S4 after this change; the look on a 1x display; how the surround reads when a room is opened (the capture was disturbed).

## Music and the steward (2026-11-16)

Work from here on is on the branch `nato/palace`. PR #6 is a draft and is not to be merged for now; the direction is to be decided with Claudio.

### Music

- The palace plays one audio file the person picks from their own computer (`music:choose` opens the system file picker). Nothing is downloaded: a YouTube link was asked for first, but it was someone else's playlist.
- The renderer is sandboxed, so the main process serves the chosen file through a private scheme, `mp-media://` (`src/main/music.ts`), which only ever answers with that file. The CSP allows `media-src mp-media:`; the window's autoplay policy lets it start without a click.
- `src/renderer/src/music.ts` holds the audio element outside React; `MusicPlayer.tsx` sits at the foot of the rail with play/pause, mute, volume, Change and Remove. Volume, mute and a pause are remembered; a pause survives a restart.

### The steward (voice orders)

- **Scope, decided by the owner**: it acts only inside the app (rooms, chats, projects, reminders, music). It cannot touch files or run anything. Deleting a chat and dropping a project wait for a yes.
- **Hearing**: Whisper base, 8-bit, through `@huggingface/transformers` in the main process (`src/main/steward.ts`), about 76 MB, downloaded from Hugging Face once into `<userData>/models` the first time voice is used (`MIND_PALACE_MODELS_DIR` overrides the folder, for tests). The recording never leaves the machine. The library does not detect the language (it assumes English, which translates Spanish speech); the module compares the model's own scores for the Spanish and English language tokens and transcribes in the winner.
- **Understanding**: one call to the small model with the palace as it stands (`buildStewardPrompt`) and a JSON schema; the answer is a spoken reply, its language, and a list of actions. `checkReply` drops any action with an unknown type or an id that is not in the palace.
- **Acting**: `src/renderer/src/steward.ts` runs each action through the app's own store, the same calls the buttons make. An order that needs real work becomes a new chat; when its answer is written, the beginning is read aloud.
- **Speaking**: the system's voices through `speechSynthesis`, in the reply's language; the music is turned down while it listens and speaks. "Speak" can be switched off.
- **Using it**: the Steward pill at the foot of the window, or Cmd/Ctrl+J to start listening. It stops by itself after a pause. Orders can also be typed.
- New dependency: `@huggingface/transformers` (brings `onnxruntime-node` and `sharp`, both native).

Verified: typecheck; 352 unit tests (14 new for the steward's rules); E2E S6 (music plays a real file, pause, mute, stays paused after reload) and S7 (an order in English, one in Spanish, delete waits for yes and no cancels, and recordings made with the Mac's voices are transcribed locally in both languages); the full E2E run otherwise as before.

Not verified: a real microphone (the tests feed recordings to the transcriber directly, so the recording code, the silence detection and the macOS microphone prompt have not run); the spoken voice (switched off in tests); reading a written answer aloud; the music file picker itself (the test sets the file in the database); a packaged build, where the native speech runtime and the microphone usage description need checking.

## Importing claude.ai chats (2026-11-16)

`scripts/import-claude-ai.py` reads the claude.ai data export (the zip, its folder, or `conversations.json`) and writes each conversation as a chat with both sides and the real timestamps. Ids start with `ca-`; a second run replaces the first; nothing else is touched; the database is backed up first; secrets are replaced by the same patterns as the Claude Code import; each message's local day is stamped in the settings timezone.

Imported chats arrive unsorted and, by default, marked as already classified. Left unmarked, the app's quiet check would classify every one of them by itself on its next runs, one model call each; `--let-app-sort` asks for exactly that.

Verified on a made-up export against a copy of a real database: dry run, apply, apply again (replaces), redaction of an email and a password, an attachment named but not copied, an empty conversation left out, other chats untouched. Not verified: a real export. The format is as known in mid-2026; the script says what it found if the shape differs.
