/** 本模块依赖服务端编译期求值，只会进入 Node.js 版本的编译器。 */
import {
  CREATE_STATIC,
  type CacheExpression,
  ConstantTypes,
  type ElementNode,
  ElementTypes,
  type ExpressionNode,
  type HoistTransform,
  Namespaces,
  NodeTypes,
  type PlainElementNode,
  type SimpleExpressionNode,
  type TemplateChildNode,
  type TextCallNode,
  type TransformContext,
  createCallExpression,
  findDir,
  isStaticArgOf,
} from '@vue/compiler-core'
import {
  escapeHtml,
  includeBooleanAttr,
  isArray,
  isBooleanAttr,
  isKnownHtmlAttr,
  isKnownMathMLAttr,
  isKnownSvgAttr,
  isString,
  isSymbol,
  isVoidTag,
  makeMap,
  normalizeClass,
  normalizeStyle,
  stringifyStyle,
  toDisplayString,
} from '@vue/shared'

/**
 * 启用静态 HTML 字符串化的收益阈值。
 * 小静态树保留普通 hoist 更省代码；节点或带绑定元素达到阈值后，innerHTML 批量创建更划算。
 */
export enum StringifyThresholds {
  /** 静态块内带属性/绑定的元素数量阈值。 */
  ELEMENT_WITH_BINDING_COUNT = 5,
  /** 静态块内所有 DOM 节点数量阈值。 */
  NODE_COUNT = 20,
}

/** 可被合并进静态 HTML chunk 的 AST 节点。 */
type StringifiableNode = PlainElementNode | TextCallNode

/**
 * 匹配静态 HTML 中嵌入的常量变量占位符。
 * 例如 compiler-sfc 资产 URL 转换生成的导入变量不能直接写进字符串，要在最终 JS 中
 * 恢复为字符串拼接表达式。
 */
const expReplaceRE = /__VUE_EXP_START__(.*?)__VUE_EXP_END__/g

/**
 * 将达到收益阈值的连续静态提升节点合并为字符串化静态 VNode，例如：
 *
 * ```js
 * const _hoisted_1 = createStaticVNode(`<div class="foo">bar</div>`)
 * ```
 *
 * 一个 static VNode 可包含多个连续元素/文本，称为一个 chunk。runtime-dom 会在隐藏容器
 * 中通过 innerHTML 一次创建整段内容，再把所有节点插到目标位置。调用中还要携带顶层
 * DOM 节点数，水合时才能知道该 static VNode 应认领多少现有节点。
 *
 * 算法扫描含 hoist 节点的 children，持续收集最大连续可字符串化区间；遇到动态或不安全
 * 节点时结算。chunk 的第一个 hoist 被替换成 createStaticVNode，其余已合并项会从 children
 * 和缓存表中删除。此优化只在 Node.js 编译器执行。
 */
