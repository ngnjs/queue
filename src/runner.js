import Reference from '@ngnjs/plugin'
import Processor from './queue.js'
import Item from './item.js'
import RateLimiter from './ratelimiter.js'
import Throttle from './throttle.js'

const NGN = new Reference().requires('EventEmitter', 'Middleware', 'WARN', 'INFO', 'ERROR')
const { WARN, ERROR, EventEmitter, Middleware } = NGN

export default class Queue extends EventEmitter {
  #queue
  #processing = false
  #cancelled = false
  #status = 'pending'
  #timer
  #timeout = 0
  #ratelimit = null
  #maxconcurrent
  #progress = { completed: 0, total: 0 }

  constructor (cfg = {}) {
    super(...arguments)

    if (cfg.rateLimit) {
      this.rate = cfg.rateLimit
    }

    if (cfg.maxConcurrent) {
      this.maxConcurrent = cfg.maxConcurrent
    }

    // Create a task queue
    this.#queue = new Processor({
      name: this.name,
      description: `The processor/runner for the the ${this.name} queue.`,
      parent: this
    })

    this.#queue.relay('*', this)
    this.#queue.on('task.abort', task => this.abort(false, task))

    /**
     * @cfg {number} [timeout=0]
     * The number of milliseconds before the processor auto-aborts.
     * This must be a positive/non-zero integer.
     */
    // Set a timer if configured for global timeout
    this.timeout = cfg.timeout

    Object.defineProperties(this, {
      _status: NGN.set(value => {
        if (this.#status !== value) {
          const old = this.#status
          this.#status = value
          this.emit('status.change', { old, current: value })
        }
      }),
      continue: NGN.get(() => this.#status !== 'aborting' && this.#status !== 'cancelled')
    })

    this.on('end', () => this.reset())

    // Add the cancel alias.
    this.alias('cancel', this.abort)

    // Register with the NGN ledger
    this.register('QueueProcessor')
  }

  set timeout (value = null) {
    clearTimeout(this.#timer)
    if (value && typeof value === 'number' && value > 0) {
      this.#timeout = value
      this.#timer = setTimeout(() => this.emit('timeout'), this.#timeout)
    }
  }

  get size () {
    return this.#queue.size
  }

  /**
   * @property {Array} list
   * A list of tasks within the collection. This is an array of
   * objects, where each object contains the `id`, `name`, and
   * `status` of the task.
   *
   * ```js
   * {
   *   id: <Number>,
   *   name: <String>,
   *   status: <String>
   * }
   * ```
   */
  get list () {
    return this.#queue.items.map((s, i) => {
      return {
        number: s.number > 0 ? s.number : i,
        name: s.name,
        status: s.status
      }
    })
  }

  get cancelled () {
    return this.#cancelled
  }

  get status () {
    return this.#status
  }

  /**
   * Rate limiting restricts the maximum number of tasks
   * which run within the specified duration. For example,
   * a max of 100 tasks per 60 seconds (60K milliseconds)
   * will will take 10 minutes to process 1000 tasks
   * (1000 tasks/100 tasks/minute = 10 minutes).
   * @param {numeric} max
   * @param {numeric} duration
   */
  rateLimit (max, duration) {
    if (isNaN(max) || max <= 0) {
      this.#ratelimit = null
      return
    }

    if (isNaN(max) || isNaN(duration)) {
      throw new Error('rate limiting requires a count and duration (milliseconds)')
    }

    this.#ratelimit = [max, duration]
  }

  /**
   * Remove rate limiting (if set).
   */
  removeRateLimit () {
    this.#ratelimit = null
  }

  /**
   * @param {Array} rate
   * A shortcut attribute for setting the rate limit.
   * This must be a 2 element array (ex: `[100, 60000]`)
   * or `null` (to remove rate).
   */
  set rate (value) {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new Error('rate attribute only accepts an array with 2 numeric elements')
    }

    this.rateLimit(...value)
  }

  get rate () {
    return this.#ratelimit
  }

  /**
   * @param {numeric} maxConcurrent
   * The maximum concurrent number of tasks allowed to
   * operate at the same time. Set this to `null` or any
   * value `<= 0` to remove concurrency limits.
   */
  set maxConcurrent (value) {
    if (value === null) {
      this.#maxconcurrent = null
      return
    }

    if (isNaN(value)) {
      throw new Error('maxConcurrent must be a number or null.')
    }

    if (value < 0) {
      this.#maxconcurrent = null
      return
    }

    this.#maxconcurrent = value
  }

  get maxConcurrent () {
    return this.#maxconcurrent
  }

  /**
   * @typedef plan
   * The expected operation plan.
   * @param {numeric} tasksRemaining
   * The number of tasks which still need to be processed
   * @param {numeric} tasksCompleted
   * The number of tasks which have been completed
   * @param {numeric} minimumDuration
   * The minimum duration (in milliseconds) the queue will take to complete.
   * This is calculated using the rate limit.
   */

  /**
   * @param {object} plan
   * Returns a plan object.
   */
  get plan () {
    if (this.#progress.total === 0 && this.#queue.items.length > 0) {
      this.#progress.total = this.#queue.items.length
    }

    const plan = {
      tasksRemaining: this.#progress.total - this.#progress.completed,
      tasksCompleted: this.#progress.completed
    }

    if (Array.isArray(this.#ratelimit)) {
      plan.minimumDuration = (this.#progress.total / this.#ratelimit[0]) * this.#ratelimit[1]
    } else {
      plan.minimumDuration = null
    }

    return Object.freeze(plan)
  }

  reset () {
    this.#queue.afterOnce('reset', this.#queue.size, () => {
      this.#cancelled = false
      this._status = 'pending'
      clearTimeout(this.#timer)
      this.emit('reset')
    })

    this.#queue.reset()
  }

  /**
   * @method add
   * Add a task to the list.
   * @param {string} [name]
   * A descriptive name for the queued process/task.
   * @param {function} handler
   * The function to call to handle the queue item.
   * @param {function} callback.next
   * This argument allows users to explicitly use asynchronous
   * methods. Example:
   *
   * ```
   * let tasks = new Queue()
   *
   * tasks.add('Descriptive Title', function (next) {
   *   myAsyncMethod(function () {
   *     console.log('Ran something async.')
   *     next()
   *   })
   * })
   * @returns {Task}
   * Returns the task object added to the queue.
   */
  add (name, handler) {
    if (typeof name === 'function') {
      handler = name
      name = null
    }

    name = name || `Task #${this.#queue.size + 1}`

    let count = 0
    const items = new Set(this.#queue.itemNames)
    while (items.has(name)) {
      count++
      name = `${name} (${count})`
    }

    if (typeof handler !== 'function') {
      throw new TypeError(`No function was defined for ${name}.`)
    }

    if (this.#processing) {
      WARN(`"${name}" was added to "${this.name}" (Queue) during execution. This step is not guaranteed to run during the current execution.`)
    }

    const task = new Item({ name, handler, number: this.size + 1 })

    // Add the task to the queue
    // Do not relay tasks from the task to the queue.
    // All task events are auto-relayed to the runner.
    // See the constructor of this class for the relay method.
    this.#queue.add(task)
    this.emit('task.created', task)

    return task
  }

  /**
   * @method getTaskByIndex
   * Retrieve a task by it's index number.
   * @param  {number} index
   * Retrieve a queue item by it's index/queue number.
   * @return {Task}
   */
  getTaskByIndex (index) {
    return this.#queue.items[index] || null
  }

  /**
   * @method get
   * Retrieve a specific queue item by name.
   * @param  {string} requestedTaskTitle
   * The descriptive name of the queue item to retrieve.
   * @return {Task}
   * Returns the task or `null` if the task cannot be found.
   */
  getTaskByName (name) {
    const index = this.#queue.itemNames.indexOf(name)
    return index < 0 ? null : this.#queue.items[index]
  }

  /**
   * @method remove
   * Remove a queue item by name, index number, Task, or Task.OID.
   * @param  {string|number|Task|Symbol} item
   * The descriptive name of the queue item to retrieve.
   * @return {Task}
   * Returns the item that was removed or `null` if no item was found.
   */
  remove (task) {
    // Ignore removal when nothing is specified.
    if (arguments.length === 0) {
      return null
    }

    if (typeof task === 'number') {
      const i = task
      task = this.getTaskByIndex(task)
      if (!task) {
        ERROR('QUEUE.ITEM.REMOVE', `"${this.name}" queue does not have an item at index ${i}`)
        return null
      }
    } else if (typeof task === 'string') {
      task = this.getTaskByName(task)
      if (!task) {
        ERROR('QUEUE.ITEM.REMOVE', `"${this.name}" queue does not have an item named "${task.name}"`)
        return null
      }
    }

    if (task instanceof Item) {
      if (this.#processing) {
        WARN('QUEUE.ITEM.REMOVE', `An attempt to remove "${task.name}" from the "${this.name}" queue happened during execution. The item may not be removed from the queue until processing is complete.`)
      }

      this.#queue.remove(task)
      return task
    } else {
      throw new Error(`Cannot remove ${task} from "${this.name}" queue.`)
    }
  }

  /**
   * @method run
   * Run the queued processes. By default, this runs all
   * events simultaneously (in parallel).
   * @param {boolean} [sequential=false]
   * Set to `true` to run the queue items in a sequence.
   * This will execute each method, one after the other.
   * Each method must complete before the next is started.
   */
  run (sequential = false) {
    this.#cancelled = false
    this._status = 'pending'

    if (this.#processing) {
      const message = `Cannot start processing of "${this.name}" queue (already running). Please wait for this process to complete before calling run() again.`
      WARN(message)
      this.emit('warning', message)
      return
    }

    this.#progress = { completed: 0, total: 0 }

    // Immediately "complete" when the queue is empty.
    if (this.#queue.size === 0) {
      this._status = 'pending'
      this.emit('end')
      return
    }

    // Update the status
    this.#processing = true
    this.#progress.total = this.#queue.items.length
    this.#progress.completed = 0
    this._status = 'running'

    // Add a timer
    let activeItem
    if (this.#timeout > 0) {
      this.#timer = setTimeout(() => this.abort(true, activeItem), this.#timeout)
    }

    const isConcurrencyLimited = !isNaN(this.#maxconcurrent) && this.#maxconcurrent > 0
    const isRateLimited = this.#ratelimit !== null
    const isLimited = isConcurrencyLimited || isRateLimited

    if (isLimited) {
      if (isRateLimited) {
        const limiter = new RateLimiter(...this.#ratelimit, this.#queue.items)

        if (isConcurrencyLimited) {
          limiter.maxConcurrent = this.#maxconcurrent
        }

        limiter.on('activetask', item => { activeItem = item })
        limiter.on('task.done', task => { this.#progress.completed += 1 })
        limiter.relay('batch.*', this, 'limited')
        limiter.on('done', () => this.emit('end'))

        ;(async () => {
          await limiter.run(sequential)
        })()

        return
      } else if (!sequential) {
        const limiter = new Throttle(this.#maxconcurrent, this.#queue.items)
        limiter.on('task.done', task => { this.#progress.completed += 1 })
        limiter.on('done', () => this.emit('end'))
        limiter.run()
        return
      }
    }

    if (!sequential) {
      this.afterOnce('task.done', this.size, 'end')

      // Run in parallel
      // const TOKEN = Symbol('queue runner')
      for (const task of this.#queue.items) {
        task.once('done', () => { this.#progress.completed += 1 })
        task.run()
      }
    } else {
      // Run sequentially.
      const process = new Middleware()
      for (const task of this.#queue.items) {
        process.use(next => {
          activeItem = task
          task.once('done', () => {
            this.#progress.completed += 1
            next()
          })
          task.run()
        })
      }

      process.run(() => this.emit('end'))
    }
  }

  /**
   * @method runSync
   * A shorthand method for running the queue processor sequentially.
   */
  runSync () {
    this.run(true)
  }

  abort (timeout = false, task) {
    if (!this.#cancelled) {
      this.#cancelled = true
      clearTimeout(this.#timer)
      this._status = timeout ? 'timeout' : 'aborting'
      this.emit(timeout ? 'timeout' : 'abort', task)
    }
  }
}
