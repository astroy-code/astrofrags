import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLevelProbeArgs } from '../ffmpegArgs.ts'

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
