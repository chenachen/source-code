import {
  type Attrs,
  type Component,
  type ComponentInternalInstance,
  type Data,
  getComponentPublicInstance,
  isStatefulComponent,
} from './component'
import { nextTick, queueJob } from './scheduler'
import {
  type OnCleanup,
  type WatchOptions,
  type WatchStopHandle,
  instanceWatch,
} from './apiWatch'
import {
  EMPTY_OBJ,
  type IfAny,
  NOOP,
  type Prettify,
  type UnionToIntersection,
  extend,
  hasOwn,
  isFunction,
  isGloballyAllowed,
  isString,
} from '@vue/shared'
import {
  ReactiveFlags,
  type ShallowUnwrapRef,
  TrackOpTypes,
  type UnwrapNestedRefs,
  shallowReadonly,
  toRaw,
  track,
} from '@vue/reactivity'
import {
  type ComponentInjectOptions,
  type ComponentOptionsBase,
  type ComponentOptionsMixin,
  type ComponentProvideOptions,
  type ComputedOptions,
  type ExtractComputedReturns,
  type InjectToObject,
  type MergedComponentOptionsOverride,
  type MethodOptions,
  type OptionTypesKeys,
  type OptionTypesType,
  resolveMergedOptions,
  shouldCacheAccess,
} from './componentOptions'
import type { EmitFn, EmitsOptions } from './componentEmits'
import type { SlotsType, UnwrapSlotsType } from './componentSlots'
import { markAttrsAccessed } from './componentRenderUtils'
import { currentRenderingInstance } from './componentRenderContext'
import { warn } from './warning'
import { installCompatInstanceProperties } from './compat/instance'
import type { Directive } from './directives'

/**
 * 通过插件/应用配置添加到所有组件公共实例、可由 `this` 访问的自定义属性扩展点。
 *
 * @example
 * 为每个组件实例增加 `$router` 的类型：
 * ```ts
 * import { createApp } from 'vue'
 * import { Router, createRouter } from 'vue-router'
 *
 * declare module 'vue' {
 *   interface ComponentCustomProperties {
 *     $router: Router
 *   }
 * }
 *
 * // 在运行时把 router 实例添加到所有组件公共实例
 * const app = createApp({})
 * const router = createRouter()
 * app.config.globalProperties.$router = router
 *
 * const vm = app.mount('#app')
 * // 现在可以从组件公共实例访问 router
 * vm.$router.push('/')
 * ```
 */
export interface ComponentCustomProperties {}

/** 判断泛型是否仍是未具体化的默认 mixin 类型，避免对 `any` 展开造成类型爆炸。 */
type IsDefaultMixinComponent<T> = T extends ComponentOptionsMixin
  ? ComponentOptionsMixin extends T
    ? true
    : false
  : false

/** 从单个 mixin/extends 递归提取 props、bindings、data、computed、methods 和默认值。 */
type MixinToOptionTypes<T> =
  T extends ComponentOptionsBase<
    infer P,
    infer B,
    infer D,
    infer C,
    infer M,
    infer Mixin,
    infer Extends,
    any,
    any,
    infer Defaults,
    any,
    any,
    any,
    any,
    any,
    any,
    any
  >
    ? OptionTypesType<P & {}, B & {}, D & {}, C & {}, M & {}, Defaults & {}> &
        IntersectionMixin<Mixin> &
        IntersectionMixin<Extends>
    : never

// 用映射类型间接提取 mixin，避免条件类型直接递归引用自身。
type ExtractMixin<T> = {
  Mixin: MixinToOptionTypes<T>
}[T extends ComponentOptionsMixin ? 'Mixin' : never]

/** 把 mixin/extends 联合转换成所有选项类型的交叉结果。 */
export type IntersectionMixin<T> =
  IsDefaultMixinComponent<T> extends true
    ? OptionTypesType
    : UnionToIntersection<ExtractMixin<T>>

/** 从合并后的 OptionTypesType 中取 props/bindings/data/computed/methods/defaults。 */
export type UnwrapMixinsType<
  T,
  Type extends OptionTypesKeys,
> = T extends OptionTypesType ? T[Type] : never

/** 把 void 选项分区规范化为空对象，便于后续交叉类型合并。 */
type EnsureNonVoid<T> = T extends void ? {} : T

