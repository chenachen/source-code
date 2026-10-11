/**
 * 代码生成器场景：验证 helper 序言、函数/module 模式、source map、缩进与各类 JS AST
 * 节点的打印结果；IfStatement 和 VNodeCall 分组覆盖控制流与 block/VNode helper 选择。
 */
import {
  ConstantTypes,
  type DirectiveArguments,
  type ForCodegenNode,
  type IfConditionalExpression,
  NodeTypes,
  type RootNode,
  type VNodeCall,
  createArrayExpression,
  createAssignmentExpression,
  createBlockStatement,
  createCacheExpression,
  createCallExpression,
  createCompoundExpression,
  createConditionalExpression,
  createIfStatement,
  createInterpolation,
  createObjectExpression,
  createObjectProperty,
  createSimpleExpression,
  createTemplateLiteral,
  createVNodeCall,
  generate,
  locStub,
} from '../src'
import {
  CREATE_COMMENT,
  CREATE_ELEMENT_VNODE,
  CREATE_VNODE,
  FRAGMENT,
  RENDER_LIST,
  RESOLVE_COMPONENT,
  RESOLVE_DIRECTIVE,
  TO_DISPLAY_STRING,
  helperNameMap,
} from '../src/runtimeHelpers'
import { createElementWithCodegen, genFlagText } from './testUtils'
import { PatchFlags } from '@vue/shared'

/** 创建带完整默认字段的 RootNode，调用方只覆盖当前 codegen 用例关心的部分。 */
function createRoot(options: Partial<RootNode> = {}): RootNode {
  return {
    type: NodeTypes.ROOT,
    source: '',
    children: [],
    helpers: new Set(),
    components: [],
    directives: [],
    imports: [],
    hoists: [],
    cached: [],
    temps: 0,
    codegenNode: createSimpleExpression(`null`, false),
    loc: locStub,
    ...options,
  }
}

