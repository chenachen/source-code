import util from 'node:util'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import type { ModuleTypeFilter } from 'rolldown'
import {
  type StringFilter,
  createCodeFilter,
  createFilterForTransform,
  createIdFilter,
} from '../../plugins/pluginFilter'

describe('createIdFilter', () => {
  /**
   * 参数化覆盖：缺省过滤器、简单值/数组、include/exclude 对象、glob、正则、Windows
   * 分隔符、虚拟 ID 与绝对式虚拟路径。每行 cases 都是该输入应接受/拒绝的模块 ID。
   */
  const filters = [
    { inputFilter: undefined, cases: undefined },
    {
      inputFilter: 'foo.js',
      cases: [
        { id: 'foo.js', expected: true },
        { id: 'foo.ts', expected: false },
        { id: '\0foo.js', expected: false },
        { id: '\0' + path.resolve('foo.js'), expected: false },
      ],
    },
    {
      inputFilter: ['foo.js'],
      cases: [
        { id: 'foo.js', expected: true },
        { id: 'foo.ts', expected: false },
      ],
    },
    {
      inputFilter: { include: 'foo.js' },
      cases: [
        { id: 'foo.js', expected: true },
        { id: 'foo.ts', expected: false },
      ],
    },
    {
      inputFilter: { include: '*.js' },
      cases: [
        { id: 'foo.js', expected: true },
        { id: 'foo.ts', expected: false },
      ],
    },
    {
      inputFilter: { include: /\.js$/ },
      cases: [
        { id: 'foo.js', expected: true },
        { id: 'foo.ts', expected: false },
      ],
    },
    {
      inputFilter: { include: /\/foo\.js$/ },
      cases: [
        { id: 'a/foo.js', expected: true },
        ...(process.platform === 'win32'
          ? [{ id: 'a\\foo.js', expected: true }]
          : []),
        { id: 'a_foo.js', expected: false },
      ],
    },
    {
      inputFilter: { include: [/\.js$/] },
      cases: [
        { id: 'foo.js', expected: true },
        { id: 'foo.ts', expected: false },
      ],
    },
    {
      inputFilter: { exclude: 'foo.js' },
      cases: [
        { id: 'foo.js', expected: false },
        { id: 'foo.ts', expected: true },
      ],
    },
    {
      inputFilter: { exclude: '*.js' },
      cases: [
        { id: 'foo.js', expected: false },
        { id: 'foo.ts', expected: true },
      ],
    },
    {
      inputFilter: { exclude: /\.js$/ },
      cases: [
        { id: 'foo.js', expected: false },
        { id: 'foo.ts', expected: true },
      ],
    },
    {
      inputFilter: { exclude: [/\.js$/] },
      cases: [
        { id: 'foo.js', expected: false },
        { id: 'foo.ts', expected: true },
      ],
    },
    {
      inputFilter: { include: 'foo.js', exclude: 'bar.js' },
      cases: [
        { id: 'foo.js', expected: true },
        { id: 'bar.js', expected: false },
        { id: 'baz.js', expected: false },
      ],
    },
    {
      inputFilter: { include: '*.js', exclude: 'foo.*' },
      cases: [
        { id: 'foo.js', expected: false }, // exclude 优先于同时命中的 include。
        { id: 'bar.js', expected: true },
        { id: 'foo.ts', expected: false },
      ],
    },
    {
      inputFilter: '/virtual/foo',
      cases: [{ id: '/virtual/foo', expected: true }],
    },
  ]

  for (const filter of filters) {
    /**
     * 场景：当前 inputFilter 形式被编译后逐项匹配 cases。
     * 验证目标：无配置返回 undefined；其余过滤器严格遵循 include/exclude 与路径规范化。
     */
    test(`${util.inspect(filter.inputFilter)}`, () => {
      const idFilter = createIdFilter(filter.inputFilter, '')
      if (!filter.cases) {
        expect(idFilter).toBeUndefined()
        return
      }
      expect(idFilter).not.toBeUndefined()

      for (const testCase of filter.cases) {
        const { id, expected } = testCase
        expect(idFilter!(id), id).toBe(expected)
      }
    })
  }
})

