import { describe, expect, test } from 'vitest'
import type { ecmaVersion } from 'acorn'
import { parse } from 'acorn'
import {
  createModernChunkLegacyGuard,
  detectModernBrowserCode,
  detectModernBrowserDetector,
  dynamicFallbackInlineCode,
  safari10NoModuleFix,
  systemJSInlineCode,
} from '../snippets'

/** ES2015–ES2019 解析器档位，用于验证现代浏览器探测代码需要更高语法等级。 */
const shouldFailVersions: ecmaVersion[] = []
for (let v = 2015; v <= 2019; v++) {
  shouldFailVersions.push(v as ecmaVersion)
}

/** ES2020–ES2024 解析器档位，用于验证探测代码在这些语法等级可被解析。 */
const shouldPassVersions: ecmaVersion[] = []
for (let v = 2020; v <= 2024; v++) {
  shouldPassVersions.push(v as ecmaVersion)
}

for (const version of shouldFailVersions) {
  /** 按 2015 至 2019 的每个版本以 module 模式解析同一探测代码；应抛语法错误，核对最低语法门槛。 */
  test(`detect code should not be able to be parsed with ES${version}`, () => {
    expect(() => {
      parse(detectModernBrowserDetector, {
        ecmaVersion: version,
        sourceType: 'module',
      })
    }).toThrow()
  })
}

for (const version of shouldPassVersions) {
  /** 按 2020 至 2024 的每个版本以 module 模式解析探测代码；应不抛错，核对现代语法兼容范围。 */
  test(`detect code should be able to be parsed with ES${version}`, () => {
    expect(() => {
      parse(detectModernBrowserDetector, {
        ecmaVersion: version,
        sourceType: 'module',
      })
    }).not.toThrow()
  })
}

describe('snippets are valid', () => {
  const codes = {
    safari10NoModuleFix,
    systemJSInlineCode,
    detectModernBrowserCode,
    dynamicFallbackInlineCode,
  }

  for (const [name, value] of Object.entries(codes)) {
    /** 循环分别解析 Safari 修复、SystemJS、现代浏览器探测和动态回退四种内联片段；latest/module 模式均应接受其语法。 */
    test(`${name} is valid JS`, () => {
      expect(() => {
        parse(value, {
          ecmaVersion: 'latest',
          sourceType: 'module',
        })
      }).not.toThrow()
    })
  }
})

describe('createModernChunkLegacyGuard', () => {
  /** 为两种 chunk 文件名生成现代代码守卫；结果应不同，核对 data URL 按 chunk 区分（vitejs/vite#22008）。 */
  test('generates unique data URLs for different chunk filenames', () => {
    const guard1 = createModernChunkLegacyGuard('assets/index-abc123.js')
    const guard2 = createModernChunkLegacyGuard('assets/chunk-def456.js')
    expect(guard1).not.toBe(guard2)
  })

  /** 为给定 chunk 生成守卫并以 latest/module 模式解析；生成字符串应是合法 JS，本例不执行浏览器回退逻辑。 */
  test('is valid JS', () => {
    const guard = createModernChunkLegacyGuard('assets/index-abc123.js')
    expect(() => {
      parse(guard, {
        ecmaVersion: 'latest',
        sourceType: 'module',
      })
    }).not.toThrow()
  })
})
