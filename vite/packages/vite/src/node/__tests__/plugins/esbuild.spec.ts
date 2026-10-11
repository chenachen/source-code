import path from 'node:path'
import { describe, expect, test } from 'vitest'
import type { ResolvedConfig, UserConfig } from '../../config'
import {
  injectEsbuildHelpers,
  resolveEsbuildTranspileOptions,
  transformWithEsbuild,
} from '../../plugins/esbuild'
import { normalizePath } from '../../utils'

describe('resolveEsbuildTranspileOptions', () => {
  /** build.target=es2020、minify=esbuild 且 keepNames=true；解析 ES 输出应采用 esm/js loader、压缩与 treeShaking，并保留 dynamic-import/import-meta 支持。 */
  test('resolve default', () => {
    const options = resolveEsbuildTranspileOptions(
      defineResolvedConfig({
        build: {
          target: 'es2020',
          minify: 'esbuild',
        },
        esbuild: {
          keepNames: true,
        },
      }),
      'es',
    )
    expect(options).toEqual({
      loader: 'js',
      target: 'es2020',
      format: 'esm',
      keepNames: true,
      minify: true,
      treeShaking: true,
      supported: {
        'dynamic-import': true,
        'import-meta': true,
      },
    })
  })

  /** target=esnext 且 minify=false；解析应返回 null，跳过不需要降级或压缩的转换。 */
  test('resolve esnext no minify', () => {
    const options = resolveEsbuildTranspileOptions(
      defineResolvedConfig({
        build: {
          target: 'esnext',
          minify: false,
        },
        esbuild: {
          keepNames: true,
        },
      }),
      'es',
    )
    expect(options).toEqual(null)
  })

  /** minify=esbuild 但显式禁止标识符压缩；解析应拆分各 minify 开关，语法/空白压缩仍开启。 */
  test('resolve specific minify options', () => {
    const options = resolveEsbuildTranspileOptions(
      defineResolvedConfig({
        build: {
          minify: 'esbuild',
        },
        esbuild: {
          keepNames: true,
          minifyIdentifiers: false,
        },
      }),
      'es',
    )
    expect(options).toEqual({
      loader: 'js',
      target: undefined,
      format: 'esm',
      keepNames: true,
      minify: false,
      minifyIdentifiers: false,
      minifySyntax: true,
      minifyWhitespace: true,
      treeShaking: true,
      supported: {
        'dynamic-import': true,
        'import-meta': true,
      },
    })
  })

  /** target=es2020 且关闭压缩；仍保留 target 转换配置，但各 minify 与 treeShaking 都关闭。 */
  test('resolve no minify', () => {
    const options = resolveEsbuildTranspileOptions(
      defineResolvedConfig({
        build: {
          target: 'es2020',
          minify: false,
        },
        esbuild: {
          keepNames: true,
        },
      }),
      'es',
    )
    expect(options).toEqual({
      loader: 'js',
      target: 'es2020',
      format: 'esm',
      keepNames: true,
      minify: false,
      minifyIdentifiers: false,
      minifySyntax: false,
      minifyWhitespace: false,
      treeShaking: false,
      supported: {
        'dynamic-import': true,
        'import-meta': true,
      },
    })
  })

  /** ES 库开启 esbuild 压缩；标识符/语法可压缩但空白压缩关闭，核对库纯注释保留所需配置。 */
  test('resolve es lib', () => {
    const options = resolveEsbuildTranspileOptions(
      defineResolvedConfig({
        build: {
          minify: 'esbuild',
          lib: {
            entry: './somewhere.js',
          },
        },
        esbuild: {
          keepNames: true,
        },
      }),
      'es',
    )
    expect(options).toEqual({
      loader: 'js',
      target: undefined,
      format: 'esm',
      keepNames: true,
      minify: false,
      minifyIdentifiers: true,
      minifySyntax: true,
      minifyWhitespace: false,
      treeShaking: true,
      supported: {
        'dynamic-import': true,
        'import-meta': true,
      },
    })
  })

  /** CJS 库开启 esbuild 压缩；解析应采用 cjs 格式并整体 minify/treeShaking=true。 */
  test('resolve cjs lib', () => {
    const options = resolveEsbuildTranspileOptions(
      defineResolvedConfig({
        build: {
          minify: 'esbuild',
          lib: {
            entry: './somewhere.js',
          },
        },
        esbuild: {
          keepNames: true,
        },
      }),
      'cjs',
    )
    expect(options).toEqual({
      loader: 'js',
      target: undefined,
      format: 'cjs',
      keepNames: true,
      minify: true,
      treeShaking: true,
      supported: {
        'dynamic-import': true,
        'import-meta': true,
      },
    })
  })

  /** ES 库显式请求空白和标识符压缩；最终空白压缩仍被关闭，其余压缩开关保留。 */
  test('resolve es lib with specific minify options', () => {
    const options = resolveEsbuildTranspileOptions(
      defineResolvedConfig({
        build: {
          minify: 'esbuild',
          lib: {
            entry: './somewhere.js',
          },
        },
        esbuild: {
          keepNames: true,
          minifyIdentifiers: true,
          minifyWhitespace: true,
        },
      }),
      'es',
    )
    expect(options).toEqual({
      loader: 'js',
      target: undefined,
      format: 'esm',
      keepNames: true,
      minify: false,
      minifyIdentifiers: true,
      minifySyntax: true,
      minifyWhitespace: false,
      treeShaking: true,
      supported: {
        'dynamic-import': true,
        'import-meta': true,
      },
    })
  })

  /** CJS 库显式开标识符、关语法压缩并启用 treeShaking；解析应保留这些细分选项并默认开启空白压缩。 */
  test('resolve cjs lib with specific minify options', () => {
    const options = resolveEsbuildTranspileOptions(
      defineResolvedConfig({
        build: {
          minify: 'esbuild',
          lib: {
            entry: './somewhere.js',
          },
        },
        esbuild: {
          keepNames: true,
          minifyIdentifiers: true,
          minifySyntax: false,
          treeShaking: true,
        },
      }),
      'cjs',
    )
    expect(options).toEqual({
      loader: 'js',
      target: undefined,
      format: 'cjs',
      keepNames: true,
      minify: false,
      minifyIdentifiers: true,
      minifySyntax: false,
      minifyWhitespace: true,
      treeShaking: true,
      supported: {
        'dynamic-import': true,
        'import-meta': true,
      },
    })
  })
})

