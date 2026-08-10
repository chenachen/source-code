import {
  type IfAny,
  type LooseRequired,
  type Prettify,
  type UnionToIntersection,
  extend,
  isArray,
  isFunction,
  isPromise,
} from '@vue/shared'
import {
  type Data,
  type SetupContext,
  createSetupContext,
  getCurrentInstance,
  isInSSRComponentSetup,
  setCurrentInstance,
  setInSSRSetupState,
  unsetCurrentInstance,
} from './component'
import type { EmitFn, EmitsOptions, ObjectEmitsOptions } from './componentEmits'
import type {
  ComponentOptionsBase,
  ComponentOptionsMixin,
  ComputedOptions,
  MethodOptions,
} from './componentOptions'
import type {
  ComponentObjectPropsOptions,
  ComponentPropsOptions,
  ExtractPropTypes,
  PropOptions,
} from './componentProps'
import { warn } from './warning'
import type { SlotsType, StrictUnwrapSlotsType } from './componentSlots'
import type { Ref } from '@vue/reactivity'

/**
 * 开发环境提示编译宏被错误地留到运行时执行。
 * 正常情况下 SFC 编译器会完整消除这些调用；触发此函数通常意味着宏写在了
 * `<script setup>` 之外，或构建链没有经过 `@vue/compiler-sfc`。
 */
const warnRuntimeUsage = (method: string) =>
  warn(
    `${method}() is a compiler-hint helper that is only usable inside ` +
      `<script setup> of a single file component. Its arguments should be ` +
      `compiled away and passing it at runtime has no effect.`,
  )

/**
 * Vue `<script setup>` 编译宏：声明组件 props。参数形式与组件 `props` 选项一致。
 *
 * 运行时声明示例：
 * ```js
 * // 数组语法
 * const props = defineProps(['foo', 'bar'])
 * // 对象语法
 * const props = defineProps({
 *   foo: String,
 *   bar: {
 *     type: Number,
 *     required: true
 *   }
 * })
 * ```
 *
 * 等价的纯类型声明：
 * ```ts
 * // 编译器会生成等价的运行时 props 声明
 * const props = defineProps<{
 *   foo?: string
 *   bar: number
 * }>()
 * ```
 *
 * @see {@link https://vuejs.org/api/sfc-script-setup.html#defineprops-defineemits}
 *
 * 只能在 `<script setup>` 中使用，输出时会被编译掉，不应真的在运行时调用。
 */
// 重载 1：数组形式的运行时 props。
export function defineProps<PropNames extends string = string>(
  props: PropNames[],
): Prettify<Readonly<{ [key in PropNames]?: any }>>
// 重载 2：对象形式的运行时 props，可推导类型、required 与 default。
export function defineProps<
  PP extends ComponentObjectPropsOptions = ComponentObjectPropsOptions,
>(props: PP): Prettify<Readonly<ExtractPropTypes<PP>>>
// 重载 3：纯类型声明，LooseRequired 让类型解析阶段能统一检查所有键。
export function defineProps<TypeProps>(): DefineProps<
  LooseRequired<TypeProps>,
  BooleanKey<TypeProps>
>
// 运行时兜底；正常编译产物不会保留该调用。
export function defineProps() {
  if (__DEV__) {
    warnRuntimeUsage(`defineProps`)
  }
  return null as any
}

/** defineProps 的只读结果；布尔 prop 即使未传也会被运行时转换为 false。 */
export type DefineProps<T, BKeys extends keyof T> = Readonly<T> & {
  readonly [K in BKeys]-?: boolean
}

/** 从 props 类型中筛出可参与布尔值转换的键，同时排除 never/纯 undefined。 */
type BooleanKey<T, K extends keyof T = keyof T> = K extends any
  ? T[K] extends boolean | undefined
    ? T[K] extends never | undefined
      ? never
      : K
    : never
  : never

