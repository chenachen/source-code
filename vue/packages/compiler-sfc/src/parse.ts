import {
  type BindingMetadata,
  type CodegenSourceMapGenerator,
  type CompilerError,
  type ElementNode,
  NodeTypes,
  type ParserOptions,
  type RawSourceMap,
  type RootNode,
  type SourceLocation,
  createRoot,
} from '@vue/compiler-core'
import * as CompilerDOM from '@vue/compiler-dom'
import { SourceMapGenerator } from 'source-map-js'
import type { TemplateCompiler } from './compileTemplate'
import { parseCssVars } from './style/cssVars'
import { createCache } from './cache'
import type { ImportBinding } from './compileScript'
import { isImportUsed } from './script/importUsageCheck'
import type { LRUCache } from 'lru-cache'
import { genCacheKey } from '@vue/shared'

/** 未提供文件名时用于诊断和 source map 的占位名称。 */
export const DEFAULT_FILENAME = 'anonymous.vue'

/** SFC 顶层解析选项。 */
export interface SFCParseOptions {
  /** 原始 `.vue` 文件名，用于错误与 source map。 */
  filename?: string
  /** 是否为各 block 生成映射回完整 SFC 的 source map，默认开启。 */
  sourceMap?: boolean
  /** 写入 source map 的源码根目录。 */
  sourceRoot?: string
  /** 是否在 block 内容前补齐原文件行/列，兼容依赖位置的旧工具。 */
  pad?: boolean | 'line' | 'space'
  /** 是否忽略没有有效内容且没有 src 的非 template block。 */
  ignoreEmpty?: boolean
  /** 自定义模板解析器。 */
  compiler?: TemplateCompiler
  /** 透传给模板 parser 的额外选项。 */
  templateParseOptions?: ParserOptions
}

/** `<template>/<script>/<style>` 与自定义块共享的描述结构。 */
export interface SFCBlock {
  /** 块标签名。 */
  type: string
  /** 标签内部的原始内容，不含开闭标签。 */
  content: string
  /** 静态属性表；无值属性记录为 true。 */
  attrs: Record<string, string | true>
  /** 内容在完整 SFC 源码中的位置。 */
  loc: SourceLocation
  /** block 内容到完整 SFC 的 source map。 */
  map?: RawSourceMap
  /** `lang` 属性值。 */
  lang?: string
  /** `src` 外部块路径。 */
  src?: string
}

/** template block，内联模板可额外保存初始 AST。 */
export interface SFCTemplateBlock extends SFCBlock {
  /** 将联合类型收窄为 template block。 */
  type: 'template'
  /** 使用默认 HTML 模板语法时在 parse 阶段预解析并缓存的 AST。 */
  ast?: RootNode
}

/** 普通 script 或 script setup block 及其后续编译元数据。 */
export interface SFCScriptBlock extends SFCBlock {
  /** 将联合类型收窄为 script block。 */
  type: 'script'
  /** `<script setup>` 的 setup 属性值；普通 script 不存在。 */
  setup?: string | boolean
  /** 脚本分析得到的模板可见绑定元数据。 */
  bindings?: BindingMetadata
  /** 用户导入的本地名称到导入来源及使用状态映射。 */
  imports?: Record<string, ImportBinding>
  /** 普通 `<script>` 的 Babel 语句 AST。 */
  scriptAst?: import('@babel/types').Statement[]
  /** `<script setup>` 的 Babel 语句 AST。 */
  scriptSetupAst?: import('@babel/types').Statement[]
  /** 脚本编译过程中收集的非致命警告。 */
  warnings?: string[]
  /** 宏类型解析实际读取的完整依赖路径（统一 `/`），供 Vite/vue-loader HMR 失效缓存。 */
  deps?: string[]
}

/** style block 的 scoped 与 CSS Modules 元数据。 */
export interface SFCStyleBlock extends SFCBlock {
  /** 将联合类型收窄为 style block。 */
  type: 'style'
  /** 是否声明 scoped 属性。 */
  scoped?: boolean
  /** CSS Modules 导出名；布尔 true 表示使用默认 `$style`。 */
  module?: string | boolean
}

