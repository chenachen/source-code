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
  /** 每例创建独立JSDOM文档并同步window/document/navigator/Event全局，保证Document根的节点与事件来自同一浏览器环境。 */
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
      /** enableFragmentRefs开启，以Document根渲染Fragment包html/body/a，先focus a再fragment.blur；activeElement回到body，验证单例遍历能释放片段内焦点；本例标题称throws但实际断言正常blur结果。 */
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
          // 先让片段内链接获得焦点，blur后应回到文档默认的body活动元素。
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
      /** Document根的body含空Fragment，给Fragment/body各加custom listener后dispatchEvent(bubbles=true)；两者各调用一次，验证无宿主子级时临时目标附到最近body父级并冒泡。 */
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
      /** Fragment在html单例上方并包body/div，添加click listener再由div冒泡；currentTarget只为documentElement，验证监听挂到片段直接宿主单例而不铺到内部所有节点。 */
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
      /** Fragment初始无html，先加listener再showShell=true插入单例子树；div click的currentTarget仍只html一次，验证后插入直接单例接收既有监听且内容不重复附加。 */
      it('attaches listeners to a singleton mounted into the fragment, but not to its content', async () => {
        const fragmentRef = React.createRef();
        const childRef = React.createRef();
        const root = ReactDOMClient.createRoot(document);

        /** showShell=false时仅有空Fragment，true时插入html/body/div单例子树，验证注册监听后新增单例的归属。 */
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
      /** 外Fragment位于html上方、内Fragment位于body下，先注册两者listener再插入span；span click使内currentTarget为span、外为html各一次，验证新增节点归最近单例下方Fragment且祖先靠冒泡接收。 */
      it('attributes new children inside a singleton to fragments below it, not above it', async () => {
        const outerFragmentRef = React.createRef();
        const innerFragmentRef = React.createRef();
        const lateChildRef = React.createRef();
        const root = ReactDOMClient.createRoot(document);

        /** 保持外Fragment/html/body/内Fragment结构，仅showLateChild控制span插入，让监听归属可在单例边界两侧比较。 */
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
        // 子节点不会另挂外层监听器；外层在html上仅通过冒泡接收一次。
        expect(innerCurrentTargets).toEqual([lateChildRef.current]);
        expect(outerCurrentTargets).toEqual([document.documentElement]);
      });
    });
  });

  describe('getClientRects()', () => {
    // @gate enableFragmentRefs
    /** Fragment包html/body/div，为div和html的getClientRects设不同桩值；片段只返回html-rect，验证测量其直接宿主单例而不深入其内容。 */
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
