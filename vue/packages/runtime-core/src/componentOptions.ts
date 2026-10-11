import {
  type Component,
  type ComponentInternalInstance,
  type ComponentInternalOptions,
  type ConcreteComponent,
  type Data,
  type InternalRenderFunction,
  type SetupContext,
  currentInstance,
} from './component'
import {
  type LooseRequired,
  NOOP,
  type Prettify,
  extend,
  isArray,
  isFunction,
  isObject,
  isPromise,
  isString,
} from '@vue/shared'
import { type Ref, getCurrentScope, isRef, traverse } from '@vue/reactivity'
import { computed } from './apiComputed'
import {
  type WatchCallback,
  type WatchOptions,
  createPathGetter,
  watch,
} from './apiWatch'
import { inject, provide } from './apiInject'
import {
  type DebuggerHook,
  type ErrorCapturedHook,
  onActivated,
  onBeforeMount,
  onBeforeUnmount,
  onBeforeUpdate,
  onDeactivated,
  onErrorCaptured,
  onMounted,
  onRenderTracked,
  onRenderTriggered,
  onServerPrefetch,
  onUnmounted,
  onUpdated,
} from './apiLifecycle'
import {
  type ComputedGetter,
  type WritableComputedOptions,
  reactive,
} from '@vue/reactivity'
import type {
  ComponentObjectPropsOptions,
  ComponentPropsOptions,
  ExtractDefaultPropTypes,
  ExtractPropTypes,
} from './componentProps'
import type {
  EmitsOptions,
  EmitsToProps,
  TypeEmitsToOptions,
} from './componentEmits'
import type { Directive } from './directives'
import {
  type ComponentPublicInstance,
  type CreateComponentPublicInstanceWithMixins,
  type IntersectionMixin,
  type UnwrapMixinsType,
  isReservedPrefix,
} from './componentPublicInstance'
import { warn } from './warning'
import type { VNodeChild } from './vnode'
import { callWithAsyncErrorHandling } from './errorHandling'
import { deepMergeData } from './compat/data'
import { DeprecationTypes, checkCompatEnabled } from './compat/compatConfig'
import {
  type CompatConfig,
  isCompatEnabled,
  softAssertCompatEnabled,
} from './compat/compatConfig'
import type { OptionMergeFunction } from './apiCreateApp'
import { LifecycleHooks } from './enums'
import type { SlotsType } from './componentSlots'
import {
  type ComponentTypeEmits,
  normalizePropsOrEmits,
} from './apiSetupHelpers'
import { markAsyncBoundary } from './helpers/useId'

/**
 * 供库作者通过模块扩展声明自定义组件选项的接口。
 *
 * @example
 * ```ts
 * declare module 'vue' {
 *   interface ComponentCustomOptions {
 *     beforeRouteUpdate?(
 *       to: Route,
 *       from: Route,
 *       next: () => void
 *     ): void
 *   }
 * }
 * ```
 */
export interface ComponentCustomOptions {}

/** 组件客户端 render 函数的公共签名。 */
export type RenderFunction = () => VNodeChild

/**
 * Options API 与 Composition API 组件定义共享的基础选项类型。
 * 泛型分别记录 props、setup bindings、data、computed、methods、mixin/extends、emits、
 * inject、slots、局部资源、expose 与 provide，供 defineComponent 构造公共实例类型。
 */
export interface ComponentOptionsBase<
  Props,
  RawBindings,
  D,
  C extends ComputedOptions,
  M extends MethodOptions,
  Mixin extends ComponentOptionsMixin,
  Extends extends ComponentOptionsMixin,
  E extends EmitsOptions,
  EE extends string = string,
  Defaults = {},
  I extends ComponentInjectOptions = {},
  II extends string = string,
  S extends SlotsType = {},
  LC extends Record<string, Component> = {},
  Directives extends Record<string, Directive> = {},
  Exposed extends string = string,
  Provide extends ComponentProvideOptions = ComponentProvideOptions,
