import Reference from '@ngnjs/plugin'
import Throttle from './throttle.js'

const NGN = new Reference()
NGN.requires('EventEmitter', 'Middleware')
const { EventEmitter, Middleware } = NGN

const PERFORMANCE = async () => {
  return globalThis.process !== undefined
    ? (await import('perf_hooks')).performance
    : globalThis.performance
}

export default class RateLimiter extends EventEmitter {
  #max
  #duration
  #queue
  #maxconcurrent

  #runBatch = async (batch, sequential) => {
    return new Promise(resolve => {
      if (!sequential) {
        if (!isNaN(this.#maxconcurrent) && this.#maxconcurrent > 0) {
          const limiter = new Throttle(this.#maxconcurrent, batch)
          limiter.on('end', resolve)
          limiter.run()
          return
        }

        this.afterOnce('task.done', batch.length, resolve)

        // Parallel processing
        for (const task of batch) {
          task.once('done', () => this.emit('task.done', task))
          task.run()
        }
      } else {
        // Sequential processing
        const process = new Middleware()
        for (const task of batch) {
          process.use(next => {
            this.emit('activetask', task)
            task.once('done', () => {
              this.emit('task.done', task)
              next()
            })
            task.run()
          })
        }

        process.run(resolve)
      }
    })
  }

  constructor (max, duration, tasks) {
    super()
    this.#max = max
    this.#duration = duration
    this.#queue = tasks
  }

  set maxConcurrent (value) {
    this.#maxconcurrent = value
  }

  get maxConcurrent () {
    return this.#maxconcurrent
  }

  async run (sequential = false) {
    if (this.#queue.length === 0) {
      return this.emit('done')
    }

    const performance = await PERFORMANCE()

    // Batch the queue tasks
    const batch = []
    while (this.#queue.length > 0) {
      batch.push(this.#queue.splice(0, this.#max))
    }

    // Begin processing
    const process = new Middleware()
    while (batch.length > 0) {
      const tasks = batch.shift()

      process.use(async next => {
        const start = performance.now()

        this.emit('batch.start', {
          id: batch.length + 1,
          start,
          tasks: tasks.length
        })

        await this.#runBatch(tasks, sequential)

        let mark = performance.now()
        const data = { endProcessing: mark }

        while ((mark - start) < this.#duration) {
          mark = performance.now()
        }

        this.emit('batch.end', Object.assign(data, {
          id: batch.length + 1,
          start,
          end: mark,
          duration: Math.ceil(mark - start),
          processingTime: data.endProcessing - start,
          tasks: tasks.length
        }))

        next()
      })
    }

    process.run(() => this.emit('done'))
  }
}
