import { ShapeFlags } from '@vue/shared'
import type { ComponentInternalInstance } from '../component'
import type { ComponentPublicInstance } from '../componentPublicInstance'
import type { VNode } from '../vnode'
import { DeprecationTypes, assertCompatEnabled } from './compatConfig'

/**
 * 实现 Vue 2 `$children`：遍历当前渲染子树，收集第一层组件公共实例。
 * 遇到组件即停止下钻，遇到 Fragment/元素的数组 children 则继续寻找；返回顺序不应
 * 被业务依赖，因为 Vue 3 已移除此 API。
 */
export function getCompatChildren(
  instance: ComponentInternalInstance,
): ComponentPublicInstance[] {
  assertCompatEnabled(DeprecationTypes.INSTANCE_CHILDREN, instance)
  const root = instance.subTree
  const children: ComponentPublicInstance[] = []
  if (root) {
    walk(root, children)
  }
  return children
}

/** 深入非组件 VNode，收集最近的组件根。 */
function walk(vnode: VNode, children: ComponentPublicInstance[]) {
  if (vnode.component) {
    children.push(vnode.component.proxy!)
  } else if (vnode.shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
    const vnodes = vnode.children as VNode[]
    for (let i = 0; i < vnodes.length; i++) {
      walk(vnodes[i], children)
    }
  }
}
