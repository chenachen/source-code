import {
  TrackOpTypes,
  TriggerOpTypes,
  isReactive,
  reactive,
  track,
  trigger,
} from '@vue/reactivity'
import {
  NOOP,
  extend,
  invokeArrayFns,
  isArray,
  isFunction,
  isObject,
  isString,
} from '@vue/shared'
import { warn } from '../warning'
import { cloneVNode, createVNode } from '../vnode'
import type { ElementNamespace, RootRenderFunction } from '../renderer'
import type {
  App,
  AppConfig,
  AppContext,
  CreateAppFunction,
  Plugin,
} from '../apiCreateApp'
import {
  type Component,
  type ComponentOptions,
  createComponentInstance,
  finishComponentSetup,
  isRuntimeOnly,
  setupComponent,
} from '../component'
import {
  type RenderFunction,
  internalOptionMergeStrats,
  mergeOptions,
} from '../componentOptions'
import type { ComponentPublicInstance } from '../componentPublicInstance'
import { devtoolsInitApp, devtoolsUnmountApp } from '../devtools'
import type { Directive } from '../directives'
import { nextTick } from '../scheduler'
import { version } from '..'
import {
  type LegacyConfig,
  installLegacyConfigWarnings,
  installLegacyOptionMergeStrats,
} from './globalConfig'
import type { LegacyDirective } from './customDirective'
import {
  DeprecationTypes,
  assertCompatEnabled,
  configureCompat,
  isCompatEnabled,
  softAssertCompatEnabled,
  warnDeprecation,
} from './compatConfig'
import type { LegacyPublicInstance } from './instance'

/**
 * @deprecated Vue 3 已移除默认导出的全局 `Vue` 构造器。该类型只为迁移期旧代码提供，
 * 新代码应使用具名导入，例如 `import { createApp } from 'vue'`。
 */
export type CompatVue = Pick<App, 'version' | 'component' | 'directive'> & {
  /** 配置全局/逐特性的 Vue 2 兼容行为。 */
  configureCompat: typeof configureCompat

  // 不追求完整构造器类型推导；这些签名主要约束内部实现，并向迁移代码显示旧 API。
  new (options?: ComponentOptions): LegacyPublicInstance

  version: string
  config: AppConfig & LegacyConfig

  nextTick: typeof nextTick

  use<Options extends unknown[]>(
    plugin: Plugin<Options>,
    ...options: Options
  ): CompatVue
  use<Options>(plugin: Plugin<Options>, options: Options): CompatVue

  mixin(mixin: ComponentOptions): CompatVue

  component(name: string): Component | undefined
  component(name: string, component: Component): CompatVue
  directive<T = any, V = any>(name: string): Directive<T, V> | undefined
  directive<T = any, V = any>(
    name: string,
    directive: Directive<T, V>,
  ): CompatVue

  compile(template: string): RenderFunction

  /**
   * @deprecated Vue 3 不再支持继承组件构造器，请使用 defineComponent/mixins/composables。
   */
  extend: (options?: ComponentOptions) => CompatVue
  /**
   * @deprecated Vue 3 Proxy 响应式可直接新增属性。
   */
  set(target: any, key: PropertyKey, value: any): void
  /**
   * @deprecated Vue 3 Proxy 响应式可直接删除属性。
   */
  delete(target: any, key: PropertyKey): void
  /**
   * @deprecated 请使用 `reactive()`。
   */
  observable: typeof reactive
  /**
   * @deprecated Vue 3 已移除过滤器，请使用方法或 computed。
   */
  filter(name: string, arg?: any): null
  /** @internal Vue 2 构造器编号。 */
  cid: number
  /** @internal 构造器级合并选项。 */
  options: ComponentOptions
  /** @internal Vue 2 曾暴露的内部工具对象。 */
  util: any
  /** @internal `Vue.extend()` 子构造器的父构造器。 */
  super: CompatVue
}

/**
 * 正在把单例 Vue.config 复制到新 App；复制期间旧字段 setter 不应误报为用户主动访问。
 */
export let isCopyingConfig = false

/** 兼容全局构造器背后的单例 App，仅额外导出供测试验证全局状态传播。 */
export let singletonApp: App
/** 全局 Vue 兼容构造器本身。 */
let singletonCtor: CompatVue

/**
 * 创建 Vue 2 风格的全局 `Vue` 构造器。
 *
 * 内部使用一个空根组件的 singletonApp 保存全局 mixin/组件/指令/config；每次
 * `new Vue()` 再创建独立 Vue 3 App，并把单例状态以原型/副本方式传播过去。
 */
