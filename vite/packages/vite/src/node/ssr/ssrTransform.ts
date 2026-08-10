import path from 'node:path'
import MagicString from 'magic-string'
import type { SourceMap } from 'rolldown'
import type { ESTree } from 'rolldown/utils'
import { extract_names as extractNames } from 'periscopic'
import { walk as eswalk } from 'estree-walker'
import type { RawSourceMap } from '@jridgewell/remapping'
import { parseAstAsync as rolldownParseAstAsync } from 'rolldown/parseAst'
import type { TransformResult } from '../server/transformRequest'
import {
  combineSourcemaps,
  generateCodeFrame,
  getFileStartIndex,
  isDefined,
  numberToPos,
} from '../utils'
import { isJSONRequest } from '../plugins/json'
import type { DefineImportMetadata } from '../../shared/ssrTransform'

/** 控制源码转换器针对不同模块格式采用的输出策略。 */
export interface ModuleRunnerTransformOptions {
  /** JSON 模块的专用转换选项。 */
  json?: {
    /** 是否使用 JSON 插件已经序列化的表达式，直接生成 default export。 */
    stringify?: boolean
  }
}

// 这些 key 是变换代码与 ModuleEvaluator 之间的调用协议：分别负责 exports、
// 静态/动态 import、export *、命名 live binding 与 import.meta。
export const ssrModuleExportsKey = `__vite_ssr_exports__`
/** runner 注入的静态模块加载函数名。 */
export const ssrImportKey = `__vite_ssr_import__`
/** runner 注入的动态模块加载函数名。 */
export const ssrDynamicImportKey = `__vite_ssr_dynamic_import__`
/** runner 注入的星号导出合并函数名。 */
export const ssrExportAllKey = `__vite_ssr_exportAll__`
/** runner 注入的 live export getter 注册函数名。 */
export const ssrExportNameKey = `__vite_ssr_exportName__`
/** runner 注入的 `import.meta` 替代对象名。 */
export const ssrImportMetaKey = `__vite_ssr_import_meta__`

/**
 * 把标准 ESM 模块转换成可由 ModuleRunner evaluator 包装执行的函数体协议。
 * JSON 走轻量 default export 改写；脚本执行 import 提升、live export 定义、
 * import binding 引用替换，并返回静态/动态依赖元数据。
 */
export async function ssrTransform(
  code: string,
  inMap:
    | SourceMap
    | {
        /** 空字符串表示上游明确禁用 sourcemap，而非没有 sourcemap。 */
        mappings: ''
      }
    | null,
  url: string,
  originalCode: string,
  options?: ModuleRunnerTransformOptions,
): Promise<TransformResult | null> {
  if (options?.json?.stringify && isJSONRequest(url)) {
    return ssrTransformJSON(code, inMap)
  }
  return ssrTransformScript(code, inMap, url, originalCode)
}

/** 把 JSON 插件生成的 default export 直接赋给 runner exports 对象。 */
function ssrTransformJSON(
  code: string,
  inMap:
    | SourceMap
    | {
        /** 保留上游“不要生成映射”的显式哨兵值。 */
        mappings: ''
      }
    | null,
): TransformResult {
  return {
    code: code.replace('export default', `${ssrModuleExportsKey}.default =`),
    map: inMap,
    deps: [],
    dynamicDeps: [],
    ssr: true,
  }
}

/**
 * 三阶段变换脚本：先提升 imports，再定义 exports，最后按词法作用域替换引用。
 * MagicString 保持源位置，最终 map 与上游插件 map 组合。
 */
