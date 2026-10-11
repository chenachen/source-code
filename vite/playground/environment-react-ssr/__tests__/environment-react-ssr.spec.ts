import fs from 'node:fs'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, onTestFinished, test } from 'vitest'
import {
  isBuild,
  isBundledDev,
  page,
  readDepOptimizationMetadata,
  readFile,
  serverLogs,
  testDir,
} from '~utils'

/** 场景：React SSR页面执行hydration；调用hydrated/Count0的isVisible后点击+，再调用Count1的isVisible。此例未断言isVisible返回布尔值，操作成功是实际检查范围。 */
test('basic', async () => {
  await page.getByText('hydrated: true').isVisible()
  await page.getByText('Count: 0').isVisible()
  await page.getByRole('button', { name: '+' }).click()
  await page.getByText('Count: 1').isVisible()
})

describe.runIf(!isBuild)('pre-bundling', () => {
  // bundled dev 的client依赖来自bundle，没有可读取的.vite/deps。
  /** 场景：仅非构建且非bundledDev执行：读取client依赖优化清单，核对React/client/JSX runtime存在而react-dom/server不存在。bundledDev没有client optimizer，故skip。 */
  test.skipIf(isBundledDev)('client', async () => {
    const metaJson = readDepOptimizationMetadata()

    expect(metaJson.optimized['react']).toBeTruthy()
    expect(metaJson.optimized['react-dom/client']).toBeTruthy()
    expect(metaJson.optimized['react/jsx-dev-runtime']).toBeTruthy()

    expect(metaJson.optimized['react-dom/server']).toBeFalsy()
  })

  /** 场景：仅非构建执行：读取SSR优化清单，核对React/server/JSX runtime存在而client不存在；扫描SSR产物至少一份保留process.env.NODE_ENV。 */
  test('ssr', async () => {
    const metaJson = readDepOptimizationMetadata('ssr')

    expect(metaJson.optimized['react']).toBeTruthy()
    expect(metaJson.optimized['react-dom/server']).toBeTruthy()
    expect(metaJson.optimized['react/jsx-dev-runtime']).toBeTruthy()

    expect(metaJson.optimized['react-dom/client']).toBeFalsy()

    // keepProcessEnv=true 应让SSR优化产物保留process.env.NODE_ENV。
    const depsFiles = fs
      .readdirSync(path.resolve(testDir, 'node_modules/.vite/deps_ssr'), {
        withFileTypes: true,
      })
      .filter((file) => file.isFile() && file.name.endsWith('.js'))
      .map((file) => path.join(file.parentPath, file.name))
    const depsFilesWithProcessEnvNodeEnv = depsFiles.filter((file) =>
      fs.readFileSync(file, 'utf-8').includes('process.env.NODE_ENV'),
    )

    expect(depsFilesWithProcessEnvNodeEnv.length).toBeGreaterThan(0)
  })

  // bundled dev 没有client优化元数据，不能运行此两环境增量优化比较。
  /** 场景：仅非构建且非bundledDev执行：初始两环境无fake包，给client/server入口各加对应导入并注册文件恢复；等待server→client优化日志顺序，再核对各清单只新增自身fake依赖。bundledDev skip。 */
  test.skipIf(isBundledDev)('deps reload', async () => {
    const envs = ['client', 'server'] as const

    const clientMeta = readDepOptimizationMetadata('client')
    const ssrMeta = readDepOptimizationMetadata('ssr')
    expect(clientMeta.optimized['react-fake-client']).toBeFalsy()
    expect(clientMeta.optimized['react-fake-server']).toBeFalsy()
    expect(ssrMeta.optimized['react-fake-server']).toBeFalsy()
    expect(ssrMeta.optimized['react-fake-client']).toBeFalsy()

    envs.forEach((env) => {
      const filePath = path.resolve(testDir, `src/entry-${env}.tsx`)
      const originalContent = readFile(filePath)
      fs.writeFileSync(
        filePath,
        `import 'react-fake-${env}'\n${originalContent}`,
        'utf-8',
      )
      onTestFinished(() => {
        fs.writeFileSync(filePath, originalContent, 'utf-8')
      })
    })

    await expect
      .poll(() =>
        serverLogs
          .map(
            (log) =>
              stripVTControlCharacters(log).match(
                /dependenc(?:y|ies) optimized: (react-fake-.*)/,
              )?.[1],
          )
          .filter(Boolean),
      )
      .toStrictEqual(['react-fake-server', 'react-fake-client'])

    const clientMetaNew = readDepOptimizationMetadata('client')
    const ssrMetaNew = readDepOptimizationMetadata('ssr')
    expect(clientMetaNew.optimized['react-fake-client']).toBeTruthy()
    expect(clientMetaNew.optimized['react-fake-server']).toBeFalsy()
    expect(ssrMetaNew.optimized['react-fake-server']).toBeTruthy()
    expect(ssrMetaNew.optimized['react-fake-client']).toBeFalsy()
  })
})
