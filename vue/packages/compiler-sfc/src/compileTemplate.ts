import type {
  CodegenResult,
  CompilerError,
  CompilerOptions,
  NodeTransform,
  ParserOptions,
  RawSourceMap,
  RootNode,
} from '@vue/compiler-core'
import { SourceMapConsumer, SourceMapGenerator } from 'source-map-js'
import {
  type AssetURLOptions,
  type AssetURLTagConfig,
  createAssetUrlTransformWithOptions,
  normalizeOptions,
  transformAssetUrl,
} from './template/transformAssetUrl'
import {
  createSrcsetTransformWithOptions,
  transformSrcset,
} from './template/transformSrcset'
import { generateCodeFrame, isObject } from '@vue/shared'
import * as CompilerDOM from '@vue/compiler-dom'
import * as CompilerSSR from '@vue/compiler-ssr'
import consolidate from '@vue/consolidate'
import { warnOnce } from './warn'
import { genCssVarsFromList } from './style/cssVars'
import { resolveTemplateAST } from './template/resolveTemplateAST'

/** compiler-sfc 可接入的模板编译器最小接口。 */
export interface TemplateCompiler {
  /** 把模板源码或现成 AST 转换并生成渲染函数。 */
  compile(source: string | RootNode, options: CompilerOptions): CodegenResult
  /** 只执行模板解析，供 SFC parse 阶段复用 AST。 */
  parse(template: string, options: ParserOptions): RootNode
}

/** 单个 SFC template block 的编译产物与诊断。 */
export interface SFCTemplateCompileResults {
  /** 生成的客户端 render 或 SSR ssrRender 代码。 */
  code: string
  /** 解析并完成转换的模板 AST；预处理失败时可能不存在。 */
  ast?: RootNode
  /** setup 内联模式所需的 import/静态提升序言。 */
  preamble?: string
  /** 实际送入模板编译器的源码；使用预处理器后是预处理结果。 */
  source: string
  /** 非致命优化或用法提示。 */
  tips: string[]
  /** 预处理与模板编译诊断。 */
  errors: (string | CompilerError)[]
  /** 生成代码到原 SFC template block 的 source map。 */
  map?: RawSourceMap
}

/** SFC 模板编译选项。 */
export interface SFCTemplateCompileOptions {
  /** template block 源码。 */
  source: string
  /** SFC parse 阶段缓存的 AST；无预处理且选项兼容时可复用。 */
  ast?: RootNode
  /** 所属 `.vue` 文件名，用于诊断和 source map。 */
  filename: string
  /** 组件 scope 哈希，模板编译时会规范为 `data-v-*`。 */
  id: string
  /** 组件是否包含 scoped style。 */
  scoped?: boolean
  /** 是否使用 `:slotted()`，决定插槽内容 scopeId 处理。 */
  slotted?: boolean
  /** 是否按生产模式生成代码。 */
  isProd?: boolean
  /** 是否生成服务端 `ssrRender`。 */
  ssr?: boolean
  /** SSR 渲染时需要注入的 CSS `v-bind()` 表达式。 */
  ssrCssVars?: string[]
  /** template block 到完整 SFC 的输入 source map。 */
  inMap?: RawSourceMap
  /** 替换默认 DOM/SSR 编译器的自定义实现。 */
  compiler?: TemplateCompiler
  /** 透传给底层模板编译器的选项。 */
  compilerOptions?: CompilerOptions
  /** Pug 等模板预处理语言。 */
  preprocessLang?: string
  /** 原样传给 consolidate 预处理器的选项。 */
  preprocessOptions?: any
  /**
   * 自定义预处理器加载函数。compiler-sfc 被 link 或全局安装时不一定能从自身位置解析到
   * 项目依赖，也可用它向浏览器构建提供预处理器实现。
   */
  preprocessCustomRequire?: (id: string) => any
  /**
   * 配置哪些标签/属性要转换为资产 URL import；设为 false 完全关闭转换。
   */
  transformAssetUrls?: AssetURLOptions | AssetURLTagConfig | boolean
}

/** consolidate 风格的同步回调模板预处理器接口。 */
interface PreProcessor {
  /** 以 consolidate 回调协议同步产出预处理后的模板文本。 */
  render(
    source: string,
    options: any,
    cb: (err: Error | null, res: string) => void,
  ): void
}

