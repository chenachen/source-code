import {
  type App,
  type CreateAppFunction,
  type DefineComponent,
  DeprecationTypes,
  type Directive,
  type ElementNamespace,
  type HydrationRenderer,
  type Renderer,
  type RootHydrateFunction,
  type RootRenderFunction,
  compatUtils,
  createHydrationRenderer,
  createRenderer,
  isRuntimeOnly,
  warn,
} from '@vue/runtime-core'
import { nodeOps } from './nodeOps'
import { patchProp } from './patchProp'
export { nodeOps, patchProp }
// 这些共享编译器判定在生产打包中可被 tree-shake，不会让 runtime-dom 强制携带编译器。
import {
  NOOP,
  extend,
  isFunction,
  isHTMLTag,
  isMathMLTag,
  isSVGTag,
  isString,
} from '@vue/shared'
import type { TransitionProps } from './components/Transition'
import type { TransitionGroupProps } from './components/TransitionGroup'
import type { vShow } from './directives/vShow'
import type { VOnDirective } from './directives/vOn'
import type { VModelDirective } from './directives/vModel'
import type { ClassValue, StyleValue } from './jsx'

/**
 * 没有 DOM lib 时的类型桩，避免单纯消费 Vue 类型必须加载浏览器类型。
 * 要获得真实 DOM 类型，请在 tsconfig `lib` 中加入 `"dom"`。
 */
type DomType<T> = typeof globalThis extends { window: unknown } ? T : never

declare module '@vue/reactivity' {
  /** DOM Node 与 Window 含有复杂宿主对象结构，ref 解包必须在这里停止递归。 */
  export interface RefUnwrapBailTypes {
    runtimeDOMBailTypes: DomType<Node | Window>
  }
}

declare module '@vue/runtime-core' {
  /** runtime-dom 为所有组件补充可透传的 class 与 style 属性类型。 */
  interface AllowedAttrs {
    class?: ClassValue
    style?: StyleValue
  }

  /** 无需局部注册即可在模板中获得类型提示的 DOM 过渡内置组件。 */
  interface GlobalComponents {
    Transition: DefineComponent<TransitionProps>
    TransitionGroup: DefineComponent<TransitionGroupProps>
  }

  /** runtime-dom 向模板类型系统登记的 DOM 平台内置指令。 */
  interface GlobalDirectives {
    vShow: typeof vShow
    vOn: VOnDirective
    vBind: VModelDirective
    vIf: Directive<any, boolean>
    vOnce: Directive
    vSlot: Directive
  }
}

/** core renderer 所需的完整 DOM 宿主选项。 */
const rendererOptions = /*@__PURE__*/ extend({ patchProp }, nodeOps)

// 惰性创建：若用户只从 Vue 导入响应式 API，core renderer 与全部 DOM 操作可被摇掉。
let renderer: Renderer<Element | ShadowRoot> | HydrationRenderer

/** 当前缓存 renderer 是否已升级为带 hydration 能力的版本。 */
let enabledHydration = false

/** 获取普通 DOM renderer，首次真正 render/createApp 时才创建。 */
function ensureRenderer() {
  return (
    renderer ||
    (renderer = createRenderer<Node, Element | ShadowRoot>(rendererOptions))
  )
}

/**
 * 获取水合 renderer。普通 renderer 已创建时会替换为 hydration 版本；两者宿主选项相同。
 */
function ensureHydrationRenderer() {
  renderer = enabledHydration
    ? renderer
    : createHydrationRenderer(rendererOptions)
  enabledHydration = true
  return renderer as HydrationRenderer
}

// 显式类型断言避免 rollup 后 d.ts 生成动态 import() 类型引用。
/** 把 VNode 树客户端渲染到 DOM 容器。 */
export const render = ((...args) => {
  ensureRenderer().render(...args)
}) as RootRenderFunction<Element | ShadowRoot>

/** 把 VNode 树水合到已有 SSR DOM。 */
export const hydrate = ((...args) => {
  ensureHydrationRenderer().hydrate(...args)
}) as RootHydrateFunction

/**
 * 创建客户端 DOM 应用，并扩展 mount：解析选择器、必要时读取 in-DOM template、清空
 * 容器、推导根命名空间，以及维护 v-cloak/data-v-app 标记。
 */
export const createApp = ((...args) => {
  const app = ensureRenderer().createApp(...args)

  if (__DEV__) {
    injectNativeTagCheck(app)
    injectCompilerOptionsCheck(app)
  }

  const { mount } = app
  app.mount = (containerOrSelector: Element | ShadowRoot | string): any => {
    const container = normalizeContainer(containerOrSelector)
    if (!container) return

    const component = app._component
    if (!isFunction(component) && !component.render && !component.template) {
      // __UNSAFE__：in-DOM template 会被编译并执行其中 JS 表达式。容器 HTML 必须可信；
      // 若来自服务端，不能把未经转义的用户内容拼入模板。
      component.template = container.innerHTML
      // Vue 2 允许在 mount 容器自身声明模板指令；compat 检测并提示迁移。
      if (__COMPAT__ && __DEV__ && container.nodeType === 1) {
        for (let i = 0; i < (container as Element).attributes.length; i++) {
          const attr = (container as Element).attributes[i]
          if (attr.name !== 'v-cloak' && /^(?:v-|:|@)/.test(attr.name)) {
            compatUtils.warnDeprecation(
              DeprecationTypes.GLOBAL_MOUNT_CONTAINER,
              null,
            )
            break
          }
        }
      }
    }

    // 客户端 mount 不复用旧内容，先清空；ShadowRoot 无 textContent 特判需要。
    if (container.nodeType === 1) {
      container.textContent = ''
    }
    const proxy = mount(container, false, resolveRootNamespace(container))
    if (container instanceof Element) {
      container.removeAttribute('v-cloak')
      container.setAttribute('data-v-app', '')
    }
    return proxy
  }

  return app
}) as CreateAppFunction<Element>

