import {
  EMPTY_ARR,
  PatchFlags,
  ShapeFlags,
  SlotFlags,
  extend,
  isArray,
  isFunction,
  isModelListener,
  isObject,
  isOn,
  isString,
  normalizeClass,
  normalizeStyle,
} from '@vue/shared'
import {
  type ClassComponent,
  type Component,
  type ComponentInternalInstance,
  type ConcreteComponent,
  type Data,
  isClassComponent,
} from './component'
import type { RawSlots } from './componentSlots'
import {
  type ReactiveFlags,
  type Ref,
  isProxy,
  isRef,
  toRaw,
} from '@vue/reactivity'
import type { AppContext } from './apiCreateApp'
import {
  type Suspense,
  type SuspenseBoundary,
  type SuspenseImpl,
  isSuspense,
} from './components/Suspense'
import type { DirectiveBinding } from './directives'
import {
  type TransitionHooks,
  setTransitionHooks,
} from './components/BaseTransition'
import { warn } from './warning'
import {
  type Teleport,
  type TeleportImpl,
  isTeleport,
} from './components/Teleport'
import {
  currentRenderingInstance,
  currentScopeId,
} from './componentRenderContext'
import type { RendererElement, RendererNode } from './renderer'
import { NULL_DYNAMIC_COMPONENT } from './helpers/resolveAssets'
import { hmrDirtyComponents } from './hmr'
import { convertLegacyComponent } from './compat/component'
import { convertLegacyVModelProps } from './compat/componentVModel'
import { defineLegacyVNodeProperties } from './compat/renderFn'
import { ErrorCodes, callWithAsyncErrorHandling } from './errorHandling'
import type { ComponentPublicInstance } from './componentPublicInstance'
import { isInternalObject } from './internalObject'

/**
 * 多根节点的逻辑容器，不会在宿主环境创建对应元素。
 * 虚拟类型断言同时让 `h(Fragment)` 在类型层表现为可构造组件。
 */
export const Fragment = Symbol.for('v-fgt') as any as {
  /** 仅供类型推导识别 Fragment；运行时值仍是 Symbol，而非构造器对象。 */
  __isFragment: true
  /** 为 h/JSX 提供组件形态的 props 推导，不表示运行时可 new Fragment。 */
  new (): {
    /** Fragment 接受 key/ref 与 VNode 阶段钩子等保留 props。 */
    $props: VNodeProps
  }
}
/** 文本 VNode 类型标识。使用全局 symbol 便于多份运行时识别同类内置节点。 */
export const Text: unique symbol = Symbol.for('v-txt')
/** 注释/空占位 VNode 类型标识，常用于 `v-if` 未命中分支。 */
export const Comment: unique symbol = Symbol.for('v-cmt')
/** 编译器字符串化静态子树的 VNode 类型标识，可一次插入多个宿主节点。 */
export const Static: unique symbol = Symbol.for('v-stc')

/** 渲染器能够分派处理的所有 VNode 类型。 */
export type VNodeTypes =
  | string
  | VNode
  | Component
  | typeof Text
  | typeof Static
  | typeof Comment
  | typeof Fragment
  | typeof Teleport
  | typeof TeleportImpl
  | typeof Suspense
  | typeof SuspenseImpl

/** 模板 ref 的用户输入形态：名称、响应式 Ref 或回调函数。 */
export type VNodeRef =
  | string
  | Ref
  | ((
      ref: Element | ComponentPublicInstance | null,
      refs: Record<string, any>,
    ) => void)

/**
 * 标准化后的单个模板 ref 描述。
 * 除实际 ref 外还保存声明它的组件，确保子树稍后提交时能写回正确的 `$refs`。
 */
export type VNodeNormalizedRefAtom = {
  /** 声明 ref 的组件实例，即 ref owner。 */
  i: ComponentInternalInstance
  /** 用户提供的实际 ref。 */
  r: VNodeRef
  /** 直接传入 Ref 时保留的字符串名，供渲染器把结果同步到 owner.refs[k]。 */
  k?: string
  /** 是否来自 `v-for`；为真时目标值维护为数组。 */
  f?: boolean
}

/** 合并 VNode 时可能让一个节点同时写入多个 ref。 */
export type VNodeNormalizedRef =
  VNodeNormalizedRefAtom | VNodeNormalizedRefAtom[]

/** 只接收当前 VNode 的挂载/卸载阶段钩子。 */
type VNodeMountHook = (vnode: VNode) => void
/** 同时接收新旧 VNode 的更新阶段钩子。 */
type VNodeUpdateHook = (vnode: VNode, oldVNode: VNode) => void
/** 单个或同阶段多个 VNode 生命周期钩子。 */
export type VNodeHook =
  VNodeMountHook | VNodeUpdateHook | VNodeMountHook[] | VNodeUpdateHook[]

/**
 * Vue 保留的 VNode 通用 props。
 *
 * 单独声明而不是通过复杂条件类型推导，可规避 TypeScript #33099 的联合类型索引问题。
 */
