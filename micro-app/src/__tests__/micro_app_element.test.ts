/* eslint-disable promise/param-names */
import {
  commonStartEffect,
  releaseAllEffect,
  ports,
  jestConsoleError,
} from './common/initial'
import CreateApp, { appInstanceMap } from '../create_app'
import microApp from '..'
import { defer } from '../libs/utils'

/** 元素集成场景共用注册表；前例保留的运行/隐藏实例是后例冲突与恢复的初始条件，beforeAll 的预取使用默认空闲后3000ms调度。 */
describe('micro_app_element', () => {
  let appCon: Element
  beforeAll(() => {
    commonStartEffect(ports.micro_app_element)
    appCon = document.querySelector('#app-container')!
    window.keepAliveListener = jest.fn()

    microApp.start({
      preFetchApps: [
        {
          name: 'test-app1',
          url: `http://127.0.0.1:${ports.micro_app_element}/common`,
        },
        {
          name: 'test-app12',
          url: `http://127.0.0.1:${ports.micro_app_element}/common`,
        },
      ]
    })
  })

  afterAll(() => {
    return releaseAllEffect()
  })

  /**
   * 场景：插入带 ssr-render 入口与兼容 baseurl 属性的 test-app2。
   * 等待 mounted 并检查 Map 中对应对象是 CreateApp，验证普通连接能创建并挂载实例。
   * 本例没有读取 baseRoute，所以不能把 legacy baseurl 的最终取值归作断言结果。
   */
  test('render app2 as usual', async () => {
    const microAppElement2 = document.createElement('micro-app')
    microAppElement2.setAttribute('name', 'test-app2')
    microAppElement2.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/ssr-render/`)
    // 兼容旧版本baseurl
    microAppElement2.setAttribute('baseurl', '/baseurl')

    appCon.appendChild(microAppElement2)

    await new Promise((resolve) => {
      microAppElement2.addEventListener('mounted', () => {
        expect(appInstanceMap.get('test-app2')).toBeInstanceOf(CreateApp)
        resolve(true)
      }, false)
    })
  })

  /**
   * 场景：beforeAll 已为 test-app1 排入默认延时预取，本例立即用同名 ssr-render 入口创建正式宿主。
   * 等 mounted 后检查 fixture 生成的 app2-iframe1 是 HTMLIFrameElement，验证正式渲染 DOM 已到达。
   * 默认预取另需空闲回调后 3000ms；本例不等待或检查预取实例，若正式实例先注册，预取会按同名跳过。
   */
  test('render prefetch app before prefetch work', async () => {
    const microAppElement3 = document.createElement('micro-app')
    microAppElement3.setAttribute('name', 'test-app1')
    microAppElement3.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/ssr-render/`)

    await new Promise((resolve) => {
      microAppElement3.addEventListener('mounted', () => {
        expect(document.getElementById('app2-iframe1')).toBeInstanceOf(HTMLIFrameElement)
        resolve(true)
      }, false)
      appCon.appendChild(microAppElement3)
    })
  })

  /**
   * 场景：前例留下正在运行的 test-app1/ssr-render，再插入同名 common 入口的宿主。
   * 连接微任务后要求记录名称冲突的完整日志，目标是拒绝覆盖运行实例。
   * 断言保留旧版带“name:”和“url:”的格式，当前源码没有这两个冒号，该完整文本预期与 rc.32 不匹配。
   */
  test('test conflict of app name', async () => {
    const microAppElement4 = document.createElement('micro-app')
    microAppElement4.setAttribute('name', 'test-app1')
    microAppElement4.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/common/`)

    appCon.appendChild(microAppElement4)

    await new Promise((resolve) => {
      defer(() => {
        expect(jestConsoleError).toHaveBeenCalledWith('[micro-app] app name conflict, an app named: test-app1 with url: http://127.0.0.1:9002/ssr-render/ is running')
        resolve(true)
      })
    })
  })

  /**
   * 场景：为 test-app2 设置相对 URL abc 后插入宿主，defer 后保留错误 mock 调用两次的旧断言。
   * 当前 formatAppURL 用宿主 location.href 作基址；HTTP 宿主下 abc 是可解析的相对入口，之后还会遇到前例运行中的同名实例。
   * 此正文的旧预期把 abc 当非法地址，与当前相对地址解析规则不符；没有断言规范化地址或具体错误来源。
   */
  test('it should log error when url is invalid', async () => {
    const microAppElement5 = document.createElement('micro-app')
    microAppElement5.setAttribute('name', 'test-app2')
    microAppElement5.setAttribute('url', 'abc')

    appCon.appendChild(microAppElement5)

    await new Promise((resolve) => {
      defer(() => {
        expect(jestConsoleError).toBeCalledTimes(2)
        resolve(true)
      })
    })
  })

  /**
   * 场景：元素尚未连接时先写 test-app6/common，再连续改为正在运行的 test-app2/ssr-render。
   * 连接前断言 name/url 属性接受新值；插入后等待一轮 defer 并检查错误日志曾被调用。
   * 区分离线属性赋值与连接后的名称冲突检查；本例不验证冲突日志精确内容或元素回滚。
   */
  test('it should deal with an error when change name or url failed', async () => {
    const microAppElement6 = document.createElement('micro-app')
    microAppElement6.setAttribute('name', 'test-app6')
    microAppElement6.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/common/`)

    microAppElement6.setAttribute('name', 'test-app2')
    microAppElement6.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/ssr-render/`)

    // micro-app元素还没插入到文档中时，可以随时修改name和url
    expect(microAppElement6.getAttribute('name')).toBe('test-app2')
    expect(microAppElement6.getAttribute('url')).toBe(`http://127.0.0.1:${ports.micro_app_element}/ssr-render/`)

    await new Promise((resolve) => {
      appCon.appendChild(microAppElement6)
      defer(() => {
        expect(jestConsoleError).toBeCalled()
        resolve(true)
      })
    })
  })

  /**
   * 场景：beforeAll 已成功 start 单例，本例再次无参数调用 start。
   * 立即断言日志为 microApp.start executed repeatedly。
   * 验证一次启动标志挡住重复全局初始化与自定义元素注册。
   */
  test('it should log error when microApp.start exec repeatedly', () => {
    microApp.start()
    expect(jestConsoleError).toBeCalledWith('[micro-app] microApp.start executed repeatedly')
  })

  /**
   * 场景：test-app7 挂载后在同一栈把 name 改为 new-name 又改回原值，defer 后确认属性仍为 test-app7，再发起真正名称变更。
   * 另挂载 test-app8，改 URL 为 abc；defer 后要求 DOM 属性仍为 abc，而 appUrl 保持原 common 地址。
   * 第一段观察属性更新合并；第二段把 abc 当非法入口的旧预期与当前 HTTP 宿主下相对 URL 解析不符。最后手动删 Map 再移除元素，没有验证完整沙箱卸载。
   */
  test('coverage special branch when change attribute name/url', async () => {
    const microAppElement7 = document.createElement('micro-app')
    microAppElement7.setAttribute('name', 'test-app7')
    microAppElement7.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/common/`)

    appCon.appendChild(microAppElement7)
    await new Promise((resolve) => {
      microAppElement7.addEventListener('mounted', () => {
        resolve(true)
      }, false)
    })

    microAppElement7.setAttribute('name', 'new-name') // 设置新name
    microAppElement7.setAttribute('name', 'test-app7') // 之后立即恢复之前的值，因为回调是异步处理的，所以会发现属性name和实例名称name是一致的，以此来覆盖某个分支

    await new Promise((resolve) => {
      defer(() => {
        expect(microAppElement7.getAttribute('name')).toBe('test-app7')
        microAppElement7.setAttribute('name', 'new-name')
        resolve(true)
      })
    })

    const microAppElement8 = document.createElement('micro-app')
    microAppElement8.setAttribute('name', 'test-app8')
    microAppElement8.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/common/`)

    appCon.appendChild(microAppElement8)
    await new Promise((resolve) => {
      microAppElement8.addEventListener('mounted', () => {
        resolve(true)
      }, false)
    })

    microAppElement8.setAttribute('url', 'abc') // 旧例视为非法；当前 HTTP 宿主下会按相对地址解析。

    await new Promise((resolve) => {
      defer(() => {
        expect(microAppElement8.getAttribute('url')).toBe('abc')
        // @ts-ignore
        expect(microAppElement8.appUrl).toBe(`http://127.0.0.1:${ports.micro_app_element}/common/`)
        resolve(true)
      })
    })

    appInstanceMap.delete('test-app8')
    appCon.removeChild(microAppElement8)
  })

  /**
   * 场景：给 test-app10 设置 shadowDom 与旧 baseurl，完成首次挂载后移除再插入；随后对无这些属性的 test-app11 做同样动作。
   * HTML 属性名大小写归一化使 shadowDom 可被 shadowDOM 读取；本例只等待两者首次 mounted，没有 ShadowRoot、baseRoute 或二次挂载断言。
   * 正文进入两类宿主的重连接路径，后续重插的完成结果未被单独验证。
   */
  test('coverage branch of remount app with shadowDom & baseurl', async () => {
    const microAppElement10 = document.createElement('micro-app')
    microAppElement10.setAttribute('name', 'test-app10')
    microAppElement10.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/common/`)
    microAppElement10.setAttribute('shadowDom', 'true')
    microAppElement10.setAttribute('baseurl', '/baseurl')

    appCon.appendChild(microAppElement10)
    await new Promise((resolve) => {
      microAppElement10.addEventListener('mounted', () => {
        resolve(true)
      }, false)
    })

    appCon.removeChild(microAppElement10)

    appCon.appendChild(microAppElement10)

    // 分支覆盖
    const microAppElement11 = document.createElement('micro-app')
    microAppElement11.setAttribute('name', 'test-app11')
    microAppElement11.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/common/`)

    appCon.appendChild(microAppElement11)
    await new Promise((resolve) => {
      microAppElement11.addEventListener('mounted', () => {
        resolve(true)
      }, false)
    })

    appCon.removeChild(microAppElement11)

    appCon.appendChild(microAppElement11)
  })

  /**
   * 场景：test-app13/dynamic 首次 mounted 后，把 name/url 一起改为 test-app12#/common。
   * defer 中检查名称回写为 test-app12，随后检查对应实例 isPrefetch 为假。
   * 验证名称规范化和正式实例标记；未比较实例身份，默认预取尚可能未开始，不能断言一定复用了预取对象。
   */
  test('change name or url to an exist prefetch/unmount app ', async () => {
    const microAppElement13 = document.createElement('micro-app')
    microAppElement13.setAttribute('name', 'test-app13')
    microAppElement13.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/dynamic/`)

    appCon.appendChild(microAppElement13)
    await new Promise((resolve) => {
      /** 首次挂载后把元素切换到预取配置中的名称，并合并 name/url 属性更新。 */
      function handleMounted () {
        microAppElement13.removeEventListener('mounted', handleMounted)
        // test-app12# 会格式化为 test-app12
        microAppElement13.setAttribute('name', 'test-app12#')
        defer(() => {
          expect(microAppElement13.getAttribute('name')).toBe('test-app12')
        })
        microAppElement13.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/common`)
        resolve(true)
      }
      microAppElement13.addEventListener('mounted', handleMounted, false)
    })

    await new Promise((resolve) => {
      defer(() => {
        expect(appInstanceMap.get('test-app12')?.isPrefetch).toBeFalsy()
        resolve(true)
      })
    })
  })

  /**
   * 场景：新宿主含 baseroute=/path，插入 test-app14/common 后等待 mounted。
   * 以 mounted 事件作为完成信号，没有读取 baseRoute 或沙箱路由字段。
   * 正文让配置读取路径参与挂载，但不单独验证前缀取值或其对导航的影响。
   */
  test('coverage branch of getBaseRouteCompatible', async () => {
    const microAppElement14 = document.createElement('micro-app')
    microAppElement14.setAttribute('name', 'test-app14')
    microAppElement14.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/common/`)
    microAppElement14.setAttribute('baseroute', '/path')

    appCon.appendChild(microAppElement14)
    await new Promise((resolve) => {
      microAppElement14.addEventListener('mounted', () => {
        resolve(true)
      }, false)
    })
  })

  /**
   * 场景：先把空 micro-app 元素插入，再在同一栈补 name 和 URL。
   * 等待 mounted，观察属性回调补齐配置后能够续接创建/挂载。
   * 此例没有 created 次数断言，不能证明没有重复创建事件或 handleConnected 调用。
   */
  test('set name & url after connectedCallback', async () => {
    const microAppElement15 = document.createElement('micro-app')
    appCon.appendChild(microAppElement15)

    microAppElement15.setAttribute('name', 'test-app15')
    microAppElement15.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/common/`)

    await new Promise((resolve) => {
      microAppElement15.addEventListener('mounted', () => {
        resolve(true)
      }, false)
    })
  })

  /**
   * 场景：test-app16/common 首次 mounted 后移除，保留普通 UNMOUNT 实例。
   * 随后插入同名但 dynamic 入口的新宿主，第二次 mounted 时检查 Map 中 url 已变成规范化的新地址。
   * 验证已卸载同名不同 URL 可以被替换；没有比较对象身份或共享缓存删除范围。
   */
  test('overwrite unmount app when name conflicts', async () => {
    const microAppElement16 = document.createElement('micro-app')
    microAppElement16.setAttribute('name', 'test-app16')
    microAppElement16.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/common`)

    appCon.appendChild(microAppElement16)

    await new Promise((resolve) => {
      microAppElement16.addEventListener('mounted', () => {
        appCon.removeChild(microAppElement16)
        resolve(true)
      })
    })

    const microAppElement17 = document.createElement('micro-app')
    // name相同，url不同
    microAppElement17.setAttribute('name', 'test-app16')
    microAppElement17.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/dynamic/`)

    appCon.appendChild(microAppElement17)

    await new Promise((resolve) => {
      microAppElement17.addEventListener('mounted', () => {
        expect(appInstanceMap.get('test-app16')!.url).toBe(`http://127.0.0.1:${ports.micro_app_element}/dynamic/`)
        resolve(true)
      })
    })
  })

  /**
   * 场景：对未连接元素分别设置 name=123$ 和 test-app19$。
   * 第一项要求完整 Invalid attribute name 日志，第二项要求属性回写 test-app19，目标是非法名称拒绝和合法部分保留。
   * 首项保留旧预期 123$；当前 formatAppName 得到空串后以该空串写日志，文本与 rc.32 不匹配。
   */
  test('test name with special characters', async () => {
    // 场景1：格式化后为空；源码日志打印格式化值，下面仍保留原输入的旧预期。
    const microAppElement18 = document.createElement('micro-app')
    microAppElement18.setAttribute('name', '123$')
    expect(jestConsoleError).toBeCalledWith('[micro-app] Invalid attribute name 123$')

    // 场景 2：格式化前后 name 不一致时回写规范化值。
    const microAppElement19 = document.createElement('micro-app')
    microAppElement19.setAttribute('name', 'test-app19$')
    expect(microAppElement19.getAttribute('name')).toBe('test-app19')
  })

  /**
   * 场景：先开 SSR 挂载，移除并关 SSR 后重插，再开 SSR 修改入口；另一个元素在改 URL 时同时删除 SSR 属性。
   * 分别检查 ssrUrl 非 null 或变成空串，验证开关与属性更新下字段的清空行为。
   * not.toBeNull 接受空字符串，这些断言不验证成功恢复路由、具体 SSR 请求地址或页面内容。
   */
  test('test ssr mode', async () => {
    const microAppElement20 = document.createElement('micro-app')
    microAppElement20.setAttribute('name', 'test-app20')
    microAppElement20.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/common`)
    microAppElement20.setAttribute('ssr', 'true')

    // 场景 1：开启 SSR 后执行一次连接，断言 ssrUrl 字段不是 null。
    appCon.appendChild(microAppElement20)

    await new Promise((resolve) => {
      setTimeout(() => {
        // 此处没有设置默认页或浏览器中的应用路由，ssrUrl 可以是空字符串，仍满足 not.toBeNull()。
        expect(microAppElement20.ssrUrl).not.toBeNull()
        resolve(true)
      }, 1000)
    })

    // 场景2: 再次渲染时，去除ssr配置，如果有 ssrUrl，则进行删除
    appCon.removeChild(microAppElement20)
    microAppElement20.removeAttribute('ssr')
    appCon.appendChild(microAppElement20)

    await new Promise((resolve) => {
      setTimeout(() => {
        expect(microAppElement20.ssrUrl).toBe('')
        resolve(true)
      }, 100)
    })

    // 场景 3：SSR 模式下修改 url，在属性更新微任务后检查 ssrUrl 仍不是 null。
    appCon.removeChild(microAppElement20)
    microAppElement20.setAttribute('ssr', 'true')
    appCon.appendChild(microAppElement20)

    await new Promise((resolve) => {
      microAppElement20.addEventListener('mounted', () => {
        microAppElement20.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/dynamic/`)
        defer(() => {
          // 与场景 1 一样，这个断言允许空字符串，没有限定最终请求地址。
          expect(microAppElement20.ssrUrl).not.toBeNull()
          resolve(true)
        })
      })
    })

    // 场景4: ssr模式已经渲染，修改url的值的同时去除ssr配置，需要将ssrUrl的值删除
    const microAppElement21 = document.createElement('micro-app')
    microAppElement21.setAttribute('name', 'test-app21')
    microAppElement21.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/common`)
    microAppElement21.setAttribute('ssr', 'true')

    appCon.appendChild(microAppElement21)

    await new Promise((resolve) => {
      microAppElement21.addEventListener('mounted', () => {
        microAppElement21.removeAttribute('ssr')
        microAppElement21.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/dynamic/`)
        defer(() => {
          expect(microAppElement21.ssrUrl).toBe('')
          resolve(true)
        })
      })
    })
  })

  /**
   * 场景：common fixture 已 mounted 且宿主开启 keep-alive；移除后检查宿主 CustomEvent 与子应用全局观察函数都收到 afterhidden。
   * 重新插入并用定时器跨过连接与恢复的两层微任务，再检查双方收到 beforeshow/aftershow。
   * 验证隐藏/恢复生命周期通道；未断言事件顺序、实例身份或旧宿主监听已经解除。末段加 shadowDom 后再次重插，没有等待或检查 ShadowRoot。
   */
  test('normal process of keep-alive', async () => {
    const microAppElement22 = document.createElement('micro-app')
    microAppElement22.setAttribute('name', 'test-app22')
    microAppElement22.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/common/`)
    microAppElement22.setAttribute('keep-alive', 'true')

    appCon.appendChild(microAppElement22)

    await new Promise((resolve) => {
      microAppElement22.addEventListener('mounted', () => {
        resolve(true)
      })
    })

    const beforeShowListener = jest.fn()
    const afterShowListener = jest.fn()
    const afterHiddenListener = jest.fn()

    microAppElement22.addEventListener('beforeshow', beforeShowListener)
    microAppElement22.addEventListener('aftershow', afterShowListener)
    microAppElement22.addEventListener('afterhidden', afterHiddenListener)

    appCon.removeChild(microAppElement22)
    // 基座元素与子应用都应收到 afterhidden。
    expect(afterHiddenListener).toBeCalledWith(expect.any(CustomEvent))
    expect(window.keepAliveListener).toBeCalledWith('afterhidden')

    appCon.appendChild(microAppElement22)

    await new Promise((resolve) => {
      // connectedCallback 先排一个微任务，handleShowKeepAliveApp 再排恢复微任务；
      // 插入后立即排入的一次 defer 会早于第二层恢复，本例用下一轮定时器等待两层微任务完成。
      setTimeout(() => {
        // 基座元素与子应用都应收到 beforeshow。
        expect(beforeShowListener).toBeCalledWith(expect.any(CustomEvent))
        expect(window.keepAliveListener).toBeCalledWith('beforeshow')

        // 基座元素与子应用都应收到 aftershow。
        expect(afterShowListener).toBeCalledWith(expect.any(CustomEvent))
        expect(window.keepAliveListener).toBeCalledWith('aftershow')
        resolve(true)
      }, 100)
    })

    // 隐藏后增加 Shadow DOM 配置再重插；本段没有等待恢复完成或断言 shadowRoot。
    appCon.removeChild(microAppElement22)
    microAppElement22.setAttribute('shadowDom', 'true')
    appCon.appendChild(microAppElement22)
  })

  /**
   * 场景：test-app23/common 开启 keep-alive，首次 mounted 后移除使其隐藏。
   * 再插入同名但 dynamic 入口的新元素，100ms 后要求冲突日志，目标是隐藏的活跃实例不被不同 URL 覆盖。
   * 完整日志断言仍是旧版带冒号格式，与当前 handleConnected 文本不匹配；本例不检查旧 DOM 或沙箱 active。
   */
  test('url conflict when remount of keep-alive', async () => {
    const microAppElement23 = document.createElement('micro-app')
    microAppElement23.setAttribute('name', 'test-app23')
    microAppElement23.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/common/`)
    microAppElement23.setAttribute('keep-alive', 'true')

    appCon.appendChild(microAppElement23)

    await new Promise((resolve) => {
      microAppElement23.addEventListener('mounted', () => {
        resolve(true)
      })
    })

    appCon.removeChild(microAppElement23)

    const microAppElement24 = document.createElement('micro-app')
    microAppElement24.setAttribute('name', 'test-app23')
    microAppElement24.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/dynamic/`)

    appCon.appendChild(microAppElement24)

    await new Promise((resolve) => {
      setTimeout(() => {
        expect(jestConsoleError).toHaveBeenCalledWith('[micro-app] app name conflict, an app named: test-app23 with url: http://127.0.0.1:9002/common/ is running')
        resolve(true)
      }, 100)
    })
  })

  /**
   * 场景：沿用前例隐藏的 test-app23，再将已挂载 test-app25/dynamic 的 keep-alive 元素同时改为 test-app23/common。
   * 50ms 后要求旧 app25 的 afterhidden 及目标 app23 的 beforeshow/aftershow 都到达同一宿主。
   * 随后只把名称改回隐藏 app25，URL 仍为 common，defer 中要求名称冲突日志，验证属性切换时隐藏、恢复和入口不匹配三条路径。
   */
  test('url conflict when remount of keep-alive', async () => {
    const microAppElement25 = document.createElement('micro-app')
    microAppElement25.setAttribute('name', 'test-app25')
    microAppElement25.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/dynamic/`)
    microAppElement25.setAttribute('keep-alive', 'true')

    appCon.appendChild(microAppElement25)

    await new Promise((resolve) => {
      microAppElement25.addEventListener('mounted', () => {
        resolve(true)
      })
    })

    // afterhidden事件指向test-app25
    const afterHiddenListenerForTestApp25 = jest.fn()
    microAppElement25.addEventListener('afterhidden', afterHiddenListenerForTestApp25)

    // beforeshow和aftershow事件指向test-app23
    const beforeShowListenerForTestApp23 = jest.fn()
    const afterShowListenerForTestApp23 = jest.fn()
    microAppElement25.addEventListener('beforeshow', beforeShowListenerForTestApp23)
    microAppElement25.addEventListener('aftershow', afterShowListenerForTestApp23)

    // 修改name和url
    microAppElement25.setAttribute('name', 'test-app23')
    microAppElement25.setAttribute('url', `http://127.0.0.1:${ports.micro_app_element}/common/`)

    await new Promise((resolve) => {
      // name和url的修改是异步的，这里放在定时器中执行
      setTimeout(() => {
        // 基座应收到 afterhidden。
        expect(afterHiddenListenerForTestApp25).toBeCalledWith(expect.any(CustomEvent))

        // 基座应收到 beforeshow。
        expect(beforeShowListenerForTestApp23).toBeCalledWith(expect.any(CustomEvent))

        // 基座应收到 aftershow。
        expect(afterShowListenerForTestApp23).toBeCalledWith(expect.any(CustomEvent))

        resolve(true)
      }, 50)
    })

    // 修改name为test-app25，test-app25为隐藏状态，但url没有修改，此时url冲突，keep-alive报错
    microAppElement25.setAttribute('name', 'test-app25')

    await new Promise((resolve) => {
      defer(() => {
        expect(jestConsoleError).toHaveBeenCalledWith('[micro-app] app name conflict, an app named test-app25 is running')
        resolve(true)
      })
    })
  })
})
