import {
  TriggerOpTypes,
  shallowReactive,
  shallowReadonly,
  toRaw,
  trigger,
} from '@vue/reactivity'
import {
  EMPTY_ARR,
  EMPTY_OBJ,
  type IfAny,
  PatchFlags,
  camelize,
  capitalize,
  extend,
  hasOwn,
  hyphenate,
  isArray,
  isFunction,
  isObject,
  isOn,
  isReservedProp,
  isString,
  isSymbol,
  makeMap,
  toRawType,
} from '@vue/shared'
import { warn } from './warning'
import {
  type ComponentInternalInstance,
  type ComponentOptions,
  type ConcreteComponent,
  type Data,
  setCurrentInstance,
} from './component'
import { isEmitListener } from './componentEmits'
import type { AppContext } from './apiCreateApp'
import { createPropsDefaultThis } from './compat/props'
import { isCompatEnabled, softAssertCompatEnabled } from './compat/compatConfig'
import { DeprecationTypes } from './compat/compatConfig'
import { shouldSkipAttr } from './compat/attrsFallthrough'
import { createInternalObject } from './internalObject'

/** 组件 props 声明支持对象语法和仅列名称的数组语法。 */
export type ComponentPropsOptions<P = Data> =
  ComponentObjectPropsOptions<P> | string[]

/** 对象 props 声明，把每个公开字段映射到构造器或完整选项。 */
export type ComponentObjectPropsOptions<P = Data> = {
  [K in keyof P]: Prop<P[K]> | null
}

/** 单个 prop 可使用完整选项，也可直接使用运行时类型构造器。 */
export type Prop<T, D = T> = PropOptions<T, D> | PropType<T>

/** default factory 接收当前已解析 props，并为每个组件实例计算默认值。 */
type DefaultFactory<T> = (props: Data) => T | null | undefined

/** 单个 prop 的运行时声明。 */
export interface PropOptions<T = any, D = T> {
  /** 允许的构造器或构造器数组；true/null 表示跳过常规类型限制。 */
  type?: PropType<T> | true | null
  /** 父级是否必须显式传入。 */
  required?: boolean
  /** 缺失/undefined 时使用的值或工厂。对象默认值通常应使用工厂避免跨实例共享。 */
  default?: D | DefaultFactory<D> | null | undefined | object
  /** 类型校验后执行的自定义校验器，可读取全部已解析 props。 */
  validator?(value: unknown, props: Data): boolean
  /** 编译/类型宏确认后跳过开发运行时类型检查。 @internal */
  skipCheck?: boolean
  /** 把函数 default 当普通值而非工厂调用。 @internal */
  skipFactory?: boolean
}

/** prop 运行时类型可为单构造器或包含 null 的构造器联合。 */
export type PropType<T> = PropConstructor<T> | (PropConstructor<T> | null)[]

/** 能在运行时用作 prop 类型检查、同时在 TS 中推导实例类型的构造器。 */
type PropConstructor<T = any> =
  { new (...args: any[]): T & {} } | { (): T } | PropMethod<T>

/** 为函数 prop 构造同时具备调用/构造签名的类型，避免把函数返回值当实例类型。 */
type PropMethod<T, TConstructor = any> = [T] extends [
  ((...args: any) => any) | undefined,
] // 带参数函数 prop 也应允许非 required。
  ? { new (): TConstructor; (): T; readonly prototype: TConstructor } // 构造 Function 风格类型。
  : never

/** 组件内部一定存在的键：required、具有 default，以及缺失时转 false 的 Boolean。 */
type RequiredKeys<T> = {
  [K in keyof T]: T[K] extends
    | { required: true }
    | { default: any }
    // Boolean prop 缺失时隐式为 false，不应在组件内部类型中包含 undefined。
    | BooleanConstructor
    | { type: BooleanConstructor }
    ? T[K] extends { default: undefined | (() => undefined) }
      ? never
      : K
    : never
}[keyof T]

/** 组件内部仍可能为 undefined 的可选 prop 键。 */
type OptionalKeys<T> = Exclude<keyof T, RequiredKeys<T>>