export function createCompatVue(
  createApp: CreateAppFunction<Element>,
  createSingletonApp: CreateAppFunction<Element>,
): CompatVue {
  singletonApp = createSingletonApp({})

  const Vue: CompatVue = (singletonCtor = function Vue(
    options: ComponentOptions = {},
  ) {
    return createCompatApp(options, Vue)
  } as any)

  /** 将 `new Vue(options)` 转成创建 App + 未挂载根实例，并支持旧 `el` 自动挂载。 */
  function createCompatApp(options: ComponentOptions = {}, Ctor: any) {
    assertCompatEnabled(DeprecationTypes.GLOBAL_MOUNT, null)

    const { data } = options
    if (
      data &&
      !isFunction(data) &&
      softAssertCompatEnabled(DeprecationTypes.OPTIONS_DATA_FN, null)
    ) {
      options.data = () => data
    }

    const app = createApp(options)

    if (Ctor !== Vue) {
      applySingletonPrototype(app, Ctor)
    }

    const vm = app._createRoot!(options)
    if (options.el) {
      return (vm as any).$mount(options.el)
    } else {
      return vm
    }
  }

  Vue.version = `2.6.14-compat:${__VERSION__}`
  Vue.config = singletonApp.config

  Vue.use = (plugin: Plugin, ...options: any[]) => {
    if (plugin && isFunction(plugin.install)) {
      plugin.install(Vue as any, ...options)
    } else if (isFunction(plugin)) {
      plugin(Vue as any, ...options)
    }
    return Vue
  }

  Vue.mixin = m => {
    singletonApp.mixin(m)
    return Vue
  }

  Vue.component = ((name: string, comp: Component) => {
    if (comp) {
      singletonApp.component(name, comp)
      return Vue
    } else {
      return singletonApp.component(name)
    }
  }) as any

  Vue.directive = ((name: string, dir: Directive | LegacyDirective) => {
    if (dir) {
      singletonApp.directive(name, dir as Directive)
      return Vue
    } else {
      return singletonApp.directive(name)
    }
  }) as any

  Vue.options = { _base: Vue }

  /** Vue.extend 子构造器递增编号。 */
  let cid = 1
  Vue.cid = cid

  Vue.nextTick = nextTick

  /** 同一 extendOptions 对象应返回相同子构造器，复现 Vue 2 identity 语义。 */
  const extendCache = new WeakMap()

  /**
   * 模拟 `Vue.extend()`：继承静态 API/原型，合并父子选项，并缓存构造器。
   */
  function extendCtor(this: any, extendOptions: ComponentOptions = {}) {
    assertCompatEnabled(DeprecationTypes.GLOBAL_EXTEND, null)
    if (isFunction(extendOptions)) {
      extendOptions = extendOptions.options
    }

    if (extendCache.has(extendOptions)) {
      return extendCache.get(extendOptions)
    }

    const Super = this
    function SubVue(inlineOptions?: ComponentOptions) {
      if (!inlineOptions) {
        return createCompatApp(SubVue.options, SubVue)
      } else {
        return createCompatApp(
          mergeOptions(
            extend({}, SubVue.options),
            inlineOptions,
            internalOptionMergeStrats as any,
          ),
          SubVue,
        )
      }
    }
    SubVue.super = Super
    SubVue.prototype = Object.create(Vue.prototype)
    SubVue.prototype.constructor = SubVue

    // 克隆父 options 中数组/对象。某些旧插件会直接修改 SubVue.options，若共享引用会
    // 反向污染 Super.options 或其他子构造器。
    const mergeBase: any = {}
    for (const key in Super.options) {
      const superValue = Super.options[key]
      mergeBase[key] = isArray(superValue)
        ? superValue.slice()
        : isObject(superValue)
          ? extend(Object.create(null), superValue)
          : superValue
    }

    SubVue.options = mergeOptions(
      mergeBase,
      extendOptions,
      internalOptionMergeStrats as any,
    )

    SubVue.options._base = SubVue
    SubVue.extend = extendCtor.bind(SubVue)
    SubVue.mixin = Super.mixin
    SubVue.use = Super.use
    SubVue.cid = ++cid

    extendCache.set(extendOptions, SubVue)
    return SubVue
  }

  Vue.extend = extendCtor.bind(Vue) as any

  Vue.set = (target, key, value) => {
    assertCompatEnabled(DeprecationTypes.GLOBAL_SET, null)
    target[key] = value
  }

  Vue.delete = (target, key) => {
    assertCompatEnabled(DeprecationTypes.GLOBAL_DELETE, null)
    delete target[key]
  }

  Vue.observable = (target: any) => {
    assertCompatEnabled(DeprecationTypes.GLOBAL_OBSERVABLE, null)
    return reactive(target)
  }

  Vue.filter = ((name: string, filter?: any) => {
    if (filter) {
      singletonApp.filter!(name, filter)
      return Vue
    } else {
      return singletonApp.filter!(name)
    }
  }) as any

  // Vue.util 在 Vue 2 也属内部 API，但部分插件使用；只提供迁移所需的最小集合。
  const util = {
    warn: __DEV__ ? warn : NOOP,
    extend,
    mergeOptions: (parent: any, child: any, vm?: ComponentPublicInstance) =>
      mergeOptions(
        parent,
        child,
        vm ? undefined : (internalOptionMergeStrats as any),
      ),
    defineReactive,
  }
  Object.defineProperty(Vue, 'util', {
    get() {
      assertCompatEnabled(DeprecationTypes.GLOBAL_PRIVATE_UTIL, null)
      return util
    },
  })

  Vue.configureCompat = configureCompat

  return Vue
}

