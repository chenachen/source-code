'use strict';

// 独立 Node 进程中的源码加载器；只转换相邻 packages，绝不回退到 npm React。
/** 读取教程与本地源码，不生成或覆盖生产文件。 */
const fs = require('node:fs');
/** 将模块身份规范化为当前工作树中的绝对路径。 */
const path = require('node:path');
/** 在独立进程内安装并最终恢复 CommonJS 解析与转换 hook。 */
const Module = require('node:module');
/** 使断言失败以非零退出码传递给复跑命令。 */
const assert = require('node:assert/strict');
/** 执行锁定版本的 Flow、JSX 与 CommonJS 转换。 */
const babel = require('@babel/core');
/** 先用 Hermes 解析 Flow，避免 Babel 默认 parser 不支持新 Flow 语法。 */
const hermes = require('hermes-parser');
/** 提供测试 DOM 与 MutationObserver，不模拟浏览器绘制。 */
const {JSDOM} = require('jsdom');
/** 所有 React workspace 实现必须来自这个相邻源码目录。 */
const sourceRoot = path.resolve(__dirname, '../../packages');
/** 定位与源码同仓的教程，避免执行过时的示例副本。 */
const repositoryRoot = path.resolve(__dirname, '../../..');
/** 记录实际转换的本地模块，用于执行来源断言。 */
const loadedSources = new Set();
/** 固定 stable DEV 入口、客户端共享 internals 与 DOM renderer fork。 */
const aliases = {
  react: 'react/index.stable.development.js',
  'shared/ReactSharedInternals': 'react/src/ReactSharedInternalsClient.js',
  'shared/ReactDOMSharedInternals': 'react-dom/src/ReactDOMSharedInternals.js',
  'react-reconciler/src/ReactFiberConfig': 'react-reconciler/src/forks/ReactFiberConfig.dom.js',
};
/** 识别本仓 workspace 包名，禁止它们回退到 npm 实现。 */
const sourcePackages = new Set(fs.readdirSync(sourceRoot));
/** 保留原始解析器，在 finally 中恢复进程内状态。 */
const originalResolve = Module._resolveFilename;
/** 保留普通 JS 加载行为，工具依赖不经过源码转换。 */
const originalJS = Module._extensions['.js'];
/** 显式注入本次 stable development 渠道的构建常量。 */
const globals = {
  __DEV__: true, __EXPERIMENTAL__: false, __PROFILE__: false,
  __VARIANT__: false, __NEXT_MAJOR__: false,
};
Object.assign(globalThis, globals);
process.env.NODE_ENV = 'development';

// 对照 scripts/jest/setupHostConfigs.js 的 DOM fork 与共享 internals 注入。
// scheduler 使用真实 packages/scheduler/index.js，未使用 Jest 或 scheduler mock。
/** 将 bare imports 与相对 HostConfig 导入统一指向选定源码 fork。 */
Module._resolveFilename = function (request, parent, ...rest) {
  if (aliases[request]) request = path.join(sourceRoot, aliases[request]);
  else if (sourcePackages.has(request.split('/')[0])) request = path.join(sourceRoot, request);
  const resolved = originalResolve.call(this, request, parent, ...rest);
  const relative = path.relative(sourceRoot, resolved).replaceAll(path.sep, '/');
  const fork = aliases[relative.replace(/\.js$/, '')];
  return fork ? path.join(sourceRoot, fork) : resolved;
};

/** 把 Flow/JSX AST 转为 CommonJS；禁用仓库 Babel 配置以固定最小转换集合。 */
function transform(source, filename) {
  const ast = hermes.parse(source, {babel: true});
  return babel.transformFromAstSync(ast, source, {
    filename, babelrc: false, configFile: false,
    plugins: [
      require.resolve('@babel/plugin-transform-flow-strip-types'),
      [require.resolve('@babel/plugin-transform-react-jsx'), {runtime: 'automatic'}],
      require.resolve('@babel/plugin-transform-modules-commonjs'),
    ],
  }).code;
}
/** 仅转换 React packages 内文件，并登记实际执行的源码身份。 */
Module._extensions['.js'] = function (mod, filename) {
  if (!filename.startsWith(sourceRoot + path.sep)) return originalJS(mod, filename);
  loadedSources.add(path.relative(sourceRoot, filename));
  mod._compile(transform(fs.readFileSync(filename, 'utf8'), filename), filename);
};

/** 本轮验证独占的 DOM，测试结束时关闭以清理定时任务与资源。 */
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/', pretendToBeVisual: true,
});
for (const key of ['window', 'document', 'MutationObserver', 'MouseEvent', 'HTMLElement', 'Node']) {
  globalThis[key] = dom.window[key];
}
Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true});

/** 执行原教程与 Context 对照，再核验本地源码来源；任一失败由外层报告非零退出。 */
async function run() {
  // 从教程提取正在展示的完整模块，防止副本与教程发生漂移。
  const guidePath = path.join(repositoryRoot, 'share/react/client-rendering-19.3.0/index.html');
  const guideDOM = new JSDOM(fs.readFileSync(guidePath, 'utf8'));
  const demo = guideDOM.window.document.querySelector('#demo pre code').textContent;
  guideDOM.window.close();
  assert.match(demo, /await main\(\);\s*$/);
  // Node CommonJS harness 唯一适配：把模块尾部顶层 await 改为导出 main，外部 await。
  const executable = demo.replace(/await main\(\);\s*$/, 'module.exports = main;');
  const example = new Module(path.join(__dirname, 'guide-demo.jsx'), module);
  example.filename = path.join(__dirname, 'guide-demo.jsx');
  example.paths = module.paths;
  example._compile(transform(executable, example.filename), example.filename);
  await example.exports();
  assert.equal(document.body.childNodes.length, 0, 'demo removes its container');
  console.log('PASS guide #demo: initial count 0; A,B,C -> C,A,B; count 1; button and A/B/C DOM identities retained; root/container cleanup');

  await require('./context-example.cjs')();
  for (const entry of ['react/index.stable.development.js', 'react-dom/client.js', 'react-reconciler/src/ReactFiberWorkLoop.js', 'scheduler/src/forks/Scheduler.js']) {
    assert(loadedSources.has(entry), `must execute local source: ${entry}`);
  }
  const npmReact = Object.keys(require.cache).filter(file => /node_modules\/(react|react-dom|react-reconciler|scheduler)\//.test(file));
  assert.deepEqual(npmReact, [], 'no npm React implementation may be loaded');
  console.log(`PASS provenance: ${loadedSources.size} local source modules; no npm React/ReactDOM/reconciler/scheduler`);
  console.log('Configuration: DEV=true EXPERIMENTAL=false PROFILE=false; default ReactFeatureFlags; DOM host config; real Scheduler; jsdom (not a browser)');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  dom.window.close();
  Module._resolveFilename = originalResolve;
  Module._extensions['.js'] = originalJS;
});
