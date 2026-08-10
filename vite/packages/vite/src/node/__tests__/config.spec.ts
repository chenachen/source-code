import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { stripVTControlCharacters } from 'node:util'
import { afterEach, assert, describe, expect, test, vi } from 'vitest'
import type { InlineConfig, PluginOption } from '..'
import type { UserConfig, UserConfigExport } from '../config'
import { defineConfig, loadConfigFromFile, resolveConfig } from '../config'
import { resolveServerOptions } from '../server'
import { resolveEnvPrefix } from '../env'
import {
  hasBothRollupOptionsAndRolldownOptions,
  mergeConfig,
  normalizePath,
} from '../utils'
import { createLogger } from '../logger'
import type { Logger } from '../logger'
import { isWindows } from '../../shared/utils'

describe('mergeConfig', () => {
  /**
   * 场景：低优先级配置使用 Alias 数组，高优先级配置使用对象简写。
   *
   * 验证目标：两种 schema 都会规范化为数组；高优先级 alias 排在前面，因为 resolver
   * 自上而下首次命中即停止。
   */
  test('handles configs with different alias schemas', () => {
    const baseConfig = defineConfig({
      resolve: {
        alias: [
          {
            find: 'foo',
            replacement: 'foo-value',
          },
        ],
      },
    })

    const newConfig = defineConfig({
      resolve: {
        alias: {
          bar: 'bar-value',
          baz: 'baz-value',
        },
      },
    })

    const mergedConfig: UserConfigExport = {
      resolve: {
        alias: [
          {
            find: 'bar',
            replacement: 'bar-value',
          },
          {
            find: 'baz',
            replacement: 'baz-value',
          },
          {
            find: 'foo',
            replacement: 'foo-value',
          },
        ],
      },
    }

    expect(mergeConfig(baseConfig, newConfig)).toEqual(mergedConfig)
  })

  /**
   * 场景：两侧 alias 都使用对象简写，并包含同名 `bar`。
   * 验证目标：保持对象 schema；新配置覆盖同名键，其他键取并集。
   */
  test('keep object alias schema', () => {
    const baseConfig = {
      resolve: {
        alias: {
          bar: 'bar-value',
          baz: 'baz-value',
        },
      },
    }

    const newConfig = {
      resolve: {
        alias: {
          bar: 'bar-value-2',
          foo: 'foo-value',
        },
      },
    }

    const mergedConfig = {
      resolve: {
        alias: {
          bar: 'bar-value-2',
          baz: 'baz-value',
          foo: 'foo-value',
        },
      },
    }

    expect(mergeConfig(baseConfig, newConfig)).toEqual(mergedConfig)
  })

  /**
   * 场景：普通配置字段一侧为标量、一侧为数组。
   * 验证目标：普通数组采用追加语义，标量先数组化并保持低→高优先级顺序。
   */
  test('handles arrays', () => {
    const baseConfig: UserConfigExport = {
      envPrefix: 'string1',
    }

    const newConfig: UserConfigExport = {
      envPrefix: ['string2', 'string3'],
    }

    const mergedConfig: UserConfigExport = {
      envPrefix: ['string1', 'string2', 'string3'],
    }

    expect(mergeConfig(baseConfig, newConfig)).toEqual(mergedConfig)
  })

  /**
   * 场景：`assetsInclude` 同时包含字符串、数组和 RegExp。
   * 验证目标：该顶层字段专门按列表追加，不能让新数组整体覆盖旧匹配规则。
   */
  test('handles assetsInclude', () => {
    const baseConfig: UserConfigExport = {
      assetsInclude: 'some-string',
    }

    const newConfig: UserConfigExport = {
      assetsInclude: ['some-other-string', /regexp?/],
    }

    const mergedConfig: UserConfigExport = {
      assetsInclude: ['some-string', 'some-other-string', /regexp?/],
    }

    expect(mergeConfig(baseConfig, newConfig)).toEqual(mergedConfig)
  })

  /**
   * 场景：顶层 input 以字符串、数组、命名对象的全部组合出现。
   *
   * 验证目标：字符串/数组追加；遇到命名对象时全部转成对象；高优先级对象覆盖同名
   * entry；任一侧缺省时保留另一侧。覆盖 #22642 引入的入口合并规则。
   */
  test('handles input', () => {
    const cases: {
      /** 便于失败信息定位的合并组合名称。 */
      name: string
      /** 低优先级 input。 */
      a: UserConfig['input']
      /** 高优先级 input。 */
      b: UserConfig['input']
      /** 两侧按顶层 input 规则合并后的结果。 */
      expected: UserConfig['input']
    }[] = [
      {
        name: 'string + string',
        a: 'src/a.ts',
        b: 'src/b.ts',
        expected: ['src/a.ts', 'src/b.ts'],
      },
      {
        name: 'array + string',
        a: ['src/a.ts'],
        b: 'src/b.ts',
        expected: ['src/a.ts', 'src/b.ts'],
      },
      {
        name: 'string + array',
        a: 'src/a.ts',
        b: ['src/b.ts'],
        expected: ['src/a.ts', 'src/b.ts'],
      },
      {
        name: 'array + array',
        a: ['src/a.ts'],
        b: ['src/b.ts'],
        expected: ['src/a.ts', 'src/b.ts'],
      },
      {
        name: 'object + object',
        a: { a: 'src/a.ts', shared: 'src/old.ts' },
        b: { b: 'src/b.ts', shared: 'src/new.ts' },
        expected: { a: 'src/a.ts', b: 'src/b.ts', shared: 'src/new.ts' },
      },
      {
        name: 'string + object',
        a: 'src/a.ts',
        b: { b: 'src/b.ts' },
        expected: { a: 'src/a.ts', b: 'src/b.ts' },
      },
      {
        name: 'object + string',
        a: { a: 'src/a.ts' },
        b: 'src/b.ts',
        expected: { a: 'src/a.ts', b: 'src/b.ts' },
      },
      {
        name: 'array + object',
        a: ['src/a.ts'],
        b: { b: 'src/b.ts' },
        expected: { a: 'src/a.ts', b: 'src/b.ts' },
      },
      {
        name: 'only a',
        a: 'src/a.ts',
        b: undefined,
        expected: 'src/a.ts',
      },
      {
        name: 'only b',
        a: undefined,
        b: 'src/b.ts',
        expected: 'src/b.ts',
      },
    ]

    for (const { name, a, b, expected } of cases) {
      expect(mergeConfig({ input: a }, { input: b }), name).toStrictEqual({
        input: expected,
      })
    }
  })

  /**
   * 场景：名为 input 的字段位于 `build` 内，而不是 Vite 顶层入口。
   * 验证目标：专属 mergeInput 只在根路径生效；普通嵌套标量仍由高优先级值覆盖。
   */
  test('not handles input not at top level', () => {
    const baseConfig = {
      build: {
        input: 'src/a.ts',
      },
    }

    const newConfig = {
      build: {
        input: 'src/b.ts',
      },
    }

    // 嵌套 input 走普通字段规则：覆盖，不追加。
    const mergedConfig = {
      build: {
        input: 'src/b.ts',
      },
    }

    expect(mergeConfig(baseConfig, newConfig)).toEqual(mergedConfig)
  })

  /**
   * 场景：业务自定义对象中也存在名为 alias 的字段。
   * 验证目标：Vite alias 特殊顺序只应用于顶层/resolve.alias；其他 alias 按普通对象
   * 递归合并，避免配置工具错误解释用户数据。
   */
  test('not handles alias not under `resolve`', () => {
    const baseConfig = {
      custom: {
        alias: {
          bar: 'bar-value',
          baz: 'baz-value',
        },
      },
    }

    const newConfig = {
      custom: {
        alias: {
          bar: 'bar-value-2',
          foo: 'foo-value',
        },
      },
    }

    const mergedConfig = {
      custom: {
        alias: {
          bar: 'bar-value-2',
          baz: 'baz-value',
          foo: 'foo-value',
        },
      },
    }

    expect(mergeConfig(baseConfig, newConfig)).toEqual(mergedConfig)
  })

  /**
   * 场景：低优先级字段为 null，高优先级字段为数组。
   * 验证目标：null 视为没有可合并的旧值，直接采用新数组，不生成 `[null, ...]`。
   */
  test('merge array correctly', () => {
    const baseConfig = {
      foo: null,
    }

    const newConfig = {
      foo: ['bar'],
    }

    const mergedConfig = {
      foo: ['bar'],
    }

    expect(mergeConfig(baseConfig, newConfig)).toEqual(mergedConfig)
  })

  /**
   * 场景：SSR external/noExternal 一侧为 `true`，另一侧为包名数组。
   * 验证目标：`true` 表示全量规则，语义强于有限数组；无论合并方向都必须保留 true。
   */
  test('handles ssr.noExternal', () => {
    const baseConfig: UserConfig = {
      ssr: {
        noExternal: true,
        external: true,
      },
    }

    const newConfig: UserConfig = {
      ssr: {
        noExternal: ['foo'],
        external: ['bar'],
      },
    }

    const mergedConfig: UserConfig = {
      ssr: {
        noExternal: true,
        external: true,
      },
    }

    // 两种合并方向都应让全量 noExternal/external 规则拥有最高语义优先级。
    expect(mergeConfig(baseConfig, newConfig)).toEqual(mergedConfig)
    expect(mergeConfig(newConfig, baseConfig)).toEqual(mergedConfig)
  })

  /**
   * 场景：同样的 noExternal 规则位于 `environments.ssr.resolve`。
   * 验证目标：递归进入 `environments.<name>` 后要重置路径语义，使 resolve 专属 true
   * 规则仍然生效；这是 #20077 修复的核心场景。
   */
  test('handles environments.*.resolve.noExternal', () => {
    const baseConfig = {
      environments: {
        ssr: {
          resolve: {
            noExternal: true,
          },
        },
      },
    }

    const newConfig = {
      environments: {
        ssr: {
          resolve: {
            noExternal: ['foo'],
          },
        },
      },
    }

    const mergedConfig = {
      environments: {
        ssr: {
          resolve: {
            noExternal: true,
          },
        },
      },
    }

    // 两种合并方向都必须保留全量 noExternal。
    expect(mergeConfig(baseConfig, newConfig)).toEqual(mergedConfig)
    expect(mergeConfig(newConfig, baseConfig)).toEqual(mergedConfig)
  })

  /**
   * 场景：旧顶层 `ssr.noExternal` 与新 Environment API
   * `environments.ssr.resolve.noExternal` 同时配置。
   *
   * 验证目标：兼容迁移合并后 true 仍强于数组，不因新旧配置入口方向不同而改变。
   */
  test('merge ssr.noExternal and environments.ssr.resolve.noExternal', async () => {
    const oldTrue = await resolveConfig(
      {
        ssr: {
          noExternal: true,
        },
        environments: {
          ssr: {
            resolve: {
              noExternal: ['dep'],
            },
          },
        },
      },
      'serve',
    )
    expect(oldTrue.environments.ssr.resolve.noExternal).toEqual(true)

    const newTrue = await resolveConfig(
      {
        ssr: {
          noExternal: ['dep'],
        },
        environments: {
          ssr: {
            resolve: {
              noExternal: true,
            },
          },
        },
      },
      'serve',
    )
    expect(newTrue.environments.ssr.resolve.noExternal).toEqual(true)
  })

  /**
   * 场景：`server.ws.server` 保存真实 Node HTTP Server 实例，两侧引用同一对象。
   * 验证目标：非纯对象不能被递归克隆或展开，合并结果必须保持实例引用。
   */
  test('handles server.ws.server', () => {
    const httpServer = http.createServer()

    const baseConfig = { server: { ws: { server: httpServer } } }
    const newConfig = { server: { ws: { server: httpServer } } }

    const mergedConfig = mergeConfig(baseConfig, newConfig)

    // HTTP Server 实例必须保持引用，不能被重新创建。
    expect(mergedConfig.server.ws.server).toBe(httpServer)
  })

  /**
   * 场景：allowedHosts 一侧为有限域名数组，另一侧为允许全部的 true。
   * 验证目标：true 语义更强，不能被数组追加规则转换成混合数组。
   */
  test('handles server.allowedHosts', () => {
    const baseConfig = {
      server: { allowedHosts: ['example.com'] },
    }

    const newConfig = {
      server: { allowedHosts: true },
    }

    const mergedConfig = {
      server: {
        allowedHosts: true,
        hmr: expect.any(Object),
        ws: expect.any(Object),
      },
    }

    expect(mergeConfig(baseConfig, newConfig)).toEqual(mergedConfig)
  })

  /**
   * 场景：调用方试图直接合并两个函数式配置。
   * 验证目标：类型层和运行时都拒绝；函数必须先用 ConfigEnv 执行，否则没有确定对象可
   * 合并。两个断言分别覆盖低优先级和高优先级函数。
   */
  test('throws error with functions', () => {
    const baseConfig = defineConfig(() => ({ base: 'base' }))
    const newConfig = defineConfig(() => ({ base: 'new' }))

    expect(() =>
      mergeConfig(
        // 类型层也应禁止把函数传给 mergeConfig。
        // @ts-expect-error TypeScript shouldn't give you to pass a function as argument
        baseConfig,
        newConfig,
      ),
    ).toThrowError('Cannot merge config in form of callback')

    expect(() =>
      mergeConfig(
        {},
        // @ts-expect-error TypeScript shouldn't give you to pass a function as argument
        newConfig,
      ),
    ).toThrowError('Cannot merge config in form of callback')
  })

  /**
   * 场景：build、worker、optimizeDeps、ssr.optimizeDeps 两侧都使用新
   * `rolldownOptions`。
   *
   * 验证目标：四个配置根递归合并；兼容 `rollupOptions` getter 与新字段读取到同一最终
   * 对象。
   */
  test('handles `rolldownOptions`', () => {
    const baseConfig = defineConfig({
      build: {
        rolldownOptions: {
          treeshake: false,
        },
      },
      worker: {
        rolldownOptions: {
          treeshake: false,
        },
      },
      optimizeDeps: {
        rolldownOptions: {
          treeshake: false,
        },
      },
      ssr: {
        optimizeDeps: {
          rolldownOptions: {
            treeshake: false,
          },
        },
      },
    })

    const newConfig = defineConfig({
      build: {
        rolldownOptions: {
          output: {
            minifyInternalExports: true,
          },
        },
      },
      worker: {
        rolldownOptions: {
          output: {
            minifyInternalExports: true,
          },
        },
      },
      optimizeDeps: {
        rolldownOptions: {
          output: {
            minifyInternalExports: true,
          },
        },
      },
      ssr: {
        optimizeDeps: {
          rolldownOptions: {
            output: {
              minifyInternalExports: true,
            },
          },
        },
      },
    })

    const mergedConfig = mergeConfig(baseConfig, newConfig)

    const expected = {
      treeshake: false,
      output: {
        minifyInternalExports: true,
      },
    }
    expect(mergedConfig.build.rollupOptions).toStrictEqual(expected)
    expect(mergedConfig.build.rolldownOptions).toStrictEqual(expected)
    expect(mergedConfig.worker.rollupOptions).toStrictEqual(expected)
    expect(mergedConfig.worker.rolldownOptions).toStrictEqual(expected)
    expect(mergedConfig.optimizeDeps.rollupOptions).toStrictEqual(expected)
    expect(mergedConfig.optimizeDeps.rolldownOptions).toStrictEqual(expected)
    expect(mergedConfig.ssr.optimizeDeps.rollupOptions).toStrictEqual(expected)
    expect(mergedConfig.ssr.optimizeDeps.rolldownOptions).toStrictEqual(
      expected,
    )
  })

  /**
   * 场景：再次覆盖四个根路径中的嵌套 Rolldown output 字段。
   * 验证目标：treeshake 与 output 递归合并，并确保 build/worker/依赖优化路径采用一致
   * 规则，防止只修复顶层 build。
   */
  test('handles `build.rolldownOptions`', () => {
    const baseConfig = defineConfig({
      build: {
        rolldownOptions: {
          treeshake: false,
        },
      },
      worker: {
        rolldownOptions: {
          treeshake: false,
        },
      },
      optimizeDeps: {
        rolldownOptions: {
          treeshake: false,
        },
      },
      ssr: {
        optimizeDeps: {
          rolldownOptions: {
            treeshake: false,
          },
        },
      },
    })

    const newConfig = defineConfig({
      build: {
        rolldownOptions: {
          output: {
            minifyInternalExports: true,
          },
        },
      },
      worker: {
        rolldownOptions: {
          output: {
            minifyInternalExports: true,
          },
        },
      },
      optimizeDeps: {
        rolldownOptions: {
          output: {
            minifyInternalExports: true,
          },
        },
      },
      ssr: {
        optimizeDeps: {
          rolldownOptions: {
            output: {
              minifyInternalExports: true,
            },
          },
        },
      },
    })

    const mergedConfig = mergeConfig(baseConfig, newConfig)

    const expected = {
      treeshake: false,
      output: {
        minifyInternalExports: true,
      },
    }
    expect(mergedConfig.build.rollupOptions).toStrictEqual(expected)
    expect(mergedConfig.build.rolldownOptions).toStrictEqual(expected)
    expect(mergedConfig.worker.rollupOptions).toStrictEqual(expected)
    expect(mergedConfig.worker.rolldownOptions).toStrictEqual(expected)
    expect(mergedConfig.optimizeDeps.rollupOptions).toStrictEqual(expected)
    expect(mergedConfig.optimizeDeps.rolldownOptions).toStrictEqual(expected)
    expect(mergedConfig.ssr.optimizeDeps.rollupOptions).toStrictEqual(expected)
    expect(mergedConfig.ssr.optimizeDeps.rolldownOptions).toStrictEqual(
      expected,
    )
  })

  /**
   * 场景：低优先级仍使用旧 `rollupOptions`，高优先级混用新旧字段。
   *
   * 验证目标：迁移时新字段优先，四个根路径都建立双向实时代理；修改旧字段返回对象
   * 后，新字段立即看到同一变化，而不是只在首次解析时复制。
   */
  test('syncs `build.rollupOptions` and `build.rolldownOptions`', () => {
    const baseConfig = defineConfig({
      build: {
        rollupOptions: {
          treeshake: false,
        },
      },
      worker: {
        rollupOptions: {
          treeshake: false,
        },
      },
      optimizeDeps: {
        rollupOptions: {
          treeshake: false,
        },
      },
      ssr: {
        optimizeDeps: {
          rollupOptions: {
            treeshake: false,
          },
        },
      },
    })

    const newConfig = defineConfig({
      build: {
        rolldownOptions: {
          output: {
            minifyInternalExports: true,
          },
        },
      },
      worker: {
        rolldownOptions: {
          output: {
            minifyInternalExports: true,
          },
        },
      },
      optimizeDeps: {
        rolldownOptions: {
          output: {
            minifyInternalExports: true,
          },
        },
      },
      ssr: {
        optimizeDeps: {
          rollupOptions: {
            output: {
              minifyInternalExports: true,
            },
          },
        },
      },
    })

    const mergedConfig = mergeConfig(baseConfig, newConfig) as UserConfig

    const expected = {
      treeshake: false,
      output: {
        minifyInternalExports: true,
      },
    }
    expect(mergedConfig.build!.rollupOptions).toStrictEqual(expected)
    expect(mergedConfig.build!.rolldownOptions).toStrictEqual(expected)
    expect(mergedConfig.worker!.rollupOptions).toStrictEqual(expected)
    expect(mergedConfig.worker!.rolldownOptions).toStrictEqual(expected)
    expect(mergedConfig.optimizeDeps!.rollupOptions).toStrictEqual(expected)
    expect(mergedConfig.optimizeDeps!.rolldownOptions).toStrictEqual(expected)
    expect(mergedConfig.ssr!.optimizeDeps!.rollupOptions).toStrictEqual(
      expected,
    )
    expect(mergedConfig.ssr!.optimizeDeps!.rolldownOptions).toStrictEqual(
      expected,
    )

    const upOutput = mergedConfig.build!.rollupOptions!.output!
    if (Array.isArray(upOutput)) throw new Error()
    const downOutput = mergedConfig.build!.rolldownOptions!.output!
    if (Array.isArray(downOutput)) throw new Error()
    upOutput.hashCharacters = 'base36'
    expect(upOutput.hashCharacters).toBe('base36')
    expect(downOutput.hashCharacters).toBe('base36')
  })

  /**
   * 场景：用户只提供旧 rollupOptions，mergeConfig 自动创建新字段代理。
   *
   * 验证目标：两个属性指向同一对象时不应误报“同时显式配置两套选项”；覆盖 #22043。
   */
  test('hasBothRollupOptionsAndRolldownOptions returns false when only rollupOptions is set', () => {
    // 低优先级必须已有 build 对象，递归合并才会进入 build 根并安装兼容代理。
    const baseConfig = defineConfig({
      build: {},
    })
    const newConfig = defineConfig({
      build: {
        rollupOptions: {
          treeshake: false,
        },
      },
    })
    const mergedConfig: UserConfig = mergeConfig(baseConfig, newConfig)

    expect(mergedConfig.build!.rollupOptions).toBeDefined()
    expect(mergedConfig.build!.rolldownOptions).toBeDefined()
    expect(mergedConfig.build!.rollupOptions).toBe(
      mergedConfig.build!.rolldownOptions,
    )

    expect(hasBothRollupOptionsAndRolldownOptions(mergedConfig)).toBe(false)
  })

  /**
   * 场景：用户确实同时提供内容不同的 rollupOptions 和 rolldownOptions。
   * 验证目标：两者不是兼容代理同一对象时返回 true，供配置校验输出迁移告警。
   */
  test('hasBothRollupOptionsAndRolldownOptions returns true when both are explicitly set to different values', () => {
    const config = defineConfig({
      build: {
        rollupOptions: {
          treeshake: false,
        },
        rolldownOptions: {
          platform: 'neutral',
        },
      },
    })
    expect(hasBothRollupOptionsAndRolldownOptions(config)).toBe(true)
  })

  /**
   * 场景：插件通过 `configEnvironment` 分别使用旧、新字段设置 SSR platform。
   * 验证目标：两种写法都落到 `rolldownOptions.platform`；只影响 SSR，client 继续保持
   * browser 默认值。
   */
  test('rollupOptions/rolldownOptions.platform', async () => {
    const testRollupOptions = await resolveConfig(
      {
        plugins: [
          {
            name: 'set-rollupOptions-platform',
            /** 用旧 rollupOptions 写入 SSR platform。 */
            configEnvironment(name) {
              if (name === 'ssr') {
                return {
                  build: {
                    rollupOptions: {
                      platform: 'neutral',
                    },
                  },
                }
              }
            },
          },
        ],
      },
      'serve',
    )
    expect(
      testRollupOptions.environments.ssr.build.rolldownOptions.platform,
    ).toBe('neutral')
    expect(
      testRollupOptions.environments.client.build.rolldownOptions.platform,
    ).toBe('browser')

    const testRolldownOptions = await resolveConfig(
      {
        plugins: [
          {
            name: 'set-rollupOptions-platform',
            /** 用新 rolldownOptions 写入 SSR platform。 */
            configEnvironment(name) {
              if (name === 'ssr') {
                return {
                  build: {
                    rolldownOptions: {
                      platform: 'neutral',
                    },
                  },
                }
              }
            },
          },
        ],
      },
      'serve',
    )
    expect(
      testRolldownOptions.environments.ssr.build.rolldownOptions.platform,
    ).toBe('neutral')
    expect(
      testRolldownOptions.environments.client.build.rolldownOptions.platform,
    ).toBe('browser')
  })

  /**
   * 场景：配置已经 resolve 后，插件重新赋值 rollupOptions 或 rolldownOptions。
   * 验证目标：顶层、client、ssr 三份 build 配置都保留 getter/setter 实时代理，而不是
   * 在解析完成后退化成两个独立快照。
   */
  test('resolved build options keep rollupOptions as a live proxy of rolldownOptions', async () => {
    const config = await resolveConfig({}, 'serve')

    for (const build of [
      config.build,
      config.environments.client.build,
      config.environments.ssr.build,
    ]) {
      // 新字段重新赋值后，旧字段 getter 必须返回新对象。
      const newOptions = { treeshake: false }
      build.rolldownOptions = newOptions
      expect(build.rollupOptions).toBe(newOptions)

      // 通过旧字段 setter 赋值，也必须更新真正存储的新字段。
      const newerOptions = { treeshake: true }
      build.rollupOptions = newerOptions
      expect(build.rolldownOptions).toBe(newerOptions)
    }
  })

  /**
   * 场景：用户只配置旧 `server.hmr` 下的 WebSocket 连接字段。
   * 验证目标：#21357 迁移层把 protocol/host/port/clientPort/path/timeout 同步到新
   * `server.ws`，旧对象继续通过代理可读。
   */
  test('syncs `server.hmr.*` to `server.ws.*`', () => {
    const baseConfig = defineConfig({
      server: {
        hmr: {
          protocol: 'wss',
          host: 'example.com',
          port: 3001,
          clientPort: 443,
          path: '/ws',
          timeout: 60000,
        },
      },
    })

    const mergedConfig = mergeConfig(
      {
        server: { ws: {} },
      },
      baseConfig,
    )

    expect(mergedConfig.server.ws).toStrictEqual({
      protocol: 'wss',
      host: 'example.com',
      port: 3001,
      clientPort: 443,
      path: '/ws',
      timeout: 60000,
    })
    expect(mergedConfig.server.hmr).toStrictEqual({
      protocol: 'wss',
      host: 'example.com',
      port: 3001,
      clientPort: 443,
      path: '/ws',
      timeout: 60000,
      server: undefined,
    })
  })

  /**
   * 场景：低优先级使用新 server.ws，高优先级插件仍写旧 server.hmr。
   * 验证目标：旧字段按配置优先级覆盖新字段，并让两个入口最终保持一致。
   */
  test('mergeConfig works with `server.ws` and `server.hmr`', () => {
    const baseConfig = defineConfig({
      server: {
        ws: {
          host: 'old-host.com',
          port: 3001,
        },
      },
    })

    const newConfig = defineConfig({
      server: {
        hmr: {
          host: 'new-host.com',
          port: 3002,
        },
      },
    })

    const mergedConfig = mergeConfig(baseConfig, newConfig)

    expect(mergedConfig.server.ws.host).toBe('new-host.com')
    expect(mergedConfig.server.hmr.host).toBe('new-host.com')
    expect(mergedConfig.server.ws.port).toBe(3002)
    expect(mergedConfig.server.hmr.port).toBe(3002)
  })

  /**
   * 场景：`overlay` 仍是 HMR UI 行为，不是 WebSocket 连接参数。
   * 验证目标：只迁移 wsOptionKeys；overlay 留在 server.hmr，不能污染 server.ws。
   */
  test('`server.hmr.overlay` is not mapped to `server.ws.overlay`', () => {
    const config = mergeConfig(
      {},
      defineConfig({
        server: {
          hmr: {
            overlay: false,
          },
        },
      }),
    )

    expect(config.server.hmr.overlay).toBe(false)
    // overlay 不属于连接选项，不应同步到 ws。
    expect(config.server.ws?.overlay).toBeUndefined()
  })

  /**
   * 场景：完整 resolveConfig 处理旧 HMR 配置后，插件在 resolved 阶段继续修改旧字段。
   * 验证目标：初始迁移和后续实时代理都有效，修改 hmr.host 会同步更新 ws.host。
   */
  test('resolveConfig properly syncs hmr and ws', async () => {
    const config = await resolveConfig(
      {
        server: {
          hmr: {
            host: 'test-host.com',
            port: 4000,
          },
        },
      },
      'serve',
    )

    assert(typeof config.server.ws === 'object')
    expect(config.server.ws.host).toBe('test-host.com')
    expect(config.server.ws.port).toBe(4000)

    assert(typeof config.server.hmr === 'object')
    config.server.hmr!.host = 'new-host.com'

    expect(config.server.ws.host).toBe('new-host.com')
    expect(config.server.hmr.host).toBe('new-host.com')
  })

  /**
   * 场景：较早执行的插件返回新版 `rolldownOptions`，较晚插件仍从兼容字段
   * `rollupOptions` 读取配置。
   * 验证目标：兼容代理必须在每次插件配置合并后立即建立，而不是等所有插件结束后
   * 才统一转换；否则后续插件会读不到前一个插件的配置（#21612）。
   */
  describe('later plugin can read `rollupOptions` set via `rolldownOptions` in earlier plugin', () => {
    /**
     * 场景：插件 A 在顶层 build/worker 中写入 rolldownOptions。
     * 验证目标：紧随其后的插件 B 可从两个旧 rollupOptions 入口读到相同值。
     */
    test('top-level config', async () => {
      expect.assertions(2)
      await resolveConfig(
        {
          plugins: [
            {
              name: 'plugin-a',
              /** 在顶层 build 与 worker 写入新字段。 */
              config() {
                return {
                  build: {
                    rolldownOptions: {
                      platform: 'neutral',
                    },
                  },
                  worker: {
                    rolldownOptions: {
                      platform: 'neutral',
                    },
                  },
                }
              },
            },
            {
              name: 'plugin-b',
              /** 从兼容旧字段读取前一插件刚写入的 platform。 */
              config(config) {
                expect(config.build?.rollupOptions?.platform).toBe('neutral')
                expect(config.worker?.rollupOptions?.platform).toBe('neutral')
              },
            },
          ],
        },
        'build',
      )
    })

    /**
     * 场景：初始配置没有 environments，插件 A 首次创建 ssr 环境并写入 rolldownOptions。
     * 验证目标：新建环境同样立即获得兼容代理，插件 B 可通过 rollupOptions 读取。
     */
    test('new `environments` object', async () => {
      expect.assertions(1)
      await resolveConfig(
        {
          plugins: [
            {
              name: 'plugin-a',
              /** 首次创建 ssr Environment 并写入新字段。 */
              config() {
                return {
                  environments: {
                    ssr: {
                      build: {
                        rolldownOptions: {
                          platform: 'neutral',
                        },
                      },
                    },
                  },
                }
              },
            },
            {
              name: 'plugin-b',
              /** 验证新建 Environment 已立即安装旧字段代理。 */
              config(config) {
                expect(
                  config.environments?.ssr?.build?.rollupOptions?.platform,
                ).toBe('neutral')
              },
            },
          ],
        },
        'build',
      )
    })

    /**
     * 场景：初始配置已有 client 环境，插件 A 再追加此前不存在的 ssr 环境。
     * 验证目标：兼容处理必须遍历合并后的环境集合，不能只处理初始环境。
     */
    test('new environment on existing `environments` object', async () => {
      expect.assertions(1)
      await resolveConfig(
        {
          environments: {
            // environments 已存在，但还没有 ssr；该分支专门覆盖“追加新环境”。
            client: {},
          },
          plugins: [
            {
              name: 'plugin-a',
              /** 向已有 environments 对象追加 ssr 配置。 */
              config() {
                return {
                  environments: {
                    ssr: {
                      build: {
                        rolldownOptions: {
                          platform: 'neutral',
                        },
                      },
                    },
                  },
                }
              },
            },
            {
              name: 'plugin-b',
              /** 验证追加 Environment 同样可从旧字段读取配置。 */
              config(config) {
                expect(
                  config.environments?.ssr?.build?.rollupOptions?.platform,
                ).toBe('neutral')
              },
            },
          ],
        },
        'build',
      )
    })
  })
})

