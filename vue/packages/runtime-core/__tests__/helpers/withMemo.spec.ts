/**
 * 在 jsdom 中通过带编译器的 Vue 构建挂载模板，修改依赖后比较实际 DOM。
 * v-memo 与元素、组件、v-if、v-for 的组合均由编译产物和运行时共同执行。
 */
/**
 * @vitest-environment jsdom
 */

import { type ComponentOptions, createApp, nextTick } from 'vue'

// v-memo 根据依赖数组复用缓存 VNode，并在依赖变化时重新渲染。
describe('v-memo', () => {
  /** 创建带模板编译能力的 App 并挂载到独立 div，返回 DOM 与公共实例，供后续修改状态和比较输出。 */
  function mount(options: ComponentOptions): [HTMLElement, any] {
    const app = createApp(options)
    const el = document.createElement('div')
    const vm = app.mount(el)
    return [el, vm]
  }

  // 外部 memo 数组按元素和长度比较，其他状态变化不会刷新缓存内容。
  test('on with external array', async () => {
    const [el, vm] = mount({
      template: `<div v-memo="arr">{{ arr[0] }} {{ arr[1] }} {{arr[2] ?? '_' }} ({{c}})</div>{{c}}`,
      /** 初始化外部 memo 数组为[0,0]与独立 c:0，供数组内容/长度及非依赖更新比较。 */
      data: () => ({ arr: [0, 0], c: 0 }),
    })
    expect(el.innerHTML).toBe(`<div>0 0 _ (0)</div>0`)

    let [x, y, z] = [0, 1, 2]

    // 修改 memo 索引 x，缓存应失效。
    vm.arr[x]++
    vm.c++
    await nextTick()
    expect(el.innerHTML).toBe(`<div>1 0 _ (1)</div>1`)

    // 修改 memo 索引 y，缓存应失效。
    vm.arr[y]++
    vm.c++
    await nextTick()
    expect(el.innerHTML).toBe(`<div>1 1 _ (2)</div>2`)

    // memo 项未变，仅 c 更新；缓存内 c 应保留旧值。
    vm.arr[x] = vm.arr[0]
    vm.arr[y] = vm.arr[1]
    vm.c++
    await nextTick()
    expect(el.innerHTML).toBe(`<div>1 1 _ (2)</div>3`)

    // 新增第三个 memo 项，长度变化使缓存失效。
    vm.arr[z] = 0
    vm.c++
    await nextTick()
    expect(el.innerHTML).toBe(`<div>1 1 0 (4)</div>4`)

    // 移除第三个 memo 项，长度变化使缓存失效。
    vm.arr = vm.arr.slice(0, vm.arr.length - 1)
    vm.c++
    await nextTick()
    expect(el.innerHTML).toBe(`<div>1 1 _ (5)</div>5`)
  })

  // 元素的 memo 依赖未变时复用旧输出，依赖变化后再读取其他最新状态。
  test('on normal element', async () => {
    const [el, vm] = mount({
      template: `<div v-memo="[x]">{{ x }} {{ y }}</div>`,
      /** 初始化外部 memo 数组为[0,0]与独立 c:0，供数组内容/长度及非依赖更新比较。 */
      data: () => ({ x: 0, y: 0 }),
    })
    expect(el.innerHTML).toBe(`<div>0 0</div>`)

    vm.x++
    // 依赖变化，缓存应刷新。
    await nextTick()
    expect(el.innerHTML).toBe(`<div>1 0</div>`)

    vm.y++
    // 依赖未变，缓存保留旧输出。
    await nextTick()
    expect(el.innerHTML).toBe(`<div>1 0</div>`)

    vm.x++
    // 依赖变化，缓存应刷新。
    await nextTick()
    expect(el.innerHTML).toBe(`<div>2 1</div>`)
  })

  // 组件的 memo 依赖未变时跳过新 props 提交，依赖变化后才更新子组件。
  test('on component', async () => {
    const [el, vm] = mount({
      template: `<Comp v-memo="[x]" :x="x" :y="y"></Comp>`,
      /** 初始化外部 memo 数组为[0,0]与独立 c:0，供数组内容/长度及非依赖更新比较。 */
      data: () => ({ x: 0, y: 0 }),
      components: {
        Comp: {
          props: ['x', 'y'],
          template: `<div>{{x}} {{y}}</div>`,
        },
      },
    })
    expect(el.innerHTML).toBe(`<div>0 0</div>`)

    vm.x++
    // 依赖变化，缓存应刷新。
    await nextTick()
    expect(el.innerHTML).toBe(`<div>1 0</div>`)

    vm.y++
    // 依赖未变，缓存保留旧输出。
    await nextTick()
    expect(el.innerHTML).toBe(`<div>1 0</div>`)

    vm.x++
    // 依赖变化，缓存应刷新。
    await nextTick()
    expect(el.innerHTML).toBe(`<div>2 1</div>`)
  })

  // v-if 两个分支分别缓存自己的 memo 子树，切换分支后仍遵循各自依赖。
  test('on v-if', async () => {
    const [el, vm] = mount({
      template: `<div v-if="ok" v-memo="[x]">{{ x }} {{ y }}</div>
        <div v-else v-memo="[y]">{{ y }} {{ x }}</div>`,
      /** 初始化外部 memo 数组为[0,0]与独立 c:0，供数组内容/长度及非依赖更新比较。 */
      data: () => ({ ok: true, x: 0, y: 0 }),
    })
    expect(el.innerHTML).toBe(`<div>0 0</div>`)

    vm.x++
    // 依赖变化，缓存应刷新。
    await nextTick()
    expect(el.innerHTML).toBe(`<div>1 0</div>`)

    vm.y++
    // 依赖未变，缓存保留旧输出。
    await nextTick()
    expect(el.innerHTML).toBe(`<div>1 0</div>`)

    vm.x++
    // 依赖变化，缓存应刷新。
    await nextTick()
    expect(el.innerHTML).toBe(`<div>2 1</div>`)

    vm.ok = false
    await nextTick()
    expect(el.innerHTML).toBe(`<div>1 2</div>`)

    vm.y++
    // 依赖变化，缓存应刷新。
    await nextTick()
    expect(el.innerHTML).toBe(`<div>2 2</div>`)

    vm.x++
    // 依赖未变，缓存保留旧输出。
    await nextTick()
    expect(el.innerHTML).toBe(`<div>2 2</div>`)

    vm.y++
    // 依赖变化，缓存应刷新。
    await nextTick()
    expect(el.innerHTML).toBe(`<div>3 3</div>`)

    vm.ok = true
    await nextTick()
    vm.ok = false
    await nextTick()
    expect(el.innerHTML).toBe(`<div>3 3</div>`)

    vm.y++
    // 依赖变化，缓存应刷新。
    await nextTick()
    expect(el.innerHTML).toBe(`<div>4 3</div>`)
  })

  // v-for 按项检查 memo；只刷新依赖变化的项，忽略不在依赖数组中的状态修改。
  test('on v-for', async () => {
    const [el, vm] = mount({
      template:
        `<div v-for="{ x } in list" :key="x" v-memo="[x, x === y]">` +
        `{{ x }} {{ x === y ? 'yes' : 'no' }} {{ z }}` +
        `</div>`,
      /** 初始化外部 memo 数组为[0,0]与独立 c:0，供数组内容/长度及非依赖更新比较。 */
      data: () => ({
        list: [{ x: 1 }, { x: 2 }, { x: 3 }],
        y: 1,
        z: 'z',
      }),
    })
    expect(el.innerHTML).toBe(
      `<div>1 yes z</div><div>2 no z</div><div>3 no z</div>`,
    )

    vm.y = 2
    await nextTick()
    expect(el.innerHTML).toBe(
      `<div>1 no z</div><div>2 yes z</div><div>3 no z</div>`,
    )

    vm.list[0].x = 4
    await nextTick()
    expect(el.innerHTML).toBe(
      `<div>4 no z</div><div>2 yes z</div><div>3 no z</div>`,
    )

    vm.list[0].x = 5
    vm.y = 5
    await nextTick()
    expect(el.innerHTML).toBe(
      `<div>5 yes z</div><div>2 no z</div><div>3 no z</div>`,
    )

    vm.z = 'zz'
    await nextTick()
    // 依赖未变，缓存保留旧输出。
    expect(el.innerHTML).toBe(
      `<div>5 yes z</div><div>2 no z</div><div>3 no z</div>`,
    )
  })

  // v-if 隐藏并恢复含 v-for 的子树后，列表项 memo 仍能继续响应依赖变化。
  test('on v-if + v-for', async () => {
    const [el, vm] = mount({
      template: `<span v-if="show">
          <span v-for="elem in [1]" :key="elem" v-memo="[count]">{{ count }}</span>
        </span>`,
      /** 初始化外部 memo 数组为[0,0]与独立 c:0，供数组内容/长度及非依赖更新比较。 */
      data: () => ({
        show: true,
        count: 0,
      }),
    })

    expect(el.innerHTML).toBe(`<span><span>0</span></span>`)

    vm.show = false
    await nextTick()
    expect(el.innerHTML).toBe(`<!--v-if-->`)

    vm.show = true
    await nextTick()
    expect(el.innerHTML).toBe(`<span><span>0</span></span>`)

    vm.count++
    await nextTick()
    expect(el.innerHTML).toBe(`<span><span>1</span></span>`)

    vm.count++
    await nextTick()
    expect(el.innerHTML).toBe(`<span><span>2</span></span>`)
  })

  // 生产模式下，含 v-for 和 v-memo 的 v-if 子树恢复后仍正确更新。
  test('on v-if + v-for in production mode', async () => {
    __DEV__ = false
    try {
      const [el, vm] = mount({
        template: `<span v-if="show">
            <span v-for="elem in [1]" :key="elem" v-memo="[count]">{{ count }}</span>
          </span>`,
        /** 初始化外部 memo 数组为[0,0]与独立 c:0，供数组内容/长度及非依赖更新比较。 */
        data: () => ({
          show: true,
          count: 0,
        }),
      })

      expect(el.innerHTML).toBe(`<span><span>0</span></span>`)

      vm.show = false
      await nextTick()
      expect(el.innerHTML).toBe(`<!---->`)

      vm.show = true
      await nextTick()
      expect(el.innerHTML).toBe(`<span><span>0</span></span>`)

      vm.count++
      await nextTick()
      expect(el.innerHTML).toBe(`<span><span>1</span></span>`)

      vm.count++
      await nextTick()
      expect(el.innerHTML).toBe(`<span><span>2</span></span>`)
    } finally {
      __DEV__ = true
    }
  })

  // 数字范围 v-for 中 memo 结果保持 true 时跳过更新，结果改变后刷新全部项。
  test('on v-for /w constant expression ', async () => {
    const [el, vm] = mount({
      template: `<div v-for="item in 3"  v-memo="[count < 2 ? true : count]">
          {{count}}
        </div>`,
      /** 初始化外部 memo 数组为[0,0]与独立 c:0，供数组内容/长度及非依赖更新比较。 */
      data: () => ({
        count: 0,
      }),
    })
    expect(el.innerHTML).toBe(`<div>0</div><div>0</div><div>0</div>`)

    vm.count = 1
    await nextTick()
    // 依赖未变，缓存保留旧输出。
    expect(el.innerHTML).toBe(`<div>0</div><div>0</div><div>0</div>`)

    vm.count = 2
    await nextTick()
    // 依赖变化，缓存应刷新。
    expect(el.innerHTML).toBe(`<div>2</div><div>2</div><div>2</div>`)
  })

  // memo 依赖为 NaN 时按 Object.is 判为相同，其他状态修改不刷新缓存输出。
  test('v-memo dependency is NaN should be equal', async () => {
    const [el, vm] = mount({
      template: `<div v-memo="[x]">{{ y }}</div>`,
      /** 初始化外部 memo 数组为[0,0]与独立 c:0，供数组内容/长度及非依赖更新比较。 */
      data: () => ({ x: NaN, y: 0 }),
    })
    expect(el.innerHTML).toBe(`<div>0</div>`)

    vm.y++
    // 依赖未变，缓存保留旧输出。
    await nextTick()
    expect(el.innerHTML).toBe(`<div>0</div>`)
  })
})
