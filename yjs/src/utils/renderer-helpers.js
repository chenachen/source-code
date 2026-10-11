import * as s from 'lib0/schema'
import * as error from 'lib0/error'
import { ObservableV2 } from 'lib0/observable'

import { createIdSet } from './ids.js'

/** attribution JSON 的结构校验器；插入、删除、格式来源为字符串数组，`*At` 是单位由应用约定的数值元数据。 */
export const attributionJsonSchema = s.$object({
  insert: s.$array(s.$string).optional,
  insertAt: s.$number.optional,
  delete: s.$array(s.$string).optional,
  deleteAt: s.$number.optional,
  format: s.$record(s.$string, s.$array(s.$string)).optional,
  formatAt: s.$number.optional
})

/**
 * renderer 可附着到内容片段上的 attribution JSON 形状。
 * insert/delete 是作者或来源标签数组；format 按格式键保存同类数组。对应的 *At 数值由应用解释，
 * 不参与 Item clock 或可见长度计算；所有字段都可省略，空数组仍表示存在该类归因。
 *
 * @todo 来源字段可改名为 `insertBy`、`deleteBy`，与 `*At` 数值元数据区分。
 *
 * @typedef {s.Unwrap<typeof attributionJsonSchema>} Attribution
 */

/**
 * renderer 切分后的内容片段，携带原 clock、有效删除状态、attribution 与 Delta 输出模式。
 *
 * @template T attribution 属性值类型。
 */
export class AttributedContent {
  /**
   * 创建可渲染片段并把四种内部行为模式归一化为 `render`/`fresh` 标志。
   *
   * @param {AbstractContent} content - 已按 attribution 边界切分的内容。
   * @param {number} clock - 片段在所属 client 中的起始 clock。
   * @param {boolean} deleted - renderer 视图中的有效删除状态。
   * @param {Array<ContentAttribute<T>> | null} attrs - attribution；`null` 表示无归因。
   * @param {0|1|2|3} renderBehavior - 0=retain，1=只输出可见/有归因内容，2=insert/delete，3=同事务新增后删除的 fresh 内容。
   */
  constructor (content, clock, deleted, attrs, renderBehavior) {
    /** 片段内容对象。 */
    this.content = content
    /** 片段首 ID 的 clock。 */
    this.clock = clock
    /** 片段在当前 renderer 视图中是否作为删除内容。 */
    this.deleted = deleted
    /** 附加到 Delta 操作的 attribution 数组。 */
    this.attrs = attrs
    /** 是否输出内容操作；mode 0 始终留给 retain，mode 1 会过滤无归因删除。 */
    this.render = renderBehavior === 0 ? false : (renderBehavior === 1 ? (!deleted || attrs != null) : true)
    /**
     * 同一事务内新增后删除的 fresh 内容（mode 3）。即使 `retainDeletes` 也必须对有归因片段产生 insert：消费端缓存从未见过它，不存在可 retain 的旧内容。
     */
    this.fresh = renderBehavior === 3
  }
}

/**
 * 把 Content 与 attribution 转为 Delta 的 renderer 抽象基类。
 *
 * 只有 `hasItem()` 声明接管的 Item 才进入 renderer；其余走通用快路径。完整状态渲染时，存活内容无归因地输出，删除内容隐藏；事件渲染时，未接管的本次删除仍需生成 DeleteOp。attribution 在原始变化之后改变时，实现应发出 `change`，让现有内容刷新归因。
 *
 * @extends {ObservableV2<{change:(idset:IdSet,origin:any,local:boolean)=>void}>}
 */
export class AbstractRenderer extends ObservableV2 {
  /** 创建空覆盖集合；具体 renderer 可扩大覆盖范围或重写 `hasItem()`。 */
  constructor () {
    super()
    /**
     * 可能被非标准渲染（归因、恢复、隐藏等）的内容 ID。允许过度近似；`readContent()` 才决定最终输出，集合外内容不咨询 renderer。
     *
     * @type {IdSet}
     */
    this.attributed = createIdSet()
  }

  /**
   * 判断 Item 任一 ID 片段是否必须交给 renderer；返回 `false` 时走通用快路径。
   *
   * @param {Item} item - 待判断 Item。
   * @return {boolean} 覆盖集合与 Item 区间相交时为 `true`。
   */
  hasItem (item) {
    return this.attributed.intersects(item.id.client, item.id.clock, item.length)
  }

  /**
   * 把一个结构内容按 renderer 边界切片并追加到结果；子类必须实现。
   *
   * mode 0 用于未变化片段，countable 可见内容生成 retain；mode 1 用于完整状态，只输出存活或有归因片段；mode 2 用于变化片段，存活/有归因内容可生成 insert，无归因删除生成 delete；mode 3 用于同事务新增后删除，有归因处必须 insert、无归因处不输出。格式标记不占可见长度，由 `toDelta` 的格式状态机解释。
   *
   * @param {Array<AttributedContent<any>>} _contents - 结果数组。
   * @param {number} _client - 内容 client。
   * @param {number} _clock - 传入 Content 切片的起始 clock，不一定等于原 Item 起点。
   * @param {boolean} _deleted - 文档删除状态。
   * @param {AbstractContent} _content - 待切分内容。
   * @param {0|1|2|3} _shouldRender - 内部输出模式；输出片段的 clock 应对应原内容位置，切片不得修改文档原 Content。
   */
  readContent (_contents, _client, _clock, _deleted, _content, _shouldRender) {
    error.methodUnimplemented()
  }

  /**
   * 计算 Item 在该 renderer 视图中的可见长度，供索引迭代器使用；非 countable 内容必须返回零。
   *
   * @param {Item} _item - 待计算 Item；结果应与 readContent 的可见片段长度一致，才能按同一坐标编辑。
   * @return {number} renderer 可见长度。
   */
  contentLength (_item) {
    error.methodUnimplemented()
  }
}

/** Renderer schema 类型标记，同时安装到抽象原型供运行时识别。 */
export const $renderer = AbstractRenderer.prototype.$type = s.$type('y:r', AbstractRenderer)

/**
 * 计算 Item 在给定 renderer 下的可见长度。
 *
 * renderer 接管时委托 `contentLength()`；否则使用通用规则：存活且 countable 的内容取完整长度，其余为零。
 *
 * @param {AbstractRenderer?} renderer - renderer；传 `null` 使用普通文档视图。
 * @param {Item} item - 待计算 Item。
 * @return {number} 当前视图可见长度。
 */
export const rendererContentLength = (renderer, item) =>
  renderer !== null && renderer.hasItem(item)
    ? renderer.contentLength(item)
    : ((item.deleted || !item.content.isCountable()) ? 0 : item.length)
