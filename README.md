<h1 align="center">NGN Queue<br/><img src="https://img.shields.io/npm/v/@ngnjs/queue?label=%40ngnjs/queue&logo=npm&style=social"/></h1>
<div align="center"><em>A plugin for <a href="https://github.com/ngnjs/ngn">NGN</a></em></div><br/>

The NGN Queue is a collection of functions, stored in the order they're added t othe collection. "Running" a queue executes these functions, in parallel or sequentially.

Documentation for this plugin does not exist yet, but the inline comments in the code are thorough. The unit tests provide use cases, and a series of live examples are available on [codepen](https://codepen.io/coreybutler/pen/eYZQJqL).

The fundamental/basic example:

```javascript
import NGN from 'https://cdn.jsdelivr.net/npm/ngn@latest/index.js'
import Queue from 'https://cdn.jsdelivr.net/npm/@ngnjs/queue/index.js'

const tasks = new Queue()

tasks.add(function () {
  console.log('Run task 1')
})

tasks.add(next => {
  setTimeout(() => {
    console.log('Run async task.')
    next()
  }, 300)
})

tasks.add('t3', function () {
  console.log('Run task named ' + this.name)
})

tasks.on('end', function () {
  console.log('All Done!')
})

tasks.runSync()
```
