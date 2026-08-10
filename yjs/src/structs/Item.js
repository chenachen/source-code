import * as error from 'lib0/error'
import * as binary from 'lib0/binary'
import * as env from 'lib0/environment'
import * as object from 'lib0/object'

import { AbstractStruct, addStructToIdSet } from '../structs/AbstractStruct.js'

import { ID, createID, compareIDs, findRootTypeKey } from '../utils/ID.js'
import { GC } from '../structs/GC.js'

import {
  replaceStruct,
  getItemCleanEnd,
  addChangedTypeToTransaction
} from '../utils/transaction-helpers.js'

/** 是否启用开发期内容冻结检查。 */
const isDevMode = env.getVariable('node_env') === 'development'

/**
 * 沿 `redone` 链追踪操作重做后的当前 Item 与区间内偏移。
 *
 * 每跳若原 ID 落在合并 Item 内，先保留相对偏移，再把偏移应用到下一个 `redone`
 * ID；链在没有后继或落到非 Item 结构时终止。
 *
 * @todo 当前接口只返回最终一个 Item；一段内容跨越多个重做 Item 时应扩展返回值。
 *
 * @param {StructStore} store
 * @param {ID} id
 * @return {{item:Item, diff:number}}
 */
export const followRedone = (store, id) => {
  /**
   * @type {ID|null}
   */
  let nextID = id
  let diff = 0
  let item
  do {
    if (diff > 0) {
      nextID = createID(nextID.client, nextID.clock + diff)
    }
    item = store.getItem(nextID)
    diff = nextID.clock - item.id.clock
    nextID = item.redone
  } while (nextID !== null && item.isItem)
  return {
    item, diff
  }
}

/**
 * 表示可集成进共享类型的 CRDT 内容结构。
 *
 * Item 同时保存不可变的原始锚点（`origin`/`rightOrigin`）与集成后的双向链接
 * （`left`/`right`）。并发插入只依据锚点和 ID 排序，因此所有副本能收敛；删除
 * 仅设置墓碑并保留因果地址，GC 后才丢弃载荷。
 */
export class Item extends AbstractStruct {
  /**
   * 创建尚未或已经部分解析的内容结构。
   *
   * 解码阶段 `parent` 可为顶层键或父 Item ID；依赖解析完成后会替换为 `YType`。
   * `parentSub === null` 表示序列内容，否则表示映射/属性键下的版本链。
   *
   * @param {ID} id
   * @param {Item | null} left
   * @param {ID | null} origin
   * @param {Item | null} right
   * @param {ID | null} rightOrigin
   * @param {YType|ID|string|null} parent Is a type if integrated, is null if it is possible to copy parent from left or right, is ID before integration to search for it, is string if child of top-level-parent
   * @param {string | null} parentSub
   * @param {AbstractContent} content
   */
  constructor (id, left, origin, right, rightOrigin, parent, parentSub, content) {
    super(id, content.getLength())
    /**
     * 创建操作时位于左侧的稳定来源 ID；用于并发确定性排序。
     * @type {ID | null}
     */
    this.origin = origin
    /**
     * 当前集成链中的左邻 Item；切分、合并与并发集成会更新它。
     * @type {Item | null}
     */
    this.left = left
    /**
     * 当前集成链中的右邻 Item。
     * @type {Item | null}
     */
    this.right = right
    /**
     * 创建操作时位于右侧的稳定来源 ID。
     * @type {ID | null}
     */
    this.rightOrigin = rightOrigin
    /**
     * 所属共享类型；解码集成前也可暂存父 Item ID 或顶层键。
     *
     * @type {YType|ID|string|null}
     */
    this.parent = parent
    /**
     * 父类型通过键引用当前 Item 时保存该键（例如 YMap）。
     *
     * `null` 表示插入 `parent._start` 序列；非空表示进入 `parent._map` 对应键的
     * 版本链，最右侧未删除 Item 是当前可见值。
     * @type {String | null}
     */
    this.parentSub = parentSub
    /**
     * 若该操作被重做，指向承载其新效果的 Item ID。
     * @type {ID | null}
     */
    this.redone = null
    /**
     * Item 的内容策略对象，负责长度、编码和生命周期副作用。
     *
     * @type {AbstractContent}
     */
    this.content = content
    /**
     * 紧凑状态位：BIT1=阻止 GC，BIT2=计入父长度，BIT3=已删除，BIT4=快速搜索标记。
     *
     * 可计数位在构造时由内容类型确定；其余位随事务生命周期切换。
     * @type {number} byte
     */
    this.info = this.content.isCountable() ? binary.BIT2 : 0
  }

  /**
   * 设置 Item 是否作为共享类型的索引搜索标记。
   *
   * @type {boolean}
   */
  set marker (isMarked) {
    if (((this.info & binary.BIT4) > 0) !== isMarked) {
      this.info ^= binary.BIT4
    }
  }

  /** 返回 Item 是否带有快速搜索标记。 */
  get marker () {
    return (this.info & binary.BIT4) > 0
  }

  /**
   * 返回该 Item 是否受保护、禁止垃圾回收。
   */
  get keep () {
    return (this.info & binary.BIT1) > 0
  }

  /** 切换 GC 保护位；重复设置保持幂等。 */
  set keep (doKeep) {
    if (this.keep !== doKeep) {
      this.info ^= binary.BIT1
    }
  }

  /** 返回内容是否计入父序列的可见长度。 */
  get countable () {
    return (this.info & binary.BIT2) > 0
  }

  /**
   * 返回该 Item 是否已经成为删除墓碑。
   * @type {Boolean}
   */
  get deleted () {
    return (this.info & binary.BIT3) > 0
  }

  /** 切换删除位；仅在目标值变化时翻转位。 */
  set deleted (doDelete) {
    if (this.deleted !== doDelete) {
      this.info ^= binary.BIT3
    }
  }

  /** 单向设置删除位，供删除和解码删除内容路径使用。 */
  markDeleted () {
    this.info |= binary.BIT3
  }

