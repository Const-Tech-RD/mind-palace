/**
 * Screenshots of the palace in fixed states, for looking at the canvas without
 * clicking through the app (plan v2, Testing: "Palace states").
 *
 *   npm run build && node scripts/palace-shots.mjs [fixture ...]
 *
 * Each fixture gets a fresh user-data folder: the app starts once to create the
 * database, the fixture is written into it with Node's built-in SQLite (no
 * sqlite3 CLI needed), then the app starts again and the palace is captured.
 * Pictures land in test-report/palace/. No model is called: chats are already
 * filed and quiet projects are snoozed, so neither the classifier nor the
 * reminders run.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'test-report', 'palace')
const TZ = 'America/Santo_Domingo'

/** The launching shell's Claude variables never reach the app (the app filters them too). */
function cleanEnv(extra) {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(ANTHROPIC_|CLAUDE_|CLAUDECODE)/.test(key) || value === undefined) continue
    env[key] = value
  }
  return { ...env, ...extra }
}

const now = new Date()
const iso = (daysAgo) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString()
const localDay = (instant) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant))
/** The instant `n` weekdays before now. */
function weekdaysAgo(n) {
  const d = new Date(now)
  for (let left = n; left > 0; ) {
    d.setDate(d.getDate() - 1)
    if (d.getDay() !== 0 && d.getDay() !== 6) left -= 1
  }
  return d.toISOString()
}

/** Writes a chat in `roomId` with one user message on each of the last `days` days. */
function streak(db, roomId, days) {
  const chatId = `fx-${roomId}`
  db.prepare(
    "insert into chats (id, title, room_id, room_source, classified_at, created_at, last_message_at) values (?, ?, ?, 'user', ?, ?, ?)"
  ).run(chatId, `Fixture chat in ${roomId}`, roomId, iso(0), iso(days), iso(0))
  const add = db.prepare("insert into messages (id, chat_id, role, content, created_at, local_day) values (?, ?, 'user', 'hi', ?, ?)")
  for (let i = 0; i < days; i++) add.run(`${chatId}-m${i}`, chatId, iso(i), localDay(iso(i)))
}

/** `count` finished projects in `roomId`, one per day going back from yesterday. */
function goals(db, roomId, count) {
  for (let i = 0; i < count; i++) {
    const id = `fx-${roomId}-done-${i}`
    db.prepare("insert into projects (id, title, room_id, state, created_at, closed_at) values (?, ?, ?, 'done', ?, ?)").run(id, `Done ${i}`, roomId, iso(60), iso(i + 1))
    db.prepare('insert into goal_completions (id, project_id, room_id, local_day) values (?, ?, ?, ?)').run(`${id}-g`, id, roomId, localDay(iso(i + 1)))
  }
}

/** An active project quiet for `weekdays` weekdays, snoozed so no reminder (and no model call) fires. */
function quietProject(db, roomId, weekdays) {
  db.prepare(
    "insert into projects (id, title, room_id, state, last_activity_at, created_at, snoozed_until) values (?, ?, ?, 'active', ?, ?, ?)"
  ).run(`fx-${roomId}-quiet`, `Quiet ${roomId} project`, roomId, weekdaysAgo(weekdays), iso(90), iso(-365))
}

const fixtures = {
  empty: { seed: () => {}, focus: ['coding'] },
  furnished: {
    seed: (db) => {
      streak(db, 'coding', 34)
      goals(db, 'coding', 13)
      streak(db, 'music', 8)
      goals(db, 'music', 3)
      streak(db, 'art', 13)
      goals(db, 'art', 5)
      streak(db, 'mailroom', 5)
      goals(db, 'mailroom', 2)
    },
    focus: ['coding', 'art', 'mailroom']
  },
  decay: {
    seed: (db) => {
      for (const room of ['coding', 'music', 'art', 'mailroom']) streak(db, room, 5)
      quietProject(db, 'coding', 8)
      quietProject(db, 'music', 15)
      quietProject(db, 'art', 22)
      quietProject(db, 'mailroom', 32)
    },
    focus: ['art'],
    extras: true
  }
}

async function launch(userData) {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.'],
    cwd: root,
    env: cleanEnv({ MIND_PALACE_USER_DATA: userData })
  })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {})
  await page.locator('.palace-canvas canvas').waitFor({ timeout: 30_000 })
  return { app, page }
}

const settle = (page, ms = 1500) => page.waitForTimeout(ms)

/** The app lives on in the tray after its window closes: give close() a moment, then end the process. */
async function quit(app) {
  const proc = app.process()
  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 5000))])
  if (proc.exitCode === null) proc.kill()
}

async function capture(name, fixture) {
  const userData = mkdtempSync(join(tmpdir(), `mind-palace-shots-${name}-`))
  try {
    // First start creates and migrates the database.
    let { app } = await launch(userData)
    await quit(app)

    const db = new DatabaseSync(join(userData, 'mind-palace.sqlite'))
    db.exec('pragma foreign_keys = on')
    db.prepare("insert or replace into settings (key, value) values ('timezone', ?)").run(TZ)
    fixture.seed(db)
    db.close()

    const run = await launch(userData)
    app = run.app
    const page = run.page
    await settle(page)
    const files = []
    const shot = async (suffix) => {
      const file = join(outDir, `${name}${suffix}.png`)
      await page.screenshot({ path: file })
      files.push(file)
    }
    await shot('')
    if (fixture.extras) {
      // The tooltip: point at the floor just below the Coding room's label.
      const label = await page.locator('[data-agent="coding"]').first().boundingBox()
      if (label) {
        await page.mouse.move(label.x + label.width / 2, label.y + label.height + 140)
        await settle(page, 600)
        await shot('-hover')
        await page.mouse.move(5, 5)
      }
      await page.getByRole('button', { name: 'List view' }).click()
      await settle(page, 400)
      await shot('-list')
      await page.getByRole('button', { name: 'Map view' }).click()
      await settle(page)
    }
    for (const roomId of fixture.focus ?? []) {
      await page.locator(`[data-agent="${roomId}"]`).first().click()
      await settle(page)
      await shot(`-${roomId}`)
      await page.keyboard.press('Escape')
      await settle(page, 800)
    }
    await quit(app)
    return files
  } finally {
    try {
      rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    } catch {
      // Windows may still hold a Chromium file for a moment; the temp folder is left behind.
    }
  }
}

mkdirSync(outDir, { recursive: true })
const wanted = process.argv.slice(2)
for (const [name, fixture] of Object.entries(fixtures)) {
  if (wanted.length > 0 && !wanted.includes(name)) continue
  try {
    const files = await capture(name, fixture)
    console.log(`${name}: ${files.map((f) => f.slice(root.length + 1)).join(', ')}`)
  } catch (error) {
    console.log(`${name}: FAILED ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
    process.exitCode = 1
  }
}
