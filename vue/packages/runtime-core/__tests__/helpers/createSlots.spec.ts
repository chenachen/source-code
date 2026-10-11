/**
 * 直接向 createSlots 传入静态记录与动态描述符，检查最终 slots 对象及返回数组上的分支 key。
 * 这些用例不渲染组件；数组描述符、返回空值的函数与单个分支分别检查合并行为。
 */
import type { Slot } from '../../src/componentSlots'
import { createSlots } from '../../src/helpers/createSlots'

// createSlots 合并静态插槽与动态插槽描述符的行为。
describe('createSlot', () => {
  /** 返回新空数组，供比较登记函数身份及分支包装附加的 key。 */
  const slot = () => []
  let record: Record<string, Slot>

  beforeEach(() => {
    record = {}
  })

  /** 从空 slots 记录加入 descriptor 动态描述符，检查名称映射仍引用原函数，验证单插槽登记。 */
  it('should return a slot', () => {
    const dynamicSlot = [{ name: 'descriptor', fn: slot }]

    const actual = createSlots(record, dynamicSlot)

    expect(actual).toEqual({ descriptor: slot })
  })

  /** 给 descriptor 指定分支 key:1，调用合并后的插槽并检查返回数组上的 key，验证分支身份由包装函数附加。 */
  it('should attach key', () => {
    const dynamicSlot = [{ name: 'descriptor', fn: slot, key: '1' }]

    const actual = createSlots(record, dynamicSlot)
    const ret = actual.descriptor()
    // @ts-expect-error
    expect(ret.key).toBe('1')
  })

  /** 把返回 undefined 的插槽描述符与 key:1 合并，检查 descriptor 属性存在，验证登记阶段允许空返回值；此处不调用插槽。 */
  it('should check nullability', () => {
    const slot = (() => {}) as Slot
    const dynamicSlot = [{ name: 'descriptor', fn: slot, key: '1' }]

    const actual = createSlots(record, dynamicSlot)
    expect(actual).toHaveProperty('descriptor')
  })

  /** 从空记录合并 descriptor 与 descriptor2，检查两个名称都指向原函数，验证多个独立描述符均被登记。 */
  it('should add all slots to the record', () => {
    const dynamicSlot = [
      { name: 'descriptor', fn: slot },
      { name: 'descriptor2', fn: slot },
    ]

    const actual = createSlots(record, dynamicSlot)

    expect(actual).toEqual({ descriptor: slot, descriptor2: slot })
  })

  /** 把 descriptor2 放入一层数组，与独立 descriptor 合并，检查两项映射，验证动态描述符数组被展开。 */
  it('should add slot to the record when given slot is an array', () => {
    const dynamicSlot = [
      { name: 'descriptor', fn: slot },
      [{ name: 'descriptor2', fn: slot }],
    ]

    const actual = createSlots(record, dynamicSlot)

    expect(actual).toEqual({ descriptor: slot, descriptor2: slot })
  })

  /** 数组中同时放 descriptor2 和 descriptor3，再与独立 descriptor 合并，检查三个名称，防止展开时漏掉后续描述符。 */
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
