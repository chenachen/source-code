'use strict';

// 实验客户端测试 API 不能跨入 RSC 条件，加载时直接给出稳定诊断。
throw new Error(
  'react-dom/unstable_testing is not supported in React Server Components.'
);
