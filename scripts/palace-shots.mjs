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

/** Rooms the person "made": the old placeholder rooms, rebuilt from library items, plus extras by id. */
const ROOMS = {
  coding: { name: 'Coding room', area: 'software', accent: 0, cell: [-1, -1], items: [['coding_laptop', 'desk_center'], ['coding_monitor', 'desk_center'], ['coding_whiteboard', 'wall_right_b'], ['coding_rack', 'corner_right'], ['coding_arcade', 'floor_right']] },
  music: { name: 'Music studio', area: 'music', accent: 1, cell: [-1, 0], items: [['music_mic', 'beside_seat'], ['music_speakers', 'desk_left'], ['music_keyboard', 'floor_right'], ['music_guitar', 'corner_right'], ['music_mixer', 'desk_center']] },
  art: { name: 'Art workshop', area: 'art', accent: 2, cell: [0, -1], items: [['art_sketchbook', 'desk_center'], ['art_easel', 'corner_right'], ['art_paint_cart', 'beside_seat'], ['art_pegboard', 'wall_right_b'], ['art_pottery_wheel', 'floor_right']] },
  finance: { name: 'Finance', area: 'finance', accent: 3, cell: [-2, 0], items: [['finance_ledger', 'desk_center'], ['finance_chart', 'wall_right_b'], ['finance_safe', 'corner_right'], ['finance_filing_cabinet', 'floor_right']] }
}
function rooms(db, ids = ['coding', 'music', 'art']) {
  const add = db.prepare('insert into rooms (id, name, area, accent, cell_x, cell_y, signature, classifier, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  ids.forEach((id, i) => {
    const r = ROOMS[id]
    const signature = JSON.stringify(r.items.map(([item, slot]) => ({ item, slots: [slot] })))
    const classifier = JSON.stringify({ belongs: `Chats about ${r.area}.`, not_here: '', examples: [`A chat about ${r.area}`] })
    add.run(id, r.name, r.area, r.accent, r.cell[0], r.cell[1], signature, classifier, iso(100 - i))
  })
}

const fixtures = {
  empty: { seed: (db) => rooms(db), focus: ['coding'] },
  alone: { seed: () => {}, focus: [] },
  grown: {
    seed: (db) => {
      rooms(db, ['coding', 'music', 'art', 'finance'])
      streak(db, 'finance', 8)
      streak(db, 'coding', 5)
    },
    focus: ['finance']
  },
  furnished: {
    seed: (db) => {
      rooms(db)
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
      rooms(db)
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

/**
 * The room editor end to end: move the chair, hide the crate... then restart
 * and see both kept; then a new streak day unlocks the monitor, which lands
 * on the desk without moving anything the user arranged.
 */
async function editorRun() {
  const userData = mkdtempSync(join(tmpdir(), 'mind-palace-shots-editor-'))
  const files = []
  const checks = []
  const check = (ok, what) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${what}`)
  const where = (view) => {
    const coding = view.rooms.find((r) => r.id === 'coding')
    return { placed: Object.fromEntries(coding.placed.map((p) => [p.instance, p.slot])), inventory: Object.fromEntries(coding.inventory.map((i) => [i.instance, i.reason])) }
  }
  try {
    let { app } = await launch(userData)
    await quit(app)
    let db = new DatabaseSync(join(userData, 'mind-palace.sqlite'))
    db.prepare("insert or replace into settings (key, value) values ('timezone', ?)").run(TZ)
    rooms(db)
    streak(db, 'coding', 2) // desk, chair (crate replaced), laptop
    db.close()

    let run = await launch(userData)
    let page = run.page
    await settle(page)
    await page.locator('[data-agent="coding"]').first().click()
    await settle(page)
    await page.getByRole('button', { name: /Arrange room/ }).click()
    const inRoom = page.getByRole('list', { name: 'In the room' })
    await inRoom.getByRole('listitem').filter({ hasText: 'Chair' }).getByRole('button', { name: 'Move' }).click()
    await settle(page, 400)
    await page.screenshot({ path: join(outDir, 'editor-targets.png') })
    files.push('editor-targets.png')
    await page.getByRole('button', { name: 'Beside the seat' }).click()
    await settle(page, 600)
    // The crate waits in the inventory: put it back on the seat the chair left.
    await page.getByRole('list', { name: 'Inventory' }).getByRole('listitem').filter({ hasText: 'Crate' }).getByRole('button', { name: 'Move' }).click()
    await page.getByRole('button', { name: 'The seat' }).click()
    await settle(page, 600)
    await page.screenshot({ path: join(outDir, 'editor-arranged.png') })
    files.push('editor-arranged.png')
    await quit(run.app)

    run = await launch(userData)
    page = run.page
    await settle(page)
    const afterRestart = where(await page.evaluate(() => window.mindPalace.invoke('palace:view', { focus: 'coding' })))
    check(afterRestart.placed['base_chair@seat#0'] === 'beside_seat', 'the moved chair is still beside the seat after a restart')
    check(afterRestart.placed['base_crate@seat#0'] === 'seat', 'the crate the user put back is still on the seat')
    await quit(run.app)

    // A third streak day unlocks the monitor (it replaces the laptop on desk_center).
    db = new DatabaseSync(join(userData, 'mind-palace.sqlite'))
    db.prepare("insert into messages (id, chat_id, role, content, created_at, local_day) values ('fx-extra', 'fx-coding', 'user', 'hi', ?, ?)").run(iso(2), localDay(iso(2)))
    db.close()
    run = await launch(userData)
    page = run.page
    await settle(page)
    const afterUnlock = where(await page.evaluate(() => window.mindPalace.invoke('palace:view', { focus: 'coding' })))
    check(afterUnlock.placed['coding_monitor@desk_center#0'] === 'desk_center', 'the new monitor lands on the desk')
    check(afterUnlock.placed['base_chair@seat#0'] === 'beside_seat' && afterUnlock.placed['base_crate@seat#0'] === 'seat', 'nothing the user arranged moved')
    await page.locator('[data-agent="coding"]').first().click()
    await settle(page)
    await page.screenshot({ path: join(outDir, 'editor-after-unlock.png') })
    files.push('editor-after-unlock.png')
    await quit(run.app)
  } finally {
    try {
      rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    } catch {
      // Left behind for a moment by Windows; harmless.
    }
  }
  return { files, checks }
}

mkdirSync(outDir, { recursive: true })
const wanted = process.argv.slice(2)
if (wanted.includes('editor')) {
  try {
    const { files, checks } = await editorRun()
    console.log(`editor: ${files.join(', ')}`)
    for (const line of checks) console.log(line)
    if (checks.some((c) => c.startsWith('FAIL'))) process.exitCode = 1
  } catch (error) {
    console.log(`editor: FAILED ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
    process.exitCode = 1
  }
}
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
