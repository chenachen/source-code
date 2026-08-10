/** 静态 import 在转换前携带给 Module Runner 的导入形态。 */
export interface DefineImportMetadata {
  /**
   * 转换成 `ssrImportKey` 调用前，静态语句显式导入的名称：
   *
   * import foo, { bar as baz, qux } from 'hello'
   * => ['default', 'bar', 'qux']
   *
   * import * as namespace from 'world'
   * => undefined
   */
  importedNames?: string[]
}

/** 在静态导入元数据上补充动态 import 标志。 */
export interface SSRImportMetadata extends DefineImportMetadata {
  /** 是否来自用户的动态 `import()`；动态导入遵循宿主 namespace，不做静态名称校验。 */
  isDynamicImport?: boolean
}

/**
 * Vite 会把静态 ESM import 转成运行时 `__vite_ssr_import__()`，底层通常使用动态
 * import；Node 对静态与动态导入的缺失命名导出处理不同，因此这里根据变换前元数据
 * 补做校验，使开发 SSR 接近生产/Node 行为。
 */
export function analyzeImportedModDifference(
  mod: any,
  rawId: string,
  moduleType: string | undefined,
  metadata?: SSRImportMetadata,
): void {
  // 用户本来就写动态 import 时，直接保留宿主返回的 namespace。
  if (metadata?.isDynamicImport) return

  // 只有显式命名/default 导入需要检查；副作用导入和 namespace 导入无需预枚举成员。
  if (metadata?.importedNames?.length) {
    const missingBindings = metadata.importedNames.filter((s) => !(s in mod))
    if (missingBindings.length) {
      const lastBinding = missingBindings[missingBindings.length - 1]

      // 原生 ESM 的静态导入会由 Node 报缺失名称；转换后变成动态 import，只能手工模拟。
      if (moduleType === 'module') {
        throw new SyntaxError(
          `[vite] The requested module '${rawId}' does not provide an export named '${lastBinding}'`,
        )
      } else {
        // Node 用 cjs-module-lexer 静态分析 CJS 命名导出；提示文本沿用 Node，建议改用 default。
        throw new SyntaxError(`\
[vite] Named export '${lastBinding}' not found. The requested module '${rawId}' is a CommonJS module, which may not support all module.exports as named exports.
CommonJS modules can always be imported via the default export, for example using:

import pkg from '${rawId}';
const {${missingBindings.join(', ')}} = pkg;
`)
      }
    }
  }
}
