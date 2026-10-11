import type { CodegenOptions } from './options'
import {
  type ArrayExpression,
  type AssignmentExpression,
  type CacheExpression,
  type CallExpression,
  type CommentNode,
  type CompoundExpressionNode,
  type ConditionalExpression,
  type ExpressionNode,
  type FunctionExpression,
  type IfStatement,
  type InterpolationNode,
  type JSChildNode,
  NodeTypes,
  type ObjectExpression,
  type Position,
  type ReturnStatement,
  type RootNode,
  type SSRCodegenNode,
  type SequenceExpression,
  type SimpleExpressionNode,
  type TemplateChildNode,
  type TemplateLiteral,
  type TextNode,
  type VNodeCall,
  getVNodeBlockHelper,
  getVNodeHelper,
  locStub,
} from './ast'
import { SourceMapGenerator } from 'source-map-js'
import {
  advancePositionWithMutation,
  assert,
  isSimpleIdentifier,
  toValidAssetId,
} from './utils'
import {
  PatchFlagNames,
  type PatchFlags,
  isArray,
  isString,
  isSymbol,
} from '@vue/shared'
import {
  CREATE_COMMENT,
  CREATE_ELEMENT_VNODE,
  CREATE_STATIC,
  CREATE_TEXT,
  CREATE_VNODE,
  OPEN_BLOCK,
  RESOLVE_COMPONENT,
  RESOLVE_DIRECTIVE,
  RESOLVE_FILTER,
  SET_BLOCK_TRACKING,
  TO_DISPLAY_STRING,
  WITH_CTX,
  WITH_DIRECTIVES,
  helperNameMap,
} from './runtimeHelpers'
import type { ImportItem } from './transform'

/**
 * compiler-core 实际使用的 source-map-js 生成器接口。
 *
 * 上游类型缺少 `toJSON()`，而这里为性能还会直接访问 `_names` / `_mappings`。
 * TS 5.3 起若直接暴露其类型，d.ts 生成会带入无法解析的 source-map-js 三斜线引用；
 * 因而在本包内内联最小接口，既修正声明产物，也避免把内部依赖类型泄漏给用户。
 */
export interface CodegenSourceMapGenerator {
  /** 登记源文件的完整内容，调试器才能展示模板源码。 */
  setSourceContent(sourceFile: string, sourceContent: string): void
  /** 上游运行时存在但类型声明遗漏的方法。 */
  toJSON(): RawSourceMap
  /** source-map-js 内部收集的源文件名集合。 */
  _sources: Set<string>
  /** source-map-js 内部收集的符号名称集合。 */
  _names: Set<string>
  /** source-map-js 内部的增量映射容器。 */
  _mappings: {
    /** 添加一条生成位置到原模板位置的映射。 */
    add(mapping: MappingItem): void
  }
}

/** 可序列化的 Source Map v3 数据结构。 */
export interface RawSourceMap {
  /** 生成文件名；Vue 编译器通常不填，由打包器决定。 */
  file?: string
  /** 所有源文件的公共根路径。 */
  sourceRoot?: string
  /** Source Map 规范版本，当前固定为 3。 */
  version: string
  /** 映射涉及的模板源文件列表。 */
  sources: string[]
  /** 映射引用的原始符号名称列表。 */
  names: string[]
  /** 与 `sources` 对齐的模板源码内容。 */
  sourcesContent?: string[]
  /** VLQ 编码后的行列映射字符串。 */
  mappings: string
}

/** 生成代码位置到模板源码位置的一条原始映射。 */
interface MappingItem {
  /** 原始模板文件名。 */
  source: string
  /** 生成代码中的行号，从 1 开始。 */
  generatedLine: number
  /** 生成代码中的列号，从 0 开始。 */
  generatedColumn: number
  /** 原模板中的行号，从 1 开始。 */
  originalLine: number
  /** 原模板中的列号，从 0 开始。 */
  originalColumn: number
  /** 可选原始符号名；无对应标识符时为 null。 */
  name: string | null
}

/** 提示 Rollup/Terser：随后调用无副作用，未使用时可以 tree-shake。 */
const PURE_ANNOTATION = `/*@__PURE__*/`

/** 把 helper Symbol 格式化为对象解构别名，例如 `openBlock: _openBlock`。 */
const aliasHelper = (s: symbol) => `${helperNameMap[s]}: _${helperNameMap[s]}`

/** 代码生成器可接受的模板、客户端 JS 和 SSR 节点联合。 */
type CodegenNode = TemplateChildNode | JSChildNode | SSRCodegenNode

/** 一次代码生成的最终产物。 */
export interface CodegenResult {
  /** 完整渲染函数模块或函数体代码。 */
  code: string
  /** setup 内联模式单独返回的 import/提升声明。 */
  preamble: string
  /** 已转换、用于生成代码的 AST。 */
  ast: RootNode
  /** 开启 sourceMap 后生成的 Source Map v3。 */
  map?: RawSourceMap
}

