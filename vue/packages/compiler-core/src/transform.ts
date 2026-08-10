import type { TransformOptions } from './options'
import {
  type ArrayExpression,
  type CacheExpression,
  ConstantTypes,
  type DirectiveNode,
  type ElementNode,
  ElementTypes,
  type ExpressionNode,
  type JSChildNode,
  NodeTypes,
  type ParentNode,
  type Property,
  type RootNode,
  type SimpleExpressionNode,
  type TemplateChildNode,
  type TemplateLiteral,
  convertToBlock,
  createCacheExpression,
  createSimpleExpression,
  createVNodeCall,
} from './ast'
import {
  EMPTY_OBJ,
  NOOP,
  PatchFlags,
  camelize,
  capitalize,
  isArray,
  isString,
} from '@vue/shared'
import { defaultOnError, defaultOnWarn } from './errors'
import {
  CREATE_COMMENT,
  FRAGMENT,
  TO_DISPLAY_STRING,
  helperNameMap,
} from './runtimeHelpers'
import { isVSlot } from './utils'
import { cacheStatic, getSingleElementRoot } from './transforms/cacheStatic'
import type { CompilerCompatOptions } from './compat/compatConfig'

/**
 * 节点转换插件。
 *
 * 进入节点时执行，可原地修改、替换或移除当前节点；返回的函数会在所有子节点完成后
 * 逆序执行，适合依赖 children 转换结果来构建 `codegenNode`。这种“进入/退出”机制
 * 让转换过程只需一次深度优先遍历。
 */
export type NodeTransform = (
  node: RootNode | TemplateChildNode,
  context: TransformContext,
) => void | (() => void) | (() => void)[]

/**
 * 单条指令的转换插件，把原始指令转换为 VNode props，并可声明需要保留的运行时指令。
 */
export type DirectiveTransform = (
  dir: DirectiveNode,
  node: ElementNode,
  context: TransformContext,
  // 平台编译器可复用基础转换，并用 augmentor 对结果追加平台语义。
  augmentor?: (ret: DirectiveTransformResult) => DirectiveTransformResult,
) => DirectiveTransformResult

/** 指令转换结果：生成的 props、运行时指令 helper，以及 SSR 标签片段。 */
export interface DirectiveTransformResult {
  /** 指令转换后要合并到 VNode props 的属性。 */
  props: Property[]
  /** 是否仍需运行时指令；Symbol 表示具体 helper，`true` 表示按指令名解析。 */
  needRuntime?: boolean | symbol
  /** SSR 平台直接追加到开始标签模板字面量的片段。 */
  ssrTagParts?: TemplateLiteral['elements']
}

/**
 * 结构指令转换。它本质仍是节点转换，但会改变 AST 层级；目前仅 `v-if` 和 `v-for` 属于此类。
 */
export type StructuralDirectiveTransform = (
  node: ElementNode,
  dir: DirectiveNode,
  context: TransformContext,
) => void | (() => void)

/** 代码生成需要显式导入的表达式与来源模块。 */
export interface ImportItem {
  /** 导入后在生成代码中引用的标识符或表达式节点。 */
  exp: string | ExpressionNode
  /** ES module 导入来源。 */
  path: string
}

/**
 * 单次 AST 转换的共享上下文。
 *
 * 它同时保存只读编译选项、遍历游标、作用域计数和最终要汇总到 RootNode 的资源。
 * helper 使用引用计数而非 Set，因为后续转换可能把 VNode 从普通调用升级成 block，
 * 这时需要安全撤销旧 helper，不能误删其他节点仍在使用的同名 helper。
 */
