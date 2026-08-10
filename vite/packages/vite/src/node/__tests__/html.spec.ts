import { describe, expect, test } from 'vitest'
import type { OutputBundle, OutputChunk } from 'rolldown'
import { getCssFilesForChunk } from '../plugins/html'

/** 构造仅保留 HTML CSS 收集算法所需字段的最小 chunk。 */
function createChunk(
  fileName: string,
  imports: string[],
  importedCss: string[],
): OutputChunk {
  return {
    type: 'chunk',
    fileName,
    imports,
    viteMetadata: { importedCss: new Set(importedCss) },
  } as unknown as OutputChunk
}

/** 按 fileName 建立 Rolldown bundle 索引，使 import 字符串可回查 chunk。 */
function createBundle(...chunks: OutputChunk[]): OutputBundle {
  const bundle: Record<string, OutputChunk> = {}
  for (const chunk of chunks) {
    bundle[chunk.fileName] = chunk
  }
  return bundle as unknown as OutputBundle
}

describe('getCssFilesForChunk', () => {
  /**
   * 场景：HTML 生成阶段需给每个入口注入其静态 chunk 子图中的 CSS。
   * 验证目标：后序顺序稳定、环/菱形依赖去重，且共享子图缓存不能把某入口已见 CSS 状态泄露给另一入口。
   * 机制：用手工 chunk 图覆盖单链、共享、菱形、环与 #21298 的跨入口缓存回归。
   */
  test('single chunk with own CSS', () => {
    const chunk = createChunk('entry.js', [], ['style.css'])
    const bundle = createBundle(chunk)
    const cache = new Map<OutputChunk, string[]>()
    expect(getCssFilesForChunk(chunk, bundle, cache)).toStrictEqual([
      'style.css',
    ])
  })

  /** 场景：入口 chunk 及其依赖均无 CSS；验证目标：收集结果为空数组。 */
  test('chunk with no CSS returns empty array', () => {
    const chunk = createChunk('entry.js', [], [])
    const bundle = createBundle(chunk)
    const cache = new Map<OutputChunk, string[]>()
    expect(getCssFilesForChunk(chunk, bundle, cache)).toStrictEqual([])
  })

  /** 场景：入口导入一个带 CSS 的依赖且自身也有样式；验证目标：依赖 CSS 排在入口 CSS 之前。 */
  test('imported chunk CSS comes before own CSS', () => {
    const dep = createChunk('dep.js', [], ['dep.css'])
    const entry = createChunk('entry.js', ['dep.js'], ['entry.css'])
    const bundle = createBundle(entry, dep)
    const cache = new Map<OutputChunk, string[]>()
    expect(getCssFilesForChunk(entry, bundle, cache)).toStrictEqual([
      'dep.css',
      'entry.css',
    ])
  })

  /** 场景：A→B→C 的深层静态导入链各带 CSS；验证目标：结果按 C、B、A 的依赖优先顺序输出。 */
  test('deep import chain preserves order', () => {
    const c = createChunk('c.js', [], ['c.css'])
    const b = createChunk('b.js', ['c.js'], ['b.css'])
    const a = createChunk('a.js', ['b.js'], ['a.css'])
    const bundle = createBundle(a, b, c)
    const cache = new Map<OutputChunk, string[]>()
    expect(getCssFilesForChunk(a, bundle, cache)).toStrictEqual([
      'c.css',
      'b.css',
      'a.css',
    ])
  })

  /** 场景：同一入口连续收集两次 CSS；验证目标：首次填充入口和依赖缓存，第二次返回相同顺序。 */
  test('cache is populated and used on second call', () => {
    const dep = createChunk('dep.js', [], ['dep.css'])
    const entry = createChunk('entry.js', ['dep.js'], ['entry.css'])
    const bundle = createBundle(entry, dep)
    const cache = new Map<OutputChunk, string[]>()

    const result = getCssFilesForChunk(entry, bundle, cache)
    expect(result).toStrictEqual(['dep.css', 'entry.css'])
    expect(cache.has(dep)).toBe(true)
    expect(cache.has(entry)).toBe(true)

    expect(getCssFilesForChunk(entry, bundle, cache)).toStrictEqual(result)
  })

  /** 场景：两个入口共享一个带 CSS 的 chunk；验证目标：每个入口结果都包含 shared.css 和自身 CSS。 */
  test('shared dependency CSS is output for each entry point', () => {
    const shared = createChunk('shared.js', [], ['shared.css'])
    const entryA = createChunk('a.js', ['shared.js'], ['a.css'])
    const entryB = createChunk('b.js', ['shared.js'], ['b.css'])
    const bundle = createBundle(entryA, entryB, shared)
    const cache = new Map<OutputChunk, string[]>()
    expect(getCssFilesForChunk(entryA, bundle, cache)).toStrictEqual([
      'shared.css',
      'a.css',
    ])
    expect(getCssFilesForChunk(entryB, bundle, cache)).toStrictEqual([
      'shared.css',
      'b.css',
    ])
  })

  /** 场景：A 经 B/C 形成菱形并共享 D；验证目标：D 的 CSS 只出现一次且位于 B、C、A 之前。 */
  test('diamond dependency deduplicates CSS and preserves order', () => {
    // 菱形图：A → B/C → D；D 的 CSS 只能输出一次，且应最先出现。
    const d = createChunk('d.js', [], ['d.css'])
    const b = createChunk('b.js', ['d.js'], ['b.css'])
    const c = createChunk('c.js', ['d.js'], ['c.css'])
    const a = createChunk('a.js', ['b.js', 'c.js'], ['a.css'])
    const bundle = createBundle(a, b, c, d)
    const cache = new Map<OutputChunk, string[]>()
    expect(getCssFilesForChunk(a, bundle, cache)).toStrictEqual([
      'd.css',
      'b.css',
      'c.css',
      'a.css',
    ])
  })

  /** 场景：两入口以相反顺序导入两个共享 chunk；验证目标：各自结果保持自身遍历顺序且追加入口 CSS。 */
  test('multiple shared dependencies with different CSS', () => {
    const shared1 = createChunk('shared1.js', [], ['shared1.css'])
    const shared2 = createChunk('shared2.js', [], ['shared2.css'])
    const entryA = createChunk('a.js', ['shared1.js', 'shared2.js'], ['a.css'])
    const entryB = createChunk('b.js', ['shared2.js', 'shared1.js'], ['b.css'])
    const bundle = createBundle(entryA, entryB, shared1, shared2)
    const cache = new Map<OutputChunk, string[]>()
    expect(getCssFilesForChunk(entryA, bundle, cache)).toStrictEqual([
      'shared1.css',
      'shared2.css',
      'a.css',
    ])
    expect(getCssFilesForChunk(entryB, bundle, cache)).toStrictEqual([
      'shared2.css',
      'shared1.css',
      'b.css',
    ])
  })

  /** 场景：先缓存入口 A 的重叠子图再读取入口 B；验证目标：B 仍获得 shared、mid2 与自身 CSS，缓存不泄露 seen 状态。 */
  test('cache from one entry does not corrupt results for another with overlapping subgraph', () => {
    // 两入口共享 mid2：入口 A 的遍历不能让入口 B 从缓存读取时丢掉 shared.css。
    const shared = createChunk('shared.js', [], ['shared.css'])
    const leaf = createChunk('leaf.js', [], ['leaf.css'])
    const mid1 = createChunk('mid1.js', ['leaf.js'], ['mid1.css'])
    const mid2 = createChunk('mid2.js', ['shared.js'], ['mid2.css'])
    const entryA = createChunk('a.js', ['mid1.js', 'mid2.js'], ['a.css'])
    const entryB = createChunk('b.js', ['mid2.js'], ['b.css'])
    const bundle = createBundle(entryA, entryB, mid1, mid2, leaf, shared)
    const cache = new Map<OutputChunk, string[]>()
    expect(getCssFilesForChunk(entryA, bundle, cache)).toStrictEqual([
      'leaf.css',
      'mid1.css',
      'shared.css',
      'mid2.css',
      'a.css',
    ])
    expect(getCssFilesForChunk(entryB, bundle, cache)).toStrictEqual([
      'shared.css',
      'mid2.css',
      'b.css',
    ])
  })

  /** 场景：首入口在访问 chunk2 前已见共享 CSS，随后另一入口只依赖 chunk2；验证目标：chunk2 缓存仍保留完整共享 CSS。 */
  test('cached chunk does not lose CSS that was already in seenCss during first entry (#21298)', () => {
    // entry 先经 chunk1 见到 shared CSS，再到 chunk2；entry2 单独依赖 chunk2。
    const chunk1 = createChunk(
      'chunk1.js',
      [],
      ['chunk1.css', 'chunk-shared.css'],
    )
    const chunk2 = createChunk(
      'chunk2.js',
      [],
      ['chunk2.css', 'chunk-shared.css'],
    )
    const entry = createChunk(
      'entry.js',
      ['chunk1.js', 'chunk2.js'],
      ['entry.css'],
    )
    const entry2 = createChunk('entry2.js', ['chunk2.js'], ['entry2.css'])
    const bundle = createBundle(entry, entry2, chunk1, chunk2)
    const cache = new Map<OutputChunk, string[]>()

    expect(getCssFilesForChunk(entry, bundle, cache)).toStrictEqual([
      'chunk1.css',
      'chunk-shared.css',
      'chunk2.css',
      'entry.css',
    ])
    expect(getCssFilesForChunk(entry2, bundle, cache)).toStrictEqual([
      'chunk2.css',
      'chunk-shared.css',
      'entry2.css',
    ])
  })

  /** 场景：父 chunk 缓存建立时叶子 shared.css 已在当前入口 seen 集合；验证目标：另一入口经缓存父节点仍得到叶子的 shared.css 与 leaf.css。 */
  test('dirty leaf chunk CSS is not lost through cached parent (#21298 edge case)', () => {
    // 更深边界：entry1 在进入 mid 前已见 shared.css，但 mid 的缓存仍须保存 leaf 的完整 CSS 集。
    const leaf = createChunk('leaf.js', [], ['shared.css', 'leaf.css'])
    const mid = createChunk('mid.js', ['leaf.js'], ['mid.css'])
    const other = createChunk('other.js', [], ['shared.css'])
    const entry1 = createChunk(
      'entry1.js',
      ['other.js', 'mid.js'],
      ['entry1.css'],
    )
    const entry2 = createChunk('entry2.js', ['mid.js'], ['entry2.css'])
    const bundle = createBundle(entry1, entry2, other, mid, leaf)
    const cache = new Map<OutputChunk, string[]>()

    expect(getCssFilesForChunk(entry1, bundle, cache)).toStrictEqual([
      'shared.css',
      'leaf.css',
      'mid.css',
      'entry1.css',
    ])
    // 即使 mid 缓存建立时 shared.css 已被本轮过滤，entry2 仍必须经 leaf 得到它。
    expect(getCssFilesForChunk(entry2, bundle, cache)).toStrictEqual([
      'shared.css',
      'leaf.css',
      'mid.css',
      'entry2.css',
    ])
  })

  /** 场景：A 与 B 构成循环导入且各带 CSS；验证目标：遍历终止并对每份 CSS 只输出一次。 */
  test('circular imports do not cause infinite loop', () => {
    const a = createChunk('a.js', ['b.js'], ['a.css'])
    const b = createChunk('b.js', ['a.js'], ['b.css'])
    const bundle = createBundle(a, b)
    const cache = new Map<OutputChunk, string[]>()
    expect(getCssFilesForChunk(a, bundle, cache)).toStrictEqual([
      'b.css',
      'a.css',
    ])
  })
})
