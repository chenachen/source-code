import { type PatchFlags, isString } from '@vue/shared'
import {
  CREATE_BLOCK,
  CREATE_ELEMENT_BLOCK,
  CREATE_ELEMENT_VNODE,
  type CREATE_SLOTS,
  CREATE_VNODE,
  type FRAGMENT,
  OPEN_BLOCK,
  type RENDER_LIST,
  type RENDER_SLOT,
  WITH_DIRECTIVES,
  type WITH_MEMO,
} from './runtimeHelpers'
import type { PropsExpression } from './transforms/transformElement'
import type { ImportItem, TransformContext } from './transform'
import type { Node as BabelNode } from '@babel/types'

/**
 * Vue 模板 AST 定义。
 *
 * 同一棵树同时容纳三类节点：解析器产生的模板节点、转换阶段产生的结构节点，
 * 以及供代码生成器直接打印的精简 JS AST。理解 `codegenNode` 的挂载关系，
 * 是阅读 compiler-core 三阶段管线的关键。
 */

/** Vue 模板的命名空间编号；平台编译器可在三个内置值之外扩展取值。 */
export type Namespace = number

/** 内置命名空间编号，用于决定标签和属性的解析/生成规则。 */
export enum Namespaces {
  /** 普通 HTML 命名空间，也是解析模板时的默认值。 */
  HTML,
  /** SVG 命名空间；标签名大小写、属性和静态序列化规则与 HTML 不同。 */
  SVG,
  /** MathML 命名空间；进入/退出集成点时需要切换解析规则。 */
  MATH_ML,
}

/**
 * 所有模板节点与精简 JS 代码生成节点的判别枚举。
 * `type` 是各联合类型的 discriminant，转换和代码生成大量使用 switch 分派。
 */
export enum NodeTypes {
  /** 整份模板的根节点。 */
  ROOT,
  /** 元素、组件、插槽出口或 `<template>` 容器。 */
  ELEMENT,
  /** 原始文本。 */
  TEXT,
  /** 模板注释。 */
  COMMENT,
  /** 单段表达式或静态字符串。 */
  SIMPLE_EXPRESSION,
  /** `{{ ... }}` 插值。 */
  INTERPOLATION,
  /** 无指令语义的普通属性。 */
  ATTRIBUTE,
  /** 已拆分名称、参数、表达式和修饰符的 Vue 指令。 */
  DIRECTIVE,
  /** 转换阶段拼接多段内容形成的复合表达式。 */
  COMPOUND_EXPRESSION,
  /** `v-if` 分支组。 */
  IF,
  /** `v-if` 分支组中的一个条件分支。 */
  IF_BRANCH,
  /** `v-for` 循环结构。 */
  FOR,
  /** 已包装成 `createTextVNode` 调用的文本类节点。 */
  TEXT_CALL,
  /** 创建 VNode 或 block 的调用描述。 */
  VNODE_CALL,
  /** JavaScript 函数调用表达式。 */
  JS_CALL_EXPRESSION,
  /** JavaScript 对象字面量。 */
  JS_OBJECT_EXPRESSION,
  /** JavaScript 对象属性。 */
  JS_PROPERTY,
  /** JavaScript 数组字面量。 */
  JS_ARRAY_EXPRESSION,
  /** JavaScript 函数表达式。 */
  JS_FUNCTION_EXPRESSION,
  /** JavaScript 三元条件表达式。 */
  JS_CONDITIONAL_EXPRESSION,
  /** `_cache` 渲染缓存表达式。 */
  JS_CACHE_EXPRESSION,

  /** SSR 代码生成专用的语句块。 */
  JS_BLOCK_STATEMENT,
  /** SSR 输出使用的模板字面量。 */
  JS_TEMPLATE_LITERAL,
  /** SSR 代码中的条件语句。 */
  JS_IF_STATEMENT,
  /** SSR 代码中的赋值表达式。 */
  JS_ASSIGNMENT_EXPRESSION,
  /** SSR 代码中的逗号序列表达式。 */
  JS_SEQUENCE_EXPRESSION,
  /** SSR 代码中的返回语句。 */
  JS_RETURN_STATEMENT,
}

/** 元素节点的语义分类；决定后续生成原生元素、组件、插槽出口还是透明容器。 */
export enum ElementTypes {
  /** 平台原生元素，例如 `<div>`、`<svg>`。 */
  ELEMENT,
  /** Vue 组件，包括静态组件名和动态组件。 */
  COMPONENT,
  /** `<slot>` 插槽出口。 */
  SLOT,
  /** 不直接产生 DOM 的 `<template>` 结构容器。 */
  TEMPLATE,
}

/** AST 节点公共字段。 */
export interface Node {
  /** 节点种类；联合类型依靠它进行类型收窄。 */
  type: NodeTypes
  /** 节点在原模板中的源码范围。 */
  loc: SourceLocation
}

/** 节点源码范围，采用左闭右开区间 `[start, end)`。 */
export interface SourceLocation {
  /** 范围起点，包含该位置。 */
  start: Position
  /** 范围终点，不包含该位置。 */
  end: Position
  /** `start` 到 `end` 对应的原始源码切片。 */
  source: string
}

/** 源码中的绝对偏移、行号和列号；行列从 1 开始，offset 从 0 开始。 */
export interface Position {
  /** 相对文件开头的 UTF-16 字符偏移。 */
  offset: number
  /** 从 1 开始的源码行号。 */
  line: number
  /** 从 1 开始的源码列号。 */
  column: number
}

/** 能直接拥有模板子节点的父节点。 */
export type ParentNode = RootNode | ElementNode | IfBranchNode | ForNode

/** 模板中的简单表达式或由多个片段拼接的复合表达式。 */
export type ExpressionNode = SimpleExpressionNode | CompoundExpressionNode