export type VNodeProps = {
  /** diff 身份键；相同 type + key 才能复用。 */
  key?: PropertyKey
  /** 模板引用。 */
  ref?: VNodeRef
  /** 编译器标记 ref 位于 `v-for`，目标应为数组。 */
  ref_for?: boolean
  /** setup 内联模式保留的 ref 字符串名，供直接 Ref 同步 `$refs`。 */
  ref_key?: string

  /** 首次挂载时同步通知；普通元素在插入前执行，水合元素已在 DOM。组件节点跟随其首次子树挂载。 */
  onVnodeBeforeMount?: VNodeMountHook | VNodeMountHook[]
  /** 节点挂载后进入 post-render；未决 Suspense 中等分支提交后再执行。 */
  onVnodeMounted?: VNodeMountHook | VNodeMountHook[]
  /** 更新前同步取得新旧 VNode，宿主节点尚未应用本轮变化。 */
  onVnodeBeforeUpdate?: VNodeUpdateHook | VNodeUpdateHook[]
  /** 更新提交后在 post-render 中取得新旧 VNode。 */
  onVnodeUpdated?: VNodeUpdateHook | VNodeUpdateHook[]
  /** 逻辑卸载前同步通知，不等同于宿主节点已被移除。 */
  onVnodeBeforeUnmount?: VNodeMountHook | VNodeMountHook[]
  /** 逻辑卸载后的 post-render 通知；异步 leave 的物理删除可晚于此钩子。 */
  onVnodeUnmounted?: VNodeMountHook | VNodeMountHook[]
}

/** 可作为单个子节点输入的最小值；空值和布尔值会标准化为注释占位。 */
type VNodeChildAtom =
  VNode | string | number | boolean | null | undefined | void

/** 支持任意嵌套数组的 VNode 子节点输入。 */
export type VNodeArrayChildren = Array<VNodeArrayChildren | VNodeChildAtom>

/** `h()` / render 函数可返回的子节点输入。 */
export type VNodeChild = VNodeChildAtom | VNodeArrayChildren

/** VNode 创建完成后允许保留的 children 形态。 */
export type VNodeNormalizedChildren =
  string | VNodeArrayChildren | RawSlots | null

/**
 * Vue 虚拟节点的完整内部结构。
 *
 * VNode 是一次渲染结果的描述，不是长期可变的组件实例。patch 会把宿主节点、组件实例
 * 等提交结果写回当前 VNode，再在下一次渲染时与新 VNode 对比并传递必要引用。
 */
export interface VNode<
  HostNode = RendererNode,
  HostElement = RendererElement,
  ExtraProps = { [key: string]: any },
> {
  /** VNode 身份标记，供 `isVNode()` 无需 `instanceof` 跨模块识别。 @internal */
  __v_isVNode: true

  /** 告诉响应式系统不要把 VNode 转为代理。 @internal */
  [ReactiveFlags.SKIP]: true

  /** 节点类型：宿主标签、组件定义或内置逻辑节点。 */
  type: VNodeTypes
  /** 标准化前后的 props；渲染器根据 patchFlag 决定比较范围。 */
  props: (VNodeProps & ExtraProps) | null
  /** 从 props 提取的稳定身份键。 */
  key: PropertyKey | null
  /** 已绑定 ref owner 的标准化模板引用。 */
  ref: VNodeNormalizedRef | null
  /**
   * SFC 作用域 CSS 标识。创建 VNode 时从与 currentRenderingInstance 同步维护的
   * `currentScopeId` 读取。
   */
  scopeId: string | null
  /**
   * SFC 插槽作用域 CSS 标识列表。用于两类节点：带 `:slotted` 样式的插槽 Fragment；
   * patch/水合中的组件 VNode，使组件根节点继承调用方的 slot scope。
   * @internal
   */
  slotScopeIds: string[] | null
  /** 文本、VNode 数组、组件 slots 对象或空值。 */
  children: VNodeNormalizedChildren
  /** 状态/函数组件挂载后对应的内部实例。 */
  component: ComponentInternalInstance | null
  /** 通过 `withDirectives()` 附加的指令绑定。 */
  dirs: DirectiveBinding[] | null
  /** 过渡状态与阶段钩子。 */
  transition: TransitionHooks<HostElement> | null

  // 宿主节点引用。名称沿用 DOM 语义，但自定义渲染器可放任意 HostNode/HostElement。
  /** 单节点的宿主元素，或多节点范围的起点。 */
  el: HostNode | null
  /** 未解析异步组件在原位置的占位宿主节点。 */
  placeholder: HostNode | null
  /** Fragment/Static 等多节点范围的结束锚点。 */
  anchor: HostNode | null
  /** Teleport 内容实际挂载的目标容器。 */
  target: HostElement | null
  /** Teleport 在目标容器内的起始锚点。 */
  targetStart: HostNode | null
  /** Teleport 在目标容器内的结束锚点。 */
  targetAnchor: HostNode | null
  /** Static 内容的顶层宿主节点数，水合时用于认领节点并确定结束位置。 @internal */
  staticCount: number

  // Suspense 分支与边界状态。
  /** 该 VNode 创建的 Suspense 边界。 */
  suspense: SuspenseBoundary | null
  /** 已标准化的 Suspense default 内容。 @internal */
  ssContent: VNode | null
  /** 已标准化的 Suspense fallback 内容。 @internal */
  ssFallback: VNode | null

  // 编译器与运行时共同维护的优化信息。
  /** 节点/children 大类位图，让 patch 用位运算分派而非反复检查对象形态。 */
  shapeFlag: number
  /** 编译器标记哪些部分动态，渲染器据此跳过静态比较。 */
  patchFlag: number
  /** `PROPS` patchFlag 下需要逐项比较的动态 prop 名。 @internal */
  dynamicProps: string[] | null
  /** block tree 收集到的动态后代；`hasOnce` 表示含 v-once，卸载不能走纯快路径。 @internal */
  dynamicChildren:
     (VNode[] & {
        /** v-once 中可能隐藏未收集的组件；为真时卸载必须遍历完整 children。 */
        hasOnce?: boolean
      })
    | null

  /** 仅应用根 VNode 设置，向下建立 app 配置、组件和指令注册表。 */
  appContext: AppContext | null

  /** 创建该 VNode 的词法渲染组件，用于警告与兼容能力。 @internal */
  ctx: ComponentInternalInstance | null

  /** `v-memo` 附加的依赖快照。 @internal */
  memo?: any[]
  /** `v-memo` 在组件 renderCache 中的位置，卸载时用于清理。 @internal */
  cacheIndex?: number
  /** compat 构建标记 Vue 2 根 VNode。 @internal */
  isCompatRoot?: true
  /** 自定义元素在组件实例创建后执行的拦截钩子。 @internal */
  ce?: (instance: ComponentInternalInstance) => void
}

