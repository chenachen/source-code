/**
 * 测试阅读说明：本文件验证 `runtime-core/helpers/renderList` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import {
  effect,
  isReactive,
  reactive,
  readonly,
  shallowReactive,
} from '../../src/index'
import { renderList } from '../../src/helpers/renderList'

// 测试组：renderList 对数组、字符串、数字、Iterable 和对象等 v-for 数据源进行展开。
describe('renderList', () => {
  // 测试场景：应该渲染数组中的项目。
  it('should render items in an array', () => {
    expect(
      renderList(['1', '2', '3'], (item, index) => `node ${index}: ${item}`),
    ).toEqual(['node 0: 1', 'node 1: 2', 'node 2: 3'])
  })

  // 测试场景：应该渲染字符串的字符。
  it('should render characters of a string', () => {
    expect(
      renderList('123', (item, index) => `node ${index}: ${item}`),
    ).toEqual(['node 0: 1', 'node 1: 2', 'node 2: 3'])
  })

  // 测试场景：当给定数字 N 时，应渲染整数 1 到 N。
  it('should render integers 1 through N when given a number N', () => {
    expect(renderList(3, (item, index) => `node ${index}: ${item}`)).toEqual([
      'node 0: 1',
      'node 1: 2',
      'node 2: 3',
    ])
  })

  // 测试场景：当给出非整数 N 时应发出警告。
  it('should warn when given a non-integer N', () => {
    expect(renderList(3.1, () => {})).toEqual([])
    expect(
      `The v-for range expects a positive integer value but got 3.1.`,
    ).toHaveBeenWarned()
  })

  // 测试场景：给出负值 N 时应发出警告。
  it('should warn when given a negative N', () => {
    expect(renderList(-1, () => {})).toEqual([])
    expect(
      `The v-for range expects a positive integer value but got -1.`,
    ).toHaveBeenWarned()
  })

  // 测试场景：给定 0 时不应发出警告。
  it('should not warn when given 0', () => {
    renderList(0, () => {})
    expect(
      `The v-for range expects a positive integer value but got 0.`,
    ).not.toHaveBeenWarned()
  })

  // 测试场景：应该渲染对象中的属性。
  it('should render properties in an object', () => {
    expect(
      renderList(
        { a: 1, b: 2, c: 3 },
        (item, key, index) => `node ${index}/${key}: ${item}`,
      ),
    ).toEqual(['node 0/a: 1', 'node 1/b: 2', 'node 2/c: 3'])
  })

  // 测试场景：应该渲染一个项目以供迭代中的条目。
  it('should render an item for entry in an iterable', () => {
    const iterable = function* () {
      yield 1
      yield 2
      yield 3
    }

    expect(
      renderList(iterable(), (item, index) => `node ${index}: ${item}`),
    ).toEqual(['node 0: 1', 'node 1: 2', 'node 2: 3'])
  })

  // 测试场景：当源为 0 时应返回空数组。
  it('should return empty array when source is 0', () => {
    expect(renderList(0, (item, index) => `node ${index}: ${item}`)).toEqual([])
  })

  // 测试场景：当源未定义时应返回空数组。
  it('should return empty array when source is undefined', () => {
    expect(
      renderList(undefined, (item, index) => `node ${index}: ${item}`),
    ).toEqual([])
  })

  // 测试场景：应该正确渲染 reactive 数组中的项目。
  it('should render items in a reactive array correctly', () => {
    const reactiveArray = reactive([{ foo: 1 }])
    expect(renderList(reactiveArray, isReactive)).toEqual([true])

    const shallowReactiveArray = shallowReactive([{ foo: 1 }])
    expect(renderList(shallowReactiveArray, isReactive)).toEqual([false])
  })

  // 测试场景：不应该允许突变。
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

  // 测试场景：应该触发 effect 进行 readonly reactive 阵列中的深度突变。
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
