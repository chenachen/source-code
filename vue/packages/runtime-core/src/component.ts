import { type VNode, type VNodeChild, isVNode } from './vnode'
import {
  EffectScope,
  type ReactiveEffect,
  TrackOpTypes,
  isRef,
  markRaw,
  pauseTracking,
  proxyRefs,
  resetTracking,
  shallowReadonly,
  track,
} from '@vue/reactivity'
import {
  type ComponentPublicInstance,
  type ComponentPublicInstanceConstructor,
  PublicInstanceProxyHandlers,
  RuntimeCompiledPublicInstanceProxyHandlers,
  createDevRenderContext,
  exposePropsOnRenderContext,
  exposeSetupStateOnRenderContext,
  publicPropertiesMap,
} from './componentPublicInstance'
import {
  type ComponentPropsOptions,
  type NormalizedPropsOptions,
  initProps,
  normalizePropsOptions,
} from './componentProps'
import {
  type InternalSlots,
  type Slots,
  type SlotsType,
  type UnwrapSlotsType,
  initSlots,
} from './componentSlots'
import { warn } from './warning'
import { ErrorCodes, callWithErrorHandling, handleError } from './errorHandling'
import {
  type AppConfig,
  type AppContext,
  createAppContext,
} from './apiCreateApp'
import { type Directive, validateDirectiveName } from './directives'
import {
  type ComponentOptions,
  type ComputedOptions,
  type MergedComponentOptions,
  type MethodOptions,
  applyOptions,
  resolveMergedOptions,
} from './componentOptions'
import {
  type EmitFn,
  type EmitsOptions,
  type EmitsToProps,
  type ObjectEmitsOptions,
  type ShortEmitsToObject,
  emit,
  normalizeEmitsOptions,
} from './componentEmits'
import {
  EMPTY_OBJ,
  type IfAny,
  NOOP,
  ShapeFlags,
  extend,
  getGlobalThis,
  isArray,
  isFunction,
  isObject,
  isPromise,
  makeMap,
} from '@vue/shared'
import type { SuspenseBoundary } from './components/Suspense'
import type { CompilerOptions } from '@vue/compiler-core'
import { markAttrsAccessed } from './componentRenderUtils'
import { currentRenderingInstance } from './componentRenderContext'
import { endMeasure, startMeasure } from './profiling'
import { convertLegacyRenderFn } from './compat/renderFn'
import {
  type CompatConfig,
  globalCompatConfig,
  validateCompatConfig,
} from './compat/compatConfig'
import type { SchedulerJob } from './scheduler'
import type { LifecycleHooks } from './enums'

// 为 TS 模板/TSX 的 GlobalComponents 补充 Vue 内置组件声明。
import type { TeleportProps } from './components/Teleport'
import type { SuspenseProps } from './components/Suspense'
import type { KeepAliveProps } from './components/KeepAlive'
import type { BaseTransitionProps } from './components/BaseTransition'
import type { DefineComponent } from './apiDefineComponent'
import { markAsyncBoundary } from './helpers/useId'
import { isAsyncWrapper } from './apiAsyncComponent'
import type { RendererElement } from './renderer'

/** Vue 内部通用的字符串键数据对象。 */
export type Data = Record<string, unknown>

/**
 * TSX 中允许的未声明组件 attrs 扩展点。库可通过 module augmentation 添加字段。
 */
export interface AllowedAttrs {}

/** 组件透传 attrs 对象类型。 */
export type Attrs = Data & AllowedAttrs

/**
 * 从任意合法组件定义提取公开实例类型的工具类型。
 *
 * 它可替代只支持构造器组件的 `InstanceType<typeof Comp>`，同时覆盖函数式组件、原始
 * options 对象和 `defineComponent()` 返回的虚拟构造器。
 *
 * @example
 * ```ts
 * const MyComp = { ... }
 * declare const instance: ComponentInstance<typeof MyComp>
 * ```
 */
export type ComponentInstance<T> = T extends { new (): ComponentPublicInstance }
  ? InstanceType<T>
  : T extends FunctionalComponent<infer Props, infer Emits>
    ? ComponentPublicInstance<Props, {}, {}, {}, {}, ShortEmitsToObject<Emits>>
    : T extends Component<
          infer PropsOrInstance,
          infer RawBindings,
          infer D,
          infer C,
          infer M
        >
      ? PropsOrInstance extends { $props: unknown }
        ? // T is returned by `defineComponent()`
          PropsOrInstance
        : // NOTE we override Props/RawBindings/D to make sure is not `unknown`
          ComponentPublicInstance<
            unknown extends PropsOrInstance ? {} : PropsOrInstance,
            unknown extends RawBindings ? {} : RawBindings,
            unknown extends D ? {} : D,
            C,
            M
          >
      : never // 输入不是 Vue 组件。

/**
 * TSX 中允许的未声明组件 props 扩展点。
 */
export interface ComponentCustomProps {}

/**
 * 全局指令的类型扩展点。以下示例把 `VTooltip` 声明为全局指令：
 *
 * @example
 * ```ts
 * import VTooltip from 'v-tooltip'
 *
 * declare module '@vue/runtime-core' {
 *   interface GlobalDirectives {
 *     VTooltip
 *   }
 * }
 * ```
 */
export interface GlobalDirectives {}