async function ssrTransformScript(
  code: string,
  inMap:
    | SourceMap
    | {
        /** 空映射会原样透传，避免错误地产生新的 sourcemap。 */
        mappings: ''
      }
    | null,
  url: string,
  originalCode: string,
): Promise<TransformResult | null> {
  const s = new MagicString(code)

  let ast: ESTree.Program
  try {
    ast = await rolldownParseAstAsync(code)
  } catch (err) {
    // 给已知 Rolldown 解析错误补模块 id、行列与 code frame。
    // https://github.com/rollup/rollup/blob/42e587e0e37bc0661aa39fe7ad6f1d7fd33f825c/src/utils/bufferToAst.ts#L17-L22
    if (err.code === 'PARSE_ERROR') {
      err.message = `Parse failure: ${err.message}\n`
      err.id = url
      if (typeof err.pos === 'number') {
        err.loc = numberToPos(code, err.pos)
        err.loc.file = url
        err.frame = generateCodeFrame(code, err.pos)
        err.message += `At file: ${url}:${err.loc.line}:${err.loc.column}`
      } else {
        err.message += `At file: ${url}`
      }
    }
    throw err
  }

  let uid = 0
  const deps = new Set<string>()
  const dynamicDeps = new Set<string>()
  const idToImportMap = new Map<string, string>()
  const declaredConst = new Set<string>()

  const fileStartIndex = getFileStartIndex(code)
  let hoistIndex = fileStartIndex

  /** 生成 await runner import，按源码执行顺序提升，并记录 importedNames 元数据。 */
  function defineImport(
    index: number,
    importNode: (
      | ESTree.ImportDeclaration
      | (ESTree.ExportNamedDeclaration & {
          /** 再导出语句中必需的模块来源字面量。 */
          source: ESTree.StringLiteral
        })
      | ESTree.ExportAllDeclaration
    ) & {
      /** 导入或再导出语句在生成代码中的起始偏移。 */
      start: number
      /** 导入或再导出语句在生成代码中的结束偏移。 */
      end: number
    },
    metadata?: DefineImportMetadata,
  ) {
    const source = importNode.source.value
    deps.add(source)

    // importedNames 为空时省略 metadata 参数，缩小生成代码并走 evaluator 默认路径。
    const metadataArg =
      (metadata?.importedNames?.length ?? 0) > 0
        ? `, ${JSON.stringify(metadata)}`
        : ''

    const importId = `__vite_ssr_import_${uid++}__`
    const transformedImport = `const ${importId} = await ${ssrImportKey}(${JSON.stringify(
      source,
    )}${metadataArg});\n`

    s.update(importNode.start, importNode.end, transformedImport)

    if (importNode.start === index) {
      // import 已位于当前提升点，只推进 hoistIndex 以维持原执行顺序。
      hoistIndex = importNode.end
    } else {
      // re-export 等 import 可能位于后方；提升到顶部，避免引用先于 await import 执行。
      s.move(importNode.start, importNode.end, index)
    }

    return importId
  }

  /** 通过 getter 定义 export live binding，并兼容声明初始化前读取为 undefined。 */
  function defineExport(name: string, local = name) {
    // try/catch 保持旧行为：TDZ 或尚未初始化的声明暂时导出 undefined。
    s.appendLeft(
      fileStartIndex,
      `${ssrExportNameKey}(${JSON.stringify(name)}, () => { try { return ${local} } catch {} });\n`,
    )
  }

  const imports: (
    | ESTree.ImportDeclaration
    | ESTree.ExportNamedDeclaration
    | ESTree.ExportAllDeclaration
  )[] = []
  const exports: (
    | ESTree.ExportNamedDeclaration
    | ESTree.ExportDefaultDeclaration
    | ESTree.ExportAllDeclaration
  )[] = []
  const reExportImportIdMap = new Map<
    ESTree.ExportNamedDeclaration | ESTree.ExportAllDeclaration,
    string
  >()

  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      imports.push(node)
    } else if (node.type === 'ExportDefaultDeclaration') {
      exports.push(node)
    } else if (
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration'
    ) {
      imports.push(node)
      exports.push(node)
    }
  }

  // 阶段 1：提升全部 import，并建立本地标识符 → runner namespace 属性映射。
  for (const node of imports) {
    // re-export 的隐式 import 与普通 import 一起提升，保持模块依赖执行顺序。
    if (node.type === 'ExportNamedDeclaration') {
      if (node.source) {
        // `export { foo, bar } from './foo'` 同时是 import 与 export。
        const importId = defineImport(
          hoistIndex,
          node as ESTree.ExportNamedDeclaration & {
            /** 有 source 的命名再导出才能被提升为 runner import。 */
            source: ESTree.StringLiteral
          },
          {
            importedNames: node.specifiers.map((s) =>
              getIdentifierNameOrLiteralValue(s.local),
            ),
          },
        )
        reExportImportIdMap.set(node, importId)
      }
      continue
    }
    if (node.type === 'ExportAllDeclaration') {
      if (node.source) {
        // `export * from './foo'` 先取得依赖 namespace，阶段 2 再转发。
        const importId = defineImport(hoistIndex, node)
        reExportImportIdMap.set(node, importId)
      }
      continue
    }

    // default/named/namespace 分别映射到 namespace.default、namespace.name、namespace。
    const importId = defineImport(hoistIndex, node, {
      importedNames: node.specifiers
        .map((s) => {
          if (s.type === 'ImportSpecifier')
            return getIdentifierNameOrLiteralValue(s.imported)
          else if (s.type === 'ImportDefaultSpecifier') return 'default'
        })
        .filter(isDefined),
    })
    for (const spec of node.specifiers) {
      if (spec.type === 'ImportSpecifier') {
        if (spec.imported.type === 'Identifier') {
          idToImportMap.set(
            spec.local.name,
            `${importId}.${spec.imported.name}`,
          )
        } else {
          idToImportMap.set(
            spec.local.name,
            `${importId}[${JSON.stringify(spec.imported.value)}]`,
          )
        }
      } else if (spec.type === 'ImportDefaultSpecifier') {
        idToImportMap.set(spec.local.name, `${importId}.default`)
      } else {
        // namespace specifier 直接使用完整 runner namespace。
        idToImportMap.set(spec.local.name, importId)
      }
    }
  }

  // 阶段 2：移除 ESM export 语法，用 getter/runner helper 定义 live exports。
  for (const node of exports) {
    // 命名导出。
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) {
        if (
          node.declaration.type === 'FunctionDeclaration' ||
          node.declaration.type === 'ClassDeclaration'
        ) {
          // `export function/class`：保留声明，只去掉 export 并定义 getter。
          defineExport(node.declaration.id!.name)
        } else {
          const declaration = node.declaration as ESTree.VariableDeclaration
          // 变量声明可能是解构，一次提取全部绑定名。
          for (const decl of declaration.declarations) {
            const names = extractNames(decl.id as any)
            for (const name of names) {
              defineExport(name)
            }
          }
        }
        s.remove(node.start, node.declaration.start)
      } else {
        if (node.source) {
          // 从阶段 1 保存的 re-export namespace 读取属性。
          const importId = reExportImportIdMap.get(node)!
          for (const spec of node.specifiers) {
            const exportedAs = getIdentifierNameOrLiteralValue(spec.exported)

            if (spec.local.type === 'Identifier') {
              defineExport(exportedAs, `${importId}.${spec.local.name}`)
            } else {
              defineExport(
                exportedAs,
                `${importId}[${JSON.stringify(spec.local.value)}]`,
              )
            }
          }
        } else {
          s.remove(node.start, node.end)
          // 本地 export 列表本身删除，getter 指向导入映射或本地绑定。
          for (const spec of node.specifiers) {
            // 无 source 时 local 必为本地 Identifier；字符串名只可能出现在 from 形式。
            const local = (spec.local as ESTree.IdentifierReference).name
            const binding = idToImportMap.get(local)
            const exportedAs = getIdentifierNameOrLiteralValue(spec.exported)

            defineExport(exportedAs, binding || local)
          }
        }
      }
    }

    // default export。
    if (node.type === 'ExportDefaultDeclaration') {
      const expressionTypes = ['FunctionExpression', 'ClassExpression']
      if (
        'id' in node.declaration &&
        node.declaration.id &&
        !expressionTypes.includes(node.declaration.type)
      ) {
        // 有名函数/类保持可提升声明，仅移除 `export default` 前缀。
        const { name } = node.declaration.id
        s.remove(node.start, node.start + 15 /* 'export default '.length */)
        defineExport('default', name)
      } else {
        // 匿名或表达式 default 先绑定到内部 const，getter 再引用该绑定。
        const name = `__vite_ssr_export_default__`
        s.update(
          node.start,
          node.start + 14 /* 'export default'.length */,
          `const ${name} =`,
        )
        defineExport('default', name)
      }
    }

    // export * 交给 evaluator 合并 namespace；export * as name 则定义单个 getter。
    if (node.type === 'ExportAllDeclaration') {
      const importId = reExportImportIdMap.get(node)!
      if (node.exported) {
        const exportedAs = getIdentifierNameOrLiteralValue(node.exported)
        defineExport(exportedAs, `${importId}`)
      } else {
        s.appendLeft(node.end, `${ssrExportAllKey}(${importId});\n`)
      }
    }
  }

  // 阶段 3：按作用域把 import 绑定引用、import.meta 与动态 import 改成 runner 协议。
  walk(ast, {
    /** 修复变换后相邻顶层语句的自动分号插入边界。 */
    onStatements(statements) {
      // MagicString 移动/替换后保证相邻语句间有分号，避免 ASI 改变语义。
      for (let i = 0; i < statements.length - 1; i++) {
        const stmt = statements[i]
        if (
          code[stmt.end - 1] !== ';' &&
          stmt.type !== 'FunctionDeclaration' &&
          stmt.type !== 'ClassDeclaration' &&
          stmt.type !== 'BlockStatement' &&
          stmt.type !== 'ImportDeclaration'
        ) {
          s.appendLeft(stmt.end, ';')
        }
      }
    },
    /** 将未被局部作用域遮蔽的静态 import 引用替换为 namespace 读取。 */
    onIdentifier(id, parent, parentStack) {
      const binding = idToImportMap.get(id.name)
      if (!binding) {
        return
      }
      if (isStaticProperty(parent) && parent.shorthand) {
        // 对象简写引用 `{ foo }` 改为 `{ foo: namespace.foo }`；解构声明中的 key 跳过。
        if (
          !isNodeInPattern(parent) ||
          isInDestructuringAssignment(parent, parentStack)
        ) {
          s.appendLeft(id.end, `: ${binding}`)
        }
      } else if (
        parent.type === 'ClassDeclaration' &&
        id === parent.superClass
      ) {
        if (!declaredConst.has(id.name)) {
          declaredConst.add(id.name)
          // extends 需要稳定本地绑定；在包含 class 的顶层语句前声明一次 const。
          const topNode = parentStack[parentStack.length - 2]
          s.prependRight(topNode.start, `const ${id.name} = ${binding};\n`)
        }
      } else if (parent.type === 'CallExpression') {
        // `(0, namespace.fn)` 去掉属性调用隐含的 this，恢复 ESM 导入函数调用语义。
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Property_accessors#method_binding
        if (id === parent.callee && !parent.optional) {
          // V8 把括号 callee 的调用栈列锚到参数 `(`。替换范围吞入 callee 到首参数
          // 之间的文本，让 `(` 映回原 callee 起点，与 Node 报错列一致（#19625）。
          // optional call 自身就锚到 `(`，不使用此分支。
          const argsStart = parent.arguments.length
            ? parent.arguments[0].start
            : parent.end
          s.update(
            id.start,
            argsStart,
            `(0,${binding})${code.slice(id.end, argsStart)}`,
          )
        } else {
          s.update(id.start, id.end, binding)
          s.prependRight(id.start, `(0,`)
          s.appendLeft(id.end, `)`)
        }
      } else if (
        // class expression 自身名称属于内部作用域，不能替换成 import binding。
        !(parent.type === 'ClassExpression' && id === parent.id)
      ) {
        s.update(id.start, id.end, binding)
      }
    },
    /** 将 `import.meta` 替换成 evaluator 提供的元信息对象。 */
    onImportMeta(node) {
      s.update(node.start, node.end, ssrImportMetaKey)
    },
    /** 将动态 import 改写为 runner 协议并收集字面量依赖。 */
    onDynamicImport(node) {
      s.update(node.start, node.start + 6, ssrDynamicImportKey)
      if (node.type === 'ImportExpression' && node.source.type === 'Literal') {
        dynamicDeps.add(node.source.value as string)
      }
    },
  })

  let map: TransformResult['map']
  if (inMap?.mappings === '') {
    map = inMap
  } else {
    map = s.generateMap({ hires: 'boundary' }) as SourceMap
    map.sources = [path.basename(url)]
    // sourcesContent 使用最初源码；即使上游 map=null，当前 code 也可能已被插件变换。
    map.sourcesContent = [originalCode]
    if (
      inMap &&
      inMap.mappings &&
      'sources' in inMap &&
      inMap.sources.length > 0
    ) {
      map = combineSourcemaps(url, [
        map as RawSourceMap,
        inMap as RawSourceMap,
      ]) as SourceMap
    }
  }

  return {
    code: s.toString(),
    map,
    ssr: true,
    deps: [...deps],
    dynamicDeps: [...dynamicDeps],
  }
}