describe('resolveEnvPrefix', () => {
  /**
   * 场景：用户未配置 `envPrefix`。
   * 验证目标：默认只公开以 `VITE_` 开头的环境变量，并统一返回数组形式。
   */
  test(`use 'VITE_' as default value`, () => {
    const config: UserConfig = {}
    expect(resolveEnvPrefix(config)).toMatchObject(['VITE_'])
  })

  /**
   * 场景：用户把单个前缀或前缀数组中的某项设为空字符串。
   * 验证目标：空字符串会匹配所有 `process.env` 键，存在把密钥打入客户端的风险，
   * 因此必须抛错，而不是把它当成“禁用前缀过滤”。
   */
  test(`throw error if envPrefix contains ''`, () => {
    let config: UserConfig = { envPrefix: '' }
    expect(() => resolveEnvPrefix(config)).toThrow()
    config = { envPrefix: ['', 'CUSTOM_'] }
    expect(() => resolveEnvPrefix(config)).toThrow()
  })

  /**
   * 场景：前缀包含空格。
   * 验证目标：这类前缀在合法 shell/`.env` 变量名中无法实际匹配，Vite 应逐次告警，
   * 帮助用户发现无效配置（#21292）。
   */
  test(`show a warning message if envPrefix contains a whitespace`, () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {})
    let config: UserConfig = { envPrefix: 'WITH SPACE' }
    resolveEnvPrefix(config)
    expect(consoleWarnSpy).toHaveBeenCalled()
    config = { envPrefix: ['CUSTOM_', 'ANOTHER SPACE'] }
    resolveEnvPrefix(config)
    expect(consoleWarnSpy).toHaveBeenCalledTimes(2)
    consoleWarnSpy.mockRestore()
  })

  /**
   * 场景：用户提供合法的自定义前缀数组。
   * 验证目标：保持用户前缀，不再额外加入默认 `VITE_`。
   */
  test('should work correctly for valid envPrefix value', () => {
    const config: UserConfig = { envPrefix: ['CUSTOM_'] }
    expect(resolveEnvPrefix(config)).toMatchObject(['CUSTOM_'])
  })
})