/**
 * 全局组件的类型扩展点。内置组件也在此声明，使模板/TSX 无需导入即可获得类型。
 * 以下示例把 `RouterView` 声明为全局组件：
 *
 * @example
 * ```ts
 * import { RouterView } from 'vue-router'
 *
 * declare module '@vue/runtime-core' {
 *   interface GlobalComponents {
 *     RouterView
 *   }
 * }
 * ```
 */
export interface GlobalComponents {
  Teleport: DefineComponent<TeleportProps>
  Suspense: DefineComponent<SuspenseProps>
  KeepAlive: DefineComponent<KeepAliveProps>
  BaseTransition: DefineComponent<BaseTransitionProps>
}

/**
 * TSX 默认允许所有组件接收的未声明外观 props。
 */
export interface AllowedComponentProps {
  class?: unknown
  style?: unknown
}

// 不能把整个接口标成 @internal：部分公开组件接口需要继承这些由编译器/工具写入的字段。
/** SFC 编译器、HMR、devtools 与 compat 附加到组件定义的内部元信息。 */
export interface ComponentInternalOptions {
  /** SFC scoped CSS 标识。 @internal */
  __scopeId?: string
  /** CSS Modules 映射。 @internal */
  __cssModules?: Data
  /** HMR 组件身份。 @internal */
  __hmrId?: string
  /** compat 构建标记 Vue 内置组件，跳过不适用的兼容转换。 */
  __isBuiltIn?: boolean
  /** SFC 源文件路径，devtools 和警告组件名推导需要公开读取。 */
  __file?: string
  /** 编译器从文件名推导的组件名，显式 name 优先级更高。 */
  __name?: string
}

/**
 * 函数式组件定义：函数直接根据 props/context 返回 VNode，不创建有状态公开代理。
 */
export interface FunctionalComponent<
  P = {},
  E extends EmitsOptions | Record<string, any[]> = {},
  S extends Record<string, any> = any,
  EE extends EmitsOptions = ShortEmitsToObject<E>,
> extends ComponentInternalOptions {
  // 返回 any 是刻意的：TypeScript 才会把该函数接受为合法 JSX Element 构造器。
  (
    props: P & EmitsToProps<EE>,
    ctx: Omit<SetupContext<EE, IfAny<S, {}, SlotsType<S>>>, 'expose'>,
  ): any
  props?: ComponentPropsOptions<P>
  emits?: EE | (keyof EE)[]
  slots?: IfAny<S, Slots, SlotsType<S>>
  inheritAttrs?: boolean
  displayName?: string
  compatConfig?: CompatConfig
}

/** 由类包装的 Vue 组件；真实 options 存放于 `__vccOpts`。 */
export interface ClassComponent {
  new (...args: any[]): ComponentPublicInstance<any, any, any, any, any>
  __vccOpts: ComponentOptions
}

/**
 * 与运行时真实值形态一致的组件类型：options 对象或函数式组件。
 * 内部需要用 `typeof`/`isFunction` 检查组件值时使用，不含 defineComponent 的虚拟构造器。
 */
export type ConcreteComponent<
  Props = {},
  RawBindings = any,
  D = any,
  C extends ComputedOptions = ComputedOptions,
  M extends MethodOptions = MethodOptions,
  E extends EmitsOptions | Record<string, any[]> = {},
  S extends Record<string, any> = any,
> =
  | ComponentOptions<Props, RawBindings, D, C, M>
  | FunctionalComponent<Props, E, S>

/**
 * 公开 API 接受的组件联合类型。
 * 额外包含 `defineComponent()` 为类型推导伪造的构造器形态。
 */
export type Component<
  PropsOrInstance = any,
  RawBindings = any,
  D = any,
  C extends ComputedOptions = ComputedOptions,
  M extends MethodOptions = MethodOptions,
  E extends EmitsOptions | Record<string, any[]> = {},
  S extends Record<string, any> = any,
> =
  | ConcreteComponent<PropsOrInstance, RawBindings, D, C, M, E, S>
  | ComponentPublicInstanceConstructor<PropsOrInstance>

export type { ComponentOptions }

/** 组件实例存储的生命周期钩子数组；包装后的钩子同时可作为调度任务。 */
export type LifecycleHook<TFn = Function> = (TFn & SchedulerJob)[] | null

// #2362：`E extends any` 强制条件类型分发/求值，避免复杂 emits 类型延迟展开后推导失败。
/** 传给 `setup(props, context)` 的上下文类型。 */
export type SetupContext<
  E = EmitsOptions,
  S extends SlotsType = {},
> = E extends any
  ? {
      attrs: Attrs
      slots: UnwrapSlotsType<S>
      emit: EmitFn<E>
      expose: <Exposed extends Record<string, any> = Record<string, any>>(
        exposed?: Exposed,
      ) => void
    }
  : never

/** 编译器生成渲染函数的内部调用签名；额外参数绕过公开代理属性查找。 @internal */
export type InternalRenderFunction = {
  (
    ctx: ComponentPublicInstance,
    cache: ComponentInternalInstance['renderCache'],
    // 编译器优化绑定可直接访问这些对象，省去 proxy get 分派。
    $props: ComponentInternalInstance['props'],
    $setup: ComponentInternalInstance['setupState'],
    $data: ComponentInternalInstance['data'],
    $options: ComponentInternalInstance['ctx'],
  ): VNodeChild
  /** 是否由运行时编译器生成。 */
  _rc?: boolean

  /** compat：已确认是 Vue 3 render，不再重复检查。 */
  _compatChecked?: boolean
  /** compat：已包装成 Vue 3 调用约定。 */
  _compatWrapped?: boolean
}