/** 解析/转换后可出现在模板 children 数组中的节点联合。 */
export type TemplateChildNode =
  | ElementNode
  | InterpolationNode
  | CompoundExpressionNode
  | TextNode
  | CommentNode
  | IfNode
  | IfBranchNode
  | ForNode
  | TextCallNode

/**
 * 整个模板的根节点，也是转换阶段全局元数据的汇总容器。
 * `helpers`、`components`、`hoists` 等集合最终决定生成代码的序言和缓存声明。
 */
export interface RootNode extends Node {
  /** 根节点固定使用 `ROOT` 作为判别值。 */
  type: NodeTypes.ROOT
  /** 传入编译器的完整模板源码。 */
  source: string
  /** 模板解析得到并经结构转换改写的顶层子节点。 */
  children: TemplateChildNode[]
  /** 渲染函数需要导入的运行时 helper；Set 同时负责去重。 */
  helpers: Set<symbol>
  /** 模板引用的组件名，代码生成时据此生成资源解析声明。 */
  components: string[]
  /** 模板引用的自定义指令名。 */
  directives: string[]
  /** 静态提升结果；数组下标对应生成代码中的 `_hoisted_n`。 */
  hoists: (JSChildNode | null)[]
  /** 表达式转换要求插入渲染函数序言的用户模块导入。 */
  imports: ImportItem[]
  /** `_cache` 各槽位的表达式；空槽保留索引，避免编号错位。 */
  cached: (CacheExpression | null)[]
  /** 转换阶段申请的临时变量数量。 */
  temps: number
  /** SSR 转换额外登记的运行时 helper。 */
  ssrHelpers?: symbol[]
  /** 整棵模板最终交给代码生成器打印的入口节点。 */
  codegenNode?: TemplateChildNode | JSChildNode | BlockStatement
  /** 标记该根节点已经执行过 transform，防止 SSR 等流程重复转换。 */
  transformed?: boolean

  /** Vue 2 兼容模式使用的过滤器名称列表。 */
  filters?: string[]
}

/** 四类元素节点的联合。 */
export type ElementNode =
  PlainElementNode | ComponentNode | SlotOutletNode | TemplateNode

/** 元素节点共有的解析结果。 */
export interface BaseElementNode extends Node {
  /** 元素节点固定使用 `ELEMENT` 作为判别值。 */
  type: NodeTypes.ELEMENT
  /** 标签所在命名空间，影响解析和平台代码生成。 */
  ns: Namespace
  /** 解析后的标签名。 */
  tag: string
  /** 原生元素、组件、插槽出口或模板容器的语义分类。 */
  tagType: ElementTypes
  /** 普通属性和指令属性，保持模板中的出现顺序。 */
  props: Array<AttributeNode | DirectiveNode>
  /** 标签内部的模板子节点。 */
  children: TemplateChildNode[]
  /** 是否由 `<foo />` 语法自闭合。 */
  isSelfClosing?: boolean
  /** SFC 根级块内部内容范围，供 script/style/template 后续编译使用。 */
  innerLoc?: SourceLocation
}

/** 平台原生元素；转换后通常生成元素 VNodeCall。 */
export interface PlainElementNode extends BaseElementNode {
  /** 将联合类型收窄为平台原生元素。 */
  tagType: ElementTypes.ELEMENT
  /** 客户端转换生成的 VNode、提升引用或缓存表达式。 */
  codegenNode:
    | VNodeCall
    | SimpleExpressionNode // 静态提升后引用 `_hoisted_n`。
    | CacheExpression // 被 v-once 缓存。
    | MemoExpression // 被 v-memo 缓存。
    | undefined
  /** SSR 转换生成的 HTML 模板字面量。 */
  ssrCodegenNode?: TemplateLiteral
}

/** Vue 组件元素；children 会在 transformElement 中整理成 slots 对象。 */
export interface ComponentNode extends BaseElementNode {
  /** 将联合类型收窄为组件。 */
  tagType: ElementTypes.COMPONENT
  /** 客户端转换生成的组件 VNode 或缓存表达式。 */
  codegenNode:
    | VNodeCall
    | CacheExpression // 被 v-once 缓存。
    | MemoExpression // 被 v-memo 缓存。
    | undefined
  /** SSR 转换生成的组件渲染 helper 调用。 */
  ssrCodegenNode?: CallExpression
}

/** `<slot>` 插槽出口节点，客户端生成 `renderSlot(...)`。 */
export interface SlotOutletNode extends BaseElementNode {
  /** 将联合类型收窄为插槽出口。 */
  tagType: ElementTypes.SLOT
  /** 客户端转换生成的 `renderSlot` 调用或缓存表达式。 */
  codegenNode:
    | RenderSlotCall
    | CacheExpression // 被 v-once 缓存。
    | undefined
  /** SSR 转换生成的 `ssrRenderSlot` helper 调用。 */
  ssrCodegenNode?: CallExpression
}

/** `<template>` 透明容器；结构转换消费它，最终不会直接生成 VNode。 */
export interface TemplateNode extends BaseElementNode {
  /** 将联合类型收窄为透明模板容器。 */
  tagType: ElementTypes.TEMPLATE
  /** `<template>` 仅组织指令与子节点，转换后必定被消除。 */
  codegenNode: undefined
}

/** 原始文本节点。 */
export interface TextNode extends Node {
  /** 文本节点的判别值。 */
  type: NodeTypes.TEXT
  /** 未经 HTML 转义的文本内容。 */
  content: string
}

/** 模板注释节点；是否保留由 parser 的 `comments` 选项决定。 */
export interface CommentNode extends Node {
  /** 注释节点的判别值。 */
  type: NodeTypes.COMMENT
  /** 不含 `<!--` 和 `-->` 定界符的注释内容。 */
  content: string
}