/** 统一读取标识符或字符串形式的模块导入/导出名。 */
function getIdentifierNameOrLiteralValue(node: ESTree.ModuleExportName) {
  return node.type === 'Identifier' ? node.name : node.value
}

/** walk 在完成作用域判定后回调给源码改写阶段的访问器集合。 */
interface Visitors {
  /** 接收一个确认是运行时引用且未被局部绑定遮蔽的标识符。 */
  onIdentifier: (
    node: ESTree.IdentifierReference,
    parent: ESTree.Node,
    parentStack: ESTree.Node[],
  ) => void
  /** 接收需要替换的 `import.meta` 节点。 */
  onImportMeta: (node: ESTree.Node) => void
  /** 接收需要改写的动态 import 节点。 */
  onDynamicImport: (node: ESTree.Node) => void
  /** 接收需要检查 ASI 边界的一组连续语句。 */
  onStatements: (statements: ESTree.Node[]) => void
}

/** 在通用 ESTree 节点上收窄出的对象属性节点。 */
type ESTreeProperty = ESTree.Node & {
  /** estree-walker 用于辨认普通对象属性的判别字段。 */
  type: 'Property'
}
/** 记录位于对象解构 pattern 中的 Property，供引用分类阶段查询。 */
const isNodeInPatternWeakSet = new WeakSet<ESTree.Node>()
/** 标记一个对象属性属于解构 pattern。 */
const setIsNodeInPattern = (node: ESTreeProperty) =>
  isNodeInPatternWeakSet.add(node)
