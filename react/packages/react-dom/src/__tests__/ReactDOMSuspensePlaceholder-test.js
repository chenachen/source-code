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
let findDOMNode;
let ReactDOMClient;
let Suspense;
let Scheduler;
let act;
let textCache;
let assertLog;

describe('ReactDOMSuspensePlaceholder', () => {
  let container;

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    findDOMNode =
      ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
        .findDOMNode;
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    assertLog = require('internal-test-utils').assertLog;
    Suspense = React.Suspense;
    container = document.createElement('div');
    document.body.appendChild(container);

    textCache = new Map();
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  /** `resolveText`：封装当前用例复用的操作、回调或断言步骤。 */
  function resolveText(text) {
    const record = textCache.get(text);
    if (record === undefined) {
      const newRecord = {
        status: 'resolved',
        value: text,
      };
      textCache.set(text, newRecord);
    } else if (record.status === 'pending') {
      const thenable = record.value;
      record.status = 'resolved';
      record.value = text;
      thenable.pings.forEach(t => t());
    }
  }

  /** `readText`：封装当前用例复用的操作、回调或断言步骤。 */
  function readText(text) {
    const record = textCache.get(text);
    if (record !== undefined) {
      switch (record.status) {
        case 'pending':
          Scheduler.log(`Suspend! [${text}]`);
          throw record.value;
        case 'rejected':
          throw record.value;
        case 'resolved':
          return record.value;
      }
    } else {
      Scheduler.log(`Suspend! [${text}]`);
      const thenable = {
        pings: [],
        /** `readText.then`：实现测试夹具的生命周期、渲染或交互步骤。 */
        then(resolve) {
          if (newRecord.status === 'pending') {
            thenable.pings.push(resolve);
          } else {
            Promise.resolve().then(() => resolve(newRecord.value));
          }
        },
      };

      const newRecord = {
        status: 'pending',
        value: thenable,
      };
      textCache.set(text, newRecord);

      throw thenable;
    }
  }

  /** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** `AsyncText`：封装当前用例复用的操作、回调或断言步骤。 */
  function AsyncText({text}) {
    readText(text);
    Scheduler.log(text);
    return text;
  }

  // @gate !disableLegacyMode
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「hides and unhides timed out DOM elements in legacy roots」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('hides and unhides timed out DOM elements in legacy roots', async () => {
    const divs = [
      React.createRef(null),
      React.createRef(null),
      React.createRef(null),
    ];
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <div ref={divs[0]}>
            <Text text="A" />
          </div>
          <div ref={divs[1]}>
            <AsyncText text="B" />
          </div>
          <div style={{display: 'inline'}} ref={divs[2]}>
            <Text text="C" />
          </div>
        </Suspense>
      );
    }
    ReactDOM.render(<App />, container);
    expect(window.getComputedStyle(divs[0].current).display).toEqual('none');
    expect(window.getComputedStyle(divs[1].current).display).toEqual('none');
    expect(window.getComputedStyle(divs[2].current).display).toEqual('none');
    assertLog(['A', 'Suspend! [B]', 'C', 'Loading...']);
    await act(async () => {
      await resolveText('B');
    });

    expect(window.getComputedStyle(divs[0].current).display).toEqual('block');
    expect(window.getComputedStyle(divs[1].current).display).toEqual('block');
    // 这个 div 的 display 由 prop 设置。
    expect(window.getComputedStyle(divs[2].current).display).toEqual('inline');
    assertLog(['B']);
  });

  /** 测试场景：验证「hides and unhides timed out text nodes」描述的渲染、交互或错误处理结果。 */
  it('hides and unhides timed out text nodes', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <Text text="A" />
          <AsyncText text="B" />
          <Text text="C" />
        </Suspense>
      );
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App />);
    });

    expect(container.textContent).toEqual('Loading...');
    assertLog([
      'A',
      'Suspend! [B]',
      'Loading...',
      // 预热阶段
      'A',
      'Suspend! [B]',
      'C',
    ]);
    await act(() => {
      resolveText('B');
    });
    assertLog(['A', 'B', 'C']);
    expect(container.textContent).toEqual('ABC');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
  it(
    'in legacy roots, re-hides children if their display is updated ' +
      'but the boundary is still showing the fallback',
    async () => {
      const {useState} = React;

      let setIsVisible;
      /** `Sibling`：封装当前用例复用的操作、回调或断言步骤。 */
      function Sibling({children}) {
        const [isVisible, _setIsVisible] = useState(false);
        setIsVisible = _setIsVisible;
        return (
          <span style={{display: isVisible ? 'inline' : 'none'}}>
            {children}
          </span>
        );
      }

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App() {
        return (
          <Suspense fallback={<Text text="Loading..." />}>
            <Sibling>Sibling</Sibling>
            <span>
              <AsyncText text="Async" />
            </span>
          </Suspense>
        );
      }

      await act(() => {
        ReactDOM.render(<App />, container);
      });
      expect(container.innerHTML).toEqual(
        '<span style="display: none;">Sibling</span><span style=' +
          '"display: none;"></span>Loading...',
      );
      assertLog(['Suspend! [Async]', 'Loading...']);

      // 更新内联 display 样式；它位于隐藏的 fallback 中，因此会被覆盖。
      await act(() => setIsVisible(true));
      expect(container.innerHTML).toEqual(
        '<span style="display: none;">Sibling</span><span style=' +
          '"display: none;"></span>Loading...',
      );
      assertLog(['Suspend! [Async]']);

      // 解除挂起后，样式应与内联 prop 匹配。
      await act(() => resolveText('Async'));
      expect(container.innerHTML).toEqual(
        '<span style="display: inline;">Sibling</span><span style="">Async</span>',
      );
    },
  );

  // 针对 https://github.com/facebook/react/issues/14188 的回归测试。
  // @gate !disableLegacyMode
  /** 测试场景：验证「can call findDOMNode() in a suspended component commit phase in legacy roots」描述的渲染、交互或错误处理结果。 */
  it('can call findDOMNode() in a suspended component commit phase in legacy roots', async () => {
    const log = [];
    const Lazy = React.lazy(
      () =>
        new Promise(resolve =>
          resolve({
            /** `default`：实现测试夹具的生命周期、渲染或交互步骤。 */
            default() {
              return 'lazy';
            },
          }),
        ),
    );

    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push('cDM ' + this.props.id);
        findDOMNode(this);
      }
      /** `Child.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        log.push('cDU ' + this.props.id);
        findDOMNode(this);
      }
      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return 'child';
      }
    }

    const buttonRef = React.createRef();
    /** `App`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class App extends React.Component {
      /** `App.state`：记录测试夹具在当前场景中的状态。 */
      state = {
        suspend: false,
      };
      /** `App.handleClick`：封装当前用例复用的操作、回调或断言步骤。 */
      handleClick = () => {
        this.setState({suspend: true});
      };
      /** `App.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <React.Suspense fallback="Loading">
            <Child id="first" />
            <button ref={buttonRef} onClick={this.handleClick}>
              Suspend
            </button>
            <Child id="second" />
            {this.state.suspend && <Lazy />}
          </React.Suspense>
        );
      }
    }

    ReactDOM.render(<App />, container);

    expect(log).toEqual(['cDM first', 'cDM second']);
    log.length = 0;

    buttonRef.current.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    await Lazy;
    expect(log).toEqual(['cDU first', 'cDU second']);
  });

  // 针对 https://github.com/facebook/react/issues/14188 的回归测试。
  /** 测试场景：验证「can call legacy findDOMNode() in a suspended component commit phase (#2)」描述的渲染、交互或错误处理结果。 */
  it('can call legacy findDOMNode() in a suspended component commit phase (#2)', async () => {
    let suspendOnce = Promise.resolve();
    /** `Suspend`：封装当前用例复用的操作、回调或断言步骤。 */
    function Suspend() {
      if (suspendOnce) {
        const promise = suspendOnce;
        suspendOnce = null;
        throw promise;
      }
      return null;
    }

    const log = [];
    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push('cDM');
        findDOMNode(this);
      }

      /** `Child.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        log.push('cDU');
        findDOMNode(this);
      }

      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Suspense fallback="Loading">
          <Suspend />
          <Child />
        </Suspense>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App />);
    });

    expect(log).toEqual(['cDM']);
    await act(() => {
      root.render(<App />);
    });

    expect(log).toEqual(['cDM', 'cDU']);
  });
});
