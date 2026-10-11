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

/** 直接返回children，不产生宿主节点；供Fragment遍历穿过函数包装的焦点、监听和滚动用例。 */
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

  /** parent div 内挂载带对象ref的Fragment与child；断言DOM没有Fragment包装且ref非null，验证提交连接FragmentInstance与保持宿主结构。 */
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

  /** Fragment通过callback保存实例；挂载后实例含_fragmentFiber，验证callback收到FragmentInstance而非包装DOM。 */
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

  /** Test在layout/passive Effect中读取同一Fragment ref；两种Effect均断言非null，验证ref在这些提交回调执行前已连接。 */
  it('is available in effects', async () => {

    /** 为Fragment创建ref并分别在layout/passive Effect断言非null，返回含div的实例树观察ref连接时序。 */
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

  /** 父Fragment含嵌套Fragment的A/B与自身C，再加入D；逐节点检查reactFragments集合，A/B含两级handle、C/D只含父handle，验证宿主记录所属Fragment并随插入更新。 */
  it('attaches fragment handles to nodes', async () => {
    const fragmentParentRef = React.createRef();
    const fragmentRef = React.createRef();

    /** show控制父Fragment的D，嵌套Fragment含A/B、父另有C，提供reactFragments归属集合对照。 */
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

      /** Fragment子树先有不可聚焦div/style再有B/C链接；调用focus后activeElement=child-b，验证按序跳过无焦点候选并选首个可聚焦宿主；随后blur。 */
      it('focuses the first focusable child', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** 返回div/style和两个链接，Fragment.focus应跳过前两类并选择B。 */
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

      /** 首分支深层tabIndex div内又有链接，后分支为链接；focus选grandchild-a的tabIndex宿主，验证深度优先查到可聚焦节点后停止，不先选其更深链接。 */
      it('focuses deeply nested focusable children, depth first', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** 返回深层tabIndex宿主内的链接及外层后方链接，提供深度优先首候选对照。 */
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

      /** 通过showA/showB先只A、再A/B、最后只B；每轮focus分别为A、A、B，验证当前提交的子节点文档顺序参与焦点选择。 */
      it('preserves document order when adding and removing children', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** showA/showB分别控制两链接是否存在，供提交后焦点候选顺序更新。 */
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

      /** 两链接中先手动聚焦首A，再调用Fragment.focus；activeElement仍A，验证已聚焦的首候选不会被误判失败而继续选B。 */
      it('keeps focus on the first focusable child if already focused', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** 返回按序A/B两个链接，供首个已聚焦目标不被跳过的验证。 */
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

      /** 先聚焦Fragment首分支的nested-input，再调用focus；焦点仍该input，验证嵌套首候选已聚焦时正确停止。 */
      it('keeps focus on a nested child if already focused', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** 返回包装内input与后方链接，供已聚焦的深层首候选对照。 */
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

      /** Fragment只包含fieldset/legend和两个input；focus选street，验证fieldset非聚焦包装不会阻挡寻找首个输入。 */
      it('focuses the first focusable child in a fieldset', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** 返回fieldset/legend与street/city两个input，供跳过不可聚焦分组宿主的验证。 */
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

      /** Fragment末端有不可聚焦div/style，Wrapper内C链接之前还有A/B；focusLast选C，验证逆向搜索穿过非宿主组件并跳过不可聚焦末端。 */
      it('focuses the last focusable child', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** 返回A/B及Wrapper内C链接，再追加不可聚焦div/style，供focusLast反向搜索。 */
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

      /** 两个分支含嵌套链接，最后分支本身有tabIndex；focusLast选其grandchild-b而非父div，验证反向深度优先末端候选。 */
      it('focuses deeply nested focusable children, depth first', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** 返回两组嵌套链接且末分支父div有tabIndex，供反向深度优先选择深层末端。 */
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

      /** Fragment内一个链接先由focus选中，再blur；activeElement变为body，验证清除Fragment内部目标焦点。 */
      it('removes focus from an element inside of the Fragment', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** 返回Fragment内单链接，供focus后blur的基本清理路径。 */
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

      /** Fragment包div内input，focus后为nested-input，再blur后body，验证blur包含嵌套后代。 */
      it('removes focus from a nested element inside of the Fragment', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** 返回Fragment内div包input，供blur遍历嵌套焦点目标。 */
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

      /** 外Fragment A首链接不属于内Fragment B；A.focus选child-a后调用B.blur，焦点仍child-a，验证blur不影响实例范围外目标。 */
      it('does not remove focus from elements outside of the Fragment', async () => {
        const fragmentRefA = React.createRef();
        const fragmentRefB = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** 返回父Fragment A的首链接及嵌套Fragment B链接，供B.blur不影响A范围内但B范围外的焦点。 */
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

      /** Effect给Fragment添加click、两个子DOM各加原生回调；点击父无日志、点击A/B先Fragment后目标原生；remove Fragment回调后只剩目标日志，验证顶层宿主监听安装及移除。 */
      it('adds and removes event listeners from children', async () => {
        const parentRef = React.createRef();
        const fragmentRef = React.createRef();
        const childARef = React.createRef();
        const childBRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        let logs = [];

        /** 记录fragmentRef标签，不读取event参数，供子DOM监听安装顺序与移除的日志断言。 */
        function handleFragmentRefClicks() {
          logs.push('fragmentRef');
        }

        /** 一次Effect在Fragment挂click并返回remove清理，输出文本、直接A与嵌套无ref Fragment的B，构造宿主遍历fixture。 */
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

      /** 父Fragment与两个嵌套Fragment分别注册click；B在宿主包装内先内后父、C同层先父后内；移除父及第一内回调后C只触发第二内回调，验证按实际宿主位置及注册顺序派发。 */
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

        /** 记录父Fragment标签，供嵌套实例在同一click中的监听顺序。 */
        function handleFragmentRefClicks() {
          logs.push('fragmentRef');
        }

        /** 记录宿主包装内nestedFragmentRef标签，与父宿主上的监听位置形成冒泡对照。 */
        function handleNestedFragmentRefClicks() {
          logs.push('nestedFragmentRef');
        }

        /** 记录无宿主包装的nestedFragmentRef2标签，供同一目标按注册顺序执行的对照。 */
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

      /** Fragment初始只有A，先注册click，再state添加B；新B ref从null变节点、点击使标志true，验证已有监听配置随新宿主插入应用。 */
      it('adds an event listener to a newly added child', async () => {
        const fragmentRef = React.createRef();
        const childRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);
        let showChild;

        /** shouldShowChild初始false，外露showChild更新为true；返回固定A与可新增B，验证已登记监听随插入应用。 */
        function Component() {
          const [shouldShowChild, setShouldShowChild] = React.useState(false);
          /** 设置shouldShowChild=true，在后续提交插入带childRef的B节点。 */
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

      /** Fragment包含直接Host A及三层Wrapper下Host B；注册click后分别点击得到A/B文本，验证遍历穿过非宿主组件找到顶层宿主。 */
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

      /** Test无依赖数组Effect添加click并返回移除函数；首次点击child-a一次，rerender触发清理再安装后仍一次，验证Effect内监听续接不累积。 */
      it('allows adding and cleaning up listeners in effects', async () => {
        const root = ReactDOMClient.createRoot(container);

        let logs = [];

        /** 记录event.currentTarget.id，观察Fragment底层实际安装在哪个宿主而非实例自身。 */
        function logClick(e) {
          logs.push(e.currentTarget.id);
        }

        let rerender;
        let removeEventListeners;

        /** useRef持有实例，dummy state供rerender；每轮Effectadd监听并返回共享remove函数，供重复提交监听不累积。 */
        function Test() {
          const fragmentRef = React.useRef(null);
          // eslint-disable-next-line no-unused-vars
          const [_, setState] = React.useState(0);
          /** 用函数式setState递增dummy值，触发Effect清理/重新安装而不改变宿主内容。 */
          rerender = () => {
            setState(p => p + 1);
          };
          /** 从当前Fragment实例移除logClick，作为Effect返回的cleanup；回调匹配同一函数身份。 */
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

      /** 固定child-a先添加click并确认一次，再remove后点击同一节点无日志，验证移除已有监听；本用例没有新增child，不能由标题推导新child传播。 */
      it('does not apply removed event listeners to new children', async () => {
        const root = ReactDOMClient.createRoot(container);
        const fragmentRef = React.createRef(null);

        /** 返回固定child-a实例树，供已注册监听移除后的同一节点对照。 */
        function Test() {
          return (
            <Fragment ref={fragmentRef}>
              <div id="child-a" />
            </Fragment>
          );
        }

        let logs = [];

        /** 记录当前监听宿主id，供添加后一次、移除后零次的日志断言。 */
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

      /** 以boolean true注册捕获监听，点击后有capture；以{capture:true}移除后再点击无日志，验证capture标识的两种写法归一化。 */
      it('removes a capture listener registered with boolean when removed with options object', async () => {
        const fragmentRef = React.createRef(null);

        /** 返回child-a的Fragment，供boolean注册/options对象移除捕获监听。 */
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

        /** 记录capture，区分捕获监听存在与解绑后的空日志。 */
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

      /** 以{capture:true}注册，再以boolean true移除；前后日志从capture变空，验证反向选项归一化。 */
      it('removes a capture listener registered with options object when removed with boolean', async () => {
        const fragmentRef = React.createRef(null);

        /** 返回child-b的Fragment，供options注册/boolean移除捕获监听。 */
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

        /** 记录capture，供反向capture选项归一化验证。 */
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

      /** Fragment包含本地A与Portal到body的B；添加click后点击各自只记录对应id，验证Fragment遍历也给Portal子宿主安装监听。 */
      it('applies event listeners to portaled children', async () => {
        const fragmentRef = React.createRef();
        const childARef = React.createRef();
        const childBRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** 返回本地A和Portal到body的B，共同位于实例的React子树，供跨DOM容器监听。 */
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

        /** Fragment中Child2处于hidden Activity，其他两宿主可见；命令式点击三个DOM只记录Child1/3，验证监听不应用到隐藏Activity子树。 */
        it('does not apply event listeners to hidden trees', async () => {
          const parentRef = React.createRef();
          const fragmentRef = React.createRef();
          const root = ReactDOMClient.createRoot(container);

          /** 返回Child1/3及hidden Activity中的Child2，供监听遍历过滤Activity隐藏分支。 */
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

        /** Activity=visible且两边宿主同属Fragment；点击三个DOM依序记录Child1/2/3，验证可见Activity后代参与监听。 */
        it('applies event listeners to visible trees', async () => {
          const parentRef = React.createRef();
          const fragmentRef = React.createRef();
          const root = ReactDOMClient.createRoot(container);

          /** 返回Child1/3与visible Activity中的Child2，供可见分支监听对照。 */
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

        /** 嵌套Fragment处于Activity，初始visible注册后点击日志1→2；hidden时点击无日志，再visible后日志2→1，验证隐藏断开与揭示续接，并记录重新注册造成的次序。 */
        it('handles Activity modes switching', async () => {
          const fragmentRef = React.createRef();
          const fragmentRef2 = React.createRef();
          const parentRef = React.createRef();
          const root = ReactDOMClient.createRoot(container);

          /** mode控制Activity，外Fragment及Activity内嵌套Fragment各有宿主；供隐藏断开/揭示重连次序验证。 */
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

      /** Fragment在带React click的parent/grandparent内；dispatch冒泡click以parent为target，日志parent→grandparent而无child；保存handle后卸载再dispatch两种bubbles均无日志且返回未取消，验证宿主父入口及失效实例行为。 */
      it('fires events on the host parent if bubbles=true', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);
        let logs = [];

        /** 记录event.type、target.id与currentTarget.id，区分实例dispatch入口和祖先合成传播目标。 */
        function handleClick(e) {
          logs.push([e.type, e.target.id, e.currentTarget.id]);
        }

        /** isMounted控制parent内Fragment/child，parent/grandparent始终有合成click，供挂载与失效handle的dispatch对照。 */
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

      /** 空Fragment位于parent，实例自有原生click监听与parent合成监听；bubbles=true先记录实例(无id)再parent，false只实例，验证实例EventTarget与向宿主父的传播分流。 */
      it('fires events on self, and only self if bubbles=false', async () => {
        const fragmentRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);
        let logs = [];

        /** 记录事件类型和两个id；实例事件没有DOM id，用undefined区别于parent分发。 */
        function handleClick(e) {
          logs.push([e.type, e.target.id, e.currentTarget.id]);
        }

        /** 返回带React click的parent与空Fragment，供实例原生listener及向父传播的分流。 */
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

    /** Effect observeUsing同一IO并捕获实例供cleanup；showB false→true→false及root=null后模拟全部现有子元素，日志A→A/B→A→空，验证动态宿主观测与卸载unobserve。 */
    it('attaches intersection observers to children', async () => {
      let logs = [];
      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          logs.push(entry.target.id);
        });
      });

      /** showB控制第二宿主；Effectobserve并捕获lastRefValue供unobserve清理，避免卸载时ref变null后丢失实例。 */
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

      /** 取当前parent的Element children，为每个构造1×1、ratio=1的IO通知；没有parent时不通知，供插入/删除/卸载观测。 */
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

    /** 实例尚未订阅observer时unobserve，再订阅observer却unobserve另一observer；分别断言同一开发警告，验证解绑要求该实例先登记同一个observer。 */
    it('warns when unobserveUsing() is called with an observer that was not observed', async () => {
      const fragmentRef = React.createRef();
      const observer = new IntersectionObserver(() => {});
      const observer2 = new IntersectionObserver(() => {});

      /** 返回单div的Fragment供注册一个observer后尝试解绑未注册observer的警告。 */
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

    /** WeakMap为Fragment/DOM缓存回调并共用IO，通过reactFragments将childA通知分发grandparent/parentA、childB给parentB、childC给parentB/手动childC；断言这些日志，验证handle支持回调路由，不断言性能。 */
    it('attaches handles to observed elements to allow caching of observers', async () => {
      const targetToCallbackMap = new WeakMap();
      let cachedObserver = null;

      /** 为Fragment或DOM目标在WeakMap追加onIntersection；仅首次创建IO，通知时先按reactFragments路由再按DOM目标路由，返回缓存observer供混合订阅。 */
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

      /** 接收onIntersection/children，layout注册缓存IO到Fragment并保存实例给unobserve清理；返回ref Fragment包children。 */
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

      /** 按id记录observe标签，供共享IO通知回调路由顺序。 */
      function logIntersection(id) {
        logs.push(`observe: ${id}`);
      }

      /** id对应div的layout Effect直接注册缓存IO并在cleanup unobserve此DOM，作为Fragment订阅之外的手动目标对照。 */
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

      /** 构造嵌套两Fragment包A、另一Fragment包B与手动IO的C，供共享observer按handle路由。 */
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

    /** Fragment两个宿主分别mock两个/一个client rect；getClientRects得到三项且left为1、5、9，验证按宿主顺序展开全部片段矩形。 */
    it('returns the bounding client rects of all children', async () => {
      const fragmentRef = React.createRef();
      const childARef = React.createRef();
      const childBRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      /** 返回两个带ref的顶层div，供每宿主多个client rect顺序展开。 */
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

    /** 已连接Fragment位于普通div内；getRootNode返回document，验证沿已挂载父宿主查询根节点。 */
    it('returns the root node of the parent', async () => {
      const fragmentRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      /** 返回已挂载div内的Fragment，提供可沿父DOM找到document的实例。 */
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

    /** Fragment与其父div初始连接、getRootNode为document；mounted=false删除两者后保存handle返回自身，验证当前卸载后的实现；被注释掉的父节点期望并未执行。 */
    it('returns the topmost disconnected element if the fragment and parent are unmounted', async () => {
      const containerRef = React.createRef();
      const parentRef = React.createRef();
      const fragmentRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      /** mounted控制父div与Fragment一起删除，外围container宿主始终保留；保存handle供卸载后getRootNode比较。 */
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

    /** 只卸载Fragment、保留父div；保存handle从document根变为自身，验证实例失去挂载父链后的返回值。 */
    it('returns self when only the fragment was unmounted', async () => {
      const fragmentRef = React.createRef();
      const parentRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      /** mounted只控制Fragment，父ref div保留，供部分卸载后实例根查询。 */
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

    /** 将position位掩码拆为following/preceding/contains/containedBy/disconnected/implementationSpecific布尔对象，与spec严格比较，不忽略额外标志。 */
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

    /** Fragment含三个宿主且前后有兄弟；比较body/container、前后兄弟、三子节点和独立div，逐位检查包含/顺序/断连，验证实例把子树范围映射到DOM位置标志。 */
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

      /** 返回前兄弟、三宿主Fragment、后兄弟及container refs，提供完整位置关系对照。 */
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

    /** Fragment只有一个宿主且位于内包装div；比较前后兄弟、唯一子、外container及断连div，逐位核对位置，验证单子范围仍具有包含与文档顺序语义。 */
    it('handles fragment instances with one child', async () => {
      const fragmentRef = React.createRef();
      const beforeRef = React.createRef();
      const afterRef = React.createRef();
      const containerRef = React.createRef();
      const onlyChildRef = React.createRef();
      const disconnectedElement = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      /** 在内包装div中返回前兄弟、单宿主Fragment、后兄弟，供单节点范围位置比较。 */
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

    /** 空Fragment在前后兄弟及外层兄弟之间；全部结果带implementationSpecific，保留推断的preceding/following/contains，验证无宿主范围时的位置比较分支。 */
    it('handles empty fragment instances', async () => {
      const fragmentRef = React.createRef();
      const beforeParentRef = React.createRef();
      const beforeRef = React.createRef();
      const afterRef = React.createRef();
      const afterParentRef = React.createRef();
      const containerRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      /** 返回空Fragment及内/外前后兄弟、父容器refs，供无DOM范围的implementationSpecific比较。 */
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

    /** Fragment包含直接A、嵌套Fragment的B和函数组件C宿主；比较三者均仅containedBy=true，验证非宿主包装不改变实例对子树宿主的包含。 */
    it('handles nested children', async () => {
      const fragmentRef = React.createRef();
      const nestedFragmentRef = React.createRef();
      const childARef = React.createRef();
      const childBRef = React.createRef();
      const childCRef = React.createRef();
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);

      /** 返回childCRef标记的C宿主，提供函数组件包装内的包含目标。 */
      function Child() {
        return (
          <div ref={childCRef} id="C">
            C
          </div>
        );
      }

      /** 返回直接A、嵌套Fragment的B及Child(C)，供不同非宿主包装的包含范围。 */
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

    /** 初始Fragment位于container内，比较得到preceding/contains；删除Fragment后保存handle比较同一container仅disconnected=true，验证卸载实例不再保有DOM范围关联。 */
    it('returns disconnected for comparison with an unmounted fragment instance', async () => {
      const fragmentRef = React.createRef();
      const containerRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      /** mount控制含div的Fragment，而container宿主保留；用例保存实例比较卸载前后关联。 */
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

    /** 根级Fragment含非空实例、空实例及前后兄弟；非空实例对child为containedBy、兄弟按顺序；空实例对所有比较带implementationSpecific并保留顺序，验证容器级无包装树。 */
    it('compares a root-level Fragment', async () => {
      const fragmentRef = React.createRef();
      const emptyFragmentRef = React.createRef();
      const childRef = React.createRef();
      const siblingPrecedingRef = React.createRef();
      const siblingFollowingRef = React.createRef();
      const root = ReactDOMClient.createRoot(container);

      /** 返回根级前兄弟、非空实例、空实例、后兄弟，供无额外宿主包装的位置比较。 */
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

      /** 兄弟Portal A与Fragment内Portal B均定向同容器；A与实例比较为preceding，B在React包含但DOM不包含时仅implementationSpecific，验证两种树位置不一致的收口。 */
      it('handles portaled elements', async () => {
        const fragmentRef = React.createRef();
        const portaledSiblingRef = React.createRef();
        const portaledChildRef = React.createRef();

        /** 兄弟Portal A与Fragment内Portal B都指向container，同时实例有本地C；构造React与DOM包含不一致输入。 */
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

      /** 两个Portal均定向body，Effect给首Fragment后添C/D，DOM顺序实际A/B/C；断言A/C/D containedBy，夹在范围中的另一Portal B与本地E只implementationSpecific，验证DOM与React归属冲突不会伪装包含。 */
      it('handles multiple portals to the same element', async () => {
        const root = ReactDOMClient.createRoot(container);
        const fragmentRef = React.createRef();
        const childARef = React.createRef();
        const childBRef = React.createRef();
        const childCRef = React.createRef();
        const childDRef = React.createRef();
        const childERef = React.createRef();

        /** c初始false，Effect设true后在首Portal的Fragment添C/D；第二Portal B共享body、本地E在根内，提供实际DOM顺序与React归属冲突。 */
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

      /** 空Fragment Portal到body，A/B仍在本地根；比较body为contains+preceding、A/B均preceding，全部implementationSpecific，验证空Portal实例的DOM位置推断。 */
      it('handles empty fragments', async () => {
        const fragmentRef = React.createRef();
        const childARef = React.createRef();
        const childBRef = React.createRef();

        /** 将空Fragment Portal到body，而本地A/B留在container，供空实例的DOM位置推断。 */
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

    /** 只比较日志数组最后一项与目标值，验证最终scroll调用对象；不约束前面调用数或真实滚动位置。 */
    function expectLast(arr, test) {
      expect(arr[arr.length - 1]).toBe(test);
    }
    // @gate enableFragmentRefs && enableFragmentRefsScrollIntoView

    /** 空实例调用scrollIntoView({block:start})同步抛暂不支持options错误，验证此版只接受alignToTop布尔值的参数边界。 */
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

      /** 两个宿主的scrollIntoView都用记录替身；默认及true调用后最后记录为childA，验证最终对齐首宿主的调用顺序，未测真实滚动位置。 */
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

      /** 两个宿主记录scroll调用；alignToTop=false后最后记录childB，验证末端对齐调用顺序。 */
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

      /** 实例先含Portal A(body)、后含本地B；默认scroll调用后最后记录childA，验证树序首子参与滚动目标选择，不测平台滚动量。 */
      it('handles portaled elements -- same scroll container', async () => {
        const fragmentRef = React.createRef();
        const childARef = React.createRef();
        const childBRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** 返回body Portal的A和本地B，供scrollIntoView树序首子选择。 */
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

      /** 先建固定header和滚动容器，再挂多个Portal到不同位置；默认最后记录header，false最后记录C，验证跨容器候选的最终调用顺序，不断言滚动容器实际偏移。 */
      it('handles portaled elements -- different scroll container', async () => {
        const fragmentRef = React.createRef();
        const headerChildRef = React.createRef();
        const childARef = React.createRef();
        const childBRef = React.createRef();
        const childCRef = React.createRef();
        const scrollContainerRef = React.createRef();
        const scrollContainerNestedRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** 先返回fixed header与两级overflow宿主；mountFragment=true时Portal四项到已存在目标，供跨DOM位置的滚动调用顺序。 */
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

      /** 空Fragment前为Wrapper下A、后为B；默认/true各只调用B的scrollIntoView一次，验证无子节点时查找后续宿主兄弟。 */
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

      /** 空Fragment前有函数组件C输出宿主、后有D；false只调用C宿主一次，验证向前查找穿过非宿主组件。 */
      it('calls scrollIntoView on the prev sibling if alignToTop is false', async () => {
        const fragmentRef = React.createRef();
        const siblingARef = React.createRef();
        const siblingBRef = React.createRef();
        const root = ReactDOMClient.createRoot(container);

        /** 经Wrapper返回C宿主，供空Fragment向前查兄弟时穿过函数/非宿主节点。 */
        function C() {
          return (
            <Wrapper>
              <div id="C" ref={siblingARef} />
            </Wrapper>
          );
        }

        /** 返回B、C组件、空Fragment、D/E的宿主顺序，供false选择前宿主C的对照。 */
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

      /** 空Fragment只有Wrapper包装、无兄弟；scrollIntoView调用父宿主一次，验证无候选兄弟时回退父节点。 */
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

      /** 以ShadowRoot为根挂空实例；scrollIntoView调用shadow host替身一次，验证根容器不能滚动时回退其host。 */
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

      /** 以脱离文档的DocumentFragment为根挂空实例；scrollIntoView不抛并报告No scroll was performed开发警告，验证无可滚动宿主的边界。 */
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

    /** 用Range矩形替身测量纯Hello World文本；getClientRects一项、宽80，验证文本宿主可通过Range测量；最后恢复Range。 */
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

    /** 实例内两段文本夹一个div；Range/Element各有尺寸替身，断言合计三rect，验证文本与元素测量合并；最后恢复Range。 */
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

    /** 实例只有文本、前面有普通div；compareDocumentPosition(div)包含PRECEDING位，验证文本子树仍可确定前方宿主顺序。 */
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

    /** 纯文本Fragment调用focus正常完成，验证没有可聚焦宿主时不会抛；未断言activeElement具体值。 */
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

      // 纯文本没有可聚焦宿主；本次调用应正常返回。
      fragmentRef.current.focus();
      // 本用例不对activeElement作断言。
    });

    // @gate enableFragmentRefs

    /** 纯文本Fragment调用focusLast正常完成，验证反向焦点搜索无可聚焦宿主的边界；未测焦点位置。 */
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

      // 纯文本没有可聚焦宿主；本次调用应正常返回。
      fragmentRef.current.focusLast();
    });

    // @gate enableFragmentRefs && enableFragmentRefsTextNodes

    /** 为纯文本实例调用observeUsing(IO)，断言文本节点不能被observer观察的警告，验证Fragment API对Element观察能力的限制。 */
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

    /** 纯文本实例用Range矩形替身且window.scrollTo mock；scrollIntoView后scrollTo被调用，验证文本滚动经Range路径；恢复scrollTo与Range，未断言具体坐标。 */
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

    /** 空实例前后为文本，mock父scrollIntoView与window.scrollTo；默认及false均只调用scrollTo一次、父零次，验证文本兄弟优先于父宿主回退；恢复两个替身。 */
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

    /** 同一type/callback/capture用passive=false再true注册；底层addEventListener只一次且保留false选项，点击只一次；用true移除后无日志，验证passive不参与去重/解绑标识。 */
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

      /** 记录fired标签，为passive选项去重与remove匹配提供同一callback身份。 */
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

    /** Test经函数/Fragment包装输出child-x；以passive=false注册点击一次，再passive=true移除后零次，验证选项passive差异不妨碍解绑。 */
    it('removes a listener registered with passive:false when removed with passive:true', async () => {
      const fragmentRef = React.createRef(null);

      /** 经Fragment返回child-x宿主，供非宿主包装后的passive差异解绑。 */
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

      /** 记录fired，供注册后的点击与移除后的无日志对照。 */
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
