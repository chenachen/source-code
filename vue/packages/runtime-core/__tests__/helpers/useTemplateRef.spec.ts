/**
 * 在 runtime-test 组件中创建 useTemplateRef，用字符串或直接 ref VNode 连接到宿主节点。
 * 检查只读诊断、动态切换、ref_key/ref_for 及生产分支对 setup ref 的写入选择。
 */
import {
  type ShallowRef,
  h,
  nextTick,
  nodeOps,
  onMounted,
  ref,
  render,
  useTemplateRef,
} from '@vue/runtime-test'

// useTemplateRef 用运行时字符串 key 连接模板引用，返回供用户读取的 shallowRef。
describe('useTemplateRef', () => {
  // 字符串模板 ref 通过指定 key，更新 useTemplateRef 返回的 shallowRef。
  test('should work', () => {
    let tRef
    const key = 'refKey'
    const Comp = {
      /** 创建 refKey 对应模板引用并保存到外部，供宿主节点身份断言。 */
      setup() {
        tRef = useTemplateRef(key)
      },
      /** 渲染带 refKey 字符串 ref 的 div，连接实例 $refs 访问器。 */
      render() {
        return h('div', { ref: key })
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(tRef!.value).toBe(root.children[0])
  })

  // 用户写入返回值时触发 readonly 警告，渲染器先前写入的节点保留。
  test('should be readonly', () => {
    let tRef
    const key = 'refKey'
    const Comp = {
      /** 保存只读模板引用，供用户写入警告测试。 */
      setup() {
        tRef = useTemplateRef(key)
      },
      /** 以字符串 refKey 挂载 div，让渲染器先设置模板引用。 */
      render() {
        return h('div', { ref: key })
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Comp), root)

    // @ts-expect-error
    tRef.value = 123

    expect(tRef!.value).toBe(root.children[0])
    expect('target is readonly').toHaveBeenWarned()
  })

  // 字符串 ref 从 t1 切到 t2，清空旧引用并给新引用赋同一节点。
  test('should be updated for ref of dynamic strings', async () => {
    let t1, t2
    const key = ref('t1')
    const Comp = {
      /** 分别创建 t1/t2 引用，供动态字符串键切换。 */
      setup() {
        t1 = useTemplateRef<HTMLAnchorElement>('t1')
        t2 = useTemplateRef('t2')
      },
      /** 渲染 ref:key.value 的同一 div，随键变化切换引用所属项。 */
      render() {
        return h('div', { ref: key.value })
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Comp), root)

    expect(t1!.value).toBe(root.children[0])
    expect(t2!.value).toBe(null)

    key.value = 't2'
    await nextTick()
    expect(t2!.value).toBe(root.children[0])
    expect(t1!.value).toBe(null)
  })

  // 同一组件重复创建相同 key 的 useTemplateRef，会发出重复声明警告。
  test('should warn on duplicate useTemplateRef', () => {
    const root = nodeOps.createElement('div')
    render(
      h(() => {
        useTemplateRef('foo')
        useTemplateRef('foo')
        return ''
      }),
      root,
    )

    expect(`useTemplateRef('foo') already exists.`).toHaveBeenWarned()
  })

  // #11795
  // setupState 中的只读模板 ref 使用不同 key 时，不把字符串 ref 写进这个别名变量。
  test('should not attempt to set when variable name is same as key', () => {
    let tRef: ShallowRef
    const key = 'refKey'
    const Comp = {
      /** 把 key 为下划线的模板引用放入 setup 返回对象的 refKey 别名，构造名称不一致场景。 */
      setup() {
        tRef = useTemplateRef('_')
        return {
          [key]: tRef,
        }
      },
      /** 使用字符串 refKey 绑定 div，检查该别名不能误写只读模板引用。 */
      render() {
        return h('div', { ref: key })
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Comp), root)

    expect('target is readonly').not.toHaveBeenWarned()
    expect(tRef!.value).toBe(null)
  })

  // 开发环境直接使用只读模板 ref 并带 ref_key，改由 $refs 访问器更新它。
  test('should work when used with direct ref value with ref_key', () => {
    let tRef: ShallowRef
    const key = 'refKey'
    const Comp = {
      /** 创建模板引用并返回带直接 ref 与 ref_key 的 div，构造开发态合法直接引用。 */
      setup() {
        tRef = useTemplateRef(key)
        return () => h('div', { ref: tRef, ref_key: key })
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Comp), root)

    expect('target is readonly').not.toHaveBeenWarned()
    expect(tRef!.value).toBe(root.children[0])
  })

  // 带 ref_key 和 ref_for 的直接模板 ref，收集列表节点且不写 readonly 包装。
  test('should work when used with direct ref value with ref_key and ref_for', () => {
    let tRef: ShallowRef
    const key = 'refKey'
    const Comp = {
      /** 保存列表模板引用，供 ref_for 收集节点。 */
      setup() {
        tRef = useTemplateRef(key)
      },
      /** 渲染三个 span 共用直接 ref、ref_key 与 ref_for，构造引用数组。 */
      render() {
        return h(
          'div',
          [1, 2, 3].map(x =>
            h('span', { ref: tRef, ref_key: key, ref_for: true }, x.toString()),
          ),
        )
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Comp), root)

    expect('target is readonly').not.toHaveBeenWarned()
    expect(tRef!.value).toHaveLength(3)
  })

  // 直接模板 ref 对应节点切换、取消 ref 或变为空分支时，更新或清空该引用。
  test('should work when used with direct ref value with ref_key and dynamic value', async () => {
    const refMode = ref('h1-ref')

    let tRef: ShallowRef
    const key = 'refKey'

    const Comp = {
      /** 保存模板引用，供节点类型、取消 ref 和空分支切换。 */
      setup() {
        tRef = useTemplateRef(key)
      },
      /** 按 refMode 渲染带 ref 的 h1/h2、无 ref 的 span 或 null，构造引用设置与清空。 */
      render() {
        switch (refMode.value) {
          case 'h1-ref':
            return h('h1', { ref: tRef, ref_key: key })
          case 'h2-ref':
            return h('h2', { ref: tRef, ref_key: key })
          case 'no-ref':
            return h('span')
          case 'nothing':
            return null
        }
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)

    expect(tRef!.value.tag).toBe('h1')

    refMode.value = 'h2-ref'
    await nextTick()
    expect(tRef!.value.tag).toBe('h2')

    refMode.value = 'no-ref'
    await nextTick()
    expect(tRef!.value).toBeNull()

    refMode.value = 'nothing'
    await nextTick()
    expect(tRef!.value).toBeNull()

    expect('target is readonly').not.toHaveBeenWarned()
  })

  // 切换直接模板 ref 与 ref_key，清空旧引用并把节点赋给新引用。
  test('should work when used with dynamic direct refs and ref_keys', async () => {
    const refKey = ref('foo')

    let tRefs: Record<string, ShallowRef>

    const Comp = {
      /** 创建 foo/bar 两个模板引用并保存映射，供直接 ref 与 ref_key 同时切换。 */
      setup() {
        tRefs = {
          foo: useTemplateRef('foo'),
          bar: useTemplateRef('bar'),
        }
      },
      /** 根据动态 refKey 选择直接引用及对应 ref_key，保持 div 类型不变。 */
      render() {
        return h('div', { ref: tRefs[refKey.value], ref_key: refKey.value })
      },
    }

    const root = nodeOps.createElement('div')
    render(h(Comp), root)

    expect(tRefs!['foo'].value).toBe(root.children[0])
    expect(tRefs!['bar'].value).toBeNull()

    refKey.value = 'bar'
    await nextTick()
    expect(tRefs!['foo'].value).toBeNull()
    expect(tRefs!['bar'].value).toBe(root.children[0])

    expect('target is readonly').not.toHaveBeenWarned()
  })

  // 开发环境直接传只读模板 ref 却缺少 ref_key，渲染器不写入该 ref。
  test('should not work when used with direct ref value without ref_key (in dev mode)', () => {
    let tRef: ShallowRef
    const Comp = {
      /** 创建只读模板引用后直接作 VNode ref，故意省略 ref_key，供开发态排除写入测试。 */
      setup() {
        tRef = useTemplateRef('refKey')
        return () => h('div', { ref: tRef })
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Comp), root)

    expect(tRef!.value).toBeNull()
  })

  // 生产环境返回可写 shallowRef，直接作为 VNode ref 时可接收节点。
  test('should work when used as direct ref value (compiled in prod mode)', () => {
    __DEV__ = false
    try {
      let foo: ShallowRef
      const Comp = {
        /** 在生产态保存 foo 模板引用并直接绑定 div，供可写 shallowRef 写入验证。 */
        setup() {
          foo = useTemplateRef('foo')
          return () => h('div', { ref: foo })
        },
      }
      const root = nodeOps.createElement('div')
      render(h(Comp), root)

      expect('target is readonly').not.toHaveBeenWarned()
      expect(foo!.value).toBe(root.children[0])
    } finally {
      __DEV__ = true
    }
  })

  // #12749
  // useTemplateRef 已定义同名 $refs 访问器，字符串 ref 不再写 setup 返回的同名普通 ref。
  test(`don't update setup ref for useTemplateRef key`, () => {
    let foo: ShallowRef
    const Comp = {
      /** 创建 bar 模板引用和同名普通 setup ref，在 mounted 检查普通 ref 仍为 null。 */
      setup() {
        foo = useTemplateRef('bar')
        const bar = ref(null)
        onMounted(() => {
          expect(bar.value).toBe(null)
        })
        return { bar }
      },
      /** 把 bar 字符串 ref 绑定 div，供验证只写模板引用访问器。 */
      render() {
        return h('div', { ref: 'bar' })
      },
    }
    const root = nodeOps.createElement('div')
    render(h(Comp), root)
    expect(foo!.value).toBe(root.children[0])
  })

  // 生产环境 ref_key 指向 useTemplateRef 访问器时，原 setup ref 保留其初始值。
  test(`don't update setup ref for useTemplateRef key (compiled in prod mode)`, () => {
    __DEV__ = false
    try {
      let foo: ReturnType<typeof ref>
      let fooRef: ShallowRef
      const Comp = {
        /** 创建 hello 普通 ref 与同名 foo 模板引用，构造生产态两种引用分离。 */
        setup() {
          foo = ref('hello')
          fooRef = useTemplateRef('foo')
          return { foo }
        },
        /** 把普通 foo ref 与 ref_key:foo 传给 input，观察访问器和 setup ref 的写入选择。 */
        render() {
          return h('input', { ref: foo, ref_key: 'foo' })
        },
      }
      const root = nodeOps.createElement('div')
      render(h(Comp), root)

      expect(foo!.value).toBe('hello')
      expect(fooRef!.value).toBe(root.children[0])
    } finally {
      __DEV__ = true
    }
  })

  // 生产环境直接模板 ref 带 ref_key 和 ref_for，仍收集所有列表节点。
  test('should work when used as direct ref value with ref_key and ref_for (compiled in prod mode)', () => {
    __DEV__ = false
    try {
      let tRef: ShallowRef
      const key = 'refKey'
      const Comp = {
        /** 创建生产态列表模板引用，供 ref_key/ref_for 组合。 */
        setup() {
          tRef = useTemplateRef(key)
        },
        /** 渲染三个 span 共享直接 ref、ref_key/ref_for，构造生产态列表数组。 */
        render() {
          return h(
            'div',
            [1, 2, 3].map(x =>
              h(
                'span',
                { ref: tRef, ref_key: key, ref_for: true },
                x.toString(),
              ),
            ),
          )
        },
      }

      const root = nodeOps.createElement('div')
      render(h(Comp), root)

      expect('target is readonly').not.toHaveBeenWarned()
      expect(tRef!.value).toHaveLength(3)
    } finally {
      __DEV__ = true
    }
  })

  // 生产环境直接模板 ref 只有 ref_for 而没有 ref_key，也能收集列表节点。
  test('should work when used as direct ref value with ref_for but without ref_key (compiled in prod mode)', () => {
    __DEV__ = false
    try {
      let tRef: ShallowRef
      const Comp = {
        /** 创建生产态 refKey 模板引用，供省略 ref_key 的 ref_for 场景。 */
        setup() {
          tRef = useTemplateRef('refKey')
        },
        /** 渲染三个 span 仅带直接 ref/ref_for，验证生产态无需 ref_key 也可收集。 */
        render() {
          return h(
            'div',
            [1, 2, 3].map(x =>
              h('span', { ref: tRef, ref_for: true }, x.toString()),
            ),
          )
        },
      }

      const root = nodeOps.createElement('div')
      render(h(Comp), root)

      expect('target is readonly').not.toHaveBeenWarned()
      expect(tRef!.value).toHaveLength(3)
    } finally {
      __DEV__ = true
    }
  })
})
