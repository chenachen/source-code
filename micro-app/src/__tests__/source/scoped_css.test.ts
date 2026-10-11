/* eslint-disable promise/param-names, no-extend-native */
import { createHash } from 'crypto'
// import fs from 'fs'
import { commonStartEffect, releaseAllEffect, ports, setAppName } from '../common/initial'
import { defer } from '../../libs/utils'
import microApp from '../..'

/**
 * 获取样式 fixture 的完整原文，供转换结果与预生成 scoped 文件逐字比较。
 *
 * resolve 采用 res.text() 的 Promise；未设置 catch/reject，抓取失败时外层可能一直待定。
 * large/nesting 输入与预期均保留原字节，场景说明写在测试头而不插入 CSS 改变摘要。
 */
const fetchText = (url: string) => new Promise((resolve) => {
  fetch(url).then((res: Response) => resolve(res.text()))
}) as Promise<string>

/** 对完整样式文本计算 md5，压缩失败日志；没有空白归一化，任一输出字节变化都会参与比较。 */
const md5 = (content: string) => {
  return createHash('md5').update(content).digest('hex')
}


/** 当前默认 Jest testMatch 纳入本文件。 */
describe('source scoped_css', () => {
  let appCon: Element
  beforeAll(() => {
    commonStartEffect(ports.scoped_css)
    microApp.start()
    appCon = document.querySelector('#app-container')!
  })

  afterAll(() => {
    return releaseAllEffect()
  })

  /**
   * 在 dynamic 应用中先插入空 style，再写入通配选择器与包含 html 的列表，
   * 等待 defer 后读 textContent。MutationObserver 应处理首次文本，
   * 给 * 与 .test 加应用前缀，而 html > .abc 保留原段；验证空节点延迟隔离。
   */
  test('set textContent after style element append to html', async () => {
    const microAppElement1 = document.createElement('micro-app')
    microAppElement1.setAttribute('name', 'test-app1')
    microAppElement1.setAttribute('url', `http://127.0.0.1:${ports.scoped_css}/dynamic/`)

    appCon.appendChild(microAppElement1)
    await new Promise((resolve) => {
      microAppElement1.addEventListener('mounted', () => {
        setAppName('test-app1')
        // 动态创建style
        const dynamicStyle = document.createElement('style')
        document.head.appendChild(dynamicStyle)

        dynamicStyle.textContent = '* {margin: 0;} .test, html > .abc {color: red;}'

        defer(() => {
          expect(dynamicStyle.textContent).toBe('micro-app[name=test-app1] *{margin: 0;} micro-app[name=test-app1] .test, html > .abc{color: red;}')
          resolve(true)
        })
      }, false)
    })
  })

  /**
   * 当前 test.skip 跳过：切换 Safari UA 并插入含 content 值及绝对 URL 的 style，
   * 旧预期逐字检查 content 保留与前缀。当前解析器直接处理文本，选择器到左花括号间空白会被消费，
   * 旧 CSSOM 引号兼容预期不能当作当前覆盖。
   */
  test.skip('complete quotation marks in safari', async () => {
    const rawUserAgent = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.1 Safari/605.1.15',
      writable: true,
      configurable: true,
    })

    const microAppElement2 = document.createElement('micro-app')
    microAppElement2.setAttribute('name', 'test-app2')
    microAppElement2.setAttribute('url', `http://127.0.0.1:${ports.scoped_css}/dynamic/`)

    appCon.appendChild(microAppElement2)
    await new Promise((resolve) => {
      microAppElement2.addEventListener('mounted', () => {
        setAppName('test-app2')
        // 动态创建style
        const dynamicStyle = document.createElement('style')
        dynamicStyle.textContent = '.test-content1 {content: no quota;} .test-content2 {content: none;} .test-content3 {content: url(http://www.micro-app-test.com/);}'

        document.head.appendChild(dynamicStyle)

        defer(() => {
          expect(dynamicStyle.textContent).toBe('micro-app[name=test-app2] .test-content1 {content: no quota;} micro-app[name=test-app2] .test-content2 {content: none;} micro-app[name=test-app2] .test-content3 {content: url(http://www.micro-app-test.com/);}')
          resolve(true)
        })
      }, false)
    })

    Object.defineProperty(navigator, 'userAgent', {
      value: rawUserAgent,
      writable: true,
      configurable: true,
    })
  })

  /**
   * 在 dynamic 应用插入同时含 font-face、media、supports 和未知 at-rule 的 style，
   * 等待 defer 后逐字核对输出。font-face 声明保留，容器规则递归改写 body/div，
   * 未知 @unknown 被普通规则路径加前缀；验证 at-rule 分流。
   */
  test('some CSSRuleType should special handling', async () => {
    const microAppElement3 = document.createElement('micro-app')
    microAppElement3.setAttribute('name', 'test-app3')
    microAppElement3.setAttribute('url', `http://127.0.0.1:${ports.scoped_css}/dynamic/`)

    appCon.appendChild(microAppElement3)
    await new Promise((resolve) => {
      microAppElement3.addEventListener('mounted', () => {
        setAppName('test-app3')
        // 动态创建style
        const dynamicStyle = document.createElement('style')
        dynamicStyle.textContent = '@font-face {font-family: test-font;} @media screen and (max-width: 300px) {body {background:lightblue;}} @supports (display: grid) {div {display: grid;}} @unknown {}'

        document.head.appendChild(dynamicStyle)

        defer(() => {
          expect(dynamicStyle.textContent).toBe('@font-face {font-family: test-font;} @media screen and (max-width: 300px) {micro-app[name=test-app3] micro-app-body{background:lightblue;}} @supports (display: grid) {micro-app[name=test-app3] div{display: grid;}} micro-app[name=test-app3] @unknown{}')
          resolve(true)
        })
      }, false)
    })
  })

  /**
   * 当前 test.skip 跳过：改写 indexOf 并给 style 设置旧 __MICRO_APP_LINK_PATH__ 属
   * 性，输入绝对、data 和两种相对 URL，旧断言期待按该属性补址。当前解析器不读取此属性，
   * linkPath 由 scopedCSS 第三参传入，故这些旧 URL 预期不代表现实现。
   */
  test.skip('complete static resource address', async () => {
    const rewIndexOf = String.prototype.indexOf
    const safariPolyfill = `//127.0.0.1:${ports.scoped_css}/safari-polyfill.png`
    /** 只令特定协议相对地址的 indexOf 表现为未命中，保留旧 Safari 兼容路径的模拟输入。 */
    String.prototype.indexOf = function (searchString: string): number {
      if (searchString === safariPolyfill) {
        return -1
      }
      return rewIndexOf.call(this, searchString)
    }
    const microAppElement4 = document.createElement('micro-app')
    microAppElement4.setAttribute('name', 'test-app4')
    microAppElement4.setAttribute('url', `http://127.0.0.1:${ports.scoped_css}/dynamic/`)

    appCon.appendChild(microAppElement4)
    await new Promise((resolve) => {
      microAppElement4.addEventListener('mounted', () => {
        setAppName('test-app4')
        // 动态创建style
        const dynamicStyle1 = document.createElement('style')
        dynamicStyle1.textContent = '.static-path1 { background: url(http://www.micro-app-test.com/img.jpeg)} .static-path2 { background: url(data:image/png;base64,iVB...)} .static-path3 { background: url(../path1/img.png)} .static-path4 { background: url(./path1/img.png)}'
        // @ts-ignore
        dynamicStyle1.setAttribute('__MICRO_APP_LINK_PATH__', 'http://www.micro-app-test.com/css/dynamic.css')

        document.head.appendChild(dynamicStyle1)
        expect(dynamicStyle1.textContent).toBe('micro-app[name=test-app4] .static-path1{ background: url(http://www.micro-app-test.com/img.jpeg)} micro-app[name=test-app4] .static-path2{ background: url(data:image/png;base64,iVB...)} micro-app[name=test-app4] .static-path3{ background: url("http://www.micro-app-test.com/path1/img.png")} micro-app[name=test-app4] .static-path4{ background: url("http://www.micro-app-test.com/css/path1/img.png")}')

        resolve(true)
      }, false)
    })

    String.prototype.indexOf = rewIndexOf
  })

  /**
   * 开始加载 common 后立即移除带 destroy 的宿主，让后续样式处理与销毁状态交错。目标是执行加载期间卸载路径；
   * 本例既无等待资源结算也无 expect，不能直接证明解析器、observer 或资源全部清理。
   */
  test('covering special branches', async () => {
    // 执行样式隔离时app已经被卸载
    const microAppElement5 = document.createElement('micro-app')
    microAppElement5.setAttribute('name', 'test-app5')
    microAppElement5.setAttribute('url', `http://127.0.0.1:${ports.scoped_css}/common/`)
    microAppElement5.setAttribute('destroy', 'true')

    appCon.appendChild(microAppElement5)
    appCon.removeChild(microAppElement5)
  })

  /**
   * 分别构造 CSSOM insertRule 的空文本 style、data-styled=active 的空 style 和已移除
   * 的空 style，再写规则/文本并安排 10ms 断言。应避免改写 styled-components 管理的规则，
   * 普通空节点也不因空文本产生前缀；定时断言不属于已 resolve 的 mounted Promise。
   */
  test('temporary handle for styled component', async () => {
    const microAppElement7 = document.createElement('micro-app')
    microAppElement7.setAttribute('name', 'test-app7')
    microAppElement7.setAttribute('url', `http://127.0.0.1:${ports.scoped_css}/common/`)

    appCon.appendChild(microAppElement7)

    await new Promise((resolve) => {
      microAppElement7.addEventListener('mounted', () => {
        setAppName('test-app7')
        // 模拟生产环境styled-component style标签
        const dynamicStyle1 = document.createElement('style')
        document.head.appendChild(dynamicStyle1)
        dynamicStyle1.appendChild(document.createTextNode(''))
        const sheet = dynamicStyle1.sheet!
        sheet.insertRule('.imred {color: red;}', 0)
        setTimeout(() => {
          expect(dynamicStyle1.textContent).toBe('')
        }, 10)

        // 模拟开发环境styled-component style标签
        const dynamicStyle2 = document.createElement('style')
        dynamicStyle2.setAttribute('data-styled', 'active')
        document.head.appendChild(dynamicStyle2)
        dynamicStyle2.textContent = '.imred {color: red;}'
        setTimeout(() => {
          expect(dynamicStyle2.textContent).toBe('.imred {color: red;}')
        }, 10)

        // 正常的style
        const dynamicStyle3 = document.createElement('style')
        document.head.appendChild(dynamicStyle3)
        document.head.removeChild(dynamicStyle3)

        dynamicStyle3.appendChild(document.createTextNode(''))
        setTimeout(() => {
          expect(dynamicStyle3.textContent).toBe('')
        }, 10)

        resolve(true)
      }, false)
    })
  })

  /**
   * 把同一个空 style 插入、移除，写入 div 文本后再次插入。二次插入应同步完成一次前缀改写，
   * textContent 不出现重复前缀；验证节点复用时 scoped 标记与空节点等待路径的协作。
   */
  test('coverage: styleElement.__MICRO_APP_HAS_SCOPED__', async () => {
    const microAppElement8 = document.createElement('micro-app')
    microAppElement8.setAttribute('name', 'test-app8')
    microAppElement8.setAttribute('url', `http://127.0.0.1:${ports.scoped_css}/dynamic/`)

    appCon.appendChild(microAppElement8)

    await new Promise((resolve) => {
      microAppElement8.addEventListener('mounted', () => {
        setAppName('test-app8')
        const dynamicStyle1 = document.createElement('style')
        document.head.appendChild(dynamicStyle1)
        document.head.removeChild(dynamicStyle1)
        dynamicStyle1.textContent = 'div {color: red}'
        document.head.appendChild(dynamicStyle1)

        expect(dynamicStyle1.textContent).toBe('micro-app[name=test-app8] div{color: red}')
        resolve(true)
      }, false)
    })
  })

  /**
   * 从服务读取 large.css 原始输入，放入动态 style，再读取 large.scoped.css 比较完整文本 md5。
   * 输入/预期包含完整 Semantic UI 规则和 at-rule，摘要覆盖选择器、声明、注释、空白与 URL 的全部输出字节，
   * 不是只检查几个样例规则。
   */
  test('coverage: use large.css improves coverage', async () => {
    const microAppElement9 = document.createElement('micro-app')
    microAppElement9.setAttribute('name', 'test-app9')
    microAppElement9.setAttribute('url', `http://127.0.0.1:${ports.scoped_css}/dynamic/`)

    appCon.appendChild(microAppElement9)

    await new Promise((resolve) => {
      microAppElement9.addEventListener('mounted', async () => {
        setAppName('test-app9')
        const dynamicLink = document.createElement('style')
        const dynamicContent = await fetchText(`http://127.0.0.1:${ports.scoped_css}/common/large.css`)
        dynamicLink.textContent = dynamicContent
        document.head.appendChild(dynamicLink)

        defer(async () => {
          const result = await fetchText(`http://127.0.0.1:${ports.scoped_css}/common/large.scoped.css`)
          // 调试时可直接输出转换结果。
          // fs.writeFileSync('./large.scoped.css', dynamicLink.textContent!, 'utf-8')
          // 使用 md5 缩短格式化后的失败日志。
          expect(md5(dynamicLink.textContent!)).toBe(md5(result!))
          resolve(true)
        })
      }, false)
    })
  })

  /**
   * 当前 test.skip 跳过：依次输入未闭合注释、缺选择器/花括号、缺关键帧名以及缺冒号声明，旧断言期待多种解析错误。
   * 当前 printError 仅在有剩余输入时抛错，div { 等耗尽输入不报错，声明冒号也不校验；仍分别保留每段旧输入以记录边界。
   */
  test.skip('coverage of all failures', async () => {
    const microAppElement10 = document.createElement('micro-app')
    microAppElement10.setAttribute('name', 'test-app10')
    microAppElement10.setAttribute('url', `http://127.0.0.1:${ports.scoped_css}/dynamic/`)

    appCon.appendChild(microAppElement10)

    await new Promise((resolve) => {
      microAppElement10.addEventListener('mounted', () => {
        setAppName('test-app10')
        const dynamicStyle1 = document.createElement('style')
        // 输入在左花括号后结束；当前 printError 因 cssText 已空而不抛缺少右花括号错误。
        dynamicStyle1.setAttribute('__MICRO_APP_LINK_PATH__', 'http://micro-app-test.com/unimportant.css')
        dynamicStyle1.textContent = 'div {'
        document.head.appendChild(dynamicStyle1)
        expect(console.error).toBeCalledWith(expect.any(String), expect.any(Error))

        // 未闭合注释。
        const dynamicStyle2 = document.createElement('style')
        dynamicStyle2.textContent = '/* sdfs'
        document.head.appendChild(dynamicStyle2)
        expect(console.error).toBeCalledWith(expect.any(String), expect.any(Error))

        // 选择器缺失。
        const dynamicStyle3 = document.createElement('style')
        dynamicStyle3.textContent = '{}'
        document.head.appendChild(dynamicStyle3)
        expect(console.error).toBeCalledWith(expect.any(String), expect.any(Error))

        // 声明块缺少 `{`。
        const dynamicStyle4 = document.createElement('style')
        dynamicStyle4.textContent = 'div'
        document.head.appendChild(dynamicStyle4)
        expect(console.error).toBeCalledWith(expect.any(String), expect.any(Error))

        // 旧断言期待缺少冒号报错；当前 matchAllDeclarations 原样消费 color，不执行属性语法校验。
        const dynamicStyle5 = document.createElement('style')
        dynamicStyle5.textContent = 'div {color}'
        document.head.appendChild(dynamicStyle5)
        expect(console.error).toBeCalledWith(expect.any(String), expect.any(Error))

        // 属性值为空的特殊场景。
        const dynamicStyle6 = document.createElement('style')
        dynamicStyle6.textContent = 'div {color:;}'
        document.head.appendChild(dynamicStyle6)
        expect(dynamicStyle6.textContent).toBe('micro-app[name=test-app10] div{color:;}')

        // `@keyframes` 缺少名称。
        const dynamicStyle7 = document.createElement('style')
        dynamicStyle7.textContent = '@keyframes '
        document.head.appendChild(dynamicStyle7)
        expect(console.error).toBeCalledWith(expect.any(String), expect.any(Error))

        // `@keyframes` 缺少 `{`。
        const dynamicStyle8 = document.createElement('style')
        dynamicStyle8.textContent = '@keyframes name'
        document.head.appendChild(dynamicStyle8)
        expect(console.error).toBeCalledWith(expect.any(String), expect.any(Error))

        // `@keyframes` 缺少 `}`。
        const dynamicStyle9 = document.createElement('style')
        dynamicStyle9.textContent = '@keyframes name {'
        document.head.appendChild(dynamicStyle9)
        expect(console.error).toBeCalledWith(expect.any(String), expect.any(Error))

        // `@media`/`@supports`/`@document`/`@host` 缺少 `{`。
        const dynamicStyle10 = document.createElement('style')
        dynamicStyle10.textContent = '@media (min-width: 500px) '
        document.head.appendChild(dynamicStyle10)
        expect(console.error).toBeCalledWith(expect.any(String), expect.any(Error))

        // `@media`/`@supports`/`@document`/`@host` 缺少 `}`。
        const dynamicStyle11 = document.createElement('style')
        dynamicStyle11.textContent = '@media (min-width: 500px) {'
        document.head.appendChild(dynamicStyle11)
        expect(console.error).toBeCalledWith(expect.any(String), expect.any(Error))

        // `@font-face`/`@page` 缺少 `{`。
        const dynamicStyle12 = document.createElement('style')
        dynamicStyle12.textContent = '@font-face'
        document.head.appendChild(dynamicStyle12)
        expect(console.error).toBeCalledWith(expect.any(String), expect.any(Error))

        // `@font-face`/`@page` 缺少 `}`。
        const dynamicStyle13 = document.createElement('style')
        dynamicStyle13.textContent = '@font-face {'
        document.head.appendChild(dynamicStyle13)
        expect(console.error).toBeCalledWith(expect.any(String), expect.any(Error))

        resolve(true)
      }, false)
    })
  })

  /**
   * 依次插入 next-line、带选择器列表的 disable、全局 disable/enable、声明内 next-line、普通
   * 斜杠与逗号空白输入，逐字检查七段输出。规则前 next-line 只免选择器，声明内指令可免下一段 URL；
   * 带列表时 URL 继续补全，enable 清列表，验证控制状态与游标消费。
   */
  test('Using configuration comments', async () => {
    const microAppElement11 = document.createElement('micro-app')
    microAppElement11.setAttribute('name', 'test-app11')
    microAppElement11.setAttribute('url', `http://127.0.0.1:${ports.scoped_css}/dynamic/`)

    appCon.appendChild(microAppElement11)

    await new Promise((resolve) => {
      microAppElement11.addEventListener('mounted', () => {
        setAppName('test-app11')
        // 单条规则豁免标记：scopecss-disable-next-line。
        const dynamicStyle1 = document.createElement('style')
        dynamicStyle1.textContent = '/* scopecss-disable-next-line */div{}span{}'
        document.head.appendChild(dynamicStyle1)
        expect(dynamicStyle1.textContent).toBe('/* scopecss-disable-next-line */div{}micro-app[name=test-app11] span{}')

        // `scopecss-disable` 配置与特殊选择器组合。
        const dynamicStyle2 = document.createElement('style')
        dynamicStyle2.textContent = '/* scopecss-disable div, span */div{background: url(/test.png);}span{}header{}'
        document.head.appendChild(dynamicStyle2)
        expect(dynamicStyle2.textContent).toBe('/* scopecss-disable div, span */div{background: url("http://127.0.0.1:9010/test.png");}span{}micro-app[name=test-app11] header{}')

        // 连续关闭作用域改写：scopecss-disable。
        const dynamicStyle3 = document.createElement('style')
        dynamicStyle3.textContent = '/* ! scopecss-disable */div{}span{}header{}'
        document.head.appendChild(dynamicStyle3)
        expect(dynamicStyle3.textContent).toBe('/* ! scopecss-disable */div{}span{}header{}')

        // 重新开启作用域改写：scopecss-enable。
        const dynamicStyle4 = document.createElement('style')
        dynamicStyle4.textContent = '/* ! scopecss-disable */div{}span{}/* ! scopecss-enable */header{}'
        document.head.appendChild(dynamicStyle4)
        expect(dynamicStyle4.textContent).toBe('/* ! scopecss-disable */div{}span{}/* ! scopecss-enable */micro-app[name=test-app11] header{}')

        // 覆盖忽略配置属性的分支。
        const dynamicStyle5 = document.createElement('style')
        dynamicStyle5.textContent = 'div{/* scopecss-disable-next-line */background: url(/test.png);}span{}header{}'
        document.head.appendChild(dynamicStyle5)
        expect(dynamicStyle5.textContent).toBe('micro-app[name=test-app11] div{/* scopecss-disable-next-line */background: url(/test.png);}micro-app[name=test-app11] span{}micro-app[name=test-app11] header{}')

        // 覆盖声明值中包含斜杠的分支。
        const dynamicStyle6 = document.createElement('style')
        dynamicStyle6.textContent = '.test1{color: re/d;}'
        document.head.appendChild(dynamicStyle6)
        expect(dynamicStyle6.textContent).toBe('micro-app[name=test-app11] .test1{color: re/d;}')

        // 保留逗号后的原始空白分隔格式。
        const dynamicStyle7 = document.createElement('style')
        dynamicStyle7.textContent = '.test1,   .test2 {color: red}'
        document.head.appendChild(dynamicStyle7)
        expect(dynamicStyle7.textContent).toBe('micro-app[name=test-app11] .test1,   micro-app[name=test-app11] .test2{color: red}')

        resolve(true)
      }, false)
    })
  })

  /**
   * 切换 Firefox UA，插入 #root 普通规则，等待 defer 后核对最终可读 CSS，再恢复 UA。
   * 应输出应用前缀并保留声明，验证 encode/decode 路径能返回普通文本；
   * 该 ASCII 输入不验证长 Unicode 字符串的性能改善。
   */
  test('encode result in firefox', async () => {
    const rawUserAgent = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.14; rv:96.0) Gecko/20100101 Firefox/96.0',
      writable: true,
      configurable: true,
    })

    const microAppElement12 = document.createElement('micro-app')
    microAppElement12.setAttribute('name', 'test-app12')
    microAppElement12.setAttribute('url', `http://127.0.0.1:${ports.scoped_css}/dynamic/`)

    appCon.appendChild(microAppElement12)
    await new Promise((resolve) => {
      microAppElement12.addEventListener('mounted', () => {
        setAppName('test-app12')
        // 动态创建style
        const dynamicStyle = document.createElement('style')
        dynamicStyle.textContent = '#root {color: red;}'

        document.head.appendChild(dynamicStyle)

        defer(() => {
          expect(dynamicStyle.textContent).toBe('micro-app[name=test-app12] #root{color: red;}')
          resolve(true)
        })
      }, false)
    })

    Object.defineProperty(navigator, 'userAgent', {
      value: rawUserAgent,
      writable: true,
      configurable: true,
    })
  })

  /**
   * 读取 nesting-css 输入动态插入 style，再比较 nesting-css.scoped 预期的完整 md5。
   * 预期仅给最外层 .ui.comments 加前缀，内部选择器、注释、字符串花括号和 keyframes 保留，
   * 验证声明扫描的嵌套深度而非逐层选择器隔离。
   */
  test('coverage: nesting-css support', async () => {
    const microAppElement13 = document.createElement('micro-app')
    microAppElement13.setAttribute('name', 'test-app13')
    microAppElement13.setAttribute('url', `http://127.0.0.1:${ports.scoped_css}/dynamic/`)

    appCon.appendChild(microAppElement13)

    await new Promise((resolve) => {
      microAppElement13.addEventListener('mounted', async () => {
        setAppName('test-app13')
        const dynamicLink = document.createElement('style')
        const dynamicContent = await fetchText(`http://127.0.0.1:${ports.scoped_css}/common/nesting-css.css`)
        dynamicLink.textContent = dynamicContent
        document.head.appendChild(dynamicLink)

        defer(async () => {
          // 调试时可直接输出转换结果。
          // fs.writeFileSync('./nesting-css.scoped.css', dynamicLink.textContent!, 'utf-8')
          const result = await fetchText(`http://127.0.0.1:${ports.scoped_css}/common/nesting-css.scoped.css`)
          // 使用 md5 缩短格式化后的失败日志。
          expect(md5(dynamicLink.textContent!)).toBe(md5(result!))
          resolve(true)
        })
      }, false)
    })
  })
})