/**
 * 组件内部实例。
 *
 * 它连接组件定义、父子关系、当前/待处理 VNode、响应式 effect、props/slots/setup 状态、
 * 生命周期和 Suspense。部分字段虽属内部实现，仍暴露给高级库与 devtools 使用。
 */
export interface ComponentInternalInstance {
  uid: number
  type: ConcreteComponent
  parent: ComponentInternalInstance | null
  root: ComponentInternalInstance
  appContext: AppContext
  /** 父级虚拟 DOM 树中代表当前组件的 VNode。 */
  vnode: VNode
  /** @internal 父组件更新时等待应用到当前实例的新 VNode。 */
  next: VNode | null
  /** 当前组件 render 返回的虚拟 DOM 根节点。 */
  subTree: VNode
  /** 追踪 render 响应式依赖的 ReactiveEffect。 */
  effect: ReactiveEffect
  /** 直接触发 render effect 的更新入口。 */
  update: () => void
  /** 交给 scheduler 的渲染任务；执行前会检查 effect 是否 dirty。 */
  job: SchedulerJob
  /** @internal 返回 VNode 树的客户端 render 函数。 */
  render: InternalRenderFunction | null
  /** @internal 服务端字符串渲染函数。 */
  ssrRender?: Function | null
  /** @internal 当前组件向后代 provide 的值；通常以父 provides 为原型。 */
  provides: Data
  /**
   * @internal `useId()` 计数状态：[当前异步边界前缀、边界内调用序号、边界序号]。
   */
  ids: [string, number, number]
  /**
   * @internal 收集组件关联的 watch/computed 等响应式副作用，卸载时统一停止。
   */
  scope: EffectScope
  /** @internal 公共代理属性来源缓存，避免每次访问重复执行 hasOwnProperty。 */
  accessCache: Data | null
  /**
   * @internal render 中依赖 `_ctx` 但初始化后无需更新的值缓存，例如内联事件处理器。
   */
  renderCache: (Function | VNode | undefined)[]

  /** @internal 解析后的局部组件表，仅含 mixins/extends 时单独保存。 */
  components: Record<string, ConcreteComponent> | null
  /** @internal 解析后的局部指令表，仅含 mixins/extends 时单独保存。 */
  directives: Record<string, Directive> | null
  /** @internal 解析后的过滤器表，仅 Vue 2 兼容构建使用。 */
  filters?: Record<string, Function>
  /** @internal 规范化后的 props 选项。 */
  propsOptions: NormalizedPropsOptions
  /** @internal 规范化后的 emits 选项。 */
  emitsOptions: ObjectEmitsOptions | null
  /** @internal 合并后的 inheritAttrs 选项。 */
  inheritAttrs?: boolean
  /** @internal 由 defineCustomElement 创建时对应的自定义元素实例。 */
  ce?: ComponentCustomElementInterface
  /** @internal 是否为自定义元素根；为兼容既有内部协议保留。 */
  isCE?: boolean
  /** @internal 自定义元素专用 HMR 重载方法。 */
  ceReload?: (newStyles?: string[]) => void

  // 以下字段仅有状态组件使用 --------------------------------------------------

  // 作为 Options API `this` 和模板 ref 值的主公共代理。
  proxy: ComponentPublicInstance | null

  // expose() 声明的原始属性及其自动解包公共代理。
  exposed: Record<string, any> | null
  exposeProxy: Record<string, any> | null

  /**
   * @internal 仅运行时编译、使用 `with` 块的 render 函数使用的替代代理。
   */
  withProxy: ComponentPublicInstance | null
  /**
   * @internal 公共实例 Proxy 的 target，同时保存 Options API 注入的 computed/methods
   * 等属性，以及用户通过 `this.x = ...` 附加的自定义属性。
   */
  ctx: Data

  // 组件运行时状态。
  data: Data
  props: Data
  attrs: Data
  slots: InternalSlots
  refs: Data
  emit: EmitFn

  /** @internal 记录组件 `.once` 事件是否已触发，防止重复调用。 */
  emitted: Record<string, boolean> | null
  /**
   * @internal 缓存 props 默认值工厂结果，避免每次更新重新创建对象并误触发 watcher。
   */
  propsDefaults: Data
  /** @internal setup() 返回并经 proxyRefs 处理的状态。 */
  setupState: Data
  /** @internal 提供给 devtools 的 setup 原始状态/额外元数据。 */
  devtoolsRawSetupState?: any
  /** @internal 按需创建并缓存的 setup 上下文。 */
  setupContext: SetupContext | null

  /** @internal 当前组件所属的 Suspense 边界。 */
  suspense: SuspenseBoundary | null
  /** @internal 注册 async setup 时的 Suspense pending 批次编号。 */
  suspenseId: number
  /** @internal setup() 返回的未决 Promise。 */
  asyncDep: Promise<any> | null
  /** @internal async setup 是否已经解析并完成实例初始化。 */
  asyncResolved: boolean

