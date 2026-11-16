/**
 * End-to-end run of the test matrix against the built app (`npm run build` first).
 *
 *   node tests/e2e/run.mjs            run everything
 *   node tests/e2e/run.mjs --only S2  run one session (S1 to S5)
 *
 * Drives the real Electron app with Playwright, with its own user-data folder
 * per session so the real database is never touched. Chat and classifier
 * cases call Claude through the local Claude Code login and use plan limits.
 * Writes test-report/results.json and screenshots; report.mjs turns them into a PDF.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = join(root, 'test-report')
const shotDir = join(outDir, 'screenshots')
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null

rmSync(shotDir, { recursive: true, force: true })
mkdirSync(shotDir, { recursive: true })

/** @type {Array<Record<string, unknown>>} */
const results = []
const log = (text) => process.stdout.write(`${text}\n`)

// ---------------------------------------------------------------- helpers

function cleanEnv(extra = {}) {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    // Variables of the Claude Code session this may be launched from would redirect the SDK.
    if (/^(ANTHROPIC_|CLAUDE_|CLAUDECODE)/.test(key)) continue
    if (value !== undefined) env[key] = value
  }
  return { ...env, ...extra }
}

async function launch(userData, extraEnv = {}) {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.'],
    cwd: root,
    env: cleanEnv({ MIND_PALACE_USER_DATA: userData, ...extraEnv })
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: 'New chat' }).or(page.getByRole('heading', { level: 1 })).first().waitFor({ timeout: 30_000 })
  // The app opens on the palace with the rail collapsed. These cases were written
  // against the chat list and the new-chat screen, so open both when signed in.
  const showChats = page.getByRole('button', { name: 'Show chats' })
  if (await showChats.count()) {
    await showChats.click()
    await page.locator('aside').getByRole('button', { name: 'New chat' }).click()
    await page.getByLabel('Message', { exact: true }).waitFor({ timeout: 10_000 })
  }
  return { app, page }
}

/** Waits for a line in the activity strip, opening the strip when the line is not the newest. */
async function activityLine(page, pattern, timeout = 10_000) {
  const strip = page.locator('footer[aria-label="Activity"]')
  await until(
    async () => {
      const more = strip.getByRole('button', { name: /more$/ })
      if (await more.count()) await more.click()
      return (await strip.getByText(pattern).count()) > 0
    },
    { timeout, every: 300, what: `the activity line ${pattern}` }
  )
}

const dbPath = (userData) => join(userData, 'mind-palace.sqlite')
const sql = (userData, statements) =>
  execFileSync('sqlite3', [dbPath(userData), `pragma foreign_keys=on; ${statements}`], { encoding: 'utf8' }).trim()

async function until(check, { timeout = 60_000, every = 500, what = 'condition' } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeout / 1000}s waiting for ${what}`)
    await new Promise((r) => setTimeout(r, every))
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

const stopButton = (page) => page.getByRole('button', { name: 'Stop', exact: true })
const sendButton = (page) => page.getByRole('button', { name: 'Send', exact: true })
const messageBox = (page) => page.getByLabel('Message', { exact: true })
const chatRow = (page, title) => page.locator('nav[aria-label="Chats"] li', { hasText: title }).first()
const groupNames = (page) => page.locator('nav[aria-label="Chats"] h2').allInnerTexts()
// Project cards only: sidebar chat rows are `li` too and their titles can contain a project's.
const projectCard = (page, title) => page.locator('li.bg-ink-soft', { hasText: title }).first()

async function send(page, text) {
  await messageBox(page).fill(text)
  await messageBox(page).press('Enter')
}

async function answerFinished(page, timeout = 180_000) {
  await stopButton(page).waitFor({ state: 'visible', timeout: 30_000 })
  await stopButton(page).waitFor({ state: 'hidden', timeout })
  await sendButton(page).waitFor({ state: 'visible', timeout: 10_000 })
}

let shotCount = 0
async function shot(page, id, caption) {
  const file = `${String(++shotCount).padStart(2, '0')}-${id}.png`
  await page.screenshot({ path: join(shotDir, file) })
  return { file: `screenshots/${file}`, caption }
}

/**
 * Runs one case and records it. `fn` returns `{ observed, screenshots }`;
 * throwing marks the case failed with the error as what was observed.
 */
async function testCase(def, fn) {
  const started = Date.now()
  const entry = { ...def, status: 'pass', observed: '', screenshots: [] }
  try {
    const out = (await fn()) ?? {}
    entry.observed = out.observed ?? 'As expected.'
    entry.screenshots = out.screenshots ?? []
  } catch (error) {
    entry.status = 'fail'
    entry.observed = error instanceof Error ? error.message.split('\n')[0] : String(error)
    entry.screenshots = def.failShot ? [await def.failShot().catch(() => null)].filter(Boolean) : []
  }
  entry.seconds = Math.round((Date.now() - started) / 100) / 10
  results.push(entry)
  log(`${entry.status === 'pass' ? 'PASS' : 'FAIL'}  ${def.id}  ${def.title}${entry.status === 'fail' ? `\n      ${entry.observed}` : ''}`)
  return entry.status === 'pass'
}

function notRun(def, reason) {
  results.push({ ...def, status: 'not_run', observed: reason, screenshots: [], seconds: 0 })
  log(`SKIP  ${def.id}  ${def.title}`)
}

const iso = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString()
const q = (text) => `'${String(text).replace(/'/g, "''")}'`

// ---------------------------------------------------------------- S1: launch and live chat