  /**
   * 解析位置并把 Item 集成进父类型、结构存储与事务索引。
   *
   * 若只接收结构后缀，先按 `offset` 切掉已知前缀。并发冲突处理中，算法从候选
   * 左邻开始扫描：同 `origin` 的并发项按 client ID 决定顺序；来源链嵌套时保留
   * 因果先后。确定位置后一次性修复双向链接、父映射、可见长度、插入集和内容
   * 副作用。
   *
   * 边界：父依赖已 GC 或无法解析时，调用链会把 `parent` 置空，本方法转而集成
   * 等长 GC，避免悬空内容进入共享类型。
   *
   * @param {Transaction} transaction
   * @param {number} offset
   */
  integrate (transaction, offset) {
    if (offset > 0) {
      this.id.clock += offset
      this.left = getItemCleanEnd(transaction, transaction.doc.store, createID(this.id.client, this.id.clock - 1))
      this.origin = this.left.lastId
      this.content = this.content.splice(offset)
      this.length -= offset
    }

    if (this.parent) {
      if ((!this.left && (!this.right || this.right.left !== null)) || (this.left && this.left.right !== this.right)) {
        /**
         * @type {Item|null}
         */
        let left = this.left

        /**
         * @type {Item|null}
         */
        let o
        // 从第一个潜在冲突项开始扫描。
        if (left !== null) {
          o = left.right
        } else if (this.parentSub !== null) {
          o = /** @type {YType} */ (this.parent)._map.get(this.parentSub) || null
          while (o !== null && o.left !== null) {
            o = o.left
          }
        } else {
          o = /** @type {YType} */ (this.parent)._start
        }
        // @todo 可改用树形全局区间集合，避免线性维护两个临时集合。
        /**
         * @type {Set<Item>}
         */
        const conflictingItems = new Set()
        /**
         * @type {Set<Item>}
         */
        const itemsBeforeOrigin = new Set()
        // c∈conflictingItems，b∈itemsBeforeOrigin：***{origin}bbbb{this}{c,b}{c,b}{o}***。
        // 不变量：conflictingItems 始终是 itemsBeforeOrigin 的子集。
        while (o !== null && o !== this.right) {
          itemsBeforeOrigin.add(o)
          conflictingItems.add(o)
          if (compareIDs(this.origin, o.origin)) {
            // 情形 1：两个候选共享同一 origin。
            if (o.id.client < this.id.client) {
              left = o
              conflictingItems.clear()
            } else if (compareIDs(this.rightOrigin, o.rightOrigin)) {
              // 两项锚点完全相同；ID 是全局一致的最终仲裁。当前项应在 o 左侧，可停止扫描。
              break
            } // 否则 o 可能先于另一个真正冲突项；继续扫描才能确定位置。
          } else if (o.origin !== null && itemsBeforeOrigin.has(transaction.doc.store.getItem(o.origin))) { // 此处只判断来源关系，无需为精确末端切分 Item。
            // 情形 2：候选 origin 已位于当前扫描前缀。
            if (!conflictingItems.has(transaction.doc.store.getItem(o.origin))) {
              left = o
              conflictingItems.clear()
            }
          } else {
            break
          }
          o = o.right
        }
        this.left = left
      }
      // 原子修复左右链，并按需更新父类型入口或键的当前值。
      if (this.left !== null) {
        const right = this.left.right
        this.right = right
        this.left.right = this
      } else {
        let r
        if (this.parentSub !== null) {
          r = /** @type {YType} */ (this.parent)._map.get(this.parentSub) || null
          while (r !== null && r.left !== null) {
            r = r.left
          }
        } else {
          r = /** @type {YType} */ (this.parent)._start
          ;/** @type {YType} */ (this.parent)._start = this
        }
        this.right = r
      }
      if (this.right !== null) {
        this.right.left = this
      } else if (this.parentSub !== null) {
        // 键版本链最右端是当前值。
        /** @type {YType} */ (this.parent)._map.set(this.parentSub, this)
        if (this.left !== null) {
          // 新项成为当前属性值后，前一版本转为删除墓碑。
          this.left.delete(transaction)
        }
      }
      // 只有序列中的可计数、未删除内容影响父类型可见长度。
      if (this.parentSub === null && this.countable && !this.deleted) {
        /** @type {YType} */ (this.parent)._length += this.length
      }
      addStructToIdSet(transaction.insertSet, this)
      transaction.doc.store.add(this)
      this.content.integrate(transaction, this)
      // 登记父类型变更，供事务收尾生成事件。
      addChangedTypeToTransaction(transaction, /** @type {YType} */ (this.parent), this.parentSub)
      if ((/** @type {YType} */ (this.parent)._item !== null && /** @type {YType} */ (this.parent)._item.deleted) || (this.parentSub !== null && this.right !== null)) {
        // 已删除父项下的内容或非当前键值必须立即成为墓碑。
        this.delete(transaction)
      }
    } else {
      // 父上下文已不可恢复；保留时钟区间但丢弃内容。
      new GC(this.id, this.length).integrate(transaction, 0)
    }
  }

  /**
   * 返回右侧第一个未删除 Item，不改变链结构。
   */
  get next () {
    let n = this.right
    while (n !== null && n.deleted) {
      n = n.right
    }
    return n
  }

  /**
   * 返回左侧第一个未删除 Item，不改变链结构。
   */
  get prev () {
    let n = this.left
    while (n !== null && n.deleted) {
      n = n.left
    }
    return n
  }

  /**
   * 返回 Item 覆盖区间最后一个内容地址。
   */
  get lastId () {
    // 长度为 1 时复用起始 ID，减少高频遍历中的短命对象。
    return this.length === 1 ? this.id : createID(this.id.client, this.id.clock + this.length - 1)
  }