>
  extends
    LegacyOptions<Props, D, C, M, Mixin, Extends, I, II, Provide>,
    ComponentInternalOptions,
    ComponentCustomOptions {
  /**
   * 有状态组件的初始化入口；实例上下文在同步执行窗口内有效，返回状态对象、渲染函数或 async Promise。
   */
  setup?: (
    this: void,
    props: LooseRequired<
      Props &
        Prettify<
          UnwrapMixinsType<
            IntersectionMixin<Mixin> & IntersectionMixin<Extends>,
            'P'
          >
        >
    >,
    ctx: SetupContext<E, S>,
  ) => Promise<RawBindings> | RawBindings | RenderFunction | void
  /**
   * 显式组件名称，供诊断格式化、自引用及 KeepAlive 名称匹配。
   */
  name?: string
  /** 模板字符串，完整版 Web 构建也兼容直接传 DOM 节点。 */
  template?: string | object
  // 此处刻意使用无签名 Function；带具体签名的函数若返回表达式引用 `this`，会使整个
  // Options API ThisType 推导失败。render 不需要在这里约束参数或返回类型。
  /**
   * 组件渲染入口的宽签名，允许编译产物和用户函数；具体公共 this 类型由 DefineComponent 推导。
   */
  render?: Function
  // 同时约束 LC 与 Record<string, Component>：既强制每个值为组件，又保留具体键推导。
  /**
   * 本地组件注册表，与 LC 泛型推导的组件名称集合合并。
   */
  components?: LC & Record<string, Component>
  // 指令表采用相同技巧，在校验值类型的同时保留局部指令名称。
  /**
   * 本地指令注册表，供资源解析优先于应用全局表查找。
   */
  directives?: Directives & Record<string, Directive>
  /**
   * 为 false 时关闭 renderComponentRoot 的自动 attrs 透传，组件可自行绑定 attrs。
   */
  inheritAttrs?: boolean
  /**
   * 运行时事件声明及校验器；用于 emit 诊断和 props/attrs 监听器分流。
   */
  emits?: (E | EE[]) & ThisType<void>
  /**
   * 只承载 slots 类型信息，运行时插槽从 VNode children 初始化。
   */
  slots?: S
  /**
   * Options API 对外实例字段列表，applyOptions 为每个键建立回读 publicThis 的描述符。
   */
  expose?: Exposed[]
  /**
   * 服务端预取钩子签名；server-renderer 等待其 Promise，客户端不消费此阶段。
   */
  serverPrefetch?(): void | Promise<any>

  // 仅运行时编译器构建 --------------------------------------------------------
  /**
   * 当前组件的模板编译配置，仅在运行时编译 template 时参与。
   */
  compilerOptions?: RuntimeCompilerOptions

  // 内部字段 ------------------------------------------------------------------

  /**
   * @internal 仅 SSR：由 compiler-ssr 生成并由 compiler-sfc 挂载。非用户 API，
   * 参数类型有意保持宽松，也方便测试注入。
   */
  ssrRender?: (
    ctx: any,
    push: (item: any) => void,
    parentInstance: ComponentInternalInstance,
    attrs: Data | undefined,
    // 编译器优化后可直接读取的绑定分区。
    $props: ComponentInternalInstance['props'],
    $setup: ComponentInternalInstance['setupState'],
    $data: ComponentInternalInstance['data'],
    $options: ComponentInternalInstance['ctx'],
  ) => void

  /**
   * @internal 仅 compiler-sfc 生成，标记 SSR render 已内联并由 setup() 返回。
   */
  __ssrInlineRender?: boolean

  /**
   * @internal AsyncComponentWrapper 类型标记及 loader。
   */
  __asyncLoader?: () => Promise<ConcreteComponent>
  /**
   * @internal AsyncComponentWrapper 已解析的真实内部组件。
   */
  __asyncResolved?: ConcreteComponent
  /**
   * @internal 暴露给异步组件懒水合策略的入口。
   */
  __asyncHydrate?: (
    el: Element,
    instance: ComponentInternalInstance,
    hydrate: () => void,
  ) => void

  // 类型判别字段 --------------------------------------------------------------

  // 这些字段运行时内部使用，但必须出现在 d.ts 中才能完成联合类型判别与推导。

  // 纯类型判别：区分普通 options 与 defineComponent/FunctionalComponent 构造类型。
  /**
   * 阻止组件选项对象被结构类型误认为可直接调用的 Function；运行时不提供此方法。
   */
  call?: (this: unknown, ...args: unknown[]) => never
  // 内置 VNode 类型的纯类型判别字段。
  __isFragment?: never
  __isTeleport?: never
  __isSuspense?: never

  __defaults?: Defaults
}

/**
 * 运行时模板编译能够接受的编译器选项子集。
 */
export interface RuntimeCompilerOptions {
  /**
   * 平台自定义元素判定函数；命中标签不解析为 Vue 组件。
   */
  isCustomElement?: (tag: string) => boolean
  /**
   * 模板空白文本保留或折叠策略，传递给运行时编译器。
   */
  whitespace?: 'preserve' | 'condense'
  /**
   * 是否保留模板注释节点。
   */
  comments?: boolean
  /**
   * 模板插值起止符二元组。
   */
  delimiters?: [string, string]
}

/**
 * 完整对象式组件选项类型，并通过 ThisType 把合并后的 props/setup/data/computed/methods
 * 暴露为 Options API `this`。
 */
export type ComponentOptions<
  Props = {},
  RawBindings = any,
  D = any,
  C extends ComputedOptions = any,
  M extends MethodOptions = any,
  Mixin extends ComponentOptionsMixin = any,
  Extends extends ComponentOptionsMixin = any,
  E extends EmitsOptions = any,
  EE extends string = string,
  Defaults = {},
  I extends ComponentInjectOptions = {},
  II extends string = string,
  S extends SlotsType = {},
  LC extends Record<string, Component> = {},
  Directives extends Record<string, Directive> = {},
  Exposed extends string = string,
  Provide extends ComponentProvideOptions = ComponentProvideOptions,
> = ComponentOptionsBase<
  Props,
  RawBindings,
  D,
  C,
  M,
  Mixin,
  Extends,
  E,
  EE,
  Defaults,
  I,
  II,
  S,
  LC,
  Directives,
  Exposed,
  Provide
> &
  ThisType<
    CreateComponentPublicInstanceWithMixins<
      {},
      RawBindings,
      D,
      C,
      M,
      Mixin,
      Extends,
      E,
      Readonly<Props>,
      Defaults,
      false,
      I,
      S,
      LC,
      Directives
    >
  >

/** mixins/extends 可接受的宽泛组件选项类型，具体成员在条件类型中重新推导。 */
export type ComponentOptionsMixin = ComponentOptionsBase<
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any
>

/** Options API computed 名称到只读 getter 或可写 computed 选项的映射。 */
export type ComputedOptions = Record<
  string,
  ComputedGetter<any> | WritableComputedOptions<any>
>

/** Options API methods 名称到函数的映射。 */
export interface MethodOptions {
  [key: string]: Function
}

/** 从 computed 选项提取每个 getter 的返回值，形成公共实例属性类型。 */
export type ExtractComputedReturns<T extends any> = {
  [key in keyof T]: T[key] extends { get: (...args: any[]) => infer TReturn }
    ? TReturn
    : T[key] extends (...args: any[]) => infer TReturn
      ? TReturn
      : never
}

/** Options API watch 的对象写法：handler 加 deep/immediate/flush 等 watch 选项。 */
export type ObjectWatchOptionItem = {
  /**
   * watch 的实际回调或 methods 中的方法名，createWatcher 在状态初始化后解析它。
   */
  handler: WatchCallback | string
} & WatchOptions

/** 单个 watch handler 可为方法名、回调函数或对象配置。 */
type WatchOptionItem = string | WatchCallback | ObjectWatchOptionItem

/** 同一 source 可配置单个或多个 watch handler。 */
type ComponentWatchOptionItem = WatchOptionItem | WatchOptionItem[]

/** watch source 表达式/键路径到 handler 配置的映射。 */
type ComponentWatchOptions = Record<string, ComponentWatchOptionItem>

/** provide 选项可为对象，也可为绑定组件 this 的工厂函数。 */
export type ComponentProvideOptions = ObjectProvideOptions | Function

