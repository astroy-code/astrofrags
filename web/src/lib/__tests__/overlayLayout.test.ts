import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CARD_FADE_SECONDS, cardLayout, lowerThirdLayout, watermarkRect } from '../overlayLayout.ts'

const HD = { width: 1920, height: 1080 }
const LOGO = { width: 512, height: 512 }

test('card fade is half a second', () => {
  assert.equal(CARD_FADE_SECONDS, 0.5)
})

test('watermark sits in each corner at 1080p with the desktop size and margin', () => {
  assert.deepEqual(watermarkRect('bottom-right', HD, LOGO), { x: 1736, y: 896, width: 160, height: 160 })
  assert.deepEqual(watermarkRect('top-left', HD, LOGO), { x: 24, y: 24, width: 160, height: 160 })
  assert.deepEqual(watermarkRect('top-right', HD, LOGO), { x: 1736, y: 24, width: 160, height: 160 })
  assert.deepEqual(watermarkRect('bottom-left', HD, LOGO), { x: 24, y: 896, width: 160, height: 160 })
})

test('watermark scales down with the output', () => {
  const rect = watermarkRect('bottom-right', { width: 1280, height: 720 }, LOGO)
  assert.equal(rect.width, 107)
  assert.equal(rect.x, 1280 - 107 - 16)
})

test('watermark keeps a non-square logo proportional', () => {
  const rect = watermarkRect('top-left', HD, { width: 400, height: 200 })
  assert.deepEqual([rect.width, rect.height], [160, 80])
})

test('card layout matches the desktop card at 1080p', () => {
  assert.deepEqual(cardLayout(HD, LOGO), {
    logo: { x: 810, y: 310, width: 300, height: 300 },
    nameFontSize: 64,
    nameCenterX: 960,
    nameCenterY: 660
  })
})

test('card layout scales for a portrait output', () => {
  const layout = cardLayout({ width: 606, height: 1080 }, LOGO)
  assert.ok(layout.logo.width < 606, 'logo fits the narrow card')
  assert.ok(layout.nameFontSize < 64)
  assert.equal(layout.nameCenterX, 303)
})

test('lower-third layout matches the desktop numbers at 1080p', () => {
  assert.deepEqual(lowerThirdLayout(HD), {
    fontSize: 28,
    marginLeft: 40,
    marginBottom: 40,
    padding: 12,
    boxColor: 'rgba(0,0,0,0.5)',
    fontColor: '#ffffff'
  })
})
