import type {
  ElementNode,
  Namespace,
  Namespaces,
  ParentNode,
  TemplateChildNode,
} from './ast'
import type { CompilerError } from './errors'
import type {
  DirectiveTransform,
  NodeTransform,
  TransformContext,
} from './transform'
import type { CompilerCompatOptions } from './compat/compatConfig'
import type { ParserPlugin } from '@babel/parser'

/** 解析、转换和代码生成阶段共用的诊断回调。 */
export interface ErrorHandlingOptions {
  /** 接收可恢复问题；默认仅在开发环境输出控制台警告。 */
  onWarn?: (warning: CompilerError) => void
  /** 接收阻止正确生成代码的错误；默认直接抛出。 */
  onError?: (error: CompilerError) => void
}

/** 控制模板如何被词法分析并构造成基础 AST。 */
export interface ParserOptions
  extends ErrorHandlingOptions, CompilerCompatOptions {
  /**
   * 选择模板解析模式。
   *
   * - `base`：平台无关，仅识别类 HTML 语法，所有标签按相同规则处理；
   * - `html`：补充 `<script>`、`<style>`、`<title>`、`<textarea>` 等 HTML 原始文本规则；
   * - `sfc`：除根级 `<template>` 外，其余根块都按纯文本读取，避免脚本/样式内容被当成模板。
   *
   * 特殊状态仍放在 compiler-core 的 tokenizer 内，避免平台层重复扫描字符。
   */
  parseMode?: 'base' | 'html' | 'sfc'
  /**
   * 模板根节点使用的命名空间。
   * @default Namespaces.HTML
   */
  ns?: Namespaces
  /** 判断平台原生元素，例如浏览器中的 `<div>`；非原生标签通常按组件处理。 */
  isNativeTag?: (tag: string) => boolean
  /** 判断不需要结束标签的原生元素，例如 `<img>`、`<br>`、`<hr>`。 */
  isVoidTag?: (tag: string) => boolean
  /** 判断是否保留内部空白，例如 `<pre>`。 */
  isPreTag?: (tag: string) => boolean
  /**
   * 判断是否按 HTML 规范忽略开标签后的第一个换行，例如 `<textarea>` 和 `<pre>`。
   */
  isIgnoreNewlineTag?: (tag: string) => boolean
  /** 把平台内置组件名映射为运行时 helper Symbol，例如 DOM 的 `<Transition>`。 */
  isBuiltInComponent?: (tag: string) => symbol | void
  /** 供最终用户扩展自定义元素列表；命中后不会把该标签解析为 Vue 组件。 */
  isCustomElement?: (tag: string) => boolean | void
  /** 根据标签、父元素和根命名空间计算当前元素命名空间（HTML / SVG / MathML）。 */
  getNamespace?: (
    tag: string,
    parent: ElementNode | undefined,
    rootNamespace: Namespace,
  ) => Namespace
  /** 插值起止分隔符。 @default ['{{', '}}'] */
  delimiters?: [string, string]
  /** 文本空白处理策略：保留或合并。 @default 'condense' */
  whitespace?: 'preserve' | 'condense'
  /**
   * 浏览器内运行的 DOM 编译器使用的 HTML 实体解码器；非浏览器构建忽略此项。
   */
  decodeEntities?: (rawText: string, asAttr: boolean) => string
  /**
   * 是否在模板 AST 中保留注释。
   * @default 开发构建为 true，生产构建为 false
   */
  comments?: boolean
  /** 是否用 Babel 解析并前缀化 JS 表达式。 @default false */
  prefixIdentifiers?: boolean
  /**
   * 传给 `@babel/parser` 的表达式语法插件列表，用于绑定和插值中的 JS/TS 新语法。
   * https://babeljs.io/docs/en/next/babel-parser#plugins
   */
  expressionPlugins?: ParserPlugin[]
}

/**
 * 静态提升完成后的平台扩展钩子。
 * compiler-dom 用它把连续静态元素进一步串成 HTML 字符串。
 */
