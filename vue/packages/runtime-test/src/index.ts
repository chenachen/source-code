import {
  type CreateAppFunction,
  type RootRenderFunction,
  type VNode,
  createRenderer,
} from '@vue/runtime-core'
import { type TestElement, nodeOps } from './nodeOps'
import { patchProp } from './patchProp'
import { serializeInner } from './serialize'
import { extend } from '@vue/shared'

/** 以 nodeOps 与 patchProp 建立测试 renderer；后续 render/createApp 共享该渲染器。 */
const { render: baseRender, createApp: baseCreateApp } = createRenderer(
  extend({ patchProp }, nodeOps),
)

/** 把 core 的根 render 绑定到 TestElement 宿主签名，复用原函数身份。 */
export const render = baseRender as RootRenderFunction<TestElement>
/** 把 core 的应用工厂绑定到 TestElement 容器签名。 */
export const createApp = baseCreateApp as CreateAppFunction<TestElement>

// 一次性客户端渲染验证入口；仅序列化测试宿主树。
/** 为一次 VNode 验证创建临时根容器，完成客户端 render 后返回其 children 序列化字符串；不是 server-renderer。 */
export function renderToString(vnode: VNode): string {
  const root = nodeOps.createElement('div')
  render(vnode, root)
  return serializeInner(root)
}

export * from './triggerEvent'
export * from './serialize'
export * from './nodeOps'
export * from '@vue/runtime-core'