// `v-if` 和 `v-for` 是模板节点结构发生变化的主要来源。把每个 v-if 分支和 v-for
// Fragment 视为 block 后，单个 block 内节点骨架稳定。编译器可把带 patchFlag 的动态
// 节点收集到 `dynamicChildren`，更新时直接逐项 patch，跳过大部分静态 children diff。
/** 嵌套 block 的动态子节点收集栈。 */
export const blockStack: VNode['dynamicChildren'][] = []
/** 当前正在收集的 block；null 表示本层禁用追踪。 */
export let currentBlock: VNode['dynamicChildren'] = null

/**
 * 开启一个 block 的动态子节点收集。
 *
 * 它必须先于 `createBlock()` 调用，不能合并进后者：JavaScript 会先求值 children 参数，
 * 再进入 `createBlock()`，若此时才开启就漏掉全部后代。编译结果通常为：
 *
 * ```js
 * function render() {
 *   return (openBlock(),createBlock('div', null, [...]))
 * }
 * ```
 * 创建 v-for Fragment 时 `disableTracking` 为真，因为列表 children 本身必须执行 diff，
 * 不依赖动态节点数组快路径。
 *
 * @private
 */
export function openBlock(disableTracking = false): void {
  blockStack.push((currentBlock = disableTracking ? null : []))
}

/** 结束当前 block，并恢复外层 block 的收集数组。 */
export function closeBlock(): void {
  blockStack.pop()
  currentBlock = blockStack[blockStack.length - 1] || null
}

// 是否收集 block 内动态节点；仅大于 0 时启用。不能用布尔值，因为嵌套 v-once、手写
// `h()` 与插槽调用都可能成对增减，计数器才能在嵌套退出时恢复正确外层状态。
export let isBlockTreeEnabled = 1

/**
 * 增减 block tracking 层级。
 *
 * 创建 `v-once` 缓存树时需暂时禁用，编译器生成类似：
 *
 * ``` js
 * _cache[1] || (
 *   setBlockTracking(-1, true),
 *   _cache[1] = createVNode(...),
 *   setBlockTracking(1),
 *   _cache[1]
 * )
 * ```
 *
 * @private
 */
export function setBlockTracking(value: number, inVOnce = false): void {
  isBlockTreeEnabled += value
  if (value < 0 && currentBlock && inVOnce) {
    // v-once 子树可能包含未进入 dynamicChildren 的组件。标记父 block 禁用纯快路径，
    // 否则卸载时会只遍历动态节点，遗漏这些嵌套组件的副作用清理。
    currentBlock.hasOnce = true
  }
}

/** 把刚收集的动态 children 写入 block 根 VNode，并恢复/登记到父 block。 */
function setupBlock(vnode: VNode) {
  // 保存当前 block 的动态节点；完全禁用 tracking 时用 null，空 block 则共享 EMPTY_ARR。
  vnode.dynamicChildren =
    isBlockTreeEnabled > 0 ? currentBlock || (EMPTY_ARR as any) : null
  // 关闭当前层，恢复父 block。
  closeBlock()
  // block 根自身始终需要 patch，因此作为一个动态节点登记到父 block。
  if (isBlockTreeEnabled > 0 && currentBlock) {
    currentBlock.push(vnode)
  }
  return vnode
}

