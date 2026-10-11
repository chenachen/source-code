import { expect, test } from 'vitest'
import { defaultAllowedOrigins } from '../constants'

/**
 * 默认 CORS 正则应接受表中的 localhost 子域、IPv4/IPv6 回环及带端口来源，
 * 拒绝伪装的 localhost 后缀、非回环保留地址、文件协议和普通主机。
 */
test('defaultAllowedOrigins', () => {
  const allowed = [
    'http://localhost',
    'http://foo.localhost',
    'http://localhost:3000',
    'https://localhost:3000',
    'http://127.0.0.1',
    'http://[::1]',
    'http://[::1]:3000',
  ]
  const denied = [
    'file:///foo',
    'http://localhost.example.com',
    'http://foo.example.com:localhost',
    'http://',
    'http://192.0.2',
    'http://[2001:db8::1]',
    'http://vite',
    'http://vite:3000',
  ]

  for (const origin of allowed) {
    expect(defaultAllowedOrigins.test(origin), origin).toBe(true)
  }

  for (const origin of denied) {
    expect(defaultAllowedOrigins.test(origin), origin).toBe(false)
  }
})
