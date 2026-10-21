export interface AbortableTask<T> {
  /** Puts a task on the shared queue (runExclusive). */
  readonly enqueue: (task: () => Promise<T>) => Promise<T>
  readonly task: () => Promise<T>
  readonly signal?: AbortSignal
  /** Stops the engine; only called when this task is the one running. */
  readonly terminate: () => void
  readonly cancelled: () => Error
}

/**
 * Runs a task on a shared queue so that cancelling it never harms other work: a task still
 * waiting just gives up (it rejects at once and never starts), and only a task that is running
 * terminates the engine, which ends it.
 */
export function runAbortable<T>({ enqueue, task, signal, terminate, cancelled }: AbortableTask<T>): Promise<T> {
  if (signal?.aborted) return Promise.reject(cancelled())
  let started = false
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      if (started) terminate()
      reject(cancelled())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    enqueue(async () => {
      if (signal?.aborted) throw cancelled()
      started = true
      return task()
    })
      .then(resolve, (error: unknown) => reject(signal?.aborted ? cancelled() : error))
      .finally(() => signal?.removeEventListener('abort', onAbort))
  })
}