describe('createCodeFilter', () => {
  /**
   * 参数化覆盖源码字符串/数组/对象/正则；字符串按字面子串匹配，不按 ID glob 解释。
   */
  const filters = [
    { inputFilter: undefined, cases: undefined },
    {
      inputFilter: 'import.meta',
      cases: [
        { code: 'import.meta', expected: true },
        { code: 'import_meta', expected: false },
      ],
    },
    {
      inputFilter: ['import.meta'],
      cases: [
        { code: 'import.meta', expected: true },
        { code: 'import_meta', expected: false },
      ],
    },
    {
      inputFilter: { include: 'import.meta' },
      cases: [
        { code: 'import.meta', expected: true },
        { code: 'import_meta', expected: false },
      ],
    },
    {
      inputFilter: { include: /import\.\w+/ },
      cases: [
        { code: 'import.meta', expected: true },
        { code: 'import_meta', expected: false },
      ],
    },
    {
      inputFilter: { include: [/import\.\w+/] },
      cases: [
        { code: 'import.meta', expected: true },
        { code: 'import_meta', expected: false },
      ],
    },
    {
      inputFilter: { exclude: 'import.meta' },
      cases: [
        { code: 'import.meta', expected: false },
        { code: 'import_meta', expected: true },
      ],
    },
    {
      inputFilter: { exclude: /import\.\w+/ },
      cases: [
        { code: 'import.meta', expected: false },
        { code: 'import_meta', expected: true },
      ],
    },
    {
      inputFilter: { exclude: [/import\.\w+/] },
      cases: [
        { code: 'import.meta', expected: false },
        { code: 'import_meta', expected: true },
      ],
    },
    {
      inputFilter: { include: 'import.meta', exclude: 'import_meta' },
      cases: [
        { code: 'import.meta', expected: true },
        { code: 'import_meta', expected: false },
        { code: 'importmeta', expected: false },
      ],
    },
    {
      inputFilter: { include: /import\.\w+/, exclude: /\w+\.meta/ },
      cases: [
        { code: 'import.meta', expected: false }, // exclude 优先于同时命中的 include。
        { code: 'import.foo', expected: true },
        { code: 'foo.meta', expected: false },
      ],
    },
  ]

  for (const filter of filters) {
    /**
     * 场景：当前源码过滤描述匹配多段 code。
     * 验证目标：无配置不创建函数；exclude 优先，include 缺省时接受未排除源码。
     */
    test(`${util.inspect(filter.inputFilter)}`, () => {
      const codeFilter = createCodeFilter(filter.inputFilter)
      if (!filter.cases) {
        expect(codeFilter).toBeUndefined()
        return
      }
      expect(codeFilter).not.toBeUndefined()

      for (const testCase of filter.cases) {
        const { code, expected } = testCase
        expect(codeFilter!(code), code).toBe(expected)
      }
    })
  }
})

