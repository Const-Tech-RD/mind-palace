/**
 * Turns test-report/results.json and its screenshots into test-report/report.html
 * and test-report/report.pdf. Run after tests/e2e/run.mjs.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const outDir = join(root, 'test-report')
const data = JSON.parse(readFileSync(join(outDir, 'results.json'), 'utf8'))

const esc = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const code = (text) => esc(text).replace(/`([^`]+)`/g, '<code>$1</code>')

const STATUS = { pass: 'Pass', fail: 'Fail', not_run: 'Not run' }
const AREAS = ['Launch', 'Login', 'Chat', 'Rooms', 'Projects', 'Reminders', 'Palace', 'Harness']
const AREA_NOTE = {
  Launch: 'Starting the app, its database and catalog, and the tray behaviour.',
  Login: 'What the app shows when Claude cannot be reached with the login on this machine.',
  Chat: 'Sending, streaming, web search, stopping, persistence and deletion. These cases call Claude for real.',
  Rooms: 'The classifier placing chats in rooms, the 30-minute quiet re-check, and moving a chat by hand.',
  Projects: 'The "Track it?" card, recognising an existing project, and every action of the projects panel.',
  Reminders: 'The scheduler at launch, the two-a-day notification cap, the inbox, and logging how each reminder ended.',
  Palace: 'The illustrated rooms: streak and goal progress, the room filling in, trophies, and announcing what is new.',
  Harness: 'Problems in the test run itself.'
}

const results = data.results
const count = (status) => results.filter((r) => r.status === status).length
const byArea = AREAS.map((area) => ({ area, cases: results.filter((r) => r.area === area) })).filter((g) => g.cases.length)
const shots = results.reduce((n, r) => n + r.screenshots.length, 0)
const minutes = Math.round((new Date(data.finishedAt) - new Date(data.startedAt)) / 6000) / 10
const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(data.startedAt))

const matrixRows = byArea
  .map(
    ({ area, cases }) =>
      `<tr class="area"><td colspan="4">${esc(area)}</td></tr>` +
      cases
        .map(
          (c) =>
            `<tr><td class="id">${esc(c.id)}</td><td>${esc(c.title)}</td><td class="exp">${code(c.expected)}</td><td><span class="badge ${c.status}">${STATUS[c.status]}</span></td></tr>`
        )
        .join('')
  )
  .join('')

const caseBlock = (c) => `
  <article class="case">
    <div class="text">
    <h3><span class="id">${esc(c.id)}</span> ${esc(c.title)} <span class="badge ${c.status}">${STATUS[c.status]}</span></h3>
    ${c.steps.length ? `<p class="label">Steps</p><ol>${c.steps.map((s) => `<li>${code(s)}</li>`).join('')}</ol>` : ''}
    ${c.expected ? `<p><span class="label">Expected</span> ${code(c.expected)}</p>` : ''}
    <p><span class="label">${c.status === 'not_run' ? 'Why not run' : 'Observed'}</span> ${code(c.observed)}${c.seconds ? ` <span class="time">(${c.seconds}s)</span>` : ''}</p>
    </div>
    ${
      c.screenshots.length
        ? `<div class="shots ${c.screenshots.length === 1 ? 'one' : ''}">${c.screenshots
            .map((s) => `<figure><img src="${esc(s.file)}" alt=""><figcaption>${esc(s.caption)}</figcaption></figure>`)
            .join('')}</div>`
        : ''
    }
  </article>`

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Mind Palace · end-to-end test report</title>
<style>
  :root { --ink: #1c1917; --muted: #6b645c; --line: #e2dcd3; --pass: #1f7a4d; --fail: #b3261e; --skip: #8a6d1a; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 10.5pt/1.5 -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color: var(--ink); }
  h1 { font-size: 22pt; line-height: 1.15; margin: 0 0 4pt; }
  h2 { font-size: 14pt; margin: 22pt 0 4pt; padding-bottom: 4pt; border-bottom: 1px solid var(--line); break-after: avoid; }
  h3 { font-size: 11pt; margin: 0 0 6pt; break-after: avoid; }
  p { margin: 0 0 6pt; }
  ol { margin: 0 0 6pt; padding-left: 16pt; }
  code { font: 9pt ui-monospace, Menlo, monospace; background: #f3efe9; padding: 0 3pt; border-radius: 3pt; }
  .sub { color: var(--muted); margin-bottom: 14pt; }
  .summary { display: flex; gap: 10pt; margin: 14pt 0 6pt; }
  .stat { flex: 1; border: 1px solid var(--line); border-radius: 6pt; padding: 8pt 10pt; }
  .stat b { display: block; font-size: 20pt; line-height: 1.1; }
  .stat span { color: var(--muted); font-size: 9pt; }
  .stat.pass b { color: var(--pass); } .stat.fail b { color: var(--fail); } .stat.not_run b { color: var(--skip); }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  th { text-align: left; color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--ink); padding: 4pt 6pt; }
  td { vertical-align: top; padding: 4pt 6pt; border-bottom: 1px solid var(--line); }
  tr { break-inside: avoid; }
  tr.area td { font-weight: 600; background: #f6f2ec; border-bottom: 1px solid var(--line); }
  td.id, .id { font: 600 9pt ui-monospace, Menlo, monospace; white-space: nowrap; }
  td.exp { color: #3d3833; }
  .badge { display: inline-block; font-size: 8pt; font-weight: 600; padding: 1pt 6pt; border-radius: 8pt; white-space: nowrap; vertical-align: 1pt; }
  .badge.pass { color: var(--pass); background: #e3f3ea; } .badge.fail { color: #fff; background: var(--fail); } .badge.not_run { color: var(--skip); background: #f6edcf; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 2pt 12pt; margin: 6pt 0 0; font-size: 9.5pt; }
  dt { color: var(--muted); } dd { margin: 0; }
  .case { border-top: 1px solid var(--line); padding: 9pt 0 2pt; margin: 8pt 0 0; }
  .case .text { break-inside: avoid; }
  .label { font-size: 8pt; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); margin-right: 4pt; }
  p.label { margin-bottom: 2pt; }
  .time { color: var(--muted); font-size: 9pt; }
  .shots { display: flex; gap: 8pt; margin-top: 6pt; break-inside: avoid; }
  figure { margin: 0; flex: 1; break-inside: avoid; }
  .shots.one figure { flex: 0 0 72%; }
  figure img { display: block; width: 100%; border: 1px solid var(--line); border-radius: 4pt; }
  figcaption { font-size: 8.5pt; color: var(--muted); margin-top: 3pt; }
  .note { color: var(--muted); font-size: 9.5pt; }
  ul { margin: 0 0 6pt; padding-left: 16pt; }
</style>
</head>
<body>
  <h1>Mind Palace · end-to-end test report</h1>
  <p class="sub">${esc(date)} · ${esc(data.app.name)} ${esc(data.app.version)}, commit <code>${esc(data.app.commit)}</code>${data.app.dirty ? ' plus uncommitted test files' : ''} on <code>${esc(data.app.branch)}</code></p>

  <p>${count('fail') === 0 ? `All ${count('pass')} cases that could be run passed.` : `${count('fail')} of ${count('pass') + count('fail')} cases that were run failed.`}${count('not_run') ? ` ${count('not_run')} case could not be run on this machine and is listed with the reason.` : ''} The run covers the parts of the app that exist today: launch, login handling, chat, rooms, projects, reminders and the palace view. Packaging is not built yet and is not in this report.</p>

  <div class="summary">
    <div class="stat"><b>${results.length}</b><span>cases in the matrix</span></div>
    <div class="stat pass"><b>${count('pass')}</b><span>passed</span></div>
    <div class="stat fail"><b>${count('fail')}</b><span>failed</span></div>
    <div class="stat not_run"><b>${count('not_run')}</b><span>not run</span></div>
    <div class="stat"><b>${shots}</b><span>screenshots</span></div>
  </div>

  <h2>How it was run</h2>
  <p>Playwright drove the built Electron app directly, clicking and typing in the real window. Each session used its own empty user-data folder, so the real database was never touched. Chat cases sent real messages to Claude and classifier cases ran the real classifier; nothing was mocked. Database state behind the screen was checked with <code>sqlite3</code> after each action.</p>
  <p>Screenshots show end results and the intermediate states that matter (an answer being written, a web search in progress). A case whose result looks the same as another's has no screenshot of its own.</p>
  <dl>
    <dt>System</dt><dd>${esc(data.environment.os)} · Electron ${esc(data.environment.electron)} · Playwright ${esc(data.environment.playwright)}</dd>
    <dt>Models</dt><dd>chat <code>${esc(data.environment.chatModel)}</code>, classifier <code>${esc(data.environment.classifierModel)}</code>, through the local Claude Code login</dd>
    <dt>Duration</dt><dd>${minutes} minutes</dd>
    <dt>Reproduce</dt><dd><code>npm run build &amp;&amp; node tests/e2e/run.mjs &amp;&amp; node tests/e2e/report.mjs</code></dd>
  </dl>

  <h2>Test matrix</h2>
  <table>
    <thead><tr><th>ID</th><th style="width:27%">Case</th><th>Expected</th><th>Result</th></tr></thead>
    <tbody>${matrixRows}</tbody>
  </table>

  ${byArea
    .map(
      ({ area, cases }) => `
  <h2>${esc(area)}</h2>
  <p class="note">${esc(AREA_NOTE[area] ?? '')}</p>
  ${cases.map(caseBlock).join('')}`
    )
    .join('')}

  <h2>What this run does not show</h2>
  <ul>
    <li><b>Answers depend on the model.</b> Chat and classifier cases use real Claude calls, so a rerun can word answers differently, and a room or project decision could differ on a borderline chat. The seeded chats were chosen to be clear-cut.</li>
    <li><b>Classifier quality is not measured here.</b> Seven chats were classified, all as expected. The plan's targets (85% room accuracy, over 70% project precision) need the eval on each person's own labelled chats, which has not been run.</li>
    <li><b>The quiet re-check was triggered with seeded timestamps</b>, 40 minutes in the past, not by waiting 30 minutes.</li>
    <li><b>The tray icon and its menu</b> were not looked at; only that closing the window leaves the app running.</li>
    <li><b>macOS only.</b> Nothing was run on Windows.</li>
    <li><b>Reminders ran at launch on seeded dates</b>, not by letting days pass, and the 15-minute timer was not waited for. System notifications were issued, but whether macOS displayed them, and their Done and Snooze buttons, was not checked.</li>
    <li><b>The palace view uses whole illustrated rooms</b>, not the sprite grid of the asset spec: furniture is listed beside the picture, not drawn into it. Streaks were seeded with dated messages, not earned over real days.</li>
    <li><b>Not built yet, so not tested:</b> the packaged installer.</li>
  </ul>
  <p class="note">The rules themselves (streaks, goals, unlocks, classification and project transitions) are covered separately by the unit tests (<code>npm test</code>), which run without the app.</p>
</body>
</html>`

writeFileSync(join(outDir, 'report.html'), html)
execFileSync(require('electron'), [join(here, 'pdf-main.cjs'), join(outDir, 'report.html'), join(outDir, 'report.pdf')], {
  stdio: 'inherit',
  env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('MIND_PALACE_')))
})
console.log(`Wrote ${join(outDir, 'report.pdf')}`)
