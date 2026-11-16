# Project Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each project shows ordered milestones (done with a date, or planned) and "N of M", drafted by the model from its chats, plan files and git history, where Claudio's edits always win.

**Architecture:** The import brings Claude's answers, each Claude Code session's folder and the files it touched. Pure modules in `src/shared/` hold every rule: folder detection, repo-evidence parsing, milestone edits and proposal filtering, and the prompts. A main-process progress service runs the sweep, the per-chat digests and the draft or refresh through `askJson`, and reads git and plan files read-only. `ProjectsView` gets a progress section.

**Tech Stack:** Electron + electron-vite, React 19, Zustand, Drizzle + better-sqlite3, zod 4, Vitest, Python import scripts, playwright-core `_electron` for the UI check.

**Spec:** `docs/superpowers/specs/2026-11-16-project-progress-design.md`

## Global Constraints

- Base branch `claudio/main`; work on `feat/project-progress`.
- Colours are tokens; no `#rrggbb` / `0xrrggbb` in `src/renderer` (the theme test fails on them).
- Every model call goes through `askJson` (`src/main/chat/claude.ts`): no tools, JSON schema output, validated with zod.
- Secrets pass through the extractors' `redact` before anything is written. `import/` stays git-ignored; never commit anything in it.
- User messages are capped at `MAX_TEXT = 1500` characters; answers at **4000**.
- Refreshes never write milestone rows, only proposals. Only a project's first draft writes milestones.
- Git is read-only: `git rev-parse --show-toplevel` and `git log --branches --date=short --format="%h %ad %D %s" -n 200 -- <folder>`.
- Milestones and project state are independent: nothing here changes `projects.state` or `goal_completions`.
- DB code runs on Electron's ABI and has no unit tests; every rule it applies lives in a tested pure function.
- Windows paths: compare paths case-insensitively with `/` separators.

## Review Focus

1. **A re-import after milestones exist.** `import-into-app.py` deletes `ccp-%` projects and `cc-%` chats, so the cascades take milestones, proposals, dismissals and folders with them unless they are saved and restored. Expect them all back after a re-import. *Task 3 checks this on a database copy.*
2. **The model cites evidence that isn't there,** e.g. a commit hash not in the log or a plan line that doesn't exist. Expect the milestone to be shown as "from chats", never as confirmed. *Task 6: `interpretDraft` / `interpretRefresh` tests.*
3. **The folder is gone, isn't a repo, or git isn't installed.** Expect progress to build from chats alone, with a note on the folder line, not an error. *Task 7: `readEvidence` returns `{ commits: [], checkboxes: [], problem }`; pinned in the UI check (Task 9).*
4. **Big inputs.** 260 Mail-room candidates, chats with hundreds of long answers. Expect batches of 60 for the sweep and clipped digest input, so no call goes over its budget. *Task 6: clip tests.*
5. **Build clicked twice, or a quiet-chat refresh landing during a build.** Expect one run per project at a time, with the second call returning the current progress. *Task 7 guard; Task 9 double-click check.*

---

### Task 1: Extractors keep answers, the folder and files touched

**Files:**
- Modify: `scripts/extract-claude-code.py`, `scripts/extract-claude-web.py`

**Interfaces:**
- Produces: each session line in `import/sessions.jsonl` and `import/web-sessions.jsonl` gains `messages[].role` (`'user' | 'assistant'`). Claude Code lines keep `cwd` and gain `files: {path: edits}`. Web lines have no `files`.

- [ ] **Step 1: Write `--self-test` in `extract-claude-code.py`.** Build a temp `.jsonl` with a user row, an assistant row holding a text block and `tool_use` blocks (`Edit` with `file_path` `C:\\a\\x.ts` twice, `Write` `C:\\a\\y.md`, `Read` `C:\\a\\z.ts`), a `tool_result` user row, a sidechain assistant row and an `sk-ant-` key in the answer. Assert:
  - `messages` roles are `['user', 'assistant']`;
  - the answer has `[secret]` (whatever `redact` writes) instead of the key, and is cut to 4000;
  - `files == {'C:\\a\\x.ts': 2, 'C:\\a\\y.md': 1}` (Read not counted; the sidechain ignored).