describe('createFilterForTransform', () => {
  /** transform 三类输入过滤器及其期望组合结果。 */
  type Filters = {
    /** 传给 transform 插件过滤器的 ID、源码与可选模块类型条件。 */
    inputFilter: [
      idFilter: StringFilter | undefined,
      codeFilter: StringFilter | undefined,
      moduleTypeFilter?: ModuleTypeFilter | undefined,
    ]
    /** 每组过滤器对应的输入样本；undefined 表示插件不应生成 codeFilter。 */
    cases:
      | {
          /** 送入 transform 过滤器的模块 ID。 */
          id: string
          /** 送入 transform 过滤器的模块源码。 */
          code: string
          /** 可选模块类型，用于验证第三类过滤条件。 */
          moduleType?: string
          /** 三类过滤条件执行短路 AND 后的期望布尔结果。 */
          expected: boolean
        }[]
      | undefined
  }[]
  /**
   * 参数化覆盖 ID、code、moduleType 单项与组合条件；三类条件之间必须是短路 AND。
   */
  const filters: Filters = [
    { inputFilter: [undefined, undefined], cases: undefined },
    {
      inputFilter: ['*.js', undefined],
      cases: [
        { id: 'foo.js', code: 'foo', expected: true },
        { id: 'foo.ts', code: 'foo', expected: false },
      ],
    },
    {
      inputFilter: [undefined, 'import.meta'],
      cases: [
        { id: 'foo.js', code: 'import.meta', expected: true },
        { id: 'foo.js', code: 'import_meta', expected: false },
      ],
    },
    {
      inputFilter: [{ exclude: '*.js' }, 'import.meta'],
      cases: [
        { id: 'foo.js', code: 'import.meta', expected: false },
        { id: 'foo.js', code: 'import_meta', expected: false },
        { id: 'foo.ts', code: 'import.meta', expected: true },
        { id: 'foo.ts', code: 'import_meta', expected: false },
      ],
    },
    {
      inputFilter: [{ include: 'foo.ts', exclude: '*.js' }, 'import.meta'],
      cases: [
        { id: 'foo.js', code: 'import.meta', expected: false },
        { id: 'foo.js', code: 'import_meta', expected: false },
        { id: 'foo.ts', code: 'import.meta', expected: true },
        { id: 'foo.ts', code: 'import_meta', expected: false },
      ],
    },
    {
      inputFilter: [
        { include: 'a*', exclude: '*b' },
        { include: 'a', exclude: 'b' },
      ],
      cases: [
        { id: 'ab', code: '', expected: false },
        { id: 'a', code: 'b', expected: false },
        { id: 'a', code: '', expected: false },
        { id: 'c', code: 'a', expected: false },
        { id: 'a', code: 'a', expected: true },
      ],
    },
    {
      inputFilter: [{ include: 'a*', exclude: '*b' }, { exclude: 'b' }],
      cases: [
        { id: 'ab', code: '', expected: false },
        { id: 'a', code: 'b', expected: false },
        { id: 'a', code: '', expected: true },
        { id: 'c', code: 'a', expected: false },
        { id: 'a', code: 'a', expected: true },
      ],
    },
    {
      inputFilter: [undefined, undefined, ['js']],
      cases: [
        { id: 'foo.js', code: 'foo', moduleType: 'js', expected: true },
        { id: 'foo.ts', code: 'foo', moduleType: 'ts', expected: false },
      ],
    },
    {
      inputFilter: [undefined, undefined, { include: ['js'] }],
      cases: [
        { id: 'foo.js', code: 'foo', moduleType: 'js', expected: true },
        { id: 'foo.ts', code: 'foo', moduleType: 'ts', expected: false },
      ],
    },
  ]

  for (const filter of filters) {
    /**
     * 场景：当前 `[id, code, moduleType]` 过滤器组合处理多组模块输入。
     * 验证目标：全部缺省返回 undefined；任一条件拒绝即整体拒绝，全部通过才调用 handler。
     */
    test(`${util.inspect(filter.inputFilter)}`, () => {
      const [idFilter, codeFilter, moduleTypeFilter] = filter.inputFilter
      const filterForTransform = createFilterForTransform(
        idFilter,
        codeFilter,
        moduleTypeFilter,
        '',
      )
      if (!filter.cases) {
        expect(filterForTransform).toBeUndefined()
        return
      }
      expect(filterForTransform).not.toBeUndefined()

      for (const testCase of filter.cases) {
        const { id, code, moduleType, expected } = testCase
        expect(
          filterForTransform!(id, code, moduleType ?? 'js'),
          util.inspect({ id, code, moduleType }),
        ).toBe(expected)
      }
    })
  }
})
