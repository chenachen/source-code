import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { isBuild, testDir } from '~utils'

describe.runIf(isBuild)('build', () => {
  // 核对构建文件名与内联映射模式。
  /** 仅构建模式枚举输出，确认不发射 map 文件；读取主 chunk 与各 worker，要求映射 URL 均为 data 协议，并检查独立入口 URL、内联 Blob 和嵌套引用。 */
  test('sourcemap generation for web workers', async () => {
    const assetsDir = path.resolve(testDir, 'dist/iife-sourcemap-inline/assets')
    const files = fs.readdirSync(assetsDir)
    // 内联 source map 模式不应另产出 .map 文件。
    expect(files.filter((f) => f.endsWith('.map'))).toStrictEqual([])
    const index = files.find((f) => f.includes('main-module'))
    const content = fs.readFileSync(path.resolve(assetsDir, index), 'utf-8')
    const indexSourcemap = getSourceMapUrl(content)
    const worker = files.find((f) => /^my-worker-[-\w]+\.js$/.test(f))
    const workerContent = fs.readFileSync(
      path.resolve(assetsDir, worker),
      'utf-8',
    )
    const workerSourcemap = getSourceMapUrl(workerContent)
    const sharedWorker = files.find((f) =>
      /^my-shared-worker-[-\w]+\.js$/.test(f),
    )
    const sharedWorkerContent = fs.readFileSync(
      path.resolve(assetsDir, sharedWorker),
      'utf-8',
    )
    const sharedWorkerSourcemap = getSourceMapUrl(sharedWorkerContent)
    const possibleTsOutputWorker = files.find((f) =>
      /^possible-ts-output-worker-[-\w]+\.js$/.test(f),
    )
    const possibleTsOutputWorkerContent = fs.readFileSync(
      path.resolve(assetsDir, possibleTsOutputWorker),
      'utf-8',
    )
    const possibleTsOutputWorkerSourcemap = getSourceMapUrl(
      possibleTsOutputWorkerContent,
    )
    const workerNestedWorker = files.find((f) =>
      /^worker-nested-worker-[-\w]+\.js$/.test(f),
    )
    const workerNestedWorkerContent = fs.readFileSync(
      path.resolve(assetsDir, workerNestedWorker),
      'utf-8',
    )
    const workerNestedWorkerSourcemap = getSourceMapUrl(
      workerNestedWorkerContent,
    )
    const subWorker = files.find((f) => /^sub-worker-[-\w]+\.js$/.test(f))
    const subWorkerContent = fs.readFileSync(
      path.resolve(assetsDir, subWorker),
      'utf-8',
    )
    const subWorkerSourcemap = getSourceMapUrl(subWorkerContent)

    // 按当前 sourcemap 模式核对代码中的映射 URL。
    expect(indexSourcemap).toMatch(/^data:/)
    expect(workerSourcemap).toMatch(/^data:/)
    expect(sharedWorkerSourcemap).toMatch(/^data:/)
    expect(possibleTsOutputWorkerSourcemap).toMatch(/^data:/)
    expect(workerNestedWorkerSourcemap).toMatch(/^data:/)
    expect(subWorkerSourcemap).toMatch(/^data:/)

    // IIFE worker 不应残留导入或导出语法。
    expect(workerContent).not.toMatch(/import\s*["(]/)
    expect(workerContent).not.toMatch(/\bexport\b/)

    // IIFE SharedWorker 不应残留导入或导出语法。
    expect(sharedWorkerContent).not.toMatch(/import\s*["(]/)
    expect(sharedWorkerContent).not.toMatch(/\bexport\b/)

    // 独立 worker 的构造器应指向外置 chunk。
    expect(content).toMatch(
      'new Worker(`/iife-sourcemap-inline/assets/my-worker',
    )
    expect(content).toMatch('new Worker(`data:text/javascript;charset=utf-8,')
    expect(content).toMatch(
      'new Worker(`/iife-sourcemap-inline/assets/possible-ts-output-worker',
    )
    expect(content).toMatch(
      'new Worker(`/iife-sourcemap-inline/assets/worker-nested-worker',
    )
    expect(content).toMatch(
      'new SharedWorker(`/iife-sourcemap-inline/assets/my-shared-worker',
    )

    // 内联 worker 包装器应包含 Blob URL 创建代码。
    expect(content).toMatch(`(self.URL||self.webkitURL).createObjectURL`)
    expect(content).toMatch(`self.Blob`)

    expect(workerNestedWorkerContent).toMatch(
      'new Worker(`/iife-sourcemap-inline/assets/sub-worker',
    )
  })
})

/** 从代码中取第一个 sourceURL/sourceMappingURL 的非空 URL；未匹配时返回 null。
 * @param code 待检查的构建产物。
 * @returns 匹配到的 URL 文本，或无匹配时的 null（现有签名仍为 string）。
 */
function getSourceMapUrl(code: string): string {
  const regex = /\/\/[#@]\ssource(?:Mapping)?URL=\s*(\S+)/
  const results = regex.exec(code)

  if (results && results.length >= 2) {
    return results[1]
  }
  return null
}