- [ ] **Step 2: Run** `PYTHONUTF8=1 python scripts/extract-claude-code.py --self-test`. Expected: FAIL (no `--self-test`, then the role assertion).
- [ ] **Step 3: Implement.** `read_session(path) -> (session_id, cwd, messages, files)`:
  - read rows with `type` `user` or `assistant`, skipping `isSidechain` / `isMeta`;
  - assistant text through `text_of` + `clean` with an `ANSWER_MAX = 4000` cap (`clean(text, limit)`);
  - count `file_path` of `tool_use` blocks named `Edit`, `Write`, `MultiEdit`, `NotebookEdit`.
  `main()` writes `role` and `files`.
- [ ] **Step 4: Add `--self-test` to `extract-claude-web.py`** with a conversation holding a `human` and an `assistant` message. Assert both are kept in order with roles, the answer is capped at 4000, and a conversation with only assistant messages still counts as "nothing typed". Run it: FAIL, then change the `sender` filter to keep `assistant` too, mapping `human` → `user`. Run it: PASS.
- [ ] **Step 5: Run both self-tests, then both extractors for real.** Expected: the self-tests print `self-test passed`. The extractors print counts with roughly double the messages. Then `grep -c '"role": "assistant"' import/web-sessions.jsonl` is > 0.
- [ ] **Step 6: Commit.** `git add scripts/extract-claude-code.py scripts/extract-claude-web.py && git commit -m "feat(import): keep Claude's answers, each session's folder and files touched"`

### Task 2: Schema and migration

**Files:**
- Modify: `src/main/db/schema.ts`
- Create: `drizzle/0007_*.sql` (via `npm run db:generate`)

**Interfaces:**
- Produces (Drizzle tables and columns, snake_case in SQL):
  - `chats.cwd` text null.
  - `chatFiles` (`chat_files`): `chatId` → chats cascade, `path`, `edits` int; primary key (`chat_id`, `path`).
  - `projects.folder`, `projects.gitRoot`, `projects.folderSource` (`'detected' | 'user'`, null), `projects.sweptAt` (ISO, null).
  - `milestones`: `id`, `projectId` → projects cascade, `title`, `originalTitle`, `position` int, `status` (`'done' | 'planned'`), `doneOn` (`YYYY-MM-DD`, null), `evidence` (`'commit' | 'plan' | 'chat' | 'user'`), `evidenceRef` (null), `edited` bool (int 0/1) default 0, `statusByUser` bool default 0, `deletedAt` null, `createdAt`.
  - `milestoneProposals`: `id`, `projectId` cascade, `kind` (`'add' | 'tick'`), `milestoneId` (null, → milestones cascade), `title`, `afterId` (null), `evidence`, `evidenceRef`, `doneOn`, `answered` (`'accepted' | 'dismissed'`, null), `createdAt`.
  - `sweepDismissals`: (`projectId` cascade, `chatId` cascade) primary key.
  - `chatDigests`: `chatId` primary key → chats cascade, `digest` (JSON text), `throughMessageAt`.
  - Index `milestones_project_idx` on (`project_id`, `position`).

- [ ] **Step 1: Add the tables and columns** to `schema.ts`, with a doc comment on each saying what it holds, like the existing tables.
- [ ] **Step 2: Run** `npm run db:generate`. Expected: a new `drizzle/0007_*.sql` with only `CREATE TABLE` / `ALTER TABLE ADD` statements.
- [ ] **Step 3: Check the migration on a copy of the real database.** Copy `%APPDATA%/mind-palace/mind-palace.sqlite` to the scratchpad and start the dev app with `MIND_PALACE_USER_DATA` pointing at the copy's folder. Expected: it starts, and `pragma table_info(milestones)` lists the columns.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: clean, all pass.
- [ ] **Step 5: Commit** schema, migration and snapshot: `feat(db): tables for milestones, proposals, digests and project folders`.

### Task 3: Import writes answers, folders and files, and keeps progress

**Files:**
- Modify: `scripts/import-into-app.py`