/**
 * Vue `<script setup>` 编译宏：声明组件可触发的事件，参数与 `emits` 选项一致。
 *
 * 运行时声明示例：
 * ```js
 * const emit = defineEmits(['change', 'update'])
 * ```
 *
 * 纯类型声明示例：
 * ```ts
 * const emit = defineEmits<{
 *   // <事件名>: <参数元组>
 *   change: []
 *   update: [value: number] // named tuple syntax
 * }>()
 *
 * emit('change')
 * emit('update', 1)
 * ```
 *
 * 只能在 `<script setup>` 中使用，输出时会被编译掉，不应在运行时调用。
 *
 * @see {@link https://vuejs.org/api/sfc-script-setup.html#defineprops-defineemits}
 */
// 重载 1：事件名数组。
export function defineEmits<EE extends string = string>(
  emitOptions: EE[],
): EmitFn<EE[]>
export function defineEmits<E extends EmitsOptions = EmitsOptions>(
  emitOptions: E,
): EmitFn<E>
export function defineEmits<T extends ComponentTypeEmits>(): T extends (
  ...args: any[]
) => any
  ? T
  : ShortEmits<T>
// 运行时兜底；正常编译产物不会保留该调用。
export function defineEmits() {
  if (__DEV__) {
    warnRuntimeUsage(`defineEmits`)
  }
  return null as any
}

/** defineEmits 接受的纯类型：完整 emit 函数签名，或“事件名 -> 参数元组”映射。 */
export type ComponentTypeEmits = ((...args: any[]) => any) | Record<string, any>

/** 取对象各属性值的联合，用于把逐事件函数映射压平成联合。 */
type RecordToUnion<T extends Record<string, any>> = T[keyof T]

/**
 * 将 `{ change: [value: string], close: [] }` 转换为可重载的 emit 函数交叉类型。
 * 联合转交叉使调用方可以按事件名获得各自独立的参数校验。
 */
type ShortEmits<T extends Record<string, any>> = UnionToIntersection<
  RecordToUnion<{
    [K in keyof T]: (evt: K, ...args: T[K]) => void
  }>
>

/**
 * Vue `<script setup>` 编译宏：声明父组件通过模板 ref 可以访问的公开实例属性。
 *
 * `<script setup>` 组件默认封闭，作用域变量不会自动挂到公共实例；只有传给
 * `defineExpose()` 的属性会暴露，并由运行时对其中的 ref 自动解包。
 *
 * 只能在 `<script setup>` 中使用，并在输出中被编译掉。
 *
 * @see {@link https://vuejs.org/api/sfc-script-setup.html#defineexpose}
 */
export function defineExpose<
  Exposed extends Record<string, any> = Record<string, any>,
>(exposed?: Exposed): void {
  if (__DEV__) {
    warnRuntimeUsage(`defineExpose`)
  }
}

/**
 * Vue `<script setup>` 编译宏：声明无法通过组合式 API 表达的额外组件选项，
 * 例如 `inheritAttrs`、`name`。props/emits/expose/slots 各有专用宏，类型上禁止重复声明。
 *
 * @see {@link https://vuejs.org/api/sfc-script-setup.html#defineoptions}
 */
export function defineOptions<
  RawBindings = {},
  D = {},
  C extends ComputedOptions = {},
  M extends MethodOptions = {},
  Mixin extends ComponentOptionsMixin = ComponentOptionsMixin,
  Extends extends ComponentOptionsMixin = ComponentOptionsMixin,
>(
  options?: ComponentOptionsBase<
    {},
    RawBindings,
    D,
    C,
    M,
    Mixin,
    Extends,
    {}
  > & {
    /** props 应通过 `defineProps()` 声明。 */
    props?: never
    /** emits 应通过 `defineEmits()` 声明。 */
    emits?: never
    /** expose 应通过 `defineExpose()` 声明。 */
    expose?: never
    /** slots 应通过 `defineSlots()` 声明。 */
    slots?: never
  },
): void {
  if (__DEV__) {
    warnRuntimeUsage(`defineOptions`)
  }
}

/**
 * Vue `<script setup>` 编译宏：向 IDE 提供插槽名称和插槽 props 类型。
 *
 * 示例：
 * ```ts
 * const slots = defineSlots<{
 *   default(props: { msg: string }): any
 * }>()
 * ```
 *
 * 只能在 `<script setup>` 中使用，并在输出中被编译掉。
 *
 * @see {@link https://vuejs.org/api/sfc-script-setup.html#defineslots}
 */
