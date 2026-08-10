/* eslint-disable dot-notation */

// Fizz 外部 runtime 的浏览器指令集入口。

import {
  clientRenderBoundary,
  completeBoundary,
  completeBoundaryWithStyles,
  completeSegment,
  listenToFormSubmissionsForReplaying,
  revealCompletedBoundaries,
  revealCompletedBoundariesWithViewTransitions,
} from './ReactDOMFizzInstructionSetShared';

// 使用字符串键，避免 Closure 高级编译模式改写协议名称；external-runtime-plugin
// 会在构建时把它们替换为局部引用。
window['$RM'] = new Map();
window['$RB'] = [];
window['$RX'] = clientRenderBoundary;
window['$RV'] = revealCompletedBoundariesWithViewTransitions.bind(
  null,
  revealCompletedBoundaries,
);
window['$RC'] = completeBoundary;
window['$RR'] = completeBoundaryWithStyles;
window['$RS'] = completeSegment;

listenToFormSubmissionsForReplaying();

/** shell 首次绘制的 PerformanceEntry 列表；为空时退回下一帧时间。 */
const entries = performance.getEntriesByType
  ? performance.getEntriesByType('paint')
  : [];
if (entries.length > 0) {
  // 外部 runtime 加载前可能已经绘制；优先读取首个 paint 指标，避免再增加揭示延迟。
  window['$RT'] = entries[0].startTime;
} else {
  // 尚无 paint 指标时，用下一次 rAF 记录近似 shell 绘制时间。
  requestAnimationFrame(() => {
    window['$RT'] = performance.now();
  });
}
