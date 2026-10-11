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
  // 把 ./ 开头路径传 isRelativeUrl；返回 true，点前缀归入本地资源分类。
  test('should return true when The first character of the string path is .', () => {
    const url = './**.vue'
    const result = isRelativeUrl(url)
    expect(result).toBe(true)
  })

  // 把 ~/ 开头路径传 isRelativeUrl；返回 true，兼容构建工具的模块资源前缀。
  test('should return true when The first character of the string path is ~', () => {
    const url = '~/xx.vue'
    const result = isRelativeUrl(url)
    expect(result).toBe(true)
  })

  // 把 @/ alias 路径传 isRelativeUrl；返回 true，该判断是前缀分类而非文件系统解析。
  test('should return true when The first character of the string path is @', () => {
    const url = '@/xx.vue'
    const result = isRelativeUrl(url)
    expect(result).toBe(true)
  })
})

// 外部 URL：覆盖小写 http/https 与协议相对地址。
describe('compiler sfc:templateUtils isExternalUrl', () => {
  // http URL 传 isExternalUrl；协议前缀匹配并返回 true。
  test('should return true when String starts with http://', () => {
    const url = 'http://vuejs.org/'
    const result = isExternalUrl(url)
    expect(result).toBe(true)
  })

  // https URL 传 isExternalUrl；同样匹配外部协议路径。
  test('should return true when String starts with https://', () => {
    const url = 'https://vuejs.org/'
    const result = isExternalUrl(url)
    expect(result).toBe(true)
  })

  // 协议相对 // URL 传 isExternalUrl；无需显式协议也归为外链。
  test('should return true when String starts with //', () => {
    const url = '//vuejs.org/'
    const result = isExternalUrl(url)
    expect(result).toBe(true)
  })
})

// data URL 按 data: 前缀识别；以下测试无媒体类型、带媒体类型与 base64 标记，不校验载荷格式。
describe('compiler sfc:templateUtils isDataUrl', () => {
  // data:,i 没有媒体类型和编码标记；仅凭 data: 前缀返回 true，不验证载荷格式。
  test('should return true w/ hasn`t media type and encode', () => {
    expect(isDataUrl('data:,i')).toBe(true)
  })

  // 带 image/png 与 base64 标记的 data URL；前缀分类返回 true。
  test('should return true w/ media type + encode', () => {
    expect(isDataUrl('data:image/png;base64,i')).toBe(true)
  })

  // 带媒体类型但无 base64 标记的 data URL；仍归为 data 资源。
  test('should return true w/ media type + hasn`t encode', () => {
    expect(isDataUrl('data:image/png,i')).toBe(true)
  })
})
