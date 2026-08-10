import type {
  ComponentInjectOptions,
  ComponentOptions,
  ComponentOptionsBase,
  ComponentOptionsMixin,
  ComponentProvideOptions,
  ComputedOptions,
  MethodOptions,
  RenderFunction,
} from './componentOptions'
import type {
  AllowedComponentProps,
  Component,
  ComponentCustomProps,
  GlobalComponents,
  GlobalDirectives,
  SetupContext,
} from './component'
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
import { type IsKeyValues, extend, isFunction } from '@vue/shared'
import type { VNodeProps } from './vnode'
import type {
  ComponentPublicInstanceConstructor,
  CreateComponentPublicInstanceWithMixins,
} from './componentPublicInstance'
import type { SlotsType } from './componentSlots'
import type { Directive } from './directives'
import type { ComponentTypeEmits } from './apiSetupHelpers'

/**
 * 所有组件都可从父级接收的公共 VNode/框架 props，如 key、ref、class/style 和
 * 用户通过模块扩展加入的 ComponentCustomProps。
 */
export type PublicProps = VNodeProps &
  AllowedComponentProps &
  ComponentCustomProps

/** 把运行时 props 声明或纯类型 props 解析成 setup 只读 props，并合并 emit 监听器。 */
type ResolveProps<PropsOrPropOptions, E extends EmitsOptions> = Readonly<
  PropsOrPropOptions extends ComponentPropsOptions
    ? ExtractPropTypes<PropsOrPropOptions>
    : PropsOrPropOptions
> &
  ({} extends E ? {} : EmitsToProps<E>)

/**
 * `defineComponent()` 返回值的核心类型。
 *
 * 它同时具有“可被 `new` 推导公共实例”的构造签名、完整组件选项类型和公共 props。
 * 这不是运行时真的创建 class，而是让模板、TSX、`ref<typeof Comp>` 与 IDE 能从同一
 * 组件定义推导 props、emits、slots、expose、本地资源及 `$el`/模板 ref 类型。
 *
 * 泛型依次保留 props、setup 返回值、data、computed、methods、mixin/extends、emits、
 * slots、局部组件/指令、expose、provide、模板 refs 与根元素类型。
 */
export type DefineComponent<
  PropsOrPropOptions = {},
  RawBindings = {},
  D = {},
  C extends ComputedOptions = ComputedOptions,
  M extends MethodOptions = MethodOptions,
  Mixin extends ComponentOptionsMixin = ComponentOptionsMixin,
  Extends extends ComponentOptionsMixin = ComponentOptionsMixin,
  E extends EmitsOptions = {},
  EE extends string = string,
  PP = PublicProps,
  Props = ResolveProps<PropsOrPropOptions, E>,
  Defaults = ExtractDefaultPropTypes<PropsOrPropOptions>,
  S extends SlotsType = {},
  LC extends Record<string, Component> = {},
  Directives extends Record<string, Directive> = {},
  Exposed extends string = string,
  Provide extends ComponentProvideOptions = ComponentProvideOptions,
  MakeDefaultsOptional extends boolean = true,
  TypeRefs extends Record<string, unknown> = {},
  TypeEl = any,
> = ComponentPublicInstanceConstructor<
  CreateComponentPublicInstanceWithMixins<
    Props,
    RawBindings,
    D,
    C,
    M,
    Mixin,
    Extends,
    E,
    PP,
    Defaults,
    MakeDefaultsOptional,
    {},
    S,
    LC & GlobalComponents,
    Directives & GlobalDirectives,
    Exposed,
    TypeRefs,
    TypeEl
  >
> &
  ComponentOptionsBase<
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
    {},
    string,
    S,
    LC & GlobalComponents,
    Directives & GlobalDirectives,
    Exposed,
    Provide
  > &
  PP

/**
 * 直接把 setup 函数传给 `defineComponent(setup, options)` 时的组件构造类型。
 * 此写法没有 Options API 数据成员，重点为 props、emits 与 slots 提供推导。
 */
export type DefineSetupFnComponent<
  P extends Record<string, any>,
  E extends EmitsOptions = {},
  S extends SlotsType = SlotsType,
  Props = P & EmitsToProps<E>,
  PP = PublicProps,
> = new (
  props: Props & PP,
) => CreateComponentPublicInstanceWithMixins<
  Props,
  {},
  {},
  {},
  {},
  ComponentOptionsMixin,
  ComponentOptionsMixin,
  E,
  PP,
  {},
  false,
  {},
  S
>

/** 把已推导 props 与 `onXxx` emit 监听器合并成组件内部只读 props。 */
type ToResolvedProps<Props, Emits extends EmitsOptions> = Readonly<Props> &
  Readonly<EmitsToProps<Emits>>

/**
 * 声明一个 Vue 组件并为 TypeScript 提供完整上下文推导。
 *
 * 运行时它几乎原样返回传入对象；主要价值发生在类型层：根据选项反推出 props、
 * emits、this、slots 等，并构造供 TSX/手写渲染函数/IDE 使用的“虚拟构造类型”。
 */

// 重载 1：直接传 setup 函数，并使用用户显式声明的 props 接口。
export function defineComponent<
  Props extends Record<string, any>,
  E extends EmitsOptions = {},
  EE extends string = string,
  S extends SlotsType = {},
