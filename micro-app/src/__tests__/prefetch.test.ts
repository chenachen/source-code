/* eslint-disable promise/param-names */
import { commonStartEffect, releaseAllEffect, ports } from './common/initial'
import microApp from '..'
import preFetch from '../prefetch'
import { globalLinks } from '../source/links'
import { globalScripts } from '../source/scripts'

/** 历史预取套件未列入当前 Jest 默认 testMatch；其中全局缓存导入仍为旧接口，逐例注释记录正文实际等待与断言，不代表该套件已执行通过。 */
describe('prefetch', () => {
  // let appCon: Element
  beforeAll(() => {
    commonStartEffect(ports.prefetch)
    // appCon = document.querySelector('#app-container')!

    microApp.start({
      globalAssets: {
        js: [
          `http://127.0.0.1:${ports.prefetch}/common/script1.js`,
          `http://127.0.0.1:${ports.prefetch}/common/script1.js`,
          'http://not-exist.com/xxx.js'
        ],
        css: [
          `http://127.0.0.1:${ports.prefetch}/common/link1.css`,
          `http://127.0.0.1:${ports.prefetch}/common/link1.css`,
          'http://not-exist.com/xxx.css'
        ],
      }
    })
  })

  afterAll(() => {
    return releaseAllEffect()
  })

  /**
   * 场景：排入非数组 123 和合法应用数组两次 preFetch 调用。
   * 只等 100ms 后结束，没有资源、Map 或日志断言；默认工作需空闲回调后再等 3000ms。
   * 此正文验证调用形式能排队，未等待数组校验、实例创建或资源完成。
   */
  test('coverage branch for prefetch', async () => {
    preFetch(123 as any) // 非法的入参
    preFetch([{ name: 'test-app1', url: 'http://www.micro-app-test.com' }]) // 正常入参
    await new Promise((resolve) => {
      setTimeout(() => {
        resolve(true)
      }, 100)
    })
  })

  /**
   * 场景：beforeAll 给全局 JS/CSS 配置重复本地 URL 与失败 URL，本例立即通过旧 globalLinks/globalScripts 读取缓存。
   * 要求两项 not.toBeNull，再等 100ms；当前模块已改用 sourceCenter，没有导出这两个旧接口。
   * 保留原测试供历史对照，导入本身与本版本不匹配，不能据此报告全局缓存加载通过。
   */
  test('globalAssets should work normal', async () => {
    expect(globalLinks.get(`http://127.0.0.1:${ports.prefetch}/common/link1.css`)).not.toBeNull()
    expect(globalScripts.get(`http://127.0.0.1:${ports.prefetch}/common/script1.js`)).not.toBeNull()
    await new Promise((resolve) => {
      setTimeout(() => {
        resolve(true)
      }, 100)
    })
  })

  /**
   * 场景：beforeAll 已 start 单例，再传新 tagName 与空 globalAssets 对象调用 start。
   * 本例没有断言；hasInit 使调用在重复启动检查处返回。
   * 实际未进入空 globalAssets 的资源分支。
   */
  test('coverage branch of globalAssets', () => {
    microApp.start({
      tagName: 'micro-app-global-assets',
      globalAssets: {}
    })
  })

  /**
   * 场景：调用 preFetch，数组中只有一个字符串 aa，测试函数随即返回。
   * 没有等待默认延时，也没有状态或日志断言。
   * 真正处理该项时 preFetchAction 会以非对象跳过，但本例正文未观察该异步校验结果。
   */
  test('coverage branch: Invalid prefetch params', () => {
    preFetch(['aa' as any])
  })
})
