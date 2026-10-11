import { expect, test } from 'vitest'
import { port } from './serve'
import { findAssetFile, isBuild, listAssets, page } from '~utils'

/** custom serve后端应用地址。 */
const url = `http://localhost:${port}`

/** 场景：访问static-light路由，初始化内联Wasm；核对页面结果42。 */
test('should work when inlined', async () => {
  await page.goto(`${url}/static-light`)
  expect(await page.textContent('.static-light')).toMatch('42')
})

/** 场景：访问static-heavy路由，初始化外置Wasm；核对页面结果24。 */
test('should work when output', async () => {
  await page.goto(`${url}/static-heavy`)
  expect(await page.textContent('.static-heavy')).toMatch('24')
})

/** 场景：仅构建执行：输出列表无light Wasm文件，static-light JS含Wasm base64 data URL。 */
test.runIf(isBuild)('should not contain wasm file when inlined', async () => {
  const assets = await listAssets()
  const lightWasm = assets.find((f) => /^light-[^-]+\.wasm$/.test(f))
  expect(lightWasm).toBeUndefined()

  const staticLight = await findAssetFile(/^static-light-.+\.js$/)
  expect(staticLight).toContain('data:application/wasm;base64,')
})

/** 场景：仅构建执行：输出列表有heavy Wasm文件，static-heavy JS引用其文件名且没有Wasm data URL。 */
test.runIf(isBuild)(
  'should contain and reference wasm file when output',
  async () => {
    const assets = await listAssets()
    const heavyWasm = assets.find((f) => /heavy-.+\.wasm$/.test(f))
    expect(heavyWasm).toBeDefined()

    const staticHeavy = await findAssetFile(/^static-heavy-.+\.js$/)
    expect(staticHeavy).toContain(heavyWasm)
    expect(staticHeavy).not.toContain('data:application/wasm;base64,')
  },
)

/** 场景：访问direct-add路由执行Wasm直接导入；核对加法结果3。 */
test('direct wasm import', async () => {
  await page.goto(`${url}/direct-add`)
  expect(await page.textContent('.direct-add')).toMatch('3')
})

/** 场景：仅构建执行：输出add Wasm文件存在，direct-add JS引用文件名且没有data URL，核对直接导入外置产物。 */
test.runIf(isBuild)(
  'direct wasm import should contain and reference wasm file',
  async () => {
    const assets = listAssets()
    const addWasm = assets.find((f) => /add-.+\.wasm$/.test(f))
    expect(addWasm).toBeDefined()

    const directAdd = findAssetFile(/^direct-add-.+\.js$/)
    expect(directAdd).toContain(addWasm)
    expect(directAdd).not.toContain('data:application/wasm;base64,')
  },
)

/** 场景：访问direct-light路由，Wasm还有导入依赖；核对运行结果42。 */
test('direct wasm import with wasm imports', async () => {
  await page.goto(`${url}/direct-light`)
  expect(await page.textContent('.direct-light')).toMatch('42')
})
