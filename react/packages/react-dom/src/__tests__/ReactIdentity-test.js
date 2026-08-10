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

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should allow key property to express identity」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should allow key property to express identity', async () => {
    let node;
    /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「should use composite identity」描述的渲染、交互或错误处理结果。 */
  it('should use composite identity', async () => {
    /** `Wrapper`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Wrapper extends React.Component {
      /** `Wrapper.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** `renderAComponentWithKeyIntoContainer`：封装当前用例复用的操作、回调或断言步骤。 */
  async function renderAComponentWithKeyIntoContainer(key, root) {
    /** `renderAComponentWithKeyIntoContainer.Wrapper`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Wrapper extends React.Component {
      /** `Wrapper.spanRef`：记录测试夹具在当前场景中的状态。 */
      spanRef = React.createRef();
      /** `Wrapper.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「should allow any character as a key, in a detached parent」描述的渲染、交互或错误处理结果。 */
  it('should allow any character as a key, in a detached parent', async () => {
    const detachedContainer = document.createElement('div');
    const root = ReactDOMClient.createRoot(detachedContainer);
    await renderAComponentWithKeyIntoContainer("<'WEIRD/&\\key'>", root);
  });

  /** 测试场景：验证「should allow any character as a key, in an attached parent」描述的渲染、交互或错误处理结果。 */
  it('should allow any character as a key, in an attached parent', async () => {
    // 此测试旨在防止使用 DOM 工具（如 getElementById）错误地查询已转义的 ID 的实现细节。
    const attachedContainer = document.createElement('div');
    const root = ReactDOMClient.createRoot(attachedContainer);
    document.body.appendChild(attachedContainer);

    await renderAComponentWithKeyIntoContainer("<'WEIRD/&\\key'>", root);

    document.body.removeChild(attachedContainer);
  });

  /** 测试场景：验证「should not allow scripts in keys to execute」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should let restructured components retain their uniqueness」描述的渲染、交互或错误处理结果。 */
  it('should let restructured components retain their uniqueness', async () => {
    const instance0 = <span />;
    const instance1 = <span />;
    const instance2 = <span />;

    /** `TestComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class TestComponent extends React.Component {
      /** `TestComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

    /** `TestContainer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class TestContainer extends React.Component {
      /** `TestContainer.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「should let nested restructures retain their uniqueness」描述的渲染、交互或错误处理结果。 */
  it('should let nested restructures retain their uniqueness', async () => {
    const instance0 = <span />;
    const instance1 = <span />;
    const instance2 = <span />;

    /** `TestComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class TestComponent extends React.Component {
      /** `TestComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

    /** `TestContainer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class TestContainer extends React.Component {
      /** `TestContainer.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「should let text nodes retain their uniqueness」描述的渲染、交互或错误处理结果。 */
  it('should let text nodes retain their uniqueness', async () => {
    /** `TestComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class TestComponent extends React.Component {
      /** `TestComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            {this.props.children}
            <span />
          </div>
        );
      }
    }

    /** `TestContainer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class TestContainer extends React.Component {
      /** `TestContainer.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「should retain key during updates in composite components」描述的渲染、交互或错误处理结果。 */
  it('should retain key during updates in composite components', async () => {
    /** `TestComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class TestComponent extends React.Component {
      /** `TestComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    /** `TestContainer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class TestContainer extends React.Component {
      /** `TestContainer.state`：记录测试夹具在当前场景中的状态。 */
      state = {swapped: false};

      /** `TestContainer.swap`：封装当前用例复用的操作、回调或断言步骤。 */
      swap = () => {
        this.setState({swapped: true});
      };

      /** `TestContainer.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「should not allow implicit and explicit keys to collide」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should throw if key is a Temporal-like object」描述的渲染、交互或错误处理结果。 */
  it('should throw if key is a Temporal-like object', async () => {
    /** `TemporalLike`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class TemporalLike {
      /** `TemporalLike.valueOf`：实现测试夹具的生命周期、渲染或交互步骤。 */
      valueOf() {
        // 此处抛错符合 ECMAScript “Temporal” 日期/时间 API 的行为。
        // 参见 https://tc39.es/proposal-temporal/docs/plaindate.html#valueOf
        throw new TypeError('prod message');
      }
      /** `TemporalLike.toString`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
