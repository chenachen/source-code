/**
 * 测试阅读说明：本文件验证 `runtime-core/helpers/toHandlers` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import { toHandlers } from '../../src/helpers/toHandlers'

// 测试组：toHandlers 把事件名映射转换为符合 onXxx 约定的监听器 props。
describe('toHandlers', () => {
  // 测试场景：不应接受非对象。
  it('should not accept non-objects', () => {
    toHandlers(null as any)
    toHandlers(undefined as any)

    expect(
      'v-on with no argument expects an object value.',
    ).toHaveBeenWarnedTimes(2)
  })

  // 测试场景：应该正确更改对象键。
  it('should properly change object keys', () => {
    const input = () => {}
    const change = () => {}

    expect(toHandlers({ input, change })).toStrictEqual({
      onInput: input,
      onChange: change,
    })
  })
})
