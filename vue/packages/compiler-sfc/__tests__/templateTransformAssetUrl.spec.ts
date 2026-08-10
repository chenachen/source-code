/**
 * 模板资产 URL 场景：把相对静态 src/href 转成去重 import，保留外链/data/hash/动态绑定，
 * 覆盖 base、绝对路径、自定义标签配置、URL 查询/hash 与特殊字符解码。
 */
import {
  type TransformOptions,
  baseParse,
  generate,
  transform,
} from '@vue/compiler-core'
import {
  type AssetURLOptions,
  createAssetUrlTransformWithOptions,
  normalizeOptions,
  transformAssetUrl,
} from '../src/template/transformAssetUrl'
import { transformElement } from '../../compiler-core/src/transforms/transformElement'
import { transformBind } from '../../compiler-core/src/transforms/vBind'
import { stringifyStatic } from '../../compiler-dom/src/transforms/stringifyStatic'

/** 运行资产 URL、元素与 bind 转换，并按调用方选项生成最终模板代码。 */
function compileWithAssetUrls(
  template: string,
  options?: AssetURLOptions,
  transformOptions?: TransformOptions,
) {
  const ast = baseParse(template)
  const t = options
    ? createAssetUrlTransformWithOptions(normalizeOptions(options))
    : transformAssetUrl
  transform(ast, {
    nodeTransforms: [t, transformElement],
    directiveTransforms: {
      bind: transformBind,
    },
    ...transformOptions,
  })
  return generate(ast, { mode: 'module' })
}

