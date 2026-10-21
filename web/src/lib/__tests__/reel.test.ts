import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addClips,
  clearReel,
  clipFromRange,
  clipsOfFile,
  createClip,
  emptyReel,
  insertClipsAfter,
  momentBlockers,
  moveClip,
  removeClip,
  replaceClip,
  selectClip,
  selectedClip,
  setMusic,
  setMuteOriginal,
  updateClip
} from '../reel.ts'
import type { Reel } from '../reel.ts'

const file = (name: string): File => new File(['x'], name, { type: 'video/mp4' })
const item = (name: string) => createClip(file(name), `blob:${name}`)
const names = (reel: Reel): string[] => reel.clips.map((clip) => clip.file.name)

/** Freezes a reel deeply enough that any in-place change throws. */
function frozen(reel: Reel): Reel {
  Object.freeze(reel.clips.map((clip) => Object.freeze(clip)))
  return Object.freeze({ ...reel, clips: Object.freeze([...reel.clips]) })
}

const three = (): Reel => addClips(emptyReel(), [item('a'), item('b'), item('c')])

test('a new clip starts unprobed with an empty range', () => {
  const clip = item('a')
  assert.equal(clip.audioProbeDone, false)
  assert.equal(clip.audioTrackCount, null)
  assert.deepEqual(clip.range, { start: 0, end: 0 })
  assert.deepEqual(clip.videoSize, { width: 0, height: 0 })
})

test('adding clips gives unique ids, keeps order and selects the first one', () => {
  const reel = three()
  assert.deepEqual(names(reel), ['a', 'b', 'c'])
  assert.equal(new Set(reel.clips.map((clip) => clip.id)).size, 3)
  assert.equal(reel.selectedId, reel.clips[0].id)
})

test('adding more clips keeps the current selection', () => {
  const reel = selectClip(three(), 2)
  const more = addClips(reel, [item('d')])
  assert.equal(more.selectedId, 2)
  assert.deepEqual(names(more), ['a', 'b', 'c', 'd'])
})

test('the same file twice makes two items', () => {
  const same = file('a')
  const reel = addClips(emptyReel(), [createClip(same, 'blob:1'), createClip(same, 'blob:2')])
  assert.equal(reel.clips.length, 2)
  assert.notEqual(reel.clips[0].id, reel.clips[1].id)
})

test('ids are never reused after a removal', () => {
  const reel = addClips(removeClip(three(), 2), [item('d')])
  assert.equal(new Set(reel.clips.map((clip) => clip.id)).size, 3)
  assert.ok(!reel.clips.slice(0, 2).some((clip) => clip.id === reel.clips[2].id))
})

test('removing the selected middle clip selects the one that moves into its place', () => {
  const reel = removeClip(selectClip(three(), 2), 2)
  assert.deepEqual(names(reel), ['a', 'c'])
  assert.equal(selectedClip(reel)?.file.name, 'c')
})

test('removing the selected last clip selects the one before it', () => {
  const reel = removeClip(selectClip(three(), 3), 3)
  assert.equal(selectedClip(reel)?.file.name, 'b')
})

test('removing the only clip leaves an empty reel with nothing selected', () => {
  const reel = removeClip(addClips(emptyReel(), [item('a')]), 1)
  assert.deepEqual(reel.clips, [])
  assert.equal(reel.selectedId, null)
})

test('removing an unselected clip keeps the selection; an unknown id changes nothing', () => {
  const reel = removeClip(three(), 3)
  assert.equal(reel.selectedId, 1)
  assert.equal(removeClip(reel, 99), reel)
})

test('moving up and down reorders, and does nothing at the ends', () => {
  const reel = three()
  assert.deepEqual(names(moveClip(reel, 2, 'up')), ['b', 'a', 'c'])
  assert.deepEqual(names(moveClip(reel, 2, 'down')), ['a', 'c', 'b'])
  assert.equal(moveClip(reel, 1, 'up'), reel)
  assert.equal(moveClip(reel, 3, 'down'), reel)
  assert.equal(moveClip(reel, 99, 'up'), reel)
})

