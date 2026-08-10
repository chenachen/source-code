import * as Y from '../src/index.js'
import * as delta from 'lib0/delta'
import * as t from 'lib0/testing'
import * as s from 'lib0/schema'

/**
 * 验证 Delta 的游标式 retain/delete/insert 可把 `hello world` 变为 `hello!`。
 *
 * Delta 属于 lib0，非 Yjs 应用无需引入完整 Yjs 即可用它描述状态与变化集。以下从文本
 * `hello world` 删除 ` world` 并插入感叹号，结果应为 `hello!`。
 *
 * 传统绝对索引写法可能是“删除 [5,11)，再在 11 插入 `!`”；多个变化组合时，后一索引究竟基于变化前
 * 还是变化后状态容易含糊。Delta 改用从左到右移动的游标，`|` 表示当前位置：
 *
 * - `retain(5)`：`|hello world → hello| world`，跳过五个字符；
 * - `delete(6)`：`hello| world → hello|`，删除接下来六个字符；
 * - `insert('!')`：`hello| → hello!|`，在当前游标插入。
 *
 * 两个独立变化也可 rebase/merge：`d1 = retain(5).delete(6)` 删除后半段，`d2 = retain(11).insert('!')`
 * 基于旧状态追加；`d2.rebase(d1)` 会把插入位置改为 5，`d1.apply(d2)` 则合成一次变化。
 *
 * Given：状态为 `hello world`。When：应用紧凑变化 `retain(5).delete(6).insert('!')`。
 * Then：最终状态严格等于只含 `hello!` 的 Delta。
 *
 * @param {t.TestCase} _tc
 */
export const testDeltaBasics = _tc => {
  // 初始状态。
  const state = delta.create().insert('hello world')
  // 唯一触发动作：删除后缀并在当前游标插入感叹号。
  const change = delta.create().retain(5).delete(6).insert('!')
  // DeltaBuilder 原地应用变化。
  state.apply(change)
  // 完整 Delta 等价性同时比较内容与操作规范化结果。
  t.assert(state.equals(delta.create().insert('hello!').done()))
}

/**
 * 验证 Delta schema 同时约束属性键值与应用进来的外部 Delta。
 *
 * lib0 schema 可校验 JSON 与 Yjs 自定义类型；约定以 `$` 前缀区分 schema 和实例。例如：
 *
 * const $myobj = s.$object({ key: s.$number })
 * let inputValue: any
 * if ($myobj.check(inputValue)) {
 *   inputValue // 此分支内已通过校验并收窄类型
 * }
 *
 * Given：schema 要求属性 `key` 为字符串。When：直接写布尔值或应用含布尔值的外部 Delta。
 * Then：静态类型拒绝直接写入，运行时 schema 拒绝外部变化。
 *
 * @param {t.TestCase} _tc
 */
export const testDeltaBasicSchema = _tc => {
  const $d = delta.$delta({ attrs: { key: s.$string }, children: s.$number, text: false })
  const d = delta.create($d)
  // @ts-expect-error
  d.setAttr('key', false) // 非法直接写入：静态类型应报错。
  t.fails(() => {
    // @ts-expect-error
    d.apply(delta.create().setAttr('key', false)) // 非法外部 Delta：运行时校验应抛错。
  })
}

/**
 * 验证 Delta 可同时描述属性变化、文本子项、JSON 子项，并按 op 种类遍历。
 *
 * 文本插入也是 children；children 还可包含 JSON 对象与嵌套 Delta，键值对则由 attrs 表示。因此一次
 * 变化可同时设置/删除属性、保留/删除文本并插入异构子项：
 *
 * delta.create().setAttr('a', 42).retain(5).delete(6).insert('!').deleteAttr('b')
 *
 * @param {t.TestCase} _tc
 */
export const testDeltaValues = _tc => {
  const change = delta.create().setAttr('a', 42).deleteAttr('b').retain(5).delete(6).insert('!').insert([{ my: 'custom object' }])
  // 属性迭代器只产生 set/delete 类操作。
  for (const attrChange of change.attrs) {
    if (delta.$insertOp.check(attrChange)) {
      console.log(`set ${attrChange.key} to ${attrChange.value}`)
    } else if (delta.$deleteOp.check(attrChange)) {
      console.log(`delete ${attrChange.key}`)
    }
  }
  // 子项迭代器区分 retain/delete、数组 insert 与文本 insert。
  for (const childChange of change.children) {
    if (delta.$retainOp.check(childChange)) {
      console.log(`retain ${childChange.retain} child items`)
    } else if (delta.$deleteOp.check(childChange)) {
      console.log(`delete ${childChange.delete} child items`)
    } else if (delta.$insertOp.check(childChange)) {
      console.log('insert child items:', childChange.insert)
    } else if (delta.$textOp.check(childChange)) {
      console.log('insert textual content', childChange.insert)
    }
  }
}

