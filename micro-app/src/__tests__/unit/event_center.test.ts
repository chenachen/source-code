import EventCenter from '../../interact/event_center'

import { MOCK_EVENT_NAME, MOCK_EVENT_DATA } from './mocks/event'

describe('EventCenter', () => {
  beforeAll(() => {
    console.error = jest.fn()
  })

  test('监听一个事件，可以成功被触发', () => {
    const callback = jest.fn()

    const eventCenter = new EventCenter()
    eventCenter.on(MOCK_EVENT_NAME, callback)

    eventCenter.dispatch(MOCK_EVENT_NAME, MOCK_EVENT_DATA)
    expect(callback).toBeCalledWith(MOCK_EVENT_DATA)
  })

  test('监听一个已移除的事件，触发不应该成功', () => {
    const callback = jest.fn()

    const eventCenter = new EventCenter()
    eventCenter.on(MOCK_EVENT_NAME, callback)

    eventCenter.off(MOCK_EVENT_NAME, callback)
    eventCenter.dispatch(MOCK_EVENT_NAME, MOCK_EVENT_DATA)
    expect(callback).not.toBeCalled()
  })

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

  test('未绑定回调的事件支持存储数据', () => {
    const eventCenter = new EventCenter()
    eventCenter.dispatch(MOCK_EVENT_NAME, MOCK_EVENT_DATA)
    expect(eventCenter.getData(MOCK_EVENT_NAME)).toEqual(MOCK_EVENT_DATA)
  })

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
   * Given：事件尚无监听器，但已通过 dispatch 排入一份对象数据。
   * When：同一同步栈内以 `autoTrigger=true` 注册监听器。
   * Then：该监听器应在待处理微任务提交数据时收到对象。
   *
   * 验证机制：没有第二次 dispatch，监听器会加入首个待提交批次；当前同步断言未显式等待该微任务。
   * 对应源码：`EventCenter.dispatch()` 的入队逻辑、`EventCenter.process()` 的批次通知。
   */
  test('先触发一个事件，再监听，在 autoTrigger 参数为 true 时监听回调自动被触发', () => {
    const callback = jest.fn()
    const eventCenter = new EventCenter()

    eventCenter.dispatch(MOCK_EVENT_NAME, MOCK_EVENT_DATA)
    eventCenter.on(MOCK_EVENT_NAME, callback, true)
    expect(callback).toBeCalledWith(MOCK_EVENT_DATA)
  })
})
