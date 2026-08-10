/**
 * `srcset` 资产场景：拆分逗号候选与 1x/2x/宽度描述符，逐项转换相对 URL 并重组表达式，
 * 覆盖 data URL 内逗号、转义空白、混合外链和格式不完整输入。
 */
import {
  type TransformOptions,
  baseParse,
  generate,
  transform,
} from '@vue/compiler-core'
import {
  createSrcsetTransformWithOptions,
  transformSrcset,
} from '../src/template/transformSrcset'
import { transformElement } from '../../compiler-core/src/transforms/transformElement'
import { transformBind } from '../../compiler-core/src/transforms/vBind'
import {
  type AssetURLOptions,
  normalizeOptions,
} from '../src/template/transformAssetUrl'
import { stringifyStatic } from '../../compiler-dom/src/transforms/stringifyStatic'

/** 运行 srcset 资产转换、元素转换和静态字符串化，返回最终 codegen 结果。 */
function compileWithSrcset(
  template: string,
  options?: AssetURLOptions,
  transformOptions?: TransformOptions,
) {
  const ast = baseParse(template)
  const srcsetTransform = options
    ? createSrcsetTransformWithOptions(normalizeOptions(options))
    : transformSrcset
  transform(ast, {
    hoistStatic: true,
    nodeTransforms: [srcsetTransform, transformElement],
    directiveTransforms: {
      bind: transformBind,
    },
    ...transformOptions,
  })
  return generate(ast, { mode: 'module' })
}

/** 基础候选矩阵：空值、单/多 URL、顺序变化及密度描述符。 */
const src = `
<img src="./logo.png" srcset=""/>
<img src="./logo.png" srcset="./logo.png"/>
<img src="./logo.png" srcset="./logo.png 2x"/>
<img src="./logo.png" srcset="./logo.png 2x"/>
<img src="./logo.png" srcset="./logo.png, ./logo.png 2x"/>
<img src="./logo.png" srcset="./logo.png 2x, ./logo.png"/>
<img src="./logo.png" srcset="./logo.png 2x, ./logo.png 3x"/>
<img src="./logo.png" srcset="./logo.png, ./logo.png 2x, ./logo.png 3x"/>
<img src="/logo.png" srcset="/logo.png, /logo.png 2x"/>
<img src="https://example.com/logo.png" srcset="https://example.com/logo.png, https://example.com/logo.png 2x"/>
<img src="/logo.png" srcset="/logo.png, ./logo.png 2x"/>
<img src="data:image/png;base64,i" srcset="data:image/png;base64,i 1x, data:image/png;base64,i 2x"/>
`

describe('compiler sfc: transform srcset', () => {
  test('transform srcset', () => {
    expect(compileWithSrcset(src).code).toMatchSnapshot()
  })

  test('transform srcset w/ base', () => {
    expect(
      compileWithSrcset(src, {
        base: '/foo',
      }).code,
    ).toMatchSnapshot()
  })

  test('transform srcset w/ includeAbsolute: true', () => {
    expect(
      compileWithSrcset(src, {
        includeAbsolute: true,
      }).code,
    ).toMatchSnapshot()
  })

  test('transform empty srcset w/ includeAbsolute: true', () => {
    expect(
      compileWithSrcset(`<img srcset=" " />`, {
        includeAbsolute: true,
      }).code,
    ).toMatchSnapshot()
  })

  test('transform srcset w/ stringify', () => {
    const code = compileWithSrcset(
      `<div>${src}</div>`,
      {
        includeAbsolute: true,
      },
      {
        hoistStatic: true,
        transformHoist: stringifyStatic,
      },
    ).code
    expect(code).toMatch(`_createStaticVNode`)
    expect(code).toMatchSnapshot()
  })

  test('srcset w/ explicit base option', () => {
    const code = compileWithSrcset(
      `
      <img srcset="@/logo.png, @/logo.png 2x"/>
      <img srcset="@/logo.png 1x, ./logo.png 2x"/>
    `,
      { base: '/foo/' },
      { hoistStatic: true },
    ).code
    expect(code).toMatchSnapshot()
  })

  test('should transform subpath import paths starting with #', () => {
    const code = compileWithSrcset(
      `<img srcset="#src/assets/vue.svg" />` +
        `<img srcset="#/src/assets/vue.svg 2x" />`,
    ).code

    expect(code).toContain(`_imports_0 from '#src/assets/vue.svg'`)
    expect(code).toContain(`_imports_1 from '#/src/assets/vue.svg'`)
    expect(code).toContain(`const _hoisted_1 = _imports_0`)
    expect(code).toContain(`const _hoisted_2 = _imports_1 + ' 2x'`)
  })

  test('should preserve svg fragments in srcset URLs', () => {
    const code = compileWithSrcset(
      `<img srcset="./icons.svg#icon-heart" />` +
        `<img srcset="./icons.svg#icon-star 2x" />`,
    ).code

    expect(code).toContain(`_imports_0 from './icons.svg'`)
    expect(code).toContain(`const _hoisted_1 = _imports_0 + '#icon-heart'`)
    expect(code).toContain(
      `const _hoisted_2 = _imports_0 + '#icon-star' + ' 2x'`,
    )
  })

  test('should not throw for malformed percent-encoding in srcset paths', () => {
    const code = compileWithSrcset(`<img srcset="./foo%.png 2x" />`).code

    expect(code).toContain(`import _imports_0 from './foo%.png'`)
    expect(code).toContain(`const _hoisted_1 = _imports_0 + ' 2x'`)
  })
})
