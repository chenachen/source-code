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
 * 嵌套 worker 与 sourcemap；与 ES 套件对照可看到 format 只改变装载机制。
 */
/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.pong')”。
 * 验证目标：“page.textContent('.pong')” 应匹配 “'pong'”；“page.textContent('.mode')” 应匹配 “process.env.NODE_ENV”，从而确认Worker/SharedWorker 包装、格式与消息传递在浏览器中可执行。
 */
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

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.pong-named')”。
 * 验证目标：“page.textContent('.pong-named')” 应匹配 “'namedWorker'”，从而确认Worker/SharedWorker 包装、格式与消息传递在浏览器中可执行。
 */
test('named', async () => {
  await expect
    .poll(() => page.textContent('.pong-named'))
    .toMatch('namedWorker')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.pong-ts-output')”。
 * 验证目标：“page.textContent('.pong-ts-output')” 应匹配 “'pong'”，从而确认Worker/SharedWorker 包装、格式与消息传递在浏览器中可执行。
 */
test('TS output', async () => {
  await expect.poll(() => page.textContent('.pong-ts-output')).toMatch('pong')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.pong-inline')”。
 * 验证目标：“page.textContent('.pong-inline')” 应匹配 “'pong'”，从而确认worker 内联包装器生成可执行 blob/data URL 且保留格式语义。
 */
test('inlined', async () => {
  await expect.poll(() => page.textContent('.pong-inline')).toMatch('pong')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.pong-inline-named')”。
 * 验证目标：“page.textContent('.pong-inline-named')” 应匹配 “'namedInlineWorker'”，从而确认worker 内联包装器生成可执行 blob/data URL 且保留格式语义。
 */
test('named inlined', async () => {
  await expect
    .poll(() => page.textContent('.pong-inline-named'))
    .toMatch('namedInlineWorker')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.tick-count')”。
 * 验证目标：“page.textContent('.tick-count')” 应匹配 “'pong'”，从而确认Worker/SharedWorker 包装、格式与消息传递在浏览器中可执行。
 */
test('shared worker', async () => {
  await expect.poll(() => page.textContent('.tick-count')).toMatch('pong')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.tick-count-named')”。
 * 验证目标：“page.textContent('.tick-count-named')” 应匹配 “'pong'”，从而确认Worker/SharedWorker 包装、格式与消息传递在浏览器中可执行。
 */
test('named shared worker', async () => {
  await expect.poll(() => page.textContent('.tick-count-named')).toMatch('pong')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.pong-shared-inline')”。
 * 验证目标：“page.textContent('.pong-shared-inline')” 应匹配 “'pong'”，从而确认worker 内联包装器生成可执行 blob/data URL 且保留格式语义。
 */
test('inline shared worker', async () => {
  await expect
    .poll(() => page.textContent('.pong-shared-inline'))
    .toMatch('pong')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.nested-worker')”。
 * 验证目标：“page.textContent('.nested-worker')” 应匹配 “'/worker-nested'”；“page.textContent('.nested-worker-module')” 应匹配 “'/sub-worker'”，从而确认子构建递归发现 worker 入口并发出可访问 chunk。
 */
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
  /**
   * 场景：在 “'build'” 中，加载用例 fixture 并观察 “fileContent”。
   * 验证目标：“fileContent” 不应包含 “'my-inline-shared-worker.js'”；“workerContent” 不应匹配 “/import\s*["(]/”，从而确认worker 内联包装器生成可执行 blob/data URL 且保留格式语义。
   */
  test('inlined code generation', async () => {
    const assetsDir = path.resolve(testDir, 'dist/iife/assets')
    const files = fs.readdirSync(assetsDir)

    // 只以内联方式使用的 worker 不应再额外发射独立文件。
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

  /**
   * 场景：在 “'build'” 中，加载用例 fixture 并观察 “page.textContent('.nested-worker-module')”。
   * 验证目标：“page.textContent('.nested-worker-module')” 应匹配 “'"type":"module"'”；“page.textContent('.nested-worker-constructor')” 应匹配 “'"type":"constructor"'”，从而确认子构建递归发现 worker 入口并发出可访问 chunk。
   */
  test('worker emitted and import.meta.url in nested worker (build)', async () => {
    await expect
      .poll(() => page.textContent('.nested-worker-module'))
      .toMatch('"type":"module"')
    await expect
      .poll(() => page.textContent('.nested-worker-constructor'))
      .toMatch('"type":"constructor"')
  })

  /**
   * 场景：在 “'build'” 中，加载用例 fixture 并观察 “manifest['index.html']”。
   * 验证目标：“manifest['index.html']” 应已定义，从而确认子构建递归发现 worker 入口并发出可访问 chunk。
   */
  test('should not emit worker manifest', async () => {
    const manifest = readManifest('iife')
    expect(manifest['index.html']).toBeDefined()
  })
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.worker-import-meta-url')”。
 * 验证目标：“page.textContent('.worker-import-meta-url')” 应匹配 “/A\sstring.*\/iife\/.+url-worker\.js.+url-worker\.js/”；“page.textContent('.worker-import-meta-url-resolve')” 应匹配 “/A\sstring.*\/iife\/.+url-worker\.js.+url-worker\.js/”，从而确认Worker/SharedWorker 包装、格式与消息传递在浏览器中可执行。
 */
test('module worker', async () => {
  // IIFE 输出中 import.meta.url / resolve 均需改写为基于 self.location 的表达式。
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

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.classic-worker')”。
 * 验证目标：“page.textContent('.classic-worker')” 应匹配 “'A classic'”；“page.textContent('.classic-worker-import')” 应匹配 “'[success] classic-esm'”，从而确认Worker/SharedWorker 包装、格式与消息传递在浏览器中可执行。
 */
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

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.simple-worker-url')”。
 * 验证目标：“page.textContent('.simple-worker-url')” 应匹配 “'Hello from simple worker!'”，从而确认Worker/SharedWorker 包装、格式与消息传递在浏览器中可执行。
 */
test('url query worker', async () => {
  await expect
    .poll(() => page.textContent('.simple-worker-url'))
    .toMatch('Hello from simple worker!')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.importMetaGlobEager-worker')”。
 * 验证目标：“page.textContent('.importMetaGlobEager-worker')” 应匹配 “'["'”，从而确认worker 内部的插件解析、glob/JSON 和包自引用与主构建一致。
 */
test('import.meta.glob eager in worker', async () => {
  await expect
    .poll(() => page.textContent('.importMetaGlobEager-worker'))
    .toMatch('["')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.worker-require-json')”。
 * 验证目标：“page.textContent('.worker-require-json')” 应匹配 “'[{"name":"a"},{"name":"b"}]'”，从而确认worker 内部的插件解析、glob/JSON 和包自引用与主构建一致。
 */
test.runIf(isBuild)('require json in worker', async () => {
  await expect
    .poll(() => page.textContent('.worker-require-json'))
    .toMatch('[{"name":"a"},{"name":"b"}]')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.self-reference-worker')”。
 * 验证目标：“page.textContent('.self-reference-worker')” 应等于 “'pong: main\npong: nested\n'”，从而确认worker 内部的插件解析、glob/JSON 和包自引用与主构建一致。
 */
test('self reference worker', async () => {
  // 自引用由运行时逻辑终止，不应被 worker 子构建缓存误判为静态循环。
  await expect
    .poll(() => page.textContent('.self-reference-worker'))
    .toBe('pong: main\npong: nested\n')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.self-reference-url-worker')”。
 * 验证目标：“page.textContent('.self-reference-url-worker')” 应等于 “'pong: main\npong: nested\n'”，从而确认worker 内部的插件解析、glob/JSON 和包自引用与主构建一致。
 */
test('self reference url worker', async () => {
  await expect
    .poll(() => page.textContent('.self-reference-url-worker'))
    .toBe('pong: main\npong: nested\n')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.self-reference-url-worker-dep')”。
 * 验证目标：“page.textContent('.self-reference-url-worker-dep')” 应等于 “'pong: main\npong: nested\n'”，从而确认worker 内部的插件解析、glob/JSON 和包自引用与主构建一致。
 */
test('self reference url worker in dependency', async () => {
  await expect
    .poll(() => page.textContent('.self-reference-url-worker-dep'))
    .toBe('pong: main\npong: nested\n')
})

/**
 * 场景：在当前 playground 中，导航到 “page.goto(viteTestUrl)”。
 * 验证目标：移除注入的 env import 后，Source Map 的 sources 必须指向 `my-worker.ts?worker_file&type=module`，mappings 仍覆盖原 worker 语句，确认运行时前置代码没有错移源码行列。
 */
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
