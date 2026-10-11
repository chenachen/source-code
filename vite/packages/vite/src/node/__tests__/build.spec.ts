import { basename, resolve } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import fsp from 'node:fs/promises'
import colors from 'picocolors'
import { afterEach, describe, expect, assert, test, vi } from 'vitest'
import type {
  LogLevel,
  OutputChunk,
  OutputOptions,
  RolldownOptions,
  RolldownOutput,
  RollupLog,
} from 'rolldown'
import type { LibraryFormats, LibraryOptions } from '../build'
import {
  ChunkMetadataMap,
  build,
  createBuilder,
  onRollupLog,
  resolveBuildOutputs,
  resolveLibFilename,
  resolveRolldownOptions,
} from '../build'
import type { Logger } from '../logger'
import { createLogger } from '../logger'
import { BuildEnvironment, resolveConfig } from '..'

/** 定位本文件旁的构建 fixture，避免测试依赖进程工作目录。 */
const dirname = import.meta.dirname

/** 按库输出格式记录期望文件名，用于参数化验证 filename 推导。 */
type FormatsToFileNames = [LibraryFormats, string][]

/**
 * 构建主链集成场景：用内存输出验证入口优先级、CSS metadata 对内容 hash 的
 * 传播、manifest 资产归属、JSON tree-shaking 与库 external 行为。
 */
describe('build', () => {
  /** 场景：动态入口只改变其导入的 CSS 内容；验证目标：入口 JS 与该 CSS 的内容哈希变化，无关产物哈希保持稳定。 */
  test('file hash should change when css changes for dynamic entries', async () => {
    /** 用指定 CSS 颜色构造动态入口图并返回内存产物，以比较内容哈希传播范围。 */
    const buildProject = async (cssColor: string) => {
      return (await build({
        root: resolve(dirname, 'packages/build-project'),
        logLevel: 'silent',
        build: {
          write: false,
        },
        plugins: [
          {
            name: 'test',
            /** 只把动态入口、子入口和样式依赖解析为测试虚拟模块。 */
            resolveId(id) {
              if (
                id === 'entry.js' ||
                id === 'subentry.js' ||
                id === 'foo.css'
              ) {
                return '\0' + id
              }
            },
            /** 按虚拟 ID 生成动态导入链与可变 CSS 内容。 */
            load(id) {
              if (id === '\0entry.js') {
                return `window.addEventListener('click', () => { import('subentry.js') });`
              }
              if (id === '\0subentry.js') {
                return `import 'foo.css'`
              }
              if (id === '\0foo.css') {
                return `.foo { color: ${cssColor} }`
              }
            },
          },
        ],
      })) as RolldownOutput
    }
    const result = await Promise.all([
      buildProject('red'),
      buildProject('blue'),
    ])
    expect(getOutputHashChanges(result[0], result[1])).toMatchInlineSnapshot(`
      {
        "changed": [
          "index",
          "_subentry.css",
        ],
        "unchanged": [
          "undefined",
        ],
      }
    `)
    assertOutputHashContentChange(result[0], result[1])
  })

  /** 场景：仅配置顶层 input；验证目标：构建以该文件为默认入口，产物名称和代码均来自它。 */
  test('top-level input is used as the default build entry', async () => {
    const result = (await build({
      root: resolve(dirname, 'packages/build-project'),
      logLevel: 'silent',
      input: 'top-level-entry.js',
      build: {
        write: false,
      },
      plugins: [
        {
          name: 'test',
          /** 把顶层文件入口截获为确定的虚拟 ID，隔离磁盘入口行为。 */
          resolveId(id) {
            if (id.replace(/\\/g, '/').endsWith('top-level-entry.js')) {
              return '\0top-level-entry.js'
            }
          },
          /** 为顶层文件入口返回可在最终 chunk 中识别的标记代码。 */
          load(id) {
            if (id === '\0top-level-entry.js') {
              return `console.log('from-top-level-input')`
            }
          },
        },
      ],
    })) as RolldownOutput
    const chunk = result.output.find((o) => o.type === 'chunk')
    expect(chunk?.fileName).toContain('top-level-entry')
    expect(chunk?.code).toContain('from-top-level-input')
  })

  /** 场景：顶层 input 是由插件解析和加载的虚拟 ID；验证目标：虚拟入口代码进入最终 chunk。 */
  test('top-level input can be a virtual module for build', async () => {
    const input = 'virtual:entry'
    const resolvedInput = `\0${input}`
    const result = (await build({
      root: resolve(dirname, 'packages/build-project'),
      logLevel: 'silent',
      input,
      build: {
        write: false,
      },
      plugins: [
        {
          name: 'virtual-entry',
          /** 仅解析用户传入的 virtual:entry，并返回带空字节前缀的内部 ID。 */
          resolveId(id) {
            if (id === input) {
              return resolvedInput
            }
          },
          /** 为解析后的虚拟入口提供可验证的模块源码。 */
          load(id) {
            if (id === resolvedInput) {
              return `console.log('from-virtual-top-level-input')`
            }
          },
        },
      ],
    })) as RolldownOutput
    const chunk = result.output.find((o) => o.type === 'chunk')
    expect(chunk?.code).toContain('from-virtual-top-level-input')
  })

  /** 场景：两个动态分支共享纯 CSS chunk 且只修改共享样式；验证目标：共享 CSS、引用它的 JS 与入口哈希变化，独立 CSS 哈希不变。 */
  test('file hash should change when pure css chunk changes', async () => {
    /** 构造两个分支共享 CSS chunk 的模块图，并允许替换共享样式内容。 */
    const buildProject = async (cssColor: string) => {
      return (await build({
        root: resolve(dirname, 'packages/build-project'),
        logLevel: 'silent',
        build: {
          write: false,
        },
        plugins: [
          {
            name: 'test',
            /** 把共享 CSS 哈希场景中的入口、分支与样式文件统一解析为虚拟模块。 */
            resolveId(id) {
              if (
                id === 'entry.js' ||
                id === 'foo.js' ||
                id === 'bar.js' ||
                id === 'baz.js' ||
                id === 'foo.css' ||
                id === 'bar.css' ||
                id === 'baz.css'
              ) {
                return '\0' + id
              }
            },
            /** 生成共享分支图，并只让 baz.css 内容随测试参数变化。 */
            load(id) {
              if (id === '\0entry.js') {
                return `
                  window.addEventListener('click', () => { import('foo.js') });
                  window.addEventListener('click', () => { import('bar.js') });`
              }
              if (id === '\0foo.js') return `import 'foo.css'; import 'baz.js'`
              if (id === '\0bar.js') return `import 'bar.css'; import 'baz.js'`
              if (id === '\0baz.js') return `import 'baz.css'`
              if (id === '\0foo.css') return `.foo { color: red }`
              if (id === '\0bar.css') return `.foo { color: green }`
              if (id === '\0baz.css') return `.foo { color: ${cssColor} }`
            },
          },
        ],
      })) as RolldownOutput
    }
    const result = await Promise.all([
      buildProject('yellow'),
      buildProject('blue'),
    ])
    expect(getOutputHashChanges(result[0], result[1])).toMatchInlineSnapshot(`
      {
        "changed": [
          "index",
          "_bar",
          "_foo",
          "_baz.css",
        ],
        "unchanged": [
          "_bar.css",
          "_foo.css",
          "undefined",
        ],
      }
    `)
    assertOutputHashContentChange(result[0], result[1])
  })

  /** 场景：两个目录各有同名 index.css 入口；构建后核对 manifest 的两个完整源路径都标为 isEntry；本例未比较两条记录的 file 字段。 */
  test('css entries with the same basename should not cross-link manifest assets', async () => {
    const root = resolve(dirname, 'fixtures/css-entry-same-basename')
    const result = (await build({
      root,
      logLevel: 'silent',
      build: {
        write: false,
        manifest: true,
        assetsInlineLimit: 0,
        rolldownOptions: {
          input: [resolve(root, 'a/index.css'), resolve(root, 'b/index.css')],
        },
      },
    })) as RolldownOutput

    const manifest = JSON.parse(
      (result.output.find((o) => o.fileName === '.vite/manifest.json') as any)
        .source,
    )
    expect(manifest['a/index.css']).toMatchObject({
      isEntry: true,
    })
    expect(manifest['b/index.css']).toMatchObject({
      isEntry: true,
    })
  })

  /** 大型对象和数组 JSON 的 stringify=true/false/auto 分别搭配 namedExports=true/false；入口未使用导入值，六种配置的产物都应排除大字符串标记。 */
  test.for([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
    ['auto', true],
    ['auto', false],
  ] as const)(
    'large json object files should have tree-shaking (json.stringify: %s, json.namedExports: %s)',
    async ([stringify, namedExports]) => {
      const esBundle = (await build({
        mode: 'development',
        root: resolve(dirname, 'packages/build-project'),
        logLevel: 'silent',
        json: { stringify, namedExports },
        build: {
          minify: false,
          modulePreload: { polyfill: false },
          write: false,
        },
        plugins: [
          {
            name: 'test',
            /** 解析 JSON tree-shaking 场景的入口与两类 JSON 虚拟模块。 */
            resolveId(id) {
              if (
                id === 'entry.js' ||
                id === 'object.json' ||
                id === 'array.json'
              ) {
                return '\0' + id
              }
            },
            /** 生成未使用的大型对象/数组 JSON，供产物排除标记字符串。 */
            load(id) {
              if (id === '\0entry.js') {
                return `
                  import object from 'object.json';
                  import array from 'array.json';
                  console.log();
                `
              }
              if (id === '\0object.json') {
                return `
                  {"value": {"${stringify}_${namedExports}":"JSON_OBJ${'_'.repeat(10_000)}"}}
                `
              }
              if (id === '\0array.json') {
                return `
                  ["${stringify}_${namedExports}","JSON_ARR${'_'.repeat(10_000)}"]
                `
              }
            },
          },
        ],
      })) as RolldownOutput

      const foo = esBundle.output.find(
        (chunk) => chunk.type === 'chunk' && chunk.isEntry,
      ) as OutputChunk
      expect(foo.code).not.contains('JSON_ARR')
      expect(foo.code).not.contains('JSON_OBJ')
    },
  )

  /** 场景：库的一个入口经另一入口引用 external 包；验证目标：external import 不被提升进无直接依赖的入口 chunk。 */
  test('external modules should not be hoisted in library build', async () => {
    const [esBundle] = (await build({
      logLevel: 'silent',
      build: {
        lib: {
          entry: ['foo.js', 'bar.js'],
          formats: ['es'],
        },
        rolldownOptions: {
          external: 'external',
        },
        write: false,
      },
      plugins: [
        {
          name: 'test',
          /** 按文件名解析多入口库场景的 foo.js 与 bar.js。 */
          resolveId(id) {
            const name = basename(id)
            if (name === 'foo.js' || name === 'bar.js') {
              return name
            }
          },
          /** 生成 foo→bar→external 的依赖链，用于检查 external import 不被错误提升。 */
          load(id) {
            if (id === 'foo.js') {
              return `
                  import bar from 'bar.js'
                  export default bar()
                `
            }
            if (id === 'bar.js') {
              return `
                  import ext from 'external';
                  export default ext();`
            }
          },
        },
      ],
    })) as RolldownOutput[]

    const foo = esBundle.output.find(
      (chunk) => chunk.fileName === 'foo.js',
    ) as OutputChunk
    expect(foo.code).not.contains('import "external"')
  })
})

