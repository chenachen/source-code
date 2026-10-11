import { describe, expect, test } from 'vitest'
import { type DefaultTreeAdapterMap, parseFragment } from 'parse5'
import { getNodeAssetAttributes } from '../assetSource'

describe('getNodeAssetAttributes', () => {
  /** 把单个 HTML 片段解析成带源码位置的 element，供属性扫描断言。 */
  const getNode = (html: string) => {
    const ast = parseFragment(html, { sourceCodeLocationInfo: true })
    return ast.childNodes[0] as DefaultTreeAdapterMap['element']
  }

  /** 场景：img 元素只有 src 资源属性；验证目标：识别为单 URL，并保留完整属性上下文与精确源码偏移。 */
  test('handles img src', () => {
    const node = getNode('<img src="foo.jpg">')
    const attrs = getNodeAssetAttributes(node)
    expect(attrs).toHaveLength(1)
    expect(attrs[0]).toHaveProperty('type', 'src')
    expect(attrs[0]).toHaveProperty('key', 'src')
    expect(attrs[0]).toHaveProperty('value', 'foo.jpg')
    expect(attrs[0].attributes).toEqual({ src: 'foo.jpg' })
    expect(attrs[0].location).toHaveProperty('startOffset', 5)
    expect(attrs[0].location).toHaveProperty('endOffset', 18)
  })

  /** 场景：source 元素提供 srcset 候选列表；验证目标：把该属性标记为 srcset，交给专用解析器分项重写。 */
  test('handles source srcset', () => {
    const node = getNode('<source srcset="foo.jpg 1x, bar.jpg 2x">')
    const attrs = getNodeAssetAttributes(node)
    expect(attrs).toHaveLength(1)
    expect(attrs[0]).toHaveProperty('type', 'srcset')
    expect(attrs[0]).toHaveProperty('key', 'srcset')
    expect(attrs[0]).toHaveProperty('value', 'foo.jpg 1x, bar.jpg 2x')
    expect(attrs[0].attributes).toEqual({ srcset: 'foo.jpg 1x, bar.jpg 2x' })
  })

  /** 场景：video 同时声明 src 与 poster；验证目标：返回两个独立资源动作，并让它们共享元素属性上下文。 */
  test('handles video src and poster', () => {
    const node = getNode('<video src="video.mp4" poster="poster.jpg">')
    const attrs = getNodeAssetAttributes(node)
    expect(attrs).toHaveLength(2)
    expect(attrs[0]).toHaveProperty('type', 'src')
    expect(attrs[0]).toHaveProperty('key', 'src')
    expect(attrs[0]).toHaveProperty('value', 'video.mp4')
    expect(attrs[0].attributes).toEqual({
      src: 'video.mp4',
      poster: 'poster.jpg',
    })
    expect(attrs[1]).toHaveProperty('type', 'src')
    expect(attrs[1]).toHaveProperty('key', 'poster')
    expect(attrs[1]).toHaveProperty('value', 'poster.jpg')
  })

  /** 场景：link 元素声明 href 与 rel；验证目标：把 href 作为默认资源源，并保留 rel 供后续判断。 */
  test('handles link with allowed rel', () => {
    const node = getNode('<link rel="stylesheet" href="style.css">')
    const attrs = getNodeAssetAttributes(node)
    expect(attrs).toHaveLength(1)
    expect(attrs[0]).toHaveProperty('type', 'src')
    expect(attrs[0]).toHaveProperty('key', 'href')
    expect(attrs[0]).toHaveProperty('value', 'style.css')
    expect(attrs[0].attributes).toEqual({
      rel: 'stylesheet',
      href: 'style.css',
    })
  })

  /** 场景：meta.name 是 twitter:image 白名单项；验证目标：把 content 识别为资源 URL。 */
  test('handles meta with allowed name', () => {
    const node = getNode('<meta name="twitter:image" content="image.jpg">')
    const attrs = getNodeAssetAttributes(node)
    expect(attrs).toHaveLength(1)
    expect(attrs[0]).toHaveProperty('type', 'src')
    expect(attrs[0]).toHaveProperty('key', 'content')
    expect(attrs[0]).toHaveProperty('value', 'image.jpg')
  })

  /** 场景：meta.property 是受支持的 Open Graph 图像项；验证目标：把 content 识别为资源 URL。 */
  test('handles meta with allowed property', () => {
    const node = getNode('<meta property="og:image" content="image.jpg">')
    const attrs = getNodeAssetAttributes(node)
    expect(attrs).toHaveLength(1)
    expect(attrs[0]).toHaveProperty('type', 'src')
    expect(attrs[0]).toHaveProperty('key', 'content')
    expect(attrs[0]).toHaveProperty('value', 'image.jpg')
  })

  /** 场景：meta.name 不在资源白名单；验证目标：不把可能是普通文本的 content 误写为构建资源。 */
  test('does not handle meta with unknown name', () => {
    const node = getNode('<meta name="unknown" content="image.jpg">')
    const attrs = getNodeAssetAttributes(node)
    expect(attrs).toHaveLength(0)
  })

  /** 场景：Open Graph property 不在资源白名单；验证目标：不为该 content 生成资源动作。 */
  test('does not handle meta with unknown property', () => {
    const node = getNode('<meta property="unknown" content="image.jpg">')
    const attrs = getNodeAssetAttributes(node)
    expect(attrs).toHaveLength(0)
  })

  /** 场景：meta 有 content 但缺少 name/property 上下文；验证目标：忽略该属性，避免无条件把内容当 URL。 */
  test('does not handle meta with no known properties', () => {
    const node = getNode('<meta foo="bar" content="image.jpg">')
    const attrs = getNodeAssetAttributes(node)
    expect(attrs).toHaveLength(0)
  })

  describe('with additionalAssetSources', () => {
    /** 场景：自定义元素只通过配置声明 srcAttributes；验证目标：默认无动作，配置后才识别指定 src。 */
    test('handles custom element with additional asset source', () => {
      const node = getNode('<html-import src="./file.html"></html-import>')
      expect(getNodeAssetAttributes(node)).toHaveLength(0)
      const attrs = getNodeAssetAttributes(node, {
        'html-import': { srcAttributes: ['src'] },
      })
      expect(attrs).toHaveLength(1)
      expect(attrs[0]).toHaveProperty('type', 'src')
      expect(attrs[0]).toHaveProperty('key', 'src')
      expect(attrs[0]).toHaveProperty('value', './file.html')
    })

    /** 场景：为 img 扩展 data-* 资源属性；验证目标：扩展规则追加到默认 src，而不是替换默认行为。 */
    test('handles data-* attributes with additional asset source', () => {
      const node = getNode('<img src="default.png" data-src-dark="dark.png">')
      const defaultAttrs = getNodeAssetAttributes(node)
      expect(defaultAttrs).toHaveLength(1)
      expect(defaultAttrs[0]).toHaveProperty('key', 'src')
      const attrs = getNodeAssetAttributes(node, {
        img: { srcAttributes: ['data-src-dark'] },
      })
      expect(attrs).toHaveLength(2)
      expect(attrs[0]).toHaveProperty('key', 'src')
      expect(attrs[0]).toHaveProperty('value', 'default.png')
      expect(attrs[1]).toHaveProperty('key', 'data-src-dark')
      expect(attrs[1]).toHaveProperty('value', 'dark.png')
    })

    /** 场景：自定义配置把属性声明为 srcset；验证目标：返回 srcset 类型动作，供后续按候选列表处理。 */
    test('additional source with srcset attribute', () => {
      const node = getNode(
        '<my-picture data-srcset="small.jpg 1x, large.jpg 2x">',
      )
      const attrs = getNodeAssetAttributes(node, {
        'my-picture': { srcsetAttributes: ['data-srcset'] },
      })
      expect(attrs).toHaveLength(1)
      expect(attrs[0]).toHaveProperty('type', 'srcset')
      expect(attrs[0]).toHaveProperty('key', 'data-srcset')
    })

    /** 场景：同一资源属性配置了依据兄弟 type 的 filter；验证目标：只在过滤器命中时返回动作。 */
    test('additional source with filter function', () => {
      const node = getNode('<my-component type="image" asset="photo.jpg">')
      const attrs = getNodeAssetAttributes(node, {
        'my-component': {
          srcAttributes: ['asset'],
          /** 只接纳兄弟 type 属性为 image 的自定义 asset。 */
          filter: ({ attributes }) => attributes.type === 'image',
        },
      })
      expect(attrs).toHaveLength(1)
      expect(attrs[0]).toHaveProperty('value', 'photo.jpg')
      const node2 = getNode('<my-component type="text" asset="data.txt">')
      const attrs2 = getNodeAssetAttributes(node2, {
        'my-component': {
          srcAttributes: ['asset'],
          /** 只接纳兄弟 type 属性为 image 的自定义 asset。 */
          filter: ({ attributes }) => attributes.type === 'image',
        },
      })
      expect(attrs2).toHaveLength(0)
    })

    /** 场景：meta 默认过滤器与用户 data-fallback 过滤器同时命中；验证目标：两个有效属性都返回且各自保持规则语义。 */
    test('default filter and additional filter are applied independently', () => {
      const node = getNode(
        '<meta name="twitter:image" content="image.jpg" data-fallback="fallback.jpg">',
      )
      const attrs = getNodeAssetAttributes(node, {
        meta: {
          srcAttributes: ['data-fallback'],
          /** 只接纳新增 data-fallback；默认 content 的规则另行执行。 */
          filter: ({ key }) => key === 'data-fallback',
        },
      })
      expect(attrs).toHaveLength(2)
      expect(attrs[0]).toHaveProperty('key', 'content')
      expect(attrs[0]).toHaveProperty('value', 'image.jpg')
      expect(attrs[1]).toHaveProperty('key', 'data-fallback')
      expect(attrs[1]).toHaveProperty('value', 'fallback.jpg')
    })

    /** 额外规则只声明不存在的 data-custom 属性，因此 filter=true 仍不处理默认规则跳过的 content。 */
    test('additional filter does not affect default filter behavior', () => {
      const node = getNode('<meta name="unknown" content="image.jpg">')
      const defaultAttrs = getNodeAssetAttributes(node)
      expect(defaultAttrs).toHaveLength(0)

      const attrs = getNodeAssetAttributes(node, {
        meta: {
          srcAttributes: ['data-custom'],
          /** 允许扩展规则声明的属性；该元素缺少 data-custom，仍不会产生动作。 */
          filter: () => true,
        },
      })
      expect(attrs).toHaveLength(0)
    })

    /** 场景：没有任何用户扩展配置；验证目标：继续识别 Vite 默认 img.src，保持向后兼容。 */
    test('works without additionalAssetSources (backward compatibility)', () => {
      const node = getNode('<img src="foo.jpg">')
      const attrs = getNodeAssetAttributes(node)
      expect(attrs).toHaveLength(1)
      expect(attrs[0]).toHaveProperty('key', 'src')
    })
  })
})
