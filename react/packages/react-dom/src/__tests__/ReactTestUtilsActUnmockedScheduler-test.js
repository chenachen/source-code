/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

// 健全性测试：确认 act() 在没有 mock Scheduler 时也能工作。

let React;
let ReactDOMClient;
let act;
let container;
let yields;
let prevActGlobal;

/** 返回本轮 effect 日志，并换成新数组供后续调用记录。 */
function clearLog() {
  try {
    return yields;
  } finally {
    yields = [];
  }
}

beforeEach(() => {
  prevActGlobal = global.IS_REACT_ACT_ENVIRONMENT;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.resetModules();
  jest.unmock('scheduler');
  yields = [];
  React = require('react');
  ReactDOMClient = require('react-dom/client');
  act = React.act;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = prevActGlobal;
  document.body.removeChild(container);
});

// @gate __DEV__
/** 使用真实 Scheduler 与 DEV act 环境，首次提交仅含 effect 的 App；await act 后日志应是 [100]，验证 act 自身会冲刷被动 effect。 */
test('can use act to flush effects', async () => {
  /** 挂载时在被动 effect 写入 100，返回 null 隔离 DOM 更新对 act 冲刷效果的影响。 */
  function App() {
    React.useEffect(() => {
      yields.push(100);
    });
    return null;
  }

  const root = ReactDOMClient.createRoot(container);
  await act(() => {
    root.render(<App />);
  });

  expect(clearLog()).toEqual([100]);
});

// @gate __DEV__
/** 计数按钮首次 effect 记录 0；一个 act 连点三次只产生最终 3 的 effect，后两个独立 act 分别记录 4 和 5，最终按钮为 5，验证每轮 act 批次都提交并冲刷对应 effect。 */
test('flushes effects on every call', async () => {
  /** 用计数按钮安排函数式增量，并在每次提交的 effect 记录最终计数，区分单次批处理和多轮 act。 */
  function App() {
    const [ctr, setCtr] = React.useState(0);
    React.useEffect(() => {
      yields.push(ctr);
    });
    return (
      <button id="button" onClick={() => setCtr(x => x + 1)}>
        {ctr}
      </button>
    );
  }

  const root = ReactDOMClient.createRoot(container);
  await act(() => {
    root.render(<App />);
  });

  expect(clearLog()).toEqual([0]);

  const button = container.querySelector('#button');
  /** 在同一 button 上派发冒泡 click，由根事件监听器调用当前 onClick。 */
  function click() {
    button.dispatchEvent(new MouseEvent('click', {bubbles: true}));
  }

  act(() => {
    click();
    click();
    click();
  });
  // 合并 3 次更新后，再触发 effect。
  expect(clearLog()).toEqual([3]);
  act(click);
  expect(clearLog()).toEqual([4]);
  act(click);
  expect(clearLog()).toEqual([5]);
  expect(button.innerHTML).toEqual('5');
});

// @gate __DEV__
/** 组件初始计数 0，effect 在计数小于 5 时继续安排函数式更新；一个 await act 后 DOM 应为 5，验证 act 持续消费由 effect 新增的提交工作。 */
test("should keep flushing effects until they're done", async () => {
  /** effect 在计数不足 5 时继续更新，构造需要 act 持续冲刷的级联提交。 */
  function App() {
    const [ctr, setCtr] = React.useState(0);
    React.useEffect(() => {
      if (ctr < 5) {
        setCtr(x => x + 1);
      }
    });
    return ctr;
  }

  const root = ReactDOMClient.createRoot(container);
  await act(() => {
    root.render(<App />);
  });

  expect(container.innerHTML).toEqual('5');
});

// @gate __DEV__
/** 在外层 async act 内再 await 内层 act 挂载组件；内层返回时 effect 日志仍空，最外层退出后才记录 0，验证嵌套 act 的冲刷归属外层作用域。 */
test('should flush effects only on exiting the outermost act', async () => {
  /** effect 仅记录 0，以日志是否出现区分内层 act 返回和最外层作用域退出。 */
  function App() {
    React.useEffect(() => {
      yields.push(0);
    });
    return null;
  }
  const root = ReactDOMClient.createRoot(container);
  // 嵌套几层 act() 调用。
  await act(async () => {
    await act(() => {
      root.render(<App />);
    });
    // 此时仍在 act() 作用域内，因此 effect 尚未 yield。
    expect(clearLog()).toEqual([]);
  });
  // 退出最外层 act() 后，effects 才会被冲刷。
  expect(clearLog()).toEqual([0]);
});

// @gate __DEV__
/** effect 每轮安排等待一个微任务的 ticker，ticker 用嵌套 act 增加状态；依赖 Math.min(state,4) 让 state=5 停止新增 effect，日志应为 0..4 且 DOM 5，验证级联 Promise 工作被外层 act 完整等待。 */
test('can handle cascading promises', async () => {
  // 此组件触发一个 effect；effect 等待一个 tick 后设置 state，并重复 5 次。
  /** effect 记录当前状态并启动 ticker，依赖被 Math.min 截断后停止新增工作，使 Promise 级联有限结束。 */
  function App() {
    const [state, setState] = React.useState(0);
    /** 等一个微任务后，在嵌套 act 中推进 state，使外层 act 能等待这轮提交。 */
    async function ticker() {
      await null;
      await act(() => {
        setState(x => x + 1);
      });
    }
    React.useEffect(() => {
      yields.push(state);
      ticker();
    }, [Math.min(state, 4)]);
    return state;
  }

  const root = ReactDOMClient.createRoot(container);
  await act(() => {
    root.render(<App />);
  });
  // 所有五次 tick 都存在并已计入。
  expect(clearLog()).toEqual([0, 1, 2, 3, 4]);
  expect(container.innerHTML).toBe('5');
});
