// 记录 shell 的绘制时间，供后续揭示节流计算使用。
requestAnimationFrame(() => {
  // eslint-disable-next-line dot-notation
  window['$RT'] = performance.now();
});
