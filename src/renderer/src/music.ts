import { create } from 'zustand'
import { MUSIC_URL, type MusicTrack } from '@shared/ipc'

/**
 * The palace's music: one looping track from a file the person chose. The
 * audio element lives here, outside React, so the music keeps playing while
 * views change and the voice assistant can turn it down to listen.
 */
const WANTED_KEY = 'mind-palace.music-on'
const VOLUME_KEY = 'mind-palace.music-volume'
const MUTED_KEY = 'mind-palace.music-muted'

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Not remembered; it still works for this sitting.
  }
}

const audio = new Audio()
audio.loop = true
audio.preload = 'auto'

interface MusicState {
  track: MusicTrack | null
  playing: boolean
  muted: boolean
  /** 0 to 1. */
  volume: number
  /** Turned down for a moment, while the assistant listens or speaks. */
  ducked: boolean
  error: string | null
  init(): Promise<void>
  play(): Promise<void>
  pause(): void
  toggle(): void
  setMuted(muted: boolean): void
  setVolume(volume: number): void
  choose(): Promise<void>
  clear(): Promise<void>
  duck(on: boolean): void
}

const DUCKED = 0.18
const clamp = (v: number): number => Math.max(0, Math.min(1, v))

export const useMusic = create<MusicState>((set, get) => {
  const apply = (): void => {
    const { volume, muted, ducked } = get()
    audio.volume = clamp(ducked ? volume * DUCKED : volume)
    audio.muted = muted
  }
  /** A new stamp on the URL makes the element load the newly chosen file. */
  const load = (): void => {
    audio.src = `${MUSIC_URL}?v=${Date.now()}`
  }
  audio.addEventListener('playing', () => set({ playing: true, error: null }))
  audio.addEventListener('pause', () => set({ playing: false }))
  audio.addEventListener('error', () => set({ playing: false, error: 'This file could not be played.' }))

  return {
    track: null,
    playing: false,
    muted: read(MUTED_KEY) === '1',
    volume: clamp(Number(read(VOLUME_KEY) ?? '0.5') || 0.5),
    ducked: false,
    error: null,

    async init() {
      const track = await window.mindPalace.invoke('music:get')
      set({ track })
      apply()
      if (!track) return
      load()
      // It plays on entering the palace, unless it was paused the last time.
      if (read(WANTED_KEY) !== '0') await get().play()
    },
    async play() {
      if (!get().track) return
      write(WANTED_KEY, '1')
      try {
        await audio.play()
      } catch {
        set({ playing: false })
      }
    },
    pause() {
      write(WANTED_KEY, '0')
      audio.pause()
    },
    toggle() {
      if (get().playing) get().pause()
      else void get().play()
    },
    setMuted(muted) {
      write(MUTED_KEY, muted ? '1' : '0')
      set({ muted })
      apply()
    },
    setVolume(volume) {
      const next = clamp(volume)
      write(VOLUME_KEY, String(next))
      set({ volume: next, muted: next === 0 ? get().muted : false })
      if (next > 0) write(MUTED_KEY, '0')
      apply()
    },
    async choose() {
      const before = get().track?.name
      const track = await window.mindPalace.invoke('music:choose')
      set({ track, error: null })
      if (!track) return
      if (track.name !== before || !audio.src) load()
      await get().play()
    },
    async clear() {
      audio.pause()
      audio.removeAttribute('src')
      await window.mindPalace.invoke('music:clear')
      set({ track: null, playing: false, error: null })
    },
    duck(on) {
      set({ ducked: on })
      apply()
    }
  }
})

/** For tests and debugging: what the audio element itself reports. */
export const musicElement = (): HTMLAudioElement => audio
