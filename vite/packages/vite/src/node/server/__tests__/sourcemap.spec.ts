import { describe, expect, test } from 'vitest'
import { getNodeModulesPackageRoot } from '../sourcemap'
import { isWindows } from '../../../shared/utils'

describe('getNodeModulesPackageRoot', () => {
  /**
   * 普通包、scope 包与嵌套 node_modules 路径应取最近包根；非依赖路径返回 undefined。
   * Windows 专属断言只在对应平台执行。这组用例检查路径提取，不读取 map/source 文件。
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
     * 按表行传入普通/scope/嵌套包、包根或非 node_modules 路径，提取结果应等于 expected；
     * 两行反斜杠 Windows 路径仅在 Windows 执行，其余平台跳过，不代表验证通过。
     */
    test.skipIf(skip)(name, () => {
      expect(getNodeModulesPackageRoot(input)).toBe(expected)
    })
  }
})