/**
 * 同步执行 Pug 等模板预处理器。
 * consolidate 虽暴露回调 API，多数引擎实际同步调用；compileTemplate 必须保持同步，才能
 * 用在 Jest 的 Node require hook 等同步转换链。异步预处理器不适用于此入口。
 */
function preprocess(
  { source, filename, preprocessOptions }: SFCTemplateCompileOptions,
  preprocessor: PreProcessor,
): string {
  let res: string = ''
  let err: Error | null = null

  preprocessor.render(
    source,
    { filename, ...preprocessOptions },
    (_err, _res) => {
      if (_err) err = _err
      res = _res
    },
  )

  if (err) throw err
  return res
}

/**
 * 编译 SFC 的 template block，并可先执行 `lang` 对应预处理器。
 * 预处理器缺失或执行失败会返回空 render 与结构化错误，而不是令整个构建进程直接崩溃。
 */
export function compileTemplate(
  options: SFCTemplateCompileOptions,
): SFCTemplateCompileResults {
  const { preprocessLang, preprocessCustomRequire } = options

  if (
    (__ESM_BROWSER__ || __GLOBAL__) &&
    preprocessLang &&
    !preprocessCustomRequire
  ) {
    throw new Error(
      `[@vue/compiler-sfc] Template preprocessing in the browser build must ` +
        `provide the \`preprocessCustomRequire\` option to return the in-browser ` +
        `version of the preprocessor in the shape of { render(): string }.`,
    )
  }

  const preprocessor = preprocessLang
    ? preprocessCustomRequire
      ? preprocessCustomRequire(preprocessLang)
      : __ESM_BROWSER__
        ? undefined
        : consolidate[preprocessLang as keyof typeof consolidate]
    : false
  if (preprocessor) {
    try {
      return doCompileTemplate({
        ...options,
        source: preprocess(options, preprocessor),
        // 预处理后源码已变化，parse 阶段基于原模板建立的 AST 不再有效。
        ast: undefined,
      })
    } catch (e: any) {
      return {
        code: `export default function render() {}`,
        source: options.source,
        tips: [],
        errors: [e],
      }
    }
  } else if (preprocessLang) {
    return {
      code: `export default function render() {}`,
      source: options.source,
      tips: [
        `Component ${options.filename} uses lang ${preprocessLang} for template. Please install the language preprocessor.`,
      ],
      errors: [
        `Component ${options.filename} uses lang ${preprocessLang} for template, however it is not installed.`,
      ],
    }
  } else {
    return doCompileTemplate(options)
  }
}

