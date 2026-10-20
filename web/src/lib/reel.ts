import type { TrackLevel } from './audioLevels.ts'
import type { Size } from './outputGeometry.ts'
import type { TrimRange } from './trimRange.ts'

/** One clip of the reel as the page tracks it: its file, preview, trim and audio facts. */
export interface ClipItem {
  readonly id: number
  readonly file: File
  readonly objectUrl: string
  readonly duration: number
  readonly range: TrimRange
  /** Loudness per audio track; empty until the probe finishes (or for a file with no audio). */
  readonly audioLevels: readonly TrackLevel[]
  /** Audio streams in the file; null until known, or when the probe could not read the file. */
  readonly audioTrackCount: number | null
  readonly audioProbeDone: boolean
  /** The user's explicit track choice; null means "use the loudest". */
  readonly audioTrackOverride: number | null
  readonly previewBroken: boolean
  readonly sizeWarningDismissed: boolean
  /** The video's displayed size; 0x0 until the preview reports it. */
  readonly videoSize: Size
}

export type NewClip = Omit<ClipItem, 'id'>

export interface Reel {
  readonly clips: readonly ClipItem[]
  readonly selectedId: number | null
  /** Background music for this export only; never persisted. */
  readonly musicFile: File | null
  readonly nextId: number
}

export const emptyReel = (): Reel => ({ clips: [], selectedId: null, musicFile: null, nextId: 1 })

/** A just-picked clip: nothing is known about it until its preview and probe report in. */
export function createClip(file: File, objectUrl: string): NewClip {
  return {
    file,
    objectUrl,
    duration: 0,
    range: { start: 0, end: 0 },
    audioLevels: [],
    audioTrackCount: null,
    audioProbeDone: false,
    audioTrackOverride: null,
    previewBroken: false,
    sizeWarningDismissed: false,
    videoSize: { width: 0, height: 0 }
  }
}

export function addClips(reel: Reel, items: readonly NewClip[]): Reel {
  const added = items.map((item, offset): ClipItem => ({ ...item, id: reel.nextId + offset }))
  return {
    ...reel,
    clips: [...reel.clips, ...added],
    selectedId: reel.selectedId ?? added[0]?.id ?? null,
    nextId: reel.nextId + items.length
  }
}

export function removeClip(reel: Reel, id: number): Reel {
  const index = reel.clips.findIndex((clip) => clip.id === id)
  if (index < 0) return reel
  const clips = reel.clips.filter((clip) => clip.id !== id)
  // The selection moves to the clip that took its place, else the one before, else nothing.
  const selectedId =
    reel.selectedId !== id ? reel.selectedId : (clips[index] ?? clips[index - 1])?.id ?? null
  return { ...reel, clips, selectedId }
}

export function moveClip(reel: Reel, id: number, direction: 'up' | 'down'): Reel {
  const index = reel.clips.findIndex((clip) => clip.id === id)
  const target = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || target < 0 || target >= reel.clips.length) return reel
  const clips = [...reel.clips]
  ;[clips[index], clips[target]] = [clips[target], clips[index]]
  return { ...reel, clips }
}

/** Changes one clip. An unknown id is ignored, so a late probe for a removed clip is dropped. */
export function updateClip(reel: Reel, id: number, patch: Partial<Omit<ClipItem, 'id'>>): Reel {
  if (!reel.clips.some((clip) => clip.id === id)) return reel
  return { ...reel, clips: reel.clips.map((clip) => (clip.id === id ? { ...clip, ...patch } : clip)) }
}

export function selectClip(reel: Reel, id: number): Reel {
  return reel.clips.some((clip) => clip.id === id) ? { ...reel, selectedId: id } : reel
}

export const selectedClip = (reel: Reel): ClipItem | null =>
  reel.clips.find((clip) => clip.id === reel.selectedId) ?? null

export const setMusic = (reel: Reel, musicFile: File | null): Reel => ({ ...reel, musicFile })

/** Empties the reel for "Start over". The id counter keeps going so a late result for an old clip can't match a new one. */
export const clearReel = (reel: Reel): Reel => ({ ...emptyReel(), nextId: reel.nextId })