async function sessionChat() {
  const userData = mkdtempSync(join(tmpdir(), 'mind-palace-e2e-chat-'))
  let { app, page } = await launch(userData)
  const failShot = () => shot(page, 'failure', 'State when the case failed')
  const CODE_TITLE = 'Show a Python function that reverses a string'

  await testCase(
    {
      id: 'A1', area: 'Launch', title: 'First launch shows the empty chat screen',
      steps: ['Start the app with an empty user-data folder.'],
      expected: 'The window opens on "New chat" with an empty chat list ("No chats yet.") and a message box.',
      failShot
    },
    async () => {
      await page.getByText('No chats yet.').waitFor({ timeout: 10_000 })
      expect(await messageBox(page).isVisible(), 'the message box is not visible')
      return { screenshots: [await shot(page, 'A1-empty', 'A1 · First launch: empty chat list and the new-chat screen')] }
    }
  )

  await testCase(
    {
      id: 'A2', area: 'Launch', title: 'Catalog and database are ready',
      steps: ['Ask the main process for its status over IPC.'],
      expected: 'Four rooms from the catalog, and the seven tables of the data model in a new database inside the user-data folder.',
      failShot
    },
    async () => {
      const status = await page.evaluate(() => window.mindPalace.status())
      const rooms = status.rooms.map((r) => r.id).sort().join(', ')
      expect(rooms === 'art, coding, mailroom, music', `rooms were: ${rooms}`)
      const tables = status.tables.join(', ')
      expect(tables === 'chats, goal_completions, messages, placements, project_chats, projects, reminders, settings', `tables were: ${tables}`)
      expect(status.databasePath.startsWith(userData), `database was created at ${status.databasePath}`)
      return { observed: `Rooms: ${rooms}. Tables: ${tables}.` }
    }
  )

  await testCase(
    {
      id: 'C1', area: 'Chat', title: 'An empty message cannot be sent; Shift+Enter adds a line',
      steps: ['Leave the message box empty.', 'Type a line, press Shift+Enter, type another line.'],
      expected: 'Send is disabled while the box is empty. Shift+Enter inserts a line break and sends nothing.',
      failShot
    },
    async () => {
      expect(await sendButton(page).isDisabled(), 'Send was enabled with an empty box')
      await messageBox(page).fill('   ')
      expect(await sendButton(page).isDisabled(), 'Send was enabled with only spaces')
      await messageBox(page).fill('first line')
      await messageBox(page).press('Shift+Enter')
      await messageBox(page).pressSequentially('second line')
      const value = await messageBox(page).inputValue()
      expect(value === 'first line\nsecond line', `box held ${JSON.stringify(value)}`)
      expect(sql(userData, 'select count(*) from chats') === '0', 'a chat was created')
      await messageBox(page).fill('')
    }
  )

  await testCase(
    {
      id: 'P1', area: 'Projects', title: 'Projects panel with no projects',
      steps: ['Open Projects from the sidebar.'],
      expected: 'An empty-state message explaining that chats will offer to be tracked.',
      failShot
    },
    async () => {
      await page.getByRole('button', { name: 'Projects', exact: true }).click()
      await page.getByText('No projects yet.').waitFor({ timeout: 10_000 })
      const s = await shot(page, 'P1-empty-projects', 'P1 · Projects panel before any project exists')
      await page.getByRole('button', { name: 'New chat' }).click()
      return { screenshots: [s] }
    }
  )

  await testCase(
    {
      id: 'C2', area: 'Chat', title: 'A question is answered as a stream, with markdown rendered',
      steps: [
        'Send: "Show a Python function that reverses a string, then list two edge cases as bullets. No web search."',
        'Watch while the answer is being written.',
        'Wait for it to finish.'
      ],
      expected:
        'While answering, the text grows, a status line shows and Send is replaced by Stop. When done, the answer has a code block and a bullet list, the chat appears under "Unsorted", and both messages are stored with token counts.',
      failShot
    },
    async () => {
      await send(page, 'Show a Python function that reverses a string, then list two edge cases as bullets. No web search.')
      await stopButton(page).waitFor({ state: 'visible', timeout: 30_000 })
      await page.waitForFunction(
        () => (document.querySelector('[aria-live="polite"] .markdown')?.textContent ?? '').length > 60,
        null,
        { timeout: 120_000 }
      )
      // The chat has no room yet, so the sorting room's helper is the one working, on the map beside the chat.
      const helperState = await page.locator('[data-agent="mailroom"]').first().getAttribute('data-state')
      expect(helperState === 'writing', `the Mail room helper was ${helperState} while the answer was being written`)
      const mid = await shot(page, 'C2-streaming', 'C2 · While answering: partial text, "Writing…", the Stop button, and the Mail room helper at work on the map')
      await answerFinished(page)
      await activityLine(page, /^Claude answered in /)
      const after = await page.locator('[data-agent="mailroom"]').first().getAttribute('data-state')
      expect(after === 'done' || after === 'idle', `the Mail room helper was ${after} after the answer`)
      const bubble = page.locator('.markdown').last()
      expect((await bubble.locator('pre code').count()) >= 1, 'the answer has no code block')
      expect((await bubble.locator('li').count()) >= 2, 'the answer has no bullet list')
      const groups = await groupNames(page)
      expect(groups.join('|').toLowerCase() === 'unsorted', `sidebar groups were: ${groups.join(', ')}`)
      const row = sql(userData, "select tokens_in > 0, tokens_out > 0 from messages where role = 'assistant'")
      expect(row === '1|1', `token counts stored were: ${row}`)
      return {
        observed: 'Streamed and finished. Code block and list rendered; chat listed under Unsorted; tokens stored.',
        screenshots: [mid, await shot(page, 'C2-answer', 'C2 · Finished answer with rendered code and list; the chat is still unsorted')]
      }
    }
  )

  await testCase(
    {
      id: 'R1', area: 'Rooms', title: 'The chat is placed in a room after the second message',
      steps: ['In the same chat send: "Now add type hints. Short answer."', 'Wait for the answer and for the classifier.'],
      expected: 'The chat moves from "Unsorted" to "Coding room" in the sidebar and its header shows the Coding room badge. `room_source` is `model`.',
      failShot
    },
    async () => {
      await send(page, 'Now add type hints. Short answer.')
      await answerFinished(page)
      await until(() => sql(userData, 'select classified_at is not null from chats') === '1', { timeout: 90_000, what: 'the classifier' })
      const state = sql(userData, 'select room_id, room_source from chats')
      expect(state === 'coding|model', `room and source were: ${state}`)
      await page.locator('nav[aria-label="Chats"] h2', { hasText: /coding room/i }).waitFor({ timeout: 15_000 })
      await until(async () => (await page.getByTestId('chat-panel').locator('header select').inputValue()) === 'coding', { timeout: 5_000, what: 'the chat header to show the Coding room' })
      await activityLine(page, /was filed in the Coding room$/)
      await page.locator('figcaption', { hasText: /room$/ }).waitFor({ timeout: 5_000 }) // the palace beside the chat followed it into its room
      return {
        observed: 'Placed in the Coding room by the model after the second user message; the activity strip says so and the palace shows that room.',
        screenshots: [await shot(page, 'R1-classified', 'R1 · After the second message: Coding room badge and sidebar group')]
      }
    }
  )

  await testCase(
    {
      id: 'R2', area: 'Rooms', title: 'Move to room places the chat by hand',
      steps: ['Choose "Music studio" in the Move to room menu of the chat header.'],
      expected: 'The chat moves to the Music studio group and badge. `room_source` becomes `user`.',
      failShot
    },
    async () => {
      await page.getByLabel('Move to room').selectOption({ label: 'Music studio' })
      await page.locator('nav[aria-label="Chats"] h2', { hasText: /music studio/i }).waitFor({ timeout: 10_000 })
      const state = sql(userData, 'select room_id, room_source from chats')
      expect(state === 'music|user', `room and source were: ${state}`)
      return { screenshots: [await shot(page, 'R2-moved', 'R2 · After Move to room: the chat sits in the Music studio')] }
    }
  )

  await testCase(
    {
      id: 'C3', area: 'Chat', title: 'A question that needs the web shows its sources',
      steps: [
        'Start a new chat.',
        'Send: "What is the latest stable version of Python? Search the web and cite your source. Two sentences."'
      ],
      expected: 'A "Searching the web" status appears while it searches. The finished answer lists at least one source as a chip, and the trailing "Sources:" list is not repeated in the text.',
      failShot
    },
    async () => {
      await page.getByRole('button', { name: 'New chat' }).click()
      await send(page, 'What is the latest stable version of Python? Search the web and cite your source. Two sentences.')
      const shots = []
      const searching = page.getByText(/Searching the web:/)
      const sawSearch = await searching.waitFor({ timeout: 45_000 }).then(() => true, () => false)
      if (sawSearch) shots.push(await shot(page, 'C3-searching', 'C3 · While answering: the web search in progress'))
      await answerFinished(page)
      const bubble = page.locator('div.rounded-bl-sm').last()
      const chips = await bubble.locator('ul a[target="_blank"]').count()
      expect(chips >= 1, 'no source chips under the answer')
      const text = await bubble.locator('.markdown').innerText()
      expect(!/^\s*sources:?\s*$/im.test(text), 'the "Sources:" list is repeated inside the answer text')
      shots.push(await shot(page, 'C3-sources', 'C3 · Finished answer with its sources shown once, as chips'))
      return {
        observed: `${chips} source chip(s) shown.${sawSearch ? ' The search status was seen.' : ' The search status was too brief to capture.'}`,
        screenshots: shots
      }
    }
  )

  await testCase(
    {
      id: 'C4', area: 'Chat', title: 'Stop keeps what was written so far',
      steps: [
        'Start a new chat.',
        'Send: "Without searching the web, write a detailed 600-word essay on the history of the electric guitar."',
        'Press Stop once a few sentences have appeared.'
      ],
      expected: 'The answer stops, the partial text stays in the chat, Send comes back, and the partial answer is stored without token counts.',
      failShot
    },
    async () => {
      await page.getByRole('button', { name: 'New chat' }).click()
      await send(page, 'Without searching the web, write a detailed 600-word essay on the history of the electric guitar.')
      await page.waitForFunction(
        () => (document.querySelector('[aria-live="polite"] .markdown')?.textContent ?? '').length > 300,
        null,
        { timeout: 120_000 }
      )
      await stopButton(page).click()
      await sendButton(page).waitFor({ state: 'visible', timeout: 20_000 })
      const row = await until(
        () => sql(userData, "select length(m.content), m.tokens_out is null from messages m join chats c on c.id = m.chat_id where m.role = 'assistant' and c.title like 'Without searching%'"),
        { timeout: 20_000, what: 'the partial answer to be stored' }
      )
      const [length, noTokens] = row.split('|')
      expect(Number(length) > 200 && Number(length) < 4000, `stored answer length was ${length}`)
      expect(noTokens === '1', 'the stopped answer has token counts')
      return {
        observed: `Stopped with ${length} characters kept; no token counts stored for the partial answer.`,
        screenshots: [await shot(page, 'C4-stopped', 'C4 · After Stop: the partial essay is kept and Send is back')]
      }
    }
  )

  await testCase(
    {
      id: 'A3', area: 'Launch', title: 'Closing the window keeps the app running',
      steps: ['Close the main window.', 'Check the app process and the window.', 'Show the window again.'],
      expected: 'The window is hidden, not destroyed, and the app keeps running in the tray.',
      failShot: null
    },
    async () => {
      const after = await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        win.close()
        return { windows: BrowserWindow.getAllWindows().length, visible: win.isVisible(), destroyed: win.isDestroyed() }
      })
      expect(after.windows === 1 && !after.destroyed, 'the window was destroyed')
      expect(after.visible === false, 'the window is still visible')
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show())
      await page.getByRole('button', { name: 'New chat' }).waitFor({ timeout: 5_000 })
      return { observed: 'Window hidden and alive; app still running; shown again on request.' }
    }
  )

  await testCase(
    {
      id: 'C5', area: 'Chat', title: 'After a restart the chat is still there and Claude remembers it',
      steps: [
        'Quit the app and start it again on the same data.',
        `Open the chat "${CODE_TITLE}…".`,
        'Send: "In one sentence: what function did I ask you for at the start of this chat?"'
      ],
      expected: 'The earlier messages are shown, and the new answer refers to reversing a string, which it can only know from the resumed session.',
      failShot
    },
    async () => {
      await app.close()
      ;({ app, page } = await launch(userData))
      await chatRow(page, CODE_TITLE).locator('button').first().click()
      await page.getByText('Now add type hints. Short answer.').waitFor({ timeout: 10_000 })
      const before = await page.locator('.markdown').count()
      expect(before >= 2, `only ${before} earlier answers were shown`)
      await send(page, 'In one sentence: what function did I ask you for at the start of this chat?')
      await answerFinished(page)
      const answer = await page.locator('.markdown').last().innerText()
      expect(/revers/i.test(answer), `the answer did not mention reversing: ${answer.slice(0, 160)}`)
      return {
        observed: `Claude answered: "${answer.trim().slice(0, 200)}"`,
        screenshots: [await shot(page, 'C5-resumed', 'C5 · After a restart: history restored and the answer uses the earlier context')]
      }
    }
  )

  await testCase(
    {
      id: 'C6', area: 'Chat', title: 'Deleting a chat removes it and its messages',
      steps: ['Hover the essay chat in the sidebar and press ×.', 'Confirm the dialog.'],
      expected: 'The chat disappears from the sidebar; its row and its messages are gone from the database.',
      failShot
    },
    async () => {
      page.once('dialog', (dialog) => void dialog.accept())
      const row = chatRow(page, 'Without searching the web')
      await row.hover()
      await row.getByRole('button', { name: /^Delete/ }).click()
      await row.waitFor({ state: 'detached', timeout: 10_000 })
      const left = sql(userData, "select (select count(*) from chats where title like 'Without searching%'), (select count(*) from messages m where not exists (select 1 from chats c where c.id = m.chat_id))")
      expect(left === '0|0', `chats and orphan messages left: ${left}`)
      return { observed: 'Chat and its messages removed.' }
    }
  )

  await app.close()
  rmSync(userData, { recursive: true, force: true })
}

