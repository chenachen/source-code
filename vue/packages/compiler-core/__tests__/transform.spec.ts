/**
 * 通用 AST 遍历场景：验证遍历上下文、节点替换/删除、helper 登记、
 * 静态提升与根 codegenNode 选择，重点保证原地改树后遍历游标仍然正确。
 */
import { baseParse } from '../src/parser'
import { type NodeTransform, transform } from '../src/transform'
import {
  type DirectiveNode,
  type ElementNode,
  type ExpressionNode,
  NodeTypes,
  type VNodeCall,
} from '../src/ast'
import { ErrorCodes, createCompilerError } from '../src/errors'
import {
  CREATE_COMMENT,
  FRAGMENT,
  RENDER_SLOT,
  TO_DISPLAY_STRING,
} from '../src/runtimeHelpers'
import { transformIf } from '../src/transforms/vIf'
import { transformFor } from '../src/transforms/vFor'
import { transformElement } from '../src/transforms/transformElement'
import { transformSlotOutlet } from '../src/transforms/transformSlotOutlet'
import { transformText } from '../src/transforms/transformText'
import { PatchFlags } from '@vue/shared'

describe('compiler: transform', () => {
  /**
   * 转换含静态文本和插值的 div，插件每次浅拷贝 context；检查 root/div/两个 child 的进入顺序及 parent/currentNode。上下文是同次遍历共享的可变游标，保存引用不足以记录当时状态。
   */
  test('context state', () => {
    const ast = baseParse(`<div>hello {{ world }}</div>`)

    // context 是跨调用复用的可变对象，因此每次进入节点时手动浅拷贝快照。
    const calls: any[] = []
    /** 记录每次节点转换收到的节点与当时上下文。 */
    const plugin: NodeTransform = (node, context) => {
      calls.push([node, { ...context }])
    }

    transform(ast, {
      nodeTransforms: [plugin],
    })

    const div = ast.children[0] as ElementNode
    expect(calls.length).toBe(4)
    expect(calls[0]).toMatchObject([
      ast,
      {
        parent: null,
        currentNode: ast,
      },
    ])
    expect(calls[1]).toMatchObject([
      div,
      {
        parent: ast,
        currentNode: div,
      },
    ])
    expect(calls[2]).toMatchObject([
      div.children[0],
      {
        parent: div,
        currentNode: div.children[0],
      },
    ])
    expect(calls[3]).toMatchObject([
      div.children[1],
      {
        parent: div,
        currentNode: div.children[1],
      },
    ])
  })

  /**
   * 插件把 div 替换为含 hello 的 p；检查根仍有两项，并继续访问新文本 child 和后继 span。replaceNode 同步 children/currentNode，后续遍历使用新子树。
   */
  test('context.replaceNode', () => {
    const ast = baseParse(`<div/><span/>`)
    /** 把 div 替换为带文本 child 的 p，验证替换后继续遍历新子树。 */
    const plugin: NodeTransform = (node, context) => {
      if (node.type === NodeTypes.ELEMENT && node.tag === 'div') {
        // 把当前节点替换成 `<p>`。
        context.replaceNode(
          Object.assign({}, node, {
            tag: 'p',
            children: [
              {
                type: NodeTypes.TEXT,
                content: 'hello',
                isEmpty: false,
              },
            ],
          }),
        )
      }
    }
    const spy = vi.fn(plugin)
    transform(ast, {
      nodeTransforms: [spy],
    })

    expect(ast.children.length).toBe(2)
    const newElement = ast.children[0] as ElementNode
    expect(newElement.tag).toBe('p')
    expect(spy).toHaveBeenCalledTimes(4)
    // 应继续遍历替换后节点的新 children。
    expect(spy.mock.calls[2][0]).toBe(newElement.children[0])
    // 替换节点之后的兄弟节点也不能被跳过。
    expect(spy.mock.calls[3][0]).toBe(ast.children[1])
  })

  /**
   * 遇到含 hello 的 div 时删除当前节点；检查两侧 span 保留，插件不访问被删除的文本 child，游标回退保证后继 span 仍进入转换。
   */
  test('context.removeNode', () => {
    const ast = baseParse(`<span/><div>hello</div><span/>`)
    const c1 = ast.children[0]
    const c2 = ast.children[2]

    /** 遇到 div 时移除当前节点。 */
    const plugin: NodeTransform = (node, context) => {
      if (node.type === NodeTypes.ELEMENT && node.tag === 'div') {
        context.removeNode()
      }
    }
    const spy = vi.fn(plugin)
    transform(ast, {
      nodeTransforms: [spy],
    })

    expect(ast.children.length).toBe(2)
    expect(ast.children[0]).toBe(c1)
    expect(ast.children[1]).toBe(c2)

    // 被移除节点的 children 不再遍历。
    expect(spy).toHaveBeenCalledTimes(4)
    // 被移除节点前后的兄弟仍正常遍历。
    expect(spy.mock.calls[1][0]).toBe(c1)
    expect(spy.mock.calls[3][0]).toBe(c2)
  })

  /**
   * 遇到 div 后依次删除当前节点和前侧 span；检查最后 span 保留且仍被访问，先前 span 已进入过转换。删除前侧兄弟须同时左移当前索引与循环游标。
   */
  test('context.removeNode (prev sibling)', () => {
    const ast = baseParse(`<span/><div/><span/>`)
    const c1 = ast.children[0]
    const c2 = ast.children[2]

    /** 移除当前 div 及其前一个兄弟，验证游标左移。 */
    const plugin: NodeTransform = (node, context) => {
      if (node.type === NodeTypes.ELEMENT && node.tag === 'div') {
        context.removeNode()
        // 再移除前一个兄弟。
        context.removeNode(context.parent!.children[0])
      }
    }
    const spy = vi.fn(plugin)
    transform(ast, {
      nodeTransforms: [spy],
    })

    expect(ast.children.length).toBe(1)
    expect(ast.children[0]).toBe(c2)

    expect(spy).toHaveBeenCalledTimes(4)
    // 首个 span 在随后被移除前已经完成遍历。
    expect(spy.mock.calls[1][0]).toBe(c1)
    // 最后一个 span 仍会遍历。
    expect(spy.mock.calls[3][0]).toBe(c2)
  })

  /**
   * 遇到 div 后删除当前节点与后侧 span；检查仅首个 span 保留，插件只收到 root、首 span、div，已删除后继不会再访问。
   */
  test('context.removeNode (next sibling)', () => {
    const ast = baseParse(`<span/><div/><span/>`)
    const c1 = ast.children[0]
    const d1 = ast.children[1]

    /** 移除当前 div 及其后一个兄弟，验证不会访问已删除后继。 */
    const plugin: NodeTransform = (node, context) => {
      if (node.type === NodeTypes.ELEMENT && node.tag === 'div') {
        context.removeNode()
        // 再移除后一个兄弟。
        context.removeNode(context.parent!.children[1])
      }
    }
    const spy = vi.fn(plugin)
    transform(ast, {
      nodeTransforms: [spy],
    })

    expect(ast.children.length).toBe(1)
    expect(ast.children[0]).toBe(c1)

    expect(spy).toHaveBeenCalledTimes(3)
    // 首个 span 仍正常遍历。
    expect(spy.mock.calls[1][0]).toBe(c1)
    // 已作为后继删除的最后 span 不应再进入转换器。
    expect(spy.mock.calls[2][0]).toBe(d1)
  })

  /**
   * 插件将两个 div 的 id 表达式主动提升；检查 hoists 保存原表达式，指令值分别变成 _hoisted_1/_hoisted_2，索引使用根级一基命名。
   */
  test('context.hoist', () => {
    const ast = baseParse(`<div :id="foo"/><div :id="bar"/>`)
    const hoisted: ExpressionNode[] = []
    /** 把每个元素的指令表达式提升，并保存原节点供结果对照。 */
    const mock: NodeTransform = (node, context) => {
      if (node.type === NodeTypes.ELEMENT) {
        const dir = node.props[0] as DirectiveNode
        hoisted.push(dir.exp!)
        dir.exp = context.hoist(dir.exp!)
      }
    }
    transform(ast, {
      nodeTransforms: [mock],
    })
    expect(ast.hoists).toMatchObject(hoisted)
    expect((ast as any).children[0].props[0].exp.content).toBe(`_hoisted_1`)
    expect((ast as any).children[1].props[0].exp.content).toBe(`_hoisted_2`)
  })

  /**
   * 传 filename /the/fileName.vue 并记录 context；检查原 filename 保留，selfName 推导为 FileName，根和元素各进入一次插件。
   */
  test('context.filename and selfName', () => {
    const ast = baseParse(`<div />`)

    const calls: any[] = []
    /** 记录 filename 和由其推导的 selfName。 */
    const plugin: NodeTransform = (node, context) => {
      calls.push({ ...context })
    }

    transform(ast, {
      filename: '/the/fileName.vue',
      nodeTransforms: [plugin],
    })

    expect(calls.length).toBe(2)
    expect(calls[1]).toMatchObject({
      filename: '/the/fileName.vue',
      selfName: 'FileName',
    })
  })

  /**
   * 插件通过 context.onError 主动报告结束标签错误；检查用户处理器收到错误代码与原 loc。处理器返回后遍历继续，未断言抛出终止路径。
   */
  test('onError option', () => {
    const ast = baseParse(`<div/>`)
    const loc = ast.children[0].loc
    /** 主动经 context.onError 报错，验证用户错误处理器接收原 location。 */
    const plugin: NodeTransform = (node, context) => {
      context.onError(
        createCompilerError(ErrorCodes.X_INVALID_END_TAG, node.loc),
      )
    }
    const spy = vi.fn()
    transform(ast, {
      nodeTransforms: [plugin],
      onError: spy,
    })
    expect(spy.mock.calls[0]).toMatchObject([
      {
        code: ErrorCodes.X_INVALID_END_TAG,
        loc,
      },
    ])
  })

  /**
   * 转换单个 foo 插值；检查 root.helpers 登记 TO_DISPLAY_STRING，插值输出需要将任意值转成可展示字符串。
   */
  test('should inject toString helper for interpolations', () => {
    const ast = baseParse(`{{ foo }}`)
    transform(ast, {})
    expect(ast.helpers).toContain(TO_DISPLAY_STRING)
  })

  /**
   * 转换单个注释；检查 root.helpers 登记 CREATE_COMMENT，客户端输出需要创建注释 VNode。
   */
  test('should inject createVNode and Comment for comments', () => {
    const ast = baseParse(`<!--foo-->`)
    transform(ast, {})
    expect(ast.helpers).toContain(CREATE_COMMENT)
  })

  // 根生成节点选择：单根直接复用 child，多根生成 Fragment，并正确处理空模板/纯文本。
  describe('root codegenNode', () => {
    /** 用构建根 codegenNode 所需的完整转换组合编译模板。 */
    function transformWithCodegen(template: string) {
      const ast = baseParse(template)
      transform(ast, {
        nodeTransforms: [
          transformIf,
          transformFor,
          transformText,
          transformSlotOutlet,
          transformElement,
        ],
      })
      return ast
    }

    /** 构造只关注 block 关键字段的 VNodeCall matcher。 */
    function createBlockMatcher(
      tag: VNodeCall['tag'],
      props?: VNodeCall['props'],
      children?: VNodeCall['children'],
      patchFlag?: VNodeCall['patchFlag'],
    ) {
      return {
        type: NodeTypes.VNODE_CALL,
        isBlock: true,
        tag,
        props,
        children,
        patchFlag,
      }
    }

    /**
     * 空模板运行根生成组合；检查 codegenNode 为 undefined，生成器随后按空渲染结果输出 null。
     */
    test('no children', () => {
      const ast = transformWithCodegen(``)
      expect(ast.codegenNode).toBeUndefined()
    })

    /**
     * 根只有 slot outlet；检查根保存原 slot 模板节点，其内部 codegenNode 为 RENDER_SLOT 调用，由生成器继续解引用。
     */
    test('single <slot/>', () => {
      const ast = transformWithCodegen(`<slot/>`)
      expect(ast.codegenNode).toMatchObject({
        codegenNode: {
          type: NodeTypes.JS_CALL_EXPRESSION,
          callee: RENDER_SLOT,
        },
      })
    })

    /**
     * 根只有原生 div；检查根复用该元素 VNodeCall 并升级为 block，以追踪根的动态后代。
     */
    test('single element', () => {
      const ast = transformWithCodegen(`<div/>`)
      expect(ast.codegenNode).toMatchObject(createBlockMatcher(`"div"`))
    })

    /**
     * 根 div 带 v-if；检查根 codegenNode 指向 IfNode，条件结构的生成节点留给其专用转换。
     */
    test('root v-if', () => {
      const ast = transformWithCodegen(`<div v-if="ok" />`)
      expect(ast.codegenNode).toMatchObject({
        type: NodeTypes.IF,
      })
    })

    /**
     * 根 div 带 v-for；检查根 codegenNode 指向 ForNode，列表结构由 for 转换管理。
     */
    test('root v-for', () => {
      const ast = transformWithCodegen(`<div v-for="i in list" />`)
      expect(ast.codegenNode).toMatchObject({
        type: NodeTypes.FOR,
      })
    })

    /**
     * 根 div 带未知 v-foo；检查 VNodeCall 保留运行时指令数组，根包装不会丢失 directive metadata。
     */
    test('root element with custom directive', () => {
      const ast = transformWithCodegen(`<div v-foo/>`)
      expect(ast.codegenNode).toMatchObject({
        type: NodeTypes.VNODE_CALL,
        directives: { type: NodeTypes.JS_ARRAY_EXPRESSION },
      })
    })

    /**
     * 根只有静态 hello；检查根 codegenNode 保持 TEXT，避免提前包装成元素或 Fragment。
     */
    test('single text', () => {
      const ast = transformWithCodegen(`hello`)
      expect(ast.codegenNode).toMatchObject({
        type: NodeTypes.TEXT,
      })
    })

    /**
     * 根只有 foo 插值；检查根 codegenNode 保持 INTERPOLATION，生成器负责显示字符串与根文本包装。
     */
    test('single interpolation', () => {
      const ast = transformWithCodegen(`{{ foo }}`)
      expect(ast.codegenNode).toMatchObject({
        type: NodeTypes.INTERPOLATION,
      })
    })

    /**
     * 根由插值与后续静态文本连续组成；检查文本合并后根直接使用 COMPOUND_EXPRESSION。
     */
    test('single CompoundExpression', () => {
      const ast = transformWithCodegen(`{{ foo }} bar baz`)
      expect(ast.codegenNode).toMatchObject({
        type: NodeTypes.COMPOUND_EXPRESSION,
      })
    })

    /**
     * 根含两个 div；检查生成 FRAGMENT block，children 保留两元素并标记 STABLE_FRAGMENT。
     */
    test('multiple children', () => {
      const ast = transformWithCodegen(`<div/><div/>`)
      expect(ast.codegenNode).toMatchObject(
        createBlockMatcher(
          FRAGMENT,
          undefined,
          [
            { type: NodeTypes.ELEMENT, tag: `div` },
            { type: NodeTypes.ELEMENT, tag: `div` },
          ] as any,
          PatchFlags.STABLE_FRAGMENT,
        ),
      )
    })

    /**
     * 根为注释、单 div、注释；检查仍生成三项 Fragment，开发环境追加 DEV_ROOT_FRAGMENT，以指明唯一有效元素根。
     */
    test('multiple children w/ single root + comments', () => {
      const ast = transformWithCodegen(`<!--foo--><div/><!--bar-->`)
      expect(ast.codegenNode).toMatchObject(
        createBlockMatcher(
          FRAGMENT,
          undefined,
          [
            { type: NodeTypes.COMMENT },
            { type: NodeTypes.ELEMENT, tag: `div` },
            { type: NodeTypes.COMMENT },
          ] as any,
          PatchFlags.STABLE_FRAGMENT | PatchFlags.DEV_ROOT_FRAGMENT,
        ),
      )
    })
  })
})