/**
 * 为已知原生元素/Fragment 创建 block 根。
 * 直接走 `createBaseVNode()` 可省去通用类型判定，是编译产物的高频快路径。
 * @private
 */
export function createElementBlock(
  type: string | typeof Fragment,
  props?: Record<string, any> | null,
  children?: any,
  patchFlag?: number,
  dynamicProps?: string[],
  shapeFlag?: number,
): VNode {
  return setupBlock(
    createBaseVNode(
      type,
      props,
      children,
      patchFlag,
      dynamicProps,
      shapeFlag,
      true /* 作为 block 根 */,
    ),
  )
}

/**
 * 创建通用 block 根，参数与 `createVNode()` 一致。
 * block 根会在 `dynamicChildren` 中保存本层动态节点，供渲染器执行定长快速 patch。
 * @private
 */
export function createBlock(
  type: VNodeTypes | ClassComponent,
  props?: Record<string, any> | null,
  children?: any,
  patchFlag?: number,
  dynamicProps?: string[],
): VNode {
  return setupBlock(
    createVNode(
      type,
      props,
      children,
      patchFlag,
      dynamicProps,
      true /* block 不收集自身。 */,
    ),
  )
}

/** 通过内部标记跨包、跨 realm 判断一个值是否为 Vue VNode。 */
export function isVNode(value: any): value is VNode {
  return value ? value.__v_isVNode === true : false
}

/**
 * 判断新旧 VNode 能否就地 patch。
 * 正常条件是 type 与 key 都相同；HMR 标记的脏组件强制视为不同类型，以完整卸载旧实例。
 */
export function isSameVNodeType(n1: VNode, n2: VNode): boolean {
  if (__DEV__ && n2.shapeFlag & ShapeFlags.COMPONENT && n1.component) {
    const dirtyInstances = hmrDirtyComponents.get(n2.type as ConcreteComponent)
    if (dirtyInstances && dirtyInstances.has(n1.component)) {
      // #7042：HMR 必须真正卸载旧组件。先清除 KeepAlive 位，否则 unmount 会把实例移入
      // 缓存而非销毁，热更新后仍可能复用旧 render/effect。
      n1.shapeFlag &= ~ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE
      n2.shapeFlag &= ~ShapeFlags.COMPONENT_KEPT_ALIVE
      // 返回 false 让 patch 走“卸载旧节点 + 挂载新节点”的完整重载路径。
      return false
    }
  }
  return n1.type === n2.type && n1.key === n2.key
}

/** test-utils 可注册的 VNode 参数变换器；生产构建不经过它。 */
let vnodeArgsTransformer:
  | ((
      args: Parameters<typeof _createVNode>,
      instance: ComponentInternalInstance | null,
    ) => Parameters<typeof _createVNode>)
  | undefined

/**
 * 注册 `createVNode()` 参数转换器，供 test-utils 在创建前替换组件桩。
 * 属于内部 API，但必须导出，外部 test-utils 才能取得准确类型并与不同 Vue 版本配合。
 */
export function transformVNodeArgs(
  transformer?: typeof vnodeArgsTransformer,
): void {
  vnodeArgsTransformer = transformer
}

/** 开发构建中的 createVNode 入口：可选先应用测试参数转换器。 */
const createVNodeWithArgsTransform = (
  ...args: Parameters<typeof _createVNode>
): VNode => {
  return _createVNode(
    ...(vnodeArgsTransformer
      ? vnodeArgsTransformer(args, currentRenderingInstance)
      : args),
  )
}

/** 把缺失 key 统一成 null，保留 0、空串和 symbol 等合法键。 */
const normalizeKey = ({ key }: VNodeProps): VNode['key'] =>
  key != null ? key : null

/** 把 ref 与当前渲染实例绑定成渲染器可直接消费的描述对象。 */
const normalizeRef = ({
  ref,
  ref_key,
  ref_for,
}: VNodeProps): VNodeNormalizedRefAtom | null => {
  if (typeof ref === 'number') {
    ref = '' + ref
  }
  return (
    ref != null
      ? isString(ref) || isRef(ref) || isFunction(ref)
        ? { i: currentRenderingInstance, r: ref, k: ref_key, f: !!ref_for }
        : ref
      : null
  ) as any
}

/**
 * 分配 VNode 并完成 children、Suspense、block tracking 等通用初始化。
 *
 * 编译器已知原生元素时可传入 shapeFlag 并跳过完整标准化；手写 render/组件 VNode 则
 * 开启 `needFullChildrenNormalization`，接受 slots、函数和各种宽松 children 形态。
 */