/** 判断对象属性是否已经被遍历阶段标记为解构 pattern。 */
const isNodeInPattern = (node: ESTree.Node): node is ESTreeProperty =>
  isNodeInPatternWeakSet.has(node)

/**
 * 作用域遍历算法源自 `@vue/compiler-core` / `@vue/compiler-sfc`，这里适配 ESTree。
 * 它以 DFS 建作用域与父栈，再以 BFS 发出 identifier，保证提升声明先于引用判断。
 */
function walk(
  root: ESTree.Node,
  { onIdentifier, onImportMeta, onDynamicImport, onStatements }: Visitors,
) {
  const parentStack: ESTree.Node[] = []
  const varKindStack: ESTree.VariableDeclaration['kind'][] = []
  const scopeMap = new WeakMap<ESTree.Node, Set<string>>()
  const identifiers: [id: any, stack: ESTree.Node[]][] = []

  /** 把绑定名登记到创建它的函数或块节点上。 */
  const setScope = (node: ESTree.Node, name: string) => {
    let scopeIds = scopeMap.get(node)
    if (scopeIds && scopeIds.has(name)) {
      return
    }
    if (!scopeIds) {
      scopeIds = new Set()
      scopeMap.set(node, scopeIds)
    }
    scopeIds.add(name)
  }

  /** 沿当前父节点栈判断名称是否被任一局部作用域声明。 */
  function isInScope(name: string, parents: ESTree.Node[]) {
    return parents.some((node) => scopeMap.get(node)?.has(name))
  }
  /** 递归提取参数、变量或 catch 解构模式中的全部绑定名。 */
  function handlePattern(p: ESTree.ParamPattern, parentScope: ESTree.Node) {
    if (p.type === 'Identifier') {
      setScope(parentScope, p.name)
    } else if (p.type === 'RestElement') {
      handlePattern(p.argument, parentScope)
    } else if (p.type === 'ObjectPattern') {
      p.properties.forEach((property) => {
        if (property.type === 'RestElement') {
          setScope(
            parentScope,
            (property.argument as ESTree.IdentifierName).name,
          )
        } else {
          handlePattern(property.value, parentScope)
        }
      })
    } else if (p.type === 'ArrayPattern') {
      p.elements.forEach((element) => {
        if (element) {
          handlePattern(element, parentScope)
        }
      })
    } else if (p.type === 'AssignmentPattern') {
      handlePattern(p.left, parentScope)
    } else {
      setScope(parentScope, (p as any).name)
    }
  }

  ;(eswalk as any)(root, {
    /** DFS 进入节点时建立作用域、收集候选引用并触发特殊语法回调。 */
    enter(node: ESTree.Node, parent: ESTree.Node | null) {
      if (node.type === 'ImportDeclaration') {
        return this.skip()
      }

      // 对含多语句的节点先处理 ASI 边界。
      if (
        node.type === 'Program' ||
        node.type === 'BlockStatement' ||
        node.type === 'StaticBlock'
      ) {
        onStatements(node.body)
      } else if (node.type === 'SwitchCase') {
        onStatements(node.consequent)
      }

      // 父栈从最近到最远排列；某些语法子节点不继承父作用域，见 isSkippedParent。
      if (parent && !isSkippedParent(node, parent)) {
        parentStack.unshift(parent)
      }

      // 保存当前声明 kind，VariableDeclarator 需要据此把 var 提升到函数作用域。
      if (node.type === 'VariableDeclaration') {
        varKindStack.unshift(node.kind)
      }

      if (node.type === 'MetaProperty' && node.meta.name === 'import') {
        onImportMeta(node)
      } else if (node.type === 'ImportExpression') {
        onDynamicImport(node)
      }

      if (node.type === 'Identifier') {
        if (
          !isInScope(node.name, parentStack) &&
          isRefIdentifier(node, parent!, parentStack)
        ) {
          // DFS 阶段只记录候选；作用域全部建立后再按记录顺序发出。
          identifiers.push([node, parentStack.slice(0)])
        }
      } else if (isFunction(node)) {
        // 函数声明名可能遮蔽 import，登记到父作用域。
        if (node.type === 'FunctionDeclaration') {
          const parentScope = findParentScope(parentStack)
          if (parentScope) {
            setScope(parentScope, node.id!.name)
          }
        }
        // 有名函数表达式的名称只在自身作用域可见。
        if (node.type === 'FunctionExpression' && node.id) {
          setScope(node, node.id.name)
        }
        // 参数与解构绑定属于函数作用域，不能被替换成同名 import。
        node.params.forEach((p) => {
          if (p.type === 'ObjectPattern' || p.type === 'ArrayPattern') {
            handlePattern(p, node)
            return
          }
          ;(eswalk as any)(p.type === 'AssignmentPattern' ? p.left : p, {
            /** 遍历解构参数，只把真正的绑定 Identifier 登记进函数作用域。 */
            enter(child: ESTree.Node, parent: ESTree.Node | undefined) {
              // 解构参数的默认值是表达式，不是新绑定。
              if (
                parent?.type === 'AssignmentPattern' &&
                parent.right === child
              ) {
                return this.skip()
              }
              if (child.type !== 'Identifier') return
              // 静态属性 key 只是结构名称，不是变量绑定。
              if (isStaticPropertyKey(child, parent)) return
              // 模板/调用中的标识符属于默认值表达式，不登记为解构变量。
              if (
                (parent?.type === 'TemplateLiteral' &&
                  parent.expressions.includes(child as ESTree.Expression)) ||
                (parent?.type === 'CallExpression' && parent.callee === child)
              ) {
                return
              }
              setScope(node, child.name)
            },
          })
        })
      } else if (node.type === 'ClassDeclaration') {
        // class declaration 名称在父作用域遮蔽同名 import。
        const parentScope = findParentScope(parentStack)
        if (parentScope) {
          setScope(parentScope, node.id!.name)
        }
      } else if (node.type === 'ClassExpression' && node.id) {
        // class expression 名称只在 class 自身作用域可见。
        setScope(node, node.id.name)
      } else if (node.type === 'Property' && parent!.type === 'ObjectPattern') {
        // 标记对象解构属性，后续区分 `{ foo }` 是绑定还是对象简写引用。
        setIsNodeInPattern(node)
      } else if (node.type === 'VariableDeclarator') {
        const parentFunction = findParentScope(
          parentStack,
          varKindStack[0] === 'var',
        )
        if (parentFunction) {
          handlePattern(node.id, parentFunction)
        }
      } else if (node.type === 'CatchClause' && node.param) {
        handlePattern(node.param, node)
      }
    },

    /** DFS 离开节点时恢复与进入阶段对称维护的父栈和变量 kind 栈。 */
    leave(node: ESTree.Node, parent: ESTree.Node | null) {
      // 离开节点时对称弹出 enter 阶段记录的父级和声明 kind。
      if (parent && !isSkippedParent(node, parent)) {
        parentStack.shift()
      }

      if (node.type === 'VariableDeclaration') {
        varKindStack.shift()
      }
    },
  })

  // 所有提升声明已入 scopeMap 后再发出 identifier，避免先遇到引用就误替换。
  identifiers.forEach(([node, stack]) => {
    if (!isInScope(node.name, stack)) onIdentifier(node, stack[0], stack)
  })
}

