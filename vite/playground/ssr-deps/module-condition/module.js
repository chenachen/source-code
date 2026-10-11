// 内容是 ESM，但本包的 .js 会被 Node 视为 CommonJS。Node 外部加载不启用 module 条件，
// 正确的 SSR external 解析应选择 import.mjs，不读取这个错误条件出口。
export default '[fail] should not load me'
