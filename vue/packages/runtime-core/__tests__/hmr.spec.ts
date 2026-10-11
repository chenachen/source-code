/**
 * 使用 runtime-test 内存宿主与编译后的 render，分别调用 HMR rerender/reload。
 * 通过节点内容、实例状态和生命周期计数，验证替换 render 与重建组件的不同结果。
 */
import type { HMRRuntime } from '../src/hmr'
import '../src/hmr'
import type { ComponentOptions, InternalRenderFunction } from '../src/component'
import {
  type TestElement,
  h,
  nextTick,
  nodeOps,
  ref,
  render,
  serializeInner,
  triggerEvent,
} from '@vue/runtime-test'
import * as runtimeTest from '@vue/runtime-test'
import { createApp, registerRuntimeCompiler } from '@vue/runtime-test'
import { baseCompile } from '@vue/compiler-core'

/** Vue 开发构建暴露的全局 HMR 控制面。 */
declare var __VUE_HMR_RUNTIME__: HMRRuntime

/** 分别覆盖首次登记、仅替换 render，以及重载组件定义三条 HMR 路径。 */
const { createRecord, rerender, reload } = __VUE_HMR_RUNTIME__

registerRuntimeCompiler(compileToFunction)

/** 把模板编译为携带 HMR 元数据的运行时 render 函数。 */
function compileToFunction(template: string) {
  const { code } = baseCompile(template, { hoistStatic: true, hmr: true })
  const render = new Function('Vue', code)(
    runtimeTest,
  ) as InternalRenderFunction
  render._rc = true // 标记为运行时编译的 render
  return render
}

/** 等待指定宏任务时间，用于观察 HMR 调度后的稳定状态。 */
const timeout = (n: number = 0) => new Promise(r => setTimeout(r, n))