/** 无指令语义的普通属性，例如 `id="app"`。 */
export interface AttributeNode extends Node {
  /** 普通属性节点的判别值。 */
  type: NodeTypes.ATTRIBUTE
  /** 规范化后的属性名。 */
  name: string
  /** 仅覆盖属性名的源码范围，供错误提示精确画线。 */
  nameLoc: SourceLocation
  /** 属性值；布尔属性没有等号和值，因此为 `undefined`。 */
  value: TextNode | undefined
}

/**
 * 归一化后的指令属性，例如 `:id="foo"` 会拆成 name=`bind`、arg=`id`、exp=`foo`。
 */
export interface DirectiveNode extends Node {
  /** 指令节点的判别值。 */
  type: NodeTypes.DIRECTIVE
  /** 去除 `v-` 前缀和简写后的规范名称，例如 `bind`、`on`。 */
  name: string
  /**
   * 保留简写、参数和修饰符的原始属性名；只在解析阶段用于精确定位和兼容处理。
   */
  rawName?: string
  /** 指令值表达式；如 `v-show` 没写值则为 `undefined`。 */
  exp: ExpressionNode | undefined
  /** 静态或动态参数；无参数指令则为 `undefined`。 */
  arg: ExpressionNode | undefined
  /** 点号分隔的修饰符，例如 `.stop`、`.prop`。 */
  modifiers: SimpleExpressionNode[]
  /** 缓存 `v-for` 表达式解析结果，避免 parser 和 transform 重复解析。 */
  forParseResult?: ForParseResult
}

/**
 * 表达式/节点的静态程度，数值越高能力越强并包含较低等级能力。
 * 例如可字符串化的节点必然也可缓存、可跳过 patch。
 */
export enum ConstantTypes {
  /** 依赖运行时数据，每次渲染都要计算。 */
  NOT_CONSTANT = 0,
  /** 值稳定到可以跳过运行时 patch，但未必适合跨渲染缓存。 */
  CAN_SKIP_PATCH,
  /** 可以提升或缓存为渲染函数外/缓存数组中的值。 */
  CAN_CACHE,
  /** 可由 compiler-dom 直接序列化进静态 HTML 字符串。 */
  CAN_STRINGIFY,
}

/** 单个源码字符串表示的表达式；静态属性名也复用该节点。 */
export interface SimpleExpressionNode extends Node {
  /** 简单表达式节点的判别值。 */
  type: NodeTypes.SIMPLE_EXPRESSION
  /** 原始或经前缀处理后的表达式文本。 */
  content: string
  /** 是否为编译器确认的静态字符串，而非待求值的 JS 表达式。 */
  isStatic: boolean
  /** 表达式的静态程度，供提升、缓存和字符串化判断使用。 */
  constType: ConstantTypes
  /**
   * 缓存 Babel 解析结果：`null` 表示无需解析的简单标识符，`false` 表示解析失败。
   */
  ast?: BabelNode | null | false
  /**
   * 表示当前表达式是 `_hoisted_n` 引用，并指向被提升的原始节点，供静态分析追溯。
   */
  hoisted?: JSChildNode
  /**
   * 表达式作为函数参数模式解析时，记录其中声明的标识符，用于正确维护模板局部作用域。
   */
  identifiers?: string[]
  /** 该表达式是否作为事件属性键生成，影响属性名规范化。 */
  isHandlerKey?: boolean
}

/** `{{ expression }}` 插值节点。 */
export interface InterpolationNode extends Node {
  /** 插值节点的判别值。 */
  type: NodeTypes.INTERPOLATION
  /** 双花括号内部的表达式。 */
  content: ExpressionNode
}

/**
 * 由字符串、Symbol helper 和子表达式拼接的表达式，例如文本合并后的
 * `"hello " + _toDisplayString(name)`。
 */
export interface CompoundExpressionNode extends Node {
  /** 复合表达式节点的判别值。 */
  type: NodeTypes.COMPOUND_EXPRESSION
  /**
   * 缓存 Babel 解析结果：`null` 表示无需解析，`false` 表示曾解析失败。
   */
  ast?: BabelNode | null | false
  /** 按生成顺序保存文本片段、helper 和嵌套表达式。 */
  children: (
    | SimpleExpressionNode
    | CompoundExpressionNode
    | InterpolationNode
    | TextNode
    | string
    | symbol
  )[]

  /**
   * 当复合表达式表示函数参数模式时，记录其声明的局部标识符。
   */
  identifiers?: string[]
  /** 该复合表达式是否用作事件属性键。 */
  isHandlerKey?: boolean
}

/** 由 `v-if` / `v-else-if` / `v-else` 合并得到的条件结构节点。 */
export interface IfNode extends Node {
  /** 条件结构节点的判别值。 */
  type: NodeTypes.IF
  /** 按源码顺序保存 `if`、`else-if`、`else` 分支。 */
  branches: IfBranchNode[]
  /** 客户端生成的嵌套三元表达式；`v-once` 外层可能再包缓存。 */
  codegenNode?: IfConditionalExpression | CacheExpression // <div v-if v-once>
}

/** `IfNode` 的一个分支；`condition` 为空表示最终 `v-else`。 */
export interface IfBranchNode extends Node {
  /** 条件分支节点的判别值。 */
  type: NodeTypes.IF_BRANCH
  /** 分支条件；最终的 `v-else` 没有条件。 */
  condition: ExpressionNode | undefined
  /** 命中该分支时渲染的模板子节点。 */
  children: TemplateChildNode[]
  /** 用户显式提供的 `key`，用于检测相邻分支重复 key。 */
  userKey?: AttributeNode | DirectiveNode
  /** 分支是否来自带 `v-if` 的 `<template>` 容器。 */
  isTemplateIf?: boolean
}