**Interfaces:**
- Consumes: Task 1's session lines; Task 2's tables.
- Produces: imported `messages` with the right `role`; `chats.cwd`; `chat_files` rows. On re-import, `milestones`, `milestone_proposals`, `sweep_dismissals` and `projects.folder` / `git_root` / `folder_source` / `swept_at` are restored. `chat_digests` for re-imported chats are dropped (rebuilt by the app).

- [ ] **Step 1: Write the re-import check as a script** in the scratchpad (not committed). Copy the real DB, insert a milestone, a proposal, a sweep dismissal and a folder on project `ccp-…`, run `import-into-app.py --apply --db <copy>`, and assert all four are still there. Run it against today's script. Expected: FAIL (milestone gone).
- [ ] **Step 2: Implement.**
  - `plan()` writes `(id, chat_id, role, content, at)` from `message['role']` (default `'user'` for old lines), plus a `cwd` per chat and `files` rows.
  - `main()` adds `cwd` to the chat insert and inserts `chat_files`.
  - Before the deletes, select `milestones`, `milestone_proposals`, `sweep_dismissals` (where the project is `ccp-%` or the chat is `cc-%`) and the four project folder columns. After the inserts, re-insert them with `INSERT OR IGNORE … WHERE EXISTS` (parents present), the way `kept_links` does.
  - Print what was kept.
- [ ] **Step 3: Run the check again.** Expected: PASS. Also on the copy:
  - `select role, count(*) from messages group by role` shows both roles;
  - `select count(*) from chat_files` > 0;
  - `select count(*) from messages where role='user'` equals what it was before (2,045 plus any new chats).
- [ ] **Step 4: Commit:** `feat(import): write answers, folders and files touched; keep milestones on re-import`. Do **not** apply to the real DB here (Task 10).

### Task 4: Folder detection and repo evidence parsing (pure)

**Files:**
- Create: `src/shared/folders.ts`, `src/shared/repoEvidence.ts`
- Test: `tests/folders.test.ts`, `tests/repoEvidence.test.ts`

**Interfaces:**
- Produces:
  - `MANIFESTS: readonly string[]`: the names from the spec, with `*.csproj` / `*.ino` as suffix patterns.
  - `isManifest(fileName: string): boolean`
  - `normPath(p: string): string`: `/` separators, lower-case drive letter, no trailing slash.
  - `interface EditFact { path: string; edits: number; gitRoot: string | null }`
  - `detectFolder(facts: EditFact[], isShared: (gitRoot: string) => boolean): { folder: string; gitRoot: string } | null`
  - `interface Commit { hash: string; day: string; refs: string; subject: string }` and `parseGitLog(stdout: string): Commit[]`
  - `interface Checkbox { file: string; line: number; done: boolean; text: string }` and `parseCheckboxes(file: string, text: string): Checkbox[]`
  - `planMentions(text: string, names: string[]): boolean`: true if any name appears (folded) in the first 40 lines or the file name.

- [ ] **Step 1: Write the failing tests:**
  - single root → `{ folder: root, gitRoot: root }`;
  - shared root, edits 5 under `C:\Users\projects\tuautord\src\a.ts` and 3 under `C:\Users\projects\docs\superpowers\plans\p.md` → folder `c:/users/projects/tuautord`;
  - shared root with only `docs/` edits → `null`;
  - edits under two git roots → the one with more edits wins;
  - no `gitRoot` anywhere → `null`;
  - a tie between first-level folders → the alphabetically first (deterministic);
  - `parseGitLog` reads `a1b2c3d 2026-10-03 HEAD -> main, origin/main feat: x` into `{ hash: 'a1b2c3d', day: '2026-10-03', refs: 'HEAD -> main, origin/main', subject: 'feat: x' }` and a line with no refs;
  - `parseCheckboxes` finds `- [x]`, `- [ ]`, `* [X]` with 1-based lines and ignores fenced code blocks;
  - `planMentions('# TuAutoRD plan', ['tuautord'])` is true, and it's false when the name appears only on line 41.
- [ ] **Step 2: Run** `npx vitest run tests/folders.test.ts tests/repoEvidence.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** to the signatures.
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(progress): folder detection and repo evidence parsing`.

