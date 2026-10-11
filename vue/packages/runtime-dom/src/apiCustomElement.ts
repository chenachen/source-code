import {
  type App,
  type Component,
  type ComponentCustomElementInterface,
  type ComponentInjectOptions,
  type ComponentInternalInstance,
  type ComponentObjectPropsOptions,
  type ComponentOptions,
  type ComponentOptionsBase,
  type ComponentOptionsMixin,
  type ComponentProvideOptions,
  type ComponentPublicInstance,
  type ComputedOptions,
  type ConcreteComponent,
  type CreateAppFunction,
  type CreateComponentPublicInstanceWithMixins,
  type DefineComponent,
  type Directive,
  type EmitsOptions,
  type EmitsToProps,
  type ExtractPropTypes,
  type MethodOptions,
  type RenderFunction,
  type SetupContext,
  type SlotsType,
  type VNode,
  type VNodeProps,
  createVNode,
  defineComponent,
  getCurrentInstance,
  nextTick,
  unref,
  warn,
} from '@vue/runtime-core'
import {
  camelize,
  extend,
  hasOwn,
  hyphenate,
  isArray,
  isPlainObject,
  toNumber,
} from '@vue/shared'
import { createApp, createSSRApp, render } from '.'

/** attribute 移除的哨兵值，用于区分“属性不存在”和值为 null/undefined 的 prop。 */
const REMOVAL = {}

/** `defineCustomElement()` 返回的原生自定义元素构造器类型。 */
export type VueElementConstructor<P = {}> = {
  /** 接收连接前初始 props，创建可注册 HTMLElement 子类实例，并以 P 暴露声明 prop 类型。 */
  new (initialProps?: Record<string, any>): VueElement & P
}

/** Vue 自定义元素的 DOM/应用级额外配置。 */
export interface CustomElementOptions {
  /** SFC 编译器内联的组件 CSS 文本数组。 */
  styles?: string[]
  /** 是否创建 ShadowRoot，默认 true。 */
  shadowRoot?: boolean
  /** 除 mode 外传给 attachShadow 的选项；Vue 固定使用 open 供 runtime 访问。 */
  shadowRootOptions?: Omit<ShadowRootInit, 'mode'>
  /** 注入 style 标签的 CSP nonce。 */
  nonce?: string
  /** mount 前配置每个自定义元素独立创建的 Vue App。 */
  configureApp?: (app: App) => void
}

// defineCustomElement 提供与 defineComponent 相同的 props/emits/mixin/this 推导；以下重载
// 应与 defineComponent 保持同步，差异仅在返回 VueElementConstructor 和额外 DOM 选项。

// 重载 1：直接 setup 函数，props 可用数组或对象声明。
/** setup 函数重载：用 prop 名数组声明输入，并把 Props 推导为元素 property 类型。 */
export function defineCustomElement<Props, RawBindings = object>(
  setup: (props: Props, ctx: SetupContext) => RawBindings | RenderFunction,
  options?: Pick<ComponentOptions, 'name' | 'inheritAttrs' | 'emits'> &
    CustomElementOptions & {
      /** 重载中的运行时 prop 声明；数组列名，对象提供类型校验/默认值，返回元素 property 类型据此推导。 */
      props?: (keyof Props)[]
    },
): VueElementConstructor<Props>
/** setup 函数重载：接受对象 prop 声明，在返回元素构造器中保留 Props 类型。 */
export function defineCustomElement<Props, RawBindings = object>(
  setup: (props: Props, ctx: SetupContext) => RawBindings | RenderFunction,
  options?: Pick<ComponentOptions, 'name' | 'inheritAttrs' | 'emits'> &
    CustomElementOptions & {
      /** 重载中的运行时 prop 声明；数组列名，对象提供类型校验/默认值，返回元素 property 类型据此推导。 */
      props?: ComponentObjectPropsOptions<Props>
    },
): VueElementConstructor<Props>