function createBaseVNode(
  type: VNodeTypes | ClassComponent | typeof NULL_DYNAMIC_COMPONENT,
  props: (Data & VNodeProps) | null = null,
  children: unknown = null,
  patchFlag = 0,
  dynamicProps: string[] | null = null,
  shapeFlag: number = type === Fragment ? 0 : ShapeFlags.ELEMENT,
  isBlockNode = false,
  needFullChildrenNormalization = false,
): VNode {
  const vnode = {
    __v_isVNode: true,
    __v_skip: true,
    type,
    props,
    key: props && normalizeKey(props),
    ref: props && normalizeRef(props),
    scopeId: currentScopeId,
    slotScopeIds: null,
    children,
    component: null,
    suspense: null,
    ssContent: null,
    ssFallback: null,
    dirs: null,
    transition: null,
    el: null,
    anchor: null,
    target: null,
    targetStart: null,
    targetAnchor: null,
    staticCount: 0,
    shapeFlag,
    patchFlag,
    dynamicProps,
    dynamicChildren: null,
    appContext: null,
    ctx: currentRenderingInstance,
  } as VNode

  if (needFullChildrenNormalization) {
    normalizeChildren(vnode, children)
    // Suspense 还需把 default/fallback slots 分别标准化为 ssContent/ssFallback。
    if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
      ;(type as typeof SuspenseImpl).normalize(vnode)
    }
  } else if (children) {
    // 编译器已保证原生元素 children 只可能是字符串或数组，可直接设置 shapeFlag。
    vnode.shapeFlag |= isString(children)
      ? ShapeFlags.TEXT_CHILDREN
      : ShapeFlags.ARRAY_CHILDREN
  }

  // NaN 与自身不相等，会让 keyed diff 永远无法命中，开发环境提前指出。
  if (__DEV__ && vnode.key !== vnode.key) {
    warn(`VNode created with invalid key (NaN). VNode type:`, vnode.type)
  }

  // #5081：innerHTML/textContent 会静默覆盖 children。模板编译器已禁止 v-html/v-text
  // 与 children 并用，但手写 render 没有编译检查，所以在 VNode 创建时补充警告。
  if (__DEV__ && props && vnode.shapeFlag & ShapeFlags.ELEMENT) {
    const overwritingProp =
      props.innerHTML != null
        ? 'innerHTML'
        : props.textContent != null
          ? 'textContent'
          : null
    if (overwritingProp && hasContentChildren(vnode.children)) {
      warn(
        `The \`${overwritingProp}\` prop on <${vnode.type as string}> will ` +
          `override its children. Remove either the \`${overwritingProp}\` ` +
          `prop or the children.`,
      )
    }
  }

  // 收集当前 block 真正需要更新的 VNode。
  if (
    isBlockTreeEnabled > 0 &&
    // block 根由 setupBlock 登记到父层，不能收集自己。
    !isBlockNode &&
    // 必须存在可追踪的父 block。
    currentBlock &&
    // 有正 patchFlag 才是动态节点；组件始终需 patch，即使 props 未变也要把旧实例传给
    // 新 VNode，否则未来卸载拿不到组件实例。
    (vnode.patchFlag > 0 || shapeFlag & ShapeFlags.COMPONENT) &&
    // NEED_HYDRATION 只表示 SSR 首次需绑定事件；缓存处理器不会在后续更新变化，若它是
    // 唯一标记则不应把节点长期视为动态。
    vnode.patchFlag !== PatchFlags.NEED_HYDRATION
  ) {
    currentBlock.push(vnode)
  }

  if (__COMPAT__) {
    convertLegacyVModelProps(vnode)
    defineLegacyVNodeProperties(vnode)
  }

  return vnode
}

export { createBaseVNode as createElementVNode }

/**
 * 开发环境判断 children 是否实际渲染内容。
 * 空字符串与空数组不算冲突，与编译器检查 v-html/v-text 时的 `children.length` 一致。
 */
function hasContentChildren(children: VNode['children']): boolean {
  if (isString(children)) return children !== ''
  if (isArray(children)) return children.length > 0
  return false
}

/**
 * 公开 VNode 创建入口。开发构建允许 test-utils 变换参数，生产构建直接指向热路径实现。
 */
export const createVNode = (
  __DEV__ ? createVNodeWithArgsTransform : _createVNode
) as typeof _createVNode