/**
 * 判断 Identifier 是否是运行时值引用，而非声明名、静态 key、label、import/export
 * 语法位或特殊 arguments；只有值引用才可能替换为 import namespace 属性。
 */
function isRefIdentifier(
  id: ESTree.Node & {
    /** 将通用节点收窄为标识符节点的判别字段。 */
    type: 'Identifier'
  },
  parent: ESTree.Node,
  parentStack: ESTree.Node[],
) {
  // catch、变量和 class 声明 id 是新绑定。
  if (
    parent.type === 'CatchClause' ||
    ((parent.type === 'VariableDeclarator' ||
      parent.type === 'ClassDeclaration') &&
      parent.id === id)
  ) {
    return false
  }

  if (isFunction(parent)) {
    // 函数名称是绑定。
    if (parent.id === id) {
      return false
    }
    // 参数列表是绑定。
    if (
      parent.params.includes(
        id as Exclude<
          typeof id,
          ESTree.TSThisParameter | ESTree.TSIndexSignatureName
        >,
      )
    ) {
      return false
    }
  }

  // 非 computed class method 名不是值引用。
  if (parent.type === 'MethodDefinition' && !parent.computed) {
    return false
  }

  // 非 computed class property 仅 value 一侧可能是引用。
  if (parent.type === 'PropertyDefinition' && !parent.computed) {
    // key 除非 computed，否则只是名称。
    return parent.value === id
  }

  // 普通对象静态 key 不是引用。
  if (isStaticPropertyKey(id, parent)) {
    return false
  }

  // 对象解构的 value 是新绑定，不是 import 读取。
  if (isNodeInPattern(parent) && parent.value === id) {
    return false
  }

  // 数组解构声明中的项是绑定；解构赋值中的项才是现有引用。
  if (
    parent.type === 'ArrayPattern' &&
    !isInDestructuringAssignment(parent, parentStack)
  ) {
    return false
  }

  // `obj.foo` 的 foo 不是引用；`obj[foo]` 才是。
  if (
    parent.type === 'MemberExpression' &&
    parent.property === id &&
    !parent.computed
  ) {
    return false
  }

  // label 与 break/continue 目标不属于变量引用。
  if (
    (parent.type === 'LabeledStatement' ||
      parent.type === 'BreakStatement' ||
      parent.type === 'ContinueStatement') &&
    parent.label === id
  ) {
    return false
  }

  // import.meta 等 MetaProperty 由专门 visitor 处理。
  if (parent.type === 'MetaProperty') {
    return false
  }

  // re-export 语法中的 id 已在前两阶段处理。
  if (
    parent.type === 'ExportSpecifier' ||
    parent.type === 'ExportAllDeclaration'
  ) {
    return false
  }

  // arguments 是特殊运行时绑定，虽然 AST 表示为 Identifier，也不能改写。
  if (id.name === 'arguments') {
    return false
  }

  return true
}

