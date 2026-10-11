import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { isBuild, page, testDir } from '~utils'

/** 页面在相对 base 下启动 worker，轮询 pong、NODE_ENV、插件消息及 SVG URL；构建指向 worker-assets，dev 指向 /vite.svg。 */
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
    .toMatch(isBuild ? '/worker-assets/worker_asset-vite' : '/vite.svg')
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

// TODO：inline worker 的资产也应内联。
/** 当前 skip：相对 base 的 inline worker 还需正确内联资产；保留的目标是页面启动后回传 pong，不能视为已验证通过。 */
test.skip('inlined', async () => {
  await expect.poll(() => page.textContent('.pong-inline')).toMatch('pong')
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

describe.runIf(isBuild)('build', () => {
  // 核对构建文件名与 worker 产物。
  /** 仅构建模式读取 chunks 与 worker-entries：确认独立 worker 无所匹配的 import/export，主 chunk 以相对 ../worker-entries 构造 Worker/SharedWorker，并保留 Blob 内联包装。 */
  test('inlined code generation', () => {
    const chunksDir = path.resolve(testDir, 'dist/relative-base/chunks')
    const files = fs.readdirSync(chunksDir)
    const index = files.find((f) => f.includes('main-module'))
    const content = fs.readFileSync(path.resolve(chunksDir, index), 'utf-8')
    const workerEntriesDir = path.resolve(
      testDir,
      'dist/relative-base/worker-entries',
    )
    const workerFiles = fs.readdirSync(workerEntriesDir)
    const worker = workerFiles.find((f) => f.includes('worker_entry-my-worker'))
    const workerContent = fs.readFileSync(
      path.resolve(workerEntriesDir, worker),
      'utf-8',
    )

    // IIFE worker 不应残留导入或导出语法。
    expect(workerContent).not.toMatch(/import\s*["(]/)
    expect(workerContent).not.toMatch(/\bexport\b/)
    // 独立 worker 的构造器应指向外置 chunk。
    expect(content).toMatch('new Worker(``+new URL(`../worker-entries/')
    expect(content).toMatch('new SharedWorker(``+new URL(`../worker-entries/')
    // 内联 worker 包装器应包含 Blob URL 创建代码。
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
})

/** 页面通过 URL 创建 SharedWorker，轮询 A string，覆盖相对 base 下的共享 worker 入口解析。 */
test('module worker', async () => {
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
test.runIf(isBuild)('emit chunk', async () => {
  await expect
    .poll(() => page.textContent('.emit-chunk-worker'))
    .toMatch(
      '["A string",{"type":"emit-chunk-sub-worker","data":"A string"},{"type":"module-and-worker:worker","data":"A string"},{"type":"module-and-worker:module","data":"module and worker"},{"type":"emit-chunk-sub-worker","data":{"module":"module and worker","msg1":"module1","msg2":"module2","msg3":"module3"}}]',
    )
  await expect
    .poll(() => page.textContent('.emit-chunk-dynamic-import-worker'))
    .toMatch('"A stringmodule1./"')
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

/** 页面启动 ?worker 自引用入口，以 main 消息控制只创建下一层，轮询两行 main/nested，验证两层执行且没有持续递归创建。 */
test('self reference worker', async () => {
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
