import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  isBuild,
  isBundled,
  isBundledDev,
  isServe,
  isWindows,
  page,
  testDir,
  viteTestUrl,
} from '~utils'

/** 场景：源文件带UTF8 BOM；读取.utf8-bom，核对模块成功执行。 */
test('bom import', async () => {
  expect(await page.textContent('.utf8-bom')).toMatch('[success]')
})

/** 场景：依赖深层导入；读取.deep-import，核对结果[2,4]。 */
test('deep import', async () => {
  expect(await page.textContent('.deep-import')).toMatch('[2,4]')
})

/** 场景：exports目标位于type不同的嵌套scope；读取对应DOM，核对目标模块成功。 */
test('exports and a nested package scope with a different type', async () => {
  expect(await page.textContent('.exports-and-nested-scope')).toMatch(
    '[success]',
  )
})

/** 场景：包入口由exports指定；读取.exports-entry，核对入口成功。 */
test('entry with exports field', async () => {
  expect(await page.textContent('.exports-entry')).toMatch('[success]')
})

/** 场景：已公开exports子路径；读取.exports-deep，核对深层模块成功。 */
test('deep import with exports field', async () => {
  expect(await page.textContent('.exports-deep')).toMatch('[success]')
})

/** 场景：exports的JSON子路径带?url；读取结果，bundled核对base64、dev核对/exports-path/deep.json。 */
test('deep import with query with exports field', async () => {
  // ?url选择资产URL语义。
  expect(await page.textContent('.exports-deep-query')).toMatch(
    isBundled ? /base64/ : '/exports-path/deep.json',
  )
})

/** 场景：exports公开目录；读取.exposed-dir对应DOM，核对子路径成功。 */
test('deep import with exports field + exposed dir', async () => {
  expect(await page.textContent('.exports-deep-exposed-dir')).toMatch(
    '[success]',
  )
})

/** 场景：exports映射目录；读取.mapped-dir对应DOM，核对映射后的模块成功。 */
test('deep import with exports field + mapped dir', async () => {
  expect(await page.textContent('.exports-deep-mapped-dir')).toMatch(
    '[success]',
  )
})

/** 场景：项目根包提供exports；读取.exports-from-root，核对根映射成功。 */
test('exports read from the root package.json', async () => {
  expect(await page.textContent('.exports-from-root')).toMatch('[success]')
})

// 此fixture复现Svelte 3的exports与legacy结构。
/** 场景：包同时有exports与legacy入口结构；读取.exports-legacy-fallback，核对目标成功。 */
test('deep import with exports and legacy fallback', async () => {
  expect(await page.textContent('.exports-legacy-fallback')).toMatch(
    '[success]',
  )
})

/** 场景：exports含多个环境条件；读取.exports-env，核对所选入口成功。 */
test('Respect exports field env key priority', async () => {
  expect(await page.textContent('.exports-env')).toMatch('[success]')
})

/** 场景：exports production/development条件；读取.exports-env，构建期望browser.prod.mjs，开发期望browser.mjs。 */
test('Respect production/development conditionals', async () => {
  expect(await page.textContent('.exports-env')).toMatch(
    isBuild ? `browser.prod.mjs` : `browser.mjs`,
  )
})

/** 场景：包同时有exports与module字段；读取.exports-with-module，核对exports选定入口成功。 */
test('Respect exports to take precedence over mainFields', async () => {
  expect(await page.textContent('.exports-with-module')).toMatch('[success]')
})

/** 场景：exports提供module条件；分别读取import与require两个结果，核对均成功。 */
test('import and require resolve using module condition', async () => {
  expect(await page.textContent('.exports-with-module-condition')).toMatch(
    '[success]',
  )
  expect(
    await page.textContent('.exports-with-module-condition-required'),
  ).toMatch('[success]')
})

/** 场景：导入目录时省略index.js；读取.index，核对目录入口成功。 */
test('implicit dir/index.js', async () => {
  expect(await page.textContent('.index')).toMatch('[success]')
})

/** 场景：同一路径有目录入口与文件候选；读取.dir-vs-file，核对夹具预期目标成功。 */
test('implicit dir/index.js vs explicit file', async () => {
  expect(await page.textContent('.dir-vs-file')).toMatch('[success]')
})

/** 场景：文件名含.json且实际后缀.js；读取.nested-extension，核对file.json.js。 */
test('nested extension', async () => {
  expect(await page.textContent('.nested-extension')).toMatch(
    '[success] file.json.js',
  )
})

/** 场景：精确.js与追加后缀.js.js候选并存；读取.exact-extension，核对精确目标成功。 */
test('exact extension vs. duplicated (.js.js)', async () => {
  expect(await page.textContent('.exact-extension')).toMatch('[success]')
})

/** 场景：目录名带.js且目标为目录index.js；读取.dir-with-ext，核对目录没有误作文件补后缀。 */
test("don't add extension to directory name (./dir-with-ext.js/index.js)", async () => {
  expect(await page.textContent('.dir-with-ext')).toMatch('[success]')
})

