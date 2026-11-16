# Project progress: milestones drafted from chats and repos

Status: design, 2026-11-16. Base branch: `claudio/main`.

## Why

A project in the palace is a title, a room, a state and one to three linked chats. Nothing says how far along it is. Claudio wants to open a project and see **how close to done it is, which milestones are behind him and which are still ahead**, without writing any of it himself.

## Goals

- Each project shows an ordered list of milestones, each **done** (with the date it happened) or **planned**, and a progress figure: done out of total, e.g. "4 of 7".
- The model drafts the milestones. Claudio can rename, reorder, tick, untick, add and delete them, and **his edits always win**: a refresh never changes or brings back anything he edited or deleted. It only proposes.
- Old history counts: the 448 imported chats feed the projects they belong to, not only chats linked from now on.
- Where a project has a folder on disk, plan checkboxes and git history count as evidence, and the view shows which milestones are backed by a commit or a ticked plan and which are the model's reading of the chats.

## Non-goals

- **Dates for planned milestones, estimates, a timeline.** Claudio chose to skip them for now. Done milestones carry the date they happened; planned ones carry only their order.
- Running anything in a project folder beyond read-only `git log` and reading files (Phase 6 is separate).
- Creating new projects from the sweep. It links chats to an existing project only.
- Attachments and files from claude.ai chats.
- Stage 3's room panel (`RoomPanel.tsx` on `main`). This branch's UI goes in `ProjectsView`; the room panel picks it up when the two lines are synced.

## Anti-goals

- A refresh that silently moves, renames, re-ticks or resurrects something Claudio changed. That would break the app's main promise (the same rule as placed furniture).
- Showing a guess as a fact: a milestone ticked only because a chat suggests it is shown differently from one backed by a commit or a plan checkbox.
- A per-project first run that burns tokens without being asked: the first draft of a project starts from a button.

## Constraints

- Colours are tokens; no hex in components (the theme test enforces it).
- Model calls go through `askJson` (`src/main/chat/claude.ts`): no tools, isolated environment, JSON schema output.
- Imports stay git-ignored. Secrets are masked by the extractors' `redact` before anything is stored.
- Re-importing must keep everything the app has made (rooms, links, project state, and now milestones), as `import-into-app.py` already does for rooms and projects.
- Windows paths and a shared repo (`C:\Users\projects` holds many projects) must work.

## Approaches considered

1. **Linked chats only.** Draft from the chats already linked. Cheapest, but most projects have 1–3 linked chats, so old projects would get a thin sketch.
2. **Room sweep, then draft.** On a project's first run, the model reads the chats in its room and the Mail room in batches, proposes which belong, Claudio accepts them in one step, then milestones are drafted from all linked chats. Fixes the linking gap once; costs more on the first run.
3. **Sweep, plus the repo.** Same as 2, plus plan checkboxes and git history for projects with a folder.

**Chosen: 3.** Claudio pointed out that a project with git history already has a folder, so no folder picker is needed: the folder is found from the linked Claude Code chats (where the session ran and which files it touched) and shown on the project to correct. Projects that live only in claude.ai chats use chats alone.

## Design

### 1. Import brings Claude's answers, the folder and the files touched

- `extract-claude-web.py` keeps assistant messages too (`role: 'assistant'`), text blocks only, through the same `clean`/`redact`. Attachments and files stay out.
- `extract-claude-code.py` keeps assistant text blocks (not tool calls, not tool results, not sidechains) and, per session, the **files touched**: the `file_path` of every `Edit`, `Write`, `MultiEdit` and `NotebookEdit` tool call, with how often. It keeps `cwd` as it does now.
- Cap: user messages stay at `MAX_TEXT = 1500` characters; answers are capped at **4,000** (my call: long enough for a plan, short enough to keep the database reasonable).
- The database gets:
  - `chats.cwd` (text, nullable): where a Claude Code session ran.
  - `chat_files(chat_id, path, edits)`: files a session touched.