/** `v-for` 结构节点，保存数据源、三个可能的别名及列表代码生成节点。 */
export interface ForNode extends Node {
  /** 循环结构节点的判别值。 */
  type: NodeTypes.FOR
  /** `in` / `of` 右侧的可迭代数据源。 */
  source: ExpressionNode
  /** 第一个别名，通常表示当前值。 */
  valueAlias: ExpressionNode | undefined
  /** 第二个别名，数组中为索引、对象中为键。 */
  keyAlias: ExpressionNode | undefined
  /** 第三个别名，对象遍历时表示索引。 */
  objectIndexAlias: ExpressionNode | undefined
  /** parser 保存的完整拆分结果，供作用域与代码生成共用。 */
  parseResult: ForParseResult
  /** 每次迭代要渲染的模板子节点。 */
  children: TemplateChildNode[]
  /** 客户端生成的 Fragment block 与 `renderList` 调用。 */
  codegenNode?: ForCodegenNode
}

/** `v-for="(value, key, index) in source"` 的拆分结果。 */
export interface ForParseResult {
  /** 循环的数据源表达式。 */
  source: ExpressionNode
  /** 当前值别名。 */
  value: ExpressionNode | undefined
  /** 键或数组索引别名。 */
  key: ExpressionNode | undefined
  /** 对象遍历的数字索引别名。 */
  index: ExpressionNode | undefined
  /** 表达式是否已经过 `finalizeForParseResult` 的标识符处理。 */
  finalized: boolean
}

/** 把文本类模板节点包装成显式 `createTextVNode` 调用的转换节点。 */
export interface TextCallNode extends Node {
  /** 文本调用节点的判别值。 */
  type: NodeTypes.TEXT_CALL
  /** 被包装的原始文本、插值或复合文本。 */
  content: TextNode | InterpolationNode | CompoundExpressionNode
  /** `createTextVNode` 调用，或静态提升后的引用。 */
  codegenNode: CallExpression | SimpleExpressionNode // 提升后可直接引用常量。
}

/** 可作为单个 VNode 文本 children 的模板节点。 */
export type TemplateTextChildNode =
  TextNode | InterpolationNode | CompoundExpressionNode

/**
 * VNode 创建调用的中间表示。代码生成时根据 `isBlock`、`isComponent` 选择具体 helper。
 */
export interface VNodeCall extends Node {
  /** VNode 调用节点的判别值。 */
  type: NodeTypes.VNODE_CALL
  /** 标签字符串、运行时 helper，或动态组件解析调用。 */
  tag: string | symbol | CallExpression
  /** 属性对象、合并属性调用或已提升的属性引用。 */
  props: PropsExpression | undefined
  /** VNode 的文本、数组、插槽、列表或缓存 children。 */
  children:
    | TemplateChildNode[] // 多个 children。
    | TemplateTextChildNode // 单个文本 child。
    | SlotsExpression // 组件插槽对象。
    | ForRenderListExpression // v-for 列表调用。
    | SimpleExpressionNode // 已提升的 children 引用。
    | CacheExpression // 已缓存的 children。
    | undefined
  /** 运行时 diff 的位掩码提示；静态节点可不提供。 */
  patchFlag: PatchFlags | undefined
  /** 需要逐项比较的动态属性名数组，或其提升引用。 */
  dynamicProps: string | SimpleExpressionNode | undefined
  /** 包装该 VNode 的运行时指令参数。 */
  directives: DirectiveArguments | undefined
  /** 后续转换即使把它降为普通 VNode，是否仍必须参与 patch。 */
  needsPatch?: boolean
  /** 后续转换是否必须保留其 block 身份。 */
  isBlockRequired?: boolean
  /** 是否以 block 形式生成，以收集动态子节点。 */
  isBlock: boolean
  /** 调用 `openBlock(true)` 禁用动态子节点追踪；稳定 Fragment 等场景会使用。 */
  disableTracking: boolean
  /** 是否为组件 VNode；决定使用通用还是 element 创建 helper。 */
  isComponent: boolean
}

// JS 代码生成节点 -------------------------------------------------------------

// 这些并非完整 ESTree/Babel AST，而是只覆盖 Vue 渲染函数所需语法的精简模型。

/** 客户端代码生成器可直接打印的表达式节点联合。 */
export type JSChildNode =
  | VNodeCall
  | CallExpression
  | ObjectExpression
  | ArrayExpression
  | ExpressionNode
  | FunctionExpression
  | ConditionalExpression
  | CacheExpression
  | AssignmentExpression
  | SequenceExpression

/** 普通函数/helper 调用表达式；callee 为 Symbol 时由 helperNameMap 解析名称。 */
export interface CallExpression extends Node {
  /** 调用表达式节点的判别值。 */
  type: NodeTypes.JS_CALL_EXPRESSION
  /** 可直接打印的函数名，或通过 helper 映射解析的 Symbol。 */
  callee: string | symbol
  /** 保持调用顺序的参数；允许嵌套模板和 SSR 节点。 */
  arguments: (
    | string
    | symbol
    | JSChildNode
    | SSRCodegenNode
    | TemplateChildNode
    | TemplateChildNode[]
  )[]
}

/** JS 对象字面量表达式。 */
export interface ObjectExpression extends Node {
  /** 对象表达式节点的判别值。 */
  type: NodeTypes.JS_OBJECT_EXPRESSION
  /** 对象属性列表，保持生成顺序。 */
  properties: Array<Property>
}

/** 对象字面量中的单个键值属性。 */
export interface Property extends Node {
  /** 对象属性节点的判别值。 */
  type: NodeTypes.JS_PROPERTY
  /** 静态键或动态计算键表达式。 */
  key: ExpressionNode
  /** 属性值对应的代码生成节点。 */
  value: JSChildNode
}

