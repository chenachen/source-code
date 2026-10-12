import assert from 'node:assert/strict'
import * as Y from '../src/index.js'
import { BlockSet, writeBlockSet } from '../src/utils/BlockSet.js'

/** 构造一个真实 V1 更新，包含指定 GC 区间与空删除集。 */
function gcUpdate (clock, length) {
  const blocks = new BlockSet()
  blocks.clients.set(7, { i: 0, refs: [new Y.GC(Y.createID(7, clock), length)] })
  const encoder = new Y.UpdateEncoderV1()
  writeBlockSet(encoder, blocks)
  Y.writeIdSet(encoder, Y.createIdSet())
  return encoder.toUint8Array()
}

const left = gcUpdate(0, 2)
const right = gcUpdate(1, 4)
const merged = Y.mergeUpdates([left, right])
const ranges = Y.decodeUpdate(merged).structs.map(block => [block.constructor.name, block.id.clock, block.id.clock + block.length])
// 已知缺陷的特征断言，不是期望算法保持的正确行为。修库时必须改成无 Skip 并集断言。
assert.deepEqual(ranges, [['GC', 0, 2], ['Skip', 2, 4], ['GC', 4, 5]])
const sequentialDoc = new Y.Doc()
const mergedDoc = new Y.Doc()
try {
  Y.applyUpdate(sequentialDoc, left)
  Y.applyUpdate(sequentialDoc, right)
  Y.applyUpdate(mergedDoc, merged)
  const sequentialClock = Y.decodeStateVector(Y.encodeStateVector(sequentialDoc)).get(7)
  const mergedClock = Y.decodeStateVector(Y.encodeStateVector(mergedDoc)).get(7)
  assert.equal(sequentialClock, 5)
  assert.equal(mergedClock, 2)
  console.log(JSON.stringify({ ranges, sequentialClock, mergedClock }))
} finally {
  sequentialDoc.destroy()
  mergedDoc.destroy()
}