// ---------------------------------------------------------------- S2: classifier on quiet chats, projects

async function sessionProjects() {
  const userData = mkdtempSync(join(tmpdir(), 'mind-palace-e2e-projects-'))
  // A first launch creates the schema; the data is then seeded with the app closed.
  let { app, page } = await launch(userData)
  await app.close()

  const quiet = iso(40)
  const recent = iso(1)
  const chat = (id, title, o = {}) =>
    `insert into chats (id, title, room_id, room_source, classified_at, created_at, last_message_at) values (${q(id)}, ${q(title)}, ${o.room ? q(o.room) : 'null'}, ${o.source ? q(o.source) : 'null'}, ${o.classified ? q(o.classified) : 'null'}, ${q(o.at ?? quiet)}, ${q(o.at ?? quiet)});`
  const msg = (chatId, n, text, at = quiet) =>
    `insert into messages (id, chat_id, role, content, created_at) values (${q(`${chatId}-m${n}`)}, ${q(chatId)}, 'user', ${q(text)}, ${q(at)});`
  const project = (id, title, room, chatId, state = 'active') =>
    `insert into projects (id, title, room_id, origin_chat_id, state, next_step, last_activity_at, created_at) values (${q(id)}, ${q(title)}, ${q(room)}, ${q(chatId)}, ${q(state)}, 'Pick the first small step', ${q(quiet)}, ${q(quiet)});` +
    (state === 'suggested' ? '' : `insert into project_chats (project_id, chat_id) values (${q(id)}, ${q(chatId)});`)
  const settled = (id, title, room) => chat(id, title, { room, source: 'model', classified: recent }) + msg(id, 1, title)

  sql(
    userData,
    [
      // Due for the quiet check.
      chat('q-vocal', 'How do I stop my vocal recordings from clipping'), msg('q-vocal', 1, 'How do I stop my vocal recordings from clipping when I sing loud?'),
      chat('q-cook', 'What should I cook tonight with chicken thighs'), msg('q-cook', 1, 'What should I cook tonight with chicken thighs and rice?'), msg('q-cook', 2, 'Something quick, under 30 minutes'),
      chat('q-moved', 'Why does my React effect run twice', { room: 'art', source: 'user' }), msg('q-moved', 1, 'Why does my React effect run twice in development?'), msg('q-moved', 2, 'I am on React 19 with StrictMode on'),
      chat('q-ep', 'Five-song reggae EP'), msg('q-ep', 1, 'I am writing a five-song reggae EP and need help structuring the second track'), msg('q-ep', 2, 'The chorus is in A minor, I want the verse to feel like it lifts'),
      chat('q-barcode', 'Barcode scanning for the inventory app'), msg('q-barcode', 1, 'For the hardware store inventory app: I want to add barcode scanning to the stock movements screen'), msg('q-barcode', 2, 'Let us plan how the scanner input maps to products'),
      // Already settled: not due.
      settled('c-inventory', 'Inventory app for the hardware store', 'coding'), project('p-inventory', 'Hardware store inventory app', 'coding', 'c-inventory'),
      settled('c-todo', 'A command-line todo tool', 'coding'), project('p-todo', 'CLI todo tool', 'coding', 'c-todo'),
      settled('c-blog', 'A small blog engine', 'coding'), project('p-blog', 'Blog engine', 'coding', 'c-blog'),
      settled('c-guitar', 'Fingerstyle practice routine', 'music'), project('p-guitar', 'Guitar practice plan', 'music', 'c-guitar'),
      settled('c-logo', 'Logo for the bakery', 'art'), project('p-logo', 'Bakery logo', 'art', 'c-logo'),
      // A suggestion waiting for an answer.
      settled('c-maybe', 'Thinking about a recipe site', 'coding'), project('p-maybe', 'Recipe site', 'coding', 'c-maybe', 'suggested'),
      "update chats set suggested_project_id = 'p-maybe' where id = 'c-maybe';"
    ].join('\n')
  )

  ;({ app, page } = await launch(userData))
  const failShot = () => shot(page, 'failure', 'State when the case failed')

  const quietDone = await testCase(
    {
      id: 'R3', area: 'Rooms', title: 'Chats that went quiet are classified at launch',
      steps: [
        'Seed five chats whose last message is 40 minutes old and which were never classified (or not since).',
        'Start the app and wait for the quiet check (10 seconds after launch).'
      ],
      expected:
        'Every quiet chat gets a `classified_at`. The single-message vocal question goes to the Music studio; the cooking question, which fits no room, goes to the Mail room.',
      failShot
    },
    async () => {
      await until(
        () => sql(userData, "select count(*) from chats where id like 'q-%' and classified_at is null") === '0',
        { timeout: 240_000, every: 2000, what: 'the quiet check to classify five chats' }
      )
      const rooms = sql(userData, "select id || '=' || room_id from chats where id in ('q-vocal', 'q-cook') order by id").replace(/\n/g, ', ')
      expect(rooms === 'q-cook=mailroom, q-vocal=music', `rooms were: ${rooms}`)
      await page.locator('nav[aria-label="Chats"] h2', { hasText: /mail room/i }).waitFor({ timeout: 15_000 })
      return {
        observed: `All five classified. ${rooms}.`,
        screenshots: [await shot(page, 'R3-quiet', 'R3 · After the quiet check: seeded chats sorted into their rooms in the sidebar')]
      }
    }
  )

  if (!quietDone) {
    for (const [id, title] of [['R4', 'A chat the user moved is not moved back'], ['P2', 'A project chat offers to be tracked'], ['P4', 'An open project is recognised instead of duplicated']]) {
      notRun({ id, area: id[0] === 'R' ? 'Rooms' : 'Projects', title, steps: [], expected: '' }, 'Depends on R3, which failed.')
    }
  } else {
    await testCase(
      {
        id: 'R4', area: 'Rooms', title: 'A chat the user moved is not moved back',
        steps: ['Among the seeded chats, one about React was placed in the Art workshop by hand.', 'Let the quiet check classify it.'],
        expected: 'It is stamped as classified but stays in the Art workshop with `room_source = user`.',
        failShot
      },
      async () => {
        const state = sql(userData, "select room_id, room_source, classified_at is not null from chats where id = 'q-moved'")
        expect(state === 'art|user|1', `room, source and stamp were: ${state}`)
        return { observed: 'Stayed in the Art workshop; classified_at set.' }
      }
    )

    await testCase(
      {
        id: 'P2', area: 'Projects', title: 'A project chat offers to be tracked',
        steps: ['Open the seeded chat about writing a reggae EP, classified by the quiet check.'],
        expected: 'The chat is in the Music studio and shows a "Track it?" card with a project title, a next step, and the buttons Track and Just a question.',
        failShot
      },
      async () => {
        const state = sql(userData, "select c.room_id, p.state, p.title from chats c join projects p on p.id = c.suggested_project_id where c.id = 'q-ep'")
        expect(state.startsWith('music|suggested|'), `room, project state and title were: ${state || '(no suggestion)'}`)
        await chatRow(page, 'Five-song reggae EP').locator('button').first().click()
        await page.getByText(/This looks like a project:/).waitFor({ timeout: 10_000 })
        await page.getByRole('button', { name: 'Track', exact: true }).waitFor()
        await page.getByRole('button', { name: 'Just a question' }).waitFor()
        return {
          observed: `Suggested project: "${state.split('|')[2]}".`,
          screenshots: [await shot(page, 'P2-track-card', 'P2 · The "Track it?" card on a chat the classifier flagged as a project')]
        }
      }
    )

    await testCase(
      {
        id: 'P3', area: 'Projects', title: 'Track turns the suggestion into an active project',
        steps: ['Press Track on that card.'],
        expected: 'The card goes away, the chat header shows the project, and the project is active and linked to the chat.',
        failShot
      },
      async () => {
        await page.getByRole('button', { name: 'Track', exact: true }).click()
        await page.getByText(/This looks like a project:/).waitFor({ state: 'detached', timeout: 10_000 })
        const state = sql(userData, "select p.state, (select count(*) from project_chats pc where pc.project_id = p.id and pc.chat_id = 'q-ep'), (select suggested_project_id is null from chats where id = 'q-ep') from projects p where p.origin_chat_id = 'q-ep'")
        expect(state === 'active|1|1', `state, link and cleared suggestion were: ${state}`)
        return { observed: 'Project active, linked to the chat, suggestion cleared.' }
      }
    )

    await testCase(
      {
        id: 'P4', area: 'Projects', title: 'An open project is recognised instead of duplicated',
        steps: [
          'An active project "Hardware store inventory app" exists in the Coding room.',
          'Open the seeded chat about adding barcode scanning to that app, classified by the quiet check.',
          'Press Add to project.'
        ],
        expected: 'The card says the chat looks like that project again and offers Add to project; no second project is created. After pressing it the project has two chats.',
        failShot
      },
      async () => {
        const offered = sql(userData, "select suggested_project_id from chats where id = 'q-barcode'")
        expect(offered === 'p-inventory', `the chat was offered: ${offered || '(nothing)'}`)
        await chatRow(page, 'Barcode scanning').locator('button').first().click()
        await page.getByText(/looks like "Hardware store inventory app" again/).waitFor({ timeout: 10_000 })
        const card = await shot(page, 'P4-existing', 'P4 · The classifier recognised an open project and offers to add the chat to it')
        await page.getByRole('button', { name: 'Add to project' }).click()
        await page.getByText(/looks like "Hardware store inventory app" again/).waitFor({ state: 'detached', timeout: 10_000 })
        const state = sql(userData, "select (select count(*) from project_chats where project_id = 'p-inventory'), (select count(*) from projects where title like '%nventory%')")
        expect(state === '2|1', `chats in the project and inventory projects were: ${state}`)
        return { observed: 'Recognised; chat added; still one inventory project.', screenshots: [card] }
      }
    )
  }

  await testCase(
    {
      id: 'P5', area: 'Projects', title: '"Just a question" drops the suggestion for good',
      steps: ['Open the seeded chat that has a pending "Recipe site" suggestion.', 'Press Just a question.'],
      expected: 'The card goes away, the suggested project is deleted, and the chat is marked so it is not offered again.',
      failShot
    },
    async () => {
      await chatRow(page, 'Thinking about a recipe site').locator('button').first().click()
      await page.getByText(/This looks like a project: "Recipe site"/).waitFor({ timeout: 10_000 })
      await page.getByRole('button', { name: 'Just a question' }).click()
      await page.getByText(/This looks like a project:/).waitFor({ state: 'detached', timeout: 10_000 })
      const state = sql(userData, "select (select count(*) from projects where id = 'p-maybe'), suggested_project_id is null, project_dismissed_at is not null from chats where id = 'c-maybe'")
      expect(state === '0|1|1', `project rows, cleared suggestion and dismissal mark were: ${state}`)
      return { observed: 'Suggested project deleted; chat marked as dismissed.' }
    }
  )

  const action = async (title, name) => {
    await projectCard(page, title).getByRole('button', { name, exact: true }).click()
  }

  await testCase(
    {
      id: 'P6', area: 'Projects', title: 'Done counts one goal per room per day',
      steps: ['Open Projects.', 'Press Done on "CLI todo tool" (Coding room).', 'Press Done on "Blog engine" (Coding room) the same day.'],
      expected: 'Both move to Done and both completions are stored on the same local day; the engine counts that day once.',
      failShot
    },
    async () => {
      await page.getByRole('button', { name: 'Projects', exact: true }).click()
      await projectCard(page, 'CLI todo tool').waitFor({ timeout: 10_000 })
      await action('CLI todo tool', 'Done')
      await until(() => sql(userData, "select state from projects where id = 'p-todo'") === 'done', { timeout: 10_000, what: 'the first Done' })
      await action('Blog engine', 'Done')
      await until(() => sql(userData, "select state from projects where id = 'p-blog'") === 'done', { timeout: 10_000, what: 'the second Done' })
      const rows = sql(userData, "select project_id || ':' || local_day from goal_completions order by project_id desc").replace(/\n/g, ', ')
      const days = new Set(rows.split(', ').map((row) => row.split(':')[1]))
      expect(rows.startsWith('p-todo:') && rows.includes('p-blog:') && days.size === 1, `completions were: ${rows}`)
      return { observed: `Completions: ${rows} (the engine counts that day once).` }
    }
  )

  await testCase(
    {
      id: 'P7', area: 'Projects', title: 'Reopen makes the project active and removes its completion',
      steps: ['Press Reopen on "Blog engine".'],
      expected: 'It returns to Active with no closing date, and its completion row is deleted.',
      failShot
    },
    async () => {
      await action('Blog engine', 'Reopen')
      await until(() => sql(userData, "select state from projects where id = 'p-blog'") === 'active', { timeout: 10_000, what: 'Reopen' })
      const state = sql(userData, "select closed_at is null, (select count(*) from goal_completions where project_id = 'p-blog') from projects where id = 'p-blog'")
      expect(state === '1|0', `cleared closing date and completions left were: ${state}`)
    }
  )

  await testCase(
    {
      id: 'P8', area: 'Projects', title: 'Snooze, Pause and Drop',
      steps: [
        'Press Snooze 2 weeks on "Guitar practice plan".',
        'Press Pause on "Hardware store inventory app".',
        'Press Drop on "Bakery logo".'
      ],
      expected:
        'The snoozed project stays Active and shows "Snoozed until" a date 14 days ahead. The paused one moves to Paused and offers Reopen, Done and Drop. The dropped one moves to Dropped and offers only Reopen. None of them writes a completion.',
      failShot
    },
    async () => {
      await action('Guitar practice plan', 'Snooze 2 weeks')
      await action('Hardware store inventory app', 'Pause')
      await action('Bakery logo', 'Drop')
      await until(() => sql(userData, "select state from projects where id = 'p-logo'") === 'dropped', { timeout: 10_000, what: 'Drop' })
      const days = sql(userData, "select round(julianday(snoozed_until) - julianday('now')) from projects where id = 'p-guitar'")
      expect(days === '14.0', `snooze was ${days} days ahead`)
      const states = sql(userData, "select id || '=' || state from projects where id in ('p-guitar', 'p-inventory', 'p-logo') order by id").replace(/\n/g, ', ')
      expect(states === 'p-guitar=active, p-inventory=paused, p-logo=dropped', `states were: ${states}`)
      expect(sql(userData, 'select count(*) from goal_completions') === '1', 'a completion was written by Snooze, Pause or Drop')
      await projectCard(page, 'Guitar practice plan').getByText(/Snoozed until/).waitFor({ timeout: 5_000 })
      const paused = await projectCard(page, 'Hardware store inventory app').getByRole('button').allInnerTexts()
      expect(paused.join(',') === 'Reopen,Done,Drop,Open chat', `paused project offered: ${paused.join(', ')}`)
      const dropped = await projectCard(page, 'Bakery logo').getByRole('button').allInnerTexts()
      expect(dropped.join(',') === 'Reopen,Open chat', `dropped project offered: ${dropped.join(', ')}`)
      return {
        observed: `${states}. Snoozed 14 days ahead.`,
        screenshots: [await shot(page, 'P8-panel', 'P6–P8 · Projects panel with every state: active (one snoozed), paused, done and dropped')]
      }
    }
  )

  await testCase(
    {
      id: 'P9', area: 'Projects', title: 'Open chat goes from a project to its chat',
      steps: ['Press Open chat on "CLI todo tool".'],
      expected: 'The chat view opens on that project\'s chat, with the project named in the header.',
      failShot
    },
    async () => {
      await projectCard(page, 'CLI todo tool').getByRole('button', { name: 'Open chat' }).click()
      await page.locator('header h1', { hasText: 'A command-line todo tool' }).waitFor({ timeout: 10_000 })
      await page.getByTestId('chat-panel').locator('header', { hasText: 'CLI todo tool' }).waitFor({ timeout: 5_000 })
    }
  )

  await app.close()
  rmSync(userData, { recursive: true, force: true })
}