/** 场景：TS导入者以对应.js名引用TS模块；读取.ts-extension，核对扩展回退成功。 */
test('a ts module can import another ts module using its corresponding js file name', async () => {
  expect(await page.textContent('.ts-extension')).toMatch('[success]')
})

/** 场景：JS导入者以对应.js名引用TS模块；读取.js-ts-extension，核对扩展回退成功。 */
test('a js module can import another ts module using its corresponding js file name', async () => {
  expect(await page.textContent('.js-ts-extension')).toMatch('[success]')
})

/** 场景：文件名含额外点号；读取.dot，核对正确模块成功。 */
test('filename with dot', async () => {
  expect(await page.textContent('.dot')).toMatch('[success]')
})

/** 场景：仅Windows执行盘符相对路径导入；读取.drive-relative，核对成功。其他平台不执行。 */
test.runIf(isWindows)('drive-relative path', async () => {
  expect(await page.textContent('.drive-relative')).toMatch('[success]')
})

/** 场景：绝对路径导入模块；读取.absolute，核对成功。 */
test('absolute path', async () => {
  expect(await page.textContent('.absolute')).toMatch('[success]')
})

/** 场景：file URL导入模块；读取.file-url，核对成功。 */
test('file url', async () => {
  expect(await page.textContent('.file-url')).toMatch('[success]')
})

/** 场景：包browser字段映射入口；读取.browser，核对成功。 */
test('browser field', async () => {
  expect(await page.textContent('.browser')).toMatch('[success]')
})

// browser:false替身属性访问回归（#22022）。
/** 场景：browser:false替身被读取属性；读取.browser-field-false-access，核对没有抛错且成功消息出现。 */
test('access property of browser:false module', async () => {
  expect(await page.textContent('.browser-field-false-access')).toMatch(
    '[success]',
  )
})

/** 场景：包同时有browser与module字段；读取.browser-module1，核对browser目标成功。 */
test('Resolve browser field even if module field exists', async () => {
  expect(await page.textContent('.browser-module1')).toMatch('[success]')
})

/** 场景：包入口为CSS；读取.css，核对样式消费成功。 */
test('css entry', async () => {
  expect(await page.textContent('.css')).toMatch('[success]')
})

/** 场景：monorepo符号链接包被导入；读取.monorepo，核对链接目标成功。 */
test('monorepo linked dep', async () => {
  expect(await page.textContent('.monorepo')).toMatch('[success]')
})

/** 场景：插件解析虚拟ID并load代码；读取.virtual，核对成功。 */
test('plugin resolved virtual file', async () => {
  expect(await page.textContent('.virtual')).toMatch('[success]')
})

/** 场景：虚拟模块还包含其他导入；读取.virtual-has-import，核对依赖链成功。 */
test('plugin resolved virtual file that has import', async () => {
  expect(await page.textContent('.virtual-has-import')).toMatch('[success]')
})

/** 场景：插件使用自定义虚拟ID；读取.custom-virtual，核对成功。 */
test('plugin resolved custom virtual file', async () => {
  expect(await page.textContent('.custom-virtual')).toMatch('[success]')
})

/** 场景：虚拟ID含URL scheme；读取.virtual-url-scheme，核对该模块正确执行。 */
test('virtual file with URL scheme should not be rewritten (#20803)', async () => {
  expect(await page.textContent('.virtual-url-scheme')).toMatch('[success]')
})

/** 场景：root内包提供入口；读取.inline-pkg，核对解析成功。 */
test('resolve inline package', async () => {
  expect(await page.textContent('.inline-pkg')).toMatch('[success]')
})

/** 场景：配置额外resolve.extensions；读取.custom-ext，核对自定义后缀成功。 */
test('resolve.extensions', async () => {
  expect(await page.textContent('.custom-ext')).toMatch('[success]')
})

/** 场景：配置自定义mainFields；读取.custom-main-fields，核对指定字段入口成功。 */
test('resolve.mainFields', async () => {
  expect(await page.textContent('.custom-main-fields')).toMatch('[success]')
})

/** 场景：mainFields把browser排前；读取.custom-browser-main-field，核对resolved browser field。 */
test('resolve.mainFields.browser-first', async () => {
  expect(await page.textContent('.custom-browser-main-field')).toBe(
    'resolved browser field',
  )
})

/** 场景：配置自定义exports条件；读取.custom-condition，核对对应入口成功。 */
test('resolve.conditions', async () => {
  expect(await page.textContent('.custom-condition')).toMatch('[success]')
})

/** 场景：包路径含#；读取.path-contains-sharp-symbol，核对三次ok完整结果。 */
test('resolve package that contains # in path', async () => {
  expect(await page.textContent('.path-contains-sharp-symbol')).toMatch(
    '[success] ok ok ok',
  )
})

/** 场景：imports顶层映射；读取.imports-top-level，核对成功。 */
test('Resolving top level with imports field', async () => {
  expect(await page.textContent('.imports-top-level')).toMatch('[success]')
})

/** 场景：同层级使用imports；读取.imports-same-level，与顶层DOM比较核对一致。 */
test('Resolving same level with imports field', async () => {
  expect(await page.textContent('.imports-same-level')).toMatch(
    await page.textContent('.imports-top-level'),
  )
})

