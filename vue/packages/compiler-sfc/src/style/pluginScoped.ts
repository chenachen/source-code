import {
  type AtRule,
  type Container,
  type Document,
  type PluginCreator,
  Rule,
} from 'postcss'
import selectorParser from 'postcss-selector-parser'
import { warn } from '../warn'

/** 匹配含浏览器前缀的 animation-name 属性。 */
const animationNameRE = /^(?:-\w+-)?animation-name$/
/** 匹配含浏览器前缀的 animation 简写属性。 */
const animationRE = /^(?:-\w+-)?animation$/
/** 匹配含浏览器前缀的 keyframes at-rule。 */
const keyframesRE = /^(?:-\w+-)?keyframes$/

/**
 * 创建 scoped CSS PostCSS 插件。
 *
 * 普通选择器会注入组件属性 `[data-v-id]`；`:slotted()` 使用 `[data-v-id-s]`；
 * `:deep()`/`:global()` 控制注入边界。keyframes 同时追加组件短 id，并重写本块内动画引用，
 * 避免不同组件的同名动画互相覆盖。
 */
const scopedPlugin: PluginCreator<string> = (id = '') => {
  const keyframes = Object.create(null)
  const shortId = id.replace(/^data-v-/, '')

  return {
    postcssPlugin: 'vue-sfc-scoped',
    /** 为普通选择器及 deep/slotted/global 语法注入正确的 scope 属性。 */
    Rule(rule) {
      processRule(id, rule)
    },
    /** 给 keyframes 名追加组件后缀，并保存名称映射供动画声明重写。 */
    AtRule(node) {
      if (keyframesRE.test(node.name) && !node.params.endsWith(`-${shortId}`)) {
        // 记录原名→作用域名；已带当前后缀的 keyframes 不重复处理。
        keyframes[node.params] = node.params = node.params + '-' + shortId
      }
    },
    /** 所有规则处理完后，按已收集 keyframes 映射重写 animation 声明。 */
    OnceExit(root) {
      if (Object.keys(keyframes).length) {
        // 只重写同一 style block 内能看到的动画声明；跨 block 引用没有可靠的局部映射。
        // 先处理独立 animation-name，再处理简写中可能出现的名称项。
        root.walkDecls(decl => {
          if (animationNameRE.test(decl.prop)) {
            decl.value = decl.value
              .split(',')
              .map(v => keyframes[v.trim()] || v.trim())
              .join(',')
          }
          // 简写值还含 duration/easing 等，只替换能命中 keyframes 表的 token。
          if (animationRE.test(decl.prop)) {
            decl.value = decl.value
              .split(',')
              .map(v => {
                const vals = v.trim().split(/\s+/)
                const i = vals.findIndex(val => keyframes[val])
                if (i !== -1) {
                  vals.splice(i, 1, keyframes[vals[i]])
                  return vals.join(' ')
                } else {
                  return v
                }
              })
              .join(',')
          }
        })
      }
    },
  }
}

/** 已处理规则集合，防止拆分/包装嵌套规则后被 PostCSS 再次访问并重复注入 scopeId。 */
const processedRules = new WeakSet<Rule>()

/** 跳过 keyframes 内部规则，解析选择器并对每个逗号分支执行作用域改写。 */
function processRule(id: string, rule: Rule) {
  if (
    processedRules.has(rule) ||
    (rule.parent &&
      rule.parent.type === 'atrule' &&
      keyframesRE.test((rule.parent as AtRule).name))
  ) {
    return
  }
  processedRules.add(rule)
  let deep = false
  // CSS nesting 中，外层规则一旦标记 deep，内层规则也处于 deep 上下文，不能再次在
  // 错误位置注入 scope 属性。
  let parent: Document | Container | undefined = rule.parent
  while (parent && parent.type !== 'root') {
    if ((parent as any).__deep) {
      deep = true
      break
    }
    parent = parent.parent
  }
  rule.selector = selectorParser(selectorRoot => {
    selectorRoot.each(selector => {
      rewriteSelector(id, rule, selector, selectorRoot, deep)
    })
  }).processSync(rule.selector)
}

/**
 * 重写单条 selector，把 scope 属性插到最后一个仍属于当前组件的选择器节点之后。
 *
 * 关键点是确定边界：`:deep(inner)` 的 inner 属于后代组件，`:slotted(inner)` 属于传入
 * 插槽，`:global(inner)` 完全不加 scope。`:is/:where/:has/:not` 中嵌套 deep 时还可能需要
 * 拆成多条 selector，避免一个分支的 deep 状态污染其他分支。
 */
