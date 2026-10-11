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
 * 移除夹具根属性的类型只读修饰，允许测试写出被运行时 readonly 拦截的操作；不会改变代理的实际只读行为。
 * @see https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-4.html
 */
type Writable<T> = { -readonly [P in keyof T]: T[P] }

describe('reactivity/readonly', () => {
  describe('Object', () => {
    /**
     * 把含嵌套 bar 的普通对象转为 readonly，再读取字段、in 查询和自有键。
     * 外层和 bar 均只读且非响应式，raw 两层无代理标记，验证深只读读取转换和对象基本访问。
     */
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
      // 读取属性或索引中的值。
      expect(wrapped.foo).toBe(1)
      // 查询属性或索引是否存在。
      expect('foo' in wrapped).toBe(true)
      // 枚举自有可枚举键。
      expect(Object.keys(wrapped)).toEqual(['foo', 'bar'])
    })

    /**
     * 只读对象含普通、嵌套及 Symbol 属性，依次尝试根层/嵌套/Symbol 赋值与删除。
     * 每次读回初值并检查对应警告，验证只读 set/delete 在各类键上阻止底层变更。
     */
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

    /**
     * effect 读取直接 readonly({ a: 1 }) 的 a，再尝试赋值 2。
     * 代理和 effect 记录均为 1 且出现警告，验证失败写入不改变观察到的数据。
     */
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
    /**
     * 对含普通对象的原数组调用 readonly，再检查索引、in 查询和自有键。
     * 数组及首个对象元素只读且非响应式，raw 保持无标记，验证深只读数组的索引值转换。
     */
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
      // 读取属性或索引中的值。
      expect(wrapped[0].foo).toBe(1)
      // 查询属性或索引是否存在。
      expect(0 in wrapped).toBe(true)
      // 枚举自有可枚举键。
      expect(Object.keys(wrapped)).toEqual(['0'])
    })

    /**
     * 只读单元素对象数组依次尝试替换索引、修改元素字段、缩短 length、push。
     * 内容与长度不变；总警告为 5，其中 push 的索引写入和 length 写入各被拦截一次。
     */
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

      // length 赋值也由只读 set 拦截。
      wrapped.length = 0
      expect(wrapped.length).toBe(1)
      expect(wrapped[0].foo).toBe(1)
      expect(
        `Set operation on key "length" failed: target is readonly.`,
      ).toHaveBeenWarned()

      // push 内部写索引和 length，两次写入都被只读 set 拦截。
      wrapped.push(2)
      expect(wrapped.length).toBe(1)
      // push 对索引 1 和 length 各产生一次警告。
      expect(`target is readonly.`).toHaveBeenWarnedTimes(5)
    })

    /**
     * effect 读取只读数组首项 a，依次修改元素 a、替换整个首项。
     * 读回值及记录均不变，累计警告 1→2，验证元素和索引两层只读屏障。
     */
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

    /**
     * readonly 包装保存三个普通对象的 Ref，computed 用 forEach 收集 list.value 元素。
     * 首项与索引读取引用相同，同时只读且响应式，验证 readonly 包装 Ref 内层 reactive 数组的身份复用。
     */
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
      /**
       * 循环分别创建含两个对象值的 Map/WeakMap，再对其直接 readonly 并 get 对象键。
       * 外层及读取值只读、非响应式，raw 值不被标记，验证只读集合的深层 value 转换。
       */
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

      /**
       * 循环分别对空 Map/WeakMap 建立只读 get 读取，再尝试 set 对象键。
       * 读取仍 undefined、has 为 false 且出现 set 警告，验证只读方法阻止新增键而不改变观察结果。
       */
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
      /**
       * 循环分别先创建 reactive Map/WeakMap，再加 readonly 外层；经可变入口写入对象值。
       * 可变 get 的值仅响应式，只读 get 的值同时响应式和只读，验证内外代理层组合的返回值转换。
       */
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
        /**
         * 仅对 Map：直接 readonly 一个含两对普通对象键值的 Map，再默认迭代、forEach 和 values。
         * size 为 2，默认迭代的键和值及其他途径的值均只读，验证不同迭代出口的深只读包装。
         */
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

        /**
         * 仅对 Map：readonly 包装已有 reactive Map，再默认迭代、forEach 和 values。
         * 默认迭代的键和值及其他途径的值同时只读和响应式，验证迭代经内层代理后再施加只读包装。
         */
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

        /**
         * 仅对 Map：创建空只读 Map，调用 clear。
         * 返回 undefined 并出现 clear 警告，验证只读 clear 的拒绝路径及返回约定；本例未预存成员。
         */
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
      /**
       * 循环分别 readonly 含两个 raw 成员的 Set/WeakSet，再用成员代理调用 has。
       * 集合只读而 raw 无标记；只读入口能命中代理对应的 raw，原集合直接 has 不能命中该代理。
       */
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

      /**
       * 循环分别对空 Set/WeakSet 建立只读 has 读取，再尝试 add 对象成员。
       * 记录与 has 均为 false 且出现 add 警告，验证只读方法拒绝新增成员。
       */
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
        /**
         * 仅对 Set：readonly 含两个普通对象的 Set，读取 size 并经默认迭代、forEach、values、entries 访问。
         * size 为 2，每种出口的成员都只读，entries 两个槽位也只读，验证成对产出的包装。
         */
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

        /**
         * 仅对 Set：创建空只读 Set，调用 clear。
         * 返回 undefined 并出现 clear 警告，验证拒绝路径及返回约定；本例未预存成员。
         */
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

  /**
   * 先 readonly 一个普通对象，再将该代理传给 reactive。
   * 结果仍只读且两者 toRaw 相同，验证可变入口保留已有只读约束；本例未直接比较两代理引用。
   */
  test('calling reactive on an readonly should return readonly', () => {
    const a = readonly({})
    const b = reactive(a)
    expect(isReadonly(b)).toBe(true)
    // 两个入口递归解包到同一原对象。
    expect(toRaw(a)).toBe(toRaw(b))
  })

  /**
   * 先 reactive 一个普通对象，再将该代理传给 readonly。
   * 结果具有只读标记且两层 toRaw 相同，验证只读包装仍指向同一底层对象。
   */
  test('calling readonly on a reactive object should return readonly', () => {
    const a = reactive({})
    const b = readonly(a)
    expect(isReadonly(b)).toBe(true)
    // 两个入口递归解包到同一原对象。
    expect(toRaw(a)).toBe(toRaw(b))
  })

  /**
   * effect 读取 readonly(reactive({ n: 1 })) 的 n，然后从内层可变入口递增 n。
   * 外层 isReactive 为 true，读取值和 effect 记录 1→2，验证内层 getter 仍建立可通知的依赖。
   */
  test('readonly should track and trigger if wrapping reactive original', () => {
    const a = reactive({ n: 1 })
    const b = readonly(a)
    // 外层包裹 reactive 来源，因此仍被 isReactive 识别。
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

  /**
   * 同一原始 Map 分别创建 reactive 和 readonly 两个入口，effect 仅从 readonly get('foo')。
   * 可变入口 set 后只读即时读取为 2，而 effect 记录仍为 1，验证直接只读 raw 集合不收集依赖。
   */
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
    // 纯只读 raw 入口没有登记该 effect 的依赖。
    expect(dummy).toBe(1)
  })

  /**
   * effect 调用直接 readonly([1]) 的 includes(2)。
   * 检查 effect.deps 仍为 undefined，验证纯只读数组查询不登记依赖 Link。
   */
  test('readonly array should not track', () => {
    const arr = [1]
    const roArr = readonly(arr)

    const eff = effect(() => {
      roArr.includes(2)
    })
    expect(eff.effect.deps).toBeUndefined()
  })

  /**
   * effect 通过 readonly(reactive(Map)) 读取 foo，再经内层 set 更新该键。
   * 外层保持响应式来源，读取值和 effect 记录 1→2，验证只读集合包装透传内层追踪。
   */
  test('readonly should track and trigger if wrapping reactive original (collection)', () => {
    const a = reactive(new Map())
    const b = readonly(a)
    // 外层包裹 reactive 来源，因此仍被 isReactive 识别。
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

  /**
   * 先 readonly 原对象，再将只读代理再次传给 readonly。
   * 两次结果引用相同，验证已有只读代理不会重复包装。
   */
  test('wrapping already wrapped value should return same Proxy', () => {
    const original = { foo: 1 }
    const wrapped = readonly(original)
    const wrapped2 = readonly(wrapped)
    expect(wrapped2).toBe(wrapped)
  })

  /**
   * 将同一个原始对象连续两次传给 readonly。
   * 两次结果引用相同，验证同输入 target 的只读代理缓存。
   */
  test('wrapping the same value multiple times should return same Proxy', () => {
    const original = { foo: 1 }
    const wrapped = readonly(original)
    const wrapped2 = readonly(original)
    expect(wrapped2).toBe(wrapped)
  })

  /**
   * 只读对象中一项是普通对象，另一项经 markRaw 标记，再读取两项。
   * 普通嵌套值只读、标记项非只读，验证深只读转换尊重 SKIP 标记。
   */
  test('markRaw', () => {
    const obj = readonly({
      foo: { a: 1 },
      bar: markRaw({ b: 2 }),
    })
    expect(isReadonly(obj.foo)).toBe(true)
    expect(isReadonly(obj.bar)).toBe(false)
  })

  /**
   * readonly 包装 ref(1)，再尝试写入 value=2。
   * value 保持 1 且出现 value 的 set 警告，验证 Ref 实例上的外层只读约束。
   */
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
  /**
   * readonly 包装读取布尔 Ref 的 computed，先把源 Ref 从 false 改成 true 再读取。
   * 能求得 true，且无历史 _dirty 警告；另写不存在属性会警告，验证求值内部操作与普通外部写入的区别。
   */
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
  /**
   * 把已有 readonly 对象写入 reactive 空对象的 foo 槽位，再读取。
   * 返回原只读代理引用并保持只读标记，验证深 set 不把只读输入还原成可变值。
   */
  test('setting a readonly object as a property of a reactive object should retain readonly proxy', () => {
    const r = readonly({})
    const rr = reactive({}) as any
    rr.foo = r
    expect(rr.foo).toBe(r)
    expect(isReadonly(rr.foo)).toBe(true)
  })

  /**
   * reactive 对象槽位保存 readonly(ref(false))，再向解包后的槽位赋普通 true。
   * 出现槽位只读警告且读回 false，验证 Ref 转发赋值不能绕过旧 Ref 的只读约束。
   */
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

  /**
   * reactive 对象槽位起初保存只读 Ref，随后显式用新 ref(true) 替换。
   * 解包值为 true，raw 槽位已不等于旧只读 Ref，验证 Ref 到 Ref 赋值允许替换容器。
   */
  test('replacing a readonly ref nested in a reactive object with a new ref', () => {
    const r = ref(false)
    const ror = readonly(r)
    const obj = reactive({ ror })
    obj.ror = ref(true) as unknown as boolean
    expect(obj.ror).toBe(true)
    expect(toRaw(obj).ror).not.toBe(ror) // raw 槽位已替换为新 Ref。
  })

  /**
   * reactive 对象 r 槽位保存可写空 Ref，随后向解包槽位赋 readonly 对象。
   * 对象属性与原 Ref.value 都等于该只读代理，验证普通值赋给旧 Ref 时转发写入 value 并保留只读身份。
   */
  test('setting readonly object to writable nested ref', () => {
    const r = ref<any>()
    const obj = reactive({ r })
    const ro = readonly({})
    obj.r = ro
    expect(obj.r).toBe(ro)
    expect(r.value).toBe(ro)
  })

  /**
   * readonly 对象属性保存字符串数组 Ref，再读取自动解包的 items。
   * 结果具有只读标记，验证解包后数组值仍经过深只读包装。
   */
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

/**
 * shallowRef 保存 { a: 1 }，readonly 包装后 effect 读取 a；先直接修改原对象字段，再 triggerRef(ror)。
 * 直接修改后记录仍为 1，手动通知后为 2，验证只读 Ref 入口能调用底层 Dep 的显式触发。
 */
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
