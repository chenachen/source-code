/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails reactcore
 * @jest-environment node
 */

'use strict';

let JSDOM;
let React;
let ReactDOMClient;
let act;
let document;
let Fragment;

describe('FragmentRefs', () => {
  beforeEach(() => {
    jest.resetModules();
    JSDOM = require('jsdom');
    React = require('react');
    Fragment = React.Fragment;
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;

    const jsdom = new JSDOM.JSDOM('');
    document = jsdom.window.document;
    global.window = jsdom.window;
    global.document = global.window.document;
    global.navigator = global.window.navigator;
    global.Event = global.window.Event;
  });

  describe('focus methods', () => {
    describe('blur()', () => {
      // @gate enableFragmentRefs
      /**
       * 代表场景（Given–When–Then）：
       * Given 当前文件已建立所需 DOM、React 根与测试夹具；
       * When 执行「throws when the nearest host parent is a Document container」描述的渲染或交互；
       * Then 通过本用例的 DOM、日志或调度断言确认行为。
       *
       * 验证机制：断言连接 reconciler Fragment ref 与 DOM 宿主实例查询路径。
       */
      it('throws when the nearest host parent is a Document container', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(document);

        await act(() => {
          root.render(
            <Fragment ref={fragmentRef}>
              <html>
                <body>
                  <a id="child-a" href="/">
                    A
                  </a>
                </body>
              </html>
            </Fragment>,
          );
        });

        await act(() => {
          // 会停止在 <body> 处。 这通常是一个片段的子元素，并且通常是 activeElement。
          document.getElementById('child-a').focus();
        });
        expect(document.activeElement.id).toEqual('child-a');

        await act(() => {
          fragmentRef.current.blur();
        });
        expect(document.activeElement).toEqual(document.body);
      });
    });
  });

  describe('events', () => {
    describe('dispatchEvent()', () => {
      // @gate enableFragmentRefs
      /** 测试场景：验证「fires events when the fragment is a child of a HostSingleton in a document root」描述的渲染、交互或错误处理结果。 */
      it('fires events when the fragment is a child of a HostSingleton in a document root', async () => {
        const fragmentRef = React.createRef();
        const bodyRef = React.createRef();
        const root = ReactDOMClient.createRoot(document);

        await act(() => {
          root.render(
            <html>
              <body ref={bodyRef}>
                <Fragment ref={fragmentRef} />
              </body>
            </html>,
          );
        });

        const fragmentListener = jest.fn();
        fragmentRef.current.addEventListener('custom', fragmentListener);
        const bodyListener = jest.fn();
        bodyRef.current.addEventListener('custom', bodyListener);

        // <body> 是片段的宿主父元素。 因此，临时事件目标被附加在那里。
        fragmentRef.current.dispatchEvent(new Event('custom', {bubbles: true}));

        expect(fragmentListener).toHaveBeenCalledTimes(1);
        expect(bodyListener).toHaveBeenCalledTimes(1);
      });
    });

    describe('addEventListener()', () => {
      // @gate enableFragmentRefs
      /** 测试场景：验证「attaches listeners to the host children inside singletons」描述的渲染、交互或错误处理结果。 */
      it('attaches listeners to the host children inside singletons', async () => {
        const fragmentRef = React.createRef();
        const childRef = React.createRef();
        const root = ReactDOMClient.createRoot(document);

        await act(() => {
          root.render(
            <Fragment ref={fragmentRef}>
              <html>
                <body>
                  <div ref={childRef} id="child" />
                </body>
              </html>
            </Fragment>,
          );
        });

        const currentTargets = [];
        fragmentRef.current.addEventListener('click', event => {
          currentTargets.push(event.currentTarget);
        });

        childRef.current.dispatchEvent(new Event('click', {bubbles: true}));

        // <html> 单例是 Fragment 的子节点，因此监听器挂在它上面并接收冒泡事件。
        expect(currentTargets).toEqual([document.documentElement]);
      });

      // @gate enableFragmentRefs
      /** 测试场景：验证「attaches listeners to a singleton mounted into the fragment, but not to its content」描述的渲染、交互或错误处理结果。 */
      it('attaches listeners to a singleton mounted into the fragment, but not to its content', async () => {
        const fragmentRef = React.createRef();
        const childRef = React.createRef();
        const root = ReactDOMClient.createRoot(document);

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test({showShell}) {
          return (
            <Fragment ref={fragmentRef}>
              {showShell && (
                <html>
                  <body>
                    <div ref={childRef} id="child" />
                  </body>
                </html>
              )}
            </Fragment>
          );
        }

        await act(() => {
          root.render(<Test showShell={false} />);
        });

        const currentTargets = [];
        fragmentRef.current.addEventListener('click', event => {
          currentTargets.push(event.currentTarget);
        });

        await act(() => {
          root.render(<Test showShell={true} />);
        });

        childRef.current.dispatchEvent(new Event('click', {bubbles: true}));

        // 放置后的 <html> 单例作为新子节点接收 Fragment 监听器；其内容不归属该 Fragment，因此事件冒泡
        // 到 <html> 时只触发一次。
        expect(currentTargets).toEqual([document.documentElement]);
      });

      // @gate enableFragmentRefs
      /** 测试场景：验证「attributes new children inside a singleton to fragments below it, not above it」描述的渲染、交互或错误处理结果。 */
      it('attributes new children inside a singleton to fragments below it, not above it', async () => {
        const outerFragmentRef = React.createRef();
        const innerFragmentRef = React.createRef();
        const lateChildRef = React.createRef();
        const root = ReactDOMClient.createRoot(document);

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test({showLateChild}) {
          return (
            <Fragment ref={outerFragmentRef}>
              <html>
                <body>
                  <Fragment ref={innerFragmentRef}>
                    <div id="child" />
                    {showLateChild && <span ref={lateChildRef} id="late" />}
                  </Fragment>
                </body>
              </html>
            </Fragment>
          );
        }

        await act(() => {
          root.render(<Test showLateChild={false} />);
        });

        const outerCurrentTargets = [];
        outerFragmentRef.current.addEventListener('click', event => {
          outerCurrentTargets.push(event.currentTarget);
        });
        const innerCurrentTargets = [];
        innerFragmentRef.current.addEventListener('click', event => {
          innerCurrentTargets.push(event.currentTarget);
        });

        await act(() => {
          root.render(<Test showLateChild={true} />);
        });

        lateChildRef.current.dispatchEvent(new Event('click', {bubbles: true}));

        // 内层片段直接拥有新子节点，并在插入时附加其监听器。 外层片段的子元素是 <html> 单例。 因此，新
        // 子组件不会被 <body> 绑定，其监听器只会通过冒泡机制触发一次。
        expect(innerCurrentTargets).toEqual([lateChildRef.current]);
        expect(outerCurrentTargets).toEqual([document.documentElement]);
      });
    });
  });

  describe('getClientRects()', () => {
    // @gate enableFragmentRefs
    /** 测试场景：验证「measures the host children inside singletons」描述的渲染、交互或错误处理结果。 */
    it('measures the host children inside singletons', async () => {
      const fragmentRef = React.createRef();
      const childRef = React.createRef();
      const root = ReactDOMClient.createRoot(document);

      await act(() => {
        root.render(
          <Fragment ref={fragmentRef}>
            <html>
              <body>
                <div ref={childRef} id="child" />
              </body>
            </html>
          </Fragment>,
        );
      });

      childRef.current.getClientRects = jest.fn(() => ['child-rect']);
      document.documentElement.getClientRects = jest.fn(() => ['html-rect']);

      // <html> 单例是 Fragment 的子节点，因此测量它，而不是测量其中的元素。
      expect(fragmentRef.current.getClientRects()).toEqual(['html-rect']);
    });
  });
});
