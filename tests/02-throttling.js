import test from 'tappedout'
import NGN from 'ngn'
import Queue from '@ngnjs/queue'
import Reference from '@ngnjs/plugin'

const PERFORMANCE = async () => {
  return globalThis.process !== undefined
    ? (await import('perf_hooks')).performance
    : globalThis.performance
}

test('Rate limiting (parallel processing)', async t => {
  t.timeoutAfter(4000)

  const duration = 300

  const tasks = new Queue({
    rateLimit: [80, duration]
  })

  for (let i = 0; i < 800; i++) {
    tasks.add(next => next())
  }

  t.expect(0, tasks.plan.tasksCompleted, 'Plan contains proper number of completed tasks.')
  t.expect(800, tasks.plan.tasksRemaining, 'Plan contains proper number of remaining tasks.')
  t.expect(3000, tasks.plan.minimumDuration, 'Rate limit minimum duration identified.')

  let count = 0

  tasks.on('limited.batch.end', data => {
    count++
    t.ok(data.duration >= duration, `Batch ${count} executed within the rate limits.`)
  })

  tasks.once('end', () => {
    const end = performance.now()
    t.ok((end - start) >= 3000, 'Total duration meets minimum timeframe.')
    t.expect(800, tasks.plan.tasksCompleted, 'All tasks completed')
    t.expect(0, tasks.plan.tasksRemaining, 'No tasks remaining')
    t.expect(10, count, 'Completed processing with the appropriate number of limited task batches.')
    t.end()
  })

  const performance = await PERFORMANCE()
  const start = performance.now()

  tasks.run()
})

test('Rate limiting (sequential processing)', async t => {
  t.timeoutAfter(4000)

  const duration = 300

  const tasks = new Queue({
    rateLimit: [5, duration]
  })

  for (let i = 0; i < 50; i++) {
    tasks.add(next => next())
  }

  t.expect(0, tasks.plan.tasksCompleted, 'Sequential rate limiting plan contains proper number of completed tasks.')
  t.expect(50, tasks.plan.tasksRemaining, 'Sequential rate limiting plan contains proper number of remaining tasks.')
  t.expect(3000, tasks.plan.minimumDuration, 'Sequential rate limit minimum duration identified.')

  let count = 0

  tasks.on('limited.batch.end', data => {
    count++
    t.ok(data.duration >= duration, `Sequential batch ${count} executed within the rate limits.`)
  })

  tasks.once('end', () => {
    const end = performance.now()
    t.ok((end - start) >= 3000, 'Total duration meets minimum timeframe.')
    t.expect(50, tasks.plan.tasksCompleted, 'All tasks completed')
    t.expect(0, tasks.plan.tasksRemaining, 'No tasks remaining')
    t.expect(10, count, 'Completed processing with the appropriate number of limited task batches.')
    t.end()
  })

  const performance = await PERFORMANCE()
  const start = performance.now()
  tasks.run(true)
})

test('Throttling (parallel processing)', async t => {
  t.timeoutAfter(4000)

  const tasks = new Queue({ maxConcurrent: 30 })

  for (let i = 0; i < 100; i++) {
    tasks.add(next => setTimeout(() => next(), 100))
  }

  t.expect(0, tasks.plan.tasksCompleted, 'Max concurrency plan contains proper number of completed tasks.')
  t.expect(100, tasks.plan.tasksRemaining, 'Max concurrency plan contains proper number of remaining tasks.')
  t.expect(null, tasks.plan.minimumDuration, 'Rate limit minimum duration not identified for max concurrency limits.')

  const performance = await PERFORMANCE()
  const start = performance.now()

  tasks.once('end', () => {
    t.ok(performance.now() - start > 400, 'Throttled queue runs over a longer period of time than it would if all tasks were run simultaneously.')
    t.expect(0, tasks.plan.tasksRemaining, 'All tasks completed using max concurrency.')
    t.end()
  })

  tasks.run()
})