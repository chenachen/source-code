import assert from 'node:assert/strict'
import * as Y from '../src/index.js'

const docA = new Y.Doc()
const docB = new Y.Doc()
try {
  const listA = docA.get('items')
  listA.insert(0, ['A'])
  const first = Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB))
  Y.applyUpdate(docB, first)
  assert.deepEqual(docB.get('items').toArray(), ['A'])
  Y.applyUpdate(docB, first)
  assert.deepEqual(docB.get('items').toArray(), ['A'])

  // B 已掌握 A 的结构。删除不会推进 state vector，仍须传送删除集。
  const oldVectorB = Y.encodeStateVector(docB)
  listA.insert(1, ['B'])
  listA.delete(0, 1)
  const second = Y.encodeStateAsUpdate(docA, oldVectorB)
  Y.applyUpdate(docB, second)
  assert.deepEqual(docB.get('items').toArray(), ['B'])
  assert.deepEqual(Y.encodeStateVector(docB), Y.encodeStateVector(docA))
  Y.applyUpdate(docB, second)
  assert.deepEqual(docB.get('items').toArray(), ['B'])
  console.log('PASS: first sync, existing-history diff + deletion, duplicate delivery')
} finally {
  docA.destroy()
  docB.destroy()
}