### Task 5: Milestone rules (pure)

**Files:**
- Create: `src/shared/milestones.ts`
- Test: `tests/milestones.test.ts`

**Interfaces:**
- Produces:
  - `type Evidence = 'commit' | 'plan' | 'chat' | 'user'`
  - `interface Milestone { id; title; originalTitle; position; status: 'done' | 'planned'; doneOn: string | null; evidence: Evidence; evidenceRef: string | null; edited: boolean; statusByUser: boolean; deletedAt: string | null }`
  - `interface Proposal { id; kind: 'add' | 'tick'; milestoneId: string | null; title; afterId: string | null; evidence: Evidence; evidenceRef: string | null; doneOn: string | null; answered: 'accepted' | 'dismissed' | null }`
  - `type MilestoneEdit = { kind: 'tick'; id; done: boolean; doneOn?: string } | { kind: 'rename'; id; title } | { kind: 'move'; id; toIndex: number } | { kind: 'add'; title; afterId: string | null } | { kind: 'delete'; id }`
  - `foldTitle(t: string): string`: the same folding as `areaKey`, reusing it.
  - `applyEdit(list: Milestone[], edit: MilestoneEdit, ctx: { today: string; now: string; newId: () => string }): Milestone[]`: returns the whole new list with positions 0..n-1 over live rows.
  - `filterProposals(fresh: Omit<Proposal,'id'|'answered'>[], milestones: Milestone[], past: Proposal[]): Omit<Proposal,'id'|'answered'>[]`
  - `acceptProposal(list: Milestone[], p: Proposal, ctx): Milestone[]`: an accepted add inserts after `afterId` (end if missing); an accepted tick sets done with the proposal's evidence and `doneOn`.
  - `progressOf(list: Milestone[]): { done: number; total: number } | null`
  - `interface ProjectProgress { projectId; milestones: Milestone[]; proposals: Proposal[]; progress: { done; total } | null; folder: string | null; folderSource: 'detected' | 'user' | null; folderProblem: string | null; sweptAt: string | null; running: boolean }`

- [ ] **Step 1: Write the failing tests:**
  - `applyEdit`:
    - tick sets `status 'done'`, `evidence 'user'`, `doneOn` today (or the given day), `statusByUser`, `edited`;
    - untick clears `doneOn` and sets `statusByUser`;
    - rename keeps `originalTitle`;
    - move renumbers;
    - add sets `originalTitle = title` and `edited`;
    - delete sets `deletedAt` and drops the row from positions.
  - `filterProposals`:
    - an add matching a live title, a deleted title, an original title after a rename (accent and case differences), or a dismissed add → dropped;
    - a tick on a `statusByUser` milestone → dropped;
    - a tick whose (`milestoneId`, `evidence`, `evidenceRef`) matches a dismissed tick → dropped, while the same milestone with a new `evidenceRef` → kept;
    - a tick on a milestone that's already done → dropped;
    - two identical fresh adds → one kept.
  - `acceptProposal` for both kinds.
  - `progressOf`: `null` for no live milestones; `{ done: 2, total: 3 }` ignoring deleted rows.
- [ ] **Step 2: Run** `npx vitest run tests/milestones.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(progress): milestone edits, proposal filtering and progress`.

### Task 6: Prompts for the sweep, digests, draft and refresh (pure)

**Files:**
- Create: `src/shared/progressPrompts.ts`
- Test: `tests/progressPrompts.test.ts`

