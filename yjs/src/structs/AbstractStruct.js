import * as error from 'lib0/error'

/**
 * 定义 `StructStore` 中所有连续时钟区间结构的共同协议。
 *
 * `Item`、`GC` 与 `Skip` 都以 `[id.clock, id.clock + length)` 占据某个客户端的
 * 连续时钟区间；子类负责实现集成、切分与更新编码。抽象实现主动抛错，避免把
 * 未实现的结构静默写入文档状态。
 */
export class AbstractStruct {
  /**
   * 创建一个由起始 ID 与区间长度标识的结构。
   *
   * @param {ID} id
   * @param {number} length
   */
  constructor (id, length) {
    this.id = id
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
   * 调用方必须保证两段时钟连续；本方法只修改当前结构，**不会**从
   * `StructStore` 删除 `right`，数组清理由事务收尾阶段负责。
   *
   * @param {GC|Item|Skip} _right
   * @return {boolean} 是否成功合并。
   */
  mergeWith (_right) {
    return false
  }

  /**
   * 将指定切片写入更新编码器；具体二进制布局由子类决定。
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} _encoder 目标更新编码器。
   * @param {number} _offset
   * @param {number} _encodingRef
   */
  write (_encoder, _offset, _encodingRef) {
    throw error.methodUnimplemented()
  }

  /**
   * 把结构集成进事务及其 `StructStore`。
   *
   * @param {Transaction} _transaction
   * @param {number} _offset
   */
  integrate (_transaction, _offset) {
    throw error.methodUnimplemented()
  }

  /**
   * 在区间内切分结构并返回右半段。
   *
   * @param {number} _diff
   * @return {GC|Item|Skip}
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
 * @param {IdSet} idSet
 * @param {AbstractStruct} struct
 *
 * @private
 * @function
 */
export const addStructToIdSet = (idSet, struct) => idSet.add(struct.id.client, struct.id.clock, struct.length)
