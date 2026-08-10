/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

// 由 `yarn test-fire` 设置。
const {disableInputAttributeSyncing} = require('shared/ReactFeatureFlags');

/** `emptyFunction`：封装当前用例复用的操作、回调或断言步骤。 */
function emptyFunction() {}

describe('ReactDOMInput', () => {
  let React;
  let ReactDOM;
  let ReactDOMClient;
  let ReactDOMServer;
  let Scheduler;
  let act;
  let assertLog;
  let setUntrackedValue;
  let setUntrackedChecked;
  let container;
  let root;
  let assertConsoleErrorDev;

  /** `dispatchEventOnNode`：封装当前用例复用的操作、回调或断言步骤。 */
  function dispatchEventOnNode(node, type) {
    node.dispatchEvent(new Event(type, {bubbles: true, cancelable: true}));
  }

  /** `isValueDirty`：封装当前用例复用的操作、回调或断言步骤。 */
  function isValueDirty(node) {
    // 返回 HTML 规范定义的“脏值标志”。把副本转成 text input，以绕过复杂的 value 清理行为。
    const copy = node.cloneNode();
    copy.type = 'text';
    // 如果此时修改 attribute 不会改变 value，就说明 value 已与该 attribute 脱离。
    copy.defaultValue += Math.random();
    return copy.value === node.value;
  }

  /** `isCheckedDirty`：封装当前用例复用的操作、回调或断言步骤。 */
  function isCheckedDirty(node) {
    // 返回 HTML 规范定义的“脏 checked 标志”。
    if (node.checked !== node.defaultChecked) {
      return true;
    }
    const copy = node.cloneNode();
    copy.type = 'checkbox';
    copy.defaultChecked = !copy.defaultChecked;
    return copy.checked === node.checked;
  }

  /** `getTrackedAndCurrentInputValue`：封装当前用例复用的操作、回调或断言步骤。 */
  function getTrackedAndCurrentInputValue(elem: HTMLElement): [mixed, mixed] {
    const tracker = elem._valueTracker;
    if (!tracker) {
      throw new Error('No input tracker');
    }
    return [
      tracker.getValue(),
      elem.nodeName === 'INPUT' &&
      (elem.type === 'checkbox' || elem.type === 'radio')
        ? String(elem.checked)
        : elem.value,
    ];
  }

  /** `assertInputTrackingIsCurrent`：封装当前用例复用的操作、回调或断言步骤。 */
  function assertInputTrackingIsCurrent(parent) {
    parent.querySelectorAll('input, textarea, select').forEach(input => {
      const [trackedValue, currentValue] =
        getTrackedAndCurrentInputValue(input);
      if (trackedValue !== currentValue) {
        throw new Error(
          `Input ${input.outerHTML} is currently ${currentValue} but tracker thinks it's ${trackedValue}`,
        );
      }
    });
  }

  beforeEach(() => {
    jest.resetModules();

    setUntrackedValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set;
    setUntrackedChecked = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'checked',
    ).set;

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
    assertLog = require('internal-test-utils').assertLog;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOMClient.createRoot(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    jest.restoreAllMocks();
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should warn for controlled value of 0 with missing onChange」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接表单宿主状态、ReactDOMSharedInternals 与提交后受控值恢复路径。
   */
  it('should warn for controlled value of 0 with missing onChange', async () => {
    await act(() => {
      root.render(<input type="text" value={0} />);
    });
    assertConsoleErrorDev([
      'You provided a `value` prop to a form ' +
        'field without an `onChange` handler. This will render a read-only ' +
        'field. If the field should be mutable use `defaultValue`. ' +
        'Otherwise, set either `onChange` or `readOnly`.\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should warn for controlled value of "" with missing onChange」描述的渲染、交互或错误处理结果。 */
  it('should warn for controlled value of "" with missing onChange', async () => {
    await act(() => {
      root.render(<input type="text" value="" />);
    });
    assertConsoleErrorDev([
      'You provided a `value` prop to a form ' +
        'field without an `onChange` handler. This will render a read-only ' +
        'field. If the field should be mutable use `defaultValue`. ' +
        'Otherwise, set either `onChange` or `readOnly`.\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should warn for controlled value of "0" with missing onChange」描述的渲染、交互或错误处理结果。 */
  it('should warn for controlled value of "0" with missing onChange', async () => {
    await act(() => {
      root.render(<input type="text" value="0" />);
    });
    assertConsoleErrorDev([
      'You provided a `value` prop to a form ' +
        'field without an `onChange` handler. This will render a read-only ' +
        'field. If the field should be mutable use `defaultValue`. ' +
        'Otherwise, set either `onChange` or `readOnly`.\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should warn for controlled value of false with missing onChange」描述的渲染、交互或错误处理结果。 */
  it('should warn for controlled value of false with missing onChange', async () => {
    await act(() => {
      root.render(<input type="checkbox" checked={false} />);
    });
    assertConsoleErrorDev([
      'You provided a `checked` prop to a form field without an `onChange` handler. ' +
        'This will render a read-only field. If the field should be mutable use `defaultChecked`. ' +
        'Otherwise, set either `onChange` or `readOnly`.\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should warn with checked and no onChange handler with readOnly specified」描述的渲染、交互或错误处理结果。 */
  it('should warn with checked and no onChange handler with readOnly specified', async () => {
    await act(() => {
      root.render(<input type="checkbox" checked={false} readOnly={true} />);
    });
    root.unmount();
    root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<input type="checkbox" checked={false} readOnly={false} />);
    });
    assertConsoleErrorDev([
      'You provided a `checked` prop to a form field without an `onChange` handler. ' +
        'This will render a read-only field. If the field should be mutable use `defaultChecked`. ' +
        'Otherwise, set either `onChange` or `readOnly`.\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should not warn about missing onChange in uncontrolled inputs」描述的渲染、交互或错误处理结果。 */
  it('should not warn about missing onChange in uncontrolled inputs', async () => {
    await act(() => {
      root.render(<input />);
    });
    root.unmount();
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<input value={undefined} />);
    });
    root.unmount();
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<input type="text" />);
    });
    root.unmount();
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<input type="text" value={undefined} />);
    });
    root.unmount();
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<input type="checkbox" />);
    });
    root.unmount();
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<input type="checkbox" checked={undefined} />);
    });
  });

  /** 测试场景：验证「should not warn with value and onInput handler」描述的渲染、交互或错误处理结果。 */
  it('should not warn with value and onInput handler', async () => {
    await act(() => {
      root.render(<input value="..." onInput={() => {}} />);
    });
  });

  /** 测试场景：验证「should properly control a value even if no event listener exists」描述的渲染、交互或错误处理结果。 */
  it('should properly control a value even if no event listener exists', async () => {
    await act(() => {
      root.render(<input type="text" value="lion" />);
    });
    assertConsoleErrorDev([
      'You provided a `value` prop to a form field without an `onChange` handler. ' +
        'This will render a read-only field. If the field should be mutable use `defaultValue`. ' +
        'Otherwise, set either `onChange` or `readOnly`.\n' +
        '    in input (at **)',
    ]);
    const node = container.firstChild;
    expect(isValueDirty(node)).toBe(true);

    setUntrackedValue.call(node, 'giraffe');

    // 这里必须派发原生事件。若使用模拟事件，会绕过延迟附加事件的系统，便无法实际覆盖此行为。
    await act(() => {
      dispatchEventOnNode(node, 'input');
    });

    expect(node.value).toBe('lion');
    expect(isValueDirty(node)).toBe(true);
  });

  /** 测试场景：验证「should control a value in reentrant events」描述的渲染、交互或错误处理结果。 */
  it('should control a value in reentrant events', async () => {
    /** `ControlledInputs`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ControlledInputs extends React.Component {
      /** `ControlledInputs.state`：记录测试夹具在当前场景中的状态。 */
      state = {value: 'lion'};
      /** `ControlledInputs.a`：记录测试夹具在当前场景中的状态。 */
      a = null;
      /** `ControlledInputs.b`：记录测试夹具在当前场景中的状态。 */
      b = null;
      /** `ControlledInputs.switchedFocus`：记录测试夹具在当前场景中的状态。 */
      switchedFocus = false;
      /** `ControlledInputs.change`：实现测试夹具的生命周期、渲染或交互步骤。 */
      change(newValue) {
        this.setState({value: newValue});
        // 这里调用 focus 会使文本框 blur，并触发原生 change 事件。理想情况下无需手动触发；
        // 除非已确认 #8240 的修复仍被此测试覆盖，否则不要删除这段逻辑。
        dispatchEventOnNode(this.a, 'input');
        this.b.focus();
      }
      /** `ControlledInputs.blur`：实现测试夹具的生命周期、渲染或交互步骤。 */
      blur(currentValue) {
        this.switchedFocus = true;
        // `currentValue` 应该在这里是 `'giraffe'`，因为我们还没有在目标上恢复它。
        this.setState({value: currentValue});
      }
      /** `ControlledInputs.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            <input
              type="text"
              ref={n => (this.a = n)}
              value={this.state.value}
              onChange={e => this.change(e.target.value)}
              onBlur={e => this.blur(e.target.value)}
            />
            <input type="text" ref={n => (this.b = n)} />
          </div>
        );
      }
    }

    const ref = React.createRef();
    await act(() => {
      root.render(<ControlledInputs ref={ref} />);
    });
    const instance = ref.current;

    // 聚焦字段，以便稍后可以将其失焦。 除非你已经验证了#8240 中的修复仍然被覆盖，否则不要移除。
    await act(() => {
      instance.a.focus();
    });
    setUntrackedValue.call(instance.a, 'giraffe');
    // 这里必须派发原生事件。若使用模拟事件，会绕过延迟附加事件的系统，便无法实际覆盖此行为。
    await act(() => {
      dispatchEventOnNode(instance.a, 'input');
    });
    await act(() => {
      dispatchEventOnNode(instance.a, 'blur');
    });
    await act(() => {
      dispatchEventOnNode(instance.a, 'focusout');
    });

    expect(instance.a.value).toBe('giraffe');
    expect(instance.switchedFocus).toBe(true);
  });

  /** 测试场景：验证「should control values in reentrant events with different targets」描述的渲染、交互或错误处理结果。 */
  it('should control values in reentrant events with different targets', async () => {
    /** `ControlledInputs`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ControlledInputs extends React.Component {
      /** `ControlledInputs.state`：记录测试夹具在当前场景中的状态。 */
      state = {value: 'lion'};
      /** `ControlledInputs.a`：记录测试夹具在当前场景中的状态。 */
      a = null;
      /** `ControlledInputs.b`：记录测试夹具在当前场景中的状态。 */
      b = null;
      /** `ControlledInputs.change`：实现测试夹具的生命周期、渲染或交互步骤。 */
      change(newValue) {
        // 此次点击会把 checkbox 改为 false，并触发内层 change 事件；最终冲刷时必须将其重置为受控值 true。
        this.b.click();
      }
      /** `ControlledInputs.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            <input
              type="text"
              ref={n => (this.a = n)}
              value="lion"
              onChange={e => this.change(e.target.value)}
            />
            <input
              type="checkbox"
              ref={n => (this.b = n)}
              checked={true}
              onChange={() => {}}
            />
          </div>
        );
      }
    }

    const ref = React.createRef();
    await act(() => {
      root.render(<ControlledInputs ref={ref} />);
    });
    const instance = ref.current;

    setUntrackedValue.call(instance.a, 'giraffe');
    // 这里必须派发原生事件。若使用模拟事件，会绕过延迟附加事件的系统，便无法实际覆盖此行为。
    await act(() => {
      dispatchEventOnNode(instance.a, 'input');
    });

    expect(instance.a.value).toBe('lion');
    expect(instance.b.checked).toBe(true);
  });

  describe('switching text inputs between numeric and string numbers', () => {
    /** 测试场景：验证「does change the number 2 to "2.0" with no change handler」描述的渲染、交互或错误处理结果。 */
    it('does change the number 2 to "2.0" with no change handler', async () => {
      await act(() => {
        root.render(<input type="text" value={2} onChange={jest.fn()} />);
      });
      const node = container.firstChild;

      setUntrackedValue.call(node, '2.0');
      dispatchEventOnNode(node, 'input');

      expect(node.value).toBe('2');
      if (disableInputAttributeSyncing) {
        expect(node.hasAttribute('value')).toBe(false);
      } else {
        expect(node.getAttribute('value')).toBe('2');
      }
    });

    /** 测试场景：验证「does change the string "2" to "2.0" with no change handler」描述的渲染、交互或错误处理结果。 */
    it('does change the string "2" to "2.0" with no change handler', async () => {
      await act(() => {
        root.render(<input type="text" value={'2'} onChange={jest.fn()} />);
      });
      const node = container.firstChild;

      setUntrackedValue.call(node, '2.0');
      dispatchEventOnNode(node, 'input');

      expect(node.value).toBe('2');
      if (disableInputAttributeSyncing) {
        expect(node.hasAttribute('value')).toBe(false);
      } else {
        expect(node.getAttribute('value')).toBe('2');
      }
    });

    /** 测试场景：验证「changes the number 2 to "2.0" using a change handler」描述的渲染、交互或错误处理结果。 */
    it('changes the number 2 to "2.0" using a change handler', async () => {
      /** `Stub`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Stub extends React.Component {
        /** `Stub.state`：记录测试夹具在当前场景中的状态。 */
        state = {
          value: 2,
        };
        /** `Stub.onChange`：封装当前用例复用的操作、回调或断言步骤。 */
        onChange = event => {
          this.setState({value: event.target.value});
        };
        /** `Stub.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          const {value} = this.state;

          return <input type="text" value={value} onChange={this.onChange} />;
        }
      }

      await act(() => {
        root.render(<Stub />);
      });
      const node = container.firstChild;

      setUntrackedValue.call(node, '2.0');
      dispatchEventOnNode(node, 'input');

      expect(node.value).toBe('2.0');
      if (disableInputAttributeSyncing) {
        expect(node.hasAttribute('value')).toBe(false);
      } else {
        expect(node.getAttribute('value')).toBe('2.0');
      }
    });
  });

  /** 测试场景：验证「does change the string ".98" to "0.98" with no change handler」描述的渲染、交互或错误处理结果。 */
  it('does change the string ".98" to "0.98" with no change handler', async () => {
    /** `Stub`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Stub extends React.Component {
      /** `Stub.state`：记录测试夹具在当前场景中的状态。 */
      state = {
        value: '.98',
      };
      /** `Stub.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <input type="number" value={this.state.value} />;
      }
    }

    const ref = React.createRef();
    await act(() => {
      root.render(<Stub ref={ref} />);
    });
    assertConsoleErrorDev([
      'You provided a `value` prop to a form field without an `onChange` handler. ' +
        'This will render a read-only field. If the field should be mutable use `defaultValue`. ' +
        'Otherwise, set either `onChange` or `readOnly`.\n' +
        '    in input (at **)\n' +
        '    in Stub (at **)',
    ]);
    const node = container.firstChild;
    await act(() => {
      ref.current.setState({value: '0.98'});
    });

    expect(node.value).toEqual('0.98');
  });

  /** 测试场景：验证「performs a state change from "" to 0」描述的渲染、交互或错误处理结果。 */
  it('performs a state change from "" to 0', async () => {
    /** `Stub`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Stub extends React.Component {
      /** `Stub.state`：记录测试夹具在当前场景中的状态。 */
      state = {
        value: '',
      };
      /** `Stub.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <input type="number" value={this.state.value} readOnly={true} />;
      }
    }

    const ref = React.createRef();
    await act(() => {
      root.render(<Stub ref={ref} />);
    });
    const node = container.firstChild;
    await act(() => {
      ref.current.setState({value: 0});
    });

    expect(node.value).toEqual('0');
  });

  /** 测试场景：验证「updates the value on radio buttons from "" to 0」描述的渲染、交互或错误处理结果。 */
  it('updates the value on radio buttons from "" to 0', async () => {
    await act(() => {
      root.render(<input type="radio" value="" onChange={function () {}} />);
    });
    await act(() => {
      root.render(<input type="radio" value={0} onChange={function () {}} />);
    });
    expect(container.firstChild.value).toBe('0');
    expect(container.firstChild.getAttribute('value')).toBe('0');
  });

  /** 测试场景：验证「updates the value on checkboxes from "" to 0」描述的渲染、交互或错误处理结果。 */
  it('updates the value on checkboxes from "" to 0', async () => {
    await act(() => {
      root.render(<input type="checkbox" value="" onChange={function () {}} />);
    });
    await act(() => {
      root.render(
        <input type="checkbox" value={0} onChange={function () {}} />,
      );
    });
    expect(container.firstChild.value).toBe('0');
    expect(container.firstChild.getAttribute('value')).toBe('0');
  });

  /** 测试场景：验证「distinguishes precision for extra zeroes in string number values」描述的渲染、交互或错误处理结果。 */
  it('distinguishes precision for extra zeroes in string number values', async () => {
    /** `Stub`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Stub extends React.Component {
      /** `Stub.state`：记录测试夹具在当前场景中的状态。 */
      state = {
        value: '3.0000',
      };
      /** `Stub.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <input type="number" value={this.state.value} />;
      }
    }

    const ref = React.createRef();
    await act(() => {
      root.render(<Stub ref={ref} />);
    });
    assertConsoleErrorDev([
      'You provided a `value` prop to a form field without an `onChange` handler. ' +
        'This will render a read-only field. If the field should be mutable use `defaultValue`. ' +
        'Otherwise, set either `onChange` or `readOnly`.\n' +
        '    in input (at **)\n' +
        '    in Stub (at **)',
    ]);
    const node = container.firstChild;
    await act(() => {
      ref.current.setState({value: '3'});
    });

    expect(node.value).toEqual('3');
  });

  /** 测试场景：验证「should display `defaultValue` of number 0」描述的渲染、交互或错误处理结果。 */
  it('should display `defaultValue` of number 0', async () => {
    await act(() => {
      root.render(<input type="text" defaultValue={0} />);
    });
    const node = container.firstChild;

    expect(node.getAttribute('value')).toBe('0');
    expect(node.value).toBe('0');
  });

  /** 测试场景：验证「only assigns defaultValue if it changes」描述的渲染、交互或错误处理结果。 */
  it('only assigns defaultValue if it changes', async () => {
    /** `Test`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Test extends React.Component {
      /** `Test.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <input defaultValue="0" />;
      }
    }

    const ref = React.createRef();
    await act(() => {
      root.render(<Test ref={ref} />);
    });
    const node = container.firstChild;

    Object.defineProperty(node, 'defaultValue', {
      /** `get`：实现测试夹具的生命周期、渲染或交互步骤。 */
      get() {
        return '0';
      },
      /** `set`：实现测试夹具的生命周期、渲染或交互步骤。 */
      set(value) {
        throw new Error(
          `defaultValue was assigned ${value}, but it did not change!`,
        );
      },
    });

    await act(() => {
      ref.current.forceUpdate();
    });
  });

  /** 测试场景：验证「should display "true" for `defaultValue` of `true`」描述的渲染、交互或错误处理结果。 */
  it('should display "true" for `defaultValue` of `true`', async () => {
    const stub = <input type="text" defaultValue={true} />;
    await act(() => {
      root.render(stub);
    });
    const node = container.firstChild;

    expect(node.value).toBe('true');
  });

  /** 测试场景：验证「should display "false" for `defaultValue` of `false`」描述的渲染、交互或错误处理结果。 */
  it('should display "false" for `defaultValue` of `false`', async () => {
    const stub = <input type="text" defaultValue={false} />;
    await act(() => {
      root.render(stub);
    });
    const node = container.firstChild;

    expect(node.value).toBe('false');
  });

  /** 测试场景：验证「should update `defaultValue` for uncontrolled input」描述的渲染、交互或错误处理结果。 */
  it('should update `defaultValue` for uncontrolled input', async () => {
    await act(() => {
      root.render(<input type="text" defaultValue="0" />);
    });
    const node = container.firstChild;

    expect(node.value).toBe('0');
    expect(node.defaultValue).toBe('0');
    if (disableInputAttributeSyncing) {
      expect(isValueDirty(node)).toBe(false);
    } else {
      expect(isValueDirty(node)).toBe(true);
    }

    await act(() => {
      root.render(<input type="text" defaultValue="1" />);
    });

    if (disableInputAttributeSyncing) {
      expect(node.value).toBe('1');
      expect(node.defaultValue).toBe('1');
      expect(isValueDirty(node)).toBe(false);
    } else {
      expect(node.value).toBe('0');
      expect(node.defaultValue).toBe('1');
      expect(isValueDirty(node)).toBe(true);
    }
  });

  /** 测试场景：验证「should update `defaultValue` for uncontrolled date/time input」描述的渲染、交互或错误处理结果。 */
  it('should update `defaultValue` for uncontrolled date/time input', async () => {
    await act(() => {
      root.render(<input type="date" defaultValue="1980-01-01" />);
    });
    const node = container.firstChild;

    expect(node.value).toBe('1980-01-01');
    expect(node.defaultValue).toBe('1980-01-01');

    await act(() => {
      root.render(<input type="date" defaultValue="2000-01-01" />);
    });

    if (disableInputAttributeSyncing) {
      expect(node.value).toBe('2000-01-01');
      expect(node.defaultValue).toBe('2000-01-01');
    } else {
      expect(node.value).toBe('1980-01-01');
      expect(node.defaultValue).toBe('2000-01-01');
    }

    await act(() => {
      root.render(<input type="date" />);
    });
  });

  /** 测试场景：验证「should take `defaultValue` when changing to uncontrolled input」描述的渲染、交互或错误处理结果。 */
  it('should take `defaultValue` when changing to uncontrolled input', async () => {
    await act(() => {
      root.render(<input type="text" value="0" readOnly={true} />);
    });
    const node = container.firstChild;
    expect(node.value).toBe('0');
    expect(isValueDirty(node)).toBe(true);
    await act(() => {
      root.render(<input type="text" defaultValue="1" />);
    });
    assertConsoleErrorDev([
      'A component is changing a controlled input to be uncontrolled. ' +
        'This is likely caused by the value changing from a defined to undefined, which should not happen. ' +
        'Decide between using a controlled or uncontrolled input element for the lifetime of the component. ' +
        'More info: https://react.dev/link/controlled-components\n' +
        '    in input (at **)',
    ]);
    expect(node.value).toBe('0');
    expect(isValueDirty(node)).toBe(true);
  });

  /** 测试场景：验证「should render defaultValue for SSR」描述的渲染、交互或错误处理结果。 */
  it('should render defaultValue for SSR', () => {
    const markup = ReactDOMServer.renderToString(
      <input type="text" defaultValue="1" />,
    );
    const div = document.createElement('div');
    div.innerHTML = markup;
    expect(div.firstChild.getAttribute('value')).toBe('1');
    expect(div.firstChild.getAttribute('defaultValue')).toBe(null);
  });

  /** 测试场景：验证「should render bigint defaultValue for SSR」描述的渲染、交互或错误处理结果。 */
  it('should render bigint defaultValue for SSR', () => {
    const markup = ReactDOMServer.renderToString(
      <input type="text" defaultValue={5n} />,
    );
    const div = document.createElement('div');
    div.innerHTML = markup;
    expect(div.firstChild.getAttribute('value')).toBe('5');
    expect(div.firstChild.getAttribute('defaultValue')).toBe(null);
  });

  /** 测试场景：验证「should render value for SSR」描述的渲染、交互或错误处理结果。 */
  it('should render value for SSR', () => {
    const element = <input type="text" value="1" onChange={() => {}} />;
    const markup = ReactDOMServer.renderToString(element);
    const div = document.createElement('div');
    div.innerHTML = markup;
    expect(div.firstChild.getAttribute('value')).toBe('1');
    expect(div.firstChild.getAttribute('defaultValue')).toBe(null);
  });

  /** 测试场景：验证「should render bigint value for SSR」描述的渲染、交互或错误处理结果。 */
  it('should render bigint value for SSR', () => {
    const element = <input type="text" value={5n} onChange={() => {}} />;
    const markup = ReactDOMServer.renderToString(element);
    const div = document.createElement('div');
    div.innerHTML = markup;
    expect(div.firstChild.getAttribute('value')).toBe('5');
    expect(div.firstChild.getAttribute('defaultValue')).toBe(null);
  });

  /** 测试场景：验证「should render name attribute if it is supplied」描述的渲染、交互或错误处理结果。 */
  it('should render name attribute if it is supplied', async () => {
    await act(() => {
      root.render(<input type="text" name="name" />);
    });
    const node = container.firstChild;
    expect(node.name).toBe('name');
    expect(container.firstChild.getAttribute('name')).toBe('name');
  });

  /** 测试场景：验证「should render name attribute if it is supplied for SSR」描述的渲染、交互或错误处理结果。 */
  it('should render name attribute if it is supplied for SSR', () => {
    const element = <input type="text" name="name" />;
    const markup = ReactDOMServer.renderToString(element);
    const div = document.createElement('div');
    div.innerHTML = markup;
    expect(div.firstChild.getAttribute('name')).toBe('name');
  });

  /** 测试场景：验证「should not render name attribute if it is not supplied」描述的渲染、交互或错误处理结果。 */
  it('should not render name attribute if it is not supplied', async () => {
    await act(() => {
      root.render(<input type="text" />);
    });
    expect(container.firstChild.getAttribute('name')).toBe(null);
  });

  /** 测试场景：验证「should not render name attribute if it is not supplied for SSR」描述的渲染、交互或错误处理结果。 */
  it('should not render name attribute if it is not supplied for SSR', () => {
    const element = <input type="text" />;
    const markup = ReactDOMServer.renderToString(element);
    const div = document.createElement('div');
    div.innerHTML = markup;
    expect(div.firstChild.getAttribute('name')).toBe(null);
  });

  /** 测试场景：验证「should display "foobar" for `defaultValue` of `objToString`」描述的渲染、交互或错误处理结果。 */
  it('should display "foobar" for `defaultValue` of `objToString`', async () => {
    const objToString = {
      /** `toString`：封装当前用例复用的操作、回调或断言步骤。 */
      toString: function () {
        return 'foobar';
      },
    };

    const stub = <input type="text" defaultValue={objToString} />;
    await act(() => {
      root.render(stub);
    });
    const node = container.firstChild;

    expect(node.value).toBe('foobar');
  });

  /** 测试场景：验证「should throw for date inputs if `defaultValue` is an object where valueOf() throws」描述的渲染、交互或错误处理结果。 */
  it('should throw for date inputs if `defaultValue` is an object where valueOf() throws', async () => {
    /** `TemporalLike`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class TemporalLike {
      /** `TemporalLike.valueOf`：实现测试夹具的生命周期、渲染或交互步骤。 */
      valueOf() {
        // 此处抛错符合 ECMAScript “Temporal” 日期/时间 API 的行为。
        // 参见 https://tc39.es/proposal-temporal/docs/plaindate.html#valueOf
        throw new TypeError('prod message');
      }
      /** `TemporalLike.toString`：实现测试夹具的生命周期、渲染或交互步骤。 */
      toString() {
        return '2020-01-01';
      }
    }
    await expect(async () => {
      await act(() => {
        root.render(<input defaultValue={new TemporalLike()} type="date" />);
      });
    }).rejects.toThrowError(new TypeError('prod message'));
    assertConsoleErrorDev([
      'Form field values (value, checked, defaultValue, or defaultChecked props) must be ' +
        'strings, not TemporalLike. This value must be coerced to a string before using it here.\n' +
        '    in input (at **)',
      'Form field values (value, checked, defaultValue, or defaultChecked props) must be ' +
        'strings, not TemporalLike. This value must be coerced to a string before using it here.\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should throw for text inputs if `defaultValue` is an object where valueOf() throws」描述的渲染、交互或错误处理结果。 */
  it('should throw for text inputs if `defaultValue` is an object where valueOf() throws', async () => {
    /** `TemporalLike`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class TemporalLike {
      /** `TemporalLike.valueOf`：实现测试夹具的生命周期、渲染或交互步骤。 */
      valueOf() {
        // 此处抛错符合 ECMAScript “Temporal” 日期/时间 API 的行为。
        // 参见 https://tc39.es/proposal-temporal/docs/plaindate.html#valueOf
        throw new TypeError('prod message');
      }
      /** `TemporalLike.toString`：实现测试夹具的生命周期、渲染或交互步骤。 */
      toString() {
        return '2020-01-01';
      }
    }
    await expect(async () => {
      await act(() => {
        root.render(<input defaultValue={new TemporalLike()} type="text" />);
      });
    }).rejects.toThrowError(new TypeError('prod message'));
    assertConsoleErrorDev([
      'Form field values (value, checked, defaultValue, or defaultChecked props) must be ' +
        'strings, not TemporalLike. This value must be coerced to a string before using it here.\n' +
        '    in input (at **)',
      'Form field values (value, checked, defaultValue, or defaultChecked props) must be ' +
        'strings, not TemporalLike. This value must be coerced to a string before using it here.\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should throw for date inputs if `value` is an object where valueOf() throws」描述的渲染、交互或错误处理结果。 */
  it('should throw for date inputs if `value` is an object where valueOf() throws', async () => {
    /** `TemporalLike`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class TemporalLike {
      /** `TemporalLike.valueOf`：实现测试夹具的生命周期、渲染或交互步骤。 */
      valueOf() {
        // 此处抛错符合 ECMAScript “Temporal” 日期/时间 API 的行为。
        // 参见 https://tc39.es/proposal-temporal/docs/plaindate.html#valueOf
        throw new TypeError('prod message');
      }
      /** `TemporalLike.toString`：实现测试夹具的生命周期、渲染或交互步骤。 */
      toString() {
        return '2020-01-01';
      }
    }
    await expect(async () => {
      await act(() => {
        root.render(
          <input value={new TemporalLike()} type="date" onChange={() => {}} />,
        );
      });
    }).rejects.toThrowError(new TypeError('prod message'));
    assertConsoleErrorDev([
      'Form field values (value, checked, defaultValue, or defaultChecked props) must be ' +
        'strings, not TemporalLike. This value must be coerced to a string before using it here.\n' +
        '    in input (at **)',
      'Form field values (value, checked, defaultValue, or defaultChecked props) must be ' +
        'strings, not TemporalLike. This value must be coerced to a string before using it here.\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should throw for text inputs if `value` is an object where valueOf() throws」描述的渲染、交互或错误处理结果。 */
  it('should throw for text inputs if `value` is an object where valueOf() throws', async () => {
    /** `TemporalLike`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class TemporalLike {
      /** `TemporalLike.valueOf`：实现测试夹具的生命周期、渲染或交互步骤。 */
      valueOf() {
        // 此处抛错符合 ECMAScript “Temporal” 日期/时间 API 的行为。
        // 参见 https://tc39.es/proposal-temporal/docs/plaindate.html#valueOf
        throw new TypeError('prod message');
      }
      /** `TemporalLike.toString`：实现测试夹具的生命周期、渲染或交互步骤。 */
      toString() {
        return '2020-01-01';
      }
    }
    await expect(async () => {
      await act(() => {
        root.render(
          <input value={new TemporalLike()} type="text" onChange={() => {}} />,
        );
      });
    }).rejects.toThrowError(new TypeError('prod message'));
    assertConsoleErrorDev([
      'Form field values (value, checked, defaultValue, or defaultChecked props) must be ' +
        'strings, not TemporalLike. This value must be coerced to a string before using it here.\n' +
        '    in input (at **)',
      'Form field values (value, checked, defaultValue, or defaultChecked props) must be ' +
        'strings, not TemporalLike. This value must be coerced to a string before using it here.\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should display `value` of number 0」描述的渲染、交互或错误处理结果。 */
  it('should display `value` of number 0', async () => {
    await act(() => {
      root.render(<input type="text" value={0} onChange={emptyFunction} />);
    });
    const node = container.firstChild;

    expect(node.value).toBe('0');
  });

  /** 测试场景：验证「should display `value` of bigint 5」描述的渲染、交互或错误处理结果。 */
  it('should display `value` of bigint 5', async () => {
    await act(() => {
      root.render(<input type="text" value={5n} onChange={emptyFunction} />);
    });
    const node = container.firstChild;

    expect(node.value).toBe('5');
  });

  /** 测试场景：验证「should allow setting `value` to `true`」描述的渲染、交互或错误处理结果。 */
  it('should allow setting `value` to `true`', async () => {
    await act(() => {
      root.render(<input type="text" value="yolo" onChange={emptyFunction} />);
    });
    const node = container.firstChild;

    expect(node.value).toBe('yolo');

    await act(() => {
      root.render(<input type="text" value={true} onChange={emptyFunction} />);
    });
    expect(node.value).toEqual('true');
  });

  /** 测试场景：验证「should allow setting `value` to `false`」描述的渲染、交互或错误处理结果。 */
  it('should allow setting `value` to `false`', async () => {
    await act(() => {
      root.render(<input type="text" value="yolo" onChange={emptyFunction} />);
    });
    const node = container.firstChild;

    expect(node.value).toBe('yolo');

    await act(() => {
      root.render(<input type="text" value={false} onChange={emptyFunction} />);
    });
    expect(node.value).toEqual('false');
  });

  /** 测试场景：验证「should allow setting `value` to `objToString`」描述的渲染、交互或错误处理结果。 */
  it('should allow setting `value` to `objToString`', async () => {
    await act(() => {
      root.render(<input type="text" value="foo" onChange={emptyFunction} />);
    });
    const node = container.firstChild;

    expect(node.value).toBe('foo');

    const objToString = {
      /** `toString`：封装当前用例复用的操作、回调或断言步骤。 */
      toString: function () {
        return 'foobar';
      },
    };
    await act(() => {
      root.render(
        <input type="text" value={objToString} onChange={emptyFunction} />,
      );
    });
    expect(node.value).toEqual('foobar');
  });

  /** 测试场景：验证「should not incur unnecessary DOM mutations」描述的渲染、交互或错误处理结果。 */
  it('should not incur unnecessary DOM mutations', async () => {
    await act(() => {
      root.render(<input value="a" onChange={() => {}} />);
    });

    const node = container.firstChild;
    let nodeValue = 'a';
    const nodeValueSetter = jest.fn();
    Object.defineProperty(node, 'value', {
      /** `get`：封装当前用例复用的操作、回调或断言步骤。 */
      get: function () {
        return nodeValue;
      },
      set: nodeValueSetter.mockImplementation(function (newValue) {
        nodeValue = newValue;
      }),
    });

    await act(() => {
      root.render(<input value="a" onChange={() => {}} />);
    });
    expect(nodeValueSetter).toHaveBeenCalledTimes(0);

    await act(() => {
      root.render(<input value="b" onChange={() => {}} />);
    });
    expect(nodeValueSetter).toHaveBeenCalledTimes(1);
  });

  /** 测试场景：验证「should not incur unnecessary DOM mutations for numeric type conversion」描述的渲染、交互或错误处理结果。 */
  it('should not incur unnecessary DOM mutations for numeric type conversion', async () => {
    await act(() => {
      root.render(<input value="0" onChange={() => {}} />);
    });

    const node = container.firstChild;
    let nodeValue = '0';
    const nodeValueSetter = jest.fn();
    Object.defineProperty(node, 'value', {
      /** `get`：封装当前用例复用的操作、回调或断言步骤。 */
      get: function () {
        return nodeValue;
      },
      set: nodeValueSetter.mockImplementation(function (newValue) {
        nodeValue = newValue;
      }),
    });

    await act(() => {
      root.render(<input value={0} onChange={() => {}} />);
    });
    expect(nodeValueSetter).toHaveBeenCalledTimes(0);
  });

  /** 测试场景：验证「should not incur unnecessary DOM mutations for the boolean type conversion」描述的渲染、交互或错误处理结果。 */
  it('should not incur unnecessary DOM mutations for the boolean type conversion', async () => {
    await act(() => {
      root.render(<input value="true" onChange={() => {}} />);
    });

    const node = container.firstChild;
    let nodeValue = 'true';
    const nodeValueSetter = jest.fn();
    Object.defineProperty(node, 'value', {
      /** `get`：封装当前用例复用的操作、回调或断言步骤。 */
      get: function () {
        return nodeValue;
      },
      set: nodeValueSetter.mockImplementation(function (newValue) {
        nodeValue = newValue;
      }),
    });

    await act(() => {
      root.render(<input value={true} onChange={() => {}} />);
    });
    expect(nodeValueSetter).toHaveBeenCalledTimes(0);
  });

  /** 测试场景：验证「should properly control a value of number `0`」描述的渲染、交互或错误处理结果。 */
  it('should properly control a value of number `0`', async () => {
    await act(() => {
      root.render(<input type="text" value={0} onChange={emptyFunction} />);
    });
    const node = container.firstChild;

    setUntrackedValue.call(node, 'giraffe');
    dispatchEventOnNode(node, 'input');
    expect(node.value).toBe('0');
  });

  /** 测试场景：验证「should properly control 0.0 for a text input」描述的渲染、交互或错误处理结果。 */
  it('should properly control 0.0 for a text input', async () => {
    await act(() => {
      root.render(<input type="text" value={0} onChange={emptyFunction} />);
    });
    const node = container.firstChild;

    setUntrackedValue.call(node, '0.0');
    await act(() => {
      dispatchEventOnNode(node, 'input');
    });
    expect(node.value).toBe('0');
  });

  /** 测试场景：验证「should properly control 0.0 for a number input」描述的渲染、交互或错误处理结果。 */
  it('should properly control 0.0 for a number input', async () => {
    await act(() => {
      root.render(<input type="number" value={0} onChange={emptyFunction} />);
    });
    const node = container.firstChild;

    setUntrackedValue.call(node, '0.0');
    await act(() => {
      dispatchEventOnNode(node, 'input');
    });

    if (disableInputAttributeSyncing) {
      expect(node.value).toBe('0.0');
      expect(node.hasAttribute('value')).toBe(false);
    } else {
      expect(node.value).toBe('0.0');
      expect(node.getAttribute('value')).toBe('0.0');
    }
  });

  /** 测试场景：验证「should properly transition from an empty value to 0」描述的渲染、交互或错误处理结果。 */
  it('should properly transition from an empty value to 0', async () => {
    await act(() => {
      root.render(<input type="text" value="" onChange={emptyFunction} />);
    });
    const node = container.firstChild;
    expect(isValueDirty(node)).toBe(false);

    await act(() => {
      root.render(<input type="text" value={0} onChange={emptyFunction} />);
    });

    expect(node.value).toBe('0');
    expect(isValueDirty(node)).toBe(true);

    if (disableInputAttributeSyncing) {
      expect(node.hasAttribute('value')).toBe(false);
    } else {
      expect(node.defaultValue).toBe('0');
    }
  });

  /** 测试场景：验证「should properly transition from 0 to an empty value」描述的渲染、交互或错误处理结果。 */
  it('should properly transition from 0 to an empty value', async () => {
    await act(() => {
      root.render(<input type="text" value={0} onChange={emptyFunction} />);
    });
    const node = container.firstChild;
    expect(isValueDirty(node)).toBe(true);

    await act(() => {
      root.render(<input type="text" value="" onChange={emptyFunction} />);
    });

    expect(node.value).toBe('');
    expect(node.defaultValue).toBe('');
    expect(isValueDirty(node)).toBe(true);
  });

  /** 测试场景：验证「should properly transition a text input from 0 to an empty 0.0」描述的渲染、交互或错误处理结果。 */
  it('should properly transition a text input from 0 to an empty 0.0', async () => {
    await act(() => {
      root.render(<input type="text" value={0} onChange={emptyFunction} />);
    });
    await act(() => {
      root.render(<input type="text" value="0.0" onChange={emptyFunction} />);
    });

    const node = container.firstChild;

    expect(node.value).toBe('0.0');
    if (disableInputAttributeSyncing) {
      expect(node.hasAttribute('value')).toBe(false);
    } else {
      expect(node.defaultValue).toBe('0.0');
    }
  });

  /** 测试场景：验证「should properly transition a number input from "" to 0」描述的渲染、交互或错误处理结果。 */
  it('should properly transition a number input from "" to 0', async () => {
    await act(() => {
      root.render(<input type="number" value="" onChange={emptyFunction} />);
    });
    await act(() => {
      root.render(<input type="number" value={0} onChange={emptyFunction} />);
    });

    const node = container.firstChild;

    expect(node.value).toBe('0');
    if (disableInputAttributeSyncing) {
      expect(node.hasAttribute('value')).toBe(false);
    } else {
      expect(node.defaultValue).toBe('0');
    }
  });

  /** 测试场景：验证「should properly transition a number input from "" to "0"」描述的渲染、交互或错误处理结果。 */
  it('should properly transition a number input from "" to "0"', async () => {
    await act(() => {
      root.render(<input type="number" value="" onChange={emptyFunction} />);
    });
    await act(() => {
      root.render(<input type="number" value="0" onChange={emptyFunction} />);
    });

    const node = container.firstChild;

    expect(node.value).toBe('0');
    if (disableInputAttributeSyncing) {
      expect(node.hasAttribute('value')).toBe(false);
    } else {
      expect(node.defaultValue).toBe('0');
    }
  });

  /** 测试场景：验证「should have the correct target value」描述的渲染、交互或错误处理结果。 */
  it('should have the correct target value', async () => {
    let handled = false;
    /** `handler`：封装当前用例复用的操作、回调或断言步骤。 */
    const handler = function (event) {
      expect(event.target.nodeName).toBe('INPUT');
      handled = true;
    };
    await act(() => {
      root.render(<input type="text" value={0} onChange={handler} />);
    });
    const node = container.firstChild;

    setUntrackedValue.call(node, 'giraffe');

    await act(() => {
      dispatchEventOnNode(node, 'input');
    });

    expect(handled).toBe(true);
  });

  /** 测试场景：验证「should restore uncontrolled inputs to last defaultValue upon reset」描述的渲染、交互或错误处理结果。 */
  it('should restore uncontrolled inputs to last defaultValue upon reset', async () => {
    const inputRef = React.createRef();
    await act(() => {
      root.render(
        <form>
          <input defaultValue="default1" ref={inputRef} />
          <input type="reset" />
        </form>,
      );
    });
    expect(inputRef.current.value).toBe('default1');
    if (disableInputAttributeSyncing) {
      expect(isValueDirty(inputRef.current)).toBe(false);
    } else {
      expect(isValueDirty(inputRef.current)).toBe(true);
    }

    setUntrackedValue.call(inputRef.current, 'changed');
    dispatchEventOnNode(inputRef.current, 'input');
    expect(inputRef.current.value).toBe('changed');
    expect(isValueDirty(inputRef.current)).toBe(true);

    await act(() => {
      root.render(
        <form>
          <input defaultValue="default2" ref={inputRef} />
          <input type="reset" />
        </form>,
      );
    });
    expect(inputRef.current.value).toBe('changed');
    expect(isValueDirty(inputRef.current)).toBe(true);

    container.firstChild.reset();
    // 注意：尚不确定是否要永久支持此行为，但既然它是当前行为，若要破坏它就应有意为之。
    // 参见 https://github.com/facebook/react/issues/4618。
    expect(inputRef.current.value).toBe('default2');
    expect(isValueDirty(inputRef.current)).toBe(false);
  });

  /** 测试场景：验证「should not set a value for submit buttons unnecessarily」描述的渲染、交互或错误处理结果。 */
  it('should not set a value for submit buttons unnecessarily', async () => {
    const stub = <input type="submit" />;
    await act(() => {
      root.render(stub);
    });
    const node = container.firstChild;

    // value 不应为 `''`，否则按钮将没有文字；它应显示默认的 “Submit” 或 “Submit Query” 标签。
    // 大多数浏览器会报告它根本没有 `value` attribute；IE 则报告用户看到的实际标签。
    expect(node.hasAttribute('value')).toBe(false);
  });

  /** 测试场景：验证「should remove the value attribute on submit inputs when value is updated to undefined」描述的渲染、交互或错误处理结果。 */
  it('should remove the value attribute on submit inputs when value is updated to undefined', async () => {
    const stub = <input type="submit" value="foo" onChange={emptyFunction} />;
    await act(() => {
      root.render(stub);
    });

    // 对于这个特定的测试并不重要, 但如果转换为 undefined 则仍然会引发警告
    await act(() => {
      root.render(
        <input type="submit" value={undefined} onChange={emptyFunction} />,
      );
    });
    assertConsoleErrorDev([
      'A component is changing a controlled input to be uncontrolled. ' +
        'This is likely caused by the value changing from a defined to undefined, which should not happen. ' +
        'Decide between using a controlled or uncontrolled input element for the lifetime of the component. ' +
        'More info: https://react.dev/link/controlled-components\n' +
        '    in input (at **)',
    ]);

    const node = container.firstChild;
    expect(node.getAttribute('value')).toBe(null);
  });

  /** 测试场景：验证「should remove the value attribute on reset inputs when value is updated to undefined」描述的渲染、交互或错误处理结果。 */
  it('should remove the value attribute on reset inputs when value is updated to undefined', async () => {
    const stub = <input type="reset" value="foo" onChange={emptyFunction} />;
    await act(() => {
      root.render(stub);
    });

    // 对于这个特定的测试并不重要, 但如果转换为 undefined 则仍然会引发警告
    await act(() => {
      root.render(
        <input type="reset" value={undefined} onChange={emptyFunction} />,
      );
    });
    assertConsoleErrorDev([
      'A component is changing a controlled input to be uncontrolled. ' +
        'This is likely caused by the value changing from a defined to undefined, which should not happen. ' +
        'Decide between using a controlled or uncontrolled input element for the lifetime of the component. ' +
        'More info: https://react.dev/link/controlled-components\n' +
        '    in input (at **)',
    ]);

    const node = container.firstChild;
    expect(node.getAttribute('value')).toBe(null);
  });

  /** 测试场景：验证「should set a value on a submit input」描述的渲染、交互或错误处理结果。 */
  it('should set a value on a submit input', async () => {
    const stub = <input type="submit" value="banana" />;
    await act(() => {
      root.render(stub);
    });
    const node = container.firstChild;

    expect(node.getAttribute('value')).toBe('banana');
  });

  /** 测试场景：验证「should not set an undefined value on a submit input」描述的渲染、交互或错误处理结果。 */
  it('should not set an undefined value on a submit input', async () => {
    const stub = <input type="submit" value={undefined} />;
    await act(() => {
      root.render(stub);
    });
    const node = container.firstChild;

    // 请注意，它不应该是一个空字符串，因为这会删除 "submit" 标签。
    expect(node.getAttribute('value')).toBe(null);

    await act(() => {
      root.render(stub);
    });
    expect(node.getAttribute('value')).toBe(null);
  });

  /** 测试场景：验证「should not set an undefined value on a reset input」描述的渲染、交互或错误处理结果。 */
  it('should not set an undefined value on a reset input', async () => {
    const stub = <input type="reset" value={undefined} />;
    await act(() => {
      root.render(stub);
    });
    const node = container.firstChild;

    // 请注意，它不应该是一个空字符串，因为这会删除 "reset" 标签。
    expect(node.getAttribute('value')).toBe(null);

    await act(() => {
      root.render(stub);
    });
    expect(node.getAttribute('value')).toBe(null);
  });

  /** 测试场景：验证「should not set a null value on a submit input」描述的渲染、交互或错误处理结果。 */
  it('should not set a null value on a submit input', async () => {
    const stub = <input type="submit" value={null} />;
    await act(() => {
      root.render(stub);
    });
    assertConsoleErrorDev([
      '`value` prop on `input` should not be null. ' +
        'Consider using an empty string to clear the component or `undefined` for uncontrolled components.\n' +
        '    in input (at **)',
    ]);
    const node = container.firstChild;

    // 请注意，它不应该是一个空字符串，因为这会删除 "submit" 标签。
    expect(node.getAttribute('value')).toBe(null);

    await act(() => {
      root.render(stub);
    });
    expect(node.getAttribute('value')).toBe(null);
  });

  /** 测试场景：验证「should not set a null value on a reset input」描述的渲染、交互或错误处理结果。 */
  it('should not set a null value on a reset input', async () => {
    const stub = <input type="reset" value={null} />;
    await act(() => {
      root.render(stub);
    });
    assertConsoleErrorDev([
      '`value` prop on `input` should not be null. ' +
        'Consider using an empty string to clear the component or `undefined` for uncontrolled components.\n' +
        '    in input (at **)',
    ]);
    const node = container.firstChild;

    // 请注意，它不应该是一个空字符串，因为这会删除 "reset" 标签。
    expect(node.getAttribute('value')).toBe(null);

    await act(() => {
      root.render(stub);
    });
    expect(node.getAttribute('value')).toBe(null);
  });

  /** 测试场景：验证「should set a value on a reset input」描述的渲染、交互或错误处理结果。 */
  it('should set a value on a reset input', async () => {
    const stub = <input type="reset" value="banana" />;
    await act(() => {
      root.render(stub);
    });
    const node = container.firstChild;

    expect(node.getAttribute('value')).toBe('banana');
  });

  /** 测试场景：验证「should set an empty string value on a submit input」描述的渲染、交互或错误处理结果。 */
  it('should set an empty string value on a submit input', async () => {
    const stub = <input type="submit" value="" />;
    await act(() => {
      root.render(stub);
    });
    const node = container.firstChild;

    expect(node.getAttribute('value')).toBe('');
  });

  /** 测试场景：验证「should set an empty string value on a reset input」描述的渲染、交互或错误处理结果。 */
  it('should set an empty string value on a reset input', async () => {
    const stub = <input type="reset" value="" />;
    await act(() => {
      root.render(stub);
    });
    const node = container.firstChild;

    expect(node.getAttribute('value')).toBe('');
  });

  /** 测试场景：验证「should control radio buttons」描述的渲染、交互或错误处理结果。 */
  it('should control radio buttons', async () => {
    /** `RadioGroup`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class RadioGroup extends React.Component {
      /** `RadioGroup.aRef`：记录测试夹具在当前场景中的状态。 */
      aRef = React.createRef();
      /** `RadioGroup.bRef`：记录测试夹具在当前场景中的状态。 */
      bRef = React.createRef();
      /** `RadioGroup.cRef`：记录测试夹具在当前场景中的状态。 */
      cRef = React.createRef();

      /** `RadioGroup.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            <input
              ref={this.aRef}
              type="radio"
              name="fruit"
              checked={true}
              onChange={emptyFunction}
              data-which="a"
            />
            A
            <input
              ref={this.bRef}
              type="radio"
              name="fruit"
              onChange={emptyFunction}
              data-which="b"
            />
            B
            <form>
              <input
                ref={this.cRef}
                type="radio"
                name="fruit"
                defaultChecked={true}
                onChange={emptyFunction}
                data-which="c"
              />
            </form>
          </div>
        );
      }
    }

    const ref = React.createRef();
    await act(() => {
      root.render(<RadioGroup ref={ref} />);
    });
    const stub = ref.current;
    const aNode = stub.aRef.current;
    const bNode = stub.bRef.current;
    const cNode = stub.cRef.current;

    expect(aNode.checked).toBe(true);
    expect(bNode.checked).toBe(false);
    // c 应该在另一个表单中，不应该在这里受到影响。
    expect(cNode.checked).toBe(true);

    if (disableInputAttributeSyncing) {
      expect(aNode.hasAttribute('checked')).toBe(false);
      expect(bNode.hasAttribute('checked')).toBe(false);
      expect(cNode.hasAttribute('checked')).toBe(true);
    } else {
      expect(aNode.hasAttribute('checked')).toBe(true);
      expect(bNode.hasAttribute('checked')).toBe(false);
      expect(cNode.hasAttribute('checked')).toBe(true);
    }

    expect(isCheckedDirty(aNode)).toBe(true);
    expect(isCheckedDirty(bNode)).toBe(true);
    expect(isCheckedDirty(cNode)).toBe(true);
    assertInputTrackingIsCurrent(container);

    setUntrackedChecked.call(bNode, true);
    expect(aNode.checked).toBe(false);
    expect(cNode.checked).toBe(true);

    // 原始的 'checked' 属性应保持不变。
    if (disableInputAttributeSyncing) {
      expect(aNode.hasAttribute('checked')).toBe(false);
      expect(bNode.hasAttribute('checked')).toBe(false);
      expect(cNode.hasAttribute('checked')).toBe(true);
    } else {
      expect(aNode.hasAttribute('checked')).toBe(true);
      expect(bNode.hasAttribute('checked')).toBe(false);
      expect(cNode.hasAttribute('checked')).toBe(true);
    }

    // 现在运行实际的 ReactDOMInput change 事件处理器。
    await act(() => {
      dispatchEventOnNode(bNode, 'click');
    });

    // 应该恢复原来的状态.
    expect(aNode.checked).toBe(true);
    expect(cNode.checked).toBe(true);

    expect(isCheckedDirty(aNode)).toBe(true);
    expect(isCheckedDirty(bNode)).toBe(true);
    expect(isCheckedDirty(cNode)).toBe(true);
    assertInputTrackingIsCurrent(container);
  });

  /** 测试场景：验证「should hydrate controlled radio buttons」描述的渲染、交互或错误处理结果。 */
  it('should hydrate controlled radio buttons', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [current, setCurrent] = React.useState('a');
      return (
        <>
          <input
            type="radio"
            name="fruit"
            checked={current === 'a'}
            onChange={() => {
              Scheduler.log('click a');
              setCurrent('a');
            }}
          />
          <input
            type="radio"
            name="fruit"
            checked={current === 'b'}
            onChange={() => {
              Scheduler.log('click b');
              setCurrent('b');
            }}
          />
          <input
            type="radio"
            name="fruit"
            checked={current === 'c'}
            onChange={() => {
              Scheduler.log('click c');
              // 假设用户无法选择 C。
            }}
          />
        </>
      );
    }
    const html = ReactDOMServer.renderToString(<App />);
    // 创建一个全新容器，尚未向其附加 root。
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = html;
    const [a, b, c] = container.querySelectorAll('input');
    expect(a.checked).toBe(true);
    expect(b.checked).toBe(false);
    expect(c.checked).toBe(false);
    expect(isCheckedDirty(a)).toBe(false);
    expect(isCheckedDirty(b)).toBe(false);
    expect(isCheckedDirty(c)).toBe(false);

    // 在 hydration 前点击 B。
    b.checked = true;
    expect(isCheckedDirty(a)).toBe(true);
    expect(isCheckedDirty(b)).toBe(true);
    expect(isCheckedDirty(c)).toBe(false);

    await act(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });

    if (gate(flags => flags.enableHydrationChangeEvent)) {
      // 我们重播了点击，因为 hydration 之前值已经改变。
      assertLog(['click b']);
    } else {
      assertLog([]);
      // 奇怪的是，尽管渲染 A 时传入 checked={true}、渲染 B 时传入 checked={false}，
      // 最终仍会保留 `b` 的选中状态。这可能是一个 bug。
    }
    expect(a.checked).toBe(false);
    expect(b.checked).toBe(true);
    expect(c.checked).toBe(false);
    expect(isCheckedDirty(a)).toBe(true);
    expect(isCheckedDirty(b)).toBe(true);
    expect(isCheckedDirty(c)).toBe(true);
    assertInputTrackingIsCurrent(container);

    // 如果我们现在点击C...
    await act(async () => {
      setUntrackedChecked.call(c, true);
      dispatchEventOnNode(c, 'click');
    });

    assertLog(['click c']);
    if (gate(flags => flags.enableHydrationChangeEvent)) {
      // C 的 onClick 不设置状态，因此 B 会重新被选中。
      expect(a.checked).toBe(false);
      expect(b.checked).toBe(true);
      expect(c.checked).toBe(false);
    } else {
      // C 的 onClick 不会设置状态；此分支未重放选择 B 的操作，因此 A 会重新被选中。
      expect(a.checked).toBe(true);
      expect(b.checked).toBe(false);
      expect(c.checked).toBe(false);
    }
    expect(isCheckedDirty(a)).toBe(true);
    expect(isCheckedDirty(b)).toBe(true);
    expect(isCheckedDirty(c)).toBe(true);
    assertInputTrackingIsCurrent(container);

    await act(async () => {
      setUntrackedChecked.call(b, true);
      dispatchEventOnNode(b, 'click');
    });
    if (gate(flags => flags.enableHydrationChangeEvent)) {
      // 既然我们已经选择了这个, 这不会再次触发变化。
      assertLog([]);
    } else {
      // hydration 完成后仍可正确切换到 B。
      assertLog(['click b']);
    }
    expect(a.checked).toBe(false);
    expect(b.checked).toBe(true);
    expect(c.checked).toBe(false);
    expect(isCheckedDirty(a)).toBe(true);
    expect(isCheckedDirty(b)).toBe(true);
    expect(isCheckedDirty(c)).toBe(true);
    assertInputTrackingIsCurrent(container);
  });

  /** 测试场景：验证「should hydrate uncontrolled radio buttons」描述的渲染、交互或错误处理结果。 */
  it('should hydrate uncontrolled radio buttons', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <>
          <input
            type="radio"
            name="fruit"
            defaultChecked={true}
            onChange={() => Scheduler.log('click a')}
          />
          <input
            type="radio"
            name="fruit"
            defaultChecked={false}
            onChange={() => Scheduler.log('click b')}
          />
          <input
            type="radio"
            name="fruit"
            defaultChecked={false}
            onChange={() => Scheduler.log('click c')}
          />
        </>
      );
    }
    const html = ReactDOMServer.renderToString(<App />);
    // 创建一个全新容器，尚未向其附加 root。
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = html;
    const [a, b, c] = container.querySelectorAll('input');
    expect(a.checked).toBe(true);
    expect(b.checked).toBe(false);
    expect(c.checked).toBe(false);
    expect(isCheckedDirty(a)).toBe(false);
    expect(isCheckedDirty(b)).toBe(false);
    expect(isCheckedDirty(c)).toBe(false);

    // 在 hydration 前点击 B。
    b.checked = true;
    expect(isCheckedDirty(a)).toBe(true);
    expect(isCheckedDirty(b)).toBe(true);
    expect(isCheckedDirty(c)).toBe(false);

    await act(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });

    if (gate(flags => flags.enableHydrationChangeEvent)) {
      // 我们重播了点击，因为 hydration 之前值已经改变。
      assertLog(['click b']);
    } else {
      assertLog([]);
    }
    expect(a.checked).toBe(false);
    expect(b.checked).toBe(true);
    expect(c.checked).toBe(false);
    expect(isCheckedDirty(a)).toBe(true);
    expect(isCheckedDirty(b)).toBe(true);
    expect(isCheckedDirty(c)).toBe(true);
    assertInputTrackingIsCurrent(container);

    // 再点击 A 切回去。
    await act(async () => {
      setUntrackedChecked.call(a, true);
      dispatchEventOnNode(a, 'click');
    });

    assertLog(['click a']);
    expect(a.checked).toBe(true);
    expect(b.checked).toBe(false);
    expect(c.checked).toBe(false);
    expect(isCheckedDirty(a)).toBe(true);
    expect(isCheckedDirty(b)).toBe(true);
    expect(isCheckedDirty(c)).toBe(true);
    assertInputTrackingIsCurrent(container);
  });

  /** 测试场景：验证「should check the correct radio when the selected name moves」描述的渲染、交互或错误处理结果。 */
  it('should check the correct radio when the selected name moves', async () => {
    /** `App`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class App extends React.Component {
      /** `App.state`：记录测试夹具在当前场景中的状态。 */
      state = {
        updated: false,
      };
      /** `App.onClick`：封装当前用例复用的操作、回调或断言步骤。 */
      onClick = () => {
        this.setState({updated: !this.state.updated});
      };
      /** `App.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        const {updated} = this.state;
        const radioName = updated ? 'secondName' : 'firstName';
        return (
          <div>
            <button type="button" onClick={this.onClick} />
            <input
              type="radio"
              name={radioName}
              onChange={emptyFunction}
              checked={updated === true}
            />
            <input
              type="radio"
              name={radioName}
              onChange={emptyFunction}
              checked={updated === false}
            />
          </div>
        );
      }
    }

    await act(() => {
      root.render(<App />);
    });
    const node = container.firstChild;
    const buttonNode = node.childNodes[0];
    const firstRadioNode = node.childNodes[1];
    expect(isCheckedDirty(firstRadioNode)).toBe(true);
    expect(firstRadioNode.checked).toBe(false);
    assertInputTrackingIsCurrent(container);
    await act(() => {
      dispatchEventOnNode(buttonNode, 'click');
    });
    expect(firstRadioNode.checked).toBe(true);
    assertInputTrackingIsCurrent(container);
    await act(() => {
      dispatchEventOnNode(buttonNode, 'click');
    });
    expect(firstRadioNode.checked).toBe(false);
    assertInputTrackingIsCurrent(container);
  });

  /** 测试场景：验证「shouldn't get tricked by changing radio names, part 2」描述的渲染、交互或错误处理结果。 */
  it("shouldn't get tricked by changing radio names, part 2", async () => {
    await act(() => {
      root.render(
        <div>
          <input
            type="radio"
            name="a"
            value="1"
            checked={true}
            onChange={() => {}}
          />
          <input
            type="radio"
            name="a"
            value="2"
            checked={false}
            onChange={() => {}}
          />
        </div>,
      );
    });
    const one = container.querySelector('input[name="a"][value="1"]');
    const two = container.querySelector('input[name="a"][value="2"]');
    expect(one.checked).toBe(true);
    expect(two.checked).toBe(false);
    expect(isCheckedDirty(one)).toBe(true);
    expect(isCheckedDirty(two)).toBe(true);
    assertInputTrackingIsCurrent(container);

    await act(() => {
      root.render(
        <div>
          <input
            type="radio"
            name="a"
            value="1"
            checked={true}
            onChange={() => {}}
          />
          <input
            type="radio"
            name="b"
            value="2"
            checked={true}
            onChange={() => {}}
          />
        </div>,
      );
    });
    expect(one.checked).toBe(true);
    expect(two.checked).toBe(true);
    expect(isCheckedDirty(one)).toBe(true);
    expect(isCheckedDirty(two)).toBe(true);
    assertInputTrackingIsCurrent(container);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should control radio buttons if the tree updates during render in legacy mode」描述的渲染、交互或错误处理结果。 */
  it('should control radio buttons if the tree updates during render in legacy mode', async () => {
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    const sharedParent = container;
    const container1 = document.createElement('div');
    const container2 = document.createElement('div');

    sharedParent.appendChild(container1);

    let aNode;
    let bNode;
    /** `ComponentA`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ComponentA extends React.Component {
      /** `ComponentA.state`：记录测试夹具在当前场景中的状态。 */
      state = {changed: false};
      /** `ComponentA.handleChange`：封装当前用例复用的操作、回调或断言步骤。 */
      handleChange = () => {
        this.setState({
          changed: true,
        });
      };
      /** `ComponentA.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        sharedParent.appendChild(container2);
      }
      /** `ComponentA.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        ReactDOM.render(<ComponentB />, container2);
      }
      /** `ComponentA.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            <input
              ref={n => (aNode = n)}
              type="radio"
              name="fruit"
              checked={false}
              onChange={this.handleChange}
            />
            A
          </div>
        );
      }
    }

    /** `ComponentB`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ComponentB extends React.Component {
      /** `ComponentB.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            <input
              ref={n => (bNode = n)}
              type="radio"
              name="fruit"
              checked={true}
              onChange={emptyFunction}
            />
            B
          </div>
        );
      }
    }

    ReactDOM.render(<ComponentA />, container1);

    expect(aNode.checked).toBe(false);
    expect(bNode.checked).toBe(true);
    expect(isCheckedDirty(aNode)).toBe(true);
    expect(isCheckedDirty(bNode)).toBe(true);
    assertInputTrackingIsCurrent(container);

    setUntrackedChecked.call(aNode, true);
    // 在真实浏览器中下一行并非必需；jsdom 不会取消同组其他项的选中状态，因为它们尚未共享父节点，
    // 这会略微削弱本测试的有效性。
    setUntrackedChecked.call(bNode, false);

    // 现在运行实际的 ReactDOMInput change 事件处理器。
    dispatchEventOnNode(aNode, 'click');

    // 应该恢复原来的状态.
    expect(aNode.checked).toBe(false);
    expect(bNode.checked).toBe(true);
    expect(isCheckedDirty(aNode)).toBe(true);
    expect(isCheckedDirty(bNode)).toBe(true);
    assertInputTrackingIsCurrent(container);
  });

  /** 测试场景：验证「should control radio buttons if the tree updates during render (case 2; #26876)」描述的渲染、交互或错误处理结果。 */
  it('should control radio buttons if the tree updates during render (case 2; #26876)', async () => {
    let thunk = null;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [disabled, setDisabled] = React.useState(false);
      const [value, setValue] = React.useState('one');
      /** `App.handleChange`：封装当前用例复用的操作、回调或断言步骤。 */
      function handleChange(e) {
        setDisabled(true);
        // 假装这是在 setTimeout 或其他地方。
        thunk = () => {
          setDisabled(false);
          setValue(e.target.value);
        };
      }
      return (
        <>
          <input
            type="radio"
            name="fruit"
            value="one"
            checked={value === 'one'}
            onChange={handleChange}
            disabled={disabled}
          />
          <input
            type="radio"
            name="fruit"
            value="two"
            checked={value === 'two'}
            onChange={handleChange}
            disabled={disabled}
          />
        </>
      );
    }
    await act(() => {
      root.render(<App />);
    });
    const [one, two] = container.querySelectorAll('input');
    expect(one.checked).toBe(true);
    expect(two.checked).toBe(false);
    expect(isCheckedDirty(one)).toBe(true);
    expect(isCheckedDirty(two)).toBe(true);
    assertInputTrackingIsCurrent(container);

    // 点击 two。
    setUntrackedChecked.call(two, true);
    await act(() => {
      dispatchEventOnNode(two, 'click');
    });
    expect(one.checked).toBe(true);
    expect(two.checked).toBe(false);
    expect(isCheckedDirty(one)).toBe(true);
    expect(isCheckedDirty(two)).toBe(true);
    assertInputTrackingIsCurrent(container);

    // 在延迟后...
    await act(thunk);
    expect(one.checked).toBe(false);
    expect(two.checked).toBe(true);
    expect(isCheckedDirty(one)).toBe(true);
    expect(isCheckedDirty(two)).toBe(true);
    assertInputTrackingIsCurrent(container);

    // 再点击 one 切回去。
    setUntrackedChecked.call(one, true);
    await act(() => {
      dispatchEventOnNode(one, 'click');
    });
    expect(one.checked).toBe(false);
    expect(two.checked).toBe(true);
    expect(isCheckedDirty(one)).toBe(true);
    expect(isCheckedDirty(two)).toBe(true);
    assertInputTrackingIsCurrent(container);

    // 在延迟后...
    await act(thunk);
    expect(one.checked).toBe(true);
    expect(two.checked).toBe(false);
    expect(isCheckedDirty(one)).toBe(true);
    expect(isCheckedDirty(two)).toBe(true);
    assertInputTrackingIsCurrent(container);
  });

  /** 测试场景：验证「should warn with value and no onChange handler and readOnly specified」描述的渲染、交互或错误处理结果。 */
  it('should warn with value and no onChange handler and readOnly specified', async () => {
    await act(() => {
      root.render(<input type="text" value="zoink" readOnly={true} />);
    });
    root.unmount();
    root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<input type="text" value="zoink" readOnly={false} />);
    });
    assertConsoleErrorDev([
      'You provided a `value` prop to a form ' +
        'field without an `onChange` handler. This will render a read-only ' +
        'field. If the field should be mutable use `defaultValue`. ' +
        'Otherwise, set either `onChange` or `readOnly`.\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should have a this value of undefined if bind is not used」描述的渲染、交互或错误处理结果。 */
  it('should have a this value of undefined if bind is not used', async () => {
    expect.assertions(1);
    /** `unboundInputOnChange`：封装当前用例复用的操作、回调或断言步骤。 */
    const unboundInputOnChange = function () {
      expect(this).toBe(undefined);
    };

    const stub = <input type="text" onChange={unboundInputOnChange} />;
    await act(() => {
      root.render(stub);
    });
    const node = container.firstChild;

    setUntrackedValue.call(node, 'giraffe');
    await act(() => {
      dispatchEventOnNode(node, 'input');
    });
  });

  /** 测试场景：验证「should update defaultValue to empty string」描述的渲染、交互或错误处理结果。 */
  it('should update defaultValue to empty string', async () => {
    await act(() => {
      root.render(<input type="text" defaultValue={'foo'} />);
    });
    if (disableInputAttributeSyncing) {
      expect(isValueDirty(container.firstChild)).toBe(false);
    } else {
      expect(isValueDirty(container.firstChild)).toBe(true);
    }
    await act(() => {
      root.render(<input type="text" defaultValue={''} />);
    });
    expect(container.firstChild.defaultValue).toBe('');
    if (disableInputAttributeSyncing) {
      expect(isValueDirty(container.firstChild)).toBe(false);
    } else {
      expect(isValueDirty(container.firstChild)).toBe(true);
    }
  });

  /** 测试场景：验证「should warn if value is null」描述的渲染、交互或错误处理结果。 */
  it('should warn if value is null', async () => {
    await act(() => {
      root.render(<input type="text" value={null} />);
    });
    assertConsoleErrorDev([
      '`value` prop on `input` should not be null. ' +
        'Consider using an empty string to clear the component or `undefined` ' +
        'for uncontrolled components.\n' +
        '    in input (at **)',
    ]);
    root.unmount();

    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<input type="text" value={null} />);
    });
  });

  /** 测试场景：验证「should warn if checked and defaultChecked props are specified」描述的渲染、交互或错误处理结果。 */
  it('should warn if checked and defaultChecked props are specified', async () => {
    await act(() => {
      root.render(
        <input
          type="radio"
          checked={true}
          defaultChecked={true}
          readOnly={true}
        />,
      );
    });
    assertConsoleErrorDev([
      'A component contains an input of type radio with both checked and defaultChecked props. ' +
        'Input elements must be either controlled or uncontrolled ' +
        '(specify either the checked prop, or the defaultChecked prop, but not ' +
        'both). Decide between using a controlled or uncontrolled input ' +
        'element and remove one of these props. More info: ' +
        'https://react.dev/link/controlled-components\n' +
        '    in input (at **)',
    ]);
    root.unmount();

    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <input
          type="radio"
          checked={true}
          defaultChecked={true}
          readOnly={true}
        />,
      );
    });
  });

  /** 测试场景：验证「should warn if value and defaultValue props are specified」描述的渲染、交互或错误处理结果。 */
  it('should warn if value and defaultValue props are specified', async () => {
    await act(() => {
      root.render(
        <input type="text" value="foo" defaultValue="bar" readOnly={true} />,
      );
    });
    assertConsoleErrorDev([
      'A component contains an input of type text with both value and defaultValue props. ' +
        'Input elements must be either controlled or uncontrolled ' +
        '(specify either the value prop, or the defaultValue prop, but not ' +
        'both). Decide between using a controlled or uncontrolled input ' +
        'element and remove one of these props. More info: ' +
        'https://react.dev/link/controlled-components\n' +
        '    in input (at **)',
    ]);
    await (() => {
      root.unmount();
    });

    await act(() => {
      root.render(
        <input type="text" value="foo" defaultValue="bar" readOnly={true} />,
      );
    });
  });

  /** 测试场景：验证「should warn if controlled input switches to uncontrolled (value is undefined)」描述的渲染、交互或错误处理结果。 */
  it('should warn if controlled input switches to uncontrolled (value is undefined)', async () => {
    const stub = (
      <input type="text" value="controlled" onChange={emptyFunction} />
    );
    await act(() => {
      root.render(stub);
    });
    await act(() => {
      root.render(<input type="text" />);
    });
    assertConsoleErrorDev([
      'A component is changing a controlled input to be uncontrolled. ' +
        'This is likely caused by the value changing from a defined to ' +
        'undefined, which should not happen. ' +
        'Decide between using a controlled or uncontrolled input ' +
        'element for the lifetime of the component. More info: https://react.dev/link/controlled-components\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should warn if controlled input switches to uncontrolled (value is null)」描述的渲染、交互或错误处理结果。 */
  it('should warn if controlled input switches to uncontrolled (value is null)', async () => {
    const stub = (
      <input type="text" value="controlled" onChange={emptyFunction} />
    );
    await act(() => {
      root.render(stub);
    });
    await act(() => {
      root.render(<input type="text" value={null} />);
    });
    assertConsoleErrorDev([
      '`value` prop on `input` should not be null. ' +
        'Consider using an empty string to clear the component or `undefined` for uncontrolled components.\n' +
        '    in input (at **)',
      'A component is changing a controlled input to be uncontrolled. ' +
        'This is likely caused by the value changing from a defined to ' +
        'undefined, which should not happen. ' +
        'Decide between using a controlled or uncontrolled input ' +
        'element for the lifetime of the component. More info: https://react.dev/link/controlled-components\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should warn if controlled input switches to uncontrolled with defaultValue」描述的渲染、交互或错误处理结果。 */
  it('should warn if controlled input switches to uncontrolled with defaultValue', async () => {
    const stub = (
      <input type="text" value="controlled" onChange={emptyFunction} />
    );
    await act(() => {
      root.render(stub);
    });
    await act(() => {
      root.render(<input type="text" defaultValue="uncontrolled" />);
    });
    assertConsoleErrorDev([
      'A component is changing a controlled input to be uncontrolled. ' +
        'This is likely caused by the value changing from a defined to ' +
        'undefined, which should not happen. ' +
        'Decide between using a controlled or uncontrolled input ' +
        'element for the lifetime of the component. More info: https://react.dev/link/controlled-components\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should warn if uncontrolled input (value is undefined) switches to controlled」描述的渲染、交互或错误处理结果。 */
  it('should warn if uncontrolled input (value is undefined) switches to controlled', async () => {
    const stub = <input type="text" />;
    await act(() => {
      root.render(stub);
    });
    await act(() => {
      root.render(<input type="text" value="controlled" />);
    });
    assertConsoleErrorDev([
      'A component is changing an uncontrolled input to be controlled. ' +
        'This is likely caused by the value changing from undefined to ' +
        'a defined value, which should not happen. ' +
        'Decide between using a controlled or uncontrolled input ' +
        'element for the lifetime of the component. More info: https://react.dev/link/controlled-components\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should warn if uncontrolled input (value is null) switches to controlled」描述的渲染、交互或错误处理结果。 */
  it('should warn if uncontrolled input (value is null) switches to controlled', async () => {
    const stub = <input type="text" value={null} />;
    await act(() => {
      root.render(stub);
    });
    assertConsoleErrorDev([
      '`value` prop on `input` should not be null. ' +
        'Consider using an empty string to clear the component or `undefined` for uncontrolled components.\n' +
        '    in input (at **)',
    ]);
    await act(() => {
      root.render(<input type="text" value="controlled" />);
    });
    assertConsoleErrorDev([
      'A component is changing an uncontrolled input to be controlled. ' +
        'This is likely caused by the value changing from undefined to ' +
        'a defined value, which should not happen. ' +
        'Decide between using a controlled or uncontrolled input ' +
        'element for the lifetime of the component. More info: https://react.dev/link/controlled-components\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should warn if controlled checkbox switches to uncontrolled (checked is undefined)」描述的渲染、交互或错误处理结果。 */
  it('should warn if controlled checkbox switches to uncontrolled (checked is undefined)', async () => {
    const stub = (
      <input type="checkbox" checked={true} onChange={emptyFunction} />
    );
    await act(() => {
      root.render(stub);
    });
    await act(() => {
      root.render(<input type="checkbox" />);
    });
    assertConsoleErrorDev([
      'A component is changing a controlled input to be uncontrolled. ' +
        'This is likely caused by the value changing from a defined to ' +
        'undefined, which should not happen. ' +
        'Decide between using a controlled or uncontrolled input ' +
        'element for the lifetime of the component. More info: https://react.dev/link/controlled-components\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should warn if controlled checkbox switches to uncontrolled (checked is null)」描述的渲染、交互或错误处理结果。 */
  it('should warn if controlled checkbox switches to uncontrolled (checked is null)', async () => {
    const stub = (
      <input type="checkbox" checked={true} onChange={emptyFunction} />
    );
    await act(() => {
      root.render(stub);
    });
    await act(() => {
      root.render(<input type="checkbox" checked={null} />);
    });
    assertConsoleErrorDev([
      'A component is changing a controlled input to be uncontrolled. ' +
        'This is likely caused by the value changing from a defined to ' +
        'undefined, which should not happen. ' +
        'Decide between using a controlled or uncontrolled input ' +
        'element for the lifetime of the component. More info: https://react.dev/link/controlled-components\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should warn if controlled checkbox switches to uncontrolled with defaultChecked」描述的渲染、交互或错误处理结果。 */
  it('should warn if controlled checkbox switches to uncontrolled with defaultChecked', async () => {
    const stub = (
      <input type="checkbox" checked={true} onChange={emptyFunction} />
    );
    await act(() => {
      root.render(stub);
    });
    await act(() => {
      root.render(<input type="checkbox" defaultChecked={true} />);
    });
    assertConsoleErrorDev([
      'A component is changing a controlled input to be uncontrolled. ' +
        'This is likely caused by the value changing from a defined to ' +
        'undefined, which should not happen. ' +
        'Decide between using a controlled or uncontrolled input ' +
        'element for the lifetime of the component. More info: https://react.dev/link/controlled-components\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should warn if uncontrolled checkbox (checked is undefined) switches to controlled」描述的渲染、交互或错误处理结果。 */
  it('should warn if uncontrolled checkbox (checked is undefined) switches to controlled', async () => {
    const stub = <input type="checkbox" />;
    await act(() => {
      root.render(stub);
    });
    await act(() => {
      root.render(<input type="checkbox" checked={true} />);
    });
    assertConsoleErrorDev([
      'A component is changing an uncontrolled input to be controlled. ' +
        'This is likely caused by the value changing from undefined to ' +
        'a defined value, which should not happen. ' +
        'Decide between using a controlled or uncontrolled input ' +
        'element for the lifetime of the component. More info: https://react.dev/link/controlled-components\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should warn if uncontrolled checkbox (checked is null) switches to controlled」描述的渲染、交互或错误处理结果。 */
  it('should warn if uncontrolled checkbox (checked is null) switches to controlled', async () => {
    const stub = <input type="checkbox" checked={null} />;
    await act(() => {
      root.render(stub);
    });
    await act(() => {
      root.render(<input type="checkbox" checked={true} />);
    });
    assertConsoleErrorDev([
      'A component is changing an uncontrolled input to be controlled. ' +
        'This is likely caused by the value changing from undefined to ' +
        'a defined value, which should not happen. ' +
        'Decide between using a controlled or uncontrolled input ' +
        'element for the lifetime of the component. More info: https://react.dev/link/controlled-components\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should warn if controlled radio switches to uncontrolled (checked is undefined)」描述的渲染、交互或错误处理结果。 */
  it('should warn if controlled radio switches to uncontrolled (checked is undefined)', async () => {
    const stub = <input type="radio" checked={true} onChange={emptyFunction} />;
    await act(() => {
      root.render(stub);
    });
    await act(() => {
      root.render(<input type="radio" />);
    });
    assertConsoleErrorDev([
      'A component is changing a controlled input to be uncontrolled. ' +
        'This is likely caused by the value changing from a defined to ' +
        'undefined, which should not happen. ' +
        'Decide between using a controlled or uncontrolled input ' +
        'element for the lifetime of the component. More info: https://react.dev/link/controlled-components\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should warn if controlled radio switches to uncontrolled (checked is null)」描述的渲染、交互或错误处理结果。 */
  it('should warn if controlled radio switches to uncontrolled (checked is null)', async () => {
    const stub = <input type="radio" checked={true} onChange={emptyFunction} />;
    await act(() => {
      root.render(stub);
    });
    await act(() => {
      root.render(<input type="radio" checked={null} />);
    });
    assertConsoleErrorDev([
      'A component is changing a controlled input to be uncontrolled. ' +
        'This is likely caused by the value changing from a defined to ' +
        'undefined, which should not happen. ' +
        'Decide between using a controlled or uncontrolled input ' +
        'element for the lifetime of the component. More info: https://react.dev/link/controlled-components\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should warn if controlled radio switches to uncontrolled with defaultChecked」描述的渲染、交互或错误处理结果。 */
  it('should warn if controlled radio switches to uncontrolled with defaultChecked', async () => {
    const stub = <input type="radio" checked={true} onChange={emptyFunction} />;
    await act(() => {
      root.render(stub);
    });
    await act(() => {
      root.render(<input type="radio" defaultChecked={true} />);
    });
    assertConsoleErrorDev([
      'A component is changing a controlled input to be uncontrolled. ' +
        'This is likely caused by the value changing from a defined to ' +
        'undefined, which should not happen. ' +
        'Decide between using a controlled or uncontrolled input ' +
        'element for the lifetime of the component. More info: https://react.dev/link/controlled-components\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should warn if uncontrolled radio (checked is undefined) switches to controlled」描述的渲染、交互或错误处理结果。 */
  it('should warn if uncontrolled radio (checked is undefined) switches to controlled', async () => {
    const stub = <input type="radio" />;
    await act(() => {
      root.render(stub);
    });
    await act(() => {
      root.render(<input type="radio" checked={true} />);
    });
    assertConsoleErrorDev([
      'A component is changing an uncontrolled input to be controlled. ' +
        'This is likely caused by the value changing from undefined to ' +
        'a defined value, which should not happen. ' +
        'Decide between using a controlled or uncontrolled input ' +
        'element for the lifetime of the component. More info: https://react.dev/link/controlled-components\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should warn if uncontrolled radio (checked is null) switches to controlled」描述的渲染、交互或错误处理结果。 */
  it('should warn if uncontrolled radio (checked is null) switches to controlled', async () => {
    const stub = <input type="radio" checked={null} />;
    await act(() => {
      root.render(stub);
    });
    await act(() => {
      root.render(<input type="radio" checked={true} />);
    });
    assertConsoleErrorDev([
      'A component is changing an uncontrolled input to be controlled. ' +
        'This is likely caused by the value changing from undefined to ' +
        'a defined value, which should not happen. ' +
        'Decide between using a controlled or uncontrolled input ' +
        'element for the lifetime of the component. More info: https://react.dev/link/controlled-components\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「should not warn if radio value changes but never becomes controlled」描述的渲染、交互或错误处理结果。 */
  it('should not warn if radio value changes but never becomes controlled', async () => {
    await act(() => {
      root.render(<input type="radio" value="value" />);
    });
    await act(() => {
      root.render(<input type="radio" />);
    });
    await act(() => {
      root.render(<input type="radio" value="value" defaultChecked={true} />);
    });
    await act(() => {
      root.render(<input type="radio" value="value" onChange={() => null} />);
    });
    await act(() => {
      root.render(<input type="radio" />);
    });
  });

  /** 测试场景：验证「should not warn if radio value changes but never becomes uncontrolled」描述的渲染、交互或错误处理结果。 */
  it('should not warn if radio value changes but never becomes uncontrolled', async () => {
    await act(() => {
      root.render(<input type="radio" checked={false} onChange={() => null} />);
    });
    const input = container.querySelector('input');
    expect(isCheckedDirty(input)).toBe(true);
    await act(() => {
      root.render(
        <input
          type="radio"
          value="value"
          defaultChecked={true}
          checked={false}
          onChange={() => null}
        />,
      );
    });
    expect(isCheckedDirty(input)).toBe(true);
    assertInputTrackingIsCurrent(container);
  });

  /** 测试场景：验证「should warn if radio checked false changes to become uncontrolled」描述的渲染、交互或错误处理结果。 */
  it('should warn if radio checked false changes to become uncontrolled', async () => {
    await act(() => {
      root.render(
        <input
          type="radio"
          value="value"
          checked={false}
          onChange={() => null}
        />,
      );
    });
    await act(() => {
      root.render(<input type="radio" value="value" />);
    });
    assertConsoleErrorDev([
      'A component is changing a controlled input to be uncontrolled. ' +
        'This is likely caused by the value changing from a defined to ' +
        'undefined, which should not happen. ' +
        'Decide between using a controlled or uncontrolled input ' +
        'element for the lifetime of the component. More info: https://react.dev/link/controlled-components\n' +
        '    in input (at **)',
    ]);
  });

  /** 测试场景：验证「sets type, step, min, max before value always」描述的渲染、交互或错误处理结果。 */
  it('sets type, step, min, max before value always', async () => {
    const log = [];
    const originalCreateElement = document.createElement;
    spyOnDevAndProd(document, 'createElement').mockImplementation(
      function (type) {
        const el = originalCreateElement.apply(this, arguments);
        let value = '';
        let typeProp = '';

        if (type === 'input') {
          Object.defineProperty(el, 'type', {
            /** `get`：封装当前用例复用的操作、回调或断言步骤。 */
            get: function () {
              return typeProp;
            },
            /** `set`：封装当前用例复用的操作、回调或断言步骤。 */
            set: function (val) {
              typeProp = String(val);
              log.push('set property type');
            },
          });
          Object.defineProperty(el, 'value', {
            /** `get`：封装当前用例复用的操作、回调或断言步骤。 */
            get: function () {
              return value;
            },
            /** `set`：封装当前用例复用的操作、回调或断言步骤。 */
            set: function (val) {
              value = String(val);
              log.push('set property value');
            },
          });
          spyOnDevAndProd(el, 'setAttribute').mockImplementation(
            function (name) {
              log.push('set attribute ' + name);
            },
          );
        }
        return el;
      },
    );

    await act(() => {
      root.render(
        <input
          value="0"
          onChange={() => {}}
          type="range"
          min="0"
          max="100"
          step="1"
        />,
      );
    });

    expect(log).toEqual([
      'set attribute min',
      'set attribute max',
      'set attribute step',
      'set property type',
      'set property value',
    ]);
  });

  /** 测试场景：验证「sets value properly with type coming later in props」描述的渲染、交互或错误处理结果。 */
  it('sets value properly with type coming later in props', async () => {
    await act(() => {
      root.render(<input value="hi" type="radio" />);
    });
    expect(container.firstChild.value).toBe('hi');
  });

  /** 测试场景：验证「does not raise a validation warning when it switches types」描述的渲染、交互或错误处理结果。 */
  it('does not raise a validation warning when it switches types', async () => {
    /** `Input`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Input extends React.Component {
      /** `Input.state`：记录测试夹具在当前场景中的状态。 */
      state = {type: 'number', value: 1000};

      /** `Input.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        const {value, type} = this.state;
        return <input onChange={() => {}} type={type} value={value} />;
      }
    }

    const ref = React.createRef();
    await act(() => {
      root.render(<Input ref={ref} />);
    });
    const node = container.firstChild;

    // 如果先设置 value 再设置 type，会触发验证警告，且 value 无法赋值。
    await act(() => {
      ref.current.setState({type: 'text', value: 'Test'});
    });
    expect(node.value).toEqual('Test');
  });

  /** 测试场景：验证「resets value of date/time input to fix bugs in iOS Safari」描述的渲染、交互或错误处理结果。 */
  it('resets value of date/time input to fix bugs in iOS Safari', async () => {
    /** `strify`：封装当前用例复用的操作、回调或断言步骤。 */
    function strify(x) {
      return JSON.stringify(x, null, 2);
    }

    const log = [];
    const originalCreateElement = document.createElement;
    spyOnDevAndProd(document, 'createElement').mockImplementation(
      function (type) {
        const el = originalCreateElement.apply(this, arguments);
        const getDefaultValue = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'defaultValue',
        ).get;
        const setDefaultValue = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'defaultValue',
        ).set;
        const getValue = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        ).get;
        const setValue = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        ).set;
        const getType = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'type',
        ).get;
        const setType = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'type',
        ).set;
        if (type === 'input') {
          Object.defineProperty(el, 'defaultValue', {
            /** `get`：封装当前用例复用的操作、回调或断言步骤。 */
            get: function () {
              return getDefaultValue.call(this);
            },
            /** `set`：封装当前用例复用的操作、回调或断言步骤。 */
            set: function (val) {
              log.push(`node.defaultValue = ${strify(val)}`);
              setDefaultValue.call(this, val);
            },
          });
          Object.defineProperty(el, 'value', {
            /** `get`：封装当前用例复用的操作、回调或断言步骤。 */
            get: function () {
              return getValue.call(this);
            },
            /** `set`：封装当前用例复用的操作、回调或断言步骤。 */
            set: function (val) {
              log.push(`node.value = ${strify(val)}`);
              setValue.call(this, val);
            },
          });
          Object.defineProperty(el, 'type', {
            /** `get`：封装当前用例复用的操作、回调或断言步骤。 */
            get: function () {
              return getType.call(this);
            },
            /** `set`：封装当前用例复用的操作、回调或断言步骤。 */
            set: function (val) {
              log.push(`node.type = ${strify(val)}`);
              setType.call(this, val);
            },
          });
          spyOnDevAndProd(el, 'setAttribute').mockImplementation(
            function (name, val) {
              log.push(`node.setAttribute(${strify(name)}, ${strify(val)})`);
            },
          );
        }
        return el;
      },
    );

    await act(() => {
      root.render(<input type="date" defaultValue="1980-01-01" />);
    });

    if (disableInputAttributeSyncing) {
      expect(log).toEqual([
        'node.type = "date"',
        'node.defaultValue = "1980-01-01"',
        // TODO：这可能重新引入了 bug，因为我们根本没有为 `value` 赋值。 需要在移动 Safari 和 Chrome 上
        // 进行检查。
      ]);
    } else {
      expect(log).toEqual([
        'node.type = "date"',
        // 值必须在默认值之前赋值。 这解决了移动Safari和Chrome中视觉显示的日期输入值消失的问题:
        // https://github.com/facebook/react/issues/7233
        'node.value = "1980-01-01"',
        'node.defaultValue = "1980-01-01"',
      ]);
    }
  });

  describe('assigning the value attribute on controlled inputs', function () {
    /** `getTestInput`：封装当前用例复用的操作、回调或断言步骤。 */
    function getTestInput() {
      return class extends React.Component {
        /** `getTestInput.state`：记录测试夹具在当前场景中的状态。 */
        state = {
          value: this.props.value == null ? '' : this.props.value,
        };
        /** `getTestInput.onChange`：封装当前用例复用的操作、回调或断言步骤。 */
        onChange = event => {
          this.setState({value: event.target.value});
        };
        /** `getTestInput.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          const type = this.props.type;
          const value = this.state.value;

          return <input type={type} value={value} onChange={this.onChange} />;
        }
      };
    }

    /** 测试场景：验证「always sets the attribute when values change on text inputs」描述的渲染、交互或错误处理结果。 */
    it('always sets the attribute when values change on text inputs', async () => {
      const Input = getTestInput();
      await act(() => {
        root.render(<Input type="text" />);
      });
      const node = container.firstChild;
      expect(isValueDirty(node)).toBe(false);

      setUntrackedValue.call(node, '2');
      await act(() => {
        dispatchEventOnNode(node, 'input');
      });

      expect(isValueDirty(node)).toBe(true);
      if (disableInputAttributeSyncing) {
        expect(node.hasAttribute('value')).toBe(false);
      } else {
        expect(node.getAttribute('value')).toBe('2');
      }
    });

    /** 测试场景：验证「sets the value attribute on number inputs even when focused」描述的渲染、交互或错误处理结果。 */
    it('sets the value attribute on number inputs even when focused', async () => {
      const Input = getTestInput();
      await act(() => {
        root.render(<Input type="number" value="1" />);
      });
      const node = container.firstChild;
      expect(isValueDirty(node)).toBe(true);

      node.focus();

      setUntrackedValue.call(node, '2');
      dispatchEventOnNode(node, 'input');

      expect(isValueDirty(node)).toBe(true);
      if (disableInputAttributeSyncing) {
        expect(node.hasAttribute('value')).toBe(false);
      } else {
        expect(node.getAttribute('value')).toBe('2');
      }
    });

    /** 测试场景：验证「sets the value attribute on number inputs on blur」描述的渲染、交互或错误处理结果。 */
    it('sets the value attribute on number inputs on blur', async () => {
      const Input = getTestInput();
      await act(() => {
        root.render(<Input type="number" value="1" />);
      });
      const node = container.firstChild;
      expect(isValueDirty(node)).toBe(true);

      node.focus();
      setUntrackedValue.call(node, '2');
      dispatchEventOnNode(node, 'input');
      node.blur();

      expect(isValueDirty(node)).toBe(true);
      if (disableInputAttributeSyncing) {
        expect(node.value).toBe('2');
        expect(node.hasAttribute('value')).toBe(false);
      } else {
        expect(node.value).toBe('2');
        expect(node.getAttribute('value')).toBe('2');
      }
    });

    /** 测试场景：验证「an uncontrolled number input will not update the value attribute on blur」描述的渲染、交互或错误处理结果。 */
    it('an uncontrolled number input will not update the value attribute on blur', async () => {
      await act(() => {
        root.render(<input type="number" defaultValue="1" />);
      });
      const node = container.firstChild;
      if (disableInputAttributeSyncing) {
        expect(isValueDirty(node)).toBe(false);
      } else {
        expect(isValueDirty(node)).toBe(true);
      }

      node.focus();
      setUntrackedValue.call(node, 4);
      dispatchEventOnNode(node, 'input');
      node.blur();

      expect(isValueDirty(node)).toBe(true);
      expect(node.getAttribute('value')).toBe('1');
    });

    /** 测试场景：验证「an uncontrolled text input will not update the value attribute on blur」描述的渲染、交互或错误处理结果。 */
    it('an uncontrolled text input will not update the value attribute on blur', async () => {
      await act(() => {
        root.render(<input type="text" defaultValue="1" />);
      });
      const node = container.firstChild;
      if (disableInputAttributeSyncing) {
        expect(isValueDirty(node)).toBe(false);
      } else {
        expect(isValueDirty(node)).toBe(true);
      }

      node.focus();
      setUntrackedValue.call(node, 4);
      dispatchEventOnNode(node, 'input');
      node.blur();

      expect(isValueDirty(node)).toBe(true);
      expect(node.getAttribute('value')).toBe('1');
    });
  });

  describe('setting a controlled input to undefined', () => {
    let input;

    /** `renderInputWithStringThenWithUndefined`：封装当前用例复用的操作、回调或断言步骤。 */
    async function renderInputWithStringThenWithUndefined() {
      let setValueToUndefined;
      /** `renderInputWithStringThenWithUndefined.Input`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Input extends React.Component {
        /** `Input.constructor`：初始化测试夹具实例及其状态。 */
        constructor() {
          super();
          setValueToUndefined = () => this.setState({value: undefined});
        }
        /** `Input.state`：记录测试夹具在当前场景中的状态。 */
        state = {value: 'first'};
        /** `Input.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return (
            <input
              onChange={e => this.setState({value: e.target.value})}
              value={this.state.value}
            />
          );
        }
      }

      await act(() => {
        root.render(<Input />);
      });
      input = container.firstChild;
      setUntrackedValue.call(input, 'latest');
      dispatchEventOnNode(input, 'input');
      await act(() => {
        setValueToUndefined();
      });
    }

    /** 测试场景：验证「reverts the value attribute to the initial value」描述的渲染、交互或错误处理结果。 */
    it('reverts the value attribute to the initial value', async () => {
      await renderInputWithStringThenWithUndefined();
      assertConsoleErrorDev([
        'A component is changing a controlled input to be uncontrolled. ' +
          'This is likely caused by the value changing from a defined to undefined, which should not happen. ' +
          'Decide between using a controlled or uncontrolled input element for the lifetime of the component. ' +
          'More info: https://react.dev/link/controlled-components\n' +
          '    in input (at **)\n' +
          '    in Input (at **)',
      ]);
      if (disableInputAttributeSyncing) {
        expect(input.getAttribute('value')).toBe(null);
      } else {
        expect(input.getAttribute('value')).toBe('latest');
      }
    });

    /** 测试场景：验证「preserves the value property」描述的渲染、交互或错误处理结果。 */
    it('preserves the value property', async () => {
      await renderInputWithStringThenWithUndefined();
      assertConsoleErrorDev([
        'A component is changing a controlled input to be uncontrolled. ' +
          'This is likely caused by the value changing from a defined to undefined, which should not happen. ' +
          'Decide between using a controlled or uncontrolled input element for the lifetime of the component. ' +
          'More info: https://react.dev/link/controlled-components\n' +
          '    in input (at **)\n' +
          '    in Input (at **)',
      ]);
      expect(input.value).toBe('latest');
    });
  });

  describe('setting a controlled input to null', () => {
    let input;

    /** `renderInputWithStringThenWithNull`：封装当前用例复用的操作、回调或断言步骤。 */
    async function renderInputWithStringThenWithNull() {
      let setValueToNull;
      /** `renderInputWithStringThenWithNull.Input`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Input extends React.Component {
        /** `Input.constructor`：初始化测试夹具实例及其状态。 */
        constructor() {
          super();
          setValueToNull = () => this.setState({value: null});
        }
        /** `Input.state`：记录测试夹具在当前场景中的状态。 */
        state = {value: 'first'};
        /** `Input.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return (
            <input
              onChange={e => this.setState({value: e.target.value})}
              value={this.state.value}
            />
          );
        }
      }

      await act(() => {
        root.render(<Input />);
      });
      input = container.firstChild;
      setUntrackedValue.call(input, 'latest');
      dispatchEventOnNode(input, 'input');
      await act(() => {
        setValueToNull();
      });
    }

    /** 测试场景：验证「reverts the value attribute to the initial value」描述的渲染、交互或错误处理结果。 */
    it('reverts the value attribute to the initial value', async () => {
      await renderInputWithStringThenWithNull();
      assertConsoleErrorDev([
        '`value` prop on `input` should not be null. ' +
          'Consider using an empty string to clear the component ' +
          'or `undefined` for uncontrolled components.\n' +
          '    in input (at **)\n' +
          '    in Input (at **)',
        'A component is changing a controlled input to be uncontrolled. ' +
          'This is likely caused by the value changing from a defined to undefined, which should not happen. ' +
          'Decide between using a controlled or uncontrolled input element for the lifetime of the component. ' +
          'More info: https://react.dev/link/controlled-components\n' +
          '    in input (at **)\n' +
          '    in Input (at **)',
      ]);
      if (disableInputAttributeSyncing) {
        expect(input.getAttribute('value')).toBe(null);
      } else {
        expect(input.getAttribute('value')).toBe('latest');
      }
    });

    /** 测试场景：验证「preserves the value property」描述的渲染、交互或错误处理结果。 */
    it('preserves the value property', async () => {
      await renderInputWithStringThenWithNull();
      assertConsoleErrorDev([
        '`value` prop on `input` should not be null. ' +
          'Consider using an empty string to clear the component ' +
          'or `undefined` for uncontrolled components.\n' +
          '    in input (at **)\n' +
          '    in Input (at **)',
        'A component is changing a controlled input to be uncontrolled. ' +
          'This is likely caused by the value changing from a defined to undefined, which should not happen. ' +
          'Decide between using a controlled or uncontrolled input element for the lifetime of the component. ' +
          'More info: https://react.dev/link/controlled-components\n' +
          '    in input (at **)\n' +
          '    in Input (at **)',
      ]);
      expect(input.value).toBe('latest');
    });
  });

  describe('When given a Symbol value', function () {
    /** 测试场景：验证「treats initial Symbol value as an empty string」描述的渲染、交互或错误处理结果。 */
    it('treats initial Symbol value as an empty string', async () => {
      await act(() => {
        root.render(<input value={Symbol('foobar')} onChange={() => {}} />);
      });
      assertConsoleErrorDev([
        'Invalid value for prop `value` on <input> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in input (at **)',
      ]);
      const node = container.firstChild;

      expect(node.value).toBe('');
      if (disableInputAttributeSyncing) {
        expect(node.hasAttribute('value')).toBe(false);
      } else {
        expect(node.getAttribute('value')).toBe('');
      }
    });

    /** 测试场景：验证「treats updated Symbol value as an empty string」描述的渲染、交互或错误处理结果。 */
    it('treats updated Symbol value as an empty string', async () => {
      await act(() => {
        root.render(<input value="foo" onChange={() => {}} />);
      });
      await act(() => {
        root.render(<input value={Symbol('foobar')} onChange={() => {}} />);
      });
      assertConsoleErrorDev([
        'Invalid value for prop `value` on <input> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in input (at **)',
      ]);
      const node = container.firstChild;

      expect(node.value).toBe('');
      if (disableInputAttributeSyncing) {
        expect(node.hasAttribute('value')).toBe(false);
      } else {
        expect(node.getAttribute('value')).toBe('');
      }
    });

    /** 测试场景：验证「treats initial Symbol defaultValue as an empty string」描述的渲染、交互或错误处理结果。 */
    it('treats initial Symbol defaultValue as an empty string', async () => {
      await act(() => {
        root.render(<input defaultValue={Symbol('foobar')} />);
      });
      const node = container.firstChild;

      expect(node.value).toBe('');
      expect(node.getAttribute('value')).toBe('');
      // TODO：这里应当发出警告。
    });

    /** 测试场景：验证「treats updated Symbol defaultValue as an empty string」描述的渲染、交互或错误处理结果。 */
    it('treats updated Symbol defaultValue as an empty string', async () => {
      await act(() => {
        root.render(<input defaultValue="foo" />);
      });
      await act(() => {
        root.render(<input defaultValue={Symbol('foobar')} />);
      });
      const node = container.firstChild;

      if (disableInputAttributeSyncing) {
        expect(node.value).toBe('');
      } else {
        expect(node.value).toBe('foo');
      }
      expect(node.getAttribute('value')).toBe('');
      // TODO：这里应当发出警告。
    });
  });

  describe('When given a function value', function () {
    /** 测试场景：验证「treats initial function value as an empty string」描述的渲染、交互或错误处理结果。 */
    it('treats initial function value as an empty string', async () => {
      await act(() => {
        root.render(<input value={() => {}} onChange={() => {}} />);
      });
      assertConsoleErrorDev([
        'Invalid value for prop `value` on <input> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in input (at **)',
      ]);
      const node = container.firstChild;

      expect(node.value).toBe('');
      if (disableInputAttributeSyncing) {
        expect(node.hasAttribute('value')).toBe(false);
      } else {
        expect(node.getAttribute('value')).toBe('');
      }
    });

    /** 测试场景：验证「treats updated function value as an empty string」描述的渲染、交互或错误处理结果。 */
    it('treats updated function value as an empty string', async () => {
      await act(() => {
        root.render(<input value="foo" onChange={() => {}} />);
      });
      await act(() => {
        root.render(<input value={() => {}} onChange={() => {}} />);
      });
      assertConsoleErrorDev([
        'Invalid value for prop `value` on <input> tag. ' +
          'Either remove it from the element, or pass a string or number value to keep it in the DOM. ' +
          'For details, see https://react.dev/link/attribute-behavior \n' +
          '    in input (at **)',
      ]);
      const node = container.firstChild;

      expect(node.value).toBe('');
      if (disableInputAttributeSyncing) {
        expect(node.hasAttribute('value')).toBe(false);
      } else {
        expect(node.getAttribute('value')).toBe('');
      }
    });

    /** 测试场景：验证「treats initial function defaultValue as an empty string」描述的渲染、交互或错误处理结果。 */
    it('treats initial function defaultValue as an empty string', async () => {
      await act(() => {
        root.render(<input defaultValue={() => {}} />);
      });
      const node = container.firstChild;

      expect(node.value).toBe('');
      expect(node.getAttribute('value')).toBe('');
      // TODO：这里应当发出警告。
    });

    /** 测试场景：验证「treats updated function defaultValue as an empty string」描述的渲染、交互或错误处理结果。 */
    it('treats updated function defaultValue as an empty string', async () => {
      await act(() => {
        root.render(<input defaultValue="foo" />);
      });
      await act(() => {
        root.render(<input defaultValue={() => {}} />);
      });
      const node = container.firstChild;

      if (disableInputAttributeSyncing) {
        expect(node.value).toBe('');
        expect(node.getAttribute('value')).toBe('');
      } else {
        expect(node.value).toBe('foo');
        expect(node.getAttribute('value')).toBe('');
      }
      // TODO：这里应当发出警告。
    });
  });

  describe('checked inputs without a value property', function () {
    // 未提供 value 时，radio 与 checkbox 都会报告值 `"on"`。在 React 16 到 16.2 之间，
    // 我们曾把节点当前的 value 赋回给它，以便与 defaultValue “脱离”。这会产生一个副作用：
    // 向 radio 与 checkbox 赋上 value="on"。
    /** 测试场景：验证「does not add "on" in absence of value on a checkbox」描述的渲染、交互或错误处理结果。 */
    it('does not add "on" in absence of value on a checkbox', async () => {
      await act(() => {
        root.render(<input type="checkbox" defaultChecked={true} />);
      });
      const node = container.firstChild;

      expect(node.value).toBe('on');
      expect(node.hasAttribute('value')).toBe(false);
    });

    /** 测试场景：验证「does not add "on" in absence of value on a radio」描述的渲染、交互或错误处理结果。 */
    it('does not add "on" in absence of value on a radio', async () => {
      await act(() => {
        root.render(<input type="radio" defaultChecked={true} />);
      });
      const node = container.firstChild;

      expect(node.value).toBe('on');
      expect(node.hasAttribute('value')).toBe(false);
    });
  });

  /** 测试场景：验证「should remove previous `defaultValue`」描述的渲染、交互或错误处理结果。 */
  it('should remove previous `defaultValue`', async () => {
    await act(() => {
      root.render(<input type="text" defaultValue="0" />);
    });
    const node = container.firstChild;

    expect(node.value).toBe('0');
    expect(node.defaultValue).toBe('0');

    await act(() => {
      root.render(<input type="text" />);
    });
    expect(node.defaultValue).toBe('');
  });

  /** 测试场景：验证「should treat `defaultValue={null}` as missing」描述的渲染、交互或错误处理结果。 */
  it('should treat `defaultValue={null}` as missing', async () => {
    await act(() => {
      root.render(<input type="text" defaultValue="0" />);
    });
    const node = container.firstChild;

    expect(node.value).toBe('0');
    expect(node.defaultValue).toBe('0');

    await act(() => {
      root.render(<input type="text" defaultValue={null} />);
    });
    expect(node.defaultValue).toBe('');
  });

  /** 测试场景：验证「should notice input changes when reverting back to original value」描述的渲染、交互或错误处理结果。 */
  it('should notice input changes when reverting back to original value', async () => {
    const log = [];
    /** `onChange`：封装当前用例复用的操作、回调或断言步骤。 */
    function onChange(e) {
      log.push(e.target.value);
    }
    await act(() => {
      root.render(<input type="text" value="" onChange={onChange} />);
    });
    await act(() => {
      root.render(<input type="text" value="a" onChange={onChange} />);
    });

    const node = container.firstChild;
    setUntrackedValue.call(node, '');
    dispatchEventOnNode(node, 'input');

    expect(log).toEqual(['']);
    expect(node.value).toBe('a');
  });
});