/** 选择 DOM/SSR 编译器、安装资产转换并合并 source map 的模板编译主流程。 */
function doCompileTemplate({
  filename,
  id,
  scoped,
  slotted,
  inMap,
  source,
  ast: inAST,
  ssr = false,
  ssrCssVars,
  isProd = false,
  compiler,
  compilerOptions = {},
  transformAssetUrls,
}: SFCTemplateCompileOptions): SFCTemplateCompileResults {
  const errors: CompilerError[] = []
  const warnings: CompilerError[] = []

  let nodeTransforms: NodeTransform[] = []
  if (isObject(transformAssetUrls)) {
    const assetOptions = normalizeOptions(transformAssetUrls)
    nodeTransforms = [
      createAssetUrlTransformWithOptions(assetOptions),
      createSrcsetTransformWithOptions(assetOptions),
    ]
  } else if (transformAssetUrls !== false) {
    nodeTransforms = [transformAssetUrl, transformSrcset]
  }

  if (ssr && !ssrCssVars) {
    warnOnce(
      `compileTemplate is called with \`ssr: true\` but no ` +
        `corresponding \`cssVars\` option.`,
    )
  }
  if (!id) {
    warnOnce(`compileTemplate now requires the \`id\` option.`)
    id = ''
  }

  const shortId = id.replace(/^data-v-/, '')
  const longId = `data-v-${shortId}`

  const defaultCompiler = ssr ? (CompilerSSR as TemplateCompiler) : CompilerDOM
  compiler = compiler || defaultCompiler

  if (compiler !== defaultCompiler) {
    // 自定义编译器的 AST 形状/解析规则可能不同，不能复用默认 parser 生成的 descriptor AST。
    inAST = undefined
  }

  inAST = resolveTemplateAST(inAST, {
    compiler,
    compilerOptions,
    ssr,
    onError: e => errors.push(e),
  })

  let { code, ast, preamble, map } = compiler.compile(inAST || source, {
    mode: 'module',
    prefixIdentifiers: true,
    hoistStatic: true,
    cacheHandlers: true,
    ssrCssVars:
      ssr && ssrCssVars && ssrCssVars.length
        ? genCssVarsFromList(ssrCssVars, shortId, isProd, true)
        : '',
    scopeId: scoped ? longId : undefined,
    slotted,
    sourceMap: true,
    ...compilerOptions,
    hmr: !isProd,
    nodeTransforms: nodeTransforms.concat(compilerOptions.nodeTransforms || []),
    filename,
    onError: e => errors.push(e),
    onWarn: w => warnings.push(w),
  })

  // inMap 是 parse.ts 生成的 block→SFC 简单映射。直接编译 block 字符串时，再把模板
  // 编译器的 code→block 映射与它合并，并将错误位置平移回完整 `.vue` 文件。
  if (inMap && !inAST) {
    if (map) {
      map = mapLines(inMap, map)
    }
    if (errors.length) {
      patchErrors(errors, source, inMap)
    }
  }

  const tips = warnings.map(w => {
    let msg = w.message
    if (w.loc) {
      msg += `\n${generateCodeFrame(
        inAST?.source || source,
        w.loc.start.offset,
        w.loc.end.offset,
      )}`
    }
    return msg
  })

  return { code, ast, preamble, source, errors, tips, map }
}

/**
 * 合并 `生成代码 → template block` 与 `template block → 完整 SFC` 两层 source map。
 */
function mapLines(oldMap: RawSourceMap, newMap: RawSourceMap): RawSourceMap {
  if (!oldMap) return newMap
  if (!newMap) return oldMap

  const oldMapConsumer = new SourceMapConsumer(oldMap)
  const newMapConsumer = new SourceMapConsumer(newMap)
  const mergedMapGenerator = new SourceMapGenerator()

  newMapConsumer.eachMapping(m => {
    if (m.originalLine == null) {
      return
    }

    const origPosInOldMap = oldMapConsumer.originalPositionFor({
      line: m.originalLine,
      column: m.originalColumn!,
    })

    if (origPosInOldMap.source == null) {
      return
    }

    mergedMapGenerator.addMapping({
      generated: {
        line: m.generatedLine,
        column: m.generatedColumn,
      },
      original: {
        line: origPosInOldMap.line,
        // parse.ts 的旧映射主要校正行号；列仍采用模板编译器提供的当前原始列。
        column: m.originalColumn!,
      },
      source: origPosInOldMap.source,
      name: origPosInOldMap.name,
    })
  })

  // source-map-js 的公开类型未暴露内部 sources/file/root 字段，但保留它们是完整映射所需。
  const generator = mergedMapGenerator as any
  ;(oldMapConsumer as any).sources.forEach((sourceFile: string) => {
    generator._sources.add(sourceFile)
    const sourceContent = oldMapConsumer.sourceContentFor(sourceFile)
    if (sourceContent != null) {
      mergedMapGenerator.setSourceContent(sourceFile, sourceContent)
    }
  })

  generator._sourceRoot = oldMap.sourceRoot
  generator._file = oldMap.file
  return generator.toJSON()
}

/** 将基于 template block 的错误位置平移到完整 SFC 源码坐标。 */
function patchErrors(
  errors: CompilerError[],
  source: string,
  inMap: RawSourceMap,
) {
  const originalSource = inMap.sourcesContent![0]
  const offset = originalSource.indexOf(source)
  const lineOffset = originalSource.slice(0, offset).split(/\r?\n/).length - 1
  errors.forEach(err => {
    if (err.loc) {
      err.loc.start.line += lineOffset
      err.loc.start.offset += offset
      if (err.loc.end !== err.loc.start) {
        err.loc.end.line += lineOffset
        err.loc.end.offset += offset
      }
    }
  })
}