/** 告诉 `push` 新字符串中的换行分布，避免每次都扫描整个字符串。 */
enum NewlineType {
  /** 唯一换行位于字符串开头。 */
  Start = 0,
  /** 唯一换行位于字符串末尾。 */
  End = -1,
  /** 字符串不含换行。 */
  None = -2,
  /** 可能有任意多个换行，必须完整扫描。 */
  Unknown = -3,
}

/**
 * 代码生成期间的输出缓冲和位置状态。
 * `push` 是唯一写入入口；code 总会追加，行列/offset 仅在非浏览器且启用 source map 时累计。
 * 各 gen* 函数只拼语法结构，不在未启用映射时额外扫描字符串来维护位置。
 */
export interface CodegenContext extends Omit<
  Required<CodegenOptions>,
  'bindingMetadata' | 'inline'
> {
  /** 原模板源码。 */
  source: string
  /** 已生成代码缓冲。 */
  code: string
  /** 当前生成位置，行列从 1 开始、offset 从 0 开始。 */
  line: number
  /** 当前生成代码列号，从 1 开始。 */
  column: number
  /** 当前生成代码的 UTF-16 字符偏移，从 0 开始。 */
  offset: number
  /** 当前两空格缩进层级。 */
  indentLevel: number
  /** 是否处于静态提升声明；此时调用前输出 PURE 标注。 */
  pure: boolean
  /** 可选 source map 生成器。 */
  map?: CodegenSourceMapGenerator
  /** 把 helper Symbol 转成生成代码中的局部别名。 */
  helper(key: symbol): string
  /** 追加代码，并可记录其换行信息及来源 AST 节点。 */
  push(code: string, newlineIndex?: number, node?: CodegenNode): void
  /** 增加缩进并换行。 */
  indent(): void
  /** 减少缩进，可选择不立即换行。 */
  deindent(withoutNewLine?: boolean): void
  /** 按当前缩进换行。 */
  newline(): void
}

/** 合并代码生成选项，建立输出缓冲、source map 和格式化方法。 */
function createCodegenContext(
  ast: RootNode,
  {
    mode = 'function',
    prefixIdentifiers = mode === 'module',
    sourceMap = false,
    filename = `template.vue.html`,
    scopeId = null,
    optimizeImports = false,
    runtimeGlobalName = `Vue`,
    runtimeModuleName = `vue`,
    ssrRuntimeModuleName = 'vue/server-renderer',
    ssr = false,
    isTS = false,
    inSSR = false,
  }: CodegenOptions,
): CodegenContext {
  const context: CodegenContext = {
    mode,
    prefixIdentifiers,
    sourceMap,
    filename,
    scopeId,
    optimizeImports,
    runtimeGlobalName,
    runtimeModuleName,
    ssrRuntimeModuleName,
    ssr,
    isTS,
    inSSR,
    source: ast.source,
    code: ``,
    column: 1,
    line: 1,
    offset: 0,
    indentLevel: 0,
    pure: false,
    map: undefined,
    /** 把 helper Symbol 转为渲染函数中的下划线别名。 */
    helper(key) {
      return `_${helperNameMap[key]}`
    },
    /** 追加生成代码；仅启用 map 时计算位置和起止映射，newlineIndex 是该路径的换行提示。 */
    push(code, newlineIndex = NewlineType.None, node) {
      context.code += code
      if (!__BROWSER__ && context.map) {
        if (node) {
          let name
          if (node.type === NodeTypes.SIMPLE_EXPRESSION && !node.isStatic) {
            const content = node.content.replace(/^_ctx\./, '')
            if (content !== node.content && isSimpleIdentifier(content)) {
              name = content
            }
          }
          if (node.loc.source) {
            addMapping(node.loc.start, name)
          }
        }
        if (newlineIndex === NewlineType.Unknown) {
          // 换行位置未知，完整扫描并更新行列。
          advancePositionWithMutation(context, code)
        } else {
          // 已知换行分布时走快速路径，避免重复扫描生成字符串。
          context.offset += code.length
          if (newlineIndex === NewlineType.None) {
            // 无换行，仅增加列和 offset。
            if (__TEST__ && code.includes('\n')) {
              throw new Error(
                `CodegenContext.push() called newlineIndex: none, but contains` +
                  `newlines: ${code.replace(/\n/g, '\\n')}`,
              )
            }
            context.column += code.length
          } else {
            // 单换行；End 是调用方使用的末尾哨兵，先换算成真实索引。
            if (newlineIndex === NewlineType.End) {
              newlineIndex = code.length - 1
            }
            if (
              __TEST__ &&
              (code.charAt(newlineIndex) !== '\n' ||
                code.slice(0, newlineIndex).includes('\n') ||
                code.slice(newlineIndex + 1).includes('\n'))
            ) {
              throw new Error(
                `CodegenContext.push() called with newlineIndex: ${newlineIndex} ` +
                  `but does not conform: ${code.replace(/\n/g, '\\n')}`,
              )
            }
            context.line++
            context.column = code.length - newlineIndex
          }
        }
        if (node && node.loc !== locStub && node.loc.source) {
          addMapping(node.loc.end)
        }
      }
    },
    /** 增加一级缩进并换行。 */
    indent() {
      newline(++context.indentLevel)
    },
    /** 减少一级缩进，默认立即换行到新层级。 */
    deindent(withoutNewLine = false) {
      if (withoutNewLine) {
        --context.indentLevel
      } else {
        newline(--context.indentLevel)
      }
    },
    /** 按当前缩进层级追加换行。 */
    newline() {
      newline(context.indentLevel)
    },
  }

  /** 追加换行和指定层级缩进。 */
  function newline(n: number) {
    context.push('\n' + `  `.repeat(n), NewlineType.Start)
  }

  /**
   * 追加单条 source map 映射。
   * 直接写内部集合可绕开 source-map-js `addMapping()` 的参数标准化和校验；
   * 此处数据均由编译器构造，已满足约束，热路径无需重复检查。
   */
  function addMapping(loc: Position, name: string | null = null) {
    const { _names, _mappings } = context.map!
    if (name !== null && !_names.has(name)) _names.add(name)
    _mappings.add({
      originalLine: loc.line,
      originalColumn: loc.column - 1, // source map 列号从 0 开始。
      generatedLine: context.line,
      generatedColumn: context.column - 1,
      source: filename,
      name,
    })
  }

  if (!__BROWSER__ && sourceMap) {
    // 浏览器运行时编译不生成 source map，条件分支让相关实现可被 tree-shake。
    context.map =
      new SourceMapGenerator() as unknown as CodegenSourceMapGenerator
    context.map.setSourceContent(filename, context.source)
    context.map._sources.add(filename)
  }

  return context
}

