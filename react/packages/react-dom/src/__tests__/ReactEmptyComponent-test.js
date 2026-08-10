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
let findDOMNode;
let ReactDOMClient;
let TogglingComponent;
let act;
let Scheduler;
let assertLog;
let assertConsoleErrorDev;

let container;

describe('ReactEmptyComponent', () => {
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    findDOMNode =
      ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
        .findDOMNode;
    Scheduler = require('scheduler');
    const InternalTestUtils = require('internal-test-utils');
    act = InternalTestUtils.act;
    assertLog = InternalTestUtils.assertLog;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;

    container = document.createElement('div');

    TogglingComponent = class extends React.Component {
      /** `state`：记录测试夹具在当前场景中的状态。 */
      state = {component: this.props.firstComponent};

      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        Scheduler.log('mount ' + findDOMNode(this)?.nodeName);
        this.setState({component: this.props.secondComponent});
      }

      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        Scheduler.log('update ' + findDOMNode(this)?.nodeName);
      }

      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        const Component = this.state.component;
        return Component ? <Component /> : null;
      }
    };
  });

  describe.each([null, undefined])('when %s', nullORUndefined => {
    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「should not throw when rendering」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
     */
    it('should not throw when rendering', () => {
      /** `EmptyComponent`：封装当前用例复用的操作、回调或断言步骤。 */
      function EmptyComponent() {
        return nullORUndefined;
      }

      const root = ReactDOMClient.createRoot(container);

      expect(() => {
        ReactDOM.flushSync(() => {
          root.render(<EmptyComponent />);
        });
      }).not.toThrowError();
    });

    /** 测试场景：验证「should not produce child DOM nodes for nullish and false」描述的渲染、交互或错误处理结果。 */
    it('should not produce child DOM nodes for nullish and false', async () => {
      /** `Component1`：封装当前用例复用的操作、回调或断言步骤。 */
      function Component1() {
        return nullORUndefined;
      }

      /** `Component2`：封装当前用例复用的操作、回调或断言步骤。 */
      function Component2() {
        return false;
      }

      const container1 = document.createElement('div');
      const root1 = ReactDOMClient.createRoot(container1);
      await act(() => {
        root1.render(<Component1 />);
      });
      expect(container1.children.length).toBe(0);

      const container2 = document.createElement('div');
      const root2 = ReactDOMClient.createRoot(container2);
      await act(() => {
        root2.render(<Component2 />);
      });
      expect(container2.children.length).toBe(0);
    });

    /** 测试场景：验证「should be able to switch between rendering nullish and a normal tag」描述的渲染、交互或错误处理结果。 */
    it('should be able to switch between rendering nullish and a normal tag', async () => {
      const instance1 = (
        <TogglingComponent
          firstComponent={nullORUndefined}
          secondComponent={'div'}
        />
      );
      const instance2 = (
        <TogglingComponent
          firstComponent={'div'}
          secondComponent={nullORUndefined}
        />
      );

      const container2 = document.createElement('div');
      const root1 = ReactDOMClient.createRoot(container);
      await act(() => {
        root1.render(instance1);
      });

      assertLog(['mount undefined', 'update DIV']);

      const root2 = ReactDOMClient.createRoot(container2);
      await act(() => {
        root2.render(instance2);
      });

      assertLog(['mount DIV', 'update undefined']);
    });

    /** 测试场景：验证「should be able to switch in a list of children」描述的渲染、交互或错误处理结果。 */
    it('should be able to switch in a list of children', async () => {
      const instance1 = (
        <TogglingComponent
          firstComponent={nullORUndefined}
          secondComponent={'div'}
        />
      );

      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div>
            {instance1}
            {instance1}
            {instance1}
          </div>,
        );
      });

      assertLog([
        'mount undefined',
        'mount undefined',
        'mount undefined',
        'update DIV',
        'update DIV',
        'update DIV',
      ]);
    });

    /** 测试场景：验证「should distinguish between a script placeholder and an actual script tag」描述的渲染、交互或错误处理结果。 */
    it('should distinguish between a script placeholder and an actual script tag', () => {
      const instance1 = (
        <TogglingComponent
          firstComponent={nullORUndefined}
          secondComponent={'script'}
        />
      );
      const instance2 = (
        <TogglingComponent
          firstComponent={'script'}
          secondComponent={nullORUndefined}
        />
      );

      const root1 = ReactDOMClient.createRoot(container);
      expect(() => {
        ReactDOM.flushSync(() => {
          root1.render(instance1);
        });
      }).not.toThrow();

      expect(container.innerHTML).toBe('<script></script>');
      if (gate('enableTrustedTypesIntegration')) {
        assertConsoleErrorDev([
          'Encountered a script tag while rendering React component. ' +
            'Scripts inside React components are never executed when rendering on the client. ' +
            'Consider using template tag instead (https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template).\n' +
            '     in script (at **)\n' +
            '     in TogglingComponent (at **)',
        ]);
      }

      const container2 = document.createElement('div');
      const root2 = ReactDOMClient.createRoot(container2);
      expect(() => {
        ReactDOM.flushSync(() => {
          root2.render(instance2);
        });
      }).not.toThrow();

      assertLog([
        'mount undefined',
        'update SCRIPT',
        'mount SCRIPT',
        'update undefined',
      ]);
      expect(container2.innerHTML).toBe('');
    });

    /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
    it(
      'should have findDOMNode return null when multiple layers of composite ' +
        'components render to the same nullish placeholder',
      () => {
        /** `GrandChild`：封装当前用例复用的操作、回调或断言步骤。 */
        function GrandChild() {
          return nullORUndefined;
        }

        /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
        function Child() {
          return <GrandChild />;
        }

        const instance1 = (
          <TogglingComponent firstComponent={'div'} secondComponent={Child} />
        );
        const instance2 = (
          <TogglingComponent firstComponent={Child} secondComponent={'div'} />
        );

        const root1 = ReactDOMClient.createRoot(container);
        expect(() => {
          ReactDOM.flushSync(() => {
            root1.render(instance1);
          });
        }).not.toThrow();

        const container2 = document.createElement('div');
        const root2 = ReactDOMClient.createRoot(container2);
        expect(() => {
          ReactDOM.flushSync(() => {
            root2.render(instance2);
          });
        }).not.toThrow();

        assertLog([
          'mount DIV',
          'update undefined',
          'mount undefined',
          'update DIV',
        ]);
      },
    );

    /** 测试场景：验证「works when switching components」描述的渲染、交互或错误处理结果。 */
    it('works when switching components', async () => {
      let innerRef;

      /** `Inner`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Inner extends React.Component {
        /** `Inner.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <span />;
        }

        /** `Inner.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
        componentDidMount() {
          // 确保 DOM 节点即使在我们替换 `null` 组件时也能正确解析。
          expect(findDOMNode(this)).not.toBe(null);
        }

        /** `Inner.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
        componentWillUnmount() {
          // 虽然当前组件将被 `null` 替换，但此刻替换尚未发生。
          expect(findDOMNode(this)).not.toBe(null);
        }
      }

      /** `Wrapper`：封装当前用例复用的操作、回调或断言步骤。 */
      function Wrapper({showInner}) {
        innerRef = React.createRef(null);
        return showInner ? <Inner ref={innerRef} /> : nullORUndefined;
      }

      const el = document.createElement('div');

      // 渲染 <Inner /> 组件...
      const root = ReactDOMClient.createRoot(el);
      await act(() => {
        root.render(<Wrapper showInner={true} />);
      });
      expect(innerRef.current).not.toBe(null);

      // 切换到 null...
      await act(() => {
        root.render(<Wrapper showInner={false} />);
      });
      expect(innerRef.current).toBe(null);

      // ……然后再切换回来。
      await act(() => {
        root.render(<Wrapper showInner={true} />);
      });
      expect(innerRef.current).not.toBe(null);

      expect.assertions(6);
    });

    /** 测试场景：验证「can render nullish at the top level」描述的渲染、交互或错误处理结果。 */
    it('can render nullish at the top level', async () => {
      const div = document.createElement('div');
      const root = ReactDOMClient.createRoot(div);

      await act(() => {
        root.render(nullORUndefined);
      });
      expect(div.innerHTML).toBe('');
    });

    /** 测试场景：验证「does not break when updating during mount」描述的渲染、交互或错误处理结果。 */
    it('does not break when updating during mount', () => {
      /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Child extends React.Component {
        /** `Child.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
        componentDidMount() {
          if (this.props.onMount) {
            this.props.onMount();
          }
        }

        /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          if (!this.props.visible) {
            return nullORUndefined;
          }

          return <div>hello world</div>;
        }
      }

      /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Parent extends React.Component {
        /** `Parent.update`：封装当前用例复用的操作、回调或断言步骤。 */
        update = () => {
          this.forceUpdate();
        };

        /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return (
            <div>
              <Child key="1" visible={false} />
              <Child key="0" visible={true} onMount={this.update} />
              <Child key="2" visible={false} />
            </div>
          );
        }
      }

      const root = ReactDOMClient.createRoot(container);
      expect(() => {
        ReactDOM.flushSync(() => {
          root.render(<Parent />);
        });
      }).not.toThrow();
    });

    /** 测试场景：验证「preserves the dom node during updates」描述的渲染、交互或错误处理结果。 */
    it('preserves the dom node during updates', async () => {
      /** `Empty`：封装当前用例复用的操作、回调或断言步骤。 */
      function Empty() {
        return nullORUndefined;
      }

      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Empty />);
      });
      const noscript1 = container.firstChild;
      expect(noscript1).toBe(null);

      // 这次更新不应创建 DOM 节点。
      await act(() => {
        root.render(<Empty />);
      });
      const noscript2 = container.firstChild;
      expect(noscript2).toBe(null);
    });

    /** 测试场景：验证「should not warn about React.forwardRef that returns nullish」描述的渲染、交互或错误处理结果。 */
    it('should not warn about React.forwardRef that returns nullish', () => {
      /** `Empty`：封装当前用例复用的操作、回调或断言步骤。 */
      const Empty = () => {
        return nullORUndefined;
      };
      const EmptyForwardRef = React.forwardRef(Empty);

      const root = ReactDOMClient.createRoot(container);
      expect(() => {
        ReactDOM.flushSync(() => {
          root.render(<EmptyForwardRef />);
        });
      }).not.toThrowError();
    });

    /** 测试场景：验证「should not warn about React.memo that returns nullish」描述的渲染、交互或错误处理结果。 */
    it('should not warn about React.memo that returns nullish', () => {
      /** `Empty`：封装当前用例复用的操作、回调或断言步骤。 */
      const Empty = () => {
        return nullORUndefined;
      };
      const EmptyMemo = React.memo(Empty);

      const root = ReactDOMClient.createRoot(container);
      expect(() => {
        ReactDOM.flushSync(() => {
          root.render(<EmptyMemo />);
        });
      }).not.toThrowError();
    });
  });
});