function rewriteSelector(
  id: string,
  rule: Rule,
  selector: selectorParser.Selector,
  selectorRoot: selectorParser.Root,
  deep: boolean,
  slotted = false,
) {
  let node: selectorParser.Node | null = null
  let shouldInject = !deep
  let hasNestedDeep = false
  let splitForNestedDeep = false
  // 遍历后保存最后一个可挂载 `[id]` 的节点；deep 之前的节点是作用域锚点。
  selector.each(n => {
    // 旧版 `>>>` / `/deep/` 等价为空格后代组合符，但给出迁移警告。
    if (
      n.type === 'combinator' &&
      (n.value === '>>>' || n.value === '/deep/')
    ) {
      n.value = ' '
      n.spaces.before = n.spaces.after = ''
      warn(
        `the >>> and /deep/ combinators have been deprecated. ` +
          `Use :deep() instead.`,
      )
      return false
    }

    if (n.type === 'pseudo') {
      const { value } = n
      if (isDeepContainerPseudo(n)) {
        const hasDeepSelectors = n.nodes.some(selector =>
          selector.some(isDeepSelector),
        )
        if (hasDeepSelectors) {
          const hasScopeAnchor = !!node
          const hasMixedSelectors = n.nodes.some(
            selector => !selector.some(isDeepSelector),
          )
          const hasTrailingNodes = selector.index(n) < selector.length - 1
          if (
            canSplitDeepContainerPseudo(n) &&
            !deep &&
            !hasScopeAnchor &&
            hasMixedSelectors &&
            hasTrailingNodes
          ) {
            splitSelectorForNestedDeep(
              id,
              rule,
              selector,
              selectorRoot,
              n,
              deep,
              slotted,
            )
            splitForNestedDeep = true
            return false
          }

          if (
            value === ':not' &&
            !deep &&
            !hasScopeAnchor &&
            hasMixedSelectors &&
            hasTrailingNodes
          ) {
            return
          }

          n.nodes.forEach(selector =>
            rewriteSelector(
              id,
              rule,
              selector,
              selectorRoot,
              deep || hasScopeAnchor,
              slotted,
            ),
          )
          if (!hasScopeAnchor) {
            node = n
            shouldInject = false
          }
          hasNestedDeep = true
        }
      }

      // deep 的 scope 属性应注入到 :deep 之前的组件自身锚点，而非其内部后代。
      if (value === ':deep' || value === '::v-deep') {
        ;(rule as any).__deep = true
        if (n.nodes.length) {
          // `.foo :deep(.bar)` → `.foo[data-v-id] .bar`：展开内部 selector。
          let last: selectorParser.Selector['nodes'][0] = n
          n.nodes[0].each(ss => {
            selector.insertAfter(last, ss)
            last = ss
          })
          // deep 参数与锚点之间必须是后代关系；原本没有空格组合符时补一个。
          const prev = selector.at(selector.index(n) - 1)
          if (!prev || !isSpaceCombinator(prev)) {
            selector.insertAfter(
              n,
              selectorParser.combinator({
                value: ' ',
              }),
            )
          }
          selector.removeChild(n)
        } else {
          // 兼容已废弃的组合符写法 `.foo ::v-deep .bar`，并提示迁移到函数形式。
          warn(
            `${value} usage as a combinator has been deprecated. ` +
              `Use :deep(<inner-selector>) instead of ${value} <inner-selector>.`,
          )

          const prev = selector.at(selector.index(n) - 1)
          if (prev && isSpaceCombinator(prev)) {
            selector.removeChild(prev)
          }
          selector.removeChild(n)
        }
        return false
      }

      // `:slotted(.foo)` → `.foo[data-v-id-s]`。插槽内容由子组件额外写入 `-s` 属性。
      if (value === ':slotted' || value === '::v-slotted') {
        rewriteSelector(
          id,
          rule,
          n.nodes[0],
          selectorRoot,
          deep,
          true /* slotted */,
        )
        let last: selectorParser.Selector['nodes'][0] = n
        n.nodes[0].each(ss => {
          selector.insertAfter(last, ss)
          last = ss
        })
        selector.removeChild(n)
        // `-s` 已限定插槽归属，不能再注入普通 `[data-v-id]`，否则传入节点无法匹配。
        shouldInject = false
        return false
      }

      // `:global(.foo)` → `.foo`，展开后完全跳过当前选择器的 scope 属性。
      if (value === ':global' || value === '::v-global') {
        selector.replaceWith(n.nodes[0])
        return false
      }
    }

    if (n.type === 'universal') {
      const prev = selector.at(selector.index(n) - 1)
      const next = selector.at(selector.index(n) + 1)
      // 通配符本身无需保留：尽量把 scope 属性挂到随后更具体的节点。
      if (!prev) {
        // `* .foo` → `.foo[data-v-id]`（同时去掉多余前导空格）。
        if (next) {
          if (next.type === 'combinator' && next.value === ' ') {
            selector.removeChild(next)
          }
          selector.removeChild(n)
          return
        } else {
          // 单独 `*` → `[data-v-id]`，用空组合符作为插入锚点后删掉通配符。
          node = selectorParser.combinator({
            value: '',
          })
          selector.insertBefore(n, node)
          selector.removeChild(n)
          return false
        }
      }
      // `.foo *` 应作用域化 `.foo`，而不是把属性加到任意后代通配符上。
      if (node) return
    }

    if (
      !hasNestedDeep &&
      ((n.type !== 'pseudo' && n.type !== 'combinator') ||
        (n.type === 'pseudo' &&
          (n.value === ':is' || n.value === ':where') &&
          !node))
    ) {
      node = n
    }
  })

  if (splitForNestedDeep) {
    return
  }

  if (rule.nodes.some(node => node.type === 'rule')) {
    // CSS nesting 规则中混有裸声明时，将声明包进 `& {}`，确保 scope 属性应用在正确层级。
    const deep = (rule as any).__deep
    if (!deep) {
      extractAndWrapNodes(rule)
      const atruleNodes = rule.nodes.filter(node => node.type === 'atrule')
      for (const atnode of atruleNodes) {
        extractAndWrapNodes(atnode)
      }
    }
    shouldInject = deep
  }

  if (node && !hasNestedDeep) {
    const { type, value } = node as selectorParser.Node
    if (type === 'pseudo' && (value === ':is' || value === ':where')) {
      ;(node as selectorParser.Pseudo).nodes.forEach(value =>
        rewriteSelector(id, rule, value, selectorRoot, deep, slotted),
      )
      shouldInject = false
    }
  }

  if (node) {
    ;(node as selectorParser.Node).spaces.after = ''
  } else {
    // deep 或独立伪类没有普通锚点时，属性会插在选择器开头；必须去掉前导空格，
    // 否则会意外变成后代组合关系。
    selector.first.spaces.before = ''
  }

  if (shouldInject) {
    const idToAdd = slotted ? id + '-s' : id
    selector.insertAfter(
      // node 为 null 表示插到开头；postcss-selector-parser 的 insertAfter 支持该值。
      node as any,
      selectorParser.attribute({
        attribute: idToAdd,
        value: idToAdd,
        raws: {},
        quoteMark: `"`,
      }),
    )
  }
}