/**
 * 把完成 transform 的 RootNode 打印为渲染函数代码。
 *
 * 根据 mode 生成 ESM 模块或供 `new Function` 执行的函数工厂；随后依次输出 helper 序言、
 * 资源解析、临时变量和根 codegenNode。setup 内联模式把 import/提升声明分离到 preamble，
 * 让调用方把箭头渲染函数嵌回 setup 作用域。
 * ast.helpers 与各 codegenNode 须由转换器预先补齐；打印器不会重新扫描调用来收集 helper。
 * 返回原 AST 引用。inline 模式的 preamble 使用独立缓冲，其映射不拼入主体 map。
 */
export function generate(
  ast: RootNode,
  options: CodegenOptions & {
    /** 测试/上层编译器可在正式生成前观察或微调已创建的上下文。 */
    onContextCreated?: (context: CodegenContext) => void
  } = {},
): CodegenResult {
  const context = createCodegenContext(ast, options)
  if (options.onContextCreated) options.onContextCreated(context)
  const {
    mode,
    push,
    prefixIdentifiers,
    indent,
    deindent,
    newline,
    scopeId,
    ssr,
  } = context

  const helpers = Array.from(ast.helpers)
  const hasHelpers = helpers.length > 0
  const useWithBlock = !prefixIdentifiers && mode !== 'module'
  const genScopeId = !__BROWSER__ && scopeId != null && mode === 'module'
  const isSetupInlined = !__BROWSER__ && !!options.inline

  // setup 内联模式用独立上下文生成序言并单独返回，主体 context 只保留箭头函数。
  const preambleContext = isSetupInlined
    ? createCodegenContext(ast, options)
    : context
  if (!__BROWSER__ && mode === 'module') {
    genModulePreamble(ast, preambleContext, genScopeId, isSetupInlined)
  } else {
    genFunctionPreamble(ast, preambleContext)
  }
  // SSR 与客户端渲染函数使用不同名称和固定参数协议。
  const functionName = ssr ? `ssrRender` : `render`
  const args = ssr ? ['_ctx', '_push', '_parent', '_attrs'] : ['_ctx', '_cache']
  if (!__BROWSER__ && options.bindingMetadata && !options.inline) {
    // 非内联 SFC 可通过额外参数直接访问四类绑定，减少 `_ctx` 代理查找。
    args.push('$props', '$setup', '$data', '$options')
  }
  const signature =
    !__BROWSER__ && options.isTS
      ? args.map(arg => `${arg}: any`).join(',')
      : args.join(', ')

  if (isSetupInlined) {
    push(`(${signature}) => {`)
  } else {
    push(`function ${functionName}(${signature}) {`)
  }
  indent()

  if (useWithBlock) {
    push(`with (_ctx) {`)
    indent()
    // with 模式的 helper 解构放在 with 内，且统一加 `_`，避免与模板上下文属性冲突。
    if (hasHelpers) {
      push(
        `const { ${helpers.map(aliasHelper).join(', ')} } = _Vue\n`,
        NewlineType.End,
      )
      newline()
    }
  }

  // 在函数顶部解析组件/指令/兼容过滤器，渲染表达式只引用稳定局部变量。
  if (ast.components.length) {
    genAssets(ast.components, 'component', context)
    if (ast.directives.length || ast.temps > 0) {
      newline()
    }
  }
  if (ast.directives.length) {
    genAssets(ast.directives, 'directive', context)
    if (ast.temps > 0) {
      newline()
    }
  }
  if (__COMPAT__ && ast.filters && ast.filters.length) {
    newline()
    genAssets(ast.filters, 'filter', context)
    newline()
  }

  if (ast.temps > 0) {
    push(`let `)
    for (let i = 0; i < ast.temps; i++) {
      push(`${i > 0 ? `, ` : ``}_temp${i}`)
    }
  }
  if (ast.components.length || ast.directives.length || ast.temps) {
    push(`\n`, NewlineType.Start)
    newline()
  }

  // 客户端函数返回 VNode 树；SSR codegenNode 自身包含 `_push` 语句，不加 return。
  if (!ssr) {
    push(`return `)
  }
  if (ast.codegenNode) {
    genNode(ast.codegenNode, context)
  } else {
    push(`null`)
  }

  if (useWithBlock) {
    deindent()
    push(`}`)
  }

  deindent()
  push(`}`)

  return {
    ast,
    code: context.code,
    preamble: isSetupInlined ? preambleContext.code : ``,
    map: context.map ? context.map.toJSON() : undefined,
  }
}

