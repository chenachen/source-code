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
  name?: string
  /** 模板字符串，完整版 Web 构建也兼容直接传 DOM 节点。 */
  template?: string | object
  // 此处刻意使用无签名 Function；带具体签名的函数若返回表达式引用 `this`，会使整个
  // Options API ThisType 推导失败。render 不需要在这里约束参数或返回类型。
  render?: Function
  // 同时约束 LC 与 Record<string, Component>：既强制每个值为组件，又保留具体键推导。
  components?: LC & Record<string, Component>
  // 指令表采用相同技巧，在校验值类型的同时保留局部指令名称。
  directives?: Directives & Record<string, Directive>
  inheritAttrs?: boolean
  emits?: (E | EE[]) & ThisType<void>
  slots?: S
  expose?: Exposed[]
  serverPrefetch?(): void | Promise<any>

  // 仅运行时编译器构建 --------------------------------------------------------
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
  isCustomElement?: (tag: string) => boolean
  whitespace?: 'preserve' | 'condense'
  comments?: boolean
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
  string | symbol | { from?: string | symbol; default?: unknown }
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
  compatConfig?: CompatConfig

  // 允许用户通过 ComponentCustomOptions/生态插件加入自定义选项。
  [key: string]: any

  // 状态选项。data 的 `this` 无法暴露 RawBindings，否则会形成循环推导并破坏整个
  // 组件的 ThisType，因此这里仅提供 props/methods/mixins 等已知成员。
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
  computed?: C
  methods?: M
  watch?: ComponentWatchOptions
  provide?: Provide
  inject?: I | II[]

  // assets
  filters?: Record<string, Function>

  // composition
  mixins?: Mixin[]
  extends?: Extends

  // lifecycle
  beforeCreate?(): any
  created?(): any
  beforeMount?(): any
  mounted?(): any
  beforeUpdate?(): any
  updated?(): any
  activated?(): any
  deactivated?(): any
  /** @deprecated use `beforeUnmount` instead */
  beforeDestroy?(): any
  beforeUnmount?(): any
  /** @deprecated use `unmounted` instead */
  destroyed?(): any
  unmounted?(): any
  renderTracked?: DebuggerHook
  renderTriggered?: DebuggerHook
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
  /** @deprecated use `beforeUnmount` instead */
  beforeDestroy?: MergedHook
  beforeUnmount?: MergedHook
  /** @deprecated use `unmounted` instead */
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
 * 公开实例 proxy 是否可缓存 key 来源。Options 初始化期间会临时关闭，因为 inject、
 * methods、data 等字段正逐步加入 ctx，过早缓存 OTHER 会让稍后新增字段永远查不到。
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
        get: () => c.value,
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
          get: () => publicThis[key],
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
          true /* treat default function as factory */,
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
        get: () => (injected as Ref).value,
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
 * 合并组件的全局 mixin、extends、局部 mixins 并按组件定义缓存。
 * 合并只依赖组件与 appContext，不依赖具体实例，因此同一应用内每个组件定义只做一次。
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
  // objects
  methods: mergeObjectOptions,
  computed: mergeObjectOptions,
  // lifecycle
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
  // assets
  components: mergeObjectOptions,
  directives: mergeObjectOptions,
  // watch
  watch: mergeWatchOptions,
  // provide / inject
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
  return function mergedDataFn(this: ComponentPublicInstance) {
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
function mergeEmitsOrPropsOptions(
  to: ComponentPropsOptions | undefined,
  from: ComponentPropsOptions | undefined,
): ComponentPropsOptions | undefined
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
 * 以字符串数组声明 props 时使用的旧版组件选项类型别名。
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
