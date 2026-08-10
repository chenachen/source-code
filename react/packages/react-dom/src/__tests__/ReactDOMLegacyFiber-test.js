/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** `React`：保存当前测试场景复用的夹具、状态或回调。 */
const React = require('react');
/** `ReactDOM`：保存当前测试场景复用的夹具、状态或回调。 */
const ReactDOM = require('react-dom');
/** `PropTypes`：保存当前测试场景复用的夹具、状态或回调。 */
const PropTypes = require('prop-types');
let act;
let assertConsoleErrorDev;
describe('ReactDOMLegacyFiber', () => {
  let container;

  beforeEach(() => {
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    container = null;
    jest.restoreAllMocks();
  });

  // @gate !disableLegacyMode
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should render strings as children」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should render strings as children', () => {
    /** `Box`：封装当前用例复用的操作、回调或断言步骤。 */
    const Box = ({value}) => <div>{value}</div>;

    ReactDOM.render(<Box value="foo" />, container);
    expect(container.textContent).toEqual('foo');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should render numbers as children」描述的渲染、交互或错误处理结果。 */
  it('should render numbers as children', () => {
    /** `Box`：封装当前用例复用的操作、回调或断言步骤。 */
    const Box = ({value}) => <div>{value}</div>;

    ReactDOM.render(<Box value={10} />, container);

    expect(container.textContent).toEqual('10');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should be called a callback argument」描述的渲染、交互或错误处理结果。 */
  it('should be called a callback argument', () => {
    // 挂载阶段
    let called = false;
    ReactDOM.render(<div>Foo</div>, container, () => (called = true));
    expect(called).toEqual(true);

    // 更新阶段
    called = false;
    ReactDOM.render(<div>Foo</div>, container, () => (called = true));
    expect(called).toEqual(true);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should call a callback argument when the same element is re-rendered」描述的渲染、交互或错误处理结果。 */
  it('should call a callback argument when the same element is re-rendered', () => {
    /** `Foo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Foo extends React.Component {
      /** `Foo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>Foo</div>;
      }
    }
    const element = <Foo />;

    // 挂载阶段
    let called = false;
    ReactDOM.render(element, container, () => (called = true));
    expect(called).toEqual(true);

    // 更新阶段
    called = false;
    ReactDOM.unstable_batchedUpdates(() => {
      ReactDOM.render(element, container, () => (called = true));
    });
    expect(called).toEqual(true);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should render a component returning strings directly from render」描述的渲染、交互或错误处理结果。 */
  it('should render a component returning strings directly from render', () => {
    /** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
    const Text = ({value}) => value;

    ReactDOM.render(<Text value="foo" />, container);
    expect(container.textContent).toEqual('foo');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should render a component returning numbers directly from render」描述的渲染、交互或错误处理结果。 */
  it('should render a component returning numbers directly from render', () => {
    /** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
    const Text = ({value}) => value;

    ReactDOM.render(<Text value={10} />, container);

    expect(container.textContent).toEqual('10');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「finds the DOM Text node of a string child」描述的渲染、交互或错误处理结果。 */
  it('finds the DOM Text node of a string child', () => {
    /** `Text`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Text extends React.Component {
      /** `Text.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return this.props.value;
      }
    }

    let instance = null;
    ReactDOM.render(
      <Text value="foo" ref={ref => (instance = ref)} />,
      container,
    );

    const textNode =
      ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.findDOMNode(
        instance,
      );
    expect(textNode).toBe(container.firstChild);
    expect(textNode.nodeType).toBe(3);
    expect(textNode.nodeValue).toBe('foo');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「finds the first child when a component returns a fragment」描述的渲染、交互或错误处理结果。 */
  it('finds the first child when a component returns a fragment', () => {
    /** `Fragment`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Fragment extends React.Component {
      /** `Fragment.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return [<div key="a" />, <span key="b" />];
      }
    }

    let instance = null;
    ReactDOM.render(<Fragment ref={ref => (instance = ref)} />, container);

    expect(container.childNodes.length).toBe(2);

    const firstNode =
      ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.findDOMNode(
        instance,
      );
    expect(firstNode).toBe(container.firstChild);
    expect(firstNode.tagName).toBe('DIV');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「finds the first child even when fragment is nested」描述的渲染、交互或错误处理结果。 */
  it('finds the first child even when fragment is nested', () => {
    /** `Wrapper`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Wrapper extends React.Component {
      /** `Wrapper.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return this.props.children;
      }
    }

    /** `Fragment`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Fragment extends React.Component {
      /** `Fragment.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return [
          <Wrapper key="a">
            <div />
          </Wrapper>,
          <span key="b" />,
        ];
      }
    }

    let instance = null;
    ReactDOM.render(<Fragment ref={ref => (instance = ref)} />, container);

    expect(container.childNodes.length).toBe(2);

    const firstNode =
      ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.findDOMNode(
        instance,
      );
    expect(firstNode).toBe(container.firstChild);
    expect(firstNode.tagName).toBe('DIV');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「finds the first child even when first child renders null」描述的渲染、交互或错误处理结果。 */
  it('finds the first child even when first child renders null', () => {
    /** `NullComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class NullComponent extends React.Component {
      /** `NullComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    /** `Fragment`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Fragment extends React.Component {
      /** `Fragment.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return [<NullComponent key="a" />, <div key="b" />, <span key="c" />];
      }
    }

    let instance = null;
    ReactDOM.render(<Fragment ref={ref => (instance = ref)} />, container);

    expect(container.childNodes.length).toBe(2);

    const firstNode =
      ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.findDOMNode(
        instance,
      );
    expect(firstNode).toBe(container.firstChild);
    expect(firstNode.tagName).toBe('DIV');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「renders an empty fragment」描述的渲染、交互或错误处理结果。 */
  it('renders an empty fragment', () => {
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

    ReactDOM.render(<EmptyFragment />, container);
    expect(container.firstChild).toBe(null);

    ReactDOM.render(<NonEmptyFragment />, container);
    expect(container.firstChild.tagName).toBe('DIV');

    ReactDOM.render(<EmptyFragment />, container);
    expect(container.firstChild).toBe(null);

    ReactDOM.render(<Div />, container);
    expect(container.firstChild.tagName).toBe('DIV');

    ReactDOM.render(<EmptyFragment />, container);
    expect(container.firstChild).toBe(null);
  });

  let svgEls, htmlEls, mathEls;
  const expectSVG = {
    /** 收集 legacy SVG 命名空间中的宿主实例。 */
    ref: el => svgEls.push(el)
  };
  const expectHTML = {
    /** 收集 legacy HTML 命名空间中的宿主实例。 */
    ref: el => htmlEls.push(el)
  };
  const expectMath = {
    /** 收集 legacy MathML 命名空间中的宿主实例。 */
    ref: el => mathEls.push(el)
  };

  /** `usePortal`：封装当前用例复用的操作、回调或断言步骤。 */
  const usePortal = function (tree) {
    return ReactDOM.createPortal(tree, document.createElement('div'));
  };

  /** `assertNamespacesMatch`：封装当前用例复用的操作、回调或断言步骤。 */
  const assertNamespacesMatch = function (tree) {
    const testContainer = document.createElement('div');
    svgEls = [];
    htmlEls = [];
    mathEls = [];

    ReactDOM.render(tree, testContainer);
    svgEls.forEach(el => {
      expect(el.namespaceURI).toBe('http://www.w3.org/2000/svg');
    });
    htmlEls.forEach(el => {
      expect(el.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    });
    mathEls.forEach(el => {
      expect(el.namespaceURI).toBe('http://www.w3.org/1998/Math/MathML');
    });

    ReactDOM.unmountComponentAtNode(testContainer);
    expect(testContainer.innerHTML).toBe('');
  };

  // @gate !disableLegacyMode
  /** 测试场景：验证「should render one portal」描述的渲染、交互或错误处理结果。 */
  it('should render one portal', () => {
    const portalContainer = document.createElement('div');

    ReactDOM.render(
      <div>{ReactDOM.createPortal(<div>portal</div>, portalContainer)}</div>,
      container,
    );
    expect(portalContainer.innerHTML).toBe('<div>portal</div>');
    expect(container.innerHTML).toBe('<div></div>');

    ReactDOM.unmountComponentAtNode(container);
    expect(portalContainer.innerHTML).toBe('');
    expect(container.innerHTML).toBe('');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should render many portals」描述的渲染、交互或错误处理结果。 */
  it('should render many portals', () => {
    const portalContainer1 = document.createElement('div');
    const portalContainer2 = document.createElement('div');

    const ops = [];
    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        ops.push(`${this.props.name} componentDidMount`);
      }
      /** `Child.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        ops.push(`${this.props.name} componentDidUpdate`);
      }
      /** `Child.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        ops.push(`${this.props.name} componentWillUnmount`);
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
        ops.push(`Parent:${this.props.step} componentDidMount`);
      }
      /** `Parent.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        ops.push(`Parent:${this.props.step} componentDidUpdate`);
      }
      /** `Parent.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        ops.push(`Parent:${this.props.step} componentWillUnmount`);
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

    ReactDOM.render(<Parent step="a" />, container);
    expect(portalContainer1.innerHTML).toBe('<div>portal1[0]:a</div>');
    expect(portalContainer2.innerHTML).toBe(
      '<div>portal2[0]:a</div><div>portal2[1]:a</div>',
    );
    expect(container.innerHTML).toBe(
      '<div>normal[0]:a</div><div>normal[1]:a</div>',
    );
    expect(ops).toEqual([
      'normal[0]:a componentDidMount',
      'portal1[0]:a componentDidMount',
      'normal[1]:a componentDidMount',
      'portal2[0]:a componentDidMount',
      'portal2[1]:a componentDidMount',
      'Parent:a componentDidMount',
    ]);

    ops.length = 0;
    ReactDOM.render(<Parent step="b" />, container);
    expect(portalContainer1.innerHTML).toBe('<div>portal1[0]:b</div>');
    expect(portalContainer2.innerHTML).toBe(
      '<div>portal2[0]:b</div><div>portal2[1]:b</div>',
    );
    expect(container.innerHTML).toBe(
      '<div>normal[0]:b</div><div>normal[1]:b</div>',
    );
    expect(ops).toEqual([
      'normal[0]:b componentDidUpdate',
      'portal1[0]:b componentDidUpdate',
      'normal[1]:b componentDidUpdate',
      'portal2[0]:b componentDidUpdate',
      'portal2[1]:b componentDidUpdate',
      'Parent:b componentDidUpdate',
    ]);

    ops.length = 0;
    ReactDOM.unmountComponentAtNode(container);
    expect(portalContainer1.innerHTML).toBe('');
    expect(portalContainer2.innerHTML).toBe('');
    expect(container.innerHTML).toBe('');
    expect(ops).toEqual([
      'Parent:b componentWillUnmount',
      'normal[0]:b componentWillUnmount',
      'portal1[0]:b componentWillUnmount',
      'normal[1]:b componentWillUnmount',
      'portal2[0]:b componentWillUnmount',
      'portal2[1]:b componentWillUnmount',
    ]);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should render nested portals」描述的渲染、交互或错误处理结果。 */
  it('should render nested portals', () => {
    const portalContainer1 = document.createElement('div');
    const portalContainer2 = document.createElement('div');
    const portalContainer3 = document.createElement('div');

    ReactDOM.render(
      [
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
      ],
      container,
    );
    expect(portalContainer1.innerHTML).toBe(
      '<div>portal1[0]</div><div>portal1[1]</div>',
    );
    expect(portalContainer2.innerHTML).toBe('<div>portal2[0]</div>');
    expect(portalContainer3.innerHTML).toBe('<div>portal3[0]</div>');
    expect(container.innerHTML).toBe(
      '<div>normal[0]</div><div>normal[1]</div>',
    );

    ReactDOM.unmountComponentAtNode(container);
    expect(portalContainer1.innerHTML).toBe('');
    expect(portalContainer2.innerHTML).toBe('');
    expect(portalContainer3.innerHTML).toBe('');
    expect(container.innerHTML).toBe('');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should reconcile portal children」描述的渲染、交互或错误处理结果。 */
  it('should reconcile portal children', () => {
    const portalContainer = document.createElement('div');

    ReactDOM.render(
      <div>{ReactDOM.createPortal(<div>portal:1</div>, portalContainer)}</div>,
      container,
    );
    expect(portalContainer.innerHTML).toBe('<div>portal:1</div>');
    expect(container.innerHTML).toBe('<div></div>');

    ReactDOM.render(
      <div>{ReactDOM.createPortal(<div>portal:2</div>, portalContainer)}</div>,
      container,
    );
    expect(portalContainer.innerHTML).toBe('<div>portal:2</div>');
    expect(container.innerHTML).toBe('<div></div>');

    ReactDOM.render(
      <div>{ReactDOM.createPortal(<p>portal:3</p>, portalContainer)}</div>,
      container,
    );
    expect(portalContainer.innerHTML).toBe('<p>portal:3</p>');
    expect(container.innerHTML).toBe('<div></div>');

    ReactDOM.render(
      <div>{ReactDOM.createPortal(['Hi', 'Bye'], portalContainer)}</div>,
      container,
    );
    expect(portalContainer.innerHTML).toBe('HiBye');
    expect(container.innerHTML).toBe('<div></div>');

    ReactDOM.render(
      <div>{ReactDOM.createPortal(['Bye', 'Hi'], portalContainer)}</div>,
      container,
    );
    expect(portalContainer.innerHTML).toBe('ByeHi');
    expect(container.innerHTML).toBe('<div></div>');

    ReactDOM.render(
      <div>{ReactDOM.createPortal(null, portalContainer)}</div>,
      container,
    );
    expect(portalContainer.innerHTML).toBe('');
    expect(container.innerHTML).toBe('<div></div>');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should unmount empty portal component wherever it appears」描述的渲染、交互或错误处理结果。 */
  it('should unmount empty portal component wherever it appears', () => {
    const portalContainer = document.createElement('div');

    /** `Wrapper`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Wrapper extends React.Component {
      /** `Wrapper.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
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

    const instance = ReactDOM.render(<Wrapper />, container);
    expect(container.innerHTML).toBe(
      '<div><div>child</div><div>parent</div></div>',
    );
    instance.setState({show: false});
    expect(instance.state.show).toBe(false);
    expect(container.innerHTML).toBe('<div><div>parent</div></div>');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should keep track of namespace across portals (simple)」描述的渲染、交互或错误处理结果。 */
  it('should keep track of namespace across portals (simple)', () => {
    assertNamespacesMatch(
      <svg {...expectSVG}>
        <image {...expectSVG} />
        {usePortal(<div {...expectHTML} />)}
        <image {...expectSVG} />
      </svg>,
    );
    assertNamespacesMatch(
      <math {...expectMath}>
        <mi {...expectMath} />
        {usePortal(<div {...expectHTML} />)}
        <mi {...expectMath} />
      </math>,
    );
    assertNamespacesMatch(
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「should keep track of namespace across portals (medium)」描述的渲染、交互或错误处理结果。 */
  it('should keep track of namespace across portals (medium)', () => {
    assertNamespacesMatch(
      <svg {...expectSVG}>
        <image {...expectSVG} />
        {usePortal(<div {...expectHTML} />)}
        <image {...expectSVG} />
        {usePortal(<div {...expectHTML} />)}
        <image {...expectSVG} />
      </svg>,
    );
    assertNamespacesMatch(
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
    assertNamespacesMatch(
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
    assertNamespacesMatch(
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
    assertNamespacesMatch(
      <svg {...expectSVG}>
        <svg {...expectSVG}>
          {usePortal(<div {...expectHTML} />)}
          <image {...expectSVG} />
        </svg>
        <image {...expectSVG} />
      </svg>,
    );
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should keep track of namespace across portals (complex)」描述的渲染、交互或错误处理结果。 */
  it('should keep track of namespace across portals (complex)', () => {
    assertNamespacesMatch(
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
    assertNamespacesMatch(
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
    assertNamespacesMatch(
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「should unwind namespaces on uncaught errors」描述的渲染、交互或错误处理结果。 */
  it('should unwind namespaces on uncaught errors', async () => {
    /** `BrokenRender`：封装当前用例复用的操作、回调或断言步骤。 */
    function BrokenRender() {
      throw new Error('Hello');
    }

    await expect(async () => {
      await act(() => {
        assertNamespacesMatch(
          <svg {...expectSVG}>
            <BrokenRender />
          </svg>,
        );
      });
    }).rejects.toThrow('Hello');
    assertNamespacesMatch(<div {...expectHTML} />);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should unwind namespaces on caught errors」描述的渲染、交互或错误处理结果。 */
  it('should unwind namespaces on caught errors', () => {
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

    assertNamespacesMatch(
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
    assertNamespacesMatch(<div {...expectHTML} />);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should unwind namespaces on caught errors in a portal」描述的渲染、交互或错误处理结果。 */
  it('should unwind namespaces on caught errors in a portal', () => {
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

    assertNamespacesMatch(
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
  // @gate !disableLegacyMode
  /** 测试场景：验证「should pass portal context when rendering subtree elsewhere」描述的渲染、交互或错误处理结果。 */
  it('should pass portal context when rendering subtree elsewhere', () => {
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

    ReactDOM.render(<Parent />, container);
    assertConsoleErrorDev([
      'Parent uses the legacy childContextTypes API which will soon be removed. Use React.createContext() instead.',
      'Component uses the legacy contextTypes API which will soon be removed. Use React.createContext() with static contextType instead.',
    ]);
    expect(container.innerHTML).toBe('');
    expect(portalContainer.innerHTML).toBe('<div>bar</div>');
  });

  // @gate !disableLegacyContext
  // @gate !disableLegacyMode
  /** 测试场景：验证「should update portal context if it changes due to setState」描述的渲染、交互或错误处理结果。 */
  it('should update portal context if it changes due to setState', () => {
    const portalContainer = document.createElement('div');

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.contextTypes`：记录测试夹具在当前场景中的状态。 */
      static contextTypes = {
        foo: PropTypes.string.isRequired,
        getFoo: PropTypes.func.isRequired,
      };

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.context.foo + '-' + this.context.getFoo()}</div>;
      }
    }

    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.childContextTypes`：记录测试夹具在当前场景中的状态。 */
      static childContextTypes = {
        foo: PropTypes.string.isRequired,
        getFoo: PropTypes.func.isRequired,
      };

      /** `Parent.state`：记录测试夹具在当前场景中的状态。 */
      state = {
        bar: 'initial',
      };

      /** `Parent.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getChildContext() {
        return {
          foo: this.state.bar,
          /** `getChildContext.getFoo`：封装当前用例复用的操作、回调或断言步骤。 */
          getFoo: () => this.state.bar,
        };
      }

      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return ReactDOM.createPortal(<Component />, portalContainer);
      }
    }

    const instance = ReactDOM.render(<Parent />, container);
    assertConsoleErrorDev([
      'Parent uses the legacy childContextTypes API which will soon be removed. Use React.createContext() instead.',
      'Component uses the legacy contextTypes API which will soon be removed. Use React.createContext() with static contextType instead.',
    ]);
    expect(portalContainer.innerHTML).toBe('<div>initial-initial</div>');
    expect(container.innerHTML).toBe('');
    instance.setState({bar: 'changed'});
    expect(portalContainer.innerHTML).toBe('<div>changed-changed</div>');
    expect(container.innerHTML).toBe('');
  });

  // @gate !disableLegacyContext
  // @gate !disableLegacyMode
  /** 测试场景：验证「should update portal context if it changes due to re-render」描述的渲染、交互或错误处理结果。 */
  it('should update portal context if it changes due to re-render', () => {
    const portalContainer = document.createElement('div');

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.contextTypes`：记录测试夹具在当前场景中的状态。 */
      static contextTypes = {
        foo: PropTypes.string.isRequired,
        getFoo: PropTypes.func.isRequired,
      };

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.context.foo + '-' + this.context.getFoo()}</div>;
      }
    }

    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.childContextTypes`：记录测试夹具在当前场景中的状态。 */
      static childContextTypes = {
        foo: PropTypes.string.isRequired,
        getFoo: PropTypes.func.isRequired,
      };

      /** `Parent.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getChildContext() {
        return {
          foo: this.props.bar,
          /** `getChildContext.getFoo`：封装当前用例复用的操作、回调或断言步骤。 */
          getFoo: () => this.props.bar,
        };
      }

      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return ReactDOM.createPortal(<Component />, portalContainer);
      }
    }

    ReactDOM.render(<Parent bar="initial" />, container);
    assertConsoleErrorDev([
      'Parent uses the legacy childContextTypes API which will soon be removed. Use React.createContext() instead.',
      'Component uses the legacy contextTypes API which will soon be removed. Use React.createContext() with static contextType instead.',
    ]);
    expect(portalContainer.innerHTML).toBe('<div>initial-initial</div>');
    expect(container.innerHTML).toBe('');
    ReactDOM.render(<Parent bar="changed" />, container);
    expect(portalContainer.innerHTML).toBe('<div>changed-changed</div>');
    expect(container.innerHTML).toBe('');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「findDOMNode should find dom element after expanding a fragment」描述的渲染、交互或错误处理结果。 */
  it('findDOMNode should find dom element after expanding a fragment', () => {
    /** `MyNode`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class MyNode extends React.Component {
      /** `MyNode.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return !this.props.flag
          ? [<div key="a" />]
          : [<span key="b" />, <div key="a" />];
      }
    }

    const myNodeA = ReactDOM.render(<MyNode />, container);
    const a =
      ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.findDOMNode(
        myNodeA,
      );
    expect(a.tagName).toBe('DIV');

    const myNodeB = ReactDOM.render(<MyNode flag={true} />, container);
    expect(myNodeA === myNodeB).toBe(true);

    const b =
      ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.findDOMNode(
        myNodeB,
      );
    expect(b.tagName).toBe('SPAN');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should bubble events from the portal to the parent」描述的渲染、交互或错误处理结果。 */
  it('should bubble events from the portal to the parent', () => {
    const portalContainer = document.createElement('div');
    document.body.appendChild(portalContainer);
    try {
      const ops = [];
      let portal = null;

      ReactDOM.render(
        <div onClick={() => ops.push('parent clicked')}>
          {ReactDOM.createPortal(
            <div
              onClick={() => ops.push('portal clicked')}
              ref={n => (portal = n)}>
              portal
            </div>,
            portalContainer,
          )}
        </div>,
        container,
      );

      expect(portal.tagName).toBe('DIV');

      portal.click();

      expect(ops).toEqual(['portal clicked', 'parent clicked']);
    } finally {
      document.body.removeChild(portalContainer);
    }
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should not onMouseLeave when staying in the portal」描述的渲染、交互或错误处理结果。 */
  it('should not onMouseLeave when staying in the portal', () => {
    const portalContainer = document.createElement('div');
    document.body.appendChild(portalContainer);

    let ops = [];
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
      ReactDOM.render(
        <div>
          <div
            onMouseEnter={() => ops.push('enter parent')}
            onMouseLeave={() => ops.push('leave parent')}>
            <div ref={n => (firstTarget = n)} />
            {ReactDOM.createPortal(
              <div
                onMouseEnter={() => ops.push('enter portal')}
                onMouseLeave={() => ops.push('leave portal')}
                ref={n => (secondTarget = n)}>
                portal
              </div>,
              portalContainer,
            )}
          </div>
          <div ref={n => (thirdTarget = n)} />
        </div>,
        container,
      );

      simulateMouseMove(null, firstTarget);
      expect(ops).toEqual(['enter parent']);

      ops = [];

      simulateMouseMove(firstTarget, secondTarget);
      expect(ops).toEqual([
        // 父组件不会触发 leave，因为指针仍位于 Portal 内部。
        'enter portal',
      ]);

      ops = [];

      simulateMouseMove(secondTarget, thirdTarget);
      expect(ops).toEqual([
        'leave portal',
        'leave parent', // 只有离开 Portal 时才会触发 onMouseLeave。
      ]);
    } finally {
      document.body.removeChild(portalContainer);
    }
  });

  // 针对 https://github.com/facebook/react/issues/19562 的回归测试。
  // @gate !disableLegacyMode
  /** 测试场景：验证「does not fire mouseEnter twice when relatedTarget is the root node」描述的渲染、交互或错误处理结果。 */
  it('does not fire mouseEnter twice when relatedTarget is the root node', () => {
    let ops = [];
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

    ReactDOM.render(
      <div
        ref={n => (target = n)}
        onMouseEnter={() => ops.push('enter')}
        onMouseLeave={() => ops.push('leave')}
      />,
      container,
    );

    simulateMouseMove(null, container);
    expect(ops).toEqual([]);

    ops = [];
    simulateMouseMove(container, target);
    expect(ops).toEqual(['enter']);

    ops = [];
    simulateMouseMove(target, container);
    expect(ops).toEqual(['leave']);

    ops = [];
    simulateMouseMove(container, null);
    expect(ops).toEqual([]);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「listens to events that do not exist in the Portal subtree」描述的渲染、交互或错误处理结果。 */
  it('listens to events that do not exist in the Portal subtree', () => {
    const onClick = jest.fn();

    const ref = React.createRef();
    ReactDOM.render(
      <div onClick={onClick}>
        {ReactDOM.createPortal(<button ref={ref}>click</button>, document.body)}
      </div>,
      container,
    );
    const event = new MouseEvent('click', {
      bubbles: true,
    });
    ref.current.dispatchEvent(event);

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

  // @gate !disableLegacyMode
  /** 测试场景：验证「should warn for non-functional event listeners」描述的渲染、交互或错误处理结果。 */
  it('should warn for non-functional event listeners', () => {
    /** `Example`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Example extends React.Component {
      /** `Example.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div onClick="woops" />;
      }
    }
    ReactDOM.render(<Example />, container);
    assertConsoleErrorDev([
      'Expected `onClick` listener to be a function, instead got a value of `string` type.\n' +
        '    in div (at **)\n' +
        '    in Example (at **)',
    ]);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should warn with a special message for `false` event listeners」描述的渲染、交互或错误处理结果。 */
  it('should warn with a special message for `false` event listeners', () => {
    /** `Example`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Example extends React.Component {
      /** `Example.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div onClick={false} />;
      }
    }
    ReactDOM.render(<Example />, container);
    assertConsoleErrorDev([
      'Expected `onClick` listener to be a function, instead got `false`.\n\n' +
        'If you used to conditionally omit it with onClick={condition && value}, ' +
        'pass onClick={condition ? value : undefined} instead.\n' +
        '    in div (at **)\n' +
        '    in Example (at **)',
    ]);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should not update event handlers until commit」描述的渲染、交互或错误处理结果。 */
  it('should not update event handlers until commit', () => {
    spyOnDev(console, 'error');

    let ops = [];
    /** `handlerA`：封装当前用例复用的操作、回调或断言步骤。 */
    const handlerA = () => ops.push('A');
    /** `handlerB`：封装当前用例复用的操作、回调或断言步骤。 */
    const handlerB = () => ops.push('B');

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
    ReactDOM.render([<Example key="a" ref={n => (inst = n)} />], container);
    const node = container.firstChild;
    expect(node.tagName).toEqual('DIV');

    click();

    expect(ops).toEqual(['A']);
    ops = [];

    // 渲染其他事件处理器。
    inst.flip();

    click();

    expect(ops).toEqual(['B']);
    ops = [];

    // 重新渲染，不改变任何 prop。
    inst.tick();

    click();

    expect(ops).toEqual(['B']);
    ops = [];

    // 给A手机回来. 第二个组件在渲染期间调用点击处理器以模拟在中途渲染时的点击。 我使用这种方法，因
    // 为目前我们没有测试已 abort ReactDOM 渲染的方法。
    ReactDOM.render(
      [<Example key="a" forceA={true} />, <Click key="b" />],
      container,
    );

    // 因为新的点击处理器尚未提交，所以需要重新挂载组件。 我们仍然应该调用 B。
    expect(ops).toEqual(['B']);
    ops = [];

    // 提交后发生的任何点击,都应该调用A.
    click();
    expect(ops).toEqual(['A']);

    if (__DEV__) {
      expect(console.error).toHaveBeenCalledTimes(2);
      expect(console.error.mock.calls[0][0]).toMatch(
        'ReactDOM.render has not been supported since React 18',
      );
      expect(console.error.mock.calls[1][0]).toMatch(
        'ReactDOM.render has not been supported since React 18',
      );
    }
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should not crash encountering low-priority tree」描述的渲染、交互或错误处理结果。 */
  it('should not crash encountering low-priority tree', () => {
    ReactDOM.render(
      <div hidden={true}>
        <div />
      </div>,
      container,
    );
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should not warn when rendering into an empty container」描述的渲染、交互或错误处理结果。 */
  it('should not warn when rendering into an empty container', () => {
    ReactDOM.render(<div>foo</div>, container);
    expect(container.innerHTML).toBe('<div>foo</div>');
    ReactDOM.render(null, container);
    expect(container.innerHTML).toBe('');
    ReactDOM.render(<div>bar</div>, container);
    expect(container.innerHTML).toBe('<div>bar</div>');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should warn when replacing a container which was manually updated outside of React」描述的渲染、交互或错误处理结果。 */
  it('should warn when replacing a container which was manually updated outside of React', async () => {
    // 当不在 DOM 外部进行操作时
    ReactDOM.render(<div key="1">foo</div>, container);
    ReactDOM.render(<div key="1">bar</div>, container);
    expect(container.innerHTML).toBe('<div>bar</div>');
    // 然后我们在更新之前搞了 DOM 我们知道这是错误 - - 这现在预计它是一个错误的类型'NotFoundError'
    // 没有消息
    container.innerHTML = '<div>MEOW.</div>';

    await expect(async () => {
      await act(() => {
        ReactDOM.render(<div key="2">baz</div>, container);
      });
    }).rejects.toThrow('The node to be removed is not a child of this node.');
    assertConsoleErrorDev([
      '' +
        'It looks like the React-rendered content of this container was ' +
        'removed without using React. This is not supported and will ' +
        'cause errors. Instead, call ReactDOM.unmountComponentAtNode ' +
        'to empty a container.',
    ]);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should warn when doing an update to a container manually updated outside of React」描述的渲染、交互或错误处理结果。 */
  it('should warn when doing an update to a container manually updated outside of React', () => {
    // 当不在 DOM 外部进行操作时
    ReactDOM.render(<div>foo</div>, container);
    ReactDOM.render(<div>bar</div>, container);
    expect(container.innerHTML).toBe('<div>bar</div>');
    // 然后我们对 DOM 进行修改，在更新之前。
    container.innerHTML = '<div>MEOW.</div>';
    ReactDOM.render(<div>baz</div>, container);
    assertConsoleErrorDev([
      '' +
        'It looks like the React-rendered content of this container was ' +
        'removed without using React. This is not supported and will ' +
        'cause errors. Instead, call ReactDOM.unmountComponentAtNode ' +
        'to empty a container.',
    ]);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should warn when doing an update to a container manually cleared outside of React」描述的渲染、交互或错误处理结果。 */
  it('should warn when doing an update to a container manually cleared outside of React', () => {
    // 当不在 DOM 外部进行操作时
    ReactDOM.render(<div>foo</div>, container);
    ReactDOM.render(<div>bar</div>, container);
    expect(container.innerHTML).toBe('<div>bar</div>');
    // 然后我们对 DOM 进行修改，在更新之前。
    container.innerHTML = '';
    ReactDOM.render(<div>baz</div>, container);
    assertConsoleErrorDev([
      '' +
        'It looks like the React-rendered content of this container was ' +
        'removed without using React. This is not supported and will ' +
        'cause errors. Instead, call ReactDOM.unmountComponentAtNode ' +
        'to empty a container.',
    ]);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should render a text component with a text DOM node on the same document as the container」描述的渲染、交互或错误处理结果。 */
  it('should render a text component with a text DOM node on the same document as the container', () => {
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

    ReactDOM.render(textContent, iframeContainer);

    expect(textNode.textContent).toBe(textContent);
    expect(actualDocument).not.toBe(document);
    expect(actualDocument).toBe(iframeDocument);
    expect(iframeContainer.appendChild).toHaveBeenCalledTimes(1);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should mount into a document fragment」描述的渲染、交互或错误处理结果。 */
  it('should mount into a document fragment', () => {
    const fragment = document.createDocumentFragment();
    ReactDOM.render(<div>foo</div>, fragment);
    expect(container.innerHTML).toBe('');
    container.appendChild(fragment);
    expect(container.innerHTML).toBe('<div>foo</div>');
  });

  // 针对 https://github.com/facebook/react/issues/12643#issuecomment-413727104 的回归测试。
  // @gate !disableLegacyMode
  /** 测试场景：验证「should not diff memoized host components」描述的渲染、交互或错误处理结果。 */
  it('should not diff memoized host components', () => {
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

    ReactDOM.render(<Parent />, container);
    inputRef.current.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
      }),
    );
    expect(didCallOnChange).toBe(true);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「unmounted legacy roots should never clear newer root content from a container」描述的渲染、交互或错误处理结果。 */
  it('unmounted legacy roots should never clear newer root content from a container', () => {
    const ref = React.createRef();

    /** `OldApp`：封装当前用例复用的操作、回调或断言步骤。 */
    function OldApp() {
      /** `OldApp.hideOnFocus`：封装当前用例复用的操作、回调或断言步骤。 */
      const hideOnFocus = () => {
        // 这款应用程序将自己卸载到一个焦点事件中.
        ReactDOM.unmountComponentAtNode(container);
      };

      return (
        <button onFocus={hideOnFocus} ref={ref}>
          old
        </button>
      );
    }

    /** `NewApp`：封装当前用例复用的操作、回调或断言步骤。 */
    function NewApp() {
      return <button ref={ref}>new</button>;
    }

    ReactDOM.render(<OldApp />, container);
    ref.current.focus();

    ReactDOM.render(<NewApp />, container);

    // 再次调用 focus 会冲刷之前为旧根计划的离散工作，但这不应该清除刚刚挂载的新应用。
    ref.current.focus();

    expect(container.textContent).toBe('new');
  });
});