// ---------------------------------------------------------------- S3: a login Claude refuses

async function sessionAuth() {
  const userData = mkdtempSync(join(tmpdir(), 'mind-palace-e2e-auth-'))
  // A Claude Code config folder holding a login that cannot be valid. The app
  // passes CLAUDE_CONFIG_DIR to the SDK (and nothing like ANTHROPIC_API_KEY), so
  // this is the login Claude sees.
  const configDir = mkdtempSync(join(tmpdir(), 'mind-palace-e2e-claude-'))
  writeFileSync(
    join(configDir, '.credentials.json'),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: 'sk-ant-oat01-mind-palace-e2e-invalid',
        refreshToken: 'sk-ant-ort01-mind-palace-e2e-invalid',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        scopes: ['user:inference'],
        subscriptionType: 'pro'
      }
    })
  )
  const { app, page } = await launch(userData, { CLAUDE_CONFIG_DIR: configDir })
  const failShot = () => shot(page, 'failure', 'State when the case failed')

  const refused = await testCase(
    {
      id: 'L1', area: 'Login', title: 'A login that Claude refuses is explained',
      steps: ['Start the app with CLAUDE_CONFIG_DIR pointing at a folder whose stored login is invalid.', 'Send "hi".'],
      expected: 'Instead of an answer, a screen says Claude did not accept the login, gives Claude\'s reason and the sign-in command.',
      failShot
    },
    async () => {
      await send(page, 'hi')
      await page.getByRole('heading', { name: 'Claude did not accept the login' }).waitFor({ timeout: 120_000 })
      await page.getByText('claude auth login --claudeai').waitFor({ timeout: 5_000 })
      const reason = await page.locator('main p').first().innerText()
      return {
        observed: `Shown reason: "${reason.slice(0, 220)}"`,
        screenshots: [await shot(page, 'L1-refused', 'L1 · Claude refused the login: the reason and how to sign in')]
      }
    }
  )

  if (refused) {
    await testCase(
      {
        id: 'L2', area: 'Login', title: 'Back to the chat after a refused login',
        steps: ['Press Back to the chat.'],
        expected: 'The chat is shown again with the question kept and the reason as an error under it; nothing was stored as an answer.',
        failShot
      },
      async () => {
        await page.getByRole('button', { name: 'Back to the chat' }).click()
        await page.getByRole('alert').waitFor({ timeout: 10_000 })
        await messageBox(page).waitFor()
        const stored = sql(userData, "select group_concat(role) from messages")
        expect(stored === 'user', `stored messages were: ${stored}`)
        return { screenshots: [await shot(page, 'L2-back', 'L2 · Back in the chat: the question is kept and the reason is shown')] }
      }
    )
  } else {
    notRun({ id: 'L2', area: 'Login', title: 'Back to the chat after a refused login', steps: [], expected: '' }, 'Depends on L1, which failed.')
  }

  notRun(
    {
      id: 'L3', area: 'Login', title: 'No Claude login at all',
      steps: ['Start the app on a machine where Claude Code has never signed in.'],
      expected: 'A "Sign in to Claude first" screen with the sign-in command and an "I have signed in" button.'
    },
    'This machine has a Claude Code login in the macOS Keychain, and the app has no switch to pretend otherwise. The screen is the same component as L1 with different text.'
  )

  await app.close()
  rmSync(userData, { recursive: true, force: true })
  rmSync(configDir, { recursive: true, force: true })
}