/** 具有显式 default 或 Boolean 隐式默认值的 prop 键。 */
type DefaultKeys<T> = {
  [K in keyof T]: T[K] extends
    | { default: any }
    // Boolean 隐式默认 false。
    | BooleanConstructor
    | { type: BooleanConstructor }
    ? T[K] extends { type: BooleanConstructor; required: true } // required Boolean 不算默认值。
      ? never
      : K
    : never
}[keyof T]

/** 从单个运行时 prop 构造器/选项递归推导 TypeScript 值类型。 */
type InferPropType<T, NullAsAny = true> = [T] extends [null]
  ? NullAsAny extends true
    ? any
    : null
  : [T] extends [{ type: null | true }]
    ? any // TS #14829：从调用签名推导构造器时 ObjectConstructor 可能变 any，
    : // PropMethod 中 BooleanConstructor 也可能被误推导成 Boolean，故显式分支兜底。
      [T] extends [ObjectConstructor | { type: ObjectConstructor }]
      ? Record<string, any>
      : [T] extends [BooleanConstructor | { type: BooleanConstructor }]
        ? boolean
        : [T] extends [DateConstructor | { type: DateConstructor }]
          ? Date
          : [T] extends [(infer U)[] | { type: (infer U)[] }]
            ? U extends DateConstructor
              ? Date | InferPropType<U, false>
              : InferPropType<U, false>
            : [T] extends [Prop<infer V, infer D>]
              ? unknown extends V
                ? keyof V extends never
                  ? IfAny<V, V, D>
                  : V
                : V
              : T

/**
 * 从运行时 props 选项提取组件内部接收的“已解析 props”类型。
 * Boolean 与有 default 的 prop 在内部始终存在。
 *
 * 提取父组件允许传入的公开类型应使用 {@link ExtractPublicPropTypes}。
 */
export type ExtractPropTypes<O> = {
  // 通过 keyof Pick 而非直接 RequiredKeys，保留 IDE 属性提示/跳转能力。
  [K in keyof Pick<O, RequiredKeys<O>>]: O[K] extends { default: any }
    ? Exclude<InferPropType<O[K]>, undefined>
    : InferPropType<O[K]>
} & {
  [K in keyof Pick<O, OptionalKeys<O>>]?: InferPropType<O[K]>
}

/** 父组件调用侧真正必须传入的键；只有 required:true 算必填。 */
type PublicRequiredKeys<T> = {
  [K in keyof T]: T[K] extends { required: true } ? K : never
}[keyof T]

/** 父组件调用侧可省略的 prop 键。 */
type PublicOptionalKeys<T> = Exclude<keyof T, PublicRequiredKeys<T>>

/**
 * 从运行时 props 选项提取父组件可传入的公开 props 类型。
 * 只有 required: true 为必填，default/Boolean 不会强迫父级显式传入。
 */
export type ExtractPublicPropTypes<O> = {
  [K in keyof Pick<O, PublicRequiredKeys<O>>]: InferPropType<O[K]>
} & {
  [K in keyof Pick<O, PublicOptionalKeys<O>>]?: InferPropType<O[K]>
}

/** Boolean prop 标准化后保存的两种转换行为。 */
enum BooleanFlags {
  /** 缺失时转 false，并接受空 attribute。 */
  shouldCast,
  /** 空串/同名字符串是否进一步转 true；String 排在 Boolean 前时关闭。 */
  shouldCastTrue,
}

/** 提取有默认值（含 Boolean 隐式 false）的 props 类型，供 withDefaults 等能力使用。 */
export type ExtractDefaultPropTypes<O> = O extends object
  ? // keyof Pick 形式保留 IDE 属性能力。
    { [K in keyof Pick<O, DefaultKeys<O>>]: InferPropType<O[K]> }
  : {}

/** 加入预计算 Boolean 转换位的单个规范化 prop。 */
type NormalizedProp = PropOptions & {
  [BooleanFlags.shouldCast]?: boolean
  [BooleanFlags.shouldCastTrue]?: boolean
}

/** 规范化后的 camelCase prop 名到选项映射。 */
export type NormalizedProps = Record<string, NormalizedProp>
/**
 * `[规范化选项, 需要 default/Boolean 转换的键]`；无 props 时用共享空元组。
 */
export type NormalizedPropsOptions = [NormalizedProps, string[]] | []

