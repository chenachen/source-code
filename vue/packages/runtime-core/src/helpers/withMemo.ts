import { hasChanged } from '@vue/shared'
import { type VNode, currentBlock, isBlockTreeEnabled } from '../vnode'

/**
 * `v-memo` 的运行时缓存入口。
 *
 * 编译器为每个 `v-memo` 分配缓存下标，并把依赖值数组传入。依赖浅比较不变时直接
 * 复用旧 VNode 子树；变化时才执行 render。保存依赖时必须浅拷贝，避免用户后续修改
 * 原数组导致新旧快照指向同一对象，从而错误命中缓存。
 */
export function withMemo(
  memo: any[],
  render: () => VNode<any, any>,
  cache: any[],
  index: number,
): VNode<any, any> {
  const cached = cache[index] as VNode | undefined
  if (cached && isMemoSame(cached, memo)) {
    return cached
  }
  const ret = render()

  // 保存当前依赖快照；这里只需浅拷贝，因为比较规则本身也是逐项引用比较。
  ret.memo = memo.slice()
  ret.cacheIndex = index

  return (cache[index] = ret)
}

/**
 * 判断缓存 VNode 的 memo 依赖是否与本次渲染相同。
 *
 * 命中缓存仍需把旧 VNode 加入当前 block 的动态子节点列表。否则父 block 更新时不会
 * 再访问这棵缓存子树，后续从命中变为未命中的更新可能被跳过。
 */
export function isMemoSame(cached: VNode, memo: any[]): boolean {
  const prev: any[] = cached.memo!
  if (prev.length != memo.length) {
    return false
  }

  for (let i = 0; i < prev.length; i++) {
    if (hasChanged(prev[i], memo[i])) {
      return false
    }
  }

  // 返回缓存节点前仍让父 block 追踪它，维持 block tree 在各次渲染间的结构一致。
  if (isBlockTreeEnabled > 0 && currentBlock) {
    currentBlock.push(cached)
  }
  return true
}
