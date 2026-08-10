import {revealCompletedBoundariesWithViewTransitions} from './ReactDOMFizzInstructionSetShared';

// 将既有 revealCompletedBoundaries 指令升级为支持 ViewTransition 的包装器。
// 使用字符串键，避免 Closure 高级编译模式重命名该协议全局变量。
// eslint-disable-next-line dot-notation
window['$RV'] = revealCompletedBoundariesWithViewTransitions.bind(
  null,
  // eslint-disable-next-line dot-notation
  window['$RV'],
);
