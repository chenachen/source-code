import { freeze } from './utils.js';

/**
 * 默认 HTML 元素目录。
 *
 * @remarks
 * 上游由默认配置和 `USE_PROFILES.html` 读取；下游经 `addToSet()` 转成
 * `ALLOWED_TAGS` 查询表。目录表示可进入后续检查的候选元素，不会绕过显式禁用、
 * 命名空间或结构威胁检查。
 */
export const html = freeze([
  'a',
  'abbr',
  'acronym',
  'address',
  'area',
  'article',
  'aside',
  'audio',
  'b',
  'bdi',
  'bdo',
  'big',
  'blink',
  'blockquote',
  'body',
  'br',
  'button',
  'canvas',
  'caption',
  'center',
  'cite',
  'code',
  'col',
  'colgroup',
  'content',
  'data',
  'datalist',
  'dd',
  'decorator',
  'del',
  'details',
  'dfn',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'element',
  'em',
  'fieldset',
  'figcaption',
  'figure',
  'font',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'i',
  'img',
  'input',
  'ins',
  'kbd',
  'label',
  'legend',
  'li',
  'main',
  'map',
  'mark',
  'marquee',
  'menu',
  'menuitem',
  'meter',
  'nav',
  'nobr',
  'ol',
  'optgroup',
  'option',
  'output',
  'p',
  'picture',
  'pre',
  'progress',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'search',
  'section',
  'select',
  'shadow',
  'slot',
  'small',
  'source',
  'spacer',
  'span',
  'strike',
  'strong',
  'style',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'template',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'track',
  'tt',
  'u',
  'ul',
  'var',
  'video',
  'wbr',
] as const);

/**
 * 默认允许的 SVG 元素目录，不含 SVG Filter 专属元素。
 *
 * @remarks
 * 上游由默认配置和 `USE_PROFILES.svg` 读取；下游既参与允许表构造，也参与 SVG
 * 命名空间分类。支持 `Object.freeze` 时共享预设被冻结，名称在查询表构造时统一转为
 * 小写。
 */
export const svg = freeze([
  'svg',
  'a',
  'altglyph',
  'altglyphdef',
  'altglyphitem',
  'animatecolor',
  'animatemotion',
  'animatetransform',
  'circle',
  'clippath',
  'defs',
  'desc',
  'ellipse',
  'enterkeyhint',
  'exportparts',
  'filter',
  'font',
  'g',
  'glyph',
  'glyphref',
  'hkern',
  'image',
  'inputmode',
  'line',
  'lineargradient',
  'marker',
  'mask',
  'metadata',
  'mpath',
  'part',
  'path',
  'pattern',
  'polygon',
  'polyline',
  'radialgradient',
  'rect',
  'stop',
  'style',
  'switch',
  'symbol',
  'text',
  'textpath',
  'title',
  'tref',
  'tspan',
  'view',
  'vkern',
] as const);

/**
 * `USE_PROFILES.svgFilters` 启用的 SVG Filter 元素目录。
 *
 * @remarks
 * 默认配置也会包含这些元素。源名称保留 SVG 规范中的大小写，进入查询表时由
 * `addToSet()` 统一转为小写；属性目录复用 `ATTRS.svg` 与 `ATTRS.xml`。
 */
export const svgFilters = freeze([
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feConvolveMatrix',
  'feDiffuseLighting',
  'feDisplacementMap',
  'feDistantLight',
  'feDropShadow',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feImage',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'fePointLight',
  'feSpecularLighting',
  'feSpotLight',
  'feTile',
  'feTurbulence',
] as const);

/**
 * 默认不进入允许表、但必须纳入 SVG 命名空间分类的元素目录。
 *
 * @remarks
 * 核心将它与 `svg`、`svgFilters` 合并为“全部已知 SVG 元素”，使调用方通过
 * `ADD_TAGS` 显式放行时仍能接受正确命名空间。该目录本身不是独立禁用表，不能取代
 * `FORBID_TAGS`。
 */
export const svgDisallowed = freeze([
  'animate',
  'color-profile',
  'cursor',
  'discard',
  'font-face',
  'font-face-format',
  'font-face-name',
  'font-face-src',
  'font-face-uri',
  'foreignobject',
  'hatch',
  'hatchpath',
  'mesh',
  'meshgradient',
  'meshpatch',
  'meshrow',
  'missing-glyph',
  'script',
  'set',
  'solidcolor',
  'unknown',
  'use',
] as const);

/**
 * 默认允许的 MathML 元素目录。
 *
 * @remarks
 * 上游由默认配置和 `USE_PROFILES.mathMl` 读取；下游参与允许表及 MathML 命名空间
 * 分类。启用配置档时核心还会合并 XML 属性目录和 MathML 文本集成点。
 */
export const mathMl = freeze([
  'math',
  'menclose',
  'merror',
  'mfenced',
  'mfrac',
  'mglyph',
  'mi',
  'mlabeledtr',
  'mmultiscripts',
  'mn',
  'mo',
  'mover',
  'mpadded',
  'mphantom',
  'mroot',
  'mrow',
  'ms',
  'mspace',
  'msqrt',
  'mstyle',
  'msub',
  'msup',
  'msubsup',
  'mtable',
  'mtd',
  'mtext',
  'mtr',
  'munder',
  'munderover',
  'mprescripts',
] as const);

/**
 * 默认不进入允许表、但必须纳入 MathML 命名空间分类的元素目录。
 *
 * @remarks
 * 与 `mathMl` 合并后用于识别全部已知 MathML 元素，支持调用方显式添加标签后的
 * 命名空间校验；它不是运行时独立禁用表。当前 `mprescripts` 同时存在于允许目录，
 * 因而“Disallowed”名称不能解释为对每个成员的最终拒绝结论。
 */
export const mathMlDisallowed = freeze([
  'maction',
  'maligngroup',
  'malignmark',
  'mlongdiv',
  'mscarries',
  'mscarry',
  'msgroup',
  'mstack',
  'msline',
  'msrow',
  'semantics',
  'annotation',
  'annotation-xml',
  'mprescripts',
  'none',
] as const);

/**
 * 文本节点在标签查询表中的内部哨兵名称。
 *
 * @remarks
 * 默认配置和任意 `USE_PROFILES` 组合都以它为基线；`KEEP_CONTENT` 也会确保该键存在，
 * 使移除父元素后保留的文本仍可继续遍历。
 */
export const text = freeze(['#text'] as const);
