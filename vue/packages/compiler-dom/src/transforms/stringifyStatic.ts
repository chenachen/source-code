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
 * 小静态树保留普通 VNode 缓存；节点或带属性元素达到阈值后，启用 innerHTML 批量创建。
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
 * 将达到收益阈值的连续静态缓存节点合并为字符串化静态 VNode，例如：
 *
 * ```js
 * _cache[0] || (_cache[0] = createStaticVNode(`<div class="foo">bar</div>`, 1))
 * ```
 *
 * 一个 static VNode 可包含多个连续元素/文本，称为一个 chunk。runtime-dom 会在隐藏容器
 * 中通过 innerHTML 一次创建整段内容，再把所有节点插到目标位置。调用中还要携带顶层
 * DOM 节点数，水合时才能知道该 static VNode 应认领多少现有节点。
 *
 * 算法扫描 cacheStatic 处理后的 children，持续收集最大连续可字符串化区间；遇到动态或
 * 未通过检查的节点时结算。子节点分别缓存时，复用第一个缓存槽并删除其余合并项及缓存槽；
 * 父数组整体缓存时，直接以 createStaticVNode 调用替换数组内的区间。仅 Node.js 构建启用。
 *
 * @param children - cacheStatic 已分析的原位 children 列表，可能同时是父级缓存数组的值。
 * @param context - 持有 helper 引用与缓存槽；合并会更新 cached 和后续缓存索引。
 * @param parent - 用于区分父数组整体缓存与子节点分别缓存，两种路径不能混用。
 * @returns 不返回新树；splice 缩短原列表，当前循环需按 deleteCount 回退下标。
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

  /**
   * 结算不包含 currentIndex 处隔断节点的连续区间。
   * currentIndex 指向区间之后的位置（结束扫描时为原列表长度）；返回被合并的顶层项数
   * 减一，供外层修正游标。阈值计的是整个子树规模，staticCount 则只计 chunk 顶层项。
   * 本函数不清空计数器/chunk，循环调用方在结算后统一重置，尾部结算无需再扫描。
   */
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
        // 第二个参数写入 VNode.staticCount，水合时据此认领已有的顶层 DOM 节点。
        // 首次插入返回实际 el/anchor，后续移动和删除沿这两个端点确定范围。
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
      // 静态缓存阶段提供候选元素或文本调用，具体能否序列化仍需后续检查。
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

/** 若节点是 cacheStatic 生成的缓存元素/文本，则返回其 CacheExpression。 */
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
 * @returns `false` 表示候选不满足当前字符串化条件；否则返回 `[节点数, 带绑定元素数]`
 * 递归只读检查候选，不求值表达式。退出后丢弃累计值，因此检查失败时无需回滚计数。
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
  /** 记录当前候选未通过字符串化检查，并返回便于递归短路的 false。 */
  const bail = (): false => {
    bailed = true
    return false
  }

  // TODO：继续覆盖 innerHTML 与逐节点创建结果不同的结构；最常见的是 `<p>` 内嵌
  // 非 phrasing-content，浏览器会自动闭合 `<p>`。validateHtmlNesting 只给开发期警告，
  // 不会阻止这里字符串化；当前退出规则尚未覆盖这一情况。
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
        // 会改变表单选择比较语义。当前对非静态 value 表达式统一退出，连 `:value="'one'"`
        // 这样的字符串常量绑定也包括在内；普通 `value="1"` 属性可以字符串化。
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

/** 把一个通过当前字符串化检查的静态 AST 节点序列化为 HTML 片段。 */
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
 * 在编译期求值已通过常量分析和字符串化检查的表达式。
 *
 * __UNSAFE__：这里使用 `new Function` 执行表达式。候选由 compiler-core 的 constType
 * 和 analyzeNode 筛选，但这不是统一排除函数调用的规则；没有外部标识符的
 * `(() => 'x')()` 也可能被标为 CAN_STRINGIFY，并在这里执行。
 * 返回值不保证在运行时是 string：简单表达式可求得数组/对象/布尔值，由调用方进行
 * class/style 规范化、展示字符串化或 HTML 转义。求值异常直接向编译调用方传播。
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
