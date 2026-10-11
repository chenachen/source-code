/**
 * 元素转换核心场景：验证原生元素/组件 VNode 构造、props 合并、运行时指令、动态组件和
 * patchFlag 推导；回归用例重点防止 block 身份、key、ref 与动态属性信息在优化中丢失。
 */
import {
  BindingTypes,
  type CompilerOptions,
  ErrorCodes,
  type NodeTransform,
  baseCompile,
  baseParse as parse,
  transform,
  transformExpression,
} from '../../src'
import {
  BASE_TRANSITION,
  CREATE_VNODE,
  GUARD_REACTIVE_PROPS,
  KEEP_ALIVE,
  MERGE_PROPS,
  NORMALIZE_CLASS,
  NORMALIZE_PROPS,
  NORMALIZE_STYLE,
  RESOLVE_COMPONENT,
  RESOLVE_DIRECTIVE,
  RESOLVE_DYNAMIC_COMPONENT,
  SUSPENSE,
  TELEPORT,
  TO_HANDLERS,
  helperNameMap,
} from '../../src/runtimeHelpers'
import {
  type DirectiveNode,
  NodeTypes,
  type RootNode,
  type VNodeCall,
  createObjectProperty,
} from '../../src/ast'
import { transformElement } from '../../src/transforms/transformElement'
import { transformStyle } from '../../../compiler-dom/src/transforms/transformStyle'
import { transformOn } from '../../src/transforms/vOn'
import { transformBind } from '../../src/transforms/vBind'
import { PatchFlags } from '@vue/shared'
import { createObjectMatcher } from '../testUtils'
import { transformText } from '../../src/transforms/transformText'
import { parseWithForTransform } from './vFor.spec'

/**
 * 用额外 div 包裹模板，避开唯一根自动转 block；默认只装 element/text 转换。
 * options 可替换整个 nodeTransforms 列表，指令转换由各场景显式配置；返回完整根和
 * 包裹元素的第一个 child 的 VNodeCall，并断言该输入确实生成 VNodeCall。
 */
function parseWithElementTransform(
  template: string,
  options: CompilerOptions = {},
): {
  /** 包裹被测元素的完整根 AST。 */
  root: RootNode
  /** 被测首元素生成的 VNodeCall。 */
  node: VNodeCall
} {
  // 外包一层 div，避免被测模板因位于根节点而自动升级为 block。
  const ast = parse(`<div>${template}</div>`, options)
  transform(ast, {
    nodeTransforms: [transformElement, transformText],
    ...options,
  })
  const codegenNode = (ast as any).children[0].children[0]
    .codegenNode as VNodeCall
  expect(codegenNode.type).toBe(NodeTypes.VNODE_CALL)
  return {
    root: ast,
    node: codegenNode,
  }
}

/** 在元素转换基础上加入 v-bind，供 props/动态组件场景复用。 */
function parseWithBind(template: string, options?: CompilerOptions) {
  return parseWithElementTransform(template, {
    ...options,
    directiveTransforms: {
      ...options?.directiveTransforms,
      bind: transformBind,
    },
  })
}

/** 从 v-for 根结构中取得迭代器最终返回的 VNodeCall。 */
function getVForChild(
  node: ReturnType<typeof parseWithForTransform>['node'],
): VNodeCall {
  return node.codegenNode.children.arguments[1].returns as VNodeCall
}

