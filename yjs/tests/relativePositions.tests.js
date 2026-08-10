import * as Y from '../src/index.js'
import * as t from 'lib0/testing'

/**
 * 对文本每个索引和 assoc=-1/0/1 执行编码往返，并断言解析后的索引与关联方向不变。
 *
 * @param {Y.Type<{text:true}>} ytext - 待穷举的文本类型。
 */
const checkRelativePositions = ytext => {
  // 穷举全部可见位置。
  for (let i = 0; i < ytext.length; i++) {
    // 同时覆盖左关联、默认关联和正关联。
    for (let assoc = -1; assoc < 2; assoc++) {
      const rpos = Y.createRelativePositionFromTypeIndex(ytext, i, assoc)
      const encodedRpos = Y.encodeRelativePosition(rpos)
      const decodedRpos = Y.decodeRelativePosition(encodedRpos)
      const absPos = /** @type {Y.AbsolutePosition} */ (Y.createAbsolutePositionFromRelativePosition(decodedRpos, /** @type {Y.Doc} */ (ytext.doc)))
      t.assert(absPos.index === i)
      t.assert(absPos.assoc === assoc)
    }
  }
}

/**
 * 验证多次在索引 0 前插入后的复杂结构分段仍可往返全部相对位置。
 *
 * @param {t.TestCase} _tc
 */
export const testRelativePositionCase1 = _tc => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get()
  ytext.insert(0, '1')
  ytext.insert(0, 'abc')
  ytext.insert(0, 'z')
  ytext.insert(0, 'y')
  ytext.insert(0, 'x')
  checkRelativePositions(ytext)
}

/**
 * 验证单次连续文本插入的相对位置编码/解码基线。
 *
 * @param {t.TestCase} _tc
 */
export const testRelativePositionCase2 = _tc => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get()
  ytext.insert(0, 'abc')
  checkRelativePositions(ytext)
}

/**
 * 验证多段头部插入形成的结构链仍保持所有绝对索引。
 *
 * @param {t.TestCase} _tc
 */
export const testRelativePositionCase3 = _tc => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get()
  ytext.insert(0, 'abc')
  ytext.insert(0, '1')
  ytext.insert(0, 'xyz')
  checkRelativePositions(ytext)
}

/**
 * 验证单字符类型的三种 assoc 解析边界。
 *
 * @param {t.TestCase} _tc
 */
export const testRelativePositionCase4 = _tc => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get()
  ytext.insert(0, '1')
  checkRelativePositions(ytext)
}

/**
 * 验证两个独立头插结构的相对位置解析。
 *
 * @param {t.TestCase} _tc
 */
export const testRelativePositionCase5 = _tc => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get()
  ytext.insert(0, '2')
  ytext.insert(0, '1')
  checkRelativePositions(ytext)
}

/**
 * 验证空类型不会产生越界位置，穷举辅助函数安全返回。
 *
 * @param {t.TestCase} _tc
 */
export const testRelativePositionCase6 = _tc => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get()
  checkRelativePositions(ytext)
}

/**
 * 回归验证 issue #657：同一内容锚点无论是否追随 redone 链，在未撤销文档上都解析为原索引。
 *
 * @param {t.TestCase} _tc
 */
export const testRelativePositionCase7 = _tc => {
  const docA = new Y.Doc()
  const textA = docA.get('text')
  textA.insert(0, 'abcde')
  // 在 textA 的索引 2 创建锚点。
  const relativePosition = Y.createRelativePositionFromTypeIndex(textA, 2)
  // 无撤销链时，两种解析策略应一致。
  const absolutePositionWithFollow =
    Y.createAbsolutePositionFromRelativePosition(relativePosition, docA, true)
  const absolutePositionWithoutFollow =
    Y.createAbsolutePositionFromRelativePosition(relativePosition, docA, false)
  t.assert(absolutePositionWithFollow?.index === 2)
  t.assert(absolutePositionWithoutFollow?.index === 2)
}

/**
 * Given：在两个字符之间分别创建右关联与左关联锚点。
 * When：在该边界插入新字符。
 * Then：右关联位置随原右字符右移，左关联位置保持在插入前。
 *
 * 验证机制：分别断言索引 2 与 1，证明 assoc 决定并发插入时的黏附侧。
 *
 * @param {t.TestCase} _tc
 */
export const testRelativePositionAssociationDifference = _tc => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get()
  ytext.insert(0, '2')
  ytext.insert(0, '1')
  const rposRight = Y.createRelativePositionFromTypeIndex(ytext, 1, 0)
  const rposLeft = Y.createRelativePositionFromTypeIndex(ytext, 1, -1)
  ytext.insert(1, 'x')
  const posRight = Y.createAbsolutePositionFromRelativePosition(rposRight, ydoc)
  const posLeft = Y.createAbsolutePositionFromRelativePosition(rposLeft, ydoc)
  t.assert(posRight != null && posRight.index === 2)
  t.assert(posLeft != null && posLeft.index === 1)
}

/**
 * 验证相对位置对 undo `redone` 链的本地增强解析与跨副本稳定解析差异。
 *
 * Given：锚点指向将被删除的文本，UndoManager 随后恢复该范围。
 * When：分别以 follow=true/false 在本地和同步副本解析。
 * Then：本地 follow 可回到恢复字符索引；禁用 follow 与远端副本按稳定原历史位置解析。
 *
 * 对应源码：`createAbsolutePositionFromRelativePosition()` 的 `followRedone` 分支。
 *
 * @param {t.TestCase} _tc
 */
export const testRelativePositionWithUndo = _tc => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get()
  ytext.insert(0, 'hello world')
  const rpos = Y.createRelativePositionFromTypeIndex(ytext, 1)
  const um = new Y.UndoManager(ytext)
  ytext.delete(0, 6)
  t.assert(Y.createAbsolutePositionFromRelativePosition(rpos, ydoc)?.index === 0)
  um.undo()
  t.assert(Y.createAbsolutePositionFromRelativePosition(rpos, ydoc)?.index === 1)
  const posWithoutFollow = Y.createAbsolutePositionFromRelativePosition(rpos, ydoc, false)
  console.log({ posWithoutFollow })
  t.assert(Y.createAbsolutePositionFromRelativePosition(rpos, ydoc, false)?.index === 6)
  const ydocClone = new Y.Doc()
  Y.applyUpdate(ydocClone, Y.encodeStateAsUpdate(ydoc))
  t.assert(Y.createAbsolutePositionFromRelativePosition(rpos, ydocClone)?.index === 6)
  t.assert(Y.createAbsolutePositionFromRelativePosition(rpos, ydocClone, false)?.index === 6)
}
