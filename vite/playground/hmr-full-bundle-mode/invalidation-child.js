/** 子模块初始值；自身接受回调调用 invalidate，使其父模块重新执行。 */
export const value = 'child'

import.meta.hot?.accept(() => {
  import.meta.hot.invalidate()
})
