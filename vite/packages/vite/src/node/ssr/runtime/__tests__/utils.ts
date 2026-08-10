import fs from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TestAPI } from 'vitest'
import { afterEach, beforeEach, onTestFinished, test } from 'vitest'
import type { ModuleRunner } from 'vite/module-runner'
import type { ServerModuleRunnerOptions } from '../serverModuleRunner'
import type { ViteDevServer } from '../../../server'
import type { InlineConfig } from '../../../config'
import { createServer } from '../../../server'
import { createServerModuleRunner } from '../serverModuleRunner'
import type { DevEnvironment } from '../../../server/environment'

/** Module Runner 集成用例注入到 Vitest 上下文的三件套。 */
interface TestClient {
  /** 当前用例独占的 middleware Vite Server。 */
  server: ViteDevServer
  /** 连接到 SSR Environment 的同进程 ModuleRunner。 */
  runner: ModuleRunner
  /** runner 拉取和失效模块时对应的 SSR Environment。 */
  environment: DevEnvironment
}

/** 注册每用例创建/关闭 Server 与 ModuleRunner 的测试工厂。 */
export async function createModuleRunnerTester(
  config: InlineConfig = {},
  runnerConfig: ServerModuleRunnerOptions = {},
): Promise<TestAPI<TestClient>> {
  /** 等待显式启用的 Chokidar watcher 完成初始扫描。 */
  function waitForWatcher(server: ViteDevServer) {
    return new Promise<void>((resolve) => {
      if ((server.watcher as any)._readyEmitted) {
        resolve()
      } else {
        server.watcher.once('ready', () => resolve())
      }
    })
  }

  beforeEach<TestClient>(async (t) => {
    // @ts-ignore
    globalThis.__HMR__ = {}

    t.server = await createServer({
      root: import.meta.dirname,
      logLevel: 'error',
      server: {
        middlewareMode: true,
        watch: null,
        ws: false,
      },
      ssr: {
        external: ['@vitejs/cjs-external', '@vitejs/esm-external'],
      },
      optimizeDeps: {
        disabled: true,
        noDiscovery: true,
        include: [],
      },
      plugins: [
        {
          name: 'vite-plugin-virtual',
          /** 把测试用三类公开虚拟 ID 映射到各自内部身份。 */
          resolveId(id) {
            if (id === 'virtual0:test') {
              return `\0virtual:test`
            }
            if (id === 'virtual:test') {
              return 'virtual:test'
            }
            if (id === 'virtual:normal') {
              return '\0' + id
            }
          },
          /** 为 null-byte、普通与常规模块三条虚拟解析路径提供代码。 */
          load(id) {
            if (id === `\0virtual:test`) {
              return `export const msg = 'virtual0'`
            }
            if (id === `virtual:test`) {
              return `export const msg = 'virtual'`
            }
            if (id === '\0virtual:normal') {
              return 'export default "ok"'
            }
          },
        },
        ...(config.plugins ?? []),
      ],
      ...config,
    })
    t.environment = t.server.environments.ssr
    t.runner = createServerModuleRunner(t.environment, {
      hmr: {
        logger: false,
      },
      // don't override by default so Vitest source maps are correct
      sourcemapInterceptor: false,
      ...runnerConfig,
    })
    if (config.server?.watch) {
      await waitForWatcher(t.server)
    }
  })

  afterEach<TestClient>(async (t) => {
    await t.runner.close()
    await t.server.close()
  })

  return test as TestAPI<TestClient>
}

/** 会在用例结束后自动恢复原始内容的夹具编辑器。 */
type FixtureEditor = {
  /** 修改文件，并在首次修改时保存其原始内容。 */
  editFile: (file: string, callback: (content: string) => string) => void
}

/** 创建按测试生命周期自动回滚文件修改的编辑器。 */
export function createFixtureEditor(): FixtureEditor {
  const originalFiles = new Map<string, string>()
  onTestFinished(() => {
    originalFiles.forEach((content, file) => {
      fs.writeFileSync(file, content, 'utf-8')
    })
    originalFiles.clear()
  })

  return {
    /** 保存首个原始版本，再把回调生成的内容写回磁盘。 */
    editFile(file, callback) {
      const content = fs.readFileSync(file, 'utf-8')
      if (!originalFiles.has(file)) originalFiles.set(file, content)
      fs.writeFileSync(file, callback(content), 'utf-8')
    },
  }
}

/** 以模块 URL 所在目录为基准解析跨平台规范化夹具路径。 */
export function resolvePath(baseUrl: string, path: string): string {
  const filename = fileURLToPath(baseUrl)
  return resolve(dirname(filename), path).replace(/\\/g, '/')
}
