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

/** 保存原生input value setter，测试用它改DOM时绕过React安装的值跟踪setter。 */
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

  /** legacy render 连续提交 Hi/Bye，完成回调立即读取对应 DOM；ops 为两值，验证旧根默认同步完成。 */
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

  /** 类实例先追加 A，flushSync scope 内追加 B/C仍读 A；scope 返回只提交 ABC一次，再普通更新 D为ABCD，验证同步批末刷新。 */
  it('flushSync batches sync updates and flushes them at the end of the batch', async () => {
    const ops = [];
    let instance;

    /** 记录字符串状态每轮提交，观察flushSync批末边界。 */
    class Component extends React.Component {

      /** 保存按push次序拼接的文本。 */
      state = {text: ''};

      /** 暴露已挂载实例供测试调用push。 */
      componentDidMount() {
        instance = this;
      }

      /** 函数式追加val，确保同批多次push依次累积而不覆盖。 */
      push(val) {
        this.setState(state => ({text: state.text + val}));
      }

      /** 记录已提交文本，区分排队更新与真正提交。 */
      componentDidUpdate() {
        ops.push(this.state.text);
      }

      /** 暴露实例并输出当前文本。 */
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

  /** 外 flushSync追加 B/C尚未提交，内 flushSync追加 D；内层返回即提交 ABCD一次，外层不再重复提交，验证嵌套同步刷新边界。 */
  it('flushSync flushes updates even if nested inside another flushSync', async () => {
    const ops = [];
    let instance;

    /** 同样的文本累积fixture，专门比较内外flushSync完成时机。 */
    class Component extends React.Component {

      /** 保存可连续拼接文本。 */
      state = {text: ''};

      /** 保存挂载实例引用。 */
      componentDidMount() {
        instance = this;
      }

      /** 函数式追加val，允许B/C/D在嵌套scope一起累积。 */
      push(val) {
        this.setState(state => ({text: state.text + val}));
      }

      /** 记录每次实际提交的文本。 */
      componentDidUpdate() {
        ops.push(this.state.text);
      }

      /** 输出当前文本并保留实例引用。 */
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
      // 内层结束时，本例相关 A/B/C/D 更新已一次提交；不代表任意优先级工作全被冲刷。
      expect(container.textContent).toEqual('ABCD');
      expect(ops).toEqual(['A', 'ABCD']);
    });
    expect(container.textContent).toEqual('ABCD');
    expect(ops).toEqual(['A', 'ABCD']);
  });

  /** 类 didUpdate 内调用 flushSync，外部同步更新触发该生命周期；开发报告 React 正在执行工作不能再次冲刷，验证提交阶段重入警告。 */
  it('flushSync logs an error if already performing work', async () => {

    /** 提交更新时再次调用flushSync，制造重入警告。 */
    class Component extends React.Component {

      /** 在didUpdate调用无callback的flushSync；React仍处于提交工作中。 */
      componentDidUpdate() {
        ReactDOM.flushSync();
      }

      /** 返回null，排除DOM变化，聚焦生命周期调用。 */
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

    /** 原生 input setter绕过 value tracker后派发 input，handler分别安排 transition asyncValue与普通 syncValue；事件内只有sync=hello，act完成后两值均hello，验证离散与过渡不同提交时机。 */
    it('does not perform deferred updates synchronously', async () => {
      const inputRef = React.createRef();
      const asyncValueRef = React.createRef();
      const syncValueRef = React.createRef();

      /** 把输入值分别放在普通与transition两状态，使用refs观察事件内时机。 */
      class Counter extends React.Component {

        /** 分开保存asyncValue与syncValue，初始均为空。 */
        state = {asyncValue: '', syncValue: ''};

        /** 先捕获event.target.value供延后更新，再transition排asyncValue和普通排syncValue；handler内检查过渡尚未提交。 */
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

        /** 用非受控input和两个p/ref输出两种优先级的已提交值。 */
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

    /** createRoot首次Hi与随后Bye更新，在act callback内都读旧DOM，act退出读新DOM；验证根更新调度不在render调用处即时提交。 */
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

    /** 类计数从0 setState到1，同act内仍读0、退出读1；覆盖深层更新的异步调度。 */
    it('deep updates (setState) are concurrent', async () => {
      let instance;

      /** 暴露类实例，检验深层setState不会在调用点立刻提交。 */
      class Component extends React.Component {

        /** 保存待更新step。 */
        state = {step: 0};

        /** 保存当前实例并输出step。 */
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

    /** 先scope外排A，flushSync内排B/C且scope内DOM仍空；返回时ABC一次提交，后续act排D再提交ABCD，验证同步入口也处理相关已有更新。 */
    it('flushSync flushes updates before end of the tick', async () => {
      let instance;

      /** 累积文本并用Scheduler日志记录提交，用于已有异步更新接上flushSync。 */
      class Component extends React.Component {

        /** 保存按push累积的文本。 */
        state = {text: ''};

        /** 用函数式更新追加val，确保不同优先级重放仍按更新顺序累积。 */
        push(val) {
          this.setState(state => ({text: state.text + val}));
        }

        /** 记录已提交文本而非render尝试。 */
        componentDidUpdate() {
          Scheduler.log(this.state.text);
        }

        /** 暴露实例并返回文本span。 */
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
      // 本例先前排队的 A也被处理，和当前 B/C一起提交。
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

    /** 点击Disable排删除Submit的更新；末尾仅断言保存的普通DOM按钮没有current属性，未检查ref.current、连接状态或再发事件，因此不能证明已删除元素忽略后续离散事件。 */
    it('ignores discrete events on a pending removed element', async () => {
      const disableButtonRef = React.createRef();
      const submitButtonRef = React.createRef();

      /** active控制Submit节点存在，Disable点击排移除。 */
      function Form() {
        const [active, setActive] = React.useState(true);

        /** 设active=false，后续树不包含Submit。 */
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

      // 这里读取普通 DOM 元素的 current 属性；这条断言没有检查 ref 清空或 DOM 删除。
      expect(submitButton.current).toBe(undefined);
    });

    /** 初始Submit绑定submitForm，点击Disable并await act后改绑空handler；再点Submit仍不提交，验证使用已提交的新props，而非本例实际存在pending抢先刷新。 */
    it('ignores discrete events on a pending removed event listener', async () => {
      const disableButtonRef = React.createRef();
      const submitButtonRef = React.createRef();

      let formSubmitted = false;

      /** active控制Submit的handler身份，保留同一按钮节点。 */
      function Form() {
        const [active, setActive] = React.useState(true);

        /** 关闭active，使Submit下一轮绑定空处理器。 */
        function disableForm() {
          setActive(false);
        }

        /** 标记真实提交；关闭后的第二事件不应调用。 */
        function submitForm() {
          formSubmitted = true; // 这不应该被调用
        }

        /** 空禁用handler，保持Submit节点和事件prop存在但不提交。 */
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

      // 前一个 act 已等待禁用更新提交，下面读取保留的 Submit 节点。
      const submitButton = submitButtonRef.current;
      expect(submitButton.tagName).toBe('BUTTON');

      // 在此期间, 我们可以在提交按钮上发出一个新的客户端事件。
      const secondEvent = document.createEvent('Event');
      secondEvent.initEvent('click', true, true);
      // 第二事件读取已提交的 disabledSubmitForm，不应调用原 submitForm。
      await act(() => {
        submitButton.dispatchEvent(secondEvent);
      });

      // 因此表单绝不应被提交。
      expect(formSubmitted).toBe(false);
    });

    /** 初始Submit无handler，点击Enable且await act后绑submitForm；再点Submit标记true，验证使用更新后事件监听。 */
    it('uses the newest discrete events on a pending changed event listener', async () => {
      const enableButtonRef = React.createRef();
      const submitButtonRef = React.createRef();

      let formSubmitted = false;

      /** active控制从null到真实Submit监听器的切换。 */
      function Form() {
        const [active, setActive] = React.useState(false);

        /** 启用active，为Submit安装真实handler。 */
        function enableForm() {
          setActive(true);
        }

        /** 标记已提交监听器被点击调用，本启用场景应变true。 */
        function submitForm() {
          formSubmitted = true; // 启用后这应由第二次点击调用
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

      // 前一个 act 已等待启用更新提交，Submit 现在已有监听器。
      const submitButton = submitButtonRef.current;
      expect(submitButton.tagName).toBe('BUTTON');

      // 在此期间, 我们可以在提交按钮上发出一个新的客户端事件。
      const secondEvent = document.createEvent('Event');
      secondEvent.initEvent('click', true, true);
      // 第二事件调用已经提交的 submitForm。
      await act(() => {
        submitButton.dispatchEvent(secondEvent);
      });

      // 因此表单应已提交。
      expect(formSubmitted).toBe(true);
    });
  });

  /** 三个独立根各effect逐步加到3，在同act调度；三容器全为Finished，回归检查跨根不会丢失被动更新。 */
  it('regression test: does not drop passive effects across roots (#17066)', async () => {
    const {useState, useEffect} = React;

    /** effect从0逐轮加到3，返回Finished/Unresolved，供三个根联合检查被动队列。 */
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

  /** 一次root.render排A/B/C，调用处DOM为空，waitForAll后日志完整且DOM ABC；本例未显式插入逐子yield断言，验证计划工作最终提交。 */
  it('updates flush without yielding in the next event', async () => {
    const root = ReactDOMClient.createRoot(container);

    /** 记录并返回同步文本，观察一次根任务完成日志。 */
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

    // 等待调度任务完成后检查三子日志及最终 DOM；此处没有逐子 yield 检查。
    await waitForAll(['A', 'B', 'C']);
    expect(container.textContent).toEqual('ABC');
  });

  /** OldApp点击先排更新又flushSync卸载，容器清空后创建NewApp同步提交并点击；DOM仍new，验证旧根遗留更新不清新根。 */
  it('unmounted roots should never clear newer root content from a container', async () => {
    const ref = React.createRef();

    /** 先排离散更新再同步卸载自己的根，制造可能遗留工作。 */
    function OldApp() {
      const [value, setValue] = React.useState('old');

      /** 排value=update后flushSync卸载oldRoot，后续该根工作不得清理新根容器。 */
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

    /** 在相同容器新根输出new并复用ref，供检查旧工作残留。 */
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

  /** popstate handler同次事件排transition导航与普通同步state，手动window.event并微任务清理；只一次render true/true，验证当前popstate新transition可一并同步尝试。 */
  it('should synchronously render the transition lane scheduled in a popState', async () => {

    /** 监听popstate并记录导航/同步两状态；effect清理移除监听器。 */
    function App() {
      const [syncState, setSyncState] = React.useState(false);
      const [hasNavigated, setHasNavigated] = React.useState(false);

      /** 当前popstate内同时transition设导航和普通设同步state，供单次render合并检查。 */
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

  /** 导航transition先在popstate外排，popstate仅排同步state；日志先false/true再true/true，验证不把先前过渡也升为该事件同步处理。 */
  it('Should not flush transition lanes if there is no transition scheduled in popState', async () => {
    let setHasNavigated;

    /** 暴露导航setter给事件外transition，popstate自身只改同步状态。 */
    function App() {
      const [syncState, setSyncState] = React.useState(false);
      const [hasNavigated, _setHasNavigated] = React.useState(false);
      setHasNavigated = _setHasNavigated;

      /** 只设置同步state，不在当前事件创建transition。 */
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

  /** popstate transition改path/b会use pending promise，微任务内尝试且保留path/a；解决后分别waitFor三个子日志可yield，最后path/b，验证首次同步尝试挂起后重试可并发。 */
  it('transition lane in popState should be allowed to suspend', async () => {
    let resolvePromise;
    const promise = new Promise(res => {
      resolvePromise = res;
    });

    /** 记录每个子文本，使恢复时可逐子waitFor观察yield。 */
    function Text({text}) {
      Scheduler.log(text);
      return text;
    }

    /** 初始path/a，切path/b后use promise可挂起；记录并重抛暂停信号，effect监听并清理popstate。 */
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

        /** 在当前popstate创建transition改path/b，触发首次同步尝试。 */
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

  /** useDeferredValue路径配合50次交替popstate，每次act都等待微任务并完成；无最终文本断言，回归目标是遍历lane周期时不陷入无限延期。 */
  it('regression: useDeferredValue in popState leads to infinite deferral loop', async () => {
    // 连续 popstate 更新与 useDeferredValue 派生任务曾形成无限延迟循环。下方遍历 transition lane
    // 分配周期，检查每次导航都能完成；browserPathname 模拟浏览器当前位置。
    let browserPathname = '/path/a';

    let setPathname;

    /** pathname与useDeferredValue派生路径一起输出，监听外部browserPathname的交替导航；initialPathname参数未参与初始state计算。 */
    function App({initialPathname}) {
      const [pathname, _setPathname] = React.useState('/path/a');
      setPathname = _setPathname;

      const deferredPathname = React.useDeferredValue(pathname);

      // 在挂载时附加一个 popstate 监听器。 通常，这应该在路由实现中。
      React.useEffect(() => {

        /** transition读取当前模拟浏览器路径并更新pathname。 */
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
    // 本例 state 值不变，不需要提交新的 useDeferredValue 输出。
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

  /** useDeferredValue每轮接收新对象并设100次render上限，popstate将path/a改b；事件微任务先旧deferred值，之后新值提交且无超限错误，验证派生deferred任务不会重复升级同步形成循环。 */
  it('regression: infinite deferral loop caused by unstable useDeferredValue input', async () => {

    /** 记录deferred文本的render，供微任务内旧值与后续新值比较。 */
    function Text({text}) {
      Scheduler.log(text);
      return text;
    }

    let i = 0;

    /** 每轮以新对象作为deferred输入，并用render次数上限捕捉无限循环；effect安装/移除导航监听。 */
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

        /** popstate内排transition到path/b，制造不稳定deferred输入的派生工作。 */
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