/** 一份 `.vue` 文件解析后的完整结构描述。 */
export interface SFCDescriptor {
  /** SFC 文件名；默认值也用于缓存键和 source map。 */
  filename: string
  /** 完整 `.vue` 源码。 */
  source: string
  /** 唯一 template block；不存在时为 null。 */
  template: SFCTemplateBlock | null
  /** 唯一普通 script block；不存在时为 null。 */
  script: SFCScriptBlock | null
  /** 唯一 script setup block；不存在时为 null。 */
  scriptSetup: SFCScriptBlock | null
  /** 按源码顺序保存的全部 style blocks。 */
  styles: SFCStyleBlock[]
  /** 除 template/script/style 外的框架或工具自定义 blocks。 */
  customBlocks: SFCBlock[]
  /** 所有 style 中去重后的 CSS `v-bind()` 表达式。 */
  cssVars: string[]
  /** 是否使用 `:slotted()`，供模板编译器决定是否生成插槽 scopeId 处理。 */
  slotted: boolean

  /**
   * 比较旧 import 使用状态，决定模板 HMR 只需重新渲染还是必须重载组件模块。
   * 前提是新旧 script 已相同；这里只处理 TS script setup 中模板变化导致 import
   * 从“可裁剪”变为“需要保留”的特殊情况。
   */
  shouldForceReload: (prevImports: Record<string, ImportBinding>) => boolean
}

/** SFC 解析结果；结构错误会收集到 errors，而不是中断并抛出。 */
export interface SFCParseResult {
  /** 即使存在可恢复错误也尽量构造的 SFC 结构描述。 */
  descriptor: SFCDescriptor
  /** 重复 block、语法错误等解析诊断。 */
  errors: (CompilerError | SyntaxError)[]
}

/** 按源码和影响解析的选项共同键控的 SFC 解析缓存。 */
export const parseCache:
  Map<string, SFCParseResult> | LRUCache<string, SFCParseResult> =
  createCache<SFCParseResult>()

/**
 * 把完整 `.vue` 源码解析为 {@link SFCDescriptor}。
 *
 * 该阶段只切分顶层 block、记录属性和位置、生成 block source map，并提取 CSS v-bind；
 * script/template/style 的具体语言编译由各自 compile API 完成。可恢复的结构问题统一返回
 * 在 `errors` 中，方便 IDE 一次展示多个诊断。
 */
