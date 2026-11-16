import { useEffect } from 'react'
import { useMusic } from '../music'

const icon = (path: string) => (
  <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={path} />
  </svg>
)
const NOTE = 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'
const PLAY = 'M7 5l12 7-12 7z'
const PAUSE = 'M8 5v14M16 5v14'
const SOUND = 'M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7'
const MUTED = 'M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6'

/**
 * The palace's music, at the foot of the rail. Collapsed, one button that
 * plays and pauses; expanded, also mute, volume and the choice of file.
 */
export function MusicPlayer({ open }: { open: boolean }) {
  const { track, playing, muted, volume, error, init, toggle, setMuted, setVolume, choose, clear } = useMusic()

  useEffect(() => {
    void init()
  }, [init])

  const quiet = 'flex size-8 shrink-0 items-center justify-center rounded-md text-paper/80 hover:bg-paper/10 hover:text-paper'

  if (!open) {
    return (
      <div className="border-t border-brass/25 p-2" data-testid="music-player">
        <button
          type="button"
          onClick={() => (track ? toggle() : void choose())}
          title={track ? (playing ? `Pause the music: ${track.name}` : `Play the music: ${track.name}`) : 'Choose music for the palace'}
          aria-label={track ? (playing ? 'Pause the music' : 'Play the music') : 'Choose music for the palace'}
          aria-pressed={track ? playing : undefined}
          className={`relative mx-auto flex w-full justify-center rounded-md py-2 ${playing ? 'text-gold' : 'text-paper/80'} hover:bg-paper/5`}
        >
          {icon(NOTE)}
          {playing && !muted && <span className="absolute top-1 right-1.5 size-1.5 animate-pulse rounded-full bg-gold" aria-hidden="true" />}
        </button>
      </div>
    )
  }

  return (
    <div className="border-t border-brass/25 px-3 py-2" data-testid="music-player">
      {track ? (
        <>
          <div className="flex items-center gap-1">
            <button type="button" onClick={toggle} aria-label={playing ? 'Pause the music' : 'Play the music'} aria-pressed={playing} className={`${quiet} ${playing ? 'text-gold' : ''}`}>
              {icon(playing ? PAUSE : PLAY)}
            </button>
            <button type="button" onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute the music' : 'Mute the music'} aria-pressed={muted} className={quiet}>
              {icon(muted ? MUTED : SOUND)}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Music volume"
              className="min-w-0 flex-1 accent-(--color-gold)"
            />
          </div>
          <p className="mt-1 truncate text-xs text-muted" title={track.name} data-testid="music-track">
            {track.name}
          </p>
          <div className="mt-1 flex gap-3 text-xs">
            <button type="button" onClick={() => void choose()} className="text-paper/70 underline-offset-2 hover:text-paper hover:underline">
              Change
            </button>
            <button type="button" onClick={() => void clear()} className="text-paper/70 underline-offset-2 hover:text-paper hover:underline">
              Remove
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-1 text-xs text-danger">
              {error}
            </p>
          )}
        </>
      ) : (
        <button type="button" onClick={() => void choose()} className="flex w-full items-center gap-2.5 rounded-md py-1.5 text-left text-sm text-paper/80 hover:bg-paper/5">
          {icon(NOTE)}
          <span className="flex-1">Choose music…</span>
        </button>
      )}
    </div>
  )
}