  // 生命周期状态与钩子数组。
  isMounted: boolean
  isUnmounted: boolean
  isDeactivated: boolean
  /**
   * @internal
   */
  [LifecycleHooks.BEFORE_CREATE]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.CREATED]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.BEFORE_MOUNT]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.MOUNTED]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.BEFORE_UPDATE]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.UPDATED]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.BEFORE_UNMOUNT]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.UNMOUNTED]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.RENDER_TRACKED]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.RENDER_TRIGGERED]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.ACTIVATED]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.DEACTIVATED]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.ERROR_CAPTURED]: LifecycleHook
  /**
   * @internal
   */
  [LifecycleHooks.SERVER_PREFETCH]: LifecycleHook<() => Promise<unknown>>

  /**
   * @internal 缓存已绑定实例的 `$forceUpdate`，保证多次读取引用稳定。
   */
  f?: () => void
  /**
   * @internal 缓存已绑定实例的 `$nextTick`。
   */
  n?: () => Promise<void>
  /**
   * @internal `updateTeleportCssVars`：更新当前组件 Teleport 远端节点上的 CSS 变量。
   */
  ut?: (vars?: Record<string, unknown>) => void

  /**
   * @internal 仅开发环境：取得 style v-bind 的 CSS 变量，用于 hydration mismatch 检查。
   */
  getCssVars?: () => Record<string, unknown>

  /**
   * @internal 仅 Vue 2 兼容：缓存补入私有字段后的 `$options`。
   */
  resolvedOptions?: MergedComponentOptions
}

/** 没有父组件且根 VNode 未提供 appContext 时复用的只读式空上下文。 */
const emptyAppContext = createAppContext()

/** 全局递增组件 uid，决定父子调度顺序并作为 devtools 身份。 */
let uid = 0

/**
 * 为组件 VNode 分配内部实例并初始化所有运行时字段。
 *
 * 此阶段不执行 setup/render；它只建立父子/appContext/provides/effectScope 与规范化
 * props/emits options。字段一次性完整铺开，可保持 V8 对实例对象的稳定 hidden class。
 */
export function createComponentInstance(
  vnode: VNode,
  parent: ComponentInternalInstance | null,
  suspense: SuspenseBoundary | null,
): ComponentInternalInstance {
  const type = vnode.type as ConcreteComponent
  // 子组件继承父 appContext；根组件从 createApp 写入的根 VNode 取得。
  const appContext =
    (parent ? parent.appContext : vnode.appContext) || emptyAppContext

  const instance: ComponentInternalInstance = {
    uid: uid++,
    vnode,
    type,
    parent,
    appContext,
    root: null!, // 对象创建后立即按 parent 设置。
    next: null,
    subTree: null!, // 首次 render 时同步设置。
    effect: null!,
    update: null!, // setupRenderEffect 时同步设置。
    job: null!,
    // detached scope 不自动归入当前外层 scope；组件父子生命周期由渲染器显式控制。
    scope: new EffectScope(true /* detached */),
    render: null,
    proxy: null,
    exposed: null,
    exposeProxy: null,
    withProxy: null,

    provides: parent ? parent.provides : Object.create(appContext.provides),
    ids: parent ? parent.ids : ['', 0, 0],
    accessCache: null!,
    renderCache: [],

    // 局部资源解析缓存/注册表。
    components: null,
    directives: null,

    // 合并全局 mixin/extends 后的 props 与 emits 规范化结果。
    propsOptions: normalizePropsOptions(type, appContext),
    emitsOptions: normalizeEmitsOptions(type, appContext),

    // emit 会在对象创建后绑定当前实例。
    emit: null!,
    emitted: null,

    // 每实例缓存 default factory 结果，保证一次实例内默认对象引用稳定。
    propsDefaults: EMPTY_OBJ,

    // undefined 表示使用默认继承行为。
    inheritAttrs: type.inheritAttrs,

    // 状态对象先用共享空对象，具体阶段按需替换，减少无状态组件分配。
    ctx: EMPTY_OBJ,
    data: EMPTY_OBJ,
    props: EMPTY_OBJ,
    attrs: EMPTY_OBJ,
    slots: EMPTY_OBJ,
    refs: EMPTY_OBJ,
    setupState: EMPTY_OBJ,
    setupContext: null,

    // Suspense 依赖与当前 pending 分支代次。
    suspense,
    suspenseId: suspense ? suspense.pendingId : 0,
    asyncDep: null,
    asyncResolved: false,

    // 生命周期字段使用字面量而非枚举计算属性，维持对象形状与更小生成代码。
    isMounted: false,
    isUnmounted: false,
    isDeactivated: false,
    bc: null,
    c: null,
    bm: null,
    m: null,
    bu: null,
    u: null,
    um: null,
    bum: null,
    da: null,
    a: null,
    rtg: null,
    rtc: null,
    ec: null,
    sp: null,
  }
  if (__DEV__) {
    instance.ctx = createDevRenderContext(instance)
  } else {
    instance.ctx = { _: instance }
  }
  instance.root = parent ? parent.root : instance
  instance.emit = emit.bind(null, instance)

  // 自定义元素在 setup 前接管实例，注入宿主元素、样式和 emit 反射能力。
  if (vnode.ce) {
    vnode.ce(instance)
  }

  return instance
}

/** 当前同步执行 `setup()` 或生命周期钩子的组件实例。 */
export let currentInstance: ComponentInternalInstance | null = null

