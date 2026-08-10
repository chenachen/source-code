/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

import {createEventTarget} from 'dom-event-testing-library';

let React;
let ReactFeatureFlags;
let ReactDOM;
let ReactDOMClient;
let ReactDOMServer;
let Scheduler;
let act;
let waitForAll;
let waitFor;

/** `dispatchEvent`：封装当前用例复用的操作、回调或断言步骤。 */
function dispatchEvent(element, type) {
  const event = document.createEvent('Event');
  event.initEvent(type, true, true);
  element.dispatchEvent(event);
}

/** `dispatchClickEvent`：封装当前用例复用的操作、回调或断言步骤。 */
function dispatchClickEvent(element) {
  dispatchEvent(element, 'click');
}

/** `eventListenersToClear`：保存当前测试场景复用的夹具、状态或回调。 */
const eventListenersToClear = [];

/** `startNativeEventListenerClearDown`：封装当前用例复用的操作、回调或断言步骤。 */
function startNativeEventListenerClearDown() {
  const nativeWindowEventListener = window.addEventListener;
  window.addEventListener = function (...params) {
    eventListenersToClear.push({target: window, params});
    return nativeWindowEventListener.apply(this, params);
  };
  const nativeDocumentEventListener = document.addEventListener;
  document.addEventListener = function (...params) {
    eventListenersToClear.push({target: document, params});
    return nativeDocumentEventListener.apply(this, params);
  };
}

/** `endNativeEventListenerClearDown`：封装当前用例复用的操作、回调或断言步骤。 */
function endNativeEventListenerClearDown() {
  eventListenersToClear.forEach(({target, params}) => {
    target.removeEventListener(...params);
  });
}

