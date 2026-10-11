import { createApp } from '@vue/runtime-dom'

// 测试组：在含v-cloak的div挂载组件，检查挂载完成后宿主移除此attribute。
describe('vCloak', () => {
  /** 测试场景：mount前容器已有v-cloak，挂载空render应用后标记被删除；实际覆盖runtime-dom mount清理，不是模板编译删除。 */
  test('should be removed after compile', () => {
    const root = document.createElement('div')
    root.setAttribute('v-cloak', '')
    createApp({
      /** 提供空根组件，不返回VNode。 */
      render() {},
    }).mount(root)
    expect(root.hasAttribute('v-cloak')).toBe(false)
  })
})