/** 为输出解析矩阵提供最小库入口与稳定文件名基线。 */
const baseLibOptions: LibraryOptions = {
  fileName: 'my-lib',
  entry: 'mylib.js',
}

/**
 * 配置算法场景：用户 output 数组优先于 lib.formats；UMD/IIFE 需要单入口与 name；
 * 同时覆盖顶层 input、SSR entry、lib entry 和 index.html 的入口优先级。
 */
describe('resolveBuildOutputs', () => {
  /** 场景：显式输出数组只声明 ES 格式；验证目标：输出解析保持该单一格式。 */
  test('resolves outputs correctly', () => {
    const logger = createLogger()
    const libOptions: LibraryOptions = { ...baseLibOptions }
    const outputs: OutputOptions[] = [{ format: 'es' }]
    const resolvedOutputs = resolveBuildOutputs(outputs, libOptions, logger)

    expect(resolvedOutputs).toEqual([
      {
        format: 'es',
      },
    ])
  })

  /** 场景：库配置有 name 但未给输出；验证目标：默认生成 ES 与 UMD 两种输出配置。 */
  test('resolves outputs from lib options', () => {
    const logger = createLogger()
    const libOptions: LibraryOptions = { ...baseLibOptions, name: 'lib' }
    const resolvedOutputs = resolveBuildOutputs(void 0, libOptions, logger)

    expect(resolvedOutputs).toEqual([
      {
        format: 'es',
      },
      {
        format: 'umd',
      },
    ])
  })

  /** 场景：不是 library build；验证目标：显式 outputs 对象按原引用和内容返回，不应用库格式默认值。 */
  test('does not change outputs when lib options are missing', () => {
    const logger = createLogger()
    const outputs: OutputOptions[] = [{ format: 'es' }]
    const resolvedOutputs = resolveBuildOutputs(outputs, false, logger)

    expect(resolvedOutputs).toEqual(outputs)
  })

  /** 场景：rolldownOptions.output 是数组且 build.lib.formats 也存在；验证目标：保留 output，并警告 formats 会被忽略。 */
  test('logs a warning when outputs is an array and formats are specified', () => {
    const logger = createLogger()
    const loggerSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const libOptions: LibraryOptions = {
      ...baseLibOptions,
      formats: ['iife'],
    }
    const outputs: OutputOptions[] = [{ format: 'es' }]

    resolveBuildOutputs(outputs, libOptions, logger)

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('"build.lib.formats" will be ignored because'),
    )
  })

  /** 场景：库输出包含 IIFE 但未配置 lib.name；验证目标：输出解析抛出 name 必填错误。 */
  test('throws an error when lib.name is missing on iife format', () => {
    const logger = createLogger()
    const libOptions: LibraryOptions = {
      ...baseLibOptions,
      formats: ['iife'],
    }
    /** 延迟执行缺少 lib.name 的 IIFE 输出解析，以断言同步错误。 */
    const resolveBuild = () => resolveBuildOutputs(void 0, libOptions, logger)

    expect(resolveBuild).toThrowError(/Option "build\.lib\.name" is required/)
  })

  /** 场景：库输出包含 UMD 但未配置 lib.name；验证目标：输出解析抛出 name 必填错误。 */
  test('throws an error when lib.name is missing on umd format', () => {
    const logger = createLogger()
    const libOptions: LibraryOptions = { ...baseLibOptions, formats: ['umd'] }
    /** 延迟执行缺少 lib.name 的 UMD 输出解析，以断言同步错误。 */
    const resolveBuild = () => resolveBuildOutputs(void 0, libOptions, logger)

    expect(resolveBuild).toThrowError(/Option "build\.lib\.name" is required/)
  })

  /** 场景：显式 IIFE output 未设置 output.name；验证目标：输出解析拒绝该条目并指出 name 必填。 */
  test('throws an error when output.name is missing on iife format', () => {
    const logger = createLogger()
    const libOptions: LibraryOptions = { ...baseLibOptions }
    const outputs: OutputOptions[] = [{ format: 'iife' }]
    /** 延迟解析未声明 output.name 的显式 IIFE 配置。 */
    const resolveBuild = () => resolveBuildOutputs(outputs, libOptions, logger)

    expect(resolveBuild).toThrowError(
      /Entries in "build\.rolldownOptions\.output" must specify "name"/,
    )
  })

  /** 场景：显式 UMD output 未设置 output.name；验证目标：输出解析拒绝该条目并指出 name 必填。 */
  test('throws an error when output.name is missing on umd format', () => {
    const logger = createLogger()
    const libOptions: LibraryOptions = { ...baseLibOptions }
    const outputs: OutputOptions[] = [{ format: 'umd' }]
    /** 延迟解析未声明 output.name 的显式 UMD 配置。 */
    const resolveBuild = () => resolveBuildOutputs(outputs, libOptions, logger)

    expect(resolveBuild).toThrowError(
      /Entries in "build\.rolldownOptions\.output" must specify "name"/,
    )
  })

  describe('input resolution in resolveRolldownOptions', () => {
    const buildProjectRoot = resolve(dirname, 'packages/build-project')

    /** 场景：顶层 input 与 build.rolldownOptions.input 同时存在；验证目标：Rolldown 最终采用后者。 */
    test('build.rolldownOptions.input takes precedence over top-level input', async () => {
      const builder = await createBuilder({
        root: buildProjectRoot,
        logLevel: 'silent',
        input: 'top-level-entry.js',
        build: {
          rolldownOptions: { input: 'explicit-entry.js' },
        },
      })
      const options = resolveRolldownOptions(
        builder.environments.client,
        new ChunkMetadataMap(),
      )
      expect(options.input).toBe('explicit-entry.js')
    })

    /** 场景：普通客户端构建未配置任何入口；验证目标：入口回退到项目根 index.html 的绝对路径。 */
    test('falls back to index.html when no input is set', async () => {
      const builder = await createBuilder({
        root: buildProjectRoot,
        logLevel: 'silent',
      })
      const options = resolveRolldownOptions(
        builder.environments.client,
        new ChunkMetadataMap(),
      )
      expect(options.input).toBe(resolve(buildProjectRoot, 'index.html'))
    })

    /** 场景：SSR 环境同时配置 environment input 与 build.ssr 字符串；验证目标：最终入口采用 build.ssr 的绝对路径。 */
    test('build.ssr string entry takes precedence over input', async () => {
      const builder = await createBuilder({
        root: buildProjectRoot,
        logLevel: 'silent',
        environments: {
          ssr: {
            input: 'env-input.js',
            build: { ssr: 'ssr-entry.js' },
          },
        },
      })
      const options = resolveRolldownOptions(
        builder.environments.ssr,
        new ChunkMetadataMap(),
      )
      expect(options.input).toBe(resolve(buildProjectRoot, 'ssr-entry.js'))
    })

    /** 场景：启用 library build 却既无 lib.entry 也无顶层 input；验证目标：解析 Rolldown 选项立即给出入口缺失错误。 */
    test('throws when build.lib is set without entry or top-level input', async () => {
      const builder = await createBuilder({
        root: buildProjectRoot,
        logLevel: 'silent',
        build: {
          lib: { name: 'MyLib', formats: ['es'] },
        },
      })
      expect(() =>
        resolveRolldownOptions(
          builder.environments.client,
          new ChunkMetadataMap(),
        ),
      ).toThrow(
        /Either "build\.lib\.entry" or the top-level "input" option is required/,
      )
    })
  })
})

