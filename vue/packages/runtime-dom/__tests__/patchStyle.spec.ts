/**
 * 测试阅读说明：本文件验证 `runtime-dom/patchStyle` 的运行时行为。
 * “测试组”概括共享前置条件，“测试场景”说明当前输入、边界或历史回归目标；具体预期以断言为准。
 */
import { patchProp } from '../src/patchProp'

// 测试组：runtime-dom：样式修补。
describe(`runtime-dom: style patching`, () => {
  // 测试场景：字符串 cssText 能整体设置、替换并清空元素样式。
  it('string', () => {
    const el = document.createElement('div')
    patchProp(el, 'style', {}, 'color:red')
    expect(el.style.cssText.replace(/\s/g, '')).toBe('color:red;')
  })

  // #1309
  // 测试场景：不应修补相同的字符串样式。
  it('should not patch same string style', () => {
    const el = document.createElement('div')
    const fn = vi.fn()
    const value = (el.style.cssText = 'color:red;')
    Object.defineProperty(el.style, 'cssText', {
      get(): any {
        return value
      },
      set: fn,
    })
    patchProp(el, 'style', value, value)
    expect(el.style.cssText.replace(/\s/g, '')).toBe('color:red;')
    expect(fn).not.toBeCalled()
  })

  // 测试场景：以普通对象形式设置、更新和移除 style。
  it('plain object', () => {
    const el = document.createElement('div')
    patchProp(el, 'style', {}, { color: 'red' })
    expect(el.style.cssText.replace(/\s/g, '')).toBe('color:red;')
  })

  // 测试场景：应保留文本区域调整大小尺寸，同时重新应用不相关的未更改对象样式。
  it('should preserve textarea resize dimensions while reapplying unrelated unchanged object styles', () => {
    const el = document.createElement('textarea')
    const value = {
      width: '200px',
      height: '100px',
      display: 'none',
    }

    patchProp(el, 'style', null, value)
    el.style.width = '320px'
    el.style.height = '160px'
    el.style.display = 'block'

    patchProp(el, 'style', value, value)
    expect(el.style.width).toBe('320px')
    expect(el.style.height).toBe('160px')
    expect(el.style.display).toBe('none')
  })

  // 测试场景：camelCase 样式名转换成浏览器可识别的 CSS property 并正确更新。
  it('camelCase', () => {
    const el = document.createElement('div')
    patchProp(el, 'style', {}, { marginRight: '10px' })
    expect(el.style.cssText.replace(/\s/g, '')).toBe('margin-right:10px;')
  })

  // 测试场景：如果值是假则删除。
  it('remove if falsy value', () => {
    const el = document.createElement('div')
    patchProp(el, 'style', null, {
      color: undefined,
      borderRadius: null,
    })
    expect(el.style.cssText.replace(/\s/g, '')).toBe('')

    patchProp(
      el,
      'style',
      { color: 'red' },
      { color: null, borderRadius: undefined },
    )
    expect(el.style.cssText.replace(/\s/g, '')).toBe('')
  })

  // 测试场景：带 !important 的值通过 setProperty 写入并保留优先级。
  it('!important', () => {
    const el = document.createElement('div')
    patchProp(el, 'style', {}, { color: 'red !important' })
    expect(el.style.cssText.replace(/\s/g, '')).toBe('color:red!important;')
  })

  // 测试场景：camelCase 属性名和 !important 同时出现时正确转换并写入。
  it('camelCase with !important', () => {
    const el = document.createElement('div')
    patchProp(el, 'style', {}, { marginRight: '10px !important' })
    expect(el.style.cssText.replace(/\s/g, '')).toBe(
      'margin-right:10px!important;',
    )
  })

  // 测试场景：具有多个条目的对象。
  it('object with multiple entries', () => {
    const el = document.createElement('div')
    patchProp(el, 'style', {}, { color: 'red', marginRight: '10px' })
    expect(el.style.getPropertyValue('color')).toBe('red')
    expect(el.style.getPropertyValue('margin-right')).toBe('10px')
  })

  // 测试场景：style 值为 falsey 值时正确清除旧声明。
  it('patch with falsy style value', () => {
    const el = document.createElement('div')
    patchProp(el as any, 'style', { width: '100px' }, { width: 0 })
    expect(el.style.width).toBe('0px')
  })

  // 测试场景：应该删除虚假值上的样式属性。
  it('should remove style attribute on falsy value', () => {
    const el = document.createElement('div')
    el.style.cssText = 'color: red;'
    patchProp(el as any, 'style', {}, null)
    expect(el.hasAttribute('style')).toBe(false)
    expect(el.style.cssText).toBe('')
  })

  // 测试场景：应对尾随分号发出警告。
  it('should warn for trailing semicolons', () => {
    const el = document.createElement('div')
    patchProp(el, 'style', null, { color: 'red;' })
    expect(
      `Unexpected semicolon at the end of 'color' style value: 'red;'`,
    ).toHaveBeenWarned()

    patchProp(el, 'style', null, { '--custom': '100; ' })
    expect(
      `Unexpected semicolon at the end of '--custom' style value: '100; '`,
    ).toHaveBeenWarned()
  })

  // 测试场景：不应警告转义的尾随分号。
  it('should not warn for escaped trailing semicolons', () => {
    const el = document.createElement('div')
    patchProp(el, 'style', null, { '--custom': '100\\;' })
    expect(el.style.getPropertyValue('--custom')).toBe('100\\;')
  })

  // 测试场景：简写属性。
  it('shorthand properties', () => {
    const el = document.createElement('div')
    patchProp(
      el as any,
      'style',
      { borderBottom: '1px solid red' },
      { border: '1px solid green' },
    )
    expect(el.style.border).toBe('1px solid green')
    expect(el.style.borderBottom).toBe('1px solid green')
  })

  // JSDOM doesn't support custom properties on style object so we have to
  // mock it here.
  function mockElementWithStyle() {
    const store: any = {}
    return {
      style: {
        display: '',
        WebkitTransition: '',
        setProperty(key: string, val: string) {
          store[key] = val
        },
        getPropertyValue(key: string) {
          return store[key]
        },
      },
    }
  }

  // 测试场景：CSS 自定义属性。
  it('CSS custom properties', () => {
    const el = mockElementWithStyle()
    patchProp(el as any, 'style', {}, { '--theme': 'red' } as any)
    expect(el.style.getPropertyValue('--theme')).toBe('red')
  })

  // 测试场景：自动供应商前缀。
  it('auto vendor prefixing', () => {
    const el = mockElementWithStyle()
    patchProp(el as any, 'style', {}, { transition: 'all 1s' })
    expect(el.style.WebkitTransition).toBe('all 1s')
  })

  // 测试场景：同一 CSS property 接收值数组时依次设置浏览器回退值。
  it('multiple values', () => {
    const el = mockElementWithStyle()
    patchProp(
      el as any,
      'style',
      {},
      { display: ['-webkit-box', '-ms-flexbox', 'flex'] },
    )
    expect(el.style.display).toBe('flex')
  })

  // 测试场景：应该清除之前的CSS字符串值。
  it('should clear previous css string value', () => {
    const el = document.createElement('div')
    patchProp(el, 'style', {}, 'color:red')
    expect(el.style.cssText.replace(/\s/g, '')).toBe('color:red;')

    patchProp(el, 'style', 'color:red', { fontSize: '12px' })
    expect(el.style.cssText.replace(/\s/g, '')).toBe('font-size:12px;')
  })
})