export function parse(
  source: string,
  options: SFCParseOptions = {},
): SFCParseResult {
  const sourceKey = genCacheKey(source, {
    ...options,
    compiler: { parse: options.compiler?.parse },
  })
  const cache = parseCache.get(sourceKey)
  if (cache) {
    return cache
  }

  const {
    sourceMap = true,
    filename = DEFAULT_FILENAME,
    sourceRoot = '',
    pad = false,
    ignoreEmpty = true,
    compiler = CompilerDOM,
    templateParseOptions = {},
  } = options

  const descriptor: SFCDescriptor = {
    filename,
    source,
    template: null,
    script: null,
    scriptSetup: null,
    styles: [],
    customBlocks: [],
    cssVars: [],
    slotted: false,
    shouldForceReload: prevImports => hmrShouldReload(prevImports, descriptor),
  }

  const errors: (CompilerError | SyntaxError)[] = []
  const ast = compiler.parse(source, {
    parseMode: 'sfc',
    prefixIdentifiers: true,
    ...templateParseOptions,
    onError: e => {
      errors.push(e)
    },
  })
  ast.children.forEach(node => {
    if (node.type !== NodeTypes.ELEMENT) {
      return
    }
    // 空的非 template block 没有编译价值；但含 src 的空块代表外部内容，必须保留。
    if (
      ignoreEmpty &&
      node.tag !== 'template' &&
      isEmpty(node) &&
      !hasSrc(node)
    ) {
      return
    }
    switch (node.tag) {
      case 'template':
        if (!descriptor.template) {
          const templateBlock = (descriptor.template = createBlock(
            node,
            source,
            false,
          ) as SFCTemplateBlock)

          if (!templateBlock.attrs.src) {
            templateBlock.ast = createRoot(node.children, source)
          }

          // Vue 3 函数组件不再依赖 `<template functional>`；定位到该属性给出迁移诊断。
          if (templateBlock.attrs.functional) {
            const err = new SyntaxError(
              `<template functional> is no longer supported in Vue 3, since ` +
                `functional components no longer have significant performance ` +
                `difference from stateful ones. Just use a normal <template> ` +
                `instead.`,
            ) as CompilerError
            err.loc = node.props.find(
              p => p.type === NodeTypes.ATTRIBUTE && p.name === 'functional',
            )!.loc
            errors.push(err)
          }
        } else {
          errors.push(createDuplicateBlockError(node))
        }
        break
      case 'script':
        const scriptBlock = createBlock(node, source, pad) as SFCScriptBlock
        const isSetup = !!scriptBlock.attrs.setup
        if (isSetup && !descriptor.scriptSetup) {
          descriptor.scriptSetup = scriptBlock
          break
        }
        if (!isSetup && !descriptor.script) {
          descriptor.script = scriptBlock
          break
        }
        errors.push(createDuplicateBlockError(node, isSetup))
        break
      case 'style':
        const styleBlock = createBlock(node, source, pad) as SFCStyleBlock
        if (styleBlock.attrs.vars) {
          errors.push(
            new SyntaxError(
              `<style vars> has been replaced by a new proposal: ` +
                `https://github.com/vuejs/rfcs/pull/231`,
            ),
          )
        }
        descriptor.styles.push(styleBlock)
        break
      default:
        descriptor.customBlocks.push(createBlock(node, source, pad))
        break
    }
  })
  if (!descriptor.template && !descriptor.script && !descriptor.scriptSetup) {
    errors.push(
      new SyntaxError(
        `At least one <template> or <script> is required in a single file component. ${descriptor.filename}`,
      ),
    )
  }
  if (descriptor.scriptSetup) {
    if (descriptor.scriptSetup.src) {
      errors.push(
        new SyntaxError(
          `<script setup> cannot use the "src" attribute because ` +
            `its syntax will be ambiguous outside of the component.`,
        ),
      )
      descriptor.scriptSetup = null
    }
    if (descriptor.script && descriptor.script.src) {
      errors.push(
        new SyntaxError(
          `<script> cannot use the "src" attribute when <script setup> is ` +
            `also present because they must be processed together.`,
        ),
      )
      descriptor.script = null
    }
  }

  // Pug/Jade 对公共缩进敏感。去掉 SFC 标签层级带来的缩进，并记录列偏移修正 source map。
  let templateColumnOffset = 0
  if (
    descriptor.template &&
    (descriptor.template.lang === 'pug' || descriptor.template.lang === 'jade')
  ) {
    ;[descriptor.template.content, templateColumnOffset] = dedent(
      descriptor.template.content,
    )
  }

  if (sourceMap) {
    /** 为无外部 src 的 block 生成到完整 SFC 的映射，并应用行列 padding 修正。 */
    const genMap = (block: SFCBlock | null, columnOffset = 0) => {
      if (block && !block.src) {
        block.map = generateSourceMap(
          filename,
          source,
          block.content,
          sourceRoot,
          !pad || block.type === 'template' ? block.loc.start.line - 1 : 0,
          columnOffset,
        )
      }
    }
    genMap(descriptor.template, templateColumnOffset)
    genMap(descriptor.script)
    descriptor.styles.forEach(s => genMap(s))
    descriptor.customBlocks.forEach(s => genMap(s))
  }

  // 汇总所有 style 中的 v-bind() 表达式，供 script/template 编译注入 useCssVars。
  descriptor.cssVars = parseCssVars(descriptor)

  // scoped CSS 的 :slotted() 需要模板侧生成额外 `-s` scopeId，预先记录优化提示。
  const slottedRE = /(?:::v-|:)slotted\(/
  descriptor.slotted = descriptor.styles.some(
    s => s.scoped && slottedRE.test(s.content),
  )

  const result = {
    descriptor,
    errors,
  }
  parseCache.set(sourceKey, result)
  return result
}

/** 为重复 template/script/script setup 创建带准确源码位置的错误。 */
function createDuplicateBlockError(
  node: ElementNode,
  isScriptSetup = false,
): CompilerError {
  const err = new SyntaxError(
    `Single file component can contain only one <${node.tag}${
      isScriptSetup ? ` setup` : ``
    }> element`,
  ) as CompilerError
  err.loc = node.loc
  return err
}

/** 从顶层元素提取通用 block 内容、属性和专用标记。 */
function createBlock(
  node: ElementNode,
  source: string,
  pad: SFCParseOptions['pad'],
): SFCBlock {
  const type = node.tag
  const loc = node.innerLoc!
  const attrs: Record<string, string | true> = {}
  const block: SFCBlock = {
    type,
    content: source.slice(loc.start.offset, loc.end.offset),
    loc,
    attrs,
  }
  if (pad) {
    block.content = padContent(source, block, pad) + block.content
  }
  node.props.forEach(p => {
    if (p.type === NodeTypes.ATTRIBUTE) {
      const name = p.name
      attrs[name] = p.value ? p.value.content || true : true
      if (name === 'lang') {
        block.lang = p.value && p.value.content
      } else if (name === 'src') {
        block.src = p.value && p.value.content
      } else if (type === 'style') {
        if (name === 'scoped') {
          ;(block as SFCStyleBlock).scoped = true
        } else if (name === 'module') {
          ;(block as SFCStyleBlock).module = attrs[name]
        }
      } else if (type === 'script' && name === 'setup') {
        ;(block as SFCScriptBlock).setup = attrs.setup
      }
    }
  })
  return block
}

/** 同时兼容 LF 与 CRLF 的分行表达式。 */
const splitRE = /\r?\n/g
/** source map 可跳过的纯空白/脚本 padding 注释行。 */
const emptyRE = /^(?:\/\/)?\s*$/
/** space padding 时匹配每个非换行字符。 */
const replaceRE = /./g

/**
 * 为提取后的 block 建立到完整 SFC 的逐非空白字符映射。
 * 这种映射刻意简单：内容未变换，只需恢复原始行列，同时避免为空白生成大量无用段。
 */
function generateSourceMap(
  filename: string,
  source: string,
  generated: string,
  sourceRoot: string,
  lineOffset: number,
  columnOffset: number,
): RawSourceMap {
  const map = new SourceMapGenerator({
    file: filename.replace(/\\/g, '/'),
    sourceRoot: sourceRoot.replace(/\\/g, '/'),
  }) as unknown as CodegenSourceMapGenerator
  map.setSourceContent(filename, source)
  map._sources.add(filename)
  generated.split(splitRE).forEach((line, index) => {
    if (!emptyRE.test(line)) {
      const originalLine = index + 1 + lineOffset
      const generatedLine = index + 1
      for (let i = 0; i < line.length; i++) {
        if (!/\s/.test(line[i])) {
          map._mappings.add({
            originalLine,
            originalColumn: i + columnOffset,
            generatedLine,
            generatedColumn: i,
            source: filename,
            name: null,
          })
        }
      }
    }
  })
  return map.toJSON()
}

/**
 * 在 block 内容前补齐原文件位置。
 * `space` 保持精确列；`line` 用换行保持行号，普通 JS 用 `//\n` 防止前置内容影响语法。
 */
function padContent(
  content: string,
  block: SFCBlock,
  pad: SFCParseOptions['pad'],
): string {
  content = content.slice(0, block.loc.start.offset)
  if (pad === 'space') {
    return content.replace(replaceRE, ' ')
  } else {
    const offset = content.split(splitRE).length
    const padChar = block.type === 'script' && !block.lang ? '//\n' : '\n'
    return Array(offset).join(padChar)
  }
}

/** 判断 block 是否通过静态 src 属性引用外部内容。 */
function hasSrc(node: ElementNode) {
  return node.props.some(p => {
    if (p.type !== NodeTypes.ATTRIBUTE) {
      return false
    }
    return p.name === 'src'
  })
}

/**
 * 忽略纯空白文本后，判断 block 是否没有有效子节点。
 */
function isEmpty(node: ElementNode) {
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]
    if (child.type !== NodeTypes.TEXT || child.content.trim() !== '') {
      return false
    }
  }
  return true
}