test('moving a clip keeps the selection on the same clip', () => {
  const moved = moveClip(selectClip(three(), 2), 2, 'down')
  assert.equal(selectedClip(moved)?.file.name, 'b')
})

test('updating a clip changes only that clip; a removed id is a no-op', () => {
  const reel = three()
  const updated = updateClip(reel, 2, { duration: 12, audioProbeDone: true })
  assert.equal(updated.clips[1].duration, 12)
  assert.equal(updated.clips[0].duration, 0)
  const gone = removeClip(updated, 2)
  assert.equal(updateClip(gone, 2, { duration: 99 }), gone)
})

test('selecting an unknown id changes nothing', () => {
  const reel = three()
  assert.equal(selectClip(reel, 99), reel)
})

test('music is set and cleared', () => {
  const song = file('song.mp3')
  assert.equal(setMusic(three(), song).musicFile, song)
  assert.equal(setMusic(setMusic(three(), song), null).musicFile, null)
})

test('no reel function mutates its input', () => {
  const reel = frozen(three())
  assert.doesNotThrow(() => {
    addClips(reel, [item('d')])
    removeClip(reel, 2)
    moveClip(reel, 2, 'up')
    updateClip(reel, 1, { duration: 5 })
    selectClip(reel, 3)
    setMusic(reel, null)
  })
})

test('clearing the reel empties it but never reuses an id, so a late probe cannot hit a new clip', () => {
  const cleared = clearReel(setMusic(three(), file('song.mp3')))
  assert.deepEqual(cleared.clips, [])
  assert.equal(cleared.selectedId, null)
  assert.equal(cleared.musicFile, null)
  const again = addClips(cleared, [item('x')])
  assert.ok(again.clips[0].id > 3)
})

test('music only starts off and is switched on and off', () => {
  assert.equal(emptyReel().muteOriginal, false)
  const on = setMuteOriginal(setMusic(three(), file('song.mp3')), true)
  assert.equal(on.muteOriginal, true)
  assert.equal(setMuteOriginal(on, false).muteOriginal, false)
})

test('removing the music also switches music only off, so the next song starts ducked', () => {
  const on = setMuteOriginal(setMusic(three(), file('song.mp3')), true)
  assert.equal(setMusic(on, null).muteOriginal, false)
  assert.equal(setMusic(on, file('other.mp3')).muteOriginal, true)
})

test('music only cannot be switched on without music', () => {
  assert.equal(setMuteOriginal(three(), true).muteOriginal, false)
})

test('clearing the reel switches music only off', () => {
  const on = setMuteOriginal(setMusic(three(), file('song.mp3')), true)
  assert.equal(clearReel(on).muteOriginal, false)
})

const probed = (name: string) => ({
  ...item(name),
  duration: 120,
  range: { start: 0, end: 120 },
  audioLevels: [{ rms: 0.1, peak: 0.5 }],
  audioTrackCount: 1,
  audioProbeDone: true,
  audioTrackOverride: 0,
  videoSize: { width: 1280, height: 720 },
  highlights: [{ time: 30, score: 1 }]
})

test('a new clip has no highlights yet', () => {
  assert.equal(item('a').highlights, null)
})

test('a clip made from a range keeps the file and what is known about it', () => {
  const source = addClips(emptyReel(), [probed('rec')]).clips[0]
  const made = clipFromRange(source, 'blob:new', { start: 25, end: 33 })
  assert.equal(made.file, source.file)
  assert.equal(made.objectUrl, 'blob:new')
  assert.deepEqual(made.range, { start: 25, end: 33 })
  assert.equal(made.duration, 120)
  assert.deepEqual(made.videoSize, { width: 1280, height: 720 })
  assert.equal(made.audioProbeDone, true)
  assert.equal(made.audioTrackCount, 1)
  assert.equal(made.audioTrackOverride, 0)
  assert.deepEqual(made.audioLevels, source.audioLevels)
  // The moments stay on screen after a tap, so the next one is a tap away.
  assert.deepEqual(made.highlights, source.highlights)
  assert.equal(made.previewBroken, false)
})

