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

/** 先在无window的Node环境导入React，随后导入client renderer，最后才安装JSDOM全局对象；这个实际先后顺序是错误报告恢复回归的输入。 */
const React = require('react');

/** 在安装 JSDOM 全局对象之前加载 client renderer，重现错误报告恢复涉及的初始化顺序。 */
const ReactDOMClient = require('react-dom/client');

/** 手工冲刷渲染任务，保留真实错误报告路径而不使用 act 的错误拦截。 */
const Scheduler = require('scheduler');

/** 在React/client renderer加载之后取得JSDOM构造器，再手动安装window/document/navigator，保留Node导入阶段与后续DOM渲染阶段的环境切换。 */
const {JSDOM} = require('jsdom');
global.requestAnimationFrame = setTimeout;
global.cancelAnimationFrame = clearTimeout;

/** 为已经加载的 React DOM 补装窗口、document 与 navigator；该后装顺序是回归场景的必要输入。 */
const jsdom = new JSDOM(`<div id="app-root"></div>`);
global.window = jsdom.window;
global.document = jsdom.window.document;
global.navigator = jsdom.window.navigator;

/** 提供首次挂载正常、更新阶段抛错的类组件，触发同时失败的错误日志路径。 */
class Bad extends React.Component {

  /** 仅在第二轮同类型更新时抛 no，使首次挂载可作为后续恢复的起点。 */
  componentDidUpdate() {
    throw new Error('no');
  }

  /** 始终返回 null；测试通过更新生命周期制造异常，不把 DOM 输出失败混入错误来源。 */
  render() {
    return null;
  }
}

/** 先执行调用者操作，再直接冲刷 Scheduler；不经过 act/waitForThrow，以观察实际错误日志和定时器报告。 */
async function fakeAct(cb) {
  // 我们在这里不使用 act/waitForThrow，因为我们要观察错误是如何被实际报告的。
  await cb();
  Scheduler.unstable_flushAll();
}

describe('ReactErrorLoggingRecovery', () => {
  const originalConsoleError = console.error;

  beforeEach(() => {
    /** 模拟错误报告设施自身的失败：任何 console.error 调用都抛 Buggy console.error，测试随后检查根仍可恢复。 */
    console.error = error => {
      throw new Error('Buggy console.error');
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  /** 在 React 先于 JSDOM 加载的 Node 环境中，让 componentDidUpdate 与错误日志函数均抛错；更新后定时器冲刷应报告异常，随后仍能在同一根提交 Hello，验证错误报告自身失败不会永久破坏根的后续恢复。 */
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