export interface TransformContext
  extends
    Required<Omit<TransformOptions, keyof CompilerCompatOptions>>,
    CompilerCompatOptions {
  /** 由文件名推导的组件名，用于模板中的组件自递归。 */
  selfName: string | null
  /** 当前模板根节点。 */
  root: RootNode
  /** 运行时 helper 的引用次数。 */
  helpers: Map<symbol, number>
  /** 模板引用的用户组件名集合。 */
  components: Set<string>
  /** 模板引用的自定义指令名集合。 */
  directives: Set<string>
  /** 静态提升表达式，索引对应 `_hoisted_n`。 */
  hoists: (JSChildNode | null)[]
  /** 生成代码需要额外导入的项目。 */
  imports: ImportItem[]
  /** 代码生成所需临时变量数。 */
  temps: number
  /** 渲染缓存槽，索引对应 `_cache[n]`。 */
  cached: (CacheExpression | null)[]
  /** 当前模板局部标识符及其嵌套声明次数。 */
  identifiers: {
    /** 名称当前被多少层 v-for/v-slot/表达式函数参数声明。 */
    [name: string]: number | undefined
  }
  /** 各结构语法的嵌套深度，用于判断动态性和缓存安全性。 */
  scopes: {
    /** 当前 `v-for` 作用域嵌套层数。 */
    vFor: number
    /** 当前 `v-slot` 作用域嵌套层数。 */
    vSlot: number
    /** 当前 `v-pre` 区域嵌套层数。 */
    vPre: number
    /** 当前 `v-once` 子树嵌套层数。 */
    vOnce: number
  }
  /** 当前节点父级。 */
  parent: ParentNode | null
  // 实际转换最多只需访问祖父级，保存两个引用比维护完整 parent 栈更省。
  grandParent: ParentNode | null
  /** 当前节点在 parent.children 中的索引。 */
  childIndex: number
  /** 正在处理的节点；被移除时设为 null。 */
  currentNode: RootNode | TemplateChildNode | null
  /** 当前是否位于 `v-once` 子树。 */
  inVOnce: boolean
  /** 登记并返回运行时 helper Symbol。 */
  helper<T extends symbol>(name: T): T
  /** 撤销一次运行时 helper 引用。 */
  removeHelper<T extends symbol>(name: T): void
  /** 登记 helper 并返回代码中的 `_helperName`。 */
  helperString(name: symbol): string
  /** 替换当前节点，并同步 parent.children 与 currentNode。 */
  replaceNode(node: TemplateChildNode): void
  /** 移除当前节点或指定兄弟节点。 */
  removeNode(node?: TemplateChildNode): void
  /** 节点移除后的遍历索引修正钩子。 */
  onNodeRemoved(): void
  /** 把表达式声明的名字加入当前模板作用域。 */
  addIdentifiers(exp: ExpressionNode | string): void
  /** 离开作用域时移除表达式声明的名字。 */
  removeIdentifiers(exp: ExpressionNode | string): void
  /** 把表达式提升到根级 `_hoisted_n`，返回该常量的引用节点。 */
  hoist(exp: string | JSChildNode | ArrayExpression): SimpleExpressionNode
  /** 把表达式放入渲染缓存 `_cache[n]`。 */
  cache(exp: JSChildNode, isVNode?: boolean, inVOnce?: boolean): CacheExpression
  /** 静态程度分析缓存，避免重复递归同一模板节点。 */
  constantCache: WeakMap<TemplateChildNode, ConstantTypes>
  /** 记录含 key 的 v-for + v-memo 节点，供 block 优化保留正确行为。 */
  vForMemoKeyedNodes: WeakSet<ElementNode>

  /** Vue 2 兼容模式收集的过滤器名称。 */
  filters?: Set<string>
}

/**
 * 合并转换选项并初始化单次编译上下文。
 *
 * `filename` 会被规范成 PascalCase 自组件名；各集合在转换完成后复制到 RootNode，
 * 因而代码生成阶段不需要继续持有可变的遍历上下文。
 */
