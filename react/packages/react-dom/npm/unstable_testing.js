'use strict';

/**
 * 让 React DevTools 验证实验测试生产 bundle 是否经过死代码消除。
 * 保留唯一 `^_^` 哨兵字符串；DevTools 以它识别错误压缩，不能复制或改写。
 */
function checkDCE() {
  /* global __REACT_DEVTOOLS_GLOBAL_HOOK__ */
  if (
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined' ||
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== 'function'
  ) {
    return;
  }
  if (process.env.NODE_ENV !== 'production') {
    // 此函数只在生产分支调用，而条件仅在开发环境成立；若代码仍存在，说明 DCE 未正确执行。
    // 不得改写或在本函数其他位置复制消息，否则 React DevTools 会产生误判。
    throw new Error('^_^');
  }
  try {
    // 通知 DevTools 检查上方哨兵分支是否已被消除。
    __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(checkDCE);
  } catch (err) {
    // DevTools 钩子异常不能中断 React 加载，但仍输出错误以暴露集成故障。
    console.error(err);
  }
}

if (process.env.NODE_ENV === 'production') {
  // 必须在 ReactDOM bundle 执行前检查，DevTools 才能在注入阶段报告错误压缩。
  checkDCE();
  module.exports = require('./cjs/react-dom-unstable_testing.production.js');
} else {
  module.exports = require('./cjs/react-dom-unstable_testing.development.js');
}
