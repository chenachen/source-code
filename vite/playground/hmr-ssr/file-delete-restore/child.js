import { rerender } from './runtime'

/** 子模块初始导出；自身接受回调更新渲染，dispose/prune 日志与持久数据用来观察删除与恢复。 */
export const value = 'child'

if (import.meta.hot) {
  if (globalThis.__vite_file_delete_restore_child_pruned) {
    log(
      `file-delete-restore/child.js hot data after prune: ${import.meta.hot.data.persisted}`,
    )
    delete globalThis.__vite_file_delete_restore_child_pruned
  }
  import.meta.hot.data.persisted = true

  import.meta.hot.accept((newMod) => {
    if (!newMod) return

    rerender({ child: newMod.value })
  })

  import.meta.hot.dispose(() => {
    log('file-delete-restore/child.js is disposed')
  })

  import.meta.hot.prune(() => {
    log('file-delete-restore/child.js is pruned')
    globalThis.__vite_file_delete_restore_child_pruned = true
  })
}