describe('transformWithEsbuild', () => {
  /** 以 inline sourcemap 转换简单 JS；应返回非空 code 和 map，核对内联模式不会造成异常。 */
  test('not throw on inline sourcemap', async () => {
    const result = await transformWithEsbuild(`const foo = 'bar'`, '', {
      sourcemap: 'inline',
    })
    expect(result?.code).toBeTruthy()
    expect(result?.map).toBeTruthy()
  })

  /** 原 tsconfigRaw jsx=preserve，但调用显式 automatic 且 importSource=bar；转换应引用 bar/jsx-runtime 并带 pure 标记。 */
  test('correctly overrides TS configuration and applies automatic transform', async () => {
    const jsxImportSource = 'bar'
    const result = await transformWithEsbuild(
      'const foo = () => <></>',
      'baz.jsx',
      {
        tsconfigRaw: {
          compilerOptions: {
            jsx: 'preserve',
          },
        },
        jsx: 'automatic',
        jsxImportSource,
      },
    )
    expect(result?.code).toContain(`${jsxImportSource}/jsx-runtime`)
    expect(result?.code).toContain('/* @__PURE__ */')
  })

  /** 原 tsconfigRaw jsx=react-jsx，但显式 jsx=preserve；输出应保留原 JSX 表达式。 */
  test('correctly overrides TS configuration and preserves code', async () => {
    const foo = 'const foo = () => <></>'
    const result = await transformWithEsbuild(foo, 'baz.jsx', {
      tsconfigRaw: {
        compilerOptions: {
          jsx: 'react-jsx',
        },
      },
      jsx: 'preserve',
    })
    expect(result?.code).toContain(foo)
  })

  /** 原 tsconfigRaw JSX 工厂为 g/foo，调用改为 h/bar；输出应使用 h(bar,null) 的 pure 工厂调用。 */
  test('correctly overrides TS configuration and transforms code', async () => {
    const jsxFactory = 'h',
      jsxFragment = 'bar'
    const result = await transformWithEsbuild(
      'const foo = () => <></>',
      'baz.jsx',
      {
        tsconfigRaw: {
          compilerOptions: {
            jsxFactory: 'g',
            jsxFragmentFactory: 'foo',
            jsxImportSource: 'baz',
          },
        },
        jsx: 'transform',
        jsxFactory,
        jsxFragment,
      },
    )
    expect(result?.code).toContain(
      `/* @__PURE__ */ ${jsxFactory}(${jsxFragment}, null)`,
    )
  })

  describe('useDefineForClassFields', async () => {
    /** 用同一 class field 源码比较输出 target 与 tsconfig 默认语义，返回生成代码作基准相等断言。 */
    const transformClassCode = async (
      target: string,
      tsconfigCompilerOptions: {
        /** TypeScript target 决定未显式指定时的 class field 默认语义。 */
        target?: string
        /** 显式切换 define/assignment 语义，生成比较基准。 */
        useDefineForClassFields?: boolean
      },
    ) => {
      const result = await transformWithEsbuild(
        `
          class foo {
            bar = 'bar'
          }
        `,
        normalizePath(path.resolve(import.meta.dirname, 'bar.ts')),
        {
          target,
          tsconfigRaw: { compilerOptions: tsconfigCompilerOptions },
        },
      )
      return result?.code
    }

    const [
      defineForClassFieldsTrueTransformedCode,
      defineForClassFieldsTrueLowerTransformedCode,
      defineForClassFieldsFalseTransformedCode,
    ] = await Promise.all([
      transformClassCode('esnext', {
        useDefineForClassFields: true,
      }),
      transformClassCode('es2021', {
        useDefineForClassFields: true,
      }),
      transformClassCode('esnext', {
        useDefineForClassFields: false,
      }),
    ])

    /** esbuild target 与 tsconfig target 均为 esnext；转换结果应等于显式 useDefineForClassFields=true 的基准。 */
    test('target: esnext and tsconfig.target: esnext => true', async () => {
      const actual = await transformClassCode('esnext', {
        target: 'esnext',
      })
      expect(actual).toBe(defineForClassFieldsTrueTransformedCode)
    })

    /** tsconfig target=esnext 而输出 target=es2021；结果应等于较低输出 target 下的 define 语义基准。 */
    test('target: es2021 and tsconfig.target: esnext => true', async () => {
      const actual = await transformClassCode('es2021', {
        target: 'esnext',
      })
      expect(actual).toBe(defineForClassFieldsTrueLowerTransformedCode)
    })

    /** tsconfig 与输出 target 均为 es2021；结果应等于显式 assignment 语义基准。 */
    test('target: es2021 and tsconfig.target: es2021 => false', async () => {
      const actual = await transformClassCode('es2021', {
        target: 'es2021',
      })
      expect(actual).toBe(defineForClassFieldsFalseTransformedCode)
    })

    /** 输出 target=esnext、tsconfig target=es2021；仍按 tsconfig 采用 assignment 语义，不由输出等级改变默认值。 */
    test('target: esnext and tsconfig.target: es2021 => false', async () => {
      const actual = await transformClassCode('esnext', {
        target: 'es2021',
      })
      expect(actual).toBe(defineForClassFieldsFalseTransformedCode)
    })

    /** tsconfig 与输出 target 均为 es2022；结果应采用 define 语义基准。 */
    test('target: es2022 and tsconfig.target: es2022 => true', async () => {
      const actual = await transformClassCode('es2022', {
        target: 'es2022',
      })
      expect(actual).toBe(defineForClassFieldsTrueTransformedCode)
    })

    /** 输出 target=es2022 而 tsconfig target 缺省；结果应采用 assignment 语义基准。 */
    test('target: es2022 and tsconfig.target: undefined => false', async () => {
      const actual = await transformClassCode('es2022', {
        target: undefined,
      })
      expect(actual).toBe(defineForClassFieldsFalseTransformedCode)
    })
  })
})

