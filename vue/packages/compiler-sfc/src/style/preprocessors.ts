import merge from 'merge-source-map'
import type { RawSourceMap } from '@vue/compiler-core'
import type { SFCStyleCompileOptions } from '../compileStyle'
import { isFunction } from '@vue/shared'

/** Sass/Less/Stylus 预处理器的统一适配器签名。 */
export type StylePreprocessor = (
  source: string,
  map: RawSourceMap | undefined,
  options: {
    /** 透传给具体预处理器的其他配置。 */
    [key: string]: any
    /** 字符串直接前置拼接；函数接收 source/filename，其返回值替换完整预处理输入。 */
    additionalData?: string | ((source: string, filename: string) => string)
    /** 当前 SFC 文件名，供 import 解析和 source map 使用。 */
    filename: string
  },
  customRequire: SFCStyleCompileOptions['preprocessCustomRequire'],
) => StylePreprocessorResults

/** 预处理器统一输出；错误作为数据返回，依赖供构建器监听。 */
export interface StylePreprocessorResults {
  /** 预处理后交给 PostCSS 的 CSS。 */
  code: string
  /** 预处理代码到输入样式的 source map。 */
  map?: object
  /** 语法、import 等预处理错误。 */
  errors: Error[]
  /** 预处理器加载的文件路径，供构建工具监听。 */
  dependencies: string[]
}

/**
 * SCSS 适配器：优先 compileString，否则使用 renderSync，统一 CSS、依赖与 map。
 * Sass 模块加载和 additionalData 执行在 try 之外；编译、URL 转换与 map 合并异常才转成
 * 空 code/errors。输入 map 存在时才请求 Sass map，并与 block → SFC 映射复合。
 */
const scss: StylePreprocessor = (source, map, options, load = require) => {
  const nodeSass: typeof import('sass') = load('sass')
  const { compileString, renderSync } = nodeSass

  const data = getSource(source, options.filename, options.additionalData)
  let css: string
  let dependencies: string[]
  let sourceMap: any

  try {
    if (compileString) {
      const { pathToFileURL, fileURLToPath }: typeof import('url') = load('url')

      const result = compileString(data, {
        ...options,
        url: pathToFileURL(options.filename),
        sourceMap: !!map,
      })
      css = result.css
      dependencies = result.loadedUrls.map(url => fileURLToPath(url))
      sourceMap = map ? result.sourceMap! : undefined
    } else {
      const result = renderSync({
        ...options,
        data,
        file: options.filename,
        outFile: options.filename,
        sourceMap: !!map,
      })
      css = result.css.toString()
      dependencies = result.stats.includedFiles
      sourceMap = map ? JSON.parse(result.map!.toString()) : undefined
    }

    if (map) {
      return {
        code: css,
        errors: [],
        dependencies,
        map: merge(map, sourceMap!),
      }
    }
    return { code: css, errors: [], dependencies }
  } catch (e: any) {
    return { code: '', errors: [e], dependencies: [] }
  }
}

/** 缩进语法 Sass 复用 SCSS 适配器，仅打开 indentedSyntax。 */
const sass: StylePreprocessor = (source, map, options, load) =>
  scss(
    source,
    map,
    {
      ...options,
      indentedSyntax: true,
    },
    load,
  )

/**
 * Less 回调适配器：强制 syncImport，再立即读取回调结果，适用于同步完成的渲染实现。
 * 回调 error 转为结果项；加载、调用 render 或合并 map 自行抛出的异常继续向外传播。
 */
const less: StylePreprocessor = (source, map, options, load = require) => {
  const nodeLess = load('less')

  let result: any
  let error: Error | null = null
  nodeLess.render(
    getSource(source, options.filename, options.additionalData),
    { ...options, syncImport: true },
    (err: Error | null, output: any) => {
      error = err
      result = output
    },
  )

  if (error) return { code: '', errors: [error], dependencies: [] }
  const dependencies = result.imports
  if (map) {
    return {
      code: result.css.toString(),
      map: merge(map, result.map),
      errors: [],
      dependencies: dependencies,
    }
  }

  return {
    code: result.css.toString(),
    errors: [],
    dependencies: dependencies,
  }
}

/**
 * Stylus 同步适配器，在 render 后收集 deps() 与可选 map；加载模块在 try 之外。
 * 它直接使用 source，未经过 getSource，因此不会应用此接口中的 additionalData。
 */
const styl: StylePreprocessor = (source, map, options, load = require) => {
  const nodeStylus = load('stylus')
  try {
    const ref = nodeStylus(source, options)
    if (map) ref.set('sourcemap', { inline: false, comment: false })

    const result = ref.render()
    const dependencies = ref.deps()
    if (map) {
      return {
        code: result,
        map: merge(map, ref.sourcemap),
        errors: [],
        dependencies,
      }
    }

    return { code: result, errors: [], dependencies }
  } catch (e: any) {
    return { code: '', errors: [e], dependencies: [] }
  }
}

/** additionalData 字符串前置拼接；函数返回完整预处理输入，需由函数自行保留原 source。 */
function getSource(
  source: string,
  filename: string,
  additionalData?: string | ((source: string, filename: string) => string),
) {
  if (!additionalData) return source
  if (isFunction(additionalData)) {
    return additionalData(source, filename)
  }
  return additionalData + source
}

/** compiler-sfc 内置支持的样式预处理语言名。 */
export type PreprocessLang = 'less' | 'sass' | 'scss' | 'styl' | 'stylus'

/** 语言名到统一预处理适配器的映射。 */
export const processors: Record<PreprocessLang, StylePreprocessor> = {
  less,
  sass,
  scss,
  styl,
  stylus: styl,
}
