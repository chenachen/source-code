import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  extractSourcemap,
  formatSourcemapForSnapshot,
  isBuild,
  isServe,
  page,
  readManifest,
  testDir,
  viteTestUrl,
} from '~utils'

/**
 * IIFE 格式 worker 的浏览器集成矩阵。
 *
 * 重点验证无 ESM 语法的 worker 输出、`import.meta` 兼容改写、内联包装器、
 * 嵌套 worker 与 sourcemap；与 ES 套件对照观察输出格式对代码与装载方式的影响。
 */
/** 页面先创建独立 worker，轮询 pong、NODE_ENV 与子构建插件成功消息；SVG URL 在构建时指向带 hash 产物、dev 指向源文件，ES 套件还检查 CJS 依赖消息。 */
test('normal', async () => {
  await expect.poll(() => page.textContent('.pong')).toMatch('pong')
  await expect
    .poll(() => page.textContent('.mode'))
    .toMatch(process.env.NODE_ENV)
  await expect
    .poll(() => page.textContent('.bundle-with-plugin'))
    .toMatch('worker bundle with plugin success!')
  await expect
    .poll(() => page.textContent('.asset-url'))
    .toMatch(
      isBuild
        ? /\/iife\/assets\/worker_asset-vite-[\w-]{8}\.svg/
        : '/iife/vite.svg',
    )
})

/** 页面以 name=namedWorker 创建 worker，轮询回传文本含该名称，验证构造选项传入 worker 全局。 */
test('named', async () => {
  await expect
    .poll(() => page.textContent('.pong-named'))
    .toMatch('namedWorker')
})

/** 页面加载由插件输出为 TypeScript 的 worker，轮询 pong，验证子构建继续处理其输出类型。 */
test('TS output', async () => {
  await expect.poll(() => page.textContent('.pong-ts-output')).toMatch('pong')
})

/** 页面通过 inline worker 包装器启动实例，轮询 pong，验证内联代码可以执行。 */
test('inlined', async () => {
  await expect.poll(() => page.textContent('.pong-inline')).toMatch('pong')
})

/** 页面传 name=namedInlineWorker 给 inline 包装器，轮询回传该名称，验证包装器保留选项。 */
test('named inlined', async () => {
  await expect
    .poll(() => page.textContent('.pong-inline-named'))
    .toMatch('namedInlineWorker')
})

/** 页面连接 SharedWorker 端口并发送消息，轮询端口回传 pong，验证共享实例通信。 */
test('shared worker', async () => {
  await expect.poll(() => page.textContent('.tick-count')).toMatch('pong')
})

/** 页面创建带名称的 SharedWorker 并连接端口，轮询 pong，验证命名构造选项下仍可通信。 */
test('named shared worker', async () => {
  await expect.poll(() => page.textContent('.tick-count-named')).toMatch('pong')
})

/** 页面连接 inline SharedWorker 的端口，轮询 pong，验证内联共享实例可执行并通信。 */
test('inline shared worker', async () => {
  await expect
    .poll(() => page.textContent('.pong-shared-inline'))
    .toMatch('pong')
})

/** 页面启动父 worker 和嵌套 worker，分别轮询父入口名、sub-worker 名与 constructor 消息；IIFE 套件仅 dev 执行此分支，其余套件两模式均有对应断言。 */
test.runIf(!isBuild)(
  'worker emitted and import.meta.url in nested worker (serve)',
  async () => {
    await expect
      .poll(() => page.textContent('.nested-worker'))
      .toMatch('/worker-nested')
    await expect
      .poll(() => page.textContent('.nested-worker-module'))
      .toMatch('/sub-worker')
    await expect
      .poll(() => page.textContent('.nested-worker-constructor'))
      .toMatch('"type":"constructor"')
  },
)

