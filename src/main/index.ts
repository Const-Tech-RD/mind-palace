import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, dialog } from 'electron'
import { formatIssue } from '@shared/catalog'
import type { ChatEvent } from '@shared/chat'
import { APP_EVENT_CHANNEL, CHAT_EVENT_CHANNEL, type AppEvent, type AppStatus } from '@shared/ipc'
import { SCHEDULER_MINUTES } from '@shared/reminders'
import { CatalogError, loadCatalog, type LoadedCatalog } from './catalog/loader'
import { askJson, type JsonAnswer } from './chat/claude'
import { createChatRepo } from './chat/repo'
import { createChatService, type ChatService } from './chat/service'
import { createClassifier } from './palace/classifier'
import { createProjectService } from './palace/projects'
import { createPalaceRepo } from './palace/repo'
import { createPalaceView } from './palace/view'
import { createProgressKeeper } from './palace/progress'
import { createRoomsRepo } from './palace/roomsRepo'
import { createRoomService } from './palace/roomService'
import { catalogWithValidRooms, roomDefFromRow } from '@shared/rooms'
import type { Catalog } from '@shared/catalog'
import { openStore, type Store } from './db/client'
import { handle } from './ipc'
import { applyStartAtLogin, getStartAtLogin } from './loginItem'
import { installAppMenu } from './menu'
import { catalogDir, databasePath, migrationsDir } from './paths'
import { showReminderNotification } from './reminders/notify'
import { createReminderRepo } from './reminders/repo'
import { createReminderService, type ReminderService } from './reminders/service'
import { createTray, destroyTray } from './tray'
import { createMainWindow, getMainWindow, markQuitting, showMainWindow } from './window'

/**
 * Test hooks, both off by default:
 *  - MIND_PALACE_USER_DATA=<dir>  keep the database somewhere other than the real user-data folder.
 *  - MIND_PALACE_SMOKE=1          start everything, print one JSON status line, then quit.
 */
const userDataOverride = process.env['MIND_PALACE_USER_DATA']
if (userDataOverride) app.setPath('userData', userDataOverride)
const smoke = process.env['MIND_PALACE_SMOKE'] === '1'

let store: Store | null = null
let chat: ChatService | null = null

/** Chat model when the `model.chat` setting is absent. The plan assumes Sonnet for usage limits. */
const DEFAULT_CHAT_MODEL = 'claude-sonnet-5-5'
/** Model for the classifier (and later the nudges); the plan puts both on Haiku. */
const DEFAULT_SMALL_MODEL = 'claude-haiku-5-5'
/** How often chats that have gone quiet are looked for. */
const QUIET_CHECK_EVERY_MS = 5 * 60_000
let quietTimer: NodeJS.Timeout | null = null
let reminderTimer: NodeJS.Timeout | null = null

