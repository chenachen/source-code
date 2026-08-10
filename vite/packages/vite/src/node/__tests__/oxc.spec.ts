import { describe, expect, test } from 'vitest'
import { convertEsbuildConfigToOxcConfig } from '../plugins/oxc'
import { createLogger } from '../logger'

describe('convertEsbuildConfigToOxcConfig', () => {
  const logger = createLogger('silent')

  // esbuild 的 jsxSideEffects 与 Oxc jsx.pure 语义相反：true 表示 JSX 有副作用，即 pure=false。
  /** 场景：Oxc transform 输入的 jsxCallsCanBeRemoved 分别为 true 与 false；验证目标：两种布尔值都正确映射，避免 JSX 调用被错误 tree-shake（#22809）。 */
  test('inverts jsxSideEffects when mapping to jsx.pure', () => {
    expect(
      convertEsbuildConfigToOxcConfig({ jsxSideEffects: true }, logger).jsx,
    ).toMatchObject({ pure: false })
    expect(
      convertEsbuildConfigToOxcConfig({ jsxSideEffects: false }, logger).jsx,
    ).toMatchObject({ pure: true })
  })
})