  /**
   * 在所有结构与内容不变量兼容时合并右邻 Item。
   *
   * 两项必须同类、时钟连续、左右锚点兼容、删除状态相同、均未被重做且内容策略
   * 接受合并。成功后迁移搜索标记和 keep 位、修复右链；调用方仍负责从存储数组
   * 移除被吞并项。
   *
   * @param {Item} right
   * @return {boolean}
   */
  mergeWith (right) {
    if (
      this.constructor === right.constructor &&
      compareIDs(right.origin, this.lastId) &&
      this.right === right &&
      compareIDs(this.rightOrigin, right.rightOrigin) &&
      this.id.client === right.id.client &&
      this.id.clock + this.length === right.id.clock &&
      this.deleted === right.deleted &&
      this.redone === null &&
      right.redone === null &&
      this.content.constructor === right.content.constructor &&
      this.content.mergeWith(right.content)
    ) {
      const searchMarker = /** @type {YType} */ (this.parent)._searchMarker
      if (searchMarker) {
        searchMarker.forEach(marker => {
          if (marker.p === right) {
            // right 即将从存储移除，搜索标记必须迁移到合并后的左项。
            marker.p = this
            // 未删除可计数内容合并后，标记索引需抵消左段长度。
            if (!this.deleted && this.countable) {
              marker.index -= this.length
            }
          }
        })
      }
      if (right.keep) {
        this.keep = true
      }
      this.right = right.right
      if (this.right !== null) {
        this.right.left = this
      }
      this.length += right.length
      return true
    }
    return false
  }

  /**
   * 把 Item 转为墓碑并记录事务可见副作用。
   *
   * 删除幂等；首次删除会扣减父序列长度、加入删除集、标记父类型变更，并委托
   * 内容对象释放其子资源。
   *
   * @param {Transaction} transaction
   */
  delete (transaction) {
    if (!this.deleted) {
      const parent = /** @type {YType} */ (this.parent)
      // 键值项不计入序列长度；只有普通可计数内容需要扣减。
      if (this.countable && this.parentSub === null) {
        parent._length -= this.length
      }
      this.markDeleted()
      transaction.deleteSet.add(this.id.client, this.id.clock, this.length)
      addChangedTypeToTransaction(transaction, parent, this.parentSub)
      this.content.delete(transaction)
    }
  }

  /**
   * 回收已删除 Item 的内容载荷。
   *
   * 父结构也已 GC 时，用 GC 完全替换 Item；否则保留 Item 元数据并把内容压缩为
   * `ContentDeleted`，使尚需解析其锚点的更新仍可工作。
   *
   * @param {Transaction} tr
   * @param {boolean} parentGCd
   */
  gc (tr, parentGCd) {
    if (!this.deleted) {
      throw error.unexpectedCase()
    }
    this.content.gc(tr)
    if (parentGCd) {
      replaceStruct(tr, this, new GC(this.id, this.length))
    } else {
      this.content = new ContentDeleted(this.length)
    }
  }

  /**
   * 在内容偏移处分裂 Item，当前对象保留左段并返回右段。
   *
   * 删除、keep 与 redone 状态按对应时钟偏移传播。事务内切分还会修复双向链、
   * 键当前值与待合并队列；无事务切分用于惰性编码，返回段不挂接文档链。
   * @param {Transaction?} transaction
   * @param {number} diff
   * @return {Item}
   */
  split (transaction, diff) {
    // 右段继承稳定锚点和父上下文，origin 指向左段最后一个时钟。
    const { client, clock } = this.id
    const rightItem = new Item(
      createID(client, clock + diff),
      this,
      createID(client, clock + diff - 1),
      this.right,
      this.rightOrigin,
      this.parent,
      this.parentSub,
      this.content.splice(diff)
    )
    if (this.deleted) {
      rightItem.markDeleted()
    }
    if (this.keep) {
      rightItem.keep = true
    }
    if (this.redone !== null) {
      rightItem.redone = createID(this.redone.client, this.redone.clock + diff)
    }
    if (transaction != null) {
      // 不改左段 rightOrigin；它是创建时的稳定锚点，改动会破坏跨副本排序。
      this.right = rightItem
      // 修复右邻回链。
      if (rightItem.right !== null) {
        rightItem.right.left = rightItem
      }
      // 右段边界更具体，事务收尾优先尝试将其重新合并。
      transaction._mergeStructs.push(rightItem)
      // 若原项是键版本链末端，右段成为新的当前值指针。
      if (rightItem.parentSub !== null && rightItem.right === null) {
        /** @type {YType} */ (rightItem.parent)._map.set(rightItem.parentSub, rightItem)
      }
    } else {
      rightItem.left = null
      rightItem.right = null
    }
    this.length = diff
    return rightItem
  }

  /**
   * 把 Item 的定位元数据与内容切片写入更新编码器。
   *
   * `info` 低五位是内容引用号，高三位声明 origin、rightOrigin、parentSub 是否
   * 存在。只有左右来源均缺失时才显式写父引用；否则接收方可从相邻 Item 复制父
   * 上下文，从而缩短更新。
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder 目标更新编码器。
   * @param {number} offset
   * @param {number} offsetEnd
   */
  write (encoder, offset, offsetEnd) {
    const origin = offset > 0 ? createID(this.id.client, this.id.clock + offset - 1) : this.origin
    const rightOrigin = this.rightOrigin
    const parentSub = this.parentSub
    const info = (this.content.getRef() & binary.BITS5) |
      (origin === null ? 0 : binary.BIT8) | // 携带 origin。
      (rightOrigin === null ? 0 : binary.BIT7) | // 携带 rightOrigin。
      (parentSub === null ? 0 : binary.BIT6) // 携带非空 parentSub。
    encoder.writeInfo(info)
    if (origin !== null) {
      encoder.writeLeftID(origin)
    }
    if (rightOrigin !== null) {
      encoder.writeRightID(rightOrigin)
    }
    if (origin === null && rightOrigin === null) {
      const parent = /** @type {YType} */ (this.parent)
      if (parent._item !== undefined) {
        const parentItem = parent._item
        if (parentItem === null) {
          // 顶层父类型没有父 Item，需要反向查找 doc.share 键。
          const ykey = findRootTypeKey(parent)
          encoder.writeParentInfo(true) // 父引用写为顶层键。
          encoder.writeString(ykey)
        } else {
          encoder.writeParentInfo(false) // 父引用写为 Item ID。
          encoder.writeLeftID(parentItem.id)
        }
      } else if (parent.constructor === String) { // 差分更新可直接携带尚未解析的顶层键。
        encoder.writeParentInfo(true) // 父引用写为顶层键。
        encoder.writeString(parent)
      } else if (parent.constructor === ID) {
        encoder.writeParentInfo(false) // 父引用写为 Item ID。
        encoder.writeLeftID(parent)
      } else {
        error.unexpectedCase()
      }
      if (parentSub !== null) {
        encoder.writeString(parentSub)
      }
    }
    this.content.write(encoder, offset, offsetEnd)
  }

