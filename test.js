process.chdir(__dirname)

const fs = require('fs-extra')
const test = require('baretest')('wdg')
const assert = require('assert')
const path = require('path')

const { fixtures, fixturesRoot } = require('./fixtures.js')

const wait = t => new Promise(resolve => setTimeout(resolve, t))

function subscribe (event, instance) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(reject, 30000)

    const close = instance.on(event, ids => {
      clearTimeout(timeout)
      close()
      resolve(ids)
    })
  })
}

test('update main entries', async () => {
  const instance = require('./')(fixtures.A, fixtures.B)

  const A = subscribe('update', instance)

  fs.outputFileSync(fixtures.A, fs.readFileSync(fixtures.A))

  assert((await A).includes(fixtures.A))

  const B = subscribe('update', instance)

  fs.outputFileSync(fixtures.B, fs.readFileSync(fixtures.B))

  assert((await B).includes(fixtures.B))

  await instance.close()
})

test('update single child', async () => {
  const instance = require('./')(fixtures.A, fixtures.B)

  const subscriber = subscribe('update', instance)

  fs.outputFileSync(fixtures.childOfA, fs.readFileSync(fixtures.childOfA))

  const updated = await subscriber

  assert(updated.length >= 1)
  assert(updated.includes(fixtures.A))

  await instance.close()
})

test('update common nested child', async () => {
  const instance = require('./')(fixtures.A, fixtures.B)

  const subscriber = subscribe('update', instance)

  const before = require(fixtures.childOfChildren)
  assert(before.foo === undefined)

  fs.outputFileSync(fixtures.childOfChildren, `module.exports = { foo: true }`)

  const updated = await subscriber

  assert(updated.length >= 2)
  assert(updated.includes(fixtures.A))
  assert(updated.includes(fixtures.B))

  const after = require(fixtures.childOfChildren)
  assert(after.foo === true)

  await instance.close()
})

test('update common nested child, clear require cache', async () => {
  const instance = require('./')(fixtures.cachedEntry)

  const subscriber = subscribe('update', instance)

  const before = require(fixtures.cachedEntry)
  assert(before.value === 0)

  fs.outputFileSync(fixtures.cachedDeepChild, `module.exports = { value: 1 }`)

  await subscriber

  const after = require(fixtures.cachedEntry)
  assert(after.value === 1)

  await instance.close()
})

test('update common nested child after ancestor removal', async () => {
  const instance = require('./')(fixtures.A, fixtures.B)

  const A = subscribe('update', instance)

  fs.outputFileSync(fixtures.childOfA, '') // remove child

  const updatedA = await A

  assert(updatedA.length === 1)
  assert(updatedA[0] === fixtures.A)

  const child = subscribe('update', instance)

  fs.outputFileSync(
    fixtures.childOfChildren,
    fs.readFileSync(fixtures.childOfChildren)
  )

  assert((await child).pop() === fixtures.B)

  await instance.close()
})

test('ensure shared deps are both mapped to entries', async () => {
  const { register, close } = require('./')(fixtures.A, fixtures.B)

  assert(register[fixtures.commonDep].entries.length === 2)

  await close()
})

test('handles circular deps', async () => {
  fs.outputFileSync(
    fixtures.childOfA,
    `require('${fixtures.childOfChildren}');require('${fixtures.commonDep}')`
  )

  await wait(500)

  const { register, close } = require('./')(fixtures.A, fixtures.B)

  assert(register[fixtures.commonDep].entries.length === 2)

  await close()
})

test('handles case rename as change', async () => {
  const instance = require('./')(fixtures.renameableEntry)

  const subscriber = subscribe('update', instance)

  fs.renameSync(
    fixtures.renameable,
    fixtures.renameable.replace('renameable', 'Renameable')
  )

  const ids = await subscriber

  assert(ids.includes(fixtures.renameableEntry))

  await instance.close()
})

test('handles file rename by unwatching', async () => {
  const instance = require('./')(fixtures.renameableEntry)

  const subscriber = subscribe('update', instance)

  const newFile = fixtures.renameable.replace('renameable', 'renameabl')
  fs.renameSync(fixtures.renameable, newFile)
  fs.outputFileSync(newFile, fs.readFileSync(newFile))

  // bump, otherwise ^ those won't fire
  fs.outputFileSync(
    fixtures.renameableEntry,
    fs.readFileSync(fixtures.renameableEntry)
  )

  const ids = await subscriber

  assert(ids.length === 1)
  assert(ids.includes(fixtures.renameableEntry))

  await instance.close()
})

test('handles entry rename by restarting', async () => {
  const instance = require('./')(path.join(__dirname, './fixtures/*.entry.js'))

  const removed = subscribe('remove', instance)

  const newFile = fixtures.renameableEntry.replace(
    'renameableEntry',
    'renameableEntr'
  )
  fs.renameSync(fixtures.renameableEntry, newFile)

  const removedIds = await removed

  assert(removedIds.includes(fixtures.renameableEntry))
  assert(instance.ids.includes(newFile))

  await instance.close()
})

test('handles adding new entry file', async () => {
  const instance = require('./')(path.join(__dirname, './fixtures/*.entry.js'))

  const added = subscribe('add', instance)

  await wait(500)

  fs.outputFileSync(fixtures.addedEntry, 'module.exports = {}')

  const ids = await added

  assert(ids.includes(fixtures.addedEntry))
  assert(instance.ids.includes(fixtures.addedEntry))

  await instance.close()
})

test('can remove listeners', async () => {
  const instance = require('./')(fixtures.A)

  let calls = 0

  // should not fire
  instance.on('update', () => {
    calls += 1
  })()

  const close = instance.on('update', () => {
    calls += 1
  })

  fs.outputFileSync(fixtures.childOfA, fs.readFileSync(fixtures.childOfA))

  await wait(500)

  assert(calls === 1)

  close()
  await instance.close()
})

test('resets listeners after close', async () => {
  const instance = require('./')(fixtures.A)

  let calls = 0

  instance.on('update', () => {
    calls += 1
  })

  await instance.close()

  fs.outputFileSync(fixtures.childOfA, fs.readFileSync(fixtures.childOfA))

  await wait(500)

  assert(calls === 0)
})

test('watches for non-existing files', async () => {
  const instance = require('./')(path.join(fixturesRoot, '*.ghost.js'))

  const added = subscribe('add', instance)

  await wait(500)

  const ghostFile = path.join(fixturesRoot, 'a.ghost.js')

  fs.outputFileSync(ghostFile, 'module.exports = {}')

  const ids = await added

  assert(ids.includes(ghostFile))
  assert(instance.ids.includes(ghostFile))

  await instance.close()
})

!(async function () {
  console.time('test')
  await test.run()
  fs.removeSync(fixturesRoot)
  console.timeEnd('test')
})()
