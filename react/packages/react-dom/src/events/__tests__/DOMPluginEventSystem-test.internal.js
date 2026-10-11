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

/** 向 element 派发 type 指定的通用 DOM Event，设置 bubbles/cancelable 为 true；不返回 dispatchEvent 的布尔结果，用可控事件覆盖委托传播。 */
function dispatchEvent(element, type) {
  const event = document.createEvent('Event');
  event.initEvent(type, true, true);
  element.dispatchEvent(event);
}

/** 向 element 调用本文件通用派发器发送 click；无返回值，避免各用例重复创建可冒泡、可取消事件。 */
function dispatchClickEvent(element) {
  dispatchEvent(element, 'click');
}

/** 记录 window/document 注册监听时的目标与完整参数；afterEach 据此移除监听，此数组跨用例保留、清理函数不重置它。 */
const eventListenersToClear = [];

/** 包装当前 window/document.addEventListener，把每次参数存入清理清单后转调保存的方法；无返回值，供用例移除全局监听，未在此处恢复被包装方法。 */
function startNativeEventListenerClearDown() {
  const nativeWindowEventListener = window.addEventListener;
  /** 接收 addEventListener 的原始可变参数，记录 window 与 params 并保持 this 转调先前方法，返回其结果；记录供 afterEach 按相同参数移除。 */
  window.addEventListener = function (...params) {
    eventListenersToClear.push({target: window, params});
    return nativeWindowEventListener.apply(this, params);
  };
  const nativeDocumentEventListener = document.addEventListener;
  /** 接收 addEventListener 的原始可变参数，记录 document 与 params 并保持 this 转调先前方法，返回其结果；不更改事件类型、回调或 options。 */
  document.addEventListener = function (...params) {
    eventListenersToClear.push({target: document, params});
    return nativeDocumentEventListener.apply(this, params);
  };
}

/** 遍历已记录的目标/参数并调用 removeEventListener；无返回值，只移除监听，不清空清单或恢复 addEventListener 包装。 */
function endNativeEventListenerClearDown() {
  eventListenersToClear.forEach(({target, params}) => {
    target.removeEventListener(...params);
  });
}