/** 对象式 provide 的字符串或 symbol key 映射。 */
type ObjectProvideOptions = Record<string | symbol, unknown>

/** inject 可使用键数组，或本地键到来源/default 的对象映射。 */
export type ComponentInjectOptions = string[] | ObjectInjectOptions

/** 对象式 inject 的来源键与可选默认值描述。 */
type ObjectInjectOptions = Record<
  string | symbol,
   string
  | symbol
  | {
      /** 祖先提供的来源键，缺省使用本地键名。 */
      from?: string | symbol;
      /** 来源键缺失时使用的值；函数按工厂调用并绑定消费组件公开实例。 */
      default?: unknown
    }
>

/** 把 inject 声明转换为 Options API `this` 上可访问的可选属性映射。 */
export type InjectToObject<T extends ComponentInjectOptions> =
  T extends string[]
    ? {
        [K in T[number]]?: unknown
      }
    : T extends ObjectInjectOptions
      ? {
          [K in keyof T]?: unknown
        }
      : never

/** Options API 传统选项集合；由 ComponentOptionsBase 继承。 */
interface LegacyOptions<
  Props,
  D,
  C extends ComputedOptions,
  M extends MethodOptions,
  Mixin extends ComponentOptionsMixin,
  Extends extends ComponentOptionsMixin,
  I extends ComponentInjectOptions,
  II extends string,
  Provide extends ComponentProvideOptions = ComponentProvideOptions,
> {
  /**
   * 本组件 Vue 2 兼容能力的局部配置。
   */
  compatConfig?: CompatConfig

  // 允许用户通过 ComponentCustomOptions/生态插件加入自定义选项。
  [key: string]: any

  // 状态选项。data 的 `this` 无法暴露 RawBindings，否则会形成循环推导并破坏整个
  // 组件的 ThisType，因此这里仅提供 props/methods/mixins 等已知成员。
  /**
   * 每实例 data 工厂，以已就绪的公共 this 为接收者和首个参数；类型容许读取 props、setup、inject 与 methods，运行时要求返回普通对象。
   */
  data?: (
    this: CreateComponentPublicInstanceWithMixins<
      Props,
      {},
      {},
      {},
      MethodOptions,
      Mixin,
      Extends
    >,
    vm: CreateComponentPublicInstanceWithMixins<
      Props,
      {},
      {},
      {},
      MethodOptions,
      Mixin,
      Extends
    >,
  ) => D
  /**
   * 计算属性 getter 或 get/set 选项映射，初始化为 ctx 描述符。
   */
  computed?: C
  /**
   * 实例方法映射，初始化时绑定 publicThis 后写入 ctx。
   */
  methods?: M
  /**
   * 状态字段/点路径到回调配置的映射，data/computed 就绪后注册。
   */
  watch?: ComponentWatchOptions
  /**
   * 提供给后代的对象或 this 工厂，初始化完成后写入 provides。
   */
  provide?: Provide
  /**
   * 本地字段到祖先键的声明，先于 methods/data 初始化以便这些工厂读取注入值。
   */
  inject?: I | II[]

  // 局部资源注册表。
  /**
   * 仅供 Vue 2 兼容构建注册的过滤器映射；普通 Vue 3 已移除此选项。
   */
  filters?: Record<string, Function>

  // 组件继承与混入来源。
  /**
   * 局部 mixin 列表，按数组顺序递归合并，在本组件自身选项之前生效。
   */
  mixins?: Mixin[]
  /**
   * 单个继承选项来源，mergeOptions 先递归它再处理 mixins 与自身字段。
   */
  extends?: Extends

  // 生命周期选项。
  /**
   * Options API beforeCreate 钩子签名；在状态选项初始化前调用，可修改 $options，运行时会绑定公共实例为 this。
   */
  beforeCreate?(): any
  /**
   * Options API created 钩子签名；在 inject/methods/data/computed/watch/provide 初始化完成后调用，运行时会绑定公共实例为 this。
   */
  created?(): any
  /**
   * Options API beforeMount 钩子签名；在首次 render 和宿主子树创建前调用，运行时会绑定公共实例为 this。
   */
  beforeMount?(): any
  /**
   * Options API mounted 钩子签名；在宿主子树插入后的 post 阶段调用，运行时会绑定公共实例为 this。
   */
  mounted?(): any
  /**
   * Options API beforeUpdate 钩子签名；在本轮 render/patch 前调用，运行时会绑定公共实例为 this。
   */
  beforeUpdate?(): any
  /**
   * Options API updated 钩子签名；在本轮子树 patch 后的 post 阶段调用，运行时会绑定公共实例为 this。
   */
  updated?(): any
  /**
   * Options API activated 钩子签名；在 KeepAlive 缓存组件重新激活后调用，运行时会绑定公共实例为 this。
   */
  activated?(): any
  /**
   * Options API deactivated 钩子签名；在 KeepAlive 组件移入缓存后调用，运行时会绑定公共实例为 this。
   */
  deactivated?(): any
  /**
   * Vue 2 兼容生命周期名称，兼容构建把它登记到 beforeUnmount 阶段。
   * @deprecated 请使用 beforeUnmount。
   */
  beforeDestroy?(): any
  /**
   * Options API beforeUnmount 钩子签名；在停止 effect scope 和卸载子树前调用，运行时会绑定公共实例为 this。
   */
  beforeUnmount?(): any
  /**
   * Vue 2 兼容生命周期名称，兼容构建把它登记到 unmounted 阶段。
   * @deprecated 请使用 unmounted。
   */
  destroyed?(): any
  /**
   * Options API unmounted 钩子签名；在子树已卸载后的 post 阶段调用，运行时会绑定公共实例为 this。
   */
  unmounted?(): any
  /**
   * 渲染 effect 收集依赖时的开发调试钩子。
   */
  renderTracked?: DebuggerHook
  /**
   * 响应式依赖触发渲染 effect 时的开发调试钩子。
   */
  renderTriggered?: DebuggerHook
  /**
   * 后代错误捕获钩子；返回 false 停止向上传播。
   */
  errorCaptured?: ErrorCapturedHook

  /**
   * 仅运行时编译使用。
   * @deprecated 请改用 `compilerOptions.delimiters`。
   */
  delimiters?: [string, string]

  /**
   * #3468
   *
   * 纯类型字段，用于辅助 Mixin 推导。TypeScript 会尝试合并/简化多个结构相似的 mixin；
   * 每个 mixin 的 `__differentiator` 来自不同 data/computed/methods 键，使它们无法被
   * 错误折叠成同一类型。运行时不会读取。
   */
  __differentiator?: keyof D | keyof C | keyof M
}

