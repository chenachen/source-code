import EventCenter from '../../interact/event_center'

import { MOCK_EVENT_NAME, MOCK_EVENT_DATA } from './mocks/event'

/**
 * 保留的同步派发测试，当前 jest.config.js 的 testMatch 未纳入本文件。
 * rc.32 的 dispatch 需要 nextStep 参数且通过微任务通知，这里的同步回调断言沿用旧接口；
 * 两参调用还把 undefined 登记为完成步骤，合法派发在微任务通知后会调用它并抛错。
 * 这类异步错误并不会被眼前的 getData 或未调用断言捕获；非法数据例在校验时退出，不入队。
 * 当前批处理、数据方向和监听器清理的测试入口是 ../interact/index.test.ts。
 */
describe('EventCenter', () => {
  beforeAll(() => {
    console.error = jest.fn()
  })

  /**
   * 对全新中心登记一个监听器，再派发对象数据并立即检查回调。当前只把合并数据排入微任务，回调此刻未调用；正文同步成功预期不符合当前调度。
   *
   */
  test('监听一个事件，可以成功被触发', () => {
    const callback = jest.fn()

    const eventCenter = new EventCenter()
    eventCenter.on(MOCK_EVENT_NAME, callback)

    eventCenter.dispatch(MOCK_EVENT_NAME, MOCK_EVENT_DATA)
    expect(callback).toBeCalledWith(MOCK_EVENT_DATA)
  })

  /**
   * 登记监听器后按原函数解绑，再派发对象并立即检查未调用。解绑应清掉订阅；由于所有通知本就异步，
   * 眼前断言不能区分解绑效果与尚未运行的微任务。
   */
  test('监听一个已移除的事件，触发不应该成功', () => {
    const callback = jest.fn()

    const eventCenter = new EventCenter()
    eventCenter.on(MOCK_EVENT_NAME, callback)

    eventCenter.off(MOCK_EVENT_NAME, callback)
    eventCenter.dispatch(MOCK_EVENT_NAME, MOCK_EVENT_DATA)
    expect(callback).not.toBeCalled()
  })

  /**
   * 给同一通道登记两个不同监听器，再派发并立即检查二者参数。当前两回调在微任务中依注册顺序运行，同步断言会先于通知，
   * 目标是多订阅者但等待边界不匹配。
   */
  test('一个事件可以绑定多个函数，可以成功被触发', () => {
    const callback = jest.fn()
    const callback2 = jest.fn()

    const eventCenter = new EventCenter()
    eventCenter.on(MOCK_EVENT_NAME, callback)
    eventCenter.on(MOCK_EVENT_NAME, callback2)

    eventCenter.dispatch(MOCK_EVENT_NAME, MOCK_EVENT_DATA)
    expect(callback).toBeCalledWith(MOCK_EVENT_DATA)
    expect(callback2).toBeCalledWith(MOCK_EVENT_DATA)
  })

  /**
   * 登记两个监听器后不传函数调用 off 清空集合，再派发并立即检查都未调用。应保留通道数据而清监听；同步断言没有等待后续通知，
   * 不能独立证明整批清理。
   */
  test('一个事件可以绑定多个函数，全部解绑后触发不应该成功', () => {
    const callback = jest.fn()
    const callback2 = jest.fn()

    const eventCenter = new EventCenter()
    eventCenter.on(MOCK_EVENT_NAME, callback)
    eventCenter.on(MOCK_EVENT_NAME, callback2)

    eventCenter.off(MOCK_EVENT_NAME)
    eventCenter.dispatch(MOCK_EVENT_NAME, MOCK_EVENT_DATA)
    expect(callback).not.toBeCalled()
    expect(callback2).not.toBeCalled()
  })

  /**
   * 在尚无通道和订阅者时首次派发对象，立即 getData。新通道直接把输入保存在 data，因此同步查询可得到对象；
   * 验证首次写入可读与异步通知是两个边界。
   */
  test('未绑定回调的事件支持存储数据', () => {
    const eventCenter = new EventCenter()
    eventCenter.dispatch(MOCK_EVENT_NAME, MOCK_EVENT_DATA)
    expect(eventCenter.getData(MOCK_EVENT_NAME)).toEqual(MOCK_EVENT_DATA)
  })

  /**
   * 登记监听器后把 MOCK_EVENT_DATA.content 作为数据传入；该 fixture 只有 data 字段，
   * 实际输入是 undefined。类型校验应同步记录 data must be object 且不排队，验证非法输入拒绝，
   * 而不是字符串 payload 场景。
   */
  test('监听一个事件，触发的数据不是对象，应该报错', () => {
    const callback = jest.fn()
    const logError = jest.spyOn(console, 'error')

    const eventCenter = new EventCenter()
    eventCenter.on(MOCK_EVENT_NAME, callback)

    // @ts-expect-error
    eventCenter.dispatch(MOCK_EVENT_NAME, MOCK_EVENT_DATA.content)
    expect(callback).not.toBeCalled()
    expect(logError).toBeCalledWith('[micro-app] event-center: data must be object')
  })

  /**
   * 全新通道先 dispatch 后在同栈 on(autoTrigger=true)，立即检查回调。首次 data 已可读，
   * 但 queue 含名称且 tempData 未设置，on 不同步回放；监听器只在稍后批次接收数据，旧同步断言不成立。
   */
  test('先触发一个事件，再监听，在 autoTrigger 参数为 true 时监听回调自动被触发', () => {
    const callback = jest.fn()
    const eventCenter = new EventCenter()

    eventCenter.dispatch(MOCK_EVENT_NAME, MOCK_EVENT_DATA)
    eventCenter.on(MOCK_EVENT_NAME, callback, true)
    expect(callback).toBeCalledWith(MOCK_EVENT_DATA)
  })
})