/** 判断节点是不是 key 不参与求值的普通对象属性。 */
const isStaticProperty = (
  node: ESTree.Node,
): node is ESTree.Node & {
  /** 普通对象属性节点的判别字段。 */
  type: 'Property'
} => node.type === 'Property' && !node.computed

/** 判断标识符是否处在普通对象属性的静态 key 位置。 */
const isStaticPropertyKey = (
  node: ESTree.Node,
  parent: ESTree.Node | undefined,
) => parent && isStaticProperty(parent) && parent.key === node

/** 匹配 ESTree 及其 TS 扩展中的函数、方法节点类型。 */
const functionNodeTypeRE = /Function(?:Expression|Declaration)$|Method$/
/** walk 所认可的函数或方法节点联合类型。 */
type FunctionNodes = ESTree.Node & {
  /** 允许 JavaScript、TypeScript 函数表达式/声明以及各类方法节点。 */
  type:
    | `Function${'Expression' | 'Declaration'}`
    | `${string}Function${'Expression' | 'Declaration'}`
    | `${string}Method`
}
/**
 * 判断不应把 parent 当作包围作用域的子节点：
 *
 * - ESTree 把 else-if/else 嵌在 IfStatement 内，但分支不继承另一分支作用域；
 * - switch discriminant 在 case block 外求值，例如 `switch (x) { case 1: let x }`
 *   中第一个 x 仍是外层绑定。
 */
