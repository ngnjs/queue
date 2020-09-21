import test from 'tappedout'
import NGN from 'ngn'
import Queue from '@ngnjs/queue'
import Reference from '@ngnjs/plugin'

test('Sanity', t => {
  if (!NGN) {
    t.bail('The test requires the presence of NGN.')
  }

  const TaskRunner = new Queue()
  t.ok(typeof TaskRunner === 'object', 'The plugin class is recognized.')

  // This functionality/test was removed so the NGN namespace does not need to be a Proxy
  // t.ok(NGN.Queue !== undefined, 'The exported queue is available directly on the NGN namespace.')
  t.ok(NGN.plugins.Queue !== undefined, 'The exported queue is available from the NGN.plugin namespace.')

  const ngn = new Reference(NGN.version)
  t.ok(ngn.Queue !== undefined, 'The queue is available within the NGN reference.')
  t.end()
})

test('NGN Queue Add Task', t => {
  const tasks = new Queue()

  tasks.add(function () {})
  tasks.add('t2', function () {})
  tasks.add(function () {})

  t.expect(3, tasks.size, 'Invalid number of steps queued.')
  t.expect('Task #1', tasks.list[0].name, 'Autoname failed.')
  t.expect('t2', tasks.list[1].name, 'Invalid step name.')

  t.end()
})

test('NGN Queue Remove Task', t => {
  const tasks = new Queue()

  tasks.add(function () {})
  tasks.add('t2', function () {})
  tasks.add('t3', function () {})

  let x = tasks.remove(1)
  t.expect(2, x.number, 'Unrecognized task removed.')
  t.expect(2, tasks.list.length, 'Invalid number of steps queued.')
  t.expect('t3', tasks.list[1].name, 'Invalid step name.')

  x = tasks.remove('t3')
  t.expect(3, x.number, 'Unrecognized task removed. ')
  t.expect(1, tasks.list.length, 'Invalid number of steps queued.')
  t.expect('Task #1', tasks.list[0].name, 'Invalid step name.')

  x = tasks.remove(0)
  t.expect(1, x.number, 'Unrecognized task removed.')
  t.expect(0, tasks.size, 'Invalid number of steps queued.')
  t.end()
})

test('NGN Queue Retrieve a task', t => {
  const tasks = new Queue()

  tasks.add(function () {
    console.log('Task 1')
  })

  tasks.add('t2', function () {
    console.log('Task 2')
  })

  tasks.add('t3', function () {
    console.log('Task 3')
  })

  let tsk = tasks.getTaskByIndex(1)
  t.expect(2, tsk.number, 'tasks.getTaskByIndex method returned unexpected value.')

  tsk = tasks.getTaskByName('t3')
  t.expect(3, tsk.number, 'tasks.getTaskByName (by name) method returned unexpected value.')

  t.end()
})

test('NGN Queue parallel execution', t => {
  const tasks = new Queue()
  const x = []

  tasks.add(function () {
    x.push('Task 1')
  })

  tasks.add('t2', function () {
    x.push('Task 2')
  })

  tasks.add('t3', function () {
    x.push('Task 3')
  })

  let ended = false
  tasks.on('complete', function () {
    if (ended) {
      t.fail("'complete' event fired more than once.")
      t.end()
      return
    }

    ended = true
    t.expect(3, x.length, 'All functions ran in parallel.')

    setTimeout(() => t.end(), 300)
  })

  tasks.run()
})

test('NGN Queue Async execution', t => {
  t.timeoutAfter(4000)

  const tasks = new Queue()
  const x = []

  tasks.add(function () {
    x.push('Task 1')
  })

  tasks.add('t2a', function (next) {
    setTimeout(function () {
      x.push('Task 2')
      next()
    }, 700)
  })

  tasks.add('t3', function () {
    x.push('Task 3')
  })

  tasks.on('complete', function () {
    t.ok(x.length === 3, 'Invalid result.' + x.toString())
    t.end()
  })

  tasks.run()
})

