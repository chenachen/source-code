import { resolve } from 'node:path'
import { defaultExclude, defineConfig } from 'vitest/config'

/** VITE_TEST_BUILD 非空时走 build + preview，用同一组 e2e 断言检查构建产物。 */
const isBuild = !!process.env.VITE_TEST_BUILD
/** 只有非 build 运行才可强制 bundled-dev；该模式仍属于 serve 测试。 */
const isBundledDev = !isBuild && !!process.env.VITE_TEST_BUNDLED_DEV

/**
 * 强制 bundled-dev 时整文件排除的尚未支持场景（vitejs/vite#23028）；不能把它们计为已通过。
 * 仅部分用例不支持的 spec 保持入选，并在用例上通过 test.skipIf(isBundledDev) 控制。
 */
const bundledDevExclude = [
  './playground/assets/__tests__/runtime-base/assets-runtime-base.spec.ts',
  './playground/backend-integration/__tests__/backend-integration.spec.ts',
  './playground/chunk-importmap/__tests__/chunk-importmap.spec.ts',
  './playground/csp/__tests__/csp.spec.ts',
  './playground/css-codesplit/__tests__/css-codesplit.spec.ts',
  './playground/css-no-codesplit/__tests__/css-no-codesplit.spec.ts',
  './playground/forward-console/__test__/forward-console.spec.ts',
  './playground/fs-serve/__tests__/base/fs-serve-base.spec.ts',
  './playground/fs-serve/__tests__/deny/fs-serve-deny.spec.ts',
  './playground/fs-serve/__tests__/fs-serve.spec.ts',
  './playground/hmr/__tests__/hmr.spec.ts',
  './playground/legacy/__tests__/chunk-importmap/legacy-chunk-importmap.spec.ts',
  './playground/object-hooks/__tests__/object-hooks.spec.ts',
  './playground/optimize-deps/__tests__/optimize-deps.spec.ts',
  './playground/tailwind-v3/__test__/tailwind-v3.spec.ts',
  './playground/tailwind/__test__/tailwind.spec.ts',
  './playground/transform-plugin/__tests__/base/transform-plugin.spec.ts',
  './playground/worker/__tests__/es/worker-es.spec.ts',
  './playground/worker/__tests__/iife/worker-iife.spec.ts',
  './playground/worker/__tests__/relative-base-iife/worker-relative-base-iife.spec.ts',
  './playground/worker/__tests__/relative-base/worker-relative-base.spec.ts',
]

/** 单个测试/hook 的毫秒超时：Playwright 调试时无限，CI 50 秒，本地 30 秒。 */
const timeout = process.env.PWDEBUG ? Infinity : process.env.CI ? 50000 : 30000

export default defineConfig({
  resolve: {
    alias: {
      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      '~utils': resolve(import.meta.dirname, './playground/test-utils'),
    },
  },
  test: {
    include: ['./playground/**/*.spec.[tj]s'],
    exclude: [
      ...(isBundledDev ? bundledDevExclude : []),
      ...(isBuild
        ? [
            './playground/object-hooks/**/*.spec.[tj]s', // 插件对象 hook 的运行顺序仅在 serve 中验证。
          ]
        : []),
      ...defaultExclude,
    ],
    setupFiles: ['./playground/vitestSetup.ts'],
    globalSetup: ['./playground/vitestGlobalSetup.ts'],
    testTimeout: timeout,
    hookTimeout: timeout,
    reporters: 'dot',
    deps: {
      // 防止 Vitest 把工作区 packages 放进自身的 Vite SSR 转换运行时。
      moduleDirectories: ['node_modules', 'packages'],
    },
    expect: {
      poll: {
        timeout: 50 * (process.env.CI ? 200 : 50),
      },
    },
    env: {
      NODE_ENV: process.env.VITE_TEST_BUILD ? 'production' : 'development',
    },
  },
  oxc: {
    target: 'node20',
  },
  publicDir: false,
})