describe('DOMPluginEventSystem', () => {
  let container;

  /** `withEnableLegacyFBSupport`：封装当前用例复用的操作、回调或断言步骤。 */
  function withEnableLegacyFBSupport(enableLegacyFBSupport) {
    describe(
      'enableLegacyFBSupport ' +
        (enableLegacyFBSupport ? 'enabled' : 'disabled'),
      () => {
        beforeAll(() => {
      // 这些测试会运行两次：一次启用 legacyFBSupport，一次禁用。第二轮开始前必须清理 document，
      // 否则测试会在非干净环境中运行。
          document.removeChild(document.documentElement);
          document.appendChild(document.createElement('html'));
          document.documentElement.appendChild(document.createElement('head'));
          document.documentElement.appendChild(document.createElement('body'));
        });

        beforeEach(() => {
          jest.resetModules();
          ReactFeatureFlags = require('shared/ReactFeatureFlags');
          ReactFeatureFlags.enableLegacyFBSupport = enableLegacyFBSupport;

          React = require('react');
          ReactDOM = require('react-dom');
          ReactDOMClient = require('react-dom/client');
          Scheduler = require('scheduler');
          ReactDOMServer = require('react-dom/server');

          const InternalTestUtils = require('internal-test-utils');
          waitForAll = InternalTestUtils.waitForAll;
          waitFor = InternalTestUtils.waitFor;
          act = InternalTestUtils.act;

          container = document.createElement('div');
          document.body.appendChild(container);
          startNativeEventListenerClearDown();
        });

        afterEach(() => {
          document.body.removeChild(container);
          container = null;
          endNativeEventListenerClearDown();
        });

        /**
         * 代表场景（Given–When–Then）：
         * Given 当前文件已建立所需 DOM、React 根与测试夹具；
         * When 执行「does not pool events」描述的渲染或交互；
         * Then 通过本用例的 DOM、日志或调度断言确认行为。
         *
         * 验证机制：事件断言连接 DOMPluginEventSystem 的委托、合成与传播路径。
         */
        it('does not pool events', async () => {
          const buttonRef = React.createRef();
          const log = [];
          const onClick = jest.fn(e => log.push(e));

          /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
          function Test() {
            return <button ref={buttonRef} onClick={onClick} />;
          }

          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(<Test />);
          });

          const buttonElement = buttonRef.current;
          dispatchClickEvent(buttonElement);
          expect(onClick).toHaveBeenCalledTimes(1);
          dispatchClickEvent(buttonElement);
          expect(onClick).toHaveBeenCalledTimes(2);
          expect(log[0]).not.toBe(log[1]);
          expect(log[0].type).toBe('click');
          expect(log[1].type).toBe('click');
        });

        /** 测试场景：验证「handle propagation of click events」描述的渲染、交互或错误处理结果。 */
        it('handle propagation of click events', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const log = [];
          const onClick = jest.fn(e => log.push(['bubble', e.currentTarget]));
          const onClickCapture = jest.fn(e =>
            log.push(['capture', e.currentTarget]),
          );

          /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
          function Test() {
            return (
              <button
                ref={buttonRef}
                onClick={onClick}
                onClickCapture={onClickCapture}>
                <div
                  ref={divRef}
                  onClick={onClick}
                  onClickCapture={onClickCapture}>
                  Click me!
                </div>
              </button>
            );
          }

          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(<Test />);
          });

          const buttonElement = buttonRef.current;
          dispatchClickEvent(buttonElement);

          expect(onClick).toHaveBeenCalledTimes(1);
          expect(onClickCapture).toHaveBeenCalledTimes(1);
          expect(log[0]).toEqual(['capture', buttonElement]);
          expect(log[1]).toEqual(['bubble', buttonElement]);

          const divElement = divRef.current;
          dispatchClickEvent(divElement);
          expect(onClick).toHaveBeenCalledTimes(3);
          expect(onClickCapture).toHaveBeenCalledTimes(3);
          expect(log[2]).toEqual(['capture', buttonElement]);
          expect(log[3]).toEqual(['capture', divElement]);
          expect(log[4]).toEqual(['bubble', divElement]);
          expect(log[5]).toEqual(['bubble', buttonElement]);
        });

        /** 测试场景：验证「handle propagation of click events combined with sync clicks」描述的渲染、交互或错误处理结果。 */
        it('handle propagation of click events combined with sync clicks', async () => {
          const buttonRef = React.createRef();
          let clicks = 0;

          /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
          function Test() {
            const inputRef = React.useRef(null);
            return (
              <div>
                <button
                  ref={buttonRef}
                  onClick={() => {
                    // 同步点击
                    inputRef.current.click();
                  }}
                />
                <input
                  ref={inputRef}
                  onClick={() => {
                    clicks++;
                  }}
                />
              </div>
            );
          }

          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(<Test />);
          });

          const buttonElement = buttonRef.current;
          dispatchClickEvent(buttonElement);

          expect(clicks).toBe(1);
        });

        /** 测试场景：验证「handle propagation of click events between roots」描述的渲染、交互或错误处理结果。 */
        it('handle propagation of click events between roots', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const childRef = React.createRef();
          const log = [];
          const onClick = jest.fn(e => log.push(['bubble', e.currentTarget]));
          const onClickCapture = jest.fn(e =>
            log.push(['capture', e.currentTarget]),
          );

          /** `withEnableLegacyFBSupport.Child`：封装当前用例复用的操作、回调或断言步骤。 */
          function Child() {
            return (
              <div
                ref={divRef}
                onClick={onClick}
                onClickCapture={onClickCapture}>
                Click me!
              </div>
            );
          }

          /** `withEnableLegacyFBSupport.Parent`：封装当前用例复用的操作、回调或断言步骤。 */
          function Parent() {
            return (
              <button
                ref={buttonRef}
                onClick={onClick}
                onClickCapture={onClickCapture}>
                <div ref={childRef} />
              </button>
            );
          }

          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(<Parent />);
          });
          const childRoot = ReactDOMClient.createRoot(childRef.current);
          await act(() => {
            childRoot.render(<Child />);
          });

          const buttonElement = buttonRef.current;
          dispatchClickEvent(buttonElement);
          expect(onClick).toHaveBeenCalledTimes(1);
          expect(onClickCapture).toHaveBeenCalledTimes(1);
          expect(log[0]).toEqual(['capture', buttonElement]);
          expect(log[1]).toEqual(['bubble', buttonElement]);

          const divElement = divRef.current;
          dispatchClickEvent(divElement);
          expect(onClick).toHaveBeenCalledTimes(3);
          expect(onClickCapture).toHaveBeenCalledTimes(3);
          expect(log[2]).toEqual(['capture', buttonElement]);
          expect(log[3]).toEqual(['capture', divElement]);
          expect(log[4]).toEqual(['bubble', divElement]);
          expect(log[5]).toEqual(['bubble', buttonElement]);
        });

        /** 测试场景：验证「handle propagation of click events between disjointed roots」描述的渲染、交互或错误处理结果。 */
        it('handle propagation of click events between disjointed roots', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const log = [];
          const onClick = jest.fn(e => log.push(['bubble', e.currentTarget]));
          const onClickCapture = jest.fn(e =>
            log.push(['capture', e.currentTarget]),
          );

          /** `withEnableLegacyFBSupport.Child`：封装当前用例复用的操作、回调或断言步骤。 */
          function Child() {
            return (
              <div
                ref={divRef}
                onClick={onClick}
                onClickCapture={onClickCapture}>
                Click me!
              </div>
            );
          }

          /** `withEnableLegacyFBSupport.Parent`：封装当前用例复用的操作、回调或断言步骤。 */
          function Parent() {
            return (
              <button
                ref={buttonRef}
                onClick={onClick}
                onClickCapture={onClickCapture}
              />
            );
          }

          const disjointedNode = document.createElement('div');
          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(<Parent />);
          });

          buttonRef.current.appendChild(disjointedNode);
          const disjointedNodeRoot = ReactDOMClient.createRoot(disjointedNode);
          await act(() => {
            disjointedNodeRoot.render(<Child />);
          });

          const buttonElement = buttonRef.current;
          dispatchClickEvent(buttonElement);
          expect(onClick).toHaveBeenCalledTimes(1);
          expect(onClickCapture).toHaveBeenCalledTimes(1);
          expect(log[0]).toEqual(['capture', buttonElement]);
          expect(log[1]).toEqual(['bubble', buttonElement]);

          const divElement = divRef.current;
          dispatchClickEvent(divElement);
          expect(onClick).toHaveBeenCalledTimes(3);
          expect(onClickCapture).toHaveBeenCalledTimes(3);
          expect(log[2]).toEqual(['capture', buttonElement]);
          expect(log[3]).toEqual(['capture', divElement]);
          expect(log[4]).toEqual(['bubble', divElement]);
          expect(log[5]).toEqual(['bubble', buttonElement]);
        });

        /** 测试场景：验证「handle propagation of click events between disjointed roots #2」描述的渲染、交互或错误处理结果。 */
        it('handle propagation of click events between disjointed roots #2', async () => {
          const buttonRef = React.createRef();
          const button2Ref = React.createRef();
          const divRef = React.createRef();
          const spanRef = React.createRef();
          const log = [];
          const onClick = jest.fn(e => log.push(['bubble', e.currentTarget]));
          const onClickCapture = jest.fn(e =>
            log.push(['capture', e.currentTarget]),
          );

          /** `withEnableLegacyFBSupport.Child`：封装当前用例复用的操作、回调或断言步骤。 */
          function Child() {
            return (
              <div
                ref={divRef}
                onClick={onClick}
                onClickCapture={onClickCapture}>
                Click me!
              </div>
            );
          }

          /** `withEnableLegacyFBSupport.Parent`：封装当前用例复用的操作、回调或断言步骤。 */
          function Parent() {
            return (
              <button
                ref={button2Ref}
                onClick={onClick}
                onClickCapture={onClickCapture}
              />
            );
          }

          /** `withEnableLegacyFBSupport.GrandParent`：封装当前用例复用的操作、回调或断言步骤。 */
          function GrandParent() {
            return (
              <button
                ref={buttonRef}
                onClick={onClick}
                onClickCapture={onClickCapture}>
                <span ref={spanRef} />
              </button>
            );
          }

          // 创建一个带内部渲染容器的包装节点，结构类似 <div><span></span></div>。
          // 随后分别渲染到三个容器：
          // - container
          // - parentContainer
          // - childContainer

          const parentContainer = document.createElement('div');
          const childContainer = document.createElement('div');

          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(<GrandParent />);
          });
          const parentRoot = ReactDOMClient.createRoot(parentContainer);
          await act(() => {
            parentRoot.render(<Parent />);
          });
          const childRoot = ReactDOMClient.createRoot(childContainer);
          await act(() => {
            childRoot.render(<Child />);
          });

          parentContainer.appendChild(childContainer);
          spanRef.current.appendChild(parentContainer);

          // 位于 <GrandParent /> 内。
          const buttonElement = buttonRef.current;
          dispatchClickEvent(buttonElement);
          expect(onClick).toHaveBeenCalledTimes(1);
          expect(onClickCapture).toHaveBeenCalledTimes(1);
          expect(log[0]).toEqual(['capture', buttonElement]);
          expect(log[1]).toEqual(['bubble', buttonElement]);

          // 位于 <Child /> 内。
          const divElement = divRef.current;
          dispatchClickEvent(divElement);
          expect(onClick).toHaveBeenCalledTimes(3);
          expect(onClickCapture).toHaveBeenCalledTimes(3);
          expect(log[2]).toEqual(['capture', buttonElement]);
          expect(log[3]).toEqual(['capture', divElement]);
          expect(log[4]).toEqual(['bubble', divElement]);
          expect(log[5]).toEqual(['bubble', buttonElement]);

          // 位于 <Parent /> 内。
          const buttonElement2 = button2Ref.current;
          dispatchClickEvent(buttonElement2);
          expect(onClick).toHaveBeenCalledTimes(5);
          expect(onClickCapture).toHaveBeenCalledTimes(5);
          expect(log[6]).toEqual(['capture', buttonElement]);
          expect(log[7]).toEqual(['capture', buttonElement2]);
          expect(log[8]).toEqual(['bubble', buttonElement2]);
          expect(log[9]).toEqual(['bubble', buttonElement]);
        });

        // @gate !disableCommentsAsDOMContainers
        /** 测试场景：验证「handle propagation of click events between disjointed comment roots」描述的渲染、交互或错误处理结果。 */
        it('handle propagation of click events between disjointed comment roots', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const log = [];
          const onClick = jest.fn(e => log.push(['bubble', e.currentTarget]));
          const onClickCapture = jest.fn(e =>
            log.push(['capture', e.currentTarget]),
          );

          /** `withEnableLegacyFBSupport.Child`：封装当前用例复用的操作、回调或断言步骤。 */
          function Child() {
            return (
              <div
                ref={divRef}
                onClick={onClick}
                onClickCapture={onClickCapture}>
                Click me!
              </div>
            );
          }

          /** `withEnableLegacyFBSupport.Parent`：封装当前用例复用的操作、回调或断言步骤。 */
          function Parent() {
            return (
              <button
                ref={buttonRef}
                onClick={onClick}
                onClickCapture={onClickCapture}
              />
            );
          }

          // 这里使用注释节点作为根容器，并将子树挂载到该节点。
          const disjointedNode = document.createComment(
            ' react-mount-point-unstable ',
          );
          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(<Parent />);
          });
          buttonRef.current.appendChild(disjointedNode);
          const disjointedNodeRoot = ReactDOMClient.createRoot(disjointedNode);
          await act(() => {
            disjointedNodeRoot.render(<Child />);
          });

          const buttonElement = buttonRef.current;
          await act(() => {
            dispatchClickEvent(buttonElement);
          });
          expect(onClick).toHaveBeenCalledTimes(1);
          expect(onClickCapture).toHaveBeenCalledTimes(1);
          expect(log[0]).toEqual(['capture', buttonElement]);
          expect(log[1]).toEqual(['bubble', buttonElement]);

          const divElement = divRef.current;
          await act(() => {
            dispatchClickEvent(divElement);
          });
          expect(onClick).toHaveBeenCalledTimes(3);
          expect(onClickCapture).toHaveBeenCalledTimes(3);
          expect(log[2]).toEqual(['capture', buttonElement]);
          expect(log[3]).toEqual(['capture', divElement]);
          expect(log[4]).toEqual(['bubble', divElement]);
          expect(log[5]).toEqual(['bubble', buttonElement]);
        });

        // @gate !disableCommentsAsDOMContainers
        /** 测试场景：验证「handle propagation of click events between disjointed comment roots #2」描述的渲染、交互或错误处理结果。 */
        it('handle propagation of click events between disjointed comment roots #2', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const spanRef = React.createRef();
          const log = [];
          const onClick = jest.fn(e => log.push(['bubble', e.currentTarget]));
          const onClickCapture = jest.fn(e =>
            log.push(['capture', e.currentTarget]),
          );

          /** `withEnableLegacyFBSupport.Child`：封装当前用例复用的操作、回调或断言步骤。 */
          function Child() {
            return (
              <div
                ref={divRef}
                onClick={onClick}
                onClickCapture={onClickCapture}>
                Click me!
              </div>
            );
          }

          /** `withEnableLegacyFBSupport.Parent`：封装当前用例复用的操作、回调或断言步骤。 */
          function Parent() {
            return (
              <button
                ref={buttonRef}
                onClick={onClick}
                onClickCapture={onClickCapture}>
                <span ref={spanRef} />
              </button>
            );
          }

          // 这里使用注释节点作为根容器，并将子树挂载到该节点。
          const disjointedNode = document.createComment(
            ' react-mount-point-unstable ',
          );
          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(<Parent />);
          });
          spanRef.current.appendChild(disjointedNode);
          const disjointedNodeRoot = ReactDOMClient.createRoot(disjointedNode);
          await act(() => {
            disjointedNodeRoot.render(<Child />);
          });

          const buttonElement = buttonRef.current;
          await act(() => {
            dispatchClickEvent(buttonElement);
          });
          expect(onClick).toHaveBeenCalledTimes(1);
          expect(onClickCapture).toHaveBeenCalledTimes(1);
          expect(log[0]).toEqual(['capture', buttonElement]);
          expect(log[1]).toEqual(['bubble', buttonElement]);

          const divElement = divRef.current;
          await act(() => {
            dispatchClickEvent(divElement);
          });
          expect(onClick).toHaveBeenCalledTimes(3);
          expect(onClickCapture).toHaveBeenCalledTimes(3);
          expect(log[2]).toEqual(['capture', buttonElement]);
          expect(log[3]).toEqual(['capture', divElement]);
          expect(log[4]).toEqual(['bubble', divElement]);
          expect(log[5]).toEqual(['bubble', buttonElement]);
        });

        /** 测试场景：验证「handle propagation of click events between portals」描述的渲染、交互或错误处理结果。 */
        it('handle propagation of click events between portals', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const log = [];
          const onClick = jest.fn(e => log.push(['bubble', e.currentTarget]));
          const onClickCapture = jest.fn(e =>
            log.push(['capture', e.currentTarget]),
          );

          const portalElement = document.createElement('div');
          document.body.appendChild(portalElement);

          /** `withEnableLegacyFBSupport.Child`：封装当前用例复用的操作、回调或断言步骤。 */
          function Child() {
            return (
              <div
                ref={divRef}
                onClick={onClick}
                onClickCapture={onClickCapture}>
                Click me!
              </div>
            );
          }

          /** `withEnableLegacyFBSupport.Parent`：封装当前用例复用的操作、回调或断言步骤。 */
          function Parent() {
            return (
              <button
                ref={buttonRef}
                onClick={onClick}
                onClickCapture={onClickCapture}>
                {ReactDOM.createPortal(<Child />, portalElement)}
              </button>
            );
          }

          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(<Parent />);
          });

          const buttonElement = buttonRef.current;
          dispatchClickEvent(buttonElement);
          expect(onClick).toHaveBeenCalledTimes(1);
          expect(onClickCapture).toHaveBeenCalledTimes(1);
          expect(log[0]).toEqual(['capture', buttonElement]);
          expect(log[1]).toEqual(['bubble', buttonElement]);

          const divElement = divRef.current;
          dispatchClickEvent(divElement);
          expect(onClick).toHaveBeenCalledTimes(3);
          expect(onClickCapture).toHaveBeenCalledTimes(3);
          expect(log[2]).toEqual(['capture', buttonElement]);
          expect(log[3]).toEqual(['capture', divElement]);
          expect(log[4]).toEqual(['bubble', divElement]);
          expect(log[5]).toEqual(['bubble', buttonElement]);

          document.body.removeChild(portalElement);
        });

        /** 测试场景：验证「handle click events on document.body portals」描述的渲染、交互或错误处理结果。 */
        it('handle click events on document.body portals', async () => {
          const log = [];

          /** `withEnableLegacyFBSupport.Child`：封装当前用例复用的操作、回调或断言步骤。 */
          function Child({label}) {
            return <div onClick={() => log.push(label)}>{label}</div>;
          }

          /** `withEnableLegacyFBSupport.Parent`：封装当前用例复用的操作、回调或断言步骤。 */
          function Parent() {
            return (
              <>
                {ReactDOM.createPortal(
                  <Child label={'first'} />,
                  document.body,
                )}
                {ReactDOM.createPortal(
                  <Child label={'second'} />,
                  document.body,
                )}
              </>
            );
          }

          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(<Parent />);
          });

          const second = document.body.lastChild;
          expect(second.textContent).toEqual('second');
          dispatchClickEvent(second);

          expect(log).toEqual(['second']);

          const first = second.previousSibling;
          expect(first.textContent).toEqual('first');
          dispatchClickEvent(first);

          expect(log).toEqual(['second', 'first']);
        });

        /** 测试场景：验证「does not invoke an event on a parent tree when a subtree is dehydrated」描述的渲染、交互或错误处理结果。 */
        it('does not invoke an event on a parent tree when a subtree is dehydrated', async () => {
          let suspend = false;
          let resolve;
          const promise = new Promise(
            resolvePromise => (resolve = resolvePromise),
          );

          let clicks = 0;
          const childSlotRef = React.createRef();

          /** `withEnableLegacyFBSupport.Parent`：封装当前用例复用的操作、回调或断言步骤。 */
          function Parent() {
            return <div onClick={() => clicks++} ref={childSlotRef} />;
          }

          /** `withEnableLegacyFBSupport.Child`：封装当前用例复用的操作、回调或断言步骤。 */
          function Child({text}) {
            if (suspend) {
              throw promise;
            } else {
              return <a>Click me</a>;
            }
          }

          /** `withEnableLegacyFBSupport.App`：封装当前用例复用的操作、回调或断言步骤。 */
          function App() {
            // 根本身就是一个 Suspense 边界。
            return (
              <React.Suspense fallback="Loading...">
                <Child />
              </React.Suspense>
            );
          }

          suspend = false;
          const finalHTML = ReactDOMServer.renderToString(<App />);

          const parentContainer = document.createElement('div');
          const childContainer = document.createElement('div');

          // 我们需要将其放在文档中，因为我们将在此处触发事件。
          document.body.appendChild(parentContainer);

          // 使用另一个 root 作为父级，以检测事件是否会经过 React 事件系统。
          const parentRoot = ReactDOMClient.createRoot(parentContainer);
          await act(() => {
            parentRoot.render(<Parent />);
          });

          childSlotRef.current.appendChild(childContainer);

          childContainer.innerHTML = finalHTML;

          const a = childContainer.getElementsByTagName('a')[0];

          suspend = true;

          // 异步执行 hydration。
          await act(() => {
            ReactDOMClient.hydrateRoot(childContainer, <App />);
          });

          // 此时 Suspense 边界尚未完成 hydration。
          await act(() => {
            a.click();
          });
          expect(clicks).toBe(0);

          // 解析 Promise，让渲染得以完成。
          await act(async () => {
            suspend = false;
            resolve();
            await promise;
          });

          // 此时 hydration 已全部完成。
          expect(clicks).toBe(0);
          document.body.removeChild(parentContainer);
        });

        /** 测试场景：验证「handle click events on dynamic portals」描述的渲染、交互或错误处理结果。 */
        it('handle click events on dynamic portals', async () => {
          const log = [];

          /** `withEnableLegacyFBSupport.Parent`：封装当前用例复用的操作、回调或断言步骤。 */
          function Parent() {
            const ref = React.useRef(null);
            const [portal, setPortal] = React.useState(null);

            React.useEffect(() => {
              setPortal(
                ReactDOM.createPortal(
                  <span onClick={() => log.push('child')} id="child" />,
                  ref.current,
                ),
              );
            }, []);

            return (
              <div ref={ref} onClick={() => log.push('parent')} id="parent">
                {portal}
              </div>
            );
          }

          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(<Parent />);
          });

          const parent = container.lastChild;
          expect(parent.id).toEqual('parent');

          await act(() => {
            dispatchClickEvent(parent);
          });

          expect(log).toEqual(['parent']);

          const child = parent.lastChild;
          expect(child.id).toEqual('child');

          await act(() => {
            dispatchClickEvent(child);
          });

          // 事件冒泡，因此日志同时包含 'child' 和 'parent'。
          expect(log).toEqual(['parent', 'child', 'parent']);
        });

        // 对上一个测试稍作调整，用于捕获遍历路径中的细微差异。
        /** 测试场景：验证「handle click events on dynamic portals #2」描述的渲染、交互或错误处理结果。 */
        it('handle click events on dynamic portals #2', async () => {
          const log = [];

          /** `withEnableLegacyFBSupport.Parent`：封装当前用例复用的操作、回调或断言步骤。 */
          function Parent() {
            const ref = React.useRef(null);
            const [portal, setPortal] = React.useState(null);

            React.useEffect(() => {
              setPortal(
                ReactDOM.createPortal(
                  <span onClick={() => log.push('child')} id="child" />,
                  ref.current,
                ),
              );
            }, []);

            return (
              <div ref={ref} onClick={() => log.push('parent')} id="parent">
                <div>{portal}</div>
              </div>
            );
          }

          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(<Parent />);
          });

          const parent = container.lastChild;
          expect(parent.id).toEqual('parent');

          await act(() => {
            dispatchClickEvent(parent);
          });

          expect(log).toEqual(['parent']);

          const child = parent.lastChild;
          expect(child.id).toEqual('child');

          await act(() => {
            dispatchClickEvent(child);
          });

          // 事件冒泡，因此日志同时包含 'child' 和 'parent'。
          expect(log).toEqual(['parent', 'child', 'parent']);
        });

        /** 测试场景：验证「native stopPropagation on click events between portals」描述的渲染、交互或错误处理结果。 */
        it('native stopPropagation on click events between portals', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const middleDivRef = React.createRef();
          const log = [];
          const onClick = jest.fn(e => log.push(['bubble', e.currentTarget]));
          const onClickCapture = jest.fn(e =>
            log.push(['capture', e.currentTarget]),
          );

          const portalElement = document.createElement('div');
          document.body.appendChild(portalElement);

          /** `withEnableLegacyFBSupport.Child`：封装当前用例复用的操作、回调或断言步骤。 */
          function Child() {
            return (
              <div ref={middleDivRef}>
                <div
                  ref={divRef}
                  onClick={onClick}
                  onClickCapture={onClickCapture}>
                  Click me!
                </div>
              </div>
            );
          }

          /** `withEnableLegacyFBSupport.Parent`：封装当前用例复用的操作、回调或断言步骤。 */
          function Parent() {
            React.useLayoutEffect(() => {
              // 阻止 portalElement 的监听器在冒泡阶段接收到这些事件。
              middleDivRef.current.addEventListener('click', e => {
                e.stopPropagation();
              });
            });

            return (
              <button
                ref={buttonRef}
                onClick={onClick}
                onClickCapture={onClickCapture}>
                {ReactDOM.createPortal(<Child />, portalElement)}
              </button>
            );
          }

          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(<Parent />);
          });

          const buttonElement = buttonRef.current;
          dispatchClickEvent(buttonElement);
          expect(onClick).toHaveBeenCalledTimes(1);
          expect(onClickCapture).toHaveBeenCalledTimes(1);
          expect(log[0]).toEqual(['capture', buttonElement]);
          expect(log[1]).toEqual(['bubble', buttonElement]);

          const divElement = divRef.current;
          dispatchClickEvent(divElement);
          expect(onClick).toHaveBeenCalledTimes(1);
          expect(onClickCapture).toHaveBeenCalledTimes(3);

          document.body.removeChild(portalElement);
        });

        /** 测试场景：验证「handle propagation of focus events」描述的渲染、交互或错误处理结果。 */
        it('handle propagation of focus events', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const log = [];
          const onFocus = jest.fn(e => log.push(['bubble', e.currentTarget]));
          const onFocusCapture = jest.fn(e =>
            log.push(['capture', e.currentTarget]),
          );

          /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
          function Test() {
            return (
              <button
                ref={buttonRef}
                onFocus={onFocus}
                onFocusCapture={onFocusCapture}>
                <div
                  ref={divRef}
                  onFocus={onFocus}
                  onFocusCapture={onFocusCapture}
                  tabIndex={0}>
                  Click me!
                </div>
              </button>
            );
          }

          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(<Test />);
          });

          const buttonElement = buttonRef.current;
          buttonElement.focus();
          expect(onFocus).toHaveBeenCalledTimes(1);
          expect(onFocusCapture).toHaveBeenCalledTimes(1);
          expect(log[0]).toEqual(['capture', buttonElement]);
          expect(log[1]).toEqual(['bubble', buttonElement]);

          const divElement = divRef.current;
          divElement.focus();
          expect(onFocus).toHaveBeenCalledTimes(3);
          expect(onFocusCapture).toHaveBeenCalledTimes(3);
          expect(log[2]).toEqual(['capture', buttonElement]);
          expect(log[3]).toEqual(['capture', divElement]);
          expect(log[4]).toEqual(['bubble', divElement]);
          expect(log[5]).toEqual(['bubble', buttonElement]);
        });

        /** 测试场景：验证「handle propagation of focus events between roots」描述的渲染、交互或错误处理结果。 */
        it('handle propagation of focus events between roots', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const childRef = React.createRef();
          const log = [];
          const onFocus = jest.fn(e => log.push(['bubble', e.currentTarget]));
          const onFocusCapture = jest.fn(e =>
            log.push(['capture', e.currentTarget]),
          );

          /** `withEnableLegacyFBSupport.Child`：封装当前用例复用的操作、回调或断言步骤。 */
          function Child() {
            return (
              <div
                ref={divRef}
                onFocus={onFocus}
                onFocusCapture={onFocusCapture}
                tabIndex={0}>
                Click me!
              </div>
            );
          }

          /** `withEnableLegacyFBSupport.Parent`：封装当前用例复用的操作、回调或断言步骤。 */
          function Parent() {
            return (
              <button
                ref={buttonRef}
                onFocus={onFocus}
                onFocusCapture={onFocusCapture}>
                <div ref={childRef} />
              </button>
            );
          }

          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(<Parent />);
          });
          const childRoot = ReactDOMClient.createRoot(childRef.current);
          await act(() => {
            childRoot.render(<Child />);
          });

          const buttonElement = buttonRef.current;
          buttonElement.focus();
          expect(onFocus).toHaveBeenCalledTimes(1);
          expect(onFocusCapture).toHaveBeenCalledTimes(1);
          expect(log[0]).toEqual(['capture', buttonElement]);
          expect(log[1]).toEqual(['bubble', buttonElement]);

          const divElement = divRef.current;
          divElement.focus();
          expect(onFocus).toHaveBeenCalledTimes(3);
          expect(onFocusCapture).toHaveBeenCalledTimes(3);
          expect(log[2]).toEqual(['capture', buttonElement]);
          expect(log[3]).toEqual(['capture', divElement]);
          expect(log[4]).toEqual(['bubble', divElement]);
          expect(log[5]).toEqual(['bubble', buttonElement]);
        });

        /** 测试场景：验证「handle propagation of focus events between portals」描述的渲染、交互或错误处理结果。 */
        it('handle propagation of focus events between portals', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const log = [];
          const onFocus = jest.fn(e => log.push(['bubble', e.currentTarget]));
          const onFocusCapture = jest.fn(e =>
            log.push(['capture', e.currentTarget]),
          );

          const portalElement = document.createElement('div');
          document.body.appendChild(portalElement);

          /** `withEnableLegacyFBSupport.Child`：封装当前用例复用的操作、回调或断言步骤。 */
          function Child() {
            return (
              <div
                ref={divRef}
                onFocus={onFocus}
                onFocusCapture={onFocusCapture}
                tabIndex={0}>
                Click me!
              </div>
            );
          }

          /** `withEnableLegacyFBSupport.Parent`：封装当前用例复用的操作、回调或断言步骤。 */
          function Parent() {
            return (
              <button
                ref={buttonRef}
                onFocus={onFocus}
                onFocusCapture={onFocusCapture}>
                {ReactDOM.createPortal(<Child />, portalElement)}
              </button>
            );
          }

          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(<Parent />);
          });

          const buttonElement = buttonRef.current;
          buttonElement.focus();
          expect(onFocus).toHaveBeenCalledTimes(1);
          expect(onFocusCapture).toHaveBeenCalledTimes(1);
          expect(log[0]).toEqual(['capture', buttonElement]);
          expect(log[1]).toEqual(['bubble', buttonElement]);

          const divElement = divRef.current;
          divElement.focus();
          expect(onFocus).toHaveBeenCalledTimes(3);
          expect(onFocusCapture).toHaveBeenCalledTimes(3);
          expect(log[2]).toEqual(['capture', buttonElement]);
          expect(log[3]).toEqual(['capture', divElement]);
          expect(log[4]).toEqual(['bubble', divElement]);
          expect(log[5]).toEqual(['bubble', buttonElement]);

          document.body.removeChild(portalElement);
        });

        /** 测试场景：验证「native stopPropagation on focus events between portals」描述的渲染、交互或错误处理结果。 */
        it('native stopPropagation on focus events between portals', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const middleDivRef = React.createRef();
          const log = [];
          const onFocus = jest.fn(e => log.push(['bubble', e.currentTarget]));
          const onFocusCapture = jest.fn(e =>
            log.push(['capture', e.currentTarget]),
          );

          const portalElement = document.createElement('div');
          document.body.appendChild(portalElement);

          /** `withEnableLegacyFBSupport.Child`：封装当前用例复用的操作、回调或断言步骤。 */
          function Child() {
            return (
              <div ref={middleDivRef}>
                <div
                  ref={divRef}
                  onFocus={onFocus}
                  onFocusCapture={onFocusCapture}
                  tabIndex={0}>
                  Click me!
                </div>
              </div>
            );
          }

          /** `withEnableLegacyFBSupport.Parent`：封装当前用例复用的操作、回调或断言步骤。 */
          function Parent() {
            React.useLayoutEffect(() => {
              // 阻止 portalElement 的监听器在冒泡阶段接收到这些事件。
              middleDivRef.current.addEventListener('focusin', e => {
                e.stopPropagation();
              });
            });

            return (
              <button
                ref={buttonRef}
                onFocus={onFocus}
                onFocusCapture={onFocusCapture}>
                {ReactDOM.createPortal(<Child />, portalElement)}
              </button>
            );
          }

          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(<Parent />);
          });

          const buttonElement = buttonRef.current;
          buttonElement.focus();
          expect(onFocus).toHaveBeenCalledTimes(1);
          expect(onFocusCapture).toHaveBeenCalledTimes(1);
          expect(log[0]).toEqual(['capture', buttonElement]);
          expect(log[1]).toEqual(['bubble', buttonElement]);

          const divElement = divRef.current;
          divElement.focus();
          expect(onFocus).toHaveBeenCalledTimes(1);
          expect(onFocusCapture).toHaveBeenCalledTimes(3);

          document.body.removeChild(portalElement);
        });

        /** 测试场景：验证「handle propagation of enter and leave events between portals」描述的渲染、交互或错误处理结果。 */
        it('handle propagation of enter and leave events between portals', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const log = [];
          const onMouseEnter = jest.fn(e => log.push(e.currentTarget));
          const onMouseLeave = jest.fn(e => log.push(e.currentTarget));

          const portalElement = document.createElement('div');
          document.body.appendChild(portalElement);

          /** `withEnableLegacyFBSupport.Child`：封装当前用例复用的操作、回调或断言步骤。 */
          function Child() {
            return (
              <div
                ref={divRef}
                onMouseEnter={onMouseEnter}
                onMouseLeave={onMouseLeave}
              />
            );
          }

          /** `withEnableLegacyFBSupport.Parent`：封装当前用例复用的操作、回调或断言步骤。 */
          function Parent() {
            return (
              <button
                ref={buttonRef}
                onMouseEnter={onMouseEnter}
                onMouseLeave={onMouseLeave}>
                {ReactDOM.createPortal(<Child />, portalElement)}
              </button>
            );
          }

          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(<Parent />);
          });

          const buttonElement = buttonRef.current;
          buttonElement.dispatchEvent(
            new MouseEvent('mouseover', {
              bubbles: true,
              cancelable: true,
              relatedTarget: null,
            }),
          );
          expect(onMouseEnter).toHaveBeenCalledTimes(1);
          expect(onMouseLeave).toHaveBeenCalledTimes(0);
          expect(log[0]).toEqual(buttonElement);

          const divElement = divRef.current;
          buttonElement.dispatchEvent(
            new MouseEvent('mouseout', {
              bubbles: true,
              cancelable: true,
              relatedTarget: divElement,
            }),
          );
          divElement.dispatchEvent(
            new MouseEvent('mouseover', {
              bubbles: true,
              cancelable: true,
              relatedTarget: buttonElement,
            }),
          );
          expect(onMouseEnter).toHaveBeenCalledTimes(2);
          expect(onMouseLeave).toHaveBeenCalledTimes(0);
          expect(log[1]).toEqual(divElement);

          document.body.removeChild(portalElement);
        });

        /** 测试场景：验证「handle propagation of enter and leave events between portals #2」描述的渲染、交互或错误处理结果。 */
        it('handle propagation of enter and leave events between portals #2', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const portalRef = React.createRef();
          const log = [];
          const onMouseEnter = jest.fn(e => log.push(e.currentTarget));
          const onMouseLeave = jest.fn(e => log.push(e.currentTarget));

          /** `withEnableLegacyFBSupport.Child`：封装当前用例复用的操作、回调或断言步骤。 */
          function Child() {
            return (
              <div
                ref={divRef}
                onMouseEnter={onMouseEnter}
                onMouseLeave={onMouseLeave}
              />
            );
          }

          /** `withEnableLegacyFBSupport.Parent`：封装当前用例复用的操作、回调或断言步骤。 */
          function Parent() {
            const [portal, setPortal] = React.useState(null);

            React.useLayoutEffect(() => {
              setPortal(ReactDOM.createPortal(<Child />, portalRef.current));
            }, []);

            return (
              <button
                ref={buttonRef}
                onMouseEnter={onMouseEnter}
                onMouseLeave={onMouseLeave}>
                <div ref={portalRef}>{portal}</div>
              </button>
            );
          }

          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(<Parent />);
          });

          const buttonElement = buttonRef.current;
          buttonElement.dispatchEvent(
            new MouseEvent('mouseover', {
              bubbles: true,
              cancelable: true,
              relatedTarget: null,
            }),
          );
          expect(onMouseEnter).toHaveBeenCalledTimes(1);
          expect(onMouseLeave).toHaveBeenCalledTimes(0);
          expect(log[0]).toEqual(buttonElement);

          const divElement = divRef.current;
          buttonElement.dispatchEvent(
            new MouseEvent('mouseout', {
              bubbles: true,
              cancelable: true,
              relatedTarget: divElement,
            }),
          );
          divElement.dispatchEvent(
            new MouseEvent('mouseover', {
              bubbles: true,
              cancelable: true,
              relatedTarget: buttonElement,
            }),
          );
          expect(onMouseEnter).toHaveBeenCalledTimes(2);
          expect(onMouseLeave).toHaveBeenCalledTimes(0);
          expect(log[1]).toEqual(divElement);
        });

        /**
         * 代表场景（Given–When–Then）：
         * Given 当前文件已建立所需 DOM、React 根与测试夹具；
         * When 执行「should preserve bubble/capture order between roots and nested portals」描述的渲染或交互；
         * Then 通过本用例的 DOM、日志或调度断言确认行为。
         *
         * 验证机制：事件断言连接 DOMPluginEventSystem 的委托、合成与传播路径。
         */
        it('should preserve bubble/capture order between roots and nested portals', async () => {
          const targetRef = React.createRef();
          let log = [];
          const onClickRoot = jest.fn(e => log.push('bubble root'));
          const onClickCaptureRoot = jest.fn(e => log.push('capture root'));
          const onClickPortal = jest.fn(e => log.push('bubble portal'));
          const onClickCapturePortal = jest.fn(e => log.push('capture portal'));

          /** `withEnableLegacyFBSupport.Portal`：封装当前用例复用的操作、回调或断言步骤。 */
          function Portal() {
            return (
              <div
                onClick={onClickPortal}
                onClickCapture={onClickCapturePortal}
                ref={targetRef}>
                Click me!
              </div>
            );
          }

          const portalContainer = document.createElement('div');

          let shouldStopPropagation = false;
          portalContainer.addEventListener(
            'click',
            e => {
              if (shouldStopPropagation) {
                e.stopPropagation();
              }
            },
            false,
          );

          /** `withEnableLegacyFBSupport.Root`：封装当前用例复用的操作、回调或断言步骤。 */
          function Root() {
            const portalTargetRef = React.useRef(null);
            React.useLayoutEffect(() => {
              portalTargetRef.current.appendChild(portalContainer);
            });
            return (
              <div onClick={onClickRoot} onClickCapture={onClickCaptureRoot}>
                <div ref={portalTargetRef} />
                {ReactDOM.createPortal(<Portal />, portalContainer)}
              </div>
            );
          }

          const root = ReactDOMClient.createRoot(container);
          await act(() => {
            root.render(<Root />);
          });

          const divElement = targetRef.current;
          dispatchClickEvent(divElement);
          expect(log).toEqual([
            'capture root',
            'capture portal',
            'bubble portal',
            'bubble root',
          ]);

          log = [];

          shouldStopPropagation = true;
          dispatchClickEvent(divElement);

          if (enableLegacyFBSupport) {
            // legacyFBSupport 不使用 root，而是在 document 上处理点击，因此会呈现此前的行为。
            expect(log).toEqual(['capture root', 'capture portal']);
          } else {
            expect(log).toEqual([
              // 若中间节点不属于 React，root 上的事件理论上不应触发；但当前行为仍会触发。
              'capture root',
              'capture portal',
              'bubble portal',
              'bubble root',
            ]);
          }
        });

        describe('ReactDOM.createEventHandle', () => {
          beforeEach(() => {
            jest.resetModules();
            ReactFeatureFlags = require('shared/ReactFeatureFlags');
            ReactFeatureFlags.enableLegacyFBSupport = enableLegacyFBSupport;
            ReactFeatureFlags.enableCreateEventHandleAPI = true;

            React = require('react');
            ReactDOM = require('react-dom');
            ReactDOMClient = require('react-dom/client');
            Scheduler = require('scheduler');
            ReactDOMServer = require('react-dom/server');
            act = require('internal-test-utils').act;

            const InternalTestUtils = require('internal-test-utils');
            waitForAll = InternalTestUtils.waitForAll;
            waitFor = InternalTestUtils.waitFor;
          });

          // @gate www
          /** 测试场景：验证「can render correctly with the ReactDOMServer」描述的渲染、交互或错误处理结果。 */
          it('can render correctly with the ReactDOMServer', () => {
            const clickEvent = jest.fn();
            const setClick = ReactDOM.unstable_createEventHandle('click');

            /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
            function Test() {
              const divRef = React.useRef(null);

              React.useEffect(() => {
                return setClick(divRef.current, clickEvent);
              });

              return <div ref={divRef}>Hello world</div>;
            }
            const output = ReactDOMServer.renderToString(<Test />);
            expect(output).toBe(`<div>Hello world</div>`);
          });

          // @gate www
          /** 测试场景：验证「can render correctly with the ReactDOMServer hydration」描述的渲染、交互或错误处理结果。 */
          it('can render correctly with the ReactDOMServer hydration', async () => {
            const clickEvent = jest.fn();
            const spanRef = React.createRef();
            const setClick = ReactDOM.unstable_createEventHandle('click');

            /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
            function Test() {
              React.useEffect(() => {
                return setClick(spanRef.current, clickEvent);
              });

              return (
                <div>
                  <span ref={spanRef}>Hello world</span>
                </div>
              );
            }
            const output = ReactDOMServer.renderToString(<Test />);
            expect(output).toBe(`<div><span>Hello world</span></div>`);
            container.innerHTML = output;
            await act(() => {
              ReactDOMClient.hydrateRoot(container, <Test />);
            });
            dispatchClickEvent(spanRef.current);
            expect(clickEvent).toHaveBeenCalledTimes(1);
          });

          // @gate www
          /** 测试场景：验证「should correctly work for a basic "click" listener」描述的渲染、交互或错误处理结果。 */
          it('should correctly work for a basic "click" listener', async () => {
            let log = [];
            const clickEvent = jest.fn(event => {
              log.push({
                eventPhase: event.eventPhase,
                type: event.type,
                currentTarget: event.currentTarget,
                target: event.target,
              });
            });
            const divRef = React.createRef();
            const buttonRef = React.createRef();
            const setClick = ReactDOM.unstable_createEventHandle('click');

            /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
            function Test() {
              React.useEffect(() => {
                return setClick(buttonRef.current, clickEvent);
              });

              return (
                <button ref={buttonRef}>
                  <div ref={divRef}>Click me!</div>
                </button>
              );
            }

            const root = ReactDOMClient.createRoot(container);
            await act(() => {
              root.render(<Test />);
            });

            expect(container.innerHTML).toBe(
              '<button><div>Click me!</div></button>',
            );

            // 点击按钮应触发事件回调。
            let divElement = divRef.current;
            dispatchClickEvent(divElement);
            expect(log).toEqual([
              {
                eventPhase: 3,
                type: 'click',
                currentTarget: buttonRef.current,
                target: divRef.current,
              },
            ]);
            expect(clickEvent).toBeCalledTimes(1);

            // 卸载容器后再点击不应触发回调。
            await act(() => {
              root.render(null);
            });

            dispatchClickEvent(divElement);
            expect(clickEvent).toBeCalledTimes(1);

            // 重新渲染容器后，点击应重新生效。
            await act(() => {
              root.render(<Test />);
            });

            divElement = divRef.current;
            dispatchClickEvent(divElement);
            expect(clickEvent).toBeCalledTimes(2);

            log = [];

            // 直接点击按钮本身也应触发回调。
            const buttonElement = buttonRef.current;
            dispatchClickEvent(buttonElement);
            expect(log).toEqual([
              {
                eventPhase: 3,
                type: 'click',
                currentTarget: buttonRef.current,
                target: buttonRef.current,
              },
            ]);

            const setClick2 = ReactDOM.unstable_createEventHandle('click');

            /** `withEnableLegacyFBSupport.Test2`：封装当前用例复用的操作、回调或断言步骤。 */
            function Test2({clickEvent2}) {
              React.useEffect(() => {
                return setClick2(buttonRef.current, clickEvent2);
              });

              return (
                <button ref={buttonRef}>
                  <div ref={divRef}>Click me!</div>
                </button>
              );
            }

            let clickEvent2 = jest.fn();
            await act(() => {
              root.render(<Test2 clickEvent2={clickEvent2} />);
            });

            divElement = divRef.current;
            dispatchClickEvent(divElement);
            expect(clickEvent2).toBeCalledTimes(1);

            // 换用新的回调函数，以验证监听器更新。
            clickEvent2 = jest.fn();
            await act(() => {
              root.render(<Test2 clickEvent2={clickEvent2} />);
            });

            divElement = divRef.current;
            dispatchClickEvent(divElement);
            expect(clickEvent2).toBeCalledTimes(1);
          });

          // @gate www
          /** 测试场景：验证「should correctly work for setting and clearing a basic "click" listener」描述的渲染、交互或错误处理结果。 */
          it('should correctly work for setting and clearing a basic "click" listener', async () => {
            const clickEvent = jest.fn();
            const divRef = React.createRef();
            const buttonRef = React.createRef();
            const setClick = ReactDOM.unstable_createEventHandle('click');

            /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
            function Test({off}) {
              React.useEffect(() => {
                const clear = setClick(buttonRef.current, clickEvent);
                if (off) {
                  clear();
                }
                return clear;
              });

              return (
                <button ref={buttonRef}>
                  <div ref={divRef}>Click me!</div>
                </button>
              );
            }

            const root = ReactDOMClient.createRoot(container);

            await act(() => {
              root.render(<Test off={false} />);
            });

            let divElement = divRef.current;
            dispatchClickEvent(divElement);
            expect(clickEvent).toBeCalledTimes(1);

            // 清理后监听器应被卸载。
            await act(() => {
              root.render(<Test off={true} />);
            });

            clickEvent.mockClear();

            divElement = divRef.current;
            dispatchClickEvent(divElement);
            expect(clickEvent).toBeCalledTimes(0);
          });

          // @gate www
          /** 测试场景：验证「should handle the target being a text node」描述的渲染、交互或错误处理结果。 */
          it('should handle the target being a text node', async () => {
            const clickEvent = jest.fn();
            const buttonRef = React.createRef();
            const setClick = ReactDOM.unstable_createEventHandle('click');

            /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
            function Test() {
              React.useEffect(() => {
                return setClick(buttonRef.current, clickEvent);
              });

              return <button ref={buttonRef}>Click me!</button>;
            }

            const root = ReactDOMClient.createRoot(container);
            await act(() => {
              root.render(<Test />);
            });

            const textNode = buttonRef.current.firstChild;
            dispatchClickEvent(textNode);
            expect(clickEvent).toBeCalledTimes(1);
          });

          // @gate www
          /** 测试场景：验证「handle propagation of click events」描述的渲染、交互或错误处理结果。 */
          it('handle propagation of click events', async () => {
            const buttonRef = React.createRef();
            const divRef = React.createRef();
            const log = [];
            const onClick = jest.fn(e => log.push(['bubble', e.currentTarget]));
            const onClickCapture = jest.fn(e =>
              log.push(['capture', e.currentTarget]),
            );
            const setClick = ReactDOM.unstable_createEventHandle('click');
            const setCaptureClick = ReactDOM.unstable_createEventHandle(
              'click',
              {
                capture: true,
              },
            );

            /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
            function Test() {
              React.useEffect(() => {
                const clearClick1 = setClick(buttonRef.current, onClick);
                const clearCaptureClick1 = setCaptureClick(
                  buttonRef.current,
                  onClickCapture,
                );
                const clearClick2 = setClick(divRef.current, onClick);
                const clearCaptureClick2 = setCaptureClick(
                  divRef.current,
                  onClickCapture,
                );

                return () => {
                  clearClick1();
                  clearCaptureClick1();
                  clearClick2();
                  clearCaptureClick2();
                };
              });

              return (
                <button ref={buttonRef}>
                  <div ref={divRef}>Click me!</div>
                </button>
              );
            }

            const root = ReactDOMClient.createRoot(container);
            await act(() => {
              root.render(<Test />);
            });

            const buttonElement = buttonRef.current;
            dispatchClickEvent(buttonElement);
            expect(onClick).toHaveBeenCalledTimes(1);
            expect(onClickCapture).toHaveBeenCalledTimes(1);
            expect(log[0]).toEqual(['capture', buttonElement]);
            expect(log[1]).toEqual(['bubble', buttonElement]);

            log.length = 0;
            onClick.mockClear();
            onClickCapture.mockClear();

            const divElement = divRef.current;
            dispatchClickEvent(divElement);
            expect(onClick).toHaveBeenCalledTimes(2);
            expect(onClickCapture).toHaveBeenCalledTimes(2);
            expect(log[0]).toEqual(['capture', buttonElement]);
            expect(log[1]).toEqual(['capture', divElement]);
            expect(log[2]).toEqual(['bubble', divElement]);
            expect(log[3]).toEqual(['bubble', buttonElement]);
          });

          // @gate www
          /** 测试场景：验证「handle propagation of click events mixed with onClick events」描述的渲染、交互或错误处理结果。 */
          it('handle propagation of click events mixed with onClick events', async () => {
            const buttonRef = React.createRef();
            const divRef = React.createRef();
            const log = [];
            const onClick = jest.fn(e => log.push(['bubble', e.currentTarget]));
            const onClickCapture = jest.fn(e =>
              log.push(['capture', e.currentTarget]),
            );
            const setClick = ReactDOM.unstable_createEventHandle('click');
            const setClickCapture = ReactDOM.unstable_createEventHandle(
              'click',
              {
                capture: true,
              },
            );

            /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
            function Test() {
              React.useEffect(() => {
                setClick(buttonRef.current, onClick);
                setClickCapture(buttonRef.current, onClickCapture);

                return () => {
                  setClick();
                  setClickCapture();
                };
              });

              return (
                <button ref={buttonRef}>
                  <div
                    ref={divRef}
                    onClick={onClick}
                    onClickCapture={onClickCapture}>
                    Click me!
                  </div>
                </button>
              );
            }

            const root = ReactDOMClient.createRoot(container);
            await act(() => {
              root.render(<Test />);
            });

            const buttonElement = buttonRef.current;
            dispatchClickEvent(buttonElement);
            expect(onClick).toHaveBeenCalledTimes(1);
            expect(onClickCapture).toHaveBeenCalledTimes(1);
            expect(log[0]).toEqual(['capture', buttonElement]);
            expect(log[1]).toEqual(['bubble', buttonElement]);

            const divElement = divRef.current;
            dispatchClickEvent(divElement);
            expect(onClick).toHaveBeenCalledTimes(3);
            expect(onClickCapture).toHaveBeenCalledTimes(3);
            expect(log[2]).toEqual(['capture', buttonElement]);
            expect(log[3]).toEqual(['capture', divElement]);
            expect(log[4]).toEqual(['bubble', divElement]);
            expect(log[5]).toEqual(['bubble', buttonElement]);
          });

          // @gate www
          /** 测试场景：验证「should correctly work for a basic "click" listener on the outer target」描述的渲染、交互或错误处理结果。 */
          it('should correctly work for a basic "click" listener on the outer target', async () => {
            const log = [];
            const clickEvent = jest.fn(event => {
              log.push({
                eventPhase: event.eventPhase,
                type: event.type,
                currentTarget: event.currentTarget,
                target: event.target,
              });
            });
            const divRef = React.createRef();
            const buttonRef = React.createRef();
            const setClick = ReactDOM.unstable_createEventHandle('click');

            /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
            function Test() {
              React.useEffect(() => {
                return setClick(divRef.current, clickEvent);
              });

              return (
                <button ref={buttonRef}>
                  <div ref={divRef}>Click me!</div>
                </button>
              );
            }

            const root = ReactDOMClient.createRoot(container);
            await act(() => {
              root.render(<Test />);
            });

            expect(container.innerHTML).toBe(
              '<button><div>Click me!</div></button>',
            );

            // 点击按钮应触发事件回调。
            let divElement = divRef.current;
            dispatchClickEvent(divElement);
            expect(log).toEqual([
              {
                eventPhase: 3,
                type: 'click',
                currentTarget: divRef.current,
                target: divRef.current,
              },
            ]);

            // 卸载容器后再点击不应触发回调。
            await act(() => {
              root.render(null);
            });

            dispatchClickEvent(divElement);
            expect(clickEvent).toBeCalledTimes(1);

            // 重新渲染容器后，点击应重新生效。
            await act(() => {
              root.render(<Test />);
            });

            divElement = divRef.current;
            dispatchClickEvent(divElement);
            expect(clickEvent).toBeCalledTimes(2);

            // 点击外层按钮不应触发绑定在内部目标上的回调。
            const buttonElement = buttonRef.current;
            dispatchClickEvent(buttonElement);
            expect(clickEvent).toBeCalledTimes(2);
          });

          // @gate www
          /** 测试场景：验证「should correctly handle many nested target listeners」描述的渲染、交互或错误处理结果。 */
          it('should correctly handle many nested target listeners', async () => {
            const buttonRef = React.createRef();
            const targetListener1 = jest.fn();
            const targetListener2 = jest.fn();
            const targetListener3 = jest.fn();
            const targetListener4 = jest.fn();
            let setClick1 = ReactDOM.unstable_createEventHandle('click', {
              capture: true,
            });
            let setClick2 = ReactDOM.unstable_createEventHandle('click', {
              capture: true,
            });
            let setClick3 = ReactDOM.unstable_createEventHandle('click');
            let setClick4 = ReactDOM.unstable_createEventHandle('click');

            /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
            function Test() {
              React.useEffect(() => {
                const clearClick1 = setClick1(
                  buttonRef.current,
                  targetListener1,
                );
                const clearClick2 = setClick2(
                  buttonRef.current,
                  targetListener2,
                );
                const clearClick3 = setClick3(
                  buttonRef.current,
                  targetListener3,
                );
                const clearClick4 = setClick4(
                  buttonRef.current,
                  targetListener4,
                );

                return () => {
                  clearClick1();
                  clearClick2();
                  clearClick3();
                  clearClick4();
                };
              });

              return <button ref={buttonRef}>Click me!</button>;
            }

            const root = ReactDOMClient.createRoot(container);
            await act(() => {
              root.render(<Test />);
            });

            let buttonElement = buttonRef.current;
            dispatchClickEvent(buttonElement);

            expect(targetListener1).toHaveBeenCalledTimes(1);
            expect(targetListener2).toHaveBeenCalledTimes(1);
            expect(targetListener3).toHaveBeenCalledTimes(1);
            expect(targetListener4).toHaveBeenCalledTimes(1);

            setClick1 = ReactDOM.unstable_createEventHandle('click');
            setClick2 = ReactDOM.unstable_createEventHandle('click');
            setClick3 = ReactDOM.unstable_createEventHandle('click');
            setClick4 = ReactDOM.unstable_createEventHandle('click');

            /** `withEnableLegacyFBSupport.Test2`：封装当前用例复用的操作、回调或断言步骤。 */
            function Test2() {
              React.useEffect(() => {
                const clearClick1 = setClick1(
                  buttonRef.current,
                  targetListener1,
                );
                const clearClick2 = setClick2(
                  buttonRef.current,
                  targetListener2,
                );
                const clearClick3 = setClick3(
                  buttonRef.current,
                  targetListener3,
                );
                const clearClick4 = setClick4(
                  buttonRef.current,
                  targetListener4,
                );

                return () => {
                  clearClick1();
                  clearClick2();
                  clearClick3();
                  clearClick4();
                };
              });

              return <button ref={buttonRef}>Click me!</button>;
            }

            await act(() => {
              root.render(<Test2 />);
            });

            buttonElement = buttonRef.current;
            dispatchClickEvent(buttonElement);
            expect(targetListener1).toHaveBeenCalledTimes(2);
            expect(targetListener2).toHaveBeenCalledTimes(2);
            expect(targetListener3).toHaveBeenCalledTimes(2);
            expect(targetListener4).toHaveBeenCalledTimes(2);
          });

          // @gate www
          /** 测试场景：验证「should correctly handle stopPropagation correctly for target events」描述的渲染、交互或错误处理结果。 */
          it('should correctly handle stopPropagation correctly for target events', async () => {
            const buttonRef = React.createRef();
            const divRef = React.createRef();
            const clickEvent = jest.fn();
            const setClick1 = ReactDOM.unstable_createEventHandle('click', {
              bind: buttonRef,
            });
            const setClick2 = ReactDOM.unstable_createEventHandle('click');

            /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
            function Test() {
              React.useEffect(() => {
                const clearClick1 = setClick1(buttonRef.current, clickEvent);
                const clearClick2 = setClick2(divRef.current, e => {
                  e.stopPropagation();
                });

                return () => {
                  clearClick1();
                  clearClick2();
                };
              });

              return (
                <button ref={buttonRef}>
                  <div ref={divRef}>Click me!</div>
                </button>
              );
            }

            const root = ReactDOMClient.createRoot(container);
            await act(() => {
              root.render(<Test />);
            });

            const divElement = divRef.current;
            dispatchClickEvent(divElement);
            expect(clickEvent).toHaveBeenCalledTimes(0);
          });

          // @gate www
          /** 测试场景：验证「should correctly handle stopPropagation correctly for many target events」描述的渲染、交互或错误处理结果。 */
          it('should correctly handle stopPropagation correctly for many target events', async () => {
            const buttonRef = React.createRef();
            const targetListener1 = jest.fn(e => e.stopPropagation());
            const targetListener2 = jest.fn(e => e.stopPropagation());
            const targetListener3 = jest.fn(e => e.stopPropagation());
            const targetListener4 = jest.fn(e => e.stopPropagation());
            const setClick1 = ReactDOM.unstable_createEventHandle('click');
            const setClick2 = ReactDOM.unstable_createEventHandle('click');
            const setClick3 = ReactDOM.unstable_createEventHandle('click');
            const setClick4 = ReactDOM.unstable_createEventHandle('click');

            /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
            function Test() {
              React.useEffect(() => {
                const clearClick1 = setClick1(
                  buttonRef.current,
                  targetListener1,
                );
                const clearClick2 = setClick2(
                  buttonRef.current,
                  targetListener2,
                );
                const clearClick3 = setClick3(
                  buttonRef.current,
                  targetListener3,
                );
                const clearClick4 = setClick4(
                  buttonRef.current,
                  targetListener4,
                );

                return () => {
                  clearClick1();
                  clearClick2();
                  clearClick3();
                  clearClick4();
                };
              });

              return <button ref={buttonRef}>Click me!</button>;
            }

            const root = ReactDOMClient.createRoot(container);
            await act(() => {
              root.render(<Test />);
            });

            const buttonElement = buttonRef.current;
            dispatchClickEvent(buttonElement);
            expect(targetListener1).toHaveBeenCalledTimes(1);
            expect(targetListener2).toHaveBeenCalledTimes(1);
            expect(targetListener3).toHaveBeenCalledTimes(1);
            expect(targetListener4).toHaveBeenCalledTimes(1);
          });

          // @gate www
          /** 测试场景：验证「should correctly handle stopPropagation for mixed capture/bubbling target listeners」描述的渲染、交互或错误处理结果。 */
          it('should correctly handle stopPropagation for mixed capture/bubbling target listeners', async () => {
            const buttonRef = React.createRef();
            const targetListener1 = jest.fn(e => e.stopPropagation());
            const targetListener2 = jest.fn(e => e.stopPropagation());
            const targetListener3 = jest.fn(e => e.stopPropagation());
            const targetListener4 = jest.fn(e => e.stopPropagation());
            const setClick1 = ReactDOM.unstable_createEventHandle('click', {
              capture: true,
            });
            const setClick2 = ReactDOM.unstable_createEventHandle('click', {
              capture: true,
            });
            const setClick3 = ReactDOM.unstable_createEventHandle('click');
            const setClick4 = ReactDOM.unstable_createEventHandle('click');

            /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
            function Test() {
              React.useEffect(() => {
                const clearClick1 = setClick1(
                  buttonRef.current,
                  targetListener1,
                );
                const clearClick2 = setClick2(
                  buttonRef.current,
                  targetListener2,
                );
                const clearClick3 = setClick3(
                  buttonRef.current,
                  targetListener3,
                );
                const clearClick4 = setClick4(
                  buttonRef.current,
                  targetListener4,
                );

                return () => {
                  clearClick1();
                  clearClick2();
                  clearClick3();
                  clearClick4();
                };
              });

              return <button ref={buttonRef}>Click me!</button>;
            }

            const root = ReactDOMClient.createRoot(container);
            await act(() => {
              root.render(<Test />);
            });

            const buttonElement = buttonRef.current;
            dispatchClickEvent(buttonElement);
            expect(targetListener1).toHaveBeenCalledTimes(1);
            expect(targetListener2).toHaveBeenCalledTimes(1);
            expect(targetListener3).toHaveBeenCalledTimes(0);
            expect(targetListener4).toHaveBeenCalledTimes(0);
          });

          // @gate www
          /** 测试场景：验证「should work with concurrent mode updates」描述的渲染、交互或错误处理结果。 */
          it('should work with concurrent mode updates', async () => {
            const log = [];
            const ref = React.createRef();
            const setClick1 = ReactDOM.unstable_createEventHandle('click');

            /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
            function Test({counter}) {
              React.useLayoutEffect(() => {
                return setClick1(ref.current, () => {
                  log.push({counter});
                });
              });

              Scheduler.log('Test');
              return <button ref={ref}>Press me</button>;
            }

            const root = ReactDOMClient.createRoot(container);
            root.render(<Test counter={0} />);

            await waitForAll(['Test']);

            // 点击按钮。
            dispatchClickEvent(ref.current);
            expect(log).toEqual([{counter: 0}]);

            // 清除日志
            log.length = 0;

            // 增加计数器
            React.startTransition(() => {
              root.render(<Test counter={1} />);
            });
            // 在提交前让出执行权。
            await waitFor(['Test']);

            // 再次点击按钮。
            dispatchClickEvent(ref.current);
            expect(log).toEqual([{counter: 0}]);

            // 清除日志
            log.length = 0;

            // 提交更新。
            await waitForAll([]);
            dispatchClickEvent(ref.current);
            expect(log).toEqual([{counter: 1}]);
          });

          // @gate www
          /** 测试场景：验证「should correctly work for a basic "click" window listener」描述的渲染、交互或错误处理结果。 */
          it('should correctly work for a basic "click" window listener', async () => {
            const log = [];
            const clickEvent = jest.fn(event => {
              log.push({
                eventPhase: event.eventPhase,
                type: event.type,
                currentTarget: event.currentTarget,
                target: event.target,
              });
            });
            const setClick1 = ReactDOM.unstable_createEventHandle('click');

            /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
            function Test() {
              React.useEffect(() => {
                return setClick1(window, clickEvent);
              });

              return <button>Click anything!</button>;
            }
            const root = ReactDOMClient.createRoot(container);
            await act(() => {
              root.render(<Test />);
            });

            expect(container.innerHTML).toBe(
              '<button>Click anything!</button>',
            );

            // 点击按钮外部应触发 window 上的事件回调。
            dispatchClickEvent(document.body);
            expect(log[0]).toEqual({
              eventPhase: 3,
              type: 'click',
              currentTarget: window,
              target: document.body,
            });

            // 卸载容器后再点击不应触发回调。

            await act(() => {
              root.render(null);
            });

            dispatchClickEvent(document.body);
            expect(clickEvent).toBeCalledTimes(1);

            // 重新渲染并点击 body 应该再次工作。
            await act(() => {
              root.render(<Test />);
            });

            dispatchClickEvent(document.body);
            expect(clickEvent).toBeCalledTimes(2);
          });

          // @gate www
          /** 测试场景：验证「handle propagation of click events on the window」描述的渲染、交互或错误处理结果。 */
          it('handle propagation of click events on the window', async () => {
            const buttonRef = React.createRef();
            const divRef = React.createRef();
            const log = [];
            const onClick = jest.fn(e => log.push(['bubble', e.currentTarget]));
            const onClickCapture = jest.fn(e =>
              log.push(['capture', e.currentTarget]),
            );
            const setClick = ReactDOM.unstable_createEventHandle('click');
            const setClickCapture = ReactDOM.unstable_createEventHandle(
              'click',
              {
                capture: true,
              },
            );

            /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
            function Test() {
              React.useEffect(() => {
                const clearClick1 = setClick(window, onClick);
                const clearClickCapture1 = setClickCapture(
                  window,
                  onClickCapture,
                );
                const clearClick2 = setClick(buttonRef.current, onClick);
                const clearClickCapture2 = setClickCapture(
                  buttonRef.current,
                  onClickCapture,
                );
                const clearClick3 = setClick(divRef.current, onClick);
                const clearClickCapture3 = setClickCapture(
                  divRef.current,
                  onClickCapture,
                );

                return () => {
                  clearClick1();
                  clearClickCapture1();
                  clearClick2();
                  clearClickCapture2();
                  clearClick3();
                  clearClickCapture3();
                };
              });

              return (
                <button ref={buttonRef}>
                  <div ref={divRef}>Click me!</div>
                </button>
              );
            }

            const root = ReactDOMClient.createRoot(container);
            await act(() => {
              root.render(<Test />);
            });

            const buttonElement = buttonRef.current;
            dispatchClickEvent(buttonElement);
            expect(onClick).toHaveBeenCalledTimes(2);
            expect(onClickCapture).toHaveBeenCalledTimes(2);
            expect(log[0]).toEqual(['capture', window]);
            expect(log[1]).toEqual(['capture', buttonElement]);
            expect(log[2]).toEqual(['bubble', buttonElement]);
            expect(log[3]).toEqual(['bubble', window]);

            log.length = 0;
            onClick.mockClear();
            onClickCapture.mockClear();

            const divElement = divRef.current;
            dispatchClickEvent(divElement);
            expect(onClick).toHaveBeenCalledTimes(3);
            expect(onClickCapture).toHaveBeenCalledTimes(3);
            expect(log[0]).toEqual(['capture', window]);
            expect(log[1]).toEqual(['capture', buttonElement]);
            expect(log[2]).toEqual(['capture', divElement]);
            expect(log[3]).toEqual(['bubble', divElement]);
            expect(log[4]).toEqual(['bubble', buttonElement]);
            expect(log[5]).toEqual(['bubble', window]);
          });

          // @gate www
          /** 测试场景：验证「should correctly handle stopPropagation for mixed listeners」描述的渲染、交互或错误处理结果。 */
          it('should correctly handle stopPropagation for mixed listeners', async () => {
            const buttonRef = React.createRef();
            const rootListener1 = jest.fn(e => e.stopPropagation());
            const rootListener2 = jest.fn();
            const targetListener1 = jest.fn();
            const targetListener2 = jest.fn();
            const setClick1 = ReactDOM.unstable_createEventHandle('click', {
              capture: true,
            });
            const setClick2 = ReactDOM.unstable_createEventHandle('click', {
              capture: true,
            });
            const setClick3 = ReactDOM.unstable_createEventHandle('click');
            const setClick4 = ReactDOM.unstable_createEventHandle('click');

            /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
            function Test() {
              React.useEffect(() => {
                const clearClick1 = setClick1(window, rootListener1);
                const clearClick2 = setClick2(
                  buttonRef.current,
                  targetListener1,
                );
                const clearClick3 = setClick3(window, rootListener2);
                const clearClick4 = setClick4(
                  buttonRef.current,
                  targetListener2,
                );

                return () => {
                  clearClick1();
                  clearClick2();
                  clearClick3();
                  clearClick4();
                };
              });

              return <button ref={buttonRef}>Click me!</button>;
            }

            const root = ReactDOMClient.createRoot(container);
            await act(() => {
              root.render(<Test />);
            });

            const buttonElement = buttonRef.current;
            dispatchClickEvent(buttonElement);
            expect(rootListener1).toHaveBeenCalledTimes(1);
            expect(targetListener1).toHaveBeenCalledTimes(0);
            expect(targetListener2).toHaveBeenCalledTimes(0);
            expect(rootListener2).toHaveBeenCalledTimes(0);
          });

          // @gate www
          /** 测试场景：验证「should correctly handle stopPropagation for delegated listeners」描述的渲染、交互或错误处理结果。 */
          it('should correctly handle stopPropagation for delegated listeners', async () => {
            const buttonRef = React.createRef();
            const rootListener1 = jest.fn(e => e.stopPropagation());
            const rootListener2 = jest.fn();
            const rootListener3 = jest.fn(e => e.stopPropagation());
            const rootListener4 = jest.fn();
            const setClick1 = ReactDOM.unstable_createEventHandle('click', {
              capture: true,
            });
            const setClick2 = ReactDOM.unstable_createEventHandle('click', {
              capture: true,
            });
            const setClick3 = ReactDOM.unstable_createEventHandle('click');
            const setClick4 = ReactDOM.unstable_createEventHandle('click');

            /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
            function Test() {
              React.useEffect(() => {
                const clearClick1 = setClick1(window, rootListener1);
                const clearClick2 = setClick2(window, rootListener2);
                const clearClick3 = setClick3(window, rootListener3);
                const clearClick4 = setClick4(window, rootListener4);

                return () => {
                  clearClick1();
                  clearClick2();
                  clearClick3();
                  clearClick4();
                };
              });

              return <button ref={buttonRef}>Click me!</button>;
            }

            const root = ReactDOMClient.createRoot(container);
            await act(() => {
              root.render(<Test />);
            });

            const buttonElement = buttonRef.current;
            dispatchClickEvent(buttonElement);
            expect(rootListener1).toHaveBeenCalledTimes(1);
            expect(rootListener2).toHaveBeenCalledTimes(1);
            expect(rootListener3).toHaveBeenCalledTimes(0);
            expect(rootListener4).toHaveBeenCalledTimes(0);
          });

          // @gate www
          /** 测试场景：验证「handle propagation of click events on the window and document」描述的渲染、交互或错误处理结果。 */
          it('handle propagation of click events on the window and document', async () => {
            const buttonRef = React.createRef();
            const divRef = React.createRef();
            const log = [];
            const onClick = jest.fn(e => log.push(['bubble', e.currentTarget]));
            const onClickCapture = jest.fn(e =>
              log.push(['capture', e.currentTarget]),
            );
            const setClick = ReactDOM.unstable_createEventHandle('click');
            const setClickCapture = ReactDOM.unstable_createEventHandle(
              'click',
              {
                capture: true,
              },
            );

            /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
            function Test() {
              React.useEffect(() => {
                const clearClick1 = setClick(window, onClick);
                const clearClickCapture1 = setClickCapture(
                  window,
                  onClickCapture,
                );
                const clearClick2 = setClick(document, onClick);
                const clearClickCapture2 = setClickCapture(
                  document,
                  onClickCapture,
                );
                const clearClick3 = setClick(buttonRef.current, onClick);
                const clearClickCapture3 = setClickCapture(
                  buttonRef.current,
                  onClickCapture,
                );
                const clearClick4 = setClick(divRef.current, onClick);
                const clearClickCapture4 = setClickCapture(
                  divRef.current,
                  onClickCapture,
                );

                return () => {
                  clearClick1();
                  clearClickCapture1();
                  clearClick2();
                  clearClickCapture2();
                  clearClick3();
                  clearClickCapture3();
                  clearClick4();
                  clearClickCapture4();
                };
              });

              return (
                <button ref={buttonRef}>
                  <div ref={divRef}>Click me!</div>
                </button>
              );
            }

            const root = ReactDOMClient.createRoot(container);
            await act(() => {
              root.render(<Test />);
            });

            const buttonElement = buttonRef.current;
            dispatchClickEvent(buttonElement);
            expect(onClick).toHaveBeenCalledTimes(3);
            expect(onClickCapture).toHaveBeenCalledTimes(3);

            if (enableLegacyFBSupport) {
              expect(log[0]).toEqual(['capture', window]);
              expect(log[1]).toEqual(['capture', document]);
              expect(log[2]).toEqual(['capture', buttonElement]);
              expect(log[3]).toEqual(['bubble', document]);
              expect(log[4]).toEqual(['bubble', buttonElement]);
              expect(log[5]).toEqual(['bubble', window]);
            } else {
              expect(log[0]).toEqual(['capture', window]);
              expect(log[1]).toEqual(['capture', document]);
              expect(log[2]).toEqual(['capture', buttonElement]);
              expect(log[3]).toEqual(['bubble', buttonElement]);
              expect(log[4]).toEqual(['bubble', document]);
              expect(log[5]).toEqual(['bubble', window]);
            }

            log.length = 0;
            onClick.mockClear();
            onClickCapture.mockClear();

            const divElement = divRef.current;
            dispatchClickEvent(divElement);
            expect(onClick).toHaveBeenCalledTimes(4);
            expect(onClickCapture).toHaveBeenCalledTimes(4);

            if (enableLegacyFBSupport) {
              expect(log[0]).toEqual(['capture', window]);
              expect(log[1]).toEqual(['capture', document]);
              expect(log[2]).toEqual(['capture', buttonElement]);
              expect(log[3]).toEqual(['capture', divElement]);
              expect(log[4]).toEqual(['bubble', document]);
              expect(log[5]).toEqual(['bubble', divElement]);
              expect(log[6]).toEqual(['bubble', buttonElement]);
              expect(log[7]).toEqual(['bubble', window]);
            } else {
              expect(log[0]).toEqual(['capture', window]);
              expect(log[1]).toEqual(['capture', document]);
              expect(log[2]).toEqual(['capture', buttonElement]);
              expect(log[3]).toEqual(['capture', divElement]);
              expect(log[4]).toEqual(['bubble', divElement]);
              expect(log[5]).toEqual(['bubble', buttonElement]);
              expect(log[6]).toEqual(['bubble', document]);
              expect(log[7]).toEqual(['bubble', window]);
            }
          });

          // @gate www
          /** 测试场景：验证「does not support custom user events」描述的渲染、交互或错误处理结果。 */
          it('does not support custom user events', () => {
            // eager listener 模式无法预先知道全部自定义事件，因此该 API 不支持自定义事件。
            // 这里断言它会抛错，避免出现 portal 不冒泡等不一致行为。
            expect(() => {
              ReactDOM.unstable_createEventHandle('custom-event');
            }).toThrow(
              'Cannot call unstable_createEventHandle with "custom-event", as it is not an event known to React.',
            );
          });

          // @gate www
          /** 测试场景：验证「beforeblur and afterblur are called after a focused element is unmounted」描述的渲染、交互或错误处理结果。 */
          it('beforeblur and afterblur are called after a focused element is unmounted', async () => {
            const log = [];
            // 我们在这里需要持久化，因为我们需要在稍后读取 relatedTarget。
            const onAfterBlur = jest.fn(e => {
              e.persist();
              log.push(e.type);
            });
            const onBeforeBlur = jest.fn(e => log.push(e.type));
            const innerRef = React.createRef();
            const innerRef2 = React.createRef();
            const setAfterBlurHandle =
              ReactDOM.unstable_createEventHandle('afterblur');
            const setBeforeBlurHandle =
              ReactDOM.unstable_createEventHandle('beforeblur');

            /** `withEnableLegacyFBSupport.Component`：封装当前用例复用的操作、回调或断言步骤。 */
            const Component = ({show}) => {
              const ref = React.useRef(null);

              React.useEffect(() => {
                const clear1 = setAfterBlurHandle(document, onAfterBlur);
                const clear2 = setBeforeBlurHandle(ref.current, onBeforeBlur);

                return () => {
                  clear1();
                  clear2();
                };
              });

              return (
                <div ref={ref}>
                  {show && <input ref={innerRef} />}
                  <div ref={innerRef2} />
                </div>
              );
            };

            const root = ReactDOMClient.createRoot(container);
            await act(() => {
              root.render(<Component show={true} />);
            });

            const inner = innerRef.current;
            const target = createEventTarget(inner);
            target.focus();
            expect(onBeforeBlur).toHaveBeenCalledTimes(0);
            expect(onAfterBlur).toHaveBeenCalledTimes(0);

            await act(() => {
              root.render(<Component show={false} />);
            });

            expect(onBeforeBlur).toHaveBeenCalledTimes(1);
            expect(onAfterBlur).toHaveBeenCalledTimes(1);
            expect(onAfterBlur).toHaveBeenCalledWith(
              expect.objectContaining({relatedTarget: inner}),
            );
            expect(log).toEqual(['beforeblur', 'afterblur']);
          });

          // @gate www
          /**
           * 代表场景（Given–When–Then）：
           * Given 当前文件已建立所需 DOM、React 根与测试夹具；
           * When 执行「beforeblur and afterblur are called after a nested focused element is unmounted」描述的渲染或交互；
           * Then 通过本用例的 DOM、日志或调度断言确认行为。
           *
           * 验证机制：事件断言连接 DOMPluginEventSystem 的委托、合成与传播路径。
           */
          it('beforeblur and afterblur are called after a nested focused element is unmounted', async () => {
            const log = [];
            // 我们在这里需要持久化，因为我们需要在稍后读取 relatedTarget。
            const onAfterBlur = jest.fn(e => {
              e.persist();
              log.push(e.type);
            });
            const onBeforeBlur = jest.fn(e => log.push(e.type));
            const innerRef = React.createRef();
            const innerRef2 = React.createRef();
            const setAfterBlurHandle =
              ReactDOM.unstable_createEventHandle('afterblur');
            const setBeforeBlurHandle =
              ReactDOM.unstable_createEventHandle('beforeblur');

            /** `withEnableLegacyFBSupport.Component`：封装当前用例复用的操作、回调或断言步骤。 */
            const Component = ({show}) => {
              const ref = React.useRef(null);

              React.useEffect(() => {
                const clear1 = setAfterBlurHandle(document, onAfterBlur);
                const clear2 = setBeforeBlurHandle(ref.current, onBeforeBlur);

                return () => {
                  clear1();
                  clear2();
                };
              });

              return (
                <div ref={ref}>
                  {show && (
                    <div>
                      <input ref={innerRef} />
                    </div>
                  )}
                  <div ref={innerRef2} />
                </div>
              );
            };

            const root = ReactDOMClient.createRoot(container);
            await act(() => {
              root.render(<Component show={true} />);
            });

            const inner = innerRef.current;
            const target = createEventTarget(inner);
            target.focus();
            expect(onBeforeBlur).toHaveBeenCalledTimes(0);
            expect(onAfterBlur).toHaveBeenCalledTimes(0);

            await act(() => {
              root.render(<Component show={false} />);
            });

            expect(onBeforeBlur).toHaveBeenCalledTimes(1);
            expect(onAfterBlur).toHaveBeenCalledTimes(1);
            expect(onAfterBlur).toHaveBeenCalledWith(
              expect.objectContaining({relatedTarget: inner}),
            );
            expect(log).toEqual(['beforeblur', 'afterblur']);
          });

          // @gate www
          /** 测试场景：验证「beforeblur should skip handlers from a deleted subtree after the focused element is unmounted」描述的渲染、交互或错误处理结果。 */
          it('beforeblur should skip handlers from a deleted subtree after the focused element is unmounted', async () => {
            const onBeforeBlur = jest.fn();
            const innerRef = React.createRef();
            const innerRef2 = React.createRef();
            const setBeforeBlurHandle =
              ReactDOM.unstable_createEventHandle('beforeblur');
            const ref2 = React.createRef();

            /** `withEnableLegacyFBSupport.Component`：封装当前用例复用的操作、回调或断言步骤。 */
            const Component = ({show}) => {
              const ref = React.useRef(null);

              React.useEffect(() => {
                const clear1 = setBeforeBlurHandle(ref.current, onBeforeBlur);
                let clear2;
                if (ref2.current) {
                  clear2 = setBeforeBlurHandle(ref2.current, onBeforeBlur);
                }

                return () => {
                  clear1();
                  if (clear2) {
                    clear2();
                  }
                };
              });

              return (
                <div ref={ref}>
                  {show && (
                    <div ref={ref2}>
                      <input ref={innerRef} />
                    </div>
                  )}
                  <div ref={innerRef2} />
                </div>
              );
            };

            const root = ReactDOMClient.createRoot(container);
            await act(() => {
              root.render(<Component show={true} />);
            });

            const inner = innerRef.current;
            const target = createEventTarget(inner);
            target.focus();
            expect(onBeforeBlur).toHaveBeenCalledTimes(0);

            await act(() => {
              root.render(<Component show={false} />);
            });

            expect(onBeforeBlur).toHaveBeenCalledTimes(1);
          });

          // @gate www
          /** 测试场景：验证「beforeblur and afterblur are called after a focused element is suspended」描述的渲染、交互或错误处理结果。 */
          it('beforeblur and afterblur are called after a focused element is suspended', async () => {
            const log = [];
            // 我们在这里需要持久化，因为我们需要在稍后读取 relatedTarget。
            const onAfterBlur = jest.fn(e => {
              e.persist();
              log.push(e.type);
            });
            const onBeforeBlur = jest.fn(e => log.push(e.type));
            const innerRef = React.createRef();
            const Suspense = React.Suspense;
            let suspend = false;
            let resolve;
            const promise = new Promise(
              resolvePromise => (resolve = resolvePromise),
            );
            const setAfterBlurHandle =
              ReactDOM.unstable_createEventHandle('afterblur');
            const setBeforeBlurHandle =
              ReactDOM.unstable_createEventHandle('beforeblur');

            /** `withEnableLegacyFBSupport.Child`：封装当前用例复用的操作、回调或断言步骤。 */
            function Child() {
              if (suspend) {
                throw promise;
              } else {
                return <input ref={innerRef} />;
              }
            }

            /** `withEnableLegacyFBSupport.Component`：封装当前用例复用的操作、回调或断言步骤。 */
            const Component = () => {
              const ref = React.useRef(null);

              React.useEffect(() => {
                const clear1 = setAfterBlurHandle(document, onAfterBlur);
                const clear2 = setBeforeBlurHandle(ref.current, onBeforeBlur);

                return () => {
                  clear1();
                  clear2();
                };
              });

              return (
                <div ref={ref}>
                  <Suspense fallback="Loading...">
                    <Child />
                  </Suspense>
                </div>
              );
            };

            const container2 = document.createElement('div');
            document.body.appendChild(container2);

            const root = ReactDOMClient.createRoot(container2);

            await act(() => {
              root.render(<Component />);
            });
            jest.runAllTimers();

            const inner = innerRef.current;
            const target = createEventTarget(inner);
            target.focus();
            expect(onBeforeBlur).toHaveBeenCalledTimes(0);
            expect(onAfterBlur).toHaveBeenCalledTimes(0);

            suspend = true;
            await act(() => {
              root.render(<Component />);
            });
            jest.runAllTimers();

            expect(onBeforeBlur).toHaveBeenCalledTimes(1);
            expect(onAfterBlur).toHaveBeenCalledTimes(1);
            expect(onAfterBlur).toHaveBeenCalledWith(
              expect.objectContaining({relatedTarget: inner}),
            );
            resolve();
            expect(log).toEqual(['beforeblur', 'afterblur']);

            document.body.removeChild(container2);
          });

          // @gate www
          /** 测试场景：验证「beforeblur should skip handlers from a deleted subtree after the focused element is suspended」描述的渲染、交互或错误处理结果。 */
          it('beforeblur should skip handlers from a deleted subtree after the focused element is suspended', async () => {
            const onBeforeBlur = jest.fn();
            const innerRef = React.createRef();
            const innerRef2 = React.createRef();
            const setBeforeBlurHandle =
              ReactDOM.unstable_createEventHandle('beforeblur');
            const ref2 = React.createRef();
            const Suspense = React.Suspense;
            let suspend = false;
            let resolve;
            const promise = new Promise(
              resolvePromise => (resolve = resolvePromise),
            );

            /** `withEnableLegacyFBSupport.Child`：封装当前用例复用的操作、回调或断言步骤。 */
            function Child() {
              if (suspend) {
                throw promise;
              } else {
                return <input ref={innerRef} />;
              }
            }

            /** `withEnableLegacyFBSupport.Component`：封装当前用例复用的操作、回调或断言步骤。 */
            const Component = () => {
              const ref = React.useRef(null);

              React.useEffect(() => {
                const clear1 = setBeforeBlurHandle(ref.current, onBeforeBlur);
                let clear2;
                if (ref2.current) {
                  clear2 = setBeforeBlurHandle(ref2.current, onBeforeBlur);
                }

                return () => {
                  clear1();
                  if (clear2) {
                    clear2();
                  }
                };
              });

              return (
                <div ref={ref}>
                  <Suspense fallback="Loading...">
                    <div ref={ref2}>
                      <Child />
                    </div>
                  </Suspense>
                  <div ref={innerRef2} />
                </div>
              );
            };

            const container2 = document.createElement('div');
            document.body.appendChild(container2);

            const root = ReactDOMClient.createRoot(container2);

            await act(() => {
              root.render(<Component />);
            });
            jest.runAllTimers();

            const inner = innerRef.current;
            const target = createEventTarget(inner);
            target.focus();
            expect(onBeforeBlur).toHaveBeenCalledTimes(0);

            suspend = true;
            await act(() => {
              root.render(<Component />);
            });
            jest.runAllTimers();

            expect(onBeforeBlur).toHaveBeenCalledTimes(1);
            resolve();

            document.body.removeChild(container2);
          });

          // @gate www
          /** 测试场景：验证「regression: does not fire beforeblur/afterblur if target is already hidden」描述的渲染、交互或错误处理结果。 */
          it('regression: does not fire beforeblur/afterblur if target is already hidden', async () => {
            const Suspense = React.Suspense;
            let suspend = false;
            const fakePromise = {
              /** 模拟 thenable 的订阅方法，使 Suspense 保持在待决状态。 */
              then() {}
            };
            const setBeforeBlurHandle =
              ReactDOM.unstable_createEventHandle('beforeblur');
            const innerRef = React.createRef();

            /** `withEnableLegacyFBSupport.Child`：封装当前用例复用的操作、回调或断言步骤。 */
            function Child() {
              if (suspend) {
                throw fakePromise;
              }
              return <input ref={innerRef} />;
            }

            /** `withEnableLegacyFBSupport.Component`：封装当前用例复用的操作、回调或断言步骤。 */
            const Component = () => {
              const ref = React.useRef(null);
              const [, setState] = React.useState(0);

              React.useEffect(() => {
                return setBeforeBlurHandle(ref.current, () => {
                  // 回归场景中，这会触发更新；随后的渲染又会触发 blur 事件并再次更新，最终形成无限循环。
                  setState(n => n + 1);
                });
              }, []);

              return (
                <div ref={ref}>
                  <Suspense fallback="Loading...">
                    <Child />
                  </Suspense>
                </div>
              );
            };

            const container2 = document.createElement('div');
            document.body.appendChild(container2);

            const root = ReactDOMClient.createRoot(container2);
            await act(() => {
              root.render(<Component />);
            });

            // 聚焦 input 节点。
            const inner = innerRef.current;
            const target = createEventTarget(inner);
            target.focus();

            // 挂起会隐藏 input 节点，使其失去焦点。
            suspend = true;
            await act(() => {
              root.render(<Component />);
            });

            document.body.removeChild(container2);
          });

          // @gate !disableCommentsAsDOMContainers
          /** 测试场景：验证「handle propagation of click events between disjointed comment roots」描述的渲染、交互或错误处理结果。 */
          it('handle propagation of click events between disjointed comment roots', async () => {
            const buttonRef = React.createRef();
            const divRef = React.createRef();
            const log = [];
            const setClick = ReactDOM.unstable_createEventHandle('click');
            const setClickCapture = ReactDOM.unstable_createEventHandle(
              'click',
              {capture: true},
            );
            const onClick = jest.fn(e => log.push(['bubble', e.currentTarget]));
            const onClickCapture = jest.fn(e =>
              log.push(['capture', e.currentTarget]),
            );

            /** `withEnableLegacyFBSupport.Child`：封装当前用例复用的操作、回调或断言步骤。 */
            function Child() {
              React.useEffect(() => {
                const click1 = setClick(divRef.current, onClick);
                const click2 = setClickCapture(divRef.current, onClickCapture);
                return () => {
                  click1();
                  click2();
                };
              });

              return <div ref={divRef}>Click me!</div>;
            }

            /** `withEnableLegacyFBSupport.Parent`：封装当前用例复用的操作、回调或断言步骤。 */
            function Parent() {
              React.useEffect(() => {
                const click1 = setClick(buttonRef.current, onClick);
                const click2 = setClickCapture(
                  buttonRef.current,
                  onClickCapture,
                );
                return () => {
                  click1();
                  click2();
                };
              });

              return <button ref={buttonRef} />;
            }

            // 我们在这里使用一个注释节点，然后挂载到它上。
            const disjointedNode = document.createComment(
              ' react-mount-point-unstable ',
            );
            const root = ReactDOMClient.createRoot(container);
            await act(() => {
              root.render(<Parent />);
            });
            buttonRef.current.appendChild(disjointedNode);
            const disjointedNodeRoot =
              ReactDOMClient.createRoot(disjointedNode);
            await act(() => {
              disjointedNodeRoot.render(<Child />);
            });

            const buttonElement = buttonRef.current;
            dispatchClickEvent(buttonElement);
            expect(onClick).toHaveBeenCalledTimes(1);
            expect(onClickCapture).toHaveBeenCalledTimes(1);
            expect(log[0]).toEqual(['capture', buttonElement]);
            expect(log[1]).toEqual(['bubble', buttonElement]);

            const divElement = divRef.current;
            dispatchClickEvent(divElement);
            expect(onClick).toHaveBeenCalledTimes(3);
            expect(onClickCapture).toHaveBeenCalledTimes(3);
            expect(log[2]).toEqual(['capture', buttonElement]);
            expect(log[3]).toEqual(['capture', divElement]);
            expect(log[4]).toEqual(['bubble', divElement]);
            expect(log[5]).toEqual(['bubble', buttonElement]);
          });

          // @gate www
          /** 测试场景：验证「propagates known createEventHandle events through portals without inner listeners」描述的渲染、交互或错误处理结果。 */
          it('propagates known createEventHandle events through portals without inner listeners', async () => {
            const buttonRef = React.createRef();
            const divRef = React.createRef();
            const log = [];
            const onClick = jest.fn(e => log.push(['bubble', e.currentTarget]));
            const onClickCapture = jest.fn(e =>
              log.push(['capture', e.currentTarget]),
            );
            const setClick = ReactDOM.unstable_createEventHandle('click');
            const setClickCapture = ReactDOM.unstable_createEventHandle(
              'click',
              {
                capture: true,
              },
            );

            const portalElement = document.createElement('div');
            document.body.appendChild(portalElement);

            /** `withEnableLegacyFBSupport.Child`：封装当前用例复用的操作、回调或断言步骤。 */
            function Child() {
              return <div ref={divRef}>Click me!</div>;
            }

            /** `withEnableLegacyFBSupport.Parent`：封装当前用例复用的操作、回调或断言步骤。 */
            function Parent() {
              React.useEffect(() => {
                const clear1 = setClick(buttonRef.current, onClick);
                const clear2 = setClickCapture(
                  buttonRef.current,
                  onClickCapture,
                );
                return () => {
                  clear1();
                  clear2();
                };
              });

              return (
                <button ref={buttonRef}>
                  {ReactDOM.createPortal(<Child />, portalElement)}
                </button>
              );
            }

            const root = ReactDOMClient.createRoot(container);
            await act(() => {
              root.render(<Parent />);
            });

            const divElement = divRef.current;
            const buttonElement = buttonRef.current;
            dispatchClickEvent(divElement);
            expect(onClick).toHaveBeenCalledTimes(1);
            expect(onClickCapture).toHaveBeenCalledTimes(1);
            expect(log[0]).toEqual(['capture', buttonElement]);
            expect(log[1]).toEqual(['bubble', buttonElement]);

            document.body.removeChild(portalElement);
          });

          describe('Compatibility with Scopes API', () => {
            beforeEach(() => {
              jest.resetModules();
              ReactFeatureFlags = require('shared/ReactFeatureFlags');
              ReactFeatureFlags.enableCreateEventHandleAPI = true;
              ReactFeatureFlags.enableScopeAPI = true;

              React = require('react');
              ReactDOM = require('react-dom');
              ReactDOMClient = require('react-dom/client');
              Scheduler = require('scheduler');
              ReactDOMServer = require('react-dom/server');
              act = require('internal-test-utils').act;
            });

            // @gate www
            /** 测试场景：验证「handle propagation of click events on a scope」描述的渲染、交互或错误处理结果。 */
            it('handle propagation of click events on a scope', async () => {
              const buttonRef = React.createRef();
              const log = [];
              const onClick = jest.fn(e =>
                log.push(['bubble', e.currentTarget]),
              );
              const onClickCapture = jest.fn(e =>
                log.push(['capture', e.currentTarget]),
              );
              const TestScope = React.unstable_Scope;
              const setClick = ReactDOM.unstable_createEventHandle('click');
              const setClickCapture = ReactDOM.unstable_createEventHandle(
                'click',
                {
                  capture: true,
                },
              );

              /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
              function Test() {
                const scopeRef = React.useRef(null);

                React.useEffect(() => {
                  const clear1 = setClick(scopeRef.current, onClick);
                  const clear2 = setClickCapture(
                    scopeRef.current,
                    onClickCapture,
                  );

                  return () => {
                    clear1();
                    clear2();
                  };
                });

                return (
                  <TestScope ref={scopeRef}>
                    <button ref={buttonRef} />
                  </TestScope>
                );
              }

              const root = ReactDOMClient.createRoot(container);
              await act(() => {
                root.render(<Test />);
              });

              const buttonElement = buttonRef.current;
              dispatchClickEvent(buttonElement);

              expect(onClick).toHaveBeenCalledTimes(1);
              expect(onClickCapture).toHaveBeenCalledTimes(1);
              expect(log).toEqual([
                ['capture', buttonElement],
                ['bubble', buttonElement],
              ]);
            });

            // @gate www
            /** 测试场景：验证「handle mixed propagation of click events on a scope」描述的渲染、交互或错误处理结果。 */
            it('handle mixed propagation of click events on a scope', async () => {
              const buttonRef = React.createRef();
              const divRef = React.createRef();
              const log = [];
              const onClick = jest.fn(e =>
                log.push(['bubble', e.currentTarget]),
              );
              const onClickCapture = jest.fn(e =>
                log.push(['capture', e.currentTarget]),
              );
              const TestScope = React.unstable_Scope;
              const setClick = ReactDOM.unstable_createEventHandle('click');
              const setClickCapture = ReactDOM.unstable_createEventHandle(
                'click',
                {
                  capture: true,
                },
              );

              /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
              function Test() {
                const scopeRef = React.useRef(null);

                React.useEffect(() => {
                  const clear1 = setClick(scopeRef.current, onClick);
                  const clear2 = setClickCapture(
                    scopeRef.current,
                    onClickCapture,
                  );
                  const clear3 = setClick(buttonRef.current, onClick);
                  const clear4 = setClickCapture(
                    buttonRef.current,
                    onClickCapture,
                  );

                  return () => {
                    clear1();
                    clear2();
                    clear3();
                    clear4();
                  };
                });

                return (
                  <TestScope ref={scopeRef}>
                    <button ref={buttonRef}>
                      <div
                        ref={divRef}
                        onClick={onClick}
                        onClickCapture={onClickCapture}>
                        Click me!
                      </div>
                    </button>
                  </TestScope>
                );
              }

              const root = ReactDOMClient.createRoot(container);
              await act(() => {
                root.render(<Test />);
              });

              const buttonElement = buttonRef.current;
              dispatchClickEvent(buttonElement);

              expect(onClick).toHaveBeenCalledTimes(2);
              expect(onClickCapture).toHaveBeenCalledTimes(2);
              expect(log).toEqual([
                ['capture', buttonElement],
                ['capture', buttonElement],
                ['bubble', buttonElement],
                ['bubble', buttonElement],
              ]);

              log.length = 0;
              onClick.mockClear();
              onClickCapture.mockClear();

              const divElement = divRef.current;
              dispatchClickEvent(divElement);

              expect(onClick).toHaveBeenCalledTimes(3);
              expect(onClickCapture).toHaveBeenCalledTimes(3);
              expect(log).toEqual([
                ['capture', buttonElement],
                ['capture', buttonElement],
                ['capture', divElement],
                ['bubble', divElement],
                ['bubble', buttonElement],
                ['bubble', buttonElement],
              ]);
            });

            // @gate www
            /** 测试场景：验证「should not handle the target being a dangling text node within a scope」描述的渲染、交互或错误处理结果。 */
            it('should not handle the target being a dangling text node within a scope', async () => {
              const clickEvent = jest.fn();
              const buttonRef = React.createRef();
              const TestScope = React.unstable_Scope;
              const setClick = ReactDOM.unstable_createEventHandle('click');

              /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
              function Test() {
                const scopeRef = React.useRef(null);

                React.useEffect(() => {
                  return setClick(scopeRef.current, clickEvent);
                });

                return (
                  <button ref={buttonRef}>
                    <TestScope ref={scopeRef}>Click me!</TestScope>
                  </button>
                );
              }

              const root = ReactDOMClient.createRoot(container);
              await act(() => {
                root.render(<Test />);
              });

              const textNode = buttonRef.current.firstChild;
              dispatchClickEvent(textNode);
              // 这里不应触发：目标实例会解析为 <button>，而它实际位于 scope 之外。
              expect(clickEvent).toBeCalledTimes(0);
            });

            // @gate www
            /** 测试场景：验证「handle stopPropagation (inner) correctly between scopes」描述的渲染、交互或错误处理结果。 */
            it('handle stopPropagation (inner) correctly between scopes', async () => {
              const buttonRef = React.createRef();
              const outerOnClick = jest.fn();
              const innerOnClick = jest.fn(e => e.stopPropagation());
              const TestScope = React.unstable_Scope;
              const TestScope2 = React.unstable_Scope;
              const setClick = ReactDOM.unstable_createEventHandle('click');

              /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
              function Test() {
                const scopeRef = React.useRef(null);
                const scope2Ref = React.useRef(null);

                React.useEffect(() => {
                  const clear1 = setClick(scopeRef.current, outerOnClick);
                  const clear2 = setClick(scope2Ref.current, innerOnClick);

                  return () => {
                    clear1();
                    clear2();
                  };
                });

                return (
                  <TestScope ref={scopeRef}>
                    <TestScope2 ref={scope2Ref}>
                      <button ref={buttonRef} />
                    </TestScope2>
                  </TestScope>
                );
              }

              const root = ReactDOMClient.createRoot(container);
              await act(() => {
                root.render(<Test />);
              });

              const buttonElement = buttonRef.current;
              dispatchClickEvent(buttonElement);

              expect(innerOnClick).toHaveBeenCalledTimes(1);
              expect(outerOnClick).toHaveBeenCalledTimes(0);
            });

            // @gate www
            /** 测试场景：验证「handle stopPropagation (outer) correctly between scopes」描述的渲染、交互或错误处理结果。 */
            it('handle stopPropagation (outer) correctly between scopes', async () => {
              const buttonRef = React.createRef();
              const outerOnClick = jest.fn(e => e.stopPropagation());
              const innerOnClick = jest.fn();
              const TestScope = React.unstable_Scope;
              const TestScope2 = React.unstable_Scope;
              const setClick = ReactDOM.unstable_createEventHandle('click');

              /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
              function Test() {
                const scopeRef = React.useRef(null);
                const scope2Ref = React.useRef(null);

                React.useEffect(() => {
                  const clear1 = setClick(scopeRef.current, outerOnClick);
                  const clear2 = setClick(scope2Ref.current, innerOnClick);

                  return () => {
                    clear1();
                    clear2();
                  };
                });

                return (
                  <TestScope ref={scopeRef}>
                    <TestScope2 ref={scope2Ref}>
                      <button ref={buttonRef} />
                    </TestScope2>
                  </TestScope>
                );
              }

              const root = ReactDOMClient.createRoot(container);
              await act(() => {
                root.render(<Test />);
              });

              const buttonElement = buttonRef.current;
              dispatchClickEvent(buttonElement);

              expect(innerOnClick).toHaveBeenCalledTimes(1);
              expect(outerOnClick).toHaveBeenCalledTimes(1);
            });

            // @gate www
            /** 测试场景：验证「handle stopPropagation (inner and outer) correctly between scopes」描述的渲染、交互或错误处理结果。 */
            it('handle stopPropagation (inner and outer) correctly between scopes', async () => {
              const buttonRef = React.createRef();
              const onClick = jest.fn(e => e.stopPropagation());
              const TestScope = React.unstable_Scope;
              const TestScope2 = React.unstable_Scope;
              const setClick = ReactDOM.unstable_createEventHandle('click');

              /** `withEnableLegacyFBSupport.Test`：封装当前用例复用的操作、回调或断言步骤。 */
              function Test() {
                const scopeRef = React.useRef(null);
                const scope2Ref = React.useRef(null);

                React.useEffect(() => {
                  const clear1 = setClick(scopeRef.current, onClick);
                  const clear2 = setClick(scope2Ref.current, onClick);

                  return () => {
                    clear1();
                    clear2();
                  };
                });

                return (
                  <TestScope ref={scopeRef}>
                    <TestScope2 ref={scope2Ref}>
                      <button ref={buttonRef} />
                    </TestScope2>
                  </TestScope>
                );
              }

              const root = ReactDOMClient.createRoot(container);
              await act(() => {
                root.render(<Test />);
              });

              const buttonElement = buttonRef.current;
              dispatchClickEvent(buttonElement);

              expect(onClick).toHaveBeenCalledTimes(1);
            });

            // @gate www
            /** 测试场景：验证「should be able to register handlers for events affected by the intervention」描述的渲染、交互或错误处理结果。 */
            it('should be able to register handlers for events affected by the intervention', async () => {
              const rootContainer = document.createElement('div');
              container.appendChild(rootContainer);

              const allEvents = [];
              const defaultPreventedEvents = [];
              /** `withEnableLegacyFBSupport.handler`：封装当前用例复用的操作、回调或断言步骤。 */
              const handler = e => {
                allEvents.push(e.type);
                if (e.defaultPrevented) defaultPreventedEvents.push(e.type);
              };

              container.addEventListener('touchstart', handler);
              container.addEventListener('touchmove', handler);
              container.addEventListener('wheel', handler);

              const ref = React.createRef();
              const setTouchStart =
                ReactDOM.unstable_createEventHandle('touchstart');
              const setTouchMove =
                ReactDOM.unstable_createEventHandle('touchmove');
              const setWheel = ReactDOM.unstable_createEventHandle('wheel');

              /** `withEnableLegacyFBSupport.Component`：封装当前用例复用的操作、回调或断言步骤。 */
              function Component() {
                React.useEffect(() => {
                  const clearTouchStart = setTouchStart(ref.current, e =>
                    e.preventDefault(),
                  );
                  const clearTouchMove = setTouchMove(ref.current, e =>
                    e.preventDefault(),
                  );
                  const clearWheel = setWheel(ref.current, e =>
                    e.preventDefault(),
                  );
                  return () => {
                    clearTouchStart();
                    clearTouchMove();
                    clearWheel();
                  };
                });
                return <div ref={ref}>test</div>;
              }

              const root = ReactDOMClient.createRoot(rootContainer);
              await act(() => {
                root.render(<Component />);
              });

              dispatchEvent(ref.current, 'touchstart');
              dispatchEvent(ref.current, 'touchmove');
              dispatchEvent(ref.current, 'wheel');

              expect(allEvents).toEqual(['touchstart', 'touchmove', 'wheel']);
              // 这些事件默认是 passive，因而无法调用 preventDefault。
              expect(defaultPreventedEvents).toEqual([]);
            });
          });
        });
      },
    );
  }

  withEnableLegacyFBSupport(false);
  withEnableLegacyFBSupport(true);
});