/** preview 配置合并矩阵：默认继承 server，但端口独立，显式 preview 字段优先。 */
describe('preview config', () => {
  /** 构造 preview 应继承的 server 配置基线。 */
  const serverConfig = () => ({
    port: 3003,
    strictPort: true,
    host: true,
    open: true,
    headers: {
      'Cache-Control': 'no-store',
    },
    proxy: { '/foo': 'http://localhost:4567' },
    cors: true,
  })

  /** 场景：只配置 server。验证目标：通用字段继承，但 preview 端口使用独立默认值 4173。 */
  test('preview inherits server config with default port', async () => {
    const config: InlineConfig = {
      server: serverConfig(),
    }
    expect(await resolveConfig(config, 'serve')).toMatchObject({
      preview: {
        ...serverConfig(),
        port: 4173,
      },
    })
  })

  /** 场景：preview 只覆盖端口。验证目标：其余字段仍逐项继承 server 配置。 */
  test('preview inherits server config with port override', async () => {
    const config: InlineConfig = {
      server: serverConfig(),
      preview: {
        port: 3006,
      },
    }
    expect(await resolveConfig(config, 'serve')).toMatchObject({
      preview: {
        ...serverConfig(),
        port: 3006,
      },
    })
  })

  /** 构造与 server 冲突的显式 preview 覆盖值。 */
  const previewConfig = () => ({
    port: 3006,
    strictPort: false,
    open: false,
    host: false,
    proxy: { '/bar': 'http://localhost:3010' },
    cors: false,
  })

  /** 场景：preview 提供完整冲突值。验证目标：所有显式 preview 值都优先于 server。 */
  test('preview overrides server config', async () => {
    const config: InlineConfig = {
      server: serverConfig(),
      preview: previewConfig(),
    }
    expect(await resolveConfig(config, 'serve')).toMatchObject({
      preview: previewConfig(),
    })
  })
})