function isSkippedParent(node: ESTree.Node, parent: ESTree.Node) {
  return (
    (parent.type === 'IfStatement' && node === parent.alternate) ||
    (parent.type === 'SwitchStatement' && node === parent.discriminant)
  )
}

/** 用节点类型名识别各类函数/方法作用域。 */
function isFunction(node: ESTree.Node): node is FunctionNodes {
  return functionNodeTypeRE.test(node.type)
}

/** 匹配会为 let/const 创建词法作用域的块级节点类型。 */
const blockNodeTypeRE =
  /^BlockStatement$|^SwitchStatement$|^For(?:In|Of)?Statement$/
/** 识别 let/const 可见的块级作用域节点。 */
function isBlock(node: ESTree.Node) {
  return blockNodeTypeRE.test(node.type)
}

/** var 查找最近函数作用域，let/const 查找最近块作用域。 */
function findParentScope(
  parentStack: ESTree.Node[],
  isVar = false,
): ESTree.Node | undefined {
  return parentStack.find(isVar ? isFunction : isBlock)
}

/** 区分声明解构与对现有变量赋值的解构。 */
function isInDestructuringAssignment(
  parent: ESTree.Node,
  parentStack: ESTree.Node[],
): boolean {
  if (parent.type === 'Property' || parent.type === 'ArrayPattern') {
    return parentStack.some((i) => i.type === 'AssignmentExpression')
  }
  return false
}