/** 场景：嵌套目录使用imports；读取.imports-nested，核对成功。 */
test('Resolving nested path with imports field', async () => {
  expect(await page.textContent('.imports-nested')).toMatch('[success]')
})

/** 场景：imports wildcard映射；读取.imports-star，核对模式子路径成功。 */
test('Resolving star with imports filed', async () => {
  expect(await page.textContent('.imports-star')).toMatch('[success]')
})

/** 场景：imports目录子路径；读取.imports-slash，核对成功。 */
test('Resolving slash with imports filed', async () => {
  expect(await page.textContent('.imports-slash')).toMatch('[success]')
})

/** 场景：另一包内部使用自己的imports；读取.imports-pkg-slash，核对作用域目标成功。 */
test('Resolving from other package with imports field', async () => {
  expect(await page.textContent('.imports-pkg-slash')).toMatch('[success]')
})

/** 场景：imports JSON目标带?url；读取结果，bundled为base64，dev为/imports-path/query.json。 */
test('Resolving with query with imports field', async () => {
  // ?url选择资产URL语义。
  expect(await page.textContent('.imports-query')).toMatch(
    isBundled ? /base64/ : '/imports-path/query.json',
  )
})

/** 场景：imports目标目录以点开头；读取.imports-dot-prefixed，核对成功。 */
test('Resolving dot-prefixed directory with imports field', async () => {
  expect(await page.textContent('.imports-dot-prefixed')).toMatch('[success]')
})

/** 场景：imports提供#后紧接斜杠的根alias模式；读取.imports-root-slash，核对成功。 */
test('Resolving #/ root alias pattern with imports field', async () => {
  // package imports中#后紧接斜杠的模式（Node PR 60864）。
  expect(await page.textContent('.imports-root-slash')).toMatch('[success]')
})

/** 场景：导航HTML根URL附?test.css；核对overlay数量0且h1为Resolve，没有把导航误当CSS模块。 */
test("Resolve doesn't interrupt page request with trailing query and .css", async () => {
  await page.goto(viteTestUrl + '/?test.css')
  expect(await page.locator('vite-error-overlay').count()).toBe(0)
  expect(await page.textContent('h1')).toBe('Resolve')
})

/** 场景：导入未归一化的绝对路径；读取.non-normalized，核对成功。 */
test('resolve non-normalized absolute path', async () => {
  expect(await page.textContent('.non-normalized')).toMatch('[success]')
})

/** 场景：仅非Windows执行：导航路径故意等于仓库绝对目录，目录含非库package.json；核对无overlay且SPA仍显示Resolve。 */
test.runIf(!isWindows)(
  "Resolve doesn't interrupt page request that clashes with local project package.json",
  async () => {
    // 用仓库目录构造含package.json的非库路径，避免依赖机器上的其他项目。
    const pathToViteMonorepoRoot = new URL('../../../', import.meta.url)
    const urlPath = fileURLToPath(pathToViteMonorepoRoot).replace(/\/$/, '')
    await page.goto(viteTestUrl + urlPath)
    expect(await page.locator('vite-error-overlay').count()).toBe(0)
    expect(await page.textContent('h1')).toBe('Resolve')
  },
)

/** 场景：仅构建执行：检查dist/should-not-be-copied不存在，核对public复制关闭。 */
test.runIf(isBuild)('public dir is not copied', async () => {
  expect(
    fs.existsSync(path.resolve(testDir, 'dist/should-not-be-copied')),
  ).toBe(false)
})

/** 场景：包入口带UTF8 BOM；读取.utf8-bom-package，核对成功。 */
test('import utf8-bom package', async () => {
  expect(await page.textContent('.utf8-bom-package')).toMatch('[success]')
})

/** 场景：仅构建执行：读取window副作用记录，核对sideEffects glob只保留success项。 */
test.runIf(isBuild)('sideEffects field glob pattern is respected', async () => {
  const sideEffectValues = await page.evaluate(
    () => (window as any).__SIDE_EFFECT,
  )
  expect(sideEffectValues).toStrictEqual(['success'])
})

// bundledDev只提供bundle，以下源码HEAD请求限定普通dev。
describe.runIf(isServe && !isBundledDev)('HEAD request handling', () => {
  /** 场景：仅普通dev执行：HEAD请求/absolute.js，核对200、text/javascript与空响应体；构建/bundledDev不执行。 */
  test('HEAD request to JS file returns correct Content-Type', async () => {
    const response = await fetch(new URL('/absolute.js', viteTestUrl), {
      method: 'HEAD',
    })
    expect(response.headers.get('content-type')).toBe('text/javascript')
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toBe('')
  })

  /** 场景：仅普通dev执行：HEAD请求/style.css带text/css Accept，核对200与text/css；构建/bundledDev不执行。 */
  test('HEAD request to CSS file returns correct Content-Type', async () => {
    const response = await fetch(new URL('/style.css', viteTestUrl), {
      method: 'HEAD',
      headers: {
        Accept: 'text/css',
      },
    })
    expect(response.headers.get('content-type')).toBe('text/css')
    expect(response.status).toBe(200)
  })
})
