import path from 'node:path'
import { describe, expect, onTestFinished, test, vi } from 'vitest'
import { build } from '../../build'
import type { Plugin } from '../../plugin'
import { resolveConfig } from '../../config'
import { createServer } from '../../server'
import { preview } from '../../preview'
import { promiseWithResolvers } from '../../../shared/utils'
import { type Logger, createLogger } from '../../logger'

/** 只运行配置解析生命周期，便于检查全局配置钩子的 `this` 上下文。 */
const resolveConfigWithPlugin = (
  plugin: Plugin,
  command: 'serve' | 'build' = 'serve',
) => {
  return resolveConfig(
    { configFile: false, plugins: [plugin], logLevel: 'error' },
    command,
  )
}

/** 插件上下文测试统一使用的公开虚拟入口 ID。 */
const ENTRY_ID = 'entry.js'
/** 带空字节前缀的内部入口 ID，用于确认 resolve/load/transform 钩子链。 */
const RESOLVED_ENTRY_ID = `\0${ENTRY_ID}`

/** 为开发/构建测试提供稳定虚拟入口，避免测试依赖真实源码文件。 */
const resolveEntryPlugin: Plugin = {
  name: 'resolve-entry.js',
  /** 把公共测试入口解析为内部虚拟 ID。 */
  resolveId(id) {
    if (id === ENTRY_ID) {
      return RESOLVED_ENTRY_ID
    }
  },
  /** 为内部测试入口返回最小模块源码。 */
  load(id) {
    if (id === RESOLVED_ENTRY_ID) {
      return 'export default {}'
    }
  },
}

/** 创建 middleware mode Dev Server，并在用例结束后自动关闭。 */
const createServerWithPlugin = async (
  plugin: Plugin,
  customLogger?: Logger,
) => {
  const server = await createServer({
    configFile: false,
    root: import.meta.dirname,
    plugins: [plugin, resolveEntryPlugin],
    logLevel: 'error',
    customLogger,
    server: {
      middlewareMode: true,
      ws: false,
    },
  })
  onTestFinished(() => server.close())
  return server
}

/** 创建不真正监听端口的 Preview Server。 */
const createPreviewServerWithPlugin = async (plugin: Plugin) => {
  const server = await preview({
    configFile: false,
    root: import.meta.dirname,
    plugins: [
      {
        name: 'mock-preview',
        /** 替换预览 HTTP Server 的 listen，并同步调用最后一个已注册的 listening 监听器而不占用端口。 */
        configurePreviewServer({ httpServer }) {
          /** 跳过真实端口绑定，仅调用最后一个 listening 监听器，完成 preview 启动等待。 */
          httpServer.listen = () => {
            const lastListener = httpServer.listeners('listening').at(-1)!
            lastListener.call(httpServer)
            return httpServer as any
          }
        },
      },
      plugin,
    ],
    logLevel: 'error',
  })
  onTestFinished(() => server.close())
  return server
}

/** 执行不写磁盘的最小构建，用于观察 build 钩子上下文。 */
const buildWithPlugin = async (plugin: Plugin) => {
  await build({
    root: path.resolve(import.meta.dirname, '../packages/build-project'),
    logLevel: 'error',
    build: {
      write: false,
    },
    plugins: [plugin, resolveEntryPlugin],
  })
}