/**
 * 生成 function 模式序言：获取 Vue/SSR helper、输出提升常量，并返回 render 函数。
 */
function genFunctionPreamble(ast: RootNode, context: CodegenContext) {
  const {
    ssr,
    prefixIdentifiers,
    push,
    newline,
    runtimeModuleName,
    runtimeGlobalName,
    ssrRuntimeModuleName,
  } = context
  const VueBinding =
    !__BROWSER__ && ssr
      ? `require(${JSON.stringify(runtimeModuleName)})`
      : runtimeGlobalName
  // 前缀模式可在顶层一次性解构 helper；with 模式则把普通 helper 放入 with 块，
  // 避免代理作用域为每次 helper 访问执行 `has` 检查。
  const helpers = Array.from(ast.helpers)
  if (helpers.length > 0) {
    if (!__BROWSER__ && prefixIdentifiers) {
      push(
        `const { ${helpers.map(aliasHelper).join(', ')} } = ${VueBinding}\n`,
        NewlineType.End,
      )
    } else {
      // 先把全局 Vue 保存为保留局部名，避免模板属性 `Vue` 遮蔽它。
      push(`const _Vue = ${VueBinding}\n`, NewlineType.End)
      // 提升常量位于 render/with 外，无法看到 with 内 helper；在存在 hoists 时，将固定
      // VNode helper 列表与整棵 ast.helpers 取交集再解构到顶层，并未扫描每个 hoist 的实际调用。
      if (ast.hoists.length) {
        const staticHelpers = [
          CREATE_VNODE,
          CREATE_ELEMENT_VNODE,
          CREATE_COMMENT,
          CREATE_TEXT,
          CREATE_STATIC,
        ]
          .filter(helper => helpers.includes(helper))
          .map(aliasHelper)
          .join(', ')
        push(`const { ${staticHelpers} } = _Vue\n`, NewlineType.End)
      }
    }
  }
  // SSR helper 来自 vue/server-renderer，与客户端 runtime helper 分开解构。
  if (!__BROWSER__ && ast.ssrHelpers && ast.ssrHelpers.length) {
    // SSR 始终启用 prefixIdentifiers，不存在 with 作用域分支。
    push(
      `const { ${ast.ssrHelpers
        .map(aliasHelper)
        .join(', ')} } = require("${ssrRuntimeModuleName}")\n`,
      NewlineType.End,
    )
  }
  genHoists(ast.hoists, context)
  newline()
  push(`return `)
}

/**
 * 生成 module 模式序言：ESM 导入 runtime helper、自定义 import、提升常量和 export 关键字。
 * inline 时不输出 export；genScopeId 保留在签名中，当前不再为提升元素生成旧 scopeId 包装。
 */
function genModulePreamble(
  ast: RootNode,
  context: CodegenContext,
  genScopeId: boolean,
  inline?: boolean,
) {
  const {
    push,
    newline,
    optimizeImports,
    runtimeModuleName,
    ssrRuntimeModuleName,
  } = context

  // 只导入 AST 收集到的 helper，保持生成模块可 tree-shake。
  if (ast.helpers.size) {
    const helpers = Array.from(ast.helpers)
    if (optimizeImports) {
      // webpack 代码分割场景中，直接调用 import binding 可能被包装成 `Object(a.b)` 或
      // `(0, a.b)`，每个调用都增加体积和开销。这里付出每组件约 50B 固定别名成本，
      // 换取模板内所有 helper 调用保持短小。
      push(
        `import { ${helpers
          .map(s => helperNameMap[s])
          .join(', ')} } from ${JSON.stringify(runtimeModuleName)}\n`,
        NewlineType.End,
      )
      push(
        `\n// Binding optimization for webpack code-split\nconst ${helpers
          .map(s => `_${helperNameMap[s]} = ${helperNameMap[s]}`)
          .join(', ')}\n`,
        NewlineType.End,
      )
    } else {
      push(
        `import { ${helpers
          .map(s => `${helperNameMap[s]} as _${helperNameMap[s]}`)
          .join(', ')} } from ${JSON.stringify(runtimeModuleName)}\n`,
        NewlineType.End,
      )
    }
  }

  if (ast.ssrHelpers && ast.ssrHelpers.length) {
    push(
      `import { ${ast.ssrHelpers
        .map(s => `${helperNameMap[s]} as _${helperNameMap[s]}`)
        .join(', ')} } from "${ssrRuntimeModuleName}"\n`,
      NewlineType.End,
    )
  }

  if (ast.imports.length) {
    genImports(ast.imports, context)
    newline()
  }

  genHoists(ast.hoists, context)
  newline()

  if (!inline) {
    push(`export `)
  }
}

