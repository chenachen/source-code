import * as Y from '../src/index.js'
import * as t from 'lib0/testing'

/**
 * 对文本索引 0 到 length-1 和 assoc=-1/0/1 执行二进制编码往返，断言解析索引与关联方向不变；不检查末尾索引 length。
 *
 * @param {Y.Type<{text:true}>} ytext - 待穷举的文本类型。
 */
const checkRelativePositions = ytext => {
  // 遍历每个字符之前的位置，不包含文本末尾端点。
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
 * 测试场景：空文本依次头插 1、abc、z、y、x，得到 xyzabc1。
 * 触发操作：辅助函数穷举索引 0..6 与 assoc=-1/0/1，编码、解码并解析锚点。
 * 预期结果：每次绝对索引与 assoc 不变；未检查末尾索引 7。
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
 * 测试场景：空文本一次写入 abc。
 * 触发操作：穷举索引 0..2 与三种 assoc，执行二进制往返。
 * 预期结果：段内锚点解析为原索引与关联方向；未检查末尾索引 3。
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
 * 测试场景：空文本头插 abc、1、xyz，得到 xyz1abc。
 * 触发操作：对多次插入形成的内容链穷举索引 0..6 与三种 assoc。
 * 预期结果：编码往返后的索引与 assoc 一致，不涵盖末尾端点。
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
 * 测试场景：文本仅含字符 1。
 * 触发操作：在索引 0 分别用 assoc=-1/0/1 编码并解析。
 * 预期结果：三次解析均保持索引 0 和原 assoc；末尾索引 1 未测试。
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
 * 测试场景：空文本依次头插 2、1，得到 12。
 * 触发操作：在两个字符前穷举三种 assoc，执行锚点二进制往返。
 * 预期结果：所有解析索引与 assoc 一致。
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
 * 测试场景：空文本长度为 0。
 * 触发操作：调用只遍历 i<length 的辅助函数。
 * 预期结果：循环执行零次，没有创建锚点，也没有位置断言；仅确认调用可完成。
 *
 * @param {t.TestCase} _tc
 */
export const testRelativePositionCase6 = _tc => {
  const ydoc = new Y.Doc()
  const ytext = ydoc.get()
  checkRelativePositions(ytext)
}

/**
 * 测试场景：文本 abcde 在索引 2 创建锚点，没有 undo 历史。
 * 触发操作：分别启用与禁用 followRedone 解析。
 * 预期结果：两者索引均为 2；覆盖 issue #657 的无重做链基线。
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
 * 测试场景：文本 12，在 1|2 边界创建右关联与左关联锚点。
 * 触发操作：在相同边界插入 x 后解析两锚点。
 * 预期结果：右关联跟随原字符 2，索引变为 2；左关联贴住字符 1，索引保持 1。
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
 * 测试场景：hello world 索引 1 的锚点和随后建立的 UndoManager。
 * 触发操作：删除前六字符、undo，再把完整状态同步到新文档；分别启用/禁用 followRedone。
 * 预期结果：删除后索引 0；本地追随 redone 得 1，禁用追随得 6；同步副本不含本地 redone 映射，两种策略均得 6。
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
