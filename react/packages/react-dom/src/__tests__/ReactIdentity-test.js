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
let ReactDOMClient;
let act;
let assertConsoleErrorDev;

describe('ReactIdentity', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
  });

  /** 两个同类型div按apple/banana key排列，再swap调换位置；旧DOM对象分别等于新的反向位置对象，验证key控制复用身份而非数组下标。 */
  it('should allow key property to express identity', async () => {
    let node;
    /** 依据swap生成apple/banana互换key的两个div，并通过ref返回父DOM供身份比较。 */
    const Component = props => (
      <div ref={c => (node = c)}>
        <div key={props.swap ? 'banana' : 'apple'} />
        <div key={props.swap ? 'apple' : 'banana'} />
      </div>
    );

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<Component />);
    });
    const origChildren = Array.from(node.childNodes);
    await act(async () => {
      root.render(<Component swap={true} />);
    });
    const newChildren = Array.from(node.childNodes);
    expect(origChildren[0]).toBe(newChildren[1]);
    expect(origChildren[1]).toBe(newChildren[0]);
  });

  /** Wrapper key由wrap1改wrap2、内部span类型不变；前后span对象不同，验证复合组件身份变化会重建其子树。 */
  it('should use composite identity', async () => {
    /** 用a包住children的类组件，外层key变化作为重建边界。 */
    class Wrapper extends React.Component {
      /** 透传span到a，保持宿主形状相同以隔离Wrapper key改变的影响。 */
      render() {
        return <a>{this.props.children}</a>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let node1;
    let node2;
    await act(async () => {
      root.render(
        <Wrapper key="wrap1">
          <span ref={c => (node1 = c)} />
        </Wrapper>,
      );
    });
    await act(async () => {
      root.render(
        <Wrapper key="wrap2">
          <span ref={c => (node2 = c)} />
        </Wrapper>,
      );
    });
    expect(node1).not.toBe(node2);
  });

  /** 在给定根挂载本调用创建的Wrapper，把传入任意key用于span；act后断言span ref存在。不比较跨调用复用，主要验证特殊key可挂载。 */
  async function renderAComponentWithKeyIntoContainer(key, root) {
    /** 此工具局部类给span持有ref，并闭包使用调用参数key。 */
    class Wrapper extends React.Component {
      /** 记录目标span DOM，避免按key构造DOM ID或选择器。 */
      spanRef = React.createRef();
      /** 输出带传入key的span，渲染完成后由工具直接检查ref。 */
      render() {
        return (
          <div>
            <span ref={this.spanRef} key={key} />
          </div>
        );
      }
    }
    const wrapperRef = React.createRef();
    await act(async () => {
      root.render(<Wrapper ref={wrapperRef} />);
    });
    const span = wrapperRef.current.spanRef.current;
    expect(span).not.toBe(null);
  }

  /** 未挂body的容器中span key含尖括号、引号、斜杠和反斜杠；ref非null且渲染完成，验证key字符不用于不安全DOM查找。 */
  it('should allow any character as a key, in a detached parent', async () => {
    const detachedContainer = document.createElement('div');
    const root = ReactDOMClient.createRoot(detachedContainer);
    await renderAComponentWithKeyIntoContainer("<'WEIRD/&\\key'>", root);
  });

  /** 已挂body容器使用相同特殊字符key；ref非null且随后移除容器，验证附着DOM下也不依赖key拼接选择器。 */
  it('should allow any character as a key, in an attached parent', async () => {
    // 此测试旨在防止使用 DOM 工具（如 getElementById）错误地查询已转义的 ID 的实现细节。
    const attachedContainer = document.createElement('div');
    const root = ReactDOMClient.createRoot(attachedContainer);
    document.body.appendChild(attachedContainer);

    await renderAComponentWithKeyIntoContainer("<'WEIRD/&\\key'>", root);

    document.body.removeChild(attachedContainer);
  });

  /** key字符串含完整script注入片段；挂body渲染后window.YOUVEBEENH4X0RED仍undefined，验证key不成为可执行HTML。 */
  it('should not allow scripts in keys to execute', async () => {
    const h4x0rKey =
      '"><script>window[\'YOUVEBEENH4X0RED\']=true;</script><div id="';

    const attachedContainer = document.createElement('div');
    const root = ReactDOMClient.createRoot(attachedContainer);
    document.body.appendChild(attachedContainer);

    await renderAComponentWithKeyIntoContainer(h4x0rKey, root);

    document.body.removeChild(attachedContainer);

    // 一旦我们到达这里，确保我们没有执行代码。
    expect(window.YOUVEBEENH4X0RED).toBe(undefined);
  });

  /** 三个span元素由TestComponent把自身instance2与传入children重排为一个div子树；act不抛错，验证重组children不会产生身份冲突；没有DOM复用断言。 */
  it('should let restructured components retain their uniqueness', async () => {
    const instance0 = <span />;
    const instance1 = <span />;
    const instance2 = <span />;

    /** 把自身instance2插入传入两元素之前，构造一次children重组。 */
    class TestComponent extends React.Component {
      /** 在div中排列instance2、children[0]/[1]，原元素对象无需复制。 */
      render() {
        return (
          <div>
            {instance2}
            {this.props.children[0]}
            {this.props.children[1]}
          </div>
        );
      }
    }

    /** 把instance0/1作为两children交给重组fixture。 */
    class TestContainer extends React.Component {
      /** 输出TestComponent，验证元素从父props移入新容器不会冲突。 */
      render() {
        return (
          <TestComponent>
            {instance0}
            {instance1}
          </TestComponent>
        );
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(<TestContainer />);
      }),
    ).resolves.not.toThrow();
  });

  /** 相同元素重组再包一层div；act不抛错，验证嵌套包装仍不冲突。 */
  it('should let nested restructures retain their uniqueness', async () => {
    const instance0 = <span />;
    const instance1 = <span />;
    const instance2 = <span />;

    /** 嵌套重组fixture，仍把instance2置于传入两元素前。 */
    class TestComponent extends React.Component {
      /** 重排共享元素对象到div，不修改元素key。 */
      render() {
        return (
          <div>
            {instance2}
            {this.props.children[0]}
            {this.props.children[1]}
          </div>
        );
      }
    }

    /** 多套一层div的传入组件，增加复合层级。 */
    class TestContainer extends React.Component {
      /** 外层div包含TestComponent并传入instance0/1，测试嵌套重组。 */
      render() {
        return (
          <div>
            <TestComponent>
              {instance0}
              {instance1}
            </TestComponent>
          </div>
        );
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(<TestContainer />);
      }),
    ).resolves.not.toThrow();
  });

  /** TestComponent透传div和文本second并追加span；act不抛错，验证文字与重组元素共存时无身份冲突。 */
  it('should let text nodes retain their uniqueness', async () => {
    /** 透传包含元素和文本的children，再追加span。 */
    class TestComponent extends React.Component {
      /** 输出children与span，检查文字在重组中不引发冲突。 */
      render() {
        return (
          <div>
            {this.props.children}
            <span />
          </div>
        );
      }
    }

    /** 给TestComponent传入div和second文字的类包装。 */
    class TestContainer extends React.Component {
      /** 固定混合children输入，让测试只检查成功渲染。 */
      render() {
        return (
          <TestComponent>
            <div />
            {'second'}
          </TestComponent>
        );
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(<TestContainer />);
      }),
    ).resolves.not.toThrow();
  });

  /** TestContainer透传带A/B显式key的span，setState交换children；前后A/B DOM身份各自保持，验证经过复合包装仍保留key。 */
  it('should retain key during updates in composite components', async () => {
    /** 透传有key子级的复合包装，不重建或剥离元素。 */
    class TestComponent extends React.Component {
      /** 输出包裹children的div，DOM身份从此容器直接取得。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    /** 持有swapped状态并交换两个已有带key元素的类fixture。 */
    class TestContainer extends React.Component {
      /** 初始false使first在前；swap只改变顺序而不改变元素对象。 */
      state = {swapped: false};

      /** 把swapped设true触发更新，让key身份与位置解耦。 */
      swap = () => {
        this.setState({swapped: true});
      };

      /** 依据swapped选择first/second前后次序并交给TestComponent。 */
      render() {
        return (
          <TestComponent>
            {this.state.swapped ? this.props.second : this.props.first}
            {this.state.swapped ? this.props.first : this.props.second}
          </TestComponent>
        );
      }
    }

    const instance0 = <span key="A" />;
    const instance1 = <span key="B" />;

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const wrappedRef = React.createRef();
    await act(async () => {
      root.render(
        <TestContainer first={instance0} second={instance1} ref={wrappedRef} />,
      );
    });
    const div = container.firstChild;

    const beforeA = div.firstChild;
    const beforeB = div.lastChild;
    await act(async () => {
      wrappedRef.current.swap();
    });
    const afterA = div.lastChild;
    const afterB = div.firstChild;

    expect(beforeA).toBe(afterA);
    expect(beforeB).toBe(afterB);
  });

  /** 同一div中首span无key、次span显式key=0；act不抛错，验证隐式索引key不与用户字符串key碰撞。 */
  it('should not allow implicit and explicit keys to collide', async () => {
    const component = (
      <div>
        <span />
        <span key="0" />
      </div>
    );

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(component);
      }),
    ).resolves.not.toThrow();
  });

  /** TemporalLike.valueOf抛TypeError而toString能返回日期，作为span.key在root.render回调中创建元素；同步抛原TypeError并DEV给类型诊断，验证key使用默认强制转换而非显式toString。 */
  it('should throw if key is a Temporal-like object', async () => {
    /** 模拟默认转换抛错但显式toString可用的Temporal对象，作为key输入。 */
    class TemporalLike {
      /** 默认原始值转换抛原TypeError，用于确认key不是直接调用toString。 */
      valueOf() {
        // 此处抛错符合 ECMAScript “Temporal” 日期/时间 API 的行为。
        // 参见 https://tc39.es/proposal-temporal/docs/plaindate.html#valueOf
        throw new TypeError('prod message');
      }
      /** 显式toString返回日期，但本用例key默认转换先触发valueOf。 */
      toString() {
        return '2020-01-01';
      }
    }

    const el = document.createElement('div');
    const root = ReactDOMClient.createRoot(el);
    await expect(() => {
      root.render(
        <div>
          <span key={new TemporalLike()} />
        </div>,
      );
    }).toThrowError(new TypeError('prod message'));
    assertConsoleErrorDev([
      'The provided key is an unsupported type TemporalLike.' +
        ' This value must be coerced to a string before using it here.',
    ]);
  });
});
