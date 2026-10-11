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

  /** 外层 div 注册 mouseover、内层 div 注册 click；分别派发后 currentTarget.id 应对应实际持有 handler 的节点，验证 Fiber listener 记录映射回宿主 DOM。 */
  it('finds nodes for instances on events', async () => {
    const mouseOverID = 'mouseOverID';
    const clickID = 'clickID';
    let currentTargetID = null;
    // 当前事件的目标设置为通过 `getNodeFromInstance` 获取的结果，这样我们可以通过在树中调用事件来
    // 测试行为，并确认预期的目标节点被设置为当前目标。

    /** 输出分别监听 mouseover/click 的嵌套 div，以 currentTarget 的 id 检查实例到节点映射。 */
    function Component() {

      /** 保存调用该 handler 的 currentTarget.id；原生 target 可不同，断言针对监听器所在宿主。 */
      const handler = e => {
        currentTargetID = e.currentTarget.id;
      };

      return (
        <div id={mouseOverID} onMouseOver={handler}>
          <div id={clickID} onClick={handler} />
        </div>
      );
    }

    /** 向传入元素派发指定类型的冒泡 MouseEvent，让根监听器进入常规插件路径。 */
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

  /** 向 dangerouslySetInnerHTML 创建且无自身 Fiber 的内部 div 派发 click；外层 React div handler 的 currentTarget 应是 closestInstance，验证沿 DOM 祖先找到最近受管实例。 */
  it('finds closest instance for node when an event happens', async () => {
    const nonReactElemID = 'aID';
    const innerHTML = {__html: `<div id="${nonReactElemID}"></div>`};
    const closestInstanceID = 'closestInstance';
    let currentTargetID = null;

    /** 把原生 HTML 子节点放在有 click handler 的受管 div 内，制造无直接 Fiber 缓存的事件目标。 */
    function ClosestInstance() {

      /** 保存最近受管祖先的 currentTarget.id，证明派发不是把 innerHTML 子节点当 React 宿主。 */
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

    /** 向无 Fiber 的 HTML 节点派发冒泡 click，迫使最近实例查询沿 DOM 祖先扫描。 */
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

  /** 同一个宿主 div 初次 onMouseOver 为 A，通过 Hook 更新切换为 B 后再次派发；action 应从 A 变 B，验证事件系统读取节点缓存的最新 props 而非初次绑定闭包。 */
  it('updates event handlers from fiber props', async () => {
    let action = '';
    let flip;

    /** 将 action 设 A，表示初次提交的 props handler 被执行。 */
    const handlerA = () => (action = 'A');

    /** 将 action 设 B，表示更新后的最新 props handler 被执行。 */
    const handlerB = () => (action = 'B');

    /** 通过同一 DOM 节点派发冒泡 mouseover，排除节点重建对 handler 切换断言的影响。 */
    function simulateMouseOver(target) {
      const event = new MouseEvent('mouseover', {
        bubbles: true,
      });
      target.dispatchEvent(event);
    }

    /** 以 Hook state 在同一 div 上切换 A/B 回调，并把一次性切换函数发布给 case。 */
    function HandlerFlipper() {
      const [flipVal, setFlipVal] = React.useState(false);
      /** 把 Hook 状态设 true，让后续提交将节点 props 缓存的 mouseover handler 从 A 换 B。 */
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

  /** input 初始 value=undefined，绕过 React tracker 的原型 setter 写 finish 后派发 input；onChange 使用 currentTarget 更新 Hook，DEV 应报告非受控转受控，验证从 DOM 找实例并恢复当前 props 的完整路径。 */
  it('finds a controlled instance from node and gets its current fiber props', async () => {
    let inputRef;
    const inputID = 'inputID';
    const startValue = undefined;
    const finishValue = 'finish';

    /** 初始 value 未定义的输入 fixture，onChange 读取当前节点值后转成受控，触发当前 props 恢复路径。 */
    function Controlled() {
      const [state, setState] = React.useState(startValue);
      const ref = React.useRef();
      inputRef = ref;

      /** 把合成事件 currentTarget.value 写入 Hook state，更新后 value 从 undefined 变为 finish。 */
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

    /** 调用 HTMLInputElement 原型 setter 绕过 React 实例 tracker，再派发 input，模拟可被变更检测识别的浏览器写值。 */
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