/** `defineComponent()` 返回的虚拟构造器类型，用 new 的实例承载公开实例推导。 */
export type ComponentPublicInstanceConstructor<
  T extends ComponentPublicInstance<Props, RawBindings, D, C, M> =
    ComponentPublicInstance<any>,
  Props = any,
  RawBindings = any,
  D = any,
  C extends ComputedOptions = ComputedOptions,
  M extends MethodOptions = MethodOptions,
> = {
  __isFragment?: never
  __isTeleport?: never
  __isSuspense?: never
  new (...args: any[]): T
}

/**
 * @deprecated 内部已不使用，但 vue-tsc 生成的现有库类型仍依赖，需保留兼容。
 */
export type CreateComponentPublicInstance<
  P = {},
  B = {},
  D = {},
  C extends ComputedOptions = {},
  M extends MethodOptions = {},
  Mixin extends ComponentOptionsMixin = ComponentOptionsMixin,
  Extends extends ComponentOptionsMixin = ComponentOptionsMixin,
  E extends EmitsOptions = {},
  PublicProps = P,
  Defaults = {},
  MakeDefaultsOptional extends boolean = false,
  I extends ComponentInjectOptions = {},
  S extends SlotsType = {},
  PublicMixin = IntersectionMixin<Mixin> & IntersectionMixin<Extends>,
  PublicP = UnwrapMixinsType<PublicMixin, 'P'> & EnsureNonVoid<P>,
  PublicB = UnwrapMixinsType<PublicMixin, 'B'> & EnsureNonVoid<B>,
  PublicD = UnwrapMixinsType<PublicMixin, 'D'> & EnsureNonVoid<D>,
  PublicC extends ComputedOptions = UnwrapMixinsType<PublicMixin, 'C'> &
    EnsureNonVoid<C>,
  PublicM extends MethodOptions = UnwrapMixinsType<PublicMixin, 'M'> &
    EnsureNonVoid<M>,
  PublicDefaults = UnwrapMixinsType<PublicMixin, 'Defaults'> &
    EnsureNonVoid<Defaults>,
> = ComponentPublicInstance<
  PublicP,
  PublicB,
  PublicD,
  PublicC,
  PublicM,
  E,
  PublicProps,
  PublicDefaults,
  MakeDefaultsOptional,
  ComponentOptionsBase<
    P,
    B,
    D,
    C,
    M,
    Mixin,
    Extends,
    E,
    string,
    Defaults,
    {},
    string,
    S
  >,
  I,
  S
>

/**
 * `CreateComponentPublicInstance` 的扩展版，增加局部组件、全局指令、expose、template ref
 * 与 provide 推导。为避免内部重复 mixin 推导调整了泛型顺序；#10842 要求创建新类型，
 * 不能直接改旧类型参数顺序，否则依赖旧位置参数的第三方声明会静默错位。
 */
export type CreateComponentPublicInstanceWithMixins<
  P = {},
  B = {},
  D = {},
  C extends ComputedOptions = {},
  M extends MethodOptions = {},
  Mixin extends ComponentOptionsMixin = ComponentOptionsMixin,
  Extends extends ComponentOptionsMixin = ComponentOptionsMixin,
  E extends EmitsOptions = {},
  PublicProps = P,
  Defaults = {},
  MakeDefaultsOptional extends boolean = false,
  I extends ComponentInjectOptions = {},
  S extends SlotsType = {},
  LC extends Record<string, Component> = {},
  Directives extends Record<string, Directive> = {},
  Exposed extends string = string,
  TypeRefs extends Data = {},
  TypeEl = any,
  Provide extends ComponentProvideOptions = ComponentProvideOptions,
  // 合并 mixin/extends 后重新计算公共 props、setup、data、computed、methods 与默认值。
  PublicMixin = IntersectionMixin<Mixin> & IntersectionMixin<Extends>,
  PublicP = UnwrapMixinsType<PublicMixin, 'P'> & EnsureNonVoid<P>,
  PublicB = UnwrapMixinsType<PublicMixin, 'B'> & EnsureNonVoid<B>,
  PublicD = UnwrapMixinsType<PublicMixin, 'D'> & EnsureNonVoid<D>,
  PublicC extends ComputedOptions = UnwrapMixinsType<PublicMixin, 'C'> &
    EnsureNonVoid<C>,
  PublicM extends MethodOptions = UnwrapMixinsType<PublicMixin, 'M'> &
    EnsureNonVoid<M>,
  PublicDefaults = UnwrapMixinsType<PublicMixin, 'Defaults'> &
    EnsureNonVoid<Defaults>,
