/**
 * compiler-core 测试辅助：把简写属性对象转成 AST matcher，构造带 codegenNode 的元素 fixture，
 * 并把位标记格式化为生成代码使用的数字与名称。这里只组装测试数据，不执行编译管线。
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
 * 字符串值按这套约定转成 SimpleExpression matcher；非字符串值直接保留，便于嵌入调用或其他节点。
 * 返回值只包含这些断言字段，不是可以直接交给 codegen 的完整对象 AST。
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

/**
 * 构造挂有 VNodeCall 的最小原生元素 fixture，供 codegen 测试绕过 parser/transform。
 * 参数描述将要打印的 tag、props、children 与更新标记；模板节点自身固定为 div、空 props/children。
 * 因而这些测试验证的是 codegenNode 的打印，不证明模板节点与输出描述之间的转换过程。
 */
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
/**
 * 把一个或多个 flag 合并为数值，并附加与生成代码一致的可读名称注释。
 * 数组按位或计算组合值，但名称按输入顺序拼接；names 可换成 ShapeFlags 的名称表。
 */
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