/** 选项合并后的生命周期可能仍是单函数，也可能是去重函数数组。 */
type MergedHook<T = () => void> = T | T[]

/** 应用全局 mixin/extends 后的完整组件选项。 */
export type MergedComponentOptions = ComponentOptions &
  MergedComponentOptionsOverride

/** 覆盖生命周期字段类型，使合并后的数组形态可被 applyOptions 接受。 */
export type MergedComponentOptionsOverride = {
  beforeCreate?: MergedHook
  created?: MergedHook
  beforeMount?: MergedHook
  mounted?: MergedHook
  beforeUpdate?: MergedHook
  updated?: MergedHook
  activated?: MergedHook
  deactivated?: MergedHook
  /**
   * 合并后的 Vue 2 兼容 beforeDestroy 钩子，允许单函数或数组；兼容初始化将其注册到 beforeUnmount。
   * @deprecated 请使用 beforeUnmount。
   */
  beforeDestroy?: MergedHook
  beforeUnmount?: MergedHook
  /**
   * 合并后的 Vue 2 兼容 destroyed 钩子，允许单函数或数组；兼容初始化将其注册到 unmounted。
   * @deprecated 请使用 unmounted。
   */
  destroyed?: MergedHook
  unmounted?: MergedHook
  renderTracked?: MergedHook<DebuggerHook>
  renderTriggered?: MergedHook<DebuggerHook>
  errorCaptured?: MergedHook<ErrorCapturedHook>
}

/** OptionTypesType 各推导槽位的键名。 */
export type OptionTypesKeys = 'P' | 'B' | 'D' | 'C' | 'M' | 'Defaults'

/** 在 mixin 条件类型间携带各类 Options API 推导结果的结构。 */
export type OptionTypesType<
  P = {},
  B = {},
  D = {},
  C extends ComputedOptions = {},
  M extends MethodOptions = {},
  Defaults = {},
> = {
  P: P
  B: B
  D: D
  C: C
  M: M
  Defaults: Defaults
}

/** 开发环境重复属性诊断中展示的选项来源。 */
enum OptionTypes {
  /** 名称最先由 props 声明。 */
  PROPS = 'Props',
  /** 名称最先由 data 返回。 */
  DATA = 'Data',
  /** 名称最先由 computed 声明。 */
  COMPUTED = 'Computed',
  /** 名称最先由 methods 声明。 */
  METHODS = 'Methods',
  /** 名称最先由 inject 注入。 */
  INJECT = 'Inject',
}

/** 创建当前组件专用的选项键冲突检查器，如 data 与 props 同名。 */
function createDuplicateChecker() {
  const cache = Object.create(null)
  return (type: OptionTypes, key: string) => {
    if (cache[key]) {
      warn(`${type} property "${key}" is already defined in ${cache[key]}.`)
    } else {
      cache[key] = type
    }
  }
}

/**
 * 公开实例 proxy 是否可缓存未命中 key 的 OTHER 来源。初始化 inject、methods、data
 * 期间临时关闭，避免提前访问 data 字段后跳过它的后续查找；data 完成后恢复。
 * computed 随后加入 ctx，而 ctx/globalProperties 在 OTHER 命中后仍会继续查找。
 */
export let shouldCacheAccess = true

/**
 * 把已合并的 Options API 选项应用到组件实例。
 *
 * 初始化顺序与 Vue 2 保持一致：props（已完成）→ inject → methods → data → computed →
 * watch → provide → created/生命周期/资源。顺序决定 `this` 在各工厂中可见哪些字段。
 */
