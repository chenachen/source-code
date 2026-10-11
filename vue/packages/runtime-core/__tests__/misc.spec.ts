/**
 * 在 runtime-test 中挂载组件，验证公共实例传给 reactive 后仍保持原身份且不成为响应式对象。
 */
import { h, isReactive, nodeOps, reactive, render } from '@vue/runtime-test'

// 测试组：杂项。
describe('misc', () => {
  /** 组件 mounted 保存公共 this，再把该实例传给 reactive；检查实例存在、返回身份相同且 isReactive 为 false，验证公共实例的代理排除标记。 */
  test('component public instance should not be observable', () => {
    let instance: any
    const Comp = {
      /** 不输出内容，让用例只观察公共实例的响应式排除行为。 */
      render() {},
      /** 挂载完成后保存公共 this，供 reactive 身份比较。 */
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
