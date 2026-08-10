import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { isBuild, page, testDir } from '~utils'

/**
 * ES 格式 worker 的浏览器集成矩阵。
 *
 * 覆盖独立/内联 Worker、SharedWorker、嵌套 worker、资产和依赖导入、glob 与
 * 自引用；既检查页面消息，也在 build 下检查子构建产物和包装器代码形态。
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
        ? /\/es\/assets\/worker_asset-vite-[\w-]{8}\.svg/
        : '/es/vite.svg',
    )
  await expect.poll(() => page.textContent('.dep-cjs')).toMatch('[cjs ok]')
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
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.pong-inline-url')”。
 * 验证目标：“page.textContent('.pong-inline-url')” 应匹配 “/^(blob|http):/”，从而确认Worker/SharedWorker 包装、格式与消息传递在浏览器中可执行。
 */
test('import meta url', async () => {
  await expect
    .poll(() => page.textContent('.pong-inline-url'))
    .toMatch(/^(blob|http):/)
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.pong-inline-unicode')”。
 * 验证目标：“page.textContent('.pong-inline-unicode')” 应匹配 “'•pong•'”，从而确认worker 内联包装器生成可执行 blob/data URL 且保留格式语义。
 */
test('unicode inlined', async () => {
  await expect
    .poll(() => page.textContent('.pong-inline-unicode'))
    .toMatch('•pong•')
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
 * 验证目标：“page.textContent('.nested-worker')” 应匹配 “'worker-nested-worker'”；“page.textContent('.nested-worker-module')” 应匹配 “'sub-worker'”，从而确认子构建递归发现 worker 入口并发出可访问 chunk。
 */
test('worker emitted and import.meta.url in nested worker (serve)', async () => {
  await expect
    .poll(() => page.textContent('.nested-worker'))
    .toMatch('worker-nested-worker')
  await expect
    .poll(() => page.textContent('.nested-worker-module'))
    .toMatch('sub-worker')
  await expect
    .poll(() => page.textContent('.nested-worker-constructor'))
    .toMatch('"type":"constructor"')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.deeply-nested-worker')”。
 * 验证目标：“page.textContent('.deeply-nested-worker')” 应匹配 “/Hello\sfrom\sroot.*\/es\/.+deeply-nested-worker\.js/”；“page.textContent('.deeply-nested-second-worker')” 应匹配 “/Hello\sfrom\ssecond.*\/es\/.+second-worker\.js/”，从而确认子构建递归发现 worker 入口并发出可访问 chunk。
 */
test('deeply nested workers', async () => {
  await expect
    .poll(() => page.textContent('.deeply-nested-worker'))
    .toMatch(/Hello\sfrom\sroot.*\/es\/.+deeply-nested-worker\.js/)
  await expect
    .poll(() => page.textContent('.deeply-nested-second-worker'))
    .toMatch(/Hello\sfrom\ssecond.*\/es\/.+second-worker\.js/)
  await expect
    .poll(() => page.textContent('.deeply-nested-third-worker'))
    .toMatch(/Hello\sfrom\sthird.*\/es\/.+third-worker\.js/)
})

describe.runIf(isBuild)('build', () => {
  // 构建期不仅检查功能，还直接检查文件集合与包装器代码。
  /**
   * 场景：在 “'build'” 中，加载用例 fixture 并观察 “fileContent”。
   * 验证目标：“fileContent” 不应包含 “'my-inline-shared-worker.js'”；“workerContent” 不应匹配 “/import\s*["(]/”，从而确认worker 内联包装器生成可执行 blob/data URL 且保留格式语义。
   */
  test('inlined code generation', async () => {
    const assetsDir = path.resolve(testDir, 'dist/es/assets')
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
    const worker = files.find((f) => f.includes('my-worker'))
    const workerContent = fs.readFileSync(
      path.resolve(assetsDir, worker),
      'utf-8',
    )

    // 独立 worker 已完成子构建，内部 import 必须解析完毕，也不能残留 export。
    expect(workerContent).not.toMatch(/import\s*["(]/)
    expect(workerContent).not.toMatch(/\bexport\b/)
    // 主 chunk 引用独立 Worker / SharedWorker 资产 URL。
    expect(content).toMatch('new Worker(`/es/assets')
    expect(content).toMatch('new SharedWorker(`/es/assets')
    // 普通内联 Worker 优先使用 blob URL，并提供失败时的 data URL 回退。
    expect(content).toMatch(`(self.URL||self.webkitURL).createObjectURL`)
    expect(content).toMatch(`self.Blob`)
    expect(content).toMatch(
      /try\{if\(\w+=\w+&&\(self\.URL\|\|self\.webkitURL\)\.createObjectURL\(\w+\),!\w+\)throw``/,
    )
    // 内联 SharedWorker 使用稳定内容的 data URL，避免不同 blob URL 创建多个实例。
    expect(content).toMatch(
      'return new SharedWorker(`data:text/javascript;charset=utf-8,',
    )
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
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.worker-import-meta-url')”。
 * 验证目标：“page.textContent('.worker-import-meta-url')” 应匹配 “'A string'”；“page.textContent('.worker-import-meta-url-resolve')” 应匹配 “'A string'”，从而确认Worker/SharedWorker 包装、格式与消息传递在浏览器中可执行。
 */
test('module worker', async () => {
  // module worker 内的 import.meta.url / resolve 也必须相对 worker 入口求值。
  await expect
    .poll(() => page.textContent('.worker-import-meta-url'))
    .toMatch('A string')
  await expect
    .poll(() => page.textContent('.worker-import-meta-url-resolve'))
    .toMatch('A string')
  await expect
    .poll(() => page.textContent('.worker-import-meta-url-without-extension'))
    .toMatch('A string')
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
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.emit-chunk-worker')”。
 * 验证目标：“page.textContent('.emit-chunk-worker')” 应匹配 “'["A string",{"type":"emit-chunk-sub-worker","data":"A string"},{"type":"module-and-worker:worker","data…”；“page.textContent('.emit-chunk-dynamic-import-worker')” 应匹配 “'"A stringmodule1/es/"'”，从而确认子构建递归发现 worker 入口并发出可访问 chunk。
 */
test('emit chunk', async () => {
  // worker 子构建可继续拆分静态/动态 chunk，并复用同时作为普通模块导入的依赖。
  await expect
    .poll(() => page.textContent('.emit-chunk-worker'))
    .toMatch(
      '["A string",{"type":"emit-chunk-sub-worker","data":"A string"},{"type":"module-and-worker:worker","data":"A string"},{"type":"module-and-worker:module","data":"module and worker"},{"type":"emit-chunk-sub-worker","data":{"module":"module and worker","msg1":"module1","msg2":"module2","msg3":"module3"}}]',
    )
  await expect
    .poll(() => page.textContent('.emit-chunk-dynamic-import-worker'))
    .toMatch('"A stringmodule1/es/"')
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
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.importMetaGlob-worker')”。
 * 验证目标：“page.textContent('.importMetaGlob-worker')” 应匹配 “'["'”，从而确认worker 内部的插件解析、glob/JSON 和包自引用与主构建一致。
 */
test('import.meta.glob in worker', async () => {
  await expect
    .poll(() => page.textContent('.importMetaGlob-worker'))
    .toMatch('["')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.importMetaGlobEager-worker')”。
 * 验证目标：“page.textContent('.importMetaGlobEager-worker')” 应匹配 “'["'”，从而确认worker 内部的插件解析、glob/JSON 和包自引用与主构建一致。
 */
test('import.meta.glob with eager in worker', async () => {
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
 * 验证目标：“page.textContent('.self-reference-worker')” 应匹配 “'pong: main\npong: nested\n'”，从而确认worker 内部的插件解析、glob/JSON 和包自引用与主构建一致。
 */
test('self reference worker', async () => {
  // 自引用由运行时条件终止；验证缓存不会把合法递归引用误报为构建期循环。
  await expect
    .poll(() => page.textContent('.self-reference-worker'))
    .toMatch('pong: main\npong: nested\n')
})

/**
 * 场景：在当前 playground 中，加载用例 fixture 并观察 “page.textContent('.self-reference-url-worker')”。
 * 验证目标：“page.textContent('.self-reference-url-worker')” 应匹配 “'pong: main\npong: nested\n'”，从而确认worker 内部的插件解析、glob/JSON 和包自引用与主构建一致。
 */
test('self reference url worker', async () => {
  await expect
    .poll(() => page.textContent('.self-reference-url-worker'))
    .toMatch('pong: main\npong: nested\n')
})
