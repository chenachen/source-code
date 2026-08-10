import {
  type CompilerError,
  type ElementNode,
  NodeTypes,
  type ParserOptions,
  type RootNode,
  createRoot,
} from '@vue/compiler-core'
import * as CompilerDOM from '@vue/compiler-dom'

/** compileTemplate 可接受的最小模板解析器接口。 */
interface TemplateParser {
  /** 解析模板并返回未转换的根 AST。 */
  parse(template: string, options: ParserOptions): RootNode
}

/**
 * 为 compileScript 的模板使用分析取得未转换的 template AST。
 *
 * parse 阶段缓存的 AST 可能已被一次模板编译原位转换（`transformed=true`），再次用于
 * 标识符分析会看到结构节点和改写表达式。此时重新以 `parseMode: 'sfc'` 解析完整 SFC
 * 源码，既恢复干净 AST，又保持节点位置相对于 `.vue` 文件，而非 template 局部字符串。
 */
export function resolveTemplateAST(
  inAST: RootNode | undefined,
  options: {
    /** 客户端模板使用的自定义 parser。 */
    compiler?: TemplateParser
    /** 重新解析时沿用的 parser 配置。 */
    compilerOptions?: ParserOptions
    /** SSR 始终使用 compiler-dom parser，以维持 AST 约定。 */
    ssr?: boolean
    /** 接收重新解析过程中发现的模板错误。 */
    onError: (error: CompilerError) => void
  },
): RootNode | undefined {
  if (!inAST?.transformed) {
    return inAST
  }

  // SSR 的表达式/AST 约定仍以 compiler-dom parser 为基准；自定义 compiler 只用于客户端。
  const { compiler = CompilerDOM, compilerOptions, ssr, onError } = options
  const newAST = (ssr ? CompilerDOM : compiler).parse(inAST.source, {
    prefixIdentifiers: true,
    ...compilerOptions,
    parseMode: 'sfc',
    onError,
  })
  const template = newAST.children.find(
    node => node.type === NodeTypes.ELEMENT && node.tag === 'template',
  ) as ElementNode
  return createRoot(template.children, inAST.source)
}