/** 创建默认以 hydration 模式 mount 的 SSR DOM 应用。 */
export const createSSRApp = ((...args) => {
  const app = ensureHydrationRenderer().createApp(...args)

  if (__DEV__) {
    injectNativeTagCheck(app)
    injectCompilerOptionsCheck(app)
  }

  const { mount } = app
  app.mount = (containerOrSelector: Element | ShadowRoot | string): any => {
    const container = normalizeContainer(containerOrSelector)
    if (container) {
      return mount(container, true, resolveRootNamespace(container))
    }
  }

  return app
}) as CreateAppFunction<Element>

/** 根据 mount 容器真实类型推导根 VNode children 的 SVG/MathML 命名空间。 */
function resolveRootNamespace(
  container: Element | ShadowRoot,
): ElementNamespace {
  if (container instanceof SVGElement) {
    return 'svg'
  }
  if (
    typeof MathMLElement === 'function' &&
    container instanceof MathMLElement
  ) {
    return 'mathml'
  }
}

/** 开发环境注入 DOM 原生标签判断，供组件名校验拒绝 HTML/SVG/MathML 标签冲突。 */
function injectNativeTagCheck(app: App) {
  Object.defineProperty(app.config, 'isNativeTag', {
    value: (tag: string) => isHTMLTag(tag) || isSVGTag(tag) || isMathMLTag(tag),
    writable: false,
  })
}

/** runtime-only 构建拦截只对运行时编译有效的配置，并给出构建工具迁移说明。 */
function injectCompilerOptionsCheck(app: App) {
  if (isRuntimeOnly()) {
    const isCustomElement = app.config.isCustomElement
    Object.defineProperty(app.config, 'isCustomElement', {
      get() {
        return isCustomElement
      },
      set() {
        warn(
          `The \`isCustomElement\` config option is deprecated. Use ` +
            `\`compilerOptions.isCustomElement\` instead.`,
        )
      },
    })

    const compilerOptions = app.config.compilerOptions
    const msg =
      `The \`compilerOptions\` config option is only respected when using ` +
      `a build of Vue.js that includes the runtime compiler (aka "full build"). ` +
      `Since you are using the runtime-only build, \`compilerOptions\` ` +
      `must be passed to \`@vue/compiler-dom\` in the build setup instead.\n` +
      `- For vue-loader: pass it via vue-loader's \`compilerOptions\` loader option.\n` +
      `- For vue-cli: see https://cli.vuejs.org/guide/webpack.html#modifying-options-of-a-loader\n` +
      `- For vite: pass it via @vitejs/plugin-vue options. See https://github.com/vitejs/vite-plugin-vue/tree/main/packages/plugin-vue#example-for-passing-options-to-vuecompiler-sfc`

    Object.defineProperty(app.config, 'compilerOptions', {
      get() {
        warn(msg)
        return compilerOptions
      },
      set() {
        warn(msg)
      },
    })
  }
}

/** 把选择器或 Element/ShadowRoot mount 目标统一成真实容器，并诊断无效/closed root。 */
function normalizeContainer(
  container: Element | ShadowRoot | string,
): Element | ShadowRoot | null {
  if (isString(container)) {
    const res = document.querySelector(container)
    if (__DEV__ && !res) {
      warn(
        `Failed to mount app: mount target selector "${container}" returned null.`,
      )
    }
    return res
  }
  if (
    __DEV__ &&
    window.ShadowRoot &&
    container instanceof window.ShadowRoot &&
    container.mode === 'closed'
  ) {
    warn(
      `mounting on a ShadowRoot with \`{mode: "closed"}\` may lead to unpredictable bugs`,
    )
  }
  return container as any
}

// 自定义元素支持。
export {
  defineCustomElement,
  defineSSRCustomElement,
  useShadowRoot,
  useHost,
  VueElement,
  type VueElementConstructor,
  type CustomElementOptions,
} from './apiCustomElement'

// SFC CSS 辅助函数。
export { useCssModule } from './helpers/useCssModule'
export { useCssVars } from './helpers/useCssVars'

// DOM 专用内置组件。
export { Transition, type TransitionProps } from './components/Transition'
export {
  TransitionGroup,
  type TransitionGroupProps,
} from './components/TransitionGroup'

// DOM 专用内部指令辅助函数，由编译器生成代码调用。
export {
  vModelText,
  vModelCheckbox,
  vModelRadio,
  vModelSelect,
  vModelDynamic,
} from './directives/vModel'
export { withModifiers, withKeys } from './directives/vOn'
export { vShow } from './directives/vShow'

import { initVModelForSSR } from './directives/vModel'
import { initVShowForSSR } from './directives/vShow'

/** 避免多次给共享 vModel/vShow 指令对象重复安装 SSR 钩子。 */
let ssrDirectiveInitialized = false

/** SSR 构建首次需要客户端指令时，惰性安装 v-model/v-show 的 getSSRProps。 @internal */
export const initDirectivesForSSR: () => void = __SSR__
  ? () => {
      if (!ssrDirectiveInitialized) {
        ssrDirectiveInitialized = true
        initVModelForSSR()
        initVShowForSSR()
      }
    }
  : NOOP

// 统一从 runtime-dom 重导出 core 的 h、组件/响应式 API、nextTick、标志与类型。
export * from '@vue/runtime-core'

export * from './jsx'
