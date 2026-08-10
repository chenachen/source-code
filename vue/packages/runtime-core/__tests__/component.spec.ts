/**
 * 测试阅读说明：本文件验证 `runtime-core/component` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import {
  type ComponentInternalInstance,
  getCurrentInstance,
  h,
  nodeOps,
  render,
} from '@vue/runtime-test'
import { formatComponentName } from '../src/component'

// 测试组：formatComponentName 从显式名称、文件名或注册 key 推导诊断用组件名。
describe('formatComponentName', () => {
  // 测试场景：默认名称。
  test('default name', () => {
    let instance: ComponentInternalInstance | null = null
    const Comp = {
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

  // 测试场景：名称选项。
  test('name option', () => {
    let instance: ComponentInternalInstance | null = null
    const Comp = {
      name: 'number-input',
      setup() {
        instance = getCurrentInstance()
        return () => null
      },
    }
    render(h(Comp), nodeOps.createElement('div'))

    expect(formatComponentName(null, Comp)).toBe('NumberInput')
    expect(formatComponentName(instance, Comp, true)).toBe('NumberInput')
  })

  // 测试场景：自递归名称。
  test('self recursive name', () => {
    let instance: ComponentInternalInstance | null = null
    const Comp = {
      components: {} as any,
      setup() {
        instance = getCurrentInstance()
        return () => null
      },
    }
    Comp.components.ToggleButton = Comp
    render(h(Comp), nodeOps.createElement('div'))

    expect(formatComponentName(instance, Comp)).toBe('ToggleButton')
  })

  // 测试场景：父母的名字。
  test('name from parent', () => {
    let instance: ComponentInternalInstance | null = null
    const Comp = {
      setup() {
        instance = getCurrentInstance()
        return () => null
      },
    }
    const Parent = {
      components: {
        list_item: Comp,
      },
      render() {
        return h(Comp)
      },
    }
    render(h(Parent), nodeOps.createElement('div'))

    expect(formatComponentName(instance, Comp)).toBe('ListItem')
  })

  // 测试场景：创建并执行函数式组件实例。
  test('functional components', () => {
    const UserAvatar = () => null
    expect(formatComponentName(null, UserAvatar)).toBe('UserAvatar')
    UserAvatar.displayName = 'UserPicture'
    expect(formatComponentName(null, UserAvatar)).toBe('UserPicture')
    expect(formatComponentName(null, () => null)).toBe('Anonymous')
  })

  // 测试场景：Name 来自文件。
  test('Name from file', () => {
    const Comp = {
      __file: './src/locale-dropdown.vue',
    }

    expect(formatComponentName(null, Comp)).toBe('LocaleDropdown')
  })

  // 测试场景：推断名称。
  test('inferred name', () => {
    const Comp = {
      __name: 'MainSidebar',
    }

    expect(formatComponentName(null, Comp)).toBe('MainSidebar')
  })

  // 测试场景：全局组件。
  test('global component', () => {
    let instance: ComponentInternalInstance | null = null
    const Comp = {
      setup() {
        instance = getCurrentInstance()
        return () => null
      },
    }
    render(h(Comp), nodeOps.createElement('div'))

    instance!.appContext.components.FieldLabel = Comp

    expect(formatComponentName(instance, Comp)).toBe('FieldLabel')
  })

  // 测试场景：名称优先级。
  test('name precedence', () => {
    let instance: ComponentInternalInstance | null = null
    const Dummy = () => null
    const Comp: Record<string, any> = {
      components: { Dummy },
      setup() {
        instance = getCurrentInstance()
        return () => null
      },
    }
    const Parent = {
      components: { Dummy } as any,
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
