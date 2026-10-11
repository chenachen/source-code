/**
 * 核对 formatComponentName 的名称来源与优先级：显式名称、推断名称、文件名和组件注册名。
 */
import {
  type ComponentInternalInstance,
  getCurrentInstance,
  h,
  nodeOps,
  render,
} from '@vue/runtime-test'
import { formatComponentName } from '../src/component'

// formatComponentName 为诊断信息推导组件名。
describe('formatComponentName', () => {
  // 未找到名称时返回 Anonymous；作为根组件格式化时返回 App。
  test('default name', () => {
    let instance: ComponentInternalInstance | null = null
    const Comp = {
      /**
       * 调用 `getCurrentInstance()` 完成本例的初始化登记或读取；把 `instance` 写入本例的状态或观察变量；返回渲染闭包，执行时产出 `null`。
       */
      setup() {
        instance = getCurrentInstance()
        return () => null
      },
    }
    render(h(Comp), nodeOps.createElement('div'))

    expect(formatComponentName(null, Comp)).toBe('Anonymous')
    expect(formatComponentName(null, Comp, true)).toBe('App')
    expect(formatComponentName(instance, Comp)).toBe('Anonymous')
    expect(formatComponentName(instance, Comp, true)).toBe('App')
  })

  // 显式 name 采用 PascalCase 展示，number-input 转为 NumberInput。
  test('name option', () => {
    let instance: ComponentInternalInstance | null = null
    const Comp = {
      name: 'number-input',
      /**
       * 调用 `getCurrentInstance()` 完成本例的初始化登记或读取；把 `instance` 写入本例的状态或观察变量；返回渲染闭包，执行时产出 `null`。
       */
      setup() {
        instance = getCurrentInstance()
        return () => null
      },
    }
    render(h(Comp), nodeOps.createElement('div'))

    expect(formatComponentName(null, Comp)).toBe('NumberInput')
    expect(formatComponentName(instance, Comp, true)).toBe('NumberInput')
  })

  // 组件在自身 components 中注册自己时，采用注册名 ToggleButton。
  test('self recursive name', () => {
    let instance: ComponentInternalInstance | null = null
    const Comp = {
      components: {} as any,
      /**
       * 调用 `getCurrentInstance()` 完成本例的初始化登记或读取；把 `instance` 写入本例的状态或观察变量；返回渲染闭包，执行时产出 `null`。
       */
      setup() {
        instance = getCurrentInstance()
        return () => null
      },
    }
    Comp.components.ToggleButton = Comp
    render(h(Comp), nodeOps.createElement('div'))

    expect(formatComponentName(instance, Comp)).toBe('ToggleButton')
  })

  // 从父组件的 components 注册表找到 list_item，并格式化为 ListItem。
  test('name from parent', () => {
    let instance: ComponentInternalInstance | null = null
    const Comp = {
      /**
       * 调用 `getCurrentInstance()` 完成本例的初始化登记或读取；把 `instance` 写入本例的状态或观察变量；返回渲染闭包，执行时产出 `null`。
       */
      setup() {
        instance = getCurrentInstance()
        return () => null
      },
    }
    const Parent = {
      components: {
        list_item: Comp,
      },
      /**
       * 渲染结果为 `h(Comp)`。
       */
      render() {
        return h(Comp)
      },
    }
    render(h(Parent), nodeOps.createElement('div'))

    expect(formatComponentName(instance, Comp)).toBe('ListItem')
  })

  // 直接传入函数检查名称：displayName 优先于函数名，匿名函数回退为 Anonymous。
  test('functional components', () => {
    /**
     * 返回空内容的具名函数式组件；formatComponentName 直接读取函数名和后续 displayName，不在本用例挂载。
     */
    const UserAvatar = () => null
    expect(formatComponentName(null, UserAvatar)).toBe('UserAvatar')
    UserAvatar.displayName = 'UserPicture'
    expect(formatComponentName(null, UserAvatar)).toBe('UserPicture')
    expect(formatComponentName(null, () => null)).toBe('Anonymous')
  })

  // 未显式命名时，从 __file 的文件名提取 LocaleDropdown。
  test('Name from file', () => {
    const Comp = {
      __file: './src/locale-dropdown.vue',
    }

    expect(formatComponentName(null, Comp)).toBe('LocaleDropdown')
  })

  // 组件的 __name 可作为推断名称。
  test('inferred name', () => {
    const Comp = {
      __name: 'MainSidebar',
    }

    expect(formatComponentName(null, Comp)).toBe('MainSidebar')
  })

  // 自身和父组件没有注册名时，从 appContext.components 找到全局注册名。
  test('global component', () => {
    let instance: ComponentInternalInstance | null = null
    const Comp = {
      /**
       * 调用 `getCurrentInstance()` 完成本例的初始化登记或读取；把 `instance` 写入本例的状态或观察变量；返回渲染闭包，执行时产出 `null`。
       */
      setup() {
        instance = getCurrentInstance()
        return () => null
      },
    }
    render(h(Comp), nodeOps.createElement('div'))

    instance!.appContext.components.FieldLabel = Comp

    expect(formatComponentName(instance, Comp)).toBe('FieldLabel')
  })

  // 逐步添加名称来源，验证优先级：name > __name > __file > 自身注册 > 父组件注册 > 全局注册。
  test('name precedence', () => {
    let instance: ComponentInternalInstance | null = null
    /**
     * 返回空内容的注册表占位组件，确保名称反查只采用与目标组件相同的值引用。
     */
    const Dummy = () => null
    const Comp: Record<string, any> = {
      components: { Dummy },
      /**
       * 调用 `getCurrentInstance()` 完成本例的初始化登记或读取；把 `instance` 写入本例的状态或观察变量；返回渲染闭包，执行时产出 `null`。
       */
      setup() {
        instance = getCurrentInstance()
        return () => null
      },
    }
    const Parent = {
      components: { Dummy } as any,
      /**
       * 渲染结果为 `h(Comp)`。
       */
      render() {
        return h(Comp)
      },
    }
    render(h(Parent), nodeOps.createElement('div'))

    expect(formatComponentName(instance, Comp)).toBe('Anonymous')
    expect(formatComponentName(instance, Comp, true)).toBe('App')

    instance!.appContext.components.CompA = Comp
    expect(formatComponentName(instance, Comp)).toBe('CompA')
    expect(formatComponentName(instance, Comp, true)).toBe('CompA')

    Parent.components.CompB = Comp
    expect(formatComponentName(instance, Comp)).toBe('CompB')

    Comp.components.CompC = Comp
    expect(formatComponentName(instance, Comp)).toBe('CompC')

    Comp.__file = './CompD.js'
    expect(formatComponentName(instance, Comp)).toBe('CompD')

    Comp.__name = 'CompE'
    expect(formatComponentName(instance, Comp)).toBe('CompE')

    Comp.name = 'CompF'
    expect(formatComponentName(instance, Comp)).toBe('CompF')
  })
})
