/**
 * 模板表达式转换场景：验证自由标识符前缀、局部作用域、Babel 新语法、TS 语法和
 * bindingMetadata 快速路径；同时覆盖函数参数/解构/switch 等容易误判引用关系的结构。
 */
import {
  BindingTypes,
  type CompilerOptions,
  ConstantTypes,
  type DirectiveNode,
  type ElementNode,
  type InterpolationNode,
  NodeTypes,
  baseCompile,
  baseParse as parse,
  transform,
} from '../../src'
import { transformIf } from '../../src/transforms/vIf'
import { transformExpression } from '../../src/transforms/transformExpression'
import { PatchFlagNames, PatchFlags } from '../../../shared/src'

/** 解析并运行表达式转换，返回首个插值/指令表达式节点。 */
function parseWithExpressionTransform(
  template: string,
  options: CompilerOptions = {},
) {
  const ast = parse(template, options)
  transform(ast, {
    prefixIdentifiers: true,
    nodeTransforms: [transformIf, transformExpression],
    ...options,
  })
  return ast.children[0]
}

/** 使用 prefixIdentifiers 编译表达式模板，供生成代码断言复用。 */
function compile(template: string) {
  return baseCompile(template, { prefixIdentifiers: true })
}

describe('compiler: expression transform', () => {
  test('interpolation (root)', () => {
    const node = parseWithExpressionTransform(`{{ foo }}`) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.SIMPLE_EXPRESSION,
      content: `_ctx.foo`,
    })
  })

  test('empty interpolation', () => {
    const node = parseWithExpressionTransform(`{{}}`) as InterpolationNode
    const node2 = parseWithExpressionTransform(`{{ }}`) as InterpolationNode
    const node3 = parseWithExpressionTransform(
      `<div>{{ }}</div>`,
    ) as ElementNode

    const objectToBeMatched = {
      type: NodeTypes.SIMPLE_EXPRESSION,
      content: ``,
    }
    expect(node.content).toMatchObject(objectToBeMatched)
    expect(node2.content).toMatchObject(objectToBeMatched)
    expect((node3.children[0] as InterpolationNode).content).toMatchObject(
      objectToBeMatched,
    )
  })

  test('interpolation (children)', () => {
    const el = parseWithExpressionTransform(
      `<div>{{ foo }}</div>`,
    ) as ElementNode
    const node = el.children[0] as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.SIMPLE_EXPRESSION,
      content: `_ctx.foo`,
    })
  })

  test('interpolation (complex)', () => {
    const el = parseWithExpressionTransform(
      `<div>{{ foo + bar(baz.qux) }}</div>`,
    ) as ElementNode
    const node = el.children[0] as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        { content: `_ctx.foo` },
        ` + `,
        { content: `_ctx.bar` },
        `(`,
        { content: `_ctx.baz` },
        `.`,
        { content: `qux` },
        `)`,
      ],
    })
  })

  test('directive value', () => {
    const node = parseWithExpressionTransform(
      `<div v-foo:arg="baz"/>`,
    ) as ElementNode
    const arg = (node.props[0] as DirectiveNode).arg!
    expect(arg).toMatchObject({
      type: NodeTypes.SIMPLE_EXPRESSION,
      content: `arg`,
    })
    const exp = (node.props[0] as DirectiveNode).exp!
    expect(exp).toMatchObject({
      type: NodeTypes.SIMPLE_EXPRESSION,
      content: `_ctx.baz`,
    })
  })

  test('dynamic directive arg', () => {
    const node = parseWithExpressionTransform(
      `<div v-foo:[arg]="baz"/>`,
    ) as ElementNode
    const arg = (node.props[0] as DirectiveNode).arg!
    expect(arg).toMatchObject({
      type: NodeTypes.SIMPLE_EXPRESSION,
      content: `_ctx.arg`,
    })
    const exp = (node.props[0] as DirectiveNode).exp!
    expect(exp).toMatchObject({
      type: NodeTypes.SIMPLE_EXPRESSION,
      content: `_ctx.baz`,
    })
  })

  test('should prefix complex expressions', () => {
    const node = parseWithExpressionTransform(
      `{{ foo(baz + 1, { key: kuz }) }}`,
    ) as InterpolationNode
    // 多个自由标识符应拆成可分别前缀化的复合表达式。
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        {
          content: `_ctx.foo`,
          loc: {
            start: { offset: 3, line: 1, column: 4 },
            end: { offset: 6, line: 1, column: 7 },
          },
        },
        `(`,
        {
          content: `_ctx.baz`,
          loc: {
            start: { offset: 7, line: 1, column: 8 },
            end: { offset: 10, line: 1, column: 11 },
          },
        },
        ` + 1, { key: `,
        {
          content: `_ctx.kuz`,
          loc: {
            start: { offset: 23, line: 1, column: 24 },
            end: { offset: 26, line: 1, column: 27 },
          },
        },
        ` })`,
      ],
    })
  })

  test('should not prefix whitelisted globals', () => {
    const node = parseWithExpressionTransform(
      `{{ Math.max(1, 2) }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [{ content: `Math` }, `.`, { content: `max` }, `(1, 2)`],
    })

    expect(
      (parseWithExpressionTransform(`{{ new Error() }}`) as InterpolationNode)
        .content,
    ).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: ['new ', { content: 'Error' }, '()'],
    })
  })

  test('should not prefix reserved literals', () => {
    /** 断言 JS 保留字/字面量保持简单表达式且不添加上下文前缀。 */
    function assert(exp: string) {
      const node = parseWithExpressionTransform(
        `{{ ${exp} }}`,
      ) as InterpolationNode
      expect(node.content).toMatchObject({
        type: NodeTypes.SIMPLE_EXPRESSION,
        content: exp,
      })
    }
    assert(`true`)
    assert(`false`)
    assert(`null`)
    assert(`this`)
  })

  test('should not prefix id of a function declaration', () => {
    const node = parseWithExpressionTransform(
      `{{ function foo() { return bar } }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        `function `,
        { content: `foo` },
        `() { return `,
        { content: `_ctx.bar` },
        ` }`,
      ],
    })
  })

  test('should not prefix params of a function expression', () => {
    const node = parseWithExpressionTransform(
      `{{ foo => foo + bar }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        { content: `foo` },
        ` => `,
        { content: `foo` },
        ` + `,
        { content: `_ctx.bar` },
      ],
    })
  })

  test('should prefix default value of a function expression param', () => {
    const node = parseWithExpressionTransform(
      `{{ (foo = baz) => foo + bar }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        `(`,
        { content: `foo` },
        ` = `,
        { content: `_ctx.baz` },
        `) => `,
        { content: `foo` },
        ` + `,
        { content: `_ctx.bar` },
      ],
    })
  })

  test('should not prefix function param destructuring', () => {
    const node = parseWithExpressionTransform(
      `{{ ({ foo }) => foo + bar }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        `({ `,
        { content: `foo` },
        ` }) => `,
        { content: `foo` },
        ` + `,
        { content: `_ctx.bar` },
      ],
    })
  })

  test('function params should not affect out of scope identifiers', () => {
    const node = parseWithExpressionTransform(
      `{{ { a: foo => foo, b: foo } }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        `{ a: `,
        { content: `foo` },
        ` => `,
        { content: `foo` },
        `, b: `,
        { content: `_ctx.foo` },
        ` }`,
      ],
    })
  })

  test('should prefix default value of function param destructuring', () => {
    const node = parseWithExpressionTransform(
      `{{ ({ foo = bar }) => foo + bar }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        `({ `,
        { content: `foo` },
        ` = `,
        { content: `_ctx.bar` },
        ` }) => `,
        { content: `foo` },
        ` + `,
        { content: `_ctx.bar` },
      ],
    })
  })

  test('should not prefix an object property key', () => {
    const node = parseWithExpressionTransform(
      `{{ { foo() { baz() }, value: bar } }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        `{ foo() { `,
        { content: `_ctx.baz` },
        `() }, value: `,
        { content: `_ctx.bar` },
        ` }`,
      ],
    })
  })

  test('should not duplicate object key with same name as value', () => {
    const node = parseWithExpressionTransform(
      `{{ { foo: foo } }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [`{ foo: `, { content: `_ctx.foo` }, ` }`],
    })
  })

  test('should prefix a computed object property key', () => {
    const node = parseWithExpressionTransform(
      `{{ { [foo]: bar } }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        `{ [`,
        { content: `_ctx.foo` },
        `]: `,
        { content: `_ctx.bar` },
        ` }`,
      ],
    })
  })

  test('should prefix object property shorthand value', () => {
    const node = parseWithExpressionTransform(
      `{{ { foo } }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [`{ foo: `, { content: `_ctx.foo` }, ` }`],
    })
  })

  test('should not prefix id in a member expression', () => {
    const node = parseWithExpressionTransform(
      `{{ foo.bar.baz }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        { content: `_ctx.foo` },
        `.`,
        { content: `bar` },
        `.`,
        { content: `baz` },
      ],
    })
  })

  test('should prefix computed id in a member expression', () => {
    const node = parseWithExpressionTransform(
      `{{ foo[bar][baz] }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        { content: `_ctx.foo` },
        `[`,
        { content: `_ctx.bar` },
        `][`,
        { content: '_ctx.baz' },
        `]`,
      ],
    })
  })

  test('should handle parse error', () => {
    const onError = vi.fn()
    parseWithExpressionTransform(`{{ a( }}`, { onError })
    expect(onError.mock.calls[0][0].message).toMatch(
      `Error parsing JavaScript expression: Unexpected token`,
    )
  })

  test('should not error', () => {
    const onError = vi.fn()
    parseWithExpressionTransform(
      `<p :id="undefined /* force override the id */"/>`,
      {
        onError,
      },
    )
    expect(onError).not.toHaveBeenCalled()
  })

  test('should prefix in assignment', () => {
    const node = parseWithExpressionTransform(
      `{{ x = 1 }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [{ content: `_ctx.x` }, ` = 1`],
    })
  })

  test('should prefix in assignment pattern', () => {
    const node = parseWithExpressionTransform(
      `{{ { x, y: [z] } = obj }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        `{ x: `,
        { content: `_ctx.x` },
        `, y: [`,
        { content: `_ctx.z` },
        `] } = `,
        { content: `_ctx.obj` },
      ],
    })
  })

  // #8295：浮点数字面量仍是编译期常量，不能因为含 `.` 被成员表达式路径误分类。
  test('should treat floating point number literals as constant', () => {
    const node = parseWithExpressionTransform(
      `{{ [1, 2.1] }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      constType: ConstantTypes.CAN_STRINGIFY,
    })
  })

  // #10807：字符串内容即使包含括号也仍是常量，不能由字符启发式提前放弃静态分析。
  test('should not bail constant on strings w/ ()', () => {
    const node = parseWithExpressionTransform(
      `{{ { foo: 'ok()' } }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      constType: ConstantTypes.CAN_STRINGIFY,
    })
  })

  test('should bail constant for global identifiers w/ new or call expressions', () => {
    const node = parseWithExpressionTransform(
      `{{ new Date().getFullYear() }}`,
    ) as InterpolationNode
    expect(node.content).toMatchObject({
      children: [
        'new ',
        { constType: ConstantTypes.NOT_CONSTANT },
        '().',
        { constType: ConstantTypes.NOT_CONSTANT },
        '()',
      ],
    })
  })

  test('should not prefix temp variable of for...in', () => {
    const { code } = compile(
      `<div @click="() => {
        for (const x in list) {
          log(x)
        }
        error(x)
      }"/>`,
    )
    expect(code).not.toMatch(`log(_ctx.x)`)
    expect(code).toMatch(`error(_ctx.x)`)
    expect(code).toMatchSnapshot()
  })

  test('should not prefix temp variable of for...of', () => {
    const { code } = compile(
      `<div @click="() => {
        for (const x of list) {
          log(x)
        }
        error(x)
      }"/>`,
    )
    expect(code).not.toMatch(`log(_ctx.x)`)
    expect(code).toMatch(`error(_ctx.x)`)
    expect(code).toMatchSnapshot()
  })

  test('should not prefix temp variable of for loop', () => {
    const { code } = compile(
      `<div @click="() => {
        for (let i = 0; i < list.length; i++) {
          log(i)
        }
        error(i)
      }"/>`,
    )
    expect(code).not.toMatch(`log(_ctx.i)`)
    expect(code).toMatch(`error(_ctx.i)`)
    expect(code).toMatchSnapshot()
  })

  test('should allow leak of var declarations in for loop', () => {
    const { code } = compile(
      `<div @click="() => {
        for (var i = 0; i < list.length; i++) {
          log(i)
        }
        error(i)
      }"/>`,
    )
    expect(code).not.toMatch(`log(_ctx.i)`)
    expect(code).not.toMatch(`error(_ctx.i)`)
    expect(code).toMatchSnapshot()
  })

  test('should not prefix catch block param', () => {
    const { code } = compile(
      `<div @click="() => {
         try {} catch (err) { console.error(err) }
        console.log(err)
      }"/>`,
    )
    expect(code).not.toMatch(`console.error(_ctx.err)`)
    expect(code).toMatch(`console.log(_ctx.err)`)
    expect(code).toMatchSnapshot()
  })

  test('should not prefix destructured catch block param', () => {
    const { code } = compile(
      `<div @click="() => {
        try {
          throw new Error('sup?')
        } catch ({ message: { length } }) {
          console.error(length)
        }
        console.log(length)
      }"/>`,
    )
    expect(code).not.toMatch(`console.error(_ctx.length)`)
    expect(code).toMatch(`console.log(_ctx.length)`)
    expect(code).toMatchSnapshot()
  })

  // 新语法分组：确认 Babel parser 插件能处理提案语法且标识符前缀仍准确。
  describe('ES Proposals support', () => {
    test('bigInt', () => {
      const node = parseWithExpressionTransform(
        `{{ 13000n }}`,
      ) as InterpolationNode
      expect(node.content).toMatchObject({
        type: NodeTypes.SIMPLE_EXPRESSION,
        content: `13000n`,
        isStatic: false,
        constType: ConstantTypes.CAN_STRINGIFY,
      })
    })

    test('nullish coalescing', () => {
      const node = parseWithExpressionTransform(
        `{{ a ?? b }}`,
      ) as InterpolationNode
      expect(node.content).toMatchObject({
        type: NodeTypes.COMPOUND_EXPRESSION,
        children: [{ content: `_ctx.a` }, ` ?? `, { content: `_ctx.b` }],
      })
    })

    test('optional chaining', () => {
      const node = parseWithExpressionTransform(
        `{{ a?.b?.c }}`,
      ) as InterpolationNode
      expect(node.content).toMatchObject({
        type: NodeTypes.COMPOUND_EXPRESSION,
        children: [
          { content: `_ctx.a` },
          `?.`,
          { content: `b` },
          `?.`,
          { content: `c` },
        ],
      })
    })

    test('Enabling additional plugins', () => {
      // 启用 pipeline operator，验证它可作为旧 filter 语法的现代替代。
      const node = parseWithExpressionTransform(`{{ a |> uppercase }}`, {
        expressionPlugins: [
          [
            'pipelineOperator',
            {
              proposal: 'minimal',
            },
          ],
        ],
      }) as InterpolationNode
      expect(node.content).toMatchObject({
        type: NodeTypes.COMPOUND_EXPRESSION,
        children: [
          { content: `_ctx.a` },
          ` |> `,
          { content: `_ctx.uppercase` },
        ],
      })
    })
  })

  // SFC 绑定元数据分组：根据 props/ref/let/const 来源生成最短且可写性正确的访问代码。
  describe('bindingMetadata', () => {
    const bindingMetadata = {
      props: BindingTypes.PROPS,
      setup: BindingTypes.SETUP_MAYBE_REF,
      setupConst: BindingTypes.SETUP_CONST,
      data: BindingTypes.DATA,
      options: BindingTypes.OPTIONS,
      reactive: BindingTypes.SETUP_REACTIVE_CONST,
      literal: BindingTypes.LITERAL_CONST,
      isNaN: BindingTypes.SETUP_REF,
    }

    /** 用固定 SFC bindingMetadata 编译，以比较 inline/non-inline 访问策略。 */
    function compileWithBindingMetadata(
      template: string,
      options?: CompilerOptions,
    ) {
      return baseCompile(template, {
        prefixIdentifiers: true,
        bindingMetadata,
        ...options,
      })
    }

    test('non-inline mode', () => {
      const { code } = compileWithBindingMetadata(
        `<div>{{ props }} {{ setup }} {{ data }} {{ options }} {{ isNaN }}</div>`,
      )
      expect(code).toMatch(`$props.props`)
      expect(code).toMatch(`$setup.setup`)
      expect(code).toMatch(`$setup.isNaN`)
      expect(code).toMatch(`$data.data`)
      expect(code).toMatch(`$options.options`)
      expect(code).toMatch(`_ctx, _cache, $props, $setup, $data, $options`)
      expect(code).toMatchSnapshot()
    })

    test('inline mode', () => {
      const { code } = compileWithBindingMetadata(
        `<div>{{ props }} {{ setup }} {{ setupConst }} {{ data }} {{ options }} {{ isNaN }}</div>`,
        { inline: true },
      )
      expect(code).toMatch(`__props.props`)
      expect(code).toMatch(`_unref(setup)`)
      expect(code).toMatch(`_toDisplayString(setupConst)`)
      expect(code).toMatch(`_ctx.data`)
      expect(code).toMatch(`_ctx.options`)
      expect(code).toMatch(`isNaN.value`)
      expect(code).toMatchSnapshot()
    })

    test('literal const handling', () => {
      const { code } = compileWithBindingMetadata(`<div>{{ literal }}</div>`, {
        inline: true,
      })
      expect(code).toMatch(`toDisplayString(literal)`)
      // #7973：字面量 const 不会变化，插值无需 TEXT patchFlag。
      expect(code).not.toMatch(
        `${PatchFlags.TEXT} /* ${PatchFlagNames[PatchFlags.TEXT]} */`,
      )
    })

    test('literal const handling， non-inline mode', () => {
      const { code } = compileWithBindingMetadata(`<div>{{ literal }}</div>`)
      expect(code).toMatch(`toDisplayString($setup.literal)`)
      // #7973：setup 内联模式下的字面量 const 同样应跳过文本 patch。
      expect(code).not.toMatch(
        `${PatchFlags.TEXT} /* ${PatchFlagNames[PatchFlags.TEXT]} */`,
      )
    })

    test('reactive const handling', () => {
      const { code } = compileWithBindingMetadata(`<div>{{ reactive }}</div>`, {
        inline: true,
      })
      // #7973：reactive const 的引用稳定但内部值可变，仍必须保留 TEXT patchFlag。
      expect(code).toMatch(
        `${PatchFlags.TEXT} /* ${PatchFlagNames[PatchFlags.TEXT]} */`,
      )
    })

    // #10754：内联模式赋值右侧的 await 必须保留 async 上下文包装，且左值改写仍正确。
    test('await expression in right hand of assignment, inline mode', () => {
      const node = parseWithExpressionTransform(
        `{{ (async () => { x = await bar })() }}`,
        {
          inline: true,
          bindingMetadata: {
            x: BindingTypes.SETUP_LET,
            bar: BindingTypes.SETUP_CONST,
          },
        },
      ) as InterpolationNode
      expect(node.content).toMatchObject({
        type: NodeTypes.COMPOUND_EXPRESSION,
        children: [
          `(async () => { `,
          {
            content: `_isRef(x) ? x.value = await bar : x`,
          },
          ` = await `,
          {
            content: `bar`,
          },
          ` })()`,
        ],
      })
    })
  })

  // switch case 共享词法作用域，验证声明计数不会在相邻 case 间提前撤销或泄漏。
  describe('switch case variable declarations', () => {
    test('should handle const declarations in switch case without braces', () => {
      const { code } = compile(
        `{{ (() => { switch (1) { case 1: const foo = "bar"; return \`\${foo}\`; } })() }}`,
      )

      expect(code).toMatch(`const foo = "bar";`)
      expect(code).toMatch(`return \`\${foo}\`;`)
      expect(code).not.toMatch(`_ctx.foo`)
    })

    test('should handle const declarations in switch case with braces (existing behavior)', () => {
      const { code } = compile(
        `{{ (() => {
          switch (true) {
            case true: {
              const foo = "bar";
              return \`\${foo}\`;
            }
          }
        })() }}`,
      )

      expect(code).toMatch(`const foo = "bar";`)
      expect(code).toMatch(`return \`\${foo}\`;`)
      expect(code).not.toMatch(`_ctx.foo`)
    })

    test('should parse switch case test as local scoped variables', () => {
      const { code } = compile(
        `{{ (() => { switch (foo) { case bar: return \`\${bar}\`; } })() }}`,
      )

      expect(code).toMatch('_ctx.foo')
      expect(code).toMatch(`_ctx.bar`)
    })
  })
})