describe.runIf(isBuild)('build', () => {
  // 构建期同时验证文件集合与 IIFE 包装代码。
  /** 仅构建模式枚举输出并读取独立 worker 与主 chunk：检查 worker 无所匹配的 import/export 文本，主 chunk 使用资产 URL，内联包装含 Blob/createObjectURL；ES 套件还检查 data URL 回退与内联 SharedWorker。 */
  test('inlined code generation', async () => {
    const assetsDir = path.resolve(testDir, 'dist/iife/assets')
    const files = fs.readdirSync(assetsDir)

    // 已发射的 worker 文件中不包含内联 SharedWorker 的源文件名。
    const workerFiles = files.filter((f) => f.startsWith('worker_'))
    for (const file of workerFiles) {
      const fileContent = fs.readFileSync(
        path.resolve(assetsDir, file),
        'utf-8',
      )
      expect(fileContent).not.toContain('my-inline-shared-worker.js')
    }

    const index = files.find((f) => f.includes('main-module'))
    const content = fs.readFileSync(path.resolve(assetsDir, index), 'utf-8')
    const worker = files.find((f) => f.includes('worker_entry-my-worker'))
    const workerContent = fs.readFileSync(
      path.resolve(assetsDir, worker),
      'utf-8',
    )

    // IIFE worker 已完成子构建，不得残留 import/export 语法。
    expect(workerContent).not.toMatch(/import\s*["(]/)
    expect(workerContent).not.toMatch(/\bexport\b/)
    // 主 chunk 应指向独立 Worker / SharedWorker 资产 URL。
    expect(content).toMatch('new Worker(`/iife/assets')
    expect(content).toMatch('new SharedWorker(`/iife/assets')
    // 内联普通 Worker 使用 blob URL 包装。
    expect(content).toMatch(`(self.URL||self.webkitURL).createObjectURL`)
    expect(content).toMatch(`self.Blob`)
  })

  /** 仅构建模式检查已启动嵌套 worker 的回传，分别要求 module 与 constructor 类型文本，验证两条创建路径的产物可执行。 */
  test('worker emitted and import.meta.url in nested worker (build)', async () => {
    await expect
      .poll(() => page.textContent('.nested-worker-module'))
      .toMatch('"type":"module"')
    await expect
      .poll(() => page.textContent('.nested-worker-constructor'))
      .toMatch('"type":"constructor"')
  })

  /** 仅构建模式读取 IIFE 主 manifest，确认 index.html 键存在；该断言未单独枚举 worker manifest 文件。 */
  test('should not emit worker manifest', async () => {
    const manifest = readManifest('iife')
    expect(manifest['index.html']).toBeDefined()
  })
})

/** 页面分别通过相对路径、别名、无扩展名 URL 创建 worker，并连接 URL SharedWorker；轮询 A string，IIFE 另检查回显的入口 URL。 */
test('module worker', async () => {
  // IIFE 输出中的 import.meta.url 改写为 self.location.href；别名解析发生在 URL 转换时。
  await expect
    .poll(async () => page.textContent('.worker-import-meta-url'))
    .toMatch(/A\sstring.*\/iife\/.+url-worker\.js.+url-worker\.js/)
  await expect
    .poll(() => page.textContent('.worker-import-meta-url-resolve'))
    .toMatch(/A\sstring.*\/iife\/.+url-worker\.js.+url-worker\.js/)
  await expect
    .poll(() => page.textContent('.worker-import-meta-url-without-extension'))
    .toMatch(/A\sstring.*\/iife\/.+url-worker\.js.+url-worker\.js/)
  await expect
    .poll(() => page.textContent('.shared-worker-import-meta-url'))
    .toMatch('A string')
})

/** 页面启动 classic Worker 与 SharedWorker，轮询 A classic；仅 dev 另检查 classic worker 中动态 ESM 导入回传 success。 */
test('classic worker', async () => {
  await expect
    .poll(() => page.textContent('.classic-worker'))
    .toMatch('A classic')
  if (!isBuild) {
    await expect
      .poll(() => page.textContent('.classic-worker-import'))
      .toMatch('[success] classic-esm')
  }
  await expect
    .poll(() => page.textContent('.classic-shared-worker'))
    .toMatch('A classic')
})

/** 页面将 ?worker&url 导出的 URL 交给 Worker，轮询 Hello from simple worker，验证 URL 包装入口。 */
test('url query worker', async () => {
  await expect
    .poll(() => page.textContent('.simple-worker-url'))
    .toMatch('Hello from simple worker!')
})

/** worker 的 eager glob 预先导入匹配模块，再回传映射的键数组；页面轮询文本含 JSON 数组开头，验证键数组消息已到达。 */
test('import.meta.glob eager in worker', async () => {
  await expect
    .poll(() => page.textContent('.importMetaGlobEager-worker'))
    .toMatch('["')
})

/** 仅构建模式启动含 require(JSON) 的 worker，轮询两个 name 对象的数组文本，验证子构建处理 CommonJS JSON。 */
test.runIf(isBuild)('require json in worker', async () => {
  await expect
    .poll(() => page.textContent('.worker-require-json'))
    .toMatch('[{"name":"a"},{"name":"b"}]')
})

/** 页面启动 ?worker 自引用入口，以 main 消息控制只创建下一层，轮询两行 main/nested，验证两层执行且没有持续递归创建。 */
test('self reference worker', async () => {
  // main 创建下一层，nested 只回传消息；运行时条件终止继续创建。
  await expect
    .poll(() => page.textContent('.self-reference-worker'))
    .toBe('pong: main\npong: nested\n')
})

/** 页面启动 new URL 自引用入口，以 main 消息控制只创建下一层，轮询两行 main/nested，验证两层执行。 */
test('self reference url worker', async () => {
  await expect
    .poll(() => page.textContent('.self-reference-url-worker'))
    .toBe('pong: main\npong: nested\n')
})

/** 页面启动依赖包中的 URL 自引用入口，轮询 main/nested 两行，验证包内入口也能解析自身并只创建下一层。 */
test('self reference url worker in dependency', async () => {
  await expect
    .poll(() => page.textContent('.self-reference-url-worker-dep'))
    .toBe('pong: main\npong: nested\n')
})

/** 仅 dev 先监听 worker_file 响应再导航页面，移除 env import 文本后提取 source map，将 sources、mappings 与可视化数据完整对照快照，验证注入与转换偏移。 */
test.runIf(isServe)('sourcemap is correct after env is injected', async () => {
  // 环境运行时被前置后，原 worker 源码位置仍应映射到正确行列。
  const response = page.waitForResponse(
    /my-worker\.ts\?worker_file&type=module/,
  )
  await page.goto(viteTestUrl)
  const code = (await (await response).text()).replace(
    /\bimport "\/iife\/@fs\/.+?\/client\/env\.mjs"/,
    '',
  )
  const map = extractSourcemap(code)
  expect(formatSourcemapForSnapshot(map, code, true)).toMatchInlineSnapshot(`
    SourceMap {
      content: {
        "mappings": ";;AAAA,SAAS,OAAO,kBAAkB;AAClC,OAAO,YAAY;AACnB,SAAS,MAAM,WAAW;AAC1B,SAAS,wBAAwB;AACjC,OAAO,aAAa;AACpB,MAAM,UAAU,YAAY;AAE5B,KAAK,aAAa,MAAM;CACtB,IAAI,EAAE,SAAS,QAAQ;EACrB,KAAK,YAAY;GACf;GACA;GACA;GACA;GACA;GACA;GACA;EACF,CAAC;CACH;CACA,IAAI,EAAE,SAAS,gBAAgB;EAC7B,KAAK,YAAY;GACf,KAAK;GACL;GACA;GACA;GACA;GACA;GACA;EACF,CAAC;CACH;AACF;AACA,KAAK,YAAY;CACf;CACA;CACA;CACA;CACA;CACA;CACA;CACA;AACF,CAAC;;AAGD,QAAQ,IAAI,cAAc",
        "sources": [
          "my-worker.ts?worker_file&type=module",
        ],
        "version": 3,
      },
      visualization: "https://evanw.github.io/source-map-visualization/#OTg5AGNvbnN0IGRlcENqcyA9IF9fdml0ZV9fY2pzSW1wb3J0Ml9fdml0ZWpzX3Rlc3RXb3JrZXJEZXBDanM7CjsKaW1wb3J0IHsgbXNnIGFzIG1zZ0Zyb21EZXAgfSBmcm9tICIvaWlmZS9ub2RlX21vZHVsZXMvLnZpdGUtaWlmZS9kZXBzL0B2aXRlanNfdGVzdC1kZXAtdG8tb3B0aW1pemUuanM/dj0wMDAwMDAwMCI7CmltcG9ydCBfX3ZpdGVfX2Nqc0ltcG9ydDJfX3ZpdGVqc190ZXN0V29ya2VyRGVwQ2pzIGZyb20gIi9paWZlL25vZGVfbW9kdWxlcy8udml0ZS1paWZlL2RlcHMvQHZpdGVqc190ZXN0LXdvcmtlci1kZXAtY2pzLmpzP3Y9MDAwMDAwMDAiOwppbXBvcnQgeyBtb2RlLCBtc2cgfSBmcm9tICIvaWlmZS9tb2R1bGVzL3dvcmtlckltcG9ydC50cyI7CmltcG9ydCB7IGJ1bmRsZVdpdGhQbHVnaW4gfSBmcm9tICIvaWlmZS9tb2R1bGVzL3Rlc3QtcGx1Z2luLmpzIjsKaW1wb3J0IHZpdGVTdmcgZnJvbSAiL2lpZmUvdml0ZS5zdmc/aW1wb3J0IjsKY29uc3QgbWV0YVVybCA9IGltcG9ydC5tZXRhLnVybDsKc2VsZi5vbm1lc3NhZ2UgPSAoZSkgPT4gewoJaWYgKGUuZGF0YSA9PT0gInBpbmciKSB7CgkJc2VsZi5wb3N0TWVzc2FnZSh7CgkJCW1zZywKCQkJbW9kZSwKCQkJYnVuZGxlV2l0aFBsdWdpbiwKCQkJdml0ZVN2ZywKCQkJbWV0YVVybCwKCQkJbmFtZSwKCQkJZGVwQ2pzCgkJfSk7Cgl9CglpZiAoZS5kYXRhID09PSAicGluZy11bmljb2RlIikgewoJCXNlbGYucG9zdE1lc3NhZ2UoewoJCQltc2c6ICLigKJwb25n4oCiIiwKCQkJbW9kZSwKCQkJYnVuZGxlV2l0aFBsdWdpbiwKCQkJdml0ZVN2ZywKCQkJbWV0YVVybCwKCQkJbmFtZSwKCQkJZGVwQ2pzCgkJfSk7Cgl9Cn07CnNlbGYucG9zdE1lc3NhZ2UoewoJbXNnLAoJbW9kZSwKCWJ1bmRsZVdpdGhQbHVnaW4sCgltc2dGcm9tRGVwLAoJdml0ZVN2ZywKCW1ldGFVcmwsCgluYW1lLAoJZGVwQ2pzCn0pOwovLyBmb3Igc291cmNlbWFwCmNvbnNvbGUubG9nKCJteS13b3JrZXIuanMiKTsKMTM4NwB7Im1hcHBpbmdzIjoiOztBQUFBLFNBQVMsT0FBTyxrQkFBa0I7QUFDbEMsT0FBTyxZQUFZO0FBQ25CLFNBQVMsTUFBTSxXQUFXO0FBQzFCLFNBQVMsd0JBQXdCO0FBQ2pDLE9BQU8sYUFBYTtBQUNwQixNQUFNLFVBQVUsWUFBWTtBQUU1QixLQUFLLGFBQWEsTUFBTTtDQUN0QixJQUFJLEVBQUUsU0FBUyxRQUFRO0VBQ3JCLEtBQUssWUFBWTtHQUNmO0dBQ0E7R0FDQTtHQUNBO0dBQ0E7R0FDQTtHQUNBO0VBQ0YsQ0FBQztDQUNIO0NBQ0EsSUFBSSxFQUFFLFNBQVMsZ0JBQWdCO0VBQzdCLEtBQUssWUFBWTtHQUNmLEtBQUs7R0FDTDtHQUNBO0dBQ0E7R0FDQTtHQUNBO0dBQ0E7RUFDRixDQUFDO0NBQ0g7QUFDRjtBQUNBLEtBQUssWUFBWTtDQUNmO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7Q0FDQTtDQUNBO0NBQ0E7QUFDRixDQUFDOztBQUdELFFBQVEsSUFBSSxjQUFjIiwic291cmNlcyI6WyJteS13b3JrZXIudHM/d29ya2VyX2ZpbGUmdHlwZT1tb2R1bGUiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgbXNnIGFzIG1zZ0Zyb21EZXAgfSBmcm9tICdAdml0ZWpzL3Rlc3QtZGVwLXRvLW9wdGltaXplJ1xuaW1wb3J0IGRlcENqcyBmcm9tICdAdml0ZWpzL3Rlc3Qtd29ya2VyLWRlcC1janMnXG5pbXBvcnQgeyBtb2RlLCBtc2cgfSBmcm9tICcuL21vZHVsZXMvd29ya2VySW1wb3J0LmpzJ1xuaW1wb3J0IHsgYnVuZGxlV2l0aFBsdWdpbiB9IGZyb20gJy4vbW9kdWxlcy90ZXN0LXBsdWdpbidcbmltcG9ydCB2aXRlU3ZnIGZyb20gJy4vdml0ZS5zdmcnXG5jb25zdCBtZXRhVXJsID0gaW1wb3J0Lm1ldGEudXJsXG5cbnNlbGYub25tZXNzYWdlID0gKGUpID0+IHtcbiAgaWYgKGUuZGF0YSA9PT0gJ3BpbmcnKSB7XG4gICAgc2VsZi5wb3N0TWVzc2FnZSh7XG4gICAgICBtc2csXG4gICAgICBtb2RlLFxuICAgICAgYnVuZGxlV2l0aFBsdWdpbixcbiAgICAgIHZpdGVTdmcsXG4gICAgICBtZXRhVXJsLFxuICAgICAgbmFtZSxcbiAgICAgIGRlcENqcyxcbiAgICB9KVxuICB9XG4gIGlmIChlLmRhdGEgPT09ICdwaW5nLXVuaWNvZGUnKSB7XG4gICAgc2VsZi5wb3N0TWVzc2FnZSh7XG4gICAgICBtc2c6ICfigKJwb25n4oCiJyxcbiAgICAgIG1vZGUsXG4gICAgICBidW5kbGVXaXRoUGx1Z2luLFxuICAgICAgdml0ZVN2ZyxcbiAgICAgIG1ldGFVcmwsXG4gICAgICBuYW1lLFxuICAgICAgZGVwQ2pzLFxuICAgIH0pXG4gIH1cbn1cbnNlbGYucG9zdE1lc3NhZ2Uoe1xuICBtc2csXG4gIG1vZGUsXG4gIGJ1bmRsZVdpdGhQbHVnaW4sXG4gIG1zZ0Zyb21EZXAsXG4gIHZpdGVTdmcsXG4gIG1ldGFVcmwsXG4gIG5hbWUsXG4gIGRlcENqcyxcbn0pXG5cbi8vIGZvciBzb3VyY2VtYXBcbmNvbnNvbGUubG9nKCdteS13b3JrZXIuanMnKVxuIl0sInZlcnNpb24iOjN9"
    }
  `)
})
