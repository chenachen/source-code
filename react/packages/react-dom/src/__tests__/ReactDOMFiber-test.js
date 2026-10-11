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

  /** 空 DOM 根渲染 Box(value=foo)，断言 textContent 为 foo，验证字符串 child 成为宿主文本。 */
  it('should render strings as children', async () => {
    /** 把 value 包在 div 中返回，供字符串 child 用例观察 textContent。 */
    const Box = ({value}) => <div>{value}</div>;
    await act(async () => {
      root.render(<Box value="foo" />);
    });
    expect(container.textContent).toEqual('foo');
  });

  /** 空根渲染 Box(value=10)，断言文本为字符串 10，验证数字 child 的文本输出。 */
  it('should render numbers as children', async () => {
    /** 把数字 value 包在 div 中输出，供宿主文本转换断言。 */
    const Box = ({value}) => <div>{value}</div>;

    await act(async () => {
      root.render(<Box value={10} />);
    });

    expect(container.textContent).toEqual('10');
  });

  /** 空根渲染 Box(value=10n)，断言文本为 10，验证 bigint child 的宿主文本转换。 */
  it('should render bigints as children', async () => {
    /** 把 bigint value 包在 div 中输出，供 bigint 文本支持用例。 */
    const Box = ({value}) => <div>{value}</div>;

    await act(async () => {
      root.render(<Box value={10n} />);
    });

    expect(container.textContent).toEqual('10');
  });

  /** Component 的无依赖数组 passive Effect 记录 Callback；首次挂载和再次提交同类型组件后各断言一次日志，验证每次完成提交后 Effect 被执行。 */
  it('should call an effect after mount/update (replacing render callback pattern)', async () => {
    /** 返回 Foo div，并用无依赖数组 useEffect 在每次提交后记录 Callback；不提供 Effect 清理。 */
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

  /** 首次提交 Component(prop=Foo)，再提交新 JSX 的 Component(prop=Bar)；无依赖数组 Effect 每次记录 Callback，验证属性更新后的 Effect，本用例没有复用同一个 element 对象。 */
  it('should call an effect when the same element is re-rendered (replacing render callback pattern)', async () => {
    /** 返回 prop 文本，并在每次提交后记录 passive Effect，供 Foo→Bar 的属性更新用例。 */
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

  /** 函数 Text 直接返回输入字符串 foo，提交后 textContent 为 foo，验证函数组件可直接输出文本而无需宿主包装。 */
  it('should render a component returning strings directly from render', async () => {
    /** 直接返回 value 字符串，不创建宿主包装，供根文本输出断言。 */
    const Text = ({value}) => value;

    await act(async () => {
      root.render(<Text value="foo" />);
    });

    expect(container.textContent).toEqual('foo');
  });

  /** 函数 Text 直接返回数字 10，提交后 textContent 为 10，验证数字返回值成为宿主文本。 */
  it('should render a component returning numbers directly from render', async () => {
    /** 直接返回数字 value，让协调器创建对应宿主文本。 */
    const Text = ({value}) => value;
    await act(async () => {
      root.render(<Text value={10} />);
    });

    expect(container.textContent).toEqual('10');
  });

  /** 同一根在 EmptyFragment、含 Div 的 Fragment、Div 之间切换；断言空分支 firstChild 为 null、非空分支为 DIV，验证 Fragment 不创建包装 DOM且切换会清理旧子节点。 */
  it('renders an empty fragment', async () => {
    /** 返回一个空 div，作为 Fragment 切换用例的非空宿主对照。 */
    const Div = () => <div />;
    /** 返回无 children 的 Fragment，期望容器没有任何宿主节点。 */
    const EmptyFragment = () => <></>;
    /** 返回只包裹 Div 的 Fragment，用来验证非空 Fragment 不添加包装节点。 */
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
    /** 接收 ref 传入的 el 并追加到 svgEls，返回 push 的数组长度；后续断言检查所收集节点的 SVG 命名空间，回调本身不筛选节点。 */
    ref: el => svgEls.push(el)
  };
  const expectHTML = {
    /** 接收 ref 传入的 el 并追加到 htmlEls，返回 push 的数组长度；后续断言检查所收集节点的 HTML 命名空间，回调本身不筛选节点。 */
    ref: el => htmlEls.push(el)
  };
  const expectMath = {
    /** 接收 ref 传入的 el 并追加到 mathEls，返回 push 的数组长度；后续断言检查所收集节点的 MathML 命名空间，回调本身不筛选节点。 */
    ref: el => mathEls.push(el)
  };

  /** 将输入 tree Portal 到新建的 HTML div；返回 Portal 供 namespace helper 验证容器上下文切换。 */
  const usePortal = function (tree) {
    return ReactDOM.createPortal(tree, document.createElement('div'));
  };

  /** 清空三类 ref 收集数组，在独立根提交 tree；逐个断言 namespaceURI，最后卸载并检查容器空；异步 act 让提交完成后再观测。 */
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

  /** 在主根 div 中声明一个向独立容器的 Portal；断言主容器只有空 div、Portal 容器有 portal 内容，unmount 两处都清空，验证跨容器宿主放置与根级清理。 */
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

  /** Parent 混排普通 Child 和两个 Portal，step 从 a 更新为 b 后卸载；断言三容器内容以及子到父的 mount/update、父到子的 unmount 日志，验证 Portal 仍按 React 树参与生命周期遍历。 */
  it('should render many portals', async () => {
    const portalContainer1 = document.createElement('div');
    const portalContainer2 = document.createElement('div');

    /** 用 name 标识普通或 Portal 子组件，输出 div 并记录 mount/update/unmount 生命周期，供跨容器遍历顺序断言。 */
    class Child extends React.Component {
      /** 子组件挂载后记录 name 与 componentDidMount，证明 Portal 子树仍参与父根的提交。 */
      componentDidMount() {
        Scheduler.log(`${this.props.name} componentDidMount`);
      }
      /** 子组件更新提交后记录新 name，供 step=a→b 的遍历顺序断言。 */
      componentDidUpdate() {
        Scheduler.log(`${this.props.name} componentDidUpdate`);
      }
      /** 删除子组件时记录 name 与 componentWillUnmount，供根卸载顺序断言。 */
      componentWillUnmount() {
        Scheduler.log(`${this.props.name} componentWillUnmount`);
      }
      /** 将 name 输出到 div，标识该 Child 最终进入哪个宿主容器。 */
      render() {
        return <div>{this.props.name}</div>;
      }
    }

    /** 根据 step 返回混排普通 Child 与两个 Portal 的数组，并记录自身生命周期，构造统一 React 树的多容器提交。 */
    class Parent extends React.Component {
      /** 在全部子节点挂载后记录 Parent/step，供子到父的 mount 日志断言。 */
      componentDidMount() {
        Scheduler.log(`Parent:${this.props.step} componentDidMount`);
      }
      /** 在子树更新后记录 Parent/step，供子到父的 update 日志断言。 */
      componentDidUpdate() {
        Scheduler.log(`Parent:${this.props.step} componentDidUpdate`);
      }
      /** 根删除时先记录 Parent/step，供父到子的 unmount 顺序断言。 */
      componentWillUnmount() {
        Scheduler.log(`Parent:${this.props.step} componentWillUnmount`);
      }
      /** 返回有 key 的普通子节点和分别定向两个容器的 Portal；step 只改变展示 name。 */
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

  /** 在 Portal 内再声明两层独立目标 Portal；断言四个容器分别只含各自宿主内容，根卸载全部清空，验证嵌套 Portal 的目标容器边界。 */
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

  /** 同一 Portal 依次提交 div 文本更新、p 类型替换、文本数组重排及 null；断言目标容器逐阶段变化、主容器始终只有空 div，验证 Portal children 的普通协调与清空。 */
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

  /** Wrapper 初始 show=true 同时包含空 Portal 和 child；setState(show=false) 后 state 为 false且只剩 parent，验证空 Portal 不阻碍同组 Fragment 子树卸载。 */
  it('should unmount empty portal component wherever it appears', async () => {
    const portalContainer = document.createElement('div');
    let instance;
    /** show 状态控制含空 Portal 与普通 div 的 Fragment，暴露类实例给用例以 setState 删除整组。 */
    class Wrapper extends React.Component {
      /** 接收 props 并传给父构造器，保存 this 到 instance，初始化 show=true 作为卸载前状态。 */
      constructor(props) {
        super(props);
        instance = this;
        this.state = {
          show: true,
        };
      }
      /** show=true 时返回空 Portal 与 child，始终返回 parent div，供条件删除后的 DOM 对照。 */
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

  /** 在 SVG/MathML 主树中插入 HTML Portal，并在 HTML 主树内插入 SVG Portal；helper 逐个 ref 检查 namespaceURI 后卸载，验证进入 Portal 使用目标容器命名空间并恢复外层上下文。 */
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

  /** 组合多个 Portal、SVG foreignObject、MathML 与 Portal 中的 Portal；逐 ref 检查命名空间并卸载，验证交错容器和宿主命名空间切换不泄漏到后续兄弟。 */
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

  /** 构造深层 SVG/foreignObject 与多级 Portal 的混合树；逐 ref 检查 HTML/SVG/MathML namespaceURI 并清空根，验证深层宿主上下文入栈/退栈。 */
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

  /** 在 SVG 内 BrokenRender 抛 Hello，断言 helper 拒绝；随后新根渲染 HTML div 且命名空间正确，验证未捕获错误后宿主上下文收口。 */
  it('should unwind namespaces on uncaught errors', async () => {
    /** render 时同步抛 Hello，主动终止 SVG 子树，供未捕获错误的宿主上下文退栈用例。 */
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

  /** foreignObject 内 ErrorBoundary 捕获 MathML 子树的 Hello 并输出 HTML p；同时检查外部 SVG image 与后续 HTML 根命名空间，验证捕获后 fallback 使用边界位置的宿主上下文。 */
  it('should unwind namespaces on caught errors', async () => {
    /** 在 MathML 子树 render 中抛 Hello，触发 foreignObject 内 ErrorBoundary 的 HTML fallback。 */
    function BrokenRender() {
      throw new Error('Hello');
    }

    /** 保存捕获错误并在 fallback 输出 HTML p，供边界位置的命名空间恢复验证。 */
    class ErrorBoundary extends React.Component {
      /** error 初值为 null，捕获后变为 Error；该值决定返回 children 还是 fallback。 */
      state = {error: null};
      /** 接收 render 错误并 setState 保存 error，触发边界的后续 fallback 提交。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** 有 error 时输出带 HTML ref 的 p，否则返回 children，区分错误前后宿主上下文。 */
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

  /** SVG 内边界的子树经 Portal 进入 HTML/MathML 后抛错，边界改输出 SVG image；各 ref 命名空间正确，验证 Portal 错误退栈回到 React 边界的外层上下文。 */
  it('should unwind namespaces on caught errors in a portal', async () => {
    /** 在 Portal 进入的 MathML render 路径抛 Hello，供外层 SVG 边界捕获。 */
    function BrokenRender() {
      throw new Error('Hello');
    }

    /** 在 Portal 子树抛错后改为自身位置的 SVG image，验证上下文回到边界所在树。 */
    class ErrorBoundary extends React.Component {
      /** error 初始为 null；捕获的错误使 render 切换为 SVG fallback。 */
      state = {error: null};
      /** 将收到的错误保存进 state，触发 image fallback 提交。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** 错误存在时输出带 SVG ref 的 image，否则返回跨容器 children。 */
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

  /** 启用 legacy context 的 Parent 在另一 DOM 容器 Portal 出消费 foo 的 Component；断言两条 legacy 警告、主容器空且目标内容为 bar，验证 context 沿 React 父链传入 Portal。 */
  // @gate !disableLegacyContext
  it('should pass portal context when rendering subtree elsewhere', async () => {
    const portalContainer = document.createElement('div');

    /** 通过 legacy contextTypes 消费 foo 并显示 div，供 Portal context 传递用例。 */
    class Component extends React.Component {
      /** 声明必需字符串 foo，开启 legacy context 消费与相应开发警告。 */
      static contextTypes = {
        foo: PropTypes.string.isRequired,
      };

      /** 把 this.context.foo 输出为 div 文本，让断言直接观察 Portal 收到的 context。 */
      render() {
        return <div>{this.context.foo}</div>;
      }
    }

    /** 通过 getChildContext 提供 foo=bar，再 Portal 出 Component 到独立容器。 */
    class Parent extends React.Component {
      /** 声明向后代提供的必需字符串 foo，供 legacy context 校验。 */
      static childContextTypes = {
        foo: PropTypes.string.isRequired,
      };

      /** 返回 foo=bar 的 child context，所有权沿 React 树传入 Portal 后代。 */
      getChildContext() {
        return {
          foo: 'bar',
        };
      }

      /** 返回定向 portalContainer 的 Component Portal，不在主容器输出宿主节点。 */
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

  /** Portal 目标容器与 React 父 div 的 DOM 位置分离；点击 Portal div 后日志依次为 portal clicked、parent clicked，验证合成冒泡使用 React 祖先；finally 移除 Portal 容器。 */
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

  /** 主树父节点和其 Portal 子节点均有 enter/leave；模拟从外部进入父子树、进入 Portal、再离开 React 父子树，断言中途只有 Portal enter、最终 Portal leave 后 parent leave，验证共享 React 祖先不会在内部移动时退出。 */
  it('should not onMouseLeave when staying in the portal', async () => {
    const portalContainer = document.createElement('div');
    document.body.appendChild(portalContainer);

    let firstTarget = null;
    let secondTarget = null;
    let thirdTarget = null;

    /** 接收离开/进入的 DOM 节点；分别发送带对方 relatedTarget 的冒泡 mouseout/mouseover，null 表示树外侧。 */
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
  /** 从外部进入根容器、再进入其 React 子节点、返回容器并离开；断言子节点 enter/leave 各一次且容器边界无日志，验证 relatedTarget 为根容器时 EnterLeave 提取不会重复。 */
  it('does not fire mouseEnter twice when relatedTarget is the root node', async () => {
    let target = null;

    /** 接收 from/to，发送对应 mouseout/mouseover 并互设 relatedTarget，构造根容器与 React 子节点间的 EnterLeave 输入。 */
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

  /** Portal button 自身没有 click handler，React 父 div 有 onClick；分发冒泡 MouseEvent 后父 mock 只调用一次，验证 Portal 目标仍安装该事件的根监听。 */
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

  /** 把 null 和 Text DOM 节点传给 createPortal 作为容器；两次同步断言相同非法容器错误，验证 Portal 容器类型校验。 */
  it('should throw on bad createPortal argument', () => {
    expect(() => {
      ReactDOM.createPortal(<div>portal</div>, null);
    }).toThrow('Target container is not a DOM element.');
    expect(() => {
      ReactDOM.createPortal(<div>portal</div>, document.createTextNode('hi'));
    }).toThrow('Target container is not a DOM element.');
  });

  /** Example 输出 onClick 字符串，flushSync 挂载后断言包含 string 类型及组件栈的警告，验证非函数事件属性的开发诊断。 */
  it('should warn for non-functional event listeners', () => {
    /** 输出字符串 onClick 的 div，供开发环境事件属性类型诊断。 */
    class Example extends React.Component {
      /** 返回 onClick=woops 的 div；不触发 click，警告来自挂载属性校验。 */
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

  /** Example 输出 onClick=false，flushSync 后断言条件表达式建议的专门警告，验证 false 的诊断分支。 */
  it('should warn with a special message for `false` event listeners', () => {
    /** 输出 onClick=false 的 div，供条件表达式误用的专门诊断。 */
    class Example extends React.Component {
      /** 返回 false 事件属性，使开发校验走带替代写法建议的分支。 */
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

  /** 先提交 handler A，再通过 state 选择 B；随后 forceA 更新旁边新挂载的 Click 在构造器中点击旧 DOM，日志仍是 B，commit 后点击才是 A，验证事件读取已提交 props；无关 tick 更新仍保持 B。 */
  it('should not update event handlers until commit', async () => {
    /** 被选择为已提交 A 处理器时记录 A，不修改状态。 */
    const handlerA = () => Scheduler.log('A');
    /** 被选择为已提交 B 处理器时记录 B，供 render 中点击与 commit 后点击对照。 */
    const handlerB = () => Scheduler.log('B');

    /** 创建可冒泡/取消、timeStamp 固定为 0 的 click 并分发到已保存 DOM node，提供统一事件输入。 */
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

    /** flip/count 状态控制 div 的 A/B handler，forceA 可覆盖 flip；供提交前后 props 可见性测试。 */
    class Example extends React.Component {
      /** flip=false 首次选择 A，count=0 用作额外 tick 更新而不改变 handler 的对照状态。 */
      state = {flip: false, count: 0};
      /** 把 flip 设为 true并递增 count，使下一次 commit 选择 B。 */
      flip() {
        this.setState({flip: true, count: this.state.count + 1});
      }
      /** 只递增 count，不改变 flip，用于证明无关状态更新后仍选择 B。 */
      tick() {
        this.setState({count: this.state.count + 1});
      }
      /** 当未 forceA 且 flip=true 时选择 B，否则选择 A，输出同一宿主 div。 */
      render() {
        const useB = !this.props.forceA && this.state.flip;
        return <div onClick={useB ? handlerB : handlerA} />;
      }
    }

    /** 构造器点击先前已提交 DOM、render 返回 null，在另一次 render 尚未 commit 时观察旧 handler。 */
    class Click extends React.Component {
      /** 调用父构造器后同步 node.click，在 forceA 的新 props 发布前触发既有处理器。 */
      constructor() {
        super();
        node.click();
      }
      /** 返回 null，不创建 DOM；此 fixture 的观测动作只在构造器。 */
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

    // 切回 A；第二个组件在 render 中模拟点击，用来观察 A 的新处理器尚未提交时的事件行为。
    await act(() => {
      root.render([<Example key="a" forceA={true} />, <Click key="b" />]);
    });

    // render 阶段的点击仍读取 DOM 上已提交的 props，因此调用旧处理器 B。
    assertLog(['B']);

    // 提交后发生的任何点击,都应该调用A.
    await act(() => {
      click();
    });
    assertLog(['A']);
  });

  /** 渲染 hidden=true 的普通 div 与子 div，断言 hidden 属性和子 DOM 完整存在，验证此宿主属性场景可正常提交；本用例未观察 Offscreen 或任务优先级。 */
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

  /** 空根依次提交 foo、null、bar，逐步断言 DOM 内容与清空，验证根可由空子树再次恢复宿主内容。 */
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

  /** 先正常更新同 key 的 div，再用 innerHTML 外部替换它并提交不同 key；断言旧节点删除时报 NotFoundError，验证 React 保留的宿主引用不会自动接管外部替换节点。 */
  it('should warn when replacing a container which was manually updated outside of React', async () => {
    // 先验证没有外部 DOM 修改时的正常更新。
    await act(() => {
      root.render(<div key="1">foo</div>);
    });
    expect(container.innerHTML).toBe('<div>foo</div>');

    await act(() => {
      root.render(<div key="1">bar</div>);
    });
    expect(container.innerHTML).toBe('<div>bar</div>');

    // 外部替换删除了 React 记录的宿主节点；改变 key 后 React 尝试移除旧节点，会收到 NotFoundError。
    container.innerHTML = '<div>MEOW.</div>';

    await expect(async () => {
      await act(() => {
        ReactDOM.flushSync(() => {
          root.render(<div key="2">baz</div>);
        });
      });
    }).rejects.toThrow('The node to be removed is not a child of this node');
  });

  /** 外部 innerHTML 将已提交 div 换成 MEOW，再提交同类型无 key 变化的 baz；容器仍是 MEOW，验证更新写入脱离容器的旧宿主，不会重新采纳外部 DOM。 */
  it('should not warn when doing an update to a container manually updated outside of React', async () => {
    // 先验证没有外部 DOM 修改时的正常更新。
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
    // 类型与 key 未变，React 更新仍保存在 Fiber 中的旧 DOM 节点；该节点已脱离容器，因此容器内容不变且没有删除错误。
    expect(container.innerHTML).toBe('<div>MEOW.</div>');
  });

  /** 外部清空已提交容器，再提交同类型的 baz；断言容器仍空，验证同类型更新不会自动把已脱离的宿主重新插回。 */
  it('should not warn when doing an update to a container manually cleared outside of React', async () => {
    // 先验证没有外部 DOM 修改时的正常更新。
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
    // 类型与 key 未变，React 更新仍保存在 Fiber 中的旧 DOM 节点；该节点已脱离容器，因此容器内容不变且没有删除错误。
    expect(container.innerHTML).toBe('');
  });

  /** 在 iframe 的独立 document 容器渲染 Hello world，并用 appendChild spy 截获文本节点；断言文本、ownerDocument 为 iframeDocument、追加一次，验证文本创建使用目标容器所属文档。 */
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

  /** 以 DocumentFragment 为根渲染 foo，主 container 起初为空；把 fragment 追加到主容器后出现 div foo，验证 Fragment 容器中的宿主节点可由 DOM 插入转移。 */
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
  /** Child 的 document 捕获 click 监听器在 checkbox 事件前 setState，父受控 checkbox 的 onChange 仍置标志为 true，验证该子树更新场景不吞掉父输入的 change 提取；未直接统计宿主 diff 次数。 */
  it('should not diff memoized host components', async () => {
    const inputRef = React.createRef();
    let didCallOnChange = false;

    /** 挂载后注册 document 捕获 click 以更新自身，卸载时注销；为父受控 checkbox 的 change 提取提供前置子树更新。 */
    class Child extends React.Component {
      /** 空 state 仅用于触发 Child 更新，不控制父 checkbox 的 checked。 */
      state = {};
      /** 挂载时给 document 注册捕获 click→update，使子组件更新发生在根的 checkbox click 处理前。 */
      componentDidMount() {
        document.addEventListener('click', this.update, true);
      }
      /** 卸载时按相同捕获参数移除 document click 回调，释放手动监听器。 */
      componentWillUnmount() {
        document.removeEventListener('click', this.update, true);
      }
      /** document 捕获 click 时提交新的空 state，触发 Child 更新而不改父 input 属性。 */
      update = () => {
        // 验证此 setState() 不会让 React 向外层 input 提交更新；否则会阻止父组件的 onChange 处理器触发。
        this.setState({});
        // 注意：同一组件的 document 手动捕获监听器若先调用 setState()，onChange 一直存在问题，
        // 但该场景很少见；这里验证子组件这样做时不会破坏父组件。
      };
      /** 返回空 div，保证本子组件的状态更新没有新输入属性。 */
      render() {
        return <div />;
      }
    }

    /** 输出 Child 与始终 checked=true 的 checkbox，onChange 标志直接记录 change 提取是否完成。 */
    class Parent extends React.Component {
      /** 接收事件但只设置 didCallOnChange=true，供 checkbox click 后断言监听器已执行。 */
      handleChange = val => {
        didCallOnChange = true;
      };
      /** 返回前置 Child 和受控 checkbox；ref 保存实际 input，checked 始终不变。 */
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

  /** 第二 JSDOM window 中聚焦 a 按钮，点击触发有 key 按钮逆序；断言第二窗口 activeElement 仍是 a，验证提交焦点恢复使用根所在 window。 */
  it('should restore selection in the correct window', async () => {
    // 创建新的 JSDOM 实例以获取第二个窗口 window.open 未实现
    const {window: newWindow} = new JSDOM('');
    // 创建一个新的容器，因为默认清理逻辑期望现有的容器位于文档中。
    const newContainer = newWindow.document.createElement('div');
    newWindow.document.body.appendChild(newContainer);
    root = ReactDOMClient.createRoot(newContainer);

    /** 在第二窗口输出有 key 的 a/b/c 按钮，reverse state 改变数组顺序，供更新后 activeElement 所属窗口与内容断言。 */
    const Test = () => {
      const [reverse, setReverse] = React.useState(false);
      const [items] = React.useState(() => ['a', 'b', 'c']);
      /** 设置 reverse=true，让下一次提交逆序排列按钮；焦点恢复由 DOM commit 路径处理。 */
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
