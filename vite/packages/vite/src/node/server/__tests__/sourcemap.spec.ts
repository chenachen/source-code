import { describe, expect, test } from 'vitest'
import { getNodeModulesPackageRoot } from '../sourcemap'
import { isWindows } from '../../../shared/utils'

describe('getNodeModulesPackageRoot', () => {
  /**
   * 场景：补齐 sourcemap 的 sourcesContent 时，依赖包中的相对 source 路径只能在当前包目录内读取。
   * 目标：准确识别普通包、scope 包、嵌套 node_modules 与 Windows 路径的最近包根；非依赖路径返回 undefined。
   * 机制：表驱动覆盖路径边界，Windows 专属断言只在对应平台执行。
   */
  const cases = [
    {
      name: 'returns undefined for path outside node_modules',
      input: '/project/src/foo.ts',
      expected: undefined,
    },
    {
      name: 'returns undefined for plain filename',
      input: 'foo.js',
      expected: undefined,
    },
    {
      name: 'unscoped package',
      input: '/project/node_modules/foo/index.js',
      expected: '/project/node_modules/foo',
    },
    {
      name: 'unscoped package in nested directory',
      input: '/project/node_modules/foo/dist/bar.js',
      expected: '/project/node_modules/foo',
    },
    {
      name: 'scoped package',
      input: '/project/node_modules/@scope/pkg/dist/foo.js',
      expected: '/project/node_modules/@scope/pkg',
    },
    {
      name: 'scoped package at root level',
      input: '/project/node_modules/@scope/pkg/index.js',
      expected: '/project/node_modules/@scope/pkg',
    },
    {
      name: 'nested node_modules uses the last segment',
      input: '/project/node_modules/foo/node_modules/bar/index.js',
      expected: '/project/node_modules/foo/node_modules/bar',
    },
    {
      name: 'Windows-style path',
      input: 'D:\\project\\node_modules\\foo\\dist\\bar.js',
      expected: 'D:/project/node_modules/foo',
      skip: !isWindows,
    },
    {
      name: 'Windows-style path with scoped package',
      input: 'D:\\project\\node_modules\\@scope\\pkg\\index.js',
      expected: 'D:/project/node_modules/@scope/pkg',
      skip: !isWindows,
    },
    {
      name: 'package name without subdirectory',
      input: '/project/node_modules/foo',
      expected: '/project/node_modules/foo',
    },
    {
      name: 'scoped package name without subdirectory',
      input: '/project/node_modules/@scope/pkg',
      expected: '/project/node_modules/@scope/pkg',
    },
  ]

  for (const { name, input, expected, skip } of cases) {
    /**
     * 场景：当前表格行提供普通、scoped、嵌套、Windows 或非 node_modules 路径。
     * 验证目标：`getNodeModulesPackageRoot(input)` 严格等于该行 expected；平台专属行按 skip 跳过。
     */
    test.skipIf(skip)(name, () => {
      expect(getNodeModulesPackageRoot(input)).toBe(expected)
    })
  }
})
