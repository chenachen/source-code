/**
 * 静态 HTML 字符串化场景：达到收益阈值后合并连续 hoist，验证属性/样式序列化、命名空间、
 * 转义、常量插值和不可字符串化边界，防止优化改变浏览器解析后的 DOM 结构。
 */
import {
  CREATE_STATIC,
  ConstantTypes,
  NodeTypes,
  compile,
  createSimpleExpression,
} from '../../src'
import {
  StringifyThresholds,
  stringifyStatic,
} from '../../src/transforms/stringifyStatic'

describe('stringify static html', () => {
  /** 开启静态提升和字符串化钩子编译模板。 */
  function compileWithStringify(template: string) {
    return compile(template, {
      hoistStatic: true,
      prefixIdentifiers: true,
      transformHoist: stringifyStatic,
    })
  }

  /** 重复模板片段以精确达到/越过字符串化收益阈值。 */
  function repeat(code: string, n: number): string {
    return code.repeat(n)
  }

  /** 匹配仍保留为缓存表达式、没有被静态 HTML 字符串化的节点数组。 */
  function cachedArrayBailedMatcher(n = 1) {
    return {
      type: NodeTypes.JS_CACHE_EXPRESSION,
      value: {
        type: NodeTypes.JS_ARRAY_EXPRESSION,
        elements: new Array(n).fill(0).map(() => ({
          // 放弃字符串化后应保持 VNODE_CALL，不能留下半转换的 JS_CALL_EXPRESSION。
          codegenNode: { type: NodeTypes.VNODE_CALL },
        })),
      },
    }
  }

  /** 断言缓存节点已字符串化；该 matcher 不检查具体 HTML 内容。 */
  function cachedArraySuccessMatcher(n = 1) {
    return {
      type: NodeTypes.JS_CACHE_EXPRESSION,
      value: {
        type: NodeTypes.JS_ARRAY_EXPRESSION,
        elements: new Array(n).fill(0).map(() => ({
          type: NodeTypes.JS_CALL_EXPRESSION,
          callee: CREATE_STATIC,
        })),
      },
    }
  }

  /** 断言缓存节点已字符串化，并比较预期 HTML 内容和节点数量。 */
  function cachedArrayStaticNodeMatcher(content: string, count: number) {
    return {
      type: NodeTypes.JS_CACHE_EXPRESSION,
      value: {
        type: NodeTypes.JS_ARRAY_EXPRESSION,
        elements: [
          {
            type: NodeTypes.JS_CALL_EXPRESSION,
            callee: CREATE_STATIC,
            arguments: [JSON.stringify(content), String(count)],
          },
        ],
      },
    }
  }

  test('should bail on non-eligible static trees', () => {
    const { ast } = compileWithStringify(
      `<div><div><div>hello</div><div>hello</div></div></div>`,
    )
    // 应生成可展开的缓存 children 数组。
    expect(ast.cached[0]!.value.type).toBe(NodeTypes.JS_ARRAY_EXPRESSION)
  })

  test('should work on eligible content (elements with binding > 5)', () => {
    const { code, ast } = compileWithStringify(
      `<div><div>${repeat(
        `<span class="foo"/>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}</div></div>`,
    )

    // 达到阈值后应启用字符串化优化。
    expect(ast.cached).toMatchObject([
      cachedArrayStaticNodeMatcher(
        `<div>${repeat(
          `<span class="foo"></span>`,
          StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
        )}</div>`,
        1,
      ),
    ])

    expect(code).toMatchSnapshot()
  })

  test('should work on eligible content (elements > 20)', () => {
    const { code, ast } = compileWithStringify(
      `<div><div>${repeat(
        `<span/>`,
        StringifyThresholds.NODE_COUNT,
      )}</div></div>`,
    )
    // 增加一个节点后达到阈值，应开始优化。
    expect(ast.cached).toMatchObject([
      cachedArrayStaticNodeMatcher(
        `<div>${repeat(`<span></span>`, StringifyThresholds.NODE_COUNT)}</div>`,
        1,
      ),
    ])

    expect(code).toMatchSnapshot()
  })

  test('should work for multiple adjacent nodes', () => {
    const { ast, code } = compileWithStringify(
      `<div>${repeat(
        `<span class="foo"/>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}</div>`,
    )
    expect(ast.cached).toMatchObject([
      cachedArrayStaticNodeMatcher(
        repeat(
          `<span class="foo"></span>`,
          StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
        ),
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      ),
    ])

    expect(code).toMatchSnapshot()
  })

  test('serializing constant bindings', () => {
    const { ast, code } = compileWithStringify(
      `<div><div :style="{ color: 'red' }">${repeat(
        `<span :class="[{ foo: true }, { bar: true }]">{{ 1 }} + {{ false }}</span>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}</div></div>`,
    )
    // 当前带绑定元素数量达到阈值，应合并静态 HTML。
    expect(ast.cached).toMatchObject([
      cachedArrayStaticNodeMatcher(
        `<div style="color:red;">${repeat(
          `<span class="foo bar">1 + false</span>`,
          StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
        )}</div>`,
        1,
      ),
    ])
    expect(code).toMatchSnapshot()
  })

  // #12391：style 值来自模板字符串常量时应按最终 CSS 序列化，不能输出模板语法本身。
  test('serializing template string style', () => {
    const { ast, code } = compileWithStringify(
      `<div><div :style="\`color:red;\`">${repeat(
        `<span :class="[{ foo: true }, { bar: true }]">{{ 1 }} + {{ false }}</span>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}</div></div>`,
    )
    // 模板字符串 style 仍满足常量条件，应被优化。
    expect(ast.cached).toMatchObject([
      cachedArrayStaticNodeMatcher(
        `<div style="color:red;">${repeat(
          `<span class="foo bar">1 + false</span>`,
          StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
        )}</div>`,
        1,
      ),
    ])
    expect(code).toMatchSnapshot()
  })

  test('escape', () => {
    const { ast, code } = compileWithStringify(
      `<div><div>${repeat(
        `<span :class="'foo' + '&gt;ar'">{{ 1 }} + {{ '<' }}</span>` +
          `<span>&amp;</span>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}</div></div>`,
    )
    // 常量表达式替换后仍可字符串化。
    expect(ast.cached).toMatchObject([
      cachedArrayStaticNodeMatcher(
        `<div>${repeat(
          `<span class="foo&gt;ar">1 + &lt;</span>` + `<span>&amp;</span>`,
          StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
        )}</div>`,
        1,
      ),
    ])
    expect(code).toMatchSnapshot()
  })

  test('should bail on bindings that are cached but not stringifiable', () => {
    const { ast, code } = compile(
      `<div><div>${repeat(
        `<span class="foo">foo</span>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}<img src="./foo" /></div></div>`,
      {
        hoistStatic: true,
        prefixIdentifiers: true,
        transformHoist: stringifyStatic,
        nodeTransforms: [
          node => {
            if (node.type === NodeTypes.ELEMENT && node.tag === 'img') {
              const exp = createSimpleExpression(
                '_imports_0_',
                false,
                node.loc,
                ConstantTypes.CAN_CACHE,
              )
              node.props[0] = {
                type: NodeTypes.DIRECTIVE,
                name: 'bind',
                arg: createSimpleExpression('src', true),
                exp,
                modifiers: [],
                loc: node.loc,
              }
            }
          },
        ],
      },
    )
    expect(ast.cached).toMatchObject([cachedArrayBailedMatcher()])
    expect(code).toMatchSnapshot()
  })

  test('should work with bindings that are non-static but stringifiable', () => {
    // 绑定虽非静态节点但标为 CAN_STRINGIFY，表示它是已知常量字符串的引用。
    const { ast, code } = compile(
      `<div><div>${repeat(
        `<span class="foo">foo</span>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}<img src="./foo" /></div></div>`,
      {
        hoistStatic: true,
        prefixIdentifiers: true,
        transformHoist: stringifyStatic,
        nodeTransforms: [
          node => {
            if (node.type === NodeTypes.ELEMENT && node.tag === 'img') {
              const exp = createSimpleExpression(
                '_imports_0_',
                false,
                node.loc,
                ConstantTypes.CAN_STRINGIFY,
              )
              node.props[0] = {
                type: NodeTypes.DIRECTIVE,
                name: 'bind',
                arg: createSimpleExpression('src', true),
                exp,
                modifiers: [],
                loc: node.loc,
              }
            }
          },
        ],
      },
    )
    expect(ast.cached).toMatchObject([cachedArraySuccessMatcher()])
    expect(code).toMatchSnapshot()
  })

  // #1128：事件/指令等非属性绑定不能塞进静态 HTML，遇到时必须放弃整块字符串化。
  test('should bail on non-attribute bindings', () => {
    const { ast } = compileWithStringify(
      `<div><div><input indeterminate>${repeat(
        `<span class="foo">foo</span>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}</div></div>`,
    )
    expect(ast.cached).toMatchObject([cachedArrayBailedMatcher()])

    const { ast: ast2 } = compileWithStringify(
      `<div><div><input :indeterminate="true">${repeat(
        `<span class="foo">foo</span>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}</div></div>`,
    )
    expect(ast2.cached).toMatchObject([cachedArrayBailedMatcher()])

    const { ast: ast3 } = compileWithStringify(
      `<div><div>${repeat(
        `<span class="foo">foo</span>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}<input indeterminate></div></div>`,
    )
    expect(ast3.cached).toMatchObject([cachedArrayBailedMatcher()])

    const { ast: ast4 } = compileWithStringify(
      `<div><div>${repeat(
        `<span class="foo">foo</span>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}<input :indeterminate="true"></div></div>`,
    )
    expect(ast4.cached).toMatchObject([cachedArrayBailedMatcher()])
  })

  test('should bail on tags that has placement constraints (eg.tables related tags)', () => {
    const { ast } = compileWithStringify(
      `<table><tbody>${repeat(
        `<tr class="foo"><td>foo</td></tr>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}</tbody></table>`,
    )
    expect(ast.cached).toMatchObject([cachedArrayBailedMatcher()])
  })

  test('should bail inside slots', () => {
    const { ast } = compileWithStringify(
      `<foo>${repeat(
        `<div class="foo"></div>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}</foo>`,
    )
    expect(ast.cached).toMatchObject([
      cachedArrayBailedMatcher(StringifyThresholds.ELEMENT_WITH_BINDING_COUNT),
    ])

    const { ast: ast2 } = compileWithStringify(
      `<foo><template #foo>${repeat(
        `<div class="foo"></div>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}</template></foo>`,
    )
    expect(ast2.cached).toMatchObject([
      cachedArrayBailedMatcher(StringifyThresholds.ELEMENT_WITH_BINDING_COUNT),
    ])
  })

  test('should remove attribute for `null`', () => {
    const { ast } = compileWithStringify(
      `<div>${repeat(
        `<span :title="null"></span>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}</div>`,
    )

    expect(ast.cached).toMatchObject([
      cachedArrayStaticNodeMatcher(
        repeat(`<span></span>`, StringifyThresholds.ELEMENT_WITH_BINDING_COUNT),
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      ),
    ])
  })

  // #6617：常量 false 的布尔属性必须从 HTML 删除，而 true 才序列化为存在型属性。
  test('should remove boolean attribute for `false`', () => {
    const { ast } = compileWithStringify(
      `<button :disabled="false">enable</button>${repeat(
        `<div></div>`,
        StringifyThresholds.NODE_COUNT,
      )}`,
    )
    expect(ast.cached).toMatchObject([
      {
        type: NodeTypes.JS_CACHE_EXPRESSION,
        value: {
          type: NodeTypes.JS_CALL_EXPRESSION,
          callee: CREATE_STATIC,
          arguments: [
            JSON.stringify(
              `<button>enable</button>${repeat(
                `<div></div>`,
                StringifyThresholds.NODE_COUNT,
              )}`,
            ),
            '21',
          ],
        },
      },
    ])
  })

  test.each(['false', '0'])('should remove `hidden` with value `%s`', value => {
    const { ast } = compileWithStringify(
      `<div>
      ${repeat(
        `<span :hidden="${value}"></span>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}
    </div>`,
    )
    expect(ast.cached).toMatchObject([
      cachedArrayStaticNodeMatcher(
        repeat(`<span></span>`, StringifyThresholds.ELEMENT_WITH_BINDING_COUNT),
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      ),
    ])
  })

  test('should stringify svg', () => {
    const svg = `<svg width="50" height="50" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">`
    const repeated = `<rect width="50" height="50" fill="#C4C4C4"></rect>`
    const { ast } = compileWithStringify(
      `<div>${svg}${repeat(
        repeated,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}</svg></div>`,
    )

    expect(ast.cached).toMatchObject([
      cachedArrayStaticNodeMatcher(
        `${svg}${repeat(
          repeated,
          StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
        )}</svg>`,
        1,
      ),
    ])
  })

  test('should stringify mathML', () => {
    const math = `<math xmlns="http://www.w3.org/1998/Math/MathML">`
    const repeated = `<ms>1</ms>`
    const { ast } = compileWithStringify(
      `<div>${math}${repeat(
        repeated,
        StringifyThresholds.NODE_COUNT,
      )}</math></div>`,
    )

    expect(ast.cached).toMatchObject([
      cachedArrayStaticNodeMatcher(
        `${math}${repeat(repeated, StringifyThresholds.NODE_COUNT)}</math>`,
        1,
      ),
    ])
  })

  // #5439：常量 `v-html` 可进入静态 HTML，但内容必须作为原始 HTML 而非转义文本写入。
  test('stringify v-html', () => {
    const { code } = compileWithStringify(`
      <pre  data-type="js"><code v-html="'&lt;span&gt;show-it &lt;/span&gt;'"></code></pre>
      <div class>
        <span class>1</span><span class>2</span>
      </div>`)
    expect(code).toMatch(`<code><span>show-it </span></code>`)
    expect(code).toMatchSnapshot()
  })

  test('stringify v-text', () => {
    const { code } = compileWithStringify(`
      <pre  data-type="js"><code v-text="'&lt;span&gt;show-it &lt;/span&gt;'"></code></pre>
      <div class>
        <span class>1</span><span class>2</span>
      </div>`)
    expect(code).toMatch(`<code>&lt;span&gt;show-it &lt;/span&gt;</code>`)
    expect(code).toMatchSnapshot()
  })

  test('stringify v-text with escape', () => {
    const { code } = compileWithStringify(`
      <pre  data-type="js"><code v-text="
                \`text1\`"></code></pre>
      <div class>
        <span class>1</span><span class>2</span>
      </div>`)
    expect(code).toMatch(`<code>text1</code>`)
    expect(code).toMatchSnapshot()
  })

  test('should work for <option> elements with string values', () => {
    const { ast, code } = compileWithStringify(
      `<div><select>${repeat(
        `<option value="1" />`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}</select></div>`,
    )
    // 常量 v-html 达到阈值后应被字符串化。
    expect(ast.cached).toMatchObject([
      cachedArrayStaticNodeMatcher(
        `<select>${repeat(
          `<option value="1"></option>`,
          StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
        )}</select>`,
        1,
      ),
    ])
    expect(code).toMatchSnapshot()
  })

  test('should bail for <option> elements with number values', () => {
    const { ast, code } = compileWithStringify(
      `<div><select>${repeat(
        `<option :value="1" />`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}</select></div>`,
    )
    expect(ast.cached).toMatchObject([cachedArrayBailedMatcher()])
    expect(code).toMatchSnapshot()
  })

  test('should bail for comments', () => {
    const { code } = compileWithStringify(
      `<!-- Comment 1 --><div class="a"><!-- Comment 2 -->${repeat(
        `<span class="b"/>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}</div>`,
    )
    expect(code).toMatchSnapshot()
  })

  test('should bail for <option> elements with null values', () => {
    const { ast, code } = compileWithStringify(
      `<div><select><option :value="null" />${repeat(
        `<option value="1" />`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}</select></div>`,
    )
    expect(ast.cached).toMatchObject([cachedArrayBailedMatcher()])
    expect(code).toMatchSnapshot()
  })

  test('eligible content (elements > 20) + non-eligible content', () => {
    const { code } = compileWithStringify(
      `<div>${repeat(
        `<span/>`,
        StringifyThresholds.NODE_COUNT,
      )}<div key="1">1</div>${repeat(
        `<span/>`,
        StringifyThresholds.NODE_COUNT,
      )}</div>`,
    )

    expect(code).toMatchSnapshot()
  })

  test('eligible content + v-once node', () => {
    const { code } = compileWithStringify(
      `<div>
        <div v-once>{{ msg }}</div>
        ${repeat(`<span class="foo">foo</span>`, StringifyThresholds.ELEMENT_WITH_BINDING_COUNT)}
      </div>`,
    )
    expect(code).toMatchSnapshot()
  })
})
