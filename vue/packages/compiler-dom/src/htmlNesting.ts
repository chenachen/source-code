/**
 * 依据 ISC 许可复制自 https://github.com/MananTank/validate-html-nesting 。
 * 为避免增加 validate-html-nesting 运行时依赖而内置；上游规则通常较稳定，但仍需定期同步。
 */

/**
 * 判断给定父子标签能否形成稳定、合法的 HTML 嵌套。
 *
 * 浏览器会自动改写非法结构，例如把 `<div>` 移出 `<p>` 或给 `<tr>` 补 `<tbody>`；
 * 服务端输出与浏览器纠正后的 DOM 不一致时就会产生 hydration 警告甚至节点错配。
 */
export function isValidHTMLNesting(parent: string, child: string): boolean {
  // template 的内容存放在 DocumentFragment，不受普通元素父子限制。
  if (parent === 'template') {
    return true
  }

  // 若父标签有“唯一允许子元素”白名单，必须命中白名单。
  if (parent in onlyValidChildren) {
    return onlyValidChildren[parent].has(child)
  }

  // 若子标签有“唯一允许父元素”白名单，父标签必须命中。
  if (child in onlyValidParents) {
    return onlyValidParents[child].has(parent)
  }

  // 没有严格白名单时，再检查已知的非法子元素黑名单。
  if (parent in knownInvalidChildren) {
    if (knownInvalidChildren[parent].has(child)) return false
  }

  // 最后检查子元素对应的非法父元素黑名单。
  if (child in knownInvalidParents) {
    if (knownInvalidParents[child].has(parent)) return false
  }

  return true
}

/** 所有标题元素；标题之间不能相互嵌套。 */
const headings = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
/** 表示某类元素不能包含任何元素子节点，或没有合法父元素。 */
const emptySet = new Set([])

/** 父元素到“仅允许这些子元素”的严格白名单映射。 */
const onlyValidChildren: Record<string, Set<string>> = {
  head: new Set([
    'base',
    'basefront',
    'bgsound',
    'link',
    'meta',
    'title',
    'noscript',
    'noframes',
    'style',
    'script',
    'template',
  ]),
  optgroup: new Set(['option']),
  select: new Set(['optgroup', 'option', 'hr']),
  // 表格结构由浏览器 HTML parser 严格纠正，因此需要精确限制层级。
  table: new Set(['caption', 'colgroup', 'tbody', 'tfoot', 'thead']),
  tr: new Set(['td', 'th']),
  colgroup: new Set(['col']),
  tbody: new Set(['tr']),
  thead: new Set(['tr']),
  tfoot: new Set(['tr']),
  // 这些元素不能包含元素子节点。
  script: emptySet,
  iframe: emptySet,
  option: emptySet,
  textarea: emptySet,
  style: emptySet,
  title: emptySet,
}

/** 子元素到“仅允许这些父元素”的严格白名单映射。 */
const onlyValidParents: Record<string, Set<string>> = {
  // 文档结构
  html: emptySet,
  body: new Set(['html']),
  head: new Set(['html']),
  // 表格结构
  td: new Set(['tr']),
  colgroup: new Set(['table']),
  caption: new Set(['table']),
  tbody: new Set(['table']),
  tfoot: new Set(['table']),
  col: new Set(['colgroup']),
  th: new Set(['tr']),
  thead: new Set(['table']),
  tr: new Set(['tbody', 'thead', 'tfoot']),
  // 描述列表
  dd: new Set(['dl', 'div']),
  dt: new Set(['dl', 'div']),
  // 其他特殊父子约束
  figcaption: new Set(['figure']),
  // li: new Set(["ul", "ol"]),
  summary: new Set(['details']),
  area: new Set(['map']),
} as const

/** 父元素到“禁止作为其子元素”的黑名单映射；未列出的子元素仍允许。 */
const knownInvalidChildren: Record<string, Set<string>> = {
  p: new Set([
    'address',
    'article',
    'aside',
    'blockquote',
    'center',
    'details',
    'dialog',
    'dir',
    'div',
    'dl',
    'fieldset',
    'figure',
    'footer',
    'form',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'header',
    'hgroup',
    'hr',
    'li',
    'main',
    'nav',
    'menu',
    'ol',
    'p',
    'pre',
    'section',
    'table',
    'ul',
  ]),
  svg: new Set([
    'b',
    'blockquote',
    'br',
    'code',
    'dd',
    'div',
    'dl',
    'dt',
    'em',
    'embed',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'i',
    'img',
    'li',
    'menu',
    'meta',
    'ol',
    'p',
    'pre',
    'ruby',
    's',
    'small',
    'span',
    'strong',
    'sub',
    'sup',
    'table',
    'u',
    'ul',
    'var',
  ]),
} as const

/** 子元素到“禁止作为其父元素”的黑名单映射；用于阻止同类元素嵌套等场景。 */
const knownInvalidParents: Record<string, Set<string>> = {
  a: new Set(['a']),
  button: new Set(['button']),
  dd: new Set(['dd', 'dt']),
  dt: new Set(['dd', 'dt']),
  form: new Set(['form']),
  li: new Set(['li']),
  h1: headings,
  h2: headings,
  h3: headings,
  h4: headings,
  h5: headings,
  h6: headings,
}
