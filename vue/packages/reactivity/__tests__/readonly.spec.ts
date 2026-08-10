import {
  computed,
  effect,
  isProxy,
  isReactive,
  isReadonly,
  markRaw,
  reactive,
  readonly,
  ref,
  shallowRef,
  toRaw,
  triggerRef,
} from '../src'

/**
 * @see https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-4.html
 */
type Writable<T> = { -readonly [P in keyof T]: T[P] }

describe('reactivity/readonly', () => {
  describe('Object', () => {
    // 场景：深只读普通对象包含嵌套对象；验证读取到的嵌套值也具有只读身份。
    it('should make nested values readonly', () => {
      const original = { foo: 1, bar: { baz: 2 } }
      const wrapped = readonly(original)
      expect(wrapped).not.toBe(original)
      expect(isProxy(wrapped)).toBe(true)
      expect(isReactive(wrapped)).toBe(false)
      expect(isReadonly(wrapped)).toBe(true)
      expect(isReactive(original)).toBe(false)
      expect(isReadonly(original)).toBe(false)
      expect(isReactive(wrapped.bar)).toBe(false)
      expect(isReadonly(wrapped.bar)).toBe(true)
      expect(isReactive(original.bar)).toBe(false)
      expect(isReadonly(original.bar)).toBe(false)
      // get
      expect(wrapped.foo).toBe(1)
      // has
      expect('foo' in wrapped).toBe(true)
      // ownKeys
      expect(Object.keys(wrapped)).toEqual(['foo', 'bar'])
    })

    // 场景：对深只读普通对象执行新增、修改和删除；验证写入被拒绝且原值不变。
    it('should not allow mutation', () => {
      const qux = Symbol('qux')
      const original = {
        foo: 1,
        bar: {
          baz: 2,
        },
        [qux]: 3,
      }
      const wrapped: Writable<typeof original> = readonly(original)

      wrapped.foo = 2
      expect(wrapped.foo).toBe(1)
      expect(
        `Set operation on key "foo" failed: target is readonly.`,
      ).toHaveBeenWarnedLast()

      wrapped.bar.baz = 3
      expect(wrapped.bar.baz).toBe(2)
      expect(
        `Set operation on key "baz" failed: target is readonly.`,
      ).toHaveBeenWarnedLast()

      wrapped[qux] = 4
      expect(wrapped[qux]).toBe(3)
      expect(
        `Set operation on key "Symbol(qux)" failed: target is readonly.`,
      ).toHaveBeenWarnedLast()

      // @ts-expect-error
      delete wrapped.foo
      expect(wrapped.foo).toBe(1)
      expect(
        `Delete operation on key "foo" failed: target is readonly.`,
      ).toHaveBeenWarnedLast()

      // @ts-expect-error
      delete wrapped.bar.baz
      expect(wrapped.bar.baz).toBe(2)
      expect(
        `Delete operation on key "baz" failed: target is readonly.`,
      ).toHaveBeenWarnedLast()

      // @ts-expect-error
      delete wrapped[qux]
      expect(wrapped[qux]).toBe(3)
      expect(
        `Delete operation on key "Symbol(qux)" failed: target is readonly.`,
      ).toHaveBeenWarnedLast()
    })

    // 场景：尝试修改只读普通对象；验证失败写操作不会触发依赖它的 effect。
    it('should not trigger effects', () => {
      const wrapped: any = readonly({ a: 1 })
      let dummy
      effect(() => {
        dummy = wrapped.a
      })
      expect(dummy).toBe(1)
      wrapped.a = 2
      expect(wrapped.a).toBe(1)
      expect(dummy).toBe(1)
      expect(`target is readonly`).toHaveBeenWarned()
    })
  })

  describe('Array', () => {
    // 场景：深只读数组包含对象元素；验证数组元素也会惰性转换为只读代理。
    it('should make nested values readonly', () => {
      const original = [{ foo: 1 }]
      const wrapped = readonly(original)
      expect(wrapped).not.toBe(original)
      expect(isProxy(wrapped)).toBe(true)
      expect(isReactive(wrapped)).toBe(false)
      expect(isReadonly(wrapped)).toBe(true)
      expect(isReactive(original)).toBe(false)
      expect(isReadonly(original)).toBe(false)
      expect(isReactive(wrapped[0])).toBe(false)
      expect(isReadonly(wrapped[0])).toBe(true)
      expect(isReactive(original[0])).toBe(false)
      expect(isReadonly(original[0])).toBe(false)
      // get
      expect(wrapped[0].foo).toBe(1)
      // has
      expect(0 in wrapped).toBe(true)
      // ownKeys
      expect(Object.keys(wrapped)).toEqual(['0'])
    })

    // 场景：对深只读数组执行索引赋值和变异方法；验证数组内容保持不变。
    it('should not allow mutation', () => {
      const wrapped: any = readonly([{ foo: 1 }])
      wrapped[0] = 1
      expect(wrapped[0]).not.toBe(1)
      expect(
        `Set operation on key "0" failed: target is readonly.`,
      ).toHaveBeenWarned()
      wrapped[0].foo = 2
      expect(wrapped[0].foo).toBe(1)
      expect(
        `Set operation on key "foo" failed: target is readonly.`,
      ).toHaveBeenWarned()

      // should block length mutation
      wrapped.length = 0
      expect(wrapped.length).toBe(1)
      expect(wrapped[0].foo).toBe(1)
      expect(
        `Set operation on key "length" failed: target is readonly.`,
      ).toHaveBeenWarned()

      // mutation methods invoke set/length internally and thus are blocked as well
      wrapped.push(2)
      expect(wrapped.length).toBe(1)
      // push triggers two warnings on [1] and .length
      expect(`target is readonly.`).toHaveBeenWarnedTimes(5)
    })

    // 场景：尝试修改只读数组；验证失败操作不会触发已建立的 effect。
    it('should not trigger effects', () => {
      const wrapped: any = readonly([{ a: 1 }])
      let dummy
      effect(() => {
        dummy = wrapped[0].a
      })
      expect(dummy).toBe(1)
      wrapped[0].a = 2
      expect(wrapped[0].a).toBe(1)
      expect(dummy).toBe(1)
      expect(`target is readonly`).toHaveBeenWarnedTimes(1)
      wrapped[0] = { a: 2 }
      expect(wrapped[0].a).toBe(1)
      expect(dummy).toBe(1)
      expect(`target is readonly`).toHaveBeenWarnedTimes(2)
    })

    // 场景：迭代包含 Ref 的只读数组；验证迭代值与按索引读取保持相同 Ref 身份。
    it('should maintain identity when iterating readonly ref array', () => {
      const list = readonly(ref([{}, {}, {}]))
      const computedList = computed(() => {
        const newList: any[] = []
        list.value.forEach(x => newList.push(x))
        return newList
      })

      expect(list.value[0]).toBe(computedList.value[0])
      expect(isReadonly(computedList.value[0])).toBe(true)
      expect(isReactive(computedList.value[0])).toBe(true)
    })
  })

  const maps = [Map, WeakMap]
  maps.forEach((Collection: any) => {
    describe(Collection.name, () => {
      // 场景：深只读 Map/WeakMap 保存对象值；验证 get 返回的对象继续只读。
      test('should make nested values readonly', () => {
        const key1 = {}
        const key2 = {}
        const original = new Collection([
          [key1, {}],
          [key2, {}],
        ])
        const wrapped = readonly(original)
        expect(wrapped).not.toBe(original)
        expect(isProxy(wrapped)).toBe(true)
        expect(isReactive(wrapped)).toBe(false)
        expect(isReadonly(wrapped)).toBe(true)
        expect(isReactive(original)).toBe(false)
        expect(isReadonly(original)).toBe(false)
        expect(isReactive(wrapped.get(key1))).toBe(false)
        expect(isReadonly(wrapped.get(key1))).toBe(true)
        expect(isReactive(original.get(key1))).toBe(false)
        expect(isReadonly(original.get(key1))).toBe(false)
      })

      // 场景：对只读 Map/WeakMap 调用 set/delete；验证修改失败且不触发 effect。
      test('should not allow mutation & not trigger effect', () => {
        const map = readonly(new Collection())
        const key = {}
        let dummy
        effect(() => {
          dummy = map.get(key)
        })
        expect(dummy).toBeUndefined()
        map.set(key, 1)
        expect(dummy).toBeUndefined()
        expect(map.has(key)).toBe(false)
        expect(
          `Set operation on key "${key}" failed: target is readonly.`,
        ).toHaveBeenWarned()
      })

      // #1772
      // 场景：readonly 包裹 reactive Map 后读取对象值；验证结果同时具备响应式和只读身份。
      test('readonly + reactive should make get() value also readonly + reactive', () => {
        const map = reactive(new Collection())
        const roMap = readonly(map)
        const key = {}
        map.set(key, {})

        const item = map.get(key)
        expect(isReactive(item)).toBe(true)
        expect(isReadonly(item)).toBe(false)

        const roItem = roMap.get(key)
        expect(isReactive(roItem)).toBe(true)
        expect(isReadonly(roItem)).toBe(true)
      })

      if (Collection === Map) {
        // 场景：迭代普通深只读 Map；验证键和值中的对象都以只读代理形式产出。
        test('should retrieve readonly values on iteration', () => {
          const key1 = {}
          const key2 = {}
          const original = new Map([
            [key1, {}],
            [key2, {}],
          ])
          const wrapped: any = readonly(original)
          expect(wrapped.size).toBe(2)
          for (const [key, value] of wrapped) {
            expect(isReadonly(key)).toBe(true)
            expect(isReadonly(value)).toBe(true)
          }
          wrapped.forEach((value: any) => {
            expect(isReadonly(value)).toBe(true)
          })
          for (const value of wrapped.values()) {
            expect(isReadonly(value)).toBe(true)
          }
        })

        // 场景：迭代 readonly(reactive(Map))；验证对象产出值既响应式又只读。
        test('should retrieve reactive + readonly values on iteration', () => {
          const key1 = {}
          const key2 = {}
          const original = reactive(
            new Map([
              [key1, {}],
              [key2, {}],
            ]),
          )
          const wrapped: any = readonly(original)
          expect(wrapped.size).toBe(2)
          for (const [key, value] of wrapped) {
            expect(isReadonly(key)).toBe(true)
            expect(isReadonly(value)).toBe(true)
            expect(isReactive(key)).toBe(true)
            expect(isReactive(value)).toBe(true)
          }
          wrapped.forEach((value: any) => {
            expect(isReadonly(value)).toBe(true)
            expect(isReactive(value)).toBe(true)
          })
          for (const value of wrapped.values()) {
            expect(isReadonly(value)).toBe(true)
            expect(isReactive(value)).toBe(true)
          }
        })

        // 场景：调用只读 Map.clear；验证清空被拒绝且返回值为 undefined。
        test('should return undefined from Map.clear() call', () => {
          const wrapped = readonly(new Collection())
          expect(wrapped.clear()).toBeUndefined()
          expect(
            `Clear operation failed: target is readonly.`,
          ).toHaveBeenWarned()
        })
      }
    })
  })

  const sets = [Set, WeakSet]
  sets.forEach((Collection: any) => {
    describe(Collection.name, () => {
      // 场景：深只读 Set/WeakSet 保存对象成员；验证取得的成员继续只读。
      test('should make nested values readonly', () => {
        const key1 = {}
        const key2 = {}
        const original = new Collection([key1, key2])
        const wrapped = readonly(original)
        expect(wrapped).not.toBe(original)
        expect(isProxy(wrapped)).toBe(true)
        expect(isReactive(wrapped)).toBe(false)
        expect(isReadonly(wrapped)).toBe(true)
        expect(isReactive(original)).toBe(false)
        expect(isReadonly(original)).toBe(false)
        expect(wrapped.has(reactive(key1))).toBe(true)
        expect(original.has(reactive(key1))).toBe(false)
      })

      // 场景：对只读 Set/WeakSet 调用 add/delete；验证集合不变且 effect 不触发。
      test('should not allow mutation & not trigger effect', () => {
        const set = readonly(new Collection())
        const key = {}
        let dummy
        effect(() => {
          dummy = set.has(key)
        })
        expect(dummy).toBe(false)
        set.add(key)
        expect(dummy).toBe(false)
        expect(set.has(key)).toBe(false)
        expect(
          `Add operation on key "${key}" failed: target is readonly.`,
        ).toHaveBeenWarned()
      })

      if (Collection === Set) {
        // 场景：迭代深只读 Set；验证对象成员以只读代理形式产出。
        test('should retrieve readonly values on iteration', () => {
          const original = new Collection([{}, {}])
          const wrapped: any = readonly(original)
          expect(wrapped.size).toBe(2)
          for (const value of wrapped) {
            expect(isReadonly(value)).toBe(true)
          }
          wrapped.forEach((value: any) => {
            expect(isReadonly(value)).toBe(true)
          })
          for (const value of wrapped.values()) {
            expect(isReadonly(value)).toBe(true)
          }
          for (const [v1, v2] of wrapped.entries()) {
            expect(isReadonly(v1)).toBe(true)
            expect(isReadonly(v2)).toBe(true)
          }
        })

        // 场景：调用只读 Set.clear；验证清空被拒绝并返回 undefined。
        test('should return undefined from Set.clear() call', () => {
          const wrapped = readonly(new Collection())
          expect(wrapped.clear()).toBeUndefined()
          expect(
            `Clear operation failed: target is readonly.`,
          ).toHaveBeenWarned()
        })
      }
    })
  })

  // 场景：把只读代理传给 reactive；验证只读约束不能被降级且返回原代理。
  test('calling reactive on an readonly should return readonly', () => {
    const a = readonly({})
    const b = reactive(a)
    expect(isReadonly(b)).toBe(true)
    // should point to same original
    expect(toRaw(a)).toBe(toRaw(b))
  })

  // 场景：把响应式代理传给 readonly；验证得到包裹原响应式对象的只读代理。
  test('calling readonly on a reactive object should return readonly', () => {
    const a = reactive({})
    const b = readonly(a)
    expect(isReadonly(b)).toBe(true)
    // should point to same original
    expect(toRaw(a)).toBe(toRaw(b))
  })

  // 场景：effect 读取 readonly(reactive(object))；验证内层响应式变化仍可触发更新。
  test('readonly should track and trigger if wrapping reactive original', () => {
    const a = reactive({ n: 1 })
    const b = readonly(a)
    // should return true since it's wrapping a reactive source
    expect(isReactive(b)).toBe(true)

    let dummy
    effect(() => {
      dummy = b.n
    })
    expect(dummy).toBe(1)
    a.n++
    expect(b.n).toBe(2)
    expect(dummy).toBe(2)
  })

  // 场景：effect 读取直接由原始集合创建的只读代理；验证纯只读集合自身不收集依赖。
  test('readonly collection should not track', () => {
    const map = new Map()
    map.set('foo', 1)

    const reMap = reactive(map)
    const roMap = readonly(map)

    let dummy
    effect(() => {
      dummy = roMap.get('foo')
    })
    expect(dummy).toBe(1)
    reMap.set('foo', 2)
    expect(roMap.get('foo')).toBe(2)
    // should not trigger
    expect(dummy).toBe(1)
  })

  // 场景：effect 读取直接由原始数组创建的只读代理；验证纯只读数组不建立依赖。
  test('readonly array should not track', () => {
    const arr = [1]
    const roArr = readonly(arr)

    const eff = effect(() => {
      roArr.includes(2)
    })
    expect(eff.effect.deps).toBeUndefined()
  })

  // 场景：effect 读取 readonly(reactive(collection))；验证内层集合变化仍能触发。
  test('readonly should track and trigger if wrapping reactive original (collection)', () => {
    const a = reactive(new Map())
    const b = readonly(a)
    // should return true since it's wrapping a reactive source
    expect(isReactive(b)).toBe(true)

    a.set('foo', 1)

    let dummy
    effect(() => {
      dummy = b.get('foo')
    })
    expect(dummy).toBe(1)
    a.set('foo', 2)
    expect(b.get('foo')).toBe(2)
    expect(dummy).toBe(2)
  })

  // 场景：对已有只读代理再次调用 readonly；验证不会重复包装并保持引用稳定。
  test('wrapping already wrapped value should return same Proxy', () => {
    const original = { foo: 1 }
    const wrapped = readonly(original)
    const wrapped2 = readonly(wrapped)
    expect(wrapped2).toBe(wrapped)
  })

  // 场景：多次只读转换同一原始对象；验证代理缓存始终返回同一实例。
  test('wrapping the same value multiple times should return same Proxy', () => {
    const original = { foo: 1 }
    const wrapped = readonly(original)
    const wrapped2 = readonly(original)
    expect(wrapped2).toBe(wrapped)
  })

  // 场景：对 markRaw 对象调用 readonly；验证显式跳过标记阻止只读代理创建。
  test('markRaw', () => {
    const obj = readonly({
      foo: { a: 1 },
      bar: markRaw({ b: 2 }),
    })
    expect(isReadonly(obj.foo)).toBe(true)
    expect(isReadonly(obj.bar)).toBe(false)
  })

  // 场景：用 readonly 包裹普通 Ref；验证 value 读取可用而写入被拒绝。
  test('should make ref readonly', () => {
    const n = readonly(ref(1))
    // @ts-expect-error
    n.value = 2
    expect(n.value).toBe(1)
    expect(
      `Set operation on key "value" failed: target is readonly.`,
    ).toHaveBeenWarned()
  })

  // https://github.com/vuejs/core/issues/3376
  // 场景：用 readonly 包裹计算属性并求值；验证内部缓存字段仍能由计算实现更新。
  test('calling readonly on computed should allow computed to set its private properties', () => {
    const r = ref<boolean>(false)
    const c = computed(() => r.value)
    const rC = readonly(c)

    r.value = true

    expect(rC.value).toBe(true)
    expect(
      'Set operation on key "_dirty" failed: target is readonly.',
    ).not.toHaveBeenWarned()
    // @ts-expect-error - non-existent property
    rC.randomProperty = true

    expect(
      'Set operation on key "randomProperty" failed: target is readonly.',
    ).toHaveBeenWarned()
  })

  // #4986
  // 场景：把只读对象写入响应式对象属性；验证读取时不会被转成可变代理。
  test('setting a readonly object as a property of a reactive object should retain readonly proxy', () => {
    const r = readonly({})
    const rr = reactive({}) as any
    rr.foo = r
    expect(rr.foo).toBe(r)
    expect(isReadonly(rr.foo)).toBe(true)
  })

  // 场景：响应式对象属性槽位保存只读 Ref，却写入普通值；验证不能绕过 Ref 只读约束。
  test('attempting to write plain value to a readonly ref nested in a reactive object should fail', () => {
    const r = ref(false)
    const ror = readonly(r)
    const obj = reactive({ ror })
    obj.ror = true
    expect(
      `Set operation on key "ror" failed: target is readonly.`,
    ).toHaveBeenWarned()
    expect(obj.ror).toBe(false)
  })

  // 场景：用新 Ref 替换响应式对象中的只读 Ref；验证显式 Ref 替换仍被允许。
  test('replacing a readonly ref nested in a reactive object with a new ref', () => {
    const r = ref(false)
    const ror = readonly(r)
    const obj = reactive({ ror })
    obj.ror = ref(true) as unknown as boolean
    expect(obj.ror).toBe(true)
    expect(toRaw(obj).ror).not.toBe(ror) // ref successfully replaced
  })

  // 场景：给响应式对象内的可写 Ref 属性赋只读对象；验证 ref.value 保存只读代理。
  test('setting readonly object to writable nested ref', () => {
    const r = ref<any>()
    const obj = reactive({ r })
    const ro = readonly({})
    obj.r = ro
    expect(obj.r).toBe(ro)
    expect(r.value).toBe(ro)
  })

  // 场景：只读代理中嵌套 Ref；验证自动解包后的对象值仍保持只读。
  test('should keep nested ref readonly', () => {
    const items = ref(['one', 'two', 'three'])
    const obj = {
      o: readonly({
        items,
      }),
    }
    expect(isReadonly(obj.o.items)).toBe(true)
  })
})

// 场景：对只读包装下的 Ref 手动调用 triggerRef；验证已有订阅者仍可被通知。
test('should be able to trigger with triggerRef', () => {
  const r = shallowRef({ a: 1 })
  const ror = readonly(r)
  let dummy
  effect(() => {
    dummy = ror.value.a
  })
  r.value.a = 2
  expect(dummy).toBe(1)
  triggerRef(ror)
  expect(dummy).toBe(2)
})
