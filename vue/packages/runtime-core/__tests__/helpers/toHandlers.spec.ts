/**
 * 直接调用 toHandlers，核对无效输入警告及 input/change 到 onInput/onChange 的键转换。
 * 处理器函数应保持原引用；这些用例不挂载组件或触发 DOM 事件。
 */
import { toHandlers } from '../../src/helpers/toHandlers'

// toHandlers 把事件名映射转换为符合 onXxx 约定的监听器 props。
describe('toHandlers', () => {
  /** 分别传入 null 与 undefined，检查对象类型警告累计两次，验证无参数 v-on 的非法输入诊断。 */
  it('should not accept non-objects', () => {
    toHandlers(null as any)
    toHandlers(undefined as any)

    expect(
      'v-on with no argument expects an object value.',
    ).toHaveBeenWarnedTimes(2)
  })

  /** 传入 input/change 两个空处理器，检查转换键为 onInput/onChange 且函数引用不变，验证只转换事件键。 */
  it('should properly change object keys', () => {
    /** 空事件处理器，以原函数身份检查事件键转换没有包装回调。 */
    const input = () => {}
    /** 空事件处理器，以原函数身份检查事件键转换没有包装回调。 */
    const change = () => {}

    expect(toHandlers({ input, change })).toStrictEqual({
      onInput: input,
      onChange: change,
    })
  })
})