  /** 返回内容策略的稳定线格式引用号。 */
  get ref () {
    return this.content.getRef()
  }
}

/**
 * 标记 Item 是可承载内容的结构类型。
 *
 * @type {true}
 */
Item.prototype.isItem = true

/**
 * 规定 Item 内容策略必须实现的生命周期与编解码协议。
 *
 * 该类只用于文档化接口，不能直接实例化或继承一个不完整实现；每种内容必须给出
 * 稳定引用号，并保持 `getLength()` 与切分、写入长度一致。
 */
export class AbstractContent {
  /**
   * 返回内容占用的 CRDT 时钟长度。
   *
   * @return {number}
   */
  getLength () {
    throw error.methodUnimplemented()
  }

  /**
   * 返回对共享类型 API 可见的值数组。
   *
   * @return {Array<any>}
   */
  getContent () {
    throw error.methodUnimplemented()
  }

  /**
   * 返回内容是否可按序列索引访问并计入共享类型长度。
   *
   * 格式标记等元信息返回 false；普通用户内容返回 true。
   *
   * @return {boolean}
   */
  isCountable () {
    throw error.methodUnimplemented()
  }

  /**
   * 创建未集成的浅副本。
   *
   * @return {AbstractContent}
   */
  copy () {
    throw error.methodUnimplemented()
  }

  /**
   * 在内容偏移处分裂，并返回右半段。
   *
   * @param {number} _offset
   * @return {AbstractContent}
   */
  splice (_offset) {
    throw error.methodUnimplemented()
  }

  /**
   * 尝试把同类右侧内容合并进当前对象。
   *
   * @param {AbstractContent} _right
   * @return {boolean}
   */
  mergeWith (_right) {
    throw error.methodUnimplemented()
  }

  /**
   * 在宿主 Item 集成后执行内容特有的挂接副作用。
   *
   * @param {Transaction} _transaction
   * @param {Item} _item
   */
  integrate (_transaction, _item) {
    throw error.methodUnimplemented()
  }

  /**
   * 在宿主 Item 首次删除时执行内容特有的清理。
   *
   * @param {Transaction} _transaction
   */
  delete (_transaction) {
    throw error.methodUnimplemented()
  }

  /**
   * 在宿主墓碑被回收时释放内容持有的资源。
   *
   * @param {Transaction} _transaction
   */
  gc (_transaction) {
    throw error.methodUnimplemented()
  }

  /**
   * 编码指定首尾裁剪后的内容切片。
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} _encoder
   * @param {number} _offset
   * @param {number} _offsetEnd
   */
  write (_encoder, _offset, _offsetEnd) {
    throw error.methodUnimplemented()
  }

  /**
   * 返回更新线格式中的稳定内容引用号。
   *
   * @return {1|2|3|4|5|6|7|8|9}
   */
  getRef () {
    throw error.methodUnimplemented()
  }
}

/** 使用 lib0 any 编码承载一段任意 JavaScript 值。 */
export class ContentAny {
  /**
   * 创建任意值数组内容；开发模式下冻结输入以暴露外部突变。
   *
   * @param {Array<any>} arr
   */
  constructor (arr) {
    /**
     * 内容值数组；其元素个数就是结构时钟长度。
     *
     * @type {Array<any>}
     */
    this.arr = arr
    isDevMode && object.deepFreeze(arr)
  }

  /**
   * 返回数组元素数量。
   *
   * @return {number}
   */
  getLength () {
    return this.arr.length
  }

  /**
   * 返回原始值数组。
   *
   * @return {Array<any>}
   */
  getContent () {
    return this.arr
  }

  /**
   * 任意值是可计数的序列内容。
   *
   * @return {boolean}
   */
  isCountable () {
    return true
  }

  /**
   * 创建共享同一值数组引用的浅副本；集成内容按不可变约定使用。
   *
   * @return {ContentAny}
   */
  copy () {
    return new ContentAny(this.arr)
  }

  /**
   * 按数组下标切分内容并让当前对象保留左段。
   *
   * @param {number} offset
   * @return {ContentAny}
   */
  splice (offset) {
    const right = new ContentAny(this.arr.slice(offset))
    this.arr = this.arr.slice(0, offset)
    return right
  }

  /**
   * 连接右侧任意值数组。
   *
   * @param {ContentAny} right
   * @return {boolean}
   */
  mergeWith (right) {
    this.arr = this.arr.concat(right.arr)
    return true
  }

  /**
   * 普通值无集成副作用。
   *
   * @param {Transaction} _transaction
   * @param {Item} _item
   */
  integrate (_transaction, _item) {}
  /**
   * 普通值无删除副作用。
   *
   * @param {Transaction} _transaction
   */
  delete (_transaction) {}
  /**
   * 普通值无额外 GC 资源。
   *
   * @param {Transaction} _tr
   */
  gc (_tr) {}
  /**
   * 写入裁剪后的元素数量，并逐项使用 any 编码。
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   * @param {number} offsetEnd
   */
  write (encoder, offset, offsetEnd) {
    const end = this.arr.length - offsetEnd
    encoder.writeLen(end - offset)
    for (let i = offset; i < end; i++) {
      const c = this.arr[i]
      encoder.writeAny(c)
    }
  }

