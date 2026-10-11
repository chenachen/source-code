import { describe, expect, it } from 'vitest'
import { getCommonBase } from '../../../plugins/importMetaGlob'

describe('getCommonBase()', async () => {
  /** 输入 /a/b/*.js 与 /a/c/*.js；取共同静态目录应为 /a，不能包含分叉后的 b/c。 */
  it('basic', () => {
    expect(getCommonBase(['/a/b/*.js', '/a/c/*.js'])).toBe('/a')
  })
  /** 场景：多个 glob 文件位于同一 /a/b 目录；验证目标：公共基准目录解析为 /a/b。 */
  it('common base', () => {
    expect(getCommonBase(['/a/b/**/*.vue', '/a/b/**/*.jsx'])).toBe('/a/b')
  })
  /** 场景：字符串路径只共享字符前缀但不共享目录段；验证目标：公共基准不会停在半个目录名。 */
  it('does not treat a path prefix as a common directory', () => {
    expect(getCommonBase(['/a/foo/*.js', '/a/foobar/*.js'])).toBe('/a')
  })
  /** 场景：输入混合静态文件与 glob；验证目标：基准按它们共同的真实父目录计算。 */
  it('static file', () => {
    expect(
      getCommonBase(['/a/b/**/*.vue', '/a/b/**/*.jsx', '/a/b/foo.js']),
    ).toBe('/a/b')
    expect(getCommonBase(['/a/b/**/*.vue', '/a/b/**/*.jsx', '/a/foo.js'])).toBe(
      '/a',
    )
  })
  /** 场景：单层 glob、静态文件与多段 ** 模式；验证目标：scan 规则均返回第一个动态段之前的目录。 */
  it('correct `scan()`', () => {
    expect(getCommonBase(['/a/*.vue'])).toBe('/a')
    expect(getCommonBase(['/a/some.vue'])).toBe('/a')
    expect(getCommonBase(['/a/b/**/c/foo.vue', '/a/b/c/**/*.jsx'])).toBe('/a/b')
  })
  /** 场景：只有一个 glob 或静态文件；验证目标：公共基准就是该项的父目录。 */
  it('single', () => {
    expect(getCommonBase(['/a/b/c/*.vue'])).toBe('/a/b/c')
    expect(getCommonBase(['/a/b/c/foo.vue'])).toBe('/a/b/c')
  })
  /** 场景：两个绝对 glob 只共享文件系统根；验证目标：公共基准返回 /。 */
  it('no common base', () => {
    expect(getCommonBase(['/a/b/*.js', '/c/a/b/*.js'])).toBe('/')
  })
})
