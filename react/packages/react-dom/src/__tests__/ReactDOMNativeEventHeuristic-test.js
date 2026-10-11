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

  /** 在派发前把event赋给window.event，finally清为undefined，让更新优先级可模拟浏览器当前原生事件；不恢复先前event值。 */
  function dispatchAndSetCurrentEvent(el, event) {
    try {
      window.event = event;
      el.dispatchEvent(event);
    } finally {
      window.event = undefined;
    }
  }

  /** 布局effect安装原生Disable onclick，Form初active=true；派click并等act微任务后Submit ref为null，验证从window.event识别离散原生事件并及时提交移除；本例未向已移除按钮再派事件。 */
  it('ignores discrete events on a pending removed element', async () => {
    const disableButtonRef = React.createRef();
    const submitButtonRef = React.createRef();

    /** 初active=true，布局effect安装原生Disable onclick；关闭状态时Submit元素从树删除。 */
    function Form() {
      const [active, setActive] = React.useState(true);

      React.useLayoutEffect(() => {
        disableButtonRef.current.onclick = disableForm;
      });

      /** 设active=false，触发离散点击产生的节点移除。 */
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

  /** 两按钮始终存在，Disable原生onclick使active=false；同act内显式flushSync后再点Submit，formSubmitted=false，验证提交布局effect已替换原生处理器为禁用实现。 */
  it('ignores discrete events on a pending removed event listener', async () => {
    const disableButtonRef = React.createRef();
    const submitButtonRef = React.createRef();

    let formSubmitted = false;

    /** 两按钮保持存在，布局effect按active替换Submit.onclick，测试显式flush后的原生监听更新。 */
    function Form() {
      const [active, setActive] = React.useState(true);

      React.useLayoutEffect(() => {
        disableButtonRef.current.onclick = disableForm;
        submitButtonRef.current.onclick = active
          ? submitForm
          : disabledSubmitForm;
      });

      /** 设active=false，等待flushSync提交后禁用原生Submit处理器。 */
      function disableForm() {
        setActive(false);
      }

      /** 置formSubmitted=true，禁用之后不应再执行旧提交函数。 */
      function submitForm() {
        formSubmitted = true; // 这不应该被调用
      }

      /** 禁用态原生onclick空操作，代替旧submit函数。 */
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

  /** 初active=false且Submit.onclick=null；Enable click后flushSync再Submit click，formSubmitted=true，验证离散更新提交安装最新原生处理器。 */
  it('uses the newest discrete events on a pending changed event listener', async () => {
    const enableButtonRef = React.createRef();
    const submitButtonRef = React.createRef();

    let formSubmitted = false;

    /** 初active=false，Enable原生click开启并在layout安装Submit handler。 */
    function Form() {
      const [active, setActive] = React.useState(false);

      React.useLayoutEffect(() => {
        enableButtonRef.current.onclick = enableForm;
        submitButtonRef.current.onclick = active ? submitForm : null;
      });

      /** 设active=true，让flushSync之后安装有效提交函数。 */
      function enableForm() {
        setActive(true);
      }

      /** 置formSubmitted=true，本用例开启后应被调用。 */
      function submitForm() {
        formSubmitted = true; // 启用后应调用最新安装的提交处理器。
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

  /** 布局effect安装原生mouseover更新isHover；事件后flushSync仍not hovered，act结束hovered，验证连续优先级不是离散同步更新。 */
  it('mouse over should be user-blocking but not discrete', async () => {
    const root = ReactDOMClient.createRoot(container);

    const target = React.createRef(null);
    /** 原生mouseover更新isHover，以DOM文字检查连续调度时序。 */
    function Foo() {
      const [isHover, setHover] = React.useState(false);
      React.useLayoutEffect(() => {
        /** 设hover=true，事件优先级从window.event而非React合成handler包装获得。 */
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

  /** 布局effect安装原生mouseenter更新isHover；flushSync时文字未变，act结束hovered，验证即使React插件不监听原生mouseenter也可从window.event判连续优先级。 */
  it('mouse enter should be user-blocking but not discrete', async () => {
    const root = ReactDOMClient.createRoot(container);

    const target = React.createRef(null);
    /** 原生mouseenter更新isHover，测试未用于React插件注册的原生名称也有优先级映射。 */
    function Foo() {
      const [isHover, setHover] = React.useState(false);
      React.useLayoutEffect(() => {
        /** 设hover=true，flushSync时尚不能把连续更新当离散提交。 */
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
      // mouseenter/mouseover 使用连续事件优先级，flushSync 不会冲刷这项连续更新。
      expect(container.textContent).toEqual('not hovered');
    });
    expect(container.textContent).toEqual('hovered');
  });

  /** 原生addEventListener mouseover内root.render(hovered=true)；立即无Scheduler日志/文字未变，waitFor后hovered，验证连续更新在后续调度提交；本例没有调用flushSync。 */
  it('continuous native events flush as expected', async () => {
    const root = ReactDOMClient.createRoot(container);

    const target = React.createRef(null);
    /** 按hovered props记录Scheduler并输出文字，供原生监听内root.render后的调度断言。 */
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

      // 此处仅检查派发后的即时状态，尚未等待连续更新调度；本例没有调用flushSync。
      assertLog([]);
      expect(container.textContent).toEqual('not hovered');

      await waitFor(['hovered']);
      expect(container.textContent).toEqual('hovered');
    });
    expect(container.textContent).toEqual('hovered');
  });

  /** 原生onclick连续两次setCount(countRef.current+1)，ref仅layout更新；act结束Count:1而非2，验证事件内两次读取同已提交值并批处理。 */
  it('should batch inside native events', async () => {
    const root = ReactDOMClient.createRoot(container);

    const target = React.createRef(null);
    /** 布局同步countRef后安装onclick，两次setState读相同已提交ref，验证批处理。 */
    function Foo() {
      const [count, setCount] = React.useState(0);
      const countRef = React.useRef(-1);

      React.useLayoutEffect(() => {
        countRef.current = count;
        /** 连续两次设置countRef.current+1；两次之间无提交则相同值，最终只增加一次。 */
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

  /** 原生onclick中unstable_batchedUpdates设count+1后立即记DOM；退出该包装仍Count:0，act微任务后Count:1，验证外层batch返回不是离散提交边界。 */
  it('should not flush discrete events at the end of outermost batchedUpdates', async () => {
    const root = ReactDOMClient.createRoot(container);

    let target;
    /** 把count闭包捕获在原生onclick，记录unstable_batchedUpdates返回后仍旧DOM。 */
    function Foo() {
      const [count, setCount] = React.useState(0);
      return (
        <div
          ref={el => {
            target = el;
            if (target !== null) {
              /** 在batch中更新count，再立即读取旧DOM日志，验证batch退出不会在该点同步提交。 */
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
