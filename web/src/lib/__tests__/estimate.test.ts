import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateExportSeconds } from '../estimate.ts'

const FULL_HD = { width: 1920, height: 1080 }
const base = { durationSeconds: 30, output: FULL_HD, hasCards: false, platform: 'desktop' } as const

test('longer clips take longer', () => {
  assert.ok(estimateExportSeconds({ ...base, durationSeconds: 60 }) > estimateExportSeconds(base))
})

test('bigger output takes longer', () => {
  const small = estimateExportSeconds({ ...base, output: { width: 1280, height: 720 } })
  assert.ok(estimateExportSeconds(base) > small)
})

test('cards add time', () => {
  assert.ok(estimateExportSeconds({ ...base, hasCards: true }) > estimateExportSeconds(base))
})

test('phones take longer than desktops', () => {
  assert.ok(estimateExportSeconds({ ...base, platform: 'mobile' }) > estimateExportSeconds(base))
})

test('never below 1 second and always a whole number', () => {
  const tiny = estimateExportSeconds({ ...base, durationSeconds: 0.01, output: { width: 2, height: 2 } })
  assert.ok(tiny >= 1)
  for (const durationSeconds of [0, 0.4, 7.3, 31.9]) {
    const seconds = estimateExportSeconds({ ...base, durationSeconds })
    assert.ok(Number.isInteger(seconds) && seconds >= 1, `${durationSeconds}s gave ${seconds}`)
  }
})
