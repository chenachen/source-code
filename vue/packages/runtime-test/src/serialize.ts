import {
  type TestComment,
  type TestElement,
  type TestNode,
  TestNodeTypes,
  type TestText,
} from './nodeOps'
import { isOn } from '@vue/shared'

/**
 * 按 type 将测试节点序列化为元素、文本或注释字符串。
 * indent 是每层空格数；depth 是调用方递归层级。它用于测试快照，不提供 HTML 转义或 SSR 语义。
 */
export function serialize(
  node: TestNode,
  indent: number = 0,
  depth: number = 0,
): string {
  if (node.type === TestNodeTypes.ELEMENT) {
    return serializeElement(node, indent, depth)
  } else {
    return serializeText(node, indent, depth)
  }
}

/** 只序列化元素 children；indent 非零时在非空内容两端及相邻子节点间加入换行。空 children 返回空串。 */
export function serializeInner(
  node: TestElement,
  indent: number = 0,
  depth: number = 0,
): string {
  const newLine = indent ? `\n` : ``
  return node.children.length
    ? newLine +
        node.children.map(c => serialize(c, indent, depth + 1)).join(newLine) +
        newLine
    : ``
}

/** 把元素 props 与 children 组装为完整标签；忽略事件和 nullish prop，空串值输出裸属性，其余值 JSON.stringify。 */
function serializeElement(
  node: TestElement,
  indent: number,
  depth: number,
): string {
  const props = Object.keys(node.props)
    .map(key => {
      const value = node.props[key]
      return isOn(key) || value == null
        ? ``
        : value === ``
          ? key
          : `${key}=${JSON.stringify(value)}`
    })
    .filter(Boolean)
    .join(' ')
  const padding = indent ? ` `.repeat(indent).repeat(depth) : ``
  return (
    `${padding}<${node.tag}${props ? ` ${props}` : ``}>` +
    `${serializeInner(node, indent, depth)}` +
    `${padding}</${node.tag}>`
  )
}

/** 输出文本原文或注释标记，并按 indent/depth 添加缩进；空文本仍会贡献对应缩进。 */
function serializeText(
  node: TestText | TestComment,
  indent: number,
  depth: number,
): string {
  const padding = indent ? ` `.repeat(indent).repeat(depth) : ``
  return (
    padding +
    (node.type === TestNodeTypes.COMMENT ? `<!--${node.text}-->` : node.text)
  )
}
