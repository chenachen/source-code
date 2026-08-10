/**
 * 模板 URL 分类工具场景：区分相对路径、协议/协议相对外链和 data URL；这些判断决定资产
 * 转换器是生成模块 import、直接保留，还是交给 base 路径拼接。
 */
import {
  isDataUrl,
  isExternalUrl,
  isRelativeUrl,
} from '../src/template/templateUtils'

// 相对 URL：识别 `.`、`~`、`@` 等本地资源前缀，同时排除绝对和协议路径。
describe('compiler sfc:templateUtils isRelativeUrl', () => {
  test('should return true when The first character of the string path is .', () => {
    const url = './**.vue'
    const result = isRelativeUrl(url)
    expect(result).toBe(true)
  })

  test('should return true when The first character of the string path is ~', () => {
    const url = '~/xx.vue'
    const result = isRelativeUrl(url)
    expect(result).toBe(true)
  })

  test('should return true when The first character of the string path is @', () => {
    const url = '@/xx.vue'
    const result = isRelativeUrl(url)
    expect(result).toBe(true)
  })
})

// 外部 URL：覆盖显式协议、协议相对地址及大小写，不把 Windows 路径误判为协议。
describe('compiler sfc:templateUtils isExternalUrl', () => {
  test('should return true when String starts with http://', () => {
    const url = 'http://vuejs.org/'
    const result = isExternalUrl(url)
    expect(result).toBe(true)
  })

  test('should return true when String starts with https://', () => {
    const url = 'https://vuejs.org/'
    const result = isExternalUrl(url)
    expect(result).toBe(true)
  })

  test('should return true when String starts with //', () => {
    const url = '//vuejs.org/'
    const result = isExternalUrl(url)
    expect(result).toBe(true)
  })
})

// data URL：只识别合法媒体类型/参数/base64 结构，避免把普通冒号路径跳过 import。
describe('compiler sfc:templateUtils isDataUrl', () => {
  test('should return true w/ hasn`t media type and encode', () => {
    expect(isDataUrl('data:,i')).toBe(true)
  })

  test('should return true w/ media type + encode', () => {
    expect(isDataUrl('data:image/png;base64,i')).toBe(true)
  })

  test('should return true w/ media type + hasn`t encode', () => {
    expect(isDataUrl('data:image/png,i')).toBe(true)
  })
})