export type HoistTransform = (
  children: TemplateChildNode[],
  context: TransformContext,
  parent: ParentNode,
) => void

/**
 * `<script>` / `<script setup>` 顶层绑定的来源与可变性分类。
 * 模板表达式转换据此决定使用 `_ctx.foo`、`$setup.foo`、`unref(foo)` 或 `foo.value`。
 */
export enum BindingTypes {
  /** `data()` 返回的响应式状态。 */
  DATA = 'data',
  /** 组件 props 声明。 */
  PROPS = 'props',
  /**
   * `<script setup>` 解构 prop 的本地别名；原始 prop 名保存在 `__propsAliases`。
   */
  PROPS_ALIASED = 'props-aliased',
  /** `let` 绑定，运行时可能是 ref，也可能是普通值。 */
  SETUP_LET = 'setup-let',
  /**
   * 确定不可能是 ref 的 `const` 绑定；内联模板访问时无需生成 `unref()`。
   */
  SETUP_CONST = 'setup-const',
  /** 无需 `unref()`、但对象内部可能被修改的响应式 `const` 绑定。 */
  SETUP_REACTIVE_CONST = 'setup-reactive-const',
  /** 可能是 ref 的 `const` 绑定，需要通过 `unref()` 安全读取。 */
  SETUP_MAYBE_REF = 'setup-maybe-ref',
  /** 确定是 ref 的绑定，赋值时可直接访问 `.value`。 */
  SETUP_REF = 'setup-ref',
  /** 由 Options API 声明的绑定，例如 `computed`、`inject`。 */
  OPTIONS = 'options',
  /** 字符串、数字、布尔值等字面量常量，可参与更激进的静态优化。 */
  LITERAL_CONST = 'literal-const',
}

/** SFC 脚本分析结果：名字到绑定类型的映射，并附带 script setup 元信息。 */
export type BindingMetadata = {
  /** 模板可见名称对应的绑定种类。 */
  [key: string]: BindingTypes | undefined
} & {
  /** 绑定元数据是否来自 `<script setup>`，影响访问与赋值代码生成。 */
  __isScriptSetup?: boolean
  /** 解构 props 的本地别名到原始 prop 名映射。 */
  __propsAliases?: Record<string, string>
}

/** AST 转换和代码生成共同依赖的选项。 */
interface SharedTransformCodegenOptions {
  /**
   * 是否把 `{{ foo }}` 等表达式改写为 `_ctx.foo`。
   * 关闭时生成代码会包在 `with (_ctx) { ... }` 中；ES module 默认为严格模式，
   * 禁止 `with`，所以 module 模式会强制开启。
   * @default mode === 'module'
   */
  prefixIdentifiers?: boolean
  /**
   * 是否生成 SSR 优化的 `ssrRender`，而非客户端 `render`。
   *
   * SSR 组件的客户端回退分支会临时设为 `false`，让子转换生成 VNode 代码；
   * 详见 `ssrTransformComponent.ts` 的 `subTransform`。
   */
  ssr?: boolean
  /**
   * 标记整次任务是否处于 SSR 编译中。即使正在为 SSR 回退分支生成客户端 VNode，
   * 仍保持 `inSSR = true`，此时组合为 `ssr = false`、`inSSR = true`。
   */
  inSSR?: boolean
  /** 脚本分析得到的绑定元数据，用于优化开启前缀模式后的变量访问。 */
  bindingMetadata?: BindingMetadata
  /**
   * 是否生成可内联到 `setup()` 的渲染函数，使模板直接访问 setup 局部变量。
   */
  inline?: boolean
  /** 指示转换和代码生成尽量输出合法 TypeScript，例如保留必要类型断言。 */
  isTS?: boolean
  /**
   * 生成 source map 时使用的文件名，也用于识别模板中的组件自递归引用。
   * @default 'template.vue.html'
   */
  filename?: string
}

