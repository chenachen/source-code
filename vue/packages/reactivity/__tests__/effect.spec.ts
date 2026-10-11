import {
  type DebuggerEvent,
  type ReactiveEffectRunner,
  TrackOpTypes,
  TriggerOpTypes,
  effect,
  markRaw,
  reactive,
  readonly,
  shallowReactive,
  stop,
  toRaw,
} from '../src/index'
import { type Dep, ITERATE_KEY, getDepFromReactive } from '../src/dep'
import {
  computed,
  h,
  nextTick,
  nodeOps,
  ref,
  render,
  serializeInner,
} from '@vue/runtime-test'
import {
  endBatch,
  onEffectCleanup,
  pauseTracking,
  resetTracking,
  startBatch,
} from '../src/effect'

describe('reactivity/effect', () => {
  /**
   * 把空函数 spy 传给 effect；创建时立即调用一次，验证 effect 默认执行传入函数。
   */
  it('should run the passed function once (wrapped by a effect)', () => {
    const fnSpy = vi.fn(() => {})
    effect(fnSpy)
    expect(fnSpy).toHaveBeenCalledTimes(1)
  })

  /**
   * effect 读取响应式 counter.num = 0；赋 num = 7 后 dummy 同步为 7，验证普通属性 SET 的依赖通知。
   */
  it('should observe basic properties', () => {
    let dummy
    const counter = reactive({ num: 0 })
    effect(() => (dummy = counter.num))

    expect(dummy).toBe(0)
    counter.num = 7
    expect(dummy).toBe(7)
  })

  /**
   * effect 两次读取 num1、一次读取 num2，初始均为 0；把两者设为 7 后 dummy 为 21，验证重复读取同一属性与多个属性共同参与更新。
   */
  it('should observe multiple properties', () => {
    let dummy
    const counter = reactive({ num1: 0, num2: 0 })
    effect(() => (dummy = counter.num1 + counter.num1 + counter.num2))

    expect(dummy).toBe(0)
    counter.num1 = counter.num2 = 7
    expect(dummy).toBe(21)
  })

  /**
   * 两个 effect 同时读取 num = 0；num 自增后两个 dummy 都为 1，验证同一属性可通知多个订阅者。
   */
  it('should handle multiple effects', () => {
    let dummy1, dummy2
    const counter = reactive({ num: 0 })
    effect(() => (dummy1 = counter.num))
    effect(() => (dummy2 = counter.num))

    expect(dummy1).toBe(0)
    expect(dummy2).toBe(0)
    counter.num++
    expect(dummy1).toBe(1)
    expect(dummy2).toBe(1)
  })

  /**
   * effect 读取对象内部 nested.num = 0；把嵌套值设为 8 后 dummy 为 8，验证深层代理的属性订阅。
   */
  it('should observe nested properties', () => {
    let dummy
    const counter = reactive({ nested: { num: 0 } })
    effect(() => (dummy = counter.nested.num))

    expect(dummy).toBe(0)
    counter.nested.num = 8
    expect(dummy).toBe(8)
  })

  /**
   * effect 读取可删除属性 prop = value；删除 prop 后 dummy 为 undefined，验证 DELETE 通知读取订阅者。
   */
  it('should observe delete operations', () => {
    let dummy
    const obj = reactive<{
      /**
       * 可删除的字符串属性，用于检查读取订阅收到 DELETE。
       */
      prop?: string
    }>({ prop: 'value' })
    effect(() => (dummy = obj.prop))

    expect(dummy).toBe('value')
    delete obj.prop
    expect(dummy).toBe(undefined)
  })

  /**
   * effect 检查 prop 是否存在，初始为真；删除后为假，重新添加数字值后为真，验证 HAS 依赖随属性增删更新。
   */
  it('should observe has operations', () => {
    let dummy
    const obj = reactive<{
      /** 允许删除和重新添加的属性，用于检查 HAS 订阅。 */
      prop?: string | number
    }>({ prop: 'value' })
    effect(() => (dummy = 'prop' in obj))

    expect(dummy).toBe(true)
    delete obj.prop
    expect(dummy).toBe(false)
    obj.prop = 12
    expect(dummy).toBe(true)
  })

  /**
   * 子对象 num = 0、响应式原型 num = 2；删除自有属性后读取回退为 2，修改原型后为 4，再给子对象赋 3 后读取为 3，验证原型链 GET 依赖与遮蔽。
   */
  it('should observe properties on the prototype chain', () => {
    let dummy
    const counter = reactive<{
      /** 子对象的可选数值字段，删除后读取响应式原型的同名字段。 */
      num?: number
    }>({ num: 0 })
    const parentCounter = reactive({ num: 2 })
    Object.setPrototypeOf(counter, parentCounter)
    effect(() => (dummy = counter.num))

    expect(dummy).toBe(0)
    delete counter.num
    expect(dummy).toBe(2)
    parentCounter.num = 4
    expect(dummy).toBe(4)
    counter.num = 3
    expect(dummy).toBe(3)
  })

  /**
   * 子对象和响应式原型都含 num；删除子属性后 in 仍为真，删除原型属性后为假，再添加子属性后为真，验证原型链 HAS 依赖。
   */
  it('should observe has operations on the prototype chain', () => {
    let dummy
    const counter = reactive<{
      /** 子对象的可选字段，用于检查原型链上的存在性。 */
      num?: number
    }>({ num: 0 })
    const parentCounter = reactive<{
      /** 原型的可选字段，删除它后整个原型链不再含 num。 */
      num?: number
    }>({ num: 2 })
    Object.setPrototypeOf(counter, parentCounter)
    effect(() => (dummy = 'num' in counter))

    expect(dummy).toBe(true)
    delete counter.num
    expect(dummy).toBe(true)
    delete parentCounter.num
    expect(dummy).toBe(false)
    counter.num = 3
    expect(dummy).toBe(true)
  })

  /**
   * 子对象继承共享 hiddenValue 的访问器，并分别由 effect 读取子对象和原型的 prop；写子对象为 4 后子 dummy 为 4，写原型为 2 后两者都为 2，验证继承访问器的订阅通知。被注释的 parentDummy = 4 断言不作为验证结果。
   */
  it('should observe inherited property accessors', () => {
    let dummy, parentDummy, hiddenValue: any
    const obj = reactive<{
      /** 子对象继承的可选属性类型，实际读写由原型访问器处理。 */
      prop?: number
    }>({})
    const parent = reactive({
      /**
       * 把继承属性写入共享 hiddenValue，以比较子对象和原型的通知。
       */
      set prop(value) {
        hiddenValue = value
      },
      /**
       * 返回共享 hiddenValue，使子对象和原型读取相同访问器结果。
       */
      get prop() {
        return hiddenValue
      },
    })
    Object.setPrototypeOf(obj, parent)
    effect(() => (dummy = obj.prop))
    effect(() => (parentDummy = parent.prop))

    expect(dummy).toBe(undefined)
    expect(parentDummy).toBe(undefined)
    obj.prop = 4
    expect(dummy).toBe(4)
    // 下方父级值为 4 的历史断言未启用；当前只核对子对象值为 4。
    // expect(parentDummy).toBe(4)
    parent.prop = 2
    expect(dummy).toBe(2)
    expect(parentDummy).toBe(2)
  })

  /**
   * getNum 函数读取 counter.num = 0，effect 调用该函数；把 num 设为 2 后 dummy 为 2，验证依赖收集能穿过普通函数调用。
   */
  it('should observe function call chains', () => {
    let dummy
    const counter = reactive({ num: 0 })
    effect(() => (dummy = getNum()))

    /**
     * 读取响应式 counter.num，让 effect 经普通函数调用收集依赖。
     */
    function getNum() {
      return counter.num
    }

    expect(dummy).toBe(0)
    counter.num = 2
    expect(dummy).toBe(2)
  })

  /**
   * effect 对初始数组 [Hello] 执行 join；push World! 后为 Hello World!，shift 后为 World!，验证数组迭代读取随增删更新。
   */
  it('should observe iteration', () => {
    let dummy
    const list = reactive(['Hello'])
    effect(() => (dummy = list.join(' ')))

    expect(dummy).toBe('Hello')
    list.push('World!')
    expect(dummy).toBe('Hello World!')
    list.shift()
    expect(dummy).toBe('World!')
  })

  /**
   * effect 对 [Hello] 执行 join；写索引 1 为 World!、再写索引 3 为 Hello!，最后结果为 Hello World!  Hello!（中间两空格），验证索引写入隐式扩展 length 时更新迭代结果。
   */
  it('should observe implicit array length changes', () => {
    let dummy
    const list = reactive(['Hello'])
    effect(() => (dummy = list.join(' ')))

    expect(dummy).toBe('Hello')
    list[1] = 'World!'
    expect(dummy).toBe('Hello World!')
    list[3] = 'Hello!'
    expect(dummy).toBe('Hello World!  Hello!')
  })

  /**
   * 响应式空数组先写索引 1 为 World! 形成空槽，再注册 join 的 effect；初读为带前导空格的 World!，补索引 0 为 Hello 后得到 Hello World!，pop 后为 Hello，验证稀疏数组的补项和删除。
   */
  it('should observe sparse array mutations', () => {
    let dummy
    const list = reactive<string[]>([])
    list[1] = 'World!'
    effect(() => (dummy = list.join(' ')))

    expect(dummy).toBe(' World!')
    list[0] = 'Hello'
    expect(dummy).toBe('Hello World!')
    list.pop()
    expect(dummy).toBe('Hello')
  })

  /**
   * effect 用 for...in 累加初始 num1 = 3；增加 num2 = 4 后和为 7，删除 num1 后和为 4，验证属性枚举依赖。
   */
  it('should observe enumeration', () => {
    let dummy = 0
    const numbers = reactive<Record<string, number>>({ num1: 3 })
    effect(() => {
      dummy = 0
      for (let key in numbers) {
        dummy += numbers[key]
      }
    })

    expect(dummy).toBe(3)
    numbers.num2 = 4
    expect(dummy).toBe(7)
    delete numbers.num1
    expect(dummy).toBe(4)
  })

  /**
   * 两个 effect 分别读取自定义 Symbol 属性和检查其存在；属性从 value 改为 newValue 后读取更新，删除后读为 undefined 且存在检查为假，验证 Symbol 的 GET、HAS 通知。
   */
  it('should observe symbol keyed properties', () => {
    const key = Symbol('symbol keyed prop')
    let dummy, hasDummy
    const obj = reactive<{
      /** 以当前自定义 Symbol 为键的可删除属性，分别覆盖 GET 和 HAS。 */
      [key]?: string
    }>({ [key]: 'value' })
    effect(() => (dummy = obj[key]))
    effect(() => (hasDummy = key in obj))

    expect(dummy).toBe('value')
    expect(hasDummy).toBe(true)
    obj[key] = 'newValue'
    expect(dummy).toBe('newValue')
    delete obj[key]
    expect(dummy).toBe(undefined)
    expect(hasDummy).toBe(false)
  })

  /**
   * effect 读取数组的 Symbol.isConcatSpreadable，初始为 undefined；写为 true 后实际属性为 true，但 dummy 仍为 undefined，验证内建 Symbol 读取不被收集。
   */
  it('should not observe well-known symbol keyed properties', () => {
    const key = Symbol.isConcatSpreadable
    let dummy
    const array: any = reactive([])
    effect(() => (dummy = array[key]))

    expect(array[key]).toBe(undefined)
    expect(dummy).toBe(undefined)
    array[key] = true
    expect(array[key]).toBe(true)
    expect(dummy).toBe(undefined)
  })

  /**
   * effect 用 in 检查对象的内建 Symbol 属性；把其值由 true 改为 false 后 spy 仍只一次，验证内建 Symbol 的 HAS 检查不订阅。
   */
  it('should not observe well-known symbol keyed properties in has operation', () => {
    const key = Symbol.isConcatSpreadable
    const obj = reactive({
      [key]: true,
    }) as any

    const spy = vi.fn(() => {
      key in obj
    })
    effect(spy)
    expect(spy).toHaveBeenCalledTimes(1)

    obj[key] = false
    expect(spy).toHaveBeenCalledTimes(1)
  })

  /**
   * effect 只读取 [1, 2, 3] 的自定义 Symbol 属性，初值为 undefined；pop、shift、splice 不改变 dummy，给 Symbol 赋 value 后再清空 length 仍保留 value，验证普通数组变更不误通知 Symbol 读取。
   */
  it('should support manipulating an array while observing symbol keyed properties', () => {
    const key = Symbol()
    let dummy
    const array: any = reactive([1, 2, 3])
    effect(() => (dummy = array[key]))

    expect(dummy).toBe(undefined)
    array.pop()
    array.shift()
    array.splice(0, 1)
    expect(dummy).toBe(undefined)
    array[key] = 'value'
    array.length = 0
    expect(dummy).toBe('value')
  })

  /**
   * 响应式属性 func 初始保存 oldFunc，effect 记录函数引用；替换为 newFunc 后 dummy 变为新引用，验证函数作为属性值同样参与变更检测。
   */
  it('should observe function valued properties', () => {
    /**
     * 初始空函数值；测试仅比较引用，不执行函数体。
     */
    const oldFunc = () => {}
    /**
     * 替换后的空函数值，用不同引用触发 func 属性更新。
     */
    const newFunc = () => {}

    let dummy
    const obj = reactive({ func: oldFunc })
    effect(() => (dummy = obj.func))

    expect(dummy).toBe(oldFunc)
    obj.func = newFunc
    expect(dummy).toBe(newFunc)
  })

  /**
   * 对象 getter b 返回 this.a = 1，effect 读取 b；a 自增后 dummy 为 2，验证访问器中的 this 指向代理并追踪 a。
   */
  it('should observe chained getters relying on this', () => {
    const obj = reactive({
      a: 1,
      /**
       * 通过代理 this 读取 a，把 getter 的内部读取纳入当前 effect。
       */
      get b() {
        return this.a
      },
    })

    let dummy
    effect(() => (dummy = obj.b))
    expect(dummy).toBe(1)
    obj.a++
    expect(dummy).toBe(2)
  })

  /**
   * 对象方法 b 返回 this.a = 1，effect 调用 b；a 自增后 dummy 为 2，验证方法中的代理 this 读取参与依赖收集。
   */
  it('should observe methods relying on this', () => {
    const obj = reactive({
      a: 1,
      /**
       * 通过代理 this 读取 a，把方法调用中的读取纳入当前 effect。
       */
      b() {
        return this.a
      },
    })

    let dummy
    effect(() => (dummy = obj.b()))
    expect(dummy).toBe(1)
    obj.a++
    expect(dummy).toBe(2)
  })

  /**
   * 两个 effect 分别读取 prop 和检查 prop 存在；重复赋入初始 value 后两个 spy 都只一次，验证同值 SET 不通知 GET 或 HAS 订阅。
   */
  it('should not observe set operations without a value change', () => {
    let hasDummy, getDummy
    const obj = reactive({ prop: 'value' })

    const getSpy = vi.fn(() => (getDummy = obj.prop))
    const hasSpy = vi.fn(() => (hasDummy = 'prop' in obj))
    effect(getSpy)
    effect(hasSpy)

    expect(getDummy).toBe('value')
    expect(hasDummy).toBe(true)
    obj.prop = 'value'
    expect(getSpy).toHaveBeenCalledTimes(1)
    expect(hasSpy).toHaveBeenCalledTimes(1)
    expect(getDummy).toBe('value')
    expect(hasDummy).toBe(true)
  })

  /**
   * effect 通过 toRaw 读取空对象的 prop；随后经代理赋 value，dummy 仍为 undefined，验证原始对象读取没有建立代理依赖。
   */
  it('should not observe raw mutations', () => {
    let dummy
    const obj = reactive<{
      /** 初始缺失的可选字段，用于原始对象读取不收集依赖的场景。 */
      prop?: string
    }>({})
    effect(() => (dummy = toRaw(obj).prop))

    expect(dummy).toBe(undefined)
    obj.prop = 'value'
    expect(dummy).toBe(undefined)
  })

  /**
   * effect 经代理读取空对象的 prop；随后通过 toRaw 写入 value，dummy 仍为 undefined，验证原始对象写入绕过通知。
   */
  it('should not be triggered by raw mutations', () => {
    let dummy
    const obj = reactive<{
      /** 初始缺失的可选字段，用于原始对象写入不触发通知的场景。 */
      prop?: string
    }>({})
    effect(() => (dummy = obj.prop))

    expect(dummy).toBe(undefined)
    toRaw(obj).prop = 'value'
    expect(dummy).toBe(undefined)
  })

  /**
   * 子对象继承共享 hiddenValue 的访问器，effect 分别读子对象和原型；通过 toRaw(obj).prop 写入 4 后两个 dummy 仍为 undefined，验证原始 receiver 的继承 setter 写入不通知代理订阅。
   */
  it('should not be triggered by inherited raw setters', () => {
    let dummy, parentDummy, hiddenValue: any
    const obj = reactive<{
      /** 子对象继承的可选属性，供原始 receiver 写入访问器。 */
      prop?: number
    }>({})
    const parent = reactive({
      /**
       * 写入共享 hiddenValue，用于检查 toRaw receiver 绕过通知的路径。
       */
      set prop(value) {
        hiddenValue = value
      },
      /**
       * 返回共享 hiddenValue，供子对象与原型各自读取。
       */
      get prop() {
        return hiddenValue
      },
    })
    Object.setPrototypeOf(obj, parent)
    effect(() => (dummy = obj.prop))
    effect(() => (parentDummy = parent.prop))

    expect(dummy).toBe(undefined)
    expect(parentDummy).toBe(undefined)
    toRaw(obj).prop = 4
    expect(dummy).toBe(undefined)
    expect(parentDummy).toBe(undefined)
  })

  /**
   * effect 内部自增 num，创建后 num 为 1 且 spy 一次；外部设 num = 4 后 effect 只再执行一次使 num 为 5，验证执行中自写不会无限递归。
   */
  it('should avoid implicit infinite recursive loops with itself', () => {
    const counter = reactive({ num: 0 })

    const counterSpy = vi.fn(() => counter.num++)
    effect(counterSpy)
    expect(counter.num).toBe(1)
    expect(counterSpy).toHaveBeenCalledTimes(1)
    counter.num = 4
    expect(counter.num).toBe(5)
    expect(counterSpy).toHaveBeenCalledTimes(2)
  })

  /**
   * 循环覆盖 push、unshift、pop、shift，各由两个 effect 修改同一数组；前两种从空数组各加 1、2，后两种从 [1, 2, 3, 4] 各删一项，最终长度都为 2、每个 spy 仅一次，验证数组操作避免收集导致自身循环的 length 依赖。
   */
  it('should avoid infinite recursive loops when use Array.prototype.push/unshift/pop/shift', () => {
    ;(['push', 'unshift'] as const).forEach(key => {
      const arr = reactive<number[]>([])
      const counterSpy1 = vi.fn(() => (arr[key] as any)(1))
      const counterSpy2 = vi.fn(() => (arr[key] as any)(2))
      effect(counterSpy1)
      effect(counterSpy2)
      expect(arr.length).toBe(2)
      expect(counterSpy1).toHaveBeenCalledTimes(1)
      expect(counterSpy2).toHaveBeenCalledTimes(1)
    })
    ;(['pop', 'shift'] as const).forEach(key => {
      const arr = reactive<number[]>([1, 2, 3, 4])
      const counterSpy1 = vi.fn(() => (arr[key] as any)())
      const counterSpy2 = vi.fn(() => (arr[key] as any)())
      effect(counterSpy1)
      effect(counterSpy2)
      expect(arr.length).toBe(2)
      expect(counterSpy1).toHaveBeenCalledTimes(1)
      expect(counterSpy2).toHaveBeenCalledTimes(1)
    })
  })

  /**
   * 原始 spy 函数主动递归自增 num，直到 num 为 10，再交给 effect 执行；断言 num = 10 且函数调用十次，验证显式函数递归仍可执行。
   */
  it('should allow explicitly recursive raw function loops', () => {
    const counter = reactive({ num: 0 })
    const numSpy = vi.fn(() => {
      counter.num++
      if (counter.num < 10) {
        numSpy()
      }
    })
    effect(numSpy)
    expect(counter.num).toEqual(10)
    expect(numSpy).toHaveBeenCalledTimes(10)
  })

  /**
   * 两个 effect 分别把 num2 赋给 num1、把 num1 赋给 num2；初始两值收敛为 1，外部写 4、10 后均收敛且每个 spy 只各新增一次，验证相互写入不会形成无限循环。
   */
  it('should avoid infinite loops with other effects', () => {
    const nums = reactive({ num1: 0, num2: 1 })

    const spy1 = vi.fn(() => (nums.num1 = nums.num2))
    const spy2 = vi.fn(() => (nums.num2 = nums.num1))
    effect(spy1)
    effect(spy2)
    expect(nums.num1).toBe(1)
    expect(nums.num2).toBe(1)
    expect(spy1).toHaveBeenCalledTimes(1)
    expect(spy2).toHaveBeenCalledTimes(1)
    nums.num2 = 4
    expect(nums.num1).toBe(4)
    expect(nums.num2).toBe(4)
    expect(spy1).toHaveBeenCalledTimes(2)
    expect(spy2).toHaveBeenCalledTimes(2)
    nums.num1 = 10
    expect(nums.num1).toBe(10)
    expect(nums.num2).toBe(10)
    expect(spy1).toHaveBeenCalledTimes(3)
    expect(spy2).toHaveBeenCalledTimes(3)
  })

  /**
   * 把同一个返回 Hello World 的 greet 函数分别交给两个 effect；返回的两个 runner 都是函数且互不相同、也不等于 greet，验证每次创建返回独立 runner。
   */
  it('should return a new reactive version of the function', () => {
    /**
     * 返回固定问候文本，供比较同一函数创建的两个独立 effect runner。
     */
    function greet() {
      return 'Hello World'
    }
    const effect1 = effect(greet)
    const effect2 = effect(greet)
    expect(typeof effect1).toBe('function')
    expect(typeof effect2).toBe('function')
    expect(effect1).not.toBe(greet)
    expect(effect1).not.toBe(effect2)
  })

  /**
   * 响应式 run 初始为 false，effect 返回 other 而不读 prop；修改 prop 不执行，打开 run 后读取 Hi，再改 prop 得到 World，验证自动重跑能发现新分支依赖。
   */
  it('should discover new branches while running automatically', () => {
    let dummy
    const obj = reactive({ prop: 'value', run: false })

    const conditionalSpy = vi.fn(() => {
      dummy = obj.run ? obj.prop : 'other'
    })
    effect(conditionalSpy)

    expect(dummy).toBe('other')
    expect(conditionalSpy).toHaveBeenCalledTimes(1)
    obj.prop = 'Hi'
    expect(dummy).toBe('other')
    expect(conditionalSpy).toHaveBeenCalledTimes(1)
    obj.run = true
    expect(dummy).toBe('Hi')
    expect(conditionalSpy).toHaveBeenCalledTimes(2)
    obj.prop = 'World'
    expect(dummy).toBe('World')
    expect(conditionalSpy).toHaveBeenCalledTimes(3)
  })

  /**
   * 普通布尔变量 run 初始为 false，runner 读取 other；手动执行后再把 run 改为 true 并手动执行，之后 prop 改为 World 能自动更新，验证手动 runner 同样重收集分支依赖。
   */
  it('should discover new branches when running manually', () => {
    let dummy
    let run = false
    const obj = reactive({ prop: 'value' })
    const runner = effect(() => {
      dummy = run ? obj.prop : 'other'
    })

    expect(dummy).toBe('other')
    runner()
    expect(dummy).toBe('other')
    run = true
    runner()
    expect(dummy).toBe('value')
    obj.prop = 'World'
    expect(dummy).toBe('World')
  })

  /**
   * 响应式 run 初始为 true，effect 读取 prop；关闭 run 后结果为 other，再改 prop 不增加 spy 次数，验证不活跃分支的依赖被清理。
   */
  it('should not be triggered by mutating a property, which is used in an inactive branch', () => {
    let dummy
    const obj = reactive({ prop: 'value', run: true })

    const conditionalSpy = vi.fn(() => {
      dummy = obj.run ? obj.prop : 'other'
    })
    effect(conditionalSpy)

    expect(dummy).toBe('value')
    expect(conditionalSpy).toHaveBeenCalledTimes(1)
    obj.run = false
    expect(dummy).toBe('other')
    expect(conditionalSpy).toHaveBeenCalledTimes(2)
    obj.prop = 'value2'
    expect(dummy).toBe('other')
    expect(conditionalSpy).toHaveBeenCalledTimes(2)
  })

  /**
   * 从 results[0] = 0 建立 39 个逐层乘 2 的 effect；把根值设为 1 后第 39 项为 2 的 39 次方，验证深层嵌套触发能正确完成。测试名保留历史 cleanup fallback 表述，断言只检查传播结果。
   */
  it('should handle deep effect recursion using cleanup fallback', () => {
    const results = reactive([0])
    const effects: {
      /** 当前层的 effect runner，与 index 一起保存链式测试条目。 */
      fx: ReactiveEffectRunner;
      /** 当前层对应 results 的索引，标识逐层乘 2 的位置。 */
      index: number
    }[] = []
    for (let i = 1; i < 40; i++) {
      ;(index => {
        const fx = effect(() => {
          results[index] = results[index - 1] * 2
        })
        effects.push({ fx, index })
      })(i)
    }

    expect(results[39]).toBe(0)
    results[0] = 1
    expect(results[39]).toBe(Math.pow(2, 39))
  })

  /**
   * 输入 a = 1、b = 2、c = 0，独立创建的 fx2 读取 fx1 的输出；依次写 b = 3、c = 1/2/3、a = 10，输出依次为 [1, 4]、[1, 4]、[3, 7]、[3, 4]、[3, 13]，每步清零后的调用次数分别为 [0, 1]、[1, 1]、[1, 1]、[1, 1]、[0, 1]，验证联动通知中各 effect 独立维护动态依赖。
   */
  it('should register deps independently during effect recursion', () => {
    const input = reactive({ a: 1, b: 2, c: 0 })
    const output = reactive({ fx1: 0, fx2: 0 })

    const fx1Spy = vi.fn(() => {
      let result = 0
      if (input.c < 2) result += input.a
      if (input.c > 1) result += input.b
      output.fx1 = result
    })

    const fx1 = effect(fx1Spy)

    const fx2Spy = vi.fn(() => {
      let result = 0
      if (input.c > 1) result += input.a
      if (input.c < 3) result += input.b
      output.fx2 = result + output.fx1
    })

    const fx2 = effect(fx2Spy)

    expect(fx1).not.toBeNull()
    expect(fx2).not.toBeNull()

    expect(output.fx1).toBe(1)
    expect(output.fx2).toBe(2 + 1)
    expect(fx1Spy).toHaveBeenCalledTimes(1)
    expect(fx2Spy).toHaveBeenCalledTimes(1)

    fx1Spy.mockClear()
    fx2Spy.mockClear()
    input.b = 3
    expect(output.fx1).toBe(1)
    expect(output.fx2).toBe(3 + 1)
    expect(fx1Spy).toHaveBeenCalledTimes(0)
    expect(fx2Spy).toHaveBeenCalledTimes(1)

    fx1Spy.mockClear()
    fx2Spy.mockClear()
    input.c = 1
    expect(output.fx1).toBe(1)
    expect(output.fx2).toBe(3 + 1)
    expect(fx1Spy).toHaveBeenCalledTimes(1)
    expect(fx2Spy).toHaveBeenCalledTimes(1)

    fx1Spy.mockClear()
    fx2Spy.mockClear()
    input.c = 2
    expect(output.fx1).toBe(3)
    expect(output.fx2).toBe(1 + 3 + 3)
    expect(fx1Spy).toHaveBeenCalledTimes(1)

    // fx1 的值变化还会触发读取它的 fx2。
    expect(fx2Spy).toHaveBeenCalledTimes(1)

    fx1Spy.mockClear()
    fx2Spy.mockClear()
    input.c = 3
    expect(output.fx1).toBe(3)
    expect(output.fx2).toBe(1 + 3)
    expect(fx1Spy).toHaveBeenCalledTimes(1)
    expect(fx2Spy).toHaveBeenCalledTimes(1)

    fx1Spy.mockClear()
    fx2Spy.mockClear()
    input.a = 10
    expect(output.fx1).toBe(3)
    expect(output.fx2).toBe(10 + 3)
    expect(fx1Spy).toHaveBeenCalledTimes(0)
    expect(fx2Spy).toHaveBeenCalledTimes(1)
  })

  /**
   * 把已有 effect runner 再交给 effect；新 runner 与旧 runner 不同，但底层 effect.fn 相同，验证识别真实 runner 后复用原函数而不嵌套包装 runner。
   */
  it('should not double wrap if the passed function is a effect', () => {
    const runner = effect(() => {})
    const otherRunner = effect(runner)
    expect(runner).not.toBe(otherRunner)
    expect(runner.effect.fn).toBe(otherRunner.effect.fn)
  })

  /**
   * 普通空函数 fakeRunner 手动带上一个空 effect 属性；交给 effect 后返回不同 runner，底层 fn 仍为 fakeRunner，验证仅伪造属性不会被当作真实 runner 解包。
   */
  it('should wrap if the passed function is a fake effect', () => {
    /**
     * 仅手动添加 effect 属性的普通空函数，用于区分真实 runner。
     */
    const fakeRunner = () => {}
    fakeRunner.effect = {}
    const runner = effect(fakeRunner)
    expect(fakeRunner).not.toBe(runner)
    expect(runner.effect.fn).toBe(fakeRunner)
  })

  /**
   * effect 同时枚举空对象并读取 prop；新增 prop = 16 后 spy 从一次变为两次，验证一次新增同时命中多个依赖时合并通知。
   */
  it('should not run multiple times for a single mutation', () => {
    let dummy
    const obj = reactive<Record<string, number>>({})
    const fnSpy = vi.fn(() => {
      for (const key in obj) {
        dummy = obj[key]
      }
      dummy = obj.prop
    })
    effect(fnSpy)

    expect(fnSpy).toHaveBeenCalledTimes(1)
    obj.prop = 16
    expect(dummy).toBe(16)
    expect(fnSpy).toHaveBeenCalledTimes(2)
  })

  /**
   * num1/num2/num3 初始为 0/1/2，父 effect 读 num2、调用读取 num1 的子 runner、再读 num3；依次设 num1 = 4、num2 = 10、num3 = 7，父/子总调用次数为 3/5，结果为 4/10/7，验证子依赖单独通知、父执行恢复各自收集上下文。
   */
  it('should allow nested effects', () => {
    const nums = reactive({ num1: 0, num2: 1, num3: 2 })
    const dummy: any = {}

    const childSpy = vi.fn(() => (dummy.num1 = nums.num1))
    const childeffect = effect(childSpy)
    const parentSpy = vi.fn(() => {
      dummy.num2 = nums.num2
      childeffect()
      dummy.num3 = nums.num3
    })
    effect(parentSpy)

    expect(dummy).toEqual({ num1: 0, num2: 1, num3: 2 })
    expect(parentSpy).toHaveBeenCalledTimes(1)
    expect(childSpy).toHaveBeenCalledTimes(2)
    // 仅 num1 变化，只有子 effect 执行。
    nums.num1 = 4
    expect(dummy).toEqual({ num1: 4, num2: 1, num3: 2 })
    expect(parentSpy).toHaveBeenCalledTimes(1)
    expect(childSpy).toHaveBeenCalledTimes(3)
    // 父 effect 的依赖变化，父执行时会手动调用子 runner 一次。
    nums.num2 = 10
    expect(dummy).toEqual({ num1: 4, num2: 10, num3: 2 })
    expect(parentSpy).toHaveBeenCalledTimes(2)
    expect(childSpy).toHaveBeenCalledTimes(4)
    // 父 effect 的依赖变化，父执行时会手动调用子 runner 一次。
    nums.num3 = 7
    expect(dummy).toEqual({ num1: 4, num2: 10, num3: 7 })
    expect(parentSpy).toHaveBeenCalledTimes(3)
    expect(childSpy).toHaveBeenCalledTimes(5)
  })

  /**
   * effect 对响应式空对象先 JSON.stringify 再 JSON.parse；新增 a = 1 后解析结果的 a 为 1，验证 JSON 枚举与属性读取可建立依赖。
   */
  it('should observe json methods', () => {
    let dummy = <Record<string, number>>{}
    const obj = reactive<Record<string, number>>({})
    effect(() => {
      dummy = JSON.parse(JSON.stringify(obj))
    })
    obj.a = 1
    expect(dummy.a).toBe(1)
  })

  /**
   * Model 实例的 count 初始为 0，reactive 包装后由 effect 读取；调用 model.inc 后 dummy 为 1，验证类方法对代理实例字段的修改能触发订阅。
   */
  it('should observe class method invocations', () => {
    /**
     * 带字段和实例方法的测试模型，用于验证 reactive 类实例。
     */
    class Model {
      /**
       * 被 effect 读取、由 inc 修改的数值字段。
       */
      count: number
      /**
       * 将模型计数初始化为 0，提供首次订阅的基线值。
       */
      constructor() {
        this.count = 0
      }
      /**
       * 把当前实例 count 自增一次，测试通过代理实例调用的方法写入。
       */
      inc() {
        this.count++
      }
    }
    const model = reactive(new Model())
    let dummy
    effect(() => {
      dummy = model.count
    })
    expect(dummy).toBe(0)
    model.inc()
    expect(dummy).toBe(1)
  })

  /**
   * 带 scheduler 的 effect 首次直接读取 foo = 1；foo 自增只调用 scheduler、dummy 仍为 1，手动调用 runner 后为 2，验证调度器接管后续执行。
   */
  it('scheduler', () => {
    let dummy
    let run: any
    const scheduler = vi.fn(() => {
      run = runner
    })
    const obj = reactive({ foo: 1 })
    const runner = effect(
      () => {
        dummy = obj.foo
      },
      { scheduler },
    )
    expect(scheduler).not.toHaveBeenCalled()
    expect(dummy).toBe(1)
    // 首次源变化调用调度器。
    obj.foo++
    expect(scheduler).toHaveBeenCalledTimes(1)
    // 调度器尚未调用 runner，effect 结果仍保持旧值。
    expect(dummy).toBe(1)
    // 手动执行 runner，读取最新源值。
    run()
    // 手动执行后结果已更新。
    expect(dummy).toBe(2)
  })

  /**
   * effect 读取 foo、检查 bar、枚举键，并配置 onTrack；核对三条 GET、HAS、ITERATE 事件中的 effect、原始 target 和 key，验证普通 effect 的依赖调试事件。
   */
  it('events: onTrack', () => {
    let events: DebuggerEvent[] = []
    let dummy
    const onTrack = vi.fn((e: DebuggerEvent) => {
      events.push(e)
    })
    const obj = reactive({ foo: 1, bar: 2 })
    const runner = effect(
      () => {
        dummy = obj.foo
        dummy = 'bar' in obj
        dummy = Object.keys(obj)
      },
      { onTrack },
    )
    expect(dummy).toEqual(['foo', 'bar'])
    expect(onTrack).toHaveBeenCalledTimes(3)
    expect(events).toEqual([
      {
        effect: runner.effect,
        target: toRaw(obj),
        type: TrackOpTypes.GET,
        key: 'foo',
      },
      {
        effect: runner.effect,
        target: toRaw(obj),
        type: TrackOpTypes.HAS,
        key: 'bar',
      },
      {
        effect: runner.effect,
        target: toRaw(obj),
        type: TrackOpTypes.ITERATE,
        key: ITERATE_KEY,
      },
    ])
  })

  /**
   * 两个 effect 依次订阅 ref(0)，onTrack 分别记录 1、2；断言序列为 [1, 2]，验证依赖收集回调按实际注册读取顺序执行。
   */
  it('debug: the call sequence of onTrack', () => {
    const seq: number[] = []
    const s = ref(0)

    /**
     * 记录第一条 onTrack 回调的顺序编号 1。
     */
    const track1 = () => seq.push(1)
    /**
     * 记录第二条 onTrack 回调的顺序编号 2。
     */
    const track2 = () => seq.push(2)

    effect(
      () => {
        s.value
      },
      {
        onTrack: track1,
      },
    )
    effect(
      () => {
        s.value
      },
      {
        onTrack: track2,
      },
    )
    expect(seq.toString()).toBe('1,2')
  })

  /**
   * effect 订阅 foo = 1 并配置 onTrigger；自增后核对 SET 事件的 1 → 2，再删除后核对 DELETE 的旧值 2，验证变更类型和新旧值。
   */
  it('events: onTrigger', () => {
    let events: DebuggerEvent[] = []
    let dummy
    const onTrigger = vi.fn((e: DebuggerEvent) => {
      events.push(e)
    })
    const obj = reactive<{
      /** 允许删除的数值源字段，用于核对 SET、DELETE 的调试信息。 */
      foo?: number
    }>({ foo: 1 })
    const runner = effect(
      () => {
        dummy = obj.foo
      },
      { onTrigger },
    )

    obj.foo!++
    expect(dummy).toBe(2)
    expect(onTrigger).toHaveBeenCalledTimes(1)
    expect(events[0]).toEqual({
      effect: runner.effect,
      target: toRaw(obj),
      type: TriggerOpTypes.SET,
      key: 'foo',
      oldValue: 1,
      newValue: 2,
    })

    delete obj.foo
    expect(dummy).toBeUndefined()
    expect(onTrigger).toHaveBeenCalledTimes(2)
    expect(events[1]).toEqual({
      effect: runner.effect,
      target: toRaw(obj),
      type: TriggerOpTypes.DELETE,
      key: 'foo',
      oldValue: 2,
    })
  })

  /**
   * 四个嵌套建立的 effect 订阅同一个 ref(0)，各自 onTrigger 记录编号；Ref 自增后序列为 [1, 2, 3, 4]，验证通知调试回调的顺序。
   */
  it('debug: the call sequence of onTrigger', () => {
    const seq: number[] = []
    const s = ref(0)

    /**
     * 记录第一层 onTrigger 的顺序编号 1。
     */
    const trigger1 = () => seq.push(1)
    /**
     * 记录第二层 onTrigger 的顺序编号 2。
     */
    const trigger2 = () => seq.push(2)
    /**
     * 记录第三层 onTrigger 的顺序编号 3。
     */
    const trigger3 = () => seq.push(3)
    /**
     * 记录第四层 onTrigger 的顺序编号 4。
     */
    const trigger4 = () => seq.push(4)

    effect(
      () => {
        s.value
      },
      {
        onTrigger: trigger1,
      },
    )
    effect(
      () => {
        s.value
        effect(
          () => {
            s.value
            effect(
              () => {
                s.value
              },
              {
                onTrigger: trigger4,
              },
            )
          },
          {
            onTrigger: trigger3,
          },
        )
      },
      {
        onTrigger: trigger2,
      },
    )
    s.value++
    expect(seq.toString()).toBe('1,2,3,4')
  })

  /**
   * effect 读取 prop = 1，改为 2 后停止 runner，再改为 3 时 dummy 保留 2；手动调用 runner 后 dummy 为 3，验证 stop 解除自动通知但保留手动执行。
   */
  it('stop', () => {
    let dummy
    const obj = reactive({ prop: 1 })
    const runner = effect(() => {
      dummy = obj.prop
    })
    obj.prop = 2
    expect(dummy).toBe(2)
    stop(runner)
    obj.prop = 3
    expect(dummy).toBe(2)

    // 已停止的 runner 仍可手动调用。
    runner()
    expect(dummy).toBe(3)
  })

  /**
   * 同一个 effect 读取两个对象的 prop；分别更新后停止，再修改两者时 dummy 保留停止前的 2、3，验证 stop 清理所有依赖。
   */
  it('stop with multiple dependencies', () => {
    let dummy1, dummy2
    const obj1 = reactive({ prop: 1 })
    const obj2 = reactive({ prop: 1 })
    const runner = effect(() => {
      dummy1 = obj1.prop
      dummy2 = obj2.prop
    })

    obj1.prop = 2
    expect(dummy1).toBe(2)

    obj2.prop = 3
    expect(dummy2).toBe(3)

    stop(runner)

    obj1.prop = 4
    obj2.prop = 5

    // 分别修改两个源，检查停止后两条依赖都不再自动通知。
    expect(dummy1).toBe(2)
    expect(dummy2).toBe(3)
  })

  /**
   * effect 配置 onStop spy；调用 stop 后 spy 被调用，验证停止钩子执行。
   */
  it('events: onStop', () => {
    const onStop = vi.fn()
    const runner = effect(() => {}, {
      onStop,
    })

    stop(runner)
    expect(onStop).toHaveBeenCalled()
  })

  /**
   * 读取 prop 的 runner 停止后不再自动更新；另一 effect 内手动调用该 runner 后，新值 2 被读取，后续 prop = 3 更新为 3，验证停止 runner 的读取归属于外层活动 effect。
   */
  it('stop: a stopped effect is nested in a normal effect', () => {
    let dummy
    const obj = reactive({ prop: 1 })
    const runner = effect(() => {
      dummy = obj.prop
    })
    stop(runner)
    obj.prop = 2
    expect(dummy).toBe(1)

    // 在外层 effect 中调用已经停止的 runner，
    // 其读取会归入当前活动的外层 effect。
    effect(() => {
      runner()
    })
    expect(dummy).toBe(2)

    // 属性变化通知新建立依赖的外层 effect。
    obj.prop = 3
    expect(dummy).toBe(3)
  })

  /**
   * reactive 对象的 foo 初始为 markRaw({ prop: 0 })；内部 prop 自增不更新 dummy，替换 foo 为普通对象 { prop: 1 } 后更新为 1，验证 markRaw 内部跳过代理但外层槽位可订阅。
   */
  it('markRaw', () => {
    const obj = reactive({
      foo: markRaw({
        prop: 0,
      }),
    })
    let dummy
    effect(() => {
      dummy = obj.foo.prop
    })
    expect(dummy).toBe(0)
    obj.foo.prop++
    expect(dummy).toBe(0)
    obj.foo = { prop: 1 }
    expect(dummy).toBe(1)
  })

  /**
   * effect 读取初值 NaN；再次赋 NaN 后 spy 仍只一次，验证 Object.is 语义将两个 NaN 视为相同值。
   */
  it('should not be triggered when the value and the old value both are NaN', () => {
    const obj = reactive({
      foo: NaN,
    })
    const fnSpy = vi.fn(() => obj.foo)
    effect(fnSpy)
    obj.foo = NaN
    expect(fnSpy).toHaveBeenCalledTimes(1)
  })

  /**
   * 数组初始为 [1]，两个 effect 分别读取 length 和索引 0；增加索引并 unshift 后长度为 3、首项为 3，再设 length = 0 后为 0 和 undefined，验证截断同时通知长度与被移除索引。
   */
  it('should trigger all effects when array length is set to 0', () => {
    const observed: any = reactive([1])
    let dummy, record
    effect(() => {
      dummy = observed.length
    })
    effect(() => {
      record = observed[0]
    })
    expect(dummy).toBe(1)
    expect(record).toBe(1)

    observed[1] = 2
    expect(observed[1]).toBe(2)

    observed.unshift(3)
    expect(dummy).toBe(3)
    expect(record).toBe(3)

    observed.length = 0
    expect(dummy).toBe(0)
    expect(record).toBeUndefined()
  })

  /**
   * 深层 reactive 包装已代理对象，浅层 shallowReactive 也保存一个代理对象；向各槽位重新赋入原先的同一代理后 spy 均只一次，验证同一代理身份不误触发。
   */
  it('should not be triggered when set with the same proxy', () => {
    const obj = reactive({ foo: 1 })
    const observed: any = reactive({ obj })
    const fnSpy = vi.fn(() => observed.obj)

    effect(fnSpy)

    expect(fnSpy).toHaveBeenCalledTimes(1)
    observed.obj = obj
    expect(fnSpy).toHaveBeenCalledTimes(1)

    const obj2 = reactive({ foo: 1 })
    const observed2: any = shallowReactive({ obj2 })
    const fnSpy2 = vi.fn(() => observed2.obj2)

    effect(fnSpy2)

    expect(fnSpy2).toHaveBeenCalledTimes(1)
    observed2.obj2 = obj2
    expect(fnSpy2).toHaveBeenCalledTimes(1)
  })

  /**
   * 两个初始长度 11 的响应式数组都由 effect 读取索引 10；分别给 length 赋数字 2 和字符串 2 后结果相等，验证字符串长度也按数组截断语义通知索引。
   */
  it('should be triggered when set length with string', () => {
    let ret1 = 'idle'
    let ret2 = 'idle'
    const arr1 = reactive(new Array(11).fill(0))
    const arr2 = reactive(new Array(11).fill(0))
    effect(() => {
      ret1 = arr1[10] === undefined ? 'arr[10] is set to empty' : 'idle'
    })
    effect(() => {
      ret2 = arr2[10] === undefined ? 'arr[10] is set to empty' : 'idle'
    })
    arr1.length = 2
    arr2.length = '2' as any
    expect(ret1).toBe(ret2)
  })

  describe('readonly + reactive for Map', () => {
    /**
     * 对 reactive Map 再包 readonly，effect 读取缺失键；通过内层 Map 设置该键后 spy 从一次变为两次，验证只读外层仍转发内层响应式读取。
     */
    test('should work with readonly(reactive(Map))', () => {
      const m = reactive(new Map())
      const roM = readonly(m)
      const fnSpy = vi.fn(() => roM.get(1))

      effect(fnSpy)
      expect(fnSpy).toHaveBeenCalledTimes(1)
      m.set(1, 1)
      expect(fnSpy).toHaveBeenCalledTimes(2)
    })

    /**
     * reactive 对象作为 Map 键，初值为 1，effect 通过 readonly 视图读取；同键再设 1 不执行，改为 2 才执行第二次，验证代理键身份归一化与同值过滤。
     */
    test('should work with observed value as key', () => {
      const key = reactive({})
      const m = reactive(new Map())
      m.set(key, 1)
      const roM = readonly(m)
      const fnSpy = vi.fn(() => roM.get(key))

      effect(fnSpy)
      expect(fnSpy).toHaveBeenCalledTimes(1)
      m.set(key, 1)
      expect(fnSpy).toHaveBeenCalledTimes(1)
      m.set(key, 2)
      expect(fnSpy).toHaveBeenCalledTimes(2)
    })

    /**
     * effect 调用 hasOwnProperty 检查空对象 foo；添加后为真、删除后为假，spy 依次为 1、2、3，随后添加无关 bar 不增加次数，验证按键追踪自有属性存在性。
     */
    test('should track hasOwnProperty', () => {
      const obj: any = reactive({})
      let has = false
      const fnSpy = vi.fn()

      effect(() => {
        fnSpy()
        has = obj.hasOwnProperty('foo')
      })
      expect(fnSpy).toHaveBeenCalledTimes(1)
      expect(has).toBe(false)

      obj.foo = 1
      expect(fnSpy).toHaveBeenCalledTimes(2)
      expect(has).toBe(true)

      delete obj.foo
      expect(fnSpy).toHaveBeenCalledTimes(3)
      expect(has).toBe(false)

      // 无关键 bar 的新增不通知 foo 的存在性订阅。
      obj.bar = 2
      expect(fnSpy).toHaveBeenCalledTimes(3)
      expect(has).toBe(false)
    })
  })

  /**
   * effect 订阅 num = 0 后清空 spy 记录，显式 startBatch 中自增两次再 endBatch；spy 只调用一次，验证批次结束时合并同一 effect 的通知。
   */
  it('should be triggered once with batching', () => {
    const counter = reactive({ num: 0 })

    const counterSpy = vi.fn(() => counter.num)
    effect(counterSpy)

    counterSpy.mockClear()

    startBatch()
    counter.num++
    counter.num++
    endBatch()
    expect(counterSpy).toHaveBeenCalledTimes(1)
  })

  // #10082
  /**
   * s 初始为 0，父组件 render 读取 s + 1 的 computed 并渲染子组件，子组件 setup 将 s 自增；等待 tick 后 DOM 为 22、父 renderSpy 两次，验证组件渲染期间的源写入能安排后续更新。
   */
  it('should set dirtyLevel when effect is allowRecurse and is running', async () => {
    const s = ref(0)
    const n = computed(() => s.value + 1)

    const Child = {
      /**
       * 在子组件初始化时递增 s，并返回读取计算值 n 的渲染函数。
       */
      setup() {
        s.value++
        return () => n.value
      },
    }

    const renderSpy = vi.fn()
    const Parent = {
      /**
       * 返回记录 renderSpy、读取 n 并渲染 Child 的父组件渲染函数。
       */
      setup() {
        return () => {
          renderSpy()
          return [n.value, h(Child)]
        }
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Parent), root)
    await nextTick()
    expect(serializeInner(root)).toBe('22')
    expect(renderSpy).toHaveBeenCalledTimes(2)
  })

  /**
   * 外层 effect 在 pauseTracking 区域读取 n 并创建内层 effect；n 自增后外层 spy 一次、内层两次，验证内层 effect 会独立启用依赖收集并恢复外层状态。
   */
  it('nested effect should force track in untracked zone', () => {
    const n = ref(0)
    const spy1 = vi.fn()
    const spy2 = vi.fn()

    effect(() => {
      spy1()
      pauseTracking()
      n.value
      effect(() => {
        n.value
        spy2()
      })
      n.value
      resetTracking()
    })

    expect(spy1).toHaveBeenCalledTimes(1)
    expect(spy2).toHaveBeenCalledTimes(1)

    n.value++
    // 外层未订阅 n，因此不重新执行。
    expect(spy1).toHaveBeenCalledTimes(1)
    // 内层独立建立依赖，因此重新执行。
    expect(spy2).toHaveBeenCalledTimes(2)
  })

  describe('dep unsubscribe', () => {
    /**
     * 从 Dep.subs 沿 prevSub 计数实际订阅 Link；调用处保证 Dep 存在。
     */
    function getSubCount(dep: Dep | undefined) {
      let count = 0
      let sub = dep!.subs
      while (sub) {
        count++
        sub = sub.prevSub
      }
      return count
    }

    /**
     * 单个 effect 订阅 prop 后，getSubCount 为 1；更新仍为 1，stop 后为 0，后续更新和手动 runner 均不重新订阅，验证停止清理订阅 Link。
     */
    it('should remove the dep when the effect is stopped', () => {
      const obj = reactive({ prop: 1 })
      const runner = effect(() => obj.prop)
      const dep = getDepFromReactive(toRaw(obj), 'prop')
      expect(getSubCount(dep)).toBe(1)
      obj.prop = 2
      expect(getSubCount(dep)).toBe(1)
      stop(runner)
      expect(getSubCount(dep)).toBe(0)
      obj.prop = 3
      runner()
      expect(getSubCount(dep)).toBe(0)
    })

    /**
     * 两个 effect 订阅同一 prop，订阅数先为 2；依次 stop 后为 1、0，后续修改和手动调用停止的 runner 仍为 0，验证仅移除对应订阅且全部停止后不恢复。
     */
    it('should only remove the dep when the last effect is stopped', () => {
      const obj = reactive({ prop: 1 })
      const runner1 = effect(() => obj.prop)
      const dep = getDepFromReactive(toRaw(obj), 'prop')
      expect(getSubCount(dep)).toBe(1)
      const runner2 = effect(() => obj.prop)
      expect(getSubCount(dep)).toBe(2)
      obj.prop = 2
      expect(getSubCount(dep)).toBe(2)
      stop(runner1)
      expect(getSubCount(dep)).toBe(1)
      obj.prop = 3
      expect(getSubCount(dep)).toBe(1)
      stop(runner2)
      obj.prop = 4
      runner1()
      runner2()
      expect(getSubCount(dep)).toBe(0)
    })

    /**
     * effect 根据 c = a 选择读取 a，初始 a 与 c 各一个订阅；切换 c = b 后修改 a，检查 b 的订阅数为 1、c 的 Dep 身份和订阅数保持，验证动态分支切换保留仍在使用的依赖。
     */
    it('should remove the dep when it is no longer used by the effect', () => {
      const obj = reactive<{
        /** 选择 c = a 时读取的数值字段，用于检查分支依赖替换。 */
        a: number;
        /** 选择 c = b 时读取的数值字段，切换后成为活动依赖。 */
        b: number;
        /** 仅取 a 或 b 的分支选择键，切换时自身 Dep 应保持不变。 */
        c: 'a' | 'b'
      }>({
        a: 1,
        b: 2,
        c: 'a',
      })
      effect(() => obj[obj.c])
      const depC = getDepFromReactive(toRaw(obj), 'c')
      expect(getSubCount(getDepFromReactive(toRaw(obj), 'a'))).toBe(1)
      expect(getSubCount(depC)).toBe(1)
      obj.c = 'b'
      obj.a = 4
      expect(getSubCount(getDepFromReactive(toRaw(obj), 'b'))).toBe(1)
      expect(getDepFromReactive(toRaw(obj), 'c')).toBe(depC)
      expect(getSubCount(depC)).toBe(1)
    })
  })

  describe('onEffectCleanup', () => {
    /**
     * effect 读取 count 并注册 onEffectCleanup；两次自增分别让 cleanupSpy 达到一次、两次，stop 后第三次调用，验证清理在每次重跑前和停止时执行。
     */
    it('should get called correctly', async () => {
      const count = ref(0)
      const cleanupEffect = vi.fn()

      const e = effect(() => {
        onEffectCleanup(cleanupEffect)
        count.value
      })

      count.value++
      await nextTick()
      expect(cleanupEffect).toHaveBeenCalledTimes(1)

      count.value++
      await nextTick()
      expect(cleanupEffect).toHaveBeenCalledTimes(2)

      // 停止时再执行一次已登记的清理。
      e.effect.stop()
      expect(cleanupEffect).toHaveBeenCalledTimes(3)
    })

    /**
     * 在没有活动 effect 的位置调用 onEffectCleanup；断言出现无法找到活动 effect 的警告，验证清理注册上下文检查。
     */
    it('should warn if called without active effect', () => {
      onEffectCleanup(() => {})
      expect(
        `onEffectCleanup() was called when there was no active effect`,
      ).toHaveBeenWarned()
    })

    /**
     * 没有活动 effect 时调用 onEffectCleanup 并传 failSilently = true；断言不发警告，验证静默参数。
     */
    it('should not warn without active effect when failSilently argument is passed', () => {
      onEffectCleanup(() => {}, true)
      expect(
        `onEffectCleanup() was called when there was no active effect`,
      ).not.toHaveBeenWarned()
    })
  })

  /**
   * effect 初次读取 foo = 1 后暂停；foo 自增为 2 时 spy 仍一次，resume 立即执行第二次，后续自增执行第三次且结果为 3，验证暂停积累更新与恢复订阅。
   */
  test('should pause/resume effect', () => {
    const obj = reactive({ foo: 1 })
    const fnSpy = vi.fn(() => obj.foo)
    const runner = effect(fnSpy)

    expect(fnSpy).toHaveBeenCalledTimes(1)
    expect(obj.foo).toBe(1)

    runner.effect.pause()
    obj.foo++
    expect(fnSpy).toHaveBeenCalledTimes(1)
    expect(obj.foo).toBe(2)

    runner.effect.resume()
    expect(fnSpy).toHaveBeenCalledTimes(2)
    expect(obj.foo).toBe(2)

    obj.foo++
    expect(fnSpy).toHaveBeenCalledTimes(3)
    expect(obj.foo).toBe(3)
  })

  /**
   * effect 初次读取 foo = 1 后暂停，期间连续自增两次；恢复前 foo = 3 而 spy 一次，resume 后 spy 立即为两次，验证多次暂停通知合并为一次恢复执行。
   */
  test('should be executed once immediately when resume is called', () => {
    const obj = reactive({ foo: 1 })
    const fnSpy = vi.fn(() => obj.foo)
    const runner = effect(fnSpy)

    expect(fnSpy).toHaveBeenCalledTimes(1)
    expect(obj.foo).toBe(1)

    runner.effect.pause()
    obj.foo++
    expect(fnSpy).toHaveBeenCalledTimes(1)
    expect(obj.foo).toBe(2)

    obj.foo++
    expect(fnSpy).toHaveBeenCalledTimes(1)
    expect(obj.foo).toBe(3)

    runner.effect.resume()
    expect(fnSpy).toHaveBeenCalledTimes(2)
    expect(obj.foo).toBe(3)
  })
})