/**
 * 为模板引用的组件、指令或 Vue 2 过滤器生成运行时解析常量。
 * 以 `__self` 结尾的组件名来自 SFC 文件名推断，向 resolveComponent 传 true 允许隐式自引用。
 */
function genAssets(
  assets: string[],
  type: 'component' | 'directive' | 'filter',
  { helper, push, newline, isTS }: CodegenContext,
) {
  const resolver = helper(
    __COMPAT__ && type === 'filter'
      ? RESOLVE_FILTER
      : type === 'component'
        ? RESOLVE_COMPONENT
        : RESOLVE_DIRECTIVE,
  )
  for (let i = 0; i < assets.length; i++) {
    let id = assets[i]
    // 该后缀仅是编译期标记，运行时解析时去掉。
    const maybeSelfReference = id.endsWith('__self')
    if (maybeSelfReference) {
      id = id.slice(0, -6)
    }
    push(
      `const ${toValidAssetId(id, type)} = ${resolver}(${JSON.stringify(id)}${
        maybeSelfReference ? `, true` : ``
      })${isTS ? `!` : ``}`,
    )
    if (i < assets.length - 1) {
      newline()
    }
  }
}

/** 输出 `_hoisted_n` 静态常量，并为其中纯 helper 调用添加 PURE 标注。 */
function genHoists(hoists: (JSChildNode | null)[], context: CodegenContext) {
  if (!hoists.length) {
    return
  }
  context.pure = true
  const { push, newline } = context
  newline()

  for (let i = 0; i < hoists.length; i++) {
    const exp = hoists[i]
    if (exp) {
      push(`const _hoisted_${i + 1} = `)
      genNode(exp, context)
      newline()
    }
  }

  context.pure = false
}

/** 输出转换插件登记的额外 import。 */
function genImports(importsOptions: ImportItem[], context: CodegenContext) {
  if (!importsOptions.length) {
    return
  }
  importsOptions.forEach(imports => {
    context.push(`import `)
    genNode(imports.exp, context)
    context.push(` from '${imports.path}'`)
    context.newline()
  })
}

/** 按节点种类判断是否可紧凑打印的文本类，不计算实际字符串长度。 */
function isText(n: string | CodegenNode) {
  return (
    isString(n) ||
    n.type === NodeTypes.SIMPLE_EXPRESSION ||
    n.type === NodeTypes.TEXT ||
    n.type === NodeTypes.INTERPOLATION ||
    n.type === NodeTypes.COMPOUND_EXPRESSION
  )
}

/**
 * 把节点列表打印成 JS 数组；超过三项必定多行，非浏览器或开发构建还会按复杂节点换行。
 * 浏览器生产构建省去复杂度分支，三项以内只采用紧凑外层布局。
 */
function genNodeListAsArray(
  nodes: (string | CodegenNode | TemplateChildNode[])[],
  context: CodegenContext,
) {
  const multilines =
    nodes.length > 3 ||
    ((!__BROWSER__ || __DEV__) && nodes.some(n => isArray(n) || !isText(n)))
  context.push(`[`)
  multilines && context.indent()
  genNodeList(nodes, context, multilines)
  multilines && context.deindent()
  context.push(`]`)
}

/**
 * 打印逗号分隔的节点列表。字符串被视为已经准备好的源码，数组则递归打印为数组字面量。
 */
function genNodeList(
  nodes: (string | symbol | CodegenNode | TemplateChildNode[])[],
  context: CodegenContext,
  multilines: boolean = false,
  comma: boolean = true,
) {
  const { push, newline } = context
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (isString(node)) {
      push(node, NewlineType.Unknown)
    } else if (isArray(node)) {
      genNodeListAsArray(node, context)
    } else {
      genNode(node, context)
    }
    if (i < nodes.length - 1) {
      if (multilines) {
        comma && push(',')
        newline()
      } else {
        comma && push(', ')
      }
    }
  }
}

/**
 * 所有 AST/代码生成节点的统一分派器。
 * 模板结构节点先跳转到 transform 阶段挂载的 `codegenNode`，精简 JS 节点再交给对应打印器。
 */
