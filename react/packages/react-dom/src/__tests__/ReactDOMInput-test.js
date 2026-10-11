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
/** 读取 test-fire 预设的属性同步开关；断言分别覆盖禁用同步时缺省 value attribute 与启用时同步 defaultValue 的行为。 */
const {disableInputAttributeSyncing} = require('shared/ReactFeatureFlags');

/** 受控字段的空 onChange；不采纳事件值、返回 undefined，让用例专门观察 React 在事件结束后的受控恢复。 */
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

  /** 在 node 派发指定 type 的可冒泡、可取消原生 Event；不返回派发结果，使测试进入真实事件插件与事件后恢复路径。 */
  function dispatchEventOnNode(node, type) {
    node.dispatchEvent(new Event(type, {bubbles: true, cancelable: true}));
  }

  /** 检测 node 的 HTML dirty value 标志：克隆后转 text 绕开类型清理，改副本 defaultValue；返回当前值仍与原节点一致与否。仅改副本，避免检测本身污染被测节点。 */
  function isValueDirty(node) {
    // 返回 HTML 规范定义的“脏值标志”。把副本转成 text input，以绕过复杂的 value 清理行为。
    const copy = node.cloneNode();
    copy.type = 'text';
    // 如果此时修改 attribute 不会改变 value，就说明 value 已与该 attribute 脱离。
    copy.defaultValue += Math.random();
    return copy.value === node.value;
  }

  /** 检测 checked 是否脱离 defaultChecked；两者不同时直接返回 true，否则克隆为 checkbox 并翻转默认值，返回副本现值是否保持原选中状态，不改原节点。 */
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

  /** 返回 elem 的 tracker 字符串及当前 DOM 值组成的二元组；radio/checkbox 读取 checked 的字符串，其余读取 value。无 tracker 时抛错，避免把缺失跟踪误当作一致。 */
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

  /** 遍历 parent 下 input/textarea/select 并比较 tracker 与 DOM；不返回数据，任一不同即抛带 outerHTML 和两值的错误，用来定位恢复或同组联动后过期的跟踪记录。 */
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

  /** 每例重置模块和诊断去重状态，读取原型 value/checked setter 以模拟绕过 tracker 的浏览器输入；加载 React/act/Scheduler，新建并挂入 body 的 container 与 root。 */
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

  /** 每例从 body 移除当前 container 并恢复所有 mock；此处不调用 root.unmount，用例自身有卸载时按其实际流程观察。 */
  afterEach(() => {
    document.body.removeChild(container);
    jest.restoreAllMocks();
  });

  /** 空 root 挂载 value 为数字 0 且无 onChange 的 text input；断言开发模式提示受控字段只读，验证 0 仍算已提供 value。 */
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

  /** 空 root 挂载 value 为空串且无 onChange 的 text input；断言只读字段警告，验证空串仍属于受控输入。 */
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

  /** 挂载 value 为字符串 "0" 且无 onChange 的 text input；断言缺少处理器的只读警告，覆盖字符串零。 */
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

  /** 挂载 checked=false 且无 onChange 的 checkbox；断言 checked 对应的只读警告，验证 false 仍属于受控 checked。 */
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

  /** 先挂载 checked=false、readOnly=true 的 checkbox，卸载后新 root 改为 readOnly=false；仅后一次断言缺少 onChange 警告，验证 readOnly 必须为真才能豁免。 */
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

  /** 分别在新 root 挂载普通、text、checkbox，value/checked 缺省或 undefined；各次 act 正常完成且无预期警告，验证非受控字段无需 onChange。 */
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

  /** 挂载 value="..." 并提供空 onInput；act 无预期警告，覆盖 onInput 也能满足受控值的处理器检查。 */
  it('should not warn with value and onInput handler', async () => {
    await act(() => {
      root.render(<input value="..." onInput={() => {}} />);
    });
  });

  /** 挂载无处理器的受控 lion 并确认警告及 dirty 标志；原型 setter 改为 giraffe 后派发原生 input，断言 value 恢复 lion 且仍 dirty，覆盖无用户监听器时的事件后恢复。 */
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

    // 派发原生事件才能覆盖顶层事件分发和事件结束时的受控恢复队列；直接调用 onChange 不经过这条路径。
    await act(() => {
      dispatchEventOnNode(node, 'input');
    });

    expect(node.value).toBe('lion');
    expect(isValueDirty(node)).toBe(true);
  });

  /** 初始受控文本 lion 已聚焦；原型 setter 改 giraffe 后 input 处理器重入 input 并把焦点移向另一字段，再派发 blur/focusout。断言最终 giraffe 且 switchedFocus=true，验证外层事件结束前 blur 仍能读到用户值。 */
  it('should control a value in reentrant events', async () => {

    /** 重入事件 fixture：初值 lion，文本 change 内重派 input 并 focus 第二字段；blur 采纳尚未恢复的用户值，外部 ref 用于检查焦点切换与最终 value。 */
    class ControlledInputs extends React.Component {

      /** 受控文本的当前值，初始 lion；change/blur 都会写入，使测试观察重入事件中最后一次采纳的值。 */
      state = {value: 'lion'};

      /** 第一个受控 text 的 ref 槽，初始 null、提交时填 DOM；用于原生输入、重派 input 及最后断言。 */
      a = null;

      /** 第二个普通 text 的 ref 槽，初始 null；change 内 focus 它以触发第一项失焦，制造嵌套事件。 */
      b = null;

      /** 记录 blur 是否执行，初始 false；与最终 value 一起证明焦点重入路径确实发生。 */
      switchedFocus = false;

      /** 接收 onChange 的 newValue，先排队 state 更新，再在同一目标重派 input 并 focus 第二字段；无返回值，制造尚未完成外层恢复的嵌套事件。 */
      change(newValue) {
        this.setState({value: newValue});
        // 这里调用 focus 会使文本框 blur，并触发原生 change 事件。理想情况下无需手动触发；
        // 除非已确认 #8240 的修复仍被此测试覆盖，否则不要删除这段逻辑。
        dispatchEventOnNode(this.a, 'input');
        this.b.focus();
      }

      /** 接收失焦时 DOM 的 currentValue，标记 switchedFocus 并写入 state；无返回值，保存事件结束前仍可见的 giraffe。 */
      blur(currentValue) {
        this.switchedFocus = true;
        // `currentValue` 应该在这里是 `'giraffe'`，因为我们还没有在目标上恢复它。
        this.setState({value: currentValue});
      }

      /** 返回受控 text 与焦点目标 text；第一项绑定 change/blur 和 ref，第二项仅提供 ref，构成焦点切换的最小树。 */
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
    // 派发原生事件才能覆盖顶层事件分发和事件结束时的受控恢复队列；直接调用 onChange 不经过这条路径。
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

  /** 初始文本固定 lion、checkbox 固定 checked=true；文本改 giraffe 的 input 处理器重入 checkbox.click()。act 后断言文本恢复 lion、checkbox 恢复 true，覆盖不同目标共同进入恢复队列。 */
  it('should control values in reentrant events with different targets', async () => {

    /** 跨目标重入 fixture：文本固定 lion、checkbox 固定 true；文本 change 内点击 checkbox，使一次外层事件同时排队两个目标的受控恢复。 */
    class ControlledInputs extends React.Component {

      /** 初始 lion 的 state；本 fixture 的 render 使用字面量 lion、change 不读写此字段，实际断言由固定 props 决定。 */
      state = {value: 'lion'};

      /** 受控文本 DOM 槽，提交时由 ref 写入；供测试绕开 tracker 修改并检查恢复结果。 */
      a = null;

      /** 受控 checkbox DOM 槽；供 change 调用 click，制造另一个目标上的嵌套 change。 */
      b = null;

      /** 签名接收 newValue，但本例不采纳该值；仅点击 checkbox、无返回值，以触发第二目标恢复而保持两项 props 不变。 */
      change(newValue) {
        // 此次点击会把 checkbox 改为 false，并触发内层 change 事件；最终冲刷时必须将其重置为受控值 true。
        this.b.click();
      }

      /** 返回固定 value=lion 的 text 与 checked=true 的 checkbox；两项通过 ref 暴露，text 绑定嵌套点击处理器。 */
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
    // 派发原生事件才能覆盖顶层事件分发和事件结束时的受控恢复队列；直接调用 onChange 不经过这条路径。
    await act(() => {
      dispatchEventOnNode(instance.a, 'input');
    });

    expect(instance.a.value).toBe('lion');
    expect(instance.b.checked).toBe(true);
  });

  describe('switching text inputs between numeric and string numbers', () => {

    /** value 为数字 2 的 text input 配有不更新状态的 mock onChange；模拟输入 2.0 后断言 value 恢复 "2"，value attribute 随开关为缺省或 "2"。标题的无处理器在此实际是处理器不采纳输入。 */
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

    /** value 为字符串 "2"、onChange 不更新状态；原型 setter 输入 2.0 后断言 text value 恢复 "2"，attribute 随同步开关缺省或为 "2"，覆盖字符串受控值。 */
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

    /** Stub 初始数字 2，onChange 将目标字符串写入 state；模拟 2.0 后断言 DOM 保留 "2.0"，attribute 随开关缺省或为 "2.0"，验证采纳输入后的精度。 */
    it('changes the number 2 to "2.0" using a change handler', async () => {

      /** 文本精度 fixture：state 初始数字 2，onChange 采纳目标字符串，返回受控 text；用以区分接受 2.0 输入与固定值恢复。 */
      class Stub extends React.Component {

        /** 文本受控值初始数字 2；onChange 后变为用户输入的字符串，从而保留末尾小数零。 */
        state = {
          value: 2,
        };

        /** 读取 event.target.value 并写入 state；无返回值，不先做数字转换，使 DOM 中 2.0 可以按字符串保留。 */
        onChange = event => {
          this.setState({value: event.target.value});
        };

        /** 返回 type=text、value=state.value 的受控字段，绑定本实例 onChange，供原生 input 驱动状态。 */
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

  /** number Stub 初始字符串 .98，无处理器先警告；setState 改 0.98 后断言 DOM value 为 "0.98"，覆盖同数值的字符串格式更新。 */
  it('does change the string ".98" to "0.98" with no change handler', async () => {

    /** number 格式 fixture：初始 .98，测试通过组件 ref 将 state 改成 0.98；省略 onChange 以同时覆盖只读诊断。 */
    class Stub extends React.Component {

      /** 保存 number 的字符串值，初始 .98；外部 setState 改为 0.98，保留格式区别。 */
      state = {
        value: '.98',
      };

      /** 返回 number input，value 取 state；未提供处理器，因此首次挂载会产生预期只读诊断。 */
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

  /** readOnly number Stub 初始空串；setState 改数字 0 后断言 value 为 "0"，验证零不会被空值判断漏掉。 */
  it('performs a state change from "" to 0', async () => {

    /** 空串到零 fixture：初始 number value 为空串，外部 setState 改数字 0；readOnly 避免把格式断言混入处理器警告。 */
    class Stub extends React.Component {

      /** number 的当前受控值，初始空串，测试改数字 0，覆盖空值判断的零边界。 */
      state = {
        value: '',
      };

      /** 返回 readOnly number，value 取 state；保持受控且不需要 onChange。 */
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

  /** radio 初始 value 空串，更新为数字 0；断言 value property 与 attribute 均为 "0"，覆盖 radio 的提交值。 */
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

  /** checkbox 初始 value 空串，更新为数字 0；断言 value property 与 attribute 均为 "0"，覆盖 checkbox 的提交值。 */
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

  /** number Stub 初始字符串 3.0000，无处理器先警告；state 改为 "3" 后断言 value 为 "3"，覆盖字符串数字额外零的变化。 */
  it('distinguishes precision for extra zeroes in string number values', async () => {

    /** number 字符串精度 fixture：初始 3.0000，外部 setState 改 3，观察同数值但不同字符串的更新。 */
    class Stub extends React.Component {

      /** 保存初始字符串 3.0000，随后改字符串 3；不转数字，保留需要检测的额外零。 */
      state = {
        value: '3.0000',
      };

      /** 返回 state.value 控制的 number；无 onChange，首次只读警告由用例显式断言。 */
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

  /** 挂载 defaultValue 数字 0；断言 value attribute 和 property 均为 "0"，验证非受控初值的数字转换。 */
  it('should display `defaultValue` of number 0', async () => {
    await act(() => {
      root.render(<input type="text" defaultValue={0} />);
    });
    const node = container.firstChild;

    expect(node.getAttribute('value')).toBe('0');
    expect(node.value).toBe('0');
  });

  /** 挂载默认值 "0" 后将 defaultValue setter 替换为抛错探针、getter 固定 "0"；forceUpdate 的 act 完成且未抛错，证明相同默认值没有重复赋值。 */
  it('only assigns defaultValue if it changes', async () => {

    /** 重复默认值写入 fixture：每次 render 都返回 defaultValue=0 的 input，外部 forceUpdate 用来触发 props 相同的提交。 */
    class Test extends React.Component {

      /** 返回 defaultValue 字符串 0 的非受控 input；每次相同，令抛错 setter 探针检查重复赋值。 */
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

      /** defaultValue 探针 getter 始终返回字符串 0；不读取真实属性，使更新比较看到默认值没有变化。 */
      get() {
        return '0';
      },

      /** 接收任意重复赋值 value 并抛包含该值的 Error；无正常返回，forceUpdate 若成功即证明 defaultValue setter 没有被调用。 */
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

  /** 挂载 defaultValue=true；断言 value 为 "true"，覆盖布尔默认值的字符串转换。 */
  it('should display "true" for `defaultValue` of `true`', async () => {
    const stub = <input type="text" defaultValue={true} />;
    await act(() => {
      root.render(stub);
    });
    const node = container.firstChild;

    expect(node.value).toBe('true');
  });

  /** 挂载 defaultValue=false；断言 value 为 "false"，验证 false 默认值不会被当作缺省。 */
  it('should display "false" for `defaultValue` of `false`', async () => {
    const stub = <input type="text" defaultValue={false} />;
    await act(() => {
      root.render(stub);
    });
    const node = container.firstChild;

    expect(node.value).toBe('false');
  });

  /** 非受控 text 默认值从 0 更新到 1；断言 defaultValue=1。禁用 attribute 同步时 value 也变 1 且不 dirty；启用时 value 留 0 且 dirty，覆盖两种初始化方式。 */
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

  /** 非受控 date 默认日期从 1980 更新到 2000；defaultValue 始终更新到 2000，value 在禁用同步时更新、启用时保留 1980；末尾移除默认值仅执行 render，没有追加断言。 */
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

  /** readOnly text 从受控 value=0 改为仅 defaultValue=1；断言受控转非受控警告、value 仍为 "0" 且 dirty。验证默认值变化不会覆盖已脱离默认值的当前值。 */
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

  /** SSR 渲染 defaultValue="1" 并解析 HTML；断言 value attribute="1" 且无 defaultValue attribute，覆盖服务器表单初值映射。 */
  it('should render defaultValue for SSR', () => {
    const markup = ReactDOMServer.renderToString(
      <input type="text" defaultValue="1" />,
    );
    const div = document.createElement('div');
    div.innerHTML = markup;
    expect(div.firstChild.getAttribute('value')).toBe('1');
    expect(div.firstChild.getAttribute('defaultValue')).toBe(null);
  });

  /** SSR 渲染 defaultValue bigint 5；断言 value attribute="5" 且无 defaultValue attribute，覆盖 bigint 初值转换。 */
  it('should render bigint defaultValue for SSR', () => {
    const markup = ReactDOMServer.renderToString(
      <input type="text" defaultValue={5n} />,
    );
    const div = document.createElement('div');
    div.innerHTML = markup;
    expect(div.firstChild.getAttribute('value')).toBe('5');
    expect(div.firstChild.getAttribute('defaultValue')).toBe(null);
  });

  /** SSR 渲染 value="1" 和空 onChange；断言 value attribute="1" 且无 defaultValue attribute，覆盖受控服务器输出。 */
  it('should render value for SSR', () => {
    const element = <input type="text" value="1" onChange={() => {}} />;
    const markup = ReactDOMServer.renderToString(element);
    const div = document.createElement('div');
    div.innerHTML = markup;
    expect(div.firstChild.getAttribute('value')).toBe('1');
    expect(div.firstChild.getAttribute('defaultValue')).toBe(null);
  });

  /** SSR 渲染 value bigint 5 和空 onChange；断言 value attribute="5" 且无 defaultValue attribute，覆盖 bigint 受控输出。 */
  it('should render bigint value for SSR', () => {
    const element = <input type="text" value={5n} onChange={() => {}} />;
    const markup = ReactDOMServer.renderToString(element);
    const div = document.createElement('div');
    div.innerHTML = markup;
    expect(div.firstChild.getAttribute('value')).toBe('5');
    expect(div.firstChild.getAttribute('defaultValue')).toBe(null);
  });

  /** 客户端挂载 name="name"；断言 name property 和 attribute 均为 "name"，验证字段名写入。 */
  it('should render name attribute if it is supplied', async () => {
    await act(() => {
      root.render(<input type="text" name="name" />);
    });
    const node = container.firstChild;
    expect(node.name).toBe('name');
    expect(container.firstChild.getAttribute('name')).toBe('name');
  });

  /** SSR 渲染 name="name" 后解析；断言 name attribute 为 "name"，覆盖服务器字段名输出。 */
  it('should render name attribute if it is supplied for SSR', () => {
    const element = <input type="text" name="name" />;
    const markup = ReactDOMServer.renderToString(element);
    const div = document.createElement('div');
    div.innerHTML = markup;
    expect(div.firstChild.getAttribute('name')).toBe('name');
  });

  /** 客户端挂载缺省 name 的 input；断言 name attribute 为 null，验证不凭空添加字段名。 */
  it('should not render name attribute if it is not supplied', async () => {
    await act(() => {
      root.render(<input type="text" />);
    });
    expect(container.firstChild.getAttribute('name')).toBe(null);
  });

  /** SSR 渲染缺省 name 并解析；断言 name attribute 为 null，覆盖服务器省略属性。 */
  it('should not render name attribute if it is not supplied for SSR', () => {
    const element = <input type="text" />;
    const markup = ReactDOMServer.renderToString(element);
    const div = document.createElement('div');
    div.innerHTML = markup;
    expect(div.firstChild.getAttribute('name')).toBe(null);
  });

  /** defaultValue 对象的 toString 返回 foobar；挂载后断言 value="foobar"，覆盖可字符串化对象的非受控初值。 */
  it('should display "foobar" for `defaultValue` of `objToString`', async () => {
    const objToString = {

      /** 默认值对象的字符串转换钩子，返回 foobar；让测试覆盖对象初值的转换结果，不依赖对象默认标签。 */
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

  /** date 的 defaultValue 为 toString 返回日期但 valueOf 抛 TypeError 的 TemporalLike；act reject 为该 TypeError，并断言开发模式转换诊断，验证当前强制转换路径会调用 valueOf。 */
  it('should throw for date inputs if `defaultValue` is an object where valueOf() throws', async () => {

    /** date 默认值转换错误 fixture：toString 能给日期，valueOf 必抛错，用来识别输入初始化使用的原始值转换路径。 */
    class TemporalLike {

      /** 调用即抛 TypeError(prod message)，不返回值；模拟 Temporal 不支持默认原始值转换的限制，错误由 act.rejects 断言。 */
      valueOf() {
        // 此处抛错符合 ECMAScript “Temporal” 日期/时间 API 的行为。
        // 参见 https://tc39.es/proposal-temporal/docs/plaindate.html#valueOf
        throw new TypeError('prod message');
      }

      /** 返回日期字符串 2020-01-01；与抛错 valueOf 对照，证明有可用 toString 仍不会绕过当前转换错误。 */
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

  /** text 的 defaultValue 为 valueOf 抛 TypeError 的 TemporalLike；断言 act 拒绝及两次开发模式转换诊断，覆盖文本默认值错误而非仅采用其 toString。 */
  it('should throw for text inputs if `defaultValue` is an object where valueOf() throws', async () => {

    /** text 默认值转换错误 fixture：valueOf 抛 TypeError、toString 返回日期，覆盖文本非受控初始化的转换诊断。 */
    class TemporalLike {

      /** 原始值转换时抛 TypeError(prod message)，无正常返回；供 act 拒绝和开发模式诊断断言。 */
      valueOf() {
        // 此处抛错符合 ECMAScript “Temporal” 日期/时间 API 的行为。
        // 参见 https://tc39.es/proposal-temporal/docs/plaindate.html#valueOf
        throw new TypeError('prod message');
      }

      /** 返回日期字符串 2020-01-01；用来排除完全无法字符串化对象这一不同情况。 */
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

  /** date 的受控 value 使用同样抛错 TemporalLike 并提供 onChange；断言 act reject TypeError 及转换诊断，覆盖受控日期转换失败。 */
  it('should throw for date inputs if `value` is an object where valueOf() throws', async () => {

    /** date 受控 value 的 TemporalLike fixture；valueOf 故意抛错，toString 返回有效日期，验证受控转换仍失败。 */
    class TemporalLike {

      /** 调用即抛 TypeError(prod message)，无正常返回，模拟不允许隐式原始值转换的日期对象。 */
      valueOf() {
        // 此处抛错符合 ECMAScript “Temporal” 日期/时间 API 的行为。
        // 参见 https://tc39.es/proposal-temporal/docs/plaindate.html#valueOf
        throw new TypeError('prod message');
      }

      /** 返回日期文本 2020-01-01；该有效文本不改变 valueOf 抛错的测试条件。 */
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

  /** text 的受控 value 使用 valueOf 抛 TypeError 的 TemporalLike；断言 act reject 及转换诊断，覆盖受控文本对象转换失败。 */
  it('should throw for text inputs if `value` is an object where valueOf() throws', async () => {

    /** text 受控值转换错误 fixture：可显式 toString 的对象仍在 valueOf 抛错，错误应由 act 暴露。 */
    class TemporalLike {

      /** 抛 TypeError(prod message) 而不返回原始值，供受控 text 初始化的错误与诊断断言。 */
      valueOf() {
        // 此处抛错符合 ECMAScript “Temporal” 日期/时间 API 的行为。
        // 参见 https://tc39.es/proposal-temporal/docs/plaindate.html#valueOf
        throw new TypeError('prod message');
      }

      /** 返回 2020-01-01 字符串，保留对象具有可用显式字符串转换的对照条件。 */
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

  /** 挂载受控 value 数字 0 和空 onChange；断言 DOM value="0"，覆盖零值显示。 */
  it('should display `value` of number 0', async () => {
    await act(() => {
      root.render(<input type="text" value={0} onChange={emptyFunction} />);
    });
    const node = container.firstChild;

    expect(node.value).toBe('0');
  });

  /** 挂载受控 value bigint 5 和空 onChange；断言 DOM value="5"，覆盖 bigint 字符串转换。 */
  it('should display `value` of bigint 5', async () => {
    await act(() => {
      root.render(<input type="text" value={5n} onChange={emptyFunction} />);
    });
    const node = container.firstChild;

    expect(node.value).toBe('5');
  });

  /** 受控 text 从 yolo 更新 value=true；断言 DOM value="true"，验证布尔更新被转为字符串。 */
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

  /** 受控 text 从 yolo 更新 value=false；断言 DOM value="false"，覆盖 false 更新。 */
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

  /** 受控 text 从 foo 更新为 toString 返回 foobar 的对象；断言 DOM value="foobar"，验证对象值更新。 */
  it('should allow setting `value` to `objToString`', async () => {
    await act(() => {
      root.render(<input type="text" value="foo" onChange={emptyFunction} />);
    });
    const node = container.firstChild;

    expect(node.value).toBe('foo');

    const objToString = {

      /** value 更新对象的 toString 钩子返回 foobar；使 foo→对象的 DOM 字符串结果可直接比较。 */
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

  /** 挂载 value="a" 后用 getter/setter mock 记录 value 写入；再次 render "a" 断言 setter 零次，改为 "b" 断言一次，验证只在 DOM 值不同时赋值。 */
  it('should not incur unnecessary DOM mutations', async () => {
    await act(() => {
      root.render(<input value="a" onChange={() => {}} />);
    });

    const node = container.firstChild;
    let nodeValue = 'a';
    const nodeValueSetter = jest.fn();
    Object.defineProperty(node, 'value', {

      /** 返回闭包 nodeValue，初始 a；与 mock setter 共享存储，让测试统计等值 render 和变化 render 的 value 写入次数。 */
      get: function () {
        return nodeValue;
      },
      /** mock setter 接收 newValue 写回闭包 nodeValue；无返回值，调用次数代表实际 value 赋值而 getter 继续返回最新值。 */
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

  /** 初始 value="0" 后替换 value setter 为 mock，再 render 数字 0；断言 setter 未调用，验证字符串和数字转换后相同不会多写 DOM。 */
  it('should not incur unnecessary DOM mutations for numeric type conversion', async () => {
    await act(() => {
      root.render(<input value="0" onChange={() => {}} />);
    });

    const node = container.firstChild;
    let nodeValue = '0';
    const nodeValueSetter = jest.fn();
    Object.defineProperty(node, 'value', {

      /** 返回闭包 nodeValue，初始字符串 0；用于比较后续数字 0 是否造成多余 value 赋值。 */
      get: function () {
        return nodeValue;
      },
      /** mock setter 接收 newValue 并更新闭包 nodeValue；无返回值，用调用计数识别字符串零与数字零之间多余的 DOM 写入。 */
      set: nodeValueSetter.mockImplementation(function (newValue) {
        nodeValue = newValue;
      }),
    });

    await act(() => {
      root.render(<input value={0} onChange={() => {}} />);
    });
    expect(nodeValueSetter).toHaveBeenCalledTimes(0);
  });

  /** 初始 value="true" 后替换 value setter 为 mock，再 render 布尔 true；断言 setter 未调用，覆盖布尔转换后的等值比较。 */
  it('should not incur unnecessary DOM mutations for the boolean type conversion', async () => {
    await act(() => {
      root.render(<input value="true" onChange={() => {}} />);
    });

    const node = container.firstChild;
    let nodeValue = 'true';
    const nodeValueSetter = jest.fn();
    Object.defineProperty(node, 'value', {

      /** 返回闭包 nodeValue，初始字符串 true；用于比较布尔 true 转换后的相同值是否多写 DOM。 */
      get: function () {
        return nodeValue;
      },
      /** mock setter 写入 newValue 到闭包；无返回值，mock 的零次调用用于验证布尔 true 与字符串 true 的等值更新。 */
      set: nodeValueSetter.mockImplementation(function (newValue) {
        nodeValue = newValue;
      }),
    });

    await act(() => {
      root.render(<input value={true} onChange={() => {}} />);
    });
    expect(nodeValueSetter).toHaveBeenCalledTimes(0);
  });

  /** 受控 value 数字 0；原型 setter 改 giraffe 并派发 input 后断言 value="0"，验证事件后恢复零值。 */
  it('should properly control a value of number `0`', async () => {
    await act(() => {
      root.render(<input type="text" value={0} onChange={emptyFunction} />);
    });
    const node = container.firstChild;

    setUntrackedValue.call(node, 'giraffe');
    dispatchEventOnNode(node, 'input');
    expect(node.value).toBe('0');
  });

  /** 受控 text value 数字 0；模拟输入 0.0 后断言恢复 "0"，验证文本字段按受控字符串恢复。 */
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

  /** 受控 number value 数字 0；模拟 0.0 后断言 property 保留 "0.0"，attribute 随开关缺省或为 "0.0"，验证数值等价时保留用户格式。 */
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

  /** text 受控值从空串到数字 0；断言 value="0"、dirty 从 false 到 true，attribute 随开关缺省或为 "0"，覆盖空串到零的提交。 */
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

  /** text 受控值从 0 到空串；断言 value/defaultValue 均空串且 dirty 保持 true，覆盖清空现值和默认值。 */
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

  /** text 受控值从 0 到字符串 0.0；断言 value="0.0"，attribute 随开关缺省或同步 "0.0"，验证文本值的格式变化。 */
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

  /** number 受控值从空串到数字 0；断言 value="0"，attribute 随开关缺省或为 "0"，覆盖数字零更新。 */
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

  /** number 受控值从空串到字符串 "0"；断言 property="0"，attribute 随同步开关分支，覆盖字符串零更新。 */
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

  /** 挂载 value=0 和记录处理器，原型 setter 改 giraffe 后派发 input；处理器断言 target.nodeName="INPUT"，act 后 handled=true，验证事件目标与处理器执行，未直接断言 target.value。 */
  it('should have the correct target value', async () => {
    let handled = false;

    /** 接收 input 合成事件，断言 target.nodeName 为 INPUT 并置 handled=true；无返回值，测试目标节点和处理器执行，未验证 target.value 的具体内容。 */
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

  /** form 中非受控默认值 1；模拟用户改 changed，再更新 defaultValue=2，断言当前值仍 changed。form.reset 后断言 value="2" 且 dirty=false，验证 reset 采用最新默认值。 */
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

  /** 挂载没有 value 的 submit input；断言不存在 value attribute，保留浏览器默认按钮文案来源。 */
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

  /** submit 初始受控 value=foo，更新 undefined；断言受控转非受控警告及 value attribute=null，覆盖按钮移除显式值。 */
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

  /** reset 初始 value=foo，更新 undefined；断言受控转非受控警告及 value attribute=null，覆盖重置按钮属性删除。 */
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

  /** 挂载 submit value=banana；断言 value attribute="banana"，验证按钮显式文案且无需 onChange。 */
  it('should set a value on a submit input', async () => {
    const stub = <input type="submit" value="banana" />;
    await act(() => {
      root.render(stub);
    });
    const node = container.firstChild;

    expect(node.getAttribute('value')).toBe('banana');
  });

  /** submit value=undefined 挂载并同值重渲染；两次均断言 value attribute=null，验证 undefined 始终省略。 */
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

  /** reset value=undefined 挂载并同值重渲染；两次断言 value attribute=null，覆盖重置按钮省略属性。 */
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

  /** submit value=null 首次挂载断言 null 值警告，重渲染后仍无 value attribute；验证 null 不生成按钮属性且诊断去重。 */
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

  /** reset value=null 首次挂载断言 null 警告，两次渲染均断言 value attribute=null，覆盖重置按钮空值与诊断去重。 */
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

  /** 挂载 reset value=banana；断言 value attribute="banana"，覆盖重置按钮显式文案。 */
  it('should set a value on a reset input', async () => {
    const stub = <input type="reset" value="banana" />;
    await act(() => {
      root.render(stub);
    });
    const node = container.firstChild;

    expect(node.getAttribute('value')).toBe('banana');
  });

  /** 挂载 submit value 空串；断言 value attribute 为空串，验证显式空文案区别于缺省。 */
  it('should set an empty string value on a submit input', async () => {
    const stub = <input type="submit" value="" />;
    await act(() => {
      root.render(stub);
    });
    const node = container.firstChild;

    expect(node.getAttribute('value')).toBe('');
  });

  /** 挂载 reset value 空串；断言 value attribute 为空串，覆盖重置按钮显式空文案。 */
  it('should set an empty string value on a reset input', async () => {
    const stub = <input type="reset" value="" />;
    await act(() => {
      root.render(stub);
    });
    const node = container.firstChild;

    expect(node.getAttribute('value')).toBe('');
  });

  /** 同名 radio a 受控选中、b 非受控未选、c 在另一 form 默认选中；原型 setter 选 b 后派发 click。断言 a 恢复选中、c 不受影响，并检查 dirty、attribute 开关和 tracker 一致，覆盖按表单分组恢复。 */
  it('should control radio buttons', async () => {

    /** radio 分组 fixture：a 受控 true，b 非受控，c 在独立 form 默认 true；三个 ref 暴露 DOM，验证同名但不同表单的互斥和恢复边界。 */
    class RadioGroup extends React.Component {

      /** 保存组内受控 radio a 的 DOM ref；用来检查受控选中状态恢复及 tracker。 */
      aRef = React.createRef();

      /** 保存组内非受控 radio b 的 DOM ref；测试模拟选它以触发 a 的浏览器互斥和 React 恢复。 */
      bRef = React.createRef();

      /** 保存另一 form 内 radio c 的 DOM ref；作为同名跨表单不受影响的对照。 */
      cRef = React.createRef();

      /** 返回 a/b 同组及独立 form 的 c；值与表单边界固定，ref 使事件前后属性、dirty、tracker 可逐项观察。 */
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

    // 派发 click，让 ChangeEventPlugin 生成 onChange 并在事件后恢复受控 radio 组。
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

  /** SSR radio 默认受控选择 a，hydrate 前直接设置 checked 选 b；hydration 保留 b，开关启用时合成 change 令日志为 click b 并更新 state，没有原生 click 重放。再选 c/b，断言日志、选择及 tracker，覆盖恢复依据。 */
  it('should hydrate controlled radio buttons', async () => {

    /** 受控 hydration fixture：state.current 初始 a，a/b change 记录日志并采纳选择，c 仅记录；返回同名三项，用来区分 hydration 合成 change 开关下恢复依赖的 state。 */
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
      // hydration 比较已改变的 checked，排队合成 change 事件；此处没有派发需要重放的原生 click。
      assertLog(['click b']);
    } else {
      assertLog([]);
      // 未启用 hydration change 事件时，不更新 App state；hydration 仍保留用户此前选中的 B。
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
      // C 的 onChange 不设置状态，因此 B 会重新被选中。
      expect(a.checked).toBe(false);
      expect(b.checked).toBe(true);
      expect(c.checked).toBe(false);
    } else {
      // C 的 onChange 不设置状态；此分支没有通过 hydration change 更新选择 B，state 仍为 A，因此恢复 A。
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

  /** SSR 非受控 radio 默认 a，hydrate 前用户选 b；断言保留 b 且 hydration click 日志随开关。随后选 a 派发 click，断言日志 click a、a 选中及 dirty/tracker，验证非受控用户选择不被默认值恢复。 */
  it('should hydrate uncontrolled radio buttons', async () => {

    /** 非受控 hydration fixture：默认仅 a 选中，三个 change 只记日志不改 checked props；返回三项供 hydration 前直接改变 checked 及后续点击测试。 */
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
      // hydration 比较已改变的 checked，排队合成 change 事件；此处没有派发需要重放的原生 click。
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

  /** 按钮切换 updated，使两个 radio 同时在 firstName/secondName 间改名并交换 checked；两次点击断言第一项 false→true→false，初始 dirty=true，各阶段 tracker 一致，覆盖改组名和选择更新。 */
  it('should check the correct radio when the selected name moves', async () => {

    /** 改组名 fixture：updated 控制两项共同 name 及互补 checked，按钮翻转该 state，验证改组名时选择与 tracker 仍一致。 */
    class App extends React.Component {

      /** 初始 updated=false；每次按钮点击取反，使组名 firstName/secondName 和选中项同时改变。 */
      state = {
        updated: false,
      };

      /** 按钮事件将 updated 取反写入 state；无返回值，使测试两次点击覆盖来回改组。 */
      onClick = () => {
        this.setState({updated: !this.state.updated});
      };

      /** 返回切换按钮及两个同名 radio；name 随 updated 变化，两项 checked 分别为 updated===true/false，保持恰好一项选中。 */
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

  /** 初始同名 a 的两项仅第一项选中；更新后第一项仍 name=a、第二项改 name=b 且两项 checked=true。断言保存节点均选中、dirty=true、tracker 一致，验证改名后不再互斥。 */
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

  /** 仅 legacy 模式：A 挂载时在尚未挂到共同父节点的 container2 渲染选中 B，A 更新时挂入 container2；手动修改两项并点击 A。断言恢复 A=false/B=true、dirty 与 tracker 一致，覆盖事件中树形变化；jsdom 手动取消 B 是测试适配。 */
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

    /** legacy 跨 root fixture A：初始未选中，挂载时在脱离共同父节点的 container2 渲染 B，change 引起更新时再把 container2 接入共同父节点。 */
    class ComponentA extends React.Component {

      /** changed 初始 false，handleChange 改 true；render 不读该值，仅用更新触发 componentDidUpdate 的 DOM 树变化。 */
      state = {changed: false};

      /** 收到 change 时排队 changed=true；无返回值，触发 A 的更新生命周期并使两组容器最终共享父节点。 */
      handleChange = () => {
        this.setState({
          changed: true,
        });
      };

      /** 更新后将 container2 加入 sharedParent；无返回值，在受控事件处理期间改变 radio 同组的 DOM 关系。 */
      componentDidUpdate() {
        sharedParent.appendChild(container2);
      }

      /** 挂载后用 legacy ReactDOM.render 在 container2 建 B root；不返回内容，构造跨 root、暂未同父的选中对照项。 */
      componentDidMount() {
        ReactDOM.render(<ComponentB />, container2);
      }

      /** 返回始终 checked=false 的 fruit radio，ref 写 aNode 并绑定 handleChange，保持状态更新不改变受控选中值。 */
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

    /** legacy 对照 fixture B：在另一个 root 返回固定选中 fruit radio，供 A 更新改变容器关系后共同恢复。 */
    class ComponentB extends React.Component {

      /** 返回 checked=true、onChange 空的 fruit radio，ref 写 bNode；固定 props 让事件后恢复结果为 B 选中。 */
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

    // 派发 click，让 ChangeEventPlugin 生成 onChange 并在事件后恢复受控 radio 组。
    dispatchEventOnNode(aNode, 'click');

    // 应该恢复原来的状态.
    expect(aNode.checked).toBe(false);
    expect(bNode.checked).toBe(true);
    expect(isCheckedDirty(aNode)).toBe(true);
    expect(isCheckedDirty(bNode)).toBe(true);
    assertInputTrackingIsCurrent(container);
  });

  /** 两项受控 radio 初选 one；click 只同步禁用并保存 thunk，断言旧选择恢复。act(thunk) 才解除禁用并采纳事件目标值；往返 two/one 均断言选择、dirty 和 tracker，验证延后 state 更新前后的恢复。 */
  it('should control radio buttons if the tree updates during render (case 2; #26876)', async () => {
    let thunk = null;

    /** 延后选择 fixture：disabled 初始 false、value 初始 one；返回受控两项，change 先禁用并保存 thunk，由测试稍后 act(thunk) 采纳目标值。 */
    function App() {
      const [disabled, setDisabled] = React.useState(false);
      const [value, setValue] = React.useState('one');

      /** 接收 radio change 事件 e，立即禁用两项并保存延后闭包；不返回值且此刻不改选择，用来观察事件结束时先恢复旧 checked。 */
      function handleChange(e) {
        setDisabled(true);
        // 假装这是在 setTimeout 或其他地方。
        /** 延后执行时解除禁用并以捕获事件的 e.target.value 更新选择；无返回值，由 act(thunk) 显式驱动，不创建真实计时器。 */
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

  /** 先挂载 value=zoink、readOnly=true，再卸载新建 root 以 readOnly=false 挂载；断言后一次缺少 onChange 警告，验证只读豁免取决于真值。 */
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

  /** 挂载未 bind 的普通函数 onChange，模拟 giraffe/input；expect.assertions(1) 且处理器断言 this=undefined，验证事件调用不绑定组件或 DOM。 */
  it('should have a this value of undefined if bind is not used', async () => {
    expect.assertions(1);

    /** 未绑定普通函数 onChange，执行时断言 this 为 undefined；无返回值，expect.assertions 保证模拟 input 确实调用它。 */
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

  /** 非受控 text 默认值 foo 更新空串；断言 defaultValue=""，dirty 在禁用 attribute 同步时始终 false、启用时始终 true，覆盖默认值清空。 */
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

  /** value=null 挂载后断言 null 警告；卸载新建 root 再挂同值不追加诊断，覆盖该警告的模块级去重。 */
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

  /** readOnly radio 同时传 checked/defaultChecked=true；首次断言受控与非受控混用警告，卸载新 root 再挂相同 props，覆盖诊断去重。 */
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

  /** readOnly text 同时传 value=foo/defaultValue=bar；首次断言混用警告，再 render 相同 props 无追加诊断。中间 await 的箭头函数没有调用，root 实际未卸载，验证的是同 root 重渲染的去重。 */
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

  /** text 初始 value=controlled/onChange，更新时省略 value；断言受控转非受控警告，覆盖 defined→undefined。 */
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

  /** text 从受控 value=controlled 改 value=null；断言 null 值诊断及受控转非受控诊断，覆盖双重检查。 */
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

  /** text 从受控 value=controlled 改为仅 defaultValue=uncontrolled；断言受控转非受控警告，验证默认值不能延续受控身份。 */
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

  /** 初始 text 不传 value，更新 value=controlled；断言非受控转受控警告，覆盖 undefined→defined。 */
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

  /** text 初始 value=null 先断言空值警告，更新 controlled 再断言非受控转受控警告，验证 null 属于非受控。 */
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

  /** checkbox 初始 checked=true/onChange，更新省略 checked；断言受控转非受控警告。 */
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

  /** checkbox 初始 checked=true/onChange，更新 checked=null；断言受控转非受控警告，覆盖 null checked。 */
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

  /** checkbox 从 checked=true 改为仅 defaultChecked=true；断言受控转非受控警告，验证默认选中值不等于受控 checked。 */
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

  /** checkbox 初始省略 checked，更新 checked=true；断言非受控转受控警告，验证选中状态的控制权变化。 */
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

  /** checkbox 初始 checked=null，更新 checked=true；断言非受控转受控警告，覆盖 null 初始值。 */
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

  /** radio 初始 checked=true/onChange，更新省略 checked；断言受控转非受控警告。 */
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

  /** radio 初始 checked=true/onChange，更新 checked=null；断言受控转非受控警告，覆盖 null 选中值。 */
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

  /** radio 从 checked=true 改为仅 defaultChecked=true；断言受控转非受控警告，验证默认值不保持受控身份。 */
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

  /** radio 初始省略 checked，更新 checked=true；断言非受控转受控警告。 */
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

  /** radio 初始 checked=null，更新 checked=true；断言非受控转受控警告，覆盖 null 的控制权边界。 */
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

  /** radio 依次添加/删除 value、defaultChecked、onChange，但始终不传 checked；各次 act 无预期警告，验证 radio 的受控身份由 checked 决定。 */
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

  /** radio checked 始终 false，更新添加 value 和 defaultChecked=true；两次断言 dirty=true，最终 tracker 与 DOM 一致，验证 value 变化不改变受控 checked 身份。 */
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

  /** radio 初始 checked=false 并带 value，更新仅保留 value；断言受控转非受控警告，验证 false 也属于受控。 */
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

  /** 拦截 createElement，在 input 的 type/value setter 和 setAttribute 记录写入；挂载 range(value=0,min=0,max=100,step=1)。精确断言 min→max→step→type→value，验证约束与类型先于现值。 */
  it('sets type, step, min, max before value always', async () => {
    const log = [];
    const originalCreateElement = document.createElement;
    spyOnDevAndProd(document, 'createElement').mockImplementation(
      /** createElement mock 接收标签 type，沿用原 this/arguments 调原方法；只给 input 安装顺序探针，返回同一 el，其余标签不改变。 */
      function (type) {
        const el = originalCreateElement.apply(this, arguments);
        let value = '';
        let typeProp = '';

        if (type === 'input') {
          Object.defineProperty(el, 'type', {

            /** 返回闭包 typeProp，初始空串；供 input type 写入顺序探针读取，不委托原生 type getter。 */
            get: function () {
              return typeProp;
            },

            /** 接收 val 并转字符串存入 typeProp，再记录 set property type；无返回值，刻画类型写入在 value 前的顺序。 */
            set: function (val) {
              typeProp = String(val);
              log.push('set property type');
            },
          });
          Object.defineProperty(el, 'value', {

            /** 返回闭包 value，初始空串；与探针 setter 共享存储，使 React 对 DOM 值的比较仍可运行。 */
            get: function () {
              return value;
            },

            /** 接收 val 转字符串存储并记录 set property value；无返回值，由精确 log 断言检验 type/约束先写。 */
            set: function (val) {
              value = String(val);
              log.push('set property value');
            },
          });
          spyOnDevAndProd(el, 'setAttribute').mockImplementation(
            /** setAttribute mock 接收 name 并仅记录 set attribute 加属性名；不写真实 attribute、不返回值，用精确日志检查 min/max/step 的调用顺序。 */
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

  /** JSX 中 value="hi" 排在 type="radio" 前；挂载后断言 value="hi"，验证 props 枚举顺序不破坏类型与值初始化。 */
  it('sets value properly with type coming later in props', async () => {
    await act(() => {
      root.render(<input value="hi" type="radio" />);
    });
    expect(container.firstChild.value).toBe('hi');
  });

  /** Input 初始 number/1000，setState 同时改为 text/Test；断言保存 DOM 节点 value="Test"，覆盖类型先于不兼容旧类型的值更新。 */
  it('does not raise a validation warning when it switches types', async () => {

    /** 类型切换 fixture：初始 number/1000，外部 ref.setState 同时改 text/Test，检验更新先设置 type 才写新值。 */
    class Input extends React.Component {

      /** 保存 input 的 type 与 value，初始 number/1000；测试整体更新为 text/Test 以覆盖旧类型不兼容的新字符串。 */
      state = {type: 'number', value: 1000};

      /** 返回由 state 的 type/value 控制且带空 onChange 的 input，保持同一 DOM 节点执行类型和值更新。 */
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

  /** 拦截 date input 的 type/value/defaultValue 原生 setter 并记录顺序；挂载默认日期后断言 type→value→defaultValue，禁用同步时仅 type→defaultValue。验证本版写入序列，Safari 显示效果仍由原 TODO 留待真浏览器验证。 */
  it('resets value of date/time input to fix bugs in iOS Safari', async () => {

    /** 把 x 用 JSON.stringify(x,null,2) 格式化后返回；给 setter/attribute 调用日志保留字符串引号，使写入顺序断言可读。 */
    function strify(x) {
      return JSON.stringify(x, null, 2);
    }

    const log = [];
    const originalCreateElement = document.createElement;
    spyOnDevAndProd(document, 'createElement').mockImplementation(
      /** createElement mock 保留原 this/arguments 并返回真实 el；仅 input 的 type/value/defaultValue 委托原型 getter/setter且记录日志，让日期写入顺序可观察。 */
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

            /** 在当前 input 上调用原型 defaultValue getter 并返回原值；日志探针保留浏览器默认值语义。 */
            get: function () {
              return getDefaultValue.call(this);
            },

            /** 接收 val 先记 defaultValue 赋值日志，再调用原型 setter；无返回值，同时保留真实 DOM 更新与顺序证据。 */
            set: function (val) {
              log.push(`node.defaultValue = ${strify(val)}`);
              setDefaultValue.call(this, val);
            },
          });
          Object.defineProperty(el, 'value', {

            /** 委托原型 value getter 读取当前 input，返回实际日期现值；避免日志封装改掉原生值比较。 */
            get: function () {
              return getValue.call(this);
            },

            /** 接收 val，先记 value 赋值再委托原型 setter；无返回值，用于断言日期现值与默认值的初始化顺序。 */
            set: function (val) {
              log.push(`node.value = ${strify(val)}`);
              setValue.call(this, val);
            },
          });
          Object.defineProperty(el, 'type', {

            /** 委托原型 type getter 并返回当前 input 类型，使 React 的类型检测仍使用真实 DOM。 */
            get: function () {
              return getType.call(this);
            },

            /** 接收 val，先记录 type 赋值后委托原型 setter；无返回值，确保顺序探针仍发生真实类型改变。 */
            set: function (val) {
              log.push(`node.type = ${strify(val)}`);
              setType.call(this, val);
            },
          });
          spyOnDevAndProd(el, 'setAttribute').mockImplementation(
            /** setAttribute mock 接收 name/val，仅记录格式化调用而不真正写属性；无返回值，用于判别日期初始化是否走 attribute 路径。 */
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

    /** 返回新的受控 Input 类；该类从 props.value 初始化 state，用户 change 采纳字符串，props.type 指定 text/number，让一组用例共享事件与 blur fixture。 */
    function getTestInput() {
      return class extends React.Component {

        /** 受控值由初始 props.value 取得，null/undefined 归一为空串；后续只由 onChange 改，避免 rerender props 覆盖用户输入。 */
        state = {
          value: this.props.value == null ? '' : this.props.value,
        };

        /** 接收 event 并将目标 value 字符串写入 state；无返回值，供受控 text/number 的 input 与 blur 同步测试。 */
        onChange = event => {
          this.setState({value: event.target.value});
        };

        /** 返回 type 取 props、value 取 state 的受控 input，绑定实例 onChange，隔离输入类型与值更新。 */
        render() {
          const type = this.props.type;
          const value = this.state.value;

          return <input type={type} value={value} onChange={this.onChange} />;
        }
      };
    }

    /** getTestInput 初始空串 text，模拟输入 2 并更新 state；断言 dirty false→true，attribute 启用同步时为 "2"、禁用时缺省，覆盖用户输入后的受控提交。 */
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

    /** getTestInput 初始 number/1 并聚焦，模拟 2/input；断言 dirty=true，attribute 启用同步时为 "2"、禁用时缺省，覆盖仍聚焦时的事件属性同步。 */
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

    /** getTestInput 初始 number/1，聚焦后输入 2 再 blur；断言 property="2"、dirty=true，attribute 随开关为 "2" 或缺省，覆盖受控 number 失焦同步。 */
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

    /** 非受控 number 默认 1，聚焦后输入 4 再 blur；断言 dirty=true 且 value attribute 仍 "1"，验证失焦不把非受控当前输入同步为默认值。 */
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

    /** 非受控 text 默认 1，聚焦后输入 4 再 blur；断言 dirty=true 且 value attribute 仍 "1"，覆盖文本默认属性保留。 */
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

    /** 无参数的异步 fixture：act 挂载 first，模拟 input 采纳 latest，再 act 将 state.value 设 undefined；设置共享 input 供用例检查 property/attribute，Promise 完成表示更新已提交，警告由调用者断言。 */
    async function renderInputWithStringThenWithUndefined() {
      let setValueToUndefined;

      /** 退出受控为 undefined 的 Input fixture；初值 first，onChange 采纳输入，构造时向外暴露设 undefined 的闭包。 */
      class Input extends React.Component {

        /** 调用 super 并把 setValueToUndefined 绑定到本实例的 setState；无显式返回，方便 helper 在用户值提交后退出受控。 */
        constructor() {
          super();
          /** 执行时把该实例 state.value 设为 undefined；返回 setState 的结果，由 helper 的 act 调用以完成控制权切换。 */
          setValueToUndefined = () => this.setState({value: undefined});
        }

        /** 受控初值 first；模拟 input 改 latest，随后 helper 改 undefined，形成三步属性与现值对照。 */
        state = {value: 'first'};

        /** 返回 state.value 控制的 input，onChange 采纳 e.target.value；退出受控时保留同一 DOM 节点便于比较。 */
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

    /** helper 从 first 经 input 更新 latest 再把 state.value 改 undefined；断言受控转非受控警告，attribute 禁用同步时 null、启用时 latest，验证实际结果保留最新默认值而非标题所称初始值。 */
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

    /** helper 先采纳用户输入 latest，再把 value 改 undefined；断言控制权警告且 property 仍 latest，验证退出受控不清空用户值。 */
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

    /** 无参数异步 fixture：act 挂载 first，模拟输入 latest 后 act 把 state.value 设 null；保存共享 input，Promise 完成表示切换提交，null 与控制权警告由调用用例断言。 */
    async function renderInputWithStringThenWithNull() {
      let setValueToNull;

      /** 退出受控为 null 的 Input fixture；初始 first，onChange 采纳 latest，构造时向 helper 提供设 null 的闭包。 */
      class Input extends React.Component {

        /** 调用 super 并暴露绑定本实例的 setValueToNull；无显式返回，使 helper 可以在用户输入之后切换为空值。 */
        constructor() {
          super();
          /** 执行时将实例 state.value 改 null；返回 setState 的结果，helper 用 act 驱动该更新并检查诊断。 */
          setValueToNull = () => this.setState({value: null});
        }

        /** 受控初值 first，随后依次成为用户 latest 和 null，用来区分当前 property 与默认 attribute 的结果。 */
        state = {value: 'first'};

        /** 返回 state.value 的 input，onChange 写目标 value 字符串；保持节点复用以观察 null 不清空当前用户值。 */
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

    /** helper 从 first 采纳 latest 后把 value 改 null；断言 null 与控制权双诊断，attribute 禁用同步时 null、启用时 latest，覆盖属性结果而非标题所称初值恢复。 */
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

    /** helper 采纳 latest 后把 value 改 null；断言 null/受控转非受控诊断且 property=latest，验证退出受控保留当前值。 */
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

    /** 首次挂载 Symbol value 和空 onChange；断言非法 value 诊断、property 空串，attribute 随开关缺省或空串，覆盖受控非法值过滤。 */
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

    /** value 从 foo 更新为 Symbol；断言非法值诊断、property 清空，attribute 随同步开关缺省或空串，覆盖受控更新过滤。 */
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

    /** 首次挂载 Symbol defaultValue；断言 property 与 value attribute 都为空串，覆盖非法默认值过滤；本例没有警告断言，保留 TODO。 */
    it('treats initial Symbol defaultValue as an empty string', async () => {
      await act(() => {
        root.render(<input defaultValue={Symbol('foobar')} />);
      });
      const node = container.firstChild;

      expect(node.value).toBe('');
      expect(node.getAttribute('value')).toBe('');
      // TODO：这里应当发出警告。
    });

    /** 非受控 defaultValue 从 foo 更新 Symbol；断言 attribute 空串，property 禁用同步时空串、启用时保留 foo，验证 dirty 分支；没有警告断言。 */
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

    /** 首次挂载 function value 和空 onChange；断言非法值诊断、property 空串，attribute 随开关缺省或空串，覆盖函数受控值过滤。 */
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

    /** 受控 value 从 foo 更新为函数；断言非法值诊断、property 空串，attribute 随开关缺省或空串，覆盖更新路径过滤。 */
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

    /** 首次挂载 function defaultValue；断言 property/attribute 均空串，覆盖默认函数值过滤；警告仍是原 TODO，没有对应断言。 */
    it('treats initial function defaultValue as an empty string', async () => {
      await act(() => {
        root.render(<input defaultValue={() => {}} />);
      });
      const node = container.firstChild;

      expect(node.value).toBe('');
      expect(node.getAttribute('value')).toBe('');
      // TODO：这里应当发出警告。
    });

    /** 非受控 defaultValue 从 foo 改函数；断言 attribute 空串，property 在禁用同步时清空、启用时保留 foo，覆盖当前值与默认属性的不同结果。 */
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

    /** checkbox 仅 defaultChecked=true、不传 value；断言原生 property 为 "on" 而没有 value attribute，验证默认提交值无需显式写属性。 */
    it('does not add "on" in absence of value on a checkbox', async () => {
      await act(() => {
        root.render(<input type="checkbox" defaultChecked={true} />);
      });
      const node = container.firstChild;

      expect(node.value).toBe('on');
      expect(node.hasAttribute('value')).toBe(false);
    });

    /** radio 仅 defaultChecked=true、不传 value；断言 property 为 "on" 且 value attribute 缺省，覆盖 radio 默认提交值。 */
    it('does not add "on" in absence of value on a radio', async () => {
      await act(() => {
        root.render(<input type="radio" defaultChecked={true} />);
      });
      const node = container.firstChild;

      expect(node.value).toBe('on');
      expect(node.hasAttribute('value')).toBe(false);
    });
  });

  /** text 初始 defaultValue="0"，断言现值与默认值均 "0"；更新省略默认值后断言 defaultValue=""，覆盖旧默认属性删除，未断言更新后现值。 */
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

  /** text 初始 defaultValue="0" 后更新 null；断言 defaultValue 从 "0" 变空串，验证 null 默认值按缺省处理。 */
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

  /** 受控 text 从空串 render 到 a；原型 setter 改回空串后派发 input，断言日志含空串一次、DOM 恢复 a，验证 tracker 同步后仍能检测回到旧值的用户输入。 */
  it('should notice input changes when reverting back to original value', async () => {
    const log = [];

    /** 接收合成事件 e，把 e.target.value 追加 log；无返回值且不采纳输入，供 tracker 回到旧值的检测及事件后恢复断言。 */
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
