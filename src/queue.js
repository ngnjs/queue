import Item from './item.js'
import Reference from '@ngnjs/plugin'

const NGN = new Reference()
NGN.requires('EventEmitter', 'UnacceptableParameterTypeError')

export default class Queue extends NGN.EventEmitter {
  #items = []

  constructor () {
    super(...arguments)
    this.register('Queue')
  }

  get items () {
    return this.#items
  }

  get itemNames () {
    return this.#items.map(i => i.name)
  }

  get size () {
    return this.#items.length
  }

  /**
   * Add items to the queue.
   * @param {Item[]|Object[]} Item
   * Any number of queue items (or queue item configurations) can be added.
   */
  add () {
    for (let item of arguments) {
      if (!this.allowParameterType(item, Item, 'object')) {
        throw new UnacceptableParameterTypeError(`"${this.name}" queue add() accepts Task parameters, not "${this.typeof(item)}".`) // eslint-disable-line no-undef
      }

      if (!(item instanceof Item)) {
        item = new Item(item)
      }

      item.parent = this

      item.relay('*', this, 'task.')

      this.#items.push(item)
    }
  }

  /**
   * Remove an queue item.
   * @param {Item[]} Item
   * Any number of queue items (or queue item indexes) can be added.
   */
  remove () {
    for (const item of arguments) {
      if (!this.allowParameterType(item, Item)) {
        throw new UnacceptableParameterTypeError(`"${this.name}" queue add() accepts Task parameters, not "${this.typeof(item)}".`) // eslint-disable-line no-undef
      }
    }

    const args = new Set([...arguments])

    this.#items = this.#items.reduce((agg, current) => {
      if (args.has(current)) {
        agg.splice(agg.indexOf(current), 1)
      }
      return agg
    }, this.#items)
  }

  /**
   * Reset all of the Item elements in the queue.
   */
  reset () {
    this.afterOnce('task.reset', this.size, () => this.emit('reset'))
    this.#items.forEach(item => item.reset())
  }

  /**
   * Remove all items from the queue.
   */
  clear () {
    this.#items = []
  }
}

NGN.Queue = Queue