function genNode(node: CodegenNode | symbol | string, context: CodegenContext) {
  if (isString(node)) {
    context.push(node, NewlineType.Unknown)
    return
  }
  if (isSymbol(node)) {
    context.push(context.helper(node))
    return
  }
  switch (node.type) {
    case NodeTypes.ELEMENT:
    case NodeTypes.IF:
    case NodeTypes.FOR:
      __DEV__ &&
        assert(
          node.codegenNode != null,
          `Codegen node is missing for element/if/for node. ` +
            `Apply appropriate transforms first.`,
        )
      genNode(node.codegenNode!, context)
      break
    case NodeTypes.TEXT:
      genText(node, context)
      break
    case NodeTypes.SIMPLE_EXPRESSION:
      genExpression(node, context)
      break
    case NodeTypes.INTERPOLATION:
      genInterpolation(node, context)
      break
    case NodeTypes.TEXT_CALL:
      genNode(node.codegenNode, context)
      break
    case NodeTypes.COMPOUND_EXPRESSION:
      genCompoundExpression(node, context)
      break
    case NodeTypes.COMMENT:
      genComment(node, context)
      break
    case NodeTypes.VNODE_CALL:
      genVNodeCall(node, context)
      break

    case NodeTypes.JS_CALL_EXPRESSION:
      genCallExpression(node, context)
      break
    case NodeTypes.JS_OBJECT_EXPRESSION:
      genObjectExpression(node, context)
      break
    case NodeTypes.JS_ARRAY_EXPRESSION:
      genArrayExpression(node, context)
      break
    case NodeTypes.JS_FUNCTION_EXPRESSION:
      genFunctionExpression(node, context)
      break
    case NodeTypes.JS_CONDITIONAL_EXPRESSION:
      genConditionalExpression(node, context)
      break
    case NodeTypes.JS_CACHE_EXPRESSION:
      genCacheExpression(node, context)
      break
    case NodeTypes.JS_BLOCK_STATEMENT:
      genNodeList(node.body, context, true, false)
      break

    // SSR 专用语句节点不会进入浏览器编译器构建。
    case NodeTypes.JS_TEMPLATE_LITERAL:
      !__BROWSER__ && genTemplateLiteral(node, context)
      break
    case NodeTypes.JS_IF_STATEMENT:
      !__BROWSER__ && genIfStatement(node, context)
      break
    case NodeTypes.JS_ASSIGNMENT_EXPRESSION:
      !__BROWSER__ && genAssignmentExpression(node, context)
      break
    case NodeTypes.JS_SEQUENCE_EXPRESSION:
      !__BROWSER__ && genSequenceExpression(node, context)
      break
    case NodeTypes.JS_RETURN_STATEMENT:
      !__BROWSER__ && genReturnStatement(node, context)
      break

    /* v8 ignore start */
    case NodeTypes.IF_BRANCH:
      // IfBranch 只能由 IfNode 的 codegenNode 消费，不应直接输出。
      break
    default:
      if (__DEV__) {
        assert(false, `unhandled codegen node type: ${(node as any).type}`)
        // never 赋值让 TS 在新增 NodeTypes 后提醒这里补充分支。
        const exhaustiveCheck: never = node
        return exhaustiveCheck
      }
    /* v8 ignore stop */
  }
}

/** 打印 JSON 转义后的静态文本。 */
function genText(
  node: TextNode | SimpleExpressionNode,
  context: CodegenContext,
) {
  context.push(JSON.stringify(node.content), NewlineType.Unknown, node)
}

/** 静态表达式按字符串字面量打印，动态表达式按已转换源码原样打印。 */
function genExpression(node: SimpleExpressionNode, context: CodegenContext) {
  const { content, isStatic } = node
  context.push(
    isStatic ? JSON.stringify(content) : content,
    NewlineType.Unknown,
    node,
  )
}

/** 打印 `_toDisplayString(expression)` 插值调用。 */
function genInterpolation(node: InterpolationNode, context: CodegenContext) {
  const { push, helper, pure } = context
  if (pure) push(PURE_ANNOTATION)
  push(`${helper(TO_DISPLAY_STRING)}(`)
  genNode(node.content, context)
  push(`)`)
}

/** 顺序拼接复合表达式的字符串片段与子节点。 */
function genCompoundExpression(
  node: CompoundExpressionNode,
  context: CodegenContext,
) {
  for (let i = 0; i < node.children!.length; i++) {
    const child = node.children![i]
    if (isString(child)) {
      context.push(child, NewlineType.Unknown)
    } else {
      genNode(child, context)
    }
  }
}

/**
 * 打印对象属性 key：合法静态标识符不加引号，其他静态 key JSON 转义，动态 key 使用 `[]`。
 */
function genExpressionAsPropertyKey(
  node: ExpressionNode,
  context: CodegenContext,
) {
  const { push } = context
  if (node.type === NodeTypes.COMPOUND_EXPRESSION) {
    push(`[`)
    genCompoundExpression(node, context)
    push(`]`)
  } else if (node.isStatic) {
    // 合法标识符保持简短；连字符等 key 才需要引号。
    const text = isSimpleIdentifier(node.content)
      ? node.content
      : JSON.stringify(node.content)
    push(text, NewlineType.None, node)
  } else {
    push(`[${node.content}]`, NewlineType.Unknown, node)
  }
}

/** 打印注释 VNode 创建调用。 */
function genComment(node: CommentNode, context: CodegenContext) {
  const { push, helper, pure } = context
  if (pure) {
    push(PURE_ANNOTATION)
  }
  push(
    `${helper(CREATE_COMMENT)}(${JSON.stringify(node.content)})`,
    NewlineType.Unknown,
    node,
  )
}

