import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkFileSize, detectPlatform, SOFT_LIMIT_BYTES } from '../sizeLimit.ts'
import type { Platform } from '../sizeLimit.ts'

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

test('a file exactly at the limit is ok', () => {
  for (const platform of ['desktop', 'mobile'] as Platform[]) {
    assert.equal(checkFileSize(SOFT_LIMIT_BYTES[platform], platform), 'ok')
  }
})

test('a file one byte over the limit warns', () => {
  for (const platform of ['desktop', 'mobile'] as Platform[]) {
    assert.equal(checkFileSize(SOFT_LIMIT_BYTES[platform] + 1, platform), 'warn')
  }
})

test('the mobile limit is lower than the desktop limit', () => {
  assert.ok(SOFT_LIMIT_BYTES.mobile < SOFT_LIMIT_BYTES.desktop)
})

test('detects iPhone and Android as mobile', () => {
  assert.equal(detectPlatform(IPHONE_UA, 5), 'mobile')
  assert.equal(detectPlatform(ANDROID_UA, 5), 'mobile')
})

test('detects an iPad reporting a Macintosh user agent as mobile', () => {
  assert.equal(detectPlatform(MAC_UA, 5), 'mobile')
})

test('detects a Mac without touch and Windows Chrome as desktop', () => {
  assert.equal(detectPlatform(MAC_UA, 0), 'desktop')
  assert.equal(detectPlatform(WINDOWS_UA, 0), 'desktop')
})