/** 控制 AST 转换、静态优化以及平台扩展的选项。 */
export interface TransformOptions
  extends
    SharedTransformCodegenOptions,
    ErrorHandlingOptions,
    CompilerCompatOptions {
  /** 依次应用于每个 AST 节点的额外节点转换。 */
  nodeTransforms?: NodeTransform[]
  /** 指令名到转换器的映射；处理元素上每个对应指令属性。 */
  directiveTransforms?: Record<string, DirectiveTransform | undefined>
  /**
   * 静态节点提升后的可选平台钩子。compiler-dom 用它将提升节点串成静态 HTML VNode。
   * @default null
   */
  transformHoist?: HoistTransform | null
  /**
   * 标记配套运行时提供的额外内置组件，使编译器为其生成组件 VNode。
   */
  isBuiltInComponent?: (tag: string) => symbol | void
  /** 判断自定义元素；供只应处理平台原生元素的转换跳过这些节点。 */
  isCustomElement?: (tag: string) => boolean | void
  /**
   * 是否把自由标识符改写为 `_ctx` 访问；module 模式因不能使用 `with` 而强制开启。
   * @default mode === 'module'
   */
  prefixIdentifiers?: boolean
  /** 把静态 VNode 和 props 对象提升到 `_hoisted_x` 常量。 @default false */
  hoistStatic?: boolean
  /**
   * 缓存 `v-on` 处理器，避免每次渲染新建内联函数，也让运行时无需反复 patch 监听器。
   * 例如 `@click="foo"` 默认生成 `{ onClick: foo }`，开启后生成：
   * ```js
   * { onClick: _cache[0] || (_cache[0] = e => _ctx.foo(e)) }
   * ```
   * 依赖 `prefixIdentifiers` 的作用域分析，只有确定处理器不捕获局部变量时才可缓存。
   * @default false
   */
  cacheHandlers?: boolean
  /**
   * `@babel/parser` 解析绑定和插值表达式时启用的语法插件。
   * https://babeljs.io/docs/en/next/babel-parser#plugins
   */
  expressionPlugins?: ParserPlugin[]
  /** SFC scoped style 的作用域 ID，例如 `data-v-xxxx`。 */
  scopeId?: string | null
  /**
   * SFC 样式是否使用 `:slotted`。为兼容旧调用方默认 `true`；工具链若确认未使用应设为 `false`。
   */
  slotted?: boolean
  /**
   * SFC CSS 变量注入表达式，例如 `{ 'xxxx-color': color }`；
   * SSR 用它在组件根元素输出内联 CSS 变量。
   */
  ssrCssVars?: string
  /**
   * 是否按需要 HMR 的模板编译。HMR 替换组件时必须保持部分动态结构可更新；
   * #6938、#7138 等边界场景因此需要生成不同 patch 标记或 block 结构。
   */
  hmr?: boolean
}

/** 控制渲染函数包装方式、helper 来源及 source map 的代码生成选项。 */
export interface CodegenOptions extends SharedTransformCodegenOptions {
  /**
   * - `module`：为 helper 生成 ESM import，并默认导出渲染函数；
   * - `function`：从全局 `Vue` 解构 helper 并返回函数，供 `new Function(code)()` 运行时编译。
   * @default 'function'
   */
  mode?: 'module' | 'function'
  /** 是否生成 source map。 @default false */
  sourceMap?: boolean
  /** SFC scoped style 的作用域 ID。 */
  scopeId?: string | null
  /**
   * 是否用变量赋值优化 helper import 绑定；仅用于 webpack 代码分割场景。
   * @default false
   */
  optimizeImports?: boolean
  /** 客户端运行时 helper 的导入模块。 @default 'vue' */
  runtimeModuleName?: string
  /**
   * SSR 运行时 helper 的导入模块。
   * @default 'vue/server-renderer'
   */
  ssrRuntimeModuleName?: string
  /**
   * function 模式下获取 helper 的 Vue 全局变量名。
   * @default 'Vue'
   */
  runtimeGlobalName?: string
}

/** 完整编译入口接受的解析、转换、代码生成选项交集。 */
export type CompilerOptions = ParserOptions & TransformOptions & CodegenOptions
