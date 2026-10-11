import { h, nodeOps, render } from '@vue/runtime-test'
import { useCssModule } from '../../src/helpers/useCssModule'

// 测试组：在最小组件setup中读__cssModules，再比较返回对象；另在缺少实例、模块或指定名字时检查开发期警告。
describe('useCssModule', () => {
  /** 把传入modules挂到组件__cssModules，在setup调用useCssModule(name)保存结果；挂载无内容fixture后返回选中的CSS模块对象。 */
  function mountWithModule(modules: any, name?: string) {
    let res
    render(
      h({
        /** 提供空根组件，不返回VNode。 */
        render() {},
        __cssModules: modules,
        /** 执行res=useCssModule(name)；useCssModule(name)。setup不返回渲染或公开状态。 */
        setup() {
          res = useCssModule(name)
        },
      }),
      nodeOps.createElement('div'),
    )
    return res
  }

  /** 测试场景：fixture向组件注入$style映射，setup调用默认useCssModule，返回同内容类名表。 */
  test('basic usage', () => {
    const modules = {
      $style: {
        red: 'red',
      },
    }
    expect(mountWithModule(modules)).toMatchObject(modules.$style)
  })

  /** 测试场景：fixture注入foo命名模块，useCssModule(foo)返回其类名表，核对指定模块选择。 */
  test('basic usage', () => {
    const modules = {
      foo: {
        red: 'red',
      },
    }
    expect(mountWithModule(modules, 'foo')).toMatchObject(modules.foo)
  })

  /** 测试场景：无组件setup上下文调用useCssModule，断言对应开发警告，核对无instance分支。 */
  test('warn out of setup usage', () => {
    useCssModule()
    expect('must be called inside setup').toHaveBeenWarned()
  })

  /** 测试场景：组件未注入__cssModules，在setup调用时警告缺少模块，核对定义注入检查。 */
  test('warn missing injection', () => {
    mountWithModule(undefined)
    expect('instance does not have CSS modules').toHaveBeenWarned()
  })

  /** 测试场景：只注入$style却请求foo，断言foo缺失警告，核对命名模块查找失败。 */
  test('warn missing injection', () => {
    mountWithModule({ $style: { red: 'red' } }, 'foo')
    expect('instance does not have CSS module named "foo"').toHaveBeenWarned()
  })
})
