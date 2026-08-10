import {
  type CompilerError,
  DOMErrorCodes,
  type SourceLocation,
  createCompilerError,
} from '@vue/compiler-dom'

/** 带 SSR 专用错误码的编译错误。 */
export interface SSRCompilerError extends CompilerError {
  /** compiler-ssr 专用错误码。 */
  code: SSRErrorCodes
}

/** 创建带源码位置和 SSR 文案的编译错误。 */
export function createSSRCompilerError(
  code: SSRErrorCodes,
  loc?: SourceLocation,
) {
  return createCompilerError(code, loc, SSRErrorMessages) as SSRCompilerError
}

/** 从 DOM 扩展点开始分配的 SSR 编译错误码。 */
export enum SSRErrorCodes {
  /** 属性名无法安全写入服务端 HTML，存在注入风险。 */
  X_SSR_UNSAFE_ATTR_NAME = 65 /* DOMErrorCodes.__EXTEND_POINT__ */,
  /** `<Teleport>` 缺少 SSR 定位内容所需的 `to` 目标。 */
  X_SSR_NO_TELEPORT_TARGET,
  /** SSR 转换遇到该阶段不应出现或尚未支持的 AST 节点。 */
  X_SSR_INVALID_AST_NODE,
}

if (__TEST__) {
  // esbuild 无法推导跨文件枚举首值后的自增结果，需手动同步；测试断言防止扩展点移动后冲突。
  if (SSRErrorCodes.X_SSR_UNSAFE_ATTR_NAME < DOMErrorCodes.__EXTEND_POINT__) {
    throw new Error(
      `SSRErrorCodes need to be updated to ${
        DOMErrorCodes.__EXTEND_POINT__
      } to match extension point from core DOMErrorCodes.`,
    )
  }
}

/** SSR 错误码对应的英文诊断文案。 */
export const SSRErrorMessages: {
  /** SSR 错误码对应的诊断文本。 */
  [code: number]: string
} = {
  [SSRErrorCodes.X_SSR_UNSAFE_ATTR_NAME]: `Unsafe attribute name for SSR.`,
  [SSRErrorCodes.X_SSR_NO_TELEPORT_TARGET]: `Missing the 'to' prop on teleport element.`,
  [SSRErrorCodes.X_SSR_INVALID_AST_NODE]: `Invalid AST node during SSR transform.`,
}