export function applyOptions(instance: ComponentInternalInstance): void {
  const options = resolveMergedOptions(instance)
  const publicThis = instance.proxy! as any
  const ctx = instance.ctx

  // 状态字段仍在加入，暂时禁止 proxy 缓存“键不存在”。
  shouldCacheAccess = false

  // #2791：beforeCreate 可能修改合并后的 `$options`，必须在解构其他选项前调用，后续
  // 初始化才能看到它的修改。
  if (options.beforeCreate) {
    callHook(options.beforeCreate, instance, LifecycleHooks.BEFORE_CREATE)
  }

  const {
    // 状态类选项。
    data: dataOptions,
    computed: computedOptions,
    methods,
    watch: watchOptions,
    provide: provideOptions,
    inject: injectOptions,
    // 生命周期。
    created,
    beforeMount,
    mounted,
    beforeUpdate,
    updated,
    activated,
    deactivated,
    beforeDestroy,
    beforeUnmount,
    destroyed,
    unmounted,
    render,
    renderTracked,
    renderTriggered,
    errorCaptured,
    serverPrefetch,
    // 公开行为。
    expose,
    inheritAttrs,
    // 局部资源。
    components,
    directives,
    filters,
  } = options

  const checkDuplicateProperties = __DEV__ ? createDuplicateChecker() : null

  if (__DEV__) {
    const [propsOptions] = instance.propsOptions
    if (propsOptions) {
      for (const key in propsOptions) {
        checkDuplicateProperties!(OptionTypes.PROPS, key)
      }
    }
  }

  // 顺序与 Vue 2 一致：props（函数外已完成）→ inject → methods → data → computed → watch。
  // data/watch 依赖完整 this 访问，因此不能提前。

  if (injectOptions) {
    resolveInjections(injectOptions, ctx, checkDuplicateProperties)
  }

  if (methods) {
    for (const key in methods) {
      const methodHandler = (methods as MethodOptions)[key]
      if (isFunction(methodHandler)) {
        // 开发 createRenderContext 预定义的同名 getter 只读但可配置；这里重定义为绑定
        // publicThis 的可写 method，便于控制台与 Options API 行为一致。
        if (__DEV__) {
          Object.defineProperty(ctx, key, {
            value: methodHandler.bind(publicThis),
            configurable: true,
            enumerable: true,
            writable: true,
          })
        } else {
          ctx[key] = methodHandler.bind(publicThis)
        }
        if (__DEV__) {
          checkDuplicateProperties!(OptionTypes.METHODS, key)
        }
      } else if (__DEV__) {
        warn(
          `Method "${key}" has type "${typeof methodHandler}" in the component definition. ` +
            `Did you reference the function correctly?`,
        )
      }
    }
  }

  if (dataOptions) {
    if (__DEV__ && !isFunction(dataOptions)) {
      warn(
        `The data option must be a function. ` +
          `Plain object usage is no longer supported.`,
      )
    }
    const data = dataOptions.call(publicThis, publicThis)
    if (__DEV__ && isPromise(data)) {
      warn(
        `data() returned a Promise - note data() cannot be async; If you ` +
          `intend to perform data fetching before component renders, use ` +
          `async setup() + <Suspense>.`,
      )
    }
    if (!isObject(data)) {
      __DEV__ && warn(`data() should return an object.`)
    } else {
      instance.data = reactive(data)
      if (__DEV__) {
        for (const key in data) {
          checkDuplicateProperties!(OptionTypes.DATA, key)
          // 开发将 data getter 暴露在 ctx 便于控制台展开；保留前缀仍只从 $data 访问。
          if (!isReservedPrefix(key[0])) {
            Object.defineProperty(ctx, key, {
              configurable: true,
              enumerable: true,
              /**
               * 开发 ctx 的 data getter 回读原 data 对象，便于控制台枚举；真实响应式读取仍由公开代理的 DATA 分支完成。
               */
              get: () => data[key],
              set: NOOP,
            })
          }
        }
      }
    }
  }

  // inject/methods/data 已稳定，现在可缓存 proxy key 来源。
  shouldCacheAccess = true

  if (computedOptions) {
    for (const key in computedOptions) {
      const opt = (computedOptions as ComputedOptions)[key]
      const get = isFunction(opt)
        ? opt.bind(publicThis, publicThis)
        : isFunction(opt.get)
          ? opt.get.bind(publicThis, publicThis)
          : NOOP
      if (__DEV__ && get === NOOP) {
        warn(`Computed property "${key}" has no getter.`)
      }
      const set =
        !isFunction(opt) && isFunction(opt.set)
          ? opt.set.bind(publicThis)
          : __DEV__
            ? () => {
                warn(
                  `Write operation failed: computed property "${key}" is readonly.`,
                )
              }
            : NOOP
      const c = computed({
        get,
        set,
      })
      Object.defineProperty(ctx, key, {
        enumerable: true,
        configurable: true,
        /**
         * 把 Options computed 的 ctx 属性读取转发到 c.value，使用 computed 自身的惰性求值与缓存。
         */
        get: () => c.value,
        /**
         * ctx 计算属性赋值转发到 c.value，由该 computed 的用户 setter 或只读警告处理。
         */
        set: v => (c.value = v),
      })
      if (__DEV__) {
        checkDuplicateProperties!(OptionTypes.COMPUTED, key)
      }
    }
  }

  if (watchOptions) {
    for (const key in watchOptions) {
      createWatcher(watchOptions[key], ctx, publicThis, key)
    }
  }

  if (provideOptions) {
    const provides = isFunction(provideOptions)
      ? provideOptions.call(publicThis)
      : provideOptions
    Reflect.ownKeys(provides).forEach(key => {
      provide(key, provides[key])
    })
  }

  if (created) {
    callHook(created, instance, LifecycleHooks.CREATED)
  }

  /**
   * 把合并后的单函数或数组逐项绑定 publicThis，再交给对应组合式 API 注册；保留合并顺序，并复用统一钩子包装/错误处理。
   */
  function registerLifecycleHook(
    register: Function,
    hook?: Function | Function[],
  ) {
    if (isArray(hook)) {
      hook.forEach(_hook => register(_hook.bind(publicThis)))
    } else if (hook) {
      register(hook.bind(publicThis))
    }
  }

  registerLifecycleHook(onBeforeMount, beforeMount)
  registerLifecycleHook(onMounted, mounted)
  registerLifecycleHook(onBeforeUpdate, beforeUpdate)
  registerLifecycleHook(onUpdated, updated)
  registerLifecycleHook(onActivated, activated)
  registerLifecycleHook(onDeactivated, deactivated)
  registerLifecycleHook(onErrorCaptured, errorCaptured)
  registerLifecycleHook(onRenderTracked, renderTracked)
  registerLifecycleHook(onRenderTriggered, renderTriggered)
  registerLifecycleHook(onBeforeUnmount, beforeUnmount)
  registerLifecycleHook(onUnmounted, unmounted)
  registerLifecycleHook(onServerPrefetch, serverPrefetch)

  if (__COMPAT__) {
    if (
      beforeDestroy &&
      softAssertCompatEnabled(DeprecationTypes.OPTIONS_BEFORE_DESTROY, instance)
    ) {
      registerLifecycleHook(onBeforeUnmount, beforeDestroy)
    }
    if (
      destroyed &&
      softAssertCompatEnabled(DeprecationTypes.OPTIONS_DESTROYED, instance)
    ) {
      registerLifecycleHook(onUnmounted, destroyed)
    }
  }

  if (isArray(expose)) {
    if (expose.length) {
      const exposed = instance.exposed || (instance.exposed = {})
      expose.forEach(key => {
        Object.defineProperty(exposed, key, {
          /**
           * Options expose 列表的属性 getter 回读 publicThis，保证对外暴露的是最新实例值而非注册时快照。
           */
          get: () => publicThis[key],
          /**
           * Options expose 列表的属性 setter 写回 publicThis，继续受 props/只读公开属性等代理规则约束。
           */
          set: val => (publicThis[key] = val),
          enumerable: true,
        })
      })
    } else if (!instance.exposed) {
      instance.exposed = {}
    }
  }

  // render/inheritAttrs 虽在实例创建时读取组件自身值，仍需让 mixin 合并结果覆盖。
  if (render && instance.render === NOOP) {
    instance.render = render as InternalRenderFunction
  }
  if (inheritAttrs != null) {
    instance.inheritAttrs = inheritAttrs
  }

  // 保存合并后的局部资源注册表，render 期间按实例解析。
  if (components) instance.components = components as any
  if (directives) instance.directives = directives
  if (
    __COMPAT__ &&
    filters &&
    isCompatEnabled(DeprecationTypes.FILTERS, instance)
  ) {
    instance.filters = filters
  }

  if (__SSR__ && serverPrefetch) {
    markAsyncBoundary(instance)
  }
}