> = ComponentPublicInstance<
  PublicP,
  PublicB,
  PublicD,
  PublicC,
  PublicM,
  E,
  PublicProps,
  PublicDefaults,
  MakeDefaultsOptional,
  ComponentOptionsBase<
    P,
    B,
    D,
    C,
    M,
    Mixin,
    Extends,
    E,
    string,
    Defaults,
    {},
    string,
    S,
    LC,
    Directives,
    Exposed,
    Provide
  >,
  I,
  S,
  Exposed,
  TypeRefs,
  TypeEl
>

/** 若组件声明了 expose 列表，只从合成 this 类型中保留指定键；空串表示全部暴露。 */
export type ExposedKeys<
  T,
  Exposed extends string & keyof T,
> = '' extends Exposed ? T : Pick<T, Exposed>

/**
 * 组件公开代理的完整类型，同时作为模板渲染上下文和 Options API render 中的 `this`。
 * 它合并公共 `$xxx`、props、setup 返回、data、computed、methods、注入和用户扩展属性。
 */
export type ComponentPublicInstance<
  P = {}, // 从 props 选项提取的内部类型。
  B = {}, // setup() 返回的原始 bindings。
  D = {}, // data() 返回值。
  C extends ComputedOptions = {},
  M extends MethodOptions = {},
  E extends EmitsOptions = {},
  PublicProps = {},
  Defaults = {},
  MakeDefaultsOptional extends boolean = false,
  Options = ComponentOptionsBase<any, any, any, any, any, any, any, any, any>,
  I extends ComponentInjectOptions = {},
  S extends SlotsType = {},
  Exposed extends string = '',
  TypeRefs extends Data = {},
  TypeEl = any,
> = {
  $: ComponentInternalInstance
  $data: D
  $props: MakeDefaultsOptional extends true
    ? Partial<Defaults> & Omit<Prettify<P> & PublicProps, keyof Defaults>
    : Prettify<P> & PublicProps
  $attrs: Attrs
  $refs: Data & TypeRefs
  $slots: UnwrapSlotsType<S>
  $root: ComponentPublicInstance | null
  $parent: ComponentPublicInstance | null
  $host: Element | null
  $emit: EmitFn<E>
  $el: TypeEl
  $options: Options & MergedComponentOptionsOverride
  $forceUpdate: () => void
  $nextTick: typeof nextTick
  $watch<T extends string | ((...args: any) => any)>(
    source: T,
    cb: T extends (...args: any) => infer R
      ? (...args: [R, R, OnCleanup]) => any
      : (...args: [any, any, OnCleanup]) => any,
    options?: WatchOptions,
  ): WatchStopHandle
} & ExposedKeys<
  IfAny<
    P,
    P,
    Readonly<Defaults> & Omit<P, keyof ShallowUnwrapRef<B> | keyof Defaults>
  > &
    ShallowUnwrapRef<B> &
    UnwrapNestedRefs<D> &
    ExtractComputedReturns<C> &
    M &
    ComponentCustomProperties &
    InjectToObject<I>,
  Exposed
>

/** `$el`、`$attrs` 等公共属性名到实例取值器的映射。 */
export type PublicPropertiesMap = Record<
  string,
  (i: ComponentInternalInstance) => any
>

/**
 * #2437：Vue 3 函数式组件存在于内部 parent 链，但没有公开实例代理。`$parent/$root`
 * 遍历必须跳过这些内部节点，返回最近有状态组件，否则用户会得到内部实例形态。
 */
const getPublicInstance = (
  i: ComponentInternalInstance | null,
): ComponentPublicInstance | ComponentInternalInstance['exposed'] | null => {
  if (!i) return null
  if (isStatefulComponent(i)) return getComponentPublicInstance(i)
  return getPublicInstance(i.parent)
}

