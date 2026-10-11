import { expect, test } from 'vitest'
import { isBuild, page } from '~utils'

/** 页面启动相对 base 的 worker 并回显导入 SVG URL，构建应包含 /worker-assets/worker_asset-vite，dev 保留 /vite.svg。 */
test('asset url', async () => {
  await expect
    .poll(() => page.textContent('.asset-url'))
    .toMatch(isBuild ? '/worker-assets/worker_asset-vite' : '/vite.svg')
})