**Interfaces:**
- Consumes: `Milestone`, `Proposal`, `Evidence` (Task 5); `Commit`, `Checkbox` (Task 4).
- Produces, for each of `SWEEP`, `DIGEST`, `DRAFT`, `REFRESH`: `*_SYSTEM_PROMPT`, `*_JSON_SCHEMA`, a zod `*Schema`, a `build*Prompt` and an `interpret*`. The required keys must keep the fake model's dispatch unique:
  - `buildSweepPrompt({ project: { title }, linked: AreaChat[], candidates: Array<{ id } & AreaChat> }): string`; schema `{ chat_ids: string[] }`; `interpretSweep(raw, candidateIds): string[]` keeps only known ids, deduped.
  - `SWEEP_BATCH = 60`.
  - `buildDigestPrompt({ title, messages: Array<{ role; content; day }> }): string` clips to `DIGEST_INPUT_MAX = 40_000` characters, keeping the newest when it must cut and noting how much was left out; schema `{ done: { item: string; day: string }[]; planned: string[] }`; `interpretDigest(raw): ChatDigest`, with days not matching `YYYY-MM-DD` dropped.
  - `type ChatDigest = { done: { item: string; day: string }[]; planned: string[] }`.
  - `buildDraftPrompt({ title, digests: Array<{ chatId; title; digest: ChatDigest }>, commits: Commit[], checkboxes: Checkbox[] }): string`; schema `{ milestones: { title; status; done_on; evidence; evidence_ref }[] }`; `interpretDraft(raw, known: { commitHashes: Set<string>; checkboxRefs: Set<string>; chatIds: Set<string> }): Array<Omit<Milestone, 'id'|'position'|'edited'|'statusByUser'|'deletedAt'|'originalTitle'>>`.
  - `buildRefreshPrompt({ title, milestones: Milestone[], digests, commits, checkboxes }): string` lists each milestone with its id and whether Claudio edited it; schema `{ proposals: { kind; milestone_id; title; after_id; evidence; evidence_ref; done_on }[] }`; `interpretRefresh(raw, known & { milestoneIds: Set<string> })`.
  - Evidence refs: a commit is its short hash; a checkbox is `"<file>:<line>"`; a chat is its chat id.
