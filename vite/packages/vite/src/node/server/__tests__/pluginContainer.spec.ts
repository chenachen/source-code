import { stripVTControlCharacters } from 'node:util'
import MagicString from 'magic-string'
import { describe, expect, it, vi } from 'vitest'
import type { UserConfig } from '../../config'
import { resolveConfig } from '../../config'
import type { Plugin } from '../../plugin'
import { DevEnvironment } from '../environment'
import { createLogger } from '../../logger'

describe('plugin container', () => {
  /** ModuleInfo 只实现开发模块图可支持的字段，重点验证 meta 的跨阶段传播。 */
  describe('getModuleInfo', () => {
    /**
     * 同一插件在 resolveId、load、transform、buildEnd 连续读写 meta。
     * 解析前未知模块返回 null；每个对象结果的 meta 浅合并，并供后续钩子读取。
     */
    it('can pass metadata between hooks', async () => {
      const entryUrl = '/x.js'

      const metaArray: any[] = []
      const plugin: Plugin = {
        name: 'p1',
        /** 首次解析入口时确认 ModuleInfo 尚不存在，并写入初始 meta。 */
        resolveId(id) {
          if (id === entryUrl) {
            // 模块尚未完成解析，ModuleGraph 中没有可返回的信息。
            const moduleInfo = this.getModuleInfo(entryUrl)
            expect(moduleInfo).toEqual(null)

            return { id, meta: { x: 1 } }
          }
        },
        /** 读取 resolveId 写入的 meta，再返回覆盖值供 transform 观察。 */
        load(id) {
          if (id === entryUrl) {
            const { meta } = this.getModuleInfo(entryUrl) ?? {}
            metaArray.push(meta)

            return { code: 'export {}', meta: { x: 2 } }
          }
        },
        /** 读取 load 合并后的 meta，并写入最终阶段值。 */
        transform(_code, id) {
          if (id === entryUrl) {
            const { meta } = this.getModuleInfo(entryUrl) ?? {}
            metaArray.push(meta)

            return { meta: { x: 3 } }
          }
        },
        /** 在容器关闭阶段确认最终 meta 已对生命周期钩子可见。 */
        buildEnd() {
          const { meta } = this.getModuleInfo(entryUrl) ?? {}
          metaArray.push(meta)
        },
      }

      const environment = await getDevEnvironment({
        plugins: [plugin],
      })

      const entryModule = await environment.moduleGraph.ensureEntryFromUrl(
        entryUrl,
        false,
      )
      expect(entryModule.meta).toEqual({ x: 1 })

      const loadResult: any = await environment.pluginContainer.load(entryUrl)
      expect(loadResult?.meta).toEqual({ x: 2 })

      await environment.pluginContainer.transform(loadResult.code, entryUrl)
      await environment.pluginContainer.close()

      expect(metaArray).toEqual([{ x: 1 }, { x: 2 }, { x: 3 }])
    })

    /**
     * 插件 p1 在 resolveId 写 meta，插件 p2 在 load 读取。
     * ModuleInfo 属于模块/Environment，不属于某个插件，元数据可跨插件共享。
     */
    it('can pass metadata between plugins', async () => {
      const entryUrl = '/x.js'

      const plugin1: Plugin = {
        name: 'p1',
        /** 为入口写入供另一个插件读取的模块元数据。 */
        resolveId(id) {
          if (id === entryUrl) {
            return { id, meta: { x: 1 } }
          }
        },
      }

      const plugin2: Plugin = {
        name: 'p2',
        /** 验证前一插件在 resolveId 阶段写入的 meta 可跨插件读取。 */
        load(id) {
          if (id === entryUrl) {
            const { meta } = this.getModuleInfo(entryUrl) ?? {}
            expect(meta).toEqual({ x: 1 })
            return null
          }
        },
      }

      const environment = await getDevEnvironment({
        plugins: [plugin1, plugin2],
      })

      await environment.moduleGraph.ensureEntryFromUrl(entryUrl, false)
      await environment.pluginContainer.load(entryUrl)

      expect.assertions(1)
    })

    /**
     * p1 在 resolveId 内调用 `this.resolve()`，传入 importer、custom 和 isEntry。
     * 嵌套解析把自定义选项完整转交给后续 p2，不能在递归入口丢失。
     */
    it('can pass custom resolve opts between plugins', async () => {
      const entryUrl = '/x.js'

      const plugin1: Plugin = {
        name: 'p1',
        /** 发起带 importer、custom 与 isEntry 的嵌套解析。 */
        resolveId(id) {
          if (id === entryUrl) {
            return this.resolve('foobar', 'notreal', {
              custom: { p1: 'success' },
              isEntry: true,
            } as any)
          }
        },
      }

      const plugin2: Plugin = {
        name: 'p2',
        /** 接收嵌套解析并断言自定义解析选项没有丢失。 */
        resolveId(id, importer, opts) {
          if (id === 'foobar') {
            expect(importer).toBe('notreal')
            expect(opts).toEqual(
              expect.objectContaining({
                custom: { p1: 'success' },
                isEntry: true,
              }),
            )
            return entryUrl
          }
        },
        /** 为嵌套解析得到的入口提供空 load 结果，完成测试调用链。 */
        load(id) {
          if (id === entryUrl) {
            return null
          }
        },
      }

      const environment = await getDevEnvironment({
        plugins: [plugin1, plugin2],
      })

      await environment.moduleGraph.ensureEntryFromUrl(entryUrl, false)
      await environment.pluginContainer.load(entryUrl)

      expect.assertions(2)
    })
  })

  /** options 是最早运行的 Rolldown 兼容钩子，使用不含活动模块的 Minimal Context。 */
  describe('options', () => {
    /**
     * options 输出一条字符串 debug 日志。
     * Minimal Context 实现 debug，且关闭调试输出时不抛错。
     */
    it('should not throw errors when this.debug is called', async () => {
      const plugin: Plugin = {
        name: 'p1',
        /** 验证最小 options 上下文可安全调用 debug。 */
        options() {
          this.debug('test')
        },
      }
      await getDevEnvironment({
        plugins: [plugin],
      })
    })

    const logFunctions = ['info', 'warn'] as const
    for (const logFunction of logFunctions) {
      /**
       * options 分别调用 this.info/this.warn。
       * 两种日志都转发给配置的自定义 Logger，且每次只输出一次。
       */
      it(`should support this.${logFunction}`, async () => {
        const logger = createLogger()
        const mockedFn = vi
          .spyOn(logger, logFunction)
          .mockImplementation(() => {})
        const plugin: Plugin = {
          name: 'p1',
          /** 把当前参数化日志方法调用转发到测试 Logger。 */
          options() {
            this[logFunction]('test')
          },
        }
        await getDevEnvironment({
          plugins: [plugin],
          customLogger: logger,
        })
        expect(mockedFn).toHaveBeenCalledOnce()
      })
    }

    /**
     * options 调用 this.error('test')。
     * 字符串被包装成 Error 并中止 Environment 初始化。
     */
    it('should support this.error', async () => {
      const plugin: Plugin = {
        name: 'p1',
        /** 从 options 钩子抛出插件错误，验证初始化会被中止。 */
        options() {
          this.error('test')
        },
      }
      await expect(() =>
        getDevEnvironment({
          plugins: [plugin],
        }),
      ).rejects.toThrowError('test')
    })
  })

  /** 覆盖 load 钩子及 PluginContext.this.load 的递归加载能力。 */
  describe('load', () => {
    /**
     * 入口 transform 用 this.load 加载 secondary，并读取其 load meta。
     * 辅助模块即使不由浏览器请求，也会建立 ModuleInfo 并返回 meta（#11469）。
     */
    it('can resolve a secondary module', async () => {
      const entryUrl = '/x.js'

      const plugin: Plugin = {
        name: 'p1',
        /** 让所有测试模块保持原 ID，便于 this.load 建立辅助模块。 */
        resolveId(id) {
          return id
        },
        /** 为入口与辅助模块返回不同代码和 meta。 */
        load(id) {
          if (id === entryUrl) return { code: '1', meta: { x: 1 } }
          else return { code: '2', meta: { x: 2 } }
        },
        /** 从入口 transform 递归加载辅助模块并返回其 meta 值。 */
        async transform(code, id) {
          if (id === entryUrl)
            return {
              code: `${
                (await this.load({ id: '/secondary.js' })).meta.x || undefined
              }`,
            }
          return { code }
        },
      }

      const environment = await getDevEnvironment({
        plugins: [plugin],
      })
      await environment.moduleGraph.ensureEntryFromUrl(entryUrl, false)
      const loadResult: any = await environment.pluginContainer.load(entryUrl)
      const result: any = await environment.pluginContainer.transform(
        loadResult.code,
        entryUrl,
      )
      expect(result.code).equals('2')
    })

    /**
     * this.load 加载 y.js；load 写 meta.code=2，transform 再更新为 3。
     * this.load 必须执行完整 load+transform，而不是只返回原始加载结果（#14965）。
     */
    it('will load and transform the module', async () => {
      const entryUrl = '/x.js'
      const otherUrl = '/y.js'

      const plugin: Plugin = {
        name: 'p1',
        /** 为入口与待递归加载模块保留稳定 ID。 */
        resolveId(id) {
          return id
        },
        /** 给 y.js 返回 transform 能覆盖的初始 meta.code。 */
        load(id) {
          if (id === entryUrl) return { code: '1' }
          else if (id === otherUrl) return { code: '2', meta: { code: '2' } }
        },
        /** 验证 this.load 会完整执行 y.js 的 transform 并取得更新后 meta。 */
        async transform(_code, id) {
          if (id === entryUrl) {
            // Dev ModuleInfo 尚未实现 code 字段，暂用 meta.code 观察 transform 是否执行。
            return (await this.load({ id: otherUrl }))?.meta.code
          } else if (id === otherUrl) {
            return { code: '3', meta: { code: '3' } }
          }
        },
      }

      const environment = await getDevEnvironment({
        plugins: [plugin],
      })
      await environment.moduleGraph.ensureEntryFromUrl(entryUrl, false)
      const loadResult: any = await environment.pluginContainer.load(entryUrl)
      const result: any = await environment.pluginContainer.transform(
        loadResult.code,
        entryUrl,
      )
      expect(result.code).equals('3')
    })

    /**
     * load 用带 pos 的对象调用 this.debug。
     * 没有活动源码时保留 pos、不生成代码帧，debug 调用不抛异常。
     */
    it('should not throw errors when this.debug is called', async () => {
      const plugin: Plugin = {
        name: 'p1',
        /** 在没有活动源码内容时发送带 pos 的调试日志。 */
        load() {
          this.debug({ message: 'test', pos: 12 })
        },
      }
      const environment = await getDevEnvironment({
        plugins: [plugin],
      })
      await environment.pluginContainer.load('foo')
    })

    const logFunctions = ['info', 'warn'] as const
    for (const logFunction of logFunctions) {
      /**
       * load 分别输出带 pos 的 info/warn。
       * 日志补齐插件名；没有活动源码时不伪造代码帧。
       */
      it(`should support this.${logFunction}`, async () => {
        const logger = createLogger()
        const mockedFn = vi
          .spyOn(logger, logFunction)
          .mockImplementation(() => {})
        const plugin: Plugin = {
          name: 'p1',
          /** 调用当前参数化 info/warn 方法，验证插件名与位置格式化。 */
          load() {
            this[logFunction]({ message: 'test', pos: 12 })
          },
        }
        const environment = await getDevEnvironment({
          plugins: [plugin],
          customLogger: logger,
        })
        await environment.pluginContainer.load('foo')
        expect(mockedFn).toHaveBeenCalledOnce()
        expect(stripVTControlCharacters(mockedFn.mock.calls[0][0])).toBe(
          `${logFunction === 'warn' ? 'warning' : logFunction}: test\n` +
            '  Plugin: p1',
        )
      })
    }

    /**
     * load 抛出带 message/pos 的 RollupLog。
     * 拒绝值附加 plugin=p1 并保留 pos，快照核对调用方得到的错误字段。
     */
    it('should support this.error', async () => {
      const plugin: Plugin = {
        name: 'p1',
        /** 抛出带 pos 的 RollupLog，供测试断言插件错误字段。 */
        load() {
          this.error({ message: 'test', pos: 12 })
        },
      }
      const environment = await getDevEnvironment({
        plugins: [plugin],
      })
      await expect(() => environment.pluginContainer.load('foo')).rejects
        .toThrowErrorMatchingInlineSnapshot(`
        {
          "message": "test",
          "plugin": "p1",
          "pos": 12,
        }
      `)
    })
  })

  /** 覆盖 transform 链的 Source Map 修复与组合。 */
  describe('transform', () => {
    /**
     * MagicString 未传 filename，生成 `sources: ['']` 的 Map。
     * 容器把空 source 修复为模块 ID，并补入原始源码内容（#13657）。
     */
    it('combines a plugin sourcemap with `sources: [""]` (#13657)', async () => {
      const entryUrl = '/zoo.js'
      const originalCode = `export const zoo = 'zoo'\n`

      const plugin: Plugin = {
        name: 'p1',
        /** 用无 filename 的 MagicString map 验证容器补齐 sources/sourceContent。 */
        transform(code, id) {
          if (id === entryUrl) {
            const ms = new MagicString(code)
            ms.append('// add comment')
            return {
              code: ms.toString(),
              // 不给 source/filename，用实际生成的空 source 检查容器修复分支。
              map: ms.generateMap({ hires: true }),
            }
          }
        },
      }

      const environment = await getDevEnvironment({ plugins: [plugin] })
      await environment.moduleGraph.ensureEntryFromUrl(entryUrl, false)
      const result = await environment.pluginContainer.transform(
        originalCode,
        entryUrl,
      )

      expect(result.code).toContain('// add comment')
      // 空 source 必须替换为当前模块 ID 和原始源码。
      expect(result.map).toMatchInlineSnapshot(`
        {
          "file": undefined,
          "mappings": "AAAA,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC;",
          "names": [],
          "sources": [
            "/zoo.js",
          ],
          "sourcesContent": [
            "export const zoo = 'zoo'
        ",
          ],
          "version": 3,
        }
      `)
    })
  })

  /** 覆盖 resolveId 内 `this.resolve()` 的递归跳过规则。 */
  describe('resolveId', () => {
    describe('skipSelf', () => {
      /**
       * 插件处理 /x.js 时显式传 skipSelf: true，再次解析同一 id/importer。
       * 当前插件不递归调用自身，调用次数保持 1。
       */
      it('should skip the plugin itself when skipSelf is true', async () => {
        let calledCount = 0
        const plugin: Plugin = {
          name: 'p1',
          /** 递归解析同一 id/importer，验证 skipSelf 阻止自调用。 */
          async resolveId(id, importer) {
            if (id !== '/x.js') return
            calledCount++
            if (calledCount <= 1) {
              return await this.resolve(id, importer, { skipSelf: true })
            }
            return id
          },
        }

        const environment = await getDevEnvironment({ plugins: [plugin] })
        await environment.pluginContainer.resolveId('/x.js')
        expect(calledCount).toBe(1)
      })

      /**
       * p2 把 foo 改成 foo/modified 后嵌套解析，p1 能处理新 ID。
       * skipSelf 只跳过相同 id+importer 调用，不能永久排除整个插件（#18903）。
       */
      it('should skip the plugin only when id and importer is same', async () => {
        const p1: Plugin = {
          name: 'p1',
          /** 处理 p2 改写后的 ID，其余请求继续嵌套解析。 */
          async resolveId(id, importer) {
            if (id === 'foo/modified') {
              return 'success'
            }
            return await this.resolve(id, importer, { skipSelf: true })
          },
        }
        const p2: Plugin = {
          name: 'p2',
          /** 改写 ID 后再次解析，验证 skipSelf 只匹配当前调用身份。 */
          async resolveId(id, importer) {
            const resolved = await this.resolve(id + '/modified', importer, {
              skipSelf: true,
            })
            return resolved ?? 'failed'
          },
        }

        const environment = await getDevEnvironment({ plugins: [p1, p2] })
        const result = await environment.pluginContainer.resolveId('foo')
        expect(result).toStrictEqual({ id: 'success' })
      })

      /**
       * p1→p2→p1 形成 ID 改写后又回到原 ID 的解析链。
       * p1 再次委托 foo、p2 再次委托 foo/modified 时各自置 called；下一层都被
       * 跳过并返回 null，最终采用 p1 的 success 回退结果。
       */
      it('should skip the plugin if it has been called before with the same id and importer (1)', async () => {
        const p1: Plugin = {
          name: 'p1',
          /** 去掉 modified 后递归回原 ID，构造可被调用历史截断的循环。 */
          async resolveId(id, importer) {
            return (
              (await this.resolve(id.replace(/\/modified$/, ''), importer, {
                skipSelf: true,
              })) ?? 'success'
            )
          },
        }
        const p2: Plugin = {
          name: 'p2',
          /** 追加 modified 并嵌套解析，形成 p1→p2→p1 链。 */
          async resolveId(id, importer) {
            return await this.resolve(id + '/modified', importer, {
              skipSelf: true,
            })
          },
        }
        const environment = await getDevEnvironment({ plugins: [p1, p2] })
        const result = await environment.pluginContainer.resolveId('foo')
        expect(result).toStrictEqual({ id: 'success' })
      })

      /**
       * 相同递归链后还有 p3 能解析 modified ID。
       * p1/p2 的重复委托都置 called 后，下一层跳过二者但继续调用 p3，返回 success。
       */
      it('should skip the plugin if it has been called before with the same id and importer (2)', async () => {
        const p1: Plugin = {
          name: 'p1',
          /** 回退 modified 后递归解析，验证重复身份只跳过当前插件。 */
          async resolveId(id, importer) {
            return (
              (await this.resolve(id.replace(/\/modified$/, ''), importer, {
                skipSelf: true,
              })) ?? 'failure1'
            )
          },
        }
        const p2: Plugin = {
          name: 'p2',
          /** 追加 modified，让后续 p3 有机会完成解析。 */
          async resolveId(id, importer) {
            return await this.resolve(id + '/modified', importer, {
              skipSelf: true,
            })
          },
        }
        const p3: Plugin = {
          name: 'p3',
          /** 为 modified ID 返回成功结果，证明跳过 p1 后管线仍会继续。 */
          resolveId(id) {
            if (id.endsWith('/modified')) {
              return 'success'
            }
            return 'failure2'
          },
        }
        const environment = await getDevEnvironment({ plugins: [p1, p2, p3] })
        const result = await environment.pluginContainer.resolveId('foo')
        expect(result).toStrictEqual({ id: 'success' })
      })
    })
  })
})

/**
 * 创建无真实 HTTP 服务器的 client DevEnvironment，并初始化其 PluginContainer。
 * 夹具不建立 Server 的依赖优化运行时，从管线移除 pre-alias，避免进入其优化器分支。
 */
async function getDevEnvironment(
  inlineConfig?: UserConfig,
): Promise<DevEnvironment> {
  const config = await resolveConfig(
    { configFile: false, ...inlineConfig },
    'serve',
  )

  // @ts-expect-error 测试调整只读插件列表，移除需要依赖优化运行时的 pre-alias。
  config.plugins = config.plugins.filter((p) => !p.name.includes('pre-alias'))

  const environment = new DevEnvironment('client', config, { hot: true })
  await environment.init()

  return environment
}