/**
 * 文件名矩阵：用户函数/字符串、package name、入口别名、package type 与 format
 * 共同决定 `.js/.mjs/.cjs` 以及 UMD/IIFE 后缀。
 */
describe('resolveLibFilename', () => {
  /** 场景：lib.fileName 是接收 format 的函数；验证目标：ES 产物使用函数返回的 custom-filename-function.es.js。 */
  test('custom filename function', () => {
    const filename = resolveLibFilename(
      {
        /** 返回携带 format 的显式文件名，验证字符串结果不再经过扩展名推导。 */
        fileName: (format) => `custom-filename-function.${format}.js`,
        entry: 'mylib.js',
      },
      'es',
      'myLib',
      resolve(dirname, 'packages/name'),
    )

    expect(filename).toBe('custom-filename-function.es.js')
  })

  /** 场景：lib.fileName 是无扩展名字符串；验证目标：ES 格式按包类型补成 custom-filename.mjs。 */
  test('custom filename string', () => {
    const filename = resolveLibFilename(
      {
        fileName: 'custom-filename',
        entry: 'mylib.js',
      },
      'es',
      'myLib',
      resolve(dirname, 'packages/name'),
    )

    expect(filename).toBe('custom-filename.mjs')
  })

  /** 场景：未配置 fileName 且 package.json 有名称；验证目标：库 JS 文件名基于包名 mylib。 */
  test('package name as filename', () => {
    const filename = resolveLibFilename(
      {
        entry: 'mylib.js',
      },
      'es',
      'myLib',
      resolve(dirname, 'packages/name'),
    )

    expect(filename).toBe('mylib.mjs')
  })

  /** 场景：项目无 package name 但显式配置 fileName；验证目标：仍使用 custom-filename 并补 ES 扩展名。 */
  test('custom filename and no package name', () => {
    const filename = resolveLibFilename(
      {
        fileName: 'custom-filename',
        entry: 'mylib.js',
      },
      'es',
      'myLib',
      resolve(dirname, 'packages/noname'),
    )

    expect(filename).toBe('custom-filename.mjs')
  })

  /** 场景：未配置 fileName 且当前目录无包名；验证目标：向上找到最近 package name 生成 named-testing-package.mjs。 */
  test('missing filename', () => {
    const filename = resolveLibFilename(
      {
        entry: 'mylib.js',
      },
      'es',
      'myLib',
      resolve(dirname, 'packages/noname'),
    )
    expect(filename).toBe('named-testing-package.mjs')
  })

  /** 场景：CommonJS package 下分别生成 ES、UMD、CJS、IIFE；验证目标：扩展名依次为 mjs、umd.js、js、iife.js。 */
  test('commonjs package extensions', () => {
    const formatsToFilenames: FormatsToFileNames = [
      ['es', 'my-lib.mjs'],
      ['umd', 'my-lib.umd.js'],
      ['cjs', 'my-lib.js'],
      ['iife', 'my-lib.iife.js'],
    ]

    for (const [format, expectedFilename] of formatsToFilenames) {
      const filename = resolveLibFilename(
        baseLibOptions,
        format,
        'myLib',
        resolve(dirname, 'packages/noname'),
      )

      expect(filename).toBe(expectedFilename)
    }
  })

  /** 场景：type=module package 下生成四种库格式；验证目标：ES 用 js，UMD/CJS 用 cjs 兼容扩展名。 */
  test('module package extensions', () => {
    const formatsToFilenames: FormatsToFileNames = [
      ['es', 'my-lib.js'],
      ['umd', 'my-lib.umd.cjs'],
      ['cjs', 'my-lib.cjs'],
      ['iife', 'my-lib.iife.js'],
    ]

    for (const [format, expectedFilename] of formatsToFilenames) {
      const filename = resolveLibFilename(
        baseLibOptions,
        format,
        'myLib',
        resolve(dirname, 'packages/module'),
      )

      expect(expectedFilename).toBe(filename)
    }
  })

  /** 场景：对象式多入口提供 entryA/entryB 别名且无 fileName；验证目标：每个别名独立生成同名 mjs。 */
  test('multiple entries with aliases', () => {
    const libOptions: LibraryOptions = {
      entry: {
        entryA: 'entryA.js',
        entryB: 'entryB.js',
      },
    }

    const [fileName1, fileName2] = ['entryA', 'entryB'].map((entryAlias) =>
      resolveLibFilename(
        libOptions,
        'es',
        entryAlias,
        resolve(dirname, 'packages/name'),
      ),
    )

    expect(fileName1).toBe('entryA.mjs')
    expect(fileName2).toBe('entryB.mjs')
  })

  /** 场景：对象式多入口搭配接收 entryAlias 的 fileName 函数；验证目标：两个文件名分别包含对应别名与格式。 */
  test('multiple entries with aliases: custom filename function', () => {
    const libOptions: LibraryOptions = {
      entry: {
        entryA: 'entryA.js',
        entryB: 'entryB.js',
      },
      /** 用 entryAlias 与 format 区分多入口输出，验证回调参数准确传入。 */
      fileName: (format, entryAlias) =>
        `custom-filename-function.${entryAlias}.${format}.js`,
    }

    const [fileName1, fileName2] = ['entryA', 'entryB'].map((entryAlias) =>
      resolveLibFilename(
        libOptions,
        'es',
        entryAlias,
        resolve(dirname, 'packages/name'),
      ),
    )

    expect(fileName1).toBe('custom-filename-function.entryA.es.js')
    expect(fileName2).toBe('custom-filename-function.entryB.es.js')
  })

  /** 场景：对象式多入口搭配固定 fileName 字符串；验证目标：每个入口都按该字符串生成 custom-filename.mjs。 */
  test('multiple entries with aliases: custom filename string', () => {
    const libOptions: LibraryOptions = {
      entry: {
        entryA: 'entryA.js',
        entryB: 'entryB.js',
      },
      fileName: 'custom-filename',
    }

    const [fileName1, fileName2] = ['entryA', 'entryB'].map((entryAlias) =>
      resolveLibFilename(
        libOptions,
        'es',
        entryAlias,
        resolve(dirname, 'packages/name'),
      ),
    )

    expect(fileName1).toBe('custom-filename.mjs')
    expect(fileName2).toBe('custom-filename.mjs')
  })

  /** 场景：数组式多入口且无 fileName；验证目标：入口推导名分别生成 entryA.mjs 与 entryB.mjs。 */
  test('multiple entries as array', () => {
    const libOptions: LibraryOptions = {
      entry: ['entryA.js', 'entryB.js'],
    }

    const [fileName1, fileName2] = ['entryA', 'entryB'].map((entryAlias) =>
      resolveLibFilename(
        libOptions,
        'es',
        entryAlias,
        resolve(dirname, 'packages/name'),
      ),
    )

    expect(fileName1).toBe('entryA.mjs')
    expect(fileName2).toBe('entryB.mjs')
  })

  /** 场景：数组式多入口搭配 fileName 函数；验证目标：函数收到每个入口别名并生成两个不同文件名。 */
  test('multiple entries as array: custom filename function', () => {
    const libOptions: LibraryOptions = {
      entry: ['entryA.js', 'entryB.js'],
      /** 用 entryAlias 与 format 区分多入口输出，验证回调参数准确传入。 */
      fileName: (format, entryAlias) =>
        `custom-filename-function.${entryAlias}.${format}.js`,
    }

    const [fileName1, fileName2] = ['entryA', 'entryB'].map((entryAlias) =>
      resolveLibFilename(
        libOptions,
        'es',
        entryAlias,
        resolve(dirname, 'packages/name'),
      ),
    )

    expect(fileName1).toBe('custom-filename-function.entryA.es.js')
    expect(fileName2).toBe('custom-filename-function.entryB.es.js')
  })

  /** 场景：数组式多入口搭配固定 fileName；验证目标：两个入口都使用 custom-filename.mjs。 */
  test('multiple entries as array: custom filename string', () => {
    const libOptions: LibraryOptions = {
      entry: ['entryA.js', 'entryB.js'],
      fileName: 'custom-filename',
    }

    const [fileName1, fileName2] = ['entryA', 'entryB'].map((entryAlias) =>
      resolveLibFilename(
        libOptions,
        'es',
        entryAlias,
        resolve(dirname, 'packages/name'),
      ),
    )

    expect(fileName1).toBe('custom-filename.mjs')
    expect(fileName2).toBe('custom-filename.mjs')
  })
})

