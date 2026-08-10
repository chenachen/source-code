'use strict';

// 条件导出命中 RSC 时立即拒绝客户端根 API；错误字符串属于公共诊断契约。
throw new Error(
  'react-dom/client is not supported in React Server Components.'
);
