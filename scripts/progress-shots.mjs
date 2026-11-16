/**
 * Drives project progress in the real app with a fake model and a throwaway
 * git repo, checks what it shows, and saves screenshots to test-report/progress/.
 *
 *     npx electron-vite build && node scripts/progress-shots.mjs
 *
 * The fake model's answers are written at run time: the draft cites the temp
 * repo's real commit hash (and one made up), and the refresh names milestone ids
 * read back from the database.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'test-report', 'progress')
mkdirSync(outDir, { recursive: true })
const TZ = 'America/Santo_Domingo'
const PROJECT = 'p-shop'

function cleanEnv(extra) {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(ANTHROPIC_|CLAUDE_|CLAUDECODE)/.test(key) || value === undefined) continue
    env[key] = value
  }
  return { ...env, ...extra }
}

async function launch(userData, fake) {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.'],
    cwd: root,
    env: cleanEnv({ MIND_PALACE_USER_DATA: userData, ...(fake ? { MIND_PALACE_FAKE_MODEL: fake } : {}) })
  })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1400, height: 950 }).catch(() => {})
  await page.locator('.palace-canvas canvas').waitFor({ timeout: 30_000 })
  return { app, page }
}

async function quit(app) {
  const proc = app.process()
  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 5000))])
  if (proc.exitCode === null) proc.kill()
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail && !ok ? ` (${detail})` : ''}`)
}

// --- A throwaway repo with a plan -------------------------------------------------
const repo = mkdtempSync(join(tmpdir(), 'mp-progress-repo-'))
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
git('init', '-q')
git('config', 'user.email', 'shots@example.invalid')
git('config', 'user.name', 'Shots')
mkdirSync(join(repo, 'docs'))
writeFileSync(join(repo, 'docs', 'plan.md'), '# Shop plan\n- [x] Login\n- [ ] Payments\n')
writeFileSync(join(repo, 'package.json'), '{}\n')
git('add', '.')
git('commit', '-q', '-m', 'feat: login works')
const loginHash = git('rev-parse', '--short=7', 'HEAD')
writeFileSync(join(repo, 'README.md'), 'shop\n')
git('add', '.')
git('commit', '-q', '-m', 'docs: readme')

// --- The app's database ------------------------------------------------------------
const userData = mkdtempSync(join(tmpdir(), 'mp-progress-'))
const fakeFile = join(userData, 'fake-model.json')
const fake = {
  sweep: { chat_ids: ['c-2', 'c-3'] },
  digest: { done: [{ item: 'Login page', day: '2026-10-01' }], planned: ['Payments'] },
  draft: {
    milestones: [
      { title: 'Login', status: 'done', done_on: '2026-10-01', evidence: 'commit', evidence_ref: loginHash },
      { title: 'Signup', status: 'done', done_on: '2026-10-05', evidence: 'commit', evidence_ref: 'deadbee' },
      { title: 'Payments', status: 'planned', done_on: '', evidence: 'plan', evidence_ref: 'docs/plan.md:3' },
      { title: 'Launch', status: 'planned', done_on: '', evidence: 'chat', evidence_ref: 'c-1' }
    ]
  },
  refresh: { proposals: [] }
}
writeFileSync(fakeFile, JSON.stringify(fake))

let { app } = await launch(userData)
await quit(app)

const dbPath = join(userData, 'mind-palace.sqlite')
{
  const db = new DatabaseSync(dbPath)
  db.exec('pragma foreign_keys = on')
  db.prepare("insert or replace into settings (key, value) values ('timezone', ?)").run(TZ)
  const at = new Date().toISOString()
  const day = at.slice(0, 10)
  const chat = db.prepare("insert into chats (id, title, room_id, room_source, classified_at, created_at, last_message_at) values (?, ?, 'mailroom', 'model', ?, ?, ?)")
  const msg = db.prepare('insert into messages (id, chat_id, role, content, created_at, local_day) values (?, ?, ?, ?, ?, ?)')
  for (const [id, title] of [['c-1', 'Shop app: login'], ['c-2', 'Shop app: payments'], ['c-3', 'Shop app: emails'], ['c-4', 'Sourdough starter']]) {
    chat.run(id, title, at, at, at)
    msg.run(`${id}-u`, id, 'user', `${title}, let's work on it`, at, day)
    msg.run(`${id}-a`, id, 'assistant', `Sure, here is a plan for ${title}.`, at, day)
  }
  db.prepare(
    "insert into projects (id, title, room_id, origin_chat_id, state, last_activity_at, created_at, folder, git_root, folder_source) values (?, 'Shop app', 'mailroom', 'c-1', 'active', ?, ?, ?, ?, 'user')"
  ).run(PROJECT, at, at, repo, repo)
  db.prepare('insert into project_chats (project_id, chat_id) values (?, ?)').run(PROJECT, 'c-1')
  db.close()
}

const read = (sql, ...args) => {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return db.prepare(sql).all(...args)
  } finally {
    db.close()
  }
}

async function openProgress(page) {
  await page.locator('button[title="Projects"], button:has-text("Projects")').first().click()
  const card = page.locator('li', { has: page.locator('h3', { hasText: 'Shop app' }) })
  await card.getByRole('button', { name: 'Progress' }).click()
  return page.locator(`[data-progress="${PROJECT}"]`)
}
const shot = (page, name) => page.screenshot({ path: join(outDir, `${name}.png`) })

// --- First run: sweep, link, draft --------------------------------------------------
let page
;({ app, page } = await launch(userData, fakeFile))
let view = await openProgress(page)
await view.getByRole('button', { name: 'Build progress' }).click()
const sweepCard = view.locator('[data-sweep]')
await sweepCard.waitFor({ timeout: 10_000 })
const offered = await sweepCard.locator('li').allInnerTexts()
check('the sweep offers the two matching chats', offered.length === 2 && offered.some((t) => t.includes('payments')) && offered.some((t) => t.includes('emails')), offered.join(' | '))
await shot(page, '1-sweep')
await sweepCard.locator('li', { hasText: 'emails' }).locator('input[type=checkbox]').uncheck()
await sweepCard.getByRole('button', { name: 'Link these' }).click()
await view.getByText('2 of 4').waitFor({ timeout: 15_000 })
check('the draft shows 2 of 4', true)
const links = read('select chat_id from project_chats where project_id = ? order by chat_id', PROJECT).map((r) => r.chat_id)
check('the ticked chat is linked, the unticked one is not', links.join(',') === 'c-1,c-2', links.join(','))
check('the unticked chat is remembered as dismissed', read('select count(*) n from sweep_dismissals where chat_id = ?', 'c-3')[0].n === 1)
const rowText = async (title) => (await view.locator(`[data-milestone="${title}"]`).innerText()).toLowerCase()
check('a real commit shows as confirmed', (await rowText('Login')).includes('confirmed'))
check('a made-up commit shows as from chats', (await rowText('Signup')).includes('from chats'))
check('a planned milestone shows no confirmed mark, even citing a plan line', !(await rowText('Payments')).includes('confirmed'))
await shot(page, '2-drafted')

// --- Hand edits, then a refresh that must respect them ------------------------------
const ids = Object.fromEntries(read('select id, title from milestones where project_id = ?', PROJECT).map((r) => [r.title, r.id]))
await view.locator('[data-milestone="Signup"]').getByRole('button', { name: 'Signup', exact: true }).click()
const title = view.getByLabel('Milestone title')
await title.fill('Accounts')
await title.press('Enter')
await view.locator('[data-milestone="Accounts"]').waitFor()
await view.locator('[data-milestone="Login"] input[type=checkbox]').uncheck()
await view.getByText('1 of 4').waitFor()

fake.refresh = {
  proposals: [
    { kind: 'tick', milestone_id: ids.Login, title: 'Login', after_id: '', evidence: 'commit', evidence_ref: loginHash, done_on: '2026-10-01' },
    { kind: 'add', milestone_id: '', title: 'Signup', after_id: '', evidence: 'chat', evidence_ref: 'c-2', done_on: '' },
    { kind: 'add', milestone_id: '', title: 'Emails', after_id: ids.Payments, evidence: 'chat', evidence_ref: 'c-2', done_on: '' },
    { kind: 'tick', milestone_id: ids.Payments, title: 'Payments', after_id: '', evidence: 'commit', evidence_ref: loginHash, done_on: '2026-11-01' }
  ]
}
writeFileSync(fakeFile, JSON.stringify(fake))
const refreshButton = view.getByRole('button', { name: 'Refresh', exact: true })
await refreshButton.dblclick()
await view.locator('[data-proposal]').first().waitFor({ timeout: 15_000 })
await page.waitForTimeout(1500)
const waiting = read('select kind, title from milestone_proposals where project_id = ? and answered is null order by title', PROJECT)
check(
  'a double-clicked refresh leaves one set of proposals, none touching edited milestones',
  waiting.map((p) => `${p.kind}:${p.title}`).join(',') === 'add:Emails,tick:Payments',
  waiting.map((p) => `${p.kind}:${p.title}`).join(',')
)
check('milestone rows were not changed by the refresh', read("select count(*) n from milestones where project_id = ? and title = 'Accounts' and status = 'done'", PROJECT)[0].n === 1)
await shot(page, '3-proposals')
await view.locator('[data-proposal="Emails"]').getByRole('button', { name: 'Accept' }).click()
await view.getByText('1 of 5').waitFor()
const order = await view.locator('[data-milestone]').evaluateAll((els) => els.map((e) => e.getAttribute('data-milestone')))
check('the accepted milestone lands after Payments', order.join(',') === 'Login,Accounts,Payments,Emails,Launch', order.join(','))
await quit(app)

// --- A restart keeps everything ------------------------------------------------------
;({ app, page } = await launch(userData, fakeFile))
view = await openProgress(page)
await view.getByText('1 of 5').waitFor({ timeout: 10_000 })
check('after a restart: 1 of 5, the rename and the waiting tick are still there', (await view.locator('[data-milestone="Accounts"]').count()) === 1 && (await view.locator('[data-proposal="Payments"]').count()) === 1)
await shot(page, '4-after-restart')

// --- Review fix: a waiting tick goes away once the person sets that milestone ----------
await view.locator('[data-milestone="Payments"] input[type=checkbox]').check()
await view.getByText('2 of 5').waitFor()
check('a waiting tick disappears once that milestone is ticked by hand', (await view.locator('[data-proposal="Payments"]').count()) === 0)

// --- Review fix: sweep results survive a reload before "Link these" -----------------------
fake.sweep = { chat_ids: ['c-4'] }
writeFileSync(fakeFile, JSON.stringify(fake))
await view.getByRole('button', { name: 'Find more chats' }).click()
await view.locator('[data-sweep]').waitFor({ timeout: 10_000 })
await page.reload()
await page.locator('.palace-canvas canvas').waitFor({ timeout: 30_000 })
view = await openProgress(page)
await view.getByText('2 of 5').waitFor({ timeout: 10_000 })
await view.getByRole('button', { name: 'Find more chats' }).click()
await view.locator('[data-sweep]').waitFor({ timeout: 10_000 }).catch(() => {})
check('a chat offered but never answered is offered again', (await view.locator('[data-sweep] li', { hasText: 'Sourdough' }).count()) === 1)
await view.locator('[data-sweep] li', { hasText: 'Sourdough' }).locator('input[type=checkbox]').uncheck().catch(() => {})
await view.getByRole('button', { name: 'Link these' }).click().catch(() => {})

// --- Review fix: deleting every milestone is not a dead end --------------------------------
for (;;) {
  const remove = view.getByRole('button', { name: /^Delete / }).first()
  if ((await remove.count()) === 0) break
  await remove.click()
  await page.waitForTimeout(150)
}
const newMilestone = view.getByLabel('New milestone')
check('with every milestone deleted, one can still be added', (await newMilestone.count()) === 1)
if ((await newMilestone.count()) === 1) {
  await newMilestone.fill('Start over')
  await newMilestone.press('Enter')
  await view.getByText('0 of 1').waitFor({ timeout: 5000 }).catch(() => {})
  check('the added milestone counts', (await view.getByText('0 of 1').count()) === 1)
}
await shot(page, '4b-review-fixes')

// --- A folder that is gone -----------------------------------------------------------
await page.evaluate((projectId) => window.mindPalace.invoke('progress:folder', { projectId, folder: 'C:/mind-palace-no-such-folder' }), PROJECT)
await view.getByRole('button', { name: 'Refresh', exact: true }).click()
await view.locator('[data-folder]').getByText(/gone|not a git/i).waitFor({ timeout: 15_000 })
check('a missing folder still refreshes and says why', (await view.getByText('0 of 1').count()) === 1)
await shot(page, '5-missing-folder')
await quit(app)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots in ${outDir}`)
process.exit(failed.length === 0 ? 0 : 1)