/** 回归矩阵：单/多入口的默认 formats，以及数组 output 与 asset 发射的环境语义。 */
describe('resolveBuildOutputs', () => {
  /** 场景：单入口 library build 未声明 formats；验证目标：默认输出 ES 与 UMD，并把对象式 output.name 合并到两者。 */
  test('default format: one entry', () => {
    const libOptions: LibraryOptions = {
      entry: 'entryA.js',
      name: 'entryA',
    }

    expect(resolveBuildOutputs(undefined, libOptions, {} as Logger)).toEqual([
      { format: 'es' },
      { format: 'umd' },
    ])
    expect(
      resolveBuildOutputs({ name: 'A' }, libOptions, {} as Logger),
    ).toEqual([
      { format: 'es', name: 'A' },
      { format: 'umd', name: 'A' },
    ])
    expect(
      resolveBuildOutputs([{ name: 'A' }], libOptions, {} as Logger),
    ).toEqual([{ name: 'A' }])
  })

  /** 场景：多入口 library build 未声明 formats；验证目标：默认输出 ES 与 CJS，避免不支持多入口的 UMD。 */
  test('default format: multiple entries', () => {
    const libOptions: LibraryOptions = {
      entry: ['entryA.js', 'entryB.js'],
    }

    expect(resolveBuildOutputs(undefined, libOptions, {} as Logger)).toEqual([
      { format: 'es' },
      { format: 'cjs' },
    ])
    expect(
      resolveBuildOutputs({ name: 'A' }, libOptions, {} as Logger),
    ).toEqual([
      { format: 'es', name: 'A' },
      { format: 'cjs', name: 'A' },
    ])
    expect(
      resolveBuildOutputs([{ name: 'A' }], libOptions, {} as Logger),
    ).toEqual([{ name: 'A' }])
  })

  /** 场景：多入口 library build 请求 UMD 或 IIFE；验证目标：解析明确拒绝这些不支持多入口的格式。 */
  test('umd or iife: should not support multiple entries', () => {
    ;['umd', 'iife'].forEach((format) => {
      expect(() =>
        resolveBuildOutputs(
          undefined,
          {
            entry: ['entryA.js', 'entryB.js'],
            formats: [format as LibraryFormats],
          },
          {} as Logger,
        ),
      ).toThrow(
        `Multiple entry points are not supported when output formats include "umd" or "iife".`,
      )
    })
  })

  /** 场景：单入口请求 UMD 或 IIFE 但未设置 lib.name；验证目标：两种格式都抛出全局名称必填错误。 */
  test('umd or iife: should define build.lib.name', () => {
    ;['umd', 'iife'].forEach((format) => {
      expect(() =>
        resolveBuildOutputs(
          undefined,
          {
            entry: 'entryA.js',
            formats: [format as LibraryFormats],
          },
          {} as Logger,
        ),
      ).toThrow(
        `Option "build.lib.name" is required when output formats include "umd" or "iife".`,
      )
    })
  })

  /** 场景：显式 output 数组与 build.lib.formats 冲突；验证目标：数组原样胜出，并记录 formats 被忽略的警告。 */
  test('array outputs: should ignore build.lib.formats', () => {
    const log = { warn: vi.fn() } as unknown as Logger
    expect(
      resolveBuildOutputs(
        [{ name: 'A' }],
        {
          entry: 'entryA.js',
          formats: ['es'],
        },
        log,
      ),
    ).toEqual([{ name: 'A' }])
    expect(log.warn).toHaveBeenLastCalledWith(
      colors.yellow(
        `"build.lib.formats" will be ignored because "build.rolldownOptions.output" is already an array format.`,
      ),
    )
  })

  /** 场景：SSR 构建开启 ssrEmitAssets；验证目标：SSR 输出同时包含 index.mjs 与带哈希 CSS 资产。 */
  test('ssrEmitAssets', async () => {
    const result = await build({
      root: resolve(dirname, 'fixtures/emit-assets'),
      logLevel: 'silent',
      build: {
        ssr: true,
        ssrEmitAssets: true,
        rolldownOptions: {
          input: {
            index: '/entry',
          },
        },
      },
    })
    expect(result).toMatchObject({
      output: [
        {
          fileName: 'index.mjs',
        },
        {
          fileName: expect.stringMatching(/assets\/index-[-\w]{8}\.css/),
        },
      ],
    })
  })

  /** 场景：自定义环境开启 emitAssets；验证目标：该环境输出 JS 与带哈希 CSS 资产。 */
  test('emitAssets', async () => {
    const builder = await createBuilder({
      root: resolve(dirname, 'fixtures/emit-assets'),
      logLevel: 'warn',
      environments: {
        ssr: {
          build: {
            ssr: true,
            emitAssets: true,
            rolldownOptions: {
              input: {
                index: '/entry',
              },
            },
          },
        },
      },
    })
    const result = await builder.build(builder.environments.ssr)
    expect(result).toMatchObject({
      output: [
        {
          fileName: 'index.mjs',
        },
        {
          fileName: expect.stringMatching(/assets\/index-[-\w]{8}\.css/),
        },
      ],
    })
  })

  /** 场景：SSR 构建使用内置 preload 配置；验证目标：服务端 chunk 不注入浏览器 preload helper。 */
  test('ssr builtin', async () => {
    const builder = await createBuilder({
      root: resolve(dirname, 'fixtures/dynamic-import'),
      logLevel: 'warn',
      environments: {
        ssr: {
          build: {
            ssr: true,
            rolldownOptions: {
              input: {
                index: '/entry',
              },
            },
          },
        },
      },
    })
    const result = await builder.build(builder.environments.ssr)
    expect((result as RolldownOutput).output[0].code).not.toContain('preload')
  })

  /** 场景：名为 custom 的 Environment 设置 build.ssr=true；构建其动态导入入口后，服务端 chunk 仍不包含浏览器 preload 代码。 */
  test('ssr custom', async () => {
    const builder = await createBuilder({
      root: resolve(dirname, 'fixtures/dynamic-import'),
      logLevel: 'warn',
      environments: {
        custom: {
          build: {
            ssr: true,
            rolldownOptions: {
              input: {
                index: '/entry',
              },
            },
          },
        },
      },
    })
    const result = await builder.build(builder.environments.custom)
    expect((result as RolldownOutput).output[0].code).not.toContain('preload')
  })
})

