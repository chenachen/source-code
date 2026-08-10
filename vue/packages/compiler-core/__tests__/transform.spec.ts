/**
 * 通用 AST 遍历场景：验证节点转换的进入/退出顺序、节点替换/删除、helper 引用计数、
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

  test('should inject toString helper for interpolations', () => {
    const ast = baseParse(`{{ foo }}`)
    transform(ast, {})
    expect(ast.helpers).toContain(TO_DISPLAY_STRING)
  })

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

    test('no children', () => {
      const ast = transformWithCodegen(``)
      expect(ast.codegenNode).toBeUndefined()
    })

    test('single <slot/>', () => {
      const ast = transformWithCodegen(`<slot/>`)
      expect(ast.codegenNode).toMatchObject({
        codegenNode: {
          type: NodeTypes.JS_CALL_EXPRESSION,
          callee: RENDER_SLOT,
        },
      })
    })

    test('single element', () => {
      const ast = transformWithCodegen(`<div/>`)
      expect(ast.codegenNode).toMatchObject(createBlockMatcher(`"div"`))
    })

    test('root v-if', () => {
      const ast = transformWithCodegen(`<div v-if="ok" />`)
      expect(ast.codegenNode).toMatchObject({
        type: NodeTypes.IF,
      })
    })

    test('root v-for', () => {
      const ast = transformWithCodegen(`<div v-for="i in list" />`)
      expect(ast.codegenNode).toMatchObject({
        type: NodeTypes.FOR,
      })
    })

    test('root element with custom directive', () => {
      const ast = transformWithCodegen(`<div v-foo/>`)
      expect(ast.codegenNode).toMatchObject({
        type: NodeTypes.VNODE_CALL,
        directives: { type: NodeTypes.JS_ARRAY_EXPRESSION },
      })
    })

    test('single text', () => {
      const ast = transformWithCodegen(`hello`)
      expect(ast.codegenNode).toMatchObject({
        type: NodeTypes.TEXT,
      })
    })

    test('single interpolation', () => {
      const ast = transformWithCodegen(`{{ foo }}`)
      expect(ast.codegenNode).toMatchObject({
        type: NodeTypes.INTERPOLATION,
      })
    })

    test('single CompoundExpression', () => {
      const ast = transformWithCodegen(`{{ foo }} bar baz`)
      expect(ast.codegenNode).toMatchObject({
        type: NodeTypes.COMPOUND_EXPRESSION,
      })
    })

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
