/**
 * 测试阅读说明：本文件验证 `runtime-dom/directives/vCloak` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import { createApp } from '@vue/runtime-dom'

// 测试组：组件挂载后移除用于隐藏未编译模板的 v-cloak attribute。
describe('vCloak', () => {
  // 测试场景：编译后应删除。
  test('should be removed after compile', () => {
    const root = document.createElement('div')
    root.setAttribute('v-cloak', '')
    createApp({
      render() {},
    }).mount(root)
    expect(root.hasAttribute('v-cloak')).toBe(false)
  })
})