  /**
   * 返回 `ContentAny` 的线格式引用号 8。
   *
   * @return {8}
   */
  getRef () {
    return 8
  }
}

/** 承载一个不可分割的二进制值。 */
export class ContentBinary {
  /**
   * 创建单值二进制内容。
   *
   * @param {Uint8Array} content
   */
  constructor (content) {
    this.content = content
  }

  /**
   * 二进制块作为一个 CRDT 元素计数。
   *
   * @return {number}
   */
  getLength () {
    return 1
  }

  /**
   * 以单元素数组返回二进制值。
   *
   * @return {Array<any>}
   */
  getContent () {
    return [this.content]
  }

  /**
   * 二进制块可按序列索引访问。
   *
   * @return {boolean}
   */
  isCountable () {
    return true
  }

  /**
   * 创建共享同一字节数组引用的浅副本。
   *
   * @return {ContentBinary}
   */
  copy () {
    return new ContentBinary(this.content)
  }

  /**
   * 二进制单值不可在内部切分。
   *
   * @param {number} _offset
   * @return {ContentBinary}
   */
  splice (_offset) {
    throw error.methodUnimplemented()
  }

  /**
   * 两个二进制值不能合并成一个结构内容。
   *
   * @param {ContentBinary} _right
   * @return {boolean}
   */
  mergeWith (_right) {
    return false
  }

  /**
   * 二进制值无集成副作用。
   *
   * @param {Transaction} _transaction
   * @param {Item} _item
   */
  integrate (_transaction, _item) {}
  /**
   * 二进制值无删除副作用。
   *
   * @param {Transaction} _transaction
   */
  delete (_transaction) {}
  /**
   * 二进制值无额外 GC 资源。
   *
   * @param {Transaction} _tr
   */
  gc (_tr) {}
  /**
   * 以带长度前缀的字节数组写入完整值。
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} _offset
   * @param {number} _offsetEnd
   */
  write (encoder, _offset, _offsetEnd) {
    encoder.writeBuf(this.content)
  }

  /**
   * 返回 `ContentBinary` 的线格式引用号 3。
   *
   * @return {3}
   */
  getRef () {
    return 3
  }
}

/** 表示已经丢弃载荷、只保留长度的删除内容。 */
export class ContentDeleted {
  /**
   * 创建指定时钟长度的删除占位内容。
   *
   * @param {number} len
   */
  constructor (len) {
    this.len = len
  }

  /**
   * 返回墓碑区间长度。
   *
   * @return {number}
   */
  getLength () {
    return this.len
  }

  /**
   * 删除内容不向共享类型暴露任何值。
   *
   * @return {Array<any>}
   */
  getContent () {
    return []
  }

  /**
   * 删除占位不计入可见长度。
   *
   * @return {boolean}
   */
  isCountable () {
    return false
  }

  /**
   * 复制删除区间长度。
   *
   * @return {ContentDeleted}
   */
  copy () {
    return new ContentDeleted(this.len)
  }

  /**
   * 按时钟偏移拆分删除区间。
   *
   * @param {number} offset
   * @return {ContentDeleted}
   */
  splice (offset) {
    const right = new ContentDeleted(this.len - offset)
    this.len = offset
    return right
  }

  /**
   * 连接右侧删除区间并累加长度。
   *
   * @param {ContentDeleted} right
   * @return {boolean}
   */
  mergeWith (right) {
    this.len += right.len
    return true
  }

  /**
   * 集成预删除内容时同步登记删除集并设置宿主删除位。
   *
   * @param {Transaction} transaction
   * @param {Item} item
   */
  integrate (transaction, item) {
    transaction.deleteSet.add(item.id.client, item.id.clock, this.len)
    item.markDeleted()
  }

  /**
   * 删除占位已处于删除终态，无额外副作用。
   *
   * @param {Transaction} _transaction
   */
  delete (_transaction) {}
  /**
   * 删除占位没有可继续回收的资源。
   *
   * @param {Transaction} _tr
   */
  gc (_tr) {}
  /**
   * 写入裁剪后的删除区间长度。
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   * @param {number} offsetEnd
   */
  write (encoder, offset, offsetEnd) {
    encoder.writeLen(this.len - offset - offsetEnd)
  }

  /**
   * 返回 `ContentDeleted` 的线格式引用号 1。
   *
   * @return {1}
   */
  getRef () {
    return 1
  }
}

/**
 * 以 GUID 与选项承载一个嵌套 Yjs 子文档。
 *
 * 子文档实例在集成时按宿主文档构造器惰性创建，避免 `Item.js` 直接导入 Doc
 * 形成循环依赖；事务集合负责对外发布新增、加载和移除事件。
 * @private
 */
export class ContentDoc {
  /**
   * 创建尚未挂接宿主 Item 的子文档描述。
   *
   * @param {string} guid
   * @param {Object<string,any>} opts
   */
  constructor (guid, opts) {
    /**
     * 已集成的子文档实例；集成前为空。
     *
     * @type {Doc?}
     */
    this.doc = null
    this.guid = guid
    this.opts = opts
  }

  /**
   * 子文档作为一个 CRDT 元素计数。
   *
   * @return {number}
   */
  getLength () {
    return 1
  }

  /**
   * 返回当前子文档实例。
   *
   * @return {Array<any>}
   */
  getContent () {
    return [this.doc]
  }

  /**
   * 子文档可按序列索引访问。
   *
   * @return {boolean}
   */
  isCountable () {
    return true
  }

  /**
   * 复制 GUID 与选项，但不复用已挂接的文档实例。
   *
   * @return {ContentDoc}
   */
  copy () {
    return new ContentDoc(this.guid, this.opts)
  }

