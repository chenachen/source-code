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
let waitForDiscrete;
let assertLog;

/** `setUntrackedChecked`：保存当前测试场景复用的夹具、状态或回调。 */
const setUntrackedChecked = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'checked',
).set;

/** `setUntrackedValue`：保存当前测试场景复用的夹具、状态或回调。 */
const setUntrackedValue = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'value',
).set;

/** `setUntrackedTextareaValue`：保存当前测试场景复用的夹具、状态或回调。 */
const setUntrackedTextareaValue = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  'value',
).set;

describe('ChangeEventPlugin', () => {
  let container;

  beforeEach(() => {
    jest.resetModules();
    // TODO：把这段逻辑提取到辅助方法中，减少重复。
    // 模拟调度器使用的浏览器 API：
    // - 调用 `window.postMessage` 时，应实际触发 `message` 事件处理程序。
    const originalAddEventListener = global.addEventListener;
    let postMessageCallback;
    global.addEventListener = function (eventName, callback, useCapture) {
      if (eventName === 'message') {
        postMessageCallback = callback;
      } else {
        originalAddEventListener(eventName, callback, useCapture);
      }
    };
    global.postMessage = function (messageKey, targetOrigin) {
      const postMessageEvent = {source: window, data: messageKey};
      if (postMessageCallback) {
        postMessageCallback(postMessageEvent);
      }
    };
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
    Scheduler = require('scheduler');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    waitForDiscrete = InternalTestUtils.waitForDiscrete;
    assertLog = InternalTestUtils.assertLog;

    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    container = null;
  });

  // 我们尽量避免触发“重复的”React 变更事件。
  // 但为了判断哪些事件是应忽略的“重复事件”，
  // 我们会跟踪输入框的“当前”值，并且只处理值发生变化后触发的事件。
  // 本文件多数测试都会验证：React 能持续跟踪“当前”值，且仅在值变化时触发事件。
  // 参见 https://github.com/facebook/react/pull/5746。

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should consider initial text value to be current」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：事件断言连接 DOMPluginEventSystem 的委托、合成与传播路径。
   */
  it('should consider initial text value to be current', async () => {
    let called = 0;

    /** `cb`：封装当前用例复用的操作、回调或断言步骤。 */
    function cb(e) {
      called++;
      expect(e.type).toBe('change');
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<input type="text" onChange={cb} defaultValue="foo" />);
    });

    const node = container.firstChild;
    node.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}));
    node.dispatchEvent(new Event('change', {bubbles: true, cancelable: true}));

    // 值没有变化，因此不应触发 React 变更事件。
    expect(called).toBe(0);
  });

  /** 测试场景：验证「should consider initial text value to be current (capture)」描述的渲染、交互或错误处理结果。 */
  it('should consider initial text value to be current (capture)', async () => {
    let called = 0;

    /** `cb`：封装当前用例复用的操作、回调或断言步骤。 */
    function cb(e) {
      called++;
      expect(e.type).toBe('change');
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <input type="text" onChangeCapture={cb} defaultValue="foo" />,
      );
    });

    const node = container.firstChild;
    node.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}));
    node.dispatchEvent(new Event('change', {bubbles: true, cancelable: true}));

    // 值没有变化，因此不应触发 React 变更事件。
    expect(called).toBe(0);
  });

  /** 测试场景：验证「should not invoke a change event for textarea same value」描述的渲染、交互或错误处理结果。 */
  it('should not invoke a change event for textarea same value', async () => {
    let called = 0;

    /** `cb`：封装当前用例复用的操作、回调或断言步骤。 */
    function cb(e) {
      called++;
      expect(e.type).toBe('change');
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea onChange={cb} defaultValue="initial" />);
    });

    const node = container.firstChild;
    node.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}));
    node.dispatchEvent(new Event('change', {bubbles: true, cancelable: true}));
    // 值没有变化，因此不应触发 React 变更事件。
    expect(called).toBe(0);
  });

  /** 测试场景：验证「should not invoke a change event for textarea same value (capture)」描述的渲染、交互或错误处理结果。 */
  it('should not invoke a change event for textarea same value (capture)', async () => {
    let called = 0;

    /** `cb`：封装当前用例复用的操作、回调或断言步骤。 */
    function cb(e) {
      called++;
      expect(e.type).toBe('change');
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<textarea onChangeCapture={cb} defaultValue="initial" />);
    });

    const node = container.firstChild;
    node.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}));
    node.dispatchEvent(new Event('change', {bubbles: true, cancelable: true}));
    // 值没有变化，因此不应触发 React 变更事件。
    expect(called).toBe(0);
  });

  /** 测试场景：验证「should consider initial checkbox checked=true to be current」描述的渲染、交互或错误处理结果。 */
  it('should consider initial checkbox checked=true to be current', async () => {
    let called = 0;

    /** `cb`：封装当前用例复用的操作、回调或断言步骤。 */
    function cb(e) {
      called++;
      expect(e.type).toBe('change');
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <input type="checkbox" onChange={cb} defaultChecked={true} />,
      );
    });

    const node = container.firstChild;

    // 绕过 React 的值追踪，把 `checked` 暗中设为 `false`，使派发 `click` 后它重新变为 `true`。
    // 因此，事件触发时 React 不应将它视为相对初始 `true` 值的变化。
    setUntrackedChecked.call(node, false);
    node.dispatchEvent(
      new MouseEvent('click', {bubbles: true, cancelable: true}),
    );
    // 值没有变化，因此不应触发 React 变更事件。
    expect(called).toBe(0);
  });

  /** 测试场景：验证「should consider initial checkbox checked=false to be current」描述的渲染、交互或错误处理结果。 */
  it('should consider initial checkbox checked=false to be current', async () => {
    let called = 0;

    /** `cb`：封装当前用例复用的操作、回调或断言步骤。 */
    function cb(e) {
      called++;
      expect(e.type).toBe('change');
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <input type="checkbox" onChange={cb} defaultChecked={false} />,
      );
    });

    const node = container.firstChild;

    // 绕过 React 的值追踪，把 `checked` 暗中设为 `true`，使派发 `click` 后它重新变为 `false`。
    // 因此，事件触发时 React 不应将它视为相对初始 `false` 值的变化。
    setUntrackedChecked.call(node, true);
    node.dispatchEvent(
      new MouseEvent('click', {bubbles: true, cancelable: true}),
    );
    // 值没有变化，因此不应触发 React 变更事件。
    expect(called).toBe(0);
  });

  /** 测试场景：验证「should fire change for checkbox input」描述的渲染、交互或错误处理结果。 */
  it('should fire change for checkbox input', async () => {
    let called = 0;

    /** `cb`：封装当前用例复用的操作、回调或断言步骤。 */
    function cb(e) {
      called++;
      expect(e.type).toBe('change');
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<input type="checkbox" onChange={cb} />);
    });

    const node = container.firstChild;

    expect(node.checked).toBe(false);
    node.dispatchEvent(
      new MouseEvent('click', {bubbles: true, cancelable: true}),
    );
    // 注意：与文本输入事件不同，派发 `click` 会实际切换复选框，
    // 并更新它的 `checked` 值。
    expect(node.checked).toBe(true);
    expect(called).toBe(1);

    expect(node.checked).toBe(true);
    node.dispatchEvent(
      new MouseEvent('click', {bubbles: true, cancelable: true}),
    );
    expect(node.checked).toBe(false);
    expect(called).toBe(2);
  });

  /** 测试场景：验证「should not fire change setting the value programmatically」描述的渲染、交互或错误处理结果。 */
  it('should not fire change setting the value programmatically', async () => {
    let called = 0;

    /** `cb`：封装当前用例复用的操作、回调或断言步骤。 */
    function cb(e) {
      called++;
      expect(e.type).toBe('change');
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<input type="text" defaultValue="foo" onChange={cb} />);
    });

    const input = container.firstChild;

    // 通过代码设置该值。
    input.value = 'bar';
    // 即使 DOM `input` 事件触发，React 也会发现输入框此时的真实值（`'bar'`）
    // 与已经记录的“当前”值相同。
    input.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}));
    expect(input.value).toBe('bar');
    // 这种情况下，不应收到 React 事件。
    expect(called).toBe(0);

    // 但可以调用底层 `setter` 来模拟用户输入。
    setUntrackedValue.call(input, 'foo');
    // 现在事件触发时，输入框的真实值（`'foo'`）
    // 与先前记录的“当前”值（`'bar'`）不同。
    input.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}));
    expect(input.value).toBe('foo');
    // 这种情况下，React 应为该变更触发事件。
    expect(called).toBe(1);

    // 再次验证：没有实际变化的额外事件会被忽略。
    input.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}));
    expect(called).toBe(1);
  });

  /** 测试场景：验证「should not distinguish equal string and number values」描述的渲染、交互或错误处理结果。 */
  it('should not distinguish equal string and number values', async () => {
    let called = 0;

    /** `cb`：封装当前用例复用的操作、回调或断言步骤。 */
    function cb(e) {
      called++;
      expect(e.type).toBe('change');
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<input type="text" defaultValue="42" onChange={cb} />);
    });

    const input = container.firstChild;

    // 通过属性设置 `value` 时，React 会更新内部跟踪的“当前”值。
    // 后续判断变更事件是否重复时，会使用这个“当前”值。
    // 即使这里把 `value` 设成数字，也仍不应触发变更事件，
    // 因为转换成字符串后，它等于初始值（'42'）。
    input.value = 42;
    input.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}));
    expect(input.value).toBe('42');
    expect(called).toBe(0);
  });

  // 详细原因参见上方相似的 `input` 测试。
  /** 测试场景：验证「should not fire change when setting checked programmatically」描述的渲染、交互或错误处理结果。 */
  it('should not fire change when setting checked programmatically', async () => {
    let called = 0;

    /** `cb`：封装当前用例复用的操作、回调或断言步骤。 */
    function cb(e) {
      called++;
      expect(e.type).toBe('change');
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <input type="checkbox" onChange={cb} defaultChecked={false} />,
      );
    });

    const input = container.firstChild;

    // 设置该值，把 React 跟踪的“当前”值更新为 `true`。
    input.checked = true;
    // 在底层取消勾选，使下一次点击重新将其勾选。
    setUntrackedChecked.call(input, false);
    input.click();
    expect(input.checked).toBe(true);
    // 不应触发 React 事件，因为点击发生时，复选框的真实 `checked` 值（`true`）
    // 与最近记录的“当前”值相同（同样为 `true`）。
    expect(called).toBe(0);

    // 但模拟普通点击应触发 React 事件，因为真实值会从最近跟踪的 `true`
    // 变为 `false`。
    input.click();
    expect(called).toBe(1);
  });

  /** 测试场景：验证「should unmount」描述的渲染、交互或错误处理结果。 */
  it('should unmount', async () => {
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<input />);
    });

    const input = container.firstChild;

    await act(() => {
      root.unmount();
    });
  });

  /** 测试场景：验证「should only fire change for checked radio button once」描述的渲染、交互或错误处理结果。 */
  it('should only fire change for checked radio button once', async () => {
    let called = 0;

    /** `cb`：封装当前用例复用的操作、回调或断言步骤。 */
    function cb(e) {
      called++;
      expect(e.type).toBe('change');
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<input type="radio" onChange={cb} />);
    });

    const input = container.firstChild;

    setUntrackedChecked.call(input, true);
    input.dispatchEvent(new Event('click', {bubbles: true, cancelable: true}));
    input.dispatchEvent(new Event('click', {bubbles: true, cancelable: true}));
    expect(called).toBe(1);
  });

  /** 测试场景：验证「should track radio button cousins in a group」描述的渲染、交互或错误处理结果。 */
  it('should track radio button cousins in a group', async () => {
    let called1 = 0;
    let called2 = 0;

    /** `cb1`：封装当前用例复用的操作、回调或断言步骤。 */
    function cb1(e) {
      called1++;
      expect(e.type).toBe('change');
    }

    /** `cb2`：封装当前用例复用的操作、回调或断言步骤。 */
    function cb2(e) {
      called2++;
      expect(e.type).toBe('change');
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <div>
          <input type="radio" name="group" onChange={cb1} />
          <input type="radio" name="group" onChange={cb2} />
        </div>,
      );
    });

    const div = container.firstChild;
    const option1 = div.childNodes[0];
    const option2 = div.childNodes[1];

    // 选择第一个选项。
    option1.click();
    expect(called1).toBe(1);
    expect(called2).toBe(0);

    // 选择第二个选项。
    option2.click();
    expect(called1).toBe(1);
    expect(called2).toBe(1);

    // 再次选择第一个选项。
    // 它应再次收到 React 变更事件。
    option1.click();
    expect(called1).toBe(2);
    expect(called2).toBe(1);
  });

  /** 测试场景：验证「should deduplicate input value change events」描述的渲染、交互或错误处理结果。 */
  it('should deduplicate input value change events', async () => {
    let called = 0;

    /** `cb`：封装当前用例复用的操作、回调或断言步骤。 */
    function cb(e) {
      called++;
      expect(e.type).toBe('change');
    }

    const inputTypes = ['text', 'number', 'range'];
    while (inputTypes.length) {
      const type = inputTypes.pop();
      called = 0;
      let root = ReactDOMClient.createRoot(container);
      let ref = {current: null};
      await act(() => {
        root.render(<input ref={ref} type={type} onChange={cb} />);
      });
      let input = ref.current;
      await act(() => {
        // 应忽略（值没有变化）：
        input.dispatchEvent(
          new Event('change', {bubbles: true, cancelable: true}),
        );
        setUntrackedValue.call(input, '42');
        input.dispatchEvent(
          new Event('change', {bubbles: true, cancelable: true}),
        );
        // 应忽略（值没有变化）：
        input.dispatchEvent(
          new Event('change', {bubbles: true, cancelable: true}),
        );
      });
      expect(called).toBe(1);
      root.unmount();

      called = 0;
      root = ReactDOMClient.createRoot(container);
      ref = {current: null};
      await act(() => {
        root.render(<input ref={ref} type={type} onChange={cb} />);
      });
      input = ref.current;
      await act(() => {
        // 应忽略（值没有变化）：
        input.dispatchEvent(
          new Event('input', {bubbles: true, cancelable: true}),
        );
        setUntrackedValue.call(input, '42');
        input.dispatchEvent(
          new Event('input', {bubbles: true, cancelable: true}),
        );
        // 应忽略（值没有变化）：
        input.dispatchEvent(
          new Event('input', {bubbles: true, cancelable: true}),
        );
      });
      expect(called).toBe(1);
      root.unmount();

      called = 0;
      root = ReactDOMClient.createRoot(container);
      ref = {current: null};
      await act(() => {
        root.render(<input ref={ref} type={type} onChange={cb} />);
      });
      input = ref.current;
      await act(() => {
        // 应忽略（值没有变化）：
        input.dispatchEvent(
          new Event('change', {bubbles: true, cancelable: true}),
        );
        setUntrackedValue.call(input, '42');
        input.dispatchEvent(
          new Event('input', {bubbles: true, cancelable: true}),
        );
        // 应忽略（值没有变化）：
        input.dispatchEvent(
          new Event('change', {bubbles: true, cancelable: true}),
        );
      });
      expect(called).toBe(1);
      root.unmount();
    }
  });

  /** 测试场景：验证「should listen for both change and input events when supported」描述的渲染、交互或错误处理结果。 */
  it('should listen for both change and input events when supported', async () => {
    let called = 0;

    /** `cb`：封装当前用例复用的操作、回调或断言步骤。 */
    function cb(e) {
      called++;
      expect(e.type).toBe('change');
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<input type="range" onChange={cb} />);
    });

    const input = container.firstChild;

    setUntrackedValue.call(input, 10);
    input.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}));

    setUntrackedValue.call(input, 20);
    input.dispatchEvent(new Event('change', {bubbles: true, cancelable: true}));

    expect(called).toBe(2);
  });

  /** 测试场景：验证「should only fire events when the value changes for range inputs」描述的渲染、交互或错误处理结果。 */
  it('should only fire events when the value changes for range inputs', async () => {
    let called = 0;

    /** `cb`：封装当前用例复用的操作、回调或断言步骤。 */
    function cb(e) {
      called++;
      expect(e.type).toBe('change');
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<input type="range" onChange={cb} />);
    });

    const input = container.firstChild;
    setUntrackedValue.call(input, '40');
    input.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}));
    input.dispatchEvent(new Event('change', {bubbles: true, cancelable: true}));

    setUntrackedValue.call(input, 'foo');
    input.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}));
    input.dispatchEvent(new Event('change', {bubbles: true, cancelable: true}));

    expect(called).toBe(2);
  });

  /** 测试场景：验证「does not crash for nodes with custom value property」描述的渲染、交互或错误处理结果。 */
  it('does not crash for nodes with custom value property', async () => {
    let originalCreateElement;
    // https://github.com/facebook/react/issues/10196
    try {
      originalCreateElement = document.createElement;
      document.createElement = function () {
        const node = originalCreateElement.apply(this, arguments);
        Object.defineProperty(node, 'value', {
          /** `get`：实现测试夹具的生命周期、渲染或交互步骤。 */
          get() {},
          /** `set`：实现测试夹具的生命周期、渲染或交互步骤。 */
          set() {},
        });
        return node;
      };
      const div = document.createElement('div');
      const root = ReactDOMClient.createRoot(div);
      // 挂载。
      await act(() => {
        root.render(<input type="text" />);
      });
      const node = div.firstChild;
      // 更新。
      await act(() => {
        root.render(<input type="text" />);
      });

      // 变更。
      node.dispatchEvent(
        new Event('change', {bubbles: true, cancelable: true}),
      );
      // 卸载。
      await act(() => {
        root.unmount();
      });
    } finally {
      document.createElement = originalCreateElement;
    }
  });

  describe('concurrent mode', () => {
    /** 测试场景：验证「text input」描述的渲染、交互或错误处理结果。 */
    it('text input', async () => {
      const root = ReactDOMClient.createRoot(container);
      let input;

      /** `ControlledInput`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class ControlledInput extends React.Component {
        /** `ControlledInput.state`：记录测试夹具在当前场景中的状态。 */
        state = {value: 'initial'};
        /** `ControlledInput.onChange`：封装当前用例复用的操作、回调或断言步骤。 */
        onChange = event => this.setState({value: event.target.value});
        /** `ControlledInput.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          Scheduler.log(`render: ${this.state.value}`);
          const controlledValue =
            this.state.value === 'changed' ? 'changed [!]' : this.state.value;
          return (
            <input
              ref={el => (input = el)}
              type="text"
              value={controlledValue}
              onChange={this.onChange}
            />
          );
        }
      }

      // 初次挂载，并验证它是异步的。
      root.render(<ControlledInput />);
      // 此时尚未冲刷。
      assertLog([]);
      expect(input).toBe(undefined);
      // 冲刷回调。
      await waitForAll(['render: initial']);
      expect(input.value).toBe('initial');

      // 触发变更事件。
      setUntrackedValue.call(input, 'changed');
      input.dispatchEvent(
        new Event('input', {bubbles: true, cancelable: true}),
      );
      // 变更应同步冲刷。
      assertLog(['render: changed']);
      // 此时应呈现受控值，而非原始值。
      expect(input.value).toBe('changed [!]');
    });

    /** 测试场景：验证「checkbox input」描述的渲染、交互或错误处理结果。 */
    it('checkbox input', async () => {
      const root = ReactDOMClient.createRoot(container);
      let input;

      /** `ControlledInput`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class ControlledInput extends React.Component {
        /** `ControlledInput.state`：记录测试夹具在当前场景中的状态。 */
        state = {checked: false};
        /** `ControlledInput.onChange`：封装当前用例复用的操作、回调或断言步骤。 */
        onChange = event => {
          this.setState({checked: event.target.checked});
        };
        /** `ControlledInput.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          Scheduler.log(`render: ${this.state.checked}`);
          const controlledValue = this.props.reverse
            ? !this.state.checked
            : this.state.checked;
          return (
            <input
              ref={el => (input = el)}
              type="checkbox"
              checked={controlledValue}
              onChange={this.onChange}
            />
          );
        }
      }

      // 初次挂载，并验证它是异步的。
      root.render(<ControlledInput reverse={false} />);
      // 此时尚未冲刷。
      assertLog([]);
      expect(input).toBe(undefined);
      // 冲刷回调。
      await waitForAll(['render: false']);
      expect(input.checked).toBe(false);

      // 触发变更事件。
      input.dispatchEvent(
        new MouseEvent('click', {bubbles: true, cancelable: true}),
      );
      // 变更应同步冲刷。
      assertLog(['render: true']);
      expect(input.checked).toBe(true);

      // 现在确认这里使用的是受控值。
      root.render(<ControlledInput reverse={true} />);
      await waitForAll(['render: true']);

      // 再次触发变更事件。
      input.dispatchEvent(
        new MouseEvent('click', {bubbles: true, cancelable: true}),
      );
      // 变更应同步冲刷。
      assertLog(['render: true']);
      expect(input.checked).toBe(false);
    });

    /** 测试场景：验证「textarea」描述的渲染、交互或错误处理结果。 */
    it('textarea', async () => {
      const root = ReactDOMClient.createRoot(container);
      let textarea;

      /** `ControlledTextarea`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class ControlledTextarea extends React.Component {
        /** `ControlledTextarea.state`：记录测试夹具在当前场景中的状态。 */
        state = {value: 'initial'};
        /** `ControlledTextarea.onChange`：封装当前用例复用的操作、回调或断言步骤。 */
        onChange = event => this.setState({value: event.target.value});
        /** `ControlledTextarea.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          Scheduler.log(`render: ${this.state.value}`);
          const controlledValue =
            this.state.value === 'changed' ? 'changed [!]' : this.state.value;
          return (
            <textarea
              ref={el => (textarea = el)}
              type="text"
              value={controlledValue}
              onChange={this.onChange}
            />
          );
        }
      }

      // 初次挂载，并验证它是异步的。
      root.render(<ControlledTextarea />);
      // 此时尚未冲刷。
      assertLog([]);
      expect(textarea).toBe(undefined);
      // 冲刷回调。
      await waitForAll(['render: initial']);
      expect(textarea.value).toBe('initial');

      // 触发变更事件。
      setUntrackedTextareaValue.call(textarea, 'changed');
      textarea.dispatchEvent(
        new Event('input', {bubbles: true, cancelable: true}),
      );
      // 变更应同步冲刷。
      assertLog(['render: changed']);
      // 此时应呈现受控值，而非原始值。
      expect(textarea.value).toBe('changed [!]');
    });

    /** 测试场景：验证「parent of input」描述的渲染、交互或错误处理结果。 */
    it('parent of input', async () => {
      const root = ReactDOMClient.createRoot(container);
      let input;

      /** `ControlledInput`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class ControlledInput extends React.Component {
        /** `ControlledInput.state`：记录测试夹具在当前场景中的状态。 */
        state = {value: 'initial'};
        /** `ControlledInput.onChange`：封装当前用例复用的操作、回调或断言步骤。 */
        onChange = event => this.setState({value: event.target.value});
        /** `ControlledInput.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          Scheduler.log(`render: ${this.state.value}`);
          const controlledValue =
            this.state.value === 'changed' ? 'changed [!]' : this.state.value;
          return (
            <div onChange={this.onChange}>
              <input
                ref={el => (input = el)}
                type="text"
                value={controlledValue}
                onChange={() => {
                  // 此处不执行操作；由父级处理程序负责更新。
                }}
              />
            </div>
          );
        }
      }

      // 初次挂载。 验证本次渲染是异步的。
      root.render(<ControlledInput />);
      // 此时尚未冲刷。
      assertLog([]);
      expect(input).toBe(undefined);
      // 冲刷回调。
      await waitForAll(['render: initial']);
      expect(input.value).toBe('initial');

      // 触发变更事件。
      setUntrackedValue.call(input, 'changed');
      input.dispatchEvent(
        new Event('input', {bubbles: true, cancelable: true}),
      );
      // 变更应同步冲刷。
      assertLog(['render: changed']);
      // 此时应呈现受控值，而非原始值。
      expect(input.value).toBe('changed [!]');
    });

    /** 测试场景：验证「is sync for non-input events」描述的渲染、交互或错误处理结果。 */
    it('is sync for non-input events', async () => {
      const root = ReactDOMClient.createRoot(container);
      let input;

      /** `ControlledInput`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class ControlledInput extends React.Component {
        /** `ControlledInput.state`：记录测试夹具在当前场景中的状态。 */
        state = {value: 'initial'};
        /** `ControlledInput.onChange`：封装当前用例复用的操作、回调或断言步骤。 */
        onChange = event => this.setState({value: event.target.value});
        /** `ControlledInput.reset`：封装当前用例复用的操作、回调或断言步骤。 */
        reset = () => {
          this.setState({value: ''});
        };
        /** `ControlledInput.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          Scheduler.log(`render: ${this.state.value}`);
          const controlledValue =
            this.state.value === 'changed' ? 'changed [!]' : this.state.value;
          return (
            <input
              ref={el => (input = el)}
              type="text"
              value={controlledValue}
              onChange={this.onChange}
              onClick={this.reset}
            />
          );
        }
      }

      // 初次挂载，并验证它是异步的。
      root.render(<ControlledInput />);
      // 此时尚未冲刷。
      assertLog([]);
      expect(input).toBe(undefined);
      // 冲刷回调。
      await waitForAll(['render: initial']);
      expect(input.value).toBe('initial');

      // 触发点击事件。
      input.dispatchEvent(
        new Event('click', {bubbles: true, cancelable: true}),
      );

      // 冲刷微任务队列。
      await waitForDiscrete(['render: ']);
      expect(input.value).toBe('');
    });

    /** 测试场景：验证「mouse enter/leave should be user-blocking but not discrete」描述的渲染、交互或错误处理结果。 */
    it('mouse enter/leave should be user-blocking but not discrete', async () => {
      const {useState} = React;

      const root = ReactDOMClient.createRoot(container);

      const target = React.createRef(null);
      /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
      function Foo() {
        const [isHover, setHover] = useState(false);
        return (
          <div
            ref={target}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}>
            {isHover ? 'hovered' : 'not hovered'}
          </div>
        );
      }

      await act(() => {
        root.render(<Foo />);
      });
      expect(container.textContent).toEqual('not hovered');

      await act(() => {
        const mouseOverEvent = document.createEvent('MouseEvents');
        mouseOverEvent.initEvent('mouseover', true, true);
        target.current.dispatchEvent(mouseOverEvent);

        // 冲刷离散更新。
        ReactDOM.flushSync();
        // 鼠标进入/离开不是离散事件，因此此时不应更新。
        expect(container.textContent).toEqual('not hovered');
      });
      expect(container.textContent).toEqual('hovered');
    });
  });
});
