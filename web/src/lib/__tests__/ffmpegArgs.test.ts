import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLevelProbeArgs, buildTrimArgs } from '../ffmpegArgs.ts'

test('builds the frame-accurate H.264/AAC trim command', () => {
  const args = buildTrimArgs({ inputPath: '/in/input', outputPath: 'out.mp4', start: 12.5, end: 20 })
  assert.deepEqual(args, [
    '-ss', '12.500',
    '-i', '/in/input',
    '-t', '7.500',
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    'out.mp4'
  ])
})

test('maps audio as optional so silent files still export, without mutating input', () => {
  const opts = Object.freeze({ inputPath: '/in/input', outputPath: 'out.mp4', start: 1, end: 3 })
  const args = buildTrimArgs(opts)
  assert.ok(args.includes('0:a:0?'))
  assert.deepEqual(opts, { inputPath: '/in/input', outputPath: 'out.mp4', start: 1, end: 3 })
})

test('maps the requested audio track, still optional', () => {
  const args = buildTrimArgs({ inputPath: '/in/input', outputPath: 'out.mp4', start: 0, end: 5, audioTrackIndex: 2 })
  assert.ok(args.includes('0:a:2?'))
  assert.ok(!args.includes('0:a:0?'))
})

test('builds the per-track level probe command', () => {
  assert.deepEqual(buildLevelProbeArgs({ inputPath: '/in/input', trackIndex: 1, outputPath: 'level.pcm' }), [
    '-i', '/in/input',
    '-map', '0:a:1',
    '-vn',
    '-ac', '1',
    '-ar', '8000',
    '-t', '120',
    '-f', 's16le',
    'level.pcm'
  ])
})