// ---------------------------------------------------------------- S4: reminders

async function sessionReminders() {
  const userData = mkdtempSync(join(tmpdir(), 'mind-palace-e2e-reminders-'))
  let { app, page } = await launch(userData)
  await app.close()

  const days = (n) => iso(n * 24 * 60)
  const seed = (id, title, room, quietDays, state = 'active') => {
    const at = days(quietDays)
    return [
      `insert into chats (id, title, room_id, room_source, classified_at, created_at, last_message_at) values (${q(`c-${id}`)}, ${q(title)}, ${q(room)}, 'model', ${q(iso(1))}, ${q(at)}, ${q(at)});`,
      `insert into messages (id, chat_id, role, content, created_at) values (${q(`c-${id}-m1`)}, ${q(`c-${id}`)}, 'user', ${q(`I am working on: ${title}. Where should I start?`)}, ${q(at)});`,
      `insert into messages (id, chat_id, role, content, created_at) values (${q(`c-${id}-m2`)}, ${q(`c-${id}`)}, 'assistant', ${q(`Start small: write down the first three things ${title} needs, then do the first one.`)}, ${q(at)});`,
      `insert into projects (id, title, room_id, origin_chat_id, state, next_step, last_activity_at, created_at) values (${q(`p-${id}`)}, ${q(title)}, ${q(room)}, ${q(`c-${id}`)}, ${q(state)}, 'Write down the first three things it needs', ${q(at)}, ${q(at)});`,
      `insert into project_chats (project_id, chat_id) values (${q(`p-${id}`)}, ${q(`c-${id}`)});`
    ].join('\n')
  }
  sql(
    userData,
    [
      seed('pantry', 'Pantry inventory app', 'coding', 4),
      seed('ep', 'Reggae EP', 'music', 20),
      seed('logo', 'Bakery logo', 'art', 9),
      seed('fresh', 'Brand new idea', 'coding', 1),
      seed('paused', 'Shelved podcast', 'music', 30, 'paused')
    ].join('\n')
  )

  ;({ app, page } = await launch(userData))
  const failShot = () => shot(page, 'failure', 'State when the case failed')
  const card = (title) => page.locator('li.bg-ink-soft', { hasText: title }).first()

  const created = await testCase(
    {
      id: 'N1', area: 'Reminders', title: 'Quiet projects get one reminder each at launch',
      steps: [
        'Seed three active projects last touched 4, 9 and 20 days ago, one touched yesterday, and one paused for 30 days.',
        'Start the app and wait for the scheduler (5 seconds after launch).',
        'Open Reminders.'
      ],
      expected:
        'Three reminders, one per quiet active project, each with a text written by the model. None for the fresh project or the paused one. The project quiet for 20 days gets a single reminder with its three missed points counted (`reminders_sent = 3`).',
      failShot
    },
    async () => {
      await until(() => sql(userData, 'select count(*) from reminders') === '3', { timeout: 180_000, every: 2000, what: 'three reminders' })
      await new Promise((r) => setTimeout(r, 2000))
      const rows = sql(userData, "select project_id || ':' || (length(message) > 10) from reminders order by project_id").replace(/\n/g, ', ')
      expect(rows === 'p-ep:1, p-logo:1, p-pantry:1', `reminders were: ${rows}`)
      const sent = sql(userData, "select id || '=' || reminders_sent from projects order by id").replace(/\n/g, ', ')
      expect(sent === 'p-ep=3, p-fresh=0, p-logo=2, p-pantry=1, p-paused=0', `reminders_sent were: ${sent}`)
      await page.getByRole('button', { name: /^Reminders/ }).click()
      await card('Reggae EP').waitFor({ timeout: 10_000 })
      expect((await page.locator('li.bg-ink-soft').count()) === 3, 'the inbox does not list three reminders')
      const text = sql(userData, "select message from reminders where project_id = 'p-pantry'")
      return {
        observed: `Three reminders created. Cadence counters: ${sent}. Example text: "${text}"`,
        screenshots: [await shot(page, 'N1-inbox', 'N1 · Reminder inbox after launch: one reminder per quiet project, with the count in the sidebar')]
      }
    }
  )

  if (!created) {
    for (const [id, title] of [['N2', 'At most two notifications a day'], ['N3', 'Reacting to a reminder acts on the project and is logged']]) {
      notRun({ id, area: 'Reminders', title, steps: [], expected: '' }, 'Depends on N1, which failed.')
    }
  } else {
    await testCase(
      {
        id: 'N2', area: 'Reminders', title: 'At most two notifications a day',
        steps: ['Look at which of the three reminders were shown as system notifications.'],
        expected: 'Two were notified, the two longest overdue (20 and 9 days); the third is in the inbox only and says so.',
        failShot
      },
      async () => {
        const notified = sql(userData, "select project_id from reminders where sent_at is not null order by project_id").replace(/\n/g, ', ')
        expect(notified === 'p-ep, p-logo', `notified were: ${notified || '(none)'}`)
        await card('Pantry inventory app').getByText('no notification shown').waitFor({ timeout: 5_000 })
        await card('Reggae EP').getByText(/· notified/).waitFor({ timeout: 5_000 })
        return { observed: `Notified: ${notified}. The Pantry reminder waits in the inbox only.` }
      }
    )

    await testCase(
      {
        id: 'N3', area: 'Reminders', title: 'Reacting to a reminder acts on the project and is logged',
        steps: ['Press Done on "Bakery logo".', 'Press Snooze 2 weeks on "Reggae EP".', 'Press Open on "Pantry inventory app".'],
        expected:
          'Each reminder leaves the inbox. The logo project is done with a goal completion, the EP is snoozed 14 days, and Open goes to the Pantry chat. The outcomes `done`, `snoozed` and `opened` are stored on the reminder rows.',
        failShot
      },
      async () => {
        await card('Bakery logo').getByRole('button', { name: 'Done', exact: true }).click()
        await card('Bakery logo').waitFor({ state: 'detached', timeout: 10_000 })
        await card('Reggae EP').getByRole('button', { name: 'Snooze 2 weeks' }).click()
        await card('Reggae EP').waitFor({ state: 'detached', timeout: 10_000 })
        await card('Pantry inventory app').getByRole('button', { name: 'Open', exact: true }).click()
        await page.locator('header h1', { hasText: 'Pantry inventory app' }).waitFor({ timeout: 10_000 })
        const outcomes = sql(userData, "select project_id || '=' || action from reminders order by project_id").replace(/\n/g, ', ')
        expect(outcomes === 'p-ep=snoozed, p-logo=done, p-pantry=opened', `outcomes were: ${outcomes}`)
        const effects = sql(userData, "select (select state from projects where id = 'p-logo'), (select count(*) from goal_completions where project_id = 'p-logo'), (select round(julianday(snoozed_until) - julianday('now')) from projects where id = 'p-ep')")
        expect(effects === 'done|1|14.0', `logo state, completions and snooze days were: ${effects}`)
        return { observed: `Outcomes logged: ${outcomes}.` }
      }
    )
  }

  await testCase(
    {
      id: 'N4', area: 'Reminders', title: 'Empty inbox and the notifications switch',
      steps: ['Open Reminders with nothing waiting.', 'Untick "Show system notifications".'],
      expected: 'An empty-state message, no count in the sidebar, and the setting stored as off.',
      failShot
    },
    async () => {
      await page.getByRole('button', { name: /^Reminders/ }).click()
      await page.getByText('Nothing waiting.').waitFor({ timeout: 10_000 })
      expect((await page.getByRole('button', { name: /^Reminders/ }).innerText()).trim() === 'Reminders', 'the sidebar still shows a count')
      await page.getByLabel(/Show system notifications/).uncheck()
      await until(() => sql(userData, "select value from settings where key = 'notifications'") === 'off', { timeout: 5_000, what: 'the setting' })
      return { screenshots: [await shot(page, 'N4-empty', 'N4 · Inbox with nothing waiting, notifications switched off')] }
    }
  )

  await testCase(
    {
      id: 'N5', area: 'Reminders', title: 'A new message in the project restarts its reminders',
      steps: ['Open the Reggae EP chat and send a message.'],
      expected: '`last_activity_at` moves to now and `reminders_sent` returns to 0, so the next reminder is three days away again.',
      failShot
    },
    async () => {
      await chatRow(page, 'Reggae EP').locator('button').first().click()
      await send(page, 'Back on this. One short sentence: what was the first step?')
      await answerFinished(page)
      const state = sql(userData, "select reminders_sent, (julianday('now') - julianday(last_activity_at)) * 1440 < 5 from projects where id = 'p-ep'")
      expect(state === '0|1', `reminders_sent and recent activity were: ${state}`)
      return { observed: 'Counter back to 0 and activity stamped now.' }
    }
  )

  await app.close()
  rmSync(userData, { recursive: true, force: true })
}