/**
 * 把 Options API inject 数组/对象解析到 ctx。
 * 注入 Ref 通过 getter/setter 自动解包并保持双向写入（#4196），普通值直接赋值。
 */
export function resolveInjections(
  injectOptions: ComponentInjectOptions,
  ctx: any,
  checkDuplicateProperties = NOOP as any,
): void {
  if (isArray(injectOptions)) {
    injectOptions = normalizeInject(injectOptions)!
  }
  for (const key in injectOptions) {
    const opt = injectOptions[key]
    let injected: unknown
    if (isObject(opt)) {
      if ('default' in opt) {
        injected = inject(
          opt.from || key,
          opt.default,
          true /* 将函数默认值作为工厂 */,
        )
      } else {
        injected = inject(opt.from || key)
      }
    } else {
      injected = inject(opt)
    }
    if (isRef(injected)) {
      // #4196：Options API this.foo 应表现为解包值，但写入仍更新原 injected ref。
      Object.defineProperty(ctx, key, {
        enumerable: true,
        configurable: true,
        /**
         * Options inject 读取 Ref.value，让 this 上的注入字段自动解包，同时追踪原 Ref 依赖。
         */
        get: () => (injected as Ref).value,
        /**
         * Options inject 赋值回写原 Ref.value，保留提供方与消费方共享的引用关系。
         */
        set: v => ((injected as Ref).value = v),
      })
    } else {
      ctx[key] = injected
    }
    if (__DEV__) {
      checkDuplicateProperties!(OptionTypes.INJECT, key)
    }
  }
}

/** 绑定公开 this 后，通过统一异步错误管道执行 Options API 生命周期。 */
function callHook(
  hook: Function,
  instance: ComponentInternalInstance,
  type: LifecycleHooks,
) {
  callWithAsyncErrorHandling(
    isArray(hook)
      ? hook.map(h => h.bind(instance.proxy!))
      : hook.bind(instance.proxy!),
    instance,
    type,
  )
}

/**
 * 从 Options API watch 的字符串、函数、对象或数组声明创建 Composition watcher。
 * 字符串 key 支持简单点路径，字符串 handler 从 ctx 解析，所有函数绑定 publicThis。
 */
export function createWatcher(
  raw: ComponentWatchOptionItem,
  ctx: Data,
  publicThis: ComponentPublicInstance,
  key: string,
): void {
  let getter = key.includes('.')
    ? createPathGetter(publicThis, key)
    : () => publicThis[key as keyof typeof publicThis]

  const options: WatchOptions = {}
  if (__COMPAT__) {
    const instance =
      currentInstance && getCurrentScope() === currentInstance.scope
        ? currentInstance
        : null

    const newValue = getter()
    if (
      isArray(newValue) &&
      isCompatEnabled(DeprecationTypes.WATCH_ARRAY, instance)
    ) {
      options.deep = true
    }

    const baseGetter = getter
    /**
     * 兼容 WATCH_ARRAY 的路径 getter：取原值后对数组 traverse，恢复 Vue 2 数组内部修改可触发 watch 的依赖收集。
     */
    getter = () => {
      const val = baseGetter()
      if (
        isArray(val) &&
        checkCompatEnabled(DeprecationTypes.WATCH_ARRAY, instance)
      ) {
        traverse(val)
      }
      return val
    }
  }

  if (isString(raw)) {
    const handler = ctx[raw]
    if (isFunction(handler)) {
      if (__COMPAT__) {
        watch(getter, handler as WatchCallback, options)
      } else {
        watch(getter, handler as WatchCallback)
      }
    } else if (__DEV__) {
      warn(`Invalid watch handler specified by key "${raw}"`, handler)
    }
  } else if (isFunction(raw)) {
    if (__COMPAT__) {
      watch(getter, raw.bind(publicThis), options)
    } else {
      watch(getter, raw.bind(publicThis))
    }
  } else if (isObject(raw)) {
    if (isArray(raw)) {
      raw.forEach(r => createWatcher(r, ctx, publicThis, key))
    } else {
      const handler = isFunction(raw.handler)
        ? raw.handler.bind(publicThis)
        : (ctx[raw.handler] as WatchCallback)
      if (isFunction(handler)) {
        watch(getter, handler, __COMPAT__ ? extend(raw, options) : raw)
      } else if (__DEV__) {
        warn(`Invalid watch handler specified by key "${raw.handler}"`, handler)
      }
    }
  } else if (__DEV__) {
    warn(`Invalid watch option: "${key}"`, raw)
  }
}

/**
 * 读取或构造当前组件的合并选项，并按 appContext 中的组件定义缓存。普通 Vue 3 合并按全局 mixin、extends、局部 mixins、自身字段执行；无继承来源时可直接复用组件定义。
 *
 * 兼容 PRIVATE_APIS 的无继承分支会浅复制并附加当前 parent/propsData，这些字段来自该次实例；不能把整个 compat 结果概括为完全不依赖实例。后续 applyOptions 使用返回对象初始化实例。
 */
