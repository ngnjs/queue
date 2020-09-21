import Reference from '@ngnjs/plugin'
import Processor from './queue.js'
import Item from './item.js'

const NGN = new Reference().requires('EventEmitter', 'Middleware', 'WARN', 'INFO', 'ERROR')
const { WARN, ERROR, EventEmitter, Middleware } = NGN

export default class Queue extends EventEmitter {
  #queue
  #processing = false
  #cancelled = false
  #status = 'pending'
  #timer
  #timeout = 0

  constructor (cfg = {}) {
    super(...arguments)

    // Create a task queue
    this.#queue = new Processor({
      name: this.name,
      description: `The processor/runner for the the ${this.name} queue.`,
      parent: this
    })

    this.#queue.relay('*', this)

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
      continue: NGN.get(() => this.#status === 'aborting'),
      moduleVersion: NGN.hiddenconstant('<#REPLACE_VERSION#>')
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

    // Immediately "complete" when the queue is empty.
    if (this.#queue.size === 0) {
      this._status = 'pending'
      this.emit('end')
      return
    }

    // Update the status
    this.#processing = true
    this._status = 'running'

    // Add a timer
    let activeItem
    if (this.#timeout > 0) {
      this.#timer = setTimeout(() => this.abort(true, activeItem), this.#timeout)
    }

    if (!sequential) {
      this.afterOnce('task.done', this.size, 'end')

      // Run in parallel
      // const TOKEN = Symbol('queue runner')
      for (const task of this.#queue.items) {
        task.run()
      }
    } else {
      // Run sequentially.
      const process = new Middleware()
      for (const task of this.#queue.items) {
        process.use(next => {
          activeItem = task
          task.once('done', next)
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
      this.emit(timeout ? 'timeout' : 'aborted', task)
    }
  }
}