- [ ] **Step 1: Write the failing tests:**
  - each schema's `required` array matches its zod schema, and no two prompts share required keys with `materialize` (`items`), `grouping` (`areas`) or each other;
  - `interpretDraft` downgrades a `commit` milestone whose hash isn't in `commitHashes` to `evidence 'chat'` with no ref, and does the same for a missing checkbox ref; a `done` milestone without a valid `done_on` gets `doneOn: null`; titles are trimmed and capped at 80; at most 20 milestones;
  - `interpretRefresh` drops a `tick` whose `milestone_id` is unknown and nulls an unknown `after_id`;
  - `buildDigestPrompt` with 60,000 characters of messages stays ≤ 41,000 characters and says how much was left out;
  - `interpretSweep` ignores ids not in the batch;
  - the draft and refresh system prompts say a milestone is a meaningful step (not a single commit), name the evidence rule, and say to answer in JSON only.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement,** in the style of `roomPrompts.ts`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(progress): prompts for the sweep, digests, draft and refresh`.

### Task 7: Main process, the progress service

**Files:**
- Create: `src/main/progress/repo.ts`, `src/main/progress/evidence.ts`, `src/main/progress/service.ts`
- Modify: `src/main/index.ts` (fake model dispatch + an `askChatModel` beside `askSmallModel`)

**Interfaces:**
- Consumes: Tasks 2, 4, 5, 6.
- Produces:
  - `readEvidence(folder: string, gitRoot: string, shared: boolean, names: string[]): Promise<{ commits: Commit[]; checkboxes: Checkbox[]; problem: string | null }>`. Uses `execFile('git', …, { cwd, timeout: 15000 })` and walks for `.md` files, skipping `node_modules` and dot-folders, at most 20 files with checkboxes, newest first. It **never throws**: any failure sets `problem`.
  - `gitRootOf(dir: string): Promise<string | null>` and `isSharedRoot(root: string): Promise<boolean>`: true when ≥ 2 first-level folders contain a file for which `isManifest` is true.
  - `createProgressService(deps: { store; askSmall: AskModel; askChat: AskModel; onChanged: (projectId: string) => void; today: () => string; now?: () => Date })` returning:
    - `get(projectId): ProjectProgress`
    - `sweep(projectId): Promise<Array<{ id: string; title: string; firstMessage: string }>>`: candidates are chats in the project's room plus the Mail room, unlinked to any project, not in `sweep_dismissals` for it, and newer than `sweptAt` if set; batches of `SWEEP_BATCH`; sets `sweptAt`.
    - `link(projectId, accept: string[], dismiss: string[]): ProjectProgress`: inserts `project_chats`, inserts `sweep_dismissals`, moves an accepted chat from the Mail room to the project's room only if its `room_source` isn't `'user'`, then `detectAndStoreFolder`.
    - `build(projectId): Promise<ProjectProgress>`: digests for linked chats whose `throughMessageAt` < their last message (small model), evidence, the draft (chat model), and writes milestones only if the project has none (otherwise it behaves as `refresh`).
    - `refresh(projectId): Promise<ProjectProgress>`: the same inputs, then `filterProposals` and inserts proposals; never writes milestone rows.
    - `edit(projectId, edit: MilestoneEdit): ProjectProgress`: persists `applyEdit`'s result.
    - `answer(proposalId, accept: boolean): ProjectProgress`.
    - `setFolder(projectId, folder: string | null): Promise<ProjectProgress>`: a folder sets `folder_source 'user'` and its git root; null clears it and sets `'user'` so detection leaves it alone.
    - `detectAndStoreFolder(projectId): Promise<void>`: skips projects with `folder_source = 'user'`. It builds `EditFact`s from the linked chats' `chat_files`, with `gitRoot = await gitRootOf(dirname(path))` (cached per directory; missing directories give `null`), calls `detectFolder(facts, root => sharedRoots.has(root))` after resolving `isSharedRoot` for each root seen, and stores `folder`, `git_root`, `folder_source = 'detected'`. `build` also calls it first when the project has no folder.
  - Model failure: `build`, `refresh` and `sweep` throw `Error('Building progress failed: …')`, like `findAreas`. Nothing is written for the step that failed, but digests already saved stay saved.
    - `afterChatQuiet(chatId): void`: refreshes each project linking that chat that already has milestones.
  - A per-project in-flight set: `build` / `refresh` on a running project returns `get()` with `running: true` and starts nothing.
  - The fake model, in `index.ts`: `chat_ids` → `sweep`, `done` + `planned` → `digest`, `milestones` → `draft`, `proposals` → `refresh`.
- [ ] **Step 1: Implement `evidence.ts`, `repo.ts` and `service.ts`.** All rules come from Tasks 4–6; this layer only reads, calls and writes. Each write that touches more than one table happens in one `store.db.transaction`.
- [ ] **Step 2: Wire it in `index.ts`.** Create the service; call `afterChatQuiet` from the classifier's quiet pass for each chat it classifies (add an `onQuiet` hook to `ClassifierDeps` if one isn't there); add `askChatModel` using `model.chat` / `DEFAULT_CHAT_MODEL`; extend `fakeAnswer`.
- [ ] **Step 3: Run** `npm run typecheck && npm test`. Expected: clean, all pass.
- [ ] **Step 4: Commit:** `feat(progress): service for the sweep, digests, draft, refresh and edits`.

### Task 8: IPC, store and the progress view

**Files:**
- Modify: `src/shared/ipc.ts`, `src/main/index.ts`, `src/renderer/src/store.ts`, `src/renderer/src/components/ProjectsView.tsx`, `src/renderer/src/styles.css`
- Create: `src/renderer/src/components/ProjectProgress.tsx`

**Interfaces:**
- Produces these IPC channels, each listed in the channel array the way `rooms:*` are:
  - `progress:get` `{ projectId }` → `ProjectProgress`
  - `progress:sweep` `{ projectId }` → `{ candidates: Array<{ id; title; firstMessage }> }`
  - `progress:link` `{ projectId; accept: string[]; dismiss: string[] }` → `ProjectProgress`
  - `progress:build` / `progress:refresh` `{ projectId }` → `ProjectProgress`
  - `progress:edit` `{ projectId; edit: MilestoneEdit }` → `ProjectProgress`
  - `progress:answer` `{ projectId; proposalId; accept: boolean }` → `ProjectProgress`
  - `progress:folder` `{ projectId; folder: string | null }` → `ProjectProgress`; "Change" opens a folder dialog in main (`dialog.showOpenDialog({ properties: ['openDirectory'] })`) when `folder` is the string `'pick'`.
  - AppEvent `{ type: 'progress_changed'; projectId }`.
- [ ] **Step 1: Add the channels and handlers,** and store actions named after the channels (`loadProgress`, `sweepProject`, `linkChats`, `buildProgress`, `refreshProgress`, `editMilestone`, `answerProposal`, `setProjectFolder`), with progress kept per project id. Reload on `progress_changed`.
- [ ] **Step 2: Build `ProjectProgress.tsx`,** opened from a "Progress" toggle on each `ProjectCard`, in this order (from the spec's §6):
  1. the progress line "4 of 7" with a bar;
  2. the proposals block ("Claude thinks these changed", Accept / Dismiss / Accept all);
  3. the milestone list: tick box, title (click to rename, Enter saves, Escape cancels), date for done ones, an evidence mark (`commit` / `plan` → "confirmed", `chat` → "from chats", `user` → nothing), up/down buttons for order (keyboard-reachable; drag optional), delete;
  4. "Add milestone";
  5. the folder line (path or "No folder", `folderProblem` in muted text, Change / Clear);
  6. "Find more chats" and "Refresh".
  
  With no milestones, it shows only "Build progress". The sweep's result is its own card: checkboxes all ticked, then "Link these" (unticked chats are sent as `dismiss`), which then runs `build`. Buttons are disabled while `running`.
- [ ] **Step 3: Style with tokens only** (`--color-brass`, `--color-paper`, `--color-gold`, `--color-muted` through Tailwind classes or `color-mix`).
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: clean; the theme test passes.
- [ ] **Step 5: Commit:** `feat(progress): progress view on project cards`.

### Task 9: The UI check with a fake model

**Files:**
- Create: `scripts/progress-shots.mjs`, `tests/fixtures/progress-fake.json`

**Interfaces:**
- Consumes everything above. Follows `scripts/palace-shots.mjs`: a temp `MIND_PALACE_USER_DATA`, a first launch to migrate, seed, relaunch with `MIND_PALACE_FAKE_MODEL`.

- [ ] **Step 1: Seed.** A project with 1 linked chat, and 3 Mail-room chats with answers. The project's `folder` points at a temp git repo the script makes (`git init`, two commits, `docs/plan.md` with `- [x] Login` and `- [ ] Payments`). The fake answers:
  - the sweep returns 2 of the 3 chats;
  - the draft has 4 milestones: one cites a real hash, one a hash not in the log, one the plan line, one planned;
  - the refresh proposes one add and one tick.
- [ ] **Step 2: Drive and assert, saving screenshots to `test-report/progress/`:**
  - "Build progress" → sweep card lists 2 → untick one → "Link these" → "2 of 4" and the bar show;
  - the made-up hash shows "from chats", the real one "confirmed";
  - double-clicking "Refresh" makes one proposal set, not two;
  - rename one milestone and untick another; "Refresh" → the proposals don't touch either; accept the add → "2 of 5";
  - quit and relaunch → everything is still there;
  - set the folder to a missing path → the view still builds and shows the folder problem.
- [ ] **Step 3: Run** `npx electron-vite build && node scripts/progress-shots.mjs`. Expected: every check passes, then look at the screenshots.
- [ ] **Step 4: Commit:** `test(progress): UI check with a fake model and a temp repo`.

### Task 10: Real data, eval and notes

**Files:**
- Create: `scripts/eval-progress.json` (3 of Claudio's projects with hand-written milestones, filled in with him)
- Modify: `NOTES.md`

- [ ] **Step 1: Re-run both extractors** and `import-into-app.py --apply` on the real database. The app must be quit first, and the script makes the backup. Expected: printed counts match Task 3's copy run; the Software room keeps its 12 chats.
- [ ] **Step 2: Build progress for three real projects** (Mind Palace, Dr Samir backend, and one claude.ai-only project). Ask Claudio to write each one's milestones in `scripts/eval-progress.json` before looking at the drafts, then record matches, misses and extras in `NOTES.md`.
- [ ] **Step 3: Write a `NOTES.md` section** with what was built, what was verified, the eval numbers and what was not verified, in the style of the existing sections.
- [ ] **Step 4: Commit:** `docs(notes): project progress, real-data run and eval`.