/**
 * 首次把原始 VNode props 拆成声明 props 与透传 attrs，并建立组件 props 响应式对象。
 * 所有声明键即使缺失也补 undefined，保证对象形状和 `key in props` 语义稳定。
 */
export function initProps(
  instance: ComponentInternalInstance,
  rawProps: Data | null,
  isStateful: number, // shapeFlag 位运算结果，非零表示有状态组件。
  isSSR = false,
): void {
  const props: Data = {}
  const attrs: Data = createInternalObject()

  instance.propsDefaults = Object.create(null)

  setFullProps(instance, rawProps, props, attrs)

  // 确保所有声明键存在，default/Boolean 解析及模板访问获得稳定对象形状。
  for (const key in instance.propsOptions[0]) {
    if (!(key in props)) {
      props[key] = undefined
    }
  }

  // 开发环境在完成 default/转换后校验最终值。
  if (__DEV__) {
    validateProps(rawProps || {}, props, instance)
  }

  if (isStateful) {
    // 客户端有状态组件需要浅响应式：只追踪 prop 引用变化，不深代理父级传入对象。
    instance.props = isSSR ? props : shallowReactive(props)
  } else {
    if (!instance.type.props) {
      // 无 props 声明的函数式组件把全部输入同时作为 props/attrs，避免复制。
      instance.props = attrs
    } else {
      // 有声明时仍严格区分 props 与 attrs。
      instance.props = props
    }
  }
  instance.attrs = attrs
}

/** 当前组件或任一祖先是否参与 SFC HMR；模板结构可能使编译优化元数据失效。 */
function isInHmrContext(instance: ComponentInternalInstance | null) {
  while (instance) {
    if (instance.type.__hmrId) return true
    instance = instance.parent
  }
}

/**
 * 父组件更新时同步 props/attrs。
 * 编译器提供稳定 dynamicProps 时走局部更新；HMR、FULL_PROPS 或手写 render 走完整
 * 拆分与删除。attrs 变化会手动 trigger，因为 attrs 内部对象自身不做深响应式包装。
 */
export function updateProps(
  instance: ComponentInternalInstance,
  rawProps: Data | null,
  rawPrevProps: Data | null,
  optimized: boolean,
): void {
  const {
    props,
    attrs,
    vnode: { patchFlag },
  } = instance
  const rawCurrentProps = toRaw(props)
  const [options] = instance.propsOptions
  let hasAttrsChanged = false

  if (
    // 开发 HMR 强制完整 diff：#1942 覆盖 SFC 自身热更；vite#872 覆盖被 SFC 使用的
    // 非 SFC 组件。热更可能改变 prop 声明/动态键，旧 patchFlag 不可信。
    !(__DEV__ && isInHmrContext(instance)) &&
    (optimized || patchFlag > 0) &&
    !(patchFlag & PatchFlags.FULL_PROPS)
  ) {
    if (patchFlag & PatchFlags.PROPS) {
      // 编译器保证键集合不变，只遍历 dynamicProps。
      const propsToUpdate = instance.vnode.dynamicProps!
      for (let i = 0; i < propsToUpdate.length; i++) {
        let key = propsToUpdate[i]
        // 已声明 emit listener 由 emit 系统消费，不进入 props/attrs。
        if (isEmitListener(instance.emitsOptions, key)) {
          continue
        }
        // PROPS flag 与动态 props 同时生成，rawProps 必然非空。
        const value = rawProps![key]
        if (options) {
          // 键集合稳定，首次拆分结果可复用：已在 attrs 的仍是 attr，否则是声明 prop。
          if (hasOwn(attrs, key)) {
            if (value !== attrs[key]) {
              attrs[key] = value
              hasAttrsChanged = true
            }
          } else {
            const camelizedKey = camelize(key)
            props[camelizedKey] = resolvePropValue(
              options,
              rawCurrentProps,
              camelizedKey,
              value,
              instance,
              false /* isAbsent */,
            )
          }
        } else {
          if (__COMPAT__) {
            if (isOn(key) && key.endsWith('Native')) {
              key = key.slice(0, -6) // 去掉 Vue 2 `.native` 编译出的 Native 后缀。
            } else if (shouldSkipAttr(key, instance)) {
              continue
            }
          }
          if (value !== attrs[key]) {
            attrs[key] = value
            hasAttrsChanged = true
          }
        }
      }
    }
  } else {
    // 完整重新拆分，随后删除新输入中已不存在的 props/attrs。
    if (setFullProps(instance, rawProps, props, attrs)) {
      hasAttrsChanged = true
    }
    // 检查声明 prop 删除；删除也需经过 resolvePropValue 以恢复 default/Boolean false。
    let kebabKey: string
    for (const key in rawCurrentProps) {
      if (
        !rawProps ||
        // 父级可能使用 camelCase。
        (!hasOwn(rawProps, key) &&
          // #955：原输入也可能是 kebab-case，初始化时已转 camelCase，删除前两种都要查。
          ((kebabKey = hyphenate(key)) === key || !hasOwn(rawProps, kebabKey)))
      ) {
        if (options) {
          if (
            rawPrevProps &&
            // 旧 camelCase 输入确实存在才解析缺失。
            (rawPrevProps[key] !== undefined ||
              // 或旧 kebab-case 输入存在。
              rawPrevProps[kebabKey!] !== undefined)
          ) {
            props[key] = resolvePropValue(
              options,
              rawCurrentProps,
              key,
              undefined,
              instance,
              true /* isAbsent */,
            )
          }
        } else {
          delete props[key]
        }
      }
    }
    // 无 props 声明的函数式组件 props===attrs，setFullProps 已完成更新，不重复删除。
    if (attrs !== rawCurrentProps) {
      for (const key in attrs) {
        if (
          !rawProps ||
          (!hasOwn(rawProps, key) &&
            (!__COMPAT__ || !hasOwn(rawProps, key + 'Native')))
        ) {
          delete attrs[key]
          hasAttrsChanged = true
        }
      }
    }
  }

  // `$attrs` 可能在插槽函数中读取；整组空 key trigger 通知这些依赖重新渲染。
  if (hasAttrsChanged) {
    trigger(instance.attrs, TriggerOpTypes.SET, '')
  }

  if (__DEV__) {
    validateProps(rawProps || {}, props, instance)
  }
}

