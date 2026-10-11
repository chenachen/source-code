import { fileURLToPath } from 'node:url'
import type { OutputAsset, RollupOutput } from 'rollup'
import { expect, test } from 'vitest'
import { build } from '../../build'

/** 对含依赖的 license fixture 开启默认 license 输出并只构建到内存；应生成 .vite/license.md，其归集内容与快照一致。 */
test('markdown', async () => {
  const result = (await build({
    root: fileURLToPath(new URL('./fixtures/license', import.meta.url)),
    logLevel: 'silent',
    build: {
      write: false,
      license: true,
    },
  })) as RollupOutput
  const licenseAsset = result.output.find(
    (asset) => asset.fileName === '.vite/license.md',
  ) as OutputAsset | undefined
  expect(licenseAsset).toBeDefined()
  expect(licenseAsset?.source).toMatchSnapshot()
})

/** 对同一 fixture 指定 .vite/license.json 文件名并构建到内存；应生成该 JSON 资产且内容与快照一致。 */
test('json', async () => {
  const result = (await build({
    root: fileURLToPath(new URL('./fixtures/license', import.meta.url)),
    logLevel: 'silent',
    build: {
      write: false,
      license: {
        fileName: '.vite/license.json',
      },
    },
  })) as RollupOutput
  const licenseAsset = result.output.find(
    (asset) => asset.fileName === '.vite/license.json',
  ) as OutputAsset | undefined
  expect(licenseAsset).toBeDefined()
  expect(licenseAsset?.source).toMatchSnapshot()
})