describe('resolveConfig', () => {
  /** 返回新配置对象的 config 钩子，用于覆盖“返回值合并”路径。 */
  const keepScreenMergePlugin = (): PluginOption => {
    return {
      name: 'vite-plugin-keep-screen-merge',
      /** 通过返回对象把 clearScreen 合并为 false。 */
      config() {
        return { clearScreen: false }
      },
    }
  }

  /** 原地修改收到配置的 config 钩子，用于覆盖“不返回值”路径。 */
  const keepScreenOverridePlugin = (): PluginOption => {
    return {
      name: 'vite-plugin-keep-screen-override',
      /** 原地把收到的 clearScreen 改为 false。 */
      config(config) {
        config.clearScreen = false
      },
    }
  }

  /**
   * 场景：插件通过 config 钩子返回 `{ clearScreen: false }`。
   * 验证目标：插件返回值会合入当前配置，且能够覆盖用户内联的 true。
   */
  test('plugin merges `clearScreen` option', async () => {
    const config1: InlineConfig = { plugins: [keepScreenMergePlugin()] }
    const config2: InlineConfig = {
      plugins: [keepScreenMergePlugin()],
      clearScreen: true,
    }

    const results1 = await resolveConfig(config1, 'build')
    const results2 = await resolveConfig(config2, 'build')

    expect(results1.clearScreen).toBe(false)
    expect(results2.clearScreen).toBe(false)
  })

  /**
   * 场景：插件直接原地修改传入的 config，并不返回新对象。
   * 验证目标：resolveConfig 保留原地修改，不要求插件必须返回配置。
   */
  test('plugin overrides `clearScreen` option', async () => {
    const config1: InlineConfig = { plugins: [keepScreenOverridePlugin()] }
    const config2: InlineConfig = {
      plugins: [keepScreenOverridePlugin()],
      clearScreen: true,
    }

    const results1 = await resolveConfig(config1, 'build')
    const results2 = await resolveConfig(config2, 'build')

    expect(results1.clearScreen).toBe(false)
    expect(results2.clearScreen).toBe(false)
  })

  /**
   * 场景：项目 root 含 `?`、`#`、`*`，会与 URL query/hash 或 glob 语义冲突。
   * 验证目标：不阻断跨平台合法路径，但必须给出重命名告警（#15761、#19683）。
   */
  test('resolveConfig with root path including "#" and "?" and "*" should warn ', async () => {
    expect.assertions(1)

    const logger = createLogger('info')
    logger.warn = (str) => {
      expect(str).to.include(
        'Consider renaming the directory without the characters',
      )
    }

    await resolveConfig({ root: './inc?ud#s*', customLogger: logger }, 'build')
  })

  /**
   * 场景：用户完全不配置新旧打包器字段。
   * 验证目标：build、worker、optimizeDeps 的旧 rollupOptions 都是新
   * rolldownOptions 的兼容视图，而不是彼此脱节的默认对象。
   */
  test('syncs `build.rollupOptions` and `build.rolldownOptions`', async () => {
    const resolved = await resolveConfig({}, 'build')
    expect(resolved.build!.rollupOptions).toStrictEqual(
      resolved.build!.rolldownOptions,
    )
    expect(resolved.worker!.rollupOptions).toStrictEqual(
      resolved.worker!.rolldownOptions,
    )
    expect(resolved.optimizeDeps!.rollupOptions).toStrictEqual(
      resolved.optimizeDeps!.rolldownOptions,
    )
  })

  /**
   * 场景：只使用顶层 input。
   * 验证目标：它作为旧入口只传给 client Environment，且保持环境入口身份，不能误塞进
   * build.rolldownOptions.input；SSR 也不能继承浏览器入口（#22642）。
   */
  test('top-level input applies to the client environment only (non-inherit)', async () => {
    const config = await resolveConfig({ input: 'src/main.ts' }, 'serve')

    expect(config.input).toBe('src/main.ts')
    expect(config.environments.client.input).toBe('src/main.ts')
    expect(
      config.environments.client.build.rolldownOptions.input,
    ).toBeUndefined()
    expect(config.environments.ssr.input).toBeUndefined()
    expect(config.environments.ssr.build.rolldownOptions.input).toBeUndefined()
  })

  /**
   * 场景：顶层声明 client 入口，ssr Environment 声明自己的入口。
   * 验证目标：环境级 input 优先，两个环境各自保留正确入口。
   */
  test('per-environment input overrides the top-level value', async () => {
    const config = await resolveConfig(
      {
        input: 'src/main.ts',
        environments: {
          ssr: { input: 'src/entry-server.ts' },
        },
      },
      'serve',
    )

    expect(config.environments.client.input).toBe('src/main.ts')
    expect(config.environments.ssr.input).toBe('src/entry-server.ts')
  })

  /**
   * 场景：input 是相对路径数组。
   * 验证目标：解析配置阶段只校验/反转义，不提前转成绝对路径或改变数组形状。
   */
  test('keeps array input relative to the root', async () => {
    const config = await resolveConfig(
      { input: ['src/a.ts', 'src/b.ts'] },
      'serve',
    )

    expect(config.environments.client.input).toEqual(['src/a.ts', 'src/b.ts'])
  })

  /**
   * 场景：input 是命名入口对象。
   * 验证目标：键名和相对路径值均原样保留，供后续 Environment/构建阶段解释。
   */
  test('keeps record input relative to the root', async () => {
    const config = await resolveConfig(
      { input: { main: 'src/a.ts', admin: 'src/b.ts' } },
      'serve',
    )

    expect(config.environments.client.input).toEqual({
      main: 'src/a.ts',
      admin: 'src/b.ts',
    })
  })

  /**
   * 场景：字符串、数组元素或对象值含 tinyglobby 支持的动态模式字符。
   * 验证目标：当前版本明确拒绝 glob，避免未来真正支持 glob 时改变既有路径语义
   * （#22642）。
   */
  test('reserves glob characters in input', async () => {
    const cases: {
      /** 动态模式类别，用作断言上下文。 */
      name: string
      /** 应被拒绝的 input 形态。 */
      input: UserConfig['input']
    }[] = [
      { name: 'wildcard', input: 'src/*.ts' },
      { name: 'single char', input: 'src/page?.ts' },
      { name: 'character class', input: 'src/[id].ts' },
      { name: 'brace expansion', input: 'src/{a,b}.ts' },
      { name: 'extglob group', input: 'src/?(group).ts' },
      { name: 'negation', input: 'src/!(main).ts' },
      { name: 'extglob prefix +', input: 'src/+(page).ts' },
      { name: 'extglob prefix @', input: 'src/@(page).ts' },
      { name: 'array element', input: ['src/main.ts', 'src/*.ts'] },
      { name: 'record', input: { main: 'src/*.ts' } },
    ]

    for (const { name, input } of cases) {
      await expect(resolveConfig({ input }, 'serve'), name).rejects.toThrow(
        /`input` cannot contain glob characters/,
      )
    }
  })

  /**
   * 场景：真实文件名本身含 `*` 等字符，用户用反斜杠显式转义。
   * 验证目标：转义形式通过校验，并在最终 input 中还原成真实文件名。
   */
  test('support escaped input', async () => {
    const cases: {
      /** 转义字符类别，用作断言上下文。 */
      name: string
      /** 带反斜杠转义的 input。 */
      input: UserConfig['input']
      /** 去除转义后应保留的真实路径。 */
      expected: UserConfig['input']
    }[] = [
      {
        name: 'glob',
        input: 'src/\\*.ts',
        expected: 'src/*.ts',
      },
      {
        name: 'array element',
        input: ['src/\\*.ts'],
        expected: ['src/*.ts'],
      },
      {
        name: 'record',
        input: { main: 'src/\\*.ts' },
        expected: { main: 'src/*.ts' },
      },
    ]

    for (const { name, input, expected } of cases) {
      await expect(
        resolveConfig({ input }, 'serve'),
        name,
      ).resolves.toMatchObject({
        input: expected,
      })
    }
  })

  /**
   * 场景：input 含 `$`、连字符、下划线或 Windows 反斜杠等非 glob 特殊字符。
   * 验证目标：不能把普通合法路径误判成 glob，也不能擅自标准化用户入口字符串。
   */
  test('allows non-glob special characters in input', async () => {
    const cases: {
      /** 合法特殊字符类别，用作断言上下文。 */
      name: string
      /** 不含动态 glob 语义的 input。 */
      input: UserConfig['input']
      /** 不应被改写的最终 input。 */
      expected: UserConfig['input']
    }[] = [
      {
        name: 'special characters',
        input: 'src/a-b_c$.ts',
        expected: 'src/a-b_c$.ts',
      },
      ...(isWindows
        ? [
            {
              name: 'windows path',
              input: 'src\\foo.ts',
              expected: 'src\\foo.ts',
            },
          ]
        : []),
    ]

    for (const { name, input, expected } of cases) {
      await expect(
        resolveConfig({ input }, 'serve'),
        name,
      ).resolves.toMatchObject({
        input: expected,
      })
    }
  })

  /**
   * 场景：库模式只配置名称，没有单独声明 lib.entry。
   * 验证目标：顶层 input 作为库入口回退值，避免用户重复声明同一路径。
   */
  test('is used as the default for build.lib.entry when entry is omitted', async () => {
    const config = await resolveConfig(
      {
        input: 'src/lib.ts',
        build: { lib: { name: 'MyLib' } },
      },
      'build',
    )

    expect(config.build.lib && config.build.lib.entry).toBe('src/lib.ts')
  })

  /**
   * 场景：顶层 input 与 build.lib.entry 同时存在。
   * 验证目标：更具体的库入口优先，顶层兼容入口不能覆盖它。
   */
  test('explicit build.lib.entry overrides the top-level input', async () => {
    const config = await resolveConfig(
      {
        input: 'src/lib.ts',
        build: { lib: { entry: 'src/explicit.ts', name: 'MyLib' } },
      },
      'build',
    )

    expect(config.build.lib && config.build.lib.entry).toBe('src/explicit.ts')
  })
})

