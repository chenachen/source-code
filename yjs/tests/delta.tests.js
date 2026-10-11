import * as Y from '../src/index.js'
import * as delta from 'lib0/delta'
import * as t from 'lib0/testing'
import * as s from 'lib0/schema'

/**
 * 内存 Delta 状态为 hello world；应用 retain(5)、delete(6)、insert(!)。结果等于 hello! 的完整 Delta。
 *
 * retain/delete 消费旧内容坐标，insert 只推进输出游标；所以删除后缀后，感叹号插在保留的 hello 后。
 * 并发变化须先 rebase 到同一坐标再顺序 apply；本用例直接应用一个已排好顺序的 change。
 *
 * @param {t.TestCase} _tc
 */
export const testDeltaBasics = _tc => {
  // 初始状态。
  const state = delta.create().insert('hello world')
  // 删除后缀并在当前游标插入感叹号。
  const change = delta.create().retain(5).delete(6).insert('!')
  // DeltaBuilder 原地应用变化。
  state.apply(change)
  // 完整 Delta 等价性同时比较内容与操作规范化结果。
  t.assert(state.equals(delta.create().insert('hello!').done()))
}

/**
 * Delta schema 只允许字符串 key 属性和数值子项；用被静态抑制的代码写入布尔 key，再尝试 apply 含布尔属性的外部 Delta。直接 set 的类型约束产生预期 TypeScript 错误，apply 在运行时 schema 校验抛错。
 * 本用例未写入 children；schema 配置同时声明其类型。
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
 * 构造含设置/删除属性、retain/delete、文本和对象 insert 的变化；分别迭代属性与子操作并按谓词打印。子操作演示可打印相应内容，旧属性谓词不命中。
 * SetAttrOp/DeleteAttrOp 应使用属性谓词；此用例无断言，未验证打印输出。
 *
 * @param {t.TestCase} _tc
 */
export const testDeltaValues = _tc => {
  const change = delta.create().setAttr('a', 42).deleteAttr('b').retain(5).delete(6).insert('!').insert([{ my: 'custom object' }])
  // 此处迭代到 SetAttrOp/DeleteAttrOp；下方旧子操作谓词不会命中，应分别使用 $setAttrOp/$deleteAttrOp。
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
 * 空文档根类型注册 observer 捕获深层 Delta；合成 a=42 与 hello/对象插入并一次 applyDelta。事件和最终完整状态都等于输入变化，因为起始状态为空。
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
 * V1 为 hello world，V2 复制后删除后缀并加 !；建 DiffRenderer 检查完整视图，再以该 Renderer retain 11 后插入 !。完整视图保留带 delete 的旧后缀；后续归因事件 retain 11，普通事件 retain 5。
 * 两种 retain 坐标都指向原有 ! 之前。格式来源属于机制介绍，本用例没有格式化动作。
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