/**
 * 完整遍历 rawProps，过滤保留键/emit listener，并拆入 props 与保留原大小写的 attrs。
 * Boolean/default 键先暂存原始值，等普通 prop 全写入后统一解析，使 default factory
 * 能读取同批次其他 props。
 */
function setFullProps(
  instance: ComponentInternalInstance,
  rawProps: Data | null,
  props: Data,
  attrs: Data,
) {
  const [options, needCastKeys] = instance.propsOptions
  let hasAttrsChanged = false
  let rawCastValues: Data | undefined
  if (rawProps) {
    for (let key in rawProps) {
      // key/ref/VNode hooks 等保留字段只服务渲染器，不向组件输入透传。
      if (isReservedProp(key)) {
        continue
      }

      if (__COMPAT__) {
        if (key.startsWith('onHook:')) {
          softAssertCompatEnabled(
            DeprecationTypes.INSTANCE_EVENT_HOOKS,
            instance,
            key.slice(2).toLowerCase(),
          )
        }
        if (key === 'inline-template') {
          continue
        }
      }

      const value = rawProps[key]
      // 声明阶段统一 camelCase；父模板的 kebab-case key 在查找前也需 camelize。
      let camelKey
      if (options && hasOwn(options, (camelKey = camelize(key)))) {
        if (!needCastKeys || !needCastKeys.includes(camelKey)) {
          props[camelKey] = value
        } else {
          ;(rawCastValues || (rawCastValues = {}))[camelKey] = value
        }
      } else if (!isEmitListener(instance.emitsOptions, key)) {
        // 未声明且不是 emit listener 的输入进入 attrs，保留原 key 大小写供自定义元素和
        // `v-bind="$attrs"` 精确透传。
        if (__COMPAT__) {
          if (isOn(key) && key.endsWith('Native')) {
            key = key.slice(0, -6) // 去掉 compat `.native` 后缀。
          } else if (shouldSkipAttr(key, instance)) {
            continue
          }
        }
        if (!(key in attrs) || value !== attrs[key]) {
          attrs[key] = value
          hasAttrsChanged = true
        }
      }
    }
  }

  if (needCastKeys) {
    const rawCurrentProps = toRaw(props)
    const castValues = rawCastValues || EMPTY_OBJ
    for (let i = 0; i < needCastKeys.length; i++) {
      const key = needCastKeys[i]
      props[key] = resolvePropValue(
        options!,
        rawCurrentProps,
        key,
        castValues[key],
        instance,
        !hasOwn(castValues, key),
      )
    }
  }

  return hasAttrsChanged
}

