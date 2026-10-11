import type { DepOptimizationConfig } from '../optimizer'
import { mergeWithDefaults } from '../utils'

/** SSR 构建所面向的原生运行时；它会影响包入口字段和条件导出选择。 */
export type SSRTarget = 'node' | 'webworker'

/** SSR 依赖优化沿用通用依赖优化器配置。 */
export type SsrDepOptimizationConfig = DepOptimizationConfig

/** SSR 外部化、目标运行时、依赖优化与解析规则。 */
export interface SSROptions {
  /**
   * 强制让匹配依赖进入 Vite/Rolldown 转换流水线，而不是交给运行时原生加载。
   * `true` 表示不外部化任何依赖，常用于需要转换 CJS 或非 JS 资源的包。
   */
  noExternal?: string | RegExp | (string | RegExp)[] | true
  /** 强制外部化的包名；`true` 表示尽可能将所有依赖留给 SSR 运行时加载。 */
  external?: string[] | true

  /**
   * 指定 SSR 构建目标。`node` 会忽略 package.json 的 browser 字段，
   * `webworker` 则会使用它。
   *
   * 此选项计划在未来主版本移除。
   *
   * @default 'node'
   */
  target?: SSRTarget

  /**
   * 配置 SSR 开发态依赖预构建，沿用通用 optimizeDeps 的 include/exclude 与 Rolldown 选项。
   * `noExternal` 决定是否经过 Vite 转换；是否预构建还由依赖优化配置决定。
   *
   * @experimental
   */
  optimizeDeps?: SsrDepOptimizationConfig

  /** SSR 内部转换与外部运行时加载各自使用的包解析条件。 */
  resolve?: {
    /**
     * 插件解析流水线使用的条件导出列表，默认继承根配置的
     * `resolve.conditions`。
     *
     * 仅在 SSR 需要与客户端采用不同条件入口时覆盖。
     *
     * @default rootConfig.resolve.conditions
     */
    conditions?: string[]

    /**
     * SSR import（包括 `ssrLoadModule`）加载已外部化依赖时交给原生运行时的
     * 条件导出列表。它与上面的插件流水线条件作用在不同边界。
     *
     * @default ['node', 'module-sync']
     */
    externalConditions?: string[]

    /** SSR 内部化依赖解析 package.json 入口时使用的字段优先级。 */
    mainFields?: string[]
  }
}

/** 补齐默认 target 与依赖优化配置后的 SSR 选项。 */
export interface ResolvedSSROptions extends SSROptions {
  /** 已补齐为 node 或 webworker 的最终运行时目标。 */
  target: SSRTarget
  /** 已合并根配置符号链接策略的依赖优化选项。 */
  optimizeDeps: SsrDepOptimizationConfig
}

/** 仅保存 SSR 自有默认值；未列出的 external/resolve 由上层配置合并决定。 */
const _ssrConfigDefaults = Object.freeze({
  // noExternal
  // external
  target: 'node',
  optimizeDeps: {},
  // resolve
} satisfies SSROptions)
/** 暴露给配置解析层的只读 SSR 默认值。 */
export const ssrConfigDefaults: Readonly<Partial<SSROptions>> =
  _ssrConfigDefaults

/**
 * 合并 SSR 默认项，并在兼容字段 esbuildOptions 中保留 preserveSymlinks。
 * 本版优化器使用 Rolldown，实际符号链接策略来自 Environment 的 resolve.preserveSymlinks。
 *
 * 先构造含嵌套默认值的对象、再合并用户配置，可避免用户只设置一个
 * `optimizeDeps` 子项时丢掉符号链接语义。
 */
export function resolveSSROptions(
  ssr: SSROptions | undefined,
  preserveSymlinks: boolean,
): ResolvedSSROptions {
  const defaults = mergeWithDefaults(_ssrConfigDefaults, {
    optimizeDeps: { esbuildOptions: { preserveSymlinks } },
  } satisfies SSROptions)
  return mergeWithDefaults(defaults, ssr ?? {})
}
