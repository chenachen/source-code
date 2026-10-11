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
  // 同一模板含相对、~、~/、http、协议相对、绝对与 data 资源；快照区分模块导入和原样保留分支。
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
  // 两个 use 引用相同 SVG #fragment 且开启 hoist；import 去重，片段在导入表达式之后拼回。
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
  // 资源仅有 ~ 前缀没有路径；快照确认容错处理，不生成空模块 import。
  test('support uri is empty', () => {
    const result = compileWithAssetUrls('<use href="~"></use>')

    expect(result.code).toMatchSnapshot()
  })

  // base=/foo 下分别使用 ./、裸名、~ 和 @theme；点相对路径拼 base，裸名保留，后两类继续转 import。
  test('with explicit base', () => {
    const { code } = compileWithAssetUrls(
      `<img src="./bar.png"></img>` + // 拼 base 后为 /foo/bar.png。
        `<img src="bar.png"></img>` + // 裸文件名保留，不拼 base。
        `<img src="~bar.png"></img>` + // 模块资源仍转为 import。
        `<img src="@theme/bar.png"></img>`, // alias 资源仍转为 import。
      {
        base: '/foo',
      },
    )
    expect(code).toMatch(`import _imports_0 from 'bar.png'`)
    expect(code).toMatch(`import _imports_1 from '@theme/bar.png'`)
    expect(code).toMatchSnapshot()
  })

  // includeAbsolute:true 下混合相对、绝对、https 与协议相对资源；绝对本地路径也生成 import，外链仍保留。
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
  // SVG use 的 xlink:href 指向 #myCircle；文档片段保留为静态属性，不生成资源导入。
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
  // img src 使用 #src 和 #/src 包子路径；图片资源位置允许把它们作为模块说明符导入。
  test('should transform subpath import paths', () => {
    const { code } = compileWithAssetUrls(
      `<img src="#src/assets/vue.svg" />` +
        `<img src="#/src/assets/vue.svg" />`,
    )
    expect(code).toContain(`_imports_0 from '#src/assets/vue.svg'`)
    expect(code).toContain(`_imports_1 from '#/src/assets/vue.svg'`)
  })

  // 自定义 foo.bar 含普通 hash 及带斜杠 hash；该标签未开放子路径说明符，三种值都原样保留。
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

  // 相对资源路径含非法百分号编码；解码失败保留原路径并正常生成 import。
  test('should not throw for malformed percent-encoding in asset paths', () => {
    const { code } = compileWithAssetUrls(`<img src="./foo%.png" />`)

    expect(code).toContain(`import _imports_0 from './foo%.png'`)
  })

  // SVG image href 分别为 # 和 #myClip；两者是文档片段，即使 includeAbsolute 也不导入。
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

  // img src 只有裸 #；即使图片支持包子路径，它也不构成有效说明符，保留属性。
  test('should not transform bare `#` value into an import', () => {
    // 单独的 `#` 永远不是合法模块说明符；即使标签支持包子路径导入，也必须保留原值。
    const { code } = compileWithAssetUrls(`<img src="#" />`, {
      includeAbsolute: true,
    })
    expect(code).toContain(`src: "#"`)
    expect(code).not.toContain(`from '#'`)
  })

  // base 是含协议、端口与 /src/ 的完整 URL；快照核对相对 logo 拼接后的完整地址。
  test('should allow for full base URLs, with paths', () => {
    const { code } = compileWithAssetUrls(`<img src="./logo.png" />`, {
      base: 'http://localhost:3000/src/',
    })

    expect(code).toMatchSnapshot()
  })

  // base 是含端口但无路径的完整 URL；相对资源拼到主机根路径，协议与端口保留。
  test('should allow for full base URLs, without paths', () => {
    const { code } = compileWithAssetUrls(`<img src="./logo.png" />`, {
      base: 'http://localhost:3000',
    })

    expect(code).toMatchSnapshot()
  })

  // base 是无端口的 http 主机；相对资源拼接不要求端口存在。
  test('should allow for full base URLs, without port', () => {
    const { code } = compileWithAssetUrls(`<img src="./logo.png" />`, {
      base: 'http://localhost',
    })

    expect(code).toMatchSnapshot()
  })

  // base 为协议相对主机；输出保持双斜杠前缀并拼资源路径。
  test('should allow for full base URLs, without protocol', () => {
    const { code } = compileWithAssetUrls(`<img src="./logo.png" />`, {
      base: '//localhost',
    })

    expect(code).toMatchSnapshot()
  })

  // 大静态 div 含重复相对与绝对资源并启用 stringifyStatic；生成 static vnode，资源表达式与 import 去重仍正确。
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

  // 绝对文件名含空格且启用字符串化；保留含空格 import，当前小块仍生成 element vnode。
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

  // 相对文件名含空格且启用字符串化；保留相对 import 的空格，输出 element vnode 不丢失资源表达式。
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
