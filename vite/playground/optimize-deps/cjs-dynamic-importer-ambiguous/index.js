// importer 最近的 package.json 没有 type，模块格式不明确。
// 动态导入带 __esModule 的 CJS 时，此场景期待 default 对应 module.exports.default。
import('@vitejs/test-dep-cjs-compiled-from-esm').then((ns) => {
  const ok = typeof ns.default === 'function' && ns.default() === 'foo'
  document.querySelector('.cjs-dynamic-importer-ambiguous').textContent = ok
    ? 'ok'
    : 'fail'
})