describe('supports plugin context', () => {
  /**
   * 最早期 config 钩子在 watchMode 和 Environment 尚未建立时执行。
   * 提供日志方法及 Rolldown/Vite 版本，但类型和运行时都不暴露 watchMode。
   */
  test('config hook', async () => {
    expect.assertions(4)

    await resolveConfigWithPlugin({
      name: 'test',
      /** 在最早 config 阶段断言基础日志/meta 上下文且无 watchMode。 */
      config() {
        expect(this).toMatchObject({
          debug: expect.any(Function),
          info: expect.any(Function),
          warn: expect.any(Function),
          error: expect.any(Function),
          meta: expect.any(Object),
        })
        expect(this.meta.rollupVersion).toBeTypeOf('string')
        expect(this.meta.viteVersion).toBeTypeOf('string')
        // @ts-expect-error watchMode should not exist in types
        expect(this.meta.watchMode).toBeUndefined()
      },
    })
  })

  /**
   * configEnvironment 对 client 的局部配置执行。
   * 与 config 同属解析早期上下文，具有日志/meta，但仍无 watchMode。
   */
  test('configEnvironment hook', async () => {
    expect.assertions(4)

    await resolveConfigWithPlugin({
      name: 'test',
      /** 只检查 client 的环境配置上下文，确认解析早期仍无 watchMode。 */
      configEnvironment(name) {
        if (name !== 'client') return

        expect(this).toMatchObject({
          debug: expect.any(Function),
          info: expect.any(Function),
          warn: expect.any(Function),
          error: expect.any(Function),
          meta: expect.any(Object),
        })
        expect(this.meta.rollupVersion).toBeTypeOf('string')
        expect(this.meta.viteVersion).toBeTypeOf('string')
        // @ts-expect-error watchMode should not exist in types
        expect(this.meta.watchMode).toBeUndefined()
      },
    })
  })

  /**
   * serve 的配置已完成解析，调用全局 configResolved。
   * 上下文补齐 watchMode=true 和双版本信息，但仍不需要当前 Environment。
   */
  test('configResolved hook', async () => {
    expect.assertions(4)

    await resolveConfigWithPlugin({
      name: 'test',
      /** 在 serve 配置解析完成后断言 watchMode 与版本元数据。 */
      configResolved() {
        expect(this).toMatchObject({
          debug: expect.any(Function),
          info: expect.any(Function),
          warn: expect.any(Function),
          error: expect.any(Function),
          meta: expect.any(Object),
        })
        expect(this.meta.rollupVersion).toBeTypeOf('string')
        expect(this.meta.viteVersion).toBeTypeOf('string')
        expect(this.meta.watchMode).toBe(true)
      },
    })
  })

  /**
   * 开发服务器创建期间运行 configureServer。
   * 全局服务器钩子获得标准日志/meta，且 serve 的 watchMode 为 true。
   */
  test('configureServer hook', async () => {
    expect.assertions(4)

    await createServerWithPlugin({
      name: 'test',
      /** 断言开发服务器钩子获得 watchMode=true 的全局插件上下文。 */
      configureServer() {
        expect(this).toMatchObject({
          debug: expect.any(Function),
          info: expect.any(Function),
          warn: expect.any(Function),
          error: expect.any(Function),
          meta: expect.any(Object),
        })
        expect(this.meta.rollupVersion).toBeTypeOf('string')
        expect(this.meta.viteVersion).toBeTypeOf('string')
        expect(this.meta.watchMode).toBe(true)
      },
    })
  })

  /**
   * 产物预览服务器运行 configurePreviewServer。
   * 预览不监听源码构建变化，因此 watchMode 必须是 false。
   */
  test('configurePreviewServer hook', async () => {
    expect.assertions(4)

    await createPreviewServerWithPlugin({
      name: 'test',
      /** 断言预览服务器钩子获得 watchMode=false 的插件上下文。 */
      configurePreviewServer() {
        expect(this).toMatchObject({
          debug: expect.any(Function),
          info: expect.any(Function),
          warn: expect.any(Function),
          error: expect.any(Function),
          meta: expect.any(Object),
        })
        expect(this.meta.rollupVersion).toBeTypeOf('string')
        expect(this.meta.viteVersion).toBeTypeOf('string')
        expect(this.meta.watchMode).toBe(false)
      },
    })
  })

  /**
   * 开发服务器转换 HTML。
   * transformIndexHtml 使用标准上下文，serve 时 watchMode=true。
   */
  test('transformIndexHtml hook in dev', async () => {
    expect.assertions(4)

    const server = await createServerWithPlugin({
      name: 'test',
      /** 在开发态 HTML 转换中检查标准上下文与 watchMode=true。 */
      transformIndexHtml() {
        expect(this).toMatchObject({
          debug: expect.any(Function),
          info: expect.any(Function),
          warn: expect.any(Function),
          error: expect.any(Function),
          meta: expect.any(Object),
        })
        expect(this.meta.rollupVersion).toBeTypeOf('string')
        expect(this.meta.viteVersion).toBeTypeOf('string')
        expect(this.meta.watchMode).toBe(true)
      },
    })
    await server.transformIndexHtml('/index.html', '<html></html>')
  })

  /**
   * 生产构建转换 HTML。
   * 同一钩子可跨 serve/build 复用，但 build 的 watchMode=false。
   */
  test('transformIndexHtml hook in build', async () => {
    expect.assertions(4)

    await buildWithPlugin({
      name: 'test',
      /** 在生产构建 HTML 转换中检查相同上下文形状与 watchMode=false。 */
      transformIndexHtml() {
        expect(this).toMatchObject({
          debug: expect.any(Function),
          info: expect.any(Function),
          warn: expect.any(Function),
          error: expect.any(Function),
          meta: expect.any(Object),
        })
        expect(this.meta.rollupVersion).toBeTypeOf('string')
        expect(this.meta.viteVersion).toBeTypeOf('string')
        expect(this.meta.watchMode).toBe(false)
      },
    })
  })

  /**
   * 文件变化触发旧应用级 handleHotUpdate。
   * 它取得全局最小上下文和 watchMode=true，不要求 Environment 字段。
   */
  test('handleHotUpdate hook', async () => {
    expect.assertions(4)

    const { promise, resolve } = promiseWithResolvers<void>()
    const server = await createServerWithPlugin({
      name: 'test',
      /** 在旧应用级热更新钩子中验证全局最小上下文，并释放等待信号。 */
      handleHotUpdate() {
        expect(this).toMatchObject({
          debug: expect.any(Function),
          info: expect.any(Function),
          warn: expect.any(Function),
          error: expect.any(Function),
          meta: expect.any(Object),
        })
        expect(this.meta.rollupVersion).toBeTypeOf('string')
        expect(this.meta.viteVersion).toBeTypeOf('string')
        expect(this.meta.watchMode).toBe(true)
        resolve()
      },
    })
    server.watcher.emit(
      'change',
      path.resolve(import.meta.dirname, 'index.html'),
    )

    await promise
  })

  /**
   * 同一文件变化触发新 Environment 级 hotUpdate。
   * 除标准日志/meta 外，`this.environment` 指向当前 client 环境。
   */
  test('hotUpdate hook', async () => {
    expect.assertions(4)

    const { promise, resolve } = promiseWithResolvers<void>()
    const server = await createServerWithPlugin({
      name: 'test',
      /** 只在 client 热更新中检查 Environment 级上下文，并释放等待信号。 */
      hotUpdate() {
        if (this.environment.name !== 'client') return

        expect(this).toMatchObject({
          debug: expect.any(Function),
          info: expect.any(Function),
          warn: expect.any(Function),
          error: expect.any(Function),
          meta: expect.any(Object),
          environment: expect.any(Object),
        })
        expect(this.meta.rollupVersion).toBeTypeOf('string')
        expect(this.meta.viteVersion).toBeTypeOf('string')
        expect(this.meta.watchMode).toBe(true)
        resolve()
      },
    })
    server.watcher.emit(
      'change',
      path.resolve(import.meta.dirname, 'index.html'),
    )

    await promise
  })

  /**
   * Dev PluginContainer 对虚拟入口运行 transform。
   * 模块级钩子获得标准上下文，开发环境 watchMode=true。
   */
  test('transform hook in dev', async () => {
    expect.assertions(4)

    const server = await createServerWithPlugin({
      name: 'test',
      /** 在开发 PluginContainer 转换内部入口时断言 watchMode=true。 */
      transform(_code, id) {
        if (id !== RESOLVED_ENTRY_ID) return
        expect(this).toMatchObject({
          debug: expect.any(Function),
          info: expect.any(Function),
          warn: expect.any(Function),
          error: expect.any(Function),
          meta: expect.any(Object),
        })
        expect(this.meta.rollupVersion).toBeTypeOf('string')
        expect(this.meta.viteVersion).toBeTypeOf('string')
        expect(this.meta.watchMode).toBe(true)
      },
    })
    await server.transformRequest(ENTRY_ID)
    await server.close()
  })

  /**
   * Rolldown 生产构建运行同一个 transform 钩子。
   * 上下文形状跨开发/构建一致，但非 watch 构建的 watchMode=false。
   */
  test('transform hook in build', async () => {
    expect.assertions(4)

    await buildWithPlugin({
      name: 'test',
      /** 在生产 Rolldown 转换内部入口时断言 watchMode=false。 */
      transform(_code, id) {
        if (id !== RESOLVED_ENTRY_ID) return
        expect(this).toMatchObject({
          debug: expect.any(Function),
          info: expect.any(Function),
          warn: expect.any(Function),
          error: expect.any(Function),
          meta: expect.any(Object),
        })
        expect(this.meta.rollupVersion).toBeTypeOf('string')
        expect(this.meta.viteVersion).toBeTypeOf('string')
        expect(this.meta.watchMode).toBe(false)
      },
    })
  })

  /**
   * 开发态 resolveId 访问 Rolldown 风格的 `this.fs`。
   * PluginContainer 提供文件系统能力，普通 Rolldown 插件可在 dev 复用。
   */
  test('this.fs is supported in dev', async () => {
    expect.hasAssertions()

    const server = await createServerWithPlugin({
      name: 'test',
      /** 在开发解析入口时确认 Rolldown 风格的 this.fs 文件系统能力可用。 */
      resolveId(id) {
        if (id !== ENTRY_ID) return
        expect(this.fs.readFile).toBeTypeOf('function')
      },
    })
    await server.transformRequest(ENTRY_ID)
    await server.close()
  })
})

