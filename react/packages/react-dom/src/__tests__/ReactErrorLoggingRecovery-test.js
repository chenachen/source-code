/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

// 这是一个针对 https://github.com/facebook/react/issues/13188. 的回归测试，它重现了导致问题的
// 组合条件。

if (global.window) {
  throw new Error('This test must run in a Node environment.');
}

// 该问题仅在 React 加载之前加载 JSDOM 时出现。
const React = require('react');
/** `ReactDOMClient`：保存当前测试场景复用的夹具、状态或回调。 */
const ReactDOMClient = require('react-dom/client');
/** `Scheduler`：保存当前测试场景复用的夹具、状态或回调。 */
const Scheduler = require('scheduler');

// 初始化 JSDOM 单独进行。 我们不使用正常的 JS DOM 设置，因为我们要先加载 React。
const {JSDOM} = require('jsdom');
global.requestAnimationFrame = setTimeout;
global.cancelAnimationFrame = clearTimeout;
/** `jsdom`：保存当前测试场景复用的夹具、状态或回调。 */
const jsdom = new JSDOM(`<div id="app-root"></div>`);
global.window = jsdom.window;
global.document = jsdom.window.document;
global.navigator = jsdom.window.navigator;

/** `Bad`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
class Bad extends React.Component {
  /** `Bad.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
  componentDidUpdate() {
    throw new Error('no');
  }
  /** `Bad.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
  render() {
    return null;
  }
}

/** `fakeAct`：封装当前用例复用的操作、回调或断言步骤。 */
async function fakeAct(cb) {
  // 我们在这里不使用 act/waitForThrow，因为我们要观察错误是如何被实际报告的。
  await cb();
  Scheduler.unstable_flushAll();
}

describe('ReactErrorLoggingRecovery', () => {
  const originalConsoleError = console.error;

  beforeEach(() => {
    console.error = error => {
      throw new Error('Buggy console.error');
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should recover from errors in console.error」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should recover from errors in console.error', async function () {
    const div = document.createElement('div');
    const root = ReactDOMClient.createRoot(div);
    await fakeAct(() => {
      root.render(<Bad />);
    });
    await fakeAct(() => {
      root.render(<Bad />);
    });

    expect(() => jest.runAllTimers()).toThrow('');

    await fakeAct(() => {
      root.render(<span>Hello</span>);
    });
    expect(div.firstChild.textContent).toBe('Hello');
  });
});
