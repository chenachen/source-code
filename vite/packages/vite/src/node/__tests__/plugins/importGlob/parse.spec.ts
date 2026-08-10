import { describe, expect, it } from 'vitest'
import { parseImportGlob } from '../../../plugins/importMetaGlob'

/** 只保留 parser 契约相关字段，避免绝对路径与内部优化字段污染快照。 */
async function run(input: string) {
  const items = await parseImportGlob(
    input,
    process.cwd(),
    process.cwd(),
    (id) => id,
  )
  return items.map((i) => ({
    globs: i.globs,
    options: i.options,
    start: i.start,
  }))
}

/** 把 throw 转成可快照值，固定错误类型、位置前的核心诊断文本。 */
async function runError(input: string) {
  try {
    await run(input)
  } catch (e) {
    return e
  }
}

describe('parse positives', async () => {
  /**
   * 场景：glob 可出现在对象/数组任意表达式位置，并接受字符串数组、负 pattern、多行静态选项。
   * 验证目标：准确得到 pattern、规范化 query/base 选项与源码 start，即使注释中包含右括号。
   * 机制：对 parser 结果做窄化快照，专门观察静态语法协议。
   */
  it('basic', async () => {
    expect(
      await run(`
    import.meta.glob('./modules/*.ts')
    `),
    ).toMatchInlineSnapshot(`
      [
        {
          "globs": [
            "./modules/*.ts",
          ],
          "options": {},
          "start": 5,
        },
      ]
    `)
  })

  /** 场景：glob 第一参数是两个字符串组成的数组；验证目标：解析结果按原顺序保留两个 pattern。 */
  it('array', async () => {
    expect(
      await run(`
    import.meta.glob(['./modules/*.ts', './dir/*.{js,ts}'])
    `),
    ).toMatchInlineSnapshot(`
      [
        {
          "globs": [
            "./modules/*.ts",
            "./dir/*.{js,ts}",
          ],
          "options": {},
          "start": 5,
        },
      ]
    `)
  })

  /** 场景：多行 pattern 数组含负模式，选项 eager/import 也跨行；验证目标：静态值完整归一化进单条解析结果。 */
  it('options with multilines', async () => {
    expect(
      await run(`
    import.meta.glob([
      './modules/*.ts',
      "!./dir/*.{js,ts}"
    ], {
      eager: true,
      import: 'named'
    })
    `),
    ).toMatchInlineSnapshot(`
      [
        {
          "globs": [
            "./modules/*.ts",
            "!./dir/*.{js,ts}",
          ],
          "options": {
            "eager": true,
            "import": "named",
          },
          "start": 5,
        },
      ]
    `)
  })

  /** 场景：glob 参数后跟含右括号的行注释与块注释；验证目标：闭括号定位不受注释干扰，start 仍为调用位置。 */
  it('options with multilines', async () => {
    expect(
      await run(`
    const modules = import.meta.glob(
      '/dir/**'
      // for test: annotation contain ")"
      /*
       * for test: annotation contain ")"
       * */
    )
    `),
    ).toMatchInlineSnapshot(`
      [
        {
          "globs": [
            "/dir/**",
          ],
          "options": {},
          "start": 21,
        },
      ]
    `)
  })

  /** 场景：query 是含字符串和布尔值的对象；验证目标：解析器序列化为 ?foo=bar&raw=true。 */
  it('options query', async () => {
    expect(
      await run(`
    const modules = import.meta.glob(
      '/dir/**',
      {
        query: {
          foo: 'bar',
          raw: true,
        }
      }
    )
    `),
    ).toMatchInlineSnapshot(`
      [
        {
          "globs": [
            "/dir/**",
          ],
          "options": {
            "query": "?foo=bar&raw=true",
          },
          "start": 21,
        },
      ]
    `)
  })

  /** 场景：glob 指定相对 base；验证目标：解析结果保留合法 base 与原 pattern。 */
  it('options with base', async () => {
    expect(
      await run(`
    import.meta.glob('./**/dir/*.md', {
      base: './path/to/base'
    })
    `),
    ).toMatchInlineSnapshot(`
      [
        {
          "globs": [
            "./**/dir/*.md",
          ],
          "options": {
            "base": "./path/to/base",
          },
          "start": 5,
        },
      ]
    `)
  })

  /** 场景：glob 调用作为对象属性值且属性后无逗号；验证目标：识别 pattern 并记录准确 start=47。 */
  it('object properties - 1', async () => {
    expect(
      await run(`
    export const pageFiles = {
      '.page': import.meta.glob('/**/*.page.*([a-zA-Z0-9])')
};`),
    ).toMatchInlineSnapshot(`
  [
    {
      "globs": [
        "/**/*.page.*([a-zA-Z0-9])",
      ],
      "options": {},
      "start": 47,
    },
  ]
`)
  })

  /** 场景：glob 调用作为对象属性值且尾随逗号；验证目标：逗号不进入调用范围，解析结果与无逗号形式一致。 */
  it('object properties - 2', async () => {
    expect(
      await run(`
    export const pageFiles = {
      '.page': import.meta.glob('/**/*.page.*([a-zA-Z0-9])'),
};`),
    ).toMatchInlineSnapshot(`
  [
    {
      "globs": [
        "/**/*.page.*([a-zA-Z0-9])",
      ],
      "options": {},
      "start": 47,
    },
  ]
`)
  })

  /** 场景：对象含 client/server 两个 glob 属性；验证目标：返回两条独立记录及各自源码起点。 */
  it('object properties - 3', async () => {
    expect(
      await run(`
    export const pageFiles = {
      '.page.client': import.meta.glob('/**/*.page.client.*([a-zA-Z0-9])'),
      '.page.server': import.meta.glob('/**/*.page.server.*([a-zA-Z0-9])'),
};`),
    ).toMatchInlineSnapshot(`
  [
    {
      "globs": [
        "/**/*.page.client.*([a-zA-Z0-9])",
      ],
      "options": {},
      "start": 54,
    },
    {
      "globs": [
        "/**/*.page.server.*([a-zA-Z0-9])",
      ],
      "options": {},
      "start": 130,
    },
  ]
`)
  })

  /** 场景：数组中连续放置两个 glob 调用；验证目标：解析器按源码顺序返回各自 pattern 与 start。 */
  it('array item', async () => {
    expect(
      await run(`
    export const pageFiles = [
      import.meta.glob('/**/*.page.client.*([a-zA-Z0-9])'),
      import.meta.glob('/**/*.page.server.*([a-zA-Z0-9])'),
    ]`),
    ).toMatchInlineSnapshot(`
      [
        {
          "globs": [
            "/**/*.page.client.*([a-zA-Z0-9])",
          ],
          "options": {},
          "start": 38,
        },
        {
          "globs": [
            "/**/*.page.server.*([a-zA-Z0-9])",
          ],
          "options": {},
          "start": 98,
        },
      ]
    `)
  })
})