export function createTransformContext(
  root: RootNode,
  {
    filename = '',
    prefixIdentifiers = false,
    hoistStatic = false,
    hmr = false,
    cacheHandlers = false,
    nodeTransforms = [],
    directiveTransforms = {},
    transformHoist = null,
    isBuiltInComponent = NOOP,
    isCustomElement = NOOP,
    expressionPlugins = [],
    scopeId = null,
    slotted = true,
    ssr = false,
    inSSR = false,
    ssrCssVars = ``,
    bindingMetadata = EMPTY_OBJ,
    inline = false,
    isTS = false,
    onError = defaultOnError,
    onWarn = defaultOnWarn,
    compatConfig,
  }: TransformOptions,
): TransformContext {
  const nameMatch = filename.replace(/\?.*$/, '').match(/([^/\\]+)\.\w+$/)
  const context: TransformContext = {
    // 调用方选项及其默认值。
    filename,
    selfName: nameMatch && capitalize(camelize(nameMatch[1])),
    prefixIdentifiers,
    hoistStatic,
    hmr,
    cacheHandlers,
    nodeTransforms,
    directiveTransforms,
    transformHoist,
    isBuiltInComponent,
    isCustomElement,
    expressionPlugins,
    scopeId,
    slotted,
    ssr,
    inSSR,
    ssrCssVars,
    bindingMetadata,
    inline,
    isTS,
    onError,
    onWarn,
    compatConfig,

    // 遍历期间不断累积的状态。
    root,
    helpers: new Map(),
    components: new Set(),
    directives: new Set(),
    hoists: [],
    imports: [],
    cached: [],
    constantCache: new WeakMap(),
    vForMemoKeyedNodes: new WeakSet(),
    temps: 0,
    identifiers: Object.create(null),
    scopes: {
      vFor: 0,
      vSlot: 0,
      vPre: 0,
      vOnce: 0,
    },
    parent: null,
    grandParent: null,
    currentNode: root,
    childIndex: 0,
    inVOnce: false,

    /** 登记一次运行时 helper 引用并返回原 Symbol，便于直接嵌入 AST。 */
    helper(name) {
      const count = context.helpers.get(name) || 0
      context.helpers.set(name, count + 1)
      return name
    },
    /** 撤销一次 helper 引用；计数归零才从最终 import 集合删除。 */
    removeHelper(name) {
      const count = context.helpers.get(name)
      if (count) {
        const currentCount = count - 1
        if (!currentCount) {
          context.helpers.delete(name)
        } else {
          context.helpers.set(name, currentCount)
        }
      }
    },
    /** 登记 helper 并返回代码生成阶段使用的下划线局部名。 */
    helperString(name) {
      return `_${helperNameMap[context.helper(name)]}`
    },
    /** 用新节点替换当前节点，同时更新父 children 与遍历游标。 */
    replaceNode(node) {
      /* v8 ignore start */
      if (__DEV__) {
        if (!context.currentNode) {
          throw new Error(`Node being replaced is already removed.`)
        }
        if (!context.parent) {
          throw new Error(`Cannot replace root node.`)
        }
      }
      /* v8 ignore stop */
      context.parent!.children[context.childIndex] = context.currentNode = node
    },
    /** 移除当前节点或指定兄弟节点，并修正 children 遍历索引。 */
    removeNode(node) {
      /* v8 ignore next 3 */
      if (__DEV__ && !context.parent) {
        throw new Error(`Cannot remove root node.`)
      }
      const list = context.parent!.children
      const removalIndex = node
        ? list.indexOf(node)
        : context.currentNode
          ? context.childIndex
          : -1
      /* v8 ignore next 3 */
      if (__DEV__ && removalIndex < 0) {
        throw new Error(`node being removed is not a child of current parent`)
      }
      if (!node || node === context.currentNode) {
        // 当前节点被移除：停止它的剩余转换，并让 children 循环回退索引。
        context.currentNode = null
        context.onNodeRemoved()
      } else {
        // 移除当前节点之前的兄弟节点时，当前索引也要左移，避免跳过后继节点。
        if (context.childIndex > removalIndex) {
          context.childIndex--
          context.onNodeRemoved()
        }
      }
      context.parent!.children.splice(removalIndex, 1)
    },
    onNodeRemoved: NOOP,
    /** 把表达式声明的局部名加入作用域计数，防止被错误加 `_ctx.`。 */
    addIdentifiers(exp) {
      // 浏览器运行时编译依赖 with 作用域，不做标识符前缀化，也无需维护局部变量表。
      if (!__BROWSER__) {
        if (isString(exp)) {
          addId(exp)
        } else if (exp.identifiers) {
          exp.identifiers.forEach(addId)
        } else if (exp.type === NodeTypes.SIMPLE_EXPRESSION) {
          addId(exp.content)
        }
      }
    },
    /** 离开作用域时撤销表达式声明的局部名计数。 */
    removeIdentifiers(exp) {
      if (!__BROWSER__) {
        if (isString(exp)) {
          removeId(exp)
        } else if (exp.identifiers) {
          exp.identifiers.forEach(removeId)
        } else if (exp.type === NodeTypes.SIMPLE_EXPRESSION) {
          removeId(exp.content)
        }
      }
    },
    /** 登记静态提升表达式并返回 `_hoisted_n` 引用节点。 */
    hoist(exp) {
      if (isString(exp)) exp = createSimpleExpression(exp)
      context.hoists.push(exp)
      const identifier = createSimpleExpression(
        `_hoisted_${context.hoists.length}`,
        false,
        exp.loc,
        ConstantTypes.CAN_CACHE,
      )
      // 保留反向引用，静态程度分析可继续检查被提升节点，而非只看到 `_hoisted_n` 标识符。
      identifier.hoisted = exp
      return identifier
    },
    /** 为表达式分配下一个 `_cache[n]` 槽位并返回缓存节点。 */
    cache(exp, isVNode = false, inVOnce = false) {
      const cacheExp = createCacheExpression(
        context.cached.length,
        exp,
        isVNode,
        inVOnce,
      )
      context.cached.push(cacheExp)
      return cacheExp
    },
  }

  if (__COMPAT__) {
    context.filters = new Set()
  }

  /** 增加局部标识符的嵌套声明计数。 */
  function addId(id: string) {
    const { identifiers } = context
    if (identifiers[id] === undefined) {
      identifiers[id] = 0
    }
    identifiers[id]!++
  }

  // 使用计数而非布尔值，支持同名参数在嵌套 v-for / v-slot 中被遮蔽后正确恢复。
  function removeId(id: string) {
    context.identifiers[id]!--
  }

  return context
}