/**
 * 打印 VNodeCall，组合 block、运行时指令、patchFlag 与 createVNode helper。
 * 开发构建把 patch flag 名称放入生成代码注释，便于在编译输出中直接理解优化路径。
 */
function genVNodeCall(node: VNodeCall, context: CodegenContext) {
  const { push, helper, pure } = context
  const {
    tag,
    props,
    children,
    patchFlag,
    dynamicProps,
    directives,
    isBlock,
    disableTracking,
    isComponent,
  } = node

  // patchFlag 是位掩码；开发版注释展开具体名称，生产版仅保留数字。
  let patchFlagString
  if (patchFlag) {
    if (__DEV__) {
      if (patchFlag < 0) {
        // 负数是互斥的特殊标记，如 CACHED / BAIL。
        patchFlagString = patchFlag + ` /* ${PatchFlagNames[patchFlag]} */`
      } else {
        // 正数可组合，逐位收集命中的标记名。
        const flagNames = Object.keys(PatchFlagNames)
          .map(Number)
          .filter(n => n > 0 && patchFlag & n)
          .map(n => PatchFlagNames[n as PatchFlags])
          .join(`, `)
        patchFlagString = patchFlag + ` /* ${flagNames} */`
      }
    } else {
      patchFlagString = String(patchFlag)
    }
  }

  if (directives) {
    push(helper(WITH_DIRECTIVES) + `(`)
  }
  if (isBlock) {
    push(`(${helper(OPEN_BLOCK)}(${disableTracking ? `true` : ``}), `)
  }
  if (pure) {
    push(PURE_ANNOTATION)
  }
  const callHelper: symbol = isBlock
    ? getVNodeBlockHelper(context.inSSR, isComponent)
    : getVNodeHelper(context.inSSR, isComponent)
  push(helper(callHelper) + `(`, NewlineType.None, node)
  genNodeList(
    genNullableArgs([tag, props, children, patchFlagString, dynamicProps]),
    context,
  )
  push(`)`)
  if (isBlock) {
    push(`)`)
  }
  if (directives) {
    push(`, `)
    genNode(directives, context)
    push(`)`)
  }
}

/**
 * 去掉调用参数尾部的空值，并把中间空槽补成 `null`，保持运行时参数位置。
 * 调用方传的是已准备好的代码片段/节点；尾部用 nullish 判断裁剪，中间按 truthy 判断补位。
 */
function genNullableArgs(args: any[]): CallExpression['arguments'] {
  let i = args.length
  while (i--) {
    if (args[i] != null) break
  }
  return args.slice(0, i + 1).map(arg => arg || `null`)
}

// JavaScript 精简 AST 打印器 --------------------------------------------------

/** 打印普通函数/helper 调用；提升上下文中的调用附带 PURE 标注。 */
function genCallExpression(node: CallExpression, context: CodegenContext) {
  const { push, helper, pure } = context
  const callee = isString(node.callee) ? node.callee : helper(node.callee)
  if (pure) {
    push(PURE_ANNOTATION)
  }
  push(callee + `(`, NewlineType.None, node)
  genNodeList(node.arguments, context)
  push(`)`)
}

/** 按复杂度选择单行或多行格式打印对象字面量。 */
function genObjectExpression(node: ObjectExpression, context: CodegenContext) {
  const { push, indent, deindent, newline } = context
  const { properties } = node
  if (!properties.length) {
    push(`{}`, NewlineType.None, node)
    return
  }
  const multilines =
    properties.length > 1 ||
    ((!__BROWSER__ || __DEV__) &&
      properties.some(p => p.value.type !== NodeTypes.SIMPLE_EXPRESSION))
  push(multilines ? `{` : `{ `)
  multilines && indent()
  for (let i = 0; i < properties.length; i++) {
    const { key, value } = properties[i]
    // 属性名和值分别使用专用打印器，动态 key 会自动添加方括号。
    genExpressionAsPropertyKey(key, context)
    push(`: `)
    genNode(value, context)
    if (i < properties.length - 1) {
      // 多属性必定进入多行分支。
      push(`,`)
      newline()
    }
  }
  multilines && deindent()
  push(multilines ? `}` : ` }`)
}

/** 打印数组字面量。 */
function genArrayExpression(node: ArrayExpression, context: CodegenContext) {
  genNodeListAsArray(node.elements as CodegenNode[], context)
}

/**
 * 打印箭头函数；插槽函数额外包裹 `withCtx`，确保异步/子组件调用时恢复声明方渲染上下文。
 * returns 与 body 由转换器择一提供，二者同时存在时优先打印 returns；newline 控制显式 return 与换行块。
 */
function genFunctionExpression(
  node: FunctionExpression,
  context: CodegenContext,
) {
  const { push, indent, deindent } = context
  const { params, returns, body, newline, isSlot } = node
  if (isSlot) {
    // 插槽由子组件执行，但依赖父组件作用域，必须包装 owner context。
    push(`_${helperNameMap[WITH_CTX]}(`)
  }
  push(`(`, NewlineType.None, node)
  if (isArray(params)) {
    genNodeList(params, context)
  } else if (params) {
    genNode(params, context)
  }
  push(`) => `)
  if (newline || body) {
    push(`{`)
    indent()
  }
  if (returns) {
    if (newline) {
      push(`return `)
    }
    if (isArray(returns)) {
      genNodeListAsArray(returns, context)
    } else {
      genNode(returns, context)
    }
  } else if (body) {
    genNode(body, context)
  }
  if (newline || body) {
    deindent()
    push(`}`)
  }
  if (isSlot) {
    if (__COMPAT__ && node.isNonScopedSlot) {
      push(`, undefined, true`)
    }
    push(`)`)
  }
}