/** 公共 `$xxx` 属性实现；昂贵的绑定函数按实例缓存为 `i.f`/`i.n`。 */
export const publicPropertiesMap: PublicPropertiesMap =
  // PURE 标记单独换行，避免编译器因前面的类型注解丢弃它。
  /*@__PURE__*/ extend(Object.create(null), {
    $: i => i,
    $el: i => i.vnode.el,
    $data: i => i.data,
    $props: i => (__DEV__ ? shallowReadonly(i.props) : i.props),
    $attrs: i => (__DEV__ ? shallowReadonly(i.attrs) : i.attrs),
    $slots: i => (__DEV__ ? shallowReadonly(i.slots) : i.slots),
    $refs: i => (__DEV__ ? shallowReadonly(i.refs) : i.refs),
    $parent: i => getPublicInstance(i.parent),
    $root: i => getPublicInstance(i.root),
    $host: i => i.ce,
    $emit: i => i.emit,
    $options: i => (__FEATURE_OPTIONS_API__ ? resolveMergedOptions(i) : i.type),
    $forceUpdate: i =>
      i.f ||
      (i.f = () => {
        queueJob(i.update)
      }),
    $nextTick: i => i.n || (i.n = nextTick.bind(i.proxy!)),
    $watch: i => (__FEATURE_OPTIONS_API__ ? instanceWatch.bind(i) : NOOP),
  } as PublicPropertiesMap)

if (__COMPAT__) {
  installCompatInstanceProperties(publicPropertiesMap)
}

/** this 代理普通键已解析到的来源，缓存后可避开重复 hasOwn 热路径。 */
enum AccessTypes {
  /** 未在 setup/data/props/ctx 找到。 */
  OTHER,
  /** 由 setup() 返回并代理到公共实例的组合式状态。 */
  SETUP,
  /** 由 Options API data() 返回的响应式状态。 */
  DATA,
  /** 组件声明并接收到的只读 props。 */
  PROPS,
  /** ctx/methods/computed 等。 */
  CONTEXT,
}

/** 公开代理 target；`_` 保存实际内部实例，其余开发字段仅便于控制台查看。 */
export interface ComponentRenderContext {
  [key: string]: any
  _: ComponentInternalInstance
}

/** `$`/`_` 前缀保留给 Vue 内部与公共 API，data/setup 普通键不代理到 this。 */
export const isReservedPrefix = (key: string): key is '_' | '$' =>
  key === '_' || key === '$'

/** script setup binding 不通过 Options API this 暴露；普通 setupState 才参与查找。 */
const hasSetupBinding = (state: Data, key: string) =>
  state !== EMPTY_OBJ && !state.__isScriptSetup && hasOwn(state, key)

/**
 * 组件公开实例代理。
 * get 的普通键优先级为 setup → data → props → ctx，首次查找后缓存来源；`$xxx`、CSS
 * Modules、globalProperties 再单独处理。set 允许写 setup/data/ctx，但拒绝 props 和公共键。
 */