>(
  setup: (
    props: Props,
    ctx: SetupContext<E, S>,
  ) => RenderFunction | Promise<RenderFunction>,
  options?: Pick<ComponentOptions, 'name' | 'inheritAttrs'> & {
    props?: (keyof NoInfer<Props>)[]
    emits?: E | EE[]
    slots?: S
  },
): DefineSetupFnComponent<Props, E, S>
export function defineComponent<
  Props extends Record<string, any>,
  E extends EmitsOptions = {},
  EE extends string = string,
  S extends SlotsType = {},
>(
  setup: (
    props: Props,
    ctx: SetupContext<E, S>,
  ) => RenderFunction | Promise<RenderFunction>,
  options?: Pick<ComponentOptions, 'name' | 'inheritAttrs'> & {
    props?: ComponentObjectPropsOptions<Props>
    emits?: E | EE[]
    slots?: S
  },
): DefineSetupFnComponent<Props, E, S>

// 重载 2：传组件选项对象，可从运行时 props/emits 或语言工具注入的纯类型字段推导。
export function defineComponent<
  // props 的纯类型声明、运行时对象声明和字符串数组声明
  TypeProps,
  RuntimePropsOptions extends ComponentObjectPropsOptions =
    ComponentObjectPropsOptions,
  RuntimePropsKeys extends string = string,
  // emits 的纯类型声明、运行时声明和事件名数组
  TypeEmits extends ComponentTypeEmits = {},
  RuntimeEmitsOptions extends EmitsOptions = {},
  RuntimeEmitsKeys extends string = string,
  // 其余 Options API/setup 上下文成员
  Data = {},
  SetupBindings = {},
  Computed extends ComputedOptions = {},
  Methods extends MethodOptions = {},
  Mixin extends ComponentOptionsMixin = ComponentOptionsMixin,
  Extends extends ComponentOptionsMixin = ComponentOptionsMixin,
  InjectOptions extends ComponentInjectOptions = {},
  InjectKeys extends string = string,
  Slots extends SlotsType = {},
  LocalComponents extends Record<string, Component> = {},
  Directives extends Record<string, Directive> = {},
  Exposed extends string = string,
  Provide extends ComponentProvideOptions = ComponentProvideOptions,
  // 解析后的 emits：有运行时声明时优先使用，否则把纯类型签名转换为选项形状。
  ResolvedEmits extends EmitsOptions = {} extends RuntimeEmitsOptions
    ? TypeEmitsToOptions<TypeEmits>
    : RuntimeEmitsOptions,
  InferredProps = IsKeyValues<TypeProps> extends true
    ? TypeProps
    : string extends RuntimePropsKeys
      ? ComponentObjectPropsOptions extends RuntimePropsOptions
        ? {}
        : ExtractPropTypes<RuntimePropsOptions>
      : { [key in RuntimePropsKeys]?: any },
  TypeRefs extends Record<string, unknown> = {},
  TypeEl = any,
>(
  options: {
    props?: (RuntimePropsOptions & ThisType<void>) | RuntimePropsKeys[]
    /** @private 仅供 Vue language-tools 携带纯类型 props，运行时不会读取。 */
    __typeProps?: TypeProps
    /** @private 仅供 Vue language-tools 携带纯类型 emits。 */
    __typeEmits?: TypeEmits
    /** @private 仅供 Vue language-tools 携带模板 ref 类型映射。 */
    __typeRefs?: TypeRefs
    /** @private 仅供 Vue language-tools 携带组件根元素类型。 */
    __typeEl?: TypeEl
  } & ComponentOptionsBase<
    ToResolvedProps<InferredProps, ResolvedEmits>,
    SetupBindings,
    Data,
    Computed,
    Methods,
    Mixin,
    Extends,
    RuntimeEmitsOptions,
    RuntimeEmitsKeys,
    {}, // 默认值类型由 DefineComponent 的 ExtractDefaultPropTypes 单独计算
    InjectOptions,
    InjectKeys,
    Slots,
    LocalComponents,
    Directives,
    Exposed,
    Provide
  > &
    ThisType<
      CreateComponentPublicInstanceWithMixins<
        ToResolvedProps<InferredProps, ResolvedEmits>,
        SetupBindings,
        Data,
        Computed,
        Methods,
        Mixin,
        Extends,
        ResolvedEmits,
        {},
        {},
        false,
        InjectOptions,
        Slots,
        LocalComponents,
        Directives,
        string
      >
    >,
): DefineComponent<
  InferredProps,
  SetupBindings,
  Data,
  Computed,
  Methods,
  Mixin,
  Extends,
  ResolvedEmits,
  RuntimeEmitsKeys,
  PublicProps,
  ToResolvedProps<InferredProps, ResolvedEmits>,
  ExtractDefaultPropTypes<RuntimePropsOptions>,
  Slots,
  LocalComponents,
  Directives,
  Exposed,
  Provide,
  // 若提供 TypeProps，则完全尊重用户类型，不再把具有 runtime default 的字段变可选；
  // 否则按普通运行时 props 规则把有默认值的字段在公共调用侧标为可选。
  unknown extends TypeProps ? true : false,
  TypeRefs,
  TypeEl
>

// 运行时实现接近 no-op，复杂逻辑都服务于上面的 TypeScript 重载。
/*@__NO_SIDE_EFFECTS__*/
export function defineComponent(
  options: unknown,
  extraOptions?: ComponentOptions,
) {
  return isFunction(options)
    ? // #8236：Rollup 会把 extend 调用和读取函数 name 视作潜在副作用。使用带
      // PURE 标记的 IIFE 包装，使未被引用的函数式组件仍能从生产包中 tree-shake。
      /*@__PURE__*/ (() =>
        extend({ name: options.name }, extraOptions, { setup: options }))()
    : options
}
