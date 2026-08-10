/**
 * compiler-core 测试辅助：提供 AST 类型断言、转换结果提取和生成代码快照工具。
 * 这些 helper 统一测试的解析/转换选项，避免每个用例重复搭建管线而产生比较口径差异。
 */
import {
  type ElementNode,
  ElementTypes,
  Namespaces,
  NodeTypes,
  type Property,
  type SimpleExpressionNode,
  type VNodeCall,
  locStub,
} from '../src'
import {
  PatchFlagNames,
  type PatchFlags,
  type ShapeFlags,
  isArray,
  isString,
} from '@vue/shared'

/** 测试约定中判断 key/value 是否以 `[...]` 标记动态表达式。 */
const leadingBracketRE = /^\[/
/** 去掉测试约定包裹动态表达式的首尾方括号。 */
const bracketsRE = /^\[|\]$/g

/**
 * 从简写对象创建 AST matcher。测试约定：非静态表达式用 `[]` 包裹，例如
 * `{ foo: '[bar]' }` 匹配 `{ foo: bar }`，`{ '[foo]': 'bar' }` 匹配 `{ [foo]: "bar" }`。
 */
export function createObjectMatcher(obj: Record<string, any>): {
  /** 对象表达式的节点判别值。 */
  type: NodeTypes
  /** 只包含断言关注字段的属性 matcher。 */
  properties: Partial<Property>[]
} {
  return {
    type: NodeTypes.JS_OBJECT_EXPRESSION,
    properties: Object.keys(obj).map(key => ({
      type: NodeTypes.JS_PROPERTY,
      key: {
        type: NodeTypes.SIMPLE_EXPRESSION,
        content: key.replace(bracketsRE, ''),
        isStatic: !leadingBracketRE.test(key),
      } as SimpleExpressionNode,
      value: isString(obj[key])
        ? {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: obj[key].replace(bracketsRE, ''),
            isStatic: !leadingBracketRE.test(obj[key]),
          }
        : obj[key],
    })),
  }
}

/** 创建一个挂有 VNodeCall 的最小原生元素节点，供 codegen 单元测试直接组装输入。 */
export function createElementWithCodegen(
  tag: VNodeCall['tag'],
  props?: VNodeCall['props'],
  children?: VNodeCall['children'],
  patchFlag?: VNodeCall['patchFlag'],
  dynamicProps?: VNodeCall['dynamicProps'],
): ElementNode {
  return {
    type: NodeTypes.ELEMENT,
    loc: locStub,
    ns: Namespaces.HTML,
    tag: 'div',
    tagType: ElementTypes.ELEMENT,
    props: [],
    children: [],
    codegenNode: {
      type: NodeTypes.VNODE_CALL,
      tag,
      props,
      children,
      patchFlag,
      dynamicProps,
      directives: undefined,
      isBlock: false,
      disableTracking: false,
      isComponent: false,
      loc: locStub,
    },
  }
}

/** 测试可格式化的 patchFlag 与 shapeFlag 数值联合。 */
type Flags = PatchFlags | ShapeFlags
/** 把一个或多个 flag 合并为数值，并附加与生成代码一致的可读名称注释。 */
export function genFlagText(
  flag: Flags | Flags[],
  names: {
    /** flag 数值到显示名称的映射。 */
    [k: number]: string
  } = PatchFlagNames,
): string {
  if (isArray(flag)) {
    let f = 0
    flag.forEach(ff => {
      f |= ff
    })
    return `${f} /* ${flag.map(f => names[f]).join(', ')} */`
  } else {
    return `${flag} /* ${names[flag]} */`
  }
}