/**
 * 验证同一 Delta 模型既可表示 YType 当前状态，也可表示属性与子项变化。
 *
 * Given：一个空 YType 与分别设置属性、插入文本/对象的两个变化。
 * When：先合并两个变化，再通过 `applyDelta()` 一次写入。
 * Then：observer 收到的深层 Delta 等于合并变化，`toDeltaDeep()` 读出的当前状态也相同。
 *
 * @param {t.TestCase} _tc
 */
export const testBasics = _tc => {
  const ydoc = new Y.Doc()
  const ytype = ydoc.get('my data')
  /**
   * @type {delta.Delta<{attrs: { a: number }, children: { my: string }, text: true }>}
   */
  let observedDelta = delta.create()
  ytype.observe(event => {
    observedDelta = event.deltaDeep
    console.log('ytype changed:', observedDelta.toJSON())
  })
  // 第一个变化设置属性 `a=42`。
  const attrChange = delta.create().setAttr('a', 42).done()
  // 第二个变化插入文本与 JSON 对象。
  const childChange = delta.create().insert('hello').insert([{ my: 'object' }]).done()
  // builder 依次应用两个变化，形成单一变化集。
  const mergedChanges = delta.create(delta.$deltaAny)
  mergedChanges.apply(attrChange)
  mergedChanges.apply(childChange).done()
  console.log('merged changes: ', mergedChanges.toJSON())
  ytype.applyDelta(mergedChanges)
  // observer 证明事务事件与输入变化一致。
  t.assert(observedDelta.equals(mergedChanges))
  // 深层快照证明同一格式也能表达最终状态。
  const currState = ytype.toDeltaDeep()
  t.assert(currState.equals(mergedChanges)) // 空状态上应用的变化恰好等于最终状态。
}

/**
 * 验证 attribution 可把两份 Yjs 文档的插入、删除和格式来源投影为仍可编辑的正向内容。
 *
 * attribution 可归属到用户或用户组，分为 `insert`、`delete`、`format`。Renderer 把插入和删除都
 * 输出为带元数据的正向 insert，使编辑器可用删除线展示旧内容、用背景色展示新增内容。
 *
 * Given：V1 为 `hello world`，V2 删除后缀并插入 `!`。When：用 DiffRenderer 渲染 V2。
 * Then：`hello` 无归因，` world` 带 delete，`!` 带 insert；在该历史视图继续编辑时，事件同时给出
 * Renderer 坐标下的归因变化和当前状态坐标下的普通变化。
 *
 * @param {t.TestCase} _tc
 */
export const testAttributions = _tc => {
  const ydocV1 = new Y.Doc()
  const ytypeV1 = ydocV1.get('txt')
  ytypeV1.applyDelta(delta.create().insert('hello world').done())
  // 从 V1 更新复制出 V2。
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(ydocV1))
  const ytype = ydoc.get('txt')
  // V2 删除后缀并插入感叹号。
  ytype.applyDelta(delta.create().retain(5).delete(6).insert('!').done())
  const renderer = Y.createDiffRenderer(ydocV1, ydoc)
  // DiffRenderer 以正向内容表示两版本差异。
  const attributedContent = ytype.toDelta({ renderer })
  console.log('attributed content', attributedContent.toJSON())
  t.assert(attributedContent.equals(delta.create().insert('hello').insert(' world', null, { delete: [] }).insert('!', null, { insert: [] }).done()))
  // 编辑器绑定还需观察在归因视图坐标中发生的后续变化。
  ytype.observe(event => {
    const attributedChange = event.getDelta({ renderer })
    console.log('the attributed change', attributedChange.toJSON())
    t.assert(attributedChange.done().equals(delta.create().retain(11).insert('!', null, { insert: [] }).done()))
    const unattributedChange = event.delta
    console.log('the UNattributed change', unattributedChange.toJSON())
    t.assert(unattributedChange.equals(delta.create().retain(5).insert('!').done()))
  })
  /**
   * 同一内容有两种坐标空间：普通表示只含最新状态，归因表示保留版本差异。
   *
   * 归因视图：`hello<delete> world</delete><insert>!</insert>`；普通视图：`hello!`。
   */
  // 在归因视图中 retain 11 会越过仍显示的删除文本。
  ytype.applyDelta(delta.create().retain(11).insert('!').done(), null, { renderer })
  // 等价的普通视图变化只需 retain 5：
  // ytype.applyDelta(delta.create().retain(5).insert('!'))
}
