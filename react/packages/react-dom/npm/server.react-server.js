'use strict';

// RSC 条件不提供 HTML server renderer；该适配器不是 `react-server` 的完整 Fizz 实现。
throw new Error(
  'react-dom/server is not supported in React Server Components.'
);