export const stringifyStatic: HoistTransform = (children, context, parent) => {
  // 插槽内容由消费方决定渲染上下文和作用域，不能安全地在声明方合并成静态 DOM。
  if (context.scopes.vSlot > 0) {
    return
  }

  const isParentCached =
    parent.type === NodeTypes.ELEMENT &&
    parent.codegenNode &&
    parent.codegenNode.type === NodeTypes.VNODE_CALL &&
    parent.codegenNode.children &&
    !isArray(parent.codegenNode.children) &&
    parent.codegenNode.children.type === NodeTypes.JS_CACHE_EXPRESSION

  let nc = 0 // 当前 chunk 的 DOM 节点总数
  let ec = 0 // 当前 chunk 中带属性/绑定的元素数
  /** 当前正在累积的连续可字符串化节点。 */
  const currentChunk: StringifiableNode[] = []

  /** 达到阈值时结算当前 chunk，并返回从 children 中合并删除的节点数量。 */
  const stringifyCurrentChunk = (currentIndex: number): number => {
    if (
      nc >= StringifyThresholds.NODE_COUNT ||
      ec >= StringifyThresholds.ELEMENT_WITH_BINDING_COUNT
    ) {
      // 把当前连续区间序列化成一次 createStaticVNode(html, topLevelCount) 调用。
      const staticCall = createCallExpression(context.helper(CREATE_STATIC), [
        JSON.stringify(
          currentChunk.map(node => stringifyNode(node, context)).join(''),
        ).replace(expReplaceRE, `" + $1 + "`),
        // 第二个参数是该静态 VNode 插入/水合时覆盖的顶层 DOM 节点数量。
        String(currentChunk.length),
      ])

      const deleteCount = currentChunk.length - 1

      if (isParentCached) {
        // 父级整体缓存时，children 本身就是 CacheExpression 的数组值，直接把对应区间
        // 替换为 staticCall，避免再操作各子节点独立的缓存表达式。
        children.splice(
          currentIndex - currentChunk.length,
          currentChunk.length,
          // @ts-expect-error
          staticCall,
        )
      } else {
        // 普通情况复用第一个节点的缓存槽承载合并后的 staticCall。
        ;(currentChunk[0].codegenNode as CacheExpression).value = staticCall
        if (currentChunk.length > 1) {
          // 其余节点已进入同一 HTML 字符串，从 children 删除。
          children.splice(currentIndex - currentChunk.length + 1, deleteCount)
          // 删除缓存项后，后续 CacheExpression.index 必须同步左移，否则 render cache
          // 的读写位置会错位。
          const cacheIndex = context.cached.indexOf(
            currentChunk[currentChunk.length - 1]
              .codegenNode as CacheExpression,
          )
          if (cacheIndex > -1) {
            for (let i = cacheIndex; i < context.cached.length; i++) {
              const c = context.cached[i]
              if (c) c.index -= deleteCount
            }
            context.cached.splice(cacheIndex - deleteCount + 1, deleteCount)
          }
        }
      }
      return deleteCount
    }
    return 0
  }

  let i = 0
  for (; i < children.length; i++) {
    const child = children[i]
    const isCached = isParentCached || getCachedNode(child)
    if (isCached) {
      // 能进入缓存意味着类型已由静态提升阶段收窄为候选元素或文本调用。
      const result = analyzeNode(child as StringifiableNode)
      if (result) {
        // 累加候选节点内部规模，继续扩展当前连续 chunk。
        nc += result[0]
        ec += result[1]
        currentChunk.push(child as StringifiableNode)
        continue
      }
    }
    // 遇到不可字符串化节点：先结算之前的 chunk，再按删除数量回调遍历下标。
    i -= stringifyCurrentChunk(i)
    // 开始收集下一个连续区间。
    nc = 0
    ec = 0
    currentChunk.length = 0
  }
  // 列表以候选节点结束时，循环内没有触发结算，需要最后再执行一次。
  stringifyCurrentChunk(i)
}

/** 若节点是静态提升阶段生成的缓存元素/文本，则返回其 CacheExpression。 */
const getCachedNode = (
  node: TemplateChildNode,
): CacheExpression | undefined => {
  if (
    ((node.type === NodeTypes.ELEMENT &&
      node.tagType === ElementTypes.ELEMENT) ||
      node.type === NodeTypes.TEXT_CALL) &&
    node.codegenNode &&
    node.codegenNode.type === NodeTypes.JS_CACHE_EXPRESSION
  ) {
    return node.codegenNode
  }
}

/** HTML/SVG/MathML 都允许安全序列化的 data-* 与 aria-* 属性。 */
const dataAriaRE = /^(?:data|aria)-/
/** 判断属性名在当前命名空间中能否按 HTML 字符串输出。 */
const isStringifiableAttr = (name: string, ns: Namespaces) => {
  return (
    (ns === Namespaces.HTML
      ? isKnownHtmlAttr(name)
      : ns === Namespaces.SVG
        ? isKnownSvgAttr(name)
        : ns === Namespaces.MATH_ML
          ? isKnownMathMLAttr(name)
          : false) || dataAriaRE.test(name)
  )
}

/**
 * 不使用 innerHTML 批量创建的表格结构标签。
 * 浏览器会根据容器上下文自动插入/调整 tbody 等节点，可能令生成节点数和 AST 不一致。
 */
const isNonStringifiable = /*@__PURE__*/ makeMap(
  `caption,thead,tr,th,tbody,td,tfoot,colgroup,col`,
)

