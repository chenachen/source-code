/* eslint-disable promise/param-names */
import { commonStartEffect, releaseAllEffect, ports } from '../common/initial'
import microApp from '../..'
import Sandbox from '../../sandbox'

/**
 * 保留的旧版 Sandbox 代理用例，当前 jest.config.js 未把本文件列入 testMatch。
 * rc.32 已拆为 with/index.ts 与 iframe/index.ts，不再提供这里导入的 ../../sandbox 入口，
 * start/stop 也改用对象参数。下列断言描述旧接口场景，阅读当前实现时以对应 Proxy 陷阱为准。
 */
declare global {
  /** 沙箱代理陷阱测试使用的宿主 window 扩展字段。 */
  interface Window {
    /** 应逃逸到宿主 window 的测试属性。 */
    escapeProperty1: string
    /** 第二个逃逸属性，覆盖插件合并分支。 */
    escapeProperty2: string
    /** 第三个逃逸属性，覆盖动态配置分支。 */
    escapeProperty3: string
    /** 模拟需要从宿主读取的 SystemJS 全局。 */
    System: string
    /** 验证同名键在 rawWindow 与 microAppWindow 间的优先级。 */
    'same-key': string
    /** 模拟 React error overlay 的逃逸全局。 */
    '__REACT_ERROR_OVERLAY_GLOBAL_HOOK__': string
    /** 代理 getter/descriptor 测试字段。 */
    key1: string
    /** 代理键枚举与删除测试字段。 */
    key2: string
    /** 代理写入隔离测试字段。 */
    key3: string
    /** 验证 Babel polyfill 标志在沙箱启动时的兼容值。 */
    _babelPolyfill: boolean
    /** 保存原生 bind 产物，验证代理不会重复绑定。 */
    boundFunction: any
  }
}