export const PublicInstanceProxyHandlers: ProxyHandler<any> = {
  get({ _: instance }: ComponentRenderContext, key: string) {
    if (key === ReactiveFlags.SKIP) {
      return true
    }

    const { ctx, setupState, data, props, accessCache, type, appContext } =
      instance

    // 供浏览器自定义 formatter 无需导入类型识别 Vue 实例。
    if (__DEV__ && key === '__isVue') {
      return true
    }

    // render 中每次标识符访问都会进入此 getter，是核心热路径。多次 hasOwn 很昂贵，
    // 所以用无原型 accessCache 记住每个 key 来源，后续只做一次普通对象读取。
    if (key[0] !== '$') {
      const n = accessCache![key]
      if (n !== undefined) {
        switch (n) {
          case AccessTypes.SETUP:
            return setupState[key]
          case AccessTypes.DATA:
            return data[key]
          case AccessTypes.CONTEXT:
            return ctx[key]
          case AccessTypes.PROPS:
            return props![key]
          // 未命中已缓存来源时继续执行下方完整查找。
        }
      } else if (hasSetupBinding(setupState, key)) {
        accessCache![key] = AccessTypes.SETUP
        return setupState[key]
      } else if (
        __FEATURE_OPTIONS_API__ &&
        data !== EMPTY_OBJ &&
        hasOwn(data, key)
      ) {
        accessCache![key] = AccessTypes.DATA
        return data[key]
      } else if (hasOwn(props, key)) {
        accessCache![key] = AccessTypes.PROPS
        return props![key]
      } else if (ctx !== EMPTY_OBJ && hasOwn(ctx, key)) {
        accessCache![key] = AccessTypes.CONTEXT
        return ctx[key]
      } else if (!__FEATURE_OPTIONS_API__ || shouldCacheAccess) {
        accessCache![key] = AccessTypes.OTHER
      }
    }

    const publicGetter = publicPropertiesMap[key]
    let cssModule, globalProperties
    // 公共 `$xxx`；读取 $attrs/$slots 还需登记响应式依赖与透传消费标记。
    if (publicGetter) {
      if (key === '$attrs') {
        track(instance.attrs, TrackOpTypes.GET, '')
        __DEV__ && markAttrsAccessed()
      } else if (__DEV__ && key === '$slots') {
        // `$slots` 依赖主要用于 HMR 强制更新。
        track(instance, TrackOpTypes.GET, key)
      }
      return publicGetter(instance)
    } else if (
      // vue-loader 注入的 CSS Modules 映射。
      (cssModule = type.__cssModules) &&
      (cssModule = cssModule[key])
    ) {
      return cssModule
    } else if (ctx !== EMPTY_OBJ && hasOwn(ctx, key)) {
      // 用户可能显式给 this 设置 `$` 开头自定义 ctx 属性，优先于 globalProperties。
      accessCache![key] = AccessTypes.CONTEXT
      return ctx[key]
    } else if (
      // `app.config.globalProperties` 是最终普通扩展来源。
      ((globalProperties = appContext.config.globalProperties),
      hasOwn(globalProperties, key))
    ) {
      if (__COMPAT__) {
        const desc = Object.getOwnPropertyDescriptor(globalProperties, key)!
        if (desc.get) {
          return desc.get.call(instance.proxy)
        } else {
          const val = globalProperties[key]
          return isFunction(val) ? extend(val.bind(instance.proxy), val) : val
        }
      } else {
        return globalProperties[key]
      }
    } else if (
      __DEV__ &&
      currentRenderingInstance &&
      (!isString(key) ||
        // #1091：isRef/isVNode 会探测 `__v_*` 内部键。若也为这些探测输出“未定义”警告，
        // 警告格式化又可能再次探测实例，形成无限循环，因此跳过该前缀。
        key.indexOf('__v') !== 0)
    ) {
      if (data !== EMPTY_OBJ && isReservedPrefix(key[0]) && hasOwn(data, key)) {
        warn(
          `Property ${JSON.stringify(
            key,
          )} must be accessed via $data because it starts with a reserved ` +
            `character ("$" or "_") and is not proxied on the render context.`,
        )
      } else if (instance === currentRenderingInstance) {
        warn(
          `Property ${JSON.stringify(key)} was accessed during render ` +
            `but is not defined on instance.`,
        )
      }
    }
  },

  set(
    { _: instance }: ComponentRenderContext,
    key: string,
    value: any,
  ): boolean {
    const { data, setupState, ctx } = instance
    if (hasSetupBinding(setupState, key)) {
      setupState[key] = value
      return true
    } else if (
      __DEV__ &&
      setupState.__isScriptSetup &&
      hasOwn(setupState, key)
    ) {
      warn(`Cannot mutate <script setup> binding "${key}" from Options API.`)
      return false
    } else if (
      __FEATURE_OPTIONS_API__ &&
      data !== EMPTY_OBJ &&
      hasOwn(data, key)
    ) {
      data[key] = value
      return true
    } else if (hasOwn(instance.props, key)) {
      __DEV__ && warn(`Attempting to mutate prop "${key}". Props are readonly.`)
      return false
    }
    if (key[0] === '$' && key.slice(1) in instance) {
      __DEV__ &&
        warn(
          `Attempting to mutate public property "${key}". ` +
            `Properties starting with $ are reserved and readonly.`,
        )
      return false
    } else {
      if (__DEV__ && key in instance.appContext.config.globalProperties) {
        Object.defineProperty(ctx, key, {
          enumerable: true,
          configurable: true,
          value,
        })
      } else {
        ctx[key] = value
      }
    }
    return true
  },

  has(
    {
      _: { data, setupState, accessCache, ctx, appContext, props, type },
    }: ComponentRenderContext,
    key: string,
  ) {
    let cssModules
    return !!(
      accessCache![key] ||
      (__FEATURE_OPTIONS_API__ &&
        data !== EMPTY_OBJ &&
        key[0] !== '$' &&
        hasOwn(data, key)) ||
      hasSetupBinding(setupState, key) ||
      hasOwn(props, key) ||
      hasOwn(ctx, key) ||
      hasOwn(publicPropertiesMap, key) ||
      hasOwn(appContext.config.globalProperties, key) ||
      ((cssModules = type.__cssModules) && cssModules[key])
    )
  },

  defineProperty(
    target: ComponentRenderContext,
    key: string,
    descriptor: PropertyDescriptor,
  ) {
    if (descriptor.get != null) {
      // #5417：defineProperty 新增 getter 会改变 key 来源，旧 OTHER/其他来源缓存必须失效。
      target._.accessCache![key] = 0
    } else if (hasOwn(descriptor, 'value')) {
      this.set!(target, key, descriptor.value, null)
    }
    return Reflect.defineProperty(target, key, descriptor)
  },
}