/** 判断节点是否为纯空白后代组合符。 */
function isSpaceCombinator(node: selectorParser.Node) {
  return node.type === 'combinator' && /^\s+$/.test(node.value)
}

/** 递归判断选择器节点或其参数中是否含 :deep。 */
function isDeepSelector(node: selectorParser.Node): boolean {
  if (
    node.type === 'pseudo' &&
    (node.value === ':deep' || node.value === '::v-deep')
  ) {
    return true
  }

  return !!(
    node as selectorParser.Node & {
      /** 容器伪类或选择器节点的嵌套参数节点。 */
      nodes?: selectorParser.Node[]
    }
  ).nodes?.some(child => isDeepSelector(child))
}

/** 判断伪类是否能以选择器列表为参数、因而可能在内部包含 :deep。 */
function isDeepContainerPseudo(
  node: selectorParser.Node,
): node is selectorParser.Pseudo {
  return (
    node.type === 'pseudo' &&
    (node.value === ':is' ||
      node.value === ':where' ||
      node.value === ':has' ||
      node.value === ':not')
  )
}

/**
 * 判断容器伪类能否安全拆为多个并列 selector。
 * `:not()` 的分支组合语义与并列展开不同，所以不能走普通拆分路径。
 */
function canSplitDeepContainerPseudo(node: selectorParser.Pseudo): boolean {
  return (
    node.value === ':is' || node.value === ':where' || node.value === ':has'
  )
}

/**
 * 将含 deep 与普通混合分支的 `:is/:where/:has` 克隆拆分，再逐支计算 scope 边界。
 * 若不拆分，一个分支设置的 deep 状态会让其他分支漏加或错加 `[data-v-id]`。
 */
function splitSelectorForNestedDeep(
  id: string,
  rule: Rule,
  selector: selectorParser.Selector,
  selectorRoot: selectorParser.Root,
  pseudo: selectorParser.Pseudo,
  deep: boolean,
  slotted: boolean,
) {
  const pseudoIndex = selector.index(pseudo)
  const selectors = pseudo.nodes.map((branch, index) => {
    const branchSelector = selector.clone()
    if (branchSelector.first) {
      branchSelector.first.spaces.before =
        index === 0 ? selector.first.spaces.before : ' '
    }
    const branchPseudo = branchSelector.at(pseudoIndex) as selectorParser.Pseudo
    const branchClone = branch.clone()
    if (branchClone.first) {
      branchClone.first.spaces.before = ''
    }
    branchPseudo.removeAll()
    branchPseudo.append(branchClone)
    rewriteSelector(id, rule, branchSelector, selectorRoot, deep, slotted)
    return branchSelector
  })

  selector.replaceWith(...selectors)
}

/** 把嵌套规则旁的裸声明/注释抽出并包装为 `&` 规则，保持 CSS nesting 语义。 */
function extractAndWrapNodes(parentNode: Rule | AtRule) {
  if (!parentNode.nodes) return
  const nodes = parentNode.nodes.filter(
    node => node.type === 'decl' || node.type === 'comment',
  )
  if (nodes.length) {
    for (const node of nodes) {
      parentNode.removeChild(node)
    }
    const wrappedRule = new Rule({
      nodes: nodes,
      selector: '&',
    })
    parentNode.prepend(wrappedRule)
  }
}

scopedPlugin.postcss = true
export default scopedPlugin