test('clips are inserted right after a clip, selected first, with fresh ids', () => {
  const reel = frozen(three())
  const next = insertClipsAfter(reel, 1, [item('x'), item('y')])
  assert.deepEqual(names(next), ['a', 'x', 'y', 'b', 'c'])
  assert.equal(next.selectedId, next.clips[1].id)
  assert.equal(new Set(next.clips.map((clip) => clip.id)).size, 5)
  assert.equal(next.nextId, reel.nextId + 2)
})

test('inserting after an unknown clip, or inserting nothing, changes nothing', () => {
  const reel = three()
  assert.equal(insertClipsAfter(reel, 99, [item('x')]), reel)
  assert.equal(insertClipsAfter(reel, 1, []), reel)
})

test('replacing a clip puts the new ones at its place and selects the first', () => {
  const reel = frozen(three())
  const next = replaceClip(reel, 2, [item('x'), item('y')])
  assert.deepEqual(names(next), ['a', 'x', 'y', 'c'])
  assert.equal(next.selectedId, next.clips[1].id)
  assert.equal(next.nextId, reel.nextId + 2)
})

test('replacing an unknown clip, or replacing with nothing, changes nothing', () => {
  const reel = three()
  assert.equal(replaceClip(reel, 99, [item('x')]), reel)
  assert.equal(replaceClip(reel, 2, []), reel)
})

test('clips of a file are those that share the File, optionally except one', () => {
  const shared = file('rec')
  const reel = addClips(emptyReel(), [
    createClip(shared, 'blob:1'),
    createClip(file('other'), 'blob:2'),
    createClip(shared, 'blob:3')
  ])
  assert.deepEqual(clipsOfFile(reel, shared).map((clip) => clip.id), [1, 3])
  assert.deepEqual(clipsOfFile(reel, shared, 1).map((clip) => clip.id), [3])
})

test('a late highlights result for a removed clip is dropped', () => {
  const reel = removeClip(three(), 2)
  assert.equal(updateClip(reel, 2, { highlights: [{ time: 1, score: 1 }] }), reel)
})

test('a new clip has no loudness yet, and a clip from a range shares the recording\'s', () => {
  assert.equal(item('a').loudness, null)
  const loudness = new Float32Array([0.1, 0.5, 0.2])
  const source = addClips(emptyReel(), [{ ...probed('rec'), loudness }]).clips[0]
  assert.equal(clipFromRange(source, 'blob:new', { start: 1, end: 2 }).loudness, loudness)
})

test('a late loudness result for a removed clip is dropped', () => {
  const reel = removeClip(three(), 2)
  assert.equal(updateClip(reel, 2, { loudness: new Float32Array(1) }), reel)
})

test('the whole-recording clip does not block moments from its own file, but a moment clip blocks itself', () => {
  const shared = file('rec')
  const whole = { ...probed('rec'), file: shared }
  const moment = { ...probed('rec'), file: shared, range: { start: 5, end: 13 } }
  const reel = addClips(emptyReel(), [whole, moment])
  const [wholeClip, momentClip] = reel.clips
  assert.deepEqual(momentBlockers(reel, wholeClip).map((clip) => clip.id), [momentClip.id])
  assert.deepEqual(momentBlockers(reel, momentClip).map((clip) => clip.id), [wholeClip.id, momentClip.id])
})

test('a recording trimmed to part of itself counts as a moment, not the whole recording', () => {
  const shared = file('rec')
  const trimmed = { ...probed('rec'), file: shared, range: { start: 0, end: 60 } }
  const reel = addClips(emptyReel(), [trimmed])
  assert.deepEqual(momentBlockers(reel, reel.clips[0]).map((clip) => clip.id), [reel.clips[0].id])
})
