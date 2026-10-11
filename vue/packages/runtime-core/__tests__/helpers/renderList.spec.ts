/**
 * 直接调用 renderList，检查不同数据源的回调参数、顺序和开发警告。
 * reactive、shallowReactive 与 readonly 数组夹具验证元素代理；effect 夹具检查嵌套更新。
 */
import {
  effect,
  isReactive,
  reactive,
  readonly,
  shallowReactive,
} from '../../src/index'
import { renderList } from '../../src/helpers/renderList'

// renderList 对数组、字符串、数字、Iterable 和对象等 v-for 数据源进行展开。
describe('renderList', () => {
  /** 传入字符串数组1/2/3，回调用元素和索引生成文本；检查顺序与零起点索引，验证数组展开。 */
  it('should render items in an array', () => {
    expect(
      renderList(['1', '2', '3'], (item, index) => `node ${index}: ${item}`),
    ).toEqual(['node 0: 1', 'node 1: 2', 'node 2: 3'])
  })

  /** 传入字符串123，检查回调依次收到字符1/2/3与索引0/1/2，验证字符串逐字符展开。 */
  it('should render characters of a string', () => {
    expect(
      renderList('123', (item, index) => `node ${index}: ${item}`),
    ).toEqual(['node 0: 1', 'node 1: 2', 'node 2: 3'])
  })

  /** 传入数字3，检查回调值为1至3而索引为0至2，验证数值范围的值与索引不同。 */
  it('should render integers 1 through N when given a number N', () => {
    expect(renderList(3, (item, index) => `node ${index}: ${item}`)).toEqual([
      'node 0: 1',
      'node 1: 2',
      'node 2: 3',
    ])
  })

  /** 传入非整数3.1，检查结果为空且出现范围警告，验证非法范围不会生成部分列表。 */
  it('should warn when given a non-integer N', () => {
    expect(renderList(3.1, () => {})).toEqual([])
    expect(
      `The v-for range expects a positive integer value but got 3.1.`,
    ).toHaveBeenWarned()
  })

  /** 传入负数-1，检查结果为空与开发警告，验证负范围被拒绝。 */
  it('should warn when given a negative N', () => {
    expect(renderList(-1, () => {})).toEqual([])
    expect(
      `The v-for range expects a positive integer value but got -1.`,
    ).toHaveBeenWarned()
  })

  /** 传入数字0，检查没有范围警告，区分合法空范围与非法负数；本例不检查返回数组。 */
  it('should not warn when given 0', () => {
    renderList(0, () => {})
    expect(
      `The v-for range expects a positive integer value but got 0.`,
    ).not.toHaveBeenWarned()
  })

  /** 传入a/b/c三个属性，回调拼接值、键和枚举索引；检查顺序与参数组合，验证对象分支。 */
  it('should render properties in an object', () => {
    expect(
      renderList(
        { a: 1, b: 2, c: 3 },
        (item, key, index) => `node ${index}/${key}: ${item}`,
      ),
    ).toEqual(['node 0/a: 1', 'node 1/b: 2', 'node 2/c: 3'])
  })

  /** 生成器依次产出1/2/3，检查 renderList 保持产出顺序并提供零起点索引，验证 Iterable 分支。 */
  it('should render an item for entry in an iterable', () => {
    /** 依次产出1、2、3，供 Iterable 分支验证展开顺序和索引。 */
    const iterable = function* () {
      yield 1
      yield 2
      yield 3
    }

    expect(
      renderList(iterable(), (item, index) => `node ${index}: ${item}`),
    ).toEqual(['node 0: 1', 'node 1: 2', 'node 2: 3'])
  })

  /** 传入数字0并检查空数组，验证空范围的返回值。 */
  it('should return empty array when source is 0', () => {
    expect(renderList(0, (item, index) => `node ${index}: ${item}`)).toEqual([])
  })

  /** 传入 undefined 并检查空数组，验证缺省数据源的返回值。 */
  it('should return empty array when source is undefined', () => {
    expect(
      renderList(undefined, (item, index) => `node ${index}: ${item}`),
    ).toEqual([])
  })

  /** 分别传入深层 reactive 与 shallowReactive 对象数组，用 isReactive 检查元素；结果应为 true 与 false，验证元素包装深度。 */
  it('should render items in a reactive array correctly', () => {
    const reactiveArray = reactive([{ foo: 1 }])
    expect(renderList(reactiveArray, isReactive)).toEqual([true])

    const shallowReactiveArray = shallowReactive([{ foo: 1 }])
    expect(renderList(shallowReactiveArray, isReactive)).toEqual([false])
  })

  /** 向 readonly(reactive(...)) 列表元素写 foo:0，检查读取仍为1并有只读警告，验证 renderList 没有绕过元素只读代理。 */
  it('should not allow mutation', () => {
    const arr = readonly(reactive([{ foo: 1 }]))
    expect(
      renderList(arr, item => {
        ;(item as any).foo = 0
        return item.foo
      }),
    ).toEqual([1])
    expect(
      `Set operation on key "foo" failed: target is readonly.`,
    ).toHaveBeenWarned()
  })

  /** 在 effect 中遍历 readonly 数组读取 foo，随后把底层 reactive 元素从1改为2；检查结果同步改变，验证嵌套依赖仍被收集。 */
  it('should trigger effect for deep mutations in readonly reactive arrays', () => {
    const arr = reactive([{ foo: 1 }])
    const readonlyArr = readonly(arr)

    let dummy
    effect(() => {
      dummy = renderList(readonlyArr, item => item.foo)
    })
    expect(dummy).toEqual([1])

    arr[0].foo = 2
    expect(dummy).toEqual([2])
  })
})