/**
 * 执行 AST 转换阶段，并把收集结果固化到根节点。
 *
 * 顺序为：深度优先运行插件 → 可选静态提升 → 为客户端创建根 codegenNode →
 * 汇总 helper/组件/指令/缓存元数据。SSR 自己在后续阶段创建根输出，故跳过客户端根节点。
 */
export function transform(root: RootNode, options: TransformOptions): void {
  const context = createTransformContext(root, options)
  traverseNode(root, context)
  if (options.hoistStatic) {
    cacheStatic(root, context)
  }
  if (!options.ssr) {
    createRootCodegen(root, context)
  }
  // 将可变上下文快照到 RootNode，供无上下文的代码生成阶段读取。
  root.helpers = new Set([...context.helpers.keys()])
  root.components = [...context.components]
  root.directives = [...context.directives]
  root.imports = context.imports
  root.hoists = context.hoists
  root.temps = context.temps
  root.cached = context.cached
  root.transformed = true

  if (__COMPAT__) {
    root.filters = [...context.filters!]
  }
}

/** 根据根 children 的形态选择单根节点、Fragment block 或空渲染结果。 */
function createRootCodegen(root: RootNode, context: TransformContext) {
  const { helper } = context
  const { children } = root
  if (children.length === 1) {
    const singleElementRootChild = getSingleElementRoot(root)
    // 单个元素根必须成为 block，运行时可直接追踪根的动态后代。
    if (singleElementRootChild && singleElementRootChild.codegenNode) {
      // 单元素根不会被静态提升，所以这里不可能得到 SimpleExpressionNode。
      const codegenNode = singleElementRootChild.codegenNode
      if (codegenNode.type === NodeTypes.VNODE_CALL) {
        convertToBlock(codegenNode, context)
      }
      root.codegenNode = codegenNode
    } else {
      // 单个 slot/if/for 已由各自转换建成 block；单文本根始终参与 patch，可直接交给 genNode。
      root.codegenNode = children[0]
    }
  } else if (children.length > 1) {
    // 多根模板用 Fragment block 包裹。
    let patchFlag = PatchFlags.STABLE_FRAGMENT
    // 开发环境中“一个有效根 + 若干注释”仍形成 Fragment。DEV_ROOT_FRAGMENT 告诉运行时
    // 透传 attrs/HMR 时把有效子节点视为真实根，解决开发版保留注释造成的行为差异。
    if (
      __DEV__ &&
      children.filter(c => c.type !== NodeTypes.COMMENT).length === 1
    ) {
      patchFlag |= PatchFlags.DEV_ROOT_FRAGMENT
    }
    root.codegenNode = createVNodeCall(
      context,
      helper(FRAGMENT),
      undefined,
      root.children,
      patchFlag,
      undefined,
      undefined,
      true,
      undefined,
      false /* Fragment 不是组件 */,
    )
  } else {
    // 空模板无需 codegenNode；代码生成器会返回 null。
  }
}

