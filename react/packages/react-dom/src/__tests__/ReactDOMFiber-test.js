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
let PropTypes;
let ReactDOMClient;
let Scheduler;

let act;
let assertConsoleErrorDev;
let assertLog;
let root;
let JSDOM;

describe('ReactDOMFiber', () => {
  let container;

  beforeEach(() => {
    jest.resetModules();

    // 需要在独立使用时设置JSDOM与 TextEncoder和 TextDecoder
    // https://github.com/jsdom/jsdom/issues/2524
    (() => {
      const {TextEncoder, TextDecoder} = require('util');
      global.TextEncoder = TextEncoder;
      global.TextDecoder = TextDecoder;
      JSDOM = require('jsdom').JSDOM;
    })();

    React = require('react');
    ReactDOM = require('react-dom');
    PropTypes = require('prop-types');
    ReactDOMClient = require('react-dom/client');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    ({assertConsoleErrorDev, assertLog} = require('internal-test-utils'));

    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOMClient.createRoot(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    container = null;
    jest.restoreAllMocks();
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should render strings as children」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should render strings as children', async () => {
    /** `Box`：封装当前用例复用的操作、回调或断言步骤。 */
    const Box = ({value}) => <div>{value}</div>;
    await act(async () => {
      root.render(<Box value="foo" />);
    });
    expect(container.textContent).toEqual('foo');
  });

  /** 测试场景：验证「should render numbers as children」描述的渲染、交互或错误处理结果。 */
  it('should render numbers as children', async () => {
    /** `Box`：封装当前用例复用的操作、回调或断言步骤。 */
    const Box = ({value}) => <div>{value}</div>;

    await act(async () => {
      root.render(<Box value={10} />);
    });

    expect(container.textContent).toEqual('10');
  });

  /** 测试场景：验证「should render bigints as children」描述的渲染、交互或错误处理结果。 */
  it('should render bigints as children', async () => {
    /** `Box`：封装当前用例复用的操作、回调或断言步骤。 */
    const Box = ({value}) => <div>{value}</div>;

    await act(async () => {
      root.render(<Box value={10n} />);
    });

    expect(container.textContent).toEqual('10');
  });

  /** 测试场景：验证「should call an effect after mount/update (replacing render callback pattern)」描述的渲染、交互或错误处理结果。 */
  it('should call an effect after mount/update (replacing render callback pattern)', async () => {
    /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
    function Component() {
      React.useEffect(() => {
        Scheduler.log('Callback');
      });
      return <div>Foo</div>;
    }

    // 挂载阶段
    await act(async () => {
      root.render(<Component />);
    });
    assertLog(['Callback']);

    // 更新阶段
    await act(async () => {
      root.render(<Component />);
    });
    assertLog(['Callback']);
  });

  /** 测试场景：验证「should call an effect when the same element is re-rendered (replacing render callback pattern)」描述的渲染、交互或错误处理结果。 */
  it('should call an effect when the same element is re-rendered (replacing render callback pattern)', async () => {
    /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
    function Component({prop}) {
      React.useEffect(() => {
        Scheduler.log('Callback');
      });
      return <div>{prop}</div>;
    }

    // 挂载阶段
    await act(async () => {
      root.render(<Component prop="Foo" />);
    });
    assertLog(['Callback']);

    // 更新阶段
    await act(async () => {
      root.render(<Component prop="Bar" />);
    });
    assertLog(['Callback']);
  });

  /** 测试场景：验证「should render a component returning strings directly from render」描述的渲染、交互或错误处理结果。 */
  it('should render a component returning strings directly from render', async () => {
    /** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
    const Text = ({value}) => value;

    await act(async () => {
      root.render(<Text value="foo" />);
    });

    expect(container.textContent).toEqual('foo');
  });

  /** 测试场景：验证「should render a component returning numbers directly from render」描述的渲染、交互或错误处理结果。 */
  it('should render a component returning numbers directly from render', async () => {
    /** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
    const Text = ({value}) => value;
    await act(async () => {
      root.render(<Text value={10} />);
    });

    expect(container.textContent).toEqual('10');
  });

  /** 测试场景：验证「renders an empty fragment」描述的渲染、交互或错误处理结果。 */
  it('renders an empty fragment', async () => {
    /** `Div`：封装当前用例复用的操作、回调或断言步骤。 */
    const Div = () => <div />;
    /** `EmptyFragment`：封装当前用例复用的操作、回调或断言步骤。 */
    const EmptyFragment = () => <></>;
    /** `NonEmptyFragment`：封装当前用例复用的操作、回调或断言步骤。 */
    const NonEmptyFragment = () => (
      <>
        <Div />
      </>
    );

    await act(async () => {
      root.render(<EmptyFragment />);
    });
    expect(container.firstChild).toBe(null);

    await act(async () => {
      root.render(<NonEmptyFragment />);
    });
    expect(container.firstChild.tagName).toBe('DIV');

    await act(async () => {
      root.render(<EmptyFragment />);
    });
    expect(container.firstChild).toBe(null);

    await act(async () => {
      root.render(<Div />);
    });
    expect(container.firstChild.tagName).toBe('DIV');

    await act(async () => {
      root.render(<EmptyFragment />);
    });
    expect(container.firstChild).toBe(null);
  });

  let svgEls, htmlEls, mathEls;
  const expectSVG = {
    /** 收集 SVG 命名空间中的宿主实例。 */
    ref: el => svgEls.push(el)
  };
  const expectHTML = {
    /** 收集 HTML 命名空间中的宿主实例。 */
    ref: el => htmlEls.push(el)
  };
  const expectMath = {
    /** 收集 MathML 命名空间中的宿主实例。 */
    ref: el => mathEls.push(el)
  };

  /** `usePortal`：封装当前用例复用的操作、回调或断言步骤。 */
  const usePortal = function (tree) {
    return ReactDOM.createPortal(tree, document.createElement('div'));
  };

  /** `assertNamespacesMatch`：封装当前用例复用的操作、回调或断言步骤。 */
  const assertNamespacesMatch = async function (tree) {
    const testContainer = document.createElement('div');
    svgEls = [];
    htmlEls = [];
    mathEls = [];

    const testRoot = ReactDOMClient.createRoot(testContainer);
    await act(async () => {
      testRoot.render(tree);
    });
    svgEls.forEach(el => {
      expect(el.namespaceURI).toBe('http://www.w3.org/2000/svg');
    });
    htmlEls.forEach(el => {
      expect(el.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    });
    mathEls.forEach(el => {
      expect(el.namespaceURI).toBe('http://www.w3.org/1998/Math/MathML');
    });

    testRoot.unmount();
    expect(testContainer.innerHTML).toBe('');
  };

  /** 测试场景：验证「should render one portal」描述的渲染、交互或错误处理结果。 */
  it('should render one portal', async () => {
    const portalContainer = document.createElement('div');

    await act(() => {
      root.render(
        <div>{ReactDOM.createPortal(<div>portal</div>, portalContainer)}</div>,
      );
    });
    expect(portalContainer.innerHTML).toBe('<div>portal</div>');
    expect(container.innerHTML).toBe('<div></div>');

    root.unmount();
    expect(portalContainer.innerHTML).toBe('');
    expect(container.innerHTML).toBe('');
  });

  /** 测试场景：验证「should render many portals」描述的渲染、交互或错误处理结果。 */
  it('should render many portals', async () => {
    const portalContainer1 = document.createElement('div');
    const portalContainer2 = document.createElement('div');

    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        Scheduler.log(`${this.props.name} componentDidMount`);
      }
      /** `Child.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        Scheduler.log(`${this.props.name} componentDidUpdate`);
      }
      /** `Child.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        Scheduler.log(`${this.props.name} componentWillUnmount`);
      }
      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.props.name}</div>;
      }
    }

    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        Scheduler.log(`Parent:${this.props.step} componentDidMount`);
      }
      /** `Parent.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        Scheduler.log(`Parent:${this.props.step} componentDidUpdate`);
      }
      /** `Parent.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        Scheduler.log(`Parent:${this.props.step} componentWillUnmount`);
      }
      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        const {step} = this.props;
        return [
          <Child key="a" name={`normal[0]:${step}`} />,
          ReactDOM.createPortal(
            <Child key="b" name={`portal1[0]:${step}`} />,
            portalContainer1,
          ),
          <Child key="c" name={`normal[1]:${step}`} />,
          ReactDOM.createPortal(
            [
              <Child key="d" name={`portal2[0]:${step}`} />,
              <Child key="e" name={`portal2[1]:${step}`} />,
            ],
            portalContainer2,
          ),
        ];
      }
    }

    await act(() => {
      root.render(<Parent step="a" />);
    });
    expect(portalContainer1.innerHTML).toBe('<div>portal1[0]:a</div>');
    expect(portalContainer2.innerHTML).toBe(
      '<div>portal2[0]:a</div><div>portal2[1]:a</div>',
    );
    expect(container.innerHTML).toBe(
      '<div>normal[0]:a</div><div>normal[1]:a</div>',
    );
    assertLog([
      'normal[0]:a componentDidMount',
      'portal1[0]:a componentDidMount',
      'normal[1]:a componentDidMount',
      'portal2[0]:a componentDidMount',
      'portal2[1]:a componentDidMount',
      'Parent:a componentDidMount',
    ]);

    await act(() => {
      root.render(<Parent step="b" />);
    });
    expect(portalContainer1.innerHTML).toBe('<div>portal1[0]:b</div>');
    expect(portalContainer2.innerHTML).toBe(
      '<div>portal2[0]:b</div><div>portal2[1]:b</div>',
    );
    expect(container.innerHTML).toBe(
      '<div>normal[0]:b</div><div>normal[1]:b</div>',
    );
    assertLog([
      'normal[0]:b componentDidUpdate',
      'portal1[0]:b componentDidUpdate',
      'normal[1]:b componentDidUpdate',
      'portal2[0]:b componentDidUpdate',
      'portal2[1]:b componentDidUpdate',
      'Parent:b componentDidUpdate',
    ]);

    root.unmount();
    expect(portalContainer1.innerHTML).toBe('');
    expect(portalContainer2.innerHTML).toBe('');
    expect(container.innerHTML).toBe('');
    assertLog([
      'Parent:b componentWillUnmount',
      'normal[0]:b componentWillUnmount',
      'portal1[0]:b componentWillUnmount',
      'normal[1]:b componentWillUnmount',
      'portal2[0]:b componentWillUnmount',
      'portal2[1]:b componentWillUnmount',
    ]);
  });

  /** 测试场景：验证「should render nested portals」描述的渲染、交互或错误处理结果。 */
  it('should render nested portals', async () => {
    const portalContainer1 = document.createElement('div');
    const portalContainer2 = document.createElement('div');
    const portalContainer3 = document.createElement('div');

    await act(() => {
      root.render([
        <div key="a">normal[0]</div>,
        ReactDOM.createPortal(
          [
            <div key="b">portal1[0]</div>,
            ReactDOM.createPortal(
              <div key="c">portal2[0]</div>,
              portalContainer2,
            ),
            ReactDOM.createPortal(
              <div key="d">portal3[0]</div>,
              portalContainer3,
            ),
            <div key="e">portal1[1]</div>,
          ],
          portalContainer1,
        ),
        <div key="f">normal[1]</div>,
      ]);
    });
    expect(portalContainer1.innerHTML).toBe(
      '<div>portal1[0]</div><div>portal1[1]</div>',
    );
    expect(portalContainer2.innerHTML).toBe('<div>portal2[0]</div>');
    expect(portalContainer3.innerHTML).toBe('<div>portal3[0]</div>');
    expect(container.innerHTML).toBe(
      '<div>normal[0]</div><div>normal[1]</div>',
    );

    root.unmount();
    expect(portalContainer1.innerHTML).toBe('');
    expect(portalContainer2.innerHTML).toBe('');
    expect(portalContainer3.innerHTML).toBe('');
    expect(container.innerHTML).toBe('');
  });

  /** 测试场景：验证「should reconcile portal children」描述的渲染、交互或错误处理结果。 */
  it('should reconcile portal children', async () => {
    const portalContainer = document.createElement('div');

    await act(() => {
      root.render(
        <div>
          {ReactDOM.createPortal(<div>portal:1</div>, portalContainer)}
        </div>,
      );
    });
    expect(portalContainer.innerHTML).toBe('<div>portal:1</div>');
    expect(container.innerHTML).toBe('<div></div>');

    await act(() => {
      root.render(
        <div>
          {ReactDOM.createPortal(<div>portal:2</div>, portalContainer)}
        </div>,
      );
    });
    expect(portalContainer.innerHTML).toBe('<div>portal:2</div>');
    expect(container.innerHTML).toBe('<div></div>');

    await act(() => {
      root.render(
        <div>{ReactDOM.createPortal(<p>portal:3</p>, portalContainer)}</div>,
      );
    });
    expect(portalContainer.innerHTML).toBe('<p>portal:3</p>');
    expect(container.innerHTML).toBe('<div></div>');

    await act(() => {
      root.render(
        <div>{ReactDOM.createPortal(['Hi', 'Bye'], portalContainer)}</div>,
      );
    });
    expect(portalContainer.innerHTML).toBe('HiBye');
    expect(container.innerHTML).toBe('<div></div>');

    await act(() => {
      root.render(
        <div>{ReactDOM.createPortal(['Bye', 'Hi'], portalContainer)}</div>,
      );
    });
    expect(portalContainer.innerHTML).toBe('ByeHi');
    expect(container.innerHTML).toBe('<div></div>');

    await act(() => {
      root.render(<div>{ReactDOM.createPortal(null, portalContainer)}</div>);
    });
    expect(portalContainer.innerHTML).toBe('');
    expect(container.innerHTML).toBe('<div></div>');
  });

  /** 测试场景：验证「should unmount empty portal component wherever it appears」描述的渲染、交互或错误处理结果。 */
  it('should unmount empty portal component wherever it appears', async () => {
    const portalContainer = document.createElement('div');
    let instance;
    /** `Wrapper`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Wrapper extends React.Component {
      /** `Wrapper.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        instance = this;
        this.state = {
          show: true,
        };
      }
      /** `Wrapper.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            {this.state.show && (
              <>
                {ReactDOM.createPortal(null, portalContainer)}
                <div>child</div>
              </>
            )}
            <div>parent</div>
          </div>
        );
      }
    }

    await act(() => {
      root.render(<Wrapper />);
    });
    expect(container.innerHTML).toBe(
      '<div><div>child</div><div>parent</div></div>',
    );
    await act(() => {
      instance.setState({show: false});
    });
    expect(instance.state.show).toBe(false);
    expect(container.innerHTML).toBe('<div><div>parent</div></div>');
  });

  /** 测试场景：验证「should keep track of namespace across portals (simple)」描述的渲染、交互或错误处理结果。 */
  it('should keep track of namespace across portals (simple)', async () => {
    await assertNamespacesMatch(
      <svg {...expectSVG}>
        <image {...expectSVG} />
        {usePortal(<div {...expectHTML} />)}
        <image {...expectSVG} />
      </svg>,
    );
    await assertNamespacesMatch(
      <math {...expectMath}>
        <mi {...expectMath} />
        {usePortal(<div {...expectHTML} />)}
        <mi {...expectMath} />
      </math>,
    );
    await assertNamespacesMatch(
      <div {...expectHTML}>
        <p {...expectHTML} />
        {usePortal(
          <svg {...expectSVG}>
            <image {...expectSVG} />
          </svg>,
        )}
        <p {...expectHTML} />
      </div>,
    );
  });

  /** 测试场景：验证「should keep track of namespace across portals (medium)」描述的渲染、交互或错误处理结果。 */
  it('should keep track of namespace across portals (medium)', async () => {
    await assertNamespacesMatch(
      <svg {...expectSVG}>
        <image {...expectSVG} />
        {usePortal(<div {...expectHTML} />)}
        <image {...expectSVG} />
        {usePortal(<div {...expectHTML} />)}
        <image {...expectSVG} />
      </svg>,
    );
    await assertNamespacesMatch(
      <div {...expectHTML}>
        <math {...expectMath}>
          <mi {...expectMath} />
          {usePortal(
            <svg {...expectSVG}>
              <image {...expectSVG} />
            </svg>,
          )}
        </math>
        <p {...expectHTML} />
      </div>,
    );
    await assertNamespacesMatch(
      <math {...expectMath}>
        <mi {...expectMath} />
        {usePortal(
          <svg {...expectSVG}>
            <image {...expectSVG} />
            <foreignObject {...expectSVG}>
              <p {...expectHTML} />
              <math {...expectMath}>
                <mi {...expectMath} />
              </math>
              <p {...expectHTML} />
            </foreignObject>
            <image {...expectSVG} />
          </svg>,
        )}
        <mi {...expectMath} />
      </math>,
    );
    await assertNamespacesMatch(
      <div {...expectHTML}>
        {usePortal(
          <svg {...expectSVG}>
            {usePortal(<div {...expectHTML} />)}
            <image {...expectSVG} />
          </svg>,
        )}
        <p {...expectHTML} />
      </div>,
    );
    await assertNamespacesMatch(
      <svg {...expectSVG}>
        <svg {...expectSVG}>
          {usePortal(<div {...expectHTML} />)}
          <image {...expectSVG} />
        </svg>
        <image {...expectSVG} />
      </svg>,
    );
  });

  /** 测试场景：验证「should keep track of namespace across portals (complex)」描述的渲染、交互或错误处理结果。 */
  it('should keep track of namespace across portals (complex)', async () => {
    await assertNamespacesMatch(
      <div {...expectHTML}>
        {usePortal(
          <svg {...expectSVG}>
            <image {...expectSVG} />
          </svg>,
        )}
        <p {...expectHTML} />
        <svg {...expectSVG}>
          <image {...expectSVG} />
        </svg>
        <svg {...expectSVG}>
          <svg {...expectSVG}>
            <image {...expectSVG} />
          </svg>
          <image {...expectSVG} />
        </svg>
        <p {...expectHTML} />
      </div>,
    );
    await assertNamespacesMatch(
      <div {...expectHTML}>
        <svg {...expectSVG}>
          <svg {...expectSVG}>
            <image {...expectSVG} />
            {usePortal(
              <svg {...expectSVG}>
                <image {...expectSVG} />
                <svg {...expectSVG}>
                  <image {...expectSVG} />
                </svg>
                <image {...expectSVG} />
              </svg>,
            )}
            <image {...expectSVG} />
            <foreignObject {...expectSVG}>
              <p {...expectHTML} />
              {usePortal(<p {...expectHTML} />)}
              <p {...expectHTML} />
            </foreignObject>
          </svg>
          <image {...expectSVG} />
        </svg>
        <p {...expectHTML} />
      </div>,
    );
    await assertNamespacesMatch(
      <div {...expectHTML}>
        <svg {...expectSVG}>
          <foreignObject {...expectSVG}>
            <p {...expectHTML} />
            {usePortal(
              <svg {...expectSVG}>
                <image {...expectSVG} />
                <svg {...expectSVG}>
                  <image {...expectSVG} />
                  <foreignObject {...expectSVG}>
                    <p {...expectHTML} />
                  </foreignObject>
                  {usePortal(<p {...expectHTML} />)}
                </svg>
                <image {...expectSVG} />
              </svg>,
            )}
            <p {...expectHTML} />
          </foreignObject>
          <image {...expectSVG} />
        </svg>
        <p {...expectHTML} />
      </div>,
    );
  });

  /** 测试场景：验证「should unwind namespaces on uncaught errors」描述的渲染、交互或错误处理结果。 */
  it('should unwind namespaces on uncaught errors', async () => {
    /** `BrokenRender`：封装当前用例复用的操作、回调或断言步骤。 */
    function BrokenRender() {
      throw new Error('Hello');
    }

    await expect(async () => {
      await assertNamespacesMatch(
        <svg {...expectSVG}>
          <BrokenRender />
        </svg>,
      );
    }).rejects.toThrow('Hello');
    await assertNamespacesMatch(<div {...expectHTML} />);
  });

  /** 测试场景：验证「should unwind namespaces on caught errors」描述的渲染、交互或错误处理结果。 */
  it('should unwind namespaces on caught errors', async () => {
    /** `BrokenRender`：封装当前用例复用的操作、回调或断言步骤。 */
    function BrokenRender() {
      throw new Error('Hello');
    }

    /** `ErrorBoundary`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ErrorBoundary extends React.Component {
      /** `ErrorBoundary.state`：记录测试夹具在当前场景中的状态。 */
      state = {error: null};
      /** `ErrorBoundary.componentDidCatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** `ErrorBoundary.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error) {
          return <p {...expectHTML} />;
        }
        return this.props.children;
      }
    }

    await assertNamespacesMatch(
      <svg {...expectSVG}>
        <foreignObject {...expectSVG}>
          <ErrorBoundary>
            <math {...expectMath}>
              <BrokenRender />
            </math>
          </ErrorBoundary>
        </foreignObject>
        <image {...expectSVG} />
      </svg>,
    );
    await assertNamespacesMatch(<div {...expectHTML} />);
  });

  /** 测试场景：验证「should unwind namespaces on caught errors in a portal」描述的渲染、交互或错误处理结果。 */
  it('should unwind namespaces on caught errors in a portal', async () => {
    /** `BrokenRender`：封装当前用例复用的操作、回调或断言步骤。 */
    function BrokenRender() {
      throw new Error('Hello');
    }

    /** `ErrorBoundary`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ErrorBoundary extends React.Component {
      /** `ErrorBoundary.state`：记录测试夹具在当前场景中的状态。 */
      state = {error: null};
      /** `ErrorBoundary.componentDidCatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** `ErrorBoundary.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error) {
          return <image {...expectSVG} />;
        }
        return this.props.children;
      }
    }

    await assertNamespacesMatch(
      <svg {...expectSVG}>
        <ErrorBoundary>
          {usePortal(
            <div {...expectHTML}>
              <math {...expectMath}>
                <BrokenRender />)
              </math>
            </div>,
          )}
        </ErrorBoundary>
        {usePortal(<div {...expectHTML} />)}
      </svg>,
    );
  });

  // @gate !disableLegacyContext
  /** 测试场景：验证「should pass portal context when rendering subtree elsewhere」描述的渲染、交互或错误处理结果。 */
  it('should pass portal context when rendering subtree elsewhere', async () => {
    const portalContainer = document.createElement('div');

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.contextTypes`：记录测试夹具在当前场景中的状态。 */
      static contextTypes = {
        foo: PropTypes.string.isRequired,
      };

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.context.foo}</div>;
      }
    }

    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.childContextTypes`：记录测试夹具在当前场景中的状态。 */
      static childContextTypes = {
        foo: PropTypes.string.isRequired,
      };

      /** `Parent.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getChildContext() {
        return {
          foo: 'bar',
        };
      }

      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return ReactDOM.createPortal(<Component />, portalContainer);
      }
    }

    await act(async () => {
      root.render(<Parent />);
    });
    assertConsoleErrorDev([
      'Parent uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
      'Component uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
    ]);
    expect(container.innerHTML).toBe('');
    expect(portalContainer.innerHTML).toBe('<div>bar</div>');
  });

  /** 测试场景：验证「should bubble events from the portal to the parent」描述的渲染、交互或错误处理结果。 */
  it('should bubble events from the portal to the parent', async () => {
    const portalContainer = document.createElement('div');
    document.body.appendChild(portalContainer);
    try {
      let portal = null;

      await act(() => {
        root.render(
          <div onClick={() => Scheduler.log('parent clicked')}>
            {ReactDOM.createPortal(
              <div
                onClick={() => Scheduler.log('portal clicked')}
                ref={n => (portal = n)}>
                portal
              </div>,
              portalContainer,
            )}
          </div>,
        );
      });

      expect(portal.tagName).toBe('DIV');

      await act(() => {
        portal.click();
      });

      assertLog(['portal clicked', 'parent clicked']);
    } finally {
      document.body.removeChild(portalContainer);
    }
  });

  /** 测试场景：验证「should not onMouseLeave when staying in the portal」描述的渲染、交互或错误处理结果。 */
  it('should not onMouseLeave when staying in the portal', async () => {
    const portalContainer = document.createElement('div');
    document.body.appendChild(portalContainer);

    let firstTarget = null;
    let secondTarget = null;
    let thirdTarget = null;

    /** `simulateMouseMove`：封装当前用例复用的操作、回调或断言步骤。 */
    function simulateMouseMove(from, to) {
      if (from) {
        from.dispatchEvent(
          new MouseEvent('mouseout', {
            bubbles: true,
            cancelable: true,
            relatedTarget: to,
          }),
        );
      }
      if (to) {
        to.dispatchEvent(
          new MouseEvent('mouseover', {
            bubbles: true,
            cancelable: true,
            relatedTarget: from,
          }),
        );
      }
    }

    try {
      await act(() => {
        root.render(
          <div>
            <div
              onMouseEnter={() => Scheduler.log('enter parent')}
              onMouseLeave={() => Scheduler.log('leave parent')}>
              <div ref={n => (firstTarget = n)} />
              {ReactDOM.createPortal(
                <div
                  onMouseEnter={() => Scheduler.log('enter portal')}
                  onMouseLeave={() => Scheduler.log('leave portal')}
                  ref={n => (secondTarget = n)}>
                  portal
                </div>,
                portalContainer,
              )}
            </div>
            <div ref={n => (thirdTarget = n)} />
          </div>,
        );
      });
      await act(() => {
        simulateMouseMove(null, firstTarget);
      });
      assertLog(['enter parent']);

      await act(() => {
        simulateMouseMove(firstTarget, secondTarget);
      });
      assertLog([
        // 父组件不会触发 leave，因为指针仍位于 Portal 内部。
        'enter portal',
      ]);

      await act(() => {
        simulateMouseMove(secondTarget, thirdTarget);
      });
      assertLog([
        'leave portal',
        'leave parent', // 只有离开 Portal 时才会触发 onMouseLeave。
      ]);
    } finally {
      document.body.removeChild(portalContainer);
    }
  });

  // 针对 https://github.com/facebook/react/issues/19562 的回归测试。
  /** 测试场景：验证「does not fire mouseEnter twice when relatedTarget is the root node」描述的渲染、交互或错误处理结果。 */
  it('does not fire mouseEnter twice when relatedTarget is the root node', async () => {
    let target = null;

    /** `simulateMouseMove`：封装当前用例复用的操作、回调或断言步骤。 */
    function simulateMouseMove(from, to) {
      if (from) {
        from.dispatchEvent(
          new MouseEvent('mouseout', {
            bubbles: true,
            cancelable: true,
            relatedTarget: to,
          }),
        );
      }
      if (to) {
        to.dispatchEvent(
          new MouseEvent('mouseover', {
            bubbles: true,
            cancelable: true,
            relatedTarget: from,
          }),
        );
      }
    }

    await act(() => {
      root.render(
        <div
          ref={n => (target = n)}
          onMouseEnter={() => Scheduler.log('enter')}
          onMouseLeave={() => Scheduler.log('leave')}
        />,
      );
    });

    await act(() => {
      simulateMouseMove(null, container);
    });
    assertLog([]);

    await act(() => {
      simulateMouseMove(container, target);
    });
    assertLog(['enter']);

    await act(() => {
      simulateMouseMove(target, container);
    });
    assertLog(['leave']);

    await act(() => {
      simulateMouseMove(container, null);
    });
    assertLog([]);
  });

  /** 测试场景：验证「listens to events that do not exist in the Portal subtree」描述的渲染、交互或错误处理结果。 */
  it('listens to events that do not exist in the Portal subtree', async () => {
    const onClick = jest.fn();

    const ref = React.createRef();
    await act(() => {
      root.render(
        <div onClick={onClick}>
          {ReactDOM.createPortal(
            <button ref={ref}>click</button>,
            document.body,
          )}
        </div>,
      );
    });
    const event = new MouseEvent('click', {
      bubbles: true,
    });
    await act(() => {
      ref.current.dispatchEvent(event);
    });

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  /** 测试场景：验证「should throw on bad createPortal argument」描述的渲染、交互或错误处理结果。 */
  it('should throw on bad createPortal argument', () => {
    expect(() => {
      ReactDOM.createPortal(<div>portal</div>, null);
    }).toThrow('Target container is not a DOM element.');
    expect(() => {
      ReactDOM.createPortal(<div>portal</div>, document.createTextNode('hi'));
    }).toThrow('Target container is not a DOM element.');
  });

  /** 测试场景：验证「should warn for non-functional event listeners」描述的渲染、交互或错误处理结果。 */
  it('should warn for non-functional event listeners', () => {
    /** `Example`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Example extends React.Component {
      /** `Example.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div onClick="woops" />;
      }
    }
    ReactDOM.flushSync(() => {
      root.render(<Example />);
    });
    assertConsoleErrorDev([
      'Expected `onClick` listener to be a function, instead got a value of `string` type.\n' +
        '    in div (at **)\n' +
        '    in Example (at **)',
    ]);
  });

  /** 测试场景：验证「should warn with a special message for `false` event listeners」描述的渲染、交互或错误处理结果。 */
  it('should warn with a special message for `false` event listeners', () => {
    /** `Example`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Example extends React.Component {
      /** `Example.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div onClick={false} />;
      }
    }
    ReactDOM.flushSync(() => {
      root.render(<Example />);
    });
    assertConsoleErrorDev([
      'Expected `onClick` listener to be a function, instead got `false`.\n\n' +
        'If you used to conditionally omit it with onClick={condition && value}, ' +
        'pass onClick={condition ? value : undefined} instead.\n' +
        '    in div (at **)\n' +
        '    in Example (at **)',
    ]);
  });

  /** 测试场景：验证「should not update event handlers until commit」描述的渲染、交互或错误处理结果。 */
  it('should not update event handlers until commit', async () => {
    /** `handlerA`：封装当前用例复用的操作、回调或断言步骤。 */
    const handlerA = () => Scheduler.log('A');
    /** `handlerB`：封装当前用例复用的操作、回调或断言步骤。 */
    const handlerB = () => Scheduler.log('B');

    /** `click`：封装当前用例复用的操作、回调或断言步骤。 */
    function click() {
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, 'timeStamp', {
        value: 0,
      });
      node.dispatchEvent(event);
    }

    /** `Example`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Example extends React.Component {
      /** `Example.state`：记录测试夹具在当前场景中的状态。 */
      state = {flip: false, count: 0};
      /** `Example.flip`：实现测试夹具的生命周期、渲染或交互步骤。 */
      flip() {
        this.setState({flip: true, count: this.state.count + 1});
      }
      /** `Example.tick`：实现测试夹具的生命周期、渲染或交互步骤。 */
      tick() {
        this.setState({count: this.state.count + 1});
      }
      /** `Example.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        const useB = !this.props.forceA && this.state.flip;
        return <div onClick={useB ? handlerB : handlerA} />;
      }
    }

    /** `Click`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Click extends React.Component {
      /** `Click.constructor`：初始化测试夹具实例及其状态。 */
      constructor() {
        super();
        node.click();
      }
      /** `Click.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    let inst;
    await act(() => {
      root.render([<Example key="a" ref={n => (inst = n)} />]);
    });
    const node = container.firstChild;
    expect(node.tagName).toEqual('DIV');

    await act(() => {
      click();
    });

    assertLog(['A']);

    // 渲染其他事件处理器。
    await act(() => {
      inst.flip();
    });

    await act(() => {
      click();
    });

    assertLog(['B']);

    // 重新渲染，不改变任何 prop。
    await act(() => {
      inst.tick();
    });

    await act(() => {
      click();
    });

    assertLog(['B']);

    // 给A手机回来. 第二个组件在渲染期间调用点击处理器以模拟在中途渲染时的点击。 我使用这种方法，因
    // 为目前我们没有测试已 abort ReactDOM 渲染的方法。
    await act(() => {
      root.render([<Example key="a" forceA={true} />, <Click key="b" />]);
    });

    // 因为新的点击处理器尚未提交，所以需要重新挂载组件。 我们仍然应该调用 B。
    assertLog(['B']);

    // 提交后发生的任何点击,都应该调用A.
    await act(() => {
      click();
    });
    assertLog(['A']);
  });

  /** 测试场景：验证「should not crash encountering low-priority tree」描述的渲染、交互或错误处理结果。 */
  it('should not crash encountering low-priority tree', async () => {
    await act(() => {
      root.render(
        <div hidden={true}>
          <div />
        </div>,
      );
    });

    expect(container.innerHTML).toBe('<div hidden=""><div></div></div>');
  });

  /** 测试场景：验证「should not warn when rendering into an empty container」描述的渲染、交互或错误处理结果。 */
  it('should not warn when rendering into an empty container', async () => {
    await act(() => {
      root.render(<div>foo</div>);
    });
    expect(container.innerHTML).toBe('<div>foo</div>');
    await act(() => {
      root.render(null);
    });
    expect(container.innerHTML).toBe('');
    await act(() => {
      root.render(<div>bar</div>);
    });
    expect(container.innerHTML).toBe('<div>bar</div>');
  });

  /** 测试场景：验证「should warn when replacing a container which was manually updated outside of React」描述的渲染、交互或错误处理结果。 */
  it('should warn when replacing a container which was manually updated outside of React', async () => {
    // 当不在 DOM 外部进行操作时
    await act(() => {
      root.render(<div key="1">foo</div>);
    });
    expect(container.innerHTML).toBe('<div>foo</div>');

    await act(() => {
      root.render(<div key="1">bar</div>);
    });
    expect(container.innerHTML).toBe('<div>bar</div>');

    // 然后我们在更新之前搞了 DOM 我们知道这是错误 - - 这现在预计它是一个错误的类型'NotFoundError'
    // 没有消息
    container.innerHTML = '<div>MEOW.</div>';

    await expect(async () => {
      await act(() => {
        ReactDOM.flushSync(() => {
          root.render(<div key="2">baz</div>);
        });
      });
    }).rejects.toThrow('The node to be removed is not a child of this node');
  });

  /** 测试场景：验证「should not warn when doing an update to a container manually updated outside of React」描述的渲染、交互或错误处理结果。 */
  it('should not warn when doing an update to a container manually updated outside of React', async () => {
    // 当不在 DOM 外部进行操作时
    await act(() => {
      root.render(<div>foo</div>);
    });
    expect(container.innerHTML).toBe('<div>foo</div>');

    await act(() => {
      root.render(<div>bar</div>);
    });
    expect(container.innerHTML).toBe('<div>bar</div>');

    // 然后我们对 DOM 进行修改，在更新之前。
    container.innerHTML = '<div>MEOW.</div>';

    await act(() => {
      root.render(<div>baz</div>);
    });
    // TODO：为什么不行，也没有错误？
    expect(container.innerHTML).toBe('<div>MEOW.</div>');
  });

  /** 测试场景：验证「should not warn when doing an update to a container manually cleared outside of React」描述的渲染、交互或错误处理结果。 */
  it('should not warn when doing an update to a container manually cleared outside of React', async () => {
    // 当不在 DOM 外部进行操作时
    await act(() => {
      root.render(<div>foo</div>);
    });
    expect(container.innerHTML).toBe('<div>foo</div>');

    await act(() => {
      root.render(<div>bar</div>);
    });
    expect(container.innerHTML).toBe('<div>bar</div>');

    // 然后我们对 DOM 进行修改，在更新之前。
    container.innerHTML = '';

    await act(() => {
      root.render(<div>baz</div>);
    });
    // TODO：为什么不行，也没有错误？
    expect(container.innerHTML).toBe('');
  });

  /** 测试场景：验证「should render a text component with a text DOM node on the same document as the container」描述的渲染、交互或错误处理结果。 */
  it('should render a text component with a text DOM node on the same document as the container', async () => {
    // 1. 通过 iframe 创建新的 document。2. 设置 spy，在 iframe 容器内渲染文本组件时执行断言。
    const textContent = 'Hello world';
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const iframeDocument = iframe.contentDocument;
    iframeDocument.write(
      '<!DOCTYPE html><html><head></head><body><div></div></body></html>',
    );
    iframeDocument.close();
    const iframeContainer = iframeDocument.body.firstChild;

    let actualDocument;
    let textNode;

    spyOnDevAndProd(iframeContainer, 'appendChild').mockImplementation(node => {
      actualDocument = node.ownerDocument;
      textNode = node;
    });

    const iFrameRoot = ReactDOMClient.createRoot(iframeContainer);
    await act(() => {
      iFrameRoot.render(textContent);
    });

    expect(textNode.textContent).toBe(textContent);
    expect(actualDocument).not.toBe(document);
    expect(actualDocument).toBe(iframeDocument);
    expect(iframeContainer.appendChild).toHaveBeenCalledTimes(1);
  });

  /** 测试场景：验证「should mount into a document fragment」描述的渲染、交互或错误处理结果。 */
  it('should mount into a document fragment', async () => {
    const fragment = document.createDocumentFragment();
    const fragmentRoot = ReactDOMClient.createRoot(fragment);
    await act(() => {
      fragmentRoot.render(<div>foo</div>);
    });
    expect(container.innerHTML).toBe('');
    container.appendChild(fragment);
    expect(container.innerHTML).toBe('<div>foo</div>');
  });

  // 针对 https://github.com/facebook/react/issues/12643#issuecomment-413727104 的回归测试。
  /** 测试场景：验证「should not diff memoized host components」描述的渲染、交互或错误处理结果。 */
  it('should not diff memoized host components', async () => {
    const inputRef = React.createRef();
    let didCallOnChange = false;

    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.state`：记录测试夹具在当前场景中的状态。 */
      state = {};
      /** `Child.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        document.addEventListener('click', this.update, true);
      }
      /** `Child.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        document.removeEventListener('click', this.update, true);
      }
      /** `Child.update`：封装当前用例复用的操作、回调或断言步骤。 */
      update = () => {
        // 验证此 setState() 不会让 React 向外层 input 提交更新；否则会阻止父组件的 onChange 处理器触发。
        this.setState({});
        // 注意：同一组件的 document 手动捕获监听器若先调用 setState()，onChange 一直存在问题，
        // 但该场景很少见；这里验证子组件这样做时不会破坏父组件。
      };
      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.handleChange`：封装当前用例复用的操作、回调或断言步骤。 */
      handleChange = val => {
        didCallOnChange = true;
      };
      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            <Child />
            <input
              ref={inputRef}
              type="checkbox"
              checked={true}
              onChange={this.handleChange}
            />
          </div>
        );
      }
    }

    await act(() => {
      root.render(<Parent />);
    });
    await act(() => {
      inputRef.current.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
        }),
      );
    });
    expect(didCallOnChange).toBe(true);
  });

  /** 测试场景：验证「should restore selection in the correct window」描述的渲染、交互或错误处理结果。 */
  it('should restore selection in the correct window', async () => {
    // 创建新的 JSDOM 实例以获取第二个窗口 window.open 未实现
    const {window: newWindow} = new JSDOM('');
    // 创建一个新的容器，因为默认清理逻辑期望现有的容器位于文档中。
    const newContainer = newWindow.document.createElement('div');
    newWindow.document.body.appendChild(newContainer);
    root = ReactDOMClient.createRoot(newContainer);

    /** `Test`：封装当前用例复用的操作、回调或断言步骤。 */
    const Test = () => {
      const [reverse, setReverse] = React.useState(false);
      const [items] = React.useState(() => ['a', 'b', 'c']);
      /** `Test.onClick`：封装当前用例复用的操作、回调或断言步骤。 */
      const onClick = () => {
        setReverse(true);
      };

      // 将项目中的项目重新排序，以便在提交后，React 指令需要恢复焦点到正确的元素。
      const itemsToRender = reverse ? items.reverse() : items;

      return (
        <div>
          {itemsToRender.map(item => (
            <button onClick={onClick} key={item} id={item}>
              {item}
            </button>
          ))}
        </div>
      );
    };

    await act(() => {
      root.render(<Test />);
    });

    newWindow.document.getElementById('a').focus();
    await act(() => {
      newWindow.document.getElementById('a').click();
    });

    expect(newWindow.document.activeElement).not.toBe(newWindow.document.body);
    expect(newWindow.document.activeElement.innerHTML).toBe('a');
  });
});