/**
 * 为每个 Vue 3 App 安装兼容能力：过滤器、旧合并策略、`$mount/$destroy`、全局 API，
 * 并把 singletonApp 上累积的全局注册/config/prototype 修改复制到新 App。
 */
export function installAppCompatProperties(
  app: App,
  context: AppContext,
  render: RootRenderFunction<any>,
): void {
  installFilterMethod(app, context)
  installLegacyOptionMergeStrats(app.config)

  if (!singletonApp) {
    // 当前正是创建 singletonApp 自身；它只作为状态仓库，不需要挂载/复制自己。
    return
  }

  installCompatMount(app, context, render)
  installLegacyAPIs(app)
  applySingletonAppMutations(app)
  if (__DEV__) installLegacyConfigWarnings(app.config)
}

/** 在 AppContext 上创建 Vue 2 filters 注册表，并安装查询/注册方法。 */
function installFilterMethod(app: App, context: AppContext) {
  context.filters = {}
  app.filter = (name: string, filter?: Function): any => {
    assertCompatEnabled(DeprecationTypes.FILTERS, null)
    if (!filter) {
      return context.filters![name]
    }
    if (__DEV__ && context.filters![name]) {
      warn(`Filter "${name}" has already been registered.`)
    }
    context.filters![name] = filter
    return app
  }
}

/** 把 Vue 2 全局静态 API 暴露到 App，使旧插件的 `install(Vue)` 仍能工作。 */
function installLegacyAPIs(app: App) {
  // 旧插件收到的是 app，但往往会访问 Vue.prototype/extend/set 等全局 API。
  Object.defineProperties(app, {
    // prototype 映射到 app.config.globalProperties。
    prototype: {
      get() {
        __DEV__ && warnDeprecation(DeprecationTypes.GLOBAL_PROTOTYPE, null)
        return app.config.globalProperties
      },
    },
    nextTick: { value: nextTick },
    extend: { value: singletonCtor.extend },
    set: { value: singletonCtor.set },
    delete: { value: singletonCtor.delete },
    observable: { value: singletonCtor.observable },
    util: {
      get() {
        return singletonCtor.util
      },
    },
  })
}

/**
 * 把兼容全局 Vue 单例的 mixin、资源注册表与 config 修改应用到一个新 App。
 * 资源表以单例表为原型，使创建后仍能继承全局项而本地覆盖不反向污染单例。
 */
function applySingletonAppMutations(app: App) {
  // 复制全局 mixins；组件/指令/过滤器注册表使用原型继承。
  app._context.mixins = [...singletonApp._context.mixins]
  ;['components', 'directives', 'filters'].forEach(key => {
    // @ts-expect-error
    app._context[key] = Object.create(singletonApp._context[key])
  })

  // 复制全局 config，跳过平台只读字段及 runtime-only 不可用的编译选项。
  isCopyingConfig = true
  for (const key in singletonApp.config) {
    if (key === 'isNativeTag') continue
    if (
      isRuntimeOnly() &&
      (key === 'isCustomElement' || key === 'compilerOptions')
    ) {
      continue
    }
    const val = singletonApp.config[key as keyof AppConfig]
    // @ts-expect-error
    app.config[key] = isObject(val) ? Object.create(val) : val

    // 完整构建中把旧 ignoredElements 数组转换为编译器 isCustomElement 判定函数。
    if (
      key === 'ignoredElements' &&
      isCompatEnabled(DeprecationTypes.CONFIG_IGNORED_ELEMENTS, null) &&
      !isRuntimeOnly() &&
      isArray(val)
    ) {
      app.config.compilerOptions.isCustomElement = tag => {
        return val.some(v => (isString(v) ? v === tag : v.test(tag)))
      }
    }
  }
  isCopyingConfig = false
  applySingletonPrototype(app, singletonCtor)
}