/** 按索引遍历父节点 children，并在转换删除节点时修正循环游标。 */
export function traverseChildren(
  parent: ParentNode,
  context: TransformContext,
): void {
  let i = 0
  /** 当前 child 被移除时让 for 游标回退，下一轮仍访问原后继节点。 */
  const nodeRemoved = () => {
    i--
  }
  for (; i < parent.children.length; i++) {
    const child = parent.children[i]
    if (isString(child)) continue
    context.grandParent = context.parent
    context.parent = parent
    context.childIndex = i
    context.onNodeRemoved = nodeRemoved
    traverseNode(child, context)
  }
}

/**
 * 深度优先遍历单个节点。
 *
 * 所有插件先执行进入阶段，再递归容器 children，最后以相反顺序执行退出回调。
 * 反序退出让先注册的高层转换在更晚时刻看到其他转换已完成的 codegenNode。
 */
export function traverseNode(
  node: RootNode | TemplateChildNode,
  context: TransformContext,
): void {
  context.currentNode = node
  // 运行每个节点转换，并收集离开节点时才执行的回调。
  const { nodeTransforms } = context
  const exitFns = []
  for (let i = 0; i < nodeTransforms.length; i++) {
    const onExit = nodeTransforms[i](node, context)
    if (onExit) {
      if (isArray(onExit)) {
        exitFns.push(...onExit)
      } else {
        exitFns.push(onExit)
      }
    }
    if (!context.currentNode) {
      // 节点已被插件删除，不能再递归或运行其退出回调。
      return
    } else {
      // 插件可能替换节点，后续插件与遍历必须使用新节点。
      node = context.currentNode
    }
  }

  switch (node.type) {
    case NodeTypes.COMMENT:
      if (!context.ssr) {
        // 客户端创建注释 VNode 需要引入 createCommentVNode。
        context.helper(CREATE_COMMENT)
      }
      break
    case NodeTypes.INTERPOLATION:
      // 插值没有模板子节点，但生成时要把任意值转成展示字符串。
      if (!context.ssr) {
        context.helper(TO_DISPLAY_STRING)
      }
      break

    // 容器节点继续向下遍历。
    case NodeTypes.IF:
      for (let i = 0; i < node.branches.length; i++) {
        traverseNode(node.branches[i], context)
      }
      break
    case NodeTypes.IF_BRANCH:
    case NodeTypes.FOR:
    case NodeTypes.ELEMENT:
    case NodeTypes.ROOT:
      traverseChildren(node, context)
      break
  }

  // 退出回调后进先出，模拟递归访问器的 leave 阶段。
  context.currentNode = node
  let i = exitFns.length
  while (i--) {
    exitFns[i]()
  }
}

/**
 * 把 `v-if`、`v-for` 一类结构指令转换器包装成普通 NodeTransform。
 *
 * 命中后先从元素 props 删除指令，再调用具体转换。提前删除很重要：具体转换经常会把
 * 原元素移动进新结构并再次遍历，若指令仍在会无限递归。`<template v-slot>` 的结构
 * 由插槽转换统一处理，故这里主动跳过。
 */
export function createStructuralDirectiveTransform(
  name: string | RegExp,
  fn: StructuralDirectiveTransform,
): NodeTransform {
  const matches = isString(name)
    ? (n: string) => n === name
    : (n: string) => name.test(n)

  return (node, context) => {
    if (node.type === NodeTypes.ELEMENT) {
      const { props } = node
      // `<template v-slot>` 由 vSlot.ts 管理作用域和动态插槽，不能在此拆结构。
      if (node.tagType === ElementTypes.TEMPLATE && props.some(isVSlot)) {
        return
      }
      const exitFns = []
      for (let i = 0; i < props.length; i++) {
        const prop = props[i]
        if (prop.type === NodeTypes.DIRECTIVE && matches(prop.name)) {
          // 先删指令，具体转换即使移动并重遍历当前元素也不会再次命中自身。
          props.splice(i, 1)
          i--
          const onExit = fn(node, prop, context)
          if (onExit) exitFns.push(onExit)
        }
      }
      return exitFns
    }
  }
}
