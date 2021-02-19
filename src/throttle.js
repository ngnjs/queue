import Reference from '@ngnjs/plugin'

const NGN = new Reference()
NGN.requires('EventEmitter')
const { EventEmitter } = NGN

/**
 * Limit parallel task executions to a threshold
 * (e.g. no more than 10 at a time). This throttles
 * executions to avoid overloading the processor.
 */
export default class Throttle extends EventEmitter {
  #max
  #queue
  #active = 0

  constructor (max, tasks) {
    super()
    this.#max = max
    this.#queue = tasks
  }

  get activeProcessingCount () {
    return this.#active
  }

  run () {
    if (this.#queue.length === 0) {
      this.emit('done')
      return
    }

    this.afterOnce('task.done', this.#queue.length, () => this.emit('done'))

    const remaining = this.#queue.slice()
    const next = t => {
      t.on('done', () => {
        this.emit('task.done', t)
        if (remaining.length > 0) {
          const nextTask = remaining.shift()
          next(nextTask)
        }
      })
      t.run()
    }

    const original = remaining.splice(0, this.#max)
    for (const task of original) {
      next(task)
    }
  }
}