export function defineSlots<
  S extends Record<string, any> = Record<string, any>,
>(): StrictUnwrapSlotsType<SlotsType<S>> {
  if (__DEV__) {
    warnRuntimeUsage(`defineSlots`)
  }
  return null as any
}

/**
 * `defineModel()` 返回的特殊 ref 类型。
 * 它既是支持独立 getter/setter 输入输出类型的 Ref，又可解构出 `[model, modifiers]`；
 * 第二项记录 `.trim`、`.number` 或自定义 v-model 修饰符。
 */
export type ModelRef<T, M extends PropertyKey = string, G = T, S = T> = Ref<
  G,
  S
> &
  [ModelRef<T, M, G, S>, Record<M, true | undefined>]

/** model 值在组件内部读取/写入时的可选转换器。 */
export type DefineModelOptions<T = any, G = T, S = T> = {
  /** 将父级 prop 值转换为组件读取到的值。 */
  get?: (v: T) => G
  /** 将组件写入值转换为 `update:*` 事件发给父级的值。 */
  set?: (v: S) => any
}

/** defineModel 可接受的运行时 prop 选项，另加 get/set 转换器。 */
type DefineModelRuntimeOptions<T, G, S> = Omit<PropOptions<T>, 'default'> &
  DefineModelOptions<T, G, S>

/** model 默认值沿用 props 默认值规则：对象/数组通常必须使用工厂函数。 */
type DefineModelDefault<T> = InferDefault<Data, T>

/**
 * Vue `<script setup>` 编译宏：声明一个供父组件 `v-model` 使用的双向绑定 prop。
 * 编译器会同时生成同名 prop 和 `update:propName` 事件。
 *
 * 第一个参数是字符串时用作 prop 名，否则默认为 `modelValue`；两种写法都可传
 * prop 运行时选项以及内部读写转换器。
 *
 * 返回 ref 的行为取决于父级是否同时传入对应 prop 与 `onUpdate:*` 监听器：
 * - 已传 v-model：写入会 emit 并与父级 prop 同步；
 * - 未传 v-model：退化为普通本地 ref，组件仍可独立修改它。
 *
 * @example
 * ```ts
 * // 默认 model（父级使用 v-model）
 * const modelValue = defineModel<string>()
 * modelValue.value = "hello"
 *
 * // 带运行时选项的默认 model
 * const modelValue = defineModel<string>({ required: true })
 *
 * // 指定名称（父级使用 v-model:count）
 * const count = defineModel<number>('count')
 * count.value++
 *
 * // 指定名称和默认值
 * const count = defineModel<number>('count', { default: 0 })
 * ```
 */
export function defineModel<T, M extends PropertyKey = string, G = T, S = T>(
  options: DefineModelRuntimeOptions<T, G, S> &
    ({ default: DefineModelDefault<T> } | { required: true }),
): ModelRef<T, M, G, S>

export function defineModel<T, M extends PropertyKey = string, G = T, S = T>(
  options?: DefineModelRuntimeOptions<T, G, S>,
): ModelRef<T | undefined, M, G | undefined, S | undefined>

export function defineModel<T, M extends PropertyKey = string, G = T, S = T>(
  name: string,
  options: DefineModelRuntimeOptions<T, G, S> &
    ({ default: DefineModelDefault<T> } | { required: true }),
): ModelRef<T, M, G, S>

export function defineModel<T, M extends PropertyKey = string, G = T, S = T>(
  name: string,
  options?: DefineModelRuntimeOptions<T, G, S>,
): ModelRef<T | undefined, M, G | undefined, S | undefined>

export function defineModel(): any {
  if (__DEV__) {
    warnRuntimeUsage('defineModel')
  }
}

/** 从类型中移除 undefined，用于默认值已确保存在后的 props 结果。 */
type NotUndefined<T> = T extends undefined ? never : T
/** 支持映射键重命名语法的 Omit，保留联合类型分发所需结构。 */
type MappedOmit<T, K extends keyof any> = {
  [P in keyof T as P extends K ? never : P]: T[P]
}

/** 为每个 prop 约束可接受的默认值类型。 */
type InferDefaults<T> = {
  [K in keyof T]?: InferDefault<T, T[K]>
}

