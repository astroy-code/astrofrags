import { useCallback, useEffect, useRef, useState } from 'react'
import { applyMetadata } from './lib/clipMetadata.ts'
import type { VideoMetadata } from './lib/clipMetadata.ts'
import { probeAudioTracks } from './lib/exportClip.ts'
import {
  addClips,
  clearReel,
  createClip,
  emptyReel,
  moveClip,
  removeClip,
  selectClip,
  setMusic,
  setMuteOriginal,
  updateClip
} from './lib/reel.ts'
import type { ClipItem, Reel } from './lib/reel.ts'

export interface ReelActions {
  readonly addFiles: (files: readonly File[]) => void
  readonly remove: (id: number) => void
  readonly move: (id: number, direction: 'up' | 'down') => void
  readonly select: (id: number) => void
  readonly patch: (id: number, patch: Partial<Omit<ClipItem, 'id'>>) => void
  readonly reportMetadata: (id: number, metadata: VideoMetadata) => void
  readonly setMusicFile: (file: File | null) => void
  readonly setMuteOriginal: (muteOriginal: boolean) => void
  readonly startOver: () => void
}

/**
 * The reel the page edits. Every change goes through one ref-backed `commit`, so a probe or
 * preview report that lands later always applies to the newest reel, and one for a clip that has
 * since been removed (or replaced by a different file) is dropped.
 */
export function useReel(): readonly [Reel, ReelActions] {
  const [reel, setReel] = useState<Reel>(emptyReel)
  const reelRef = useRef(reel)
  const urlsRef = useRef<ReadonlySet<string>>(new Set())

  const commit = useCallback((next: Reel) => {
    reelRef.current = next
    setReel(next)
  }, [])

  // Release the preview URL of every clip that left the reel, and all of them on unmount.
  useEffect(() => {
    const present = new Set(reel.clips.map((clip) => clip.objectUrl))
    urlsRef.current.forEach((url) => {
      if (!present.has(url)) URL.revokeObjectURL(url)
    })
    urlsRef.current = present
  }, [reel.clips])
  useEffect(() => () => urlsRef.current.forEach((url) => URL.revokeObjectURL(url)), [])

  const patch = useCallback(
    (id: number, changes: Partial<Omit<ClipItem, 'id'>>) => commit(updateClip(reelRef.current, id, changes)),
    [commit]
  )

  const addFiles = useCallback(
    (files: readonly File[]) => {
      const next = addClips(
        reelRef.current,
        files.map((file) => createClip(file, URL.createObjectURL(file)))
      )
      commit(next)
      next.clips.slice(next.clips.length - files.length).forEach((clip) => {
        void probeAudioTracks(clip.file).then(({ trackCount, levels }) => {
          // Still the same clip? (It may have been removed, or the reel started over.)
          const current = reelRef.current.clips.find((item) => item.id === clip.id)
          if (current?.file !== clip.file) return
          patch(clip.id, { audioLevels: levels, audioTrackCount: trackCount, audioProbeDone: true })
        })
      })
    },
    [commit, patch]
  )

  const reportMetadata = useCallback(
    (id: number, metadata: VideoMetadata) => {
      const clip = reelRef.current.clips.find((item) => item.id === id)
      if (clip) patch(id, applyMetadata(clip, metadata))
    },
    [patch]
  )

  const actions: ReelActions = {
    addFiles,
    remove: useCallback((id) => commit(removeClip(reelRef.current, id)), [commit]),
    move: useCallback((id, direction) => commit(moveClip(reelRef.current, id, direction)), [commit]),
    select: useCallback((id) => commit(selectClip(reelRef.current, id)), [commit]),
    patch,
    reportMetadata,
    setMusicFile: useCallback((file) => commit(setMusic(reelRef.current, file)), [commit]),
    setMuteOriginal: useCallback((mute) => commit(setMuteOriginal(reelRef.current, mute)), [commit]),
    startOver: useCallback(() => commit(clearReel(reelRef.current)), [commit])
  }
  return [reel, actions]
}