// 重载 2：完整 options 对象，从运行时声明和 emits 推导元素 property 类型。
/** 完整 Options API 重载：从 props/emits/mixins/slots 推导元素 property 与组件 this，并接收 DOM 自定义元素配置。 */
export function defineCustomElement<
  // props 推导。
  RuntimePropsOptions extends ComponentObjectPropsOptions =
    ComponentObjectPropsOptions,
  PropsKeys extends string = string,
  // emits 推导。
  RuntimeEmitsOptions extends EmitsOptions = {},
  EmitsKeys extends string = string,
  // 其他 Options API 推导。
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
  // 最终公开 props + onEvent listener 类型。
  InferredProps = string extends PropsKeys
    ? ComponentObjectPropsOptions extends RuntimePropsOptions
      ? {}
      : ExtractPropTypes<RuntimePropsOptions>
    : { [key in PropsKeys]?: any },
  ResolvedProps = InferredProps & EmitsToProps<RuntimeEmitsOptions>,
>(
  options: CustomElementOptions & {
    /** 重载中的运行时 prop 声明；数组列名，对象提供类型校验/默认值，返回元素 property 类型据此推导。 */
    props?: (RuntimePropsOptions & ThisType<void>) | PropsKeys[]
  } & ComponentOptionsBase<
      ResolvedProps,
      SetupBindings,
      Data,
      Computed,
      Methods,
      Mixin,
      Extends,
      RuntimeEmitsOptions,
      EmitsKeys,
      {}, // 自定义元素构造器不在此重载额外推导 Defaults。
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
        Readonly<ResolvedProps>,
        SetupBindings,
        Data,
        Computed,
        Methods,
        Mixin,
        Extends,
        RuntimeEmitsOptions,
        EmitsKeys,
        {},
        false,
        InjectOptions,
        Slots,
        LocalComponents,
        Directives,
        Exposed
      >
    >,
  extraOptions?: CustomElementOptions,
): VueElementConstructor<ResolvedProps>

// 重载 3：接受 defineComponent 返回的虚拟构造器并提取其 props。
/** 已有 defineComponent 虚拟构造器重载：提取其声明 props，返回相应 VueElement 构造器。 */
export function defineCustomElement<
  // 理论上应为 ComponentPublicInstanceConstructor；这里用等价结构避免额外导出依赖。
  T extends {
    /** 读取 defineComponent 返回值的公共实例结构以提取 props；此重载不执行构造。 */
    new (...args: any[]): ComponentPublicInstance<any>
  },
>(
  options: T,
  extraOptions?: CustomElementOptions,
): VueElementConstructor<
  T extends DefineComponent<infer P, any, any, any> ? P : unknown
>

/*@__NO_SIDE_EFFECTS__*/
/**
 * 把组件定义封装成 Custom Elements API 可注册的 HTMLElement 子类。
 * 每个构造器静态保存标准化组件 def；每个元素实例持有独立 Vue App/props/ShadowRoot。
 */
export function defineCustomElement(
  options: any,
  extraOptions?: ComponentOptions,
  /** @internal 注入 createSSRApp，使声明式 Shadow DOM 可走 hydration。 */
  _createApp?: CreateAppFunction<Element>,
): VueElementConstructor {
  let Comp = defineComponent(options, extraOptions) as any
  if (isPlainObject(Comp)) Comp = extend({}, Comp, extraOptions)
  /** 为本组件生成的可注册元素子类；静态 def 共享组件定义，元素实例状态由 VueElement 管理。 */
  class VueCustomElement extends VueElement {
    /** 本次 defineCustomElement 标准化后的组件定义，供静态读取与实例构造共用。 */
    static def = Comp
    /** 把初始 props 和可选 SSR 应用工厂传给 VueElement，绑定本构造器的共享组件定义。 */
    constructor(initialProps?: Record<string, any>) {
      super(Comp, initialProps, _createApp)
    }
  }

  return VueCustomElement
}

/*@__NO_SIDE_EFFECTS__*/
/** 创建默认水合预渲染声明式 Shadow DOM 的自定义元素构造器。 */
export const defineSSRCustomElement = ((
  options: any,
  extraOptions?: ComponentOptions,
) => {
  // 私有第三参数不在公开重载中。
  // @ts-expect-error
  return defineCustomElement(options, extraOptions, createSSRApp)
}) as typeof defineCustomElement

