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
        ? /\/es\/assets\/worker_asset-vite-[\w-]{8}\.svg/
        : '/es/vite.svg',
    )
  await expect.poll(() => page.textContent('.dep-cjs')).toMatch('[cjs ok]')
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

/** 页面启动 inline worker 并回显 import.meta.url，轮询其协议为 blob 或 http；该正则不单独区分具体运行模式。 */
test('import meta url', async () => {
  await expect
    .poll(() => page.textContent('.pong-inline-url'))
    .toMatch(/^(blob|http):/)
})

/** 页面给 inline worker 发送含 Unicode 的请求，轮询 •pong•，验证内联编码与消息内容保持字符。 */
test('unicode inlined', async () => {
  await expect
    .poll(() => page.textContent('.pong-inline-unicode'))
    .toMatch('•pong•')
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

/** 页面启动三层 worker，依次轮询 root、second、third 的消息和各自入口 URL，验证递归子构建与路径传递。 */
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
  /** 仅构建模式枚举输出并读取独立 worker 与主 chunk：检查 worker 无所匹配的 import/export 文本，主 chunk 使用资产 URL，内联包装含 Blob/createObjectURL；ES 套件还检查 data URL 回退与内联 SharedWorker。 */
  test('inlined code generation', async () => {
    const assetsDir = path.resolve(testDir, 'dist/es/assets')
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

  /** 仅构建模式检查已启动嵌套 worker 的回传，分别要求 module 与 constructor 类型文本，验证两条创建路径的产物可执行。 */
  test('worker emitted and import.meta.url in nested worker (build)', async () => {
    await expect
      .poll(() => page.textContent('.nested-worker-module'))
      .toMatch('"type":"module"')
    await expect
      .poll(() => page.textContent('.nested-worker-constructor'))
      .toMatch('"type":"constructor"')
  })
})

/** 页面分别通过相对路径、别名、无扩展名 URL 创建 worker，并连接 URL SharedWorker；轮询 A string，IIFE 另检查回显的入口 URL。 */
test('module worker', async () => {
  // Worker URL 的相对路径、别名与省略扩展名都应解析到同一入口。
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

/** 页面启动会拆分子图的 worker，核对模块/worker 复用及静动态导入的完整消息；relative-base 套件仅 build 执行，并检查动态结果中的 ./ base。 */
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

/** 页面将 ?worker&url 导出的 URL 交给 Worker，轮询 Hello from simple worker，验证 URL 包装入口。 */
test('url query worker', async () => {
  await expect
    .poll(() => page.textContent('.simple-worker-url'))
    .toMatch('Hello from simple worker!')
})

/** worker 的 lazy glob 生成导入函数映射，但未调用这些函数；回传匹配键数组，页面轮询文本含 JSON 数组开头，验证键数组消息已到达。 */
test('import.meta.glob in worker', async () => {
  await expect
    .poll(() => page.textContent('.importMetaGlob-worker'))
    .toMatch('["')
})

/** worker 的 eager glob 预先导入匹配模块，再回传映射的键数组；页面轮询文本含 JSON 数组开头，验证键数组消息已到达。 */
test('import.meta.glob with eager in worker', async () => {
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
    .toMatch('pong: main\npong: nested\n')
})

/** 页面启动 new URL 自引用入口，以 main 消息控制只创建下一层，轮询两行 main/nested，验证两层执行。 */
test('self reference url worker', async () => {
  await expect
    .poll(() => page.textContent('.self-reference-url-worker'))
    .toMatch('pong: main\npong: nested\n')
})
