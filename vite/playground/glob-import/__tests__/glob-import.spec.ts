import path from 'node:path'
import { readdir } from 'node:fs/promises'
import { expect, test } from 'vitest'
import {
  addFile,
  editFile,
  findAssetFile,
  isBuild,
  isBundledDev,
  page,
  removeFile,
} from '~utils'

/** 目录内部相对glob排除其他扩展后得到的三份JS命名空间。 */
const filteredResult = {
  './alias.js': {
    default: 'hi',
  },
  './foo.js': {
    msg: 'foo',
  },
  "./quote'.js": {
    msg: 'single-quote',
  },
}

/** JSON模块预期同时提供msg具名字段与完整default对象。 */
const json = {
  msg: 'baz',
  default: {
    msg: 'baz',
  },
}

/** alias模式命中的单个JS模块预期，以root绝对键表示。 */
const globWithAlias = {
  '/dir/alias.js': {
    default: 'hi',
  },
}

/** 根glob完整命名空间表；index.js字段顺序按构建/开发输出选择，JSON/CSS/嵌套导出逐项列出。 */
const allResult = {
  // JSON模块按具名/default双导出形式处理。
  '/dir/alias.js': {
    default: 'hi',
  },
  '/dir/baz.json': json,
  '/dir/foo.css': {},
  '/dir/foo.js': {
    msg: 'foo',
  },
  '/dir/index.js': isBuild
    ? {
        modules: filteredResult,
        globWithAlias,
      }
    : {
        globWithAlias,
        modules: filteredResult,
      },
  '/dir/nested/bar.js': {
    modules: {
      '../baz.json': json,
    },
    msg: 'bar',
  },
  "/dir/quote'.js": {
    msg: 'single-quote',
  },
}

/** 显式包含node_modules模式的预期文件，不依赖默认忽略规则。 */
const nodeModulesResult = {
  '/dir/node_modules/hoge.js': { msg: 'hoge' },
}

/** raw消费场景的预期root绝对键与JSON内容。 */
const rawResult = {
  '/dir/baz.json': {
    msg: 'baz',
  },
}

/** 相对glob场景的预期./dir/baz.json键。 */
const relativeRawResult = {
  './dir/baz.json': {
    msg: 'baz',
  },
}

/** 指定base场景的预期./baz.json键。 */
const baseRawResult = {
  './baz.json': {
    msg: 'baz',
  },
}

/** 场景：入口分别消费 lazy/eager glob 与显式 node_modules glob；解析三个DOM JSON，核对普通/JSON/CSS/嵌套/引号文件及包内项完整匹配预期表。 */
test('should work', async () => {
  await expect
    .poll(async () => JSON.parse(await page.textContent('.result')))
    .toStrictEqual(allResult)
  await expect
    .poll(async () => JSON.parse(await page.textContent('.result-eager')))
    .toStrictEqual(allResult)
  await expect
    .poll(async () =>
      JSON.parse(await page.textContent('.result-node_modules')),
    )
    .toStrictEqual(nodeModulesResult)
})

/** 场景：glob raw 结果写入 .globraw；读取格式化文本，核对唯一 /dir/baz.json 键及 msg=baz 的结果。 */
test('import glob raw', async () => {
  expect(await page.textContent('.globraw')).toBe(
    JSON.stringify(rawResult, null, 2),
  )
})

/** 场景：消费glob结果的JSON文件属性；读取 .property-access，核对仅得到 baz 的对象内容。 */
test('import property access', async () => {
  expect(await page.textContent('.property-access')).toBe(
    JSON.stringify(rawResult['/dir/baz.json'], null, 2),
  )
})

/** 场景：相对glob保留 ./dir/baz.json 键；读取格式化结果，核对相对键与 msg=baz。 */
test('import relative glob raw', async () => {
  expect(await page.textContent('.relative-glob-raw')).toBe(
    JSON.stringify(relativeRawResult, null, 2),
  )
})

/** 场景：未赋值的glob用于副作用加载；读取页面，核对 Hello from side effect 已执行。 */
test('unassigned import processes', async () => {
  expect(await page.textContent('.side-effect-result')).toBe(
    'Hello from side effect',
  )
})

/** 场景：包内glob匹配 pkg-pages 文件；读取页面JSON字符串，核对只有 /pkg-pages/foo.js。 */
test('import glob in package', async () => {
  expect(await page.textContent('.in-package')).toBe(
    JSON.stringify(['/pkg-pages/foo.js']),
  )
})