describe('DOMPluginEventSystem', () => {
  let container;

  /** 按 enableLegacyFBSupport 布尔值定义一组测试，初始化 flags、独立 DOM 容器及全局监听记录，并在 afterEach 移除容器/监听；返回 undefined，两次调用分别覆盖开关状态。 */
  function withEnableLegacyFBSupport(enableLegacyFBSupport) {
    describe(
      'enableLegacyFBSupport ' +
        (enableLegacyFBSupport ? 'enabled' : 'disabled'),
      () => {
        beforeAll(() => {
          // 两组测试分别设置 legacyFBSupport；重新创建 document 元素，避免沿用上一组的宿主节点和监听标记。
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

        /** 按钮的 onClick 保存收到的事件；连续派发两次 click，断言回调计数从 1 到 2、两次事件对象不同且 type 均为 click，验证事件未复用为同一池化对象。 */
        it('does not pool events', async () => {
          const buttonRef = React.createRef();
          const log = [];
          const onClick = jest.fn(e => log.push(e));

          /** 返回带 ref 和 onClick 的按钮；回调把每次 SyntheticEvent 保存到外部 log，使测试能比较两次事件对象。 */
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

        /** 按钮和内层 div 都注册捕获/冒泡回调；先点击按钮得到按钮捕获→冒泡，再点击 div 得到按钮捕获→div 捕获→div 冒泡→按钮冒泡，累计每阶段 3 次，验证单根两阶段路径。 */
        it('handle propagation of click events', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const log = [];
          const onClick = jest.fn(e => log.push(['bubble', e.currentTarget]));
          const onClickCapture = jest.fn(e =>
            log.push(['capture', e.currentTarget]),
          );

          /** 返回按钮包 div 的宿主树，在两节点注册相同捕获/冒泡 mock 并暴露 ref，供日志断言 currentTarget 的四阶段顺序。 */
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

        /** 按钮的 click 回调同步调用隐藏 input 的 click()，input 回调递增闭包计数；派发按钮 click 后只断言计数为 1，验证嵌套同步派发能到达 input。 */
        it('handle propagation of click events combined with sync clicks', async () => {
          const buttonRef = React.createRef();
          let clicks = 0;

          /** 返回按钮和 display:none 的 input；按钮 onClick 同步调用 inputRef.current.click()，input onClick 递增外部 clicks，构造嵌套派发。 */
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

        /** 外根按钮内的 div 容器再创建子根，子根渲染带回调的 div；分别点击按钮和子 div，断言自身两阶段及跨根四阶段顺序，累计每种回调 3 次。 */
        it('handle propagation of click events between roots', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const childRef = React.createRef();
          const log = [];
          const onClick = jest.fn(e => log.push(['bubble', e.currentTarget]));
          const onClickCapture = jest.fn(e =>
            log.push(['capture', e.currentTarget]),
          );

          /** 返回注册 click 两阶段的 div 并赋给 divRef，作为按钮内独立子根的可点击宿主目标。 */
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

          /** 返回注册 click 两阶段的按钮及 childRef div；测试在该 div 创建子根，因此 Parent 不直接返回 Child 的 React 元素。 */
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

        /** 外根渲染按钮后手动把独立子根容器接到按钮 DOM 下；点击按钮与子根 div，断言捕获由按钮到 div、冒泡反向，验证通过 DOM 嵌套连接两个独立根的事件路径。 */
        it('handle propagation of click events between disjointed roots', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const log = [];
          const onClick = jest.fn(e => log.push(['bubble', e.currentTarget]));
          const onClickCapture = jest.fn(e =>
            log.push(['capture', e.currentTarget]),
          );

          /** 返回带两阶段 click 回调和 ref 的 div，供手动接入按钮 DOM 的独立根渲染并记录传播目标。 */
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

          /** 返回带两阶段 click 回调的空按钮；子根容器由测试在提交后 appendChild，借此区分 React 子树与 DOM 嵌套。 */
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

        /** 三个独立根的容器经 DOM 手动嵌套，中间根的按钮与内层根容器是兄弟；分别点击外按钮、内 div、中按钮，断言内 div 的路径不含中按钮，而中按钮的路径含外按钮，累计各阶段 5 次。 */
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

          /** 返回带两阶段 click 回调的最内 div，供三个独立根的 DOM 嵌套场景检验实际祖先路径。 */
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

          /** 返回带两阶段 click 回调的中间根按钮；该按钮与后接入的子根容器为 DOM 兄弟，内 div 的传播不经过它。 */
          function Parent() {
            return (
              <button
                ref={button2Ref}
                onClick={onClick}
                onClickCapture={onClickCapture}
              />
            );
          }

          /** 返回带两阶段 click 回调的最外按钮和 span 插槽，测试用 spanRef 把另两根容器接入其 DOM 之下。 */
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

        /** 以外根按钮内的特定注释为子根容器，子 div 插在注释前；点击按钮与子 div，断言按钮捕获→div 捕获→div 冒泡→按钮冒泡及累计计数，验证启用注释容器时的跨根传播。 */
        // @gate !disableCommentsAsDOMContainers
        it('handle propagation of click events between disjointed comment roots', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const log = [];
          const onClick = jest.fn(e => log.push(['bubble', e.currentTarget]));
          const onClickCapture = jest.fn(e =>
            log.push(['capture', e.currentTarget]),
          );

          /** 返回带两阶段 click 回调的 div；由按钮内注释容器的子根插到注释之前，用 ref 作为事件目标。 */
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

          /** 返回带两阶段 click 回调的按钮，测试向按钮添加特定注释作为独立子根挂载点。 */
          function Parent() {
            return (
              <button
                ref={buttonRef}
                onClick={onClick}
                onClickCapture={onClickCapture}
              />
            );
          }

          // 使用注释节点作为根容器，子树插入其父节点中并位于该注释之前。
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

        /** 将子根挂在按钮内 span 中的注释容器，子 div 位于注释之前；先后点击按钮和 div，断言按钮/div 四阶段顺序及累计 3 次，验证路径可穿过无监听的 span。 */
        // @gate !disableCommentsAsDOMContainers
        it('handle propagation of click events between disjointed comment roots #2', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const spanRef = React.createRef();
          const log = [];
          const onClick = jest.fn(e => log.push(['bubble', e.currentTarget]));
          const onClickCapture = jest.fn(e =>
            log.push(['capture', e.currentTarget]),
          );

          /** 返回带两阶段 click 回调的 div，供 span 内注释容器的子根渲染，日志检查与按钮之间的路径。 */
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

          /** 返回带两阶段 click 回调的按钮和 span 容器，测试用 childRef 给 span 添加注释挂载点。 */
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

          // 使用注释节点作为根容器，子树插入其父节点中并位于该注释之前。
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

        /** 按钮的 React 子树通过 portal 渲染到 body 下独立容器；点击按钮后点击 portal div，断言两阶段累计各 3 次及按钮/div 四阶段顺序，验证事件沿 portal 的 React 祖先传播；末尾移除 portal 容器。 */
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

          /** 返回带两阶段 click 回调的 div，作为挂到 body 下独立容器的 portal 子树，并以 ref 提供点击目标。 */
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

          /** 返回带两阶段 click 回调的按钮，其 Child 经 createPortal 渲染到外部 portalElement，构造 DOM 分离而 React 祖先相连的路径。 */
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

        /** 两个带 label 的 div 通过 portal 挂到 document.body；依次点击最后一个及前一个节点，日志为 second→first，验证各目标收到自己的回调，不把一次点击派发给另一个 portal。 */
        it('handle click events on document.body portals', async () => {
          const log = [];

          /** 接收 label，返回点击时把该 label 追加到 log 的 div；两个 body portal 据此区分收到事件的具体目标。 */
          function Child({label}) {
            return <div onClick={() => log.push(label)}>{label}</div>;
          }

          /** 返回 first/second 两个 portal 到 document.body，不添加父级宿主或父级回调，让用例分别点击两个 portal div。 */
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

        /** 外根的 div 带 onClick，内根用服务器 HTML 水合 Suspense 中的链接并在客户端抛出未决 Promise；点击链接时外根计数为 0，解除挂起并等待水合后仍为 0，验证此被水合边界阻塞的点击没有转交外树。 */
        it('does not invoke an event on a parent tree when a subtree is dehydrated', async () => {
          let suspend = false;
          let resolve;
          const promise = new Promise(
            resolvePromise => (resolve = resolvePromise),
          );

          let clicks = 0;
          const childSlotRef = React.createRef();

          /** 返回 onClick 递增 clicks 的外根 div 及 childSlotRef 插槽；内根容器手动插入该槽，检验阻塞点击是否到达外树。 */
          function Parent() {
            return <div onClick={() => clicks++} ref={childSlotRef} />;
          }

          /** 接收但未读取 text；suspend=true 时抛出共享 Promise，false 时返回链接，复现服务器已输出但客户端水合待决的子树。 */
          function Child({text}) {
            if (suspend) {
              throw promise;
            } else {
              return <a>Click me</a>;
            }
          }

          /** 返回 fallback 为 Loading... 的 Suspense 并包含 Child；复用同一元素结构进行服务器渲染及客户端 hydrateRoot。 */
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

        /** Parent 初次返回无 portal 的 div，effect 再把 child span portal 挂到其 ref DOM；分别点击 parent 与 child，日志为 parent、随后 child→parent，验证 effect 创建的 portal 能连到父级回调。 */
        it('handle click events on dynamic portals', async () => {
          const log = [];

          /** 初始 portal state 为 null；effect 用父 div ref 建立带 child 点击日志的 span portal 并更新 state，返回带 parent 点击日志的父 div。 */
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
        /** Parent 在父 div 内保留额外 div，effect 把 child span portal 挂到父 div 本身；点击父节点与最后的 portal span，日志仍为 parent、child→parent，验证 portal 目标与 JSX 占位结构不同也能传播。 */
        it('handle click events on dynamic portals #2', async () => {
          const log = [];

          /** 初始 portal state 为 null；effect 把 child span portal 挂到父 div ref，返回父 div 内额外的 div 占位，检验实际目标与 JSX 插槽不同的事件连接。 */
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

        /** portal 内目标 div 外包原生 click stopPropagation 节点；先点击按钮得到一次捕获/冒泡，再点击目标只使捕获累计到 3、冒泡仍为 1，验证原生中间节点阻止 portal 容器的冒泡监听；末尾移除容器。 */
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

          /** 返回 portal 的中间 div 包目标 div，目标注册两阶段 click 并暴露 ref；中间 ref 供父级 layout effect 注册原生阻断回调。 */
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

          /** layout effect 在 portal 中间 div 注册原生 click stopPropagation；返回带两阶段回调的按钮和 Child portal，使捕获已发生而冒泡到不了 portal 容器。 */
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

        /** 按钮与可聚焦 div 各有 onFocus 捕获/冒泡回调；先聚焦按钮，再聚焦 div，断言按钮捕获→div 捕获→div 冒泡→按钮冒泡及累计各 3 次，验证 focusin 对应的合成 focus 路径。 */
        it('handle propagation of focus events', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const log = [];
          const onFocus = jest.fn(e => log.push(['bubble', e.currentTarget]));
          const onFocusCapture = jest.fn(e =>
            log.push(['capture', e.currentTarget]),
          );

          /** 返回带两阶段 focus 回调的按钮及 tabIndex=0 的 div，以两个 ref 依次调用 focus 并记录 currentTarget。 */
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

        /** 外根按钮内挂子根的可聚焦 div；分别聚焦按钮与子 div，断言自身两阶段和跨根四阶段顺序，累计每阶段 3 次，验证 focus 能跨 DOM 嵌套根传播。 */
        it('handle propagation of focus events between roots', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const childRef = React.createRef();
          const log = [];
          const onFocus = jest.fn(e => log.push(['bubble', e.currentTarget]));
          const onFocusCapture = jest.fn(e =>
            log.push(['capture', e.currentTarget]),
          );

          /** 返回 tabIndex=0 的 div，注册 focus 两阶段并提供 ref，作为按钮内独立子根的聚焦目标。 */
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

          /** 返回注册 focus 两阶段的按钮和 childRef 容器，测试在容器另建子根，使 DOM focus 路径跨两个根。 */
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

        /** 按钮的子 div 通过 portal 挂到独立 body 容器；先聚焦按钮再聚焦 div，断言按钮/div 四阶段顺序及累计计数，验证合成 focus 沿 portal 的 React 祖先传播；最后移除容器。 */
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

          /** 返回可聚焦且有 focus 两阶段回调的 div，经独立容器 portal 渲染，用 ref 触发聚焦。 */
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

          /** 返回带 focus 两阶段回调的按钮和 Child portal，连接 DOM 分离的 div 与按钮的 React 祖先路径。 */
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

        /** portal 内可聚焦 div 外包原生 focusin stopPropagation 节点；聚焦按钮后再聚焦 div，捕获累计为 3、冒泡仍为 1，验证中间原生监听挡住 portal 的冒泡处理；最后移除容器。 */
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

          /** 返回中间 div 包可聚焦目标 div；目标有 focus 两阶段回调，中间 ref 供原生 focusin stopPropagation 注册。 */
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

          /** layout effect 在中间 div 注册原生 focusin 阻断回调；返回有 focus 两阶段回调的按钮和 Child portal，构造捕获成功而冒泡受阻的路径。 */
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

        /** 按钮与独立容器中的 portal div 注册 enter/leave；用 relatedTarget=null 进入按钮，再以互指 relatedTarget 的 out/over 从按钮移到 portal div，断言只再 enter div、没有 leave 按钮，验证共同 React 祖先被排除。 */
        it('handle propagation of enter and leave events between portals', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const log = [];
          const onMouseEnter = jest.fn(e => log.push(e.currentTarget));
          const onMouseLeave = jest.fn(e => log.push(e.currentTarget));

          const portalElement = document.createElement('div');
          document.body.appendChild(portalElement);

          /** 返回带 mouseenter/mouseleave mock 与 divRef 的 portal div，用 relatedTarget 成对事件检验按钮到 div 的进入路径。 */
          function Child() {
            return (
              <div
                ref={divRef}
                onMouseEnter={onMouseEnter}
                onMouseLeave={onMouseLeave}
              />
            );
          }

          /** 返回带 enter/leave mock 的按钮及挂到独立容器的 Child portal，给共同 React 祖先计算提供父按钮。 */
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

        /** layout effect 把 portal div 挂到按钮内的 div 容器；先从外部进入按钮，再模拟按钮到 portal div 的成对 out/over，断言总 enter 2 次、leave 0 次且目标为按钮→div，验证嵌套 portal 的共同祖先计算。 */
        it('handle propagation of enter and leave events between portals #2', async () => {
          const buttonRef = React.createRef();
          const divRef = React.createRef();
          const portalRef = React.createRef();
          const log = [];
          const onMouseEnter = jest.fn(e => log.push(e.currentTarget));
          const onMouseLeave = jest.fn(e => log.push(e.currentTarget));

          /** 返回带 enter/leave mock 与 divRef 的 div，供 layout effect 建立的嵌套 portal 作为鼠标移动目标。 */
          function Child() {
            return (
              <div
                ref={divRef}
                onMouseEnter={onMouseEnter}
                onMouseLeave={onMouseLeave}
              />
            );
          }

          /** 初始 portal state 为 null，layout effect 把 Child 挂到 portalRef 容器并更新 state；返回有 enter/leave mock 的按钮和目标容器。 */
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

        /** portal 容器经 layout effect 插回根的 DOM 内，并在容器上先注册可开关的原生停止传播回调；普通点击得到根捕获→portal 捕获→portal 冒泡→根冒泡；开启停止后 legacy FB 只保留捕获，普通模式仍有四条，验证不同委托位置的实测结果。 */
        it('should preserve bubble/capture order between roots and nested portals', async () => {
          const targetRef = React.createRef();
          let log = [];
          const onClickRoot = jest.fn(e => log.push('bubble root'));
          const onClickCaptureRoot = jest.fn(e => log.push('capture root'));
          const onClickPortal = jest.fn(e => log.push('bubble portal'));
          const onClickCapturePortal = jest.fn(e => log.push('capture portal'));

          /** 返回带 portal 捕获/冒泡 mock 的 div 并提供 targetRef，作为可开关原生阻断场景的唯一点击目标。 */
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

          /** 返回带 root 捕获/冒泡 mock 的 div、portal 插槽及 Portal；layout effect 把外建 portalContainer append 到插槽，使原生 DOM 与 portal 路径重合。 */
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
              // portal 容器自己的 React 冒泡监听仍会执行，并在同一次合成派发中调用 React 祖先回调。
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

          /** 启用 EventHandle API，组件 effect 拟在 div ref 注册 click；仅服务器 renderToString，断言输出 Hello world 的 div HTML，验证服务器渲染无需执行该客户端 effect。 */
          // @gate www
          it('can render correctly with the ReactDOMServer', () => {
            const clickEvent = jest.fn();
            const setClick = ReactDOM.unstable_createEventHandle('click');

            /** 返回 Hello world 的 div；effect 计划把 clickEvent 注册到本地 ref 并返回解除函数，服务器 renderToString 不执行该 effect。 */
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

          /** 服务器生成包含 span 的 HTML，客户端 hydrateRoot 后 effect 在 span 注册 click handle；点击水合 span 时回调一次，验证水合后 ref 和 handle 可用于派发。 */
          // @gate www
          it('can render correctly with the ReactDOMServer hydration', async () => {
            const clickEvent = jest.fn();
            const spanRef = React.createRef();
            const setClick = ReactDOM.unstable_createEventHandle('click');

            /** 返回 div 内的 Hello world span；effect 在 spanRef 注册 clickEvent 并返回解除函数，供服务器 HTML 水合后派发点击。 */
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

          /** 在按钮上注册 click handle 后点击内 div，断言 phase=3、currentTarget=按钮、target=div；render(null) 后旧节点不再计数，重新挂载和直接点击按钮恢复处理，换组件/回调后新 mock 各收到一次，验证注册、清理与回调更新。 */
          // @gate www
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

            /** 返回按钮包 div 的宿主树；effect 在按钮 ref 注册 clickEvent 并返回解除函数，使 render(null) 后旧 div 的点击不再调用它。 */
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

            // 点击内层 div，检查注册目标与原始 target。
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

            // render(null) 卸载组件并清理 effect 后，旧节点的点击不再增加计数。
            await act(() => {
              root.render(null);
            });

            dispatchClickEvent(divElement);
            expect(clickEvent).toBeCalledTimes(1);

            // 在同一个 root 重新挂载组件，effect 再次注册监听。
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

            /** 接收 clickEvent2，返回同样的按钮/div 结构；每次 effect 把当前 prop 回调绑到按钮并返回解除函数，验证重新渲染时替换注册。 */
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

          /** 组件接收 off，effect 先在按钮注册 click handle；off=false 时内 div 点击回调一次，更新为 true 后立即调用解除函数并清空 mock，再点击为 0 次，验证显式清理能取消处理。 */
          // @gate www
          it('should correctly work for setting and clearing a basic "click" listener', async () => {
            const clickEvent = jest.fn();
            const divRef = React.createRef();
            const buttonRef = React.createRef();
            const setClick = ReactDOM.unstable_createEventHandle('click');

            /** 接收 off，返回按钮包 div；effect 注册 clickEvent 后在 off=true 时立即解除，同时把同一解除函数作为清理返回。 */
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

          /** 按钮上通过 effect 注册 click handle，事件直接派发到按钮的文本子节点；断言回调一次，验证文本目标能解析到可处理的宿主节点。 */
          // @gate www
          it('should handle the target being a text node', async () => {
            const clickEvent = jest.fn();
            const buttonRef = React.createRef();
            const setClick = ReactDOM.unstable_createEventHandle('click');

            /** 返回含文本的按钮；effect 在按钮注册 clickEvent 并返回解除函数，让用例直接向文本子节点派发 click。 */
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

          /** EventHandle 在按钮和内 div 分别注册捕获、冒泡并返回四个解除操作；按钮点击得到两条，清空日志后 div 点击得到按钮捕获→div 捕获→div 冒泡→按钮冒泡，验证 handle 的两阶段累积。 */
          // @gate www
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

            /** 返回按钮包 div；effect 在两节点各注册 click 捕获/冒泡，共四个 handle，并返回逐一解除它们的清理闭包。 */
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

          /** 按钮通过 EventHandle 注册两阶段，内 div 使用 onClick/onClickCapture；分别点击按钮和 div，断言二者组合成相同的四阶段顺序及累计 3 次，验证 handle 与 JSX 回调可共同累积。 */
          // @gate www
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

            /** 返回没有 JSX 点击回调的按钮，内 div 注册 JSX 两阶段；effect 在按钮另注册两阶段 handle，其清理闭包调用无参 setter，本例仅执行注册后的传播断言。 */
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

          /** 实际把 click handle 绑在内 div；点击 div 断言 currentTarget 和 target 都为 div，render(null) 后旧 div 不再计数，重新挂载后恢复；最后点击外按钮不增加计数，验证内部监听不处理祖先点击。 */
          // @gate www
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

            /** 返回按钮包 div；effect 实际在内 div 注册 clickEvent 并返回解除函数，供区分 div 自身点击与外按钮点击。 */
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

            // 点击内层 div，检查注册目标与原始 target。
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

            // render(null) 卸载组件并清理 effect 后，旧节点的点击不再增加计数。
            await act(() => {
              root.render(null);
            });

            dispatchClickEvent(divElement);
            expect(clickEvent).toBeCalledTimes(1);

            // 在同一个 root 重新挂载组件，effect 再次注册监听。
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

          /** 同一按钮先注册两个捕获及两个冒泡 handle，每个 mock 点击后一次；再换成新组件并用四个冒泡 handle 注册，第二次点击每个累计两次，验证同节点多 handle 都能执行并在替换后继续注册。 */
          // @gate www
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

            /** 返回按钮，effect 用四个外部 setter 注册 targetListener1–4，再返回逐一解除的闭包，首轮包含捕获和冒泡两类。 */
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

            /** 返回按钮并用已替换的四个冒泡 setter 注册原 mock，effect 返回四项解除闭包；替换组件后验证每个计数继续累加。 */
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

          /** 按钮注册普通 click handle，内 div 另注册会 stopPropagation 的 handle；点击 div 后按钮 mock 为 0 次，验证内目标停止传播挡住祖先的 handle。 */
          // @gate www
          it('should correctly handle stopPropagation correctly for target events', async () => {
            const buttonRef = React.createRef();
            const divRef = React.createRef();
            const clickEvent = jest.fn();
            const setClick1 = ReactDOM.unstable_createEventHandle('click', {
              bind: buttonRef,
            });
            const setClick2 = ReactDOM.unstable_createEventHandle('click');

            /** 返回按钮包 div；effect 给按钮注册 clickEvent、给内 div 注册 stopPropagation，并返回两个解除操作，构造祖先 handle 被挡住的情形。 */
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

          /** 同一按钮注册四个都会 stopPropagation 的冒泡 handle；一次 click 后四个 mock 都为 1，验证停止向其他目标传播仍允许同一目标的同阶段回调执行。 */
          // @gate www
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

            /** 返回按钮；effect 在同一节点注册四个冒泡 handle，各 mock 都停止传播，清理闭包解除全部四项注册。 */
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

          /** 同一按钮注册两个捕获和两个冒泡 handle，每个都会 stopPropagation；点击后两个捕获各执行一次、两个冒泡均为 0，验证同目标捕获队列执行完后停止进入冒泡。 */
          // @gate www
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

            /** 返回按钮；effect 在同节点注册两个捕获和两个冒泡 handle，回调均停止传播，清理闭包解除四项，检验阶段间停止。 */
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

          /** layout effect 为按钮注册捕获 counter 的 click 回调；提交 counter=0 后点击记录 0，transition 渲染 counter=1 只让出而未提交时仍记录 0，完成提交后记录 1，验证回调以最近提交的 effect 为准。 */
          // @gate www
          it('should work with concurrent mode updates', async () => {
            const log = [];
            const ref = React.createRef();
            const setClick1 = ReactDOM.unstable_createEventHandle('click');

            /** 接收 counter，render 时记录 Test 并返回按钮；layout effect 让点击闭包记录此次 counter，并返回解除函数，区分尚未提交与已提交的注册。 */
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

          /** effect 在 window 注册 click handle，点击 body 断言 phase=3、currentTarget=window、target=body；render(null) 后再点不增加计数，重新挂载后计数到 2，验证全局目标的注册与清理。 */
          // @gate www
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

            /** 返回 Click anything! 按钮；effect 把 clickEvent 绑到 window 并返回解除函数，事件目标可为按钮之外的 body。 */
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

            // render(null) 卸载组件并清理 effect 后，旧节点的点击不再增加计数。

            await act(() => {
              root.render(null);
            });

            dispatchClickEvent(document.body);
            expect(clickEvent).toBeCalledTimes(1);

            // 在同一 root 重新挂载并注册 window handle，再点击 body。
            await act(() => {
              root.render(<Test />);
            });

            dispatchClickEvent(document.body);
            expect(clickEvent).toBeCalledTimes(2);
          });

          /** 在 window、按钮、内 div 注册捕获和冒泡 handle；按钮点击得到 window 捕获→按钮捕获→按钮冒泡→window 冒泡，清空后 div 点击补上 div 两阶段、每阶段各 3 次，验证全局与宿主目标路径。 */
          // @gate www
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

            /** 返回按钮包 div；effect 在 window、按钮、div 各注册捕获/冒泡 handle，清理闭包解除六项，让日志包含完整宿主及全局路径。 */
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

          /** window 捕获 handle 会 stopPropagation，按钮捕获/冒泡和 window 冒泡另有 mock；点击按钮后只有 window 捕获执行一次，验证在最外捕获目标停止会挡住后续目标和冒泡。 */
          // @gate www
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

            /** 返回按钮；effect 分别注册 window 捕获停止回调、按钮捕获/冒泡及 window 冒泡，清理解除四项，构造最外捕获截断路径。 */
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

          /** window 上注册两个捕获及两个冒泡 handle，首个捕获会停止传播；点击按钮后两个捕获均一次而两个冒泡为 0，验证同 window 的捕获队列仍执行，但不会进入冒泡。 */
          // @gate www
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

            /** 返回按钮；effect 只在 window 注册两个捕获和两个冒泡 handle，首个捕获停止传播，清理闭包解除四项。 */
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

          /** window、document、按钮、div 各注册两阶段 handle；分别点击按钮与 div，捕获始终由 window 向目标；普通模式冒泡从目标回到 document/window，legacy FB 的 document 冒泡先于宿主冒泡，逐条断言开关对应顺序和各阶段计数。 */
          // @gate www
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

            /** 返回按钮包 div；effect 在 window、document、按钮、div 各注册捕获/冒泡 handle，并返回八项解除操作，记录不同委托模式下的顺序。 */
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

          /** 启用 EventHandle API 后传入 custom-event 名称，断言立即抛出“不属于 React 已知事件”的具体错误，验证不支持的事件类型在创建 handle 时被拒绝。 */
          // @gate www
          it('does not support custom user events', () => {
            // eager listener 模式无法预先知道全部自定义事件，因此该 API 不支持自定义事件。
            // 这里断言它会抛错，避免出现 portal 不冒泡等不一致行为。
            expect(() => {
              ReactDOM.unstable_createEventHandle('custom-event');
            }).toThrow(
              'Cannot call unstable_createEventHandle with "custom-event", as it is not an event known to React.',
            );
          });

          /** 外 div 注册 beforeblur，document 注册 afterblur，show=true 的 input 先聚焦且没有回调；更新 show=false 移除 input 后各一次，日志 beforeblur→afterblur、afterblur.relatedTarget 为旧 input，验证提交删除的焦点通知。 */
          // @gate www
          it('beforeblur and afterblur are called after a focused element is unmounted', async () => {
            const log = [];
            // 稍后检查 mock 捕获的事件及 relatedTarget；现代 SyntheticEvent 不再池化，persist() 保留为兼容空操作。
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

            /** 接收 show，返回保留的外 div、可移除 input 和另一 div；effect 在 document 注册 afterblur、外 div 注册 beforeblur，并返回两项清理。 */
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

          /** 把聚焦 input 放在额外内 div 中，外 div/document 注册 beforeblur/afterblur；删除整段内树后各回调一次、顺序 beforeblur→afterblur 且 relatedTarget 为旧 input，验证嵌套删除也通知保留的祖先。 */
          // @gate www
          it('beforeblur and afterblur are called after a nested focused element is unmounted', async () => {
            const log = [];
            // 稍后检查 mock 捕获的事件及 relatedTarget；现代 SyntheticEvent 不再池化，persist() 保留为兼容空操作。
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

            /** 接收 show，把可移除 input 再包进内 div，外 div 保留；effect 注册 document afterblur/外 div beforeblur 并返回解除闭包，供嵌套删除焦点用例。 */
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

          /** 保留外 div 与将删除的内 div 都注册 beforeblur，内 input 聚焦后删除内树；总回调仅一次，验证提交删除时跳过同一已删除子树里的 beforeblur handler。 */
          // @gate www
          it('beforeblur should skip handlers from a deleted subtree after the focused element is unmounted', async () => {
            const onBeforeBlur = jest.fn();
            const innerRef = React.createRef();
            const innerRef2 = React.createRef();
            const setBeforeBlurHandle =
              ReactDOM.unstable_createEventHandle('beforeblur');
            const ref2 = React.createRef();

            /** 接收 show，返回外 div 包条件内 div/input 与保留兄弟；effect 总注册外 beforeblur，仅 ref2 存在时注册内 beforeblur，清理按是否注册解除。 */
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

          /** 先提交并聚焦 Suspense 中的 input，随后令 Child 抛未决 Promise、提交 fallback 并清计时器；beforeblur/afterblur 各一次且按顺序发生，relatedTarget 指向旧 input，验证隐藏已聚焦 primary 的通知；最后 resolve 并移除容器，未断言揭示结果。 */
          // @gate www
          it('beforeblur and afterblur are called after a focused element is suspended', async () => {
            const log = [];
            // 稍后检查 mock 捕获的事件及 relatedTarget；现代 SyntheticEvent 不再池化，persist() 保留为兼容空操作。
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

            /** 不接收参数；读取 suspend，true 时抛共享 Promise，false 时返回 input 并暴露 innerRef，让已聚焦 primary 在更新时挂起。 */
            function Child() {
              if (suspend) {
                throw promise;
              } else {
                return <input ref={innerRef} />;
              }
            }

            /** 返回外 div 包 Suspense/Child；effect 在保留外 div 注册 beforeblur、document 注册 afterblur，并返回两项清理，使隐藏 primary 的通知可被观察。 */
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

          /** 保留外 div 与 Suspense primary 内 div 都注册 beforeblur；聚焦 input 后使 Child 抛 Promise 并提交 fallback，总 handler 仅一次，验证隐藏树内的监听不参与此次 beforeblur；末尾 resolve 并移除容器。 */
          // @gate www
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

            /** 读取 suspend，true 时抛共享 Promise，false 时返回 input；以相同 ref 供测试先聚焦后触发 Suspense 隐藏。 */
            function Child() {
              if (suspend) {
                throw promise;
              } else {
                return <input ref={innerRef} />;
              }
            }

            /** 返回外 div、Suspense 内的 ref2 div/Child 及保留兄弟；effect 在外/内 div 注册 beforeblur，返回有条件解除闭包，检验隐藏内树的 handler 被跳过。 */
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

          /** Suspense 初次显示聚焦 input，beforeblur handler 触发外组件 state 更新；令 Child 抛永不 settle 的 thenable 并等待 act 完成，验证再次提交已隐藏 primary 不反复触发此更新而形成循环；本例没有 blur 次数或 afterblur 断言。 */
          // @gate www
          it('regression: does not fire beforeblur/afterblur if target is already hidden', async () => {
            const Suspense = React.Suspense;
            let suspend = false;
            const fakePromise = {
              /** 模拟 thenable 的订阅方法，使 Suspense 保持在待决状态。 */
              /** 模拟 thenable 的空订阅方法；不调用 resolve/reject、不返回值，令抛出它的 Child 一直待决，复现已隐藏树再次提交的回归条件。 */
              then() {}
            };
            const setBeforeBlurHandle =
              ReactDOM.unstable_createEventHandle('beforeblur');
            const innerRef = React.createRef();

            /** 读取 suspend；true 时抛不 settle 的 fakePromise，false 时返回带 innerRef 的 input，提供初次聚焦与之后隐藏的同一子树。 */
            function Child() {
              if (suspend) {
                throw fakePromise;
              }
              return <input ref={innerRef} />;
            }

            /** 返回外 div 包 Suspense/Child；持有未读取的计数 state，effect 只注册一次 beforeblur，其回调递增 state 并返回解除函数，暴露重复隐藏通知造成的重渲染循环。 */
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

          /** 在外按钮与其注释子根渲染的 div 上用 effect 注册 EventHandle 两阶段；点击按钮后点击 div，断言按钮捕获→div 捕获→div 冒泡→按钮冒泡与累计 3 次，验证注释容器跨根 handle 路径。 */
          // @gate !disableCommentsAsDOMContainers
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

            /** 返回带 divRef 的 div；effect 在该 div 注册 click 捕获/冒泡 handle 并返回两项解除操作，供注释子根检验路径。 */
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

            /** 返回空按钮；effect 在按钮注册 click 捕获/冒泡 handle 并返回两项解除操作，随后测试把注释子根接到按钮 DOM。 */
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

            // 使用注释节点作为根容器，子树插入其父节点中并位于该注释之前。
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

          /** 只在父按钮注册 click EventHandle 捕获/冒泡，portal 的 div 本身无监听；点击 portal div 时父按钮捕获后冒泡各一次，验证已知事件无需内目标 handler 也会沿 portal 路径累积；末尾移除容器。 */
          // @gate www
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

            /** 仅返回带 divRef 的 portal div，不注册自身监听，让父按钮的 EventHandle 能否接到点击成为唯一断言。 */
            function Child() {
              return <div ref={divRef}>Click me!</div>;
            }

            /** 返回按钮和独立容器中的 Child portal；effect 只在按钮注册 click 捕获/冒泡 handle，并返回两项解除操作。 */
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

            /** Scope 包住按钮，effect 在 Scope 实例注册 click 的捕获/冒泡 handle；点击按钮时每阶段一次且 currentTarget 均为按钮，验证 Scope 回调采用所包住的宿主目标。 */
            // @gate www
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

              /** 返回 Scope 包按钮；effect 在 scopeRef 实例注册 click 捕获/冒泡 handle 并返回两项解除操作，日志以按钮 currentTarget 检验 Scope 分发。 */
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

            /** Scope 和内按钮用 handle 注册两阶段，最内 div 用 JSX 两阶段；点击按钮记录两组按钮回调，清空后点击 div 每阶段各 3 次、currentTarget 为按钮/按钮/div 及反向，验证 Scope 与宿主监听的组合顺序。 */
            // @gate www
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

              /** 返回 Scope 包按钮/内 div，div 用 JSX 回调；effect 在 Scope 和按钮各注册两阶段 handle，清理解除四项，构造三层监听组合。 */
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

            /** 按钮仅把文本放进 Scope，Scope 自身注册 click handle；向文本节点派发 click 后 mock 为 0，验证目标实例解析到 Scope 外的按钮时不会调用该 Scope 的监听。 */
            // @gate www
            it('should not handle the target being a dangling text node within a scope', async () => {
              const clickEvent = jest.fn();
              const buttonRef = React.createRef();
              const TestScope = React.unstable_Scope;
              const setClick = ReactDOM.unstable_createEventHandle('click');

              /** 返回按钮包仅含文本的 Scope；effect 只在 Scope 实例注册 clickEvent 并返回解除函数，文本目标解析到外按钮用于检验未调用。 */
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

            /** 两层 Scope 的内层冒泡 handler 会 stopPropagation、外层为普通 mock；点击按钮后内层一次、外层 0 次，验证内 Scope 停止向外 Scope 传播。 */
            // @gate www
            it('handle stopPropagation (inner) correctly between scopes', async () => {
              const buttonRef = React.createRef();
              const outerOnClick = jest.fn();
              const innerOnClick = jest.fn(e => e.stopPropagation());
              const TestScope = React.unstable_Scope;
              const TestScope2 = React.unstable_Scope;
              const setClick = ReactDOM.unstable_createEventHandle('click');

              /** 返回两层 Scope 包按钮；effect 将普通冒泡 mock 绑到外 Scope、停止传播 mock 绑到内 Scope，返回两项解除操作。 */
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

            /** 两层 Scope 的外层冒泡 handler 会 stopPropagation、内层为普通 mock；点击按钮后内外各一次，验证先到达内层，再由外层停止继续传播。 */
            // @gate www
            it('handle stopPropagation (outer) correctly between scopes', async () => {
              const buttonRef = React.createRef();
              const outerOnClick = jest.fn(e => e.stopPropagation());
              const innerOnClick = jest.fn();
              const TestScope = React.unstable_Scope;
              const TestScope2 = React.unstable_Scope;
              const setClick = ReactDOM.unstable_createEventHandle('click');

              /** 返回两层 Scope 包按钮；effect 将停止传播 mock 绑到外 Scope、普通 mock 绑到内 Scope，返回两项解除操作，检验内先外后。 */
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

            /** 两层 Scope 共享同一会 stopPropagation 的冒泡 mock；点击最内按钮后总次数为 1，验证内 Scope 停止后不会再调用外 Scope 的同一函数。 */
            // @gate www
            it('handle stopPropagation (inner and outer) correctly between scopes', async () => {
              const buttonRef = React.createRef();
              const onClick = jest.fn(e => e.stopPropagation());
              const TestScope = React.unstable_Scope;
              const TestScope2 = React.unstable_Scope;
              const setClick = ReactDOM.unstable_createEventHandle('click');

              /** 返回两层 Scope 包按钮；effect 在内外 Scope 注册同一停止传播 mock 并返回两项解除操作，以总调用次数判断内层是否截断外层。 */
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

            /** 内根 div 用 EventHandle 为 touchstart/touchmove/wheel 注册 preventDefault 回调，外容器原生监听记录类型和 defaultPrevented；派发三种可取消事件后类型全收到、defaultPrevented 列表为空，验证此测试环境中 passive 注册使取消无效。 */
            // @gate www
            it('should be able to register handlers for events affected by the intervention', async () => {
              const rootContainer = document.createElement('div');
              container.appendChild(rootContainer);

              const allEvents = [];
              const defaultPreventedEvents = [];
              /** 接收原生事件 e，把 type 追加到 allEvents，仅在 defaultPrevented 为真时追加到另一个列表；无返回值，用于观察 handle.preventDefault 的结果。 */
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

              /** 返回带 ref 的 div；effect 为 touchstart/touchmove/wheel 注册调用 preventDefault 的 handle，并返回三项解除操作，让外容器原生监听观察 passive 取消结果。 */
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
