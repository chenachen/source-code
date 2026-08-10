import {clientRenderBoundary} from './ReactDOMFizzInstructionSetShared';

// 使用字符串键，避免 Closure 高级编译模式重命名该协议全局变量。
// eslint-disable-next-line dot-notation
window['$RX'] = clientRenderBoundary;
