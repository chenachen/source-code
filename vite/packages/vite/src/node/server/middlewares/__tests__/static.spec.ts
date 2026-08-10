import { describe, expect, test } from 'vitest'
import { isFileInTargetPath } from '../static'

describe('isFileInTargetPath', () => {
  /**
   * 场景矩阵：目标目录是否带尾斜杠，以及候选路径为同路径、相似前缀或多级子目录。
   * 目标：确认判断基于真实目录边界，不会把 `/parenta` 误当成 `/parent` 的子项；同时保留
   * “显式尾斜杠目标不等同于无尾斜杠文件名”的路径语义。
   */
  const cases = {
    '/parent': {
      '/parent': true,
      '/parenta': false,
      '/parent/': true,
      '/parent/child': true,
      '/parent/child/child2': true,
    },
    '/parent/': {
      '/parent': false,
      '/parenta': false,
      '/parent/': true,
      '/parent/child': true,
      '/parent/child/child2': true,
    },
  }

  for (const [parent, children] of Object.entries(cases)) {
    for (const [child, expected] of Object.entries(children)) {
      /**
       * 场景：当前矩阵行比较带/不带尾斜杠的 parent 与相同、相似前缀或子级 child。
       * 验证目标：`isFileInTargetPath` 严格返回该路径关系对应的 expected 布尔值。
       */
      test(`isFileInTargetPath("${parent}", "${child}")`, () => {
        expect(isFileInTargetPath(parent, child)).toBe(expected)
      })
    }
  }
})
