import {
  type Component,
  type ComponentInternalInstance,
  type ConcreteComponent,
  type Data,
  getComponentPublicInstance,
  validateComponentName,
} from './component'
import type {
  ComponentOptions,
  MergedComponentOptions,
  RuntimeCompilerOptions,
} from './componentOptions'
import type {
  ComponentCustomProperties,
  ComponentPublicInstance,
} from './componentPublicInstance'
import { type Directive, validateDirectiveName } from './directives'
import type { ElementNamespace, RootRenderFunction } from './renderer'
import type { InjectionKey } from './apiInject'
import { warn } from './warning'
import { type VNode, cloneVNode, createVNode } from './vnode'
import type { RootHydrateFunction } from './hydration'
import { devtoolsInitApp, devtoolsUnmountApp } from './devtools'
import { NO, extend, hasOwn, isFunction, isObject } from '@vue/shared'
import { version } from '.'
import { installAppCompatProperties } from './compat/global'
import type { NormalizedPropsOptions } from './componentProps'
import type { ObjectEmitsOptions } from './componentEmits'
import { ErrorCodes, callWithAsyncErrorHandling } from './errorHandling'
import type { DefineComponent } from './apiDefineComponent'

/**
 * 一个由 `createApp()` 创建、拥有独立配置和资源注册表的应用实例。
 * 同一根组件可以创建多个 App；插件、全局组件、provide 与合并缓存均不会跨 App 污染。
 */
export interface App<HostElement = any> {
  /** 当前 Vue 运行时版本。 */
  version: string
  /** 本应用独享的运行时配置；对象本身不可替换，但字段可以修改。 */
  config: AppConfig

  /** 安装函数式插件或带 `install()` 的对象插件；同一插件对象只执行一次。 */
  use<Options extends unknown[]>(
    plugin: Plugin<Options>,
    ...options: NoInfer<Options>
  ): this
  /**
   * 安装使用单个配置值的插件；配置类型由插件泛型约束，返回当前 App 以支持链式调用。
   */
  use<Options>(plugin: Plugin<Options>, options: NoInfer<Options>): this

  /** 注册只作用于本应用的全局 mixin。 */
  mixin(mixin: ComponentOptions): this
  /** 查询全局组件。 */
  component(name: string): Component | undefined
  /** 注册全局组件。 */
  component<T extends Component | DefineComponent>(
    name: string,
    component: T,
  ): this
  /** 查询全局指令。 */
  directive<
    HostElement = any,
    Value = any,
    Modifiers extends string = string,
    Arg = any,
  >(
    name: string,
  ): Directive<HostElement, Value, Modifiers, Arg> | undefined
  /** 注册全局指令。 */
  directive<
    HostElement = any,
    Value = any,
    Modifiers extends string = string,
    Arg = any,
  >(
    name: string,
    directive: Directive<HostElement, Value, Modifiers, Arg>,
  ): this
  /** 创建根 VNode 并挂载/水合到宿主容器；同一 App 只能挂载一次。 */
  mount(
    rootContainer: HostElement | string,
    /** @internal 是否走 hydration。 */
    isHydrate?: boolean,
    /** @internal 根容器的元素命名空间。 */
    namespace?: boolean | ElementNamespace,
    /** @internal 预先创建的根 VNode。 */
    vnode?: VNode,
  ): ComponentPublicInstance
  /** 卸载根组件，并执行插件登记的清理函数。 */
  unmount(): void
  /** 登记 App 卸载时的清理函数，常用于插件释放全局资源。 */
  onUnmount(cb: () => void): void
  /** 向整个应用的依赖注入根作用域提供值。 */
  provide<T, K = InjectionKey<T> | string | number>(
    key: K,
    value: K extends InjectionKey<infer V> ? V : T,
  ): this

  /**
   * 临时把当前 App 设为活动注入上下文并执行函数。
   * 这样在组件 setup 之外调用 `inject()`，也能读取 `app.provide()` 提供的值。
   *
   * @param fn 要在当前 App 上下文中执行的同步函数。
   */
  runWithContext<T>(fn: () => T): T

