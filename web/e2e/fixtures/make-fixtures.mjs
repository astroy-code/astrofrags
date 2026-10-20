import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ffmpegPath = require('ffmpeg-static')

// Shared with the spec through JSON because the spec is loaded as CommonJS.
export const FIXTURE_NAMES = JSON.parse(readFileSync(new URL('./names.json', import.meta.url), 'utf8'))

function ffmpeg(args) {
  execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })
}

const VIDEO_SOURCE = ['-f', 'lavfi', '-i', 'testsrc=duration=6:size=640x360:rate=30']
const AUDIO_SOURCE = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=6']
// VP9 because Playwright's bundled Chromium cannot play H.264.
const VP9 = ['-c:v', 'libvpx-vp9', '-b:v', '300k', '-deadline', 'realtime', '-cpu-used', '8']

/** Generates the E2E input clips into outDir (git-ignored scratch space). */
export function makeFixtures(outDir) {
  mkdirSync(outDir, { recursive: true })
  const clip = join(outDir, FIXTURE_NAMES.clip)

  ffmpeg([...VIDEO_SOURCE, ...AUDIO_SOURCE, ...VP9, '-c:a', 'libopus', '-shortest', clip])
  ffmpeg([...VIDEO_SOURCE, ...VP9, join(outDir, FIXTURE_NAMES.silent)])
  copyFileSync(clip, join(outDir, FIXTURE_NAMES.awkward))
  // Two audio tracks: a silent first one (like a mic-only track) and a loud second one.
  ffmpeg([
    ...VIDEO_SOURCE,
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-map', '0:v', '-map', '1:a', '-map', '2:a',
    ...VP9, '-c:a', 'libopus', '-t', '6',
    join(outDir, FIXTURE_NAMES.twoTrack)
  ])
  // An MP4 with only an audio track: metadata loads but there are no video dimensions.
  ffmpeg([...AUDIO_SOURCE, '-c:a', 'aac', join(outDir, FIXTURE_NAMES.audioOnly)])
  // Background music: a 330 Hz tone, shorter than the clips so the loop path is exercised.
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', join(outDir, FIXTURE_NAMES.music)])
  // A picture with an audio file's name: must be rejected as music.
  ffmpeg([
    '-f', 'lavfi', '-i', 'color=c=red:s=64x64',
    '-frames:v', '1', '-f', 'image2', '-c:v', 'png',
    join(outDir, FIXTURE_NAMES.notAudio)
  ])
  // A portrait phone-shaped clip with sound, to join with the landscape ones.
  ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc=duration=6:size=360x640:rate=30', ...AUDIO_SOURCE,
    ...VP9, '-c:a', 'libopus', '-shortest', join(outDir, FIXTURE_NAMES.portrait)
  ])
  // A 200 s recording (over the 3:00 Shorts cap), tiny and silent so it is cheap to make and load.
  ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc=duration=200:size=160x90:rate=5',
    ...VP9, join(outDir, FIXTURE_NAMES.long)
  ])
  // Music that adds no sound at all, so only the clips' own audio can be heard in an export.
  ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '3', join(outDir, FIXTURE_NAMES.silenceMusic)])
}