if (!isBuild) {
  /** 场景：仅非构建注册且bundledDev skip：新增空a.js、写入msg=a、删除；逐阶段核对根glob与index.js内相对glob同时更新，最终恢复allResult。 */
  test.skipIf(isBundledDev)('hmr for adding/removing files', async () => {
    const resultElement = page.locator('.result')

    addFile('root/dir/a.js', '')
    await expect
      .poll(async () => {
        const actualAdd = await resultElement.textContent()
        return JSON.parse(actualAdd)
      })
      .toStrictEqual({
        '/dir/a.js': {},
        ...allResult,
        '/dir/index.js': {
          ...allResult['/dir/index.js'],
          modules: {
            './a.js': {},
            ...allResult['/dir/index.js'].modules,
          },
        },
      })

    // 编辑刚新增的文件，检查导出内容更新。
    editFile('root/dir/a.js', () => 'export const msg ="a"')
    await expect
      .poll(async () => {
        const actualEdit = await resultElement.textContent()
        return JSON.parse(actualEdit)
      })
      .toStrictEqual({
        '/dir/a.js': {
          msg: 'a',
        },
        ...allResult,
        '/dir/index.js': {
          ...allResult['/dir/index.js'],
          modules: {
            './a.js': {
              msg: 'a',
            },
            ...allResult['/dir/index.js'].modules,
          },
        },
      })

    removeFile('root/dir/a.js')
    await expect
      .poll(async () => {
        const actualRemove = await resultElement.textContent()
        return JSON.parse(actualRemove)
      })
      .toStrictEqual(allResult)
  })

  /** 场景：仅非构建注册：新增/删除glob外 nohmr.js，分别等待 dir/index.js 响应200ms；超时替身status=-1应被断言，检查无目标模块请求。 */
  test('no hmr for adding/removing files', async () => {
    let request = page.waitForResponse(/dir\/index\.js$/, { timeout: 200 })
    addFile('root/nohmr.js', '')
    let response = await request.catch(() => ({
      /** 将目标模块响应超时标记为-1，供无HMR请求断言使用。 */
      status: () => -1
    }))
    expect(response.status()).toBe(-1)

    request = page.waitForResponse(/dir\/index\.js$/, { timeout: 200 })
    removeFile('root/nohmr.js')
    response = await request.catch(() => ({
      /** 将目标模块响应超时标记为-1，供无HMR请求断言使用。 */
      status: () => -1
    }))
    expect(response.status()).toBe(-1)
  })

  /** 场景：仅非构建且非bundledDev执行：包页目录新增bar后核对foo/bar排序列表，再删除恢复foo；bundledDev skip。 */
  test.skipIf(isBundledDev)(
    'hmr for adding/removing files in package',
    async () => {
      const resultElement = page.locator('.in-package')

      addFile('root/pkg-pages/bar.js', '// empty')
      await expect
        .poll(async () => JSON.parse(await resultElement.textContent()))
        .toStrictEqual(['/pkg-pages/foo.js', '/pkg-pages/bar.js'].sort())

      removeFile('root/pkg-pages/bar.js')
      await expect
        .poll(async () => JSON.parse(await resultElement.textContent()))
        .toStrictEqual(['/pkg-pages/foo.js'])
    },
  )

  /** 场景：仅非构建且非bundledDev执行：多模式含排除项初始只included，新增new-file后出现对应默认导出，再删除恢复；bundledDev skip。 */
  test.skipIf(isBundledDev)(
    'hmr for adding/removing files with array patterns and exclusions',
    async () => {
      const resultElement = page.locator('.array-result')
      await expect
        .poll(async () => JSON.parse(await resultElement.textContent()))
        .toStrictEqual({
          './array-test-dir/included.js': 'included',
        })

      addFile('root/array-test-dir/new-file.js', 'export default "new"')
      await expect
        .poll(async () => JSON.parse(await resultElement.textContent()))
        .toStrictEqual({
          './array-test-dir/included.js': 'included',
          './array-test-dir/new-file.js': 'new',
        })

      removeFile('root/array-test-dir/new-file.js')
      await expect
        .poll(async () => JSON.parse(await resultElement.textContent()))
        .toStrictEqual({
          './array-test-dir/included.js': 'included',
        })
    },
  )
}

/** 场景：glob跟随符号链接进入my-lib/components；解析页面JSON，核对a/b两路径与导出。 */
test('follow symlinks', async () => {
  await expect
    .poll(async () => JSON.parse(await page.textContent('.follow-symlinks')))
    .toStrictEqual({
      './follow-symlinks/linked/my-lib/components/a.js': 'a',
      './follow-symlinks/linked/my-lib/components/b.js': 'b',
    })
})

/** 场景：glob与直接导入经符号链接指向同一模块；解析页面的a/b身份比较结果，核对均true。 */
test('follow symlinks same reference', async () => {
  await expect
    .poll(async () =>
      JSON.parse(await page.textContent('.follow-symlinks-same-ref')),
    )
    .toStrictEqual({
      a: true,
      b: true,
    })
})

/** 场景：别名负glob排除alias文件；解析结果键列表，核对非空且每个键不含alias。 */
test('alias exclusion', async () => {
  await expect
    .poll(async () => JSON.parse(await page.textContent('.alias-exclusion')))
    .toSatisfy((keys: string[]) => {
      return keys.length > 0 && keys.every((k) => !k.includes('alias'))
    })
})

/** 场景：数组glob模式包含正/负模式；解析结果，核对仅included.js默认值included。 */
test('array pattern with exclusions', async () => {
  await expect
    .poll(async () => JSON.parse(await page.textContent('.array-result')))
    .toStrictEqual({
      './array-test-dir/included.js': 'included',
    })
})

