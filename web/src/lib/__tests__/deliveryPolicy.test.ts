import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldAutoDeliver } from '../deliveryPolicy.ts'

test('desktop saves automatically when the export finishes', () => {
  assert.equal(shouldAutoDeliver('desktop'), true)
})

test('phones wait for a tap because share and download need a user gesture', () => {
  assert.equal(shouldAutoDeliver('mobile'), false)
})