/**
 * 场景：用户从旧顶层 client/ssr resolve 配置起步，插件返回新 environments 配置。
 * 验证目标：两套入口按“旧配置为默认、新环境配置追加”的顺序合并，并同步回兼容字段。
 */
test('config compat 1', async () => {
  const config = await resolveConfig(
    {
      resolve: {
        conditions: ['client1'],
      },
      ssr: {
        resolve: {
          conditions: ['ssr1'],
        },
      },
      plugins: [
        {
          name: 'test',
          /** 用新 Environment 配置覆盖旧顶层 client/ssr 条件。 */
          config() {
            return {
              environments: {
                client: {
                  resolve: {
                    conditions: ['client2'],
                  },
                },
                ssr: {
                  resolve: {
                    conditions: ['ssr2'],
                  },
                },
              },
            }
          },
        },
      ],
    },
    'serve',
  )
  expect(config.resolve.conditions).toMatchInlineSnapshot(`
    [
      "client1",
      "client2",
    ]
  `)
  expect(config.environments.client.resolve.conditions).toMatchInlineSnapshot(`
    [
      "client1",
      "client2",
    ]
  `)
  expect(config.ssr.resolve?.conditions).toMatchInlineSnapshot(`
    [
      "ssr1",
      "ssr2",
    ]
  `)
  expect(config.environments.ssr.resolve?.conditions).toMatchInlineSnapshot(`
    [
      "ssr1",
      "ssr2",
    ]
  `)
})