/** 标准化类型、props、class/style 后创建任意类型 VNode 的内部实现。 */
function _createVNode(
  type: VNodeTypes | ClassComponent | typeof NULL_DYNAMIC_COMPONENT,
  props: (Data & VNodeProps) | null = null,
  children: unknown = null,
  patchFlag: number = 0,
  dynamicProps: string[] | null = null,
  isBlockNode = false,
): VNode {
  if (!type || type === NULL_DYNAMIC_COMPONENT) {
    if (__DEV__ && !type) {
      warn(`Invalid vnode type when creating vnode: ${type}.`)
    }
    type = Comment
  }

  if (isVNode(type)) {
    // `<component :is="vnode"/>` 会把现有 VNode 当 type 传入。VNode 不能被两个渲染位置
    // 共享挂载状态，因此先 clone；#2078 要求额外 ref 与原 ref 合并，而非覆盖。
    const cloned = cloneVNode(type, props, true /* 合并 ref。 */)
    if (children) {
      normalizeChildren(cloned, children)
    }
    if (isBlockTreeEnabled > 0 && !isBlockNode && currentBlock) {
      if (cloned.shapeFlag & ShapeFlags.COMPONENT) {
        currentBlock[currentBlock.indexOf(type)] = cloned
      } else {
        currentBlock.push(cloned)
      }
    }
    cloned.patchFlag = PatchFlags.BAIL
    return cloned
  }

  // 类组件运行时真正的选项保存在 `__vccOpts`。
  if (isClassComponent(type)) {
    type = type.__vccOpts
  }

  // compat 构建把 Vue 2 异步/函数式组件转换成 Vue 3 可识别定义。
  if (__COMPAT__) {
    type = convertLegacyComponent(type, currentRenderingInstance)
  }

  // class/style 允许数组和对象语法；在进入宿主 patch 前统一成稳定形态。
  if (props) {
    // 响应式 props 属于用户状态，标准化 class/style 不得直接修改它，先浅克隆。
    props = guardReactiveProps(props)!
    let { class: klass, style } = props
    if (klass && !isString(klass)) {
      props.class = normalizeClass(klass)
    }
    if (isObject(style)) {
      // 代理 style 先复制成本轮快照，保留旧 VNode 的样式键和值供下一轮比较、删除。
      // normalizeStyle 对普通对象直接返回，对数组另建合并对象。
      if (isProxy(style) && !isArray(style)) {
        style = extend({}, style)
      }
      props.style = normalizeStyle(style)
    }
  }

  // 将类型大类编码进 shapeFlag，patch 时用位运算快速分派。
  const shapeFlag = isString(type)
    ? ShapeFlags.ELEMENT
    : __FEATURE_SUSPENSE__ && isSuspense(type)
      ? ShapeFlags.SUSPENSE
      : isTeleport(type)
        ? ShapeFlags.TELEPORT
        : isObject(type)
          ? ShapeFlags.STATEFUL_COMPONENT
          : isFunction(type)
            ? ShapeFlags.FUNCTIONAL_COMPONENT
            : 0

  if (__DEV__ && shapeFlag & ShapeFlags.STATEFUL_COMPONENT && isProxy(type)) {
    type = toRaw(type)
    warn(
      `Vue received a Component that was made a reactive object. This can ` +
        `lead to unnecessary performance overhead and should be avoided by ` +
        `marking the component with \`markRaw\` or using \`shallowRef\` ` +
        `instead of \`ref\`.`,
      `\nComponent that was made reactive: `,
      type,
    )
  }

  return createBaseVNode(
    type,
    props,
    children,
    patchFlag,
    dynamicProps,
    shapeFlag,
    isBlockNode,
    true,
  )
}

/**
 * 若 props 是响应式代理或 Vue 内部共享对象，返回可安全修改的浅副本。
 * 普通用户对象直接复用，减少每个 VNode 的无条件分配。
 */
export function guardReactiveProps(
  props: (Data & VNodeProps) | null,
): (Data & VNodeProps) | null {
  if (!props) return null
  return isProxy(props) || isInternalObject(props) ? extend({}, props) : props
}

/**
 * 克隆 VNode，并可合并额外 props/ref/transition。
 *
 * 手写展开所有字段是刻意的热路径优化，避免对象展开枚举 key。若追加 props，编译器原
 * patchFlag 已无法完整描述动态范围，非 Fragment 节点必须提升为 FULL_PROPS 安全比较。
 */
