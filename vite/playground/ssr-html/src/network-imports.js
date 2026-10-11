// 固定端口与 playground/test-utils.ts 的 ssr-html 端口一致。
import slash from 'http://localhost:9602/slash@3.0.0.js'

// 也可手动改用下方公共地址测试；当前测试使用本地服务。
// import slash from 'https://esm.sh/slash@3.0.0'

export { slash }