/** 可以直接作为默认值而无需工厂函数的原生值类型。 */
type NativeType =
  null | undefined | number | string | boolean | symbol | Function

/**
 * 单个 prop 默认值：函数可作为工厂接收完整 props；只有原生值允许直接书写。
 * 对象/数组若直接共享会导致组件实例互相污染，因此类型上要求工厂。
 */
type InferDefault<P, T> =
  ((props: P) => T & {}) | (T extends NativeType ? T : never)

/**
 * 计算 `withDefaults()` 之后的 props 类型：具有默认值的键变为必需并移除 undefined，
 * 布尔 prop 继续遵循缺失时转换为 false 的特殊规则。
 */
type PropsWithDefaults<
  T,
  Defaults extends InferDefaults<T>,
  BKeys extends keyof T,
> = T extends unknown
  ? Readonly<MappedOmit<T, keyof Defaults>> & {
      readonly [
        K in keyof Defaults as K extends keyof T ? K : never
      ]-?: K extends keyof T
        ? Defaults[K] extends undefined
          ? IfAny<Defaults[K], NotUndefined<T[K]>, T[K]>
          : NotUndefined<T[K]>
        : never
    } & {
      readonly [K in BKeys]-?: K extends keyof Defaults
        ? Defaults[K] extends undefined
          ? boolean | undefined
          : boolean
        : boolean
    }
  : never

/**
 * Vue `<script setup>` 编译宏：为纯类型 `defineProps` 声明补充运行时默认值。
 *
 * 示例：
 * ```ts
 * withDefaults(defineProps<{
 *   size?: number
 *   labels?: string[]
 * }>(), {
 *   size: 3,
 *   labels: () => ['default label']
 * })
 * ```
 *
 * 只能在 `<script setup>` 中使用，并在输出中被编译掉；不应在运行时直接调用。
 *
 * @see {@link https://vuejs.org/guide/typescript/composition-api.html#typing-component-props}
 */
export function withDefaults<
  T,
  BKeys extends keyof T,
  Defaults extends InferDefaults<T>,
>(
  props: DefineProps<T, BKeys>,
  defaults: Defaults,
): PropsWithDefaults<T, Defaults, BKeys> {
  if (__DEV__) {
    warnRuntimeUsage(`withDefaults`)
  }
  return null as any
}

/** 取得当前组件的 slots；首次调用时会按需创建 SetupContext。 */
export function useSlots(): SetupContext['slots'] {
  return getContext('useSlots').slots
}

/** 取得当前组件未被 props/emits 消费的 attrs 只读代理。 */
export function useAttrs(): SetupContext['attrs'] {
  return getContext('useAttrs').attrs
}

/** 为 useSlots/useAttrs 获取并缓存当前实例的 SetupContext。 */
function getContext(calledFunctionName: string): SetupContext {
  const i = getCurrentInstance()!
  if (__DEV__ && !i) {
    warn(`${calledFunctionName}() called without active instance.`)
  }
  return i.setupContext || (i.setupContext = createSetupContext(i))
}

/**
 * @internal 将数组式 props/emits 声明转换为对象映射，便于后续与其他声明合并。
 * 对象输入原样返回，避免无意义复制。
 */
export function normalizePropsOrEmits(
  props: ComponentPropsOptions | EmitsOptions,
): ComponentObjectPropsOptions | ObjectEmitsOptions {
  return isArray(props)
    ? props.reduce(
        (normalized, p) => ((normalized[p] = null), normalized),
        {} as ComponentObjectPropsOptions | ObjectEmitsOptions,
      )
    : props
}

/**
 * @internal 合并 `withDefaults` 编译生成的默认值与 props 声明，仅由编译代码导入。
 * 数组/构造器形式会升级为 `{ type, default }`；`__skip_*` 元数据表示函数默认值是
 * 字面函数本身而非工厂，运行时应设置 `skipFactory`。
 */
