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

  /**
   * 场景：很小的嵌套静态 div 树开启提升和字符串化，断言缓存仍保存 JS_ARRAY_EXPRESSION，验证不足收益阈值时保留普通 VNode 缓存。
   */
  test('should bail on non-eligible static trees', () => {
    const { ast } = compileWithStringify(
      `<div><div><div>hello</div><div>hello</div></div></div>`,
    )
    // 应生成可展开的缓存 children 数组。
    expect(ast.cached[0]!.value.type).toBe(NodeTypes.JS_ARRAY_EXPRESSION)
  })

  /**
   * 场景：重复五个带 class 的 span 置于一个静态 div 内，断言合成的 HTML、顶层 count=1 与快照，验证按有 props 的元素数达到阈值而非按 chunk 顶层数判断。
   */
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

  /**
   * 场景：一个静态 div 内含二十个 span，断言整个子树合成一个 static VNode、count=1，验证节点规模达到阈值后仍以顶层 DOM 数作为水合计数。
   */
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

  /**
   * 场景：五个带 class 的 span 互为兄弟，断言合并 HTML 和 count=5，验证连续候选合成一个调用但保留全部顶层节点数量。
   */
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

  /**
   * 场景：常量 style 对象、class 数组/对象与数值/布尔插值达到阈值，断言规范化后的 CSS、class 和展示文本，验证编译期求值与序列化协作。
   */
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
  /**
   * 场景：style 使用无插值的模板字符串常量，配合常量 class/文本达到阈值，断言结果是 color:red; 而非模板语法，验证字符串 style 的规范化路径。
   */
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

  /**
   * 场景：常量 class 表达式、插值 < 与普通 & 文本达到阈值，断言输出 HTML 分别转义属性和文本，验证求值后仍正确转义。
   */
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

  /**
   * 场景：自定义节点转换把 img src 改成 _imports_0_ 且仅标 CAN_CACHE，断言缓存仍为 VNode 数组，验证可缓存不等于可编译期字符串化。
   */
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

  /**
   * 场景：同一 img 导入引用改标 CAN_STRINGIFY，断言 createStatic 调用及快照，验证导入值通过占位恢复为 JS 拼接，而不是执行外部变量求值。
   */
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

  // #1128：indeterminate 需要 DOM property 语义，静态属性和常量绑定两种写法
  // 都不能写进静态 HTML。
  /**
   * 场景：indeterminate 以静态属性/常量绑定两种方式出现在候选树首尾，共四个输入都断言 VNode 缓存，验证递归发现 DOM property 语义时整候选退出。
   */
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

  /**
   * 场景：table/tbody 下重复带属性的 tr/td，虽然规模达到阈值仍断言保留 VNode 缓存，验证表格放置约束优先于优化收益。
   */
  test('should bail on tags that has placement constraints (eg.tables related tags)', () => {
    const { ast } = compileWithStringify(
      `<table><tbody>${repeat(
        `<tr class="foo"><td>foo</td></tr>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}</tbody></table>`,
    )
    expect(ast.cached).toMatchObject([cachedArrayBailedMatcher()])
  })

  /**
   * 场景：普通默认插槽与具名 template 插槽都放入五个静态 div，分别断言各节点仍为 VNode 缓存，验证 vSlot 作用域内跳过合并。
   */
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

  /**
   * 场景：五个 span 的 :title=null 达到阈值，断言合成 HTML 完全省略 title、count=5，验证 null 属性与 DOM 缺失属性语义一致。
   */
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
  /**
   * 场景：disabled=false 的 button 与二十个 div 形成二十一顶层项，断言合成 HTML 不含 disabled、count=21，验证布尔 false 不能写成仍会启用的字符串属性。
   */
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

  /**
   * 参数场景：value=false 走字面量布尔省略，value=0 走 hidden 的数值假值省略；两组各重复五个 span，均断言合成 HTML 不含 hidden，验证两条删除分支。
   */
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

  /**
   * 场景：SVG 含 width/height/viewBox/fill/xmlns 与五个 rect，断言序列化 HTML 大小写/属性完整且顶层 count=1，验证 SVG 合法属性可以通过分析。
   */
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

  /**
   * 场景：MathML math 内重复二十个 ms，断言合成完整 math HTML、count=1，验证 MathML namespace 的静态属性和后代序列化。
   */
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
  /**
   * 场景：常量 v-html 的实体解码后内容是 span 标记，配合足够规模匹配代码及快照，验证原始 HTML 进入 code 内容而不再次转义。
   */
  test('stringify v-html', () => {
    const { code } = compileWithStringify(`
      <pre  data-type="js"><code v-html="'&lt;span&gt;show-it &lt;/span&gt;'"></code></pre>
      <div class>
        <span class>1</span><span class>2</span>
      </div>`)
    expect(code).toMatch(`<code><span>show-it </span></code>`)
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：相同常量内容使用 v-text，断言 code 内为转义的 span 文本及快照，验证展示文本与 v-html 的原始内容路径不同。
   */
  test('stringify v-text', () => {
    const { code } = compileWithStringify(`
      <pre  data-type="js"><code v-text="'&lt;span&gt;show-it &lt;/span&gt;'"></code></pre>
      <div class>
        <span class>1</span><span class>2</span>
      </div>`)
    expect(code).toMatch(`<code>&lt;span&gt;show-it &lt;/span&gt;</code>`)
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：v-text 表达式含格式换行及模板字符串 text1，断言序列化内容只保留 text1，验证表达式空白不混入展示结果。
   */
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

  /**
   * 场景：select 内五个 option 使用静态 value=1 字符串，断言整个 select 字符串化且 value 保留，验证普通属性的字符串语义允许优化。
   */
  test('should work for <option> elements with string values', () => {
    const { ast, code } = compileWithStringify(
      `<div><select>${repeat(
        `<option value="1" />`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}</select></div>`,
    )
    // 静态 value 属性保留字符串语义，达到阈值后可随 select 一起字符串化。
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

  /**
   * 场景：option 使用 :value=1 数值绑定，虽然达到阈值仍断言 VNode 缓存，验证字符串属性不能替代运行时数值 property。
   */
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

  /**
   * 场景：根注释与 div 内注释和连续 span 共存，匹配快照验证注释仍为独立 VNode、后面的 span 仍可合并，验证注释形成区间边界而非禁止全部后续优化。
   */
  test('should bail for comments', () => {
    const { code } = compileWithStringify(
      `<!-- Comment 1 --><div class="a"><!-- Comment 2 -->${repeat(
        `<span class="b"/>`,
        StringifyThresholds.ELEMENT_WITH_BINDING_COUNT,
      )}</div>`,
    )
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：select 的第一个 option 绑定 :value=null，其余是静态字符串值，断言整个缓存候选退出字符串化，验证 option value 非静态表达式的保守退出规则。
   */
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

  /**
   * 场景：两组二十个 span 中间隔着带 key 的 div，匹配快照验证形成两个 static 调用而隔断节点保留，验证结算、splice 与扫描下标修正不跳过第二组。
   */
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

  /**
   * 场景：v-once 动态文本 div 后接五个静态 span，匹配快照验证 v-once 的 block tracking/缓存独立、span 用另一个 static 缓存槽，验证两类缓存边界不被合并。
   */
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
