import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildHighlightDecodeArgs, buildLevelProbeArgs } from '../ffmpegArgs.ts'

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

test('builds the highlight decode command: one track, 8 kHz mono, the whole length', () => {
  const args = buildHighlightDecodeArgs({ inputPath: '/in/input0', trackIndex: 2, outputPath: 'highlights.pcm' })
  assert.deepEqual(args, [
    '-i', '/in/input0',
    '-map', '0:a:2',
    '-vn',
    '-ac', '1',
    '-ar', '8000',
    '-f', 's16le',
    'highlights.pcm'
  ])
  assert.ok(!args.includes('-t'))
})