describe('watcher add/unlink error handling', () => {
  /**
   * watcher `add` 触发的异步 watchChange 被拒绝。
   * 事件回调接住 Promise rejection 并交给 Logger，不能形成未处理拒绝。
   */
  test("'add' event logs error when watchChange throws", async () => {
    const { promise, resolve } = promiseWithResolvers<void>()
    const error = new Error('async watchChange error')

    const logError = vi.fn()
    const logger = createLogger('error')
    /** 先保留原错误输出，再解除本例等待，用于确认 watcher 钩子异常已交给 logger。 */
    logger.error = (...args) => {
      logError(...args)
      resolve()
    }

    const server = await createServerWithPlugin(
      {
        name: 'test',
        /** 让 add 事件对应的异步 watchChange 拒绝，以验证错误进入 logger。 */
        watchChange() {
          return Promise.reject(error)
        },
      },
      logger,
    )

    server.watcher.emit(
      'add',
      path.resolve(import.meta.dirname, 'some-file.js'),
    )

    await promise
    expect(logError).toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith(error)
  })

  /**
   * watcher `change` 触发的异步 watchChange 被拒绝。
   * 普通内容变化同样统一记录错误。
   */
  test("'change' event logs error when watchChange throws", async () => {
    const { promise, resolve } = promiseWithResolvers<void>()
    const error = new Error('async watchChange error')

    const logError = vi.fn()
    const logger = createLogger('error')
    /** 先保留原错误输出，再解除本例等待，用于确认 watcher 钩子异常已交给 logger。 */
    logger.error = (...args) => {
      logError(...args)
      resolve()
    }

    const server = await createServerWithPlugin(
      {
        name: 'test',
        /** 让 change 事件对应的异步 watchChange 拒绝，以验证错误进入 logger。 */
        watchChange() {
          return Promise.reject(error)
        },
      },
      logger,
    )

    server.watcher.emit(
      'change',
      path.resolve(import.meta.dirname, 'some-file.js'),
    )

    await promise
    expect(logError).toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith(error)
  })

  /**
   * watcher `unlink` 触发的异步 watchChange 被拒绝。
   * 删除事件也不能泄漏未处理 rejection。
   */
  test("'unlink' event logs error when watchChange throws", async () => {
    const { promise, resolve } = promiseWithResolvers<void>()
    const error = new Error('async watchChange error')

    const logError = vi.fn()
    const logger = createLogger('error')
    /** 先保留原错误输出，再解除本例等待，用于确认 watcher 钩子异常已交给 logger。 */
    logger.error = (...args) => {
      logError(...args)
      resolve()
    }

    const server = await createServerWithPlugin(
      {
        name: 'test',
        /** 让 unlink 事件对应的异步 watchChange 拒绝，以验证错误进入 logger。 */
        watchChange() {
          return Promise.reject(error)
        },
      },
      logger,
    )

    server.watcher.emit(
      'unlink',
      path.resolve(import.meta.dirname, 'some-file.js'),
    )

    await promise
    expect(logError).toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith(error)
  })
})
