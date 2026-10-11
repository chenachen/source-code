import { patchProp } from '../src/patchProp'

// 测试组：向真实元素写cssText或对象样式，并用最小style对象模拟CSS变量接口；比较移除、优先级、前缀、用户resize与v-show协作。
describe(`runtime-dom: style patching`, () => {
  /** 测试场景：div 从空对象样式改 cssText=color:red，断言规范化文本为color:red;，核对字符串整体赋值。 */
  it('string', () => {
    const el = document.createElement('div')
    patchProp(el, 'style', {}, 'color:red')
    expect(el.style.cssText.replace(/\s/g, '')).toBe('color:red;')
  })

  // #1309
  /** 测试场景：已写 cssText=color:red，监控 setter后以相同字符串patch；样式保留且setter未调用，核对相等值短路。 */
  it('should not patch same string style', () => {
    const el = document.createElement('div')
    const fn = vi.fn()
    const value = (el.style.cssText = 'color:red;')
    Object.defineProperty(el.style, 'cssText', {
      /** 返回fixture预存的cssText字符串value；与set spy配对，检查同一字符串补丁没有再次写入cssText。 */
      get(): any {
        return value
      },
      set: fn,
    })
    patchProp(el, 'style', value, value)
    expect(el.style.cssText.replace(/\s/g, '')).toBe('color:red;')
    expect(fn).not.toBeCalled()
  })

  /** 测试场景：div以style对象color:red更新，断言CSS文本，核对逐属性写入。 */
  it('plain object', () => {
    const el = document.createElement('div')
    patchProp(el, 'style', {}, { color: 'red' })
    expect(el.style.cssText.replace(/\s/g, '')).toBe('color:red;')
  })

  /** 测试场景：textarea原声明200×100且display:none，模拟用户改320×160和display:block；相同对象重patch保留尺寸但恢复none，核对resize特判仅宽高。 */
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

  /** 测试场景：marginRight对象属性写10px，CSS文本为margin-right，核对camelCase property。 */
  it('camelCase', () => {
    const el = document.createElement('div')
    patchProp(el, 'style', {}, { marginRight: '10px' })
    expect(el.style.cssText.replace(/\s/g, '')).toBe('margin-right:10px;')
  })

  /** 测试场景：新对象含null/undefined不写声明，旧color:red改null后清空；核对缺失/空值清理。 */
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

  /** 测试场景：color:red !important写入后保留priority，核对setProperty第三参数。 */
  it('!important', () => {
    const el = document.createElement('div')
    patchProp(el, 'style', {}, { color: 'red !important' })
    expect(el.style.cssText.replace(/\s/g, '')).toBe('color:red!important;')
  })

  /** 测试场景：marginRight与!important同时设置，断言连字符属性及优先级，核对两种转换协作。 */
  it('camelCase with !important', () => {
    const el = document.createElement('div')
    patchProp(el, 'style', {}, { marginRight: '10px !important' })
    expect(el.style.cssText.replace(/\s/g, '')).toBe(
      'margin-right:10px!important;',
    )
  })

  /** 测试场景：同style对象含color和marginRight，分别读取red和10px，核对多键独立写入。 */
  it('object with multiple entries', () => {
    const el = document.createElement('div')
    patchProp(el, 'style', {}, { color: 'red', marginRight: '10px' })
    expect(el.style.getPropertyValue('color')).toBe('red')
    expect(el.style.getPropertyValue('margin-right')).toBe('10px')
  })

  /** 测试场景：width从100px改数值0，DOM宽度为0px；有效0不能当整体空style。 */
  it('patch with falsy style value', () => {
    const el = document.createElement('div')
    patchProp(el as any, 'style', { width: '100px' }, { width: 0 })
    expect(el.style.width).toBe('0px')
  })

  /** 测试场景：元素已有style，整体next=null后attribute删除且cssText清空；核对整个样式移除。 */
  it('should remove style attribute on falsy value', () => {
    const el = document.createElement('div')
    el.style.cssText = 'color: red;'
    patchProp(el as any, 'style', {}, null)
    expect(el.hasAttribute('style')).toBe(false)
    expect(el.style.cssText).toBe('')
  })

  /** 测试场景：color和CSS变量值带未转义尾分号，分别发开发告警；核对值末分隔符诊断。 */
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

  /** 测试场景：CSS变量值末尾使用转义分号，保留原值；本例断言写入值，不声称已额外断言警告次数。 */
  it('should not warn for escaped trailing semicolons', () => {
    const el = document.createElement('div')
    patchProp(el, 'style', null, { '--custom': '100\\;' })
    expect(el.style.getPropertyValue('--custom')).toBe('100\\;')
  })

  /** 测试场景：旧borderBottom:red改新border:green，简写同时覆盖底边；核对先清旧键再写新简写的顺序。 */
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

  // 用最小 style fixture 保存自定义属性，
  // 直接核对 patchStyle 的变量写入结果。
  /** 构造含display/WebkitTransition及自定义属性读写方法的最小style对象；内部store记录CSS变量，供补丁测试比较结果。 */
  function mockElementWithStyle() {
    const store: any = {}
    return {
      style: {
        display: '',
        WebkitTransition: '',
        /** 按CSS属性名key保存val到fixture store，模拟style.setProperty的可观察写入。 */
        setProperty(key: string, val: string) {
          store[key] = val
        },
        /** 按key返回fixture store中保存的CSS值，供变量补丁断言读取。 */
        getPropertyValue(key: string) {
          return store[key]
        },
      },
    }
  }

  /** 测试场景：模拟style对象写--theme:red，以getPropertyValue读回，核对CSS变量保留原名。 */
  it('CSS custom properties', () => {
    const el = mockElementWithStyle()
    patchProp(el as any, 'style', {}, { '--theme': 'red' } as any)
    expect(el.style.getPropertyValue('--theme')).toBe('red')
  })

  /** 测试场景：模拟浏览器仅支持WebkitTransition，写transition后落在该property；核对前缀探测。 */
  it('auto vendor prefixing', () => {
    const el = mockElementWithStyle()
    patchProp(el as any, 'style', {}, { transition: 'all 1s' })
    expect(el.style.WebkitTransition).toBe('all 1s')
  })

  /** 测试场景：display传回退值数组-webkit-box/-ms-flexbox/flex，模拟style最终为flex；核对按顺序赋值。 */
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

  /** 测试场景：旧cssText=color:red改fontSize对象，新文本只有font-size:12px；核对字符串旧样式按键清理。 */
  it('should clear previous css string value', () => {
    const el = document.createElement('div')
    patchProp(el, 'style', {}, 'color:red')
    expect(el.style.cssText.replace(/\s/g, '')).toBe('color:red;')

    patchProp(el, 'style', 'color:red', { fontSize: '12px' })
    expect(el.style.cssText.replace(/\s/g, '')).toBe('font-size:12px;')
  })
})