/** 场景：通过旧 build() API 执行单环境构建；验证目标：共享配置只解析一次，插件 config 钩子只调用一次。 */
test('default sharedConfigBuild true on build api', async () => {
  let counter = 0
  await build({
    root: resolve(dirname, 'fixtures/emit-assets'),
    logLevel: 'warn',
    build: {
      ssr: true,
      rolldownOptions: {
        input: {
          index: '/entry',
        },
      },
    },
    plugins: [
      {
        name: 'test-plugin',
        /** 记录旧 build API 解析共享配置时插件 config 钩子的实际调用次数。 */
        config() {
          counter++
        },
      },
    ],
  })
  expect(counter).toBe(1)
})

/** for 的两行分别开启/关闭 sharedPlugins；每行依次构建默认 client、默认 SSR、显式 minify=true 的 custom1 与 minify=false 的 custom2，同一入口输出行数应为 [1,8,1,8]，验证插件是否共享不影响各环境压缩配置。 */
test.for([true, false])(
  'minify per environment (builder.sharedPlugins: %s)',
  async (sharedPlugins) => {
    const root = resolve(dirname, 'fixtures/shared-plugins/minify')
    const builder = await createBuilder({
      root,
      logLevel: 'warn',
      environments: {
        client: {
          build: {
            outDir: './dist/client',
            rolldownOptions: {
              input: '/entry.js',
            },
          },
        },
        ssr: {
          build: {
            outDir: './dist/server',
            rolldownOptions: {
              input: '/entry.js',
            },
          },
        },
        custom1: {
          build: {
            minify: true,
            outDir: './dist/custom1',
            rolldownOptions: {
              input: '/entry.js',
            },
          },
        },
        custom2: {
          build: {
            minify: false,
            outDir: './dist/custom2',
            rolldownOptions: {
              input: '/entry.js',
            },
          },
        },
      },
      builder: {
        sharedPlugins,
      },
    })
    const client = await builder.build(builder.environments.client)
    const ssr = await builder.build(builder.environments.ssr)
    const custom1 = await builder.build(builder.environments.custom1)
    const custom2 = await builder.build(builder.environments.custom2)
    expect(
      ([client, ssr, custom1, custom2] as RolldownOutput[]).map(
        (o) => o.output[0].code.split('\n').length,
      ),
    ).toEqual([1, 8, 1, 8])
  },
)