/** 获取 setup 实例；函数式渲染场景回退到 currentRenderingInstance。 */
export const getCurrentInstance: () => ComponentInternalInstance | null = () =>
  currentInstance || currentRenderingInstance

/** 实际设置器；SSR 下可能广播给同一页面加载的多份 Vue runtime。 */
let internalSetCurrentInstance: (
  instance: ComponentInternalInstance | null,
) => void
/** 切换 SSR setup 标志；多 runtime 场景同样通过全局 setter 广播。 */
export let setInSSRSetupState: (state: boolean) => void

/**
 * 让 `getCurrentInstance()` 在同一 SSR 进程加载多份 Vue 时尽量可用。
 *
 * #7590 汇总了依赖重复的来源。理想情况应由包管理/打包配置去重，但复杂 SSR、CDN 组合
 * 中用户往往无法控制，所以各副本向全局 setter 数组注册并同步 currentInstance。
 *
 * 该修复并不完整：effectScope 和全局响应式依赖图仍是每份 runtime 的单例。但它覆盖了
 * 组合式 API 读取实例等常见场景；浏览器执行中检测到重复仍会警告用户处理根因。
 */
if (__SSR__) {
  /** 多份 SSR runtime 之间广播当前实例或 SSR setup 状态的 setter 签名。 */
  type Setter = (v: any) => void
  const g = getGlobalThis()
  const registerGlobalSetter = (key: string, setter: Setter) => {
    let setters: Setter[]
    if (!(setters = g[key])) setters = g[key] = []
    setters.push(setter)
    return (v: any) => {
      if (setters.length > 1) setters.forEach(set => set(v))
      else setters[0](v)
    }
  }
  internalSetCurrentInstance = registerGlobalSetter(
    `__VUE_INSTANCE_SETTERS__`,
    v => (currentInstance = v),
  )
  // 同步 `isInSSRComponentSetup`：SFC playground 从 CDN 分别加载 runtime 与
  // server-renderer，两者内含重复 Vue；异步组件 SSR 必须看到同一 setup 状态。
  setInSSRSetupState = registerGlobalSetter(
    `__VUE_SSR_SETTERS__`,
    v => (isInSSRComponentSetup = v),
  )
} else {
  internalSetCurrentInstance = i => {
    currentInstance = i
  }
  setInSSRSetupState = v => {
    isInSSRComponentSetup = v
  }
}

/**
 * 设置当前组件并激活其 effectScope，返回按栈恢复前一实例的清理函数。
 */
export const setCurrentInstance = (instance: ComponentInternalInstance) => {
  const prev = currentInstance
  internalSetCurrentInstance(instance)
  instance.scope.on()
  return (): void => {
    instance.scope.off()
    internalSetCurrentInstance(prev)
  }
}

/** 清除当前组件上下文，并关闭其 effectScope 的依赖归属窗口。 */
export const unsetCurrentInstance = (): void => {
  currentInstance && currentInstance.scope.off()
  internalSetCurrentInstance(null)
}

/** 不能注册为用户组件名的模板内置伪标签。 */
const isBuiltInTag = /*@__PURE__*/ makeMap('slot,component')

/** 开发环境校验组件名未占用模板内置标签或平台原生标签。 */
export function validateComponentName(
  name: string,
  { isNativeTag }: AppConfig,
): void {
  if (isBuiltInTag(name) || isNativeTag(name)) {
    warn(
      'Do not use built-in or reserved HTML elements as component id: ' + name,
    )
  }
}

/** 通过 VNode shapeFlag 判断组件是否需要有状态实例/setup 流程。 */
export function isStatefulComponent(
  instance: ComponentInternalInstance,
): number {
  return instance.vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT
}

/** 当前是否正在执行 SSR 组件 setup；computed/watch/useSSRContext 会读取。 */
export let isInSSRComponentSetup = false

/**
 * 初始化组件 props/slots，并对有状态组件执行 setup。
 * 返回 Promise 仅发生在 SSR async setup，供 server-renderer 等待。
 */
export function setupComponent(
  instance: ComponentInternalInstance,
  isSSR = false,
  optimized = false,
): Promise<void> | undefined {
  isSSR && setInSSRSetupState(isSSR)

  const { props, children } = instance.vnode
  const isStateful = isStatefulComponent(instance)
  initProps(instance, props, isStateful, isSSR)
  initSlots(instance, children, optimized || isSSR)

  const setupResult = isStateful
    ? setupStatefulComponent(instance, isSSR)
    : undefined

  isSSR && setInSSRSetupState(false)
  return setupResult
}

/**
 * 创建公开代理并执行有状态组件 setup，处理同步返回、async setup 与 Suspense 注册。
 */
