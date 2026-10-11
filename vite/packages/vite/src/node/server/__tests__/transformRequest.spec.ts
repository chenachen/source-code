import { describe, expect, test } from 'vitest'
import { getModuleTypeFromId } from '../transformRequest'

describe('getModuleTypeFromId', () => {
  /**
   * 场景：变换管线只拿到模块 ID，需要按已知扩展名推断交给插件 transform 的 moduleType。
   * 目标：普通、复合文件名均返回末尾扩展名；无扩展名时不凭空猜测类型。
   * 机制：用表驱动用例固定输入/输出契约，避免新增模块类型时破坏基础回退行为。
   */
  const testCases = [
    { id: 'foo.js', expected: 'js' },
    { id: 'foo.ts', expected: 'ts' },
    { id: 'foo.a.js', expected: 'js' },
    { id: '', expected: undefined },
  ]

  for (const { id, expected } of testCases) {
    /**
     * 场景：当前表格行传入普通、复合或无扩展名模块 ID。
     * 验证目标：`getModuleTypeFromId` 只返回该行最后扩展名 expected，不为无扩展 ID 猜测类型。
     */
    test(`should return ${expected} for id: ${id}`, () => {
      const result = getModuleTypeFromId(id)
      expect(result).toBe(expected)
    })
  }
})