/** 场景：client 启用 chunkImportMap、SSR 关闭且 sharedPlugins=true；验证目标：只有 client 发射 import map，环境配置不经共享插件实例泄漏。 */
test('chunkImportMap per environment with shared plugins', async () => {
  const root = resolve(dirname, 'fixtures/shared-plugins/chunk-import-map')
  let client: RolldownOutput | undefined
  let ssr: RolldownOutput | undefined
  const builder = await createBuilder({
    root,
    logLevel: 'warn',
    environments: {
      client: {
        build: {
          chunkImportMap: true,
          write: false,
          rolldownOptions: {
            input: '/entry.js',
          },
        },
      },
      ssr: {
        build: {
          chunkImportMap: false,
          ssr: true,
          write: false,
          rolldownOptions: {
            input: '/entry.js',
          },
        },
      },
    },
    builder: {
      sharedPlugins: true,
      /** 在同一共享插件 builder 中依次捕获 client 与 SSR 产物，检查环境配置隔离。 */
      async buildApp(builder) {
        client = (await builder.build(
          builder.environments.client,
        )) as RolldownOutput
        ssr = (await builder.build(builder.environments.ssr)) as RolldownOutput
      },
    },
  })

  await builder.buildApp()

  const entry = client!.output.find(
    (output): output is OutputChunk =>
      output.type === 'chunk' && output.isEntry,
  )!
  const css = client!.output.find(
    (output) => output.type === 'asset' && output.fileName.endsWith('.css'),
  )!
  const importMapAsset = client!.output.find(
    (output) => output.type === 'asset' && output.fileName === 'importmap.json',
  )!
  expect(
    ssr!.output.some(
      (output) =>
        output.type === 'asset' && output.fileName === 'importmap.json',
    ),
  ).toBe(false)
  const importMap = JSON.parse(importMapAsset.source.toString())
    .imports as Record<string, string>
  const cssSpecifier = Object.entries(importMap).find(
    ([, fileName]) => fileName === `/${css.fileName}`,
  )![0]
  expect(entry.code).toContain(JSON.stringify(cssSpecifier.slice(1)))
})

/** 场景：emitAssets=false 但启用自定义 chunkImportMap 文件名；验证目标：构建仍发射 custom-importmap.json。 */
test('chunkImportMap is emitted when emitAssets is false', async () => {
  const root = resolve(dirname, 'fixtures/shared-plugins/chunk-import-map')
  const builder = await createBuilder({
    root,
    logLevel: 'warn',
    environments: {
      ssr: {
        build: {
          ssr: true,
          emitAssets: false,
          write: false,
          chunkImportMap: true,
          rolldownOptions: {
            input: '/entry.js',
            experimental: {
              chunkImportMap: {
                fileName: 'custom-importmap.json',
              },
            },
          },
        },
      },
    },
  })

  const result = (await builder.build(
    builder.environments.ssr,
  )) as RolldownOutput

  expect(result.output).toContainEqual(
    expect.objectContaining({
      type: 'asset',
      fileName: 'custom-importmap.json',
    }),
  )
})

/** 场景：SSR 环境显式启用 chunkImportMap；验证目标：SSR 输出包含 importmap.json。 */
test('chunkImportMap is emitted for SSR when enabled', async () => {
  const root = resolve(dirname, 'fixtures/shared-plugins/chunk-import-map')
  const builder = await createBuilder({
    root,
    logLevel: 'warn',
    environments: {
      ssr: {
        build: {
          ssr: true,
          chunkImportMap: true,
          write: false,
          rolldownOptions: {
            input: '/entry.js',
          },
        },
      },
    },
  })

  const result = (await builder.build(
    builder.environments.ssr,
  )) as RolldownOutput

  expect(result.output).toContainEqual(
    expect.objectContaining({
      type: 'asset',
      fileName: 'importmap.json',
    }),
  )
})

