'use strict';

// profiling renderer 不能在 RSC 条件中加载；入口用稳定错误阻止跨环境误用。
throw new Error(
  'react-dom/profiling is not supported in React Server Components.'
);