  // 以下字段属于内部协议，但服务端渲染器和开发工具需要读取，因而保留在公共类型上。
  /** @internal 应用唯一编号。 */
  _uid: number
  /** @internal 根组件定义。 */
  _component: ConcreteComponent
  /** @internal 根 props。 */
  _props: Data | null
  /** @internal 当前挂载容器。 */
  _container: HostElement | null
  /** @internal 应用级共享上下文。 */
  _context: AppContext
  /** @internal 根组件内部实例。 */
  _instance: ComponentInternalInstance | null

  /** @internal 自定义元素预先创建的根 VNode。 */
  _ceVNode?: VNode

  /** @internal 仅 Vue 2 兼容构建：查询或注册过滤器。 */
  filter?(name: string): Function | undefined
  /**
   * Vue 2 兼容入口：以名称注册过滤器，返回当前 App；普通 Vue 3 构建没有此方法。
   */
  filter?(name: string, filter: Function): this

  /** @internal Vue 3 兼容层创建根实例的入口。 */
  _createRoot?(options: ComponentOptions): ComponentPublicInstance
}

/** Options API 某个选项的自定义合并策略。 */
export type OptionMergeFunction = (to: unknown, from: unknown) => any

/** 应用级运行时配置；每个 AppContext 持有一份。 */
export interface AppConfig {
  /** @private 判断标签是否为平台原生元素，由 runtime-dom 等平台包覆盖。 */
  readonly isNativeTag: (tag: string) => boolean

  /** 是否记录组件性能指标并上报浏览器 Performance/devtools。 */
  performance: boolean
  /** Options API 自定义字段的合并策略。 */
  optionMergeStrategies: Record<string, OptionMergeFunction>
  /** 暴露到所有组件公共代理上的全局属性，如 `$http`。 */
  globalProperties: ComponentCustomProperties & Record<string, any>
  /** 未被 errorCaptured 截止的组件错误处理器。 */
  errorHandler?: (
    err: unknown,
    instance: ComponentPublicInstance | null,
    info: string,
  ) => void
  /** 开发环境运行时警告处理器。 */
  warnHandler?: (
    msg: string,
    instance: ComponentPublicInstance | null,
    trace: string,
  ) => void

  /**
   * 传给 `@vue/compiler-dom` 的编译选项，仅带运行时编译器的构建支持。
   */
  compilerOptions: RuntimeCompilerOptions

  /**
   * @deprecated 请使用 `config.compilerOptions.isCustomElement`。
   */
  isCustomElement?: (tag: string) => boolean

  /**
   * 开发环境保留的递归 computed 诊断开关。runtime-core 会把它写入
   * `computed._warnRecursive`，本版响应式实现没有消费该字段的警告分支。
   */
  warnRecursiveComputed?: boolean

  /**
   * 生产环境是否重新抛出未处理错误。默认仅记录、避免整个客户端应用崩溃；
   * SSR 等需要让请求失败并交给上层框架处理的场景可开启。
   */
  throwUnhandledErrorInProduction?: boolean

  /** 本应用所有 `useId()` 生成值的前缀，便于多应用页面避免冲突。 */
  idPrefix?: string
}

/**
 * 组件实例共享的应用级上下文。
 * 除资源注册表与 provide 外还保存规范化缓存；全局 mixin/合并策略会影响结果，因此
 * 缓存必须按应用隔离，不能放在组件定义的全局 WeakMap 中。
 */
export interface AppContext {
  /** 反向指向应用实例，供开发工具识别。 */
  app: App
  /**
   * 所有组件共享的本应用配置对象。
   */
  config: AppConfig
  /**
   * 本应用全局 mixin 列表，参与 Options/props/emits 规范化。
   */
  mixins: ComponentOptions[]
  /**
   * 全局组件名到定义的注册表，资源解析在本地查找失败后读取。
   */
  components: Record<string, Component>
  /**
   * 本应用全局指令注册表。
   */
  directives: Record<string, Directive>
  /**
   * 应用注入根，组件 provides 原型链从这里继承。
   */
  provides: Record<string | symbol, any>

  /** @internal 合并/规范化组件选项缓存，受本应用 mixin 和合并策略影响。 */
  optionsCache: WeakMap<ComponentOptions, MergedComponentOptions>
  /** @internal 组件 props 规范化结果缓存。 */
  propsCache: WeakMap<ConcreteComponent, NormalizedPropsOptions>
  /** @internal 组件 emits 规范化结果缓存。 */
  emitsCache: WeakMap<ConcreteComponent, ObjectEmitsOptions | null>
  /** @internal HMR 重新渲染根 VNode 的回调。 */
  reload?: () => void
  /** @internal 仅 Vue 2 兼容构建的过滤器注册表。 */
  filters?: Record<string, Function>
}

