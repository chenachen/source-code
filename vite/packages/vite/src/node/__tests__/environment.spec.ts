import path from 'node:path'
import { describe, expect, onTestFinished, test } from 'vitest'
import type { RolldownOutput } from 'rolldown'
import { createServer } from '../server'
import type { InlineConfig } from '../config'
import { createBuilder } from '../build'
import { createServerModuleRunner } from '../ssr/runtime/serverModuleRunner'

describe('custom environment conditions', () => {
  /**
   * 构造四个运行目标：默认 SSR、worker，以及两个条件完全相同但名称不同的自定义环境。
   * `noExternal` 用于让同一组条件分别经过 Vite 转换管线和原生外部模块加载路径。
   */
  function getConfig({
    noExternal,
  }: {
    /** 控制依赖由 Vite 内联转换还是交给原生 external 加载，以交叉验证条件解析。 */
    noExternal: true | undefined
  }): InlineConfig {
    return {
      configFile: false,
      root: import.meta.dirname,
      logLevel: 'error',
      server: {
        middlewareMode: true,
        ws: false,
      },
      // 此组用例不读取 client，关闭其入口扫描，避免无关的缺少 index.html 警告。
      optimizeDeps: { entries: [] },
      environments: {
        // 默认 SSR 环境不追加条件，应命中包的 default export condition。
        ssr: {
          resolve: {
            noExternal,
          },
          build: {
            outDir: path.join(
              import.meta.dirname,
              'fixtures/test-dep-conditions/dist/ssr',
            ),
            rolldownOptions: {
              input: { index: '@vitejs/test-dep-conditions' },
            },
          },
        },
        // worker 环境应命中包的 worker export condition。
        worker: {
          resolve: {
            noExternal,
            conditions: ['worker'],
            externalConditions: ['worker'],
          },
          build: {
            outDir: path.join(
              import.meta.dirname,
              'fixtures/test-dep-conditions/dist/worker',
            ),
            rolldownOptions: {
              input: { index: '@vitejs/test-dep-conditions' },
            },
          },
        },
        // 自定义环境把同一条件同时用于 Vite 解析和原生 external 解析。
        custom1: {
          resolve: {
            noExternal,
            conditions: ['custom1'],
            externalConditions: ['custom1'],
          },
          build: {
            outDir: path.join(
              import.meta.dirname,
              'fixtures/test-dep-conditions/dist/custom1',
            ),
            rolldownOptions: {
              input: { index: '@vitejs/test-dep-conditions' },
            },
          },
        },
        // 与 custom1 配置相同但实例不同，用来排除“按名称写死结果”的假阳性。
        custom1_2: {
          resolve: {
            noExternal,
            conditions: ['custom1'],
            externalConditions: ['custom1'],
          },
          build: {
            outDir: path.join(
              import.meta.dirname,
              'fixtures/test-dep-conditions/dist/custom1_2',
            ),
            rolldownOptions: {
              input: { index: '@vitejs/test-dep-conditions' },
            },
          },
        },
      },
    }
  }

  /**
   * 场景：依赖设为 noExternal，由四个 DevEnvironment 各自解析、转换并执行同一个包。
   * 验证目标：确认 resolve conditions 属于 Environment 配置，独立模块图/插件上下文不会把
   * SSR、worker 与 custom1 的条件结果串在一起。
   */
  test('dev noExternal', async () => {
    const server = await createServer(getConfig({ noExternal: true }))
    onTestFinished(() => server.close())

    const results: Record<string, unknown> = {}
    for (const key of ['ssr', 'worker', 'custom1', 'custom1_2']) {
      const runner = createServerModuleRunner(server.environments[key], {
        hmr: {
          logger: false,
        },
        sourcemapInterceptor: false,
      })
      const mod = await runner.import('@vitejs/test-dep-conditions')
      results[key] = mod.default
    }
    expect(results).toMatchInlineSnapshot(`
      {
        "custom1": "index.custom1.js",
        "custom1_2": "index.custom1.js",
        "ssr": "index.default.js",
        "worker": "index.worker.js",
      }
    `)
  })

  /**
   * 场景：依赖保持 external，由 ModuleRunner 中的原生加载路径选择 package exports。
   * 验证目标：确认 externalConditions 与普通 conditions 一样按 Environment 生效；两个使用
   * custom1 条件的实例应得相同文件，但仍是两条独立执行链。
   */
  test('dev external', async () => {
    const server = await createServer(getConfig({ noExternal: undefined }))
    onTestFinished(() => server.close())

    const results: Record<string, unknown> = {}
    for (const key of ['ssr', 'worker', 'custom1', 'custom1_2']) {
      const runner = createServerModuleRunner(server.environments[key], {
        hmr: {
          logger: false,
        },
        sourcemapInterceptor: false,
      })
      const mod = await runner.import(
        '/fixtures/test-dep-conditions-app/entry.js',
      )
      results[key] = mod.default
    }
    expect(results).toMatchInlineSnapshot(`
      {
        "custom1": "index.custom1.js",
        "custom1_2": "index.custom1.js",
        "ssr": "index.default.js",
        "worker": "index.worker.js",
      }
    `)
  })

  /**
   * 场景：旧 `server.ssrLoadModule()` 兼容入口分别加载 JS 和内联 CSS。
   * 验证目标：确认兼容 API 仍代理到默认 SSR Environment；JS 采用 default condition，CSS
   * 经过同一 Environment 的插件配置正常生成字符串导出。
   */
  test('css', async () => {
    const server = await createServer(getConfig({ noExternal: true }))
    onTestFinished(() => server.close())

    const modJs = await server.ssrLoadModule(
      '/fixtures/test-dep-conditions-app/entry.js',
    )
    const modCss = await server.ssrLoadModule(
      '/fixtures/test-dep-conditions-app/entry.css?inline',
    )
    expect([modCss.default.replace(/\s+/g, ' '), modJs.default])
      .toMatchInlineSnapshot(`
      [
        ".test-css { color: orange; } ",
        "index.default.js",
      ]
    `)
  })

  /**
   * 场景：Builder 依次构建 SSR、worker 和两个自定义 BuildEnvironment，再执行产物。
   * 验证目标：确认 Environment 级 resolve conditions 不只是开发态概念；构建实例也使用同一
   * 配置隔离模型，并为各运行目标选择对应 package export。
   */
  test('build', async () => {
    const builder = await createBuilder(getConfig({ noExternal: true }))
    const results: Record<string, unknown> = {}
    for (const key of ['ssr', 'worker', 'custom1', 'custom1_2']) {
      const output = await builder.build(builder.environments[key])
      const chunk = (output as RolldownOutput).output[0]
      const mod = await import(
        path.join(
          import.meta.dirname,
          'fixtures/test-dep-conditions/dist',
          key,
          chunk.fileName,
        )
      )
      results[key] = mod.default
    }
    expect(results).toMatchInlineSnapshot(`
      {
        "custom1": "index.custom1.js",
        "custom1_2": "index.custom1.js",
        "ssr": "index.default.js",
        "worker": "index.worker.js",
      }
    `)
  })
})
