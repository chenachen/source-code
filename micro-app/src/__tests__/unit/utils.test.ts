/* eslint-disable promise/param-names */
import * as Utils from '../../libs/utils'
import {
  rewriteConsole,
  releaseConsole,
  jestConsoleError,
  jestConsoleWarn,
} from '../common/initial'

/** 当前默认 Jest testMatch 纳入本文件。 */
describe('utils', () => {
  beforeAll(() => {
    rewriteConsole()
  })

  afterAll(() => {
    releaseConsole()
  })

  /**
   * 分别向 error/warn 传字符串和 Error 对象加应用名、额外参数，立即检查 console mock。
   * 字符串应拼入框架前缀，对象保持独立参数并附应用上下文，验证两种日志形态而不丢失错误对象。
   */
  test('utils ==> logError & logWarn', () => {
    Utils.logError('msg')
    expect(jestConsoleError).toHaveBeenLastCalledWith('[micro-app] msg')
    Utils.logError(new Error('123'), 'appName', 111)
    expect(jestConsoleError).toHaveBeenLastCalledWith('[micro-app] app appName:', expect.any(Error), 111)

    Utils.logWarn('msg')
    expect(jestConsoleWarn).toHaveBeenLastCalledWith('[micro-app] msg')
    Utils.logWarn(new Error('123'), 'appName', 111)
    expect(jestConsoleWarn).toHaveBeenLastCalledWith('[micro-app] app appName:', expect.any(Error), 111)
  })

  /**
   * 先登记 defer(mock)，再安排 Promise 微任务做断言；按入队顺序 mock 应先运行。验证 defer 的任务边界；
   * 本用例未返回该 Promise 给 Jest，测试完成不包含断言微任务。
   */
  test('call function in micro task', () => {
    const mockFn = jest.fn()
    Utils.defer(mockFn)
    Promise.resolve().then(() => {
      expect(mockFn).toHaveBeenCalled()
    })
  })

  /**
   * 依次传无尾斜杠 URL、协议相对 URL、HTML 文件、空值、错误协议和相对 abc，核对规范化结果。
   * 当前保留 /path-a 原路径且用宿主 href 解析 abc，旧补斜杠/拒相对值的断言不成立；
   * htt 协议可返回空串而不必触发解析异常日志。
   */
  test('utils ==> formatAppURL', () => {
    expect(Utils.formatAppURL('http://localhost:3000/path-a')).toBe('http://localhost:3000/path-a/')
    expect(Utils.formatAppURL('//localhost:3000/path-a/')).toBe('http://localhost:3000/path-a/')
    expect(Utils.formatAppURL('http://localhost:3000/path-a/index.html')).toBe('http://localhost:3000/path-a/index.html')
    expect(Utils.formatAppURL(null)).toBe('')
    expect(Utils.formatAppURL('')).toBe('')
    expect(Utils.formatAppURL('htt://abc')).toBe('')
    expect(Utils.formatAppURL('abc')).toBe('')
    expect(jestConsoleError).toBeCalledWith('[micro-app]', expect.anything())
  })

  /**
   * 传 html/node/php 文件地址、裸 origin 以及含 query/hash 的目录 URL。
   * 应得到去文件和查询片段后的 http://abc/，验证末段含点的目录启发式与根目录归一化。
   */
  test('utils ==> getEffectivePath', () => {
    expect(Utils.getEffectivePath('http://abc/index.html')).toBe('http://abc/')
    expect(Utils.getEffectivePath('http://abc/index.node')).toBe('http://abc/')
    expect(Utils.getEffectivePath('http://abc/index.php')).toBe('http://abc/')
    expect(Utils.getEffectivePath('http://abc')).toBe('http://abc/')
    expect(Utils.getEffectivePath('http://abc/?a=1#page1')).toBe('http://abc/')
  })

  /**
   * 用不同 origin 的绝对图地址及根路径 /img.png 调用补址。绝对地址应原样返回，
   * 根路径沿用给定基址 origin 而丢弃 /path/，验证两条解析分支。
   */
  test('utils ==> CompletionPath', () => {
    expect(Utils.CompletionPath('http://abc/img.png', 'http://localhost:3000/')).toBe('http://abc/img.png')
    expect(Utils.CompletionPath('/img.png', 'http://localhost:3000/path/')).toBe('http://localhost:3000/img.png')
  })

  /**
   * 输入一个带目录和 CSS 文件名的 https 地址。应去最后一个 / 分段并保留尾斜杠，得到 path/css/，
   * 验证外链 CSS 目录提取。
   */
  test('utils ==> getLinkFileDir', () => {
    expect(Utils.getLinkFileDir('https://localhost:3000/path/css/filename.css')).toBe('https://localhost:3000/path/css/')
  })

  /**
   * 登记 200ms 成功、100ms 成功、300ms 拒绝和一个普通值，先查普通值，再按计时窗口观察回调。
   * 普通值同步以 index=3 通知；Promise 以结算顺序通知但保留原索引，350ms 末段核对拒绝与汇总回调，
   * 验证顺序和完成计数。
   */
  test('utils ==> promiseStream', async () => {
    const successFn = jest.fn()
    const errorFn = jest.fn()
    const finallyCb = jest.fn()
    const promiseList: Array<Promise<string> | string> = []
    promiseList.push(new Promise((resolve) => {
      setTimeout(() => {
        resolve('1')
      }, 200)
    }))

    promiseList.push(new Promise((resolve) => {
      setTimeout(() => {
        resolve('2')
      }, 100)
    }))

    const e = new Error('3')
    promiseList.push(new Promise((_, reject) => {
      setTimeout(() => {
        reject(e)
      }, 300)
    }))

    promiseList.push('4')

    Utils.promiseStream<string>(promiseList, successFn, errorFn, finallyCb)
    expect(successFn).toHaveBeenCalledWith({ data: '4', index: 3 })
    setTimeout(() => {
      expect(successFn).toHaveBeenCalledWith({ data: '2', index: 1 })
    }, 150)
    setTimeout(() => {
      expect(successFn).toHaveBeenCalledWith({ data: '1', index: 0 })
    }, 250)

    await new Promise((resolve) => {
      setTimeout(() => {
        expect(errorFn).toHaveBeenCalledWith({ error: e, index: 2 })
        expect(finallyCb).toHaveBeenCalled()
        resolve(true)
      }, 350)
    })
  })

  /**
   * 在未安装 support_module 桩的 JSDOM 中调用能力检测。script 缺 noModule 属性，
   * 应返回 false；验证当前测试环境的特性，不是所有浏览器均不支持 module。
   */
  test('check if browser support module script', () => {
    expect(Utils.isSupportModuleScript()).toBeFalsy()
  })

  /**
   * 调用 createNonceSrc 并检查这一次结果长度不等于 21。目标是执行随机内联键生成路径；
   * 单个长度否定断言不验证唯一性、固定长度或随机分布。
   */
  test('create random string', () => {
    expect(Utils.createNonceSrc()).not.toHaveLength(21)
  })

  /**
   * 输入含重复数字的数组并把去重结果拼为字符串。应保留首次出现顺序得到 12345，验证数字属性键去重；
   * 没有覆盖不同类型映射到相同键的情况。
   */
  test('the fastest remove array duplication method', () => {
    expect(Utils.unique([1, 2, 2, 3, 4, 3, 5]).join('')).toBe('12345')
  })

  /**
   * 调用导入 utils 时选定的 requestIdleCallback，先断言尚未调用，等 100ms 后确认触发；
   * 再把 window 属性设为 undefined 并重复。实现不会重新选择，
   * 回调参数应 didTimeout=false 且剩余预算小于 51，验证异步与回退预算形态。
   */
  test('polyfill for requestIdleCallback', async () => {
    // 调用已在模块初始化时选定的实现。
    const mockFn = jest.fn()
    Utils.requestIdleCallback(mockFn)
    expect(mockFn).not.toBeCalled()
    await new Promise((resolve) => {
      setTimeout(() => {
        expect(mockFn).toBeCalled()
        resolve(true)
      }, 100)
    })

    Object.defineProperty(window, 'requestIdleCallback', {
      value: undefined,
      writable: true,
      configurable: true,
    })

    // 仍调用先前选定的实现，随后断言其回调参数。
    const mockFn2 = jest.fn()
    Utils.requestIdleCallback((param: any) => {
      mockFn2()
      expect(param.didTimeout).toBeFalsy()
      expect(param.timeRemaining()).toBeLessThan(51)
    })
    expect(mockFn2).not.toBeCalled()
    await new Promise((resolve) => {
      setTimeout(() => {
        expect(mockFn2).toBeCalled()
        resolve(true)
      }, 100)
    })
  })

  /**
   * 先写当前应用名再读取，随后 removeDomScope 并再次读取。应先返回 appName 后变成 null，
   * 验证动态 DOM 归属的同步作用域寄存状态。
   */
  test('mark the active appName', () => {
    Utils.setCurrentAppName('appName')
    expect(Utils.getCurrentAppName()).toBe('appName')
    Utils.removeDomScope()
    expect(Utils.getCurrentAppName()).toBe(null)
  })

  /**
   * 先在默认 JSDOM UA 检测 Safari，再替换为 Safari UA 重测。结果应从 false 变 true，
   * 验证每次调用读取当前 UA；本例没有恢复 UA。
   */
  test('get result whether in safari', () => {
    expect(Utils.isSafari()).toBeFalsy()

    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.1 Safari/605.1.15',
      writable: true,
      configurable: true,
    })

    expect(Utils.isSafari()).toBeTruthy()
  })

  /**
   * 仅传一个箭头函数给 isFunction。应返回 true，验证 typeof=function 的正例，没有非函数反例。
   */
  test('get result whether target is function', () => {
    expect(Utils.isFunction(() => {})).toBeTruthy()
  })

  /**
   * 在全局 DOM 补丁可能存在时用 pureCreateElement 创建 div，查看应用名字段。
   * 应没有 __MICRO_APP_NAME__，验证绕过当前应用归属标记；没有检查返回节点的全部属性。
   */
  test('get element that not marked by micro-app', () => {
    // @ts-ignore
    expect(Utils.pureCreateElement('div').__MICRO_APP_NAME__).toBeUndefined()
  })

  /**
   * 把 null 传给 isNull。应返回 true，验证严格 null 判断的正例，没有 undefined 等反例。
   */
  test('coverage of isNull function', () => {
    expect(Utils.isNull(null)).toBeTruthy()
  })

  /**
   * 先设置测试标记为 false，传含 & 的 a&bc，再恢复 true。输入在测试和生产正则中都非法，应返回 true；
   * 该相同结果不能证明已切到另一编译分支。
   */
  test('coverage of isInvalidQuerySelectorKey', () => {
    // @ts-ignore
    window.__TEST__ = false
    expect(Utils.isInvalidQuerySelectorKey('a&bc')).toBeTruthy()
    // @ts-ignore
    window.__TEST__ = true
  })

  /**
   * 分别传 null 和空字符串给 formatAppName。应都返回空字符串，验证假值短路；没有覆盖正常名称清洗及数字前缀顺序。
   */
  test('coverage of formatAppName', () => {
    expect(Utils.formatAppName(null)).toBe('')
    expect(Utils.formatAppName('')).toBe('')
  })

  /**
   * 通过 ts-ignore 省略 trim 的字符串参数。假值兼容分支应返回空字符串，验证超出静态签名的运行时输入容错。
   */
  test('coverage of trim', () => {
    // @ts-ignore
    expect(Utils.trim()).toBe('')
  })
})