/** chunkImportMap=false 且 emitAssets=false 时，插件主动发射的同名普通 importmap.json 资产也被移除。 */
test('importmap named asset is not emitted when chunkImportMap is false', async () => {
  const root = resolve(dirname, 'fixtures/shared-plugins/chunk-import-map')
  const builder = await createBuilder({
    root,
    logLevel: 'warn',
    plugins: [
      {
        name: 'emit-importmap-named-asset',
        /** 主动发射同名 importmap.json 资产，用于区分普通资产与 chunkImportMap 产物。 */
        buildStart() {
          this.emitFile({
            type: 'asset',
            fileName: 'importmap.json',
            source: '{}',
          })
        },
      },
    ],
    environments: {
      ssr: {
        build: {
          ssr: true,
          emitAssets: false,
          write: false,
          rolldownOptions: {
            input: '/entry.js',
          },
        },
      },
    },
  })

  const result = (await builder.build(
    builder.environments.ssr,
  )) as RolldownOutput

  expect(result.output).not.toContainEqual(
    expect.objectContaining({
      type: 'asset',
      fileName: 'importmap.json',
    }),
  )
})

/** sharedConfigBuild=true 且 client/ssr/custom 各设 emitAssets:true 与不同 outDir；先核对三个解析值，再 buildApp 检查三个输出目录都含 CSS。 */
test('sharedConfigBuild and emitAssets', async () => {
  const root = resolve(dirname, 'fixtures/shared-config-build/emitAssets')
  const builder = await createBuilder({
    root,
    logLevel: 'warn',
    configFile: false,
    environments: {
      client: {
        build: {
          outDir: './dist/client',
          emitAssets: true,
          rolldownOptions: {
            input: '/entry.js',
          },
        },
      },
      ssr: {
        build: {
          outDir: './dist/ssr',
          emitAssets: true,
          rolldownOptions: {
            input: '/entry.js',
          },
        },
      },
      custom: {
        build: {
          outDir: './dist/custom',
          emitAssets: true,
          rolldownOptions: {
            input: '/entry.js',
          },
        },
      },
    },
    builder: {
      sharedConfigBuild: true,
    },
  })

  expect(
    ['client', 'ssr', 'custom'].map(
      (name) => builder.environments[name].config.build.emitAssets,
    ),
  ).toEqual([true, true, true])

  await builder.buildApp()

  expect(
    await Promise.all(
      ['client', 'ssr', 'custom'].map((name) =>
        fsp.readdir(
          resolve(
            root,
            builder.environments[name].config.build.outDir,
            'assets',
          ),
        ),
      ),
    ),
  ).toEqual([
    expect.arrayContaining([expect.stringMatching(/\.css$/)]),
    expect.arrayContaining([expect.stringMatching(/\.css$/)]),
    expect.arrayContaining([expect.stringMatching(/\.css$/)]),
  ])
})

/** 场景：lib.entry 由顶层 input 补齐；验证目标：解析结果获得 src/main.ts，而用户传入的 lib 对象仍无 entry。 */
test('resolving lib entry from the top-level input does not mutate the user config', async () => {
  const userLib: LibraryOptions = { formats: ['es'] }
  const config = await resolveConfig(
    {
      configFile: false,
      input: 'src/main.ts',
      build: { lib: userLib },
    },
    'build',
  )
  const resolvedLib = config.environments.client.build.lib
  assert(resolvedLib !== false)
  expect(resolvedLib.entry).toBe('src/main.ts')
  expect(userLib.entry).toBeUndefined()
})

/** 日志适配矩阵：Vite 默认处理、用户 onLog/onwarn、插件名前缀与致命未解析导入。 */
describe('onRollupLog', () => {
  const pluginName = 'rollup-plugin-test'
  const msgInfo = 'This is the INFO message.'
  const msgWarn = 'This is the WARN message.'
  /** 执行一次带可控日志回调的构建，把插件日志送入被测适配层。 */
  const buildProject = async (
    level: LogLevel | 'error',
    message: string | RollupLog,
    logger: Logger,
    options?: Pick<RolldownOptions, 'onLog' | 'onwarn'>,
  ) => {
    await build({
      root: resolve(dirname, 'packages/build-project'),
      logLevel: 'info',
      build: {
        write: false,
        rolldownOptions: {
          ...options,
          logLevel: 'debug',
        },
      },
      customLogger: logger,
      plugins: [
        {
          name: pluginName,
          /** 在解析日志测试入口时发出指定级别消息，并返回虚拟入口 ID。 */
          resolveId(id) {
            this[level](message)
            if (id === 'entry.js') {
              return '\0' + id
            }
          },
          /** 为日志适配场景的虚拟入口提供最小可构建源码。 */
          load(id) {
            if (id === '\0entry.js') {
              return `export default "This is test module";`
            }
          },
        },
      ],
    })
  }

  /** 创建 client BuildEnvironment 并直接调用日志适配器，覆盖无需完整构建的错误分支。 */
  const callOnRollupLog = async (
    logger: Logger,
    level: LogLevel,
    log: RollupLog,
  ) => {
    const config = await resolveConfig(
      { customLogger: logger },
      'build',
      'production',
      'production',
    )
    const buildEnvironment = new BuildEnvironment('client', config)
    onRollupLog(level, log, buildEnvironment)
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** 场景：Rolldown 插件发出 info 日志；验证目标：Vite logger 输出带插件名前缀的消息。 */
  test('Rollup logs of info should be handled by vite', async () => {
    const logger = createLogger()
    const loggerSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})

    await buildProject('info', msgInfo, logger)
    const logs = loggerSpy.mock.calls.map((args) =>
      stripVTControlCharacters(args[0]),
    )
    expect(logs).contain(`[plugin ${pluginName}] ${msgInfo}`)
  })

  /** 场景：Rolldown 插件发出 warn 日志；验证目标：Vite logger 输出带插件名前缀的警告。 */
  test('Rollup logs of warn should be handled by vite', async () => {
    const logger = createLogger('silent')
    const loggerSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})

    await buildProject('warn', msgWarn, logger)
    const logs = loggerSpy.mock.calls.map((args) =>
      stripVTControlCharacters(args[0]),
    )
    expect(logs).contain(`[plugin ${pluginName}] ${msgWarn}`)
  })

  /** 场景：用户提供 onLog；验证目标：插件 info 以结构化 message/plugin 信息传给该回调。 */
  test('onLog passed by user is called', async () => {
    const logger = createLogger('silent')

    const onLogInfo = vi.fn((_log: RollupLog) => {})
    await buildProject('info', msgInfo, logger, {
      /** 捕获用户 onLog 收到的 info 级别与结构化插件日志。 */
      onLog(level, log) {
        if (level === 'info') {
          onLogInfo(log)
        }
      },
    })
    expect(onLogInfo).toBeCalledWith(
      expect.objectContaining({ message: msgInfo, plugin: pluginName }),
    )
  })

  /** 场景：用户提供旧式 onwarn；验证目标：插件 warning 以结构化日志对象传给该回调。 */
  test('onwarn passed by user is called', async () => {
    const logger = createLogger('silent')

    const onWarn = vi.fn((_log: RollupLog) => {})
    await buildProject('warn', msgWarn, logger, {
      /** 捕获兼容 onwarn 收到的结构化 warning。 */
      onwarn(warning) {
        onWarn(warning)
      },
    })
    expect(onWarn).toBeCalledWith(
      expect.objectContaining({ message: msgWarn, plugin: pluginName }),
    )
  })

  /** 场景：warn 日志代码为 UNRESOLVED_IMPORT；验证目标：Vite 将其升级为包含解析失败提示的构建错误。 */
  test('should throw error when warning contains UNRESOLVED_IMPORT', async () => {
    const logger = createLogger()
    await expect(() =>
      callOnRollupLog(logger, 'warn', {
        code: 'UNRESOLVED_IMPORT',
        message: 'test',
      }),
    ).rejects.toThrowError(/Rolldown failed to resolve import/)
  })

  /** 动态导入变量插件分别报告 Unsupported expression 与 statically analyzed 两种消息；调用日志适配器后 warn 均不得被调用。 */
  test.each([[`Unsupported expression`], [`statically analyzed`]])(
    'should ignore dynamic import warnings (%s)',
    async (message: string) => {
      const logger = createLogger()
      const loggerSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})

      await callOnRollupLog(logger, 'warn', {
        code: 'PLUGIN_WARNING',
        message: message,
        plugin: 'rollup-plugin-dynamic-import-variables',
      })
      expect(loggerSpy).toBeCalledTimes(0)
    },
  )

  /** 分别以 CIRCULAR_DEPENDENCY 与 THIS_IS_UNDEFINED 两种 code 调用日志适配器；warn 调用次数应均为零。 */
  test.each([[`CIRCULAR_DEPENDENCY`], [`THIS_IS_UNDEFINED`]])(
    'should ignore some warnings (%s)',
    async (code: string) => {
      const logger = createLogger()
      const loggerSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})

      await callOnRollupLog(logger, 'warn', {
        code: code,
        message: 'test message',
        plugin: pluginName,
      })
      expect(loggerSpy).toBeCalledTimes(0)
    },
  )
})