describe('parse negatives', async () => {
  /**
   * 场景：glob 展开必须在构建前确定文件全集。
   * 验证目标：拒绝缺括号、动态 pattern/选项、错误参数数目/类型和非法 base；字符串中的伪调用忽略。
   * 机制：快照每个错误分支，确保诊断指向用户可修复的约束而非底层 AST 异常。
   */
  it('syntax error', async () => {
    expect(await runError('import.meta.glob(')).toMatchInlineSnapshot(
      '[Error: Invalid glob import syntax: Close parenthesis not found]',
    )
  })

  /** 场景：glob 调用没有参数；验证目标：错误明确要求 1–2 个参数并报告实际为 0。 */
  it('empty', async () => {
    expect(await runError('import.meta.glob()')).toMatchInlineSnapshot(
      '[Error: Invalid glob import syntax: Expected 1-2 arguments, but got 0]',
    )
  })

  /** 场景：glob 调用传入三个参数；验证目标：错误拒绝超出上限并报告实际为 3。 */
  it('3 args', async () => {
    expect(
      await runError('import.meta.glob("", {}, {})'),
    ).toMatchInlineSnapshot(
      '[Error: Invalid glob import syntax: Expected 1-2 arguments, but got 3]',
    )
  })

  /** 场景：字符串内容看似 import.meta.glob 调用；验证目标：字面量清理后不解析它，也不返回错误。 */
  it('in string', async () => {
    expect(await runError('"import.meta.glob()"')).toBeUndefined()
  })

  /** 场景：glob pattern 是标识符变量；验证目标：静态分析拒绝非字面量。 */
  it('variable', async () => {
    expect(await runError('import.meta.glob(hey)')).toMatchInlineSnapshot(
      '[Error: Invalid glob import syntax: Could only use literals]',
    )
  })

  /** 场景：模板字面量包含表达式；验证目标：错误指出动态模板不能作为静态 glob。 */
  it('template', async () => {
    expect(
      await runError('import.meta.glob(`hi ${hey}`)'),
    ).toMatchInlineSnapshot(
      '[Error: Invalid glob import syntax: Expected glob to be a string, but got dynamic template literal]',
    )
  })

  /** 场景：无表达式模板用 Unicode 转义拼出 hello；验证目标：解析结果解码为 /hello。 */
  it('template with unicode', async () => {
    expect(await run('import.meta.glob(`/\u0068\u0065\u006c\u006c\u006f`)'))
      .toMatchInlineSnapshot(`
      [
        {
          "globs": [
            "/hello",
          ],
          "options": {},
          "start": 0,
        },
      ]
    `)
  })

  /** 场景：模板字面量没有表达式；验证目标：它按普通静态字符串 pattern 接受。 */
  it('template without expressions', async () => {
    expect(await run('import.meta.glob(`/**/*.page.client.*([a-zA-Z0-9])`)'))
      .toMatchInlineSnapshot(`
      [
        {
          "globs": [
            "/**/*.page.client.*([a-zA-Z0-9])",
          ],
          "options": {},
          "start": 0,
        },
      ]
    `)
  })

  /** 场景：glob pattern 是数字；验证目标：诊断指出需要字符串而实际为 number。 */
  it('be string', async () => {
    expect(await runError('import.meta.glob(1)')).toMatchInlineSnapshot(
      '[Error: Invalid glob import syntax: Expected glob to be a string, but got "number"]',
    )
  })

  /** 场景：pattern 数组包含变量或混合字符串与变量；验证目标：两种写法都因非字面量被拒绝。 */
  it('be array variable', async () => {
    expect(await runError('import.meta.glob([hey])')).toMatchInlineSnapshot(
      '[Error: Invalid glob import syntax: Could only use literals]',
    )
    expect(
      await runError('import.meta.glob(["1", hey])'),
    ).toMatchInlineSnapshot(
      '[Error: Invalid glob import syntax: Could only use literals]',
    )
  })

  /** 场景：第二参数分别为标识符和数组；验证目标：诊断要求对象字面量并报告实际 AST 类型。 */
  it('options', async () => {
    expect(
      await runError('import.meta.glob("hey", hey)'),
    ).toMatchInlineSnapshot(
      '[Error: Invalid glob import syntax: Expected the second argument to be an object literal, but got "Identifier"]',
    )
    expect(await runError('import.meta.glob("hey", [])')).toMatchInlineSnapshot(
      '[Error: Invalid glob import syntax: Expected the second argument to be an object literal, but got "ArrayExpression"]',
    )
  })

  /** 场景：选项含未知键、动态 import 值或错误 eager 类型；验证目标：分别给出未知项、非静态值和类型错误。 */
  it('options props', async () => {
    expect(
      await runError('import.meta.glob("hey", { hey: 1 })'),
    ).toMatchInlineSnapshot('[Error: Unknown glob option "hey"]')
    expect(
      await runError('import.meta.glob("hey", { import: hey })'),
    ).toMatchInlineSnapshot(
      '[Error: Vite is unable to parse the glob options as the value is not static]',
    )
    expect(
      await runError('import.meta.glob("hey", { eager: 123 })'),
    ).toMatchInlineSnapshot(
      '[Error: Expected glob option "eager" to be of type boolean, but got number]',
    )
  })

  /** 场景：query 与旧 as 冲突，或 query 值类型/展开非静态；验证目标：每个非法分支返回对应约束诊断。 */
  it('options query', async () => {
    expect(
      await runError('import.meta.glob("./*.js", { as: "raw", query: "hi" })'),
    ).toMatchInlineSnapshot(
      '[Error: Options "as" and "query" cannot be used together]',
    )
    expect(
      await runError('import.meta.glob("./*.js", { query: 123 })'),
    ).toMatchInlineSnapshot(
      '[Error: Expected glob option "query" to be of type object or string, but got number]',
    )
    expect(
      await runError('import.meta.glob("./*.js", { query: { foo: {} } })'),
    ).toMatchInlineSnapshot(
      '[Error: Expected glob option "query.foo" to be of type string, number, or boolean, but got object]',
    )
    expect(
      await runError('import.meta.glob("./*.js", { query: { foo: hey } })'),
    ).toMatchInlineSnapshot(
      '[Error: Vite is unable to parse the glob options as the value is not static]',
    )
    expect(
      await runError(
        'import.meta.glob("./*.js", { query: { foo: 123, ...a } })',
      ),
    ).toMatchInlineSnapshot(
      '[Error: Vite is unable to parse the glob options as the value is not static]',
    )
  })

  /** 场景：base 为数字、无相对/绝对前缀或以 ! 开头；验证目标：解析器分别拒绝类型、前缀和负 base。 */
  it('options base', async () => {
    expect(
      await runError('import.meta.glob("./*.js", { base: 1 })'),
    ).toMatchInlineSnapshot(
      '[Error: Expected glob option "base" to be of type string, but got number]',
    )
    expect(
      await runError('import.meta.glob("./*.js", { base: "foo" })'),
    ).toMatchInlineSnapshot(
      "[Error: Option \"base\" must start with '/', './' or '../', but got \"foo\"]",
    )
    expect(
      await runError('import.meta.glob("./*.js", { base: "!/foo" })'),
    ).toMatchInlineSnapshot('[Error: Option "base" cannot start with "!"]')
  })
})
