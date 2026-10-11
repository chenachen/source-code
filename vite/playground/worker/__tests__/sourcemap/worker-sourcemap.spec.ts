import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { isBuild, testDir } from '~utils'

describe.runIf(isBuild)('build', () => {
  // 核对构建文件名与映射产物。
  /** 仅构建模式枚举每个 JS 的配套 map，读取主 chunk 与各 worker 的映射 URL 并检查对应文件名，再核对独立入口 URL、内联 Blob 与嵌套引用。 */
  test('sourcemap generation for web workers', async () => {
    const assetsDir = path.resolve(testDir, 'dist/iife-sourcemap/assets')
    const files = fs.readdirSync(assetsDir)

    // 每份 JS 文件应有对应的外置 .js.map。
    for (const jsFile of files.filter((f) => f.endsWith('.js'))) {
      expect(files, `missing sourcemap for ${jsFile}`).toContain(
        `${jsFile}.map`,
      )
    }

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

    expect(files).toContainEqual(
      expect.stringMatching(/^index-[-\w]+\.js\.map$/),
    )
    expect(files).toContainEqual(
      expect.stringMatching(/^my-worker-[-\w]+\.js\.map$/),
    )
    expect(files).toContainEqual(
      expect.stringMatching(/^my-shared-worker-[-\w]+\.js\.map$/),
    )
    expect(files).toContainEqual(
      expect.stringMatching(/^possible-ts-output-worker-[-\w]+\.js\.map$/),
    )
    expect(files).toContainEqual(
      expect.stringMatching(/^worker-nested-worker-[-\w]+\.js\.map$/),
    )
    expect(files).toContainEqual(
      expect.stringMatching(/^sub-worker-[-\w]+\.js\.map$/),
    )

    // 按当前 sourcemap 模式核对代码中的映射 URL。
    expect(indexSourcemap).toMatch(/^main-module-[-\w]+\.js\.map$/)
    expect(workerSourcemap).toMatch(/^my-worker-[-\w]+\.js\.map$/)
    expect(sharedWorkerSourcemap).toMatch(/^my-shared-worker-[-\w]+\.js\.map$/)
    expect(possibleTsOutputWorkerSourcemap).toMatch(
      /^possible-ts-output-worker-[-\w]+\.js\.map$/,
    )
    expect(workerNestedWorkerSourcemap).toMatch(
      /^worker-nested-worker-[-\w]+\.js\.map$/,
    )
    expect(subWorkerSourcemap).toMatch(/^sub-worker-[-\w]+\.js\.map$/)

    // IIFE worker 不应残留导入或导出语法。
    expect(workerContent).not.toMatch(/import\s*["(]/)
    expect(workerContent).not.toMatch(/\bexport\b/)

    // IIFE SharedWorker 不应残留导入或导出语法。
    expect(sharedWorkerContent).not.toMatch(/import\s*["(]/)
    expect(sharedWorkerContent).not.toMatch(/\bexport\b/)

    // 独立 worker 的构造器应指向外置 chunk。
    expect(content).toMatch('new Worker(`/iife-sourcemap/assets/my-worker')
    expect(content).toMatch('new Worker(`data:text/javascript;charset=utf-8,')
    expect(content).toMatch(
      'new Worker(`/iife-sourcemap/assets/possible-ts-output-worker',
    )
    expect(content).toMatch(
      'new Worker(`/iife-sourcemap/assets/worker-nested-worker',
    )
    expect(content).toMatch(
      'new SharedWorker(`/iife-sourcemap/assets/my-shared-worker',
    )

    // 内联 worker 包装器应包含 Blob URL 创建代码。
    expect(content).toMatch(`(self.URL||self.webkitURL).createObjectURL`)
    expect(content).toMatch(`self.Blob`)

    expect(workerNestedWorkerContent).toMatch(
      'new Worker(`/iife-sourcemap/assets/sub-worker',
    )
  })
})

/** 从代码中取最后一个 sourceURL/sourceMappingURL 的非空 URL；未匹配时返回 null。
 * @param code 待检查的构建产物。
 * @returns 匹配到的 URL 文本，或无匹配时的 null（现有签名仍为 string）。
 */
function getSourceMapUrl(code: string): string {
  const regex = /\/\/[#@]\ssource(?:Mapping)?URL=\s*(\S+)/g
  const matches = [...code.matchAll(regex)]
  const results = matches.at(-1)

  if (results && results.length >= 2) {
    return results[1]
  }
  return null
}
