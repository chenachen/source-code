import { getInjectedMsg } from '@vitejs/test-dep-with-injected-import'

try {
  document.querySelector('.injected-import-in-optimized-dep').textContent =
    getInjectedMsg()
} catch {
  // 仅开发态优化依赖请求会被注入 import，构建态允许此调用失败。
}