/** 根据插件 Options 是参数元组还是单个值，生成对应 install 调用签名。 */
type PluginInstallFunction<Options = any[]> = Options extends unknown[]
  ? (app: App, ...options: Options) => any
  : (app: App, options: Options) => any

/** 以 `{ install(app, ...options) }` 对象形式声明的插件。 */
export type ObjectPlugin<Options = any[]> = {
  /**
   * app.use 调用的插件入口；接收本 App 和插件选项，安装返回值不会被 App API 等待。
   */
  install: PluginInstallFunction<Options>
}
/** 直接以函数安装、也可附带 install 属性的插件。 */
export type FunctionPlugin<Options = any[]> = PluginInstallFunction<Options> &
  Partial<ObjectPlugin<Options>>

/** `app.use()` 接受的插件联合类型，并保留安装参数的类型推导。 */
export type Plugin<
  Options = any[],
  // TODO：下个大版本让 Options 直接约束为 unknown[]，移除兼容单值参数的 P。
  P extends unknown[] = Options extends unknown[] ? Options : [Options],
> = FunctionPlugin<P> | ObjectPlugin<P>

/**
 * 创建全新的应用上下文与空注册表。
 * provides 使用无原型对象，避免 `constructor` 等原型键被误当作已提供依赖；缓存
 * 使用 WeakMap，使组件定义不再被应用引用时可以一并回收。
 */
export function createAppContext(): AppContext {
  return {
    app: null as any,
    config: {
      isNativeTag: NO,
      performance: false,
      globalProperties: {},
      optionMergeStrategies: {},
      errorHandler: undefined,
      warnHandler: undefined,
      compilerOptions: {},
    },
    mixins: [],
    components: {},
    directives: {},
    provides: Object.create(null),
    optionsCache: new WeakMap(),
    propsCache: new WeakMap(),
    emitsCache: new WeakMap(),
  }
}

/** 平台 renderer 对外暴露的 `createApp(rootComponent, rootProps)` 函数签名。 */
export type CreateAppFunction<HostElement> = (
  rootComponent: Component,
  rootProps?: Data | null,
) => App<HostElement>

/** 进程内递增的 App 实例编号，供 devtools、CSS 变量等内部能力标识应用。 */
let uid = 0

/**
 * 基于平台提供的 `render`/`hydrate` 构造 createApp API。
 * runtime-core 管理应用状态、插件与资源；runtime-dom 等平台包只需注入如何把根
 * VNode 提交到宿主容器，便可复用完整应用 API。
 */