/**
 * 分析一个缓存节点能否字符串化，并计算其规模。
 *
 * @returns `false` 表示含不安全属性或运行时常量；否则返回 `[节点数, 带绑定元素数]`
 */
function analyzeNode(node: StringifiableNode): [number, number] | false {
  if (node.type === NodeTypes.ELEMENT && isNonStringifiable(node.tag)) {
    return false
  }

  // v-once 有独立的缓存和更新语义，合并后会破坏其缓存边界。
  if (node.type === NodeTypes.ELEMENT && findDir(node, 'once', true)) {
    return false
  }

  if (node.type === NodeTypes.TEXT_CALL) {
    return [1, 0]
  }

  let nc = 1 // 当前根元素本身计一个节点
  let ec = node.props.length > 0 ? 1 : 0 // 有 props 的根元素计一个绑定元素
  let bailed = false
  /** 标记当前候选不可安全字符串化，并返回便于递归短路的 false。 */
  const bail = (): false => {
    bailed = true
    return false
  }

  // TODO：继续覆盖 innerHTML 与逐节点创建结果不同的结构；最常见的是 `<p>` 内嵌
  // 非 phrasing-content，浏览器会自动闭合 `<p>`。目前通过其他结构校验和保守退出兜底。
  /** 递归检查属性和常量级别，同时累计后代规模。 */
  function walk(node: ElementNode): boolean {
    const isOptionTag = node.tag === 'option' && node.ns === Namespaces.HTML
    for (let i = 0; i < node.props.length; i++) {
      const p = node.props[i]
      // 未知静态属性可能应作为 DOM property 设置，不能保证字符串属性与其语义一致。
      if (
        p.type === NodeTypes.ATTRIBUTE &&
        !isStringifiableAttr(p.name, node.ns)
      ) {
        return bail()
      }
      if (p.type === NodeTypes.DIRECTIVE && p.name === 'bind') {
        // 动态参数或非当前命名空间合法属性无法安全写进静态 HTML。
        if (
          p.arg &&
          (p.arg.type === NodeTypes.COMPOUND_EXPRESSION ||
            (p.arg.isStatic && !isStringifiableAttr(p.arg.content, node.ns)))
        ) {
          return bail()
        }
        if (
          p.exp &&
          (p.exp.type === NodeTypes.COMPOUND_EXPRESSION ||
            p.exp.constType < ConstantTypes.CAN_STRINGIFY)
        ) {
          return bail()
        }
        // `<option :value="1">` 的 property 值是 number，而 HTML 属性只能得到 string，
        // 会改变表单选择比较语义，因此不能字符串化非字符串常量 value。
        if (
          isOptionTag &&
          isStaticArgOf(p.arg, 'value') &&
          p.exp &&
          !p.exp.isStatic
        ) {
          return bail()
        }
      }
    }
    for (let i = 0; i < node.children.length; i++) {
      nc++
      const child = node.children[i]
      if (child.type === NodeTypes.ELEMENT) {
        if (child.props.length > 0) {
          ec++
        }
        walk(child)
        if (bailed) {
          return false
        }
      }
    }
    return true
  }

  return walk(node) ? [nc, ec] : false
}

/** 把一个已证明安全的静态 AST 节点序列化为 HTML 片段。 */
function stringifyNode(
  node: string | TemplateChildNode,
  context: TransformContext,
): string {
  if (isString(node)) {
    return node
  }
  if (isSymbol(node)) {
    return ``
  }
  switch (node.type) {
    case NodeTypes.ELEMENT:
      return stringifyElement(node, context)
    case NodeTypes.TEXT:
      return escapeHtml(node.content)
    case NodeTypes.COMMENT:
      return `<!--${escapeHtml(node.content)}-->`
    case NodeTypes.INTERPOLATION:
      return escapeHtml(toDisplayString(evaluateConstant(node.content)))
    case NodeTypes.COMPOUND_EXPRESSION:
      return escapeHtml(evaluateConstant(node))
    case NodeTypes.TEXT_CALL:
      return stringifyNode(node.content, context)
    default:
      // 静态树不会包含 if/for 等结构节点；兜底返回空串保持类型完备。
      return ''
  }
}