/**
 * 场景：用户从新 environments 配置起步，插件仍返回旧顶层 client/ssr 字段。
 * 验证目标：插件返回值继续拥有较高优先级，同时最终新旧入口保持一致。
 */
test('config compat 2', async () => {
  const config = await resolveConfig(
    {
      environments: {
        client: {
          resolve: {
            conditions: ['client1'],
          },
        },
        ssr: {
          resolve: {
            conditions: ['ssr1'],
          },
        },
      },
      plugins: [
        {
          name: 'test',
          /** 用旧顶层字段覆盖初始 Environment 条件，验证反向兼容合并。 */
          config() {
            return {
              resolve: {
                conditions: ['client2'],
              },
              ssr: {
                resolve: {
                  conditions: ['ssr2'],
                },
              },
            }
          },
        },
      ],
    },
    'serve',
  )
  expect(config.resolve.conditions).toMatchInlineSnapshot(`
    [
      "client2",
      "client1",
    ]
  `)
  expect(config.environments.client.resolve.conditions).toMatchInlineSnapshot(`
    [
      "client2",
      "client1",
    ]
  `)
  expect(config.ssr.resolve?.conditions).toMatchInlineSnapshot(`
    [
      "ssr2",
      "ssr1",
    ]
  `)
  expect(config.environments.ssr.resolve?.conditions).toMatchInlineSnapshot(`
    [
      "ssr2",
      "ssr1",
    ]
  `)
})

/**
 * 场景：用户没有声明任何 resolve conditions。
 * 验证目标：client 采用 browser 条件、ssr 采用 node 条件，且每组默认值同步到旧入口。
 */
test('config compat 3', async () => {
  const config = await resolveConfig({}, 'serve')
  expect(config.resolve.conditions).toMatchInlineSnapshot(`
    [
      "module",
      "browser",
      "development|production",
    ]
  `)
  expect(config.environments.client.resolve.conditions).toMatchInlineSnapshot(`
    [
      "module",
      "browser",
      "development|production",
    ]
  `)
  expect(config.ssr.resolve?.conditions).toMatchInlineSnapshot(`
    [
      "module",
      "node",
      "development|production",
    ]
  `)
  expect(config.environments.ssr.resolve?.conditions).toMatchInlineSnapshot(`
    [
      "module",
      "node",
      "development|production",
    ]
  `)
})

/**
 * 场景：configEnvironment 钩子只原地修改 custom1 的 noExternal。
 * 验证目标：各 Environment 在继承默认配置时拥有独立对象，修改不能泄漏到 custom2。
 */
test('configEnvironment mutation does not leak between environments', async () => {
  const resolved = await resolveConfig(
    {
      environments: {
        custom1: {},
        custom2: {},
      },
      plugins: [
        {
          name: 'test-mutate-env',
          /** 只原地修改 custom1，暴露 Environment 配置对象是否错误共享。 */
          configEnvironment(name, config) {
            if (name === 'custom1') {
              config.resolve ??= {}
              config.resolve.noExternal = true
            }
          },
        },
      ],
    },
    'serve',
  )

  expect(resolved.environments.custom1.resolve.noExternal).toBe(true)
  expect(resolved.environments.custom2.resolve.noExternal).not.toBe(true)
})

/**
 * 场景：顶层 build 内含需按引用保留的 terser nameCache。
 * 验证目标：旧顶层 build 与 client Environment build 共享相同深层引用，兼容
 * configResolved 阶段的生态插件原地修改。
 */
test('build and environments.client.build has the same reference', async () => {
  const nameCache = {}
  const resolved = await resolveConfig(
    {
      build: {
        terserOptions: {
          nameCache,
        },
      },
    },
    'serve',
  )

  expect(resolved.build.terserOptions.nameCache).toBe(nameCache)
  expect(resolved.environments.client.build.terserOptions.nameCache).toBe(
    resolved.build.terserOptions.nameCache,
  )
})

/**
 * 场景：未配置、旧顶层 server.preTransformRequests，以及环境级显式 true/false 组合。
 * 验证目标：client 默认 true、其他环境默认 false；旧顶层值作为环境默认值，但不能覆盖
 * 环境自身显式选择。
 */
test('preTransformRequests', async () => {
  /** 把最终各环境的 preTransformRequests 提取成便于快照比较的对象。 */
  async function testConfig(inlineConfig: InlineConfig) {
    return Object.fromEntries(
      Object.entries(
        (await resolveConfig(inlineConfig, 'serve')).environments,
      ).map(([name, e]) => [name, e.dev.preTransformRequests]),
    )
  }

  expect(
    await testConfig({
      environments: {
        custom: {},
        customTrue: {
          dev: {
            preTransformRequests: true,
          },
        },
        customFalse: {
          dev: {
            preTransformRequests: false,
          },
        },
      },
    }),
  ).toMatchInlineSnapshot(`
    {
      "client": true,
      "custom": false,
      "customFalse": false,
      "customTrue": true,
      "ssr": false,
    }
  `)

  expect(
    await testConfig({
      server: {
        preTransformRequests: true,
      },
      environments: {
        custom: {},
        customTrue: {
          dev: {
            preTransformRequests: true,
          },
        },
        customFalse: {
          dev: {
            preTransformRequests: false,
          },
        },
      },
    }),
  ).toMatchInlineSnapshot(`
    {
      "client": true,
      "custom": true,
      "customFalse": false,
      "customTrue": true,
      "ssr": true,
    }
  `)

  expect(
    await testConfig({
      server: {
        preTransformRequests: false,
      },
      environments: {
        custom: {},
        customTrue: {
          dev: {
            preTransformRequests: true,
          },
        },
        customFalse: {
          dev: {
            preTransformRequests: false,
          },
        },
      },
    }),
  ).toMatchInlineSnapshot(`
    {
      "client": false,
      "custom": false,
      "customFalse": false,
      "customTrue": true,
      "ssr": false,
    }
  `)
})

