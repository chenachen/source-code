/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails reactcore
 */

'use strict';

let React;
let ReactDOMClient;
let ReactDOM;
let createPortal;
let act;
let container;
let Fragment;
let Activity;
let mockIntersectionObserver;
let simulateIntersection;
let setClientRects;
let mockRangeClientRects;
let assertConsoleErrorDev;
let assertConsoleWarnDev;

/** `Wrapper`：封装当前用例复用的操作、回调或断言步骤。 */
function Wrapper({children}) {
  return children;
}

describe('FragmentRefs', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    Fragment = React.Fragment;
    Activity = React.Activity;
    ReactDOMClient = require('react-dom/client');
    ReactDOM = require('react-dom');
    createPortal = ReactDOM.createPortal;
    act = require('internal-test-utils').act;
    const IntersectionMocks = require('./utils/IntersectionMocks');
    mockIntersectionObserver = IntersectionMocks.mockIntersectionObserver;
    simulateIntersection = IntersectionMocks.simulateIntersection;
    setClientRects = IntersectionMocks.setClientRects;
    mockRangeClientRects = IntersectionMocks.mockRangeClientRects;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
    assertConsoleWarnDev = require('internal-test-utils').assertConsoleWarnDev;

    container = document.createElement('div');
    document.body.innerHTML = '';
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  // @gate enableFragmentRefs
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「attaches a ref to Fragment」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 reconciler Fragment ref 与 DOM 宿主实例查询路径。
   */
  it('attaches a ref to Fragment', async () => {
    const fragmentRef = React.createRef();
    const root = ReactDOMClient.createRoot(container);

    await act(() =>
      root.render(
        <div id="parent">
          <Fragment ref={fragmentRef}>
            <div id="child">Hi</div>
          </Fragment>
        </div>,
      ),
    );
    expect(container.innerHTML).toEqual(
      '<div id="parent"><div id="child">Hi</div></div>',
    );

    expect(fragmentRef.current).not.toBe(null);
  });

  // @gate enableFragmentRefs
  /** 测试场景：验证「accepts a ref callback」描述的渲染、交互或错误处理结果。 */
  it('accepts a ref callback', async () => {
    let fragmentRef;
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(
        <Fragment ref={ref => (fragmentRef = ref)}>
          <div id="child">Hi</div>
        </Fragment>,
      );
    });

    expect(fragmentRef._fragmentFiber).toBeTruthy();
  });

  // @gate enableFragmentRefs
  /** 测试场景：验证「is available in effects」描述的渲染、交互或错误处理结果。 */
  it('is available in effects', async () => {
    /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
    function Test() {
      const fragmentRef = React.useRef(null);
      React.useLayoutEffect(() => {
        expect(fragmentRef.current).not.toBe(null);
      });
      React.useEffect(() => {
        expect(fragmentRef.current).not.toBe(null);
      });
      return (
        <Fragment ref={fragmentRef}>
          <div />
        </Fragment>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<Test />));
  });

  // @gate enableFragmentRefs && enableFragmentRefsInstanceHandles
  /** 测试场景：验证「attaches fragment handles to nodes」描述的渲染、交互或错误处理结果。 */
  it('attaches fragment handles to nodes', async () => {
    const fragmentParentRef = React.createRef();
    const fragmentRef = React.createRef();

    /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
    function Test({show}) {
      return (
        <Fragment ref={fragmentParentRef}>
          <Fragment ref={fragmentRef}>
            <div id="childA">A</div>
            <div id="childB">B</div>
          </Fragment>
          <div id="childC">C</div>
          {show && <div id="childD">D</div>}
        </Fragment>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<Test show={false} />));

    const childA = document.querySelector('#childA');
    const childB = document.querySelector('#childB');
    const childC = document.querySelector('#childC');

    expect(childA.reactFragments.has(fragmentRef.current)).toBe(true);
    expect(childB.reactFragments.has(fragmentRef.current)).toBe(true);
    expect(childC.reactFragments.has(fragmentRef.current)).toBe(false);
    expect(childA.reactFragments.has(fragmentParentRef.current)).toBe(true);
    expect(childB.reactFragments.has(fragmentParentRef.current)).toBe(true);
    expect(childC.reactFragments.has(fragmentParentRef.current)).toBe(true);

    await act(() => root.render(<Test show={true} />));

    const childD = document.querySelector('#childD');
    expect(childD.reactFragments.has(fragmentRef.current)).toBe(false);
    expect(childD.reactFragments.has(fragmentParentRef.current)).toBe(true);
  });

  describe('focus methods', () => {
    describe('focus()', () => {
      // @gate enableFragmentRefs
      /** 测试场景：验证「focuses the first focusable child」描述的渲染、交互或错误处理结果。 */
      it('focuses the first focusable child', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          return (
            <div>
              <Fragment ref={fragmentRef}>
                <div id="child-a" />
                <style>{`#child-c {}`}</style>
                <a id="child-b" href="/">
                  B
                </a>
                <a id="child-c" href="/">
                  C
                </a>
              </Fragment>
            </div>
          );
        }

        await act(() => {
          root.render(<Test />);
        });

        await act(() => {
          fragmentRef.current.focus();
        });
        expect(document.activeElement.id).toEqual('child-b');
        document.activeElement.blur();
      });

      // @gate enableFragmentRefs
      /** 测试场景：验证「focuses deeply nested focusable children, depth first」描述的渲染、交互或错误处理结果。 */
      it('focuses deeply nested focusable children, depth first', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          return (
            <Fragment ref={fragmentRef}>
              <div id="child-a">
                <div tabIndex={0} id="grandchild-a">
                  <a id="greatgrandchild-a" href="/" />
                </div>
              </div>
              <a id="child-b" href="/" />
            </Fragment>
          );
        }
        await act(() => {
          root.render(<Test />);
        });
        await act(() => {
          fragmentRef.current.focus();
        });
        expect(document.activeElement.id).toEqual('grandchild-a');
      });

      // @gate enableFragmentRefs
      /** 测试场景：验证「preserves document order when adding and removing children」描述的渲染、交互或错误处理结果。 */
      it('preserves document order when adding and removing children', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test({showA, showB}) {
          return (
            <Fragment ref={fragmentRef}>
              {showA && <a href="/" id="child-a" />}
              {showB && <a href="/" id="child-b" />}
            </Fragment>
          );
        }

        // 让 A 成为第一个可聚焦子节点。
        await act(() => {
          root.render(<Test showA={true} showB={false} />);
        });
        await act(() => {
          fragmentRef.current.focus();
        });
        expect(document.activeElement.id).toEqual('child-a');
        document.activeElement.blur();
        // A 仍是第一个可聚焦子节点，但 B 也已被跟踪。
        await act(() => {
          root.render(<Test showA={true} showB={true} />);
        });
        await act(() => {
          fragmentRef.current.focus();
        });
        expect(document.activeElement.id).toEqual('child-a');
        document.activeElement.blur();

        // 现在 B 是第一个可聚焦子节点。
        await act(() => {
          root.render(<Test showA={false} showB={true} />);
        });
        await act(() => {
          fragmentRef.current.focus();
        });
        expect(document.activeElement.id).toEqual('child-b');
        document.activeElement.blur();
      });

      // @gate enableFragmentRefs
      /** 测试场景：验证「keeps focus on the first focusable child if already focused」描述的渲染、交互或错误处理结果。 */
      it('keeps focus on the first focusable child if already focused', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          return (
            <Fragment ref={fragmentRef}>
              <a id="child-a" href="/">
                A
              </a>
              <a id="child-b" href="/">
                B
              </a>
            </Fragment>
          );
        }

        await act(() => {
          root.render(<Test />);
        });

        // 手动聚焦第一个子元素
        document.getElementById('child-a').focus();
        expect(document.activeElement.id).toEqual('child-a');

        // 调用 fragment.focus() 后，焦点应留在 child-a，不应跳到 child-b。
        await act(() => {
          fragmentRef.current.focus();
        });
        expect(document.activeElement.id).toEqual('child-a');
        document.activeElement.blur();
      });

      // @gate enableFragmentRefs
      /** 测试场景：验证「keeps focus on a nested child if already focused」描述的渲染、交互或错误处理结果。 */
      it('keeps focus on a nested child if already focused', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          return (
            <Fragment ref={fragmentRef}>
              <div>
                <input id="nested-input" />
              </div>
              <a id="sibling-link" href="/">
                Link
              </a>
            </Fragment>
          );
        }

        await act(() => {
          root.render(<Test />);
        });

        // 手动聚焦嵌套的输入框
        document.getElementById('nested-input').focus();
        expect(document.activeElement.id).toEqual('nested-input');

        // 调用 fragment.focus() 应该保持嵌套输入的焦点。
        await act(() => {
          fragmentRef.current.focus();
        });
        expect(document.activeElement.id).toEqual('nested-input');
        document.activeElement.blur();
      });

      // @gate enableFragmentRefs
      /** 测试场景：验证「focuses the first focusable child in a fieldset」描述的渲染、交互或错误处理结果。 */
      it('focuses the first focusable child in a fieldset', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          return (
            <Fragment ref={fragmentRef}>
              <fieldset>
                <legend>Shipping</legend>
                <input id="street" name="street" />
                <input id="city" name="city" />
              </fieldset>
            </Fragment>
          );
        }

        await act(() => {
          root.render(<Test />);
        });
        await act(() => {
          fragmentRef.current.focus();
        });
        expect(document.activeElement.id).toEqual('street');
        document.activeElement.blur();
      });
    });

    describe('focusLast()', () => {
      // @gate enableFragmentRefs
      /** 测试场景：验证「focuses the last focusable child」描述的渲染、交互或错误处理结果。 */
      it('focuses the last focusable child', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          return (
            <div>
              <Fragment ref={fragmentRef}>
                <a id="child-a" href="/">
                  A
                </a>
                <a id="child-b" href="/">
                  B
                </a>
                <Wrapper>
                  <a id="child-c" href="/">
                    C
                  </a>
                </Wrapper>
                <div id="child-d" />
                <style id="child-e">{`#child-d {}`}</style>
              </Fragment>
            </div>
          );
        }

        await act(() => {
          root.render(<Test />);
        });

        await act(() => {
          fragmentRef.current.focusLast();
        });
        expect(document.activeElement.id).toEqual('child-c');
        document.activeElement.blur();
      });

      // @gate enableFragmentRefs
      /** 测试场景：验证「focuses deeply nested focusable children, depth first」描述的渲染、交互或错误处理结果。 */
      it('focuses deeply nested focusable children, depth first', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          return (
            <Fragment ref={fragmentRef}>
              <div id="child-a" href="/">
                <a id="grandchild-a" href="/" />
                <a id="grandchild-b" href="/" />
              </div>
              <div tabIndex={0} id="child-b">
                <a id="grandchild-a" href="/" />
                <a id="grandchild-b" href="/" />
              </div>
            </Fragment>
          );
        }
        await act(() => {
          root.render(<Test />);
        });
        await act(() => {
          fragmentRef.current.focusLast();
        });
        expect(document.activeElement.id).toEqual('grandchild-b');
      });
    });

    describe('blur()', () => {
      // @gate enableFragmentRefs
      /** 测试场景：验证「removes focus from an element inside of the Fragment」描述的渲染、交互或错误处理结果。 */
      it('removes focus from an element inside of the Fragment', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          return (
            <Fragment ref={fragmentRef}>
              <a id="child-a" href="/">
                A
              </a>
            </Fragment>
          );
        }

        await act(() => {
          root.render(<Test />);
        });

        await act(() => {
          fragmentRef.current.focus();
        });
        expect(document.activeElement.id).toEqual('child-a');

        await act(() => {
          fragmentRef.current.blur();
        });
        expect(document.activeElement).toEqual(document.body);
      });

      // @gate enableFragmentRefs
      /** 测试场景：验证「removes focus from a nested element inside of the Fragment」描述的渲染、交互或错误处理结果。 */
      it('removes focus from a nested element inside of the Fragment', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          return (
            <Fragment ref={fragmentRef}>
              <div>
                <input id="nested-input" />
              </div>
            </Fragment>
          );
        }

        await act(() => {
          root.render(<Test />);
        });

        await act(() => {
          fragmentRef.current.focus();
        });
        expect(document.activeElement.id).toEqual('nested-input');

        await act(() => {
          fragmentRef.current.blur();
        });
        expect(document.activeElement).toEqual(document.body);
      });

      // @gate enableFragmentRefs
      /** 测试场景：验证「does not remove focus from elements outside of the Fragment」描述的渲染、交互或错误处理结果。 */
      it('does not remove focus from elements outside of the Fragment', async () => {
        const fragmentRefA = React.createRef();
        const fragmentRefB = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          return (
            <Fragment ref={fragmentRefA}>
              <a id="child-a" href="/">
                A
              </a>
              <Fragment ref={fragmentRefB}>
                <a id="child-b" href="/">
                  B
                </a>
              </Fragment>
            </Fragment>
          );
        }

        await act(() => {
          root.render(<Test />);
        });

        await act(() => {
          fragmentRefA.current.focus();
        });
        expect(document.activeElement.id).toEqual('child-a');

        await act(() => {
          fragmentRefB.current.blur();
        });
        expect(document.activeElement.id).toEqual('child-a');
      });
    });
  });

  describe('events', () => {
    describe('add/remove event listeners', () => {
      // @gate enableFragmentRefs
      /** 测试场景：验证「adds and removes event listeners from children」描述的渲染、交互或错误处理结果。 */
      it('adds and removes event listeners from children', async () => {
        const parentRef = React.createRef();
        const fragmentRef = React.createRef();
        const childARef = React.createRef();
        const childBRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        let logs = [];

        /** `handleFragmentRefClicks`：封装当前用例复用的操作、回调或断言步骤。 */
        function handleFragmentRefClicks() {
          logs.push('fragmentRef');
        }

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          React.useEffect(() => {
            fragmentRef.current.addEventListener(
              'click',
              handleFragmentRefClicks,
            );

            return () => {
              fragmentRef.current.removeEventListener(
                'click',
                handleFragmentRefClicks,
              );
            };
          }, []);
          return (
            <div ref={parentRef}>
              <Fragment ref={fragmentRef}>
                <>Text</>
                <div ref={childARef}>A</div>
                <>
                  <div ref={childBRef}>B</div>
                </>
              </Fragment>
            </div>
          );
        }

        await act(() => {
          root.render(<Test />);
        });

        childARef.current.addEventListener('click', () => {
          logs.push('A');
        });

        childBRef.current.addEventListener('click', () => {
          logs.push('B');
        });

        // 单击父节点不应触发任何监听器。
        parentRef.current.click();
        expect(logs).toEqual([]);

        // 点击子节点会触发它自身以及 Fragment 的监听器。
        childARef.current.click();
        expect(logs).toEqual(['fragmentRef', 'A']);

        logs = [];

        childBRef.current.click();
        expect(logs).toEqual(['fragmentRef', 'B']);

        logs = [];

        fragmentRef.current.removeEventListener(
          'click',
          handleFragmentRefClicks,
        );

        childARef.current.click();
        expect(logs).toEqual(['A']);

        logs = [];

        childBRef.current.click();
        expect(logs).toEqual(['B']);
      });

      // @gate enableFragmentRefs
      /** 测试场景：验证「adds and removes event listeners from children with multiple fragments」描述的渲染、交互或错误处理结果。 */
      it('adds and removes event listeners from children with multiple fragments', async () => {
        const fragmentRef = React.createRef();
        const nestedFragmentRef = React.createRef();
        const nestedFragmentRef2 = React.createRef();
        const childARef = React.createRef();
        const childBRef = React.createRef();
        const childCRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        await act(() => {
          root.render(
            <div>
              <Fragment ref={fragmentRef}>
                <div ref={childARef}>A</div>
                <div>
                  <Fragment ref={nestedFragmentRef}>
                    <div ref={childBRef}>B</div>
                  </Fragment>
                </div>
                <Fragment ref={nestedFragmentRef2}>
                  <div ref={childCRef}>C</div>
                </Fragment>
              </Fragment>
            </div>,
          );
        });

        let logs = [];

        /** `handleFragmentRefClicks`：封装当前用例复用的操作、回调或断言步骤。 */
        function handleFragmentRefClicks() {
          logs.push('fragmentRef');
        }

        /** `handleNestedFragmentRefClicks`：封装当前用例复用的操作、回调或断言步骤。 */
        function handleNestedFragmentRefClicks() {
          logs.push('nestedFragmentRef');
        }

        /** `handleNestedFragmentRef2Clicks`：封装当前用例复用的操作、回调或断言步骤。 */
        function handleNestedFragmentRef2Clicks() {
          logs.push('nestedFragmentRef2');
        }

        fragmentRef.current.addEventListener('click', handleFragmentRefClicks);
        nestedFragmentRef.current.addEventListener(
          'click',
          handleNestedFragmentRefClicks,
        );
        nestedFragmentRef2.current.addEventListener(
          'click',
          handleNestedFragmentRef2Clicks,
        );

        childBRef.current.click();
        // 事件冒泡到父 Fragment。
        expect(logs).toEqual(['nestedFragmentRef', 'fragmentRef']);

        logs = [];

        childARef.current.click();
        expect(logs).toEqual(['fragmentRef']);

        logs = [];
        childCRef.current.click();
        expect(logs).toEqual(['fragmentRef', 'nestedFragmentRef2']);

        logs = [];

        fragmentRef.current.removeEventListener(
          'click',
          handleFragmentRefClicks,
        );
        nestedFragmentRef.current.removeEventListener(
          'click',
          handleNestedFragmentRefClicks,
        );
        childCRef.current.click();
        expect(logs).toEqual(['nestedFragmentRef2']);
      });

      // @gate enableFragmentRefs
      /** 测试场景：验证「adds an event listener to a newly added child」描述的渲染、交互或错误处理结果。 */
      it('adds an event listener to a newly added child', async () => {
        const fragmentRef = React.createRef();
        const childRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);
        let showChild;

        /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
        function Component() {
          const [shouldShowChild, setShouldShowChild] = React.useState(false);
          showChild = () => {
            setShouldShowChild(true);
          };

          return (
            <div>
              <Fragment ref={fragmentRef}>
                <div id="a">A</div>
                {shouldShowChild && (
                  <div ref={childRef} id="b">
                    B
                  </div>
                )}
              </Fragment>
            </div>
          );
        }

        await act(() => {
          root.render(<Component />);
        });

        expect(fragmentRef.current).not.toBe(null);
        expect(childRef.current).toBe(null);

        let hasClicked = false;
        fragmentRef.current.addEventListener('click', () => {
          hasClicked = true;
        });

        await act(() => {
          showChild();
        });
        expect(childRef.current).not.toBe(null);

        childRef.current.click();
        expect(hasClicked).toBe(true);
      });

      // @gate enableFragmentRefs
      /** 测试场景：验证「applies event listeners to host children nested within non-host children」描述的渲染、交互或错误处理结果。 */
      it('applies event listeners to host children nested within non-host children', async () => {
        const fragmentRef = React.createRef();
        const childRef = React.createRef();
        const nestedChildRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        await act(() => {
          root.render(
            <div>
              <Fragment ref={fragmentRef}>
                <div ref={childRef}>Host A</div>
                <Wrapper>
                  <Wrapper>
                    <Wrapper>
                      <div ref={nestedChildRef}>Host B</div>
                    </Wrapper>
                  </Wrapper>
                </Wrapper>
              </Fragment>
            </div>,
          );
        });
        const logs = [];
        fragmentRef.current.addEventListener('click', e => {
          logs.push(e.target.textContent);
        });

        expect(logs).toEqual([]);
        childRef.current.click();
        expect(logs).toEqual(['Host A']);
        nestedChildRef.current.click();
        expect(logs).toEqual(['Host A', 'Host B']);
      });

      // @gate enableFragmentRefs
      /** 测试场景：验证「allows adding and cleaning up listeners in effects」描述的渲染、交互或错误处理结果。 */
      it('allows adding and cleaning up listeners in effects', async () => {
        const root = ReactDOMClient.createRoot(container);

        let logs = [];
        /** `logClick`：封装当前用例复用的操作、回调或断言步骤。 */
        function logClick(e) {
          logs.push(e.currentTarget.id);
        }

        let rerender;
        let removeEventListeners;

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          const fragmentRef = React.useRef(null);
          // eslint-disable-next-line no-unused-vars
          const [_, setState] = React.useState(0);
          rerender = () => {
            setState(p => p + 1);
          };
          removeEventListeners = () => {
            fragmentRef.current.removeEventListener('click', logClick);
          };
          React.useEffect(() => {
            fragmentRef.current.addEventListener('click', logClick);

            return removeEventListeners;
          });

          return (
            <Fragment ref={fragmentRef}>
              <div id="child-a" />
            </Fragment>
          );
        }

        // 事件监听器已生效。
        await act(() => root.render(<Test />));
        expect(logs).toEqual([]);
        document.querySelector('#child-a').click();
        expect(logs).toEqual(['child-a']);

        // 事件监听器可以移除后重新添加。
        logs = [];
        await act(rerender);
        document.querySelector('#child-a').click();
        expect(logs).toEqual(['child-a']);
      });

      // @gate enableFragmentRefs
      /** 测试场景：验证「does not apply removed event listeners to new children」描述的渲染、交互或错误处理结果。 */
      it('does not apply removed event listeners to new children', async () => {
        const root = ReactDOMClient.createRoot(container);
        const fragmentRef = React.createRef(null);
        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          return (
            <Fragment ref={fragmentRef}>
              <div id="child-a" />
            </Fragment>
          );
        }

        let logs = [];
        /** `logClick`：封装当前用例复用的操作、回调或断言步骤。 */
        function logClick(e) {
          logs.push(e.currentTarget.id);
        }
        await act(() => {
          root.render(<Test />);
        });
        fragmentRef.current.addEventListener('click', logClick);
        const childA = document.querySelector('#child-a');
        childA.click();
        expect(logs).toEqual(['child-a']);

        logs = [];
        fragmentRef.current.removeEventListener('click', logClick);
        childA.click();
        expect(logs).toEqual([]);
      });

      // @gate enableFragmentRefs
      /** 测试场景：验证「removes a capture listener registered with boolean when removed with options object」描述的渲染、交互或错误处理结果。 */
      it('removes a capture listener registered with boolean when removed with options object', async () => {
        const fragmentRef = React.createRef(null);
        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          return (
            <Fragment ref={fragmentRef}>
              <div id="child-a" />
            </Fragment>
          );
        }
        const root = ReactDOMClient.createRoot(container);
        await act(() => {
          root.render(<Test />);
        });

        const logs = [];
        /** `logCapture`：封装当前用例复用的操作、回调或断言步骤。 */
        function logCapture() {
          logs.push('capture');
        }

        // 注册为布尔值 `true`（捕获阶段）
        fragmentRef.current.addEventListener('click', logCapture, true);
        document.querySelector('#child-a').click();
        expect(logs).toEqual(['capture']);

        logs.length = 0;

        // 使用等价的选项对象 {capture: true} 移除；按 DOM 规范，它们视为相同，必须移除监听器。
        fragmentRef.current.removeEventListener('click', logCapture, {
          capture: true,
        });
        document.querySelector('#child-a').click();
        // 监听器应已移除，因此日志必须保持为空。
        expect(logs).toEqual([]);
      });

      // @gate enableFragmentRefs
      /** 测试场景：验证「removes a capture listener registered with options object when removed with boolean」描述的渲染、交互或错误处理结果。 */
      it('removes a capture listener registered with options object when removed with boolean', async () => {
        const fragmentRef = React.createRef(null);
        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          return (
            <Fragment ref={fragmentRef}>
              <div id="child-b" />
            </Fragment>
          );
        }
        const root = ReactDOMClient.createRoot(container);
        await act(() => {
          root.render(<Test />);
        });

        const logs = [];
        /** `logCapture`：封装当前用例复用的操作、回调或断言步骤。 */
        function logCapture() {
          logs.push('capture');
        }

        // 注册选项对象 {capture: true}
        fragmentRef.current.addEventListener('click', logCapture, {
          capture: true,
        });
        document.querySelector('#child-b').click();
        expect(logs).toEqual(['capture']);

        logs.length = 0;

        // 使用布尔值 `true` 移除；按 DOM 规范，它与 capture 选项等价，必须移除监听器。
        fragmentRef.current.removeEventListener('click', logCapture, true);
        document.querySelector('#child-b').click();
        // 监听器应已移除，因此日志必须保持为空。
        expect(logs).toEqual([]);
      });

      // @gate enableFragmentRefs
      /** 测试场景：验证「applies event listeners to portaled children」描述的渲染、交互或错误处理结果。 */
      it('applies event listeners to portaled children', async () => {
        const fragmentRef = React.createRef();
        const childARef = React.createRef();
        const childBRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          return (
            <Fragment ref={fragmentRef}>
              <div id="child-a" ref={childARef} />
              {createPortal(
                <div id="child-b" ref={childBRef} />,
                document.body,
              )}
            </Fragment>
          );
        }

        await act(() => {
          root.render(<Test />);
        });

        const logs = [];
        fragmentRef.current.addEventListener('click', e => {
          logs.push(e.target.id);
        });

        childARef.current.click();
        expect(logs).toEqual(['child-a']);

        logs.length = 0;
        childBRef.current.click();
        expect(logs).toEqual(['child-b']);
      });

      describe('with activity', () => {
        // @gate enableFragmentRefs
        /** 测试场景：验证「does not apply event listeners to hidden trees」描述的渲染、交互或错误处理结果。 */
        it('does not apply event listeners to hidden trees', async () => {
          const parentRef = React.createRef();
          const fragmentRef = React.createRef();
          const root = ReactDOMClient.createRoot(container);

          /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
          function Test() {
            return (
              <div ref={parentRef}>
                <Fragment ref={fragmentRef}>
                  <div>Child 1</div>
                  <Activity mode="hidden">
                    <div>Child 2</div>
                  </Activity>
                  <div>Child 3</div>
                </Fragment>
              </div>
            );
          }

          await act(() => {
            root.render(<Test />);
          });

          const logs = [];
          fragmentRef.current.addEventListener('click', e => {
            logs.push(e.target.textContent);
          });

          const [child1, child2, child3] = parentRef.current.children;
          child1.click();
          child2.click();
          child3.click();
          expect(logs).toEqual(['Child 1', 'Child 3']);
        });

        // @gate enableFragmentRefs
        /** 测试场景：验证「applies event listeners to visible trees」描述的渲染、交互或错误处理结果。 */
        it('applies event listeners to visible trees', async () => {
          const parentRef = React.createRef();
          const fragmentRef = React.createRef();
          const root = ReactDOMClient.createRoot(container);

          /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
          function Test() {
            return (
              <div ref={parentRef}>
                <Fragment ref={fragmentRef}>
                  <div>Child 1</div>
                  <Activity mode="visible">
                    <div>Child 2</div>
                  </Activity>
                  <div>Child 3</div>
                </Fragment>
              </div>
            );
          }

          await act(() => {
            root.render(<Test />);
          });

          const logs = [];
          fragmentRef.current.addEventListener('click', e => {
            logs.push(e.target.textContent);
          });

          const [child1, child2, child3] = parentRef.current.children;
          child1.click();
          child2.click();
          child3.click();
          expect(logs).toEqual(['Child 1', 'Child 2', 'Child 3']);
        });

        // @gate enableFragmentRefs
        /** 测试场景：验证「handles Activity modes switching」描述的渲染、交互或错误处理结果。 */
        it('handles Activity modes switching', async () => {
          const fragmentRef = React.createRef();
          const fragmentRef2 = React.createRef();
          const parentRef = React.createRef();
          const root = ReactDOMClient.createRoot(container);

          /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
          function Test({mode}) {
            return (
              <div id="parent" ref={parentRef}>
                <Fragment ref={fragmentRef}>
                  <Activity mode={mode}>
                    <div id="child1">Child</div>
                    <Fragment ref={fragmentRef2}>
                      <div id="child2">Child 2</div>
                    </Fragment>
                  </Activity>
                </Fragment>
              </div>
            );
          }

          await act(() => {
            root.render(<Test mode="visible" />);
          });

          let logs = [];
          fragmentRef.current.addEventListener('click', () => {
            logs.push('clicked 1');
          });
          fragmentRef2.current.addEventListener('click', () => {
            logs.push('clicked 2');
          });
          parentRef.current.lastChild.click();
          expect(logs).toEqual(['clicked 1', 'clicked 2']);

          logs = [];
          await act(() => {
            root.render(<Test mode="hidden" />);
          });
          parentRef.current.firstChild.click();
          parentRef.current.lastChild.click();
          expect(logs).toEqual([]);

          logs = [];
          await act(() => {
            root.render(<Test mode="visible" />);
          });
          parentRef.current.lastChild.click();
          // 事件顺序在这里被颠倒，因为嵌套的子组件首先重新注册。
          expect(logs).toEqual(['clicked 2', 'clicked 1']);
        });
      });
    });

    describe('dispatchEvent()', () => {
      // @gate enableFragmentRefs
      /** 测试场景：验证「fires events on the host parent if bubbles=true」描述的渲染、交互或错误处理结果。 */
      it('fires events on the host parent if bubbles=true', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);
        let logs = [];

        /** `handleClick`：封装当前用例复用的操作、回调或断言步骤。 */
        function handleClick(e) {
          logs.push([e.type, e.target.id, e.currentTarget.id]);
        }

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test({isMounted}) {
          return (
            <div onClick={handleClick} id="grandparent">
              <div onClick={handleClick} id="parent">
                {isMounted && (
                  <Fragment ref={fragmentRef}>
                    <div onClick={handleClick} id="child">
                      Hi
                    </div>
                  </Fragment>
                )}
              </div>
            </div>
          );
        }

        await act(() => {
          root.render(<Test isMounted={true} />);
        });

        let isCancelable = !fragmentRef.current.dispatchEvent(
          new MouseEvent('click', {bubbles: true}),
        );
        expect(logs).toEqual([
          ['click', 'parent', 'parent'],
          ['click', 'parent', 'grandparent'],
        ]);
        expect(isCancelable).toBe(false);

        const fragmentInstanceHandle = fragmentRef.current;
        await act(() => {
          root.render(<Test isMounted={false} />);
        });
        logs = [];
        isCancelable = !fragmentInstanceHandle.dispatchEvent(
          new MouseEvent('click', {bubbles: true}),
        );
        expect(logs).toEqual([]);
        expect(isCancelable).toBe(false);

        logs = [];
        isCancelable = !fragmentInstanceHandle.dispatchEvent(
          new MouseEvent('click', {bubbles: false}),
        );
        expect(logs).toEqual([]);
        expect(isCancelable).toBe(false);
      });

      // @gate enableFragmentRefs
      /** 测试场景：验证「fires events on self, and only self if bubbles=false」描述的渲染、交互或错误处理结果。 */
      it('fires events on self, and only self if bubbles=false', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);
        let logs = [];

        /** `handleClick`：封装当前用例复用的操作、回调或断言步骤。 */
        function handleClick(e) {
          logs.push([e.type, e.target.id, e.currentTarget.id]);
        }

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          return (
            <div id="parent" onClick={handleClick}>
              <Fragment ref={fragmentRef} />
            </div>
          );
        }

        await act(() => {
          root.render(<Test />);
        });

        fragmentRef.current.addEventListener('click', handleClick);

        fragmentRef.current.dispatchEvent(
          new MouseEvent('click', {bubbles: true}),
        );
        expect(logs).toEqual([
          ['click', undefined, undefined],
          ['click', 'parent', 'parent'],
        ]);

        logs = [];

        fragmentRef.current.dispatchEvent(
          new MouseEvent('click', {bubbles: false}),
        );
        expect(logs).toEqual([['click', undefined, undefined]]);
      });
    });
  });

  describe('observers', () => {
    beforeEach(() => {
      mockIntersectionObserver();
    });

    // @gate enableFragmentRefs
    /** 测试场景：验证「attaches intersection observers to children」描述的渲染、交互或错误处理结果。 */
    it('attaches intersection observers to children', async () => {
      let logs = [];
      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          logs.push(entry.target.id);
        });
      });
      /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
      function Test({showB}) {
        const fragmentRef = React.useRef(null);
        React.useEffect(() => {
          fragmentRef.current.observeUsing(observer);
          const lastRefValue = fragmentRef.current;
          return () => {
            lastRefValue.unobserveUsing(observer);
          };
        }, []);
        return (
          <div id="parent">
            <React.Fragment ref={fragmentRef}>
              <div id="childA">A</div>
              {showB && <div id="childB">B</div>}
            </React.Fragment>
          </div>
        );
      }

      /** `simulateAllChildrenIntersecting`：封装当前用例复用的操作、回调或断言步骤。 */
      function simulateAllChildrenIntersecting() {
        const parent = container.firstChild;
        if (parent) {
          const children = Array.from(parent.children).map(child => {
            return [child, {y: 0, x: 0, width: 1, height: 1}, 1];
          });
          simulateIntersection(...children);
        }
      }

      const root = ReactDOMClient.createRoot(container);
      await act(() => root.render(<Test showB={false} />));
      simulateAllChildrenIntersecting();
      expect(logs).toEqual(['childA']);

      // 显示子节点，并期望观察器检测到它。
      logs = [];
      await act(() => root.render(<Test showB={true} />));
      simulateAllChildrenIntersecting();
      expect(logs).toEqual(['childA', 'childB']);

      // 隐藏子节点，并期望观察器不再检测到它。
      logs = [];
      await act(() => root.render(<Test showB={false} />));
      simulateAllChildrenIntersecting();
      expect(logs).toEqual(['childA']);

      // 卸载组件，并期望所有子组件均被标记为未观察。
      logs = [];
      await act(() => root.render(null));
      simulateAllChildrenIntersecting();
      expect(logs).toEqual([]);
    });

    // @gate enableFragmentRefs
    /** 测试场景：验证「warns when unobserveUsing() is called with an observer that was not observed」描述的渲染、交互或错误处理结果。 */
    it('warns when unobserveUsing() is called with an observer that was not observed', async () => {
      const fragmentRef = React.createRef();
      const observer = new IntersectionObserver(() => {});
      const observer2 = new IntersectionObserver(() => {});
      /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
      function Test() {
        return (
          <React.Fragment ref={fragmentRef}>
            <div />
          </React.Fragment>
        );
      }

      const root = ReactDOMClient.createRoot(container);
      await act(() => root.render(<Test />));

      // 未挂载 observer 时发出警告。
      fragmentRef.current.unobserveUsing(observer);
      assertConsoleErrorDev([
        'You are calling unobserveUsing() with an observer that is not being observed with this fragment ' +
          'instance. First attach the observer with observeUsing()',
      ]);

      // 挂载的 observer 不匹配时发出警告。
      fragmentRef.current.observeUsing(observer);
      fragmentRef.current.unobserveUsing(observer2);
      assertConsoleErrorDev([
        'You are calling unobserveUsing() with an observer that is not being observed with this fragment ' +
          'instance. First attach the observer with observeUsing()',
      ]);
    });

    // @gate enableFragmentRefs && enableFragmentRefsInstanceHandles
    /** 测试场景：验证「attaches handles to observed elements to allow caching of observers」描述的渲染、交互或错误处理结果。 */
    it('attaches handles to observed elements to allow caching of observers', async () => {
      const targetToCallbackMap = new WeakMap();
      let cachedObserver = null;
      /** `createObserverIfNeeded`：封装当前用例复用的操作、回调或断言步骤。 */
      function createObserverIfNeeded(fragmentInstance, onIntersection) {
        const callbacks = targetToCallbackMap.get(fragmentInstance);
        targetToCallbackMap.set(
          fragmentInstance,
          callbacks ? [...callbacks, onIntersection] : [onIntersection],
        );
        if (cachedObserver !== null) {
          return cachedObserver;
        }
        const observer = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            const fragmentInstances = entry.target.reactFragments;
            if (fragmentInstances) {
              Array.from(fragmentInstances).forEach(fInstance => {
                const cbs = targetToCallbackMap.get(fInstance) || [];
                cbs.forEach(callback => {
                  callback(entry);
                });
              });
            }

            targetToCallbackMap.get(entry.target)?.forEach(callback => {
              callback(entry);
            });
          });
        });
        cachedObserver = observer;
        return observer;
      }

      /** `IntersectionObserverFragment`：封装当前用例复用的操作、回调或断言步骤。 */
      function IntersectionObserverFragment({onIntersection, children}) {
        const fragmentRef = React.useRef(null);
        React.useLayoutEffect(() => {
          const observer = createObserverIfNeeded(
            fragmentRef.current,
            onIntersection,
          );
          fragmentRef.current.observeUsing(observer);
          const lastRefValue = fragmentRef.current;
          return () => {
            lastRefValue.unobserveUsing(observer);
          };
        }, []);
        return <React.Fragment ref={fragmentRef}>{children}</React.Fragment>;
      }

      let logs = [];
      /** `logIntersection`：封装当前用例复用的操作、回调或断言步骤。 */
      function logIntersection(id) {
        logs.push(`observe: ${id}`);
      }

      /** `ChildWithManualIO`：封装当前用例复用的操作、回调或断言步骤。 */
      function ChildWithManualIO({id}) {
        const divRef = React.useRef(null);
        React.useLayoutEffect(() => {
          const observer = createObserverIfNeeded(divRef.current, entry => {
            logIntersection(id);
          });
          observer.observe(divRef.current);
          return () => {
            observer.unobserve(divRef.current);
          };
        }, []);
        return (
          <div id={id} ref={divRef}>
            {id}
          </div>
        );
      }

      /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
      function Test() {
        return (
          <>
            <IntersectionObserverFragment
              onIntersection={() => logIntersection('grandparent')}>
              <IntersectionObserverFragment
                onIntersection={() => logIntersection('parentA')}>
                <div id="childA">A</div>
              </IntersectionObserverFragment>
            </IntersectionObserverFragment>
            <IntersectionObserverFragment
              onIntersection={() => logIntersection('parentB')}>
              <div id="childB">B</div>
              <ChildWithManualIO id="childC" />
            </IntersectionObserverFragment>
          </>
        );
      }

      const root = ReactDOMClient.createRoot(container);
      await act(() => root.render(<Test />));

      simulateIntersection([
        container.querySelector('#childA'),
        {y: 0, x: 0, width: 1, height: 1},
        1,
      ]);
      expect(logs).toEqual(['observe: grandparent', 'observe: parentA']);

      logs = [];

      simulateIntersection([
        container.querySelector('#childB'),
        {y: 0, x: 0, width: 1, height: 1},
        1,
      ]);
      expect(logs).toEqual(['observe: parentB']);

      logs = [];
      simulateIntersection([
        container.querySelector('#childC'),
        {y: 0, x: 0, width: 1, height: 1},
        1,
      ]);
      expect(logs).toEqual(['observe: parentB', 'observe: childC']);
    });
  });

  describe('getClientRects', () => {
    // @gate enableFragmentRefs
    /** 测试场景：验证「returns the bounding client rects of all children」描述的渲染、交互或错误处理结果。 */
    it('returns the bounding client rects of all children', async () => {
      const fragmentRef = React.createRef();
      const childARef = React.createRef();
      const childBRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
      function Test() {
        return (
          <React.Fragment ref={fragmentRef}>
            <div ref={childARef} />
            <div ref={childBRef} />
          </React.Fragment>
        );
      }

      await act(() => root.render(<Test />));
      setClientRects(childARef.current, [
        {
          x: 1,
          y: 2,
          width: 3,
          height: 4,
        },
        {
          x: 5,
          y: 6,
          width: 7,
          height: 8,
        },
      ]);
      setClientRects(childBRef.current, [{x: 9, y: 10, width: 11, height: 12}]);
      const clientRects = fragmentRef.current.getClientRects();
      expect(clientRects.length).toBe(3);
      expect(clientRects[0].left).toBe(1);
      expect(clientRects[1].left).toBe(5);
      expect(clientRects[2].left).toBe(9);
    });
  });

  describe('getRootNode', () => {
    // @gate enableFragmentRefs
    /** 测试场景：验证「returns the root node of the parent」描述的渲染、交互或错误处理结果。 */
    it('returns the root node of the parent', async () => {
      const fragmentRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
      function Test() {
        return (
          <div>
            <React.Fragment ref={fragmentRef}>
              <div />
            </React.Fragment>
          </div>
        );
      }

      await act(() => root.render(<Test />));
      expect(fragmentRef.current.getRootNode()).toBe(document);
    });

    // 期望行为是：卸载 Fragment 与父节点后，返回最顶层的断开连接元素。目前卸载流程会递归清理
    // 整棵树的 return 指针；未来重构可以改变此行为。参见：
    // https://github.com/facebook/react/pull/32682#discussion_r2008313082
    // @gate enableFragmentRefs
    /** 测试场景：验证「returns the topmost disconnected element if the fragment and parent are unmounted」描述的渲染、交互或错误处理结果。 */
    it('returns the topmost disconnected element if the fragment and parent are unmounted', async () => {
      const containerRef = React.createRef();
      const parentRef = React.createRef();
      const fragmentRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
      function Test({mounted}) {
        return (
          <div ref={containerRef} id="container">
            {mounted && (
              <div ref={parentRef} id="parent">
                <React.Fragment ref={fragmentRef}>
                  <div />
                </React.Fragment>
              </div>
            )}
          </div>
        );
      }

      await act(() => root.render(<Test mounted={true} />));
      expect(fragmentRef.current.getRootNode()).toBe(document);
      const fragmentHandle = fragmentRef.current;
      await act(() => root.render(<Test mounted={false} />));
      // TODO：下面被注释掉的断言才是期望行为。目前这里返回 Fragment 实例本身；仅卸载 Fragment、
      // 保留父元素时也会得到相同行为，背景说明见上文。
      // expect(fragmentHandle.getRootNode().id).toBe(parentRefHandle.id);
      expect(fragmentHandle.getRootNode()).toBe(fragmentHandle);
    });

    // @gate enableFragmentRefs
    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「returns self when only the fragment was unmounted」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：断言连接 reconciler Fragment ref 与 DOM 宿主实例查询路径。
     */
    it('returns self when only the fragment was unmounted', async () => {
      const fragmentRef = React.createRef();
      const parentRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
      function Test({mounted}) {
        return (
          <div ref={parentRef} id="parent">
            {mounted && (
              <React.Fragment ref={fragmentRef}>
                <div />
              </React.Fragment>
            )}
          </div>
        );
      }

      await act(() => root.render(<Test mounted={true} />));
      expect(fragmentRef.current.getRootNode()).toBe(document);
      const fragmentHandle = fragmentRef.current;
      await act(() => root.render(<Test mounted={false} />));
      expect(fragmentHandle.getRootNode()).toBe(fragmentHandle);
    });
  });

  describe('compareDocumentPosition', () => {
    /** `expectPosition`：封装当前用例复用的操作、回调或断言步骤。 */
    function expectPosition(position, spec) {
      const positionResult = {
        following: (position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        preceding: (position & Node.DOCUMENT_POSITION_PRECEDING) !== 0,
        contains: (position & Node.DOCUMENT_POSITION_CONTAINS) !== 0,
        containedBy: (position & Node.DOCUMENT_POSITION_CONTAINED_BY) !== 0,
        disconnected: (position & Node.DOCUMENT_POSITION_DISCONNECTED) !== 0,
        implementationSpecific:
          (position & Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC) !== 0,
      };
      expect(positionResult).toEqual(spec);
    }
    // @gate enableFragmentRefs
    /** 测试场景：验证「returns the relationship between the fragment instance and a given node」描述的渲染、交互或错误处理结果。 */
    it('returns the relationship between the fragment instance and a given node', async () => {
      const fragmentRef = React.createRef();
      const beforeRef = React.createRef();
      const afterRef = React.createRef();
      const middleChildRef = React.createRef();
      const firstChildRef = React.createRef();
      const lastChildRef = React.createRef();
      const containerRef = React.createRef();
      const disconnectedElement = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
      function Test() {
        return (
          <div ref={containerRef} id="container">
            <div ref={beforeRef} id="before" />
            <React.Fragment ref={fragmentRef}>
              <div ref={firstChildRef} id="first" />
              <div ref={middleChildRef} id="middle" />
              <div ref={lastChildRef} id="last" />
            </React.Fragment>
            <div ref={afterRef} id="after" />
          </div>
        );
      }

      await act(() => root.render(<Test />));

      // document.body 位于 Fragment 之前，并包含 Fragment。
      expectPosition(
        fragmentRef.current.compareDocumentPosition(document.body),
        {
          preceding: true,
          following: false,
          contains: true,
          containedBy: false,
          disconnected: false,
          implementationSpecific: false,
        },
      );

      // beforeRef 位于片段之前。
      expectPosition(
        fragmentRef.current.compareDocumentPosition(beforeRef.current),
        {
          preceding: true,
          following: false,
          contains: false,
          containedBy: false,
          disconnected: false,
          implementationSpecific: false,
        },
      );

      // afterRef 位于 Fragment 之后。
      expectPosition(
        fragmentRef.current.compareDocumentPosition(afterRef.current),
        {
          preceding: false,
          following: true,
          contains: false,
          containedBy: false,
          disconnected: false,
          implementationSpecific: false,
        },
      );

      // firstChildRef 被 Fragment 包含。
      expectPosition(
        fragmentRef.current.compareDocumentPosition(firstChildRef.current),
        {
          preceding: false,
          following: false,
          contains: false,
          containedBy: true,
          disconnected: false,
          implementationSpecific: false,
        },
      );

      // middleChildRef 被 Fragment 包含。
      expectPosition(
        fragmentRef.current.compareDocumentPosition(middleChildRef.current),
        {
          preceding: false,
          following: false,
          contains: false,
          containedBy: true,
          disconnected: false,
          implementationSpecific: false,
        },
      );

      // lastChildRef 被 Fragment 包含。
      expectPosition(
        fragmentRef.current.compareDocumentPosition(lastChildRef.current),
        {
          preceding: false,
          following: false,
          contains: false,
          containedBy: true,
          disconnected: false,
          implementationSpecific: false,
        },
      );

      // containerRef 位于 Fragment 之前，并包含 Fragment。
      expectPosition(
        fragmentRef.current.compareDocumentPosition(containerRef.current),
        {
          preceding: true,
          following: false,
          contains: true,
          containedBy: false,
          disconnected: false,
          implementationSpecific: false,
        },
      );

      expectPosition(
        fragmentRef.current.compareDocumentPosition(disconnectedElement),
        {
          preceding: false,
          following: true,
          contains: false,
          containedBy: false,
          disconnected: true,
          implementationSpecific: true,
        },
      );
    });

    // @gate enableFragmentRefs
    /** 测试场景：验证「handles fragment instances with one child」描述的渲染、交互或错误处理结果。 */
    it('handles fragment instances with one child', async () => {
      const fragmentRef = React.createRef();
      const beforeRef = React.createRef();
      const afterRef = React.createRef();
      const containerRef = React.createRef();
      const onlyChildRef = React.createRef();
      const disconnectedElement = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
      function Test() {
        return (
          <div id="container" ref={containerRef}>
            <div id="innercontainer">
              <div ref={beforeRef} id="before" />
              <React.Fragment ref={fragmentRef}>
                <div ref={onlyChildRef} id="within" />
              </React.Fragment>
              <div id="after" ref={afterRef} />
            </div>
          </div>
        );
      }

      await act(() => root.render(<Test />));
      expectPosition(
        fragmentRef.current.compareDocumentPosition(beforeRef.current),
        {
          preceding: true,
          following: false,
          contains: false,
          containedBy: false,
          disconnected: false,
          implementationSpecific: false,
        },
      );
      expectPosition(
        fragmentRef.current.compareDocumentPosition(afterRef.current),
        {
          preceding: false,
          following: true,
          contains: false,
          containedBy: false,
          disconnected: false,
          implementationSpecific: false,
        },
      );
      expectPosition(
        fragmentRef.current.compareDocumentPosition(onlyChildRef.current),
        {
          preceding: false,
          following: false,
          contains: false,
          containedBy: true,
          disconnected: false,
          implementationSpecific: false,
        },
      );
      expectPosition(
        fragmentRef.current.compareDocumentPosition(containerRef.current),
        {
          preceding: true,
          following: false,
          contains: true,
          containedBy: false,
          disconnected: false,
          implementationSpecific: false,
        },
      );
      expectPosition(
        fragmentRef.current.compareDocumentPosition(disconnectedElement),
        {
          preceding: false,
          following: true,
          contains: false,
          containedBy: false,
          disconnected: true,
          implementationSpecific: true,
        },
      );
    });

    // @gate enableFragmentRefs
    /** 测试场景：验证「handles empty fragment instances」描述的渲染、交互或错误处理结果。 */
    it('handles empty fragment instances', async () => {
      const fragmentRef = React.createRef();
      const beforeParentRef = React.createRef();
      const beforeRef = React.createRef();
      const afterRef = React.createRef();
      const afterParentRef = React.createRef();
      const containerRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
      function Test() {
        return (
          <>
            <div id="before-container" ref={beforeParentRef} />
            <div id="container" ref={containerRef}>
              <div id="before" ref={beforeRef} />
              <React.Fragment ref={fragmentRef} />
              <div id="after" ref={afterRef} />
            </div>
            <div id="after-container" ref={afterParentRef} />
          </>
        );
      }

      await act(() => root.render(<Test />));

      expectPosition(
        fragmentRef.current.compareDocumentPosition(document.body),
        {
          preceding: true,
          following: false,
          contains: true,
          containedBy: false,
          disconnected: false,
          implementationSpecific: true,
        },
      );
      expectPosition(
        fragmentRef.current.compareDocumentPosition(beforeRef.current),
        {
          preceding: true,
          following: false,
          contains: false,
          containedBy: false,
          disconnected: false,
          implementationSpecific: true,
        },
      );
      expectPosition(
        fragmentRef.current.compareDocumentPosition(beforeParentRef.current),
        {
          preceding: true,
          following: false,
          contains: false,
          containedBy: false,
          disconnected: false,
          implementationSpecific: true,
        },
      );
      expectPosition(
        fragmentRef.current.compareDocumentPosition(afterRef.current),
        {
          preceding: false,
          following: true,
          contains: false,
          containedBy: false,
          disconnected: false,
          implementationSpecific: true,
        },
      );
      expectPosition(
        fragmentRef.current.compareDocumentPosition(afterParentRef.current),
        {
          preceding: false,
          following: true,
          contains: false,
          containedBy: false,
          disconnected: false,
          implementationSpecific: true,
        },
      );
      expectPosition(
        fragmentRef.current.compareDocumentPosition(containerRef.current),
        {
          preceding: false,
          following: false,
          contains: true,
          containedBy: false,
          disconnected: false,
          implementationSpecific: true,
        },
      );
    });

    // @gate enableFragmentRefs
    /** 测试场景：验证「handles nested children」描述的渲染、交互或错误处理结果。 */
    it('handles nested children', async () => {
      const fragmentRef = React.createRef();
      const nestedFragmentRef = React.createRef();
      const childARef = React.createRef();
      const childBRef = React.createRef();
      const childCRef = React.createRef();
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);

      /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
      function Child() {
        return (
          <div ref={childCRef} id="C">
            C
          </div>
        );
      }

      /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
      function Test() {
        return (
          <React.Fragment ref={fragmentRef}>
            <div ref={childARef} id="A">
              A
            </div>
            <React.Fragment ref={nestedFragmentRef}>
              <div ref={childBRef} id="B">
                B
              </div>
            </React.Fragment>
            <Child />
          </React.Fragment>
        );
      }

      await act(() => root.render(<Test />));

      expectPosition(
        fragmentRef.current.compareDocumentPosition(childARef.current),
        {
          preceding: false,
          following: false,
          contains: false,
          containedBy: true,
          disconnected: false,
          implementationSpecific: false,
        },
      );
      expectPosition(
        fragmentRef.current.compareDocumentPosition(childBRef.current),
        {
          preceding: false,
          following: false,
          contains: false,
          containedBy: true,
          disconnected: false,
          implementationSpecific: false,
        },
      );
      expectPosition(
        fragmentRef.current.compareDocumentPosition(childCRef.current),
        {
          preceding: false,
          following: false,
          contains: false,
          containedBy: true,
          disconnected: false,
          implementationSpecific: false,
        },
      );
    });

    // @gate enableFragmentRefs
    /** 测试场景：验证「returns disconnected for comparison with an unmounted fragment instance」描述的渲染、交互或错误处理结果。 */
    it('returns disconnected for comparison with an unmounted fragment instance', async () => {
      const fragmentRef = React.createRef();
      const containerRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
      function Test({mount}) {
        return (
          <div ref={containerRef}>
            {mount && (
              <Fragment ref={fragmentRef}>
                <div />
              </Fragment>
            )}
          </div>
        );
      }

      await act(() => root.render(<Test mount={true} />));

      const fragmentHandle = fragmentRef.current;

      expectPosition(
        fragmentHandle.compareDocumentPosition(containerRef.current),
        {
          preceding: true,
          following: false,
          contains: true,
          containedBy: false,
          disconnected: false,
          implementationSpecific: false,
        },
      );

      await act(() => {
        root.render(<Test mount={false} />);
      });

      expectPosition(
        fragmentHandle.compareDocumentPosition(containerRef.current),
        {
          preceding: false,
          following: false,
          contains: false,
          containedBy: false,
          disconnected: true,
          implementationSpecific: false,
        },
      );
    });

    // @gate enableFragmentRefs
    /** 测试场景：验证「compares a root-level Fragment」描述的渲染、交互或错误处理结果。 */
    it('compares a root-level Fragment', async () => {
      const fragmentRef = React.createRef();
      const emptyFragmentRef = React.createRef();
      const childRef = React.createRef();
      const siblingPrecedingRef = React.createRef();
      const siblingFollowingRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
      function Test() {
        return (
          <Fragment>
            <div ref={siblingPrecedingRef} />
            <Fragment ref={fragmentRef}>
              <div ref={childRef} />
            </Fragment>
            <Fragment ref={emptyFragmentRef} />
            <div ref={siblingFollowingRef} />
          </Fragment>
        );
      }

      await act(() => root.render(<Test />));

      const fragmentInstance = fragmentRef.current;
      if (fragmentInstance == null) {
        throw new Error('Expected fragment instance to be non-null');
      }
      const emptyFragmentInstance = emptyFragmentRef.current;
      if (emptyFragmentInstance == null) {
        throw new Error('Expected empty fragment instance to be non-null');
      }

      expectPosition(
        fragmentInstance.compareDocumentPosition(childRef.current),
        {
          preceding: false,
          following: false,
          contains: false,
          containedBy: true,
          disconnected: false,
          implementationSpecific: false,
        },
      );

      expectPosition(
        fragmentInstance.compareDocumentPosition(siblingPrecedingRef.current),
        {
          preceding: true,
          following: false,
          contains: false,
          containedBy: false,
          disconnected: false,
          implementationSpecific: false,
        },
      );

      expectPosition(
        fragmentInstance.compareDocumentPosition(siblingFollowingRef.current),
        {
          preceding: false,
          following: true,
          contains: false,
          containedBy: false,
          disconnected: false,
          implementationSpecific: false,
        },
      );

      expectPosition(
        emptyFragmentInstance.compareDocumentPosition(childRef.current),
        {
          preceding: true,
          following: false,
          contains: false,
          containedBy: false,
          disconnected: false,
          implementationSpecific: true,
        },
      );

      expectPosition(
        emptyFragmentInstance.compareDocumentPosition(
          siblingPrecedingRef.current,
        ),
        {
          preceding: true,
          following: false,
          contains: false,
          containedBy: false,
          disconnected: false,
          implementationSpecific: true,
        },
      );

      expectPosition(
        emptyFragmentInstance.compareDocumentPosition(
          siblingFollowingRef.current,
        ),
        {
          preceding: false,
          following: true,
          contains: false,
          containedBy: false,
          disconnected: false,
          implementationSpecific: true,
        },
      );
    });

    describe('with portals', () => {
      // @gate enableFragmentRefs
      /** 测试场景：验证「handles portaled elements」描述的渲染、交互或错误处理结果。 */
      it('handles portaled elements', async () => {
        const fragmentRef = React.createRef();
        const portaledSiblingRef = React.createRef();
        const portaledChildRef = React.createRef();

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          return (
            <div id="wrapper">
              {createPortal(<div ref={portaledSiblingRef} id="A" />, container)}
              <Fragment ref={fragmentRef}>
                {createPortal(<div ref={portaledChildRef} id="B" />, container)}
                <div id="C" />
              </Fragment>
            </div>
          );
        }

        const root = ReactDOMClient.createRoot(container);
        await act(() => root.render(<Test />));

        // 兄弟节点在两个树中都排在前面。
        expectPosition(
          fragmentRef.current.compareDocumentPosition(
            portaledSiblingRef.current,
          ),
          {
            preceding: true,
            following: false,
            contains: false,
            containedBy: false,
            disconnected: false,
            implementationSpecific: false,
          },
        );

        // 子节点在 React 树中被 Fragment 包含，但在 DOM 中不被包含。
        expectPosition(
          fragmentRef.current.compareDocumentPosition(portaledChildRef.current),
          {
            preceding: false,
            following: false,
            contains: false,
            containedBy: false,
            disconnected: false,
            implementationSpecific: true,
          },
        );
      });

      // @gate enableFragmentRefs
      /** 测试场景：验证「handles multiple portals to the same element」描述的渲染、交互或错误处理结果。 */
      it('handles multiple portals to the same element', async () => {
        const root = ReactDOMClient.createRoot(container);
        const fragmentRef = React.createRef();
        const childARef = React.createRef();
        const childBRef = React.createRef();
        const childCRef = React.createRef();
        const childDRef = React.createRef();
        const childERef = React.createRef();

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          const [c, setC] = React.useState(false);
          React.useEffect(() => {
            setC(true);
          });

          return (
            <>
              {createPortal(
                <Fragment ref={fragmentRef}>
                  <div id="A" ref={childARef} />
                  {c ? (
                    <div id="C" ref={childCRef}>
                      <div id="D" ref={childDRef} />
                    </div>
                  ) : null}
                </Fragment>,
                document.body,
              )}
              {createPortal(<p id="B" ref={childBRef} />, document.body)}
              <div id="E" ref={childERef} />
            </>
          );
        }

        await act(() => root.render(<Test />));

        // 由于 effect，顺序为 E / A->B->C->D。
        expect(document.body.outerHTML).toBe(
          '<body>' +
            '<div><div id="E"></div></div>' +
            '<div id="A"></div>' +
            '<p id="B"></p>' +
            '<div id="C"><div id="D"></div></div>' +
            '</body>',
        );

        expectPosition(
          fragmentRef.current.compareDocumentPosition(document.body),
          {
            preceding: true,
            following: false,
            contains: true,
            containedBy: false,
            disconnected: false,
            implementationSpecific: false,
          },
        );
        expectPosition(
          fragmentRef.current.compareDocumentPosition(childARef.current),
          {
            preceding: false,
            following: false,
            contains: false,
            containedBy: true,
            disconnected: false,
            implementationSpecific: false,
          },
        );
        // 在 DOM 中被 Fragment 包含，但在 React 树中位于 Fragment 之后。
        expectPosition(
          fragmentRef.current.compareDocumentPosition(childBRef.current),
          {
            preceding: false,
            following: false,
            contains: false,
            containedBy: false,
            disconnected: false,
            implementationSpecific: true,
          },
        );
        expectPosition(
          fragmentRef.current.compareDocumentPosition(childCRef.current),
          {
            preceding: false,
            following: false,
            contains: false,
            containedBy: true,
            disconnected: false,
            implementationSpecific: false,
          },
        );
        expectPosition(
          fragmentRef.current.compareDocumentPosition(childDRef.current),
          {
            preceding: false,
            following: false,
            contains: false,
            containedBy: true,
            disconnected: false,
            implementationSpecific: false,
          },
        );
        // 在 DOM 中位于 Fragment 之前，但在 React 树中位于 Fragment 之后。
        expectPosition(
          fragmentRef.current.compareDocumentPosition(childERef.current),
          {
            preceding: false,
            following: false,
            contains: false,
            containedBy: false,
            disconnected: false,
            implementationSpecific: true,
          },
        );
      });

      // @gate enableFragmentRefs
      /** 测试场景：验证「handles empty fragments」描述的渲染、交互或错误处理结果。 */
      it('handles empty fragments', async () => {
        const fragmentRef = React.createRef();
        const childARef = React.createRef();
        const childBRef = React.createRef();

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          return (
            <>
              <div id="A" ref={childARef} />
              {createPortal(<Fragment ref={fragmentRef} />, document.body)}
              <div id="B" ref={childBRef} />
            </>
          );
        }

        const root = ReactDOMClient.createRoot(container);
        await act(() => root.render(<Test />));

        expectPosition(
          fragmentRef.current.compareDocumentPosition(document.body),
          {
            preceding: true,
            following: false,
            contains: true,
            containedBy: false,
            disconnected: false,
            implementationSpecific: true,
          },
        );
        expectPosition(
          fragmentRef.current.compareDocumentPosition(childARef.current),
          {
            preceding: true,
            following: false,
            contains: false,
            containedBy: false,
            disconnected: false,
            implementationSpecific: true,
          },
        );
        expectPosition(
          fragmentRef.current.compareDocumentPosition(childBRef.current),
          {
            preceding: true,
            following: false,
            contains: false,
            containedBy: false,
            disconnected: false,
            implementationSpecific: true,
          },
        );
      });
    });
  });

  describe('scrollIntoView', () => {
    /** `expectLast`：封装当前用例复用的操作、回调或断言步骤。 */
    function expectLast(arr, test) {
      expect(arr[arr.length - 1]).toBe(test);
    }
    // @gate enableFragmentRefs && enableFragmentRefsScrollIntoView
    /** 测试场景：验证「does not yet support options」描述的渲染、交互或错误处理结果。 */
    it('does not yet support options', async () => {
      const fragmentRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Fragment ref={fragmentRef} />);
      });

      expect(() => {
        fragmentRef.current.scrollIntoView({block: 'start'});
      }).toThrowError(
        'FragmentInstance.scrollIntoView() does not support ' +
          'scrollIntoViewOptions. Use the alignToTop boolean instead.',
      );
    });

    describe('with children', () => {
      // @gate enableFragmentRefs && enableFragmentRefsScrollIntoView
      /** 测试场景：验证「settles scroll on the first child by default, or if alignToTop=true」描述的渲染、交互或错误处理结果。 */
      it('settles scroll on the first child by default, or if alignToTop=true', async () => {
        const fragmentRef = React.createRef();
        const childARef = React.createRef();
        const childBRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);
        await act(() => {
          root.render(
            <React.Fragment ref={fragmentRef}>
              <div ref={childARef} id="a">
                A
              </div>
              <div ref={childBRef} id="b">
                B
              </div>
            </React.Fragment>,
          );
        });

        let logs = [];
        childARef.current.scrollIntoView = jest.fn().mockImplementation(() => {
          logs.push('childA');
        });
        childBRef.current.scrollIntoView = jest.fn().mockImplementation(() => {
          logs.push('childB');
        });

        // 默认调用
        fragmentRef.current.scrollIntoView();
        expectLast(logs, 'childA');
        logs = [];
        // alignToTop=true
        fragmentRef.current.scrollIntoView(true);
        expectLast(logs, 'childA');
      });

      // @gate enableFragmentRefs && enableFragmentRefsScrollIntoView
      /** 测试场景：验证「calls scrollIntoView on the last child if alignToTop is false」描述的渲染、交互或错误处理结果。 */
      it('calls scrollIntoView on the last child if alignToTop is false', async () => {
        const fragmentRef = React.createRef();
        const childARef = React.createRef();
        const childBRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);
        await act(() => {
          root.render(
            <Fragment ref={fragmentRef}>
              <div ref={childARef}>A</div>
              <div ref={childBRef}>B</div>
            </Fragment>,
          );
        });

        const logs = [];
        childARef.current.scrollIntoView = jest.fn().mockImplementation(() => {
          logs.push('childA');
        });
        childBRef.current.scrollIntoView = jest.fn().mockImplementation(() => {
          logs.push('childB');
        });

        fragmentRef.current.scrollIntoView(false);
        expectLast(logs, 'childB');
      });

      // @gate enableFragmentRefs && enableFragmentRefsScrollIntoView
      /** 测试场景：验证「handles portaled elements -- same scroll container」描述的渲染、交互或错误处理结果。 */
      it('handles portaled elements -- same scroll container', async () => {
        const fragmentRef = React.createRef();
        const childARef = React.createRef();
        const childBRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          return (
            <Fragment ref={fragmentRef}>
              {createPortal(
                <div ref={childARef} id="child-a">
                  A
                </div>,
                document.body,
              )}

              <div ref={childBRef} id="child-b">
                B
              </div>
            </Fragment>
          );
        }

        await act(() => {
          root.render(<Test />);
        });

        const logs = [];
        childARef.current.scrollIntoView = jest.fn().mockImplementation(() => {
          logs.push('childA');
        });
        childBRef.current.scrollIntoView = jest.fn().mockImplementation(() => {
          logs.push('childB');
        });

        // 默认调用
        fragmentRef.current.scrollIntoView();
        expectLast(logs, 'childA');
      });

      // @gate enableFragmentRefs && enableFragmentRefsScrollIntoView
      /** 测试场景：验证「handles portaled elements -- different scroll container」描述的渲染、交互或错误处理结果。 */
      it('handles portaled elements -- different scroll container', async () => {
        const fragmentRef = React.createRef();
        const headerChildRef = React.createRef();
        const childARef = React.createRef();
        const childBRef = React.createRef();
        const childCRef = React.createRef();
        const scrollContainerRef = React.createRef();
        const scrollContainerNestedRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test({mountFragment}) {
          return (
            <>
              <div id="header" style={{position: 'fixed'}}>
                <div id="parent-a" />
              </div>
              <div id="parent-b" />
              <div
                id="scroll-container"
                ref={scrollContainerRef}
                style={{overflow: 'scroll'}}>
                <div id="parent-c" />
                <div
                  id="scroll-container-nested"
                  ref={scrollContainerNestedRef}
                  style={{overflow: 'scroll'}}>
                  <div id="parent-d" />
                </div>
              </div>
              {mountFragment && (
                <Fragment ref={fragmentRef}>
                  {createPortal(
                    <div ref={headerChildRef} id="header-content">
                      Header
                    </div>,
                    document.querySelector('#parent-a'),
                  )}
                  {createPortal(
                    <div ref={childARef} id="child-a">
                      A
                    </div>,
                    document.querySelector('#parent-b'),
                  )}
                  {createPortal(
                    <div ref={childBRef} id="child-b">
                      B
                    </div>,
                    document.querySelector('#parent-b'),
                  )}
                  {createPortal(
                    <div ref={childCRef} id="child-c">
                      C
                    </div>,
                    document.querySelector('#parent-c'),
                  )}
                </Fragment>
              )}
            </>
          );
        }

        await act(() => {
          root.render(<Test mountFragment={false} />);
        });
        // portal 挂载位置已经存在，现在挂载 Fragment。
        await act(() => {
          root.render(<Test mountFragment={true} />);
        });

        let logs = [];
        headerChildRef.current.scrollIntoView = jest.fn(() => {
          logs.push('header');
        });
        childARef.current.scrollIntoView = jest.fn(() => {
          logs.push('A');
        });
        childBRef.current.scrollIntoView = jest.fn(() => {
          logs.push('B');
        });
        childCRef.current.scrollIntoView = jest.fn(() => {
          logs.push('C');
        });

        // 默认调用
        fragmentRef.current.scrollIntoView();
        expectLast(logs, 'header');

        childARef.current.scrollIntoView.mockClear();
        childBRef.current.scrollIntoView.mockClear();
        childCRef.current.scrollIntoView.mockClear();

        logs = [];

        // // alignToTop=false
        fragmentRef.current.scrollIntoView(false);
        expectLast(logs, 'C');
      });
    });

    describe('without children', () => {
      // @gate enableFragmentRefs && enableFragmentRefsScrollIntoView
      /** 测试场景：验证「calls scrollIntoView on the next sibling by default, or if alignToTop=true」描述的渲染、交互或错误处理结果。 */
      it('calls scrollIntoView on the next sibling by default, or if alignToTop=true', async () => {
        const fragmentRef = React.createRef();
        const siblingARef = React.createRef();
        const siblingBRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);
        await act(() => {
          root.render(
            <div>
              <Wrapper>
                <div ref={siblingARef} />
              </Wrapper>
              <Fragment ref={fragmentRef} />
              <div ref={siblingBRef} />
            </div>,
          );
        });

        siblingARef.current.scrollIntoView = jest.fn();
        siblingBRef.current.scrollIntoView = jest.fn();

        // 默认调用
        fragmentRef.current.scrollIntoView();
        expect(siblingARef.current.scrollIntoView).toHaveBeenCalledTimes(0);
        expect(siblingBRef.current.scrollIntoView).toHaveBeenCalledTimes(1);

        siblingBRef.current.scrollIntoView.mockClear();

        // alignToTop=true
        fragmentRef.current.scrollIntoView(true);
        expect(siblingARef.current.scrollIntoView).toHaveBeenCalledTimes(0);
        expect(siblingBRef.current.scrollIntoView).toHaveBeenCalledTimes(1);
      });

      // @gate enableFragmentRefs && enableFragmentRefsScrollIntoView
      /** 测试场景：验证「calls scrollIntoView on the prev sibling if alignToTop is false」描述的渲染、交互或错误处理结果。 */
      it('calls scrollIntoView on the prev sibling if alignToTop is false', async () => {
        const fragmentRef = React.createRef();
        const siblingARef = React.createRef();
        const siblingBRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);
        /** `C`：封装当前用例复用的操作、回调或断言步骤。 */
        function C() {
          return (
            <Wrapper>
              <div id="C" ref={siblingARef} />
            </Wrapper>
          );
        }
        /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
        function Test() {
          return (
            <div id="A">
              <div id="B" />
              <C />
              <Fragment ref={fragmentRef} />
              <div id="D" ref={siblingBRef} />
              <div id="E" />
            </div>
          );
        }
        await act(() => {
          root.render(<Test />);
        });

        siblingARef.current.scrollIntoView = jest.fn();
        siblingBRef.current.scrollIntoView = jest.fn();

        // alignToTop=false
        fragmentRef.current.scrollIntoView(false);
        expect(siblingARef.current.scrollIntoView).toHaveBeenCalledTimes(1);
        expect(siblingBRef.current.scrollIntoView).toHaveBeenCalledTimes(0);
      });

      // @gate enableFragmentRefs && enableFragmentRefsScrollIntoView
      /** 测试场景：验证「calls scrollIntoView on the parent if there are no siblings」描述的渲染、交互或错误处理结果。 */
      it('calls scrollIntoView on the parent if there are no siblings', async () => {
        const fragmentRef = React.createRef();
        const parentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);
        await act(() => {
          root.render(
            <div ref={parentRef}>
              <Wrapper>
                <Fragment ref={fragmentRef} />
              </Wrapper>
            </div>,
          );
        });

        parentRef.current.scrollIntoView = jest.fn();
        fragmentRef.current.scrollIntoView();
        expect(parentRef.current.scrollIntoView).toHaveBeenCalledTimes(1);
      });

      // @gate enableFragmentRefs && enableFragmentRefsScrollIntoView
      /** 测试场景：验证「scrolls the host element when the fallback target is a ShadowRoot container」描述的渲染、交互或错误处理结果。 */
      it('scrolls the host element when the fallback target is a ShadowRoot container', async () => {
        const fragmentRef = React.createRef();
        const host = document.createElement('div');
        container.appendChild(host);
        const shadowRoot = host.attachShadow({mode: 'open'});
        const root = ReactDOMClient.createRoot(shadowRoot);
        await act(() => {
          root.render(<Fragment ref={fragmentRef} />);
        });

        // ShadowRoot 的宿主元素表示片段的内容将出现在哪里。
        host.scrollIntoView = jest.fn();
        fragmentRef.current.scrollIntoView();
        expect(host.scrollIntoView).toHaveBeenCalledTimes(1);
      });

      // @gate enableFragmentRefs && enableFragmentRefsScrollIntoView
      /** 测试场景：验证「warns without scrolling when the fallback target is a detached DocumentFragment container」描述的渲染、交互或错误处理结果。 */
      it('warns without scrolling when the fallback target is a detached DocumentFragment container', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(
          document.createDocumentFragment(),
        );
        await act(() => {
          root.render(<Fragment ref={fragmentRef} />);
        });

        expect(() => fragmentRef.current.scrollIntoView()).not.toThrow();
        assertConsoleWarnDev(
          [
            'You are attempting to scroll a FragmentInstance that is only ' +
              'mounted inside a detached DocumentFragment. No scroll was ' +
              'performed.',
          ],
          {withoutStack: true},
        );
      });
    });
  });

  describe('with text nodes', () => {
    // @gate enableFragmentRefs && enableFragmentRefsTextNodes
    /** 测试场景：验证「getClientRects includes text node bounds」描述的渲染、交互或错误处理结果。 */
    it('getClientRects includes text node bounds', async () => {
      const restoreRange = mockRangeClientRects([
        {x: 0, y: 0, width: 80, height: 16},
      ]);
      const fragmentRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      await act(() =>
        root.render(
          <div>
            <Fragment ref={fragmentRef}>Hello World</Fragment>
          </div>,
        ),
      );

      const rects = fragmentRef.current.getClientRects();
      expect(rects.length).toBe(1);
      expect(rects[0].width).toBe(80);
      restoreRange();
    });

    // @gate enableFragmentRefs && enableFragmentRefsTextNodes
    /** 测试场景：验证「getClientRects includes both text and element bounds」描述的渲染、交互或错误处理结果。 */
    it('getClientRects includes both text and element bounds', async () => {
      const restoreRange = mockRangeClientRects([
        {x: 0, y: 0, width: 60, height: 16},
      ]);
      const fragmentRef = React.createRef();
      const childRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      await act(() =>
        root.render(
          <div>
            <Fragment ref={fragmentRef}>
              Text before
              <div ref={childRef}>Element</div>
              Text after
            </Fragment>
          </div>,
        ),
      );

      setClientRects(childRef.current, [
        {x: 10, y: 10, width: 100, height: 20},
      ]);
      const rects = fragmentRef.current.getClientRects();
      // 应取得 2 个文本节点与 1 个元素的 rect，共 3 个。
      expect(rects.length).toBe(3);
      restoreRange();
    });

    // @gate enableFragmentRefs
    /** 测试场景：验证「compareDocumentPosition works with text children」描述的渲染、交互或错误处理结果。 */
    it('compareDocumentPosition works with text children', async () => {
      const fragmentRef = React.createRef();
      const beforeRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      await act(() =>
        root.render(
          <div>
            <div ref={beforeRef} />
            <Fragment ref={fragmentRef}>Text content</Fragment>
          </div>,
        ),
      );

      const position = fragmentRef.current.compareDocumentPosition(
        beforeRef.current,
      );
      expect(position & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    });

    // @gate enableFragmentRefs
    /** 测试场景：验证「focus is a no-op on text-only fragment」描述的渲染、交互或错误处理结果。 */
    it('focus is a no-op on text-only fragment', async () => {
      const fragmentRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      await act(() =>
        root.render(
          <div>
            <Fragment ref={fragmentRef}>Text only content</Fragment>
          </div>,
        ),
      );

      // 不应抛错或警告，只需静默执行空操作。
      fragmentRef.current.focus();
      // 如果没有错误,测试会通过
    });

    // @gate enableFragmentRefs
    /** 测试场景：验证「focusLast is a no-op on text-only fragment」描述的渲染、交互或错误处理结果。 */
    it('focusLast is a no-op on text-only fragment', async () => {
      const fragmentRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      await act(() =>
        root.render(
          <div>
            <Fragment ref={fragmentRef}>Text only content</Fragment>
          </div>,
        ),
      );

      // 不应抛错或警告，只需静默执行空操作。
      fragmentRef.current.focusLast();
    });

    // @gate enableFragmentRefs && enableFragmentRefsTextNodes
    /** 测试场景：验证「warns when observeUsing is called on text-only fragment」描述的渲染、交互或错误处理结果。 */
    it('warns when observeUsing is called on text-only fragment', async () => {
      mockIntersectionObserver();
      const fragmentRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      await act(() =>
        root.render(
          <div>
            <Fragment ref={fragmentRef}>Text only content</Fragment>
          </div>,
        ),
      );

      const observer = new IntersectionObserver(() => {});
      fragmentRef.current.observeUsing(observer);
      assertConsoleErrorDev(
        [
          'observeUsing() was called on a FragmentInstance with only text children. ' +
            'Observers do not work on text nodes.',
        ],
        {withoutStack: true},
      );
    });

    // @gate enableFragmentRefs && enableFragmentRefsScrollIntoView
    /** 测试场景：验证「scrollIntoView works on text-only fragment using Range API」描述的渲染、交互或错误处理结果。 */
    it('scrollIntoView works on text-only fragment using Range API', async () => {
      const restoreRange = mockRangeClientRects([
        {x: 100, y: 200, width: 80, height: 16},
      ]);
      const fragmentRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      await act(() =>
        root.render(
          <div>
            <Fragment ref={fragmentRef}>Text content</Fragment>
          </div>,
        ),
      );

      // mock window.scrollTo，以验证它被调用。
      const originalScrollTo = window.scrollTo;
      const scrollToMock = jest.fn();
      window.scrollTo = scrollToMock;

      fragmentRef.current.scrollIntoView();

      // 应该为文本节点调用 window.scrollTo
      expect(scrollToMock).toHaveBeenCalled();

      window.scrollTo = originalScrollTo;
      restoreRange();
    });

    // @gate enableFragmentRefs && enableFragmentRefsTextNodes && enableFragmentRefsScrollIntoView
    /** 测试场景：验证「scrollIntoView scrolls to text siblings of an empty fragment using the Range API」描述的渲染、交互或错误处理结果。 */
    it('scrollIntoView scrolls to text siblings of an empty fragment using the Range API', async () => {
      const restoreRange = mockRangeClientRects([
        {x: 100, y: 200, width: 80, height: 16},
      ]);
      const fragmentRef = React.createRef();
      const parentRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      await act(() =>
        root.render(
          <div ref={parentRef}>
            Text before
            <Fragment ref={fragmentRef} />
            Text after
          </div>,
        ),
      );

      const parentScrollMock = jest.fn();
      parentRef.current.scrollIntoView = parentScrollMock;
      // mock window.scrollTo，以验证基于 Range 的文本滚动。
      const originalScrollTo = window.scrollTo;
      const scrollToMock = jest.fn();
      window.scrollTo = scrollToMock;

      // 默认调用会滚动到后续文本兄弟节点。
      fragmentRef.current.scrollIntoView();
      expect(scrollToMock).toHaveBeenCalledTimes(1);
      expect(parentScrollMock).toHaveBeenCalledTimes(0);

      scrollToMock.mockClear();

      // alignToTop=false 时滚动到前一个文本兄弟节点。
      fragmentRef.current.scrollIntoView(false);
      expect(scrollToMock).toHaveBeenCalledTimes(1);
      expect(parentScrollMock).toHaveBeenCalledTimes(0);

      window.scrollTo = originalScrollTo;
      restoreRange();
    });

    // @gate enableFragmentRefs
    /** 测试场景：验证「treats passive:true and passive:false as same listener per DOM spec」描述的渲染、交互或错误处理结果。 */
    it('treats passive:true and passive:false as same listener per DOM spec', async () => {
      const fragmentRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          <Fragment ref={fragmentRef}>
            <div id="child" />
          </Fragment>,
        );
      });

      const logs = [];
      /** `handler`：封装当前用例复用的操作、回调或断言步骤。 */
      const handler = () => logs.push('fired');

      const child = document.querySelector('#child');
      const spy = jest.spyOn(child, 'addEventListener');
      // 根据 DOM 规范，监听器标识由 (type, callback, capture) 组成；passive 不属于 key，因此二者是同一个监听器。
      fragmentRef.current.addEventListener('click', handler, {passive: false});
      // 第二次添加是空操作，因为 (type, callback, capture) 标识相同。
      fragmentRef.current.addEventListener('click', handler, {passive: true});
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('click', handler, {passive: false});

      document.querySelector('#child').click();
      // 第一个处理器仅触发一次（第二个添加是无操作的）。
      expect(logs).toEqual(['fired']);

      // removeEventListener 匹配监听器时也会忽略 passive。
      fragmentRef.current.removeEventListener('click', handler, {
        passive: true,
      });

      logs.length = 0;
      document.querySelector('#child').click();
      expect(logs).toEqual([]);
    });
    // @gate enableFragmentRefs
    /** 测试场景：验证「removes a listener registered with passive:false when removed with passive:true」描述的渲染、交互或错误处理结果。 */
    it('removes a listener registered with passive:false when removed with passive:true', async () => {
      const fragmentRef = React.createRef(null);
      /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
      function Test() {
        return (
          <>
            <div id="child-x" />
          </>
        );
      }
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <Fragment ref={fragmentRef}>
            <Test />
          </Fragment>,
        );
      });
      const logs = [];
      /** `handler`：封装当前用例复用的操作、回调或断言步骤。 */
      function handler() {
        logs.push('fired');
      }
      // 使用 passive: false 注册。
      fragmentRef.current.addEventListener('click', handler, {
        passive: false,
      });
      document.querySelector('#child-x').click();
      expect(logs).toEqual(['fired']);
      logs.length = 0;
      // 使用 passive: true 移除。按 DOM 规范，passive 不属于监听器标识，因此即使 passive 不一致也必须移除监听器。
      fragmentRef.current.removeEventListener('click', handler, {
        passive: true,
      });
      document.querySelector('#child-x').click();
      // 监听器移除 - 无进一步调用
      expect(logs).toEqual([]);
    });
  });
});