describe('compiler: element transform', () => {
  /**
   * 将 <Foo/> 放在外层 div 内转换；helpers 登记 RESOLVE_COMPONENT、components 登记 Foo，验证未知组件在 render 顶部解析。
   */
  test('import + resolve component', () => {
    const { root } = parseWithElementTransform(`<Foo/>`)
    expect(root.helpers).toContain(RESOLVE_COMPONENT)
    expect(root.components).toContain(`Foo`)
  })

  /**
   * 以 Example.vue?vue&type=template 文件名编译 <Example/>；登记 Example__self 和解析 helper，让 codegen 可传自引用提示。
   */
  test('resolve implicitly self-referencing component', () => {
    const { root } = parseWithElementTransform(`<Example/>`, {
      filename: `/foo/bar/Example.vue?vue&type=template`,
    })
    expect(root.helpers).toContain(RESOLVE_COMPONENT)
    expect(root.components).toContain(`Example__self`)
  })

  /**
   * 为 Example 提供 SETUP_MAYBE_REF 元数据、使用非 inline 模式；tag 直接为 $setup["Example"] 且不登记 RESOLVE_COMPONENT。
   */
  test('resolve component from setup bindings', () => {
    const { root, node } = parseWithElementTransform(`<Example/>`, {
      bindingMetadata: {
        Example: BindingTypes.SETUP_MAYBE_REF,
      },
    })
    expect(root.helpers).not.toContain(RESOLVE_COMPONENT)
    expect(node.tag).toBe(`$setup["Example"]`)
  })

  /**
   * 同一 maybe-ref 组件在 inline 模式生成 _unref(Example)，由局部绑定取组件类型而不调用 resolveComponent。
   */
  test('resolve component from setup bindings (inline)', () => {
    const { root, node } = parseWithElementTransform(`<Example/>`, {
      inline: true,
      bindingMetadata: {
        Example: BindingTypes.SETUP_MAYBE_REF,
      },
    })
    expect(root.helpers).not.toContain(RESOLVE_COMPONENT)
    expect(node.tag).toBe(`_unref(Example)`)
  })

  /**
   * inline 组件 Example 标为 SETUP_CONST 时 tag 直接引用 Example，常量绑定无需 unref 和运行时名称解析。
   */
  test('resolve component from setup bindings (inline const)', () => {
    const { root, node } = parseWithElementTransform(`<Example/>`, {
      inline: true,
      bindingMetadata: {
        Example: BindingTypes.SETUP_CONST,
      },
    })
    expect(root.helpers).not.toContain(RESOLVE_COMPONENT)
    expect(node.tag).toBe(`Example`)
  })

  /**
   * 非 inline 的 <Foo.Example/> 只解析命名空间 Foo，maybe-ref 元数据生成 $setup["Foo"].Example。
   */
  test('resolve namespaced component from setup bindings', () => {
    const { root, node } = parseWithElementTransform(`<Foo.Example/>`, {
      bindingMetadata: {
        Foo: BindingTypes.SETUP_MAYBE_REF,
      },
    })
    expect(root.helpers).not.toContain(RESOLVE_COMPONENT)
    expect(node.tag).toBe(`$setup["Foo"].Example`)
  })

  /**
   * inline 的命名空间 Foo 为 maybe-ref 时先 _unref(Foo) 再访问 .Example，避免对 ref 外壳取成员。
   */
  test('resolve namespaced component from setup bindings (inline)', () => {
    const { root, node } = parseWithElementTransform(`<Foo.Example/>`, {
      inline: true,
      bindingMetadata: {
        Foo: BindingTypes.SETUP_MAYBE_REF,
      },
    })
    expect(root.helpers).not.toContain(RESOLVE_COMPONENT)
    expect(node.tag).toBe(`_unref(Foo).Example`)
  })

  /**
   * inline 的命名空间 Foo 为 SETUP_CONST 时直接生成 Foo.Example，不引入名称解析 helper。
   */
  test('resolve namespaced component from setup bindings (inline const)', () => {
    const { root, node } = parseWithElementTransform(`<Foo.Example/>`, {
      inline: true,
      bindingMetadata: {
        Foo: BindingTypes.SETUP_CONST,
      },
    })
    expect(root.helpers).not.toContain(RESOLVE_COMPONENT)
    expect(node.tag).toBe(`Foo.Example`)
  })

  /**
   * inline 的 Foo 来自 PROPS 时使用 _unref(__props["Foo"]).Example，验证 props 与 setup 绑定的访问入口不同。
   */
  test('resolve namespaced component from props bindings (inline)', () => {
    const { root, node } = parseWithElementTransform(`<Foo.Example/>`, {
      inline: true,
      bindingMetadata: {
        Foo: BindingTypes.PROPS,
      },
    })
    expect(root.helpers).not.toContain(RESOLVE_COMPONENT)
    expect(node.tag).toBe(`_unref(__props["Foo"]).Example`)
  })

  /**
   * 非 inline 的 PROPS 命名空间生成 _unref($props["Foo"]).Example，仍不登记 RESOLVE_COMPONENT。
   */
  test('resolve namespaced component from props bindings (non-inline)', () => {
    const { root, node } = parseWithElementTransform(`<Foo.Example/>`, {
      inline: false,
      bindingMetadata: {
        Foo: BindingTypes.PROPS,
      },
    })
    expect(root.helpers).not.toContain(RESOLVE_COMPONENT)
    expect(node.tag).toBe('_unref($props["Foo"]).Example')
  })

  /**
   * 将 bindingMetadata.__isScriptSetup 明确设为 false；即使 Example 标为 SETUP_MAYBE_REF，也走 RESOLVE_COMPONENT 并登记名称。
   */
  test('do not resolve component from non-script-setup bindings', () => {
    const bindingMetadata = {
      Example: BindingTypes.SETUP_MAYBE_REF,
    }
    Object.defineProperty(bindingMetadata, '__isScriptSetup', { value: false })
    const { root } = parseWithElementTransform(`<Example/>`, {
      bindingMetadata,
    })
    expect(root.helpers).toContain(RESOLVE_COMPONENT)
    expect(root.components).toContain(`Example`)
  })

  /**
   * 转换空 div 的 id/class 静态属性；生成字符串 tag 与静态对象 props，children 保持 undefined。
   */
  test('static props', () => {
    const { node } = parseWithElementTransform(`<div id="foo" class="bar" />`)
    expect(node).toMatchObject({
      tag: `"div"`,
      props: createObjectMatcher({
        id: 'foo',
        class: 'bar',
      }),
      children: undefined,
    })
  })

  /**
   * 转换带 id 的 div/span 树；退出转换先取得 span 的 VNodeCall，再将元素节点数组写入父 children。
   */
  test('props + children', () => {
    const { node } = parseWithElementTransform(`<div id="foo"><span/></div>`)

    expect(node).toMatchObject({
      tag: `"div"`,
      props: createObjectMatcher({
        id: 'foo',
      }),
      children: [
        {
          type: NodeTypes.ELEMENT,
          tag: 'span',
          codegenNode: {
            type: NodeTypes.VNODE_CALL,
            tag: `"span"`,
          },
        },
      ],
    })
  })

  /**
   * 转换没有 props 的 div/span；AST 的 props 保持 undefined、children 保留 span 数组，未在此断言生成字符串中的参数占位。
   */
  test('0 placeholder for children with no props', () => {
    const { node } = parseWithElementTransform(`<div><span/></div>`)

    expect(node).toMatchObject({
      tag: `"div"`,
      props: undefined,
      children: [
        {
          type: NodeTypes.ELEMENT,
          tag: 'span',
          codegenNode: {
            type: NodeTypes.VNODE_CALL,
            tag: `"span"`,
          },
        },
      ],
    })
  })

  /**
   * 单 v-bind="obj" 无需 mergeProps；props 生成 normalizeProps(guardReactiveProps(obj))，防止归一化直接修改响应式原对象。
   */
  test('v-bind="obj"', () => {
    const { root, node } = parseWithElementTransform(`<div v-bind="obj" />`)
    // 只有一个无参数 v-bind 时无需 mergeProps。
    expect(root.helpers).not.toContain(MERGE_PROPS)
    expect(root.helpers).toContain(NORMALIZE_PROPS)
    expect(root.helpers).toContain(GUARD_REACTIVE_PROPS)

    // props 参数是归一化调用；其最内层实参保留整体绑定表达式 obj。
    expect(node.props).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: NORMALIZE_PROPS,
      arguments: [
        {
          type: NodeTypes.JS_CALL_EXPRESSION,
          callee: GUARD_REACTIVE_PROPS,
          arguments: [
            {
              type: NodeTypes.SIMPLE_EXPRESSION,
              content: `obj`,
            },
          ],
        },
      ],
    })
  })

  /**
   * 静态 id 位于 v-bind 对象前时，mergeProps 参数依次为 id 对象和 obj，保留书写顺序的覆盖关系。
   */
  test('v-bind="obj" after static prop', () => {
    const { root, node } = parseWithElementTransform(
      `<div id="foo" v-bind="obj" />`,
    )
    expect(root.helpers).toContain(MERGE_PROPS)

    expect(node.props).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: MERGE_PROPS,
      arguments: [
        createObjectMatcher({
          id: 'foo',
        }),
        {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: `obj`,
        },
      ],
    })
  })

  /**
   * v-bind 对象位于静态 id 前时，mergeProps 参数依次为 obj 和 id 对象，让后写显式属性参与最后合并。
   */
  test('v-bind="obj" before static prop', () => {
    const { root, node } = parseWithElementTransform(
      `<div v-bind="obj" id="foo" />`,
    )
    expect(root.helpers).toContain(MERGE_PROPS)

    expect(node.props).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: MERGE_PROPS,
      arguments: [
        {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: `obj`,
        },
        createObjectMatcher({
          id: 'foo',
        }),
      ],
    })
  })

  /**
   * id、v-bind 对象、class 三段依次封口为 mergeProps 的三个参数，验证对象片段不会跨整体绑定乱序。
   */
  test('v-bind="obj" between static props', () => {
    const { root, node } = parseWithElementTransform(
      `<div id="foo" v-bind="obj" class="bar" />`,
    )
    expect(root.helpers).toContain(MERGE_PROPS)

    expect(node.props).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: MERGE_PROPS,
      arguments: [
        createObjectMatcher({
          id: 'foo',
        }),
        {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: `obj`,
        },
        createObjectMatcher({
          class: 'bar',
        }),
      ],
    })
  })

  /**
   * 原生 div 的 id/v-on 对象/class 形成三段 mergeProps；toHandlers(obj,true) 的第二参要求保留原生事件键大小写。
   */
  test('v-on="obj"', () => {
    const { root, node } = parseWithElementTransform(
      `<div id="foo" v-on="obj" class="bar" />`,
    )
    expect(root.helpers).toContain(MERGE_PROPS)

    expect(node.props).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: MERGE_PROPS,
      arguments: [
        createObjectMatcher({
          id: 'foo',
        }),
        {
          type: NodeTypes.JS_CALL_EXPRESSION,
          callee: TO_HANDLERS,
          arguments: [
            {
              type: NodeTypes.SIMPLE_EXPRESSION,
              content: `obj`,
            },
            `true`,
          ],
        },
        createObjectMatcher({
          class: 'bar',
        }),
      ],
    })
  })

  /**
   * 组件 Foo 的同一 v-on 对象只生成 toHandlers(obj)，与前后静态 props 合并，不传原生事件大小写选项。
   */
  test('v-on="obj" on component', () => {
    const { root, node } = parseWithElementTransform(
      `<Foo id="foo" v-on="obj" class="bar" />`,
    )
    expect(root.helpers).toContain(MERGE_PROPS)

    expect(node.props).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: MERGE_PROPS,
      arguments: [
        createObjectMatcher({
          id: 'foo',
        }),
        {
          type: NodeTypes.JS_CALL_EXPRESSION,
          callee: TO_HANDLERS,
          arguments: [
            {
              type: NodeTypes.SIMPLE_EXPRESSION,
              content: `obj`,
            },
          ],
        },
        createObjectMatcher({
          class: 'bar',
        }),
      ],
    })
  })

  /**
   * 静态 id 后连续 v-on="handlers" 与 v-bind="obj" 按顺序生成 id 对象、toHandlers(handlers,true)、obj 三个合并参数。
   */
  test('v-on="obj" + v-bind="obj"', () => {
    const { root, node } = parseWithElementTransform(
      `<div id="foo" v-on="handlers" v-bind="obj" />`,
    )
    expect(root.helpers).toContain(MERGE_PROPS)

    expect(node.props).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: MERGE_PROPS,
      arguments: [
        createObjectMatcher({
          id: 'foo',
        }),
        {
          type: NodeTypes.JS_CALL_EXPRESSION,
          callee: TO_HANDLERS,
          arguments: [
            {
              type: NodeTypes.SIMPLE_EXPRESSION,
              content: `handlers`,
            },
            `true`,
          ],
        },
        {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: `obj`,
        },
      ],
    })
  })

  /**
   * 没有结构指令的 <template id="foo"/> 被 parser 当作普通元素；元素转换生成字符串 template tag 与 id props。
   */
  test('should handle plain <template> as normal element', () => {
    const { node } = parseWithElementTransform(`<template id="foo" />`)

    expect(node).toMatchObject({
      tag: `"template"`,
      props: createObjectMatcher({
        id: 'foo',
      }),
    })
  })

  /**
   * 分别转换 teleport 与 Teleport 标签，二者都使用 TELEPORT helper、不登记用户组件，span 仍以普通 children 数组传递。
   */
  test('should handle <Teleport> with normal children', () => {
    /** 同时验证内置组件名的大小写写法都解析为 TELEPORT helper。 */
    function assert(tag: string) {
      const { root, node } = parseWithElementTransform(
        `<${tag} target="#foo"><span /></${tag}>`,
      )
      expect(root.components.length).toBe(0)
      expect(root.helpers).toContain(TELEPORT)

      expect(node).toMatchObject({
        tag: TELEPORT,
        props: createObjectMatcher({
          target: '#foo',
        }),
        children: [
          {
            type: NodeTypes.ELEMENT,
            tag: 'span',
            codegenNode: {
              type: NodeTypes.VNODE_CALL,
              tag: `"span"`,
            },
          },
        ],
      })
    }

    assert(`teleport`)
    assert(`Teleport`)
  })

  /**
   * 分别给 suspense 提供隐式默认内容、显式 #default、#default 加 #fallback；都用 SUSPENSE helper，slots 对象只在第三分支包含 fallback，稳定标记为 1。
   */
  test('should handle <Suspense>', () => {
    /** 按是否提供 fallback 断言 Suspense 的稳定 slots 对象。 */
    function assert(tag: string, content: string, hasFallback?: boolean) {
      const { root, node } = parseWithElementTransform(
        `<${tag}>${content}</${tag}>`,
      )
      expect(root.components.length).toBe(0)
      expect(root.helpers).toContain(SUSPENSE)

      expect(node).toMatchObject({
        tag: SUSPENSE,
        props: undefined,
        children: hasFallback
          ? createObjectMatcher({
              default: {
                type: NodeTypes.JS_FUNCTION_EXPRESSION,
              },
              fallback: {
                type: NodeTypes.JS_FUNCTION_EXPRESSION,
              },
              _: `[1 /* STABLE */]`,
            })
          : createObjectMatcher({
              default: {
                type: NodeTypes.JS_FUNCTION_EXPRESSION,
              },
              _: `[1 /* STABLE */]`,
            }),
      })
    }

    assert(`suspense`, `foo`)
    assert(`suspense`, `<template #default>foo</template>`)
    assert(
      `suspense`,
      `<template #default>foo</template><template #fallback>fallback</template>`,
      true,
    )
  })

  /**
   * 分别转换 keep-alive 与 KeepAlive 包裹 span；都使用 KEEP_ALIVE，保留原始 children，并强制 isBlock 与 DYNAMIC_SLOTS。
   */
  test('should handle <KeepAlive>', () => {
    /** 验证两种标签写法都透明保留 children，并强制 block/动态更新。 */
    function assert(tag: string) {
      const root = parse(`<div><${tag}><span /></${tag}></div>`)
      transform(root, {
        nodeTransforms: [transformElement, transformText],
      })
      expect(root.components.length).toBe(0)
      expect(root.helpers).toContain(KEEP_ALIVE)
      const node = (root.children[0] as any).children[0].codegenNode
      expect(node).toMatchObject({
        type: NodeTypes.VNODE_CALL,
        tag: KEEP_ALIVE,
        isBlock: true, // KeepAlive 必须成为 block。
        props: undefined,
        // KeepAlive 的内容保留为原始 children，不编译成普通组件 slots。
        children: [{ type: NodeTypes.ELEMENT, tag: 'span' }],
        // 动态插槽标志强制运行时更新其透明子树。
        patchFlag: PatchFlags.DYNAMIC_SLOTS,
      })
    }

    assert(`keep-alive`)
    assert(`KeepAlive`)
  })

  /**
   * base-transition 与 BaseTransition 两种标签都解析为 BASE_TRANSITION，并把 span 编成带稳定标记的默认 slot 函数。
   */
  test('should handle <BaseTransition>', () => {
    /** 验证大小写标签都解析到 BASE_TRANSITION，并把 child 编译为默认插槽。 */
    function assert(tag: string) {
      const { root, node } = parseWithElementTransform(
        `<${tag}><span /></${tag}>`,
      )
      expect(root.components.length).toBe(0)
      expect(root.helpers).toContain(BASE_TRANSITION)

      expect(node).toMatchObject({
        tag: BASE_TRANSITION,
        props: undefined,
        children: createObjectMatcher({
          default: {
            type: NodeTypes.JS_FUNCTION_EXPRESSION,
          },
          _: `[1 /* STABLE */]`,
        }),
      })
    }

    assert(`base-transition`)
    assert(`BaseTransition`)
  })

  /**
   * 给无参数且无值的 v-bind 配置返回型 onError；断言第一条诊断为 X_V_BIND_NO_EXPRESSION，验证属性构建的错误路径。
   */
  test('error on v-bind with no argument', () => {
    const onError = vi.fn()
    parseWithElementTransform(`<div v-bind/>`, { onError })
    expect(onError.mock.calls[0]).toMatchObject([
      {
        code: ErrorCodes.X_V_BIND_NO_EXPRESSION,
      },
    ])
  })

  /**
   * 自定义 foo 转换把 v-foo:bar="hello" 的 arg/exp 原节点组合为 Property；输出 PROPS 与包含 bar 的动态名单，证明扩展转换同样参与 patch 分析。
   */
  test('directiveTransforms', () => {
    let _dir: DirectiveNode
    const { node } = parseWithElementTransform(`<div v-foo:bar="hello" />`, {
      directiveTransforms: {
        /** 测试自定义指令把 arg/exp 转成普通 VNode prop。 */
        foo(dir) {
          _dir = dir
          return {
            props: [createObjectProperty(dir.arg!, dir.exp!)],
          }
        },
      },
    })

    expect(node.props).toMatchObject({
      type: NodeTypes.JS_OBJECT_EXPRESSION,
      properties: [
        {
          type: NodeTypes.JS_PROPERTY,
          key: _dir!.arg,
          value: _dir!.exp,
        },
      ],
    })
    // 自定义指令转换返回的 props 也必须参与 patchFlag 分析。
    expect(node.patchFlag).toBe(PatchFlags.PROPS)
    expect(node.dynamicProps).toMatch(`"bar"`)
  })

  /**
   * foo 转换返回 needRuntime:true 且无 props；登记 foo/RESOLVE_DIRECTIVE，以 [运行时指令,hello,bar] 构造 directives，并为节点设置 NEED_PATCH。
   */
  test('directiveTransform with needRuntime: true', () => {
    const { root, node } = parseWithElementTransform(
      `<div v-foo:bar="hello" />`,
      {
        directiveTransforms: {
          /** 声明需要按指令名解析运行时实现。 */
          foo() {
            return {
              props: [],
              needRuntime: true,
            }
          },
        },
      },
    )
    expect(root.helpers).toContain(RESOLVE_DIRECTIVE)
    expect(root.directives).toContain(`foo`)
    expect(node).toMatchObject({
      tag: `"div"`,
      props: undefined,
      children: undefined,
      patchFlag: PatchFlags.NEED_PATCH, // 运行时指令要求当前 VNode 参与 patch。
      directives: {
        type: NodeTypes.JS_ARRAY_EXPRESSION,
        elements: [
          {
            type: NodeTypes.JS_ARRAY_EXPRESSION,
            elements: [
              `_directive_foo`,
              // 指令值表达式。
              {
                type: NodeTypes.SIMPLE_EXPRESSION,
                content: `hello`,
                isStatic: false,
              },
              // 指令参数。
              {
                type: NodeTypes.SIMPLE_EXPRESSION,
                content: `bar`,
                isStatic: true,
              },
            ],
          },
        ],
      },
    })
  })

  /**
   * foo 转换以 CREATE_VNODE Symbol 作为测试运行时实现；指令参数直接引用该 helper，既不登记 foo 名称也不调用 RESOLVE_DIRECTIVE。
   */
  test('directiveTransform with needRuntime: Symbol', () => {
    const { root, node } = parseWithElementTransform(
      `<div v-foo:bar="hello" />`,
      {
        directiveTransforms: {
          /** 直接返回已知 helper Symbol，避免按用户指令名解析。 */
          foo() {
            return {
              props: [],
              needRuntime: CREATE_VNODE,
            }
          },
        },
      },
    )

    expect(root.helpers).toContain(CREATE_VNODE)
    expect(root.helpers).not.toContain(RESOLVE_DIRECTIVE)
    expect(root.directives.length).toBe(0)
    expect(node.directives!.elements[0].elements[0]).toBe(
      `_${helperNameMap[CREATE_VNODE]}`,
    )
  })

  /**
   * 同时输入无值 foo、带值 bar、动态参数和两个 modifier 的 baz；逐项核对指令登记及参数数组，baz 修饰符生成 mod/mad:true 对象。
   */
  test('runtime directives', () => {
    const { root, node } = parseWithElementTransform(
      `<div v-foo v-bar="x" v-baz:[arg].mod.mad="y" />`,
    )
    expect(root.helpers).toContain(RESOLVE_DIRECTIVE)
    expect(root.directives).toContain(`foo`)
    expect(root.directives).toContain(`bar`)
    expect(root.directives).toContain(`baz`)

    expect(node).toMatchObject({
      directives: {
        type: NodeTypes.JS_ARRAY_EXPRESSION,
        elements: [
          {
            type: NodeTypes.JS_ARRAY_EXPRESSION,
            elements: [`_directive_foo`],
          },
          {
            type: NodeTypes.JS_ARRAY_EXPRESSION,
            elements: [
              `_directive_bar`,
              // 指令值表达式。
              {
                type: NodeTypes.SIMPLE_EXPRESSION,
                content: `x`,
              },
            ],
          },
          {
            type: NodeTypes.JS_ARRAY_EXPRESSION,
            elements: [
              `_directive_baz`,
              // 指令值表达式。
              {
                type: NodeTypes.SIMPLE_EXPRESSION,
                content: `y`,
                isStatic: false,
              },
              // 指令参数。
              {
                type: NodeTypes.SIMPLE_EXPRESSION,
                content: `arg`,
                isStatic: false,
              },
              // 指令修饰符对象。
              {
                type: NodeTypes.JS_OBJECT_EXPRESSION,
                properties: [
                  {
                    type: NodeTypes.JS_PROPERTY,
                    key: {
                      type: NodeTypes.SIMPLE_EXPRESSION,
                      content: `mod`,
                      isStatic: true,
                    },
                    value: {
                      type: NodeTypes.SIMPLE_EXPRESSION,
                      content: `true`,
                      isStatic: false,
                    },
                  },
                  {
                    type: NodeTypes.JS_PROPERTY,
                    key: {
                      type: NodeTypes.SIMPLE_EXPRESSION,
                      content: `mad`,
                      isStatic: true,
                    },
                    value: {
                      type: NodeTypes.SIMPLE_EXPRESSION,
                      content: `true`,
                      isStatic: false,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    })
  })

  /**
   * 两个带不同修饰符的 @click 经 core transformOn 得到同名 onClick；dedupeProperties 把 a/b 处理器按顺序合为数组。
   */
  test(`props merging: event handlers`, () => {
    const { node } = parseWithElementTransform(
      `<div @click.foo="a" @click.bar="b" />`,
      {
        directiveTransforms: {
          on: transformOn,
        },
      },
    )
    expect(node.props).toMatchObject({
      type: NodeTypes.JS_OBJECT_EXPRESSION,
      properties: [
        {
          type: NodeTypes.JS_PROPERTY,
          key: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `onClick`,
            isStatic: true,
          },
          value: {
            type: NodeTypes.JS_ARRAY_EXPRESSION,
            elements: [
              {
                type: NodeTypes.SIMPLE_EXPRESSION,
                content: `a`,
                isStatic: false,
              },
              {
                type: NodeTypes.SIMPLE_EXPRESSION,
                content: `b`,
                isStatic: false,
              },
            ],
          },
        },
      ],
    })
  })

  /**
   * 静态 style 与对象 :style 经 DOM transformStyle 和 bind 转换后合成数组，再由 normalizeStyle 包装，核对两项实际值。
   */
  test(`props merging: style`, () => {
    const { node, root } = parseWithElementTransform(
      `<div style="color: green" :style="{ color: 'red' }" />`,
      {
        nodeTransforms: [transformStyle, transformElement],
        directiveTransforms: {
          bind: transformBind,
        },
      },
    )
    expect(root.helpers).toContain(NORMALIZE_STYLE)
    expect(node.props).toMatchObject({
      type: NodeTypes.JS_OBJECT_EXPRESSION,
      properties: [
        {
          type: NodeTypes.JS_PROPERTY,
          key: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `style`,
            isStatic: true,
          },
          value: {
            type: NodeTypes.JS_CALL_EXPRESSION,
            callee: NORMALIZE_STYLE,
            arguments: [
              {
                type: NodeTypes.JS_ARRAY_EXPRESSION,
                elements: [
                  {
                    type: NodeTypes.SIMPLE_EXPRESSION,
                    content: `{"color":"green"}`,
                    isStatic: false,
                  },
                  {
                    type: NodeTypes.SIMPLE_EXPRESSION,
                    content: `{ color: 'red' }`,
                    isStatic: false,
                  },
                ],
              },
            ],
          },
        },
      ],
    })
  })

  /**
   * 为相同 style 合并场景加入 expression 转换和 prefixIdentifiers；静态对象表达式仍必须经 normalizeStyle 归一化。
   */
  test(`props merging: style w/ transformExpression`, () => {
    const { node, root } = parseWithElementTransform(
      `<div style="color: green" :style="{ color: 'red' }" />`,
      {
        nodeTransforms: [transformExpression, transformStyle, transformElement],
        directiveTransforms: {
          bind: transformBind,
        },
        prefixIdentifiers: true,
      },
    )
    expect(root.helpers).toContain(NORMALIZE_STYLE)
    expect(node.props).toMatchObject({
      type: NodeTypes.JS_OBJECT_EXPRESSION,
      properties: [
        {
          type: NodeTypes.JS_PROPERTY,
          key: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `style`,
            isStatic: true,
          },
          value: {
            type: NodeTypes.JS_CALL_EXPRESSION,
            callee: NORMALIZE_STYLE,
          },
        },
      ],
    })
  })

  /**
   * prefixIdentifiers 模式的 :style 数组字面量 [{color:"red"}] 即使内容常量，也由 normalizeStyle 包装数组输入。
   */
  test(':style with array literal', () => {
    const { node, root } = parseWithElementTransform(
      `<div :style="[{ color: 'red' }]" />`,
      {
        nodeTransforms: [transformExpression, transformStyle, transformElement],
        directiveTransforms: {
          bind: transformBind,
        },
        prefixIdentifiers: true,
      },
    )
    expect(root.helpers).toContain(NORMALIZE_STYLE)
    expect(node.props).toMatchObject({
      type: NodeTypes.JS_OBJECT_EXPRESSION,
      properties: [
        {
          type: NodeTypes.JS_PROPERTY,
          key: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `style`,
            isStatic: true,
          },
          value: {
            type: NodeTypes.JS_CALL_EXPRESSION,
            callee: NORMALIZE_STYLE,
          },
        },
      ],
    })
  })

  /**
   * 静态 class="foo" 与动态 class 对象合成有序数组，并由 normalizeClass 包装，使二者共同形成最终 class。
   */
  test(`props merging: class`, () => {
    const { node, root } = parseWithElementTransform(
      `<div class="foo" :class="{ bar: isBar }" />`,
      {
        directiveTransforms: {
          bind: transformBind,
        },
      },
    )
    expect(root.helpers).toContain(NORMALIZE_CLASS)
    expect(node.props).toMatchObject({
      type: NodeTypes.JS_OBJECT_EXPRESSION,
      properties: [
        {
          type: NodeTypes.JS_PROPERTY,
          key: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `class`,
            isStatic: true,
          },
          value: {
            type: NodeTypes.JS_CALL_EXPRESSION,
            callee: NORMALIZE_CLASS,
            arguments: [
              {
                type: NodeTypes.JS_ARRAY_EXPRESSION,
                elements: [
                  {
                    type: NodeTypes.SIMPLE_EXPRESSION,
                    content: `foo`,
                    isStatic: true,
                  },
                  {
                    type: NodeTypes.SIMPLE_EXPRESSION,
                    content: `{ bar: isBar }`,
                    isStatic: false,
                  },
                ],
              },
            ],
          },
        },
      ],
    })
  })

  // patchFlag 分组：按 class/style/props/text/ref/指令组合验证最小运行时 diff 范围。
  describe('patchFlag analysis', () => {
    /**
     * 分别转换纯 foo 文本、单插值 foo、文本加插值 bar；纯文本无标志，后两者均为 TEXT，第三分支依靠 transformText 合并文本。
     */
    test('TEXT', () => {
      const { node } = parseWithBind(`<div>foo</div>`)
      expect(node.patchFlag).toBeUndefined()

      const { node: node2 } = parseWithBind(`<div>{{ foo }}</div>`)
      expect(node2.patchFlag).toBe(PatchFlags.TEXT)

      // 多个文本类节点经文本优化合并。
      const { node: node3 } = parseWithBind(`<div>foo {{ bar }} baz</div>`)
      expect(node3.patchFlag).toBe(PatchFlags.TEXT)
    })

    /**
     * 原生 div 的 :class="foo" 单独设置 CLASS，使用 class 专用更新路径。
     */
    test('CLASS', () => {
      const { node } = parseWithBind(`<div :class="foo" />`)
      expect(node.patchFlag).toBe(PatchFlags.CLASS)
    })

    /**
     * 原生 div 的 :style="foo" 单独设置 STYLE，使用 style 专用更新路径。
     */
    test('STYLE', () => {
      const { node } = parseWithBind(`<div :style="foo" />`)
      expect(node.patchFlag).toBe(PatchFlags.STYLE)
    })

    /**
     * 静态 id 加 :foo/:baz 只设置 PROPS，并按首次出现顺序输出 ["foo","baz"] 动态名单。
     */
    test('PROPS', () => {
      const { node } = parseWithBind(`<div id="foo" :foo="bar" :baz="qux" />`)
      expect(node.patchFlag).toBe(PatchFlags.PROPS)
      expect(node.dynamicProps).toBe(`["foo", "baz"]`)
    })

    /**
     * 同时绑定 class/style/foo/baz 时按位组合 CLASS|STYLE|PROPS；动态名单只含普通 foo/baz。
     */
    test('CLASS + STYLE + PROPS', () => {
      const { node } = parseWithBind(
        `<div id="foo" :class="cls" :style="styl" :foo="bar" :baz="qux"/>`,
      )
      expect(node.patchFlag).toBe(
        PatchFlags.CLASS | PatchFlags.STYLE | PatchFlags.PROPS,
      )
      expect(node.dynamicProps).toBe(`["foo", "baz"]`)
    })

    // 组件的 class/style 按普通动态 PROPS 处理。
    /**
     * 组件 Foo 的动态 id/class/style 都作为普通组件 props，只设置 PROPS，名单依次为 id/class/style。
     */
    test('PROPS on component', () => {
      const { node } = parseWithBind(
        `<Foo :id="foo" :class="cls" :style="styl" />`,
      )
      expect(node.patchFlag).toBe(PatchFlags.PROPS)
      expect(node.dynamicProps).toBe(`["id", "class", "style"]`)
    })

    /**
     * 无参数 v-bind="foo" 的键集合无法静态枚举，因此使用 FULL_PROPS。
     */
    test('FULL_PROPS (v-bind)', () => {
      const { node } = parseWithBind(`<div v-bind="foo" />`)
      expect(node.patchFlag).toBe(PatchFlags.FULL_PROPS)
    })

    /**
     * 动态参数 :[foo]="bar" 的实际键未知，设置 FULL_PROPS 而不生成精确名单。
     */
    test('FULL_PROPS (dynamic key)', () => {
      const { node } = parseWithBind(`<div :[foo]="bar" />`)
      expect(node.patchFlag).toBe(PatchFlags.FULL_PROPS)
    })

    /**
     * 静态 id、整体 v-bind 和动态 class 共存时 FULL_PROPS 覆盖具名快速路径，不叠加 CLASS。
     */
    test('FULL_PROPS (w/ others)', () => {
      const { node } = parseWithBind(
        `<div id="foo" v-bind="bar" :class="cls" />`,
      )
      expect(node.patchFlag).toBe(PatchFlags.FULL_PROPS)
    })

    /**
     * 静态 ref="foo" 即使没有动态属性仍设置 NEED_PATCH，让运行时执行 ref 更新。
     */
    test('NEED_PATCH (static ref)', () => {
      const { node } = parseWithBind(`<div ref="foo" />`)
      expect(node.patchFlag).toBe(PatchFlags.NEED_PATCH)
    })

    /**
     * 动态 :ref="foo" 不进入普通 PROPS 名单，以 NEED_PATCH 保证 ref 生命周期处理。
     */
    test('NEED_PATCH (dynamic ref)', () => {
      const { node } = parseWithBind(`<div :ref="foo" />`)
      expect(node.patchFlag).toBe(PatchFlags.NEED_PATCH)
    })

    /**
     * 只有未注册的 v-foo 运行时指令时设置 NEED_PATCH，确保指令钩子随 VNode 更新执行。
     */
    test('NEED_PATCH (custom directives)', () => {
      const { node } = parseWithBind(`<div v-foo />`)
      expect(node.patchFlag).toBe(PatchFlags.NEED_PATCH)
    })

    /**
     * 完整编译 @vue:updated 配合 cacheHandlers；事件处理器虽已缓存，VNode hook 仍要求 NEED_PATCH。
     */
    test('NEED_PATCH (vnode hooks)', () => {
      const root = baseCompile(`<div @vue:updated="foo" />`, {
        prefixIdentifiers: true,
        cacheHandlers: true,
      }).ast
      const node = (root as any).children[0].codegenNode
      expect(node.patchFlag).toBe(PatchFlags.NEED_PATCH)
    })

    /**
     * prefixIdentifiers 下常量范围 v-for="i in 3" 带静态 ref；稳定循环 child 降为普通 VNode，但保留 NEED_PATCH。
     */
    test('NEED_PATCH (stable v-for + static ref)', () => {
      const { node } = parseWithForTransform(
        `<div v-for="i in 3" :key="i" ref="foo" />`,
        { prefixIdentifiers: true },
      )
      const child = getVForChild(node)
      expect(child.isBlock).toBe(false)
      expect(child.patchFlag).toBe(PatchFlags.NEED_PATCH)
    })

    /**
     * 稳定数字循环带无 children 的自定义指令；child 无需 block，仍用 NEED_PATCH 执行指令更新。
     */
    test('NEED_PATCH (stable v-for + custom directives)', () => {
      const { node } = parseWithForTransform(
        `<div v-for="i in 3" :key="i" v-dir />`,
        { prefixIdentifiers: true },
      )
      const child = getVForChild(node)
      expect(child.isBlock).toBe(false)
      expect(child.patchFlag).toBe(PatchFlags.NEED_PATCH)
    })

    /**
     * 稳定循环的 @vue:unmounted 处理器已缓存；child 不是 block，仍保留 NEED_PATCH 追踪生命周期 hook。
     */
    test('NEED_PATCH (stable v-for + vnode hooks)', () => {
      const { node } = parseWithForTransform(
        `<div v-for="i in 3" :key="i" @vue:unmounted="foo" />`,
        {
          prefixIdentifiers: true,
          cacheHandlers: true,
          directiveTransforms: {
            bind: transformBind,
            on: transformOn,
          },
        },
      )
      const child = getVForChild(node)
      expect(child.isBlock).toBe(false)
      expect(child.patchFlag).toBe(PatchFlags.NEED_PATCH)
    })

    /**
     * 稳定循环的 :ref 引用 SETUP_CONST 函数；常量值免去普通动态 props 更新，但 ref 本身仍要求 NEED_PATCH。
     */
    test('NEED_PATCH (stable v-for + setup-const function ref)', () => {
      const { node } = parseWithForTransform(
        `<div v-for="i in 3" :key="i" :ref="setRefFn" />`,
        {
          prefixIdentifiers: true,
          bindingMetadata: {
            setRefFn: BindingTypes.SETUP_CONST,
          },
        },
      )
      const child = getVForChild(node)
      expect(child.isBlock).toBe(false)
      expect(child.patchFlag).toBe(PatchFlags.NEED_PATCH)
    })

    /**
     * 稳定数字循环的 v-dir 带插值 child；自定义指令可能有 beforeUpdate，因此保留 child block，并使用 TEXT 追踪文本。
     */
    test('preserve block for stable v-for + custom directive with children', () => {
      const { node } = parseWithForTransform(
        `<div v-for="i in 3" v-dir>{{ i }}</div>`,
        { prefixIdentifiers: true },
      )
      const child = getVForChild(node)
      expect(child.isBlock).toBe(true)
      expect(child.patchFlag).toBe(PatchFlags.TEXT)
    })

    /**
     * 参数化输入 before-update 与 beforeUpdate，两者经 camelize 都命中 vue:beforeUpdate；稳定循环仍保留带 span 的 child block，缓存 handler 后无需 patchFlag。
     */
    test.each(['before-update', 'beforeUpdate'])(
      'preserve block for stable v-for + @vue:%s vnode hook',
      hook => {
        const { node } = parseWithForTransform(
          `<div v-for="i in 3" @vue:${hook}="foo"><span /></div>`,
          {
            prefixIdentifiers: true,
            cacheHandlers: true,
            directiveTransforms: {
              bind: transformBind,
              on: transformOn,
            },
          },
        )
        const child = getVForChild(node)
        expect(child.isBlock).toBe(true)
        expect(child.patchFlag).toBeUndefined()
      },
    )

    /**
     * 稳定循环同时有缓存的 unmounted hook 和插值；TEXT 已追踪该 child，故不再添加 NEED_PATCH，child 可降为普通 VNode。
     */
    test('does not add NEED_PATCH when another patch flag tracks the vnode', () => {
      const { node } = parseWithForTransform(
        `<div v-for="i in 3" :key="i" @vue:unmounted="foo">{{ i }}</div>`,
        {
          prefixIdentifiers: true,
          cacheHandlers: true,
          directiveTransforms: {
            bind: transformBind,
            on: transformOn,
          },
        },
      )
      const child = getVForChild(node)
      expect(child.isBlock).toBe(false)
      expect(child.patchFlag).toBe(PatchFlags.TEXT)
    })

    /**
     * inline 模式的静态 ref="input" 命中 SETUP_REF 元数据；输出静态 ref_key="input" 及动态 ref:input，传入真实局部 ref。
     */
    test('script setup inline mode template ref (binding exists)', () => {
      const { node } = parseWithElementTransform(`<input ref="input"/>`, {
        inline: true,
        bindingMetadata: {
          input: BindingTypes.SETUP_REF,
        },
      })
      expect(node.props).toMatchObject({
        type: NodeTypes.JS_OBJECT_EXPRESSION,
        properties: [
          {
            type: NodeTypes.JS_PROPERTY,
            key: {
              content: 'ref_key',
              isStatic: true,
            },
            value: {
              content: 'input',
              isStatic: true,
            },
          },
          {
            type: NodeTypes.JS_PROPERTY,
            key: {
              content: 'ref',
              isStatic: true,
            },
            value: {
              content: 'input',
              isStatic: false,
            },
          },
        ],
      })
    })

    /**
     * inline 模式没有 input 绑定时，ref="input" 保持字符串属性，不补 ref_key。
     */
    test('script setup inline mode template ref (binding does not exist)', () => {
      const { node } = parseWithElementTransform(`<input ref="input"/>`, {
        inline: true,
      })
      expect(node.props).toMatchObject({
        type: NodeTypes.JS_OBJECT_EXPRESSION,
        properties: [
          {
            type: NodeTypes.JS_PROPERTY,
            key: {
              content: 'ref',
              isStatic: true,
            },
            value: {
              content: 'input',
              isStatic: true,
            },
          },
        ],
      })
    })

    /**
     * inline 模式只有同名 msg props 和名为 ref 的 setup 常量；ref="msg" 仍是字符串，不能把 props 名误认成局部 ref 变量。
     */
    test('script setup inline mode template ref (binding does not exist but props with the same name exist)', () => {
      const { node } = parseWithElementTransform(`<input ref="msg"/>`, {
        inline: true,
        bindingMetadata: {
          msg: BindingTypes.PROPS,
          ref: BindingTypes.SETUP_CONST,
        },
      })
      expect(node.props).toMatchObject({
        type: NodeTypes.JS_OBJECT_EXPRESSION,
        properties: [
          {
            type: NodeTypes.JS_PROPERTY,
            key: {
              content: 'ref',
              isStatic: true,
            },
            value: {
              content: 'msg',
              isStatic: true,
            },
          },
        ],
      })
    })

    /**
     * 对照 @click 与 @keyup：click 仅有 PROPS，keyup 加 NEED_HYDRATION，核对 click 的专用 hydration 路径。
     */
    test('NEED_HYDRATION for v-on', () => {
      // click 事件有专用 hydration 快速路径，不计入普通事件标志。
      const { node } = parseWithElementTransform(`<div @click="foo" />`, {
        directiveTransforms: {
          on: transformOn,
        },
      })
      // 最终只需 PROPS 标志。
      expect(node.patchFlag).toBe(PatchFlags.PROPS)

      const { node: node2 } = parseWithElementTransform(
        `<div @keyup="foo" />`,
        {
          directiveTransforms: {
            on: transformOn,
          },
        },
      )
      expect(node2.patchFlag).toBe(PatchFlags.PROPS | PatchFlags.NEED_HYDRATION)
    })

    /**
     * 显式 v-bind:id.prop 与点号 .id 简写都设置 PROPS|NEED_HYDRATION，DOM property 在 hydration 时需写入。
     */
    test('NEED_HYDRATION for v-bind.prop', () => {
      const { node } = parseWithBind(`<div v-bind:id.prop="id" />`)
      expect(node.patchFlag).toBe(PatchFlags.PROPS | PatchFlags.NEED_HYDRATION)

      const { node: node2 } = parseWithBind(`<div .id="id" />`)
      expect(node2.patchFlag).toBe(PatchFlags.PROPS | PatchFlags.NEED_HYDRATION)
    })

    // #5870：动态组件也可能解析为原生元素，因此 @input 必须保留事件 hydration 标志。
    /**
     * 动态 component :is="foo" 的 @input 设置 PROPS|NEED_HYDRATION，因为运行时也可能解析为原生元素；本输入没有自定义运行时指令。
     */
    test('NEED_HYDRATION on dynamic component', () => {
      const { node } = parseWithElementTransform(
        `<component :is="foo" @input="foo" />`,
        {
          directiveTransforms: {
            on: transformOn,
          },
        },
      )
      expect(node.patchFlag).toBe(PatchFlags.PROPS | PatchFlags.NEED_HYDRATION)
    })

    /**
     * @keydown 的 foo 标为 SETUP_CONST 后不需 PROPS，仅保留 NEED_HYDRATION 来安装真实 DOM 事件。
     */
    test('should not have PROPS patchflag for constant v-on handlers', () => {
      const { node } = parseWithElementTransform(`<div @keydown="foo" />`, {
        prefixIdentifiers: true,
        bindingMetadata: {
          foo: BindingTypes.SETUP_CONST,
        },
        directiveTransforms: {
          on: transformOn,
        },
      })
      // 最终只需 NEED_HYDRATION 标志。
      expect(node.patchFlag).toBe(PatchFlags.NEED_HYDRATION)
    })
  })

  // 动态组件分组：覆盖 `<component :is>`、`is="vue:*"` 兼容语法及运行时解析 helper。
  describe('dynamic component', () => {
    /**
     * 静态 is="foo" 的 component 生成 resolveDynamicComponent("foo") 并强制 block，is 参数本身为静态表达式。
     */
    test('static binding', () => {
      const { node, root } = parseWithBind(`<component is="foo" />`)
      expect(root.helpers).toContain(RESOLVE_DYNAMIC_COMPONENT)
      expect(node).toMatchObject({
        isBlock: true,
        tag: {
          callee: RESOLVE_DYNAMIC_COMPONENT,
          arguments: [
            {
              type: NodeTypes.SIMPLE_EXPRESSION,
              content: 'foo',
              isStatic: true,
            },
          ],
        },
      })
    })

    /**
     * 大写 Component 容器与小写 component 等价；静态 is 值进入 resolveDynamicComponent 参数并保持 block。
     */
    test('capitalized version w/ static binding', () => {
      const { node, root } = parseWithBind(`<Component is="foo" />`)
      expect(root.helpers).toContain(RESOLVE_DYNAMIC_COMPONENT)
      expect(node).toMatchObject({
        isBlock: true,
        tag: {
          callee: RESOLVE_DYNAMIC_COMPONENT,
          arguments: [
            {
              type: NodeTypes.SIMPLE_EXPRESSION,
              content: 'foo',
              isStatic: true,
            },
          ],
        },
      })
    })

    /**
     * 动态 :is="foo" 生成 resolveDynamicComponent(foo)，参数为非静态表达式，VNode 必须是 block。
     */
    test('dynamic binding', () => {
      const { node, root } = parseWithBind(`<component :is="foo" />`)
      expect(root.helpers).toContain(RESOLVE_DYNAMIC_COMPONENT)
      expect(node).toMatchObject({
        isBlock: true,
        tag: {
          callee: RESOLVE_DYNAMIC_COMPONENT,
          arguments: [
            {
              type: NodeTypes.SIMPLE_EXPRESSION,
              content: 'foo',
              isStatic: false,
            },
          ],
        },
      })
    })

    /**
     * 同名简写 <component :is/> 补建非静态 is 表达式，而非把 component 当作未知静态组件解析。
     */
    test('dynamic binding shorthand', () => {
      const { node, root } = parseWithBind(`<component :is />`)
      expect(root.helpers).toContain(RESOLVE_DYNAMIC_COMPONENT)
      expect(node).toMatchObject({
        isBlock: true,
        tag: {
          callee: RESOLVE_DYNAMIC_COMPONENT,
          arguments: [
            {
              type: NodeTypes.SIMPLE_EXPRESSION,
              content: 'is',
              isStatic: false,
            },
          ],
        },
      })
    })

    /**
     * 原生 div 的 is="vue:foo" 将标签类型转换为组件 foo；生成 _component_foo 并登记 RESOLVE_COMPONENT。
     */
    test('is casting', () => {
      const { node, root } = parseWithBind(`<div is="vue:foo" />`)
      expect(root.helpers).toContain(RESOLVE_COMPONENT)
      expect(node).toMatchObject({
        type: NodeTypes.VNODE_CALL,
        tag: '_component_foo',
      })
    })

    // #3934：普通组件上的静态 `is` 只是 prop，不能误当成动态组件并调用 resolveDynamicComponent。
    /**
     * 将 custom-input 判为组件后，其普通 is="foo" 不触发 resolveDynamicComponent，仍按自定义组件名解析。
     */
    test('normal component with is prop', () => {
      const { node, root } = parseWithBind(`<custom-input is="foo" />`, {
        isNativeTag: () => false,
      })
      expect(root.helpers).toContain(RESOLVE_COMPONENT)
      expect(root.helpers).not.toContain(RESOLVE_DYNAMIC_COMPONENT)
      expect(node).toMatchObject({
        tag: '_component_custom_input',
      })
    })
  })

  /**
   * 在 div 内转换 svg 而不启用静态缓存；svg VNode 强制 isBlock=true，维护命名空间相关更新边界。
   */
  test('<svg> should be forced into blocks', () => {
    const ast = parse(`<div><svg/></div>`)
    transform(ast, {
      nodeTransforms: [transformElement],
    })
    expect((ast as any).children[0].children[0].codegenNode).toMatchObject({
      type: NodeTypes.VNODE_CALL,
      tag: `"svg"`,
      isBlock: true,
    })
  })

  /**
   * 同样在 div 内转换 math；math VNode 强制 isBlock=true，覆盖 MathML 命名空间分支。
   */
  test('<math> should be forced into blocks', () => {
    const ast = parse(`<div><math/></div>`)
    transform(ast, {
      nodeTransforms: [transformElement],
    })
    expect((ast as any).children[0].children[0].codegenNode).toMatchObject({
      type: NodeTypes.VNODE_CALL,
      tag: `"math"`,
      isBlock: true,
    })
  })

  /**
   * 自定义运行时 v-foo 带 hello child 时强制 block，使 beforeUpdate 钩子先于 children patch。
   */
  test('force block for runtime custom directive w/ children', () => {
    const { node } = parseWithElementTransform(`<div v-foo>hello</div>`)
    expect(node.isBlock).toBe(true)
  })

  /**
   * 即使此测试没有注册 transformOn、@vue:before-update 没有值，buildProps 仍依据 hook 名和 children 强制 block。
   */
  test('force block for inline before-update handlers w/ children', () => {
    expect(
      parseWithElementTransform(`<div @vue:before-update>hello</div>`).node
        .isBlock,
    ).toBe(true)
  })

  // #938：带动态 key 的元素必须成为 block，key 变化时才能正确销毁并重建整棵子树。
  /**
   * 仅安装 transformElement 的动态 :key="foo" 元素也会强制 block；该身份由原始指令语义决定，无需等 bind 产出 props。
   */
  test('element with dynamic keys should be forced into blocks', () => {
    const ast = parse(`<div><div :key="foo" /></div>`)
    transform(ast, {
      nodeTransforms: [transformElement],
    })
    expect((ast as any).children[0].children[0].codegenNode).toMatchObject({
      type: NodeTypes.VNODE_CALL,
      tag: `"div"`,
      isBlock: true,
    })
  })

  /**
   * 后置自定义 NodeTransform 把 id="foo" 的 div 替换为 span；element 退出回调重读 context.currentNode，生成 span 的普通 VNodeCall。
   */
  test('should process node when node has been replaced', () => {
    /** 用 NodeTransform 替换当前节点，验证后续转换读取的是新节点。 */
    const customNodeTransform: NodeTransform = (node, context) => {
      if (
        node.type === NodeTypes.ELEMENT &&
        node.tag === 'div' &&
        node.props.some(
          prop =>
            prop.type === NodeTypes.ATTRIBUTE &&
            prop.name === 'id' &&
            prop.value &&
            prop.value.content === 'foo',
        )
      ) {
        context.replaceNode({
          ...node,
          tag: 'span',
        })
      }
    }
    const ast = parse(`<div><div id="foo" /></div>`)
    transform(ast, {
      nodeTransforms: [transformElement, transformText, customNodeTransform],
    })
    expect((ast as any).children[0].children[0].codegenNode).toMatchObject({
      type: NodeTypes.VNODE_CALL,
      tag: '"span"',
      isBlock: false,
    })
  })

  /**
   * v-for 内的静态 ref="x" 生成 ref_for:true 和字符串 ref:x，标记运行时 ref 收集为数组。
   */
  test('ref_for marker on static ref', () => {
    const { node } = parseWithForTransform(`<div v-for="i in l" ref="x"/>`)
    expect((node.children[0] as any).codegenNode.props).toMatchObject(
      createObjectMatcher({
        ref_for: `[true]`,
        ref: 'x',
      }),
    )
  })

  /**
   * v-for 内动态 :ref="x" 生成 ref_for:true 与非静态 x 引用，验证动态 ref 同样保留循环标记。
   */
  test('ref_for marker on dynamic ref', () => {
    const { node } = parseWithForTransform(`<div v-for="i in l" :ref="x"/>`)
    expect((node.children[0] as any).codegenNode.props).toMatchObject(
      createObjectMatcher({
        ref_for: `[true]`,
        ref: '[x]',
      }),
    )
  })

  /**
   * v-for 内整体 v-bind="x" 先放入 {ref_for:true} 再与 x 合并，即使 ref 藏在对象里也可按循环语义收集。
   */
  test('ref_for marker on v-bind', () => {
    const { node } = parseWithForTransform(`<div v-for="i in l" v-bind="x" />`)
    expect((node.children[0] as any).codegenNode.props).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: MERGE_PROPS,
      arguments: [
        createObjectMatcher({
          ref_for: `[true]`,
        }),
        {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: 'x',
          isStatic: false,
        },
      ],
    })
  })
})
