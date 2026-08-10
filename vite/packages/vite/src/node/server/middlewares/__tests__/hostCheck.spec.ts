import { expect, test } from 'vitest'
import { getAdditionalAllowedHosts } from '../hostCheck'

/**
 * 场景：dev host、HMR host、server.origin 和 preview host 同时显式配置。
 * 验证目标：确认它们的 hostname 都自动进入允许列表，origin 只取 hostname、不携带协议和端口。
 */
test('getAdditionalAllowedHosts', async () => {
  const actual = getAdditionalAllowedHosts(
    {
      host: 'vite.host.example.com',
      ws: {
        host: 'vite.hmr-host.example.com',
      },
      origin: 'http://vite.origin.example.com:5173',
    },
    {
      host: 'vite.preview-host.example.com',
    },
  ).sort()
  expect(actual).toStrictEqual(
    [
      'vite.host.example.com',
      'vite.hmr-host.example.com',
      'vite.origin.example.com',
      'vite.preview-host.example.com',
    ].sort(),
  )
})