// https://github.com/vitejs/vite/issues/22170
/** 场景：两个兄弟目录名称共享前缀；解析数组glob结果，核对pattern1/a与pattern2/b都命中各自路径。 */
test('array pattern with sibling directories sharing a prefix', async () => {
  await expect
    .poll(async () =>
      JSON.parse(await page.textContent('.array-common-base-result')),
    )
    .toStrictEqual({
      '/array-common-base/pattern1/a.js': 'a',
      '/array-common-base/pattern2/b.js': 'b',
    })
})

/** 场景：eager CSS glob中保留一项、未用另一项；先核对保留CSS文本，构建另查入口JS不含未用规则。 */
test('tree-shake eager css', async () => {
  expect(await page.textContent('.no-tree-shake-eager-css-result')).toMatch(
    '.no-tree-shake-eager-css',
  )

  if (isBuild) {
    const content = findAssetFile(/index-[-\w]+\.js/, '../root/dist')
    expect(content).not.toMatch('.tree-shake-eager-css')
  }
})

/** 场景：escape目录各特殊字符子目录分别导出相对与alias glob；读取实际目录形成预期列表，核对页面两种成功文件列表完整一致，用户递归匹配 JS 的 glob 后缀仍可匹配。 */
test('escapes special chars in globs without mangling user supplied glob suffix', async () => {
  // 每个特殊目录的glob.js同时执行相对与别名glob；页面只列出结果符合预期的目录。
  const files = await readdir(
    path.join(import.meta.dirname, '..', 'root', 'escape'),
    {
      withFileTypes: true,
    },
  )
  const expectedNames = files
    .filter((f) => f.isDirectory())
    .map((f) => `/escape/${f.name}/glob.js`)
    .sort()
  await expect
    .poll(async () => {
      const text = await page.textContent('.escape-relative')
      return text.split('\n').sort()
    })
    .toEqual(expectedNames)
  await expect
    .poll(async () => {
      const text = await page.textContent('.escape-alias')
      return text.split('\n').sort()
    })
    .toEqual(expectedNames)
})

/** 场景：glob用反斜杠转义括号；解析页面结果，核对只命中 /escape/(parenthesis)/mod/index.js。 */
test('escape literal parenthesis in glob pattern', async () => {
  // https://github.com/vitejs/vite/issues/22166
  // 反斜杠转义的括号应在开发与构建中都按字面目录字符匹配。
  await expect
    .poll(async () =>
      JSON.parse(await page.textContent('.escape-literal-parenthesis')),
    )
    .toStrictEqual(['/escape/(parenthesis)/mod/index.js'])
})

/** 场景：glob使用package imports子路径模式；轮询页面，核对展开模块的bar foo消息。 */
test('subpath imports', async () => {
  await expect
    .poll(async () => await page.textContent('.subpath-imports'))
    .toMatch('bar foo')
})

/** 场景：子目录中的glob使用package imports；轮询对应页面，核对同样得到bar foo。 */
test('subpath imports (sub dir)', async () => {
  await expect
    .poll(async () => await page.textContent('.subpath-imports-sub-dir'))
    .toMatch('bar foo')
})

/** 场景：glob使用#开头alias；轮询结果，核对别名模式展开后得到bar foo。 */
test('#alias imports', async () => {
  await expect
    .poll(async () => await page.textContent('.hash-alias-imports'))
    .toMatch('bar foo')
})

/** 场景：glob指定base后改变结果键；读取页面，核对键为./baz.json与baz对象，不使用完整dir路径。 */
test('import base glob raw', async () => {
  await expect
    .poll(async () => await page.textContent('.result-base'))
    .toBe(JSON.stringify(baseRawResult, null, 2))
})

/** 场景：post插件观察glob与动态变量import转换后代码；读取结果JSON，核对两种转换均已发生。 */
test('import.meta.glob and dynamic import vars transformations should be visible to post transform plugins', async () => {
  await expect
    .poll(async () => await page.textContent('.transform-visibility'))
    .toBe(
      JSON.stringify({ globTransformed: true, dynamicImportTransformed: true }),
    )
})

/** 场景：同一目录含大小写不同文件；分别解析true/false选项结果，核对true只data-test，false另包含DATA-other。 */
test('caseSensitiveMatch option', async () => {
  await expect
    .poll(async () =>
      JSON.parse(await page.textContent('.case-sensitive-true')),
    )
    .toStrictEqual(['./case-sensitive-dir/data-test.js'])

  await expect
    .poll(async () =>
      JSON.parse(await page.textContent('.case-sensitive-false')),
    )
    .toStrictEqual([
      './case-sensitive-dir/DATA-other.js',
      './case-sensitive-dir/data-test.js',
    ])
})
/** 场景：glob使用绝对base匹配root外external目录；解析结果，核对相对键../external/x/y及各hello导出。 */
test('absolute base with files outside of root', async () => {
  await expect
    .poll(async () =>
      JSON.parse(await page.textContent('.absolute-base-outside-root')),
    )
    .toStrictEqual({
      '../external/x.js': 'hello from x',
      '../external/y.js': 'hello from y',
    })
})
