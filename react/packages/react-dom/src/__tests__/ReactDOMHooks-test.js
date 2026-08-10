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
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「can ReactDOM.render() from useEffect」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('can ReactDOM.render() from useEffect', async () => {
    const container2 = document.createElement('div');
    const container3 = document.createElement('div');

    /** `Example1`：封装当前用例复用的操作、回调或断言步骤。 */
    function Example1({n}) {
      React.useEffect(() => {
        ReactDOM.render(<Example2 n={n} />, container2);
      });
      return 1 * n;
    }

    /** `Example2`：封装当前用例复用的操作、回调或断言步骤。 */
    function Example2({n}) {
      React.useEffect(() => {
        ReactDOM.render(<Example3 n={n} />, container3);
      });
      return 2 * n;
    }

    /** `Example3`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「can render() from useEffect」描述的渲染、交互或错误处理结果。 */
  it('can render() from useEffect', async () => {
    const container2 = document.createElement('div');
    const container3 = document.createElement('div');

    const root1 = ReactDOMClient.createRoot(container);
    const root2 = ReactDOMClient.createRoot(container2);
    const root3 = ReactDOMClient.createRoot(container3);

    /** `Example1`：封装当前用例复用的操作、回调或断言步骤。 */
    function Example1({n}) {
      React.useEffect(() => {
        root2.render(<Example2 n={n} />);
      });
      return 1 * n;
    }

    /** `Example2`：封装当前用例复用的操作、回调或断言步骤。 */
    function Example2({n}) {
      React.useEffect(() => {
        root3.render(<Example3 n={n} />);
      });
      return 2 * n;
    }

    /** `Example3`：封装当前用例复用的操作、回调或断言步骤。 */
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
  /** 测试场景：验证「should not bail out when an update is scheduled from within an event handler」描述的渲染、交互或错误处理结果。 */
  it('should not bail out when an update is scheduled from within an event handler', () => {
    const {createRef, useCallback, useState} = React;

    /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
    const Example = ({inputRef, labelRef}) => {
      const [text, setText] = useState('');
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

  /** 测试场景：验证「should not bail out when an update is scheduled from within an event handler in Concurrent Mode」描述的渲染、交互或错误处理结果。 */
  it('should not bail out when an update is scheduled from within an event handler in Concurrent Mode', async () => {
    const {createRef, useCallback, useState} = React;

    /** `Example`：封装当前用例复用的操作、回调或断言步骤。 */
    const Example = ({inputRef, labelRef}) => {
      const [text, setText] = useState('');
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