/** JS 数组字面量表达式。 */
export interface ArrayExpression extends Node {
  /** 数组表达式节点的判别值。 */
  type: NodeTypes.JS_ARRAY_EXPRESSION
  /** 数组元素；字符串元素已经是可直接打印的代码片段。 */
  elements: Array<string | Node>
}

/** 箭头函数/普通函数表达式，主要用于插槽、列表迭代器和事件处理器。 */
export interface FunctionExpression extends Node {
  /** 函数表达式节点的判别值。 */
  type: NodeTypes.JS_FUNCTION_EXPRESSION
  /** 无参数、单参数或参数列表；表达式节点可保留源码位置。 */
  params: ExpressionNode | string | (ExpressionNode | string)[] | undefined
  /** 表达式函数体的返回值。 */
  returns?: TemplateChildNode | TemplateChildNode[] | JSChildNode
  /** 需要语句控制流时使用的块函数体。 */
  body?: BlockStatement | IfStatement
  /** 代码生成时是否把函数体换行展开。 */
  newline: boolean
  /** 标记插槽函数；代码生成器据此添加 `withCtx()` 等插槽上下文包装。 */
  isSlot: boolean
  /**
   * 仅兼容构建使用：该插槽不应暴露到 Vue 2 的 `$scopedSlots` 实例属性。
   */
  isNonScopedSlot?: boolean
}

/** JS 三元条件表达式。 */
export interface ConditionalExpression extends Node {
  /** 条件表达式节点的判别值。 */
  type: NodeTypes.JS_CONDITIONAL_EXPRESSION
  /** 三元表达式的判断条件。 */
  test: JSChildNode
  /** 条件为真时的结果。 */
  consequent: JSChildNode
  /** 条件为假时的结果。 */
  alternate: JSChildNode
  /** 是否将分支换行打印，以保持复杂生成代码可读。 */
  newline: boolean
}

/**
 * 渲染缓存表达式，对应 `_cache[index] || (_cache[index] = value)` 一类输出。
 * `v-once`、缓存事件处理器和部分静态节点共用此节点。
 */
export interface CacheExpression extends Node {
  /** 缓存表达式节点的判别值。 */
  type: NodeTypes.JS_CACHE_EXPRESSION
  /** `_cache` 数组中的槽位编号。 */
  index: number
  /** 首次渲染时计算并写入缓存的值。 */
  value: JSChildNode
  /** 求值期间是否暂停响应式依赖追踪，主要供 `v-once` 使用。 */
  needPauseTracking: boolean
  /** 是否处于 `v-once` 子树内，影响 block 与缓存恢复逻辑。 */
  inVOnce: boolean
  /** 取出数组缓存时是否需要展开，以维持 children 数组形状。 */
  needArraySpread: boolean
}

/** `withMemo(deps, factory, _cache, index)` 调用的精确类型。 */
export interface MemoExpression extends CallExpression {
  /** `v-memo` 固定调用运行时 `withMemo` helper。 */
  callee: typeof WITH_MEMO
  /** 依赖、VNode 工厂、缓存数组和槽位编号。 */
  arguments: [ExpressionNode, MemoFactory, string, string]
}

/** `v-memo` 重新计算子树时调用的工厂函数。 */
interface MemoFactory extends FunctionExpression {
  /** 依赖变化后重新创建的 block 节点。 */
  returns: BlockCodegenNode
}

// SSR 专用代码生成节点 ---------------------------------------------------------

/** SSR 代码生成器可打印的语句/模板字面量节点联合。 */
export type SSRCodegenNode =
  | BlockStatement
  | TemplateLiteral
  | IfStatement
  | AssignmentExpression
  | ReturnStatement
  | SequenceExpression

/** SSR 分支或函数体使用的 JS 语句块。 */
export interface BlockStatement extends Node {
  /** 语句块节点的判别值。 */
  type: NodeTypes.JS_BLOCK_STATEMENT
  /** 块中按执行顺序排列的表达式或嵌套条件语句。 */
  body: (JSChildNode | IfStatement)[]
}

/**
 * SSR 输出模板字面量；静态字符串与动态表达式交错存放，最后打印成 `_push(`...`)`。
 */
export interface TemplateLiteral extends Node {
  /** 模板字面量节点的判别值。 */
  type: NodeTypes.JS_TEMPLATE_LITERAL
  /** 静态字符串与动态表达式交错组成的模板片段。 */
  elements: (string | JSChildNode)[]
}

/** SSR 代码中的 `if / else if / else` 语句。 */
export interface IfStatement extends Node {
  /** 条件语句节点的判别值。 */
  type: NodeTypes.JS_IF_STATEMENT
  /** `if` 或 `else if` 的条件。 */
  test: ExpressionNode
  /** 条件命中时执行的语句块。 */
  consequent: BlockStatement
  /** 后续 `else if`、`else` 语句块或提前返回。 */
  alternate: IfStatement | BlockStatement | ReturnStatement | undefined
}

/** JS 赋值表达式，SSR 插槽与临时变量处理会使用。 */
export interface AssignmentExpression extends Node {
  /** 赋值表达式节点的判别值。 */
  type: NodeTypes.JS_ASSIGNMENT_EXPRESSION
  /** 被赋值的简单左值。 */
  left: SimpleExpressionNode
  /** 写入左值的表达式。 */
  right: JSChildNode
}

/** 逗号序列表达式，用于在一个表达式位置按顺序执行多个动作。 */
export interface SequenceExpression extends Node {
  /** 序列表达式节点的判别值。 */
  type: NodeTypes.JS_SEQUENCE_EXPRESSION
  /** 使用逗号连接并从左到右求值的表达式。 */
  expressions: JSChildNode[]
}