export function createAppAPI<HostElement>(
  render: RootRenderFunction<HostElement>,
  hydrate?: RootHydrateFunction,
): CreateAppFunction<HostElement> {
  return /** 为一次 createApp 调用分配独立 context、插件去重集合与清理队列；对象根组件浅克隆，非法根 props 改为 null。返回供平台包装的 App 对象。 */ function createApp(
    rootComponent,
    rootProps = null
  ) {
    // 对象式根组件会被 App 写入/缓存少量内部信息；浅克隆可避免同一组件定义创建
    // 多个 App 时共享可变根定义。函数/类组件本身不能这样克隆。
    if (!isFunction(rootComponent)) {
      rootComponent = extend({}, rootComponent)
    }

    if (rootProps != null && !isObject(rootProps)) {
      __DEV__ && warn(`root props passed to app.mount() must be an object.`)
      rootProps = null
    }

    const context = createAppContext()
    /** 用对象身份去重插件，WeakSet 不延长插件生命周期。 */
    const installedPlugins = new WeakSet()
    /** 插件通过 app.onUnmount 注册的清理函数。 */
    const pluginCleanupFns: Array<() => any> = []

    let isMounted = false

    const app: App = (context.app = {
      _uid: uid++,
      _component: rootComponent as ConcreteComponent,
      _props: rootProps,
      _container: null,
      _context: context,
      _instance: null,

      version,

      /**
       * 返回本 AppContext 的同一配置对象，使插件与组件读取一致的应用配置。
       */
      get config() {
        return context.config
      },

      /**
       * 拒绝替换整个 config 对象，开发环境给出逐字段修改提示；保持所有组件和插件持有的配置引用稳定。
       */
      set config(v) {
        // 替换整个对象会使组件已持有的 context.config 失效；只能逐项修改以保持引用稳定。
        if (__DEV__) {
          warn(
            `app.config cannot be replaced. Modify individual options instead.`,
          )
        }
      },

      /**
       * 按插件对象/函数身份去重并同步执行 install；登记先于执行，因此插件递归安装自身也会被拦截。返回当前 App。
       */
      use(plugin: Plugin, ...options: any[]) {
        // 先登记再调用 install，插件内部递归 app.use(自身) 时也不会无限循环。
        if (installedPlugins.has(plugin)) {
          __DEV__ && warn(`Plugin has already been applied to target app.`)
        } else if (plugin && isFunction(plugin.install)) {
          installedPlugins.add(plugin)
          plugin.install(app, ...options)
        } else if (isFunction(plugin)) {
          installedPlugins.add(plugin)
          plugin(app, ...options)
        } else if (__DEV__) {
          warn(
            `A plugin must either be a function or an object with an "install" ` +
              `function.`,
          )
        }
        return app
      },

      /**
       * 把尚未登记的全局 mixin 加入本应用列表；依赖 Options API 构建开关，重复对象会警告。返回当前 App。
       */
      mixin(mixin: ComponentOptions) {
        if (__FEATURE_OPTIONS_API__) {
          if (!context.mixins.includes(mixin)) {
            context.mixins.push(mixin)
          } else if (__DEV__) {
            warn(
              'Mixin has already been applied to target app' +
                (mixin.name ? `: ${mixin.name}` : ''),
            )
          }
        } else if (__DEV__) {
          warn('Mixins are only available in builds supporting Options API')
        }
        return app
      },

      /**
       * 仅传名称时查询本应用全局组件；传组件时校验名称、覆盖登记并返回 App。同名局部组件的优先级由资源解析器决定。
       */
      component(name: string, component?: Component): any {
        if (__DEV__) {
          validateComponentName(name, context.config)
        }
        if (!component) {
          return context.components[name]
        }
        if (__DEV__ && context.components[name]) {
          warn(`Component "${name}" has already been registered in target app.`)
        }
        context.components[name] = component
        return app
      },

      /**
       * 仅传名称时查询全局指令；传指令时检查内置保留名、覆盖登记并返回 App，注册表按应用隔离。
       */
      directive(name: string, directive?: Directive) {
        if (__DEV__) {
          validateDirectiveName(name)
        }

        if (!directive) {
          return context.directives[name] as any
        }
        if (__DEV__ && context.directives[name]) {
          warn(`Directive "${name}" has already been registered in target app.`)
        }
        context.directives[name] = directive
        return app
      },

      /**
       * 首次挂载创建根 VNode 并写入 appContext，再交给注入的 render/hydrate；成功后记录容器并返回根公开实例。isHydrate 请求水合，但没有 hydrate 时回退 render；namespace 的布尔值兼容旧 svg 参数。isMounted 不在 unmount 后复位，同一 App 不能重挂。
       */
      mount(
        rootContainer: HostElement,
        isHydrate?: boolean,
        namespace?: boolean | ElementNamespace,
      ): any {
        if (!isMounted) {
          // #5571：容器上的 __vue_app__ 表示另一个 App 尚未卸载。直接覆盖会让旧
          // 组件仍持有事件/响应式 effect，却失去可达的 unmount 入口，因此明确警告。
          if (__DEV__ && (rootContainer as any).__vue_app__) {
            warn(
              `There is already an app instance mounted on the host container.\n` +
                ` If you want to mount another app on the same host container,` +
                ` you need to unmount the previous app by calling \`app.unmount()\` first.`,
            )
          }
          const vnode = app._ceVNode || createVNode(rootComponent, rootProps)
          // 根 VNode 携带 AppContext；创建根组件实例时会把它作为全局资源/provide 根。
          vnode.appContext = context

          if (namespace === true) {
            namespace = 'svg'
          } else if (namespace === false) {
            namespace = undefined
          }

          // HMR 根重载必须 clone VNode 并清空 el，强制 renderer 当作新树处理；
          // 若沿用 hydration DOM 引用，热更新可能错误跳过根节点重建。
          if (__DEV__) {
            /**
             * 开发环境 HMR 根重载：克隆根 VNode 并清空 el 后重新 render，避免沿用水合 DOM 引用；仍复用本 AppContext。
             */
            context.reload = () => {
              const cloned = cloneVNode(vnode)
              // 热更新不走 hydration。
              cloned.el = null
              // TS 不会把外层分支的 namespace 缩窄保留到闭包调用点，因此显式断言。
              render(cloned, rootContainer, namespace as ElementNamespace)
            }
          }

          if (isHydrate && hydrate) {
            hydrate(vnode as VNode<Node, Element>, rootContainer as any)
          } else {
            render(vnode, rootContainer, namespace)
          }
          isMounted = true
          app._container = rootContainer
          // 容器反向标记用于重复挂载检测、devtools 和遥测定位所属 App。
          ;(rootContainer as any).__vue_app__ = app

          if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
            app._instance = vnode.component
            devtoolsInitApp(app, version)
          }

          return getComponentPublicInstance(vnode.component!)
        } else if (__DEV__) {
          warn(
            `App has already been mounted.\n` +
              `If you want to remount the same app, move your app creation logic ` +
              `into a factory function and create fresh app instances for each ` +
              `mount - e.g. \`const createMyApp = () => createApp(App)\``,
          )
        }
      },

      /**
       * 追加 App 卸载清理函数；不按函数身份去重，挂载前后都可登记，开发环境只检查传入值是否为函数。
       */
      onUnmount(cleanupFn: () => void) {
        if (__DEV__ && typeof cleanupFn !== 'function') {
          warn(
            `Expected function as first argument to app.onUnmount(), ` +
              `but got ${typeof cleanupFn}`,
          )
        }
        pluginCleanupFns.push(cleanupFn)
      },

      /**
       * 先通过组件错误管道执行登记的 App 清理，再调用 render(null) 卸载根树并删除容器标记。清理 Promise 不会被等待；同步错误若被重抛会中止后续步骤。
       */
      unmount() {
        if (isMounted) {
          // 先调用 App 清理函数，再卸载组件树。同步错误若经错误管道重新抛出，会中止
          // 后续清理与卸载；返回 Promise 的清理函数不会被等待，其 rejection 另行报告。
          callWithAsyncErrorHandling(
            pluginCleanupFns,
            app._instance,
            ErrorCodes.APP_UNMOUNT_CLEANUP,
          )
          render(null, app._container)
          if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
            app._instance = null
            devtoolsUnmountApp(app)
          }
          delete app._container.__vue_app__
        } else if (__DEV__) {
          warn(`Cannot unmount an app that is not mounted.`)
        }
      },

      /**
       * 把字符串或 Symbol 键写入本应用 provides 并返回 App；组件 inject 从应用根读取它，同名写入覆盖旧值，开发环境分别提示自身重复与继承值遮蔽。
       */
      provide(key, value) {
        if (__DEV__ && (key as string | symbol) in context.provides) {
          if (hasOwn(context.provides, key as string | symbol)) {
            warn(
              `App already provides property with key "${String(key)}". ` +
                `It will be overwritten with the new value.`,
            )
          } else {
            // #13212：自定义元素的 AppContext.provides 可能以父元素 provides 为原型。
            // 即使 key 非自有属性，覆盖继承值也值得提示，否则用户难以发现注入被遮蔽。
            warn(
              `App already provides property with key "${String(key)}" inherited from its parent element. ` +
                `It will be overwritten with the new value.`,
            )
          }
        }

        context.provides[key as string | symbol] = value

        return app
      },

      /**
       * 在同步调用 fn 期间设置 currentApp，让 inject 优先读取此 App 的 provides；返回 fn 的原结果，并在 finally 中恢复嵌套调用前的 App。异步延续不继承上下文。
       */
      runWithContext(fn) {
        // 用 try/finally 恢复嵌套调用前的 App；即使用户函数抛错，也不能污染后续 inject。
        const lastApp = currentApp
        currentApp = app
        try {
          return fn()
        } finally {
          currentApp = lastApp
        }
      },
    })

    if (__COMPAT__) {
      installAppCompatProperties(app, context, render)
    }

    return app
  }
}

/**
 * @internal `app.runWithContext()` 执行期间的活动应用，供组件外 `inject()` 查找
 * 应用级 provides。它只覆盖同步调用栈，异步延续不会自动继承。
 */
export let currentApp: App<unknown> | null = null