export function cloneVNode<T, U>(
  vnode: VNode<T, U>,
  extraProps?: (Data & VNodeProps) | null,
  mergeRef = false,
  cloneTransition = false,
): VNode<T, U> {
  // 刻意不用展开或 extend，避免运行时枚举 VNode 的大量固定字段。
  const { props, ref, patchFlag, children, transition } = vnode
  const mergedProps = extraProps ? mergeProps(props || {}, extraProps) : props
  const cloned: VNode<T, U> = {
    __v_isVNode: true,
    __v_skip: true,
    type: vnode.type,
    props: mergedProps,
    key: mergedProps && normalizeKey(mergedProps),
    ref:
      extraProps && extraProps.ref
        ? // #2078：`<component :is="vnode" ref="extra"/>` 中现有 VNode 可能已有 ref；
          // mergeRef 模式要同时写入原 ref 与 extra ref。
          mergeRef && ref
          ? isArray(ref)
            ? ref.concat(normalizeRef(extraProps)!)
            : [ref, normalizeRef(extraProps)!]
          : normalizeRef(extraProps)
        : ref,
    scopeId: vnode.scopeId,
    slotScopeIds: vnode.slotScopeIds,
    children:
      __DEV__ && patchFlag === PatchFlags.CACHED && isArray(children)
        ? (children as VNode[]).map(deepCloneVNode)
        : children,
    target: vnode.target,
    targetStart: vnode.targetStart,
    targetAnchor: vnode.targetAnchor,
    staticCount: vnode.staticCount,
    shapeFlag: vnode.shapeFlag,
    // 追加 props 后原 patchFlag 不再覆盖全部可能变化，加入 FULL_PROPS。Fragment 的
    // patchFlag 只描述 children diff 策略，额外 props 不应破坏其快路径标志。
    patchFlag:
      extraProps && vnode.type !== Fragment
        ? patchFlag === PatchFlags.CACHED // 提升节点。
          ? PatchFlags.FULL_PROPS
          : patchFlag | PatchFlags.FULL_PROPS
        : patchFlag,
    dynamicProps: vnode.dynamicProps,
    dynamicChildren: vnode.dynamicChildren,
    appContext: vnode.appContext,
    dirs: vnode.dirs,
    transition,

    // 以下挂载状态理论上只存在于已挂载 VNode，但 KeepAlive clone 必须保留。统一复制
    // 更简单；普通重新挂载时这些值会被覆盖，不影响控制流。
    component: vnode.component,
    suspense: vnode.suspense,
    ssContent: vnode.ssContent && cloneVNode(vnode.ssContent),
    ssFallback: vnode.ssFallback && cloneVNode(vnode.ssFallback),
    placeholder: vnode.placeholder,

    el: vnode.el,
    anchor: vnode.anchor,
    ctx: vnode.ctx,
    ce: vnode.ce,
  }

  // 若 clone 将替换原 VNode，transition 闭包也需改为引用新 VNode，否则离场/完成回调
  // 可能操作旧节点状态。
  if (transition && cloneTransition) {
    setTransitionHooks(
      cloned as VNode,
      transition.clone(cloned as VNode) as TransitionHooks,
    )
  }

  if (__COMPAT__) {
    defineLegacyVNodeProperties(cloned as VNode)
  }

  return cloned
}

/**
 * 开发环境深克隆静态提升 VNode，服务 HMR 下的 v-for 复用。
 *
 * vite#2022 场景中，同一个提升子树会被多个列表项复用；只克隆根节点仍会共享后代的
 * `el/component` 挂载状态，因此 HMR 的 CACHED 子树必须递归克隆。
 */
function deepCloneVNode(vnode: VNode): VNode {
  const cloned = cloneVNode(vnode)
  if (isArray(vnode.children)) {
    cloned.children = (vnode.children as VNode[]).map(deepCloneVNode)
  }
  return cloned
}

/** 创建文本 VNode；默认单空格供编译器需要稳定占位时使用。 @private */
export function createTextVNode(text: string = ' ', flag: number = 0): VNode {
  return createVNode(Text, null, text, flag)
}

/** 创建由编译器字符串化的静态 VNode，并记录其包含的宿主节点数量。 @private */
export function createStaticVNode(
  content: string,
  numberOfNodes: number,
): VNode {
  // 一段静态 HTML 可生成多个兄弟节点；水合按数量建立首尾引用，移动和删除使用 el/anchor。
  const vnode = createVNode(Static, null, content)
  vnode.staticCount = numberOfNodes
  return vnode
}

/**
 * 创建注释占位 VNode。作为 v-else 分支时可创建 block，确保分支切换进入更新快路径。
 * @private
 */
export function createCommentVNode(
  text: string = '',
  // v-else 空分支的注释也代表一个动态分支，必须作为 block 才能被父 block 追踪。
  asBlock: boolean = false,
): VNode {
  return asBlock
    ? (openBlock(), createBlock(Comment, null, text))
    : createVNode(Comment, null, text)
}

/** 把任意 render 返回值标准化为单个可 patch VNode。 */
export function normalizeVNode(child: VNodeChild): VNode {
  if (child == null || typeof child === 'boolean') {
    // null/undefined/boolean 不渲染文本，但用注释保留稳定位置。
    return createVNode(Comment)
  } else if (isArray(child)) {
    // 数组用 Fragment 包装；#3666 浅拷贝可避免复用输入数组时 patch 写入造成引用污染。
    return createVNode(Fragment, null, child.slice())
  } else if (isVNode(child)) {
    // 编译模板 children 通常已经全是 VNode；仅已挂载/缓存节点需要 clone。
    return cloneIfMounted(child)
  } else {
    // 其他原始值统一字符串化为 Text。
    return createVNode(Text, null, String(child))
  }
}

/**
 * 编译渲染函数的复用保护：未挂载普通 VNode可直接用，已挂载或静态缓存 VNode需克隆。
 * 带 memo 的 VNode 由缓存协议管理身份，即使有 el 也按原对象返回。
 */
export function cloneIfMounted(child: VNode): VNode {
  return (child.el === null && child.patchFlag !== PatchFlags.CACHED) ||
    child.memo
    ? child
    : cloneVNode(child)
}