/**
 * 解析单个 prop 的 default factory 与 Boolean attribute 转换。
 *
 * default factory 每个组件实例只执行一次并缓存引用；执行期间设置 currentInstance，
 * 允许默认工厂内部使用注入上下文。Boolean 转换遵循 HTML attribute 语义和声明类型顺序。
 */
function resolvePropValue(
  options: NormalizedProps,
  props: Data,
  key: string,
  value: unknown,
  instance: ComponentInternalInstance,
  isAbsent: boolean,
) {
  const opt = options[key]
  if (opt != null) {
    const hasDefault = hasOwn(opt, 'default')
    // 只有值为 undefined 时应用 default；显式 null 会保留。
    if (hasDefault && value === undefined) {
      const defaultValue = opt.default
      if (
        opt.type !== Function &&
        !opt.skipFactory &&
        isFunction(defaultValue)
      ) {
        const { propsDefaults } = instance
        if (key in propsDefaults) {
          value = propsDefaults[key]
        } else {
          const reset = setCurrentInstance(instance)
          value = propsDefaults[key] = defaultValue.call(
            __COMPAT__ &&
              isCompatEnabled(DeprecationTypes.PROPS_DEFAULT_THIS, instance)
              ? createPropsDefaultThis(instance, props, key)
              : null,
            props,
          )
          reset()
        }
      } else {
        value = defaultValue
      }
      // #9006：自定义元素的默认 prop 也需反射进 VueElement 内部状态，否则元素属性未传
      // 值时组件与宿主 `_props` 会不一致。
      if (instance.ce) {
        instance.ce._setProp(key, value)
      }
    }
    // Boolean 缺失且无 default → false；空串或同名 attribute → true（除非 String 优先）。
    if (opt[BooleanFlags.shouldCast]) {
      if (isAbsent && !hasDefault) {
        value = false
      } else if (
        opt[BooleanFlags.shouldCastTrue] &&
        (value === '' || value === hyphenate(key))
      ) {
        value = true
      }
    }
  }
  return value
}

/** mixin/extends 递归规范化缓存，独立于应用组件缓存，避免跨应用上下文污染。 */
const mixinPropsCache = new WeakMap<ConcreteComponent, NormalizedPropsOptions>()

/**
 * 合并全局 mixin、extends、局部 mixins 的 props，并统一名称/声明形态。
 * 同时预计算需执行 Boolean/default 转换的键，实例更新时无需反复检查构造器列表。
 */