function setupStatefulComponent(
  instance: ComponentInternalInstance,
  isSSR: boolean,
) {
  const Component = instance.type as ComponentOptions

  if (__DEV__) {
    if (Component.name) {
      validateComponentName(Component.name, instance.appContext.config)
    }
    if (Component.components) {
      const names = Object.keys(Component.components)
      for (let i = 0; i < names.length; i++) {
        validateComponentName(names[i], instance.appContext.config)
      }
    }
    if (Component.directives) {
      const names = Object.keys(Component.directives)
      for (let i = 0; i < names.length; i++) {
        validateDirectiveName(names[i])
      }
    }
    if (Component.compilerOptions && isRuntimeOnly()) {
      warn(
        `"compilerOptions" is only supported when using a build of Vue that ` +
          `includes the runtime compiler. Since you are using a runtime-only ` +
          `build, the options should be passed via your build tool config instead.`,
      )
    }
  }
  // 0. 创建渲染代理访问来源缓存；缓存必须先于第一次 render。
  instance.accessCache = Object.create(null)
  // 1. 公开实例/渲染代理把 this.key 分派到 setup/data/props/ctx。
  instance.proxy = new Proxy(instance.ctx, PublicInstanceProxyHandlers)
  if (__DEV__) {
    exposePropsOnRenderContext(instance)
  }
  // 2. 在正确 currentInstance/effectScope 中调用 setup；暂停追踪避免初始化读取污染外层。
  const { setup } = Component
  if (setup) {
    pauseTracking()
    const setupContext = (instance.setupContext =
      setup.length > 1 ? createSetupContext(instance) : null)
    const reset = setCurrentInstance(instance)
    const setupResult = callWithErrorHandling(
      setup,
      instance,
      ErrorCodes.SETUP_FUNCTION,
      [
        __DEV__ ? shallowReadonly(instance.props) : instance.props,
        setupContext,
      ],
    )
    const isAsyncSetup = isPromise(setupResult)
    resetTracking()
    reset()

    if ((isAsyncSetup || instance.sp) && !isAsyncWrapper(instance)) {
      // async setup/serverPrefetch 恢复顺序不稳定，为 useId 标记独立异步边界。
      markAsyncBoundary(instance)
    }

    if (isAsyncSetup) {
      setupResult.then(unsetCurrentInstance, unsetCurrentInstance)
      if (isSSR) {
        // SSR 返回 Promise，让 server-renderer 等待后再继续完成组件 setup。
        return setupResult
          .then((resolvedResult: unknown) => {
            setInSSRSetupState(true)
            try {
              handleSetupResult(instance, resolvedResult, isSSR)
            } finally {
              setInSSRSetupState(false)
            }
          })
          .catch(e => {
            handleError(e, instance, ErrorCodes.SETUP_FUNCTION)
          })
      } else if (__FEATURE_SUSPENSE__) {
        // 客户端把 Promise 保存为 Suspense 依赖并暂停，resolve 后渲染器重新进入。
        instance.asyncDep = setupResult
        if (__DEV__ && !instance.suspense) {
          const name = formatComponentName(instance, Component)
          warn(
            `Component <${name}>: setup function returned a promise, but no ` +
              `<Suspense> boundary was found in the parent component tree. ` +
              `A component with async setup() must be nested in a <Suspense> ` +
              `in order to be rendered.`,
          )
        }
      } else if (__DEV__) {
        warn(
          `setup() returned a Promise, but the version of Vue you are using ` +
            `does not support it yet.`,
        )
      }
    } else {
      handleSetupResult(instance, setupResult, isSSR)
    }
  } else {
    finishComponentSetup(instance, isSSR)
  }
}

/**
 * 解释 setup 返回值：函数成为 render，普通对象经 proxyRefs 后成为 setupState。
 * 无论何种合法结果，最后都进入 `finishComponentSetup()` 补模板/Options API。
 */
export function handleSetupResult(
  instance: ComponentInternalInstance,
  setupResult: unknown,
  isSSR: boolean,
): void {
  if (isFunction(setupResult)) {
    // setup 返回内联渲染函数。
    if (__SSR__ && (instance.type as ComponentOptions).__ssrInlineRender) {
      // SFC SSR inline 模式返回的是 ssrRender，不能当客户端 VNode render 使用。
      instance.ssrRender = setupResult
    } else {
      instance.render = setupResult as InternalRenderFunction
    }
  } else if (isObject(setupResult)) {
    if (__DEV__ && isVNode(setupResult)) {
      warn(
        `setup() should not return VNodes directly - ` +
          `return a render function instead.`,
      )
    }
    // setup 返回模板绑定；render 由预编译结果或运行时模板编译补充。
    if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
      instance.devtoolsRawSetupState = setupResult
    }
    instance.setupState = proxyRefs(setupResult)
    if (__DEV__) {
      exposeSetupStateOnRenderContext(instance)
    }
  } else if (__DEV__ && setupResult !== undefined) {
    warn(
      `setup() should return an object. Received: ${
        setupResult === null ? 'null' : typeof setupResult
      }`,
    )
  }
  finishComponentSetup(instance, isSSR)
}

/** runtime-dom 注入的模板编译器签名。template 也可为 DOM 节点。 */
type CompileFunction = (
  template: string | object,
  options?: CompilerOptions,
) => InternalRenderFunction

/** 未安装表示 runtime-only 构建。 */
let compile: CompileFunction | undefined
/** 为运行时编译 render 安装更严格 with-proxy 的回调。 */
let installWithProxy: (i: ComponentInternalInstance) => void

/**
 * 供 runtime-dom 的 full build 注册运行时模板编译器。
 * 导出参数使用 any，避免 runtime-core 的 d.ts 反向依赖 compiler 类型。
 */
export function registerRuntimeCompiler(_compile: any): void {
  compile = _compile
  installWithProxy = i => {
    if (i.render!._rc) {
      i.withProxy = new Proxy(i.ctx, RuntimeCompiledPublicInstanceProxyHandlers)
    }
  }
}

/** 当前构建是否没有运行时模板编译器。主要用于开发警告。 */
export const isRuntimeOnly = (): boolean => !compile