/**
 * 序列化静态元素及其后代，并处理常量 v-bind、v-html/v-text 与 SFC scopeId。
 */
function stringifyElement(
  node: ElementNode,
  context: TransformContext,
): string {
  let res = `<${node.tag}`
  let innerHTML = ''
  for (let i = 0; i < node.props.length; i++) {
    const p = node.props[i]
    if (p.type === NodeTypes.ATTRIBUTE) {
      res += ` ${p.name}`
      if (p.value) {
        res += `="${escapeHtml(p.value.content)}"`
      }
    } else if (p.type === NodeTypes.DIRECTIVE) {
      if (p.name === 'bind') {
        const exp = p.exp as SimpleExpressionNode
        if (exp.content[0] === '_') {
          // 编译器内部生成的字符串常量引用，例如 SFC 资产 URL 转换产生的 import 变量。
          // 先放特殊占位符，外层 JSON.stringify 后再恢复成 JS 字符串拼接。
          res += ` ${
            (p.arg as SimpleExpressionNode).content
          }="__VUE_EXP_START__${exp.content}__VUE_EXP_END__"`
          continue
        }
        // #6568：布尔属性绑定为字面量 false 时必须完全省略；输出 hidden="false"
        // 仍会被浏览器视为 true，导致静态优化前后行为不同。
        if (
          (isBooleanAttr((p.arg as SimpleExpressionNode).content) ||
            (p.arg as SimpleExpressionNode).content === 'hidden') &&
          exp.content === 'false'
        ) {
          continue
        }
        // 常量 v-bind（如 `:foo="1"`）在编译期求值，并按属性类型规范化。
        let evaluated = evaluateConstant(exp)
        if (evaluated != null) {
          const arg = p.arg && (p.arg as SimpleExpressionNode).content
          if (
            arg === 'hidden' &&
            typeof evaluated === 'number' &&
            !includeBooleanAttr(evaluated)
          ) {
            continue
          }
          if (arg === 'class') {
            evaluated = normalizeClass(evaluated)
          } else if (arg === 'style') {
            evaluated = stringifyStyle(normalizeStyle(evaluated))
          }
          res += ` ${(p.arg as SimpleExpressionNode).content}="${escapeHtml(
            evaluated,
          )}"`
        }
      } else if (p.name === 'html') {
        // #5439：常量 v-html 直接成为元素内部 HTML，并取代普通 children。
        innerHTML = evaluateConstant(p.exp as SimpleExpressionNode)
      } else if (p.name === 'text') {
        innerHTML = escapeHtml(
          toDisplayString(evaluateConstant(p.exp as SimpleExpressionNode)),
        )
      }
    }
  }
  if (context.scopeId) {
    res += ` ${context.scopeId}`
  }
  res += `>`
  if (innerHTML) {
    res += innerHTML
  } else {
    for (let i = 0; i < node.children.length; i++) {
      res += stringifyNode(node.children[i], context)
    }
  }
  if (!isVoidTag(node.tag)) {
    res += `</${node.tag}>`
  }
  return res
}

/**
 * 在编译期求值已被常量分析确认安全的表达式。
 *
 * __UNSAFE__：实现使用 `new Function`，因此明确标记供安全审查。这里理论上只会收到
 * `{{ 1 }}`、`{{ 'foo' }}` 等常量；常量分析遇到可调用结构和危险括号形式会提前退出，
 * 具体边界见 compiler-core 的 transformExpression。
 */
function evaluateConstant(exp: ExpressionNode): string {
  if (exp.type === NodeTypes.SIMPLE_EXPRESSION) {
    return new Function(`return (${exp.content})`)()
  } else {
    // 复合表达式逐段拼接，文本保留原值，插值继续递归求值并转成展示字符串。
    let res = ``
    exp.children.forEach(c => {
      if (isString(c) || isSymbol(c)) {
        return
      }
      if (c.type === NodeTypes.TEXT) {
        res += c.content
      } else if (c.type === NodeTypes.INTERPOLATION) {
        res += toDisplayString(evaluateConstant(c.content))
      } else {
        res += evaluateConstant(c as ExpressionNode)
      }
    })
    return res
  }
}
