/**
 * `srcset` 资产场景：覆盖单/多候选与密度描述符、data URL 逗号、混合外链、base/绝对路径、
 * hash 及非法百分号编码。
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
  // 基础矩阵含空候选、重复 URL、不同顺序/密度、绝对/外链/data 混合；快照核对候选拆分、导入去重和描述符保留。
  test('transform srcset', () => {
    expect(compileWithSrcset(src).code).toMatchSnapshot()
  })

  // 基础矩阵加 base=/foo；点相对候选改为 base 路径，外链与 data 候选不改。
  test('transform srcset w/ base', () => {
    expect(
      compileWithSrcset(src, {
        base: '/foo',
      }).code,
    ).toMatchSnapshot()
  })

  // 基础矩阵加 includeAbsolute:true；本地绝对候选参与导入，外链/data 保持原值。
  test('transform srcset w/ includeAbsolute: true', () => {
    expect(
      compileWithSrcset(src, {
        includeAbsolute: true,
      }).code,
    ).toMatchSnapshot()
  })

  // srcset 仅含空白且允许绝对路径；空候选被跳过，不产生无意义 import。
  test('transform empty srcset w/ includeAbsolute: true', () => {
    expect(
      compileWithSrcset(`<img srcset=" " />`, {
        includeAbsolute: true,
      }).code,
    ).toMatchSnapshot()
  })

  // 把候选矩阵包在 div 并启用 stringifyStatic；生成静态 vnode，同时快照核对资源候选表达式可被字符串化消费。
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

  // base 下候选混合 @ alias 与 ./ 相对路径；整组静态直写仅适用于可拼 base 的路径，alias 仍需模块导入。
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

  // srcset 使用两种 # 包子路径，其中一项带 2x；生成各自 import，提升表达式保留密度描述符。
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

  // 两个候选引用同一 SVG 的不同 fragment；共用基础文件 import，分别拼回 #icon 与 2x。
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

  // 候选路径含非法百分号并带 2x；不因 URI 解码失败抛错，import 与描述符均保留。
  test('should not throw for malformed percent-encoding in srcset paths', () => {
    const code = compileWithSrcset(`<img srcset="./foo%.png 2x" />`).code

    expect(code).toContain(`import _imports_0 from './foo%.png'`)
    expect(code).toContain(`const _hoisted_1 = _imports_0 + ' 2x'`)
  })
})
