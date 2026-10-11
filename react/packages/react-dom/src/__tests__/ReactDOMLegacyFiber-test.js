/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/**
 * 测试使用的 React 元素与组件定义入口；所有旧根能力是否执行由 case 的 disableLegacyMode gate 决定。
 */
const React = require('react');
/**
 * 旧 render/unmount、Portal 与内部 findDOMNode 的测试入口；fixture 输出与 DOM 断言经该 renderer 连接。
 */
const ReactDOM = require('react-dom');
/**
 * 声明 gated legacy Context 的字段约束，使 provider/consumer 测试走真实旧 Context 分支。
 */
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
  /**
   * Box 以 div 包 value=foo；ReactDOM.render 后 textContent 为 foo，验证旧入口接收字符串 children。
   */

  // @gate !disableLegacyMode
  it('should render strings as children', () => {
    /**
     * 返回包住 value 的 div，供字符串 children 的 HostText 输出断言。
     */
    const Box = ({value}) => <div>{value}</div>;

    ReactDOM.render(<Box value="foo" />, container);
    expect(container.textContent).toEqual('foo');
  });
  /**
   * Box 以 div 包 value=10；DOM textContent 为字符串 10，证明数值 children 经 HostText 输出。
   */

  // @gate !disableLegacyMode
  it('should render numbers as children', () => {
    /**
     * 返回包住 value 的 div，value=10 用来证明数值被输出成 DOM 文本。
     */
    const Box = ({value}) => <div>{value}</div>;

    ReactDOM.render(<Box value={10} />, container);

    expect(container.textContent).toEqual('10');
  });
  /**
   * 先挂载 div 再更新同结构，各次 render 的第三参数把 called 设 true；两次断言均 true，验证旧入口提交 callback 在挂载和更新都执行。
   */

  // @gate !disableLegacyMode
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
  /**
   * 同一 Foo element 对象先挂载，再在 batchedUpdates 中重复 render；两次 callback 都执行，证明元素 identity bailout 不丢掉根提交回调。
   */

  // @gate !disableLegacyMode
  it('should call a callback argument when the same element is re-rendered', () => {
    /**
     * 返回固定 Foo 的 class fixture；同一个 element 重用时用于验证根 callback 仍执行。
     */
    class Foo extends React.Component {
      /**
       * 返回 Foo div，无状态副作用，让测试专注同元素对象重复 render 的提交 callback。
       */
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
  /**
   * Text 直接返回 value=foo；旧根 DOM 文本为 foo，覆盖函数组件直接返回字符串而非包宿主元素。
   */

  // @gate !disableLegacyMode
  it('should render a component returning strings directly from render', () => {
    /**
     * 直接返回 props.value 的函数组件，不包宿主元素；用于字符串根输出。
     */
    const Text = ({value}) => value;

    ReactDOM.render(<Text value="foo" />, container);
    expect(container.textContent).toEqual('foo');
  });
  /**
   * Text 直接返回 value=10；DOM 文本为 10，验证数值可以作为组件根输出。
   */

  // @gate !disableLegacyMode
  it('should render a component returning numbers directly from render', () => {
    /**
     * 直接返回 value 的函数组件，以数值输入覆盖组件根 HostText 创建。
     */
    const Text = ({value}) => value;

    ReactDOM.render(<Text value={10} />, container);

    expect(container.textContent).toEqual('10');
  });
  /**
   * class Text 返回字符串并经 ref 取得实例；内部 findDOMNode 返回容器首子、nodeType=3、nodeValue=foo，验证实例解析到 HostText。
   */

  // @gate !disableLegacyMode
  it('finds the DOM Text node of a string child', () => {
    /**
     * 直接输出字符串的 class fixture；ref 提供组件实例供内部 findDOMNode 解析。
     */
    class Text extends React.Component {
      /**
       * 返回 props.value，而非 div，使 findDOMNode 必须定位 HostText。
       */
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
  /**
   * class Fragment 返回 div/span 数组；容器有两子，findDOMNode 返回第一枚 DIV，验证 Fragment 本身无独立宿主实例。
   */

  // @gate !disableLegacyMode
  it('finds the first child when a component returns a fragment', () => {
    /**
     * 返回两枚 keyed 宿主节点的 class fixture；用于观察无独立宿主节点的数组 Fragment。
     */
    class Fragment extends React.Component {
      /**
       * 按 div、span 顺序返回数组，查找首宿主节点应选择 div。
       */
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
  /**
   * 第一项经 Wrapper 返回 div，后面为 span；容器仍两子，findDOMNode 返回第一 DIV，证明查找会穿过复合组件。
   */

  // @gate !disableLegacyMode
  it('finds the first child even when fragment is nested', () => {
    /**
     * 透传 children 的复合包装，给 findDOMNode 增加一层无宿主输出的路径。
     */
    class Wrapper extends React.Component {
      /**
       * 直接返回 children，既不增加 DOM 包装也不改变子节点顺序。
       */
      render() {
        return this.props.children;
      }
    }

    /**
     * 以 Wrapper 包第一 div、后接 span 的数组 fixture；验证首宿主节点查找穿过复合组件。
     */
    class Fragment extends React.Component {
      /**
       * 返回 Wrapper(div) 与 span，保持两个 DOM 子节点并让查找从首个逻辑子节点继续下降。
       */
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
  /**
   * 数组首项 NullComponent 后接 div/span；DOM 只有两子，findDOMNode 跳过空输出并返回 DIV，而非把第一个 Fiber 当成第一个宿主节点。
   */

  // @gate !disableLegacyMode
  it('finds the first child even when first child renders null', () => {
    /**
     * 故意返回 null 的首 sibling fixture，用于确认宿主查找跳过空输出。
     */
    class NullComponent extends React.Component {
      /**
       * 返回 null，不产生 DOM；findDOMNode 应继续寻找之后的 sibling。
       */
      render() {
        return null;
      }
    }

    /**
     * 首项无输出、之后 div/span 的数组 fixture；验证查找首 DOM 而非首 Fiber。
     */
    class Fragment extends React.Component {
      /**
       * 返回 keyed NullComponent/div/span；空首项不能阻止之后的宿主节点被找到。
       */
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
  /**
   * 依次渲染空 Fragment、含 Div 的 Fragment、空 Fragment、Div、空 Fragment；各次首子按 null/DIV 交替，验证空输出与普通宿主输出互换时正确清理。
   */

  // @gate !disableLegacyMode
  it('renders an empty fragment', () => {
    /**
     * 返回 div，作为空 Fragment 来回替换时的普通宿主输出对照。
     */
    const Div = () => <div />;
    /**
     * 返回空 Fragment，不产生 HostComponent 或 HostText，供更新清理断言。
     */
    const EmptyFragment = () => <></>;
    /**
     * 返回包含 Div 的 Fragment，使同一用例可在空输出与有宿主子节点间切换。
     */
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
    /**
     * 把 SVG ref 的 el 加入 svgEls；namespace 断言先于卸载，之后收到 null 的清理调用也可追加但不再读取其 namespace。
     */
    ref: el => svgEls.push(el)
  };
  const expectHTML = {
    /**
     * 把 HTML ref 的 el 加入 htmlEls，供提交后 namespaceURI 断言；卸载 null 在断言之后才到来。
     */
    ref: el => htmlEls.push(el)
  };
  const expectMath = {
    /**
     * 把 MathML ref 的 el 加入 mathEls，供与 HTML/SVG 分组比较；卸载清理不再次检查这些节点。
     */
    ref: el => mathEls.push(el)
  };

  /**
   * 把 tree 作为 Portal children，返回指向新建 HTML div 的 React Portal；新容器使宿主 namespace 从其根重新计算。
   */
  const usePortal = function (tree) {
    return ReactDOM.createPortal(tree, document.createElement('div'));
  };

  /**
   * 重置三组 ref 数组并在独立 div render tree，逐节点核对 namespaceURI，然后卸载并断言容器空；若 render/断言抛错，异常直接交给调用 case，不保证走到末尾清理。
   */
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
  /**
   * 普通 div 的 child 为外部 Portal；内容只写入 portalContainer，主容器仅空 div；卸载后两容器清空，证明 portal DOM 所有权随父树清理。
   */

  // @gate !disableLegacyMode
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
  /**
   * Parent 返回普通 children 与两个 Portal，step a→b；断言三个容器内容、子先父后的 mount/update 日志以及父先子卸载日志，证明逻辑 Fiber 顺序不取决于 DOM 容器。
   */

  // @gate !disableLegacyMode
  it('should render many portals', () => {
    const portalContainer1 = document.createElement('div');
    const portalContainer2 = document.createElement('div');

    const ops = [];
    /**
     * 普通和 Portal children 共用的日志 fixture；name 编码宿主容器位置和 step，便于比较统一 Fiber 提交顺序。
     */
    class Child extends React.Component {
      /**
       * 向 ops 记录当前 name 的挂载提交；不修改状态，供子先父顺序断言。
       */
      componentDidMount() {
        ops.push(`${this.props.name} componentDidMount`);
      }
      /**
       * 记录更新后的 name，证明 portal children 与普通 children 同批更新。
       */
      componentDidUpdate() {
        ops.push(`${this.props.name} componentDidUpdate`);
      }
      /**
       * 记录最后已提交 name 的卸载访问，配合父先子的删除顺序断言。
       */
      componentWillUnmount() {
        ops.push(`${this.props.name} componentWillUnmount`);
      }
      /**
       * 返回 name 文本 div，让不同逻辑位置的实例在各自宿主容器直接可见。
       */
      render() {
        return <div>{this.props.name}</div>;
      }
    }

    /**
     * 生成普通 children 和两份 Portal 的父 fixture；step 参数同步驱动所有输出和父日志。
     */
    class Parent extends React.Component {
      /**
       * 记录 Parent:step 挂载，在全部普通/Portal children didMount 后调用。
       */
      componentDidMount() {
        ops.push(`Parent:${this.props.step} componentDidMount`);
      }
      /**
       * 记录 Parent:step 更新，为 children 统一提交顺序提供父级终点。
       */
      componentDidUpdate() {
        ops.push(`Parent:${this.props.step} componentDidUpdate`);
      }
      /**
       * 记录父卸载，在普通/Portal 子实例清理之前作为删除起点。
       */
      componentWillUnmount() {
        ops.push(`Parent:${this.props.step} componentWillUnmount`);
      }
      /**
       * 按逻辑数组顺序返回普通 Child、Portal1、普通 Child、Portal2 的两子；key 保持各实例更新身份，宿主容器由 Portal 指定。
       */
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
  /**
   * Portal 内再嵌套两份 Portal；四个容器分别显示其直属文本，卸载后全部空，验证嵌套 Portal 的宿主容器切换和递归清理。
   */

  // @gate !disableLegacyMode
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
  /**
   * 同 Portal 依次更新 div 文本、换 p、文本数组重排、null；外部容器按 portal:1/2/3、HiBye/ByeHi、空变化，主树始终只有空 div，验证 Portal children 正常协调。
   */

  // @gate !disableLegacyMode
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
  /**
   * Wrapper 初始 show=true 包含空 Portal、child、parent；实例 setState(show=false) 后状态为 false、DOM 仅 parent，验证无宿主输出的 Portal 不打断删除 sibling。
   */

  // @gate !disableLegacyMode
  it('should unmount empty portal component wherever it appears', () => {
    const portalContainer = document.createElement('div');

    /**
     * show 状态控制空 Portal 与普通 child 的成组删除；parent 节点始终保留，便于发现空输出是否打断 sibling 清理。
     */
    class Wrapper extends React.Component {
      /**
       * 保存 props 并初始化 show=true，使首次提交同时包含空 Portal 和可见 child。
       */
      constructor(props) {
        super(props);
        this.state = {
          show: true,
        };
      }
      /**
       * show 为真时返回空 Portal/child Fragment，并始终返回 parent；状态关闭后只删除该 Fragment 的逻辑子树。
       */
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
  /**
   * SVG/MathML 内 Portal 指向新 HTML div，另例 HTML Portal 内含 SVG；helper 逐节点 namespaceURI 断言并卸载清空，证明进入新容器重算 namespace、返回后恢复原环境。
   */

  // @gate !disableLegacyMode
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
  /**
   * 多 Portal、MathML/SVG/foreignObject 与嵌套 Portal 组合；每种 ref 分组核对 namespaceURI，helper 卸载根清空，覆盖反复进入/退出宿主上下文的栈恢复。
   */

  // @gate !disableLegacyMode
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
  /**
   * 更深 SVG/foreignObject/Portal 嵌套和旁路 HTML sibling；逐宿主 namespace 断言及卸载清空，验证复杂容器切换不把子树 namespace 泄漏给其他分支。
   */

  // @gate !disableLegacyMode
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
  /**
   * SVG 下 BrokenRender 无边界抛 Hello，act 拒绝；之后在新测试容器渲染 HTML div 的 namespace 正确，证明异常 unwind 不遗留 SVG host context。
   */

  // @gate !disableLegacyMode
  it('should unwind namespaces on uncaught errors', async () => {
    /**
     * 在 SVG render 中直接抛 Hello；无边界 case 通过 act 断言错误并检查后续 HTML namespace。
     */
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
  /**
   * SVG foreignObject 的边界内 MathML render 抛错；didCatch 恢复为 HTML p，随后独立 HTML render 也正确，验证捕获恢复与普通后续路径均恢复 namespace 栈。
   */

  // @gate !disableLegacyMode
  it('should unwind namespaces on caught errors', () => {
    /**
     * 在 MathML 分支直接抛 Hello，触发 foreignObject 内边界的旧式提交后恢复。
     */
    function BrokenRender() {
      throw new Error('Hello');
    }

    /**
     * 捕获 MathML 子错误后输出 HTML p 的边界；所在 foreignObject 为回退提供 HTML host context。
     */
    class ErrorBoundary extends React.Component {
      /**
       * error=null 时先渲染原 children，didCatch 更新后据此切换 p 回退。
       */
      state = {error: null};
      /**
       * 提交后保存捕获 error 到状态，安排边界重新 render；不自己更改 host context。
       */
      componentDidCatch(error) {
        this.setState({error});
      }
      /**
       * error 存在返回带 HTML ref 的 p，否则透传 children；namespace 由恢复后的父宿主上下文决定。
       */
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
  /**
   * SVG 边界的 Portal 内经过 HTML/MathML 后抛错；边界回退 image 必须仍属 SVG，旁边 Portal div 必须属 HTML，证明跨 Portal 异常向上恢复 host context。
   */

  // @gate !disableLegacyMode
  it('should unwind namespaces on caught errors in a portal', () => {
    /**
     * 在 Portal 内 MathML render 中抛 Hello，检验 unwind 跨容器回到 SVG 边界。
     */
    function BrokenRender() {
      throw new Error('Hello');
    }

    /**
     * 所在 SVG 树的错误边界；跨 Portal 错误返回后应以 SVG image 恢复。
     */
    class ErrorBoundary extends React.Component {
      /**
       * error 初始为空，捕获后保留 Error 作为 image 回退的开关。
       */
      state = {error: null};
      /**
       * didCatch 把 error 写入状态，下一更新在保留边界的宿主上下文中恢复。
       */
      componentDidCatch(error) {
        this.setState({error});
      }
      /**
       * 错误态返回带 SVG ref 的 image，成功态返回 children；回退不能沿用抛错 Portal 内的 HTML/MathML 环境。
       */
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
  /**
   * legacy Context Parent 提供 foo=bar，并把 consumer 放外部 Portal；断言旧 API 警告、主容器空、Portal bar，证明 Context 沿逻辑树而非 DOM 祖先传播。
   */

  // @gate !disableLegacyContext
  // @gate !disableLegacyMode
  it('should pass portal context when rendering subtree elsewhere', () => {
    const portalContainer = document.createElement('div');

    /**
     * Portal 内的 legacy Context consumer；读取逻辑祖先提供的 foo，DOM 容器本身没有该 provider。
     */
    class Component extends React.Component {
      /**
       * 要求旧 Context 的 foo 为字符串，配合 Parent.childContextTypes 声明消费通道。
       */
      static contextTypes = {
        foo: PropTypes.string.isRequired,
      };

      /**
       * 返回 this.context.foo 的 div，以 Portal DOM 文本证明旧 Context 跨容器传播。
       */
      render() {
        return <div>{this.context.foo}</div>;
      }
    }

    /**
     * 提供 foo=bar 后返回 Portal 的旧 Context provider fixture。
     */
    class Parent extends React.Component {
      /**
       * 声明向后代提供必需字符串 foo，与 consumer.contextTypes 对齐。
       */
      static childContextTypes = {
        foo: PropTypes.string.isRequired,
      };

      /**
       * 返回固定 foo=bar 的旧 Context 值，逻辑后代即使在 Portal 中也应读取此值。
       */
      getChildContext() {
        return {
          foo: 'bar',
        };
      }

      /**
       * 返回指向 portalContainer 的 Component Portal，主容器不会产生宿主节点。
       */
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
  /**
   * Parent state.bar 从 initial→changed，同时提供 foo 与 getFoo；Portal 文本从 initial-initial→changed-changed，主容器空，验证 state 驱动的旧 Context 更新穿过 Portal。
   */

  // @gate !disableLegacyContext
  // @gate !disableLegacyMode
  it('should update portal context if it changes due to setState', () => {
    const portalContainer = document.createElement('div');

    /**
     * 同时读取 legacy Context 值和 getter 的 Portal consumer；两项拼接便于发现字段/闭包更新不同步。
     */
    class Component extends React.Component {
      /**
       * 声明 foo 字符串和 getFoo 函数，分别测试直接值与延后读取路径。
       */
      static contextTypes = {
        foo: PropTypes.string.isRequired,
        getFoo: PropTypes.func.isRequired,
      };

      /**
       * 返回 foo-getFoo() 文本，要求两条读取都反映 Parent 最新 state。
       */
      render() {
        return <div>{this.context.foo + '-' + this.context.getFoo()}</div>;
      }
    }

    /**
     * state.bar 驱动旧 Context 的 Portal provider；供实例 setState 后验证传播。
     */
    class Parent extends React.Component {
      /**
       * 声明提供 foo/getFoo 两通道，保持 consumer 接口稳定。
       */
      static childContextTypes = {
        foo: PropTypes.string.isRequired,
        getFoo: PropTypes.func.isRequired,
      };

      /**
       * bar 初始 initial；更新 changed 后用于同轮生成 Context 字段与 getter 读值。
       */
      state = {
        bar: 'initial',
      };

      /**
       * 返回 foo=this.state.bar 及读取当前 state 的 getFoo；由旧 Context 栈传递到 Portal consumer。
       */
      getChildContext() {
        return {
          foo: this.state.bar,
          /**
           * 调用时返回 Parent 当前 state.bar，而非创建 Context 对象时缓存的值；用来对照直接 foo 字段。
           */
          getFoo: () => this.state.bar,
        };
      }

      /**
       * 返回 Portal(Component)，容器保持不变，更新只传播 provider 状态。
       */
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
  /**
   * Parent props.bar 从 initial→changed 提供 Context 字段/闭包；重复 render 后 Portal 两次读值一致，验证 props 驱动的 Context 更新同样不被容器边界截断。
   */

  // @gate !disableLegacyContext
  // @gate !disableLegacyMode
  it('should update portal context if it changes due to re-render', () => {
    const portalContainer = document.createElement('div');

    /**
     * props 驱动 Context 更新的 Portal consumer，输出直接值和 getter 值作一致性断言。
     */
    class Component extends React.Component {
      /**
       * 声明 foo/getFoo 两个 legacy Context 通道，分别为字符串和函数。
       */
      static contextTypes = {
        foo: PropTypes.string.isRequired,
        getFoo: PropTypes.func.isRequired,
      };

      /**
       * 拼接当前 foo 与 getFoo()，用于验证重渲染更新两项读值。
       */
      render() {
        return <div>{this.context.foo + '-' + this.context.getFoo()}</div>;
      }
    }

    /**
     * props.bar 驱动 Context 的 provider；重用同一个根与 Portal 容器，排除重新挂载的干扰。
     */
    class Parent extends React.Component {
      /**
       * 声明向逻辑后代提供 foo/getFoo，Portal 不截断该旧 Context 通道。
       */
      static childContextTypes = {
        foo: PropTypes.string.isRequired,
        getFoo: PropTypes.func.isRequired,
      };

      /**
       * 返回 foo=this.props.bar 与读取当前 props 的 getFoo；下一轮 root render 后生成更新的 Context 值。
       */
      getChildContext() {
        return {
          foo: this.props.bar,
          /**
           * 调用时返回 Parent 当前 props.bar，和 Context 的直接 foo 值比较。
           */
          getFoo: () => this.props.bar,
        };
      }

      /**
       * 返回固定 portalContainer 的 Component Portal，普通根输出为空。
       */
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
  /**
   * MyNode 数组从 div 扩为 span/div；ReactDOM.render 返回同一个组件实例，但 findDOMNode 从 DIV 变 SPAN，验证查找按当前已提交宿主树定位。
   */

  // @gate !disableLegacyMode
  it('findDOMNode should find dom element after expanding a fragment', () => {
    /**
     * flag 控制在原 keyed div 前新增 keyed span 的 class fixture；组件实例保持而首宿主位置改变。
     */
    class MyNode extends React.Component {
      /**
       * flag 为假返回 div 数组，为真返回 span/div；findDOMNode 应根据当前树找到新的第一个宿主节点。
       */
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
  /**
   * Portal DOM 在独立容器，点击 portal 节点；ops 为 portal clicked→parent clicked，证明 React 事件沿逻辑父 Fiber 冒泡；finally 移除 Portal 容器。
   */

  // @gate !disableLegacyMode
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
  /**
   * 鼠标从父内普通节点移到 Portal 内，再移到父外 sibling；进入 Portal 不触发父 leave，离开逻辑子树才 portal leave→parent leave；finally 清理外部容器。
   */

  // @gate !disableLegacyMode
  it('should not onMouseLeave when staying in the portal', () => {
    const portalContainer = document.createElement('div');
    document.body.appendChild(portalContainer);

    let ops = [];
    let firstTarget = null;
    let secondTarget = null;
    let thirdTarget = null;

    /**
     * 模拟 from→to 的鼠标移动：mouseout.relatedTarget=to，mouseover.relatedTarget=from；空端点为窗口外，无返回值，用来检查 Portal 逻辑祖先的 enter/leave。
     */
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
  /**
   * issue 19562 场景按窗口外→根容器→内部目标→根容器→窗口外移动；ops 为无/enter/leave/无，证明 relatedTarget=根容器时 EnterLeave 不重复派发。
   */

  // 针对 https://github.com/facebook/react/issues/19562 的回归测试。
  // @gate !disableLegacyMode
  it('does not fire mouseEnter twice when relatedTarget is the root node', () => {
    let ops = [];
    let target = null;

    /**
     * 分别派发 from 的 out 与 to 的 over，相关目标互指；根容器也作为端点，供 issue19562 场景检验重复 enter 消除。
     */
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
  /**
   * Portal button 本身无 onClick、父 div 有；冒泡 click 仍只调用父 listener 一次，验证 Portal 容器注册所需事件即使其子树没有对应 prop。
   */

  // @gate !disableLegacyMode
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

  /**
   * createPortal 分别接收 null 与 TextNode 容器；同步抛 Target container is not a DOM element，覆盖容器入口校验。
   */
  it('should throw on bad createPortal argument', () => {
    expect(() => {
      ReactDOM.createPortal(<div>portal</div>, null);
    }).toThrow('Target container is not a DOM element.');
    expect(() => {
      ReactDOM.createPortal(<div>portal</div>, document.createTextNode('hi'));
    }).toThrow('Target container is not a DOM element.');
  });
  /**
   * Example 返回 onClick 字符串 woops；render 后 DEV 警告指出 listener 必须为函数，此例只验证注册值校验，未派发点击。
   */

  // @gate !disableLegacyMode
  it('should warn for non-functional event listeners', () => {
    /**
     * 返回非函数 onClick 的 class fixture，用来触发 host prop listener 校验。
     */
    class Example extends React.Component {
      /**
       * 返回 onClick=woops 的 div，不派发事件；预期仅 DEV 注册值警告。
       */
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
  /**
   * Example 返回 onClick=false；断言专用 DEV 提示以及改用 ternary 的建议，区分 false 与一般非函数值提示。
   */

  // @gate !disableLegacyMode
  it('should warn with a special message for `false` event listeners', () => {
    /**
     * 返回 onClick=false 的 class fixture，检验与一般字符串值不同的专用提示。
     */
    class Example extends React.Component {
      /**
       * 返回绑定 false 的 div，作为条件表达式误传 listener 的输入。
       */
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
  /**
   * 先 A，再 flip 到 B，tick 保持 B；render 候选 forceA 时 Click 构造器点击旧 DOM，仍调用 B；提交后再点调用 A，证明 getListener 读取已提交 DOM props 而非候选 Fiber props。
   */

  // @gate !disableLegacyMode
  it('should not update event handlers until commit', () => {
    spyOnDev(console, 'error');

    let ops = [];
    /**
     * 记录已提交 handler A 的访问并返回 push 的长度；返回值不参与 React 事件断言。
     */
    const handlerA = () => ops.push('A');
    /**
     * 记录已提交 handler B 的访问，使候选 render 中的点击可与提交后新 handler 区分。
     */
    const handlerB = () => ops.push('B');

    /**
     * 给已提交 node 派发可冒泡、可取消 click，并固定 timeStamp=0；不返回 dispatch 结果，ops 记录当前监听选择。
     */
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

    /**
     * 通过 state.flip 与 props.forceA 选择 A/B 的事件 fixture；count 只提供不换监听的额外 render。
     */
    class Example extends React.Component {
      /**
       * flip=false 初始 A，count=0 为无关更新计数；这些候选状态不会在 render 中直接改 DOM 已提交监听。
       */
      state = {flip: false, count: 0};
      /**
       * 把 flip 设真并递增 count，安排提交 B listener；无返回值。
       */
      flip() {
        this.setState({flip: true, count: this.state.count + 1});
      }
      /**
       * 只递增 count 保持 flip，验证重复 render 不改变已提交 B listener。
       */
      tick() {
        this.setState({count: this.state.count + 1});
      }
      /**
       * forceA 优先，否则 flip 选择 B；返回 div 的候选 onClick，只有 host commit 才写入供 getListener 读取的 DOM props。
       */
      render() {
        const useB = !this.props.forceA && this.state.flip;
        return <div onClick={useB ? handlerB : handlerA} />;
      }
    }

    /**
     * 在构造过程中点击旧 DOM 的 probe 组件；它自己返回 null，让测试只观察未提交监听的隔离。
     */
    class Click extends React.Component {
      /**
       * super 后立即 node.click，故点击发生在本轮 render/构造而非 commit；此时应仍读取旧 B listener。
       */
      constructor() {
        super();
        node.click();
      }
      /**
       * 返回 null，不增添 DOM 或事件 handler，避免 probe 干扰待测目标。
       */
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

    // 切回 A；第二个组件在 render 中模拟点击，用来观察 A 的新处理器尚未提交时的事件行为。
    ReactDOM.render(
      [<Example key="a" forceA={true} />, <Click key="b" />],
      container,
    );

    // render 阶段的点击仍读取 DOM 上已提交的 props，因此调用旧处理器 B。
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
  /**
   * 标题提 low-priority tree，但正文仅同步 render hidden div 子树且没有调度/DOM断言；有效观察是渲染调用完成，不足以证明特定 lane 或时间片行为。
   */

  // @gate !disableLegacyMode
  it('should not crash encountering low-priority tree', () => {
    ReactDOM.render(
      <div hidden={true}>
        <div />
      </div>,
      container,
    );
  });
  /**
   * 空容器先 foo，再 render(null) 清空，再 bar；三次 DOM 断言证明同一旧根可以在空输出后继续使用，正文未显式断言 console 调用数。
   */

  // @gate !disableLegacyMode
  it('should not warn when rendering into an empty container', () => {
    ReactDOM.render(<div>foo</div>, container);
    expect(container.innerHTML).toBe('<div>foo</div>');
    ReactDOM.render(null, container);
    expect(container.innerHTML).toBe('');
    ReactDOM.render(<div>bar</div>, container);
    expect(container.innerHTML).toBe('<div>bar</div>');
  });
  /**
   * 先正常同 key 更新到 bar，随后手工 innerHTML 替换，再改 key；act 拒绝旧节点不属于父节点的错误并断言 DEV 外部删除警告，揭示 Fiber 保留旧 DOM 引用。
   */

  // @gate !disableLegacyMode
  it('should warn when replacing a container which was manually updated outside of React', async () => {
    // 先验证没有外部 DOM 修改时的正常更新。
    ReactDOM.render(<div key="1">foo</div>, container);
    ReactDOM.render(<div key="1">bar</div>, container);
    expect(container.innerHTML).toBe('<div>bar</div>');
    // 外部替换删除了 React 记录的宿主节点；改变 key 后 React 尝试移除旧节点，会收到 NotFoundError。
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
  /**
   * 先正常更新，再手工换成 MEOW 后同类型更新 baz；断言外部删除 DEV 警告，正文没有断言最终 DOM，不能讲成成功修复手工改动。
   */

  // @gate !disableLegacyMode
  it('should warn when doing an update to a container manually updated outside of React', () => {
    // 先验证没有外部 DOM 修改时的正常更新。
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
  /**
   * 先正常更新，再手工把容器清空后同类型更新 baz；仅断言 DEV 不支持外部删除警告，未验证重新挂载内容。
   */

  // @gate !disableLegacyMode
  it('should warn when doing an update to a container manually cleared outside of React', () => {
    // 先验证没有外部 DOM 修改时的正常更新。
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
  /**
   * 在 iframe document 的容器渲染文本，spy appendChild 保存节点；断言内容、ownerDocument 是 iframe 而非主 document、插入一次，证明 HostText 创建使用容器所属文档。
   */

  // @gate !disableLegacyMode
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
  /**
   * 把 div 挂到 DocumentFragment，普通容器先为空；再 append fragment 后普通容器出现 foo，验证 fragment 可作为创建/插入宿主容器。
   */

  // @gate !disableLegacyMode
  it('should mount into a document fragment', () => {
    const fragment = document.createDocumentFragment();
    ReactDOM.render(<div>foo</div>, fragment);
    expect(container.innerHTML).toBe('');
    container.appendChild(fragment);
    expect(container.innerHTML).toBe('<div>foo</div>');
  });
  /**
   * Child 在 document 原生 capture click 中 setState({})，外层受控 checkbox 同次 click 触发 Parent onChange；断言 flag=true，证明子更新不应无故 diff 复用的父 input 而干扰 change 提取。
   */

  // 针对 https://github.com/facebook/react/issues/12643#issuecomment-413727104 的回归测试。
  // @gate !disableLegacyMode
  it('should not diff memoized host components', () => {
    const inputRef = React.createRef();
    let didCallOnChange = false;

    /**
     * document capture click 中触发自身更新的子组件；用来检查复用父 input 不被无关更新重新提交。
     */
    class Child extends React.Component {
      /**
       * 初始化空 state；update 也传空补丁，足以安排子 render 而不改变父 checkbox props。
       */
      state = {};
      /**
       * 挂载提交向 document 注册稳定 this.update 的捕获 click listener，让 setState 发生在 React change 处理前。
       */
      componentDidMount() {
        document.addEventListener('click', this.update, true);
      }
      /**
       * 用同一 this.update 和 capture=true 移除 document listener，避免 fixture 生命周期外遗留全局订阅。
       */
      componentWillUnmount() {
        document.removeEventListener('click', this.update, true);
      }
      /**
       * 原生 document capture 阶段 setState({})；不返回输出，要求父宿主 input 保持已提交 props 以继续提取 onChange。
       */
      update = () => {
        // 验证此 setState() 不会让 React 向外层 input 提交更新；否则会阻止父组件的 onChange 处理器触发。
        this.setState({});
        // 注意：同一组件的 document 手动捕获监听器若先调用 setState()，onChange 一直存在问题，
        // 但该场景很少见；这里验证子组件这样做时不会破坏父组件。
      };
      /**
       * 返回无状态展示的 div，子更新本身不需要改动父 input。
       */
      render() {
        return <div />;
      }
    }

    /**
     * 包含更新子组件与受控 checkbox 的父 fixture；onChange flag 证明同一次点击未被子更新干扰。
     */
    class Parent extends React.Component {
      /**
       * 收到 change 回调即置 didCallOnChange=true；参数 val 未读取，测试只关心回调到达。
       */
      handleChange = val => {
        didCallOnChange = true;
      };
      /**
       * 返回 Child 与 checked=true 的 checkbox，把 ref 暴露给测试派发 click；父 props 没有参与子 setState 更新。
       */
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
  /**
   * 旧 button focus handler 卸载旧根，再同容器挂新 button；新 focus 冲刷旧离散工作后 DOM 仍 new，验证旧根残留任务不会清空替换后的根。
   */

  // @gate !disableLegacyMode
  it('unmounted legacy roots should never clear newer root content from a container', () => {
    const ref = React.createRef();

    /**
     * 返回旧 button，focus handler 卸载其根；ref 供外部触发焦点，制造旧根遗留任务与新根重用容器的顺序。
     */
    function OldApp() {
      /**
       * focus 时 unmountComponentAtNode(container)，不返回清理函数；随后的旧离散工作不能误清除新根内容。
       */
      const hideOnFocus = () => {
        // 旧 button 的 focus handler 卸载所属旧根；新根随后重用同一容器。
        ReactDOM.unmountComponentAtNode(container);
      };

      return (
        <button onFocus={hideOnFocus} ref={ref}>
          old
        </button>
      );
    }

    /**
     * 返回 new button 并重用测试 ref；第二次 focus 触发待处理旧工作，DOM new 是隔离断言。
     */
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