export function mergeDefaults(
  raw: ComponentPropsOptions,
  defaults: Record<string, any>,
): ComponentObjectPropsOptions {
  const props = normalizePropsOrEmits(raw)
  for (const key in defaults) {
    // 编译器附加的 __skip_x 元数据不是实际 prop。
    if (key.startsWith('__skip')) continue
    let opt = props[key]
    if (opt) {
      if (isArray(opt) || isFunction(opt)) {
        opt = props[key] = { type: opt, default: defaults[key] }
      } else {
        opt.default = defaults[key]
      }
    } else if (opt === null) {
      opt = props[key] = { default: defaults[key] }
    } else if (__DEV__) {
      warn(`props default key "${key}" has no corresponding declaration.`)
    }
    if (opt && defaults[`__skip_${key}`]) {
      opt.skipFactory = true
    }
  }
  return props
}

/**
 * @internal 合并普通 props/emits 与 `defineModel` 生成的声明，仅由编译代码调用。
 * 两边都是数组时直接拼接；混合形式统一为对象，使后声明的 model 项可以覆盖同名项。
 */
export function mergeModels(
  a: ComponentPropsOptions | EmitsOptions,
  b: ComponentPropsOptions | EmitsOptions,
): ComponentPropsOptions | EmitsOptions {
  if (!a || !b) return a || b
  if (isArray(a) && isArray(b)) return a.concat(b)
  return extend({}, normalizePropsOrEmits(a), normalizePropsOrEmits(b))
}

/**
 * @internal 为 `const { a, ...rest } = defineProps()` 创建剩余属性代理。
 * 每个键使用 getter 回读原 props，保证父级更新后 `rest.x` 仍是最新值，而不是解构
 * 当时的静态快照。
 */
export function createPropsRestProxy(
  props: any,
  excludedKeys: string[],
): Record<string, any> {
  const ret: Record<string, any> = {}
  for (const key in props) {
    if (!excludedKeys.includes(key)) {
      Object.defineProperty(ret, key, {
        enumerable: true,
        get: () => props[key],
      })
    }
  }
  return ret
}

/**
 * @internal `<script setup>` 的异步上下文辅助函数：让 currentInstance 跨越 await 后恢复。
 *
 * `@vue/compiler-sfc` 会把：
 *
 * ```ts
 * const x = await foo()
 * ```
 *
 * 转换为：
 *
 * ```ts
 * let __temp, __restore
 * const x = (([__temp, __restore] = withAsyncContext(() => foo())),__temp=await __temp,__restore(),__temp)
 * ```
 * await 挂起期间必须清空全局实例，避免其他并发组件错误读取；恢复函数只覆盖紧接着
 * await 的用户 continuation，随后在微任务中再次清理。
 */
export function withAsyncContext(getAwaitable: () => any): [any, () => void] {
  const ctx = getCurrentInstance()!
  const inSSRSetup = isInSSRComponentSetup
  if (__DEV__ && !ctx) {
    warn(
      `withAsyncContext called without active current instance. ` +
        `This is likely a bug.`,
    )
  }
  let awaitable = getAwaitable()
  // Promise 开始执行后立即退出当前组件 effect scope；await 期间其他组件可安全 setup。
  unsetCurrentInstance()
  if (inSSRSetup) {
    setInSSRSetupState(false)
  }

  const restore = () => {
    setCurrentInstance(ctx)
    if (inSSRSetup) {
      setInSSRSetupState(true)
    }
  }

  // 不能恢复调用前捕获的 prev：并发 async setup 中它可能属于兄弟组件，恢复会造成
  // 跨组件上下文泄漏。这里只需平衡 setCurrentInstance(ctx) 打开的 effect scope，
  // 再为用户后续微任务清空全局 currentInstance。
  const cleanup = () => {
    if (getCurrentInstance() !== ctx) ctx.scope.off()
    unsetCurrentInstance()
    if (inSSRSetup) {
      setInSSRSetupState(false)
    }
  }

  if (isPromise(awaitable)) {
    awaitable = awaitable.catch(e => {
      restore()
      // 拒绝路径也先恢复实例，让 async 函数自身的 catch continuation 能正常调用
      // 组合式 API；清理延迟两层微任务，排在该 continuation 之后。
      Promise.resolve().then(() => Promise.resolve().then(cleanup))
      throw e
    })
  }
  return [
    awaitable,
    () => {
      restore()
      // 保留实例给当前 await continuation，随后自动清理。
      Promise.resolve().then(cleanup)
    },
  ]
}
