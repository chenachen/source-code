import { beforeAll, describe, expect, test } from 'vitest'
import { init, parse as parseImports } from 'es-module-lexer'
import {
  matchImportsToPreloadMarkers,
  preloadMarker,
} from '../../plugins/importAnalysisBuild'

beforeAll(async () => {
  await init
})

/** 按源码顺序返回每个 `__VITE_PRELOAD__` marker 的起点，供配对结果使用精确位置断言。 */
function markerPositions(code: string): number[] {
  const positions: number[] = []
  for (
    let pos = code.indexOf(preloadMarker);
    pos !== -1;
    pos = code.indexOf(preloadMarker, pos + preloadMarker.length)
  ) {
    positions.push(pos)
  }
  return positions
}

/** 使用与 generateBundle 相同的 lexer 提取动态 import，再调用真实 marker 配对算法。 */
function match(code: string) {
  const imports = parseImports(code)[0].filter((i) => i.d > -1)
  return matchImportsToPreloadMarkers(code, imports)
}

describe('matchImportsToPreloadMarkers', () => {
  /**
   * 场景：无 import、单 import 和并列 import。
   * 验证目标：输出数组与 imports 索引严格平行，每个 marker 只能被消费一次。
   */
  test('returns an empty array when there are no imports', () => {
    expect(matchImportsToPreloadMarkers('const a = 1', [])).toStrictEqual([])
  })

  /** 场景：一条动态 import 与一个 preload marker 相邻；验证目标：分析结果把该 import 索引与 marker 一一配对。 */
  test('pairs a single dynamic import with its marker', () => {
    const code = `__vitePreload(() => import('a'), ${preloadMarker})`
    const [marker] = markerPositions(code)
    expect(match(code)).toStrictEqual([marker])
  })

  /** 场景：Rollup 时代两个 sibling import 与 marker 交错；验证目标：每个 import 只取得自己的 marker。 */
  test('gives sibling imports their own markers (Rollup-era interleaved shape)', () => {
    // Rollup 时代的交错顺序：import a < Ma < import b < Mb。
    const code =
      `__vitePreload(() => import('a'), ${preloadMarker})` +
      `.then(() => __vitePreload(() => import('b'), ${preloadMarker}))`
    const [markerA, markerB] = markerPositions(code)
    expect(match(code)).toStrictEqual([markerA, markerB])
  })

  /** 场景：外层 import 的 then 回调中还有内层 import；验证目标：嵌套调用分别绑定两个 marker，不能被外层范围吞并。 */
  test('gives a nested `import().then(() => import())` each its own marker (#22700)', () => {
    // Rolldown 包裹整个 `.then`，内层 marker 位于外层之前；外层 import 虽在文本上
    // 更早，也不能抢走内层 marker。
    const code =
      `__vitePreload(() => import('a').then(() => ` +
      `__vitePreload(() => import('b'), ${preloadMarker})), ${preloadMarker})`
    const [innerMarker, outerMarker] = markerPositions(code)
    // imports 仍按源码排序：[0] 外层 a，[1] 内层 b。
    expect(match(code)).toStrictEqual([outerMarker, innerMarker])
  })

  /** 场景：单个 import 的 marker 位于它之前；验证目标：反向扫描仍把二者配成同一 preload 记录。 */
  test('#3051: a lone import whose marker precedes it still pairs with that marker', () => {
    const code = `const x = ${preloadMarker};import('a')`
    const [marker] = markerPositions(code)
    expect(match(code)).toStrictEqual([marker])
  })
})
