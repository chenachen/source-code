import type { CustomEventName, InferCustomEventPayload } from './customEvent.js'

/** HMR 重新导入后交给 accept 回调的 ESM 命名空间对象。 */
export type ModuleNamespace = Record<string, any> & {
  /** 保持与标准 ESM namespace 的 `Object.prototype.toString` 标识一致。 */
  [Symbol.toStringTag]: 'Module'
}

/**
 * 每个模块的 `import.meta.hot` 协议。模块重执行时 context 会重建，但 data 在 dispose 与下一代之间保留；
 * prune 表示模块已经脱离当前图，需清除长期副作用。
 */
export interface ViteHotContext {
  /** 跨当前模块相邻两代实例保留的可变数据对象。 */
  readonly data: any

  /** 声明模块自接受；无 callback 时只阻止更新继续向 importer 冒泡。 */
  accept(): void
  /** 声明模块自接受，并在新一代模块命名空间加载后执行回调。 */
  accept(cb: (mod: ModuleNamespace | undefined) => void): void
  /** 接受单个依赖更新，并把该依赖的新模块命名空间交给回调。 */
  accept(dep: string, cb: (mod: ModuleNamespace | undefined) => void): void
  /** 接受一组依赖更新，并按 deps 顺序把各依赖的新模块命名空间交给回调。 */
  accept(
    deps: readonly string[],
    cb: (mods: Array<ModuleNamespace | undefined>) => void,
  ): void

  /** 仅接受指定导出；未接受导出若被 importer 使用，服务端仍继续向上传播。 */
  acceptExports(
    exportNames: string | readonly string[],
    cb?: (mod: ModuleNamespace | undefined) => void,
  ): void

  /** 新一代模块重新导入前执行，可通过 data 保存临时状态并清除旧副作用。 */
  dispose(cb: (data: any) => void): void
  /** 模块脱离图时执行，用于最终清理；完成后 data 也会被删除。 */
  prune(cb: (data: any) => void): void
  /** 当前边界无法安全接管更新时，请求服务端从 importer 继续传播。 */
  invalidate(message?: string): void

  /** 监听内置生命周期或用户扩展事件；模块重执行时旧 context 的监听器自动移除。 */
  on<T extends CustomEventName>(
    event: T,
    cb: (payload: InferCustomEventPayload<T>) => void,
  ): void
  /** 主动移除当前 context 登记的事件监听器。 */
  off<T extends CustomEventName>(
    event: T,
    cb: (payload: InferCustomEventPayload<T>) => void,
  ): void
  /** 经 HotChannel 向服务端发送自定义事件。 */
  send<T extends CustomEventName>(
    event: T,
    data?: InferCustomEventPayload<T>,
  ): void
}