/**
 * 判断模板变化是否改变 TS script setup 的 import 裁剪结果，从而要求 HMR 完整重载。
 * 调用方已保证新旧 script 相同；非 TS 不做基于模板的 import 裁剪，因此无需检查。
 */
export function hmrShouldReload(
  prevImports: Record<string, ImportBinding>,
  next: SFCDescriptor,
): boolean {
  if (
    !next.scriptSetup ||
    (next.scriptSetup.lang !== 'ts' && next.scriptSetup.lang !== 'tsx')
  ) {
    return false
  }

  // 逐个检查旧 import 在新模板中的使用状态。
  for (const key in prevImports) {
    // 旧产物已裁掉、而新模板开始使用的 import 无法靠替换 render 函数补回来，必须重载
    // script 模块重新生成 setup 返回值。
    if (!prevImports[key].isUsedInTemplate && isImportUsed(key, next)) {
      return true
    }
  }

  return false
}

/**
 * 删除所有非空行共有的最小前导缩进，并返回删除的列数。
 */
function dedent(s: string): [string, number] {
  const lines = s.split('\n')
  const minIndent = lines.reduce(function (minIndent, line) {
    if (line.trim() === '') {
      return minIndent
    }
    const indent = line.match(/^\s*/)?.[0]?.length || 0
    return Math.min(indent, minIndent)
  }, Infinity)
  if (minIndent === 0) {
    return [s, minIndent]
  }
  return [
    lines
      .map(function (line) {
        return line.slice(minIndent)
      })
      .join('\n'),
    minIndent,
  ]
}
