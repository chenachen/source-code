import {
  revealCompletedBoundaries,
  completeBoundary,
} from './ReactDOMFizzInstructionSetShared';

// 使用字符串键，避免 Closure 高级编译模式重命名这些协议全局变量。
// eslint-disable-next-line dot-notation
window['$RB'] = [];
// eslint-disable-next-line dot-notation
window['$RV'] = revealCompletedBoundaries;
// eslint-disable-next-line dot-notation
window['$RC'] = completeBoundary;