export function resolveMergedOptions(
  instance: ComponentInternalInstance,
): MergedComponentOptions {
  const base = instance.type as ComponentOptions
  const { mixins, extends: extendsOptions } = base
  const {
    mixins: globalMixins,
    optionsCache: cache,
    config: { optionMergeStrategies },
  } = instance.appContext
  const cached = cache.get(base)

  let resolved: MergedComponentOptions

  if (cached) {
    resolved = cached
  } else if (!globalMixins.length && !mixins && !extendsOptions) {
    if (
      __COMPAT__ &&
      isCompatEnabled(DeprecationTypes.PRIVATE_APIS, instance)
    ) {
      resolved = extend({}, base) as MergedComponentOptions
      resolved.parent = instance.parent && instance.parent.proxy
      resolved.propsData = instance.vnode.props
    } else {
      resolved = base as MergedComponentOptions
    }
  } else {
    resolved = {}
    if (globalMixins.length) {
      globalMixins.forEach(m =>
        mergeOptions(resolved, m, optionMergeStrategies, true),
      )
    }
    mergeOptions(resolved, base, optionMergeStrategies)
  }
  if (isObject(base)) {
    cache.set(base, resolved)
  }
  return resolved
}

/**
 * 按 extends → mixins → 当前选项递归合并 Options API。
 * 每个键优先使用 Vue 内置策略，再使用 app.config.optionMergeStrategies，最后默认覆盖。
 */
export function mergeOptions(
  to: any,
  from: any,
  strats: Record<string, OptionMergeFunction>,
  asMixin = false,
): any {
  if (__COMPAT__ && isFunction(from)) {
    from = from.options
  }

  const { mixins, extends: extendsOptions } = from

  if (extendsOptions) {
    mergeOptions(to, extendsOptions, strats, true)
  }
  if (mixins) {
    mixins.forEach((m: ComponentOptionsMixin) =>
      mergeOptions(to, m, strats, true),
    )
  }

  for (const key in from) {
    if (asMixin && key === 'expose') {
      __DEV__ &&
        warn(
          `"expose" option is ignored when declared in mixins or extends. ` +
            `It should only be declared in the base component itself.`,
        )
    } else {
      const strat = internalOptionMergeStrats[key] || (strats && strats[key])
      to[key] = strat ? strat(to[key], from[key]) : from[key]
    }
  }
  return to
}

/** Vue 内置选项合并策略表：生命周期成数组、资源/方法成对象、data/provide 成合并工厂。 */
export const internalOptionMergeStrats: Record<string, Function> = {
  data: mergeDataFn,
  props: mergeEmitsOrPropsOptions,
  emits: mergeEmitsOrPropsOptions,
  // 同名对象选项按键覆盖。
  methods: mergeObjectOptions,
  computed: mergeObjectOptions,
  // 生命周期选项。
  beforeCreate: mergeAsArray,
  created: mergeAsArray,
  beforeMount: mergeAsArray,
  mounted: mergeAsArray,
  beforeUpdate: mergeAsArray,
  updated: mergeAsArray,
  beforeDestroy: mergeAsArray,
  beforeUnmount: mergeAsArray,
  destroyed: mergeAsArray,
  unmounted: mergeAsArray,
  activated: mergeAsArray,
  deactivated: mergeAsArray,
  errorCaptured: mergeAsArray,
  serverPrefetch: mergeAsArray,
  // 局部资源注册表。
  components: mergeObjectOptions,
  directives: mergeObjectOptions,
  // 同一 source 的 watch 处理器按顺序合并。
  watch: mergeWatchOptions,
  // provide 合并工厂，inject 先统一声明形态。
  provide: mergeDataFn,
  inject: mergeInject,
}

if (__COMPAT__) {
  internalOptionMergeStrats.filters = mergeObjectOptions
}

/** 合并 data/provide 工厂，调用时以后来源字段覆盖前来源字段。 */
function mergeDataFn(to: any, from: any) {
  if (!from) {
    return to
  }
  if (!to) {
    return from
  }
  return /** 执行合并后的 data/provide 工厂：两个来源都绑定调用时的公共 this；普通构建浅覆盖前结果，Vue 2 兼容开关启用时递归合并。 */ function mergedDataFn(
    this: ComponentPublicInstance
  ) {
    return (
      __COMPAT__ && isCompatEnabled(DeprecationTypes.OPTIONS_DATA_MERGE, null)
        ? deepMergeData
        : extend
    )(
      isFunction(to) ? to.call(this, this) : to,
      isFunction(from) ? from.call(this, this) : from,
    )
  }
}

/** 先统一 inject 数组语法，再按对象键覆盖合并。 */
function mergeInject(
  to: ComponentInjectOptions | undefined,
  from: ComponentInjectOptions,
) {
  return mergeObjectOptions(normalizeInject(to), normalizeInject(from))
}

/** 把 `['foo']` inject 简写转换为 `{ foo: 'foo' }`。 */
function normalizeInject(
  raw: ComponentInjectOptions | undefined,
): ObjectInjectOptions | undefined {
  if (isArray(raw)) {
    const res: ObjectInjectOptions = {}
    for (let i = 0; i < raw.length; i++) {
      res[raw[i]] = raw[i]
    }
    return res
  }
  return raw
}

/** 把单值/数组合并成保持顺序的去重数组，主要用于生命周期。 */
function mergeAsArray<T = Function>(to: T[] | T | undefined, from: T | T[]) {
  return to ? [...new Set([].concat(to as any, from as any))] : from
}

/** 在无原型对象上浅合并 methods/computed/components/directives。 */
function mergeObjectOptions(to: Object | undefined, from: Object | undefined) {
  return to ? extend(Object.create(null), to, from) : from
}

/** 合并 props/emits 的数组或对象语法；数组去重，混合语法统一为对象。 */
function mergeEmitsOrPropsOptions(
  to: EmitsOptions | undefined,
  from: EmitsOptions | undefined,
): EmitsOptions | undefined
/**
 * props 合并重载：保留 ComponentPropsOptions 输入/输出类型，运行时与 emits 使用同一个数组/对象规范化策略。
 */
function mergeEmitsOrPropsOptions(
  to: ComponentPropsOptions | undefined,
  from: ComponentPropsOptions | undefined,
): ComponentPropsOptions | undefined
/**
 * 合并 props/emits 的实现：两份数组按顺序去重；混合形状转对象并在无原型目标上后项覆盖，缺少前项直接返回后项。
 */
