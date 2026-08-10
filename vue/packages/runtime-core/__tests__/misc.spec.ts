/**
 * 测试阅读说明：本文件验证 `runtime-core/misc` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import { h, isReactive, nodeOps, reactive, render } from '@vue/runtime-test'

// 测试组：杂项。
describe('misc', () => {
  // 测试场景：组件公共实例不应该是可观察的。
  test('component public instance should not be observable', () => {
    let instance: any
    const Comp = {
      render() {},
      mounted() {
        instance = this
      },
    }
    render(h(Comp), nodeOps.createElement('div'))
    expect(instance).toBeDefined()
    const r = reactive(instance)
    expect(r).toBe(instance)
    expect(isReactive(r)).toBe(false)
  })
})