  /**
   * 子文档单值不可在内部切分。
   *
   * @param {number} _offset
   * @return {ContentDoc}
   */
  splice (_offset) {
    throw error.methodUnimplemented()
  }

  /**
   * 两个子文档内容不能合并。
   *
   * @param {ContentDoc} _right
   * @return {boolean}
   */
  mergeWith (_right) {
    return false
  }

  /**
   * 创建或复用子文档，并把它挂到宿主 Item 与事务事件集合。
   *
   * WHY：通过 `transaction.doc.constructor` 构造可保留宿主的 Doc 子类，又避免
   * 模块循环依赖。`shouldLoad` 同时兼容显式、自动加载选项。
   *
   * @param {Transaction} transaction
   * @param {Item} item
   */
  integrate (transaction, item) {
    const opts = this.opts
    if (this.doc == null) {
      // 从宿主文档取得构造器，既保留子类又避免直接导入 Doc 造成循环依赖。
      this.doc = /** @type {Doc} */ (new /** @type {any} */ (transaction.doc.constructor)({ guid: this.guid, ...this.opts, shouldLoad: opts.shouldLoad || opts.autoLoad || false }))
    }
    this.doc._item = item
    transaction.subdocsAdded.add(this.doc)
    if (this.doc.shouldLoad) {
      transaction.subdocsLoaded.add(this.doc)
    }
  }

  /**
   * 从事务新增集合撤回子文档，或登记为已移除。
   *
   * @param {Transaction} transaction
   */
  delete (transaction) {
    if (this.doc) {
      if (transaction.subdocsAdded.has(this.doc)) {
        transaction.subdocsAdded.delete(this.doc)
      } else {
        transaction.subdocsRemoved.add(this.doc)
      }
    }
  }

  /**
   * 子文档实例生命周期由事务事件处理，无额外 GC 操作。
   *
   * @param {Transaction} _tr
   */
  gc (_tr) {}

  /**
   * 写入子文档 GUID 与构造选项。
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} _offset
   * @param {number} _offsetEnd
   */
  write (encoder, _offset, _offsetEnd) {
    encoder.writeString(this.guid)
    encoder.writeAny(this.opts)
  }

  /**
   * 返回 `ContentDoc` 的线格式引用号 9。
   *
   * @return {9}
   */
  getRef () {
    return 9
  }
}

/**
 * 从现有 Doc 提取同步所需选项并创建已绑定的 `ContentDoc`。
 *
 * 只传播会改变远端子文档语义的 `gc`、`autoLoad` 与 `meta`；返回对象复用传入
 * Doc，等待宿主 Item 集成完成反向链接。
 *
 * @param {Doc} ydoc
 */
export const createContentDocFromDoc = ydoc => {
  /**
   * @type {any}
   */
  const opts = {}
  if (!ydoc.gc) {
    opts.gc = false
  }
  if (ydoc.autoLoad) {
    opts.autoLoad = true
  }
  if (ydoc.meta !== null) {
    opts.meta = ydoc.meta
  }
  const c = new ContentDoc(ydoc.guid, opts)
  c.doc = ydoc
  return c
}

/**
 * 承载一个不可分割的富文本嵌入对象。
 *
 * @private
 */
export class ContentEmbed {
  /**
   * 创建嵌入内容。
   *
   * @param {Object} embed
   */
  constructor (embed) {
    this.embed = embed
  }

  /**
   * 嵌入对象作为一个 CRDT 元素计数。
   *
   * @return {number}
   */
  getLength () {
    return 1
  }

  /**
   * 以单元素数组返回嵌入对象。
   *
   * @return {Array<any>}
   */
  getContent () {
    return [this.embed]
  }

  /**
   * 嵌入对象可按序列索引访问。
   *
   * @return {boolean}
   */
  isCountable () {
    return true
  }

  /**
   * 创建共享同一嵌入对象引用的浅副本。
   *
   * @return {ContentEmbed}
   */
  copy () {
    return new ContentEmbed(this.embed)
  }

  /**
   * 嵌入单值不可在内部切分。
   *
   * @param {number} _offset
   * @return {ContentEmbed}
   */
  splice (_offset) {
    throw error.methodUnimplemented()
  }

  /**
   * 两个嵌入对象不能合并。
   *
   * @param {ContentEmbed} _right
   * @return {boolean}
   */
  mergeWith (_right) {
    return false
  }

  /**
   * 嵌入对象无集成副作用。
   *
   * @param {Transaction} _transaction
   * @param {Item} _item
   */
  integrate (_transaction, _item) {}
  /**
   * 嵌入对象无删除副作用。
   *
   * @param {Transaction} _transaction
   */
  delete (_transaction) {}
  /**
   * 嵌入对象无额外 GC 资源。
   *
   * @param {Transaction} _tr
   */
  gc (_tr) {}
  /**
   * 使用兼容编码器的 JSON/any 通道写入嵌入对象。
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} _offset
   * @param {number} _offsetEnd
   */
  write (encoder, _offset, _offsetEnd) {
    encoder.writeJSON(this.embed)
  }

  /**
   * 返回 `ContentEmbed` 的线格式引用号 5。
   *
   * @return {5}
   */
  getRef () {
    return 5
  }
}

/**
 * 表示富文本格式键值的非计数元数据 Item。
 *
 * 格式标记不出现在普通内容数组中；它改变后续文本解释，并使父类型进入格式化
 * 模式。
 *
 * @private
 */
export class ContentFormat {
  /**
   * 创建格式键及其起止值；`null` 通常表示结束该格式范围。
   *
   * @param {string} key
   * @param {Object} value
   */
  constructor (key, value) {
    this.key = key
    this.value = value
  }

  /**
   * 格式标记占用一个逻辑时钟。
   *
   * @return {number}
   */
  getLength () {
    return 1
  }

  /**
   * 格式元信息不直接暴露为用户内容。
   *
   * @return {Array<any>}
   */
  getContent () {
    return []
  }

  /**
   * 格式标记不计入共享类型可见长度。
   *
   * @return {boolean}
   */
  isCountable () {
    return false
  }

