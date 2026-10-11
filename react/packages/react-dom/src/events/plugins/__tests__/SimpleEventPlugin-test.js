/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

// 缺少 JSDOM 支持的 polyfill
/** JSDOM缺原生ToggleEvent时的测试子类，只补oldState/newState两个字段，不模拟浏览器popover或details自动展开。 */
class ToggleEvent extends Event {
  /** 透传type/init给Event再保存两状态字段，便于插件接口拷贝。 */
  constructor(type, eventInit) {
    super(type, eventInit);
    this.newState = eventInit.newState;
    this.oldState = eventInit.oldState;
  }
}

describe('SimpleEventPlugin', function () {
  let React;
  let ReactDOMClient;
  let Scheduler;
  let act;

  let onClick;
  let container;
  let assertLog;
  let waitForAll;

  /** 在act里调用原生element.click，再断言共享onClick一次，涵盖提交后的handler效果。 */
  async function expectClickThru(element) {
    await act(() => {
      element.click();
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  }

  /** 直接element.click并断言共享监听零次，禁用/不传播场景无待提交状态。 */
  function expectNoClickThru(element) {
    element.click();
    expect(onClick).toHaveBeenCalledTimes(0);
  }

  /** 把容器挂body、createRoot并act渲染，返回firstChild；afterEach只移容器，没有调用root.unmount。 */
  async function mounted(element) {
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(element);
    });
    element = container.firstChild;
    return element;
  }

  beforeEach(function () {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    Scheduler = require('scheduler');

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;
    waitForAll = InternalTestUtils.waitForAll;
    act = InternalTestUtils.act;

    onClick = jest.fn();
  });

  afterEach(() => {
    if (container && document.body.contains(container)) {
      document.body.removeChild(container);
      container = null;
    }
  });

  /** 非交互div只有onClick，没有disabled prop；element.click后监听一次，验证普通div可分发click，旧标题disabled并非实际输入。 */
  it('A non-interactive tags click when disabled', async function () {
    const element = <div onClick={onClick} />;
    await expectClickThru(await mounted(element));
  });

  /** 父div onClick、子div无监听且无disabled prop；点击child父一次，验证非交互宿主普通冒泡。 */
  it('A non-interactive tags clicks bubble when disabled', async function () {
    const element = await mounted(
      <div onClick={onClick}>
        <div />
      </div>,
    );
    const child = element.firstChild;
    child.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  /** disabled button有onClick、内部span无监听；点span按钮监听零次，验证disabled交互宿主过滤自身click。 */
  it('does not register a click when clicking a child of a disabled element', async function () {
    const element = await mounted(
      <button onClick={onClick} disabled={true}>
        <span />
      </button>,
    );
    const child = element.querySelector('span');

    child.click();
    expect(onClick).toHaveBeenCalledTimes(0);
  });

  /** disabled button内span自己有onClick；点span一次，验证过滤disabled父不阻止有效子级监听。 */
  it('triggers click events for children of disabled elements', async function () {
    const element = await mounted(
      <button disabled={true}>
        <span onClick={onClick} />
      </button>,
    );
    const child = element.querySelector('span');

    child.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  /** 外div有capture、内部disabled button/span；点span外capture一次，验证禁用按钮不阻断祖先捕获。 */
  it('triggers parent captured click events when target is a child of a disabled elements', async function () {
    const element = await mounted(
      <div onClickCapture={onClick}>
        <button disabled={true}>
          <span />
        </button>
      </div>,
    );
    const child = element.querySelector('span');

    child.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  /** disabled button内span有capture；点span一次，验证有效目标捕获保留。 */
  it('triggers captured click events for children of disabled elements', async function () {
    const element = await mounted(
      <button disabled={true}>
        <span onClickCapture={onClick} />
      </button>,
    );
    const child = element.querySelector('span');

    child.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  describe.each(['button', 'input', 'select', 'textarea'])(
    '%s',
    function (tagName) {
      /** describe.each四tag button/input/select/textarea各初始非disabled，安装onClick；原生click监听一次，验证交互标签开放态。 */
      it('should forward clicks when it starts out not disabled', async () => {
        const element = React.createElement(tagName, {
          onClick: onClick,
        });

        await expectClickThru(await mounted(element));
      });

      /** 同四tag初disabled=true；原生click监听零次，验证初始禁用。 */
      it('should not forward clicks when it starts out disabled', async () => {
        const element = React.createElement(tagName, {
          onClick: onClick,
          disabled: true,
        });

        await expectNoClickThru(await mounted(element));
      });

      /** 同四tag先disabled=true再更新移除disabled；act后click一次，验证更新后恢复监听可用性。 */
      it('should forward clicks when it becomes not disabled', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        const root = ReactDOMClient.createRoot(container);
        await act(() => {
          root.render(
            React.createElement(tagName, {onClick: onClick, disabled: true}),
          );
        });
        await act(() => {
          root.render(React.createElement(tagName, {onClick: onClick}));
        });
        const element = container.firstChild;
        await expectClickThru(element);
      });

      /** 同四tag先启用再disabled=true；更新后click零次，验证禁用状态以最新props判定。 */
      it('should not forward clicks when it becomes disabled', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        const root = ReactDOMClient.createRoot(container);
        await act(() => {
          root.render(React.createElement(tagName, {onClick: onClick}));
        });
        await act(() => {
          root.render(
            React.createElement(tagName, {onClick: onClick, disabled: true}),
          );
        });
        const element = container.firstChild;
        expectNoClickThru(element);
      });

      /** 同四tag disabled true→false但onClick始终同mock；click一次，验证显式false恢复，并非更换监听函数身份，旧标题listener changed不准确。 */
      it('should work correctly if the listener is changed', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        const root = ReactDOMClient.createRoot(container);
        await act(() => {
          root.render(
            React.createElement(tagName, {onClick: onClick, disabled: true}),
          );
        });
        await act(() => {
          root.render(
            React.createElement(tagName, {onClick: onClick, disabled: false}),
          );
        });
        const element = container.firstChild;
        await expectClickThru(element);
      });
    },
  );

  /** Button click先increment、focus嵌套onFocus increment、再increment；函数更新累计3且didUpdate仅一次，验证同步嵌套事件沿同批提交。 */
  it('batches updates that occur as a result of a nested event dispatch', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);

    let button;
    /** count类fixture，click中的focus会同步派嵌套onFocus，检查三更新只一提交。 */
    class Button extends React.Component {
      /** 初count0，函数更新可按队列累计。 */
      state = {count: 0};
      /** 函数setState以最新排队state.count加1，避免对象更新合并遮住累计。 */
      increment = () =>
        this.setState(state => ({
          count: state.count + 1,
        }));
      /** 每次真实更新提交记didUpdate/count，验证批次数。 */
      componentDidUpdate() {
        Scheduler.log(`didUpdate - Count: ${this.state.count}`);
      }
      /** 同按钮绑定onFocus increment，click前后两increment，中间focus产生第三项。 */
      render() {
        return (
          <button
            ref={el => (button = el)}
            onFocus={this.increment}
            onClick={() => {
              // 调用 focus 会同步派发嵌套事件；此处理器中的所有更新应合并为一批。
              this.increment();
              button.focus();
              this.increment();
            }}>
            Count: {this.state.count}
          </button>
        );
      }
    }

    /** 派可冒泡可取消原生click给保存的button，构造嵌套事件链。 */
    function click() {
      button.dispatchEvent(
        new MouseEvent('click', {bubbles: true, cancelable: true}),
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Button />);
    });

    expect(button.textContent).toEqual('Count: 0');
    assertLog([]);

    await act(() => {
      click();
    });
    // 应恰好只有一次更新。
    assertLog(['didUpdate - Count: 3']);
    expect(button.textContent).toEqual('Count: 3');
  });

  describe('interactive events, in concurrent mode', () => {
    beforeEach(() => {
      jest.resetModules();

      React = require('react');
      ReactDOMClient = require('react-dom/client');
      Scheduler = require('scheduler');

      const InternalTestUtils = require('internal-test-utils');
      assertLog = InternalTestUtils.assertLog;
      waitForAll = InternalTestUtils.waitForAll;

      act = require('internal-test-utils').act;
    });

    /** Button初异步挂载尚无ref，waitFor后启用；点击act完成记录Side-effect/disabled并移除onClick，后续六click无副作用，验证离散更新在act返回前提交。state.disabled未作为DOM disabled prop。 */
    it('flushes pending interactive work before exiting event handler', async () => {
      container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      document.body.appendChild(container);

      let button;
      /** 点击后从props移除监听的类，状态名disabled不等于DOM disabled attribute。 */
      class Button extends React.Component {
        /** 初disabled=false，有可用onClick。 */
        state = {disabled: false};
        /** 记录副作用再设disabled=true，下次render移除onClick但不写disabled prop。 */
        onClick = () => {
          // 执行某个副作用。
          Scheduler.log('Side-effect');
          // 禁用按钮。
          this.setState({disabled: true});
        };
        /** 记录启用/禁用render日志并选择onClick函数或null。 */
        render() {
          Scheduler.log(
            `render button: ${this.state.disabled ? 'disabled' : 'enabled'}`,
          );
          return (
            <button
              ref={el => (button = el)}
              // 首次点击后处理器被移除。
              onClick={this.state.disabled ? null : this.onClick}
            />
          );
        }
      }

      // 初次挂载。
      root.render(<Button />);
      // 由于更新是异步的，此时尚未冲刷。
      assertLog([]);
      expect(button).toBe(undefined);
      // 冲刷异步工作。
      await waitForAll(['render button: enabled']);

      /** 派固定timeStamp0的冒泡click，后续点击应读当前props中null监听。 */
      function click() {
        const event = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(event, 'timeStamp', {
          value: 0,
        });
        button.dispatchEvent(event);
      }

      // 点击按钮以触发副作用。
      await act(() => click());
      assertLog([
        // 处理器已触发。
        'Side-effect',
        // act 返回时离散更新已提交，按钮处理器也已移除。
        'render button: disabled',
      ]);

      // 再次点击按钮。
      click();
      assertLog([
        // 事件处理器已从按钮移除，因此不会产生效果。
      ]);

      // 无论再点击多少次，该处理器都不应再次触发。
      click();
      click();
      click();
      click();
      click();
      await waitForAll([]);
    });

    // 注意：此测试针对旧的离散更新行为编写；更新原本异步，
    // 但派发另一个离散更新时会提前冲刷。
    /** Button onClick用对象state+1，七次各自await act(click)；最终7，验证每次离散操作提交后下次读取最新state；不证明同一未提交batch对象更新累计。 */
    it('end result of many interactive updates is deterministic', async () => {
      container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      document.body.appendChild(container);

      let button;
      /** count类使用对象setState，测试每次独立离散操作之间可见最新this.state。 */
      class Button extends React.Component {
        /** 初count0，七次独立act各增加一次。 */
        state = {count: 0};
        /** onClick直接读this.state.count+1而非函数更新，所以测试依赖各事件提交边界。 */
        render() {
          return (
            <button
              ref={el => (button = el)}
              onClick={() =>
                // 这里刻意不使用 updater 形式。
                this.setState({count: this.state.count + 1})
              }>
              Count: {this.state.count}
            </button>
          );
        }
      }

      // 初次挂载。
      root.render(<Button />);
      // 由于更新是异步的，此时尚未冲刷。
      expect(button).toBe(undefined);
      // 冲刷异步工作。
      await waitForAll([]);
      expect(button.textContent).toEqual('Count: 0');

      /** 派固定timeStamp0的可冒泡click，供七次独立act调用。 */
      function click() {
        const event = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(event, 'timeStamp', {
          value: 0,
        });
        button.dispatchEvent(event);
      }

      // 点击按钮一次。
      await act(() => click());
      // act 返回时该次 click 的离散更新已提交，计数应为 1。
      expect(button.textContent).toEqual('Count: 1');

      // 再多次点击按钮。
      await act(() => click());
      await act(() => click());
      await act(() => click());
      await act(() => click());
      await act(() => click());
      await act(() => click());

      // 冲刷剩余工作。
      await waitForAll([]);
      // 计数器应等于总点击次数。
      expect(button.textContent).toEqual('Count: 7');
    });
  });

  describe('iOS bubbling click fix', function () {
    // 参见 http://www.quirksmode.org/blog/archives/2010/09/click_event_del.html 。

    /** button onClick，派new MouseEvent(click)默认不冒泡；合成mock零次，验证事件未到根冒泡监听。仅此断言不检查本地noop是否安装。 */
    it('does not add a local click to interactive elements', async function () {
      container = document.createElement('div');

      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<button onClick={onClick} />);
      });

      const node = container.firstChild;

      node.dispatchEvent(new MouseEvent('click'));

      expect(onClick).toHaveBeenCalledTimes(0);
    });

    /** 非交互div onClick，同默认不冒泡click；mock零次，验证合成click仍走根监听，非交互noop不会直接调用用户handler；未直接检查安装操作。 */
    it('adds a local click listener to non-interactive elements', async function () {
      container = document.createElement('div');

      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div onClick={onClick} />);
      });

      const node = container.firstChild;

      await act(() => {
        node.dispatchEvent(new MouseEvent('click'));
      });

      expect(onClick).toHaveBeenCalledTimes(0);
    });

    /** 拦截根容器addEventListener记录passive选项；createRoot后touchstart/touchmove/wheel各两次，验证capture+bubble两阶段均被动注册。 */
    it('registers passive handlers for events affected by the intervention', async () => {
      container = document.createElement('div');

      const passiveEvents = [];
      const nativeAddEventListener = container.addEventListener;
      /** 拦截根addEventListener，仅记录options.passive真值的事件名后原样透传this/arguments；用次数区分capture/bubble注册。 */
      container.addEventListener = function (type, fn, options) {
        if (options !== null && typeof options === 'object') {
          if (options.passive) {
            passiveEvents.push(type);
          }
        }
        return nativeAddEventListener.apply(this, arguments);
      };

      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<div />);
      });

      expect(passiveEvents).toEqual([
        'touchstart',
        'touchstart',
        'touchmove',
        'touchmove',
        'wheel',
        'wheel',
      ]);
    });

    /** 有popover属性div，手动派不冒泡ToggleEvent closed→open→closed；onToggle两次且old/new字段对应，验证target原生监听与合成字段，不依赖实际Popover API展开。 */
    it('dispatches synthetic toggle events when the Popover API is used', async () => {
      container = document.createElement('div');

      const onToggle = jest.fn();
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <>
            <button popoverTarget="popover">Toggle popover</button>
            <div id="popover" popover="" onToggle={onToggle}>
              popover content
            </div>
          </>,
        );
      });

      const target = container.querySelector('#popover');
      target.dispatchEvent(
        new ToggleEvent('toggle', {
          bubbles: false,
          cancelable: true,
          oldState: 'closed',
          newState: 'open',
        }),
      );

      expect(onToggle).toHaveBeenCalledTimes(1);
      let event = onToggle.mock.calls[0][0];
      expect(event).toEqual(
        expect.objectContaining({
          oldState: 'closed',
          newState: 'open',
        }),
      );

      target.dispatchEvent(
        new ToggleEvent('toggle', {
          bubbles: false,
          cancelable: true,
          oldState: 'open',
          newState: 'closed',
        }),
      );

      expect(onToggle).toHaveBeenCalledTimes(2);
      event = onToggle.mock.calls[1][0];
      expect(event).toEqual(
        expect.objectContaining({
          oldState: 'open',
          newState: 'closed',
        }),
      );
    });

    /** details手动派相同ToggleEvent两次；onToggle含准确状态，验证details的target提取及字段，与JSDOM是否原生支持自动toggle无关。 */
    it('dispatches synthetic toggle events when <details> is used', async () => {
      // 本测试手动派发 ToggleEvent，验证 <details> 的 onToggle 提取及 newState/oldState 字段；
      // 原生事件定义参见：
      // https://html.spec.whatwg.org/multipage/indices.html#event-toggle

      container = document.createElement('div');

      const onToggle = jest.fn();
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <details id="details" onToggle={onToggle}>
            <summary>Summary</summary>
            Details
          </details>,
        );
      });

      const target = container.querySelector('#details');
      target.dispatchEvent(
        new ToggleEvent('toggle', {
          bubbles: false,
          cancelable: true,
          oldState: 'closed',
          newState: 'open',
        }),
      );

      expect(onToggle).toHaveBeenCalledTimes(1);
      let event = onToggle.mock.calls[0][0];
      expect(event).toEqual(
        expect.objectContaining({
          oldState: 'closed',
          newState: 'open',
        }),
      );

      target.dispatchEvent(
        new ToggleEvent('toggle', {
          bubbles: false,
          cancelable: true,
          oldState: 'open',
          newState: 'closed',
        }),
      );

      expect(onToggle).toHaveBeenCalledTimes(2);
      event = onToggle.mock.calls[1][0];
      expect(event).toEqual(
        expect.objectContaining({
          oldState: 'open',
          newState: 'closed',
        }),
      );
    });
  });

  /** form onSubmit preventDefault，向submit按钮派SubmitEvent且submitter同按钮；form合成一次、event.submitter同DOM，验证submitter字段透传与根冒泡。 */
  it('includes the submitter in submit events', async function () {
    container = document.createElement('div');

    const onSubmit = jest.fn(event => {
      event.preventDefault();
    });
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <form onSubmit={onSubmit}>
          <button type="submit" id="submitter">
            Submit
          </button>
        </form>,
      );
    });

    const submitter = container.querySelector('#submitter');
    const submitEvent = new SubmitEvent('submit', {
      bubbles: true,
      cancelable: true,
      submitter: submitter,
    });
    await act(() => {
      submitter.dispatchEvent(submitEvent);
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const event = onSubmit.mock.calls[0][0];
    expect(event.submitter).toBe(submitter);
  });
});
