import {
  AsyncFunction,
  getAsyncFunctionDeclarationPaddingLineCount,
} from '../shared/utils'
import {
  ssrDynamicImportKey,
  ssrExportAllKey,
  ssrExportNameKey,
  ssrImportKey,
  ssrImportMetaKey,
  ssrModuleExportsKey,
} from './constants'
import type { ModuleEvaluator, ModuleRunnerContext } from './types'

/** 使用 AsyncFunction 执行 SSR 协议代码，并用原生动态 import 装载 external 模块。 */
export class ESModulesEvaluator implements ModuleEvaluator {
  /** AsyncFunction 包装器在用户代码之前额外占用的行数，供 sourcemap 修正。 */
  public readonly startOffset: number =
    // 额外一行来自下方独占一行的 `"use strict";`。
    getAsyncFunctionDeclarationPaddingLineCount() + 1

  /** 执行已转换成 SSR 协议调用的内联模块，并封闭最终导出 namespace。 */
  async runInlinedModule(
    context: ModuleRunnerContext,
    code: string,
  ): Promise<any> {
    // AsyncFunction 不依赖 Node vm.Module，可直接支持更广的 JS 运行时。
    const initModule = new AsyncFunction(
      ssrModuleExportsKey,
      ssrImportMetaKey,
      ssrImportKey,
      ssrDynamicImportKey,
      ssrExportAllKey,
      ssrExportNameKey,
      // sourcemap 已由 Vite内联；strict 指令独占一行，避免改变第一行源码列号。
      '"use strict";\n' + code,
    )

    await initModule(
      context[ssrModuleExportsKey],
      context[ssrImportMetaKey],
      context[ssrImportKey],
      context[ssrDynamicImportKey],
      context[ssrExportAllKey],
      context[ssrExportNameKey],
    )

    Object.seal(context[ssrModuleExportsKey])
  }

  /** 交给宿主原生动态 import 装载 external 模块。 */
  runExternalModule(filepath: string): Promise<any> {
    return import(filepath)
  }
}