  /**
   * 复制格式键值。
   *
   * @return {ContentFormat}
   */
  copy () {
    return new ContentFormat(this.key, this.value)
  }

  /**
   * 格式标记单值不可在内部切分。
   *
   * @param {number} _offset
   * @return {ContentFormat}
   */
  splice (_offset) {
    throw error.methodUnimplemented()
  }

  /**
   * 相邻格式标记不合并，避免改变格式边界语义。
   *
   * @param {ContentFormat} _right
   * @return {boolean}
   */
  mergeWith (_right) {
    return false
  }

  /**
   * 标记父文本存在格式并禁用当前不支持的搜索标记缓存。
   *
   * @param {Transaction} _transaction
   * @param {Item} item
   */
  integrate (_transaction, item) {
    // @todo 富文本当前不支持 search marker；发现格式项后禁用现有缓存。
    const p = /** @type {import('../ytype.js').YType<any>} */ (item.parent)
    p._searchMarker = null
    p._hasFormatting = true
  }

  /**
   * 删除格式项无需额外资源清理。
   *
   * @param {Transaction} _transaction
   */
  delete (_transaction) {}
  /**
   * 格式项无额外 GC 资源。
   *
   * @param {Transaction} _tr
   */
  gc (_tr) {}
  /**
   * 写入格式键和值；V2 可分别压缩重复键和任意值。
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} _offset
   * @param {number} _offsetEnd
   */
  write (encoder, _offset, _offsetEnd) {
    encoder.writeKey(this.key)
    encoder.writeJSON(this.value)
  }

  /**
   * 返回 `ContentFormat` 的线格式引用号 6。
   *
   * @return {6}
   */
  getRef () {
    return 6
  }
}

/**
 * 使用字符串化 JSON 兼容格式承载一段值数组。
 *
 * 该内容类型保留旧更新兼容性；新值通常由 `ContentAny` 编码。
 *
 * @private
 */
export class ContentJSON {
  /**
   * 创建 JSON 兼容值数组。
   *
   * @param {Array<any>} arr
   */
  constructor (arr) {
    /**
     * 每个元素对应一个 CRDT 时钟。
     *
     * @type {Array<any>}
     */
    this.arr = arr
  }

  /**
   * 返回数组元素数量。
   *
   * @return {number}
   */
  getLength () {
    return this.arr.length
  }

  /**
   * 返回原始值数组。
   *
   * @return {Array<any>}
   */
  getContent () {
    return this.arr
  }

  /**
   * JSON 值是可计数内容。
   *
   * @return {boolean}
   */
  isCountable () {
    return true
  }

  /**
   * 创建共享同一值数组引用的浅副本。
   *
   * @return {ContentJSON}
   */
  copy () {
    return new ContentJSON(this.arr)
  }

  /**
   * 按数组下标切分内容。
   *
   * @param {number} offset
   * @return {ContentJSON}
   */
  splice (offset) {
    const right = new ContentJSON(this.arr.slice(offset))
    this.arr = this.arr.slice(0, offset)
    return right
  }

  /**
   * 连接右侧 JSON 值数组。
   *
   * @param {ContentJSON} right
   * @return {boolean}
   */
  mergeWith (right) {
    this.arr = this.arr.concat(right.arr)
    return true
  }

  /**
   * JSON 值无集成副作用。
   *
   * @param {Transaction} _transaction
   * @param {Item} _item
   */
  integrate (_transaction, _item) {}
  /**
   * JSON 值无删除副作用。
   *
   * @param {Transaction} _transaction
   */
  delete (_transaction) {}
  /**
   * JSON 值无额外 GC 资源。
   *
   * @param {Transaction} _tr
   */
  gc (_tr) {}
  /**
   * 写入裁剪后的元素数量与逐项字符串表示。
   *
   * `undefined` 使用专用字面量，其他值由 `JSON.stringify` 生成，匹配旧版解码。
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   * @param {number} offsetEnd
   */
  write (encoder, offset, offsetEnd) {
    const end = this.arr.length - offsetEnd
    encoder.writeLen(end - offset)
    for (let i = offset; i < end; i++) {
      const c = this.arr[i]
      encoder.writeString(c === undefined ? 'undefined' : JSON.stringify(c))
    }
  }

  /**
   * 返回 `ContentJSON` 的线格式引用号 2。
   *
   * @return {2}
   */
  getRef () {
    return 2
  }
}

/**
 * 承载一段可切分、可合并的 UTF-16 字符串。
 *
 * @private
 */
export class ContentString {
  /**
   * 创建字符串内容。
   *
   * @param {string} str
   */
  constructor (str) {
    /**
     * UTF-16 代码单元字符串；长度同时作为 CRDT 时钟长度。
     *
     * @type {string}
     */
    this.str = str
  }

  /**
   * 返回 UTF-16 代码单元数量。
   *
   * @return {number}
   */
  getLength () {
    return this.str.length
  }

  /**
   * 把字符串拆成共享类型 API 使用的字符数组。
   *
   * @return {Array<any>}
   */
  getContent () {
    return this.str.split('')
  }

  /**
   * 字符串内容可计数。
   *
   * @return {boolean}
   */
  isCountable () {
    return true
  }

  /**
   * 复制字符串值。
   *
   * @return {ContentString}
   */
  copy () {
    return new ContentString(this.str)
  }

  /**
   * 按 UTF-16 偏移切分字符串，并修复被切开的代理对。
   *
   * WHY：孤立高/低代理会生成不可编码文档；若边界落在代理对中间，两侧都改为
   * U+FFFD，使长度不变且更新保持有效。对应历史场景：yjs/yjs#248。
   *
   * @param {number} offset
   * @return {ContentString}
   */
  splice (offset) {
    const right = new ContentString(this.str.slice(offset))
    this.str = this.str.slice(0, offset)

    // 防止切开代理对后编码出非法文档：https://github.com/yjs/yjs/issues/248
    const firstCharCode = this.str.charCodeAt(offset - 1)
    if (firstCharCode >= 0xD800 && firstCharCode <= 0xDBFF) {
      // 左段末尾是代理对高位；两侧孤立代码单元都替换为 Unicode 替换字符 U+FFFD。
      this.str = this.str.slice(0, offset - 1) + '�'
      // 右段同步替换，保持两段总长度与原时钟区间一致。
      right.str = '�' + right.str.slice(1)
    }
    return right
  }

