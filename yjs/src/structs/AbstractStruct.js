import * as error from 'lib0/error'

/**
 * 定义 `StructStore` 中所有连续时钟区间结构的共同协议。
 *
 * `Item`、`GC` 与 `Skip` 都以 `[id.clock, id.clock + length)` 占据某个客户端的
 * 连续时钟区间；子类负责集成与更新编码。`splitStruct()` 对 Item 调用 `split()`，
 * 对 GC/Skip 调用 `splice()`。未实现的抽象操作会抛错。
 */
export class AbstractStruct {
  /**
   * 创建一个由起始 ID 与区间长度标识的结构。
   *
   * @param {ID} id 区间所属 client 及包含的起始 clock；切分会保留 client 并推进右段起点。
   * @param {number} length 消耗的逻辑 clock 数量，不是可见字符数；格式项也占一个 clock。
   */
  constructor (id, length) {
    /** 区间左端；与 `length` 一起决定结构的半开 ID 范围。 */
    this.id = id
    /** 结构占据的 clock 数；内容切分、合并及前缀裁剪会原地更新。 */
    this.length = length
  }

  /**
   * 返回该结构是否代表已删除内容。
   *
   * @type {boolean}
   */
  get deleted () {
    throw error.methodUnimplemented()
  }

  /**
   * 尝试把紧邻右侧的同类结构合并进当前结构。
   *
   * 调用方必须保证两段属于同一客户端且时钟连续。成功时左段吸收右段的长度与
   * 内容，Item 还会修复邻接链接；存储数组中 `right` 的移除由调用方负责。
   *
   * @param {GC|Item|Skip} _right 紧邻当前区间的右结构；基础实现拒绝合并且不修改两段。
   * @return {boolean} 是否成功合并。
   */
  mergeWith (_right) {
    return false
  }

  /**
   * 将指定切片写入更新编码器；具体二进制布局由子类决定。
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} _encoder 目标更新编码器。
   * @param {number} _offset 从结构左端排除的 clock 数；不是输出流的字节偏移。
   * @param {number} _encodingRef 兼容参数名；Item/GC 用第三参数表达尾部排除的 clock 数，Skip 忽略它。
   */
  write (_encoder, _offset, _encodingRef) {
    throw error.methodUnimplemented()
  }

  /**
   * 把结构集成进事务及其 `StructStore`。
   *
   * @param {Transaction} _transaction 接收集成的事务；子类负责同步 store 与插入/删除集合。
   * @param {number} _offset 已知前缀的 clock 数；裁剪后仅集成剩余区间。
   */
  integrate (_transaction, _offset) {
    throw error.methodUnimplemented()
  }

  /**
   * 在区间内切分 GC/Skip 并返回右半段；Item 使用带事务参数的 `split()`。
   *
   * @param {number} _diff 相对结构起点的切分位置，要求位于区间内部。
   * @return {GC|Item|Skip} 右段；左段原地截短，调用方负责将右段放入结构数组。
   */
  splice (_diff) {
    throw error.methodUnimplemented()
  }
}

/**
 * 把结构覆盖的完整半开时钟区间登记进 `IdSet`。
 *
 * 事务用它维护插入集；区间长度直接取自结构，保持集合与存储边界一致。
 *
 * @param {IdSet} idSet 原地接收区间的集合；相邻/重叠区间由集合归并。
 * @param {AbstractStruct} struct 用其完整 ID 范围登记，调用前须完成集成时的前缀裁剪。
 *
 * @private
 * @function
 */
export const addStructToIdSet = (idSet, struct) => idSet.add(struct.id.client, struct.id.clock, struct.length)