export function normalizePropsOptions(
  comp: ConcreteComponent,
  appContext: AppContext,
  asMixin = false,
): NormalizedPropsOptions {
  const cache =
    __FEATURE_OPTIONS_API__ && asMixin ? mixinPropsCache : appContext.propsCache
  const cached = cache.get(comp)
  if (cached) {
    return cached
  }

  const raw = comp.props
  const normalized: NormalizedPropsOptions[0] = {}
  const needCastKeys: NormalizedPropsOptions[1] = []

  // 先按全局 mixin → extends → 本地 mixins → 组件自身的顺序合并，后者覆盖前者。
  let hasExtends = false
  if (__FEATURE_OPTIONS_API__ && !isFunction(comp)) {
    const extendProps = (raw: ComponentOptions) => {
      if (__COMPAT__ && isFunction(raw)) {
        raw = raw.options
      }
      hasExtends = true
      const [props, keys] = normalizePropsOptions(raw, appContext, true)
      extend(normalized, props)
      if (keys) needCastKeys.push(...keys)
    }
    if (!asMixin && appContext.mixins.length) {
      appContext.mixins.forEach(extendProps)
    }
    if (comp.extends) {
      extendProps(comp.extends)
    }
    if (comp.mixins) {
      comp.mixins.forEach(extendProps)
    }
  }

  if (!raw && !hasExtends) {
    if (isObject(comp)) {
      cache.set(comp, EMPTY_ARR as any)
    }
    return EMPTY_ARR as any
  }

  if (isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      if (__DEV__ && !isString(raw[i])) {
        warn(`props must be strings when using array syntax.`, raw[i])
      }
      const normalizedKey = camelize(raw[i])
      if (validatePropName(normalizedKey)) {
        normalized[normalizedKey] = EMPTY_OBJ
      }
    }
  } else if (raw) {
    if (__DEV__ && !isObject(raw)) {
      warn(`invalid props options`, raw)
    }
    for (const key in raw) {
      const normalizedKey = camelize(key)
      if (validatePropName(normalizedKey)) {
        const opt = raw[key]
        const prop: NormalizedProp = (normalized[normalizedKey] =
          isArray(opt) || isFunction(opt) ? { type: opt } : extend({}, opt))
        const propType = prop.type
        let shouldCast = false
        let shouldCastTrue = true

        if (isArray(propType)) {
          for (let index = 0; index < propType.length; ++index) {
            const type = propType[index]
            const typeName = isFunction(type) && type.name

            if (typeName === 'Boolean') {
              shouldCast = true
              break
            } else if (typeName === 'String') {
              // `[String, Boolean]` 中 String 优先：`checked=""`/`checked="checked"` 应保留
              // 字符串；`[Boolean, String]` 才按 HTML Boolean attribute 转成 true。
              shouldCastTrue = false
            }
          }
        } else {
          shouldCast = isFunction(propType) && propType.name === 'Boolean'
        }

        prop[BooleanFlags.shouldCast] = shouldCast
        prop[BooleanFlags.shouldCastTrue] = shouldCastTrue
        // 只把需要额外解析的键加入列表，普通 props 可直接赋原值。
        if (shouldCast || hasOwn(prop, 'default')) {
          needCastKeys.push(normalizedKey)
        }
      }
    }
  }

  const res: NormalizedPropsOptions = [normalized, needCastKeys]
  if (isObject(comp)) {
    cache.set(comp, res)
  }
  return res
}

/** 拒绝 `$` 前缀和 key/ref/onVnodeXxx 等运行时保留 prop 名。 */
function validatePropName(key: string) {
  if (key[0] !== '$' && !isReservedProp(key)) {
    return true
  } else if (__DEV__) {
    warn(`Invalid prop name: "${key}" is a reserved property.`)
  }
  return false
}

/**
 * 开发环境取得 prop 构造器名称。
 * 不依赖 `instanceof` 判断构造器身份，因此跨 VM/iframe 也能生成正确期望类型文本。
 */
function getType(ctor: Prop<any> | null): string {
  // null 是合法联合成员，先返回避免访问 constructor。
  if (ctor === null) {
    return 'null'
  }

  // 函数常见路径直接读 name，避免 Function#toString 与正则解析。
  if (typeof ctor === 'function') {
    return ctor.name || ''
  } else if (typeof ctor === 'object') {
    // 对象式构造器尽量读取自身 constructor.name。
    const name = ctor.constructor && ctor.constructor.name
    return name || ''
  }

  // 其他类型没有可靠构造器名。
  return ''
}

/** 开发环境遍历规范化声明并校验所有最终 prop 值。 */
function validateProps(
  rawProps: Data,
  props: Data,
  instance: ComponentInternalInstance,
) {
  const resolvedValues = toRaw(props)
  const options = instance.propsOptions[0]
  const camelizePropsKey = Object.keys(rawProps).map(key => camelize(key))
  for (const key in options) {
    let opt = options[key]
    if (opt == null) continue
    validateProp(
      key,
      resolvedValues[key],
      opt,
      __DEV__ ? shallowReadonly(resolvedValues) : resolvedValues,
      !camelizePropsKey.includes(key),
    )
  }
}