/** 打印三元表达式；嵌套 alternate 保持链式 `: condition ? ...` 缩进。 */
function genConditionalExpression(
  node: ConditionalExpression,
  context: CodegenContext,
) {
  const { test, consequent, alternate, newline: needNewline } = node
  const { push, indent, deindent, newline } = context
  if (test.type === NodeTypes.SIMPLE_EXPRESSION) {
    const needsParens = !isSimpleIdentifier(test.content)
    needsParens && push(`(`)
    genExpression(test, context)
    needsParens && push(`)`)
  } else {
    push(`(`)
    genNode(test, context)
    push(`)`)
  }
  needNewline && indent()
  context.indentLevel++
  needNewline || push(` `)
  push(`? `)
  genNode(consequent, context)
  context.indentLevel--
  needNewline && newline()
  needNewline || push(` `)
  push(`: `)
  const isNested = alternate.type === NodeTypes.JS_CONDITIONAL_EXPRESSION
  if (!isNested) {
    context.indentLevel++
  }
  genNode(alternate, context)
  if (!isNested) {
    context.indentLevel--
  }
  needNewline && deindent(true /* 不再换行 */)
}

/**
 * 打印 `_cache[index]` 缓存表达式。
 * needPauseTracking 为 true 时暂停 block tracking，赋值结果写入 cacheIndex 后恢复并返回缓存；
 * inVOnce 只控制暂停 helper 的第二个参数，不能把它与 needPauseTracking 混为同一开关。
 * needArraySpread 会在每次求值外层浅拷贝缓存数组，保留 VNode 复用并避免共享可被归一化改写的数组容器。
 */
function genCacheExpression(node: CacheExpression, context: CodegenContext) {
  const { push, helper, indent, deindent, newline } = context
  const { needPauseTracking, needArraySpread } = node
  if (needArraySpread) {
    push(`[...(`)
  }
  push(`_cache[${node.index}] || (`)
  if (needPauseTracking) {
    indent()
    push(`${helper(SET_BLOCK_TRACKING)}(-1`)
    if (node.inVOnce) push(`, true`)
    push(`),`)
    newline()
    push(`(`)
  }
  push(`_cache[${node.index}] = `)
  genNode(node.value, context)
  if (needPauseTracking) {
    push(`).cacheIndex = ${node.index},`)
    newline()
    push(`${helper(SET_BLOCK_TRACKING)}(1),`)
    newline()
    push(`_cache[${node.index}]`)
    deindent()
  }
  push(`)`)
  if (needArraySpread) {
    push(`)]`)
  }
}

/** 打印 SSR 模板字面量，并转义反引号、`${` 起始符和反斜杠。 */
function genTemplateLiteral(node: TemplateLiteral, context: CodegenContext) {
  const { push, indent, deindent } = context
  push('`')
  const l = node.elements.length
  const multilines = l > 3
  for (let i = 0; i < l; i++) {
    const e = node.elements[i]
    if (isString(e)) {
      push(e.replace(/(`|\$|\\)/g, '\\$1'), NewlineType.Unknown)
    } else {
      push('${')
      if (multilines) indent()
      genNode(e, context)
      if (multilines) deindent()
      push('}')
    }
  }
  push('`')
}

/** 打印 SSR `if / else if / else` 语句链。 */
function genIfStatement(node: IfStatement, context: CodegenContext) {
  const { push, indent, deindent } = context
  const { test, consequent, alternate } = node
  push(`if (`)
  genNode(test, context)
  push(`) {`)
  indent()
  genNode(consequent, context)
  deindent()
  push(`}`)
  if (alternate) {
    push(` else `)
    if (alternate.type === NodeTypes.JS_IF_STATEMENT) {
      genIfStatement(alternate, context)
    } else {
      push(`{`)
      indent()
      genNode(alternate, context)
      deindent()
      push(`}`)
    }
  }
}

/** 打印赋值表达式。 */
function genAssignmentExpression(
  node: AssignmentExpression,
  context: CodegenContext,
) {
  genNode(node.left, context)
  context.push(` = `)
  genNode(node.right, context)
}

/** 打印括号包裹的逗号序列表达式。 */
function genSequenceExpression(
  node: SequenceExpression,
  context: CodegenContext,
) {
  context.push(`(`)
  genNodeList(node.expressions, context)
  context.push(`)`)
}

/** 打印 return；数组返回值使用统一数组格式化规则。 */
function genReturnStatement(
  { returns }: ReturnStatement,
  context: CodegenContext,
) {
  context.push(`return `)
  if (isArray(returns)) {
    genNodeListAsArray(returns, context)
  } else {
    genNode(returns, context)
  }
}
