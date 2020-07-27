import Reference from '@ngnjs/plugin'

const NGN = new Reference('2.0.0')

NGN.requires('EventEmitter', 'WARN', 'INFO', 'get')

const { INFO, WARN } = NGN

export default class Item extends NGN.EventEmitter {
  #method
  #status = 'pending'
  #skip = false
  #number = -1
  #timer

  #done = () => {
    clearTimeout(this.#timer)
    this.#status = 'complete'
    this.emit('complete', this)
    this.emit('done')
    INFO('QUEUE.TASK.DONE', `Finished processing ${this._dsc}.`)
  }

  constructor (cfg = {}) {
    super(...arguments)

    if (typeof cfg.handler !== 'function') {
      throw new TypeError(`"${this.name}" item expected a function to process, but received a ${typeof cfg.handler} configuration attribute.`)
    }

    /**
     * @cfg {function} handler
     * The method to execute when the task is called.
     */
    this.#method = cfg.handler

    /**
     * @cfg {number} [number=0]
     * The queue item number. This is used primarily as a _descriptive_ ID.
     */
    this.#number = cfg.number || 0

    /**
     * @cfg {number} [timeout=-1]
     * The number of milliseconds before the item times out.
     */
    if (typeof cfg.timeout === 'number') {
      this.timeout = cfg.timeout
    }
    
    Object.defineProperty(this, '_dsc', NGN.get(() => `${this.name} of ${this.parent ? this.parent.name : 'unknown'} queue`))
    
    this.on('fail', () => this.#status = 'failed')
    this.on('timeout', ms => {
      this.#status = 'timedout'
      INFO('QUEUE.TASK.TIMEOUT', `${this._dsc} timed out${ms ? ' after ' + ms + 'ms' : ''}.`)

      if (this.parent && this.parent.parent && this.parent.parent.abort) {
        this.parent.parent.abort(true, this)
      } else {
        this.#done()
      }
    })
  }

  get number () {
    return this.#number
  }

  /**
   * @property {string} status (running, complete, pending, timedout, failed)
   */
  get status () {
    return this.#status
  }

  set timeout (value) {
    this.#timer = setTimeout(() => this.emit('timeout', this), value)
  }

  /**
   * @method skip
   * Do not process this task.
   */
  skip () {
    if (this.#status === 'running') {
      WARN('QUEUE.TASK.SKIP_FAILURE', `Cannot skip ${this.name} (currently running).`)
    } else if (this.#status === 'timedout') {
      WARN('QUEUE.TASK.SKIP_FAILURE', `Cannot skip ${this.name} (timed out).`)
    } else if (this.#status === 'complete') {
      WARN('QUEUE.TASK.SKIP_FAILURE', `Cannot skip ${this.name} (already completed).`)
    }

    this.#skip = true
  }

  /**
   * @method run
   * Execute the callback function.
   * @param {string} mode
   * `dev` or `prod`. When in "dev" mode, verbose output is written
   * to the console.
   */
  run () {
    // Only process tasks which have not been processed.
    if (this.#status !== 'pending') {
      return
    }

    // If the item is part of a queue handled by a runner,
    // respect the state of the runner.
    if (this.parent && this.parent.parent) {
      if (this.parent.parent.continue) {
        return
      }
    }

    if (this.#skip) {
      this.#status = 'skipped'
      this.emit('skip', this)
      WARN('QUEUE.TASK.SKIPPED', `Skipped ${this._dsc}.`)
      return this.#done()
    }

    this.#status = 'running'
    INFO('QUEUE.TASK.START', `Started processing ${this._dsc}.`)
    this.emit('start', this)

    const me = this
    this.#method.apply({
      name: this.name,
      number: this.#number,
      get queue () { return me.parent },
      fail () { me.emit('failed', me) },
      abort () {
        me.emit('abort', me)
        if (me.parent && me.parent.parent && me.parent.parent.abort) {
          me.parent.parent.abort(me)
        } else {
          me.#done()
        }
      },
      timeout (duration = null) {
        if (duration) {
          me.timeout = duration
        } else {
          me.emit('timeout', me)
        }
      }
    }, [this.#done])

    // If the callback isn't in the arguments,
    // treat the method as a synchronous operation.
    if (this.#method.length === 0) {
      this.#done()
    }
  }

  /**
   * Reset the task to its original state
   */
  reset () {
    this.#status = 'pending'
    this.#skip = false
    this.emit('reset')
  }
}