describe('sandbox', () => {
  // let appCon: Element
  /**
   * 启动本套件资源服务与框架单例；全局/应用插件分别提供 scope、escape 键，再混入非法条目覆盖过滤。
   * 各用例共享宿主 window 和插件配置，没有 afterEach 还原前面定义的属性，后续断言依赖这一累积环境。
   */
  beforeAll(() => {
    commonStartEffect(ports.sandbox)
    // appCon = document.querySelector('#app-container')!

    microApp.start({
      plugins: {
        global: [
          {
            scopeProperties: ['scopeProperty1', 'scopeProperty2', 'same-key'],
            escapeProperties: ['escapeProperty1', 'escapeProperty2', 'same-key'],
          },
          {
            scopeProperties: 'invalid scopeProperties',
            escapeProperties: 'invalid escapeProperties'
          },
          'invalid plugin' as any,
        ],
        modules: {
          'test-app-scopeProperties': [
            {
              scopeProperties: ['scopeProperty3'],
            },
            {
              scopeProperties: 'invalid scopeProperties',
              escapeProperties: 'invalid escapeProperties'
            },
            'invalid plugin' as any,
          ],
          'test-app-escapeProperties': [
            {
              escapeProperties: ['escapeProperty3'],
            },
            {
              scopeProperties: 'invalid scopeProperties',
              escapeProperties: 'invalid escapeProperties'
            },
            'invalid plugin' as any,
          ],
          'test-app1': 'invalid-module' as any,
        }
      },
    })
  })

  afterAll(() => {
    return releaseAllEffect()
  })

  /**
   * 宿主初始位于顶层时构造代理，读取 window/self/globalThis/top/parent。
   * 五个引用都应回到同一代理，验证全局别名不会让子应用绕过窗口隔离。
   */
  test('which keys should return proxyWindow in sandbox', () => {
    const proxyWindow = new Sandbox('test-app2', `http://127.0.0.1:${ports.sandbox}/common/`, true).proxyWindow
    expect(proxyWindow.window).toBe(proxyWindow)
    expect(proxyWindow.self).toBe(proxyWindow)
    // @ts-ignore
    expect(proxyWindow.globalThis).toBe(proxyWindow)
    expect(proxyWindow.top).toBe(proxyWindow)
    expect(proxyWindow.parent).toBe(proxyWindow)
  })

  /**
   * 将宿主 top/parent 改为不同值，再构造代理模拟基座本身嵌在 iframe 的分支。
   * 断言读取 1/2，验证该分支保留宿主上层窗口视图；输入是属性替身，没有创建真实外层 iframe。
   */
  test('top and parent is different when base app in iframe', () => {
    Object.defineProperties(window, {
      top: {
        value: 1,
      },
      parent: {
        value: 2,
      }
    })
    const proxyWindow = new Sandbox('test-app3', `http://127.0.0.1:${ports.sandbox}/common/`, true).proxyWindow
    expect(proxyWindow.top).toBe(1)
    expect(proxyWindow.parent).toBe(2)
  })

  /**
   * 插件已把三个键列入作用域隔离；启动沙箱后在宿主定义这些键及普通不可配置键。
   * 先读取隔离键应不可见，再赋值应留在代理且可配置；普通宿主键复制后仍继承不可配置边界。
   * 这两组断言共同检查 scope 优先级和宿主描述符复制，而不只是写入值相同。
   */
  test('scopeProperties should prevent key in rawWidow', () => {
    const sandbox = new Sandbox('test-app-scopeProperties', `http://127.0.0.1:${ports.sandbox}/common/`, true)

    sandbox.start()

    const proxyWindow: any = sandbox.proxyWindow

    // 原window上自带变量
    Object.defineProperties(window, {
      scopeProperty1: {
        value: 1,
        configurable: false,
        enumerable: true,
        writable: true,
      },
      scopeProperty2: {
        value: 2,
      },
      scopeProperty3: {
        value: 3,
      },
      notScopedProperty: {
        value: 4,
        configurable: false,
        enumerable: true,
        writable: true,
      }
    })

    Object.defineProperty(window, 'qqqqqqqqqq', {
      value: 11,
      configurable: false,
      enumerable: true,
      writable: true,
    })

    // 未注入的 scope 键不能因宿主已有同名属性而回退可见。
    expect(proxyWindow.scopeProperty1).toBeUndefined()
    expect(proxyWindow.scopeProperty2).toBeUndefined()
    expect(proxyWindow.scopeProperty3).toBeUndefined()

    // scope 键新建隔离自有描述符；普通键则复制宿主描述符，比较两条写入路径的 configurable。
    proxyWindow.scopeProperty1 = 'scopeProperty1-value'
    expect(proxyWindow.scopeProperty1).toBe('scopeProperty1-value')
    const proxyScopedPro1Desc = Object.getOwnPropertyDescriptor(proxyWindow, 'scopeProperty1')
    expect(proxyScopedPro1Desc?.configurable).toBeTruthy()

    proxyWindow.notScopedProperty = 'not-ScopedProperty-value'
    proxyWindow.qqqqqqqqqq = 11
    const proxyNotScopedProDesc = Object.getOwnPropertyDescriptor(proxyWindow, 'notScopedProperty')
    expect(proxyNotScopedProDesc?.configurable).toBeFalsy()
  })

  /**
   * 全局/应用插件和内置静态名单同时提供逃逸键；宿主预先拥有 React hook，same-key 同时被列为 scope。
   * 写代理后只三个新逃逸值出现在宿主，scope 冲突和已有静态 hook 保持各自边界。
   * 再普通停止，断言新逃逸记录和值被清空、active 关闭，验证新建宿主值的清理归属。
   */
  test('escapeProperties should escape from microAppWindow to rawWindow', () => {
    const sandbox = new Sandbox('test-app-escapeProperties', `http://127.0.0.1:${ports.sandbox}/common/`, true)
    sandbox.start()
    const proxyWindow: any = sandbox.proxyWindow

    Object.defineProperties(window, {
      __REACT_ERROR_OVERLAY_GLOBAL_HOOK__: {
        value: 'origin-react-hook',
        writable: true,
        configurable: true,
      },
    })

    // 可逃逸属性
    proxyWindow.escapeProperty1 = 'global-plugin-value'
    proxyWindow.System = 'static-value-System'
    proxyWindow.escapeProperty3 = 'module-plugin-value'

    // scope 配置胜过 escape；静态逃逸名单也不能覆盖宿主已有同名 hook。
    proxyWindow['same-key'] = 'scoped has a higher priority than escape'
    // staticEscapeProperties 的优先级比原window属性低
    proxyWindow.__REACT_ERROR_OVERLAY_GLOBAL_HOOK__ = 'static-escape-key has lower priority than rawWindow'

    expect(window.escapeProperty1).toBe('global-plugin-value')
    expect(window.System).toBe('static-value-System')
    expect(window.escapeProperty3).toBe('module-plugin-value')
    expect(window['same-key']).toBeUndefined()
    expect(window.__REACT_ERROR_OVERLAY_GLOBAL_HOOK__).toBe('origin-react-hook')

    // escapeKeys 只登记新建宿主值；停止后记录和这三个宿主值一同消失，不要求删除已有 hook。
    // @ts-ignore
    expect(sandbox.escapeKeys.size).toBe(3)
    // @ts-ignore
    expect(sandbox.active).toBeTruthy()
    sandbox.stop(false, false, true)
    // @ts-ignore
    expect(sandbox.escapeKeys.size).toBe(0)
    // @ts-ignore
    expect(sandbox.active).toBeFalsy()
    expect(window.escapeProperty1).toBeUndefined()
    expect(window.System).toBeUndefined()
    expect(window.escapeProperty3).toBeUndefined()
  })

  /**
   * 通过旧 Sandbox 接口启动后给整个 proxyWindow.location 赋绝对地址。
   * 旧断言要求 microAppWindow.location 仍未定义，以此判断 location 只作用宿主；rc.32 已始终安装
   * 虚拟 location，这个字段存在性不能再充当宿主赋值转发的证据。
   */
  test('escapeSetterKeyList should only acts on rawWindow', () => {
    const sandbox = new Sandbox('test-app-escapeSetterKeyList', `http://127.0.0.1:${ports.sandbox}/common/`)
    sandbox.start()
    const proxyWindow: any = sandbox.proxyWindow

    proxyWindow.location = 'https://www.micro-app-test.com'

    expect(sandbox.microAppWindow.location).toBeUndefined()
  })

  /**
   * 插件已屏蔽宿主 scopeProperty1，启动后仅在代理新增 inlineKey，再用 in 运算查询四类键。
   * location、Math 和新增键应存在，未注入的 scope 键应不存在，验证 has 的合并和屏蔽规则。
   */
  test('proxyWindow combine with rawWindow in has', () => {
    const sandbox = new Sandbox('test-app-has', `http://127.0.0.1:${ports.sandbox}/common/`)
    sandbox.start()
    const proxyWindow: any = sandbox.proxyWindow
    proxyWindow.inlineKey = 'inline-key-value'

    expect('location' in proxyWindow).toBe(true)
    expect('scopeProperty1' in proxyWindow).toBe(false)
    expect('inlineKey' in proxyWindow).toBe(true)
    expect('Math' in proxyWindow).toBe(true)
  })

  /**
   * 代理先有 key1，宿主另有 key2/key3；查询四个描述符后再对 key1/key2/未知键 defineProperty。
   * 断言宿主描述符副本可配置且未知键无描述符，随后 key1 留在代理、已查询的 key2 写回宿主。
   * 目标是证明 descriptor 来源缓存决定 defineProperty 的目标，该路径不会触发普通 set 陷阱。
   */
  test('getOwnPropertyDescriptor and defineProperty', () => {
    const sandbox = new Sandbox('test-app-defineProperty', `http://127.0.0.1:${ports.sandbox}/common/`)
    sandbox.start()
    const proxyWindow: any = sandbox.proxyWindow
    proxyWindow.key1 = 'value1'

    Object.defineProperties(window, {
      key2: {
        value: 'value2',
        configurable: false,
        writable: true,
      },
      key3: { // key3 覆盖分支
        value: 'value3',
        configurable: true,
        writable: true,
        enumerable: true,
      },
    })

    // 查询记录来源；宿主 key2 的不可配置属性以可配置副本返回，key3 覆盖普通宿主描述符分支。
    expect(Object.getOwnPropertyDescriptor(proxyWindow, 'key1')?.configurable).toBeTruthy()
    expect(Object.getOwnPropertyDescriptor(proxyWindow, 'key2')?.configurable).toBeTruthy()
    expect(Object.getOwnPropertyDescriptor(proxyWindow, 'key3')?.configurable).toBeTruthy()
    expect(Object.getOwnPropertyDescriptor(proxyWindow, 'not-exist')).toBeUndefined()

    // 根据前面的来源记录写入：key1 与未知键落目标，key2 落宿主。
    Object.defineProperty(proxyWindow, 'key1', {
      value: 'new-value1'
    })
    Object.defineProperty(proxyWindow, 'key2', {
      value: 'new-value2'
    })
    Object.defineProperty(proxyWindow, 'not-exist', {
      value: 'not-exist-value'
    })

    expect(proxyWindow.key1).toBe('new-value1')
    // Object.defineProperty定义不会触发proxy set钩子
    expect(window.key1).toBeUndefined()
    expect(window.key2).toBe('new-value2')
    // 兜底到原window上
    expect(proxyWindow.key2).toBe('new-value2')
    expect(proxyWindow['not-exist']).toBe('not-exist-value')
  })

  /**
   * 启动后在代理新增 ownKey1，再用 Reflect.ownKeys 读取合并键集合。
   * 断言集合足够大且含业务键，验证目标新增键与宿主能力共同出现在枚举结果；没有逐键检查去重。
   */
  test('ownKeys should get keys from proxyWindow & rawWindow', () => {
    const sandbox = new Sandbox('test-app-ownKeys', `http://127.0.0.1:${ports.sandbox}/common/`)
    sandbox.start()
    const proxyWindow: any = sandbox.proxyWindow
    proxyWindow.ownKey1 = 'ownKey1-value'

    const keys = Reflect.ownKeys(proxyWindow)
    expect(keys.length).toBeGreaterThan(10)
    expect(keys.includes('ownKey1')).toBeTruthy()
  })

  /**
   * 代理分别创建隔离值和新逃逸值，先确认逃逸值已写宿主，再删除两者及一个不存在的键。
   * 最后代理隔离值与宿主逃逸值都不可见，验证删除隔离自有键时同步清理其新宿主镜像。
   */
  test('deleteProperty from proxyWindow', () => {
    const sandbox = new Sandbox('test-app-deleteProperty', `http://127.0.0.1:${ports.sandbox}/common/`)
    sandbox.start()
    const proxyWindow: any = sandbox.proxyWindow
    proxyWindow.deleteProperty1 = 'deleteProperty1-value'
    proxyWindow.escapeProperty1 = 'escapeProperty1-value'

    expect(window.escapeProperty1).toBe('escapeProperty1-value')

    delete proxyWindow.deleteProperty1
    delete proxyWindow.escapeProperty1
    delete proxyWindow.notExist

    expect(proxyWindow.deleteProperty1).toBeUndefined()
    expect(window.escapeProperty1).toBeUndefined()
  })

  /**
   * 启动代理并新增 hasOwnProperty1，调用代理提供的 hasOwnProperty 查询业务键、location 和未知键。
   * 前两者为真、未知键为假，验证自定义方法合并隔离目标与宿主自有属性的存在性。
   */
  test('hasOwnProperty is customized for proxyWindow', () => {
    const sandbox = new Sandbox('test-app-hasOwnProperty', `http://127.0.0.1:${ports.sandbox}/common/`)
    sandbox.start()
    const proxyWindow: any = sandbox.proxyWindow
    proxyWindow.hasOwnProperty1 = 'hasOwnProperty1-value'

    expect(proxyWindow.hasOwnProperty('hasOwnProperty1')).toBeTruthy()
    expect(proxyWindow.hasOwnProperty('location')).toBeTruthy()
    expect(proxyWindow.hasOwnProperty('not-exist')).toBeFalsy()
  })

  /**
   * 旧场景先在未启动代理赋值，期待值不可见；随后连续两次 start 再赋值，期待写入成功，并连续 stop。
   * 它预定检查 active 写入门禁和启停幂等。rc.32 with 的 set 不检查 active，首个不可见断言已不对应
   * 当前实现；当前 active 用于启停计数和 UMD 捕获，重复启停也没有在本用例中断言计数。
   */
  test('active is switch for sandbox', () => {
    const sandbox = new Sandbox('test-app-active', `http://127.0.0.1:${ports.sandbox}/common/`)
    const proxyWindow: any = sandbox.proxyWindow

    proxyWindow.notExecute = 'notExecute-value'
    expect(proxyWindow.notExecute).toBeUndefined()

    sandbox.start()
    sandbox.start() // 多次执行start无效

    proxyWindow.notExecute = 'notExecute-value'
    expect(proxyWindow.notExecute).toBe('notExecute-value')

    sandbox.stop(false, false, true)
    sandbox.stop(false, false, true) // 旧接口下重复 stop 无效。
  })

  /**
   * 宿主先定义可写键与不可写/不可配置键，代理尚无同名自有属性，再通过代理赋新值。
   * 两个代理读取都应是新值，验证首次赋值能够以该值创建隔离描述符；没有断言宿主值或后续重写能力。
   */
  test('priority of use descriptor from rawWindow', () => {
    const sandbox = new Sandbox('test-app-descriptor', `http://127.0.0.1:${ports.sandbox}/common/`)
    sandbox.start()
    const proxyWindow: any = sandbox.proxyWindow

    Object.defineProperties(window, {
      'descriptor-key1': {
        value: 'descriptor-key1',
        configurable: true,
        writable: true,
        enumerable: true,
      },
      'descriptor-key2': {
        value: 'descriptor-key2',
        configurable: false,
        writable: false,
        enumerable: false,
      },
    })

    proxyWindow['descriptor-key1'] = 'new-descriptor-key1'
    proxyWindow['descriptor-key2'] = 'new-descriptor-key2'

    expect(proxyWindow['descriptor-key1']).toBe('new-descriptor-key1')
    // 初次复制描述符时同时给定新 value，因此宿主原描述符 writable=false 不阻止本次目标属性定义。
    expect(proxyWindow['descriptor-key2']).toBe('new-descriptor-key2')
  })

  /**
   * 宿主已有 _babelPolyfill=true，再启动沙箱，断言宿主标志变为假值。
   * 验证启动兼容处理允许子应用再次安装 polyfill；不验证 polyfill 的实际安装过程。
   */
  test('_babelPolyfill should be false', () => {
    const sandbox = new Sandbox('test-app-_babelPolyfill', `http://127.0.0.1:${ports.sandbox}/common/`)
    window._babelPolyfill = true
    sandbox.start()

    expect(window._babelPolyfill).toBeFalsy()
  })

  /**
   * 宿主 window 保存一个已经由原生 bind 生成的函数，通过旧版 Sandbox 的 proxyWindow 读取它。
   * 断言函数名和引用都不变，确认已识别的 bound 函数不会再次绑定到 rawWindow。
   *
   * 断言目标：函数名和引用都不变；rc.32 的 `bindFunctionToRawTarget()` 也保留已识别的 bound 函数。
   */
  test('test bind_function of isBoundedFunction', () => {
    const sandbox = new Sandbox('test-isBoundedFunction', `http://127.0.0.1:${ports.sandbox}/common/`)
    sandbox.start()
    const proxyWindow: any = sandbox.proxyWindow

    /** 生成可识别的原生 bound 函数供绑定缓存分支断言。 */
    function willBind () {}
    const boundFunction = willBind.bind(window)
    window.boundFunction = boundFunction

    expect(proxyWindow.boundFunction.name).toBe('bound willBind')
    expect(proxyWindow.boundFunction).toBe(boundFunction)
  })

  /**
   * 启动后分别把代理 eval、Image 改为非空字符串，再读取同一属性。
   * 两次读取应返回覆盖值，验证各自局部槽位可替换默认能力；输入不是函数，不验证执行或假值回退。
   */
  test('test set eval & Image', () => {
    const sandbox = new Sandbox('test-set-eval&Image', `http://127.0.0.1:${ports.sandbox}/common/`)
    sandbox.start()
    const proxyWindow: any = sandbox.proxyWindow

    proxyWindow.eval = 'new-eval'
    expect(proxyWindow.eval).toBe('new-eval')

    proxyWindow.Image = 'new-image'
    expect(proxyWindow.Image).toBe('new-image')
  })

  /**
   * 宿主键使用 getter 与空 setter 而非数据描述符，启动后通过代理给同名键赋值。
   * 断言新代理描述符 writable 为真，验证 setter 存在时从 accessor 转成可写的隔离数据属性。
   */
  test('coverage: proxyWindow getter', () => {
    const sandbox = new Sandbox('test-coverage-proxy-getter', `http://127.0.0.1:${ports.sandbox}/common/`)
    sandbox.start()
    const proxyWindow: any = sandbox.proxyWindow

    Object.defineProperties(window, {
      'key1-for-proxy-getter': {
        /** 返回宿主 accessor 值，验证描述符复制。 */
        get () {
          return 'key1-proxy-getter-value'
        },
        /** 空 setter 用于构造同时含 getter/setter 的宿主描述符。 */
        set () {},
        configurable: true,
        enumerable: true,
      },
    })

    proxyWindow['key1-for-proxy-getter'] = 'set value to proxyWindow'
    expect(Object.getOwnPropertyDescriptor(proxyWindow, 'key1-for-proxy-getter')?.writable).toBeTruthy()
  })

  /**
   * 删除宿主 parent 后构造并启动旧沙箱，预定进入宿主描述符缺失的默认描述符分支。
   * 实际只断言宿主 parent 描述符仍不存在，没有读取代理描述符来验证其默认字段。
   */
  test('coverage: empty descriptor in createDescriptorForMicroAppWindow ', () => {
    // @ts-ignore
    delete window.parent
    const sandbox = new Sandbox('empty-descriptor-createDescriptorForMicroAppWindow', `http://127.0.0.1:${ports.sandbox}/common/`)
    sandbox.start()
    expect(Object.getOwnPropertyDescriptor(window, 'parent')).toBeUndefined()
  })
})
