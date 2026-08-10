/**
 * 测试阅读说明：本文件验证 `runtime-dom/helpers/useCssModule` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import { h, nodeOps, render } from '@vue/runtime-test'
import { useCssModule } from '../../src/helpers/useCssModule'

// 测试组：useCssModule 的模块读取行为，以及缺少上下文时的开发期警告。
describe('useCssModule', () => {
  function mountWithModule(modules: any, name?: string) {
    let res
    render(
      h({
        render() {},
        __cssModules: modules,
        setup() {
          res = useCssModule(name)
        },
      }),
      nodeOps.createElement('div'),
    )
    return res
  }

  // 测试场景：基本用法。
  test('basic usage', () => {
    const modules = {
      $style: {
        red: 'red',
      },
    }
    expect(mountWithModule(modules)).toMatchObject(modules.$style)
  })

  // 测试场景：基本用法。
  test('basic usage', () => {
    const modules = {
      foo: {
        red: 'red',
      },
    }
    expect(mountWithModule(modules, 'foo')).toMatchObject(modules.foo)
  })

  // 测试场景：警告 setup 使用情况。
  test('warn out of setup usage', () => {
    useCssModule()
    expect('must be called inside setup').toHaveBeenWarned()
  })

  // 测试场景：警告缺少注射。
  test('warn missing injection', () => {
    mountWithModule(undefined)
    expect('instance does not have CSS modules').toHaveBeenWarned()
  })

  // 测试场景：警告缺少注射。
  test('warn missing injection', () => {
    mountWithModule({ $style: { red: 'red' } }, 'foo')
    expect('instance does not have CSS module named "foo"').toHaveBeenWarned()
  })
})
