'use strict';

// RSC 条件不提供静态 HTML 预渲染 API，加载时直接给出稳定诊断。
throw new Error(
  'react-dom/static is not supported in React Server Components.'
);
