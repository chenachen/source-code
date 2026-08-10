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

/** `clearLog`：封装当前用例复用的操作、回调或断言步骤。 */
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
/**
 * 代表场景（Given–When–Then）：
 * Given 当前文件已建立所需 DOM、React 根与测试夹具；
 * When 执行「can use act to flush effects」描述的渲染或交互；
 * Then 通过本用例的 DOM、日志或调度断言确认行为。
 *
 * 验证机制：断言覆盖 ReactTestUtils.act 到 React.act 的兼容转发与调度冲刷。
 */
test('can use act to flush effects', async () => {
  /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
/** 测试场景：验证「flushes effects on every call」描述的渲染、交互或错误处理结果。 */
test('flushes effects on every call', async () => {
  /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
  /** `click`：封装当前用例复用的操作、回调或断言步骤。 */
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
/** 测试场景：验证「should keep flushing effects until they're done」描述的渲染、交互或错误处理结果。 */
test("should keep flushing effects until they're done", async () => {
  /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
/** 测试场景：验证「should flush effects only on exiting the outermost act」描述的渲染、交互或错误处理结果。 */
test('should flush effects only on exiting the outermost act', async () => {
  /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
/** 测试场景：验证「can handle cascading promises」描述的渲染、交互或错误处理结果。 */
test('can handle cascading promises', async () => {
  // 此组件触发一个 effect；effect 等待一个 tick 后设置 state，并重复 5 次。
  /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
  function App() {
    const [state, setState] = React.useState(0);
    /** `App.ticker`：封装当前用例复用的操作、回调或断言步骤。 */
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
