/**
 * The palace's music: one audio file the person picked from their own
 * computer. The renderer is sandboxed and cannot read files, so the file is
 * served to it through a private scheme that only ever answers with that one
 * file. Nothing is downloaded and nothing is copied.
 */
import { existsSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dialog, net, protocol, type BrowserWindow } from 'electron'
import type { MusicTrack } from '@shared/ipc'

export const MUSIC_SCHEME = 'mp-media'
const SETTING = 'music.path'
const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus']

interface SettingsStore {
  getSetting(key: string): string | undefined
  setSetting(key: string, value: string): void
}

/** Must run before the app is ready: lets <audio> stream from the scheme. */
export function registerMusicScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: MUSIC_SCHEME, privileges: { stream: true, supportFetchAPI: true } }])
}

export function createMusic(store: SettingsStore) {
  const current = (): string | null => {
    const path = store.getSetting(SETTING)
    return path && existsSync(path) ? path : null
  }
  const track = (): MusicTrack | null => {
    const path = current()
    // The file's name without its extension is what the player shows; the path stays in the main process.
    return path ? { name: basename(path, extname(path)) } : null
  }

  return {
    /** Serves the chosen file, whatever path the URL names, and nothing else. */
    serve(): void {
      protocol.handle(MUSIC_SCHEME, (request) => {
        const path = current()
        if (!path) return new Response('No music has been chosen.', { status: 404 })
        // Passing the headers on keeps range requests working, so the player can seek and loop.
        return net.fetch(pathToFileURL(path).toString(), { headers: request.headers })
      })
    },
    track,
    async choose(window: BrowserWindow | null): Promise<MusicTrack | null> {
      const options = {
        title: 'Choose the music for your palace',
        properties: ['openFile' as const],
        filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }]
      }
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
      const path = result.filePaths[0]
      if (result.canceled || !path) return track()
      store.setSetting(SETTING, path)
      return track()
    },
    clear(): null {
      store.setSetting(SETTING, '')
      return null
    }
  }
}