// ---------------------------------------------------------------- S5: the palace view

async function sessionPalace() {
  const userData = mkdtempSync(join(tmpdir(), 'mind-palace-e2e-palace-'))
  let { app, page } = await launch(userData)
  await app.close()

  const daysAgo = (n) => iso(n * 24 * 60)
  const localDay = (n) => sql(userData, `select date('now', 'localtime', '-${n} day')`)
  const streakChat = (id, title, room, days) =>
    `insert into chats (id, title, room_id, room_source, classified_at, created_at, last_message_at) values (${q(id)}, ${q(title)}, ${q(room)}, 'model', ${q(iso(0))}, ${q(daysAgo(days - 1))}, ${q(iso(1))});` +
    Array.from({ length: days }, (_, i) =>
      `insert into messages (id, chat_id, role, content, created_at) values (${q(`${id}-m${i}`)}, ${q(id)}, 'user', ${q(`Day ${i} of ${title}`)}, ${q(i === 0 ? iso(1) : daysAgo(i))});`
    ).join('')
  const doneProject = (id, title, room, chatId, dayOffset) =>
    `insert into projects (id, title, room_id, origin_chat_id, state, last_activity_at, created_at, closed_at) values (${q(id)}, ${q(title)}, ${q(room)}, ${q(chatId)}, 'done', ${q(daysAgo(dayOffset))}, ${q(daysAgo(10))}, ${q(daysAgo(dayOffset))});` +
    `insert into project_chats (project_id, chat_id) values (${q(id)}, ${q(chatId)});` +
    `insert into goal_completions (id, project_id, room_id, local_day) values (${q(`g-${id}`)}, ${q(id)}, ${q(room)}, ${q(localDay(dayOffset))});`

  sql(
    userData,
    [
      streakChat('c-code', 'Refactoring the sync module', 'coding', 5),
      streakChat('c-music', 'Daily fingerstyle practice', 'music', 21),
      doneProject('p-one', 'CSV importer', 'coding', 'c-code', 3),
      doneProject('p-two', 'Login page', 'coding', 'c-code', 2),
      `insert into projects (id, title, room_id, origin_chat_id, state, next_step, last_activity_at, created_at) values ('p-live', 'Sync module refactor', 'coding', 'c-code', 'active', 'Write the first test', ${q(iso(1))}, ${q(daysAgo(4))});`,
      `insert into project_chats (project_id, chat_id) values ('p-live', 'c-code');`
    ].join('\n')
  )

  ;({ app, page } = await launch(userData))
  const failShot = () => shot(page, 'failure', 'State when the case failed')
  const palaceButton = () => page.locator('aside').getByRole('button', { name: /^Palace/ })
  const roomTab = (name) => page.getByRole('navigation', { name: 'Rooms' }).getByRole('button', { name })
  const bar = (name) => page.getByRole('progressbar', { name })
  const chips = () => page.getByTestId('room-furniture').locator('li').allInnerTexts()
  /** Waits until the canvas is up, the camera has had time to arrive and any "new" pop animation has finished. */
  const settled = async () => {
    await page.locator('.palace-canvas[data-ready="true"]').waitFor({ timeout: 15_000 })
    await page.waitForTimeout(1500)
    await until(
      async () =>
        page.evaluate(
          () => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity).length === 0
        ),
      { timeout: 8_000, every: 300, what: 'the palace animations to finish' }
    )
  }
  /** The shell tier the canvas is drawing for the room in view, from the floor model. */
  const stageRoom = () => page.getByTestId('palace-stage').getAttribute('data-room')

  const settledHub = settled

  await testCase(
    {
      id: 'V1', area: 'Palace', title: 'A room shows what its streak and finished projects have earned',
      steps: [
        'Seed a Coding room chat with a message on each of the last five days, and two projects finished on different days.',
        'Open Palace and choose Coding room.'
      ],
      expected:
        'Streak 5 heading for 8, two finished projects heading for 3, a painted room, two of five trophies, and the furniture earned so far: desk, chair (not the crate), rug, monitor (not the laptop), trophy shelf and poster. Nothing is marked new on a first visit.',
      failShot
    },
    async () => {
      await palaceButton().click()
      await roomTab('Coding room').click()
      await page.locator('figcaption', { hasText: 'Painted room' }).waitFor({ timeout: 10_000 })
      const streak = `${await bar('Streak').getAttribute('aria-valuenow')}/${await bar('Streak').getAttribute('aria-valuemax')}`
      const goals = `${await bar('Finished projects').getAttribute('aria-valuenow')}/${await bar('Finished projects').getAttribute('aria-valuemax')}`
      expect(streak === '5/8', `streak bar was ${streak}`)
      expect(goals === '2/3', `goals bar was ${goals}`)
      const items = (await chips()).map((t) => t.trim()).sort().join(', ')
      expect(items === 'Chair, Desk, Monitor, Poster, Rug, Trophy shelf', `furniture was: ${items}`)
      await page.getByRole('img', { name: '2 of 5 trophies' }).waitFor({ timeout: 5_000 })
      expect((await page.getByText(/New in this room/).count()) === 0, 'something was announced as new on a first visit')
      const fill = await bar('Streak').locator('div').evaluate((el) => el.style.width)
      expect(fill === '63%', `the streak bar was filled ${fill}`)
      await settled()
      return {
        observed: `Streak ${streak}, goals ${goals}, painted room, 2 trophies. Furniture: ${items}.`,
        screenshots: [await shot(page, 'V1-coding', 'V1 · Coding room at a five-day streak: painted room, furniture earned, two trophies')]
      }
    }
  )

  await testCase(
    {
      id: 'V2', area: 'Palace', title: 'A room with no chats is bare',
      steps: ['Choose Art workshop, which has no chats.'],
      expected: 'The picture is dim and nearly colourless ("Bare room"), both tracks are at 0, there is no trophy shelf, and only the starting furniture is listed: desk, crate and sketchbook.',
      failShot
    },
    async () => {
      await roomTab('Art workshop').click()
      await page.locator('figcaption', { hasText: 'Bare room' }).waitFor({ timeout: 10_000 })
      const values = `${await bar('Streak').getAttribute('aria-valuenow')},${await bar('Finished projects').getAttribute('aria-valuenow')}`
      expect(values === '0,0', `streak and goals were ${values}`)
      const items = (await chips()).map((t) => t.trim()).sort().join(', ')
      expect(items === 'Crate, Desk, Sketchbook', `furniture was: ${items}`)
      expect((await page.getByRole('img', { name: /trophies/ }).count()) === 0, 'a trophy shelf is shown')
      expect((await stageRoom()) === 'art', `the stage was showing: ${await stageRoom()}`)
      await page.locator('figcaption', { hasText: 'Bare room' }).waitFor({ timeout: 5_000 })
      await settled()
      return { screenshots: [await shot(page, 'V2-bare', 'V2 · A room nobody has used yet: bare, with only its starting furniture')] }
    }
  )

  await testCase(
    {
      id: 'V3', area: 'Palace', title: 'A 21-day streak finishes the room',
      steps: ['Choose Music studio, seeded with a message on each of the last 21 days.'],
      expected: 'Streak 21 heading for 34, the picture in full colour ("Finished room"), and the streak furniture up to the fourth signature item.',
      failShot
    },
    async () => {
      await roomTab('Music studio').click()
      await page.locator('figcaption', { hasText: 'Finished room' }).waitFor({ timeout: 10_000 })
      const streak = `${await bar('Streak').getAttribute('aria-valuenow')}/${await bar('Streak').getAttribute('aria-valuemax')}`
      expect(streak === '21/34', `streak bar was ${streak}`)
      // The picture fades between tiers over 0.8s when switching rooms: wait for it to settle.
      await page.locator('figcaption', { hasText: 'Finished room' }).waitFor({ timeout: 5_000 })
      expect((await stageRoom()) === 'music', `the stage was showing: ${await stageRoom()}`)
      const items = (await chips()).map((t) => t.trim()).sort().join(', ')
      expect(items === 'Chair, Desk, Guitar, Keyboard, Low bookshelf, Mic, Rug, Small plant, Speakers, Speakers', `furniture was: ${items}`)
      return {
        observed: `Streak ${streak}, finished room. Furniture: ${items}.`,
        screenshots: [await shot(page, 'V3-finished', 'V3 · Music studio at a 21-day streak: the finished room in full colour')]
      }
    }
  )

  await testCase(
    {
      id: 'V4', area: 'Palace', title: 'Finishing a project announces what it unlocked',
      steps: [
        'Open Projects and press Done on "Sync module refactor" (Coding room, its third finished project).',
        'Look at the sidebar, then open Palace on the Coding room.',
        'Go to another room and come back.'
      ],
      expected:
        'The Palace button shows "New". The Coding room announces the floor lamp and a trophy, highlights them, and shows three trophies and 3 of 5 goals. After leaving and returning, nothing is marked new any more.',
      failShot
    },
    async () => {
      await page.getByRole('button', { name: 'Projects', exact: true }).click()
      await projectCard(page, 'Sync module refactor').getByRole('button', { name: 'Done', exact: true }).click()
      await palaceButton().getByText('New').waitFor({ timeout: 10_000 })
      await palaceButton().click()
      await roomTab('Coding room').click()
      const banner = page.getByRole('status')
      await banner.waitFor({ timeout: 10_000 })
      const text = (await banner.innerText()).trim()
      expect(text === 'New in this room: Floor lamp, a trophy.', `the announcement was: ${text}`)
      await page.getByRole('img', { name: '3 of 5 trophies' }).waitFor({ timeout: 5_000 })
      const goals = `${await bar('Finished projects').getAttribute('aria-valuenow')}/${await bar('Finished projects').getAttribute('aria-valuemax')}`
      expect(goals === '3/5', `goals bar was ${goals}`)
      await settled()
      const s = await shot(page, 'V4-new', 'V4 · After finishing a project: the new floor lamp and trophy are announced and highlighted')
      await roomTab('Art workshop').click()
      await roomTab('Coding room').click()
      await page.locator('figcaption', { hasText: 'Painted room' }).waitFor({ timeout: 10_000 })
      expect((await page.getByRole('status').count()) === 0, 'the announcement is still shown after coming back')
      expect((await palaceButton().getByText('New').count()) === 0, 'the sidebar still says New')
      return { observed: `Announced: "${text}". Gone after leaving and returning.`, screenshots: [s] }
    }
  )

  await testCase(
    {
      id: 'V5', area: 'Palace', title: 'The palace hub shows every room, the character and the shortcuts',
      steps: ['In the Palace, choose All rooms.', 'Wait for the character to walk to the room last worked in.', 'Click the Coding room on the map.'],
      expected:
        'A map with the four rooms around the atrium, each with its streak. Nato stands at the room last worked in. The atrium offers New chat, reminders and active projects. Clicking a room opens it.',
      failShot
    },
    async () => {
      await roomTab('All rooms').click()
      const stage = page.getByTestId('palace-stage')
      await stage.waitFor({ timeout: 10_000 })
      const wings = await stage.locator('button.palace-wing').count()
      expect(wings === 4, `the map had ${wings} rooms`)
      const nato = stage.getByRole('img', { name: /^Nato, in the (Coding room|Music studio)$/ })
      await nato.waitFor({ timeout: 5_000 })
      const where = await nato.getAttribute('alt')
      for (const name of [/^New chat$/, /^\d+ reminders?$/, /^\d+ active projects?$/]) {
        expect((await stage.getByRole('button', { name }).count()) === 1, `the atrium has no ${name} shortcut`)
      }
      const label = await stage.getByRole('button', { name: /^Music studio: 21-day streak/ }).count()
      expect(label === 1, 'the Music studio did not show its 21-day streak')
      const flowing = await stage.locator('button.palace-wing[data-active-today="true"]').count()
      expect(flowing === 2, `${flowing} rooms were marked as used today`)
      await settledHub()
      const s = await shot(page, 'V5-hub', 'V5 · The palace hub: four rooms around the atrium, Nato at the room last worked in, shortcuts in the centre')
      await stage.getByRole('button', { name: /^Coding room:/ }).click()
      await page.locator('figcaption', { hasText: 'Painted room' }).waitFor({ timeout: 10_000 })
      await page.getByRole('heading', { name: /Recent chats/ }).waitFor({ timeout: 5_000 })
      return { observed: `${wings} rooms on the map. ${where}. Clicking the Coding room opened it.`, screenshots: [s] }
    }
  )

  await testCase(
    {
      id: 'V6', area: 'Palace', title: 'A chat started inside a room opens beside it',
      steps: ['In the Coding room, click Chat here.', 'Close the chat panel.', 'Click ← Palace.'],
      expected:
        'A new, empty chat opens as a panel beside the room and says it will be filed in the Coding room. Closing it leaves the room; ← Palace returns to the map.',
      failShot
    },
    async () => {
      await page.getByRole('button', { name: 'Chat here', exact: true }).click()
      const panel = page.getByTestId('chat-panel')
      await panel.getByText('This chat will be filed in the Coding room.').waitFor({ timeout: 5_000 })
      expect(await page.locator('figcaption', { hasText: 'Painted room' }).isVisible(), 'the room is not visible beside the chat')
      await settled()
      const s = await shot(page, 'V6-chat-here', 'V6 · New chat started from the Coding room: a panel beside the room, saying where it will be filed')
      await panel.getByRole('button', { name: 'Close chat' }).click()
      await until(async () => (await panel.count()) === 0, { timeout: 5_000, what: 'the chat panel to close' })
      await page.getByRole('button', { name: '← Palace' }).click()
      await page.getByTestId('palace-stage').waitFor({ timeout: 5_000 })
      return { observed: 'The panel opened beside the Coding room and named it; closing it and ← Palace returned to the map.', screenshots: [s] }
    }
  )

  await testCase(
    {
      id: 'V7', area: 'Palace', title: 'The app opens on the palace, and Cmd+K jumps anywhere',
      steps: ['Relaunch the app.', 'Press Cmd+K, type "fingerstyle", press Enter.', 'Press Cmd+K, type "coding", press Enter.'],
      expected:
        'The app starts on the palace map with the rail collapsed. The search finds the chat by its title and opens it beside its room, the Music studio; then finds the Coding room and goes there.',
      failShot
    },
    async () => {
      await page.evaluate(() => window.localStorage.clear())
      await page.reload()
      await page.getByTestId('palace-stage').waitFor({ timeout: 15_000 })
      expect((await page.getByRole('navigation', { name: 'Chats' }).count()) === 0, 'the chat list was open at start')
      const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
      await page.keyboard.press(`${mod}+k`)
      const dialog = page.getByRole('dialog', { name: 'Search' })
      await dialog.waitFor({ timeout: 5_000 })
      await page.keyboard.type('fingerstyle')
      const first = (await dialog.getByRole('option').first().innerText()).replace(/\s+/g, ' ').trim()
      expect(/Daily fingerstyle practice/.test(first), `the first result was: ${first}`)
      const s1 = await shot(page, 'V7-search', 'V7 · Cmd+K: searching chats, rooms and projects by name')
      await page.keyboard.press('Enter')
      await page.getByTestId('chat-panel').getByRole('heading', { name: 'Daily fingerstyle practice' }).waitFor({ timeout: 5_000 })
      await page.locator('figcaption', { hasText: 'Finished room' }).waitFor({ timeout: 5_000 })
      await settled()
      const s2 = await shot(page, 'V7-chat-beside-room', 'V7 · The chat opens as a panel beside the room it lives in')
      await page.keyboard.press(`${mod}+k`)
      await dialog.waitFor({ timeout: 5_000 })
      await page.keyboard.type('coding')
      await page.keyboard.press('Enter')
      await page.locator('figcaption', { hasText: 'Painted room' }).waitFor({ timeout: 5_000 })
      expect((await page.getByTestId('chat-panel').count()) === 0, 'the chat panel stayed open after going to a room')
      return { observed: `Started on the map. First result: ${first}. Enter opened it beside the Music studio; "coding" went to the Coding room.`, screenshots: [s1, s2] }
    }
  )

  await testCase(
    {
      id: 'V8', area: 'Palace', title: 'Things in a room can be clicked',
      steps: [
        'Open the Coding room. Click the stage jacket.',
        'Press Esc.',
        'Click the desk.'
      ],
      expected:
        'The jacket opens a card listing the room\'s three finished projects, each with Reopen. Esc closes the card and stays in the room. The desk starts a chat that will be filed in the Coding room.',
      failShot
    },
    async () => {
      await roomTab('Coding room').click()
      await settled()
      const stage = page.getByTestId('palace-stage')
      const kinds = await stage.locator('button.hotspot').evaluateAll((els) => els.map((el) => el.getAttribute('data-hotspot')).sort().join(','))
      expect(kinds === 'chat,chats,finished,projects', `the room's clickable things were: ${kinds}`)
      await stage.getByRole('button', { name: /^The stage jacket:/ }).click()
      const card = page.getByTestId('room-panel')
      await card.waitFor({ timeout: 5_000 })
      const titles = (await card.locator('li').allInnerTexts()).map((t) => t.split('\n')[0].trim()).sort().join(', ')
      expect(titles === 'CSV importer, Login page, Sync module refactor', `the finished projects listed were: ${titles}`)
      expect((await card.getByRole('button', { name: /^Reopen:/ }).count()) === 3, 'not every finished project offers Reopen')
      const s1 = await shot(page, 'V8-card', 'V8 · Clicking the stage jacket in the Coding room: its finished projects, on a parchment card')
      await page.keyboard.press('Escape')
      await until(async () => (await card.count()) === 0, { timeout: 5_000, what: 'the card to close' })
      expect((await stageRoom()) === 'coding', 'Esc left the room instead of only closing the card')
      await stage.getByRole('button', { name: /^The desk:/ }).click()
      await page.getByTestId('chat-panel').getByText('This chat will be filed in the Coding room.').waitFor({ timeout: 5_000 })
      await page.getByTestId('chat-panel').getByRole('button', { name: 'Close chat' }).click()
      return { observed: `Things: ${kinds}. The jacket listed: ${titles}. Esc closed the card and stayed. The desk started a chat for the room.`, screenshots: [s1] }
    }
  )

  await testCase(
    {
      id: 'V9', area: 'Palace', title: 'Reminders can be answered on the map, and a chat can be dragged onto a room',
      steps: [
        'Go to All rooms and click the reminders button.',
        'Show the chat list and drag "Daily fingerstyle practice" onto the Art workshop tab.'
      ],
      expected:
        'The reminders card opens on the map (empty here). After the drag the chat is in the Art workshop as a move made by the person, and the activity strip says so.',
      failShot
    },
    async () => {
      await roomTab('All rooms').click()
      await settled()
      const stage = page.getByTestId('palace-stage')
      await stage.getByRole('button', { name: /^\d+ reminders?$/ }).click()
      const card = page.getByTestId('room-panel')
      await card.getByText('No reminder is waiting.').waitFor({ timeout: 5_000 })
      await page.keyboard.press('Escape')
      await until(async () => (await card.count()) === 0, { timeout: 5_000, what: 'the card to close' })
      const showChats = page.getByRole('button', { name: 'Show chats' })
      if (await showChats.count()) await showChats.click()
      const row = page.getByRole('navigation', { name: 'Chats' }).getByRole('button', { name: 'Daily fingerstyle practice', exact: true })
      await row.dragTo(roomTab('Art workshop'))
      await until(() => sql(userData, "select room_id || '|' || room_source from chats where id = 'c-music'") === 'art|user', { timeout: 10_000, what: 'the chat to be filed in the Art workshop' })
      await activityLine(page, /^You moved .Daily fingerstyle practice. to the Art workshop$/)
      await page.locator('nav[aria-label="Chats"] h2', { hasText: /art workshop/i }).waitFor({ timeout: 10_000 })
      await settled()
      return {
        observed: 'The reminders card opened and closed on the map. Dragging the chat onto the Art workshop filed it there as a user move.',
        screenshots: [await shot(page, 'V9-dragged', 'V9 · After dragging a chat onto the Art workshop: it is listed there and the activity strip reports the move')]
      }
    }
  )

  await app.close()
  rmSync(userData, { recursive: true, force: true })
}

