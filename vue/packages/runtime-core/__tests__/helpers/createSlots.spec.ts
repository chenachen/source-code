/**
 * 测试阅读说明：本文件验证 `runtime-core/helpers/createSlots` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import type { Slot } from '../../src/componentSlots'
import { createSlots } from '../../src/helpers/createSlots'

// 测试组：createSlots 合并静态插槽与动态插槽描述符的行为。
describe('createSlot', () => {
  const slot = () => []
  let record: Record<string, Slot>

  beforeEach(() => {
    record = {}
  })

  // 测试场景：应该返回 slot。
  it('should return a slot', () => {
    const dynamicSlot = [{ name: 'descriptor', fn: slot }]

    const actual = createSlots(record, dynamicSlot)

    expect(actual).toEqual({ descriptor: slot })
  })

  // 测试场景：应附加key。
  it('should attach key', () => {
    const dynamicSlot = [{ name: 'descriptor', fn: slot, key: '1' }]

    const actual = createSlots(record, dynamicSlot)
    const ret = actual.descriptor()
    // @ts-expect-error
    expect(ret.key).toBe('1')
  })

  // 测试场景：应该检查可为空性。
  it('should check nullability', () => {
    const slot = (() => {}) as Slot
    const dynamicSlot = [{ name: 'descriptor', fn: slot, key: '1' }]

    const actual = createSlots(record, dynamicSlot)
    expect(actual).toHaveProperty('descriptor')
  })

  // 测试场景：应该将所有slots添加到记录中。
  it('should add all slots to the record', () => {
    const dynamicSlot = [
      { name: 'descriptor', fn: slot },
      { name: 'descriptor2', fn: slot },
    ]

    const actual = createSlots(record, dynamicSlot)

    expect(actual).toEqual({ descriptor: slot, descriptor2: slot })
  })

  // 测试场景：当给定的 slot 是数组时，应将 slot 添加到记录中。
  it('should add slot to the record when given slot is an array', () => {
    const dynamicSlot = [
      { name: 'descriptor', fn: slot },
      [{ name: 'descriptor2', fn: slot }],
    ]

    const actual = createSlots(record, dynamicSlot)

    expect(actual).toEqual({ descriptor: slot, descriptor2: slot })
  })

  // 测试场景：当给定的 slot 是一个数组时，应该将每个 slot 添加到记录中。
  it('should add each slot to the record when given slot is an array', () => {
    const dynamicSlot = [
      { name: 'descriptor', fn: slot },
      [
        { name: 'descriptor2', fn: slot },
        { name: 'descriptor3', fn: slot },
      ],
    ]

    const actual = createSlots(record, dynamicSlot)

    expect(actual).toEqual({
      descriptor: slot,
      descriptor2: slot,
      descriptor3: slot,
    })
  })
})