/** 同一 Environment 连续执行两次构建，第二次删除动态 import 后，manifest 不再含 dep.js 旧记录。 */
test('watch rebuild manifest', async (ctx) => {
  // 不启动长期 watcher，而是复用同一 Environment 连续构建两次，模拟重建时 manifest
  // 状态必须清空：删除动态 import 后，旧 dep key 不得残留。
  const root = resolve(dirname, 'fixtures/watch-rebuild-manifest')
  const builder = await createBuilder({
    root,
    logLevel: 'error',
    environments: {
      client: {
        build: {
          rolldownOptions: {
            input: '/entry.js',
          },
        },
      },
    },
    build: {
      manifest: true,
    },
  })

  /** 从内存产物读取 manifest.json，并返回当前构建登记的模块键。 */
  function getManifestKeys(output: RolldownOutput) {
    return Object.keys(
      JSON.parse(
        (output.output.find((o) => o.fileName === '.vite/manifest.json') as any)
          .source,
      ),
    )
  }

  const result = await builder.build(builder.environments.client)
  expect(getManifestKeys(result as RolldownOutput)).toMatchInlineSnapshot(`
    [
      "dep.js",
      "entry.js",
    ]
  `)

  const entry = resolve(root, 'entry.js')
  const content = await fsp.readFile(entry, 'utf-8')
  await fsp.writeFile(
    entry,
    content.replace(`import('./dep.js')`, `'dep.js removed'`),
  )
  ctx.onTestFinished(async () => {
    await fsp.writeFile(entry, content)
  })

  const result2 = await builder.build(builder.environments.client)
  expect(getManifestKeys(result2 as RolldownOutput)).toMatchInlineSnapshot(`
    [
      "entry.js",
    ]
  `)
})

/** 场景：同一环境先以 write=false 构建再切换为 write=true；验证目标：第二轮仍准备输出目录并复制 public 资产。 */
test('copies public directory after building same environment with write false first', async (ctx) => {
  const root = resolve(dirname, 'fixtures/public-dir-write-false')
  ctx.onTestFinished(() =>
    fsp.rm(resolve(root, 'dist'), { recursive: true, force: true }),
  )

  const builder = await createBuilder({
    root,
    configFile: false,
    logLevel: 'silent',
  })

  builder.environments.client.config.build.write = false
  await builder.build(builder.environments.client)

  builder.environments.client.config.build.write = true
  await builder.build(builder.environments.client)

  await expect(
    fsp.readFile(resolve(root, 'dist/favicon.svg'), 'utf-8'),
  ).resolves.toBe('<svg></svg>')
})

/**
 * 对两次输出中的同名 chunk 校验内容一致；若内容不同，文件名 hash 就必须变化，
 * 防止 CDN 继续命中旧内容。
 */
function assertOutputHashContentChange(
  output1: RolldownOutput,
  output2: RolldownOutput,
) {
  for (const chunk of output1.output) {
    if (chunk.type === 'chunk') {
      const chunk2 = output2.output.find(
        (c) => c.type === 'chunk' && c.fileName === chunk.fileName,
      ) as OutputChunk | undefined
      if (chunk2) {
        expect(
          chunk.code,
          `the ${chunk.fileName} chunk has the same hash but different contents between builds`,
        ).toEqual(chunk2.code)
      }
    }
  }
}

/** 按产物逻辑名称比较两次构建文件名，分出哈希变化与未变化集合。 */
function getOutputHashChanges(
  output1: RolldownOutput,
  output2: RolldownOutput,
) {
  const map1 = Object.fromEntries(
    output1.output.map((o) => [o.name, o.fileName]),
  )
  const map2 = Object.fromEntries(
    output2.output.map((o) => [o.name, o.fileName]),
  )
  const names = Object.keys(map1).filter(Boolean)
  return {
    changed: names.filter((name) => map1[name] !== map2[name]),
    unchanged: names.filter((name) => map1[name] === map2[name]),
  }
}
