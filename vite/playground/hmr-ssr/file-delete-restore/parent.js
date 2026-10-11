import { rerender } from './runtime'

/** 父模块固定导出，与重导出的子值一起初始化页面；父接受回调可更新两字段。 */
export const parentValue = 'parent'
export { value as childValue } from './child'

if (import.meta.hot) {
  import.meta.hot.accept((newMod) => {
    if (!newMod) return

    rerender({ child: newMod.childValue, parent: newMod.parentValue })
  })
}
