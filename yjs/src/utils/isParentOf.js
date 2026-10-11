/**
 * 沿嵌套共享类型的宿主 Item 链判断 `parent` 是否为 `child` 的祖先。
 *
 * 直接父类型也算命中；deleted 位不影响结构归属。遇到根类型的 `_item=null` 即结束，不依赖可见索引。
 *
 * @param {YType} parent 待匹配的祖先共享类型。
 * @param {Item|null} child 开始回溯的子 Item；`null` 表示没有宿主链。
 * @return {Boolean} 宿主链中是否出现 `parent`。
 *
 * @private
 * @function
 */
export const isParentOf = (parent, child) => {
  while (child !== null) {
    if (child.parent === parent) {
      return true
    }
    child = /** @type {YType} */ (child.parent)._item
  }
  return false
}
