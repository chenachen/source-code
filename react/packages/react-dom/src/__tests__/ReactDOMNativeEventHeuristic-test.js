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
let Scheduler;
let act;
let assertLog;
let waitFor;

describe('ReactDOMNativeEventHeuristic-test', () => {
  let container;

  beforeEach(() => {
    jest.resetModules();
    container = document.createElement('div');
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;
    waitFor = InternalTestUtils.waitFor;

    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  /** `dispatchAndSetCurrentEvent`：封装当前用例复用的操作、回调或断言步骤。 */
  function dispatchAndSetCurrentEvent(el, event) {
    try {
      window.event = event;
      el.dispatchEvent(event);
    } finally {
      window.event = undefined;
    }
  }

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「ignores discrete events on a pending removed element」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：事件断言连接 DOMPluginEventSystem 的委托、合成与传播路径。
   */
  it('ignores discrete events on a pending removed element', async () => {
    const disableButtonRef = React.createRef();
    const submitButtonRef = React.createRef();

    /** `Form`：封装当前用例复用的操作、回调或断言步骤。 */
    function Form() {
      const [active, setActive] = React.useState(true);

      React.useLayoutEffect(() => {
        disableButtonRef.current.onclick = disableForm;
      });

      /** `Form.disableForm`：封装当前用例复用的操作、回调或断言步骤。 */
      function disableForm() {
        setActive(false);
      }

      return (
        <div>
          <button ref={disableButtonRef}>Disable</button>
          {active ? <button ref={submitButtonRef}>Submit</button> : null}
        </div>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Form />);
    });

    const disableButton = disableButtonRef.current;
    expect(disableButton.tagName).toBe('BUTTON');

    // 在 Disable 按钮上派发 click 事件。
    await act(async () => {
      const firstEvent = document.createEvent('Event');
      firstEvent.initEvent('click', true, true);
      dispatchAndSetCurrentEvent(disableButton, firstEvent);
    });
    // 离散事件应在微任务中冲刷；验证第二个按钮已移除。
    expect(submitButtonRef.current).toBe(null);
    // 我们假设浏览器不会允许用户点击它。
  });

  /** 测试场景：验证「ignores discrete events on a pending removed event listener」描述的渲染、交互或错误处理结果。 */
  it('ignores discrete events on a pending removed event listener', async () => {
    const disableButtonRef = React.createRef();
    const submitButtonRef = React.createRef();

    let formSubmitted = false;

    /** `Form`：封装当前用例复用的操作、回调或断言步骤。 */
    function Form() {
      const [active, setActive] = React.useState(true);

      React.useLayoutEffect(() => {
        disableButtonRef.current.onclick = disableForm;
        submitButtonRef.current.onclick = active
          ? submitForm
          : disabledSubmitForm;
      });

      /** `Form.disableForm`：封装当前用例复用的操作、回调或断言步骤。 */
      function disableForm() {
        setActive(false);
      }

      /** `Form.submitForm`：封装当前用例复用的操作、回调或断言步骤。 */
      function submitForm() {
        formSubmitted = true; // 这不应该被调用
      }

      /** `Form.disabledSubmitForm`：封装当前用例复用的操作、回调或断言步骤。 */
      function disabledSubmitForm() {
        // 表单已禁用。
      }

      return (
        <div>
          <button ref={disableButtonRef}>Disable</button>
          <button ref={submitButtonRef}>Submit</button>
        </div>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    // 冲刷。
    await act(() => root.render(<Form />));

    const disableButton = disableButtonRef.current;
    expect(disableButton.tagName).toBe('BUTTON');

    // 在 Disable 按钮上派发 click 事件。
    const firstEvent = document.createEvent('Event');
    firstEvent.initEvent('click', true, true);
    await act(() => {
      dispatchAndSetCurrentEvent(disableButton, firstEvent);

      // 此时应已有禁用表单的待处理更新；并发模式下它尚未冲刷。
      const submitButton = submitButtonRef.current;
      expect(submitButton.tagName).toBe('BUTTON');

      // 冲刷离散事件
      ReactDOM.flushSync();

      // 现在让我们在提交按钮上触发事件。
      const secondEvent = document.createEvent('Event');
      secondEvent.initEvent('click', true, true);
      dispatchAndSetCurrentEvent(submitButton, secondEvent);
    });

    // 因此表单绝不应被提交。
    expect(formSubmitted).toBe(false);
  });

  /** 测试场景：验证「uses the newest discrete events on a pending changed event listener」描述的渲染、交互或错误处理结果。 */
  it('uses the newest discrete events on a pending changed event listener', async () => {
    const enableButtonRef = React.createRef();
    const submitButtonRef = React.createRef();

    let formSubmitted = false;

    /** `Form`：封装当前用例复用的操作、回调或断言步骤。 */
    function Form() {
      const [active, setActive] = React.useState(false);

      React.useLayoutEffect(() => {
        enableButtonRef.current.onclick = enableForm;
        submitButtonRef.current.onclick = active ? submitForm : null;
      });

      /** `Form.enableForm`：封装当前用例复用的操作、回调或断言步骤。 */
      function enableForm() {
        setActive(true);
      }

      /** `Form.submitForm`：封装当前用例复用的操作、回调或断言步骤。 */
      function submitForm() {
        formSubmitted = true; // 这不应该被调用
      }

      return (
        <div>
          <button ref={enableButtonRef}>Enable</button>
          <button ref={submitButtonRef}>Submit</button>
        </div>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<Form />));

    const enableButton = enableButtonRef.current;
    expect(enableButton.tagName).toBe('BUTTON');

    // 在 Enable 按钮上派发 click 事件。
    await act(() => {
      const firstEvent = document.createEvent('Event');
      firstEvent.initEvent('click', true, true);
      dispatchAndSetCurrentEvent(enableButton, firstEvent);

      // 此时应已有启用表单的待处理更新；并发模式下它尚未冲刷。
      const submitButton = submitButtonRef.current;
      expect(submitButton.tagName).toBe('BUTTON');

      // 冲刷离散更新。
      ReactDOM.flushSync();

      // 现在让我们在提交按钮上触发事件。
      const secondEvent = document.createEvent('Event');
      secondEvent.initEvent('click', true, true);
      dispatchAndSetCurrentEvent(submitButton, secondEvent);
    });

    // 因此表单应已提交。
    expect(formSubmitted).toBe(true);
  });

  /** 测试场景：验证「mouse over should be user-blocking but not discrete」描述的渲染、交互或错误处理结果。 */
  it('mouse over should be user-blocking but not discrete', async () => {
    const root = ReactDOMClient.createRoot(container);

    const target = React.createRef(null);
    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      const [isHover, setHover] = React.useState(false);
      React.useLayoutEffect(() => {
        target.current.onmouseover = () => setHover(true);
      });
      return <div ref={target}>{isHover ? 'hovered' : 'not hovered'}</div>;
    }

    await act(() => {
      root.render(<Foo />);
    });
    expect(container.textContent).toEqual('not hovered');

    await act(() => {
      const mouseOverEvent = document.createEvent('MouseEvents');
      mouseOverEvent.initEvent('mouseover', true, true);
      dispatchAndSetCurrentEvent(target.current, mouseOverEvent);

      // 冲刷离散更新。
      ReactDOM.flushSync();
      // mouseover 不是离散事件，因此此时不应更新。
      expect(container.textContent).toEqual('not hovered');
    });
    expect(container.textContent).toEqual('hovered');
  });

  /** 测试场景：验证「mouse enter should be user-blocking but not discrete」描述的渲染、交互或错误处理结果。 */
  it('mouse enter should be user-blocking but not discrete', async () => {
    const root = ReactDOMClient.createRoot(container);

    const target = React.createRef(null);
    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      const [isHover, setHover] = React.useState(false);
      React.useLayoutEffect(() => {
        target.current.onmouseenter = () => setHover(true);
      });
      return <div ref={target}>{isHover ? 'hovered' : 'not hovered'}</div>;
    }

    await act(() => {
      root.render(<Foo />);
    });
    expect(container.textContent).toEqual('not hovered');

    await act(() => {
      // 注意：React 不使用原生的 mouseenter/mouseleave 事件，但我们仍然应该正确确定它们的优先级。
      const mouseEnterEvent = document.createEvent('MouseEvents');
      mouseEnterEvent.initEvent('mouseenter', true, true);
      dispatchAndSetCurrentEvent(target.current, mouseEnterEvent);

      // 冲刷离散更新。
      ReactDOM.flushSync();
      // 由于 mouse end 不是离散事件，此时尚不应完成更新。
      expect(container.textContent).toEqual('not hovered');
    });
    expect(container.textContent).toEqual('hovered');
  });

  /** 测试场景：验证「continuous native events flush as expected」描述的渲染、交互或错误处理结果。 */
  it('continuous native events flush as expected', async () => {
    const root = ReactDOMClient.createRoot(container);

    const target = React.createRef(null);
    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo({hovered}) {
      const hoverString = hovered ? 'hovered' : 'not hovered';
      Scheduler.log(hoverString);
      return <div ref={target}>{hoverString}</div>;
    }

    await act(() => {
      root.render(<Foo hovered={false} />);
    });
    expect(container.textContent).toEqual('not hovered');

    assertLog(['not hovered']);
    await act(async () => {
      // 注意：React 不使用原生的 mouseenter/mouseleave 事件，但我们仍然应该正确确定它们的优先级。
      const mouseEnterEvent = document.createEvent('MouseEvents');
      mouseEnterEvent.initEvent('mouseover', true, true);
      target.current.addEventListener('mouseover', () => {
        root.render(<Foo hovered={true} />);
      });
      dispatchAndSetCurrentEvent(target.current, mouseEnterEvent);

      // 由于 mouse end 不是离散事件，此时尚不应完成更新。
      assertLog([]);
      expect(container.textContent).toEqual('not hovered');

      await waitFor(['hovered']);
      expect(container.textContent).toEqual('hovered');
    });
    expect(container.textContent).toEqual('hovered');
  });

  /** 测试场景：验证「should batch inside native events」描述的渲染、交互或错误处理结果。 */
  it('should batch inside native events', async () => {
    const root = ReactDOMClient.createRoot(container);

    const target = React.createRef(null);
    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      const [count, setCount] = React.useState(0);
      const countRef = React.useRef(-1);

      React.useLayoutEffect(() => {
        countRef.current = count;
        target.current.onclick = () => {
          setCount(countRef.current + 1);
          // 再次更新。若这些更新被批处理，由于尚未重新渲染且 `countRef` 未变化，这一步应为空操作。
          setCount(countRef.current + 1);
        };
      });
      return <div ref={target}>Count: {count}</div>;
    }

    await act(() => {
      root.render(<Foo />);
    });
    expect(container.textContent).toEqual('Count: 0');

    await act(async () => {
      const pressEvent = document.createEvent('Event');
      pressEvent.initEvent('click', true, true);
      dispatchAndSetCurrentEvent(target.current, pressEvent);
    });
    // 如果这是 2，这意味着 `setCount` 调用没有被批处理。
    expect(container.textContent).toEqual('Count: 1');
  });

  /** 测试场景：验证「should not flush discrete events at the end of outermost batchedUpdates」描述的渲染、交互或错误处理结果。 */
  it('should not flush discrete events at the end of outermost batchedUpdates', async () => {
    const root = ReactDOMClient.createRoot(container);

    let target;
    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      const [count, setCount] = React.useState(0);
      return (
        <div
          ref={el => {
            target = el;
            if (target !== null) {
              el.onclick = () => {
                ReactDOM.unstable_batchedUpdates(() => {
                  setCount(count + 1);
                });
                Scheduler.log(
                  container.textContent + ' [after batchedUpdates]',
                );
              };
            }
          }}>
          Count: {count}
        </div>
      );
    }

    await act(() => {
      root.render(<Foo />);
    });
    expect(container.textContent).toEqual('Count: 0');

    await act(async () => {
      const pressEvent = document.createEvent('Event');
      pressEvent.initEvent('click', true, true);
      dispatchAndSetCurrentEvent(target, pressEvent);
      assertLog(['Count: 0 [after batchedUpdates]']);
      expect(container.textContent).toEqual('Count: 0');
    });
    expect(container.textContent).toEqual('Count: 1');
  });
});
