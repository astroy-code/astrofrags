import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_BRANDING_SETTINGS,
  lowerThirdLabel,
  parseBrandingSettings,
  serializeBrandingSettings
} from '../brandingSettings.ts'
import type { BrandingSettings } from '../brandingSettings.ts'

const CUSTOM: BrandingSettings = {
  displayName: 'Rey',
  accentColor: '#112233',
  introEnabled: true,
  outroEnabled: true,
  cardDurationSeconds: 5,
  lowerThirdEnabled: true,
  lowerThirdText: 'Ace on Bank',
  watermarkCorner: 'top-left'
}

test('defaults match the desktop app', () => {
  assert.deepEqual(DEFAULT_BRANDING_SETTINGS, {
    displayName: 'Astroy',
    accentColor: '#1a1a2e',
    introEnabled: false,
    outroEnabled: false,
    cardDurationSeconds: 3,
    lowerThirdEnabled: false,
    lowerThirdText: '',
    watermarkCorner: 'bottom-right'
  })
})

test('null and empty strings give defaults', () => {
  assert.deepEqual(parseBrandingSettings(null), DEFAULT_BRANDING_SETTINGS)
  assert.deepEqual(parseBrandingSettings(''), DEFAULT_BRANDING_SETTINGS)
})

test('valid stored settings round-trip through serialize and parse', () => {
  assert.deepEqual(parseBrandingSettings(serializeBrandingSettings(CUSTOM)), CUSTOM)
})

test('corrupt JSON gives defaults', () => {
  for (const raw of ['{not json', 'null', '[]', '42', '"text"', 'true']) {
    assert.deepEqual(parseBrandingSettings(raw), DEFAULT_BRANDING_SETTINGS, raw)
  }
})

test('each invalid field falls back alone', () => {
  const bad: Record<string, unknown> = {
    displayName: 42,
    accentColor: 'red',
    introEnabled: 'yes',
    outroEnabled: 1,
    cardDurationSeconds: '5',
    lowerThirdEnabled: null,
    lowerThirdText: {},
    watermarkCorner: 'middle'
  }
  for (const [field, value] of Object.entries(bad)) {
    const parsed = parseBrandingSettings(JSON.stringify({ ...CUSTOM, [field]: value }))
    const key = field as keyof BrandingSettings
    assert.equal(parsed[key], DEFAULT_BRANDING_SETTINGS[key], `${field} should fall back`)
    for (const other of Object.keys(CUSTOM) as Array<keyof BrandingSettings>) {
      if (other !== key) assert.equal(parsed[other], CUSTOM[other], `${other} should be kept`)
    }
  }
})

test('accent colour must be #rrggbb', () => {
  for (const color of ['red', '#fff', '#gggggg', '1a1a2e', '#1a1a2e00']) {
    const parsed = parseBrandingSettings(JSON.stringify({ accentColor: color }))
    assert.equal(parsed.accentColor, DEFAULT_BRANDING_SETTINGS.accentColor, color)
  }
  assert.equal(parseBrandingSettings(JSON.stringify({ accentColor: '#ABCDEF' })).accentColor, '#abcdef')
})

test('card duration is clamped to 1..10 and non-numbers fall back', () => {
  const duration = (value: unknown): number =>
    parseBrandingSettings(JSON.stringify({ cardDurationSeconds: value })).cardDurationSeconds
  assert.equal(duration(0), 1)
  assert.equal(duration(-4), 1)
  assert.equal(duration(99), 10)
  assert.equal(duration(2.5), 2.5)
  assert.equal(duration('7'), 3)
  assert.equal(duration(null), 3)
})

test('corner must be one of the four', () => {
  for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    assert.equal(parseBrandingSettings(JSON.stringify({ watermarkCorner: corner })).watermarkCorner, corner)
  }
  assert.equal(parseBrandingSettings(JSON.stringify({ watermarkCorner: 'center' })).watermarkCorner, 'bottom-right')
})

test('strings are trimmed, newlines collapse to spaces, and length is capped', () => {
  const parsed = parseBrandingSettings(
    JSON.stringify({ displayName: '  Line one\n\nLine\ttwo  ', lowerThirdText: 'x'.repeat(10_000) })
  )
  assert.equal(parsed.displayName, 'Line one Line two')
  assert.equal(parsed.lowerThirdText.length, 120)
  const longName = parseBrandingSettings(JSON.stringify({ displayName: 'n'.repeat(10_000) })).displayName
  assert.equal(longName.length, 60)
})

test('unknown keys are dropped', () => {
  const parsed = parseBrandingSettings(JSON.stringify({ ...CUSTOM, evil: '<script>', __proto__: { x: 1 } }))
  assert.deepEqual(Object.keys(parsed).sort(), Object.keys(CUSTOM).sort())
})

test('lowerThirdLabel falls back to the display name when text is empty', () => {
  assert.equal(lowerThirdLabel({ ...CUSTOM, lowerThirdText: '' }), 'Rey')
  assert.equal(lowerThirdLabel({ ...CUSTOM, lowerThirdText: 'Ace on Bank' }), 'Ace on Bank')
})