describe('loadConfigFromFile', () => {
  /** 配置加载器测试夹具根目录。 */
  const fixtures = path.resolve(import.meta.dirname, './fixtures/config')

  /**
   * bundle loader 当前会修补一部分 Node 原生 ESM 不支持的写法；这些测试验证它同时给出
   * 迁移到未来 native 默认值所需的精确告警（#22850）。
   */
  describe('native-incompatibility warnings', () => {
    const compatRoot = path.resolve(fixtures, './native-compat')

    // Node 新版本才提供原生 TypeScript type stripping；旧版本无法执行对应夹具。
    // eslint-disable-next-line n/no-unsupported-features/node-builtins
    const supportsTypeStripping = !!process.features.typescript

    /** 用默认 bundle loader 加载夹具，并提取去除终端控制码后的 native 兼容告警。 */
    const loadWithWarnings = async (
      dir: string,
      configFile = 'vite.config.js',
    ) => {
      const logger = createLogger('info')
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
      const root = path.resolve(compatRoot, dir)
      await loadConfigFromFile(
        {} as any,
        path.resolve(root, configFile),
        root,
        undefined,
        logger,
        'bundle',
      )
      const messages = warn.mock.calls.map((c) =>
        stripVTControlCharacters(c[0]),
      )
      warn.mockRestore()
      return messages
    }

    /**
     * 场景：ESM 配置直接使用 CJS 的 __dirname/__filename。
     * 验证目标：bundle 仍可注入兼容值，但提示改用 Node ESM 的 import.meta 对应属性。
     */
    test('warns on __dirname / __filename', async () => {
      const messages = await loadWithWarnings('dirname')
      expect(messages).toMatchInlineSnapshot(`
        [
          "(!) Your Vite config uses features that are unsupported by \`configLoader: 'native'\`, which is planned to become the default in a future major version of Vite:
          - \`__dirname\` (vite.config.js:3:29). Use \`import.meta.dirname\` instead
          - \`__filename\` (vite.config.js:4:30). Use \`import.meta.filename\` instead
        Set \`VITE_CONFIG_NATIVE_IGNORE_WARNING=true\` to suppress this warning.",
        ]
      `)
    })

    /**
     * 场景：含 TypeScript 专属语法的配置也使用 __dirname。
     * 验证目标：当当前 Node 能原生剥离类型时，兼容扫描仍能定位 TS 源码行列；不支持该
     * 能力的 Node 跳过用例，而不是把运行时限制误判成扫描失败。
     */
    test.skipIf(!supportsTypeStripping)(
      'warns on __dirname in a config using TypeScript syntax',
      async () => {
        const messages = await loadWithWarnings('ts-syntax', 'vite.config.ts')
        expect(messages).toMatchInlineSnapshot(`
          [
            "(!) Your Vite config uses features that are unsupported by \`configLoader: 'native'\`, which is planned to become the default in a future major version of Vite:
            - \`__dirname\` (vite.config.ts:10:29). Use \`import.meta.dirname\` instead
          Set \`VITE_CONFIG_NATIVE_IGNORE_WARNING=true\` to suppress this warning.",
          ]
        `)
      },
    )

    /**
     * 场景：ESM 配置省略相对导入扩展名。
     * 验证目标：bundle 可以解析，但告知 native Node ESM 必须写完整文件名。
     */
    test('warns on extension-less import', async () => {
      const messages = await loadWithWarnings('extensionless')
      expect(messages).toMatchInlineSnapshot(`
        [
          "(!) Your Vite config uses features that are unsupported by \`configLoader: 'native'\`, which is planned to become the default in a future major version of Vite:
          - import "./helper" without a file extension (vite.config.js:1:23). Add the file extension
        Set \`VITE_CONFIG_NATIVE_IGNORE_WARNING=true\` to suppress this warning.",
        ]
      `)
    })

    /**
     * 场景：ESM 相对导入依赖目录 index 自动解析。
     * 验证目标：提示显式导入 index 文件，因为 native Node ESM 不做目录入口补全。
     */
    test('warns on directory-index import', async () => {
      const messages = await loadWithWarnings('directory-index')
      expect(messages).toMatchInlineSnapshot(`
        [
          "(!) Your Vite config uses features that are unsupported by \`configLoader: 'native'\`, which is planned to become the default in a future major version of Vite:
          - import "./plugins" resolves to a directory index (vite.config.js:1:25). Import the index file directly
        Set \`VITE_CONFIG_NATIVE_IGNORE_WARNING=true\` to suppress this warning.",
        ]
      `)
    })

    /**
     * 场景：ESM 配置导入 JSON，但没有 import attributes。
     * 验证目标：精确提示补充 `with { type: 'json' }`，避免切到 native 后加载失败。
     */
    test('warns on JSON import without attributes', async () => {
      const messages = await loadWithWarnings('json')
      expect(messages).toMatchInlineSnapshot(`
        [
          "(!) Your Vite config uses features that are unsupported by \`configLoader: 'native'\`, which is planned to become the default in a future major version of Vite:
          - JSON import "./data.json" without import attributes (vite.config.js:1:18). Add \`with { type: 'json' }\`
        Set \`VITE_CONFIG_NATIVE_IGNORE_WARNING=true\` to suppress this warning.",
        ]
      `)
    })

    /**
     * 场景：JSON import 已声明正确 attributes。
     * 验证目标：原生兼容写法不能产生误报警告。
     */
    test('does not warn on JSON import with attributes', async () => {
      expect(await loadWithWarnings('json-ok')).toHaveLength(0)
    })

    /**
     * 场景：无扩展名导入最终解析到 JSON。
     * 验证目标：一次告警同时给出 `.json` 扩展名和 import attributes 两项修复要求。
     */
    test('warns on an extension-less import that resolves to JSON', async () => {
      const messages = await loadWithWarnings('json-extensionless')
      expect(messages).toMatchInlineSnapshot(`
        [
          "(!) Your Vite config uses features that are unsupported by \`configLoader: 'native'\`, which is planned to become the default in a future major version of Vite:
          - import "./foo" resolves to a JSON file (vite.config.js:1:18). Import it with a \`.json\` extension and \`with { type: 'json' }\`
        Set \`VITE_CONFIG_NATIVE_IGNORE_WARNING=true\` to suppress this warning.",
        ]
      `)
    })

    /**
     * 场景：配置只使用 native Node ESM 支持的语法。
     * 验证目标：兼容扫描应保持安静，避免无行动价值的迁移噪声。
     */
    test('does not warn on a native-compatible config', async () => {
      expect(await loadWithWarnings('clean')).toHaveLength(0)
    })

    /**
     * 场景：真正的 `.cjs` 配置使用 __dirname。
     * 验证目标：该变量在原生 CommonJS 中合法，不能套用 ESM 告警规则。
     */
    test('does not warn for a CJS config using __dirname', async () => {
      expect(await loadWithWarnings('cjs', 'vite.config.cjs')).toHaveLength(0)
    })

    /**
     * 场景：CJS 主配置导入 ESM 辅助文件，辅助文件内部使用 __dirname。
     * 验证目标：兼容性按每个模块的真实格式判断，而不是只看入口 `.cjs`。
     */
    test('warns for an ESM file imported by a CJS config', async () => {
      const messages = await loadWithWarnings(
        'cjs-imports-esm',
        'vite.config.cjs',
      )
      expect(messages).toMatchInlineSnapshot(`
        [
          "(!) Your Vite config uses features that are unsupported by \`configLoader: 'native'\`, which is planned to become the default in a future major version of Vite:
          - \`__dirname\` (esm-helper.mjs:1:35). Use \`import.meta.dirname\` instead
        Set \`VITE_CONFIG_NATIVE_IGNORE_WARNING=true\` to suppress this warning.",
        ]
      `)
    })

    /**
     * 场景：最近 package.json 声明 `type: commonjs`，但 `.js` 配置使用 ESM 语法。
     * 验证目标：提示改扩展名或 package type；bundle 能转译不代表 native Node 能加载。
     */
    test('warns on ESM syntax in a config under a `type: commonjs` package', async () => {
      const messages = await loadWithWarnings('esm-in-commonjs-pkg')
      expect(messages).toMatchInlineSnapshot(`
        [
          "(!) Your Vite config uses features that are unsupported by \`configLoader: 'native'\`, which is planned to become the default in a future major version of Vite:
          - ESM syntax in a file loaded as CommonJS (vite.config.js:1:1). Use a \`.mjs\` extension or set \`"type": "module"\` in the closest package.json
        Set \`VITE_CONFIG_NATIVE_IGNORE_WARNING=true\` to suppress this warning.",
        ]
      `)
    })
  })

  /**
   * 覆盖默认文件名发现矩阵：js/cjs/mjs/ts/cts/mts 在无 package type 与 module package
   * 下都应按正确的 ESM/CJS 身份执行。
   */
  describe('load default files', () => {
    const root = path.resolve(fixtures, './loadConfigFromFile')

    let writtenConfig: string | undefined
    afterEach(() => {
      if (writtenConfig) {
        fs.unlinkSync(path.resolve(root, writtenConfig))
      }
      fs.unlinkSync(path.resolve(root, 'package.json'))
    })

    /** 写入当前参数化用例的临时 vite.config.*。 */
    const writeConfig = (fileName: string, content: string) => {
      fs.writeFileSync(path.resolve(root, fileName), content)
      writtenConfig = fileName
    }
    /** 写入决定 `.js/.ts` 模块身份的最近 package.json。 */
    const writePackageJson = (typeField: string | undefined) => {
      fs.writeFileSync(
        path.resolve(root, 'package.json'),
        JSON.stringify({
          name: '@vitejs/test-load-config-from-file',
          type: typeField,
        }),
      )
    }

    /** 验证默认发现命中刚写入的文件，且 TS/模块语法执行结果正确。 */
    const canLoadConfig = async () => {
      const result = await loadConfigFromFile(
        { command: 'build', mode: 'production' },
        undefined,
        root,
        'silent',
      )
      expect(result).toBeTruthy()
      expect(result?.config).toStrictEqual({ define: { foo: 1 } })
      expect(path.normalize(result!.path)).toBe(
        path.resolve(root, writtenConfig!),
      )
    }

    const cases = [
      {
        fileName: 'vite.config.js',
        content: 'export default { define: { foo: 1 } }',
      },
      {
        fileName: 'vite.config.js',
        content: 'export default { define: { foo: 1 } }',
      },
      {
        fileName: 'vite.config.cjs',
        content: 'module.exports = { define: { foo: 1 } }',
      },
      {
        fileName: 'vite.config.cjs',
        content: 'module.exports = { define: { foo: 1 } }',
      },
      {
        fileName: 'vite.config.mjs',
        content: 'export default { define: { foo: 1 } }',
      },
      {
        fileName: 'vite.config.mjs',
        content: 'export default { define: { foo: 1 } }',
      },
      {
        fileName: 'vite.config.ts',
        content: 'export default { define: { foo: 1 as number } }',
      },
      {
        fileName: 'vite.config.ts',
        content: 'export default { define: { foo: 1 as number } }',
      },
      {
        fileName: 'vite.config.mts',
        content: 'export default { define: { foo: 1 as number } }',
      },
      {
        fileName: 'vite.config.mts',
        content: 'export default { define: { foo: 1 as number } }',
      },
      {
        fileName: 'vite.config.cts',
        content: 'module.exports = { define: { foo: 1 as number } }',
      },
      {
        fileName: 'vite.config.cts',
        content: 'module.exports = { define: { foo: 1 as number } }',
      },
    ]

    for (const { fileName, content } of cases) {
      for (const typeField of [undefined, 'module']) {
        /**
         * 场景：当前扩展名与最近 package type 的组合。
         * 验证目标：默认发现、模块格式判断、TS 转换和返回路径全部一致。
         */
        test(`load ${fileName}${typeField ? ' with package#type module' : ''}`, async () => {
          writePackageJson(typeField)
          writeConfig(fileName, content)
          await canLoadConfig()
        })
      }
    }
  })

  /**
   * 场景：TS 配置跨多个本地模块导入数组、package imports 映射和条件导出。
   * 验证目标：bundle loader 遵循 Node/Vite 解析语义，并执行完整依赖图而非只转入口。
   */
  test('can import values', async () => {
    const { config } = (await loadConfigFromFile(
      {} as any,
      path.resolve(fixtures, './entry/vite.config.ts'),
      path.resolve(fixtures, './entry'),
    ))!
    expect(config).toMatchInlineSnapshot(`
      {
        "array": [
          [
            1,
            3,
          ],
          [
            2,
            4,
          ],
        ],
        "importsField": "imports-field",
        "moduleCondition": "import condition",
      }
    `)
  })

  /**
   * 场景：配置通过 import attributes 导入 JSON。
   * 验证目标：bundle loader 能消费 attributes 并把 JSON 值交给配置。
   */
  test('loadConfigFromFile with import attributes', async () => {
    const { config } = (await loadConfigFromFile(
      {} as any,
      path.resolve(fixtures, './entry/vite.config.import-attributes.ts'),
      path.resolve(fixtures, './entry'),
    ))!
    expect(config).toMatchInlineSnapshot(`
        {
          "jsonValue": "vite",
        }
      `)
  })

  /**
   * 场景：ESM/TS 配置使用 __dirname 和 __filename。
   * 验证目标：默认 bundle loader 注入每个源文件自己的原始路径，而不是打包临时文件路径
   * （#2728、#8442）。
   */
  test('cjs module vars are supported in esm', async () => {
    const { config } = (await loadConfigFromFile(
      {} as any,
      path.resolve(fixtures, './cjs-module-vars-in-esm/vite.config.ts'),
      path.resolve(fixtures, './cjs-module-vars-in-esm'),
      'silent',
    ))!
    const c = config as any
    expect(c.dirname).toContain('cjs-module-vars-in-esm')
    expect(c.filename).toContain('vite.config.ts')
  })

  /**
   * 场景：配置读取 import.meta.main/url/dirname/filename/resolve，包括跨行 resolve 语法。
   * 验证目标：打包时的 define 与自定义 resolve hook 保留原生文件作用域语义
   * （#20516、#20962）。
   */
  test('import.meta properties are supported', async () => {
    const { config } = (await loadConfigFromFile(
      {} as any,
      path.resolve(fixtures, './import-meta/vite.config.ts'),
      path.resolve(fixtures, './import-meta'),
    ))!

    const c = config as any
    expect(c.isMain).toBe(false)
    expect(c.url).toContain('file://')
    expect(c.dirname).toContain('import-meta')
    expect(c.filename).toContain('vite.config.ts')
    expect(c.resolved).toBe(c.url)
    expect(c.resolvedMultiline).toBe(c.url)
  })

  /**
   * 场景：配置首行带 Unix shebang，随后还需注入文件作用域变量。
   * 验证目标：shebang 保持输出第一行，注入代码插在其后，避免 Node 语法错误（#21158）。
   */
  test('shebang is preserved at the top of the file', async () => {
    const { config } = (await loadConfigFromFile(
      {} as any,
      path.resolve(fixtures, './shebang/vite.config.ts'),
      path.resolve(fixtures, './shebang'),
    ))!

    const c = config as any
    expect(c.dirname).toContain('shebang')
  })

  /**
   * 场景：hashbang 以 Windows CRLF 结束。
   * 验证目标：行终止符识别正确，注入变量不会挤进 hashbang 行（#23038）。
   */
  test('injected variables follow a hashbang ending in CRLF', async () => {
    const { config, path: configPath } = (await loadConfigFromFile(
      {} as any,
      path.resolve(fixtures, './shebang-crlf/vite.config.ts'),
      path.resolve(fixtures, './shebang-crlf'),
    ))!

    const configFile = fs.readFileSync(configPath, 'utf8')
    expect(configFile).toContain('\r\n')

    const c = config as any
    expect(c.dirname).toContain('shebang-crlf')
  })

  /** 覆盖不经 bundle/runner 转换、直接由当前运行时 import 的实验性 native loader。 */
  describe('loadConfigFromFile with configLoader: native', () => {
    const fixtureRoot = path.resolve(fixtures, './native-import')

    /**
     * 场景：原生兼容的基础 ESM JavaScript 配置。
     * 验证目标：native loader 直接取得默认导出；普通测试运行时无 freshImport，依赖列表
     * 因而为空（#19178、#22602）。
     */
    test('imports a basic js config', async () => {
      const result = (await loadConfigFromFile(
        {} as any,
        path.resolve(fixtureRoot, 'basic.js'),
        fixtureRoot,
        undefined,
        undefined,
        'native',
      ))!
      expect(result.config).toMatchInlineSnapshot(`
        {
          "value": "works",
        }
      `)
      expect(result.dependencies.length).toBe(0)
    })
  })

  /** 覆盖找不到最近 package.json 时的 cacheDir 回退规则（#21777、#23060）。 */
  describe('cacheDir resolution', () => {
    // 使用系统临时目录，避免 findNearestPackageData 命中仓库父级 package.json。
    const tmpBase = path.join(os.tmpdir(), 'vite-cachedir-test')

    afterEach(() => {
      if (fs.existsSync(tmpBase)) {
        fs.rmSync(tmpBase, { recursive: true, force: true })
      }
    })

    /**
     * 场景：root 没有 package.json，但已有 node_modules（常见于使用 npm 包的 Deno 项目）。
     * 验证目标：缓存仍放入 node_modules/.vite，不在 root 额外创建裸 `.vite`。
     */
    test('uses node_modules/.vite when node_modules exists without package.json', async () => {
      const tempDir = path.join(tmpBase, 'with-node-modules')
      const nodeModulesDir = path.join(tempDir, 'node_modules')
      fs.mkdirSync(nodeModulesDir, { recursive: true })

      const config = await resolveConfig({ root: tempDir }, 'serve')

      expect(config.cacheDir).toBe(
        normalizePath(
          path.resolve(fs.realpathSync.native(tempDir), 'node_modules/.vite'),
        ),
      )
    })

    /**
     * 场景：root 既无 package.json 也无 node_modules。
     * 验证目标：最后才回退到 root/.vite。
     */
    test('uses .vite when neither package.json nor node_modules exist', async () => {
      const tempDir = path.join(tmpBase, 'empty')
      fs.mkdirSync(tempDir, { recursive: true })

      const config = await resolveConfig({ root: tempDir }, 'serve')

      expect(config.cacheDir).toBe(
        normalizePath(path.resolve(fs.realpathSync.native(tempDir), '.vite')),
      )
    })
  })
})

