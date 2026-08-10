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
let ReactDOMClient;
let Scheduler;
let act;
let Activity;
let useState;
let useLayoutEffect;
let useEffect;
let LegacyHidden;
let assertLog;
let Suspense;

describe('ReactDOMActivity', () => {
  let container;

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    Scheduler = require('scheduler/unstable_mock');
    Activity = React.Activity;
    useState = React.useState;
    Suspense = React.Suspense;
    useState = React.useState;
    LegacyHidden = React.unstable_LegacyHidden;
    useLayoutEffect = React.useLayoutEffect;
    useEffect = React.useEffect;
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    const InternalTestUtils = require('internal-test-utils');
    act = InternalTestUtils.act;
    assertLog = InternalTestUtils.assertLog;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  /** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
  function Text(props) {
    Scheduler.log(props.text);
    return <span prop={props.text}>{props.children}</span>;
  }

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「当前参数化场景」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言覆盖 ReactTestUtils.act 到 React.act 的兼容转发与调度冲刷。
   */
  it(
    'hiding an Activity boundary also hides the direct children of any ' +
      'portals it contains, regardless of how deeply nested they are',
    async () => {
      const portalContainer = document.createElement('div');

      let setShow;
      /** `Accordion`：封装当前用例复用的操作、回调或断言步骤。 */
      function Accordion({children}) {
        const [shouldShow, _setShow] = useState(true);
        setShow = _setShow;
        return (
          <Activity mode={shouldShow ? 'visible' : 'hidden'}>
            {children}
          </Activity>
        );
      }

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App() {
        return (
          <Accordion>
            <div>
              {ReactDOM.createPortal(
                <div>Portal contents</div>,
                portalContainer,
              )}
            </div>
          </Accordion>
        );
      }

      const root = ReactDOMClient.createRoot(container);
      await act(() => root.render(<App />));
      expect(container.innerHTML).toBe('<div></div>');
      expect(portalContainer.innerHTML).toBe('<div>Portal contents</div>');

      // 隐藏 Activity 边界时，不仅隐藏最近的 DOM 元素，也隐藏其中嵌套 Portal 的子节点。
      await act(() => setShow(false));
      expect(container.innerHTML).toBe('<div style="display: none;"></div>');
      expect(portalContainer.innerHTML).toBe(
        '<div style="display: none;">Portal contents</div>',
      );
    },
  );

  /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
  it(
    'revealing an Activity boundary inside a portal does not reveal the ' +
      'portal contents if has a hidden Activity parent',
    async () => {
      const portalContainer = document.createElement('div');

      let setShow;
      /** `Accordion`：封装当前用例复用的操作、回调或断言步骤。 */
      function Accordion({children}) {
        const [shouldShow, _setShow] = useState(false);
        setShow = _setShow;
        return (
          <Activity mode={shouldShow ? 'visible' : 'hidden'}>
            {children}
          </Activity>
        );
      }

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App() {
        return (
          <Activity mode="hidden">
            <div>
              {ReactDOM.createPortal(
                <Accordion>
                  <div>Portal contents</div>
                </Accordion>,
                portalContainer,
              )}
            </div>
          </Activity>
        );
      }

      // 初始时让两个边界都处于隐藏状态。
      const root = ReactDOMClient.createRoot(container);
      await act(() => root.render(<App />));
      expect(container.innerHTML).toBe('<div style="display: none;"></div>');
      expect(portalContainer.innerHTML).toBe(
        '<div style="display: none;">Portal contents</div>',
      );

      // 显示内部 Activity 边界；由于外层 Activity 边界仍然隐藏，它不应显示自己的子节点。
      await act(() => setShow(true));
      expect(container.innerHTML).toBe('<div style="display: none;"></div>');
      expect(portalContainer.innerHTML).toBe(
        '<div style="display: none;">Portal contents</div>',
      );
    },
  );

  /** 测试场景：验证「hides new portals added to an already hidden tree」描述的渲染、交互或错误处理结果。 */
  it('hides new portals added to an already hidden tree', async () => {
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      return <Text text="Child" />;
    }

    const portalContainer = document.createElement('div');

    /** `Portal`：封装当前用例复用的操作、回调或断言步骤。 */
    function Portal({children}) {
      return <div>{ReactDOM.createPortal(children, portalContainer)}</div>;
    }

    const root = ReactDOMClient.createRoot(container);
    // 挂载隐藏树。
    await act(() => {
      root.render(
        <Activity mode="hidden">
          <Text text="Parent" />
        </Activity>,
      );
    });
    assertLog(['Parent']);
    expect(container.innerHTML).toBe(
      '<span prop="Parent" style="display: none;"></span>',
    );
    expect(portalContainer.innerHTML).toBe('');

    // 在隐藏树中添加一个 Portal。
    await act(() => {
      root.render(
        <Activity mode="hidden">
          <Text text="Parent" />
          <Portal>
            <Child />
          </Portal>
        </Activity>,
      );
    });
    assertLog(['Parent', 'Child']);
    expect(container.innerHTML).toBe(
      '<span prop="Parent" style="display: none;"></span><div style="display: none;"></div>',
    );
    expect(portalContainer.innerHTML).toBe(
      '<span prop="Child" style="display: none;"></span>',
    );

    // 现在展示它。
    await act(() => {
      root.render(
        <Activity mode="visible">
          <Text text="Parent" />
          <Portal>
            <Child />
          </Portal>
        </Activity>,
      );
    });

    assertLog(['Parent', 'Child']);
    expect(container.innerHTML).toBe(
      '<span prop="Parent" style=""></span><div style=""></div>',
    );
    expect(portalContainer.innerHTML).toBe(
      '<span prop="Child" style=""></span>',
    );
  });

  /** 测试场景：验证「hides new insertions inside an already hidden portal」描述的渲染、交互或错误处理结果。 */
  it('hides new insertions inside an already hidden portal', async () => {
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({text}) {
      useLayoutEffect(() => {
        Scheduler.log(`Mount layout ${text}`);
        return () => {
          Scheduler.log(`Unmount layout ${text}`);
        };
      }, [text]);
      return <Text text={text} />;
    }

    const portalContainer = document.createElement('div');

    /** `Portal`：封装当前用例复用的操作、回调或断言步骤。 */
    function Portal({children}) {
      return <div>{ReactDOM.createPortal(children, portalContainer)}</div>;
    }

    const root = ReactDOMClient.createRoot(container);
    // 挂载隐藏树。
    await act(() => {
      root.render(
        <Activity mode="hidden">
          <Portal>
            <Child text="A" />
          </Portal>
        </Activity>,
      );
    });
    assertLog(['A']);
    expect(container.innerHTML).toBe('<div style="display: none;"></div>');
    expect(portalContainer.innerHTML).toBe(
      '<span prop="A" style="display: none;"></span>',
    );

      // 向隐藏的 Portal 内添加节点。
    await act(() => {
      root.render(
        <Activity mode="hidden">
          <Portal>
            <Child text="A" />
            <Child text="B" />
          </Portal>
        </Activity>,
      );
    });
    assertLog(['A', 'B']);
    expect(container.innerHTML).toBe('<div style="display: none;"></div>');
    expect(portalContainer.innerHTML).toBe(
      '<span prop="A" style="display: none;"></span><span prop="B" style="display: none;"></span>',
    );

    // 现在展示它。
    await act(() => {
      root.render(
        <Activity mode="visible">
          <Portal>
            <Child text="A" />
            <Child text="B" />
          </Portal>
        </Activity>,
      );
    });

    assertLog(['A', 'B', 'Mount layout A', 'Mount layout B']);
    expect(container.innerHTML).toBe('<div style=""></div>');
    expect(portalContainer.innerHTML).toBe(
      '<span prop="A" style=""></span><span prop="B" style=""></span>',
    );
  });

  /** 测试场景：验证「reveal an inner Suspense boundary without revealing an outer Activity on the same host child」描述的渲染、交互或错误处理结果。 */
  it('reveal an inner Suspense boundary without revealing an outer Activity on the same host child', async () => {
    const promise = new Promise(() => {});

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({showInner}) {
      useLayoutEffect(() => {
        Scheduler.log('Mount layout');
        return () => {
          Scheduler.log('Unmount layout');
        };
      }, []);
      return (
        <>
          {showInner ? null : promise}
          <Text text="Child" />
        </>
      );
    }

    const portalContainer = document.createElement('div');

    /** `Portal`：封装当前用例复用的操作、回调或断言步骤。 */
    function Portal({children}) {
      return <div>{ReactDOM.createPortal(children, portalContainer)}</div>;
    }

    const root = ReactDOMClient.createRoot(container);

    // prerender 整棵树。
    await act(() => {
      root.render(
        <Activity mode="hidden">
          <Portal>
            <Suspense name="Inner" fallback={<span>Loading</span>}>
              <Child showInner={true} />
            </Suspense>
          </Portal>
        </Activity>,
      );
    });

    assertLog(['Child']);
    expect(container.innerHTML).toBe('<div style="display: none;"></div>');
    expect(portalContainer.innerHTML).toBe(
      '<span prop="Child" style="display: none;"></span>',
    );

    // 让内部边界再次挂起。
    await act(() => {
      root.render(
        <Activity mode="hidden">
          <Portal>
            <Suspense name="Inner" fallback={<span>Loading</span>}>
              <Child showInner={false} />
            </Suspense>
          </Portal>
        </Activity>,
      );
    });
    assertLog([]);
    expect(container.innerHTML).toBe('<div style="display: none;"></div>');
    expect(portalContainer.innerHTML).toBe(
      '<span prop="Child" style="display: none;"></span><span style="display: none;">Loading</span>',
    );

    // 在仍处于挂起状态时切换为可见。
    await act(() => {
      root.render(
        <Activity mode="visible">
          <Portal>
            <Suspense name="Inner" fallback={<span>Loading</span>}>
              <Child showInner={false} />
            </Suspense>
          </Portal>
        </Activity>,
      );
    });
    assertLog([]);
    expect(container.innerHTML).toBe('<div style=""></div>');
    expect(portalContainer.innerHTML).toBe(
      '<span prop="Child" style="display: none;"></span><span style="">Loading</span>',
    );

    // 现在展示。
    await act(() => {
      root.render(
        <Activity mode="visible">
          <Portal>
            <Suspense name="Inner" fallback={<span>Loading</span>}>
              <Child showInner={true} />
            </Suspense>
          </Portal>
        </Activity>,
      );
    });
    assertLog(['Child', 'Mount layout']);
    expect(container.innerHTML).toBe('<div style=""></div>');
    expect(portalContainer.innerHTML).toBe(
      '<span prop="Child" style=""></span>',
    );
  });

  /** 测试场景：验证「mounts/unmounts layout effects in portal when visibility changes (starting visible)」描述的渲染、交互或错误处理结果。 */
  it('mounts/unmounts layout effects in portal when visibility changes (starting visible)', async () => {
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      useLayoutEffect(() => {
        Scheduler.log('Mount layout');
        return () => {
          Scheduler.log('Unmount layout');
        };
      }, []);
      return <Text text="Child" />;
    }

    const portalContainer = document.createElement('div');

    /** `Portal`：封装当前用例复用的操作、回调或断言步骤。 */
    function Portal({children}) {
      return <div>{ReactDOM.createPortal(children, portalContainer)}</div>;
    }

    const root = ReactDOMClient.createRoot(container);
    // 挂载可见树。
    await act(() => {
      root.render(
        <Activity mode="visible">
          <Portal>
            <Child />
          </Portal>
        </Activity>,
      );
    });
    assertLog(['Child', 'Mount layout']);
    expect(container.innerHTML).toBe('<div></div>');
    expect(portalContainer.innerHTML).toBe('<span prop="Child"></span>');

    // 隐藏树；布局 Effect 随之卸载。
    await act(() => {
      root.render(
        <Activity mode="hidden">
          <Portal>
            <Child />
          </Portal>
        </Activity>,
      );
    });
    assertLog(['Unmount layout', 'Child']);
    expect(container.innerHTML).toBe('<div style="display: none;"></div>');
    expect(portalContainer.innerHTML).toBe(
      '<span prop="Child" style="display: none;"></span>',
    );
  });

  /** 测试场景：验证「mounts/unmounts layout effects in portal when visibility changes (starting hidden)」描述的渲染、交互或错误处理结果。 */
  it('mounts/unmounts layout effects in portal when visibility changes (starting hidden)', async () => {
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      useLayoutEffect(() => {
        Scheduler.log('Mount layout');
        return () => {
          Scheduler.log('Unmount layout');
        };
      }, []);
      return <Text text="Child" />;
    }

    const portalContainer = document.createElement('div');

    /** `Portal`：封装当前用例复用的操作、回调或断言步骤。 */
    function Portal({children}) {
      return <div>{ReactDOM.createPortal(children, portalContainer)}</div>;
    }

    const root = ReactDOMClient.createRoot(container);
    // 挂载隐藏树。
    await act(() => {
      root.render(
        <Activity mode="hidden">
          <Portal>
            <Child />
          </Portal>
        </Activity>,
      );
    });
    // 此时没有挂载布局 Effect。
    assertLog(['Child']);
    expect(container.innerHTML).toBe('<div style="display: none;"></div>');
    expect(portalContainer.innerHTML).toBe(
      '<span prop="Child" style="display: none;"></span>',
    );

    // 显示树；布局 Effect 随之挂载。
    await act(() => {
      root.render(
        <Activity mode="visible">
          <Portal>
            <Child />
          </Portal>
        </Activity>,
      );
    });
    assertLog(['Child', 'Mount layout']);
    expect(container.innerHTML).toBe('<div style=""></div>');
    expect(portalContainer.innerHTML).toBe(
      '<span prop="Child" style=""></span>',
    );
  });

  // @gate enableLegacyHidden
  /** 测试场景：验证「does not toggle effects or hide nodes for LegacyHidden component inside portal」描述的渲染、交互或错误处理结果。 */
  it('does not toggle effects or hide nodes for LegacyHidden component inside portal', async () => {
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      useLayoutEffect(() => {
        Scheduler.log('Mount layout');
        return () => {
          Scheduler.log('Unmount layout');
        };
      }, []);
      useEffect(() => {
        Scheduler.log('Mount passive');
        return () => {
          Scheduler.log('Unmount passive');
        };
      }, []);
      return <Text text="Child" />;
    }

    const portalContainer = document.createElement('div');

    /** `Portal`：封装当前用例复用的操作、回调或断言步骤。 */
    function Portal({children}) {
      return <div>{ReactDOM.createPortal(children, portalContainer)}</div>;
    }

    const root = ReactDOMClient.createRoot(container);
    // 挂载可见树。
    await act(() => {
      root.render(
        <LegacyHidden mode="visible">
          <Portal>
            <Child />
          </Portal>
        </LegacyHidden>,
      );
    });
    assertLog(['Child', 'Mount layout', 'Mount passive']);
    expect(container.innerHTML).toBe('<div></div>');
    expect(portalContainer.innerHTML).toBe('<span prop="Child"></span>');

    // 隐藏树。
    await act(() => {
      root.render(
        <LegacyHidden mode="hidden">
          <Portal>
            <Child />
          </Portal>
        </LegacyHidden>,
      );
    });
    // 这些 effect 尚未卸载。
    assertLog(['Child']);
    expect(container.innerHTML).toBe('<div></div>');
    expect(portalContainer.innerHTML).toBe('<span prop="Child"></span>');

    // 显示树。
    await act(() => {
      root.render(
        <LegacyHidden mode="visible">
          <Portal>
            <Child />
          </Portal>
        </LegacyHidden>,
      );
    });
    // 这些 effect 已经挂载。
    assertLog(['Child']);
    expect(container.innerHTML).toBe('<div></div>');
    expect(portalContainer.innerHTML).toBe('<span prop="Child"></span>');
  });
});
