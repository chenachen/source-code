import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { resolveConfig } from '../config'
import { createIsConfiguredAsExternal } from '../external'
import { PartialEnvironment } from '../baseEnvironment'

describe('createIsConfiguredAsExternal', () => {
  /**
   * 场景：未配置 resolve.external 的 workspace fixture 包。
   * 验证目标：链接/源码包默认不外部化，应进入 Vite 转换与 bundle。
   */
  test('default', async () => {
    const isExternal = await createIsExternal()
    expect(isExternal('@vitejs/cjs-ssr-dep')).toBe(false)
  })

  /**
   * 场景：resolve.external=true。
   * 验证目标：显式全量 external 覆盖链接包的默认保护，只要文件类型可外部化就返回 true。
   */
  test('force external', async () => {
    const isExternal = await createIsExternal(true)
    expect(isExternal('@vitejs/cjs-ssr-dep')).toBe(true)
  })
})

/** 解析最小 SSR 配置，并返回只考虑 external/noExternal 的判定器。 */
async function createIsExternal(external?: true) {
  const resolvedConfig = await resolveConfig(
    {
      configFile: false,
      root: fileURLToPath(new URL('./', import.meta.url)),
      resolve: { external },
    },
    'serve',
  )
  const environment = new PartialEnvironment('ssr', resolvedConfig)
  return createIsConfiguredAsExternal(environment)
}