// ---------------------------------------------------------------- main

const sessions = { S1: sessionChat, S2: sessionProjects, S3: sessionAuth, S4: sessionReminders, S5: sessionPalace }
const startedAt = new Date()
for (const [name, run] of Object.entries(sessions)) {
  if (only && only !== name) continue
  log(`\n== ${name} ==`)
  try {
    await run()
  } catch (error) {
    log(`Session ${name} aborted: ${error instanceof Error ? error.message : String(error)}`)
    results.push({
      id: `${name}-abort`, area: 'Harness', title: `Session ${name} stopped early`, steps: [], expected: 'The session runs to its end.',
      status: 'fail', observed: error instanceof Error ? error.message.split('\n')[0] : String(error), screenshots: [], seconds: 0
    })
  }
}

const git = (args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}
const pkg = require(join(root, 'package.json'))
writeFileSync(
  join(outDir, 'results.json'),
  JSON.stringify(
    {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      app: { name: pkg.name, version: pkg.version, commit: git(['rev-parse', '--short', 'HEAD']), branch: git(['branch', '--show-current']), dirty: git(['status', '--porcelain']) !== '' },
      environment: {
        os: `${execFileSync('sw_vers', ['-productName'], { encoding: 'utf8' }).trim()} ${execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim()}`,
        electron: require(join(root, 'node_modules/electron/package.json')).version,
        playwright: require(join(root, 'node_modules/playwright-core/package.json')).version,
        chatModel: 'claude-sonnet-5-5',
        classifierModel: 'claude-haiku-5-5'
      },
      results
    },
    null,
    2
  )
)
const count = (status) => results.filter((r) => r.status === status).length
log(`\n${count('pass')} passed, ${count('fail')} failed, ${count('not_run')} not run. Results in test-report/results.json`)
process.exit(count('fail') > 0 ? 1 : 0)