describe('compiler: codegen', () => {
  /**
   * 场景：RootNode 登记 CREATE_VNODE/RESOLVE_DIRECTIVE，module 模式 generate 后断言从 vue 导入带下划线别名，验证 helper 集合决定模块序言并用快照核对整体代码。
   */
  test('module mode preamble', () => {
    const root = createRoot({
      helpers: new Set([CREATE_VNODE, RESOLVE_DIRECTIVE]),
    })
    const { code } = generate(root, { mode: 'module' })
    expect(code).toMatch(
      `import { ${helperNameMap[CREATE_VNODE]} as _${helperNameMap[CREATE_VNODE]}, ${helperNameMap[RESOLVE_DIRECTIVE]} as _${helperNameMap[RESOLVE_DIRECTIVE]} } from "vue"`,
    )
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：同一 helper 集合开启 optimizeImports，断言先导入原名再用 const 建立下划线别名，验证模块导入优化的两段声明形式。
   */
  test('module mode preamble w/ optimizeImports: true', () => {
    const root = createRoot({
      helpers: new Set([CREATE_VNODE, RESOLVE_DIRECTIVE]),
    })
    const { code } = generate(root, { mode: 'module', optimizeImports: true })
    expect(code).toMatch(
      `import { ${helperNameMap[CREATE_VNODE]}, ${helperNameMap[RESOLVE_DIRECTIVE]} } from "vue"`,
    )
    expect(code).toMatch(
      `const _${helperNameMap[CREATE_VNODE]} = ${helperNameMap[CREATE_VNODE]}, _${helperNameMap[RESOLVE_DIRECTIVE]} = ${helperNameMap[RESOLVE_DIRECTIVE]}`,
    )
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：function 模式且不前缀标识符，断言先保存 _Vue=Vue，再从 _Vue 解构 helper，验证 with 作用域模式使用独立的全局 Vue 别名。
   */
  test('function mode preamble', () => {
    const root = createRoot({
      helpers: new Set([CREATE_VNODE, RESOLVE_DIRECTIVE]),
    })
    const { code } = generate(root, { mode: 'function' })
    expect(code).toMatch(`const _Vue = Vue`)
    expect(code).toMatch(
      `const { ${helperNameMap[CREATE_VNODE]}: _${helperNameMap[CREATE_VNODE]}, ${helperNameMap[RESOLVE_DIRECTIVE]}: _${helperNameMap[RESOLVE_DIRECTIVE]} } = _Vue`,
    )
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：function 模式开启 prefixIdentifiers，断言直接从 Vue 解构 helper 且没有 _Vue 中间别名，验证前缀模式的序言分支。
   */
  test('function mode preamble w/ prefixIdentifiers: true', () => {
    const root = createRoot({
      helpers: new Set([CREATE_VNODE, RESOLVE_DIRECTIVE]),
    })
    const { code } = generate(root, {
      mode: 'function',
      prefixIdentifiers: true,
    })
    expect(code).not.toMatch(`const _Vue = Vue`)
    expect(code).toMatch(
      `const { ${helperNameMap[CREATE_VNODE]}: _${helperNameMap[CREATE_VNODE]}, ${helperNameMap[RESOLVE_DIRECTIVE]}: _${helperNameMap[RESOLVE_DIRECTIVE]} } = Vue`,
    )
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：根账本包含四组件、两指令及三个临时变量，断言短横线转合法局部名、__self 后缀改成自组件解析参数、指令解析和 _temp0～2 声明，验证资源声明生成。
   */
  test('assets + temps', () => {
    const root = createRoot({
      components: [`Foo`, `bar-baz`, `barbaz`, `Qux__self`],
      directives: [`my_dir_0`, `my_dir_1`],
      temps: 3,
    })
    const { code } = generate(root, { mode: 'function' })
    expect(code).toMatch(
      `const _component_Foo = _${helperNameMap[RESOLVE_COMPONENT]}("Foo")\n`,
    )
    expect(code).toMatch(
      `const _component_bar_baz = _${helperNameMap[RESOLVE_COMPONENT]}("bar-baz")\n`,
    )
    expect(code).toMatch(
      `const _component_barbaz = _${helperNameMap[RESOLVE_COMPONENT]}("barbaz")\n`,
    )
    // 由 SFC 文件名推导的隐式自组件引用。
    expect(code).toMatch(
      `const _component_Qux = _${helperNameMap[RESOLVE_COMPONENT]}("Qux", true)\n`,
    )
    expect(code).toMatch(
      `const _directive_my_dir_0 = _${helperNameMap[RESOLVE_DIRECTIVE]}("my_dir_0")\n`,
    )
    expect(code).toMatch(
      `const _directive_my_dir_1 = _${helperNameMap[RESOLVE_DIRECTIVE]}("my_dir_1")\n`,
    )
    expect(code).toMatch(`let _temp0, _temp1, _temp2`)
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：根 hoists 保存 hello 表达式与 id=foo 对象，generate 后断言 _hoisted_1/_hoisted_2 按登记顺序写入序言，验证提升值采用独立声明。
   */
  test('hoists', () => {
    const root = createRoot({
      hoists: [
        createSimpleExpression(`hello`, false, locStub),
        createObjectExpression(
          [
            createObjectProperty(
              createSimpleExpression(`id`, true, locStub),
              createSimpleExpression(`foo`, true, locStub),
            ),
          ],
          locStub,
        ),
      ],
    })
    const { code } = generate(root)
    expect(code).toMatch(`const _hoisted_1 = hello`)
    expect(code).toMatch(`const _hoisted_2 = { id: "foo" }`)
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：根 temps=3，生成后断言连续声明 _temp0/_temp1/_temp2，验证临时槽数量驱动函数内变量声明。
   */
  test('temps', () => {
    const root = createRoot({
      temps: 3,
    })
    const { code } = generate(root)
    expect(code).toMatch(`let _temp0, _temp1, _temp2`)
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：根 codegenNode 是内容 hello 的 TEXT，断言 return 字符串字面量并匹配快照，验证文本节点打印时加引号。
   */
  test('static text', () => {
    const { code } = generate(
      createRoot({
        codegenNode: {
          type: NodeTypes.TEXT,
          content: 'hello',
          loc: locStub,
        },
      }),
    )
    expect(code).toMatch(`return "hello"`)
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：根是 hello 插值，断言返回 toDisplayString(hello)，验证 INTERPOLATION 的展示 helper 调用生成。
   */
  test('interpolation', () => {
    const { code } = generate(
      createRoot({
        codegenNode: createInterpolation(`hello`, locStub),
      }),
    )
    expect(code).toMatch(`return _${helperNameMap[TO_DISPLAY_STRING]}(hello)`)
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：根是 foo 注释节点，断言返回 createCommentVNode(字符串)，验证模板注释采用 VNode helper。
   */
  test('comment', () => {
    const { code } = generate(
      createRoot({
        codegenNode: {
          type: NodeTypes.COMMENT,
          content: 'foo',
          loc: locStub,
        },
      }),
    )
    expect(code).toMatch(`return _${helperNameMap[CREATE_COMMENT]}("foo")`)
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：复合表达式混合 _ctx.、foo、bar 插值及嵌套复合片段，断言按原顺序拼接并只包装插值，验证字符串/子 AST 的递归打印。
   */
  test('compound expression', () => {
    const { code } = generate(
      createRoot({
        codegenNode: createCompoundExpression([
          `_ctx.`,
          createSimpleExpression(`foo`, false, locStub),
          ` + `,
          {
            type: NodeTypes.INTERPOLATION,
            loc: locStub,
            content: createSimpleExpression(`bar`, false, locStub),
          },
          // 嵌套复合表达式。
          createCompoundExpression([` + `, `nested`]),
        ]),
      }),
    )
    expect(code).toMatch(
      `return _ctx.foo + _${helperNameMap[TO_DISPLAY_STRING]}(bar) + nested`,
    )
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：手工 IF 节点带 foo?bar:baz 的 codegenNode，断言输出对应条件表达式，验证模板结构节点转发到自身生成节点。
   */
  test('ifNode', () => {
    const { code } = generate(
      createRoot({
        codegenNode: {
          type: NodeTypes.IF,
          loc: locStub,
          branches: [],
          codegenNode: createConditionalExpression(
            createSimpleExpression('foo', false),
            createSimpleExpression('bar', false),
            createSimpleExpression('baz', false),
          ) as IfConditionalExpression,
        },
      }),
    )
    expect(code).toMatch(/return foo\s+\? bar\s+: baz/)
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：手工 FOR 的 VNodeCall 设置 isBlock 与 disableTracking=true，断言 openBlock(true)，验证生成器保留输入 AST 的追踪开关。
   */
  test('forNode', () => {
    const { code } = generate(
      createRoot({
        codegenNode: {
          type: NodeTypes.FOR,
          loc: locStub,
          source: createSimpleExpression('foo', false),
          valueAlias: undefined,
          keyAlias: undefined,
          objectIndexAlias: undefined,
          children: [],
          parseResult: {} as any,
          codegenNode: {
            type: NodeTypes.VNODE_CALL,
            tag: FRAGMENT,
            isBlock: true,
            disableTracking: true,
            props: undefined,
            children: createCallExpression(RENDER_LIST),
            patchFlag: PatchFlags.TEXT,
            dynamicProps: undefined,
            directives: undefined,
            loc: locStub,
          } as ForCodegenNode,
        },
      }),
    )
    expect(code).toMatch(`openBlock(true)`)
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：手工 FOR source 标为 CAN_STRINGIFY，VNodeCall 同时设 disableTracking=false、STABLE_FRAGMENT，断言 openBlock()，验证此 AST 的 block 参数输出；常量判定由 fixture 预先给定。
   */
  test('forNode with constant expression', () => {
    const { code } = generate(
      createRoot({
        codegenNode: {
          type: NodeTypes.FOR,
          loc: locStub,
          source: createSimpleExpression(
            '1 + 2',
            false,
            locStub,
            ConstantTypes.CAN_STRINGIFY,
          ),
          valueAlias: undefined,
          keyAlias: undefined,
          objectIndexAlias: undefined,
          children: [],
          parseResult: {} as any,
          codegenNode: {
            type: NodeTypes.VNODE_CALL,
            tag: FRAGMENT,
            isBlock: true,
            disableTracking: false,
            props: undefined,
            children: createCallExpression(RENDER_LIST),
            patchFlag: PatchFlags.STABLE_FRAGMENT,
            dynamicProps: undefined,
            directives: undefined,
            loc: locStub,
          } as ForCodegenNode,
        },
      }),
    )
    expect(code).toMatch(`openBlock()`)
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：div 含静态 id、动态 prop、复合计算 key 与 p 子节点，并带 FULL_PROPS；断言静态键/计算键的括号、非法标识符键引号及子数组格式，验证对象与 VNode 参数组合打印。
   */
  test('Element (callExpression + objectExpression + TemplateChildNode[])', () => {
    const { code } = generate(
      createRoot({
        codegenNode: createElementWithCodegen(
          // 字符串键值。
          `"div"`,
          // 对象表达式值。
          createObjectExpression(
            [
              createObjectProperty(
                createSimpleExpression(`id`, true, locStub),
                createSimpleExpression(`foo`, true, locStub),
              ),
              createObjectProperty(
                createSimpleExpression(`prop`, false, locStub),
                createSimpleExpression(`bar`, false, locStub),
              ),
              // 复合表达式作为计算属性 key。
              createObjectProperty(
                {
                  type: NodeTypes.COMPOUND_EXPRESSION,
                  loc: locStub,
                  children: [
                    `foo + `,
                    createSimpleExpression(`bar`, false, locStub),
                  ],
                },
                createSimpleExpression(`bar`, false, locStub),
              ),
            ],
            locStub,
          ),
          // 子节点数组作为返回值。
          [
            createElementWithCodegen(
              `"p"`,
              createObjectExpression(
                [
                  createObjectProperty(
                    // 非法标识符 key 必须加引号。
                    createSimpleExpression(`some-key`, true, locStub),
                    createSimpleExpression(`foo`, true, locStub),
                  ),
                ],
                locStub,
              ),
            ),
          ],
          // FULL_PROPS patchFlag 参数。
          PatchFlags.FULL_PROPS,
        ),
      }),
    )
    expect(code).toMatch(`
    return _${helperNameMap[CREATE_ELEMENT_VNODE]}("div", {
      id: "foo",
      [prop]: bar,
      [foo + bar]: bar
    }, [
      _${helperNameMap[CREATE_ELEMENT_VNODE]}("p", { "some-key": "foo" })
    ], ${genFlagText(PatchFlags.FULL_PROPS)})`)
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：数组 AST 同时含 foo 表达式与 bar(baz) 调用，断言多行 return 数组并匹配快照，验证数组子项递归生成。
   */
  test('ArrayExpression', () => {
    const { code } = generate(
      createRoot({
        codegenNode: createArrayExpression([
          createSimpleExpression(`foo`, false),
          createCallExpression(`bar`, [`baz`]),
        ]),
      }),
    )
    expect(code).toMatch(`return [
      foo,
      bar(baz)
    ]`)
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：ok?foo():(orNot?bar():baz()) 的嵌套条件 AST，断言条件链的缩进与分支顺序，验证 alternate 为条件表达式时保持右结合布局。
   */
  test('ConditionalExpression', () => {
    const { code } = generate(
      createRoot({
        codegenNode: createConditionalExpression(
          createSimpleExpression(`ok`, false),
          createCallExpression(`foo`),
          createConditionalExpression(
            createSimpleExpression(`orNot`, false),
            createCallExpression(`bar`),
            createCallExpression(`baz`),
          ),
        ),
      }),
    )
    expect(code).toMatch(
      `return ok
      ? foo()
      : orNot
        ? bar()
        : baz()`,
    )
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：缓存槽 1 保存 foo，module+前缀模式生成后断言 _cache[1] || (_cache[1]=foo)，验证普通缓存表达式的短路读取和首次赋值。
   */
  test('CacheExpression', () => {
    const { code } = generate(
      createRoot({
        cached: [],
        codegenNode: createCacheExpression(
          1,
          createSimpleExpression(`foo`, false),
        ),
      }),
      {
        mode: 'module',
        prefixIdentifiers: true,
      },
    )
    expect(code).toMatch(`_cache[1] || (_cache[1] = foo)`)
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：createCacheExpression 第三参为 true，即 needPauseTracking；断言暂停追踪、写 cacheIndex、恢复追踪并返回缓存值。标题写 isVOnce，但第四参 inVOnce 仍为 false，覆盖的是暂停追踪分支。
   */
  test('CacheExpression w/ isVOnce: true', () => {
    const { code } = generate(
      createRoot({
        cached: [],
        codegenNode: createCacheExpression(
          1,
          createSimpleExpression(`foo`, false),
          true,
        ),
      }),
      {
        mode: 'module',
        prefixIdentifiers: true,
      },
    )
    expect(code).toMatch(
      `
  _cache[1] || (
    _setBlockTracking(-1),
    (_cache[1] = foo).cacheIndex = 1,
    _setBlockTracking(1),
    _cache[1]
  )
    `.trim(),
    )
    expect(code).toMatchSnapshot()
  })

  /**
   * 场景：SSR 根输出 _push 模板字面量，静态 foo/bar 之间嵌 _renderAttr(id,foo)，快照核对插值分隔与 ssrRender 签名，验证字符串和表达式片段打印。
   */
  test('TemplateLiteral', () => {
    const { code } = generate(
      createRoot({
        codegenNode: createCallExpression(`_push`, [
          createTemplateLiteral([
            `foo`,
            createCallExpression(`_renderAttr`, ['id', 'foo']),
            `bar`,
          ]),
        ]),
      }),
      { ssr: true, mode: 'module' },
    )
    expect(code).toMatchInlineSnapshot(`
      "
      export function ssrRender(_ctx, _push, _parent, _attrs) {
        _push(\`foo\${_renderAttr(id, foo)}bar\`)
      }"
    `)
  })

  // 条件语句分组：比较单分支、else-if 链、else block 与 return 分支的打印布局。
  describe('IfStatement', () => {
    /**
     * 场景：SSR BlockStatement 只有 if(foo){ok()}，快照核对语句体与缩进，验证没有 alternate 时不生成 else。
     */
    test('if', () => {
      const { code } = generate(
        createRoot({
          codegenNode: createBlockStatement([
            createIfStatement(
              createSimpleExpression('foo', false),
              createBlockStatement([createCallExpression(`ok`)]),
            ),
          ]),
        }),
        { ssr: true, mode: 'module' },
      )
      expect(code).toMatchInlineSnapshot(`
        "
        export function ssrRender(_ctx, _push, _parent, _attrs) {
          if (foo) {
            ok()
          }
        }"
      `)
    })

    /**
     * 场景：if(foo) 调 foo，else 调 bar，快照核对两个 BlockStatement 的开闭括号，验证普通 else 语句体打印。
     */
    test('if/else', () => {
      const { code } = generate(
        createRoot({
          codegenNode: createBlockStatement([
            createIfStatement(
              createSimpleExpression('foo', false),
              createBlockStatement([createCallExpression(`foo`)]),
              createBlockStatement([createCallExpression('bar')]),
            ),
          ]),
        }),
        { ssr: true, mode: 'module' },
      )
      expect(code).toMatchInlineSnapshot(`
        "
        export function ssrRender(_ctx, _push, _parent, _attrs) {
          if (foo) {
            foo()
          } else {
            bar()
          }
        }"
      `)
    })

    /**
     * 场景：if(foo) 的 alternate 是 if(bar)，快照核对连续 else if 而非额外嵌套块，验证条件链布局。
     */
    test('if/else-if', () => {
      const { code } = generate(
        createRoot({
          codegenNode: createBlockStatement([
            createIfStatement(
              createSimpleExpression('foo', false),
              createBlockStatement([createCallExpression(`foo`)]),
              createIfStatement(
                createSimpleExpression('bar', false),
                createBlockStatement([createCallExpression(`bar`)]),
              ),
            ),
          ]),
        }),
        { ssr: true, mode: 'module' },
      )
      expect(code).toMatchInlineSnapshot(`
        "
        export function ssrRender(_ctx, _push, _parent, _attrs) {
          if (foo) {
            foo()
          } else if (bar) {
            bar()
          }
        }"
      `)
    })

    /**
     * 场景：if→else-if→else 三分支分别调用 foo/bar/baz，快照核对完整语句链，验证最终 alternate 为 BlockStatement 时输出 else。
     */
    test('if/else-if/else', () => {
      const { code } = generate(
        createRoot({
          codegenNode: createBlockStatement([
            createIfStatement(
              createSimpleExpression('foo', false),
              createBlockStatement([createCallExpression(`foo`)]),
              createIfStatement(
                createSimpleExpression('bar', false),
                createBlockStatement([createCallExpression(`bar`)]),
                createBlockStatement([createCallExpression('baz')]),
              ),
            ),
          ]),
        }),
        { ssr: true, mode: 'module' },
      )
      expect(code).toMatchInlineSnapshot(`
        "
        export function ssrRender(_ctx, _push, _parent, _attrs) {
          if (foo) {
            foo()
          } else if (bar) {
            bar()
          } else {
            baz()
          }
        }"
      `)
    })
  })

  /**
   * 场景：客户端根 AssignmentExpression 写 foo=bar，快照断言 with(_ctx) 中返回赋值表达式，验证左右 AST 与等号的打印顺序。
   */
  test('AssignmentExpression', () => {
    const { code } = generate(
      createRoot({
        codegenNode: createAssignmentExpression(
          createSimpleExpression(`foo`, false),
          createSimpleExpression(`bar`, false),
        ),
      }),
    )
    expect(code).toMatchInlineSnapshot(`
      "
      return function render(_ctx, _cache) {
        with (_ctx) {
          return foo = bar
        }
      }"
    `)
  })

  // VNode 调用分组：覆盖普通/组件、block、指令、patchFlag 和动态 props 的参数裁剪。
  describe('VNodeCall', () => {
    /** 生成单个 VNodeCall，并抽取 with 函数体中的核心表达式便于比较。 */
    function genCode(node: VNodeCall) {
      return generate(
        createRoot({
          codegenNode: node,
        }),
      ).code.match(/with \(_ctx\) \{\s+([^]+)\s+\}\s+\}$/)![1]
    }

    /** 固定 props 对象，供参数位置与属性打印断言复用。 */
    const mockProps = createObjectExpression([
      createObjectProperty(`foo`, createSimpleExpression(`bar`, true)),
    ])
    /** 只承载 children 标识符的表达式，避免混入子节点转换规则。 */
    const mockChildren = createCompoundExpression(['children'])
    /** 单项运行时指令参数 [foo, bar]，供 withDirectives 包装断言复用。 */
    const mockDirs = createArrayExpression([
      createArrayExpression([`foo`, createSimpleExpression(`bar`, false)]),
    ]) as DirectiveArguments

    /**
     * 场景：VNodeCall 只提供 div 字符串 tag 或 FRAGMENT symbol，快照断言均裁去尾部空参数并分别打印字符串/helper，验证 tag 打印及参数裁剪。
     */
    test('tag only', () => {
      expect(genCode(createVNodeCall(null, `"div"`))).toMatchInlineSnapshot(`
        "return _createElementVNode("div")
         "
      `)
      expect(genCode(createVNodeCall(null, FRAGMENT))).toMatchInlineSnapshot(`
              "return _createElementVNode(_Fragment)
               "
          `)
    })

    /**
     * 场景：div VNodeCall 带固定 foo=bar props，快照断言只保留 tag/props 两参，验证对象属性值与末尾空参数裁剪。
     */
    test('with props', () => {
      expect(genCode(createVNodeCall(null, `"div"`, mockProps)))
        .toMatchInlineSnapshot(`
          "return _createElementVNode("div", { foo: "bar" })
           "
        `)
    })

    /**
     * 场景：div 有 children 而没有 props，快照断言第二参补 null，验证位置参数不能因中间缺项左移。
     */
    test('with children, no props', () => {
      expect(genCode(createVNodeCall(null, `"div"`, undefined, mockChildren)))
        .toMatchInlineSnapshot(`
          "return _createElementVNode("div", null, children)
           "
        `)
    })

    /**
     * 场景：div 同时有固定 props 与 children，快照核对三参顺序，验证属性对象和子表达式组合。
     */
    test('with children + props', () => {
      expect(genCode(createVNodeCall(null, `"div"`, mockProps, mockChildren)))
        .toMatchInlineSnapshot(`
          "return _createElementVNode("div", { foo: "bar" }, children)
           "
        `)
    })

    /**
     * 场景：div 只有 TEXT patchFlag，快照断言 props/children 两处 null 和数字及开发期名称注释，验证第四参数位置与标记格式。
     */
    test('with patchFlag and no children/props', () => {
      expect(
        genCode(
          createVNodeCall(null, `"div"`, undefined, undefined, PatchFlags.TEXT),
        ),
      ).toMatchInlineSnapshot(`
        "return _createElementVNode("div", null, null, 1 /* TEXT */)
         "
      `)
    })

    /**
     * 场景：div 设置 isBlock=true，快照断言 openBlock 与 createElementBlock 组成序列表达式，验证普通元素 block helper 选择。
     */
    test('as block', () => {
      expect(
        genCode(
          createVNodeCall(
            null,
            `"div"`,
            mockProps,
            mockChildren,
            undefined,
            undefined,
            undefined,
            true,
          ),
        ),
      ).toMatchInlineSnapshot(`
        "return (_openBlock(), _createElementBlock("div", { foo: "bar" }, children))
         "
      `)
    })

    /**
     * 场景：block 另设 disableTracking=true，快照断言 openBlock(true)，验证列表块的追踪禁用参数。
     */
    test('as for block', () => {
      expect(
        genCode(
          createVNodeCall(
            null,
            `"div"`,
            mockProps,
            mockChildren,
            undefined,
            undefined,
            undefined,
            true,
            true,
          ),
        ),
      ).toMatchInlineSnapshot(`
        "return (_openBlock(true), _createElementBlock("div", { foo: "bar" }, children))
         "
      `)
    })

    /**
     * 场景：普通 div VNodeCall 附 foo/bar 指令参数数组，快照断言 withDirectives 包住 createElementVNode，验证指令外层包装。
     */
    test('with directives', () => {
      expect(
        genCode(
          createVNodeCall(
            null,
            `"div"`,
            mockProps,
            mockChildren,
            undefined,
            undefined,
            mockDirs,
          ),
        ),
      ).toMatchInlineSnapshot(`
        "return _withDirectives(_createElementVNode("div", { foo: "bar" }, children), [
              [foo, bar]
            ])
         "
      `)
    })

    /**
     * 场景：div 同时为 block 并带指令，快照断言 withDirectives 包住完整 openBlock/createElementBlock 序列，验证包装不会破坏 block 边界。
     */
    test('block + directives', () => {
      expect(
        genCode(
          createVNodeCall(
            null,
            `"div"`,
            mockProps,
            mockChildren,
            undefined,
            undefined,
            mockDirs,
            true,
          ),
        ),
      ).toMatchInlineSnapshot(`
        "return _withDirectives((_openBlock(), _createElementBlock("div", { foo: "bar" }, children)), [
              [foo, bar]
            ])
         "
      `)
    })
  })
})
