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

8. **Base and shared items are not declared anywhere in the catalog.**
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

