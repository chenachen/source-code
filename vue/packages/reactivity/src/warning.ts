/**
 * 输出响应式包内部的开发期警告，并统一添加 Vue 前缀。
 *
 * @param msg 警告正文。
 * @param args 需要交给 `console.warn` 展示的附加上下文。
 */
export function warn(msg: string, ...args: any[]): void {
  console.warn(`[Vue warn] ${msg}`, ...args)
}
