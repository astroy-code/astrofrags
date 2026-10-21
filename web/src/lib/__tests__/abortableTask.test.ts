import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runAbortable } from '../abortableTask.ts'

/** A serial queue like runExclusive, whose tasks can be held back by the test. */
function makeQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const next = tail.then(task, task)
    tail = next.catch(() => undefined)
    return next
  }
}

const cancelled = (): Error => new Error('cancelled')

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

test('a task that is not cancelled returns its result', async () => {
  let terminated = 0
  const result = await runAbortable({
    enqueue: makeQueue(),
    task: async () => 42,
    signal: new AbortController().signal,
    terminate: () => (terminated += 1),
    cancelled
  })
  assert.equal(result, 42)
  assert.equal(terminated, 0)
})

test('cancelling while queued rejects at once, never starts the task and never terminates the engine', async () => {
  const enqueue = makeQueue()
  const gate = deferred()
  const blocker = enqueue(() => gate.promise) // another clip's audio check holds the queue
  let ran = false
  let terminated = 0
  const controller = new AbortController()
  const pending = runAbortable({
    enqueue,
    task: async () => {
      ran = true
    },
    signal: controller.signal,
    terminate: () => (terminated += 1),
    cancelled
  })

  controller.abort()

  await assert.rejects(pending, /cancelled/)
  gate.resolve()
  await blocker
  assert.equal(ran, false)
  assert.equal(terminated, 0)
})

test('cancelling while running terminates the engine once and rejects', async () => {
  const gate = deferred()
  let terminated = 0
  const controller = new AbortController()
  const pending = runAbortable({
    enqueue: makeQueue(),
    task: () => gate.promise,
    signal: controller.signal,
    terminate: () => {
      terminated += 1
      gate.resolve() // the engine dying ends the running task
    },
    cancelled
  })
  await new Promise((resolve) => setTimeout(resolve, 5))

  controller.abort()

  await assert.rejects(pending, /cancelled/)
  assert.equal(terminated, 1)
})

test('an already cancelled request does nothing', async () => {
  const controller = new AbortController()
  controller.abort()
  let ran = false
  await assert.rejects(
    runAbortable({
      enqueue: makeQueue(),
      task: async () => {
        ran = true
      },
      signal: controller.signal,
      terminate: () => assert.fail('must not terminate'),
      cancelled
    }),
    /cancelled/
  )
  assert.equal(ran, false)
})

test('a failure that is not a cancel is passed on, and a late abort changes nothing', async () => {
  const controller = new AbortController()
  await assert.rejects(
    runAbortable({
      enqueue: makeQueue(),
      task: async () => {
        throw new Error('decode failed')
      },
      signal: controller.signal,
      terminate: () => assert.fail('must not terminate'),
      cancelled
    }),
    /decode failed/
  )
  controller.abort()
})
