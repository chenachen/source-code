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
let waitForAll;
let waitFor;
let waitForMicrotasks;
let assertLog;
let assertConsoleErrorDev;

/** `setUntrackedInputValue`：保存当前测试场景复用的夹具、状态或回调。 */
const setUntrackedInputValue = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'value',
).set;

describe('ReactDOMFiberAsync', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
    Scheduler = require('scheduler');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    waitFor = InternalTestUtils.waitFor;
    waitForMicrotasks = InternalTestUtils.waitForMicrotasks;
    assertLog = InternalTestUtils.assertLog;

    document.body.appendChild(container);
    window.event = undefined;
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  // @gate !disableLegacyMode
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「renders synchronously by default in legacy mode」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('renders synchronously by default in legacy mode', () => {
    const ops = [];
    ReactDOM.render(<div>Hi</div>, container, () => {
      ops.push(container.textContent);
    });
    ReactDOM.render(<div>Bye</div>, container, () => {
      ops.push(container.textContent);
    });
    expect(ops).toEqual(['Hi', 'Bye']);
  });

  /** 测试场景：验证「flushSync batches sync updates and flushes them at the end of the batch」描述的渲染、交互或错误处理结果。 */
  it('flushSync batches sync updates and flushes them at the end of the batch', async () => {
    const ops = [];
    let instance;

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.state`：记录测试夹具在当前场景中的状态。 */
      state = {text: ''};
      /** `Component.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        instance = this;
      }

      /** `Component.push`：实现测试夹具的生命周期、渲染或交互步骤。 */
      push(val) {
        this.setState(state => ({text: state.text + val}));
      }
      /** `Component.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        ops.push(this.state.text);
      }
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        instance = this;
        return <span>{this.state.text}</span>;
      }
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<Component />));

    await act(() => {
      instance.push('A');
    });

    expect(ops).toEqual(['A']);
    expect(container.textContent).toEqual('A');

    ReactDOM.flushSync(() => {
      instance.push('B');
      instance.push('C');
      // 尚未冲刷
      expect(container.textContent).toEqual('A');
      expect(ops).toEqual(['A']);
    });

    expect(container.textContent).toEqual('ABC');
    expect(ops).toEqual(['A', 'ABC']);
    await act(() => {
      instance.push('D');
    });
    expect(container.textContent).toEqual('ABCD');
    expect(ops).toEqual(['A', 'ABC', 'ABCD']);
  });

  /** 测试场景：验证「flushSync flushes updates even if nested inside another flushSync」描述的渲染、交互或错误处理结果。 */
  it('flushSync flushes updates even if nested inside another flushSync', async () => {
    const ops = [];
    let instance;

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.state`：记录测试夹具在当前场景中的状态。 */
      state = {text: ''};
      /** `Component.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        instance = this;
      }

      /** `Component.push`：实现测试夹具的生命周期、渲染或交互步骤。 */
      push(val) {
        this.setState(state => ({text: state.text + val}));
      }
      /** `Component.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        ops.push(this.state.text);
      }
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        instance = this;
        return <span>{this.state.text}</span>;
      }
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<Component />));

    await act(() => {
      instance.push('A');
    });
    expect(ops).toEqual(['A']);
    expect(container.textContent).toEqual('A');

    ReactDOM.flushSync(() => {
      instance.push('B');
      instance.push('C');
      // 尚未冲刷
      expect(container.textContent).toEqual('A');
      expect(ops).toEqual(['A']);

      ReactDOM.flushSync(() => {
        instance.push('D');
      });
      // 嵌套的 flushSync 导致所有待处理工作都被冲刷。
      expect(container.textContent).toEqual('ABCD');
      expect(ops).toEqual(['A', 'ABCD']);
    });
    expect(container.textContent).toEqual('ABCD');
    expect(ops).toEqual(['A', 'ABCD']);
  });

  /** 测试场景：验证「flushSync logs an error if already performing work」描述的渲染、交互或错误处理结果。 */
  it('flushSync logs an error if already performing work', async () => {
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        ReactDOM.flushSync();
      }
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    // 初始挂载
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component />);
    });
    // 更新。
    ReactDOM.flushSync(() => {
      root.render(<Component />);
    });
    assertConsoleErrorDev([
      'flushSync was called from inside a lifecycle method. ' +
        'React cannot flush when React is already rendering. ' +
        'Consider moving this call to a scheduler task or micro task.\n' +
        '    in Component (at **)',
    ]);
  });

  describe('concurrent mode', () => {
    /** 测试场景：验证「does not perform deferred updates synchronously」描述的渲染、交互或错误处理结果。 */
    it('does not perform deferred updates synchronously', async () => {
      const inputRef = React.createRef();
      const asyncValueRef = React.createRef();
      const syncValueRef = React.createRef();

      /** `Counter`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Counter extends React.Component {
        /** `Counter.state`：记录测试夹具在当前场景中的状态。 */
        state = {asyncValue: '', syncValue: ''};

        /** `Counter.handleChange`：封装当前用例复用的操作、回调或断言步骤。 */
        handleChange = e => {
          const nextValue = e.target.value;
          React.startTransition(() => {
            this.setState({
              asyncValue: nextValue,
            });
            // 此时尚未冲刷。
            expect(asyncValueRef.current.textContent).toBe('');
          });
          this.setState({
            syncValue: nextValue,
          });
        };

        /** `Counter.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return (
            <div>
              <input
                ref={inputRef}
                onChange={this.handleChange}
                defaultValue=""
              />
              <p ref={asyncValueRef}>{this.state.asyncValue}</p>
              <p ref={syncValueRef}>{this.state.syncValue}</p>
            </div>
          );
        }
      }
      const root = ReactDOMClient.createRoot(container);
      await act(() => root.render(<Counter />));
      expect(asyncValueRef.current.textContent).toBe('');
      expect(syncValueRef.current.textContent).toBe('');

      await act(() => {
        setUntrackedInputValue.call(inputRef.current, 'hello');
        inputRef.current.dispatchEvent(
          new MouseEvent('input', {bubbles: true}),
        );
      // 只应冲刷非 deferred 更新。
        expect(asyncValueRef.current.textContent).toBe('');
        expect(syncValueRef.current.textContent).toBe('hello');
      });

      // 现在应冲刷两次更新。
      expect(asyncValueRef.current.textContent).toBe('hello');
      expect(syncValueRef.current.textContent).toBe('hello');
    });

    /** 测试场景：验证「top-level updates are concurrent」描述的渲染、交互或错误处理结果。 */
    it('top-level updates are concurrent', async () => {
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div>Hi</div>);
        expect(container.textContent).toEqual('');
      });
      expect(container.textContent).toEqual('Hi');

      await act(() => {
        root.render(<div>Bye</div>);
        expect(container.textContent).toEqual('Hi');
      });
      expect(container.textContent).toEqual('Bye');
    });

    /** 测试场景：验证「deep updates (setState) are concurrent」描述的渲染、交互或错误处理结果。 */
    it('deep updates (setState) are concurrent', async () => {
      let instance;
      /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Component extends React.Component {
        /** `Component.state`：记录测试夹具在当前场景中的状态。 */
        state = {step: 0};
        /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          instance = this;
          return <div>{this.state.step}</div>;
        }
      }

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<Component />);
        expect(container.textContent).toEqual('');
      });
      expect(container.textContent).toEqual('0');

      await act(() => {
        instance.setState({step: 1});
        expect(container.textContent).toEqual('0');
      });
      expect(container.textContent).toEqual('1');
    });

    /** 测试场景：验证「flushSync flushes updates before end of the tick」描述的渲染、交互或错误处理结果。 */
    it('flushSync flushes updates before end of the tick', async () => {
      let instance;

      /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Component extends React.Component {
        /** `Component.state`：记录测试夹具在当前场景中的状态。 */
        state = {text: ''};
        /** `Component.push`：实现测试夹具的生命周期、渲染或交互步骤。 */
        push(val) {
          this.setState(state => ({text: state.text + val}));
        }
        /** `Component.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
        componentDidUpdate() {
          Scheduler.log(this.state.text);
        }
        /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          instance = this;
          return <span>{this.state.text}</span>;
        }
      }

      const root = ReactDOMClient.createRoot(container);
      await act(() => root.render(<Component />));

      // 默认情况下，更新是异步的。
      instance.push('A');
      assertLog([]);
      expect(container.textContent).toEqual('');

      ReactDOM.flushSync(() => {
        instance.push('B');
        instance.push('C');
        // 尚未冲刷
        expect(container.textContent).toEqual('');
        assertLog([]);
      });
      // 只有活跃的更新才被冲刷。
      expect(container.textContent).toEqual('ABC');
      assertLog(['ABC']);

      await act(() => {
        instance.push('D');
        expect(container.textContent).toEqual('ABC');
        assertLog([]);
      });
      assertLog(['ABCD']);
      expect(container.textContent).toEqual('ABCD');
    });

    /** 测试场景：验证「ignores discrete events on a pending removed element」描述的渲染、交互或错误处理结果。 */
    it('ignores discrete events on a pending removed element', async () => {
      const disableButtonRef = React.createRef();
      const submitButtonRef = React.createRef();

      /** `Form`：封装当前用例复用的操作、回调或断言步骤。 */
      function Form() {
        const [active, setActive] = React.useState(true);
        /** `Form.disableForm`：封装当前用例复用的操作、回调或断言步骤。 */
        function disableForm() {
          setActive(false);
        }

        return (
          <div>
            <button onClick={disableForm} ref={disableButtonRef}>
              Disable
            </button>
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

      const submitButton = submitButtonRef.current;
      expect(submitButton.tagName).toBe('BUTTON');

      // 在 Disable 按钮上派发 click 事件。
      const firstEvent = document.createEvent('Event');
      firstEvent.initEvent('click', true, true);
      disableButton.dispatchEvent(firstEvent);

      // 点击事件在并发模式下也是同步冲刷的。
      expect(submitButton.current).toBe(undefined);
    });

    /** 测试场景：验证「ignores discrete events on a pending removed event listener」描述的渲染、交互或错误处理结果。 */
    it('ignores discrete events on a pending removed event listener', async () => {
      const disableButtonRef = React.createRef();
      const submitButtonRef = React.createRef();

      let formSubmitted = false;

      /** `Form`：封装当前用例复用的操作、回调或断言步骤。 */
      function Form() {
        const [active, setActive] = React.useState(true);
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
            <button onClick={disableForm} ref={disableButtonRef}>
              Disable
            </button>
            <button
              onClick={active ? submitForm : disabledSubmitForm}
              ref={submitButtonRef}>
              Submit
            </button>
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
      const firstEvent = document.createEvent('Event');
      firstEvent.initEvent('click', true, true);
      await act(() => {
        disableButton.dispatchEvent(firstEvent);
      });

      // 此时应已有禁用表单的待处理更新；并发模式下它尚未冲刷。
      const submitButton = submitButtonRef.current;
      expect(submitButton.tagName).toBe('BUTTON');

      // 在此期间, 我们可以在提交按钮上发出一个新的客户端事件。
      const secondEvent = document.createEvent('Event');
      secondEvent.initEvent('click', true, true);
      // 这会强制冲刷待处理更新，从而在事件处理器调用前禁用提交按钮。
      await act(() => {
        submitButton.dispatchEvent(secondEvent);
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
            <button onClick={enableForm} ref={enableButtonRef}>
              Enable
            </button>
            <button onClick={active ? submitForm : null} ref={submitButtonRef}>
              Submit
            </button>
          </div>
        );
      }

      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Form />);
      });

      const enableButton = enableButtonRef.current;
      expect(enableButton.tagName).toBe('BUTTON');

      // 在 Enable 按钮上派发 click 事件。
      const firstEvent = document.createEvent('Event');
      firstEvent.initEvent('click', true, true);
      await act(() => {
        enableButton.dispatchEvent(firstEvent);
      });

      // 此时应已有启用表单的待处理更新；并发模式下它尚未冲刷。
      const submitButton = submitButtonRef.current;
      expect(submitButton.tagName).toBe('BUTTON');

      // 在此期间, 我们可以在提交按钮上发出一个新的客户端事件。
      const secondEvent = document.createEvent('Event');
      secondEvent.initEvent('click', true, true);
      // 这会强制冲刷待处理更新，从而在事件处理器调用前启用提交按钮。
      await act(() => {
        submitButton.dispatchEvent(secondEvent);
      });

      // 因此表单应已提交。
      expect(formSubmitted).toBe(true);
    });
  });

  /** 测试场景：验证「regression test: does not drop passive effects across roots (#17066)」描述的渲染、交互或错误处理结果。 */
  it('regression test: does not drop passive effects across roots (#17066)', async () => {
    const {useState, useEffect} = React;

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({label}) {
      const [step, setStep] = useState(0);
      useEffect(() => {
        if (step < 3) {
          setStep(step + 1);
        }
      }, [step]);

      // 组件应持续重新渲染，直到 `step` 为 3。
      return step === 3 ? 'Finished' : 'Unresolved';
    }

    const containerA = document.createElement('div');
    const containerB = document.createElement('div');
    const containerC = document.createElement('div');
    const rootA = ReactDOMClient.createRoot(containerA);
    const rootB = ReactDOMClient.createRoot(containerB);
    const rootC = ReactDOMClient.createRoot(containerC);

    await act(() => {
      rootA.render(<App label="A" />);
      rootB.render(<App label="B" />);
      rootC.render(<App label="C" />);
    });

    expect(containerA.textContent).toEqual('Finished');
    expect(containerB.textContent).toEqual('Finished');
    expect(containerC.textContent).toEqual('Finished');
  });

  /** 测试场景：验证「updates flush without yielding in the next event」描述的渲染、交互或错误处理结果。 */
  it('updates flush without yielding in the next event', async () => {
    const root = ReactDOMClient.createRoot(container);

    /** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
    function Text(props) {
      Scheduler.log(props.text);
      return props.text;
    }

    root.render(
      <>
        <Text text="A" />
        <Text text="B" />
        <Text text="C" />
      </>,
    );

    // 此时不应渲染任何内容。
    expect(container.textContent).toEqual('');

    // 下一个事件中应立即渲染全部内容。
    await waitForAll(['A', 'B', 'C']);
    expect(container.textContent).toEqual('ABC');
  });

  /** 测试场景：验证「unmounted roots should never clear newer root content from a container」描述的渲染、交互或错误处理结果。 */
  it('unmounted roots should never clear newer root content from a container', async () => {
    const ref = React.createRef();

    /** `OldApp`：封装当前用例复用的操作、回调或断言步骤。 */
    function OldApp() {
      const [value, setValue] = React.useState('old');
      /** `OldApp.hideOnClick`：封装当前用例复用的操作、回调或断言步骤。 */
      function hideOnClick() {
        // 安排一个离散更新。
        setValue('update');
        // 同步卸载此根。
        ReactDOM.flushSync(() => oldRoot.unmount());
      }
      return (
        <button onClick={hideOnClick} ref={ref}>
          {value}
        </button>
      );
    }

    /** `NewApp`：封装当前用例复用的操作、回调或断言步骤。 */
    function NewApp() {
      return <button ref={ref}>new</button>;
    }

    const oldRoot = ReactDOMClient.createRoot(container);
    await act(() => {
      oldRoot.render(<OldApp />);
    });

    // 触发离散事件。
    ref.current.click();

    // 此时 root 应已卸载。
    expect(container.textContent).toBe('');

    // 现在可以渲染一个新的 root。
    const newRoot = ReactDOMClient.createRoot(container);
    ReactDOM.flushSync(() => {
      newRoot.render(<NewApp />);
    });
    ref.current.click();

    expect(container.textContent).toBe('new');
  });

  /** 测试场景：验证「should synchronously render the transition lane scheduled in a popState」描述的渲染、交互或错误处理结果。 */
  it('should synchronously render the transition lane scheduled in a popState', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [syncState, setSyncState] = React.useState(false);
      const [hasNavigated, setHasNavigated] = React.useState(false);
      /** `App.onPopstate`：封装当前用例复用的操作、回调或断言步骤。 */
      function onPopstate() {
        Scheduler.log(`popState`);
        React.startTransition(() => {
          setHasNavigated(true);
        });
        setSyncState(true);
      }
      React.useEffect(() => {
        window.addEventListener('popstate', onPopstate);
        return () => {
          window.removeEventListener('popstate', onPopstate);
        };
      }, []);
      Scheduler.log(`render:${hasNavigated}/${syncState}`);
      return null;
    }
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    assertLog(['render:false/false']);

    await act(async () => {
      const popStateEvent = new Event('popstate');
      // Jest 对微任务中的 window.event 模拟不正确。
      window.event = popStateEvent;
      window.dispatchEvent(popStateEvent);
      queueMicrotask(() => {
        window.event = undefined;
      });
    });

    assertLog(['popState', 'render:true/true']);
    await act(() => {
      root.unmount();
    });
  });

  /** 测试场景：验证「Should not flush transition lanes if there is no transition scheduled in popState」描述的渲染、交互或错误处理结果。 */
  it('Should not flush transition lanes if there is no transition scheduled in popState', async () => {
    let setHasNavigated;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [syncState, setSyncState] = React.useState(false);
      const [hasNavigated, _setHasNavigated] = React.useState(false);
      setHasNavigated = _setHasNavigated;
      /** `App.onPopstate`：封装当前用例复用的操作、回调或断言步骤。 */
      function onPopstate() {
        setSyncState(true);
      }

      React.useEffect(() => {
        window.addEventListener('popstate', onPopstate);
        return () => {
          window.removeEventListener('popstate', onPopstate);
        };
      }, []);

      Scheduler.log(`render:${hasNavigated}/${syncState}`);
      return null;
    }
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    assertLog(['render:false/false']);

    React.startTransition(() => {
      setHasNavigated(true);
    });
    await act(async () => {
      const popStateEvent = new Event('popstate');
      // Jest 对微任务中的 window.event 模拟不正确。
      window.event = popStateEvent;
      window.dispatchEvent(popStateEvent);
      queueMicrotask(() => {
        window.event = undefined;
      });
    });
    assertLog(['render:false/true', 'render:true/true']);
    await act(() => {
      root.unmount();
    });
  });

  /** 测试场景：验证「transition lane in popState should be allowed to suspend」描述的渲染、交互或错误处理结果。 */
  it('transition lane in popState should be allowed to suspend', async () => {
    let resolvePromise;
    const promise = new Promise(res => {
      resolvePromise = res;
    });

    /** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
    function Text({text}) {
      Scheduler.log(text);
      return text;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [pathname, setPathname] = React.useState('/path/a');

      if (pathname !== '/path/a') {
        try {
          React.use(promise);
        } catch (e) {
          Scheduler.log(`Suspend! [${pathname}]`);
          throw e;
        }
      }

      React.useEffect(() => {
        /** `App.onPopstate`：封装当前用例复用的操作、回调或断言步骤。 */
        function onPopstate() {
          React.startTransition(() => {
            setPathname('/path/b');
          });
        }
        window.addEventListener('popstate', onPopstate);
        return () => window.removeEventListener('popstate', onPopstate);
      }, []);

      return (
        <>
          <Text text="Before" />
          <div>
            <Text text={pathname} />
          </div>
          <Text text="After" />
        </>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    assertLog(['Before', '/path/a', 'After']);

    const div = container.getElementsByTagName('div')[0];
    expect(div.textContent).toBe('/path/a');

    // 模拟 popstate 事件
    await act(async () => {
      const popStateEvent = new Event('popstate');

      // 模拟 popstate 事件
      window.event = popStateEvent;
      window.dispatchEvent(popStateEvent);
      await waitForMicrotasks();
      window.event = undefined;

      // transition lane 应已在微任务中被同步尝试。
      assertLog(['Suspend! [/path/b]']);
      // 由于发生挂起，它仍留在当前路径上。
      expect(div.textContent).toBe('/path/a');
    });
    // 预热阶段
    assertLog(['Suspend! [/path/b]']);

    await act(async () => {
      resolvePromise();

      // 该 transition 先前已经挂起，后续尝试无需再同步渲染它；若第一次未能同步提交，滚动恢复状态
      // 无论如何也不会恢复。每个子节点之间都主动 yield，以证明这是并发渲染。
      await waitForMicrotasks();
      assertLog([]);

      await waitFor(['Before']);
      await waitFor(['/path/b']);
      await waitFor(['After']);
    });
    assertLog([]);
    expect(div.textContent).toBe('/path/b');
    await act(() => {
      root.unmount();
    });
  });

  /** 测试场景：验证「regression: useDeferredValue in popState leads to infinite deferral loop」描述的渲染、交互或错误处理结果。 */
  it('regression: useDeferredValue in popState leads to infinite deferral loop', async () => {
    // 编写此测试时，它复现了由多个微妙实现细节共同导致的特定崩溃。为避免测试与这些细节耦合，这里尽量保持高层场景；未来它可能不再触发完全相同的内部条件，但仍可捕获类似缺陷，因为它代表了使用 useDeferredValue 的应用反复切换标签页这一真实场景。不必过分追究测试为何如此编写。下方状态表示浏览器当前位置。
    let browserPathname = '/path/a';

    let setPathname;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({initialPathname}) {
      const [pathname, _setPathname] = React.useState('/path/a');
      setPathname = _setPathname;

      const deferredPathname = React.useDeferredValue(pathname);

      // 在挂载时附加一个 popstate 监听器。 通常，这应该在路由实现中。
      React.useEffect(() => {
        /** `App.onPopstate`：封装当前用例复用的操作、回调或断言步骤。 */
        function onPopstate() {
          React.startTransition(() => {
            setPathname(browserPathname);
          });
        }
        window.addEventListener('popstate', onPopstate);
        return () => window.removeEventListener('popstate', onPopstate);
      }, []);

      return `Current:  ${pathname}\nDeferred: ${deferredPathname}`;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<App initialPathname={browserPathname} />);
    });

    // 模拟在两个位置间来回切换的一系列 popstate 事件。原始回归中，某种 transition lane 组合会让
    // React 陷入无限延迟循环：useDeferredValue 派生任务拿到的 bit 高于 popstate 任务时会触发问题。

    // 为对齐分配结果，先调用一次以推进负责分配 transition lane 的内部变量。该更新是无操作更新，
    // 只会递增计数器，不会触发 useDeferredValue Hook。
    setPathname(browserPathname);

    // 触发足够多的 popstate 事件，使场景覆盖每一种可能的 transition lane。
    for (let i = 0; i < 50; i++) {
      await act(async () => {
        // 模拟 popstate 事件
        browserPathname = browserPathname === '/path/a' ? '/path/b' : '/path/a';
        const popStateEvent = new Event('popstate');
        window.event = popStateEvent;
        window.dispatchEvent(popStateEvent);
        await waitForMicrotasks();
        window.event = undefined;
      });
    }
  });

  /** 测试场景：验证「regression: infinite deferral loop caused by unstable useDeferredValue input」描述的渲染、交互或错误处理结果。 */
  it('regression: infinite deferral loop caused by unstable useDeferredValue input', async () => {
    /** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
    function Text({text}) {
      Scheduler.log(text);
      return text;
    }

    let i = 0;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [pathname, setPathname] = React.useState('/path/a');
      // 这是引用不稳定的输入，因此总会触发 deferred render。
      const {value: deferredPathname} = React.useDeferredValue({
        value: pathname,
      });
      if (i++ > 100) {
        throw new Error('Infinite loop detected');
      }
      React.useEffect(() => {
        /** `App.onPopstate`：封装当前用例复用的操作、回调或断言步骤。 */
        function onPopstate() {
          React.startTransition(() => {
            setPathname('/path/b');
          });
        }
        window.addEventListener('popstate', onPopstate);
        return () => window.removeEventListener('popstate', onPopstate);
      }, []);

      return <Text text={deferredPathname} />;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App />);
    });
    assertLog(['/path/a']);
    expect(container.textContent).toBe('/path/a');

    // 模拟 popstate 事件
    await act(async () => {
      const popStateEvent = new Event('popstate');

      // 模拟 popstate 事件
      window.event = popStateEvent;
      window.dispatchEvent(popStateEvent);
      await waitForMicrotasks();
      window.event = undefined;

      // transition lane 会在微任务中被同步尝试。由于 useDeferredValue 的输入引用不稳定，它会以
      // transition priority 派生 deferred task；但该任务即使在 transition event 中派生，也不应升级为同步优先级。
      assertLog(['/path/a']);
    });
    assertLog(['/path/b']);
    expect(container.textContent).toBe('/path/b');
    await act(() => {
      root.unmount();
    });
  });
});
