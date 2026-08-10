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
/** `ToggleEvent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
class ToggleEvent extends Event {
  /** `ToggleEvent.constructor`：初始化测试夹具实例及其状态。 */
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

  /** `expectClickThru`：封装当前用例复用的操作、回调或断言步骤。 */
  async function expectClickThru(element) {
    await act(() => {
      element.click();
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  }

  /** `expectNoClickThru`：封装当前用例复用的操作、回调或断言步骤。 */
  function expectNoClickThru(element) {
    element.click();
    expect(onClick).toHaveBeenCalledTimes(0);
  }

  /** `mounted`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「A non-interactive tags click when disabled」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：事件断言连接 DOMPluginEventSystem 的委托、合成与传播路径。
   */
  it('A non-interactive tags click when disabled', async function () {
    const element = <div onClick={onClick} />;
    await expectClickThru(await mounted(element));
  });

  /** 测试场景：验证「A non-interactive tags clicks bubble when disabled」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「does not register a click when clicking a child of a disabled element」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「triggers click events for children of disabled elements」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「triggers parent captured click events when target is a child of a disabled elements」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「triggers captured click events for children of disabled elements」描述的渲染、交互或错误处理结果。 */
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
      /** 测试场景：验证「should forward clicks when it starts out not disabled」描述的渲染、交互或错误处理结果。 */
      it('should forward clicks when it starts out not disabled', async () => {
        const element = React.createElement(tagName, {
          onClick: onClick,
        });

        await expectClickThru(await mounted(element));
      });

      /** 测试场景：验证「should not forward clicks when it starts out disabled」描述的渲染、交互或错误处理结果。 */
      it('should not forward clicks when it starts out disabled', async () => {
        const element = React.createElement(tagName, {
          onClick: onClick,
          disabled: true,
        });

        await expectNoClickThru(await mounted(element));
      });

      /** 测试场景：验证「should forward clicks when it becomes not disabled」描述的渲染、交互或错误处理结果。 */
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

      /** 测试场景：验证「should not forward clicks when it becomes disabled」描述的渲染、交互或错误处理结果。 */
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

      /** 测试场景：验证「should work correctly if the listener is changed」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「batches updates that occur as a result of a nested event dispatch」描述的渲染、交互或错误处理结果。 */
  it('batches updates that occur as a result of a nested event dispatch', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);

    let button;
    /** `Button`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Button extends React.Component {
      /** `Button.state`：记录测试夹具在当前场景中的状态。 */
      state = {count: 0};
      /** `Button.increment`：封装当前用例复用的操作、回调或断言步骤。 */
      increment = () =>
        this.setState(state => ({
          count: state.count + 1,
        }));
      /** `Button.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        Scheduler.log(`didUpdate - Count: ${this.state.count}`);
      }
      /** `Button.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

    /** `click`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** 测试场景：验证「flushes pending interactive work before exiting event handler」描述的渲染、交互或错误处理结果。 */
    it('flushes pending interactive work before exiting event handler', async () => {
      container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      document.body.appendChild(container);

      let button;
      /** `Button`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Button extends React.Component {
        /** `Button.state`：记录测试夹具在当前场景中的状态。 */
        state = {disabled: false};
        /** `Button.onClick`：封装当前用例复用的操作、回调或断言步骤。 */
        onClick = () => {
          // 执行某个副作用。
          Scheduler.log('Side-effect');
          // 禁用按钮。
          this.setState({disabled: true});
        };
        /** `Button.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

      /** `click`：封装当前用例复用的操作、回调或断言步骤。 */
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
        // 组件已同步重新渲染，即使在并发模式下也是如此。
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
    /** 测试场景：验证「end result of many interactive updates is deterministic」描述的渲染、交互或错误处理结果。 */
    it('end result of many interactive updates is deterministic', async () => {
      container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      document.body.appendChild(container);

      let button;
      /** `Button`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Button extends React.Component {
        /** `Button.state`：记录测试夹具在当前场景中的状态。 */
        state = {count: 0};
        /** `Button.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

      /** `click`：封装当前用例复用的操作、回调或断言步骤。 */
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
      // 计数器应同步更新，即使在并发模式下也是如此。
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

    /** 测试场景：验证「does not add a local click to interactive elements」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「adds a local click listener to non-interactive elements」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「registers passive handlers for events affected by the intervention」描述的渲染、交互或错误处理结果。 */
    it('registers passive handlers for events affected by the intervention', async () => {
      container = document.createElement('div');

      const passiveEvents = [];
      const nativeAddEventListener = container.addEventListener;
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

    /** 测试场景：验证「dispatches synthetic toggle events when the Popover API is used」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「dispatches synthetic toggle events when <details> is used」描述的渲染、交互或错误处理结果。 */
    it('dispatches synthetic toggle events when <details> is used', async () => {
      // 此测试只重放浏览器行为；真正要验证的是浏览器是否在 <details> 上派发 ToggleEvent。
      // MDN 声称 <details> 不接收该事件，但 Chrome 会派发，规范也确认这一行为：
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

  /** 测试场景：验证「includes the submitter in submit events」描述的渲染、交互或错误处理结果。 */
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