test('NGN Queue Process timeout', t => {
  t.timeoutAfter(500)

  const tasks = new Queue()
  tasks.timeout = 0.00000000001

  const x = []
  tasks.add(function () {
    x.push('Task 1')
  })

  tasks.add('t2', function (next) {
    setTimeout(function () {
      x.push('Task 2')
      next()
    }, 700)
  })

  tasks.on('timeout', function () {
    t.pass('Timed out appropriately.')
    t.end()
  })

  tasks.run()
})

test('NGN.Task timeout', t => {
  t.timeoutAfter(3000)
  const tasks = new Queue()
  const x = []

  tasks.add(function () {
    x.push('Task 1')
  })

  let timer
  tasks.add('t2', function (next) {
    this.timeout(500)
    timer = setTimeout(function () {
      t.fail('Should have timed out by now.')
      t.end()
    }, 2000)
  })

  tasks.on('task.timeout', function () {
    clearTimeout(timer)
    t.pass('Step times out appropriately.')
    t.end()
  })

  tasks.run()
})

test('NGN Queue Abort Process', t => {
  t.timeoutAfter(5000)

  const tasks = new Queue()
  let total = 0

  for (let x = 0; x < 50; x++) {
    tasks.add(function (next) {
      setTimeout(function () {
        total++
        next()
      }, 1000)
    })
  }

  tasks.on('aborted', function () {
    setTimeout(function () {
      if (total !== 50) {
        t.fail('Running steps were cancelled.')
      }

      t.ok(tasks.cancelled, 'Cancellation attribute populated correctly.')

      t.pass('Successfully aborted process.')
      t.end()
    }, 2200)
  })

  setTimeout(function () {
    tasks.abort()
  }, 300)

  tasks.run()
})

test('NGN Queue Simple linear execution', t => {
  const tasks = new Queue()
  const x = []

  tasks.add(function () {
    x.push(1)
  })

  tasks.add('t2', function () {
    x.push(2)
  })

  tasks.add('t3', function () {
    x.push(3)
  })

  tasks.on('complete', function () {
    t.ok(x[0] === 1 && x[1] === 2 && x[2] === 3, 'Invalid result.' + x.toString())
    t.end()
  })

  tasks.runSync()
})

test('NGN Queue Asynchronous sequential execution', t => {
  const tasks = new Queue()
  const x = []

  tasks.add(function () {
    x.push(1)
  })

  tasks.add('t2', function (next) {
    setTimeout(function () {
      x.push(2)
      next()
    }, 600)
  })

  tasks.add('t3', function () {
    x.push(3)
  })

  const extra = tasks.add('t4', function () {
    x.push(4)
  })

  extra.skip()

  tasks.on('complete', function () {
    t.ok(x.length === 3, 'Appropriately skipped step.')
    t.ok(x[0] === 1 && x[1] === 2 && x[2] === 3, 'Valid result: ' + x.toString())
    t.end()
  })

  tasks.runSync()
})

test('NGN Queue Abort Process', t => {
  t.timeoutAfter(5000)

  const tasks = new Queue()
  let totalSync = 0

  for (let x = 0; x < 50; x++) {
    tasks.add(function (next) {
      setTimeout(function () {
        totalSync++
        next()
      }, 1000)
    })
  }

  tasks.on('aborted', function () {
    setTimeout(function () {
      if (totalSync !== 1) {
        t.fail('Queued steps were not cancelled.')
      }

      t.pass('Successfully aborted process.')
      tasks.reset()

      t.end()
    }, 1500)
  })

  setTimeout(function () {
    tasks.abort()
  }, 300)

  tasks.runSync()
})

test('NGN Queue Process an empty queue.', t => {
  const tasks = new Queue()
  tasks.on('complete', function () {
    t.pass('No error on empty task.')
    tasks.reset()
    t.end()
  })

  tasks.run()
})
