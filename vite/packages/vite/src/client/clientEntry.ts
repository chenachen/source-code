// middleware 模式的 client.mjs 公共入口。client.ts 为 bundled-dev 复用而额外导出 transport、
// registerBundledDevClient 等内部绑定；通过这一薄包装，避免它们泄漏到 `/@vite/client` 公共 API。
export {
  createHotContext,
  injectQuery,
  removeStyle,
  updateStyle,
  ErrorOverlay,
} from './client'
