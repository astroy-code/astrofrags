import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeFixtures } from './fixtures/make-fixtures.mjs'

export default function globalSetup() {
  makeFixtures(join(dirname(fileURLToPath(import.meta.url)), '.fixtures'))
}