if (__DEV__ && !__TEST__) {
  PublicInstanceProxyHandlers.ownKeys = (target: ComponentRenderContext) => {
    warn(
      `Avoid app logic that relies on enumerating keys on a component instance. ` +
        `The keys will be empty in production mode to avoid performance overhead.`,
    )
    return Reflect.ownKeys(target)
  }
}

/**
 * 运行时编译 `with` 模板专用代理：has trap 把合法标识符留在 with 作用域，并阻止访问
 * `_` 内部前缀；原生全局白名单返回 false，让查找继续落到真实全局对象。
 */
export const RuntimeCompiledPublicInstanceProxyHandlers: ProxyHandler<any> =
  /*@__PURE__*/ extend({}, PublicInstanceProxyHandlers, {
    get(target: ComponentRenderContext, key: string) {
      // `with` 会读取 Symbol.unscopables，直接返回避免进入通用查找与警告。
      if ((key as any) === Symbol.unscopables) {
        return
      }
      return PublicInstanceProxyHandlers.get!(target, key, target)
    },
    has(_: ComponentRenderContext, key: string) {
      const has = key[0] !== '_' && !isGloballyAllowed(key)
      if (__DEV__ && !has && PublicInstanceProxyHandlers.has!(_, key)) {
        warn(
          `Property ${JSON.stringify(
            key,
          )} should not start with _ which is a reserved prefix for Vue internals.`,
        )
      }
      return has
    },
  })

/**
 * 开发环境创建便于控制台检查的代理 target，使展开对象能看到 this 上同名属性。
 * 生产 target 只保留内部 `_`，省去所有属性描述符分配。
 */
export function createDevRenderContext(instance: ComponentInternalInstance) {
  const target: Record<string, any> = {}

  // 非枚举 `_` 供代理 handlers 定位内部实例。
  Object.defineProperty(target, `_`, {
    configurable: true,
    enumerable: false,
    get: () => instance,
  })

  // 公共属性只定义 getter；写入仍由 proxy set 拦截。
  Object.keys(publicPropertiesMap).forEach(key => {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: false,
      get: () => publicPropertiesMap[key](instance),
      // setter 无需实现，但存在可避免严格模式在进入 proxy 前抛描述符写错误。
      set: NOOP,
    })
  })

  return target as ComponentRenderContext
}

/** 开发环境把声明 props 以 getter 暴露在 ctx，便于控制台枚举与 Options API 检查。 */
export function exposePropsOnRenderContext(
  instance: ComponentInternalInstance,
): void {
  const {
    ctx,
    propsOptions: [propsOptions],
  } = instance
  if (propsOptions) {
    Object.keys(propsOptions).forEach(key => {
      Object.defineProperty(ctx, key, {
        enumerable: true,
        configurable: true,
        get: () => instance.props[key],
        set: NOOP,
      })
    })
  }
}

/** 开发环境把普通 setupState bindings 暴露在 ctx，并警告保留前缀。 */
export function exposeSetupStateOnRenderContext(
  instance: ComponentInternalInstance,
): void {
  const { ctx, setupState } = instance
  Object.keys(toRaw(setupState)).forEach(key => {
    if (!setupState.__isScriptSetup) {
      if (isReservedPrefix(key[0])) {
        warn(
          `setup() return property ${JSON.stringify(
            key,
          )} should not start with "$" or "_" ` +
            `which are reserved prefixes for Vue internals.`,
        )
        return
      }
      Object.defineProperty(ctx, key, {
        enumerable: true,
        configurable: true,
        get: () => setupState[key],
        set: NOOP,
      })
    }
  })
}
