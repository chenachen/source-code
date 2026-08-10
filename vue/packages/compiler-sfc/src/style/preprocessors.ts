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
    /** 编译前追加到样式源码的共享变量/混入，或动态转换函数。 */
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

/** SCSS 适配器，同时兼容现代 `compileString` 与旧 `renderSync` Sass API。 */
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

/** Less 同步适配器；强制 syncImport，保证 compileStyle 同步 API 可用。 */
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

/** Stylus 同步适配器，并收集 `@import` 依赖与可选 source map。 */
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

/** 将 additionalData 字符串/函数的结果注入实际样式源码之前。 */
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