/**
 * 确定组件最终 render：优先 setup 返回，其次组件 render，再次运行时编译 template，
 * 最后应用 Options API。SSR 的运行时模板编译由 server-renderer 独立负责。
 */
export function finishComponentSetup(
  instance: ComponentInternalInstance,
  isSSR: boolean,
  skipOptions?: boolean,
): void {
  const Component = instance.type as ComponentOptions

  if (__COMPAT__) {
    convertLegacyRenderFn(instance)

    if (__DEV__ && Component.compatConfig) {
      validateCompatConfig(Component.compatConfig)
    }
  }

  // 规范化 template/render；setup() 若直接返回 render，instance.render 已提前赋值。
  if (!instance.render) {
    // 仅客户端执行即时模板编译；SSR 的即时编译由 server-renderer 负责生成 ssrRender。
    if (!isSSR && compile && !Component.render) {
      const template =
        (__COMPAT__ &&
          instance.vnode.props &&
          instance.vnode.props['inline-template']) ||
        Component.template ||
        (__FEATURE_OPTIONS_API__ && resolveMergedOptions(instance).template)
      if (template) {
        if (__DEV__) {
          startMeasure(instance, `compile`)
        }
        const { isCustomElement, compilerOptions } = instance.appContext.config
        const { delimiters, compilerOptions: componentCompilerOptions } =
          Component
        const finalCompilerOptions: CompilerOptions = extend(
          extend(
            {
              isCustomElement,
              delimiters,
            },
            compilerOptions,
          ),
          componentCompilerOptions,
        )
        if (__COMPAT__) {
          // 编译器也要知道当前兼容模式，才能生成 Vue 2 filters/v-model 等旧语义代码。
          finalCompilerOptions.compatConfig = Object.create(globalCompatConfig)
          if (Component.compatConfig) {
            // @ts-expect-error types are not compatible
            extend(finalCompilerOptions.compatConfig, Component.compatConfig)
          }
        }
        Component.render = compile(template, finalCompilerOptions)
        if (__DEV__) {
          endMeasure(instance, `compile`)
        }
      }
    }

    instance.render = (Component.render || NOOP) as InternalRenderFunction

    // 运行时编译 render 使用 `with` 块，需要专用 Proxy.has：既提高标识符查找性能，
    // 又只允许白名单全局变量穿透，避免模板意外访问任意 globalThis 属性。
    if (installWithProxy) {
      installWithProxy(instance)
    }
  }

  // 应用 Options API；兼容层预创建未挂载根时可通过 skipOptions 避免重复应用。
  if (__FEATURE_OPTIONS_API__ && !(__COMPAT__ && skipOptions)) {
    const reset = setCurrentInstance(instance)
    pauseTracking()
    try {
      applyOptions(instance)
    } finally {
      resetTracking()
      reset()
    }
  }

  // 客户端既无 template 编译结果也无 render 时提示；SSR 即时编译由服务端包处理。
  if (__DEV__ && !Component.render && instance.render === NOOP && !isSSR) {
    if (!compile && Component.template) {
      /* v8 ignore start */
      warn(
        `Component provided template option but ` +
          `runtime compilation is not supported in this build of Vue.` +
          (__ESM_BUNDLER__
            ? ` Configure your bundler to alias "vue" to "vue/dist/vue.esm-bundler.js".`
            : __ESM_BROWSER__
              ? ` Use "vue.esm-browser.js" instead.`
              : __GLOBAL__
                ? ` Use "vue.global.js" instead.`
                : ``) /* should not happen */,
      )
      /* v8 ignore stop */
    } else {
      warn(`Component is missing template or render function: `, Component)
    }
  }
}

/** setupContext.attrs 的只读代理：读取会追踪整组 attrs 变化，开发环境拒绝写入。 */
const attrsProxyHandlers = __DEV__
  ? {
      get(target: Data, key: string) {
        markAttrsAccessed()
        track(target, TrackOpTypes.GET, '')
        return target[key]
      },
      set() {
        warn(`setupContext.attrs is readonly.`)
        return false
      },
      deleteProperty() {
        warn(`setupContext.attrs is readonly.`)
        return false
      },
    }
  : {
      get(target: Data, key: string) {
        track(target, TrackOpTypes.GET, '')
        return target[key]
      },
    }

/** 开发环境 slots 代理：读取 slot 时追踪 `$slots`，便于 HMR/诊断触发更新。 */
function getSlotsProxy(instance: ComponentInternalInstance): Slots {
  return new Proxy(instance.slots, {
    get(target, key: string) {
      track(instance, TrackOpTypes.GET, '$slots')
      return target[key]
    },
  })
}

/**
 * 创建 setup 第二参数 `{ attrs, slots, emit, expose }`。
 *
 * 开发环境用 getter 惰性创建代理并冻结外层对象，既能警告误写，也允许 test-utils 在
 * 内部替换 instance 字段后 getter 读取最新值；生产环境使用更少包装。
 */
