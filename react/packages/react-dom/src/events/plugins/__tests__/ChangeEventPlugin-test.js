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

/** 保存checkbox/radio原生checked setter，用测试绕过React自己的tracker赋值封装。 */
const setUntrackedChecked = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'checked',
).set;

/** 保存input原生value setter，模拟DOM值变但tracker仍旧的用户输入。 */
const setUntrackedValue = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'value',
).set;

/** 保存textarea原生value setter，覆盖独立原型的值追踪。 */
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
    /** 测试调度器替身截获message监听回调，其余事件转给旧addEventListener；本文件afterEach只移容器，未恢复这两个全局函数。 */
    global.addEventListener = function (eventName, callback, useCapture) {
      if (eventName === 'message') {
        postMessageCallback = callback;
      } else {
        originalAddEventListener(eventName, callback, useCapture);
      }
    };
    /** 用source/data构造简化postMessage事件并同步执行记录的message回调，targetOrigin未参与校验。 */
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

  /** 文本input初始defaultValue=foo，不改值便连续派发input/change；onChange计数0，验证初始值已进入tracker而非首次事件必报。 */
  it('should consider initial text value to be current', async () => {
    let called = 0;

    /** 累计本例实际生成的合成change，并检查type已标准化为change；重复原生事件是否被去重由外层计数断言决定。 */
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

  /** 相同foo初值改用onChangeCapture，不改值派发input/change仍0次；验证capture同样应用值去重。 */
  it('should consider initial text value to be current (capture)', async () => {
    let called = 0;

    /** 累计本例实际生成的合成change，并检查type已标准化为change；重复原生事件是否被去重由外层计数断言决定。 */
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

  /** 初始textarea为initial，不改变value派发input/change，onChange为0；验证textarea初值跟踪。 */
  it('should not invoke a change event for textarea same value', async () => {
    let called = 0;

    /** 累计本例实际生成的合成change，并检查type已标准化为change；重复原生事件是否被去重由外层计数断言决定。 */
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

  /** 相同textarea场景使用capture handler，事件计数仍0，覆盖捕获阶段去重。 */
  it('should not invoke a change event for textarea same value (capture)', async () => {
    let called = 0;

    /** 累计本例实际生成的合成change，并检查type已标准化为change；重复原生事件是否被去重由外层计数断言决定。 */
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

  /** checkbox初始checked=true，原生setter暗设false再MouseEvent click自动变true；与tracker初始true相同故0次change，验证比较事件最终值。 */
  it('should consider initial checkbox checked=true to be current', async () => {
    let called = 0;

    /** 累计本例实际生成的合成change，并检查type已标准化为change；重复原生事件是否被去重由外层计数断言决定。 */
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

  /** checkbox初始false，原生setter暗设true后click自动变false；0次change，覆盖相反初值的去重。 */
  it('should consider initial checkbox checked=false to be current', async () => {
    let called = 0;

    /** 累计本例实际生成的合成change，并检查type已标准化为change；重复原生事件是否被去重由外层计数断言决定。 */
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

  /** 普通checkbox初始false，两个MouseEvent click分别切true/false并各触发一次change；验证点击默认行为与tracker更新。 */
  it('should fire change for checkbox input', async () => {
    let called = 0;

    /** 累计本例实际生成的合成change，并检查type已标准化为change；重复原生事件是否被去重由外层计数断言决定。 */
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

  /** 直接赋input.value=bar同时更新tracker，input事件不报；原生setter改foo绕过tracker后报一次，再重复input不报，验证程序赋值与用户模拟的差别。 */
  it('should not fire change setting the value programmatically', async () => {
    let called = 0;

    /** 累计本例实际生成的合成change，并检查type已标准化为change；重复原生事件是否被去重由外层计数断言决定。 */
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

  /** 初始文本42，直接赋数字42再input；DOM字符串42且change0次，验证tracker按字符串化后的值比较。 */
  it('should not distinguish equal string and number values', async () => {
    let called = 0;

    /** 累计本例实际生成的合成change，并检查type已标准化为change；重复原生事件是否被去重由外层计数断言决定。 */
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

  /** 直接checked=true更新tracker，再原生setter设false后click回true不报；下一普通click变false才报一次，验证程序赋值后当前checked基线。 */
  it('should not fire change when setting checked programmatically', async () => {
    let called = 0;

    /** 累计本例实际生成的合成change，并检查type已标准化为change；重复原生事件是否被去重由外层计数断言决定。 */
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

  /** 挂载普通input后act卸载，不额外检查旧节点tracker或DOM身份；主要验证该清理流程不抛错。 */
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

  /** 原生setter把radio checked改true，连续派两个普通Event click但不再改值；只有一次change，验证checked事件去重。 */
  it('should only fire change for checked radio button once', async () => {
    let called = 0;

    /** 累计本例实际生成的合成change，并检查type已标准化为change；重复原生事件是否被去重由外层计数断言决定。 */
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

  /** 同name两个radio依次click第一、第二、第一；计数2/1，验证自动取消兄弟选中后其tracker基线也同步，回选仍被识别。 */
  it('should track radio button cousins in a group', async () => {
    let called1 = 0;
    let called2 = 0;

    /** 累计第一个radio收到的change，并检查合成type。 */
    function cb1(e) {
      called1++;
      expect(e.type).toBe('change');
    }

    /** 累计第二个radio收到的change，并检查合成type。 */
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

  /** 依次测试range/number/text，每类型分别用全change、全input与混合事件三独立根；原生setter改42只有一有效变化，初始及重复事件不报，验证跨原生类型共享tracker去重。 */
  it('should deduplicate input value change events', async () => {
    let called = 0;

    /** 累计本例实际生成的合成change，并检查type已标准化为change；重复原生事件是否被去重由外层计数断言决定。 */
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

  /** range原生setter先10并input、再20并change；计数2，验证支持input与change两条提取入口。 */
  it('should listen for both change and input events when supported', async () => {
    let called = 0;

    /** 累计本例实际生成的合成change，并检查type已标准化为change；重复原生事件是否被去重由外层计数断言决定。 */
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

  /** range从初值改40，随后赋非法foo被DOM规范化；每次input/change成对只报一次，共2次，验证按实际规范化value判断并跨事件去重。 */
  it('should only fire events when the value changes for range inputs', async () => {
    let called = 0;

    /** 累计本例实际生成的合成change，并检查type已标准化为change；重复原生事件是否被去重由外层计数断言决定。 */
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

  /** 临时createElement给节点自定义空get/set value，input挂载、更新、change与卸载都可执行；finally还原createElement，验证不能安装tracker时不崩溃。 */
  it('does not crash for nodes with custom value property', async () => {
    let originalCreateElement;
    // https://github.com/facebook/react/issues/10196
    try {
      originalCreateElement = document.createElement;
      /** 保留原createElement的this/arguments，给所有创建节点加自有value访问器，制造无法正常安装tracker的情形；外层finally恢复。 */
      document.createElement = function () {
        const node = originalCreateElement.apply(this, arguments);
        Object.defineProperty(node, 'value', {

          /** 自定义value getter返回undefined，不提供标准DOM字符串读取。 */
          get() {},

          /** 自定义value setter忽略赋值，使tracker安装必须避开已有自有属性。 */
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

    /** 受控text初始异步挂载，原生setter改changed后input立即触发更新；最终DOM为派生changed [!]，验证事件批结束提交并恢复受控输出。 */
    it('text input', async () => {
      const root = ReactDOMClient.createRoot(container);
      let input;

      /** 受控input把state changed派生为changed [!]，用于检查事件结束恢复。 */
      class ControlledInput extends React.Component {

        /** 保存输入原始state值，初始initial。 */
        state = {value: 'initial'};

        /** 立即捕获event.target.value并排state更新。 */
        onChange = event => this.setState({value: event.target.value});

        /** 记录原始state而把派生value送input，ref暴露实际DOM。 */
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

    /** 受控checkbox先正常checked再reverse输出反值，click更新后DOM遵循派生checked而非原生切换值；验证checked恢复与反向受控输出。 */
    it('checkbox input', async () => {
      const root = ReactDOMClient.createRoot(container);
      let input;

      /** 可反转受控checked输出的类，区分state与主机最终checked。 */
      class ControlledInput extends React.Component {

        /** 初始checked state为false。 */
        state = {checked: false};

        /** 读取事件当时target.checked并写state。 */
        onChange = event => {
          this.setState({checked: event.target.checked});
        };

        /** 按reverse决定输出checked是否取反，记录state而非派生值。 */
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

    /** 受控textarea初始异步挂载，原生setter改changed并input后同步日志及DOM changed [!]；覆盖textarea受控恢复。 */
    it('textarea', async () => {
      const root = ReactDOMClient.createRoot(container);
      let textarea;

      /** textarea受控输出fixture，使用其独立value原型。 */
      class ControlledTextarea extends React.Component {

        /** 初始文本状态为initial。 */
        state = {value: 'initial'};

        /** 把event.target.value捕获进state。 */
        onChange = event => this.setState({value: event.target.value});

        /** 将changed转changed [!]并记录render，检验受控textarea输出覆盖用户原值。 */
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

    /** input自身onChange为空，祖先div handler读input.target.value更新；事件后DOM changed [!]，验证合成change冒泡及批结束受控恢复。 */
    it('parent of input', async () => {
      const root = ReactDOMClient.createRoot(container);
      let input;

      /** 让change在祖先div更新state的受控inputfixture。 */
      class ControlledInput extends React.Component {

        /** 保存祖先读取到的原输入值。 */
        state = {value: 'initial'};

        /** 读取冒泡事件target.value并更新父state。 */
        onChange = event => this.setState({value: event.target.value});

        /** 在div装onChange，input只保留空handler避免受控警告；value派生后由提交恢复。 */
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

    /** 受控input以普通onClick重置state，派click后等离散微任务，DOM为空；验证非Change插件事件导致的更新也能完成受控值提交。 */
    it('is sync for non-input events', async () => {
      const root = ReactDOMClient.createRoot(container);
      let input;

      /** 除了onChange还用onClick清空受控文本，比较非input事件更新。 */
      class ControlledInput extends React.Component {

        /** 保存初始文本state。 */
        state = {value: 'initial'};

        /** 把input的change目标值送state。 */
        onChange = event => this.setState({value: event.target.value});

        /** click时将state设空字符串，后续提交驱动受控value。 */
        reset = () => {
          this.setState({value: ''});
        };

        /** 记录state并输出受控value，同时连接change与click两个事件入口。 */
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

    /** mouseover触发onMouseEnter设hover=true，handler后的flushSync仍读not hovered，act最终读hovered；验证连续事件更新不属于该同步冲刷优先级，本例未派mouseleave。 */
    it('mouse enter/leave should be user-blocking but not discrete', async () => {
      const {useState} = React;

      const root = ReactDOMClient.createRoot(container);

      const target = React.createRef(null);

      /** 用鼠标enter/leave更新hover显示，连续事件应等act刷新而不被无callback flushSync强制提交。 */
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