  /**
   * 拼接右侧字符串内容。
   *
   * @param {ContentString} right
   * @return {boolean}
   */
  mergeWith (right) {
    this.str += right.str
    return true
  }

  /**
   * 字符串无集成副作用。
   *
   * @param {Transaction} _transaction
   * @param {Item} _item
   */
  integrate (_transaction, _item) {}
  /**
   * 字符串无删除副作用。
   *
   * @param {Transaction} _transaction
   */
  delete (_transaction) {}
  /**
   * 字符串无额外 GC 资源。
   *
   * @param {Transaction} _tr
   */
  gc (_tr) {}
  /**
   * 写入首尾裁剪后的字符串切片。
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   * @param {number} offsetEnd
   */
  write (encoder, offset, offsetEnd) {
    encoder.writeString((offset === 0 && offsetEnd === 0) ? this.str : this.str.slice(offset, this.str.length - offsetEnd))
  }

  /**
   * 返回 `ContentString` 的线格式引用号 4。
   *
   * @return {4}
   */
  getRef () {
    return 4
  }
}

/** `YArray` 嵌套类型的稳定线格式引用号。 */
export const YArrayRefID = 0
/** `YMap` 嵌套类型的稳定线格式引用号。 */
export const YMapRefID = 1
/** `YText` 嵌套类型的稳定线格式引用号。 */
export const YTextRefID = 2
/** `YXmlElement` 嵌套类型的稳定线格式引用号。 */
export const YXmlElementRefID = 3
/** `YXmlFragment` 嵌套类型的稳定线格式引用号。 */
export const YXmlFragmentRefID = 4
/** `YXmlHook` 嵌套类型的稳定线格式引用号。 */
export const YXmlHookRefID = 5
/** `YXmlText` 嵌套类型的稳定线格式引用号。 */
export const YXmlTextRefID = 6

/**
 * 承载嵌套共享类型及其整个子树。
 *
 * 集成时把类型绑定到宿主文档和 Item；删除/GC 必须递归处理子结构，保证父项
 * 生命周期覆盖所有后代。
 *
 * @private
 */
export class ContentType {
  /**
   * 创建嵌套共享类型内容。
   *
   * @param {import('../ytype.js').YType} type
   */
  constructor (type) {
    /**
     * 尚未或已经集成的共享类型实例。
     *
     * @type {import('../ytype.js').YType}
     */
    this.type = type
  }

  /**
   * 嵌套类型作为一个 CRDT 元素计数。
   *
   * @return {number}
   */
  getLength () {
    return 1
  }

  /**
   * 以单元素数组返回嵌套共享类型。
   *
   * @return {Array<any>}
   */
  getContent () {
    return [this.type]
  }

  /**
   * 嵌套类型可按序列索引访问。
   *
   * @return {boolean}
   */
  isCountable () {
    return true
  }

  /**
   * 通过类型自身 `_copy()` 创建未集成副本。
   *
   * @return {ContentType}
   */
  copy () {
    return new ContentType(this.type._copy())
  }

  /**
   * 嵌套类型单值不可在内部切分。
   *
   * @param {number} _offset
   * @return {ContentType}
   */
  splice (_offset) {
    throw error.methodUnimplemented()
  }

  /**
   * 两个嵌套类型不能合并。
   *
   * @param {ContentType} _right
   * @return {boolean}
   */
  mergeWith (_right) {
    return false
  }

  /**
   * 把嵌套类型绑定到事务文档与宿主 Item。
   *
   * @param {Transaction} transaction
   * @param {Item} item
   */
  integrate (transaction, item) {
    this.type._integrate(transaction.doc, item)
  }

  /**
   * 递归删除嵌套类型的序列与映射内容。
   *
   * 已删除且非本事务新插入的后代仍加入 `_mergeStructs`；WHY：它们不会再次进入
   * 删除集，若不显式登记，事务收尾就不知道需要尝试合并这些墓碑。
   *
   * @param {Transaction} transaction
   */
  delete (transaction) {
    let item = this.type._start
    while (item !== null) {
      if (!item.deleted) {
        item.delete(transaction)
      } else if (!transaction.insertSet.hasId(item.id)) {
        // 该旧墓碑不在本事务删除集中，显式登记后事务收尾才能尝试合并。
        transaction._mergeStructs.push(item)
      }
      item = item.right
    }
    this.type._map.forEach(item => {
      if (!item.deleted) {
        item.delete(transaction)
      } else if (!transaction.insertSet.hasId(item.id)) {
        // 与序列分支相同：补登记旧墓碑的合并机会。
        transaction._mergeStructs.push(item)
      }
    })
  }

  /**
   * 递归 GC 嵌套类型全部后代并清空类型入口。
   *
   * @param {Transaction} tr
   */
  gc (tr) {
    let item = this.type._start
    while (item !== null) {
      item.gc(tr, true)
      item = item.right
    }
    this.type._start = null
    this.type._map.forEach(/** @param {Item | null} item */ (item) => {
      while (item !== null) {
        item.gc(tr, true)
        item = item.left
      }
    })
    this.type._map = new Map()
  }

  /**
   * 委托嵌套类型写出其稳定类型引用和类型元数据。
   *
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} _offset
   * @param {number} _offsetEnd
   */
  write (encoder, _offset, _offsetEnd) {
    this.type._write(encoder)
  }

  /**
   * 返回 `ContentType` 的线格式引用号 7。
   *
   * @return {7}
   */
  getRef () {
    return 7
  }
}
