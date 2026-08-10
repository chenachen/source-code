/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

describe('ReactDOMComponentTree', () => {
  let React;
  let ReactDOMClient;
  let act;
  let container;
  let assertConsoleErrorDev;

  beforeEach(() => {
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;

    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    container = null;
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「finds nodes for instances on events」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('finds nodes for instances on events', async () => {
    const mouseOverID = 'mouseOverID';
    const clickID = 'clickID';
    let currentTargetID = null;
    // 当前事件的目标设置为通过 `getNodeFromInstance` 获取的结果，这样我们可以通过在树中调用事件来
    // 测试行为，并确认预期的目标节点被设置为当前目标。
    /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
    function Component() {
      /** `Component.handler`：封装当前用例复用的操作、回调或断言步骤。 */
      const handler = e => {
        currentTargetID = e.currentTarget.id;
      };

      return (
        <div id={mouseOverID} onMouseOver={handler}>
          <div id={clickID} onClick={handler} />
        </div>
      );
    }

    /** `simulateMouseEvent`：封装当前用例复用的操作、回调或断言步骤。 */
    function simulateMouseEvent(elem, type) {
      const event = new MouseEvent(type, {
        bubbles: true,
      });
      elem.dispatchEvent(event);
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component />);
    });
    expect(currentTargetID).toBe(null);
    simulateMouseEvent(document.getElementById(mouseOverID), 'mouseover');
    expect(currentTargetID).toBe(mouseOverID);
    simulateMouseEvent(document.getElementById(clickID), 'click');
    expect(currentTargetID).toBe(clickID);
  });

  /** 测试场景：验证「finds closest instance for node when an event happens」描述的渲染、交互或错误处理结果。 */
  it('finds closest instance for node when an event happens', async () => {
    const nonReactElemID = 'aID';
    const innerHTML = {__html: `<div id="${nonReactElemID}"></div>`};
    const closestInstanceID = 'closestInstance';
    let currentTargetID = null;

    /** `ClosestInstance`：封装当前用例复用的操作、回调或断言步骤。 */
    function ClosestInstance() {
      /** `ClosestInstance.onClick`：封装当前用例复用的操作、回调或断言步骤。 */
      const onClick = e => {
        currentTargetID = e.currentTarget.id;
      };

      return (
        <div
          id={closestInstanceID}
          onClick={onClick}
          dangerouslySetInnerHTML={innerHTML}
        />
      );
    }

    /** `simulateClick`：封装当前用例复用的操作、回调或断言步骤。 */
    function simulateClick(elem) {
      const event = new MouseEvent('click', {
        bubbles: true,
      });
      elem.dispatchEvent(event);
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <section>
          <ClosestInstance />
        </section>,
      );
    });
    expect(currentTargetID).toBe(null);
    simulateClick(document.getElementById(nonReactElemID));
    expect(currentTargetID).toBe(closestInstanceID);
  });

  /** 测试场景：验证「updates event handlers from fiber props」描述的渲染、交互或错误处理结果。 */
  it('updates event handlers from fiber props', async () => {
    let action = '';
    let flip;
    /** `handlerA`：封装当前用例复用的操作、回调或断言步骤。 */
    const handlerA = () => (action = 'A');
    /** `handlerB`：封装当前用例复用的操作、回调或断言步骤。 */
    const handlerB = () => (action = 'B');

    /** `simulateMouseOver`：封装当前用例复用的操作、回调或断言步骤。 */
    function simulateMouseOver(target) {
      const event = new MouseEvent('mouseover', {
        bubbles: true,
      });
      target.dispatchEvent(event);
    }

    /** `HandlerFlipper`：封装当前用例复用的操作、回调或断言步骤。 */
    function HandlerFlipper() {
      const [flipVal, setFlipVal] = React.useState(false);
      flip = () => setFlipVal(true);

      return <div id="update" onMouseOver={flipVal ? handlerB : handlerA} />;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<HandlerFlipper key="1" />);
    });
    const node = container.firstChild;

    await act(() => {
      simulateMouseOver(node);
    });
    expect(action).toEqual('A');
    action = '';

    // 渲染其他事件处理器。
    await act(() => {
      flip();
    });
    await act(() => {
      simulateMouseOver(node);
    });
    expect(action).toEqual('B');
  });

  /** 测试场景：验证「finds a controlled instance from node and gets its current fiber props」描述的渲染、交互或错误处理结果。 */
  it('finds a controlled instance from node and gets its current fiber props', async () => {
    let inputRef;
    const inputID = 'inputID';
    const startValue = undefined;
    const finishValue = 'finish';

    /** `Controlled`：封装当前用例复用的操作、回调或断言步骤。 */
    function Controlled() {
      const [state, setState] = React.useState(startValue);
      const ref = React.useRef();
      inputRef = ref;
      /** `Controlled.onChange`：封装当前用例复用的操作、回调或断言步骤。 */
      const onChange = e => setState(e.currentTarget.value);

      return (
        <input
          id={inputID}
          type="text"
          ref={ref}
          value={state}
          onChange={onChange}
        />
      );
    }

    const setUntrackedInputValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set;

    /** `simulateInput`：封装当前用例复用的操作、回调或断言步骤。 */
    function simulateInput(elem, value) {
      const inputEvent = new Event('input', {
        bubbles: true,
      });
      setUntrackedInputValue.call(elem, value);
      elem.dispatchEvent(inputEvent);
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Controlled />);
    });

    await act(() => {
      simulateInput(inputRef.current, finishValue);
    });
    assertConsoleErrorDev([
      'A component is changing an uncontrolled input to be controlled. ' +
        'This is likely caused by the value changing from undefined to ' +
        'a defined value, which should not happen. ' +
        'Decide between using a controlled or uncontrolled input ' +
        'element for the lifetime of the component. More info: ' +
        'https://react.dev/link/controlled-components\n' +
        '    in input (at **)\n' +
        '    in Controlled (at **)',
    ]);
  });
});
