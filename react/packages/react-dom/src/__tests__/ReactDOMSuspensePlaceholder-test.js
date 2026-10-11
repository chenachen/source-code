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

  /** 缓存未读key时直接存resolved记录；已有pending则先改状态/值再同步触发所有ping，让重试读到已完成状态，不清空回调数组。 */
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

  /** 按文本key读缓存：resolved返回文字、rejected抛原因、pending记录Suspend并抛同thenable；初读创建含pings的pending记录后抛出。 */
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

        /** pending时收集ping；已完成时用Promise微任务通知记录值，使晚订阅者也能重试。 */
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

  /** 记录同步文字渲染并原样返回text，日志用于区分预热与最终重渲染。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** 先读可能挂起的缓存，只有成功后才记录text并返回文字。 */
  function AsyncText({text}) {
    readText(text);
    Scheduler.log(text);
    return text;
  }

  // @gate !disableLegacyMode

  /** legacy根Suspense含A/B异步/C三个div，C原display:inline；B挂起时全none，resolve后A/B为block、C恢复inline，仅B重渲染日志，验证隐藏保留DOM并恢复prop样式。 */
  it('hides and unhides timed out DOM elements in legacy roots', async () => {
    const divs = [
      React.createRef(null),
      React.createRef(null),
      React.createRef(null),
    ];

    /** 三div在同一legacy Suspense内，B异步、C显式inline，用ref检查隐藏和恢复后的计算样式。 */
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

  /** 并发根Suspense三个文本A/B/C且B待定；先只显示Loading并记录预热尝试，resolve后ABC，验证未完成内容不提前可见且文本揭示完整。 */
  it('hides and unhides timed out text nodes', async () => {

    /** 三个文本共享并发Suspense，B挂起，fallback为可记录的Loading，检查内容揭示及预热日志。 */
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

  /** legacy根已显示fallback，Sibling由display:none更新inline而Async仍挂起；两span继续none，resolve后Sibling inline且Async可见，验证隐藏边界内样式更新后再次隐藏并按最新prop恢复。 */
  it(
    'in legacy roots, re-hides children if their display is updated ' +
      'but the boundary is still showing the fallback',
    async () => {
      const {useState} = React;

      let setIsVisible;

      /** 用本地isVisible控制span的none/inline，并把setState暴露给测试，在隐藏边界内更新style。 */
      function Sibling({children}) {
        const [isVisible, _setIsVisible] = useState(false);
        setIsVisible = _setIsVisible;
        return (
          <span style={{display: isVisible ? 'inline' : 'none'}}>
            {children}
          </span>
        );
      }

      /** Sibling与异步span共用legacy边界，验证尚挂起时覆盖样式更新。 */
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

      // 更新仍隐藏的主内容span，其inline prop会写入DOM后被边界隐藏逻辑再设none。
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

  /** legacy根两个Child生命周期调用findDOMNode，按钮使Lazy首次挂起；初次cDM两次、点击后cDU两次且不崩溃，验证挂起提交期间宿主查找。本例await Lazy对象不是等待其Promise本体。 */
  it('can call findDOMNode() in a suspended component commit phase in legacy roots', async () => {
    const log = [];
    const Lazy = React.lazy(
      () =>
        new Promise(resolve =>
          resolve({

            /** Lazy Promise成功后使用的默认组件，返回lazy文本。 */
            default() {
              return 'lazy';
            },
          }),
        ),
    );

    /** 两个宿主文字Child在legacy边界内，生命周期调用findDOMNode并按id记录先后。 */
    class Child extends React.Component {

      /** 挂载记录cDM和id，然后执行宿主查找，验证正常提交查找。 */
      componentDidMount() {
        log.push('cDM ' + this.props.id);
        findDOMNode(this);
      }

      /** 更新记录cDU和id，然后在挂起相关提交中执行宿主查找。 */
      componentDidUpdate() {
        log.push('cDU ' + this.props.id);
        findDOMNode(this);
      }

      /** 返回child文字，令findDOMNode可解析到HostText。 */
      render() {
        return 'child';
      }
    }

    const buttonRef = React.createRef();

    /** 按钮更新suspend后加入Lazy，其余Child保持原类型和位置。 */
    class App extends React.Component {

      /** 初始不渲染Lazy，首次点击才使边界挂起。 */
      state = {
        suspend: false,
      };

      /** 设suspend=true，把懒组件加入已有内容的更新。 */
      handleClick = () => {
        this.setState({suspend: true});
      };

      /** 输出两个Child、按钮及条件Lazy，保留前后Child用于更新生命周期断言。 */
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

  /** 并发根Suspend仅首次抛已解决Promise、Child渲染null；act完成后cDM，再重渲染cDU，两次findDOMNode均不崩溃，验证无宿主子级且经历挂起的提交查找。 */
  it('can call legacy findDOMNode() in a suspended component commit phase (#2)', async () => {
    let suspendOnce = Promise.resolve();

    /** 第一次取走已解决Promise并抛出；随后返回null，构造仅一次挂起且可立刻重试的输入。 */
    function Suspend() {
      if (suspendOnce) {
        const promise = suspendOnce;
        suspendOnce = null;
        throw promise;
      }
      return null;
    }

    const log = [];

    /** 没有宿主输出的Child，生命周期仍调用内部findDOMNode。 */
    class Child extends React.Component {

      /** 记录cDM再查找宿主，空渲染应安全返回。 */
      componentDidMount() {
        log.push('cDM');
        findDOMNode(this);
      }

      /** 记录cDU再查找宿主，验证重试后更新仍安全。 */
      componentDidUpdate() {
        log.push('cDU');
        findDOMNode(this);
      }

      /** 返回null，使查找路径必须处理无HostComponent/HostText。 */
      render() {
        return null;
      }
    }

    /** 把一次挂起fixture和空Child放到并发Suspense，act内完成重试后检查生命周期。 */
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