/** SSR 导入时没有 HTMLElement，使用空基类避免模块求值报错。 */
const BaseClass = (
  typeof HTMLElement !== 'undefined' ? HTMLElement : class {}
) as typeof HTMLElement

/** 解析异步包装后真正挂载的组件定义及自定义元素配置。 */
type InnerComponentDef = ConcreteComponent & CustomElementOptions

/**
 * Vue 组件与浏览器 Custom Elements 生命周期之间的桥梁。
 *
 * 它负责连接/断开时 mount/unmount、attribute↔prop 反射、异步定义、Shadow DOM 样式、
 * light DOM slots、provide/inject 父链、emit→CustomEvent，以及 HMR 样式替换。
 */
export class VueElement
  extends BaseClass
  implements ComponentCustomElementInterface
{
  /** core patchProp 识别 Vue 自定义元素的标记。 */
  _isVueCE = true
  /** 当前挂载的组件内部实例。 @internal */
  _instance: ComponentInternalInstance | null = null
  /** 每个元素独立创建的 Vue App。 @internal */
  _app: App | null = null
  /** 组件实际 mount 容器：ShadowRoot 或元素自身。 @internal */
  _root: Element | ShadowRoot
  /** style 标签使用的 CSP nonce。 @internal */
  _nonce: string | undefined = this._def.nonce

  /** light DOM 模式下嵌套 Teleport 也可能包含 slot outlet。 @internal */
  _teleportTargets?: Set<Element>

  /** 元素本轮是否连接；nextTick 延迟卸载用来区分移动与真正移除。 */
  private _connected = false
  /** 同步/异步组件定义是否已解析并完成 prop/style 准备。 */
  private _resolved = false
  /** core 正批量 patch 元素 property，期间延迟组件重渲染。 */
  private _patching = false
  /** 本批 patch 是否真的改变了元素 props。 */
  private _dirty = false
  /** 需把 attribute 字符串转 Number 的声明 prop 集合。 */
  private _numberProps: Record<string, true> | null = null
  /** 已注入 style 的子组件集合，防止 HOC/重复渲染插入重复 CSS。 */
  private _styleChildren = new WeakSet()
  /** 异步定义或等待父元素定义的进行中 Promise。 */
  private _pendingResolve: Promise<void> | undefined
  /** 最近的 VueElement 祖先，用于内部实例 parent 与 provide/inject。 */
  private _parent: VueElement | undefined
  /** 组件定义到首个 style 节点的锚点，维持父子样式插入顺序。 */
  private _styleAnchors: WeakMap<ConcreteComponent, HTMLStyleElement> =
    new WeakMap()
  /** 开发/HMR：当前元素自身 style 节点列表。 */
  private _styles?: HTMLStyleElement[]
  /** 开发/HMR：子组件 hmrId 到 style 节点列表。 */
  private _childStyles?: Map<string, HTMLStyleElement[]>
  /** 监听外部 attribute 变化并同步 props。 */
  private _ob?: MutationObserver | null = null
  /** light DOM 模式连接时取出的原始 slot 内容。 */
  private _slots?: Record<string, Node[]>

  /** 建立元素 mount 容器；SSR 工厂复用已有声明式 ShadowRoot，其余按配置创建 open ShadowRoot 或使用 light DOM；尚不 mount 组件。 */
  constructor(
    /** 组件定义可能是 AsyncWrapper；解析后 `_def` 会替换成内部真实组件。 */
    private _def: InnerComponentDef,
    private _props: Record<string, any> = {},
    private _createApp: CreateAppFunction<Element> = createApp,
  ) {
    super()
    if (this.shadowRoot && _createApp !== createApp) {
      this._root = this.shadowRoot
    } else {
      if (__DEV__ && this.shadowRoot) {
        warn(
          `Custom element has pre-rendered declarative shadow root but is not ` +
            `defined as hydratable. Use \`defineSSRCustomElement\`.`,
        )
      }
      if (_def.shadowRoot !== false) {
        this.attachShadow(
          extend({}, _def.shadowRootOptions, {
            mode: 'open',
          }) as ShadowRootInit,
        )
        this._root = this.shadowRoot!
      } else {
        this._root = this
      }
    }
  }

  /**
   * 浏览器把元素接入文档时建立 Vue 父链，并解析/挂载组件。
   * 子异步元素会等待父定义先 resolve，确保 provide/inject 上下文已存在。
   */
  connectedCallback(): void {
    // 构造后又立即移除的元素无需加载异步组件。
    if (!this.isConnected) return

    // light DOM slots 只在首次解析前摘取一次，重连复用同一节点集合。
    if (!this.shadowRoot && !this._resolved) {
      this._parseSlots()
    }
    this._connected = true

    // 向组合树查找最近 VueElement 祖先，建立 provide/inject 与 $parent 关系。
    let parent: Node | null = this
    while (
      (parent =
        parent &&
        // #12479：元素被分配进原生 slot 时，DOM parentNode 仍在声明位置；assignedSlot
        // 才代表组合树上的实际父路径，必须优先检查。
        ((parent as Element).assignedSlot ||
          parent.parentNode ||
          (parent as ShadowRoot).host))
    ) {
      if (parent instanceof VueElement) {
        this._parent = parent
        break
      }
    }

    if (!this._instance) {
      if (this._resolved) {
        this._mount(this._def)
      } else {
        if (parent && parent._pendingResolve) {
          this._pendingResolve = parent._pendingResolve.then(() => {
            this._pendingResolve = undefined
            if (this.isConnected) {
              return this._resolveDef()
            }
          })
        } else {
          this._resolveDef()
        }
      }
    }
  }

  /** 把内部组件 parent 指向父自定义元素实例，并继承应用 provides。 */
  private _setParent(parent = this._parent) {
    if (parent) {
      this._instance!.parent = parent._instance
      this._inheritParentContext(parent)
    }
  }

  /** 让当前独立 App 的 provides 原型继承父元素实例 provides。 */
  private _inheritParentContext(parent = this._parent) {
    // #13212：自定义元素各自是独立 App；将 appContext.provides 原型接到父 instance.provides，
    // 才能同时读取当前 configureApp/app.provide 与祖先自定义元素 provide。
    if (parent && this._app) {
      Object.setPrototypeOf(
        this._app._context.provides,
        parent._instance!.provides,
      )
    }
  }

  /**
   * 元素断开后延迟到 nextTick 再卸载。
   * 同一 tick DOM 移动会先 disconnected 再 connected，延迟复查可保留组件状态而不误卸载。
   */
  disconnectedCallback(): void {
    this._connected = false
    nextTick(() => {
      if (!this._connected) {
        if (this._ob) {
          this._ob.disconnect()
          this._ob = null
        }
        // 确认仍断开后停止观察、卸载 App/effects，并释放 Teleport 目标引用。
        this._app && this._app.unmount()
        if (this._instance) this._instance.ce = undefined
        this._app = this._instance = null
        if (this._teleportTargets) {
          this._teleportTargets.clear()
          this._teleportTargets = undefined
        }
      }
    })
  }

  /** 批量处理 MutationObserver 捕获的 attribute 变化。 */
  private _processMutations(mutations: MutationRecord[]) {
    for (const m of mutations) {
      this._setAttr(m.attributeName!)
    }
  }

  /**
   * 解析内部组件定义（含 async wrapper），准备 attrs/props/样式后首次 mount。
   * 同一个元素只允许一个进行中的解析 Promise。
   */
  private _resolveDef() {
    if (this._pendingResolve) {
      return this._pendingResolve
    }

    // observer 启动前先读取已有 attrs，避免漏掉 HTML 解析阶段写入的初始值。
    for (let i = 0; i < this.attributes.length; i++) {
      this._setAttr(this.attributes[i].name)
    }

    // 后续外部 setAttribute/removeAttribute 实时同步到组件 props。
    this._ob = new MutationObserver(this._processMutations.bind(this))

    this._ob.observe(this, { attributes: true })

    /** 定义解析后的准备/挂载闭包：清 pending，转换 Number props、建立 property 访问器、注入 ShadowRoot 样式，再 mount。异步定义路径在调用前已把 _def 替换为内部组件。 */
    const resolve = (def: InnerComponentDef, isAsync = false) => {
      this._resolved = true
      this._pendingResolve = undefined

      const { props, styles } = def

      // 异步定义解析前收到的 attributes 尚不知道类型；解析后补做 Number 转换并缓存键。
      let numberProps
      if (props && !isArray(props)) {
        for (const key in props) {
          const opt = props[key]
          if (opt === Number || (opt && opt.type === Number)) {
            if (key in this._props) {
              this._props[key] = toNumber(this._props[key])
            }
            ;(numberProps || (numberProps = Object.create(null)))[
              camelize(key)
            ] = true
          }
        }
      }
      this._numberProps = numberProps
      this._resolveProps(def)

      // scoped 样式只可靠隔离在 ShadowRoot；light DOM 模式暂不自动注入。
      if (this.shadowRoot) {
        this._applyStyles(styles)
      } else if (__DEV__ && styles) {
        warn(
          'Custom element style injection is not supported when using ' +
            'shadowRoot: false',
        )
      }

      // props 与 styles 均准备完成后首次挂载。
      this._mount(def)
    }

    const asyncDef = (this._def as ComponentOptions).__asyncLoader
    if (asyncDef) {
      this._pendingResolve = asyncDef().then((def: InnerComponentDef) => {
        def.configureApp = this._def.configureApp
        resolve((this._def = def), true)
      })
      return this._pendingResolve
    } else {
      resolve(this._def)
    }
  }

  /** 创建独立 App、建立父 provide 原型、执行 configureApp 并 mount 到 root。 */
  private _mount(def: InnerComponentDef) {
    if ((__DEV__ || __FEATURE_PROD_DEVTOOLS__) && !def.name) {
      // @ts-expect-error
      def.name = 'VueElement'
    }
    this._app = this._createApp(def)
    // 先继承父上下文，再运行 configureApp；后者可显式提供同名值覆盖祖先。
    this._inheritParentContext()
    if (def.configureApp) {
      def.configureApp(this._app)
    }
    this._app._ceVNode = this._createVNode()
    this._app.mount(this._root)

    // 把组件 expose 的只读、自动解 ref getter投射到 HTMLElement 实例。
    const exposed = this._instance && this._instance.exposed
    if (!exposed) return
    for (const key in exposed) {
      if (!hasOwn(this, key)) {
        // expose 到自定义元素的属性只读。
        Object.defineProperty(this, key, {
          // 与组件公共实例一致，读取时自动解包 ref。
          /** 把组件 expose 属性投射为元素只读 getter，读取时 unref，保持公开暴露值随 ref 更新。 */
          get: () => unref(exposed[key]),
        })
      } else if (__DEV__) {
        warn(`Exposed property "${key}" already exists on custom element.`)
      }
    }
  }

  /**
   * 定义解析后，先把 upgrade/连接前写入的声明 prop 存入 `_props`，
   * 再在元素实例上用 getter/setter 替换同名自有 property，后续读写进入更新与反射流程。
   */
  private _resolveProps(def: InnerComponentDef) {
    const { props } = def
    const declaredPropKeys = isArray(props) ? props : Object.keys(props || {})

    // 收集定义注册/连接前写在元素实例上的声明 prop。
    for (const key of Object.keys(this)) {
      if (key[0] !== '_' && declaredPropKeys.includes(key)) {
        this._setProp(key, this[key as keyof this])
      }
    }

    // 每个声明 key 统一 camelCase，并让 property 写入可反射 attribute/触发组件更新。
    for (const key of declaredPropKeys.map(camelize)) {
      if (__DEV__ && key in Object.getPrototypeOf(this)) {
        warn(
          `Custom element prop "${key}" conflicts with an existing property ` +
            `on the element and will overwrite it.`,
        )
      }
      Object.defineProperty(this, key, {
        /** 声明 prop 的元素 property getter，返回 _props 中原始值。 */
        get(this: VueElement) {
          return this._getProp(key)
        },
        /** 声明 prop 的 property setter；反射到 attribute，批量 patch 中只标记 dirty，否则允许立即更新组件。 */
        set(this: VueElement, val) {
          this._setProp(key, val, true, !this._patching)
        },
      })
    }
  }

  /** 把一个 attribute 的当前状态转换并同步成 camelCase 组件 prop。 */
  protected _setAttr(key: string): void {
    if (key.startsWith('data-v-')) return
    const has = this.hasAttribute(key)
    let value = has ? this.getAttribute(key) : REMOVAL
    const camelKey = camelize(key)
    if (has && this._numberProps && this._numberProps[camelKey]) {
      value = toNumber(value)
    }
    this._setProp(camelKey, value, false, true)
  }

  /** 读取自定义元素内部 prop 原值。 @internal */
  protected _getProp(key: string): any {
    return this._props[key]
  }

  /**
   * 更新内部 prop，可选反射回 attribute 与触发 VNode patch。
   *
   * 反射期间先消费 observer 已排队记录并暂时断开，防止自己的 setAttribute 再次回流。
   * 只有 boolean/string/number 适合 attribute；对象/函数只保留 property。
   * @internal
   */
  _setProp(
    key: string,
    val: any,
    shouldReflect = true,
    shouldUpdate = false,
  ): void {
    if (val !== this._props[key]) {
      this._dirty = true
      if (val === REMOVAL) {
        delete this._props[key]
      } else {
        this._props[key] = val
        // key 是 VNode 身份字段，不属于普通 props；App 已存在时还需同步根 ceVNode.key。
        if (key === 'key' && this._app) {
          this._app._ceVNode!.key = val
        }
      }
      if (shouldUpdate && this._instance) {
        this._update()
      }
      // property → attribute 反射。
      if (shouldReflect) {
        const ob = this._ob
        if (ob) {
          this._processMutations(ob.takeRecords())
          ob.disconnect()
        }
        if (val === true) {
          this.setAttribute(hyphenate(key), '')
        } else if (typeof val === 'string' || typeof val === 'number') {
          this.setAttribute(hyphenate(key), val + '')
        } else if (!val) {
          this.removeAttribute(hyphenate(key))
        }
        ob && ob.observe(this, { attributes: true })
      }
    }
  }

  /** 用最新 `_props` 创建根 VNode 并增量 patch 当前 root。 */
  private _update() {
    const vnode = this._createVNode()
    if (this._app) vnode.appContext = this._app._context
    render(vnode, this._root)
  }

  /**
   * 创建承载组件的根 VNode，并在首次创建实例时安装 custom-element 拦截器。
   * light DOM 模式还在 mounted/updated 后把原始 slot 节点替换进 `<slot>` outlet。
   */
  private _createVNode(): VNode<any, any> {
    const baseProps: VNodeProps = {}
    if (!this.shadowRoot) {
      baseProps.onVnodeMounted = baseProps.onVnodeUpdated =
        this._renderSlots.bind(this)
    }
    const vnode = createVNode(this._def, extend(baseProps, this._props))
    if (!this._instance) {
      /** 首次创建内部组件实例时把 ce 双向绑定，安装 HMR 重载与 emit→CustomEvent 转换，并接入最近自定义元素父上下文。 */
      vnode.ce = instance => {
        this._instance = instance
        instance.ce = this
        instance.isCE = true // vue-i18n 等库的历史兼容检测字段。
        // HMR 重载样式后重建实例 VNode，避免旧组件/样式状态残留。
        if (__DEV__) {
          /** HMR 删除自身旧样式和锚点，应用新样式，清 _instance 后重建根 VNode，使实例/样式回到当前定义。 */
          instance.ceReload = newStyles => {
            // 自身样式始终整组替换；子样式锚点也需失效。
            if (this._styles) {
              this._styles.forEach(s => this._root.removeChild(s))
              this._styles.length = 0
            }
            this._styleAnchors.delete(this._def)
            this._applyStyles(newStyles)
            this._instance = null
            this._update()
          }
        }

        /** 把组件 emit 转成 CustomEvent；detail 默认是参数数组，首参数为普通对象时可提供 bubbles/composed 等事件选项。 */
        const dispatch = (event: string, args: any[]) => {
          this.dispatchEvent(
            new CustomEvent(
              event,
              isPlainObject(args[0])
                ? extend({ detail: args }, args[0])
                : { detail: args },
            ),
          )
        }

        // 组件 emit 转换为原生 CustomEvent，让非 Vue 消费者可 addEventListener。
        /** 以原事件名和不同的 kebab-case 名分别分发 CustomEvent，参数数组放入 detail，兼容模板和原生监听者。 */
        instance.emit = (event: string, ...args: any[]) => {
          // 同时分发原名与 kebab-case，匹配 Vue 模板事件大小写兼容行为。
          dispatch(event, args)
          if (hyphenate(event) !== event) {
            dispatch(hyphenate(event), args)
          }
        }

        this._setParent()
      }
    }
    return vnode
  }

  /**
   * 按组件嵌套顺序把 CSS 文本注入 ShadowRoot。
   *
   * 倒序创建再用 last/anchor 插入，最终仍保持 styles 原顺序；owner WeakSet 防重复；
   * styleAnchors 让父/子组件样式按渲染层级稳定排列；开发环境额外记录供 HMR 删除。
   */
  private _applyStyles(
    styles: string[] | undefined,
    owner?: ConcreteComponent,
    parentComp?: ConcreteComponent,
  ) {
    if (!styles) return
    if (owner) {
      if (owner === this._def || this._styleChildren.has(owner)) {
        return
      }
      this._styleChildren.add(owner)
    }

    const nonce = this._nonce
    const root = this.shadowRoot!
    const insertionAnchor = parentComp
      ? this._getStyleAnchor(parentComp) || this._getStyleAnchor(this._def)
      : this._getRootStyleInsertionAnchor(root)
    let last: HTMLStyleElement | null = null
    for (let i = styles.length - 1; i >= 0; i--) {
      const s = document.createElement('style')
      if (nonce) s.setAttribute('nonce', nonce)
      s.textContent = styles[i]

      root.insertBefore(s, last || insertionAnchor)
      last = s
      if (i === 0) {
        if (!parentComp) this._styleAnchors.set(this._def, s)
        if (owner) this._styleAnchors.set(owner, s)
      }

      // 开发环境按自身/子组件 hmrId 记录真实 style 节点，热更时精确删除。
      if (__DEV__) {
        if (owner) {
          if (owner.__hmrId) {
            if (!this._childStyles) this._childStyles = new Map()
            let entry = this._childStyles.get(owner.__hmrId)
            if (!entry) {
              this._childStyles.set(owner.__hmrId, (entry = []))
            }
            entry.push(s)
          }
        } else {
          ;(this._styles || (this._styles = [])).push(s)
        }
      }
    }
  }

  /** 取得仍属于当前 ShadowRoot 的组件 style 锚点；脱离节点会清除陈旧缓存。 */
  private _getStyleAnchor(comp?: ConcreteComponent): HTMLStyleElement | null {
    if (!comp) {
      return null
    }
    const anchor = this._styleAnchors.get(comp)
    if (anchor && anchor.parentNode === this.shadowRoot) {
      return anchor
    }
    if (anchor) {
      this._styleAnchors.delete(comp)
    }
    return null
  }

  /** 返回 ShadowRoot 第一个非 style 子节点，使 Vue 样式始终插在实际内容之前。 */
  private _getRootStyleInsertionAnchor(root: ShadowRoot): ChildNode | null {
    for (let i = 0; i < root.childNodes.length; i++) {
      const node = root.childNodes[i]
      if (!(node instanceof HTMLStyleElement)) {
        return node
      }
    }
    return null
  }

  /**
   * light DOM 模式首次连接时摘取元素原 children，并按 slot attribute 分组保存。
   * 仅 `shadowRoot: false` 调用。
   */
  private _parseSlots() {
    const slots: VueElement['_slots'] = (this._slots = {})
    let n
    while ((n = this.firstChild)) {
      const slotName =
        (n.nodeType === 1 && (n as Element).getAttribute('slot')) || 'default'
      ;(slots[slotName] || (slots[slotName] = [])).push(n)
      this.removeChild(n)
    }
  }

  /**
   * light DOM 模式把保存的原始节点/回退内容替换到组件渲染出的 `<slot>` outlet。
   * 原生 slot 分发只作用于 Shadow DOM，因此无 ShadowRoot 时由 Vue 手动模拟。
   */
  private _renderSlots() {
    const outlets = this._getSlots()
    const scopeId = this._instance!.type.__scopeId
    for (let i = 0; i < outlets.length; i++) {
      const o = outlets[i] as HTMLSlotElement
      const slotName = o.getAttribute('name') || 'default'
      const content = this._slots![slotName]
      const parent = o.parentNode!
      if (content) {
        for (const n of content) {
          // SFC `:slotted` 选择器需要给插入节点及其元素后代附加 `scopeId-s`。
          if (scopeId && n.nodeType === 1) {
            const id = scopeId + '-s'
            const walker = document.createTreeWalker(n, 1)
            ;(n as Element).setAttribute(id, '')
            let child
            while ((child = walker.nextNode())) {
              ;(child as Element).setAttribute(id, '')
            }
          }
          parent.insertBefore(n, o)
        }
      } else {
        while (o.firstChild) parent.insertBefore(o.firstChild, o)
      }
      parent.removeChild(o)
    }
  }

  /**
   * 查找元素自身及 light DOM Teleport 目标中的全部 slot outlet，并去重。
   * @internal
   */
  private _getSlots(): HTMLSlotElement[] {
    const roots: Element[] = [this]
    if (this._teleportTargets) {
      roots.push(...this._teleportTargets)
    }

    const slots = new Set<HTMLSlotElement>()
    for (const root of roots) {
      const found = root.querySelectorAll<HTMLSlotElement>('slot')
      for (let i = 0; i < found.length; i++) {
        slots.add(found[i])
      }
    }

    return Array.from(slots)
  }

  /** 向当前自定义元素 ShadowRoot 注入子组件 SFC 样式。 @internal */
  _injectChildStyle(
    comp: ConcreteComponent & CustomElementOptions,
    parentComp?: ConcreteComponent,
  ): void {
    this._applyStyles(comp.styles, comp, parentComp)
  }

  /** 开始 core 批量 patch property，期间只标记 dirty、不逐项重渲染。 @internal */
  _beginPatch(): void {
    this._patching = true
    this._dirty = false
  }

  /** 结束批量 patch；若 props 有变化，只执行一次组件更新。 @internal */
  _endPatch(): void {
    this._patching = false
    if (this._dirty && this._instance) {
      this._update()
    }
  }

  /** 组件定义是否启用 ShadowRoot。 @internal */
  _hasShadowRoot(): boolean {
    return this._def.shadowRoot !== false
  }

  /** 开发/HMR 时移除指定子组件的旧样式和锚点记录。 @internal */
  _removeChildStyle(comp: ConcreteComponent): void {
    if (__DEV__) {
      this._styleChildren.delete(comp)
      this._styleAnchors.delete(comp)
      if (this._childStyles && comp.__hmrId) {
        // 删除该 hmrId 旧 style 节点，等待新 render 注入替代文本。
        const oldStyles = this._childStyles.get(comp.__hmrId)
        if (oldStyles) {
          oldStyles.forEach(s => this._root.removeChild(s))
          oldStyles.length = 0
        }
      }
    }
  }
}

/**
 * 读取当前 `defineCustomElement()` 组件所属 HTMLElement。
 * 仅 setup/组件上下文内且 instance.ce 存在时可用；普通 createApp 组件返回 null。
 */
export function useHost(caller?: string): VueElement | null {
  const instance = getCurrentInstance()
  const el = instance && (instance.ce as VueElement)
  if (el) {
    return el
  } else if (__DEV__) {
    if (!instance) {
      warn(
        `${caller || 'useHost'} called without an active component instance.`,
      )
    } else {
      warn(
        `${caller || 'useHost'} can only be used in components defined via ` +
          `defineCustomElement.`,
      )
    }
  }
  return null
}

/**
 * 获取当前自定义元素的 ShadowRoot。
 * 只能在 `defineCustomElement()` 组件的 setup 中使用；`shadowRoot: false` 时返回 null。
 */
export function useShadowRoot(): ShadowRoot | null {
  const el = __DEV__ ? useHost('useShadowRoot') : useHost()
  return el && el.shadowRoot
}
