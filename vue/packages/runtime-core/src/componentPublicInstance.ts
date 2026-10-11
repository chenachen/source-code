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
/**
 * 通过映射槽位间接提取 mixin 的各类选项，避免条件类型直接递归引用自身。
 */
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
  /**
   * 虚拟组件构造签名，供 TS/JSX 从组件定义推导实例类型 T；不意味着运行时 new 该组件。
   */
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
  /**
   * 允许高级 API 取得内部实例。
   */
  $: ComponentInternalInstance
  /**
   * Options API data 返回的响应式状态类型。
   */
  $data: D
  /**
   * 公开调用侧 props 类型；MakeDefaultsOptional 开启时，有默认值字段可省略。
   */
  $props: MakeDefaultsOptional extends true
    ? Partial<Defaults> & Omit<Prettify<P> & PublicProps, keyof Defaults>
    : Prettify<P> & PublicProps
  /**
   * 未声明输入的 attrs 类型，包含允许的自定义 attrs 扩展。
   */
  $attrs: Attrs
  /**
   * 模板引用集合与 language-tools 提供的具体 ref 类型交叉。
   */
  $refs: Data & TypeRefs
  /**
   * 把声明 slots 解包为按名调用的函数表。
   */
  $slots: UnwrapSlotsType<S>
  /**
   * 根有状态组件的公开实例，无公开根时为空。
   */
  $root: ComponentPublicInstance | null
  /**
   * 最近有状态父组件公开实例；运行时跳过函数式内部父节点。
   */
  $parent: ComponentPublicInstance | null
  /**
   * 自定义元素宿主的公开类型声明。
   */
  $host: Element | null
  /**
   * 按当前组件 emits 声明约束事件名和参数。
   */
  $emit: EmitFn<E>
  /**
   * 根宿主节点类型，由 TypeEl 泛型携带。
   */
  $el: TypeEl
  /**
   * 组件原始选项类型与合并后生命周期数组形态交叉。
   */
  $options: Options & MergedComponentOptionsOverride
  /**
   * 请求显式组件更新的缓存函数。
   */
  $forceUpdate: () => void
  /**
   * 绑定到公共实例的刷新后回调入口。
   */
  $nextTick: typeof nextTick
  /**
   * 公开实例 watcher 签名：字符串 source 支持字段/点路径，函数 source 推导回调值类型；返回可停止的 WatchStopHandle。
   */
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
    /**
     * 返回内部实例，供高级内部 API 使用。
     */
    $: i => i,
    /**
     * 读取组件 VNode 当前宿主节点；HOC 根变化会由 renderer 同步更新此引用。
     */
    $el: i => i.vnode.el,
    /**
     * 返回 Options API 响应式 data 对象。
     */
    $data: i => i.data,
    /**
     * 开发返回浅只读 props，生产直接返回内部映射；不改变嵌套对象身份。
     */
    $props: i => (__DEV__ ? shallowReadonly(i.props) : i.props),
    /**
     * 开发返回浅只读 attrs，生产复用内部映射；整组变化追踪由公开代理 get 分支完成。
     */
    $attrs: i => (__DEV__ ? shallowReadonly(i.attrs) : i.attrs),
    /**
     * 开发返回浅只读插槽映射，生产直接返回标准化函数表。
     */
    $slots: i => (__DEV__ ? shallowReadonly(i.slots) : i.slots),
    /**
     * 开发返回浅只读模板引用集合，生产直接返回实例 refs。
     */
    $refs: i => (__DEV__ ? shallowReadonly(i.refs) : i.refs),
    /**
     * 沿 parent 链跳过无公共代理的函数式组件，返回最近有状态父级的公开/暴露代理。
     */
    $parent: i => getPublicInstance(i.parent),
    /**
     * 取得根内部实例对应的公开代理；函数式根向上回退后可能没有公开实例。
     */
    $root: i => getPublicInstance(i.root),
    /**
     * 返回自定义元素宿主 VueElement；普通组件没有 ce，结果为 undefined。
     */
    $host: i => i.ce,
    /**
     * 返回已绑定本实例的 emit 函数，事件从当前组件 VNode props 分发。
     */
    $emit: i => i.emit,
    /**
     * Options API 构建返回缓存的合并选项，否则直接返回组件定义。
     */
    $options: i => (__FEATURE_OPTIONS_API__ ? resolveMergedOptions(i) : i.type),
    /**
     * 首次读取创建并缓存强制更新闭包，后续读取复用 i.f，执行时把直接 effect 更新入口排队。
     */
    $forceUpdate: i =>
      i.f ||
      /** 缓存的 forceUpdate 闭包把 instance.update 加入主队列；update 使用 effect.run，显式请求不依赖 runIfDirty 的判定。 */
      (i.f = () => {
        queueJob(i.update)
      }),
    /**
     * 首次读取将 nextTick 绑定到公共代理并缓存 i.n，让用户回调获得该 this。
     */
    $nextTick: i => i.n || (i.n = nextTick.bind(i.proxy!)),
    /**
     * Options API 构建将 instanceWatch 绑定内部实例，否则返回 NOOP；watcher 因而归属被调用组件。
     */
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
  /**
   * 公开代理 trap 用于回到内部实例的链接，开发环境定义为非枚举 getter。
   */
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
  /**
   * 普通键按 setup/data/props/ctx 优先级解析并缓存来源，再查询内置 $ 属性、CSS Modules 和 globalProperties。OTHER 只跳过普通来源重查，仍可读取随后新增的 ctx/globalProperties；开发环境渲染中缺失键会警告。
   */
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

  /**
   * 优先写 setup/data，再拒绝 prop、script setup binding 与内部公共属性；其他字段落到 ctx。覆盖全局属性时定义实例自有可配置字段，保持应用 globalProperties 不变。返回布尔值决定严格模式赋值结果。
   */
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

  /**
   * 检查缓存和各成员分区是否声明该键，不执行 computed getter；OTHER 值为 0，不会让曾读取的缺失键误报存在。CSS Modules 与全局属性也参与。
   */
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

  /**
   * 新 getter 使旧来源缓存失效，值描述符先按 set 分派写入状态，再由 Reflect 写入 ctx 描述符；支持测试 spy 和用户重定义代理字段。
   */
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
  /**
   * 开发且非测试构建枚举公开实例时警告不要依赖此键集合，再返回 ctx 自有键；生产 ctx 不提供相同调试枚举内容。
   */
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
    /**
     * with 模板读取 Symbol.unscopables 时返回 undefined，其他键委托普通公开代理，保留正常的状态来源与诊断。
     */
    get(target: ComponentRenderContext, key: string) {
      // `with` 会读取 Symbol.unscopables，直接返回避免进入通用查找与警告。
      if ((key as any) === Symbol.unscopables) {
        return
      }
      return PublicInstanceProxyHandlers.get!(target, key, target)
    },
    /**
     * with 模板对非下划线且不在全局白名单的名称返回 true，使标识符留在实例作用域；白名单全局变量返回 false 继续向外查找。
     */
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
    /**
     * ctx 的非枚举内部 _ getter 返回该组件实例，供所有公开代理 trap 定位运行时状态。
     */
    get: () => instance,
  })

  // 公共属性只定义 getter；写入仍由 proxy set 拦截。
  Object.keys(publicPropertiesMap).forEach(key => {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: false,
      /**
       * 开发 ctx 的公共属性 getter 通过 publicPropertiesMap 回读实例，方便控制台检查并保持实际公共值来源一致。
       */
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
        /**
         * 开发 ctx 的 prop getter 回读 instance.props，父级更新同一 props 映射后调试视图仍显示最新值。
         */
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
        /**
         * 开发 ctx 的普通 setup getter 回读 proxyRefs 后的 setupState，调试视图与公开代理的解包结果一致。
         */
        get: () => setupState[key],
        set: NOOP,
      })
    }
  })
}
