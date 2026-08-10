import type { DefaultTreeAdapterMap, Token } from 'parse5'

/**
 * 定义某类 HTML 元素中哪些属性应按资源 URL 处理，供 `html.additionalAssetSources` 扩展
 * 自定义元素、data-* 属性或框架约定。
 */
export interface HtmlAssetSource {
  /**
   * 包含单个资源 URL 的属性。
   * @example ['src', 'data-src-dark']
   */
  srcAttributes?: string[]
  /**
   * 包含 srcset 格式候选列表的属性。
   * @example ['srcset', 'imagesrcset']
   */
  srcsetAttributes?: string[]
  /**
   * 每个候选属性处理前调用；可结合元素全部属性决定是否把当前值视为资源。
   */
  filter?: (data: HtmlAssetSourceFilterData) => boolean
}

/** asset source filter 的当前属性与完整元素属性快照。 */
interface HtmlAssetSourceFilterData {
  /** 当前待判断的规范化属性名。 */
  key: string
  /** 当前属性值。 */
  value: string
  /** 元素全部属性，含 namespace 前缀。 */
  attributes: Record<string, string>
}

// 只有规范明确表示图像/配置 URL 的 meta name 才处理 content，避免把任意 metadata 文本误当资源：
// https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta/name
// https://wiki.whatwg.org/wiki/MetaExtensions
const ALLOWED_META_NAME = [
  'msapplication-tileimage',
  'msapplication-square70x70logo',
  'msapplication-square150x150logo',
  'msapplication-wide310x150logo',
  'msapplication-square310x310logo',
  'msapplication-config',
  'twitter:image',
]

// Open Graph 中明确使用 URL 的媒体 property 白名单：
// https://ogp.me
const ALLOWED_META_PROPERTY = [
  'og:image',
  'og:image:url',
  'og:image:secure_url',
  'og:audio',
  'og:audio:secure_url',
  'og:video',
  'og:video:secure_url',
]

/** HTML/SVG 内建元素的默认资源属性表；扩展配置会追加而非替换这些规则。 */
const DEFAULT_HTML_ASSET_SOURCES: Record<string, HtmlAssetSource> = {
  audio: {
    srcAttributes: ['src'],
  },
  embed: {
    srcAttributes: ['src'],
  },
  img: {
    srcAttributes: ['src'],
    srcsetAttributes: ['srcset'],
  },
  image: {
    srcAttributes: ['href', 'xlink:href'],
  },
  input: {
    srcAttributes: ['src'],
  },
  link: {
    srcAttributes: ['href'],
    srcsetAttributes: ['imagesrcset'],
  },
  object: {
    srcAttributes: ['data'],
  },
  source: {
    srcAttributes: ['src'],
    srcsetAttributes: ['srcset'],
  },
  track: {
    srcAttributes: ['src'],
  },
  use: {
    srcAttributes: ['href', 'xlink:href'],
  },
  video: {
    srcAttributes: ['src', 'poster'],
  },
  meta: {
    srcAttributes: ['content'],
    /** 只把允许携带预加载或社交媒体资源 URL 的 meta 元素视为资源来源。 */
    filter({ attributes }) {
      if (
        attributes.name &&
        ALLOWED_META_NAME.includes(attributes.name.trim().toLowerCase())
      ) {
        return true
      }

      if (
        attributes.property &&
        ALLOWED_META_PROPERTY.includes(attributes.property.trim().toLowerCase())
      ) {
        return true
      }

      return false
    },
  },
}

/** HTML transform 对单个资源属性采取的动作及其精确源码位置。 */
interface HtmlAssetAttribute {
  /** 单 URL、srcset 候选列表，或只删除控制属性。 */
  type: 'src' | 'srcset' | 'remove'
  /** 含 namespace 前缀的属性名。 */
  key: string
  /** parse5 解码后的属性值。 */
  value: string
  /** 供 filter 与后续 HTML hook 查看同元素上下文的属性快照。 */
  attributes: Record<string, string>
  /** MagicString 替换/删除使用的 parse5 精确区间。 */
  location: Token.Location
}

/**
 * 扫描一个 parse5 元素节点，返回需由 HTML transform 重写的默认及用户扩展资源属性。
 * 元素级忽略控制属性优先返回 remove 动作并短路全部 URL 处理，使最终 HTML
 * 去掉控制标记但保留原 URL。
 */
export function getNodeAssetAttributes(
  node: DefaultTreeAdapterMap['element'],
  additionalAssetSources?: Record<string, HtmlAssetSource>,
): HtmlAssetAttribute[] {
  const defaults = DEFAULT_HTML_ASSET_SOURCES[node.nodeName]
  const additional = additionalAssetSources?.[node.nodeName]

  if (!defaults && !additional) return []

  const attributes: Record<string, string> = {}
  for (const attr of node.attrs) {
    attributes[getAttrKey(attr)] = attr.value
  }

  // vite-ignore 是元素级短路：只删除控制属性，其他 src/srcset 原样留给浏览器或用户 runtime。
  if ('vite-ignore' in attributes) {
    return [
      {
        type: 'remove',
        key: 'vite-ignore',
        value: '',
        attributes,
        location: node.sourceCodeLocation!.attrs!['vite-ignore'],
      },
    ]
  }

  const actions: HtmlAssetAttribute[] = []
  /** 统一执行空值、filter 与 location 检查，并记录后续重写动作。 */
  function handleAttributeKey(
    key: string,
    type: 'src' | 'srcset',
    filter?: (data: HtmlAssetSourceFilterData) => boolean,
  ) {
    const value = attributes[key]
    if (!value) return
    if (filter && !filter({ key, value, attributes })) return
    const location = node.sourceCodeLocation!.attrs![key]
    actions.push({ type, key, value, attributes, location })
  }

  // 默认规则先执行，保证返回顺序稳定并保持旧行为。
  if (defaults) {
    defaults.srcAttributes?.forEach((key) =>
      handleAttributeKey(key, 'src', defaults.filter),
    )
    defaults.srcsetAttributes?.forEach((key) =>
      handleAttributeKey(key, 'srcset', defaults.filter),
    )
  }

  // 用户规则独立追加；其 filter 不得覆盖或放宽默认 meta 等规则（#21412）。
  if (additional) {
    additional.srcAttributes?.forEach((key) =>
      handleAttributeKey(key, 'src', additional.filter),
    )
    additional.srcsetAttributes?.forEach((key) =>
      handleAttributeKey(key, 'srcset', additional.filter),
    )
  }

  return actions
}

/** 还原 SVG `xlink:href` 等带 namespace 前缀的属性键。 */
function getAttrKey(attr: Token.Attribute): string {
  return attr.prefix === undefined ? attr.name : `${attr.prefix}:${attr.name}`
}
