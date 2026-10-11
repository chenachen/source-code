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

  /** 记录text后输出span，其prop便于HTML断言定位；children透传而不是把text作为可见文字。 */
  function Text(props) {
    Scheduler.log(props.text);
    return <span prop={props.text}>{props.children}</span>;
  }

  /** Activity初visible，内部深层Portal输出div；setShow(false)后普通最近div与Portal直接div均display:none，验证隐藏沿Fiber树跨Portal容器。 */
  it(
    'hiding an Activity boundary also hides the direct children of any ' +
      'portals it contains, regardless of how deeply nested they are',
    async () => {
      const portalContainer = document.createElement('div');

      let setShow;

      /** 初show=true的Activity状态包装，把setter暴露给case，children包含深Portal。 */
      function Accordion({children}) {
        const [shouldShow, _setShow] = useState(true);
        setShow = _setShow;
        return (
          <Activity mode={shouldShow ? 'visible' : 'hidden'}>
            {children}
          </Activity>
        );
      }

      /** 普通div里创建Portal，验证隐藏不能在最近宿主处停而漏Portal子级。 */
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

  /** 外Activity一直hidden、Portal内Accordion初hidden；只显示内Accordion后两容器仍none，验证子边界不能越过隐藏祖先揭示。 */
  it(
    'revealing an Activity boundary inside a portal does not reveal the ' +
      'portal contents if has a hidden Activity parent',
    async () => {
      const portalContainer = document.createElement('div');

      let setShow;

      /** 初show=false的内Activity包装，外层另保持hidden。 */
      function Accordion({children}) {
        const [shouldShow, _setShow] = useState(false);
        setShow = _setShow;
        return (
          <Activity mode={shouldShow ? 'visible' : 'hidden'}>
            {children}
          </Activity>
        );
      }

      /** 外hidden Activity中Portal包Accordion，测试只显示内层不能揭示。 */
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

  /** 已隐藏树初只有Parent，再添加Portal/Child；新普通与Portal宿主都none，最后visible恢复空style，验证插入时继承隐藏与揭示。 */
  it('hides new portals added to an already hidden tree', async () => {

    /** 返回记录Child的Text，作为新插入隐藏Portal宿主。 */
    function Child() {
      return <Text text="Child" />;
    }

    const portalContainer = document.createElement('div');

    /** 普通div包装Portal，形成两容器的最近宿主边界。 */
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

  /** 隐藏Portal初A再加B，Child带layout effect；隐藏两轮仅渲染日志无layout挂载，visible后A/B layout同时挂且宿主恢复，验证新插入不提前连effect。 */
  it('hides new insertions inside an already hidden portal', async () => {

    /** 按text记录render并挂/清layout日志，隐藏时effect应断开，初隐藏插入不挂。 */
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

    /** 将children portal到独立容器，外层div仍留原根用于显示对比。 */
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

  /** 外Activity hidden预渲染已完成Child，内Suspense再挂起；主内容与Loading都隐藏。外改visible时只Loading可见，随后showInner=true才Child可见并挂layout，验证两层隐藏理由独立解除。 */
  it('reveal an inner Suspense boundary without revealing an outer Activity on the same host child', async () => {
    const promise = new Promise(() => {});

    /** showInner=false时加入永久Promise令Suspense挂起，另输出Text；一次layout effect记录揭示与断开。 */
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

    /** 把含内Suspense的children放Portal，外Activity隐藏跨该DOM边界。 */
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

  /** Portal内Child初Activity visible；首轮Child/Mount layout，改hidden记录Unmount layout再Child且两容器none，验证隐藏断layout但保留DOM。 */
  it('mounts/unmounts layout effects in portal when visibility changes (starting visible)', async () => {

    /** 带空依赖layout effect的Child，初visible先挂，hidden清理。 */
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

    /** Portal包装Child，两容器HTML分别检查隐藏。 */
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

  /** Portal内Child初Activity hidden；只有Child日志无layout，改visible才Child/Mount layout且解除none，验证初始隐藏不挂layout。 */
  it('mounts/unmounts layout effects in portal when visibility changes (starting hidden)', async () => {

    /** 带空依赖layout effect的Child，初hidden不得挂，visible再挂。 */
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

    /** Portal包装初始隐藏Child，对照Activity初态。 */
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

  /** LegacyHidden功能开启时，Portal Child初visible含layout/passive；hidden再visible两次仅Child日志、DOM始终无none、effect不卸载或重挂，验证遗留隐藏与Activity语义不同。 */
  it('does not toggle effects or hide nodes for LegacyHidden component inside portal', async () => {

    /** 同时layout/passive记录挂载清理的Child，用于LegacyHidden不切effect语义。 */
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

    /** Portal内承载两种effect的Child，旧hidden模式不改实际样式。 */
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