/** 将 `Vue.prototype`/子构造器 prototype 扩展复制为 App 全局公共属性。 */
function applySingletonPrototype(app: App, Ctor: Function) {
  // 以构造器原型作为 globalProperties 原型，并保留 getter/setter 属性描述符。
  const enabled = isCompatEnabled(DeprecationTypes.GLOBAL_PROTOTYPE, null)
  if (enabled) {
    app.config.globalProperties = Object.create(Ctor.prototype)
  }
  let hasPrototypeAugmentations = false
  for (const key of Object.getOwnPropertyNames(Ctor.prototype)) {
    if (key !== 'constructor') {
      hasPrototypeAugmentations = true
      if (enabled) {
        Object.defineProperty(
          app.config.globalProperties,
          key,
          Object.getOwnPropertyDescriptor(Ctor.prototype, key)!,
        )
      }
    }
  }
  if (__DEV__ && hasPrototypeAugmentations) {
    warnDeprecation(DeprecationTypes.GLOBAL_PROTOTYPE, null)
  }
}

function installCompatMount(
  app: App,
  context: AppContext,
  render: RootRenderFunction,
) {
  /** 旧根实例是否已经通过 `$mount` 提交到 DOM。 */
  let isMounted = false

  /**
   * Vue 2 允许 `new Vue()` 先创建实例、稍后 `$mount()`；Vue 3 的 `app.mount()` 会把
   * 创建与挂载合并。该内部入口手动执行 createComponentInstance/setupComponent，
   * 先返回未挂载公共实例，再把真正提交动作保存到实例 ctx。
   */
  app._createRoot = options => {
    const component = app._component
    const vnode = createVNode(component, options.propsData || null)
    vnode.appContext = context

    const hasNoRender =
      !isFunction(component) && !component.render && !component.template
    const emptyRender = () => {}

    // 先创建并 setup 根实例，但尚不调用 renderer 挂载宿主节点。
    const instance = createComponentInstance(vnode, null, null)
    // 若要从挂载容器读取 in-DOM template，此时尚不能判定 render 缺失；临时空函数
    // 用来压制 setup 阶段警告，等 `$mount` 找到容器后再编译真实模板。
    if (hasNoRender) {
      instance.render = emptyRender
    }
    setupComponent(instance)
    vnode.component = instance
    vnode.isCompatRoot = true

    // `$mount/$destroy` 实现放在 ctx，由 compat/instance.ts 的公共属性 getter 读取。
    // 兼容构建只面向 Web，这里因此直接使用 DOM API，并合并 runtime-core 与
    // runtime-dom 两层 app.mount 原本分开的逻辑。
    instance.ctx._compat_mount = (selectorOrEl?: string | Element) => {
      if (isMounted) {
        __DEV__ && warn(`Root instance is already mounted.`)
        return
      }

      let container: Element
      if (typeof selectorOrEl === 'string') {
        // eslint-disable-next-line
        const result = document.querySelector(selectorOrEl)
        if (!result) {
          __DEV__ &&
            warn(
              `Failed to mount root instance: selector "${selectorOrEl}" returned null.`,
            )
          return
        }
        container = result
      } else {
        // eslint-disable-next-line
        container = selectorOrEl || document.createElement('div')
      }

      let namespace: ElementNamespace
      if (container instanceof SVGElement) namespace = 'svg'
      else if (
        typeof MathMLElement === 'function' &&
        container instanceof MathMLElement
      )
        namespace = 'mathml'

      // HMR 重载克隆根 VNode，并清空 component 引用，防止 compat 路径复用旧实例。
      if (__DEV__) {
        context.reload = () => {
          const cloned = cloneVNode(vnode)
          // compat renderer 若保留 component，会继续使用旧根实例而无法重载脚本。
          cloned.component = null
          render(cloned, container, namespace)
        }
      }

      // 根组件没提供 render/template，且 setup/mixin 也没替换临时 render 时，按 Vue 2
      // 规则使用挂载容器 innerHTML 作为模板。
      if (hasNoRender && instance.render === emptyRender) {
        // Vue 3 不再把挂载容器视为模板一部分；容器本身的 v-/@/: 指令不会被编译。
        if (__DEV__) {
          for (let i = 0; i < container.attributes.length; i++) {
            const attr = container.attributes[i]
            if (attr.name !== 'v-cloak' && /^(?:v-|:|@)/.test(attr.name)) {
              warnDeprecation(DeprecationTypes.GLOBAL_MOUNT_CONTAINER, null)
              break
            }
          }
        }
        instance.render = null
        ;(component as ComponentOptions).template = container.innerHTML
        finishComponentSetup(instance, false, true /* skip options */)
      }

      // 编译模板内容已保存，清空容器后让 renderer 创建新的根 DOM。
      container.textContent = ''

      // TODO：兼容 `$mount` 尚未桥接 hydration。
      render(vnode, container, namespace)

      if (container instanceof Element) {
        container.removeAttribute('v-cloak')
        container.setAttribute('data-v-app', '')
      }

      isMounted = true
      app._container = container
      // 标记容器所属 App，供重复挂载检查、devtools 与遥测使用。
      ;(container as any).__vue_app__ = app
      if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
        devtoolsInitApp(app, version)
      }

      return instance.proxy!
    }

    instance.ctx._compat_destroy = () => {
      if (isMounted) {
        // 已挂载根通过 renderer(null) 走完整卸载流程。
        render(null, app._container)
        if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
          devtoolsUnmountApp(app)
        }
        delete app._container.__vue_app__
      } else {
        // 未挂载实例无法交给 renderer 卸载，手动复现 Vue 2 destroy 的钩子与 scope 清理。
        const { bum, scope, um } = instance
        // beforeDestroy 已在选项解析时映射到 beforeUnmount 数组。
        if (bum) {
          invokeArrayFns(bum)
        }
        if (isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)) {
          instance.emit('hook:beforeDestroy')
        }
        // 停止 setup/computed/watch 等实例 effect。
        if (scope) {
          scope.stop()
        }
        // destroyed 已映射到 unmounted。
        if (um) {
          invokeArrayFns(um)
        }
        if (isCompatEnabled(DeprecationTypes.INSTANCE_EVENT_HOOKS, instance)) {
          instance.emit('hook:destroyed')
        }
      }
    }

    return instance.proxy!
  }
}