/** SSR 分支中的 return 语句。 */
export interface ReturnStatement extends Node {
  /** 返回语句节点的判别值。 */
  type: NodeTypes.JS_RETURN_STATEMENT
  /** 返回的模板子节点、节点数组或 JS 生成表达式。 */
  returns: TemplateChildNode | TemplateChildNode[] | JSChildNode
}

// 具有特定调用结构的代码生成节点 ---------------------------------------------

/** `withDirectives(vnode, directiveArgs)` 的指令参数列表。 */
export interface DirectiveArguments extends ArrayExpression {
  /** 当前 VNode 上全部运行时指令的参数数组。 */
  elements: DirectiveArgumentNode[]
}

/**
 * 单条运行时指令参数，按需包含 `[dir, exp, arg, modifiers]`；尾部缺省项不生成。
 */
export interface DirectiveArgumentNode extends ArrayExpression {
  /**
   * 按运行时协议依次保存指令、值、参数、修饰符；只保留到最后一个有意义参数。
   */
  elements:
    // 运行时指令、值表达式、参数、修饰符对象。
    | [string]
    | [string, ExpressionNode]
    | [string, ExpressionNode, ExpressionNode]
    | [string, ExpressionNode, ExpressionNode, ObjectExpression]
}

/** `renderSlot($slots, name, props, fallback, noSlotted, branchKey)` 调用。 */
export interface RenderSlotCall extends CallExpression {
  /** 插槽出口固定调用客户端 `renderSlot` helper。 */
  callee: typeof RENDER_SLOT
  /**
   * 参数依次为插槽集合、名称、props、fallback、slotted 开关和分支 key；
   * 后部参数按需省略，避免生成无意义的占位代码。
   */
  arguments:
    // 插槽集合、名称、props、回退函数、禁用 slotted 标记、分支 key。
    | [string, string | ExpressionNode]
    | [string, string | ExpressionNode, PropsExpression | '{}']
    | [
        string,
        string | ExpressionNode,
        PropsExpression | '{}',
        FunctionExpression | string,
      ]
    | [
        string,
        string | ExpressionNode,
        PropsExpression | '{}',
        FunctionExpression | string,
        string,
      ]
    | [
        string,
        string | ExpressionNode,
        PropsExpression | '{}',
        FunctionExpression | string,
        string,
        JSChildNode,
      ]
}

/** 静态插槽对象，或由 `createSlots` 合并的动态插槽表达式。 */
export type SlotsExpression = SlotsObjectExpression | DynamicSlotsExpression

/** 静态插槽对象，例如 `{ foo: () => [...] }`。 */
export interface SlotsObjectExpression extends ObjectExpression {
  /** 插槽名称到插槽函数的属性集合。 */
  properties: SlotsObjectProperty[]
}

/** 静态插槽对象中的属性，值被限定为插槽函数。 */
export interface SlotsObjectProperty extends Property {
  /** 插槽属性的值固定是由 `withCtx` 管理上下文的函数。 */
  value: SlotFunctionExpression
}

/** 返回模板子节点数组或缓存表达式的插槽函数。 */
export interface SlotFunctionExpression extends FunctionExpression {
  /** 插槽函数返回的 VNode 子节点，或已缓存的插槽结果。 */
  returns: TemplateChildNode[] | CacheExpression
}

/**
 * 动态插槽合并调用：
 * `createSlots({ ... }, [condition ? slot : undefined, renderList(...)])`。
 */
export interface DynamicSlotsExpression extends CallExpression {
  /** 动态插槽固定由 `createSlots` 合并到静态插槽对象。 */
  callee: typeof CREATE_SLOTS
  /** 第一个参数是基础插槽对象，第二个参数是条件/列表动态条目。 */
  arguments: [SlotsObjectExpression, DynamicSlotEntries]
}

/** 条件插槽和列表插槽组成的动态插槽条目数组。 */
export interface DynamicSlotEntries extends ArrayExpression {
  /** `v-if` 条件插槽和 `v-for` 列表插槽。 */
  elements: (ConditionalDynamicSlotNode | ListDynamicSlotNode)[]
}

/** 由 `v-if` / `v-else` 产生的一条条件动态插槽。 */
export interface ConditionalDynamicSlotNode extends ConditionalExpression {
  /** 条件成立时注册的插槽描述。 */
  consequent: DynamicSlotNode
  /** 条件失败时的另一插槽描述，或表示无插槽的 `undefined`。 */
  alternate: DynamicSlotNode | SimpleExpressionNode
}

/** 由插槽上的 `v-for` 产生的 `renderList` 调用。 */
export interface ListDynamicSlotNode extends CallExpression {
  /** 列表插槽固定调用 `renderList`。 */
  callee: typeof RENDER_LIST
  /** 循环数据源和生成单条插槽描述的迭代器。 */
  arguments: [ExpressionNode, ListDynamicSlotIterator]
}

/** 动态列表每次迭代返回一个 `{ name, fn }` 插槽描述。 */
export interface ListDynamicSlotIterator extends FunctionExpression {
  /** 每次迭代返回的 `{ name, fn }` 插槽描述。 */
  returns: DynamicSlotNode
}

/** 运行时动态插槽描述对象，固定包含名称和函数属性。 */
export interface DynamicSlotNode extends ObjectExpression {
  /** 固定为名称属性和函数属性；分支 key 可作为名称侧附加信息生成。 */
  properties: [Property, DynamicSlotFnProperty]
}

/** 动态插槽描述对象中的 `fn` 属性。 */
export interface DynamicSlotFnProperty extends Property {
  /** `fn` 属性值固定是插槽函数。 */
  value: SlotFunctionExpression
}

/** 可以作为控制流分支根 block 的代码生成节点。 */
export type BlockCodegenNode = VNodeCall | RenderSlotCall