- `import-into-app.py` writes both roles and the new columns. It deletes `ccp-%` projects and `cc-%` chats before re-inserting them, so foreign-key cascades would wipe the new tables. It must save and restore milestones, proposals, sweep dismissals and project folders the way it already restores links. Digests and `chat_files` are rebuilt from the fresh import instead.
- Note from the data: only the 21 Claude Code sessions came with project labels, so imported projects come from them, and only those can have a folder. The 427 claude.ai chats reach a project only through the sweep.
- Expect roughly double the messages and a much larger database; this was accepted.

### 2. A project's folder

- `projects.folder` (text, nullable) and `projects.folder_source` (`'detected' | 'user'`).
- **Detection**, from the project's linked chats that have `chat_files`:
  1. Take every touched path; find each one's git root (`git rev-parse --show-toplevel` from the file's directory; missing files or folders are skipped).
  2. Use the git root most of the edits fall under.
  3. **Shared or single.** A git root is *shared* when its first-level folders include two or more that each hold a project manifest (`package.json`, `pyproject.toml`, `requirements.txt`, `Cargo.toml`, `go.mod`, `*.csproj`, `platformio.ini`, `*.ino`). Otherwise it is *single*. *(My call.)*
  4. **Single root:** the folder is the git root.
  5. **Shared root:** the folder is the first-level folder that holds **the most** edits, not counting `docs/` and dot-folders (sessions that wrote a plan in the root's `docs/` also edit the project). If no first-level folder holds any edits, there is no folder. In practice: edits under `C:\Users\projects\tuautord\src\...` and `C:\Users\projects\docs\superpowers\plans\...` give `C:\Users\projects\tuautord`.
  6. No touched files, or no git root: no folder.
  7. `projects.git_root` stores the root alongside, for the plan lookup and `git log` below.
- Detection runs after links change. A folder Claudio set (`folder_source = 'user'`) is never replaced. He can also clear it.
- The folder is shown on the project with "Change" and "Clear".

### 3. The sweep: finding a project's chats

- Candidates: chats in the project's room and in the Mail room, not linked to any project, and not already dismissed for this project.
- The model gets the project's title, its linked chats' titles and first lines, and a batch of up to **60** candidates (title + first user message, trimmed), and returns the ids that belong. Batches like `findAreas` (`roomService.ts`).
- Result: a list of proposed chats with a checkbox each, all ticked, and "Link these". Unticked ones are recorded as dismissed for this project and not offered again.
- A linked chat in the Mail room moves into the project's room only if its `room_source` is not `'user'`. A chat Claudio placed stays where he put it.
- The sweep runs as part of a project's first run, and again from "Find more chats" on the project. It only looks at chats new since its last run.

### 4. Milestones

Table `milestones`:

| Column | Meaning |
| --- | --- |
| `id`, `project_id` | |
| `title` | Short, e.g. "Backend deployed on EC2". |
| `position` | Order in the list. |
| `status` | `done` or `planned`. |
| `done_on` | Local day it happened, for done ones (from the evidence's date), nullable. |
| `evidence` | `commit`, `plan`, `chat` or `user`: what backs the status. |
| `evidence_ref` | Commit hash, plan file and line, or chat id. |
| `edited` | True once Claudio changed anything about it. |
| `deleted_at` | Set when he deletes it; the row stays as a tombstone. |
| `created_at` | |

Table `milestone_proposals`: `id`, `project_id`, `kind` (`add` or `tick`), `milestone_id` (for `tick`), `title`, `position_after` (for `add`), `evidence`, `evidence_ref`, `done_on`, `answered` (`accepted` / `dismissed`, nullable), `created_at`.

Rules:
- **First draft** of a project writes milestones directly (there is nothing of Claudio's to protect yet), all with `edited = false`.
- **Every later refresh only writes proposals.** It never edits a milestone row. It can propose a new milestone, or propose ticking a planned one with evidence.
- Ticking, unticking, renaming, reordering, adding or deleting by hand sets `edited = true` (a hand tick sets `evidence = 'user'` and today's date unless he picks one).
- Milestones also keep `original_title` (the title it was drafted or added with) and `status_by_user` (true once he ticked or unticked it by hand).
- Filtering proposals before they are shown *(my calls)*. Titles are compared case- and accent-folded, like `areaKey`:
  - **`add`** is dropped when its title matches any milestone's current or original title (deleted ones included), or a dismissed `add`.
  - **`tick`** is dropped when the milestone's status was set by hand (`status_by_user`), or when a tick for that milestone with the **same evidence** (`evidence` + `evidence_ref`) was dismissed. A tick backed by new evidence, such as a later commit, can still be offered.
- Progress: done ÷ (done + planned), over rows without `deleted_at`. Shown as "4 of 7" and a bar. No milestones: no figure.
- **Milestones and project state are independent** *(my call)*. "7 of 7" does not mark the project done, and marking a project done ticks nothing. Done projects add goal completions that feed room unlocks, so that stays a deliberate act.

### 5. Drafting and refreshing

Two steps, so a refresh does not reread every chat:

1. **Chat digests.** For each linked chat, a cheap model (Haiku) writes a digest: what was done, what was planned, with the day of each item. Stored in `chat_digests(chat_id, digest, through_message_at)` and rebuilt only when the chat has newer messages.
2. **Milestone draft.** A stronger model (the app's chat model) gets the project title, the current milestones (with which ones Claudio edited), the digests in date order, and, when there is a folder, the repo evidence. It returns milestones (first draft) or proposals (refresh) as JSON validated with zod.

Repo evidence, read-only, from `projects.folder`:
- Plan files: Markdown files with checkboxes (`- [ ]` / `- [x]`), `node_modules` and dot-folders skipped, at most 20 files, newest first, from two places:
  - under the project folder;
  - in a shared root, also under the root's `docs/` (where `C:\Users\projects` keeps every project's plans), but only files whose name or first 40 lines mention the project folder's name or the project title. *(My call.)*
  Each checkbox line goes in with its file and ticked state.
- Git: `git log --branches --date=short --format="%h %ad %D %s" -n 200 -- <folder>` (on a shared root, scoped to the folder; on a single root, the whole repo). **All local branches**, not only the checked-out one, so finished work on an unmerged branch (like everything on `claudio/main`) counts, and the evidence doesn't change with whatever happens to be checked out. Remote-only and deleted branches are not read. *(My call; the cost is that work on an abandoned local branch can count as done until the branch is deleted.)*
- A milestone ticked from a commit or a plan checkbox gets that evidence; one ticked from chats alone gets `chat`.

Triggers:
- **First run**: a "Build progress" button on a project with no milestones. It runs the sweep, waits for "Link these", then digests and drafts.
- **Refresh**: "Refresh" on the project, and automatically when a linked chat goes quiet (the classifier's quiet check, `runQuietChecks`), proposals only.
- Errors leave what exists untouched and show a retry, like `findAreas`.

### 6. The view

In `ProjectsView`, a project card opens to its progress:

- Progress line: "4 of 7" with a bar (token colours).
- The milestone list in order: a tick box, the title, the date for done ones, and a small mark for the evidence: **commit** or **plan** (confirmed) versus **from chats** (the model's reading). Drag to reorder; click a title to rename; a delete control; "Add milestone" at the end.
- Proposals above the list when there are any: "Claude thinks these changed", each with Accept / Dismiss, and "Accept all".
- The folder line: path, or "No folder", with Change / Clear.
- "Find more chats" and "Refresh", and the first run's "Build progress".
- The sweep's result as its own card: the proposed chats with checkboxes and "Link these".

## Left to the builder

- Exact prompts (tested the way `roomPrompts.ts` is), batch trimming, the digest format, and the zod schemas.
- The migration number and Drizzle details.
- How the card lays out on narrow windows; the drag interaction.
- Whether the digest model is Haiku or the classifier's model setting, as long as it is the cheap one.
- An eval: a few of Claudio's projects with hand-written milestones, scored like `scripts/eval-rooms.json`.
