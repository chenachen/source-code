import { beforeEach, describe, expect, test, vi } from 'vitest'
import { transformCjsImport } from '../../plugins/importAnalysis'

describe('runTransform', () => {
  /**
   * 场景：浏览器 ESM 从 optimizer 产出的 CJS 包做 named/default/namespace import 或 re-export。
   * 目标：改写为唯一默认导入 + 属性赋值，并区分 Web/Node default interop；无法安全枚举的
   * `export *` 返回 undefined 且告警。
   * 机制：同一语句分别在两种 interop mode 下生成代码快照，并额外固定改写前后行数相同。
   */
  const config: any = {
    command: 'serve',
    logger: {
      warn: vi.fn(),
    },
  }

  /** 调用真实改写器，拼回 hoisted assignments，并把分号展开以提高快照可读性。 */
  function runTransformCjsImport(importExp: string, isNodeMode: boolean) {
    const result = transformCjsImport(
      importExp,
      './node_modules/.vite/deps/react.js',
      'react',
      0,
      'modA',
      isNodeMode,
      config,
    )
    if (result === undefined) return undefined
    const joined = result.hoistedAssignments
      ? `${result.hoistedAssignments}; ${result.importLine}`
      : result.importLine
    expect(joined.split('\n').length, 'result line count').toBe(
      importExp.split('\n').length,
    )
    return joined.replaceAll(';', ';\n')
  }

  beforeEach(() => {
    config.logger.warn.mockClear()
  })

  /** 场景：从优化 CJS 包导入多个命名项含字符串名；验证目标：两种 interop 模式都生成属性读取与唯一默认导入。 */
  test('import specifier', () => {
    expect(
      runTransformCjsImport(
        'import { useState, Component, "👋" as fake } from "react"',
        false,
      ),
    ).toMatchInlineSnapshot(`
      "const useState = __vite__cjsImport0_react["useState"];
       const Component = __vite__cjsImport0_react["Component"];
       const fake = __vite__cjsImport0_react["👋"];
       import __vite__cjsImport0_react from "./node_modules/.vite/deps/react.js""
    `)
    expect(
      runTransformCjsImport(
        'import { useState, Component, "👋" as fake } from "react"',
        true,
      ),
    ).toMatchInlineSnapshot(`
      "const useState = __vite__cjsImport0_react["useState"];
       const Component = __vite__cjsImport0_react["Component"];
       const fake = __vite__cjsImport0_react["👋"];
       import __vite__cjsImport0_react from "./node_modules/.vite/deps/react.js""
    `)
  })

  /** 场景：默认导入及 default-as-named 写法；验证目标：Web 模式检查 __esModule，Node 模式直接使用模块对象。 */
  test('import default specifier', () => {
    expect(runTransformCjsImport('import React from "react"', false))
      .toMatchInlineSnapshot(`
      "const React = !__vite__cjsImport0_react.__esModule ? __vite__cjsImport0_react : __vite__cjsImport0_react.default;
       import __vite__cjsImport0_react from "./node_modules/.vite/deps/react.js""
    `)
    expect(runTransformCjsImport('import React from "react"', true))
      .toMatchInlineSnapshot(`
        "const React = __vite__cjsImport0_react;
         import __vite__cjsImport0_react from "./node_modules/.vite/deps/react.js""
      `)

    expect(
      runTransformCjsImport('import { default as React } from "react"', false),
    ).toMatchInlineSnapshot(`
      "const React = !__vite__cjsImport0_react.__esModule ? __vite__cjsImport0_react : __vite__cjsImport0_react.default;
       import __vite__cjsImport0_react from "./node_modules/.vite/deps/react.js""
    `)
  })

  /** 场景：namespace import CJS 包；验证目标：生成互操作 namespace，且 Node 模式参数切换为 1。 */
  test('import all specifier', () => {
    expect(runTransformCjsImport('import * as react from "react"', false))
      .toMatchInlineSnapshot(`
      "const react = ((m, n) => n || !m?.__esModule ? {	...typeof m === "object" && !Array.isArray(m) || typeof m === "function" ? m : {},	default: m} : m)(__vite__cjsImport0_react, 0);
       import __vite__cjsImport0_react from "./node_modules/.vite/deps/react.js""
    `)
    expect(runTransformCjsImport('import * as react from "react"', true))
      .toMatchInlineSnapshot(`
        "const react = ((m, n) => n || !m?.__esModule ? {	...typeof m === "object" && !Array.isArray(m) || typeof m === "function" ? m : {},	default: m} : m)(__vite__cjsImport0_react, 1);
         import __vite__cjsImport0_react from "./node_modules/.vite/deps/react.js""
      `)
  })

  /** export * 与 export * as 都返回 undefined；只有两次 export * 发警告，带 namespace 别名的形式不进入警告分支。 */
  test('export all specifier', () => {
    expect(
      runTransformCjsImport('export * from "react"', false),
    ).toMatchInlineSnapshot(`undefined`)
    expect(
      runTransformCjsImport('export * from "react"', true),
    ).toMatchInlineSnapshot(`undefined`)

    expect(config.logger.warn).toBeCalledWith(
      expect.stringContaining(`export * from "react"\` in modA`),
    )

    expect(
      runTransformCjsImport('export * as react from "react"', false),
    ).toMatchInlineSnapshot(`undefined`)

    expect(config.logger.warn).toBeCalledTimes(2)
  })

  /** 场景：重导出多个命名项及字符串导出别名；验证目标：生成稳定临时绑定与对应 export 列表。 */
  test('export name specifier', () => {
    expect(
      runTransformCjsImport(
        'export { useState, Component, "👋" } from "react"',
        false,
      ),
    ).toMatchInlineSnapshot(`
      "const __vite__cjsExportI_useState = __vite__cjsImport0_react["useState"];
       const __vite__cjsExportI_Component = __vite__cjsImport0_react["Component"];
       const __vite__cjsExportL_1d0452e3 = __vite__cjsImport0_react["👋"];
       export { __vite__cjsExportI_useState as useState, __vite__cjsExportI_Component as Component, __vite__cjsExportL_1d0452e3 as "👋" };
       import __vite__cjsImport0_react from "./node_modules/.vite/deps/react.js""
    `)
    expect(
      runTransformCjsImport(
        'export { useState, Component, "👋" } from "react"',
        true,
      ),
    ).toMatchInlineSnapshot(`
      "const __vite__cjsExportI_useState = __vite__cjsImport0_react["useState"];
       const __vite__cjsExportI_Component = __vite__cjsImport0_react["Component"];
       const __vite__cjsExportL_1d0452e3 = __vite__cjsImport0_react["👋"];
       export { __vite__cjsExportI_useState as useState, __vite__cjsExportI_Component as Component, __vite__cjsExportL_1d0452e3 as "👋" };
       import __vite__cjsImport0_react from "./node_modules/.vite/deps/react.js""
    `)

    expect(
      runTransformCjsImport(
        'export { useState as useStateAlias, Component as ComponentAlias, "👋" as "👍" } from "react"',
        false,
      ),
    ).toMatchInlineSnapshot(`
      "const __vite__cjsExportI_useStateAlias = __vite__cjsImport0_react["useState"];
       const __vite__cjsExportI_ComponentAlias = __vite__cjsImport0_react["Component"];
       const __vite__cjsExportL_5d57d39e = __vite__cjsImport0_react["👋"];
       export { __vite__cjsExportI_useStateAlias as useStateAlias, __vite__cjsExportI_ComponentAlias as ComponentAlias, __vite__cjsExportL_5d57d39e as "👍" };
       import __vite__cjsImport0_react from "./node_modules/.vite/deps/react.js""
    `)
  })

  /** 场景：重导出 CJS 默认值或为其命名；验证目标：Web/Node 模式分别应用正确 default interop 后导出。 */
  test('export default specifier', () => {
    expect(runTransformCjsImport('export { default } from "react"', false))
      .toMatchInlineSnapshot(`
      "const __vite__cjsExportDefault_0 = !__vite__cjsImport0_react.__esModule ? __vite__cjsImport0_react : __vite__cjsImport0_react.default;
       export default __vite__cjsExportDefault_0;
       import __vite__cjsImport0_react from "./node_modules/.vite/deps/react.js""
    `)
    expect(runTransformCjsImport('export { default } from "react"', true))
      .toMatchInlineSnapshot(`
        "const __vite__cjsExportDefault_0 = __vite__cjsImport0_react;
         export default __vite__cjsExportDefault_0;
         import __vite__cjsImport0_react from "./node_modules/.vite/deps/react.js""
      `)

    expect(
      runTransformCjsImport('export { default as React} from "react"', false),
    ).toMatchInlineSnapshot(`
      "const __vite__cjsExportI_React = !__vite__cjsImport0_react.__esModule ? __vite__cjsImport0_react : __vite__cjsImport0_react.default;
       export { __vite__cjsExportI_React as React };
       import __vite__cjsImport0_react from "./node_modules/.vite/deps/react.js""
    `)

    expect(
      runTransformCjsImport(
        'export { Component as default } from "react"',
        false,
      ),
    ).toMatchInlineSnapshot(`
      "const __vite__cjsExportDefault_0 = __vite__cjsImport0_react["Component"];
       export default __vite__cjsExportDefault_0;
       import __vite__cjsImport0_react from "./node_modules/.vite/deps/react.js""
    `)
  })
})