function fatal(title: string, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[mind-palace] ${title}\n${message}`)
  if (!smoke) dialog.showErrorBox(title, message)
  app.exit(1)
  // app.exit() is asynchronous on some platforms; make sure start-up stops here.
  throw error
}

function start(): void {
  let catalog: LoadedCatalog
  try {
    catalog = loadCatalog(catalogDir())
  } catch (error) {
    fatal(error instanceof CatalogError ? 'Mind Palace: invalid catalog' : 'Mind Palace: cannot load catalog', error)
  }
  for (const warning of catalog.warnings) console.warn(`[mind-palace] catalog warning: ${formatIssue(warning)}`)

  try {
    store = openStore(databasePath(), migrationsDir())
  } catch (error) {
    fatal('Mind Palace: cannot open the database', error)
  }
  const db = store
  if (db.getSetting('timezone') === undefined) {
    db.setSetting('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone)
  }
  applyStartAtLogin(db)

  const fileCatalog = catalog
  const roomsRepo = createRoomsRepo(db.db)
  /** The catalog with the rooms the person made; read fresh, since rooms are made while the app runs. */
  const currentCatalog = (): Catalog =>
    catalogWithValidRooms(
      fileCatalog,
      roomsRepo.rows().flatMap((row) => {
        try {
          return [roomDefFromRow(row)]
        } catch (error) {
          console.warn(`[mind-palace] room "${row.id}" is left out: ${error instanceof Error ? error.message : String(error)}`)
          return []
        }
      }),
      (message) => console.warn(`[mind-palace] ${message}`)
    )

  const status = (): AppStatus => ({
    version: app.getVersion(),
    databasePath: db.path,
    tables: db.tables(),
    rooms: Object.values(currentCatalog().rooms).map(({ id, name, accent }) => ({ id, name, accent })),
    catalogWarnings: catalog.warnings.map(formatIssue),
    startAtLogin: getStartAtLogin(db)
  })

  handle('ping', ({ message }) => ({ pong: true, echo: message, at: new Date().toISOString() }))
  handle('app:status', status)

  // The SDK keeps its session transcripts per working directory; give the app its own.
  const sessionsDir = join(app.getPath('userData'), 'claude-sessions')
  mkdirSync(sessionsDir, { recursive: true })
  const emit = (event: ChatEvent): void => getMainWindow()?.webContents.send(CHAT_EVENT_CHANNEL, event)
  const timeZone = (): string => db.getSetting('timezone') ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const chatRepo = createChatRepo(db.db, undefined, timeZone)
  // Messages from before local days were stored keep the day they show today.
  const stamped = chatRepo.fillMissingLocalDays()
  if (stamped > 0) console.log(`[mind-palace] stored the local day on ${stamped} older messages`)
  const palaceRepo = createPalaceRepo(db.db)
  // Earned stays earned: store each room's marks before anything can move a chat.
  const keeper = createProgressKeeper({ store: db, catalog: currentCatalog, timeZone })
  keeper.record()
  const onChanged = (chatId: string): void => emit({ type: 'updated', chatId })

  const emitApp = (event: AppEvent): void => getMainWindow()?.webContents.send(APP_EVENT_CHANNEL, event)
  const fakeModel = !app.isPackaged ? process.env['MIND_PALACE_FAKE_MODEL'] : undefined
  const askSmallModel = (prompt: string, system: string, schema: Record<string, unknown>) =>
    fakeModel ? fakeAnswer(fakeModel, schema) : askJson({
      prompt,
      system,
      schema,
      model: db.getSetting('model.small') ?? DEFAULT_SMALL_MODEL,
      cwd: sessionsDir,
      appVersion: app.getVersion()
    })

  // The reminders and projects services call each other; `reminders` is set just below.
  let reminders: ReminderService | null = null
  const projects = createProjectService({
    repo: palaceRepo,
    roomIds: () => Object.keys(currentCatalog().rooms),
    timeZone,
    onChanged,
    afterAction: (projectId, action) => reminders?.afterProjectAction(projectId, action),
    afterActivity: (projectId) => reminders?.afterProjectActivity(projectId),
    beforeMove: () => keeper.record(),
    goalDaysOf: (roomId) => keeper.goalDays(roomId),
    afterReopen: (roomId, daysBefore) => keeper.resetGoals(roomId, daysBefore)
  })
  const reminderService = createReminderService({
    repo: createReminderRepo(db.db),
    messagesOf: (chatId) => chatRepo.messages(chatId),
    askModel: askSmallModel,
    notificationsOn: () => db.getSetting('notifications') !== 'off',
    timeZone,
    projectAct: (projectId, action) => void projects.act(projectId, action),
    onChanged: () => emitApp({ type: 'reminders_changed' }),
    notify: (item) =>
      showReminderNotification(item, (reminderId, response) => {
        try {
          const target = reminderService.respond(reminderId, response)
          if (response === 'open') {
            showMainWindow()
            emitApp({ type: 'open_project', ...target })
          }
        } catch (error) {
          // Answered in the app before the notification was clicked: nothing left to do.
          console.warn(`[mind-palace] notification for ${reminderId}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }),
    log: (message) => console.warn(`[mind-palace] ${message}`)
  })
  reminders = reminderService
  const classifier = createClassifier({
    repo: palaceRepo,
    rooms: () =>
      Object.values(currentCatalog().rooms).map(({ id, name, belongs, not_here, examples }) => ({
        id,
        name,
        belongs,
        not_here,
        examples
      })),
    fallbackRoomId: catalog.rules.classification.fallback_room,
    messagesOf: (chatId) => chatRepo.messages(chatId),
    askModel: askSmallModel,
    onChanged,
    beforeMove: () => keeper.record(),
    log: (message) => console.warn(`[mind-palace] ${message}`)
  })

  const service = createChatService({
    repo: chatRepo,
    emit,
    sessionsDir,
    model: () => db.getSetting('model.chat') ?? DEFAULT_CHAT_MODEL,
    appVersion: app.getVersion(),
    afterUserMessage: (chatId, count) => {
      projects.noteActivity(chatId)
      classifier.afterUserMessage(chatId, count)
    }
  })
  chat = service

  // Chats that went quiet while the app was closed are picked up shortly after launch.
  const quietCheck = (): void => void classifier.runQuietChecks()
  // Reminders: at launch (one per project, however long the machine was off) and every 15 minutes.
  const reminderTick = (): void => void reminderService.tick()
  if (!smoke) {
    setTimeout(quietCheck, 10_000)
    quietTimer = setInterval(quietCheck, QUIET_CHECK_EVERY_MS)
    setTimeout(reminderTick, 5_000)
    reminderTimer = setInterval(reminderTick, SCHEDULER_MINUTES * 60_000)
  }
  handle('auth:check', () => service.auth())
  handle('auth:retry', () => service.auth({ retry: true }))
  handle('chat:list', () => service.list())
  handle('chat:messages', ({ chatId }) => service.messages(chatId))
  handle('chat:send', (request) => service.send(request))
  handle('chat:stop', ({ chatId }) => service.stop(chatId))
  handle('chat:delete', ({ chatId }) => {
    projects.forgetSuggestionOf(chatId)
    return service.delete(chatId)
  })
  handle('chat:move', ({ chatId, roomId }) => {
    projects.moveChat(chatId, roomId)
    return { moved: true }
  })
  handle('project:list', () => projects.list())
  handle('project:track', ({ chatId }) => projects.track(chatId))
  handle('project:dismiss', ({ chatId }) => {
    projects.dismiss(chatId)
    return { dismissed: true }
  })
  handle('project:action', ({ projectId, action }) => projects.act(projectId, action))
  const roomService = createRoomService({
    store: db,
    roomsRepo,
    palaceRepo,
    keeper,
    catalog: currentCatalog,
    askModel: askSmallModel,
    onChanged: () => emitApp({ type: 'rooms_changed' })
  })
  const palace = createPalaceView({ store: db, catalog: currentCatalog, keeper, suggestions: roomService.suggestions, timeZone })
  handle('palace:view', (request) => palace.view(request?.focus ?? null))
  handle('palace:place', (change) => palace.place(change))
  handle('palace:reset', ({ roomId, instance }) => palace.reset(roomId, instance))
  handle('rooms:materialize', async ({ area, name }) => {
    const roomId = await roomService.materialize(area, name)
    return palace.view(roomId)
  })
  handle('rooms:dismiss', ({ area }) => {
    roomService.dismiss(area)
    return palace.view()
  })
  handle('rooms:rename', ({ roomId, name }) => {
    roomService.rename(roomId, name)
    emitApp({ type: 'rooms_changed' })
    return palace.view(roomId)
  })
  handle('rooms:find', async () => {
    const tagged = await roomService.findAreas()
    return { tagged, view: palace.view() }
  })
  handle('palace:seen', ({ roomId }) => {
    palace.markSeen(roomId)
    return { seen: true }
  })
  handle('reminder:list', () => reminderService.list())
  handle('reminder:respond', ({ reminderId, response }) => reminderService.respond(reminderId, response))
  handle('reminder:notifications', ({ enabled }) => {
    if (enabled !== undefined) db.setSetting('notifications', enabled ? 'on' : 'off')
    return { enabled: db.getSetting('notifications') !== 'off' }
  })

  installAppMenu()
  createTray(db)

  // Launched by the OS at login: stay in the tray until asked for.
  const openedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin
  const win = createMainWindow({ show: !openedAtLogin && !smoke })
  if (openedAtLogin && process.platform === 'darwin') app.dock?.hide()

  if (smoke) {
    win.webContents.once('did-finish-load', () => {
      void (async () => {
        let ping: unknown
        try {
          ping = await win.webContents.executeJavaScript('window.mindPalace.ping("smoke")')
        } catch (error) {
          ping = { error: String(error) }
        }
        console.log(`MIND_PALACE_SMOKE ${JSON.stringify({ ...status(), rendererPing: ping, tray: true })}`)
        markQuitting()
        app.quit()
      })()
    })
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  // No windows is the normal resting state of a tray app: never quit on it.
  app.on('window-all-closed', () => {})

  app.on('activate', () => {
    if (getMainWindow()) showMainWindow()
    else if (app.isReady() && store) createMainWindow({ show: true })
  })

  // Reached from the tray's Quit item and from OS shutdown or logout.
  app.on('before-quit', () => markQuitting())
  app.on('will-quit', () => {
    if (quietTimer) clearInterval(quietTimer)
    quietTimer = null
    if (reminderTimer) clearInterval(reminderTimer)
    reminderTimer = null
    chat?.stopAll()
    chat = null
    destroyTray()
    store?.close()
    store = null
  })

  void app.whenReady().then(start)
}

/**
 * Screenshot runs only (never a packaged build): answers small-model calls from
 * a JSON file `{ "materialize": …, "grouping": …, "classify": … }`, picked by
 * the shape asked for, so the UI can be driven without the network.
 */
function fakeAnswer(file: string, schema: Record<string, unknown>): Promise<JsonAnswer> {
  const required = (schema['required'] as string[] | undefined) ?? []
  const kind = required.includes('items') ? 'materialize' : required.includes('areas') ? 'grouping' : 'classify'
  try {
    const answers = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    if (!(kind in answers)) return Promise.resolve({ ok: false, error: `the fake model has no "${kind}" answer` })
    return Promise.resolve({ ok: true, value: answers[kind], tokensIn: 0, tokensOut: 0 })
  } catch (error) {
    return Promise.resolve({ ok: false, error: `the fake model file cannot be read: ${error instanceof Error ? error.message : String(error)}` })
  }
}
