/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React;
let ReactDOM;
let ReactDOMClient;
let act;
let waitForAll;

describe('ReactDOMHooks', () => {
  let container;

  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
    waitForAll = require('internal-test-utils').waitForAll;

    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  // @gate !disableLegacyMode

  /** legacy 根的 Example1 effect 渲染第二根，其 effect 再渲染第三根；初次同步 DOM 仅第一根为 1，冲刷后为 1/2/3。n=2 更新时后两根仍旧值，冲刷后为 2/4/6，验证跨根 effect 链在被动阶段继续调度。 */
  it('can ReactDOM.render() from useEffect', async () => {
    const container2 = document.createElement('div');
    const container3 = document.createElement('div');

    /** legacy 第一根组件输出 n，并在 effect 用 ReactDOM.render 推进第二根。 */
    function Example1({n}) {
      React.useEffect(() => {
        ReactDOM.render(<Example2 n={n} />, container2);
      });
      return 1 * n;
    }

    /** legacy 第二根输出 2*n，并在其 effect 推进第三根，形成连续被动调度链。 */
    function Example2({n}) {
      React.useEffect(() => {
        ReactDOM.render(<Example3 n={n} />, container3);
      });
      return 2 * n;
    }

    /** legacy 第三根只输出 3*n，作为跨根 effect 链的末端。 */
    function Example3({n}) {
      return 3 * n;
    }

    ReactDOM.render(<Example1 n={1} />, container);
    expect(container.textContent).toBe('1');
    expect(container2.textContent).toBe('');
    expect(container3.textContent).toBe('');
    await waitForAll([]);
    expect(container.textContent).toBe('1');
    expect(container2.textContent).toBe('2');
    expect(container3.textContent).toBe('3');

    ReactDOM.render(<Example1 n={2} />, container);
    expect(container.textContent).toBe('2');
    expect(container2.textContent).toBe('2'); // 尚未冲刷
    expect(container3.textContent).toBe('3'); // 尚未冲刷
    await waitForAll([]);
    expect(container.textContent).toBe('2');
    expect(container2.textContent).toBe('4');
    expect(container3.textContent).toBe('6');
  });

  /** 三个并发根串联 effect 渲染，先传 n=1 再传 n=2；act/调度冲刷后对应 DOM 为 1/2/3 与 2/4/6，验证 effect 内 root.render 能连续推进其它根。 */
  it('can render() from useEffect', async () => {
    const container2 = document.createElement('div');
    const container3 = document.createElement('div');

    const root1 = ReactDOMClient.createRoot(container);
    const root2 = ReactDOMClient.createRoot(container2);
    const root3 = ReactDOMClient.createRoot(container3);

    /** 并发第一根输出 n，effect 在独立 root2 提交 Example2。 */
    function Example1({n}) {
      React.useEffect(() => {
        root2.render(<Example2 n={n} />);
      });
      return 1 * n;
    }

    /** 并发第二根输出 2*n，effect 在独立 root3 提交 Example3。 */
    function Example2({n}) {
      React.useEffect(() => {
        root3.render(<Example3 n={n} />);
      });
      return 2 * n;
    }

    /** 并发第三根输出 3*n，供最终三个容器的比例值比较。 */
    function Example3({n}) {
      return 3 * n;
    }

    await act(() => {
      root1.render(<Example1 n={1} />);
    });
    await waitForAll([]);
    expect(container.textContent).toBe('1');
    expect(container2.textContent).toBe('2');
    expect(container3.textContent).toBe('3');

    await act(() => {
      root1.render(<Example1 n={2} />);
    });
    await waitForAll([]);
    expect(container.textContent).toBe('2');
    expect(container2.textContent).toBe('4');
    expect(container3.textContent).toBe('6');
  });

  // @gate !disableLegacyMode

  /** legacy 挂载 input 与 state 驱动 label，程序写 input.value=abc 再派发 input；label 应同步变 abc，验证 useCallback handler 安排的 Hook 更新不会因错误 bailout 丢失。 */
  it('should not bail out when an update is scheduled from within an event handler', () => {
    const {createRef, useCallback, useState} = React;

    /** legacy 输入 fixture 用 Hook state 驱动 label；input 回调从原生 target 取值安排更新。 */
    const Example = ({inputRef, labelRef}) => {
      const [text, setText] = useState('');
      /** 从当前 input 事件读值并安排 Hook 更新，检查 legacy 事件批次能提交新 label。 */
      const handleInput = useCallback(event => {
        setText(event.target.value);
      });

      return (
        <>
          <input ref={inputRef} onInput={handleInput} />
          <label ref={labelRef}>{text}</label>
        </>
      );
    };

    const inputRef = createRef();
    const labelRef = createRef();

    ReactDOM.render(
      <Example inputRef={inputRef} labelRef={labelRef} />,
      container,
    );

    inputRef.current.value = 'abc';
    inputRef.current.dispatchEvent(
      new Event('input', {bubbles: true, cancelable: true}),
    );

    expect(labelRef.current.innerHTML).toBe('abc');
  });

  /** 并发根挂载同样输入 fixture，等待初次提交后写 value=abc 并在 act 中派发 input；label 最终应为 abc，验证并发事件更新也能越过 bailout 并提交。 */
  it('should not bail out when an update is scheduled from within an event handler in Concurrent Mode', async () => {
    const {createRef, useCallback, useState} = React;

    /** 并发输入 fixture 用 Hook state 驱动 label，外部对象 ref 提供程序赋值与结果读取节点。 */
    const Example = ({inputRef, labelRef}) => {
      const [text, setText] = useState('');
      /** 并发根的 input handler 保存原生 target.value，后续 act 检查 Hook 更新未被 bailout 丢弃。 */
      const handleInput = useCallback(event => {
        setText(event.target.value);
      });

      return (
        <>
          <input ref={inputRef} onInput={handleInput} />
          <label ref={labelRef}>{text}</label>
        </>
      );
    };

    const inputRef = createRef();
    const labelRef = createRef();

    const root = ReactDOMClient.createRoot(container);
    root.render(<Example inputRef={inputRef} labelRef={labelRef} />);

    await waitForAll([]);

    inputRef.current.value = 'abc';
    await act(() => {
      inputRef.current.dispatchEvent(
        new Event('input', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(labelRef.current.innerHTML).toBe('abc');
  });
});