/** Vue 2 数组响应式需要拦截的七个变更方法。 */
const methodsToPatch = [
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
]

/** 已为内部对象打过兼容补丁的集合，避免重复覆盖属性/数组方法。 */
const patched = new WeakSet<object>()

/**
 * Vue 2 `Vue.util.defineReactive` 的迁移实现。
 * 对原对象安装 getter/setter 并使用 Vue 3 track/trigger；嵌套对象还会 reactive 化。
 * 为兼容“调用后仍直接修改原对象”的旧代码，数组变更方法代理到 reactive 数组，
 * 普通对象则递归把现有键定义成响应式访问器。
 */
function defineReactive(obj: any, key: string, val: any) {
  // 旧代码常在 defineReactive 之后继续持有并修改原始 val，而不是返回的 proxy；
  // 因此需要给原数组/对象也打桥接补丁，使这些修改仍能触发 Vue 3 响应式系统。
  if (isObject(val) && !isReactive(val) && !patched.has(val)) {
    const reactiveVal = reactive(val)
    if (isArray(val)) {
      methodsToPatch.forEach((m: any) => {
        val[m] = (...args: any[]) => {
          Array.prototype[m].apply(reactiveVal, args)
        }
      })
    } else {
      Object.keys(val).forEach(key => {
        try {
          defineReactiveSimple(val, key, val[key])
        } catch (e: any) {
          if (__DEV__) {
            warn(`Failed making property "${key}" reactive:`, e)
          }
        }
      })
    }
  }

  const i = obj.$
  if (i && obj === i.proxy) {
    // 目标是组件公共实例时，属性实际定义在 ctx，并清空访问来源缓存使代理重新解析键。
    defineReactiveSimple(i.ctx, key, val)
    i.accessCache = Object.create(null)
  } else if (isReactive(obj)) {
    obj[key] = val
  } else {
    defineReactiveSimple(obj, key, val)
  }
}

/** 在普通对象单个属性上安装连接 Vue 3 track/trigger 的兼容访问器。 */
function defineReactiveSimple(obj: any, key: string, val: any) {
  val = isObject(val) ? reactive(val) : val
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get() {
      track(obj, TrackOpTypes.GET, key)
      return val
    },
    set(newVal) {
      val = isObject(newVal) ? reactive(newVal) : newVal
      trigger(obj, TriggerOpTypes.SET, key, newVal)
    },
  })
}