/** `v-if` 递归三元表达式；每个分支最终返回 block 或 memo 节点。 */
export interface IfConditionalExpression extends ConditionalExpression {
  /** 条件命中时渲染的 block，或受 `v-memo` 控制的 block。 */
  consequent: BlockCodegenNode | MemoExpression
  /** 后续条件分支、最终 block 或 memo 结果。 */
  alternate: BlockCodegenNode | IfConditionalExpression | MemoExpression
}

/** `v-for` 固定生成的 Fragment block。 */
export interface ForCodegenNode extends VNodeCall {
  /** `v-for` 外层必须是 block，才能正确追踪每轮产生的动态节点。 */
  isBlock: true
  /** 循环结果用 Fragment 承载，而不是额外创建真实元素。 */
  tag: typeof FRAGMENT
  /** Fragment 默认没有 props。 */
  props: undefined
  /** children 固定为 `renderList` 的返回结果。 */
  children: ForRenderListExpression
  /** 根据 key 稳定性选择 keyed/unkeyed/stable Fragment 标志。 */
  patchFlag: PatchFlags
  /** 是否关闭 block 动态追踪，由列表稳定性决定。 */
  disableTracking: boolean
}

/** `renderList(source, iterator)` 的精确调用形状。 */
export interface ForRenderListExpression extends CallExpression {
  /** `v-for` 固定调用运行时 `renderList` helper。 */
  callee: typeof RENDER_LIST
  /** 循环数据源与逐项创建 VNode 的迭代器。 */
  arguments: [ExpressionNode, ForIteratorExpression]
}

/** `v-for` 迭代器函数，参数对应 value/key/index，返回当前迭代的 block。 */
export interface ForIteratorExpression extends FunctionExpression {
  /** 每轮迭代返回的 block；某些中间阶段尚未挂载，因此可缺省。 */
  returns?: BlockCodegenNode
}

// AST 工厂与辅助函数 ----------------------------------------------------------

/**
 * 无真实源码位置时复用的占位 location。
 * 条件/序列表达式等编译器合成节点不直接对应模板片段，容器节点也无需精确定位。
 */
export const locStub: SourceLocation = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 },
  source: '',
}

/** 创建模板根节点，并初始化 helper、提升项、缓存项等全局收集容器。 */
export function createRoot(
  children: TemplateChildNode[],
  source = '',
): RootNode {
  return {
    type: NodeTypes.ROOT,
    source,
    children,
    helpers: new Set(),
    components: [],
    directives: [],
    hoists: [],
    imports: [],
    cached: [],
    temps: 0,
    codegenNode: undefined,
    loc: locStub,
  }
}

/**
 * 创建 VNode 调用节点，并同步登记代码生成需要导入的运行时 helper。
 *
 * block 节点需要 `openBlock` 加对应的 createBlock helper；普通节点只需 createVNode。
 * 原生元素可使用体积更小的 element 版本，组件与 SSR 则统一使用通用版本。
 */
export function createVNodeCall(
  context: TransformContext | null,
  tag: VNodeCall['tag'],
  props?: VNodeCall['props'],
  children?: VNodeCall['children'],
  patchFlag?: VNodeCall['patchFlag'],
  dynamicProps?: VNodeCall['dynamicProps'],
  directives?: VNodeCall['directives'],
  isBlock: VNodeCall['isBlock'] = false,
  disableTracking: VNodeCall['disableTracking'] = false,
  isComponent: VNodeCall['isComponent'] = false,
  loc: SourceLocation = locStub,
): VNodeCall {
  if (context) {
    if (isBlock) {
      context.helper(OPEN_BLOCK)
      context.helper(getVNodeBlockHelper(context.inSSR, isComponent))
    } else {
      context.helper(getVNodeHelper(context.inSSR, isComponent))
    }
    if (directives) {
      context.helper(WITH_DIRECTIVES)
    }
  }

  // 工厂只描述调用，不立即生成字符串；后续转换仍可修改 patchFlag、children 或 block 身份。
  return {
    type: NodeTypes.VNODE_CALL,
    tag,
    props,
    children,
    patchFlag,
    dynamicProps,
    directives,
    isBlock,
    disableTracking,
    isComponent,
    loc,
  }
}

/** 创建精简 JS 数组字面量节点。 */
export function createArrayExpression(
  elements: ArrayExpression['elements'],
  loc: SourceLocation = locStub,
): ArrayExpression {
  return {
    type: NodeTypes.JS_ARRAY_EXPRESSION,
    loc,
    elements,
  }
}

/** 创建精简 JS 对象字面量节点。 */
export function createObjectExpression(
  properties: ObjectExpression['properties'],
  loc: SourceLocation = locStub,
): ObjectExpression {
  return {
    type: NodeTypes.JS_OBJECT_EXPRESSION,
    loc,
    properties,
  }
}

/** 创建对象属性；字符串 key 会自动包装为静态简单表达式。 */
export function createObjectProperty(
  key: Property['key'] | string,
  value: Property['value'],
): Property {
  return {
    type: NodeTypes.JS_PROPERTY,
    loc: locStub,
    key: isString(key) ? createSimpleExpression(key, true) : key,
    value,
  }
}

/**
 * 创建简单表达式。静态表达式天然达到 `CAN_STRINGIFY`，因为内容由编译器确认不会变。
 */
export function createSimpleExpression(
  content: SimpleExpressionNode['content'],
  isStatic: SimpleExpressionNode['isStatic'] = false,
  loc: SourceLocation = locStub,
  constType: ConstantTypes = ConstantTypes.NOT_CONSTANT,
): SimpleExpressionNode {
  return {
    type: NodeTypes.SIMPLE_EXPRESSION,
    loc,
    content,
    isStatic,
    constType: isStatic ? ConstantTypes.CAN_STRINGIFY : constType,
  }
}