// 测试组：热模块替换（HMR）的组件登记、rerender 与 reload 行为。
describe('hot module replacement', () => {
  /** 导入开发 HMR 模块后检查全局 createRecord/rerender/reload 都存在，验证控制面注入。 */
  test('inject global runtime', () => {
    expect(createRecord).toBeDefined()
    expect(rerender).toBeDefined()
    expect(reload).toBeDefined()
  })

  /** 同一 test1 ID 连续登记空定义，检查首次 true、第二次 false，验证记录去重。 */
  test('createRecord', () => {
    expect(createRecord('test1', {})).toBe(true)
    // 同一 ID 再登记返回 false。
    expect(createRecord('test1', {})).toBe(false)
  })

  /** 先点击把父 count 从0改为1，再依次 rerender 父文本、插槽和子树结构；检查状态仍1且新结构生效，验证替换 render 保留实例状态并强制更新静态结构。 */
  test('rerender', async () => {
    const root = nodeOps.createElement('div')
    const parentId = 'test2-parent'
    const childId = 'test2-child'

    const Child: ComponentOptions = {
      __hmrId: childId,
      render: compileToFunction(`<div><slot/></div>`),
    }
    createRecord(childId, Child)

    const Parent: ComponentOptions = {
      __hmrId: parentId,
      /** 提供 count:0 初始状态，供热更新前后比较实例保留或新实例初始化结果。 */
      data() {
        return { count: 0 }
      },
      components: { Child },
      render: compileToFunction(
        `<div @click="count++">{{ count }}<Child>{{ count }}</Child></div>`,
      ),
    }
    createRecord(parentId, Parent)

    render(h(Parent), root)
    expect(serializeInner(root)).toBe(`<div>0<div>0</div></div>`)

    // 先修改实例状态，后面的 rerender 应保留该值。

    triggerEvent(root.children[0] as TestElement, 'click')
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>1<div>1</div></div>`)

    // 改变模板文本并保留实例状态。
    rerender(
      parentId,
      compileToFunction(
        `<div @click="count++">{{ count }}!<Child>{{ count }}</Child></div>`,
      ),
    )
    expect(serializeInner(root)).toBe(`<div>1!<div>1</div></div>`)

    // 插槽文本变化也须强制更新子组件。
    rerender(
      parentId,
      compileToFunction(
        `<div @click="count++">{{ count }}!<Child>{{ count }}!</Child></div>`,
      ),
    )
    expect(serializeInner(root)).toBe(`<div>1!<div>1!</div></div>`)

    // 改变静态 children 结构，热更新应绕过旧 block 假设。
    rerender(
      parentId,
      compileToFunction(
        `<div @click="count++">{{ count }}<span>{{ count }}</span>
        <Child>{{ count }}!</Child>
      </div>`,
      ),
    )
    expect(serializeInner(root)).toBe(`<div>1<span>1</span><div>1!</div></div>`)

    // 子插槽内部的元素结构也须更新。
    rerender(
      parentId,
      compileToFunction(
        `<div @click="count++">
        <Child><span>{{ count }}</span></Child>
      </div>`,
      ),
    )
    expect(serializeInner(root)).toBe(`<div><div><span>1</span></div></div>`)
  })

  /** Child 初始 count:0，reload 改为1并更换钩子；刷新后检查新输出与旧卸载/新挂载各一次，验证重建实例。 */
  test('reload', async () => {
    const root = nodeOps.createElement('div')
    const childId = 'test3-child'
    const unmountSpy = vi.fn()
    const mountSpy = vi.fn()

    const Child: ComponentOptions = {
      __hmrId: childId,
      /** 提供 count:0 初始状态，供热更新前后比较实例保留或新实例初始化结果。 */
      data() {
        return { count: 0 }
      },
      unmounted: unmountSpy,
      render: compileToFunction(`<div @click="count++">{{ count }}</div>`),
    }
    createRecord(childId, Child)

    const Parent: ComponentOptions = {
      /** 仅渲染 Child，供普通子组件 reload 通过父更新替换实例。 */
      render: () => h(Child),
    }

    render(h(Parent), root)
    expect(serializeInner(root)).toBe(`<div>0</div>`)

    reload(childId, {
      __hmrId: childId,
      /** 提供 count:1 初始状态，供热更新前后比较实例保留或新实例初始化结果。 */
      data() {
        return { count: 1 }
      },
      mounted: mountSpy,
      render: compileToFunction(`<div @click="count++">{{ count }}</div>`),
    })
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>1</div>`)
    expect(unmountSpy).toHaveBeenCalledTimes(1)
    expect(mountSpy).toHaveBeenCalledTimes(1)
  })

  // #7042
  /** KeepAlive 活跃 Child 从 count0 reload 为1，再两次点击切换；检查初次重建、后续只停用/激活且保留1，验证 HMR 后缓存恢复。 */
  test('reload KeepAlive slot', async () => {
    const root = nodeOps.createElement('div')
    const childId = 'test-child-keep-alive'
    const unmountSpy = vi.fn()
    const mountSpy = vi.fn()
    const activeSpy = vi.fn()
    const deactiveSpy = vi.fn()

    const Child: ComponentOptions = {
      __hmrId: childId,
      /** 提供 count:0 初始状态，供热更新前后比较实例保留或新实例初始化结果。 */
      data() {
        return { count: 0 }
      },
      unmounted: unmountSpy,
      render: compileToFunction(`<div>{{ count }}</div>`),
    }
    createRecord(childId, Child)

    const Parent: ComponentOptions = {
      components: { Child },
      /** 初始化 toggle:true，让 KeepAlive 中的 Child 首次处于激活态，供随后切换缓存。 */
      data() {
        return { toggle: true }
      },
      render: compileToFunction(
        `<button @click="toggle = !toggle" />
        <KeepAlive><Child v-if="toggle" /></KeepAlive>`,
      ),
    }

    render(h(Parent), root)
    expect(serializeInner(root)).toBe(`<button></button><div>0</div>`)

    reload(childId, {
      __hmrId: childId,
      /** 提供 count:1 初始状态，供热更新前后比较实例保留或新实例初始化结果。 */
      data() {
        return { count: 1 }
      },
      mounted: mountSpy,
      unmounted: unmountSpy,
      activated: activeSpy,
      deactivated: deactiveSpy,
      render: compileToFunction(`<div>{{ count }}</div>`),
    })
    await nextTick()
    expect(serializeInner(root)).toBe(`<button></button><div>1</div>`)
    expect(unmountSpy).toHaveBeenCalledTimes(1)
    expect(mountSpy).toHaveBeenCalledTimes(1)
    expect(activeSpy).toHaveBeenCalledTimes(1)
    expect(deactiveSpy).toHaveBeenCalledTimes(0)

    // 隐藏缓存组件只停用，不再次卸载。
    triggerEvent(root.children[1] as TestElement, 'click')
    await nextTick()
    expect(unmountSpy).toHaveBeenCalledTimes(1)
    expect(mountSpy).toHaveBeenCalledTimes(1)
    expect(activeSpy).toHaveBeenCalledTimes(1)
    expect(deactiveSpy).toHaveBeenCalledTimes(1)

    // 恢复缓存组件只激活，不再次挂载。
    triggerEvent(root.children[1] as TestElement, 'click')
    await nextTick()
    expect(unmountSpy).toHaveBeenCalledTimes(1)
    expect(mountSpy).toHaveBeenCalledTimes(1)
    expect(activeSpy).toHaveBeenCalledTimes(2)
    expect(deactiveSpy).toHaveBeenCalledTimes(1)
  })

  // #7121
  /** BaseTransition 包 KeepAlive，Child 从0 reload 为1后再隐藏/恢复；检查输出及挂载/卸载/激活/停用次数，验证组合边界下缓存更新。 */
  test('reload KeepAlive slot in Transition', async () => {
    const root = nodeOps.createElement('div')
    const childId = 'test-transition-keep-alive-reload'
    const unmountSpy = vi.fn()
    const mountSpy = vi.fn()
    const activeSpy = vi.fn()
    const deactiveSpy = vi.fn()

    const Child: ComponentOptions = {
      __hmrId: childId,
      /** 提供 count:0 初始状态，供热更新前后比较实例保留或新实例初始化结果。 */
      data() {
        return { count: 0 }
      },
      unmounted: unmountSpy,
      render: compileToFunction(`<div>{{ count }}</div>`),
    }
    createRecord(childId, Child)

    const Parent: ComponentOptions = {
      components: { Child },
      /** 初始化 toggle:true，让 KeepAlive 中的 Child 首次处于激活态，供随后切换缓存。 */
      data() {
        return { toggle: true }
      },
      render: compileToFunction(
        `<button @click="toggle = !toggle" />
        <BaseTransition>
          <KeepAlive><Child v-if="toggle" /></KeepAlive>
        </BaseTransition>`,
      ),
    }

    render(h(Parent), root)
    expect(serializeInner(root)).toBe(`<button></button><div>0</div>`)

    reload(childId, {
      __hmrId: childId,
      /** 提供 count:1 初始状态，供热更新前后比较实例保留或新实例初始化结果。 */
      data() {
        return { count: 1 }
      },
      mounted: mountSpy,
      unmounted: unmountSpy,
      activated: activeSpy,
      deactivated: deactiveSpy,
      render: compileToFunction(`<div>{{ count }}</div>`),
    })
    await nextTick()
    expect(serializeInner(root)).toBe(`<button></button><div>1</div>`)
    expect(unmountSpy).toHaveBeenCalledTimes(1)
    expect(mountSpy).toHaveBeenCalledTimes(1)
    expect(activeSpy).toHaveBeenCalledTimes(1)
    expect(deactiveSpy).toHaveBeenCalledTimes(0)

    // 隐藏缓存组件只停用，不再次卸载。
    triggerEvent(root.children[1] as TestElement, 'click')
    await nextTick()
    expect(serializeInner(root)).toBe(`<button></button><!--v-if-->`)
    expect(unmountSpy).toHaveBeenCalledTimes(1)
    expect(mountSpy).toHaveBeenCalledTimes(1)
    expect(activeSpy).toHaveBeenCalledTimes(1)
    expect(deactiveSpy).toHaveBeenCalledTimes(1)

    // 恢复缓存组件只激活，不再次挂载。
    triggerEvent(root.children[1] as TestElement, 'click')
    await nextTick()
    expect(serializeInner(root)).toBe(`<button></button><div>1</div>`)
    expect(unmountSpy).toHaveBeenCalledTimes(1)
    expect(mountSpy).toHaveBeenCalledTimes(1)
    expect(activeSpy).toHaveBeenCalledTimes(2)
    expect(deactiveSpy).toHaveBeenCalledTimes(1)
  })

  /** out-in 的 leave 用计时器完成，reload Child 从 original/0 改为 updated/1，再隐藏/恢复；等待 leave 后检查输出和生命周期次数，验证异步过渡后的缓存重建。 */
  test('reload KeepAlive slot in Transition with out-in', async () => {
    const root = nodeOps.createElement('div')
    const childId = 'test-transition-keep-alive-reload-with-out-in'
    const unmountSpy = vi.fn()
    const mountSpy = vi.fn()
    const activeSpy = vi.fn()
    const deactiveSpy = vi.fn()

    const Child: ComponentOptions = {
      __hmrId: childId,
      name: 'original',
      /** 提供 count:0 初始状态，供热更新前后比较实例保留或新实例初始化结果。 */
      data() {
        return { count: 0 }
      },
      unmounted: unmountSpy,
      render: compileToFunction(`<div>{{ count }}</div>`),
    }
    createRecord(childId, Child)

    const Parent: ComponentOptions = {
      components: { Child },
      /** 初始化 toggle:true，让 KeepAlive 中的 Child 首次处于激活态，供随后切换缓存。 */
      data() {
        return { toggle: true }
      },
      methods: {
        // @ts-expect-error
        /** 通过0毫秒计时器调用 done，构造 out-in 模式等待 leave 完成的异步边界。 */
        onLeave(_, done) {
          setTimeout(done, 0)
        },
      },
      render: compileToFunction(
        `<button @click="toggle = !toggle" />
        <BaseTransition mode="out-in" @leave="onLeave">
          <KeepAlive><Child v-if="toggle" /></KeepAlive>
        </BaseTransition>`,
      ),
    }

    render(h(Parent), root)
    expect(serializeInner(root)).toBe(`<button></button><div>0</div>`)

    reload(childId, {
      __hmrId: childId,
      name: 'updated',
      /** 提供 count:1 初始状态，供热更新前后比较实例保留或新实例初始化结果。 */
      data() {
        return { count: 1 }
      },
      mounted: mountSpy,
      unmounted: unmountSpy,
      activated: activeSpy,
      deactivated: deactiveSpy,
      render: compileToFunction(`<div>{{ count }}</div>`),
    })
    await nextTick()
    await new Promise(r => setTimeout(r, 0))
    expect(serializeInner(root)).toBe(`<button></button><div>1</div>`)
    expect(unmountSpy).toHaveBeenCalledTimes(1)
    expect(mountSpy).toHaveBeenCalledTimes(1)
    expect(activeSpy).toHaveBeenCalledTimes(1)
    expect(deactiveSpy).toHaveBeenCalledTimes(0)

    // 等待 leave 后缓存组件停用，不再次卸载。
    triggerEvent(root.children[1] as TestElement, 'click')
    await nextTick()
    await new Promise(r => setTimeout(r, 0))
    expect(serializeInner(root)).toBe(`<button></button><!--v-if-->`)
    expect(unmountSpy).toHaveBeenCalledTimes(1)
    expect(mountSpy).toHaveBeenCalledTimes(1)
    expect(activeSpy).toHaveBeenCalledTimes(1)
    expect(deactiveSpy).toHaveBeenCalledTimes(1)

    // 恢复缓存组件只激活，不再次挂载。
    triggerEvent(root.children[1] as TestElement, 'click')
    await nextTick()
    expect(serializeInner(root)).toBe(`<button></button><div>1</div>`)
    expect(unmountSpy).toHaveBeenCalledTimes(1)
    expect(mountSpy).toHaveBeenCalledTimes(1)
    expect(activeSpy).toHaveBeenCalledTimes(2)
    expect(deactiveSpy).toHaveBeenCalledTimes(1)
  })

  /** 类组件通过 __vccOpts 提供 count0，reload 为新类 count1；刷新后检查新文本及旧卸载/新挂载一次，验证类定义归一化。 */
  test('reload class component', async () => {
    const root = nodeOps.createElement('div')
    const childId = 'test4-child'
    const unmountSpy = vi.fn()
    const mountSpy = vi.fn()

    /** 旧类组件夹具，运行时读取静态 __vccOpts 而不实例化此类，用于验证 HMR 对类定义的归一化。 */
    class Child {
      /** 旧类组件的真实选项：保存 HMR ID、初始 count:0、卸载 spy 与编译 render。 */
      static __vccOpts: ComponentOptions = {
        __hmrId: childId,
        /** 提供 count:0 初始状态，供热更新前后比较实例保留或新实例初始化结果。 */
        data() {
          return { count: 0 }
        },
        unmounted: unmountSpy,
        render: compileToFunction(`<div @click="count++">{{ count }}</div>`),
      }
    }
    createRecord(childId, Child)

    const Parent: ComponentOptions = {
      /** 仅渲染 class Child，供 __vccOpts 重载通过父更新提交。 */
      render: () => h(Child),
    }

    render(h(Parent), root)
    expect(serializeInner(root)).toBe(`<div>0</div>`)

    /** 新类组件夹具，作为 reload 的新定义，验证相同 HMR ID 下读取新 __vccOpts。 */
    class UpdatedChild {
      /** 重载后的真实选项：初始 count:1、挂载 spy 与编译 render。 */
      static __vccOpts: ComponentOptions = {
        __hmrId: childId,
        /** 提供 count:1 初始状态，供热更新前后比较实例保留或新实例初始化结果。 */
        data() {
          return { count: 1 }
        },
        mounted: mountSpy,
        render: compileToFunction(`<div @click="count++">{{ count }}</div>`),
      }
    }

    reload(childId, UpdatedChild)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>1</div>`)
    expect(unmountSpy).toHaveBeenCalledTimes(1)
    expect(mountSpy).toHaveBeenCalledTimes(1)
  })

  // #6930
  /** 父持有两个 Child 函数 ref 并读取第一个公开 count，reload 两个实例从0到1；检查最终两根与父文本、两次卸载/挂载，验证引用依赖不会无限重载。 */
  test('reload: avoid infinite recursion', async () => {
    const root = nodeOps.createElement('div')
    const childId = 'test-child-6930'
    const unmountSpy = vi.fn()
    const mountSpy = vi.fn()

    const Child: ComponentOptions = {
      __hmrId: childId,
      /** 提供 count:0 初始状态，供热更新前后比较实例保留或新实例初始化结果。 */
      data() {
        return { count: 0 }
      },
      expose: ['count'],
      unmounted: unmountSpy,
      render: compileToFunction(`<div @click="count++">{{ count }}</div>`),
    }
    createRecord(childId, Child)

    const Parent: ComponentOptions = {
      /** 创建两个组件 ref 与赋值回调，并在父 render 读取第一实例 count，构造 HMR 的 ref 依赖递归场景。 */
      setup() {
        const com1 = ref()
        /** 把组件 ref 回调的实例/null 写入对应 com ref，使父 render 可读取公开 count。 */
        const changeRef1 = (value: any) => (com1.value = value)

        const com2 = ref()
        /** 把组件 ref 回调的实例/null 写入对应 com ref，使父 render 可读取公开 count。 */
        const changeRef2 = (value: any) => (com2.value = value)

        return () => [
          h(Child, { ref: changeRef1 }),
          h(Child, { ref: changeRef2 }),
          com1.value?.count,
        ]
      },
    }

    render(h(Parent), root)
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>0</div><div>0</div>0`)

    reload(childId, {
      __hmrId: childId,
      /** 提供 count:1 初始状态，供热更新前后比较实例保留或新实例初始化结果。 */
      data() {
        return { count: 1 }
      },
      mounted: mountSpy,
      render: compileToFunction(`<div @click="count++">{{ count }}</div>`),
    })
    await nextTick()
    expect(serializeInner(root)).toBe(`<div>1</div><div>1</div>1`)
    expect(unmountSpy).toHaveBeenCalledTimes(2)
    expect(mountSpy).toHaveBeenCalledTimes(2)
  })

  // #1156：热更新期间，静态节点的宿主引用须跨响应式更新保留。
  /** HMR 组件先点击 count0到1，再 rerender 给静态 button 加 class:foo；检查状态与新 class，验证响应式更新后的静态节点引用可继续补丁。 */
  test('static el reference', async () => {
    const root = nodeOps.createElement('div')
    const id = 'test-static-el'

    const template = `<div>
    <div>{{ count }}</div>
    <button @click="count++">++</button>
  </div>`

    const Comp: ComponentOptions = {
      __hmrId: id,
      /** 提供 count:0 初始状态，供热更新前后比较实例保留或新实例初始化结果。 */
      data() {
        return { count: 0 }
      },
      render: compileToFunction(template),
    }
    createRecord(id, Comp)

    render(h(Comp), root)
    expect(serializeInner(root)).toBe(
      `<div><div>0</div><button>++</button></div>`,
    )

    // 1. 点击触发响应式更新。
    triggerEvent((root as any).children[0].children[1], 'click')
    await nextTick()
    expect(serializeInner(root)).toBe(
      `<div><div>1</div><button>++</button></div>`,
    )

    // 2. 热替换模板。
    rerender(
      id,
      compileToFunction(template.replace(`<button`, `<button class="foo"`)),
    )
    expect(serializeInner(root)).toBe(
      `<div><div>1</div><button class="foo">++</button></div>`,
    )
  })

  // #1157：HMR 应强制完整更新组件 props。
  /** 父模板的 Child msg 从静态 foo rerender 为 bar，检查子输出，验证 HMR 强制提交编译静态 props。 */
  test('force update child component w/ static props', () => {
    const root = nodeOps.createElement('div')
    const parentId = 'test-force-props-parent'
    const childId = 'test-force-props-child'

    const Child: ComponentOptions = {
      __hmrId: childId,
      props: {
        msg: String,
      },
      render: compileToFunction(`<div>{{ msg }}</div>`),
    }
    createRecord(childId, Child)

    const Parent: ComponentOptions = {
      __hmrId: parentId,
      components: { Child },
      render: compileToFunction(`<Child msg="foo" />`),
    }
    createRecord(parentId, Parent)

    render(h(Parent), root)
    expect(serializeInner(root)).toBe(`<div>foo</div>`)

    rerender(parentId, compileToFunction(`<Child msg="bar" />`))
    expect(serializeInner(root)).toBe(`<div>bar</div>`)
  })

  // #1305：HMR 应删除旧静态 class。
  /** 父模板移除 Child 的静态 class:test，检查子根 class 消失，验证热更新会删除原透传属性。 */
  test('remove static class from parent', () => {
    const root = nodeOps.createElement('div')
    const parentId = 'test-force-class-parent'
    const childId = 'test-force-class-child'

    const Child: ComponentOptions = {
      __hmrId: childId,
      render: compileToFunction(`<div>child</div>`),
    }
    createRecord(childId, Child)

    const Parent: ComponentOptions = {
      __hmrId: parentId,
      components: { Child },
      render: compileToFunction(`<Child class="test" />`),
    }
    createRecord(parentId, Parent)

    render(h(Parent), root)
    expect(serializeInner(root)).toBe(`<div class="test">child</div>`)

    rerender(parentId, compileToFunction(`<Child/>`))
    expect(serializeInner(root)).toBe(`<div>child</div>`)
  })

  /** 构造五层组件根传递链，再给最外层 Parent 调用添加 class:test；检查最终 Child 根 class，验证热更新穿过祖先链。 */
  test('rerender if any parent in the parent chain', () => {
    const root = nodeOps.createElement('div')
    const parent = 'test-force-props-parent-'
    const childId = 'test-force-props-child'

    const numberOfParents = 5

    const Child: ComponentOptions = {
      __hmrId: childId,
      render: compileToFunction(`<div>child</div>`),
    }
    createRecord(childId, Child)

    const components: ComponentOptions[] = []

    for (let i = 0; i < numberOfParents; i++) {
      const parentId = `${parent}${i}`
      const parentComp: ComponentOptions = {
        __hmrId: parentId,
      }
      components.push(parentComp)
      if (i === 0) {
        parentComp.render = compileToFunction(`<Child />`)
        parentComp.components = {
          Child,
        }
      } else {
        parentComp.render = compileToFunction(`<Parent />`)
        parentComp.components = {
          Parent: components[i - 1],
        }
      }

      createRecord(parentId, parentComp)
    }

    const last = components[components.length - 1]

    render(h(last), root)
    expect(serializeInner(root)).toBe(`<div>child</div>`)

    rerender(last.__hmrId!, compileToFunction(`<Parent class="test"/>`))
    expect(serializeInner(root)).toBe(`<div class="test">child</div>`)
  })

  // #3302
  /** Child Teleport 向内存目标渲染插槽，父 rerender 从一个 div 变两个；检查源锚点与目标完整输出，验证目标内静态插槽结构更新。 */
  test('rerender with Teleport', () => {
    const root = nodeOps.createElement('div')
    const target = nodeOps.createElement('div')
    const parentId = 'parent-teleport'

    const Child: ComponentOptions = {
      /** 返回 target 与空动态 style，使 Teleport 内 div 被块跟踪并提供目标容器。 */
      data() {
        return {
          // 动态 style 使这个 div 被 Teleport 的块跟踪收集。
          style: {},
          target,
        }
      },
      render: compileToFunction(`
        <teleport :to="target">
          <div :style="style">
            <slot/>
          </div>
        </teleport>
      `),
    }

    const Parent: ComponentOptions = {
      __hmrId: parentId,
      components: { Child },
      render: compileToFunction(`
        <Child>
          <template #default>
            <div>1</div>
          </template>
        </Child>
      `),
    }
    createRecord(parentId, Parent)

    render(h(Parent), root)
    expect(serializeInner(root)).toBe(
      `<!--teleport start--><!--teleport end-->`,
    )
    expect(serializeInner(target)).toBe(`<div style={}><div>1</div></div>`)

    rerender(
      parentId,
      compileToFunction(`
      <Child>
        <template #default>
          <div>1</div>
          <div>2</div>
        </template>
      </Child>
    `),
    )
    expect(serializeInner(root)).toBe(
      `<!--teleport start--><!--teleport end-->`,
    )
    expect(serializeInner(target)).toBe(
      `<div style={}><div>1</div><div>2</div></div>`,
    )
  })

  // #4174
  /** App 安装全局空 mixin，Child reload 替换 created；检查旧钩子仍一次、新钩子一次，验证选项缓存没有保留旧创建钩子。 */
  test('with global mixins', async () => {
    const childId = 'hmr-global-mixin'
    const createSpy1 = vi.fn()
    const createSpy2 = vi.fn()

    const Child: ComponentOptions = {
      __hmrId: childId,
      created: createSpy1,
      /** 返回单 div 根，供全局 mixin 下比较旧/新 created 钩子的执行次数。 */
      render() {
        return h('div')
      },
    }
    createRecord(childId, Child)

    const Parent: ComponentOptions = {
      /** 仅渲染 Child，供带全局 mixin 的选项缓存失效。 */
      render: () => h(Child),
    }

    const app = createApp(Parent)
    app.mixin({})

    const root = nodeOps.createElement('div')
    app.mount(root)
    expect(createSpy1).toHaveBeenCalledTimes(1)
    expect(createSpy2).toHaveBeenCalledTimes(0)

    reload(childId, {
      __hmrId: childId,
      created: createSpy2,
      /** 返回单 div 根，供全局 mixin 下比较旧/新 created 钩子的执行次数。 */
      render() {
        return h('div')
      },
    })
    await nextTick()
    expect(createSpy1).toHaveBeenCalledTimes(1)
    expect(createSpy2).toHaveBeenCalledTimes(1)
  })

  // #4757
  /** Foo 只登记尚未挂载，rerender 将 foo 改为 bar 后首次挂载；检查 bar 输出，验证无活动实例时仍更新定义。 */
  test('rerender for component that has no active instance yet', () => {
    const id = 'no-active-instance-rerender'
    const Foo: ComponentOptions = {
      __hmrId: id,
      /** 返回初始 foo 文本，供尚无活动实例时 rerender 替换。 */
      render: () => 'foo',
    }

    createRecord(id, Foo)
    rerender(id, () => 'bar')

    const root = nodeOps.createElement('div')
    render(h(Foo), root)
    expect(serializeInner(root)).toBe('bar')
  })

  /** Foo 只登记尚未挂载，reload 替换 foo render 为 bar 后挂载；检查 bar 输出，验证无活动实例的定义重载。 */
  test('reload for component that has no active instance yet', () => {
    const id = 'no-active-instance-reload'
    const Foo: ComponentOptions = {
      __hmrId: id,
      /** 返回初始 foo 文本，供尚无活动实例时 reload 替换。 */
      render: () => 'foo',
    }

    createRecord(id, Foo)
    reload(id, {
      __hmrId: id,
      /** 返回重载后的 bar 文本，供首次挂载使用新定义。 */
      render: () => 'bar',
    })

    const root = nodeOps.createElement('div')
    render(h(Foo), root)
    expect(serializeInner(root)).toBe('bar')
  })

  // #7155：插槽内容变化时强制 HMR 更新。
  /** Child computed 缓存 default 插槽结果，父 rerender 从1改为2；检查新文本，验证热更新刷新计算插槽依赖。 */
  test('force update slot content change', () => {
    const root = nodeOps.createElement('div')
    const parentId = 'test-force-computed-parent'
    const childId = 'test-force-computed-child'

    const Child: ComponentOptions = {
      __hmrId: childId,
      computed: {
        /** 计算属性调用当前 default 插槽，构造插槽结果被计算属性缓存的热更新场景。 */
        slotContent() {
          return this.$slots.default?.()
        },
      },
      render: compileToFunction(`<component :is="() => slotContent" />`),
    }
    createRecord(childId, Child)

    const Parent: ComponentOptions = {
      __hmrId: parentId,
      components: { Child },
      render: compileToFunction(`<Child>1</Child>`),
    }
    createRecord(parentId, Parent)

    render(h(Parent), root)
    expect(serializeInner(root)).toBe(`1`)

    rerender(parentId, compileToFunction(`<Child>2</Child>`))
    expect(serializeInner(root)).toBe(`2`)
  })

  // #6978, #7138, #7114
  /** 两项 v-for 的提升静态 children 加上外部 p，rerender 把 p3 移入每项内部；检查两项的新嵌套结构，验证共享提升数组重新处理。 */
  test('hoisted children array inside v-for', () => {
    const root = nodeOps.createElement('div')
    const appId = 'test-app-id'
    const App: ComponentOptions = {
      __hmrId: appId,
      render: compileToFunction(
        `<div v-for="item of 2">
          <div>1</div>
        </div>
        <p>2</p>
        <p>3</p>`,
      ),
    }
    createRecord(appId, App)

    render(h(App), root)
    expect(serializeInner(root)).toBe(
      `<div><div>1</div></div><div><div>1</div></div><p>2</p><p>3</p>`,
    )

    // 把外部 p/3 移到每个 v-for 项的内部 div。
    rerender(
      appId,
      compileToFunction(
        `<div v-for="item of 2">
          <div>1<p>3</p></div>
        </div>
        <p>2</p>`,
      ),
    )
    expect(serializeInner(root)).toBe(
      `<div><div>1<p>3</p></div></div><div><div>1<p>3</p></div></div><p>2</p>`,
    )
  })

  // #11248
  /** 异步包装 Child 挂载两个实例，加载后 count0，reload 为count1；等待宏任务后检查两个新输出，验证多异步实例统一重载。 */
  test('reload async component with multiple instances', async () => {
    const root = nodeOps.createElement('div')
    const childId = 'test-child-id'
    const Child: ComponentOptions = {
      __hmrId: childId,
      /** 提供 count:0 初始状态，供热更新前后比较实例保留或新实例初始化结果。 */
      data() {
        return { count: 0 }
      },
      render: compileToFunction(`<div>{{ count }}</div>`),
    }
    const Comp = runtimeTest.defineAsyncComponent(() => Promise.resolve(Child))
    const appId = 'test-app-id'
    const App: ComponentOptions = {
      __hmrId: appId,
      /** 同时创建两个异步 Comp 实例，供 HMR 统一更新活动实例。 */
      render: () => [h(Comp), h(Comp)],
    }
    createRecord(appId, App)

    render(h(App), root)

    await timeout()

    expect(serializeInner(root)).toBe(`<div>0</div><div>0</div>`)

    // 新定义初始 count 改为1。
    reload(childId, {
      __hmrId: childId,
      /** 提供 count:1 初始状态，供热更新前后比较实例保留或新实例初始化结果。 */
      data() {
        return { count: 1 }
      },
      render: compileToFunction(`<div>{{ count }}</div>`),
    })

    await timeout()

    expect(serializeInner(root)).toBe(`<div>1</div><div>1</div>`)
  })

  /** Suspense/KeepAlive 内 async setup 从 foo reload 为 bar；等待初始解析和重载后检查输出，验证异步缓存子组件重建。 */
  test('reload async child wrapped in Suspense + KeepAlive', async () => {
    const id = 'async-child-reload'
    const AsyncChild: ComponentOptions = {
      __hmrId: id,
      /** 等待 nextTick 后返回 foo 文本 render，构造 async setup 在 Suspense/KeepAlive 中的重载。 */
      async setup() {
        await nextTick()
        return () => 'foo'
      },
    }
    createRecord(id, AsyncChild)

    const appId = 'test-app-id'
    const App: ComponentOptions = {
      __hmrId: appId,
      components: { AsyncChild },
      render: compileToFunction(`
        <div>
        <Suspense>
          <KeepAlive>
            <AsyncChild />
          </KeepAlive>
        </Suspense>
      </div>
      `),
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(serializeInner(root)).toBe('<div><!----></div>')
    await timeout()
    expect(serializeInner(root)).toBe('<div>foo</div>')

    reload(id, {
      __hmrId: id,
      /** 等待 nextTick 后返回 bar 文本 render，构造 async setup 在 Suspense/KeepAlive 中的重载。 */
      async setup() {
        await nextTick()
        return () => 'bar'
      },
    })
    await timeout()
    expect(serializeInner(root)).toBe('<div>bar</div>')
  })

  /** KeepAlive/Suspense 内 Child 连续 reload 初始 count0到1再到2；各次等待后检查新状态，验证缓存连续失效。 */
  test('multi reload child wrapped in Suspense + KeepAlive', async () => {
    const id = 'test-child-reload-3'
    const Child: ComponentOptions = {
      __hmrId: id,
      /** 创建 count:0 的 ref 并返回 setupState，供连续 reload 比较重新初始化的状态。 */
      setup() {
        const count = ref(0)
        return { count }
      },
      render: compileToFunction(`<div>{{ count }}</div>`),
    }
    createRecord(id, Child)

    const appId = 'test-app-id'
    const App: ComponentOptions = {
      __hmrId: appId,
      components: { Child },
      render: compileToFunction(`
        <KeepAlive>
          <Suspense>
            <Child />
          </Suspense>
        </KeepAlive>
      `),
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(serializeInner(root)).toBe('<div>0</div>')
    await timeout()
    reload(id, {
      __hmrId: id,
      /** 创建 count:1 的 ref 并返回 setupState，供连续 reload 比较重新初始化的状态。 */
      setup() {
        const count = ref(1)
        return { count }
      },
      render: compileToFunction(`<div>{{ count }}</div>`),
    })
    await timeout()
    expect(serializeInner(root)).toBe('<div>1</div>')

    reload(id, {
      __hmrId: id,
      /** 创建 count:2 的 ref 并返回 setupState，供连续 reload 比较重新初始化的状态。 */
      setup() {
        const count = ref(2)
        return { count }
      },
      render: compileToFunction(`<div>{{ count }}</div>`),
    })
    await timeout()
    expect(serializeInner(root)).toBe('<div>2</div>')
  })

  /** 嵌套 Foo 经转发插槽先输出 foo，再 rerender Foo 为 bar；检查最终文本，验证热替换到达嵌套实例。 */
  test('rerender for nested component', () => {
    const id = 'child-nested-rerender'
    const Foo: ComponentOptions = {
      __hmrId: id,
      /** 直接调用 default 插槽，构造被热替换的嵌套插槽组件。 */
      render() {
        return this.$slots.default()
      },
    }
    createRecord(id, Foo)

    const parentId = 'parent-nested-rerender'
    const Parent: ComponentOptions = {
      __hmrId: parentId,
      /** 把 default 插槽转发给 Foo 并标记 FORWARDED，构造嵌套 HMR 插槽链。 */
      render() {
        return h(Foo, null, {
          /** 调用并返回当前 default 插槽，构造 FORWARDED 插槽函数。 */
          default: () => this.$slots.default(),
          _: 3 /* FORWARDED */,
        })
      },
    }

    const appId = 'app-nested-rerender'
    const App: ComponentOptions = {
      __hmrId: appId,
      /** 向 Parent 提供嵌套 Foo 的 default 插槽，构造两层可热替换实例。 */
      render: () =>
        h(Parent, null, {
          /** 返回包含内层 Foo 的 VNode 数组，供嵌套插槽实例挂载。 */
          default: () => [
            h(Foo, null, {
              /** 返回 foo 文本数组，作为内层 Foo 的初始插槽内容。 */
              default: () => ['foo'],
            }),
          ],
        }),
    }
    createRecord(parentId, App)

    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(serializeInner(root)).toBe('foo')

    rerender(id, () => 'bar')
    expect(serializeInner(root)).toBe('bar')
  })

  /** 同一批替换 Outer 与 Inner 变量并先后 reload，Inner 从 div/foo 到 div/bar；刷新后检查 bar，验证嵌套同批重载合并。 */
  test('reload nested components from single update', async () => {
    const innerId = 'nested-reload-inner'
    const outerId = 'nested-reload-outer'

    let Inner = {
      __hmrId: innerId,
      /** 返回 div/foo，供嵌套组件同批 reload 的新旧输出比较。 */
      render() {
        return h('div', 'foo')
      },
    }
    let Outer = {
      __hmrId: outerId,
      /** 渲染当前变量 Inner，使外层和内层定义替换可在同一次更新中生效。 */
      render() {
        return h(Inner)
      },
    }

    createRecord(innerId, Inner)
    createRecord(outerId, Outer)

    const App = {
      /** 仅渲染当前 Outer，供内外层同批 reload 的根入口。 */
      render: () => h(Outer),
    }

    const root = nodeOps.createElement('div')
    render(h(App), root)
    expect(serializeInner(root)).toBe('<div>foo</div>')

    Inner = {
      __hmrId: innerId,
      /** 返回 div/bar，供嵌套组件同批 reload 的新旧输出比较。 */
      render() {
        return h('div', 'bar')
      },
    }
    Outer = {
      __hmrId: outerId,
      /** 渲染当前变量 Inner，使外层和内层定义替换可在同一次更新中生效。 */
      render() {
        return h(Inner)
      },
    }

    // 同一批重载 Outer 与 Inner。
    reload(outerId, Outer)
    reload(innerId, Inner)
    await nextTick()

    expect(serializeInner(root)).toBe('<div>bar</div>')
  })

  // #14127
  /** 先点击把 count0到1，再两次 rerender 修改缓存静态文本；检查动态值保留1、静态文本依次更新，验证缓存文本不会阻止 HMR。 */
  test('update cached text nodes', async () => {
    const root = nodeOps.createElement('div')
    const appId = 'test-cached-text-nodes'
    const App: ComponentOptions = {
      __hmrId: appId,
      /** 提供 count:0 初始状态，供热更新前后比较实例保留或新实例初始化结果。 */
      data() {
        return {
          count: 0,
        }
      },
      render: compileToFunction(
        `{{count}}
        <button @click="count++">++</button> 
        static text`,
      ),
    }
    createRecord(appId, App)
    render(h(App), root)
    expect(serializeInner(root)).toBe(`0 <button>++</button> static text`)

    // 点击触发 count 更新。
    triggerEvent((root as any).children[2], 'click')
    await nextTick()
    expect(serializeInner(root)).toBe(`1 <button>++</button> static text`)

    // 热替换缓存静态文本。
    rerender(
      appId,
      compileToFunction(
        `{{count}}
        <button @click="count++">++</button> 
        static text updated`,
      ),
    )
    expect(serializeInner(root)).toBe(
      `1 <button>++</button> static text updated`,
    )

    // 再次热替换缓存静态文本。
    rerender(
      appId,
      compileToFunction(
        `{{count}}
        <button @click="count++">++</button> 
        static text updated2`,
      ),
    )
    expect(serializeInner(root)).toBe(
      `1 <button>++</button> static text updated2`,
    )
  })
})