export function createSetupContext(
  instance: ComponentInternalInstance,
): SetupContext {
  const expose: SetupContext['expose'] = exposed => {
    if (__DEV__) {
      if (instance.exposed) {
        warn(`expose() should be called only once per setup().`)
      }
      if (exposed != null) {
        let exposedType: string = typeof exposed
        if (exposedType === 'object') {
          if (isArray(exposed)) {
            exposedType = 'array'
          } else if (isRef(exposed)) {
            exposedType = 'ref'
          }
        }
        if (exposedType !== 'object') {
          warn(
            `expose() should be passed a plain object, received ${exposedType}.`,
          )
        }
      }
    }
    instance.exposed = exposed || {}
  }

  if (__DEV__) {
    // 开发用 getter，兼容 test-utils 替换 instance.attrs/slots；生产代码不应这样覆盖。
    let attrsProxy: Attrs
    let slotsProxy: Slots
    return Object.freeze({
      get attrs() {
        return (
          attrsProxy ||
          (attrsProxy = new Proxy(instance.attrs, attrsProxyHandlers) as Attrs)
        )
      },
      get slots() {
        return slotsProxy || (slotsProxy = getSlotsProxy(instance))
      },
      get emit() {
        return (event: string, ...args: any[]) => instance.emit(event, ...args)
      },
      expose,
    })
  } else {
    return {
      attrs: new Proxy(instance.attrs, attrsProxyHandlers) as Attrs,
      slots: instance.slots,
      emit: instance.emit,
      expose,
    }
  }
}

/**
 * 返回 ref/$parent 等公开 API 应暴露的组件实例。
 * 调用 expose() 时只代理 exposed 对象并补 `$el` 等公共属性；否则返回完整 this 代理。
 */
export function getComponentPublicInstance(
  instance: ComponentInternalInstance,
): ComponentPublicInstance | ComponentInternalInstance['exposed'] | null {
  if (instance.exposed) {
    return (
      instance.exposeProxy ||
      (instance.exposeProxy = new Proxy(proxyRefs(markRaw(instance.exposed)), {
        get(target, key: string) {
          if (key in target) {
            return target[key]
          } else if (key in publicPropertiesMap) {
            return publicPropertiesMap[key](instance)
          }
        },
        has(target, key: string) {
          return key in target || key in publicPropertiesMap
        },
      }))
    )
  } else {
    return instance.proxy
  }
}

/** 把 kebab/snake 组件名转换成 PascalCase 的匹配表达式。 */
const classifyRE = /(?:^|[-_])\w/g
/** 格式化组件显示名，供警告与 devtools 使用。 */
const classify = (str: string): string =>
  str.replace(classifyRE, c => c.toUpperCase()).replace(/[-_]/g, '')

/** 读取函数式/对象组件显式名称，并可回退到 SFC 文件名推导的 `__name`。 */
export function getComponentName(
  Component: ConcreteComponent,
  includeInferred = true,
): string | false | undefined {
  return isFunction(Component)
    ? Component.displayName || Component.name
    : Component.name || (includeInferred && Component.__name)
}

/**
 * 为警告栈格式化组件名。
 * 优先显式/推导 name，其次源文件名，再反查局部/全局组件注册表；仍找不到则返回
 * 根组件 `App` 或普通 `Anonymous`。
 */
export function formatComponentName(
  instance: ComponentInternalInstance | null,
  Component: ConcreteComponent,
  isRoot = false,
): string {
  let name = getComponentName(Component)
  if (!name && Component.__file) {
    const match = Component.__file.match(/([^/\\]+)\.\w+$/)
    if (match) {
      name = match[1]
    }
  }

  if (!name && instance) {
    // 从注册表按组件值反查 key；兼容未声明 name 的局部/全局对象组件。
    const inferFromRegistry = (
      registry: Record<string, any> | undefined | null,
    ) => {
      for (const key in registry) {
        if (registry[key] === Component) {
          return key
        }
      }
    }
    name =
      inferFromRegistry(instance.components) ||
      (instance.parent &&
        inferFromRegistry(
          (instance.parent.type as ComponentOptions).components,
        )) ||
      inferFromRegistry(instance.appContext.components)
  }

  return name ? classify(name) : isRoot ? `App` : `Anonymous`
}

/** 判断函数是否为携带 `__vccOpts` 的类组件包装。 */
export function isClassComponent(value: unknown): value is ClassComponent {
  return isFunction(value) && '__vccOpts' in value
}

/** runtime-core 与 runtime-dom VueElement 之间的内部协作接口。 */
export interface ComponentCustomElementInterface {
  /** 标记宿主元素由 Vue 自定义元素实现。 @internal */
  _isVueCE: boolean
  /** 向 ShadowRoot 注入当前/父组件样式。 @internal */
  _injectChildStyle(type: ConcreteComponent, parent?: ConcreteComponent): void
  /** 移除子组件动态样式。 @internal */
  _removeChildStyle(type: ConcreteComponent): void
  /** 更新元素 prop，并可控制 attribute 反射和组件重渲染。 @internal */
  _setProp(
    key: string,
    val: any,
    shouldReflect?: boolean,
    shouldUpdate?: boolean,
  ): void
  /** 开始一批 Vue 内部 patch，抑制中途重复更新。 @internal */
  _beginPatch(): void
  /** 结束内部 patch，并在需要时提交一次组件更新。 @internal */
  _endPatch(): void
  /** 未启用 ShadowRoot 时，嵌套 Teleport 登记的外部目标集合。 @internal */
  _teleportTargets?: Set<RendererElement>
  /** 当前自定义元素是否启用 ShadowRoot。 @internal */
  _hasShadowRoot(): boolean
}