function mergeEmitsOrPropsOptions(
  to: ComponentPropsOptions | EmitsOptions | undefined,
  from: ComponentPropsOptions | EmitsOptions | undefined,
) {
  if (to) {
    if (isArray(to) && isArray(from)) {
      return [...new Set([...to, ...from])]
    }
    return extend(
      Object.create(null),
      normalizePropsOrEmits(to),
      normalizePropsOrEmits(from ?? {}),
    )
  } else {
    return from
  }
}

/** 按 watch source key 合并 handler；同名 handler 保持为按来源顺序执行的数组。 */
function mergeWatchOptions(
  to: ComponentWatchOptions | undefined,
  from: ComponentWatchOptions | undefined,
) {
  if (!to) return from
  if (!from) return to
  const merged = extend(Object.create(null), to)
  for (const key in from) {
    merged[key] = mergeAsArray(to[key], from[key])
  }
  return merged
}

// 已弃用的历史类型；因过去属于公共导出，为兼容现有 TypeScript 代码继续保留 --------

/**
 * 不声明运行时 props 时使用的旧版组件选项类型别名，可由 __typeProps 携带纯类型信息。
 * 新代码应使用统一的 ComponentOptions/defineComponent 类型推导入口。
 *
 * @deprecated
 */
export type ComponentOptionsWithoutProps<
  Props = {},
  RawBindings = {},
  D = {},
  C extends ComputedOptions = {},
  M extends MethodOptions = {},
  Mixin extends ComponentOptionsMixin = ComponentOptionsMixin,
  Extends extends ComponentOptionsMixin = ComponentOptionsMixin,
  E extends EmitsOptions = {},
  EE extends string = string,
  I extends ComponentInjectOptions = {},
  II extends string = string,
  S extends SlotsType = {},
  LC extends Record<string, Component> = {},
  Directives extends Record<string, Directive> = {},
  Exposed extends string = string,
  Provide extends ComponentProvideOptions = ComponentProvideOptions,
  TE extends ComponentTypeEmits = {},
  ResolvedEmits extends EmitsOptions = {} extends E
    ? TypeEmitsToOptions<TE>
    : E,
  PE = Props & EmitsToProps<ResolvedEmits>,
> = ComponentOptionsBase<
  PE,
  RawBindings,
  D,
  C,
  M,
  Mixin,
  Extends,
  E,
  EE,
  {},
  I,
  II,
  S,
  LC,
  Directives,
  Exposed,
  Provide
> & {
  props?: never
  /** @private 仅供 Vue language-tools 携带纯类型 props。 */
  __typeProps?: Props
  /** @private 仅供 Vue language-tools 携带纯类型 emits。 */
  __typeEmits?: TE
} & ThisType<
    CreateComponentPublicInstanceWithMixins<
      PE,
      RawBindings,
      D,
      C,
      M,
      Mixin,
      Extends,
      ResolvedEmits,
      EE,
      {},
      false,
      I,
      S,
      LC,
      Directives,
      string
    >
  >

/**
 * 以字符串数组声明 props 时使用的旧版组件选项类型别名。
 * 仅为已有类型引用保留，新代码应使用统一的 ComponentOptions/defineComponent。
 *
 * @deprecated
 */
export type ComponentOptionsWithArrayProps<
  PropNames extends string = string,
  RawBindings = {},
  D = {},
  C extends ComputedOptions = {},
  M extends MethodOptions = {},
  Mixin extends ComponentOptionsMixin = ComponentOptionsMixin,
  Extends extends ComponentOptionsMixin = ComponentOptionsMixin,
  E extends EmitsOptions = EmitsOptions,
  EE extends string = string,
  I extends ComponentInjectOptions = {},
  II extends string = string,
  S extends SlotsType = {},
  LC extends Record<string, Component> = {},
  Directives extends Record<string, Directive> = {},
  Exposed extends string = string,
  Provide extends ComponentProvideOptions = ComponentProvideOptions,
  Props = Prettify<Readonly<{ [key in PropNames]?: any } & EmitsToProps<E>>>,
> = ComponentOptionsBase<
  Props,
  RawBindings,
  D,
  C,
  M,
  Mixin,
  Extends,
  E,
  EE,
  {},
  I,
  II,
  S,
  LC,
  Directives,
  Exposed,
  Provide
> & {
  props: PropNames[]
} & ThisType<
    CreateComponentPublicInstanceWithMixins<
      Props,
      RawBindings,
      D,
      C,
      M,
      Mixin,
      Extends,
      E,
      Props,
      {},
      false,
      I,
      S,
      LC,
      Directives,
      string
    >
  >

/**
 * 以对象形式声明 props 时使用的旧版组件选项类型别名。
 * 仅为已有类型引用保留，新代码应使用统一的 ComponentOptions/defineComponent。
 *
 * @deprecated
 */
export type ComponentOptionsWithObjectProps<
  PropsOptions = ComponentObjectPropsOptions,
  RawBindings = {},
  D = {},
  C extends ComputedOptions = {},
  M extends MethodOptions = {},
  Mixin extends ComponentOptionsMixin = ComponentOptionsMixin,
  Extends extends ComponentOptionsMixin = ComponentOptionsMixin,
  E extends EmitsOptions = EmitsOptions,
  EE extends string = string,
  I extends ComponentInjectOptions = {},
  II extends string = string,
  S extends SlotsType = {},
  LC extends Record<string, Component> = {},
  Directives extends Record<string, Directive> = {},
  Exposed extends string = string,
  Provide extends ComponentProvideOptions = ComponentProvideOptions,
  Props = Prettify<
    Readonly<ExtractPropTypes<PropsOptions>> & Readonly<EmitsToProps<E>>
  >,
  Defaults = ExtractDefaultPropTypes<PropsOptions>,
> = ComponentOptionsBase<
  Props,
  RawBindings,
  D,
  C,
  M,
  Mixin,
  Extends,
  E,
  EE,
  Defaults,
  I,
  II,
  S,
  LC,
  Directives,
  Exposed,
  Provide
> & {
  props: PropsOptions & ThisType<void>
} & ThisType<
    CreateComponentPublicInstanceWithMixins<
      Props,
      RawBindings,
      D,
      C,
      M,
      Mixin,
      Extends,
      E,
      Props,
      Defaults,
      false,
      I,
      S,
      LC,
      Directives
    >
  >