/** 创建插值节点；字符串内容会自动包装为动态简单表达式。 */
export function createInterpolation(
  content: InterpolationNode['content'] | string,
  loc: SourceLocation,
): InterpolationNode {
  return {
    type: NodeTypes.INTERPOLATION,
    loc,
    content: isString(content)
      ? createSimpleExpression(content, false, loc)
      : content,
  }
}

/** 创建由字符串、helper 和子节点交错组成的复合表达式。 */
export function createCompoundExpression(
  children: CompoundExpressionNode['children'],
  loc: SourceLocation = locStub,
): CompoundExpressionNode {
  return {
    type: NodeTypes.COMPOUND_EXPRESSION,
    loc,
    children,
  }
}

/** 根据 callee 推导通用调用或 `renderSlot` 专用调用类型。 */
type InferCodegenNodeType<T> = T extends typeof RENDER_SLOT
  ? RenderSlotCall
  : CallExpression

/** 创建函数/helper 调用节点。 */
export function createCallExpression<T extends CallExpression['callee']>(
  callee: T,
  args: CallExpression['arguments'] = [],
  loc: SourceLocation = locStub,
): InferCodegenNodeType<T> {
  return {
    type: NodeTypes.JS_CALL_EXPRESSION,
    loc,
    callee,
    arguments: args,
  } as InferCodegenNodeType<T>
}

/** 创建函数表达式；`isSlot` 会影响代码生成时的上下文包装。 */
export function createFunctionExpression(
  params: FunctionExpression['params'],
  returns: FunctionExpression['returns'] = undefined,
  newline: boolean = false,
  isSlot: boolean = false,
  loc: SourceLocation = locStub,
): FunctionExpression {
  return {
    type: NodeTypes.JS_FUNCTION_EXPRESSION,
    params,
    returns,
    newline,
    isSlot,
    loc,
  }
}

/** 创建三元条件表达式；`newline` 控制生成代码是否为分支换行。 */
export function createConditionalExpression(
  test: ConditionalExpression['test'],
  consequent: ConditionalExpression['consequent'],
  alternate: ConditionalExpression['alternate'],
  newline = true,
): ConditionalExpression {
  return {
    type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
    test,
    consequent,
    alternate,
    newline,
    loc: locStub,
  }
}

/**
 * 创建 `_cache[index]` 缓存表达式。
 * `needPauseTracking` 用于 `v-once` 缓存 block 时避免错误收集动态子节点。
 */
export function createCacheExpression(
  index: number,
  value: JSChildNode,
  needPauseTracking: boolean = false,
  inVOnce: boolean = false,
): CacheExpression {
  return {
    type: NodeTypes.JS_CACHE_EXPRESSION,
    index,
    value,
    needPauseTracking: needPauseTracking,
    inVOnce,
    needArraySpread: false,
    loc: locStub,
  }
}

/** 创建 SSR/函数体语句块。 */
export function createBlockStatement(
  body: BlockStatement['body'],
): BlockStatement {
  return {
    type: NodeTypes.JS_BLOCK_STATEMENT,
    body,
    loc: locStub,
  }
}

/** 创建 SSR 输出模板字面量。 */
export function createTemplateLiteral(
  elements: TemplateLiteral['elements'],
): TemplateLiteral {
  return {
    type: NodeTypes.JS_TEMPLATE_LITERAL,
    elements,
    loc: locStub,
  }
}

/** 创建 SSR if 语句。 */
export function createIfStatement(
  test: IfStatement['test'],
  consequent: IfStatement['consequent'],
  alternate?: IfStatement['alternate'],
): IfStatement {
  return {
    type: NodeTypes.JS_IF_STATEMENT,
    test,
    consequent,
    alternate,
    loc: locStub,
  }
}

/** 创建赋值表达式。 */
export function createAssignmentExpression(
  left: AssignmentExpression['left'],
  right: AssignmentExpression['right'],
): AssignmentExpression {
  return {
    type: NodeTypes.JS_ASSIGNMENT_EXPRESSION,
    left,
    right,
    loc: locStub,
  }
}

/** 创建逗号序列表达式。 */
export function createSequenceExpression(
  expressions: SequenceExpression['expressions'],
): SequenceExpression {
  return {
    type: NodeTypes.JS_SEQUENCE_EXPRESSION,
    expressions,
    loc: locStub,
  }
}

/** 创建 return 语句。 */
export function createReturnStatement(
  returns: ReturnStatement['returns'],
): ReturnStatement {
  return {
    type: NodeTypes.JS_RETURN_STATEMENT,
    returns,
    loc: locStub,
  }
}

/** 按 SSR/组件语义选择通用或原生元素 createVNode helper。 */
export function getVNodeHelper(
  ssr: boolean,
  isComponent: boolean,
): typeof CREATE_VNODE | typeof CREATE_ELEMENT_VNODE {
  return ssr || isComponent ? CREATE_VNODE : CREATE_ELEMENT_VNODE
}

/** 按 SSR/组件语义选择通用或原生元素 createBlock helper。 */
export function getVNodeBlockHelper(
  ssr: boolean,
  isComponent: boolean,
): typeof CREATE_BLOCK | typeof CREATE_ELEMENT_BLOCK {
  return ssr || isComponent ? CREATE_BLOCK : CREATE_ELEMENT_BLOCK
}

/**
 * 把已有普通 VNodeCall 原地升级为 block，并维护 helper 引用计数。
 * 这保证最终只导入实际使用的 createVNode/createBlock 版本。
 */
export function convertToBlock(
  node: VNodeCall,
  { helper, removeHelper, inSSR }: TransformContext,
): void {
  if (!node.isBlock) {
    node.isBlock = true
    removeHelper(getVNodeHelper(inSSR, node.isComponent))
    helper(OPEN_BLOCK)
    helper(getVNodeBlockHelper(inSSR, node.isComponent))
  }
}