describe('resolveServerOptions', () => {
  const warnFn = vi.fn()
  const logger = { warn: warnFn } as unknown as Logger

  afterEach(() => {
    delete process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS
  })

  /** 场景：环境变量只含一个主机。验证目标：该主机被追加到空 allowedHosts。 */
  test('adds single host from __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS', async () => {
    process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = 'example.com'
    const resolved = await resolveServerOptions(
      '/root',
      { allowedHosts: [] },
      logger,
    )
    expect(resolved.allowedHosts).toEqual(['example.com'])
  })

  /** 场景：环境变量用逗号声明多个主机。验证目标：保持声明顺序解析为三个独立条目。 */
  test('adds multiple hosts from __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS', async () => {
    process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS =
      'example.com,test.com,dev.example.org'
    const resolved = await resolveServerOptions(
      '/root',
      { allowedHosts: [] },
      logger,
    )
    expect(resolved.allowedHosts).toEqual([
      'example.com',
      'test.com',
      'dev.example.org',
    ])
  })

  /** 场景：各主机两侧含空白。验证目标：规范化结果只保留主机文本。 */
  test('trims whitespace from hosts in __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS', async () => {
    process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS =
      ' example.com , test.com , dev.example.org '
    const resolved = await resolveServerOptions(
      '/root',
      { allowedHosts: [] },
      logger,
    )
    expect(resolved.allowedHosts).toEqual([
      'example.com',
      'test.com',
      'dev.example.org',
    ])
  })

  /** 场景：逗号列表含连续和尾随空项。验证目标：空项被丢弃且有效主机全部保留。 */
  test('filters empty hosts from __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS', async () => {
    process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS =
      'example.com,,test.com,,'
    const resolved = await resolveServerOptions(
      '/root',
      { allowedHosts: [] },
      logger,
    )
    expect(resolved.allowedHosts).toEqual(['example.com', 'test.com'])
  })

  /** 场景：配置已有允许主机且环境变量再提供两个。验证目标：原配置优先保留并在末尾追加新项。 */
  test('appends to existing allowedHosts', async () => {
    process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = 'new.com,another.com'
    const resolved = await resolveServerOptions(
      '/root',
      { allowedHosts: ['existing.com'] },
      logger,
    )
    expect(resolved.allowedHosts).toEqual([
      'existing.com',
      'new.com',
      'another.com',
    ])
  })

  /** 场景：allowedHosts 已设为允许全部。验证目标：环境变量不能把布尔语义降级成数组。 */
  test('does not modify allowedHosts when set to true', async () => {
    process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = 'example.com'
    const resolved = await resolveServerOptions(
      '/root',
      { allowedHosts: true },
      logger,
    )
    expect(resolved.allowedHosts).toBe(true)
  })

  /** 场景：环境变量包含引号或反斜杠保留字符。验证目标：拒绝全部条目并为每种输入输出警告。 */
  test('throw an error if it contains `"` or `\'` or `\\`', async () => {
    const envs = ['"example.com"', "'example.com'", '\\example.com']
    for (const env of envs) {
      process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = env
      const resolved = await resolveServerOptions(
        '/root',
        { allowedHosts: [] },
        logger,
      )
      expect(resolved.allowedHosts).toEqual([])
      expect(warnFn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Skipping additional allowed hosts from environment variable due to reserved characters',
        ),
      )
      warnFn.mockClear()
    }
  })
})