/**
 * 标准化 VNode children，并把最终形态编码进 shapeFlag。
 *
 * 元素/Teleport 的对象 children 被视为 default slot 并立即展开；组件对象 children
 * 保留为 slots。转发插槽会继承父插槽稳定性，动态时给组件加 DYNAMIC_SLOTS，确保
 * 父级看似 props 不变时子组件仍会更新插槽内容。
 */
export function normalizeChildren(vnode: VNode, children: unknown): void {
  let type = 0
  const { shapeFlag } = vnode
  if (children == null) {
    children = null
  } else if (isArray(children)) {
    type = ShapeFlags.ARRAY_CHILDREN
  } else if (typeof children === 'object') {
    if (shapeFlag & (ShapeFlags.ELEMENT | ShapeFlags.TELEPORT)) {
      // 原生元素和 Teleport 不持有 slots 对象，执行 default slot 得到普通 children。
      const slot = (children as any).default
      if (slot) {
        // `_c` 表示编译插槽；由 renderSlot 控制的调用可临时开启 block tracking。
        slot._c && (slot._d = false)
        normalizeChildren(vnode, slot())
        slot._c && (slot._d = true)
      }
      return
    } else {
      type = ShapeFlags.SLOTS_CHILDREN
      const slotFlag = (children as RawSlots)._
      if (!slotFlag && !isInternalObject(children)) {
        // 未标准化用户 slots 需记录声明上下文；编译/内部 slots 已经携带，无需覆盖。
        ;(children as RawSlots)._ctx = currentRenderingInstance
      } else if (slotFlag === SlotFlags.FORWARDED && currentRenderingInstance) {
        // 转发插槽自身稳定性取决于父组件收到的插槽：父级稳定则仍稳定，否则标成动态，
        // 并给当前组件加 patchFlag，不能因 props 未变跳过更新。
        if (
          (currentRenderingInstance.slots as RawSlots)._ === SlotFlags.STABLE
        ) {
          ;(children as RawSlots)._ = SlotFlags.STABLE
        } else {
          ;(children as RawSlots)._ = SlotFlags.DYNAMIC
          vnode.patchFlag |= PatchFlags.DYNAMIC_SLOTS
        }
      }
    }
  } else if (isFunction(children)) {
    if (shapeFlag & (ShapeFlags.ELEMENT | ShapeFlags.TELEPORT)) {
      normalizeChildren(vnode, { default: children })
      return
    }
    children = { default: children, _ctx: currentRenderingInstance }
    type = ShapeFlags.SLOTS_CHILDREN
  } else {
    children = String(children)
    // Teleport 的 children 需要逐节点搬移，纯文本也转成单元素 VNode 数组。
    if (shapeFlag & ShapeFlags.TELEPORT) {
      type = ShapeFlags.ARRAY_CHILDREN
      children = [createTextVNode(children as string)]
    } else {
      type = ShapeFlags.TEXT_CHILDREN
    }
  }
  vnode.children = children as VNodeNormalizedChildren
  vnode.shapeFlag |= type
}

/**
 * 合并多组 VNode props，使用适合渲染语义的特殊规则。
 *
 * class/style 做标准化合并；事件处理器保留已有值并追加新处理器。相同输入引用，或已有
 * 数组已包含的单个函数会被跳过；两个处理器数组之间不逐项去重。其他键后值覆盖前值。
 * model update listener 即使值为 undefined 也不能被保留，否则会让组件误判存在 v-model。
 */
export function mergeProps(...args: (Data & VNodeProps)[]): Data {
  const ret: Data = {}
  for (let i = 0; i < args.length; i++) {
    const toMerge = args[i]
    for (const key in toMerge) {
      if (key === 'class') {
        if (ret.class !== toMerge.class) {
          ret.class = normalizeClass([ret.class, toMerge.class])
        }
      } else if (key === 'style') {
        ret.style = normalizeStyle([ret.style, toMerge.style])
      } else if (isOn(key)) {
        const existing = ret[key]
        const incoming = toMerge[key]
        if (
          incoming &&
          existing !== incoming &&
          !(isArray(existing) && existing.includes(incoming))
        ) {
          ret[key] = existing
            ? [].concat(existing as any, incoming as any)
            : incoming
        } else if (
          incoming == null &&
          existing == null &&
          // `onUpdate:modelValue: undefined` 不应在合并后留下 model listener 键。
          !isModelListener(key)
        ) {
          ret[key] = incoming
        }
      } else if (key !== '') {
        ret[key] = toMerge[key]
      }
    }
  }
  return ret
}

/** 通过统一异步错误处理管道调用一个或一组 VNode 生命周期钩子。 */
export function invokeVNodeHook(
  hook: VNodeHook,
  instance: ComponentInternalInstance | null,
  vnode: VNode,
  prevVNode: VNode | null = null,
): void {
  callWithAsyncErrorHandling(hook, instance, ErrorCodes.VNODE_HOOK, [
    vnode,
    prevVNode,
  ])
}
