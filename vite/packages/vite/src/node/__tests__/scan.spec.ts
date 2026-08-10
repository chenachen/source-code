import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  commentRE,
  devToScanEnvironment,
  importsRE,
  scanImports,
  scriptRE,
} from '../optimizer/scan'
import {
  multilineCommentsRE,
  normalizePath,
  singlelineCommentsRE,
} from '../utils'
import { createServer, createServerModuleRunner } from '..'

/**
 * 场景：依赖扫描器不能直接把 Vue/Svelte 等组件文件当成普通 JavaScript。
 * 机制：先剥离 HTML 注释，再用轻量正则提取真正的 `<script>` 内容和静态导入。
 * 目标：既发现脚本依赖，又不把注释、组件标签或 `import type` 误判为运行时依赖。
 */
describe('optimizer-scan:script-test', () => {
  const scriptContent = `import { defineComponent } from 'vue'
      import ScriptDevelopPane from './ScriptDevelopPane.vue';
      export default defineComponent({
        components: {
          ScriptDevelopPane
        }
      })`

  /** 场景：普通与 lang=ts 的 script 标签包裹同一内容；验证目标：scriptRE 分别返回完整开标签和相同脚本文本。 */
  test('component return value test', () => {
    scriptRE.lastIndex = 0
    const [, tsOpenTag, tsContent] = scriptRE.exec(
      `<script lang="ts">${scriptContent}</script>`,
    )!
    expect(tsOpenTag).toEqual('<script lang="ts">')
    expect(tsContent).toEqual(scriptContent)

    scriptRE.lastIndex = 0
    const [, openTag, content] = scriptRE.exec(
      `<script>${scriptContent}</script>`,
    )!
    expect(openTag).toEqual('<script>')
    expect(content).toEqual(scriptContent)
  })

  /** 场景：template 注释中包含两个伪 script 标签；验证目标：先移除注释后 scriptRE 返回 null。 */
  test('include comments test', () => {
    scriptRE.lastIndex = 0
    const ret = scriptRE.exec(
      `<template>
        <!--  <script >var test1 = null</script> -->
        <!--  <script >var test2 = null</script> -->
      </template>`.replace(commentRE, ''),
    )
    expect(ret).toEqual(null)
  })

  /** 场景：自定义元素名称含 script 关键字；验证目标：自闭合、成对和带空格三种写法都不被当作 script 标签。 */
  test('components with script keyword test', () => {
    scriptRE.lastIndex = 0
    let ret = scriptRE.exec(`<template><script-develop-pane/></template>`)
    expect(ret).toBe(null)

    scriptRE.lastIndex = 0
    ret = scriptRE.exec(
      `<template><script-develop-pane></script-develop-pane></template>`,
    )
    expect(ret).toBe(null)

    scriptRE.lastIndex = 0
    ret = scriptRE.exec(
      `<template><script-develop-pane  > content </script-develop-pane></template>`,
    )
    expect(ret).toBe(null)
  })

  /** 场景：普通 script 开标签分别带或不带尾空格；验证目标：正则准确分离原开标签与内部内容。 */
  test('ordinary script tag test', () => {
    scriptRE.lastIndex = 0
    const [, tag, content] = scriptRE.exec(
      `<script  >var test = null</script>`,
    )!
    expect(tag).toEqual('<script  >')
    expect(content).toEqual('var test = null')

    scriptRE.lastIndex = 0
    const [, tag1, content1] = scriptRE.exec(
      `<script>var test = null</script>`,
    )!
    expect(tag1).toEqual('<script>')
    expect(content1).toEqual('var test = null')
  })

  /** 场景：多种静态 import 与注释/type import 反例；验证目标：importsRE 只提取运行时 vue specifier，反例均不匹配。 */
  test('imports regex should work', () => {
    const shouldMatchArray = [
      `import 'vue'`,
      `import { foo } from 'vue'`,
      `import foo from 'vue'`,
      `;import foo from 'vue'`,
      `   import foo from 'vue'`,
      `import { foo
      } from 'vue'`,
      `import bar, { foo } from 'vue'`,
      `import foo from 'vue';`,
      `*/ import foo from 'vue';`,
      `import foo from 'vue';//comment`,
      `import foo from 'vue';/*comment
      */`,
      // 暂不启用：当前正则仍会漏掉这些写法。
      // `import typescript from 'typescript'`,
      // import type, {foo} from 'vue'
    ]

    shouldMatchArray.forEach((str) => {
      importsRE.lastIndex = 0
      expect(importsRE.exec(str)![1]).toEqual("'vue'")
    })

    const shouldFailArray = [
      `testMultiline("import", {
        body: "ok" });`,
      `//;import foo from 'vue'`,
      `import type { Bar } from 'foo'`,
      `import type{ Bar } from 'foo'`,
      `import type Bar from 'foo'`,
    ]
    shouldFailArray.forEach((str) => {
      importsRE.lastIndex = 0
      expect(importsRE.test(str)).toBe(false)
    })
  })

  /** 场景：export default 只出现在块注释或行注释；验证目标：注释清理后结果不再含该关键字。 */
  test('script comments test', () => {
    multilineCommentsRE.lastIndex = 0
    let ret = `/*
      export default { }
      */`.replace(multilineCommentsRE, '')
    expect(ret).not.toContain('export default')

    singlelineCommentsRE.lastIndex = 0
    ret = `//export default { }`.replace(singlelineCommentsRE, '')
    expect(ret).not.toContain('export default')
  })
})

