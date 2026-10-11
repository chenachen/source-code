import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'
import { isBuild, readFile, testDir } from '~utils'

/** Promise化execFile，供构建产物在真实Node进程执行检查。 */
const execFileAsync = promisify(execFile)

/** 场景：仅构建执行，读取SSR main.mjs核对目录/文件/exports/deep/module-sync五种external入口说明符，再用Node执行产物；被注释的utils深层路径断言未执行。 */
test.runIf(isBuild)('correctly resolve entrypoints', async () => {
  const contents = readFile('dist/main.mjs')

  const _ = `['"]`
  expect(contents).toMatch(
    new RegExp(`from ${_}@vitejs/test-entries/dir/index.js${_}`),
  )
  expect(contents).toMatch(
    new RegExp(`from ${_}@vitejs/test-entries/file.js${_}`),
  )
  expect(contents).toMatch(
    new RegExp(`from ${_}@vitejs/test-resolve-pkg-exports/entry${_}`),
  )

  expect(contents).toMatch(
    new RegExp(`from ${_}@vitejs/test-deep-import/foo/index.js${_}`),
  )

  // expect(contents).toMatch(
  //   new RegExp(`from ${_}@vitejs/test-deep-import/utils/bar.js${_}`),
  // )

  expect(contents).toMatch(new RegExp(`from ${_}@vitejs/test-module-sync${_}`))

  await execFileAsync('node', [`${testDir}/dist/main.mjs`])
})

/** 场景：仅构建执行，读取SSR入口JS，核对未使用的node:url没有残留在输出。 */
test.runIf(isBuild)(
  'node builtins should not be bundled if not used',
  async () => {
    const contents = readFile('dist/main.mjs')
    expect(contents).not.include(`node:url`)
  },
)
