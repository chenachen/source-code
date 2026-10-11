// importer 的 package.json 明确声明 commonjs。
// 动态导入带 __esModule 的 CJS 采用此场景的 Node 互操作语义，default 对应整个 module.exports。
import('@vitejs/test-dep-cjs-compiled-from-esm').then((ns) => {
  const ok =
    typeof ns.default.default === 'function' && ns.default.default() === 'foo'
  document.querySelector('.cjs-dynamic-importer-cjs').textContent = ok
    ? 'ok'
    : 'fail'
})