/**
 * 场景：JSX automatic runtime 会在转换阶段隐式注入 `jsx-runtime` 导入。
 * 机制：扫描阶段使用与真实转换一致的 JSX 配置，提前把运行时包纳入优化结果。
 * 验证目标：首次请求 JSX 模块时不再发现新依赖，从而避免优化器二次运行和模块失效。
 */
test('scan jsx-runtime', async (ctx) => {
  const server = await createServer({
    configFile: false,
    logLevel: 'error',
    root: path.join(import.meta.dirname, 'fixtures', 'scan-jsx-runtime'),
    environments: {
      client: {
        // 本用例只观察 SSR 环境，关闭客户端自动发现以消除无关日志和竞态。
        optimizeDeps: {
          noDiscovery: true,
        },
      },
      ssr: {
        resolve: {
          noExternal: true,
        },
        optimizeDeps: {
          force: true,
          noDiscovery: false,
          entries: ['./entry-jsx.tsx', './entry-no-jsx.js'],
        },
      },
    },
  })
  ctx.onTestFinished(() => server.close())

  // 启动服务器，触发 SSR 环境的依赖优化器。
  await server.listen()

  const runner = createServerModuleRunner(server.environments.ssr, {
    hmr: { logger: false },
  })

  // 第一个模块请求到来前，后台扫描应已经完成。
  await server.environments.ssr.depsOptimizer?.scanProcessing

  // 导入任意文件，提交首轮优化结果。
  await runner.import('./entry-no-jsx.js')

  // 再导入 JSX：扫描若完整，就不会触发重跑，并且两次导入复用同一模块实例。
  const mod1 = await runner.import('./entry-jsx.js')
  const mod2 = await runner.import('./entry-jsx.js')
  expect((globalThis as any).__test_scan_jsx_runtime).toBe(1)
  expect(mod1).toBe(mod2)
})

/**
 * 场景：`import.meta.glob` 展开的 TSX 文件可能使用环境级 Oxc 配置，也可能被
 * `optimizeDeps.rolldownOptions.transform.jsx` 覆盖。
 * 机制：扫描器把依赖优化专用的 Rolldown JSX 选项传给 glob 转换。
 * 验证目标：发现实际会被注入的 `vue/jsx-dev-runtime`，而不是环境默认的 React runtime。
 */
test('scan import.meta.glob respects rolldown transform jsx options', async (ctx) => {
  const server = await createServer({
    configFile: false,
    logLevel: 'error',
    root: path.join(import.meta.dirname, 'fixtures', 'scan-jsx-runtime'),
    oxc: {
      jsx: {
        runtime: 'automatic',
        importSource: 'react',
      },
    },
    optimizeDeps: {
      force: true,
      noDiscovery: false,
      entries: ['./entry-glob-custom-oxc.tsx'],
      rolldownOptions: {
        transform: {
          jsx: {
            runtime: 'automatic',
            importSource: 'vue',
          },
        },
      },
    },
  })
  ctx.onTestFinished(() => server.close())

  const { cancel, result } = scanImports(
    devToScanEnvironment(server.environments.client),
  )
  ctx.onTestFinished(cancel)

  const scanResult = await result

  expect(scanResult).toMatchObject({
    deps: {
      'vue/jsx-dev-runtime': expect.any(String),
    },
    missing: {},
  })
  expect(scanResult.deps).not.toHaveProperty('react/jsx-runtime')
})

/**
 * 场景：用户通过顶层 `input` 指定应用入口，而非依赖默认的 `index.html`。
 * 机制：入口计算优先读取显式 input，并从该入口递归收集裸包导入。
 * 验证目标：确保入口中的 `vue` 进入预构建候选集。
 */
test('top-level input is used as the entry for dep scanning', async (ctx) => {
  const server = await createServer({
    configFile: false,
    logLevel: 'error',
    root: path.join(import.meta.dirname, 'fixtures', 'input-option'),
    input: 'entry.js',
    optimizeDeps: {
      force: true,
      noDiscovery: false,
    },
  })
  ctx.onTestFinished(() => server.close())

  const { cancel, result } = scanImports(
    devToScanEnvironment(server.environments.client),
  )
  ctx.onTestFinished(cancel)

  const scanResult = await result
  expect(scanResult.deps).toHaveProperty('vue')
})