describe('compiler sfc: transform asset url', () => {
  test('transform assetUrls', () => {
    const result = compileWithAssetUrls(`
			<img src="./logo.png"/>
			<img src="~fixtures/logo.png"/>
			<img src="~/fixtures/logo.png"/>
			<img src="http://example.com/fixtures/logo.png"/>
			<img src="//example.com/fixtures/logo.png"/>
			<img src="/fixtures/logo.png"/>
			<img src="data:image/png;base64,i"/>
		`)

    expect(result.code).toMatchSnapshot()
  })

  /**
   * component-compiler-utils#22：资源 URL 的 hash fragment 必须保留在 import 路径之后，
   * 重复的完整 URL 仍应复用同一 import。
   */
  test('support uri fragment', () => {
    const result = compileWithAssetUrls(
      '<use href="~@svg/file.svg#fragment"></use>' +
        '<use href="~@svg/file.svg#fragment"></use>',
      {},
      {
        hoistStatic: true,
      },
    )
    expect(result.code).toMatchSnapshot()
  })

  /** component-compiler-utils#22：只有 `~` 而没有实际路径时应容错，不能生成空模块 import。 */
  test('support uri is empty', () => {
    const result = compileWithAssetUrls('<use href="~"></use>')

    expect(result.code).toMatchSnapshot()
  })

  test('with explicit base', () => {
    const { code } = compileWithAssetUrls(
      `<img src="./bar.png"></img>` + // -> /foo/bar.png
        `<img src="bar.png"></img>` + // -> bar.png (untouched)
        `<img src="~bar.png"></img>` + // -> still converts to import
        `<img src="@theme/bar.png"></img>`, // -> still converts to import
      {
        base: '/foo',
      },
    )
    expect(code).toMatch(`import _imports_0 from 'bar.png'`)
    expect(code).toMatch(`import _imports_1 from '@theme/bar.png'`)
    expect(code).toMatchSnapshot()
  })

  test('with includeAbsolute: true', () => {
    const { code } = compileWithAssetUrls(
      `<img src="./bar.png"/>` +
        `<img src="/bar.png"/>` +
        `<img src="https://foo.bar/baz.png"/>` +
        `<img src="//foo.bar/baz.png"/>`,
      {
        includeAbsolute: true,
      },
    )
    expect(code).toMatchSnapshot()
  })

  // vite#298：`href="#fragment"` 指向当前文档元素，不是构建资产，必须原样保留。
  test('should not transform hash fragments', () => {
    const { code } = compileWithAssetUrls(
      `<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <defs>
          <circle id="myCircle" cx="0" cy="0" r="5" />
        </defs>
        <use x="5" y="5" xlink:href="#myCircle" />
      </svg>`,
    )
    // 该属性不是待转换资源，必须原样保留，不能在遍历时误删。
    expect(code).toMatch(`"xlink:href": "#myCircle"`)
  })

  // #9919：包子路径/alias 资源 URL 也要规范化为可解析 import，不能只支持相对文件路径。
  test('should transform subpath import paths', () => {
    const { code } = compileWithAssetUrls(
      `<img src="#src/assets/vue.svg" />` +
        `<img src="#/src/assets/vue.svg" />`,
    )
    expect(code).toContain(`_imports_0 from '#src/assets/vue.svg'`)
    expect(code).toContain(`_imports_1 from '#/src/assets/vue.svg'`)
  })

  test('should not transform pure hash values for custom asset URL tags', () => {
    const { code } = compileWithAssetUrls(
      `<foo bar="#fragment" />` +
        `<foo bar="#src/assets/vue.svg" />` +
        `<foo bar="#/src/assets/vue.svg" />`,
      {
        tags: {
          foo: ['bar'],
        },
      },
    )

    expect(code).toContain(`bar: "#fragment"`)
    expect(code).toContain(`bar: "#src/assets/vue.svg"`)
    expect(code).toContain(`bar: "#/src/assets/vue.svg"`)
    expect(code).not.toContain(`from '#fragment'`)
    expect(code).not.toContain(`from '#src/assets/vue.svg'`)
    expect(code).not.toContain(`from '#/src/assets/vue.svg'`)
  })

  test('should not throw for malformed percent-encoding in asset paths', () => {
    const { code } = compileWithAssetUrls(`<img src="./foo%.png" />`)

    expect(code).toContain(`import _imports_0 from './foo%.png'`)
  })

  test('should not transform hash fragments on <image>', () => {
    // `<image href="#...">` 是指向当前文档其他 SVG 元素的片段引用（类似
    // `<use>`），不是 Node.js 的包子路径导入说明符，因此不能转换成 import。
    const { code } = compileWithAssetUrls(
      `<svg><image href="#" /><image href="#myClip" /></svg>`,
      { includeAbsolute: true },
    )
    expect(code).toContain(`href: "#"`)
    expect(code).toContain(`href: "#myClip"`)
    expect(code).not.toContain(`from '#'`)
    expect(code).not.toContain(`from '#myClip'`)
  })

  test('should not transform bare `#` value into an import', () => {
    // 单独的 `#` 永远不是合法模块说明符；即使标签支持包子路径导入，也必须保留原值。
    const { code } = compileWithAssetUrls(`<img src="#" />`, {
      includeAbsolute: true,
    })
    expect(code).toContain(`src: "#"`)
    expect(code).not.toContain(`from '#'`)
  })

  test('should allow for full base URLs, with paths', () => {
    const { code } = compileWithAssetUrls(`<img src="./logo.png" />`, {
      base: 'http://localhost:3000/src/',
    })

    expect(code).toMatchSnapshot()
  })

  test('should allow for full base URLs, without paths', () => {
    const { code } = compileWithAssetUrls(`<img src="./logo.png" />`, {
      base: 'http://localhost:3000',
    })

    expect(code).toMatchSnapshot()
  })

  test('should allow for full base URLs, without port', () => {
    const { code } = compileWithAssetUrls(`<img src="./logo.png" />`, {
      base: 'http://localhost',
    })

    expect(code).toMatchSnapshot()
  })

  test('should allow for full base URLs, without protocol', () => {
    const { code } = compileWithAssetUrls(`<img src="./logo.png" />`, {
      base: '//localhost',
    })

    expect(code).toMatchSnapshot()
  })

  test('transform with stringify', () => {
    const { code } = compileWithAssetUrls(
      `<div>` +
        `<img src="./bar.png"/>` +
        `<img src="/bar.png"/>` +
        `<img src="https://foo.bar/baz.png"/>` +
        `<img src="//foo.bar/baz.png"/>` +
        `<img src="./bar.png"/>` +
        `</div>`,
      {
        includeAbsolute: true,
      },
      {
        hoistStatic: true,
        transformHoist: stringifyStatic,
      },
    )
    expect(code).toMatch(`_createStaticVNode`)
    expect(code).toMatchSnapshot()
  })

  test('transform with stringify with space in absolute filename', () => {
    const { code } = compileWithAssetUrls(
      `<div><img src="/foo bar.png"/></div>`,
      {
        includeAbsolute: true,
      },
      {
        hoistStatic: true,
        transformHoist: stringifyStatic,
      },
    )
    expect(code).toMatch(`_createElementVNode`)
    expect(code).toContain(`import _imports_0 from '/foo bar.png'`)
  })

  test('transform with stringify with space in relative filename', () => {
    const { code } = compileWithAssetUrls(
      `<div><img src="./foo bar.png"/></div>`,
      {
        includeAbsolute: true,
      },
      {
        hoistStatic: true,
        transformHoist: stringifyStatic,
      },
    )
    expect(code).toMatch(`_createElementVNode`)
    expect(code).toContain(`import _imports_0 from './foo bar.png'`)
  })
})
