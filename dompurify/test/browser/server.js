/**
 * 为 Playwright 和 legacy runner 提供仓库文件的本地 HTTP 入口。
 * 以 DOMPurify 仓库为根，从同一源加载测试 HTML、ESM fixture、node_modules 和 dist；
 * 仅监听回环地址。响应不缓存，便于不同构建复用同一套件时读取当前磁盘内容。
 */

'use strict';

/** 查询文件状态并读取测试页面、依赖与构建产物。 */
const fs = require('fs');
/** 创建本地静态服务器，供浏览器页面和 runner 的就绪探测共同访问。 */
const http = require('http');
/** 解析请求路径并检查其与仓库根目录的关系。 */
const path = require('path');

/** URL 路径的文件系统基准：由 test/browser 向上两层回到 DOMPurify 根。 */
const ROOT = path.resolve(__dirname, '..', '..');
/** 本地监听端口；环境变量 PORT 与外层 Playwright/legacy runner 必须使用同一值，默认 9877。 */
const PORT = Number.parseInt(process.env.PORT || '9877', 10);

/** 按扩展名选择固定 Content-Type；模块脚本需 JavaScript 类型，未知扩展名用二进制回退。 */
const MIME = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ts': 'application/javascript; charset=utf-8',
});

/**
 * 结束请求并返回纯文本状态码，错误正文不回显请求路径。
 * @param res - 尚未发送响应头的 HTTP 响应。
 * @param status - URL、目录范围或文件读取阶段选定的错误码。
 */
function sendError(res, status) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(String(status));
}

/**
 * 检查已解析路径是否等于根目录，或在字符串路径层面位于根目录之内。
 * path.relative 的父级/绝对路径结果会拒绝；此检查不解析符号链接指向。
 * @param child - path.resolve 生成的候选绝对路径。
 * @param parent - 允许读取的仓库根。
 * @returns 候选通过路径包含关系时为 true，随后仍需 stat 确認是文件。
 */
function isInside(child, parent) {
  if (child === parent) return true;
  const rel = path.relative(parent, child);
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** 共享的 HTTP server；每个请求按 URL → 路径范围 → 文件状态 → 内容读取顺序处理。 */
const server = http.createServer((req, res) => {
  // URL 解析异常先返回 400，未进入任何文件系统访问。pathname 本身不做额外 decodeURIComponent。
  let urlPath;
  try {
    urlPath = new URL(req.url || '/', 'http://127.0.0.1').pathname;
  } catch (_) {
    return sendError(res, 400);
  }

  // 以相对的 . + pathname 拼到仓库根，再检查折叠后的绝对路径；越界时在 stat/readFile 前结束。
  const resolved = path.resolve(ROOT, '.' + urlPath);

  if (!isInside(resolved, ROOT)) {
    return sendError(res, 403);
  }

  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) return sendError(res, 404);

    // 目录与不存在路径返回 404；类型取固定表，读取过程中失败另返回 500，不发送半个成功响应。
    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    fs.readFile(resolved, (readErr, data) => {
      if (readErr) return sendError(res, 500);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(data);
    });
  });
});

// 启动回调只记录地址；请求处理保持异步，不阻塞其他页面资源的加载。
server.listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`test server listening on http://127.0.0.1:${PORT}`);
});

// 终止信号先停止接收请求；close 回调完成后退出，外层 legacy runner 可用 child.kill 触发。
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}