/** 开发环境校验 required、构造器联合与自定义 validator。 */
function validateProp(
  name: string,
  value: unknown,
  prop: PropOptions,
  props: Data,
  isAbsent: boolean,
) {
  const { type, required, validator, skipCheck } = prop
  // required 首先判断“父级是否传入”，不能只看解析后 value。
  if (required && isAbsent) {
    warn('Missing required prop: "' + name + '"')
    return
  }
  // 可选 null/undefined 不再进行类型与 validator 检查。
  if (value == null && !required) {
    return
  }
  // 联合类型任一构造器通过即有效。
  if (type != null && type !== true && !skipCheck) {
    let isValid = false
    const types = isArray(type) ? type : [type]
    const expectedTypes = []
    for (let i = 0; i < types.length && !isValid; i++) {
      const { valid, expectedType } = assertType(value, types[i])
      expectedTypes.push(expectedType || '')
      isValid = valid
    }
    if (!isValid) {
      warn(getInvalidTypeMessage(name, value, expectedTypes))
      return
    }
  }
  // 自定义 validator 最后执行，可读取全部 props 做跨字段约束。
  if (validator && !validator(value, props)) {
    warn('Invalid prop: custom validator check failed for prop "' + name + '".')
  }
}

/** 可直接用 typeof 校验的原始构造器名。 */
const isSimpleType = /*@__PURE__*/ makeMap(
  'String,Number,Boolean,Function,Symbol,BigInt',
)

/** 单构造器类型断言结果，同时携带名称供错误消息组合。 */
type AssertionResult = {
  valid: boolean
  expectedType: string
}

/** 开发环境判断值是否符合一个 prop 构造器，兼容原始值包装对象。 */
function assertType(
  value: unknown,
  type: PropConstructor | null,
): AssertionResult {
  let valid
  const expectedType = getType(type)
  if (expectedType === 'null') {
    valid = value === null
  } else if (isSimpleType(expectedType)) {
    const t = typeof value
    valid = t === expectedType.toLowerCase()
    // `new String()` 等包装对象也接受对应构造器。
    if (!valid && t === 'object') {
      valid = value instanceof (type as PropConstructor)
    }
  } else if (expectedType === 'Object') {
    valid = isObject(value)
  } else if (expectedType === 'Array') {
    valid = isArray(value)
  } else {
    valid = value instanceof (type as PropConstructor)
  }
  return {
    valid,
    expectedType,
  }
}

/** 生成包含期望联合、实际类型和可读值的开发 prop 类型错误。 */
function getInvalidTypeMessage(
  name: string,
  value: unknown,
  expectedTypes: string[],
): string {
  if (expectedTypes.length === 0) {
    return (
      `Prop type [] for prop "${name}" won't match anything.` +
      ` Did you mean to use type Array instead?`
    )
  }
  let message =
    `Invalid prop: type check failed for prop "${name}".` +
    ` Expected ${expectedTypes.map(capitalize).join(' | ')}`
  const expectedType = expectedTypes[0]
  const receivedType = toRawType(value)
  const expectedValue = styleValue(value, expectedType)
  const receivedValue = styleValue(value, receivedType)
  // 字符串/数字等可解释且可互转时，同时展示按期望类型转换后的值。
  if (
    expectedTypes.length === 1 &&
    isExplicable(expectedType) &&
    isCoercible(expectedType, receivedType)
  ) {
    message += ` with value ${expectedValue}`
  }
  message += `, got ${receivedType} `
  // 实际类型可安全打印时展示接收到的值。
  if (isExplicable(receivedType)) {
    message += `with value ${receivedValue}.`
  }
  return message
}

/** 按类型格式化错误消息中的值，字符串加引号、Symbol 避免隐式转换异常。 */
function styleValue(value: unknown, type: string): string {
  if (isSymbol(value)) {
    return value.toString()
  } else if (type === 'String') {
    return `"${value}"`
  } else if (type === 'Number') {
    return `${Number(value)}`
  } else {
    return `${value}`
  }
}

/** 类型值是否适合在错误消息中直接展示。 */
function isExplicable(type: string): boolean {
  const explicitTypes = ['string', 'number', 'boolean']
  return explicitTypes.some(elem => type.toLowerCase() === elem)
}

/** 一组类型是否可做有意义的字符串/数字值对照；Boolean/Symbol 不参与。 */
function isCoercible(...args: string[]): boolean {
  return args.every(elem => {
    const value = elem.toLowerCase()
    return value !== 'boolean' && value !== 'symbol'
  })
}