/**
 * 场景：顶层 input 是插件提供的虚拟 ID。
 * 机制：扫描入口也经过插件容器的 `resolveId`，再从解析出的真实文件开始遍历。
 * 验证目标：扫描阶段与正常请求阶段共享解析语义，不漏掉虚拟入口中的依赖。
 */
test('top-level input can be resolved by a plugin for dep scanning', async (ctx) => {
  const root = path.join(import.meta.dirname, 'fixtures', 'input-option')
  const input = 'virtual:entry'
  const server = await createServer({
    configFile: false,
    logLevel: 'error',
    root,
    input,
    plugins: [
      {
        name: 'virtual-entry',
        enforce: 'pre',
        /** 把扫描用虚拟入口解析为 fixture 中的真实 entry.js。 */
        resolveId(id, _importer) {
          if (id === input) {
            return normalizePath(path.resolve(root, 'entry.js'))
          }
        },
      },
    ],
    optimizeDeps: {
      force: true,
      noDiscovery: false,
    },
  })
  ctx.onTestFinished(() => server.close())

  const { cancel, result } = scanImports(
    devToScanEnvironment(server.environments.client),
  )
  ctx.onTestFinished(cancel)

  const scanResult = await result
  expect(scanResult.deps).toHaveProperty('vue')
})

// 回归测试：https://github.com/vitejs/vite/issues/22752
// `resolveRolldownOptions` 会相对 root 解析
// `build.rolldownOptions.input`，扫描器也必须从同一 root 解析相对入口。
/** 场景：环境 build.rolldownOptions.input 是相对 root 的 entry-client.tsx；验证目标：依赖扫描从该入口发现 vue 且 missing 为空。 */
test('scan resolves build.rolldownOptions.input relative to the root', async (ctx) => {
  const server = await createServer({
    configFile: false,
    logLevel: 'error',
    // root 故意不同于 process.cwd()；入口位于 `<root>/entry-client.tsx`。
    root: path.join(import.meta.dirname, 'fixtures', 'scan-build-input', 'src'),
    environments: {
      client: {
        build: {
          rolldownOptions: {
            input: 'entry-client.tsx',
          },
        },
      },
    },
    optimizeDeps: {
      force: true,
      noDiscovery: false,
    },
  })
  ctx.onTestFinished(() => server.close())

  const { cancel, result } = scanImports(
    devToScanEnvironment(server.environments.client),
  )
  ctx.onTestFinished(cancel)

  await expect(result).resolves.toMatchObject({
    deps: {
      vue: expect.any(String),
    },
    missing: {},
  })
})

// 回归场景：依赖扫描在后台运行，服务器关闭时可能仍在遍历。此时解析会以
// `ERR_CLOSED_SERVER` 拒绝，并产生“Request is outdated”。扫描结果本来就会在关闭时
// 丢弃，所以这里必须吞掉该错误，避免它以未处理 Promise rejection 逃逸。
/** 场景：扫描开始前客户端插件容器已关闭；验证目标：中途关闭错误被视为取消，结果解析为空 deps/missing。 */
test('scan ignores the failure when the server is closed mid-scan', async (ctx) => {
  const server = await createServer({
    configFile: false,
    logLevel: 'silent',
    root: path.join(import.meta.dirname, 'fixtures', 'scan-build-input', 'src'),
    optimizeDeps: {
      entries: ['./entry-client.tsx'],
      force: true,
      noDiscovery: false,
    },
  })
  ctx.onTestFinished(() => server.close())

  // 先关闭插件容器，模拟扫描仍在执行时服务器被拆除。
  await server.environments.client.pluginContainer.close()

  const { cancel, result } = scanImports(
    devToScanEnvironment(server.environments.client),
  )
  ctx.onTestFinished(cancel)

  await expect(result).resolves.toEqual({ deps: {}, missing: {} })
})

/**
 * 场景：`import.meta.glob('#alias/*.js')` 使用 package.json `imports` 子路径模式。
 * 机制：glob 转换会把模式解析成包内文件；这些内部文件不是需要预构建的裸依赖。
 * 验证目标：扫描成功结束，同时不把展开结果误记进 deps 或 missing。
 */
test('scan import.meta.glob package imports patterns', async (ctx) => {
  const server = await createServer({
    configFile: false,
    logLevel: 'error',
    root: path.join(
      import.meta.dirname,
      'fixtures',
      'scan-subpath-import-glob',
    ),
    optimizeDeps: {
      entries: ['./entry.ts'],
      force: true,
      noDiscovery: false,
    },
  })
  ctx.onTestFinished(() => server.close())

  const { cancel, result } = scanImports(
    devToScanEnvironment(server.environments.client),
  )
  ctx.onTestFinished(cancel)

  await expect(result).resolves.toEqual({ deps: {}, missing: {} })
})