describe('injectEsbuildHelpers', () => {
  /** IIFE 代码前置有 helper；注入后 helper 应移入带括号的工厂函数内部并位于 use strict 之后。 */
  test('injects helpers in IIFE format', () => {
    const esbuildCode =
      'var $=function(){};var MyLib=(function(){"use strict";return 42;})()'
    const result = injectEsbuildHelpers(esbuildCode, 'iife')
    expect(result).toBe(
      'var MyLib=(function(){"use strict";var $=function(){};return 42;})()',
    )
  })

  /** 旧版 esbuild IIFE 使用无包裹括号的函数调用；helper 也应移入其 use strict 之后。 */
  test('injects helpers in IIFE format (pre esbuild 0.25.9)', () => {
    const esbuildCode =
      'var $=function(){};var MyLib=function(){"use strict";return 42;}()'
    const result = injectEsbuildHelpers(esbuildCode, 'iife')
    expect(result).toBe(
      'var MyLib=function(){"use strict";var $=function(){};return 42;}()',
    )
  })

  /** UMD 代码前置有 helper；注入后 helper 应移入 UMD 工厂体内，保留严格模式起点。 */
  test('injects helpers in UMD format', () => {
    const esbuildCode =
      'var $=function(){};(function(global){"use strict";return 42;})'
    const result = injectEsbuildHelpers(esbuildCode, 'umd')
    expect(result).toBe(
      '(function(global){"use strict";var $=function(){};return 42;})',
    )
  })

  /** helper 名包含两个美元符号；注入 IIFE 后应保持完整名字，避免替换文本的 $ 特殊语义破坏源码。 */
  test('handles helpers with special characters', () => {
    const esbuildCode =
      'var $$=function(){};var MyLib=(function(){"use strict";return 42;})()'
    const result = injectEsbuildHelpers(esbuildCode, 'iife')
    expect(result).toContain('"use strict";var $$=function(){};')
  })
})

/** 将最小输入断言为 ResolvedConfig；被测函数只读取 build.target、build.minify 与 esbuild，本辅助不执行配置解析。 */
function defineResolvedConfig(config: UserConfig): ResolvedConfig {
  return config as any
}
