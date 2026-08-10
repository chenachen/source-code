/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment ./scripts/jest/ReactDOMServerIntegrationEnvironment
 */

'use strict';

/** `ReactDOMServerIntegrationUtils`：保存当前测试场景复用的夹具、状态或回调。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let PropTypes;
let React;
let ReactDOMClient;
let ReactDOMServer;
let assertConsoleErrorDev;

/** `initModules`：封装当前用例复用的操作、回调或断言步骤。 */
function initModules() {
  // 重置警告缓存。
  jest.resetModules();
  PropTypes = require('prop-types');
  React = require('react');
  ReactDOMClient = require('react-dom/client');
  ReactDOMServer = require('react-dom/server');
  assertConsoleErrorDev = require('internal-test-utils').assertConsoleErrorDev;

    // 将这些方法暴露给测试辅助函数。
  return {
    ReactDOMClient,
    ReactDOMServer,
  };
}

/** `{ resetModules, itRenders, itThrowsWhenRendering, clientRenderOnBadMarkup, }`：保存当前测试场景复用的夹具、状态或回调。 */
const {
  resetModules,
  itRenders,
  itThrowsWhenRendering,
  clientRenderOnBadMarkup,
} = ReactDOMServerIntegrationUtils(initModules);

describe('ReactDOMServerIntegration', () => {
  beforeEach(() => {
    resetModules();
  });
  afterEach(() => {
    // TODO：这是临时规避方案，因为 expectErrors 不会恢复 mock；彻底修复需要大规模重构这些测试。
    if (console.error.mockClear) {
      console.error.mockRestore();
    }
  });

  describe('legacy context', function () {
    // `itRenders` 测试抽象无法配合 @gate，因此在这里改用显式分支。
    if (gate(flags => flags.disableLegacyContext)) {
      /**
       * 代表场景（Given–When–Then）：
       * Given 当前文件已建立所需 DOM、React 根与测试夹具；
       * When 执行「empty test to stop Jest from being a complainy complainer」描述的渲染或交互；
       * Then 通过本用例的 DOM、日志或调度断言确认行为。
       *
       * 验证机制：断言覆盖 react-dom 的服务端流适配层；完整 Fizz 状态机位于 react-server。
       */
      it('empty test to stop Jest from being a complainy complainer', () => {});
      return;
    }

    let PurpleContext, RedContext;
    beforeEach(() => {
      /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Parent extends React.Component {
        /** `Parent.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
        getChildContext() {
          return {text: this.props.text};
        }
        /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return this.props.children;
        }
      }
      Parent.childContextTypes = {text: PropTypes.string};

      PurpleContext = props => <Parent text="purple">{props.children}</Parent>;
      RedContext = props => <Parent text="red">{props.children}</Parent>;
    });

    itRenders('class child with context', async render => {
      /** `ClassChildWithContext`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class ClassChildWithContext extends React.Component {
        /** `ClassChildWithContext.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <div>{this.context.text}</div>;
        }
      }
      ClassChildWithContext.contextTypes = {text: PropTypes.string};

      const e = await render(
        <PurpleContext>
          <ClassChildWithContext />
        </PurpleContext>,
        2,
      );
      expect(e.textContent).toBe('purple');
    });

    itRenders('stateless child with context', async render => {
      if (gate(flags => flags.disableLegacyContextForFunctionComponents)) {
        return;
      }
      /** `FunctionChildWithContext`：封装当前用例复用的操作、回调或断言步骤。 */
      function FunctionChildWithContext(props, context) {
        return <div>{context.text}</div>;
      }
      FunctionChildWithContext.contextTypes = {text: PropTypes.string};

      const e = await render(
        <PurpleContext>
          <FunctionChildWithContext />
        </PurpleContext>,
        2,
      );
      expect(e.textContent).toBe('purple');
    });

    itRenders('class child without context', async render => {
      /** `ClassChildWithoutContext`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class ClassChildWithoutContext extends React.Component {
        /** `ClassChildWithoutContext.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          // 此组件不会收到 context，因此应渲染为空白。
          return <div>{this.context.text}</div>;
        }
      }

      const e = await render(
        <PurpleContext>
          <ClassChildWithoutContext />
        </PurpleContext>,
        1,
      );
      expect(e.textContent).toBe('');
    });

    itRenders('stateless child without context', async render => {
      if (gate(flags => flags.disableLegacyContextForFunctionComponents)) {
        return;
      }
      /** `FunctionChildWithoutContext`：封装当前用例复用的操作、回调或断言步骤。 */
      function FunctionChildWithoutContext(props, context) {
        // 此组件不会收到 context，因此应渲染为空白。
        return <div>{context.text}</div>;
      }

      const e = await render(
        <PurpleContext>
          <FunctionChildWithoutContext />
        </PurpleContext>,
        1,
      );
      expect(e.textContent).toBe('');
    });

    itRenders('class child with wrong context', async render => {
      /** `ClassChildWithWrongContext`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class ClassChildWithWrongContext extends React.Component {
        /** `ClassChildWithWrongContext.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          // 这应该是空白的; context.text 并没有传递到这个组件.
          return <div id="classWrongChild">{this.context.text}</div>;
        }
      }
      ClassChildWithWrongContext.contextTypes = {foo: PropTypes.string};

      const e = await render(
        <PurpleContext>
          <ClassChildWithWrongContext />
        </PurpleContext>,
        2,
      );
      expect(e.textContent).toBe('');
    });

    itRenders('stateless child with wrong context', async render => {
      if (gate(flags => flags.disableLegacyContextForFunctionComponents)) {
        return;
      }
      /** `FunctionChildWithWrongContext`：封装当前用例复用的操作、回调或断言步骤。 */
      function FunctionChildWithWrongContext(props, context) {
        // 这应该是空白的; context.text 并没有传递到这个组件.
        return <div id="statelessWrongChild">{context.text}</div>;
      }
      FunctionChildWithWrongContext.contextTypes = {
        foo: PropTypes.string,
      };

      const e = await render(
        <PurpleContext>
          <FunctionChildWithWrongContext />
        </PurpleContext>,
        2,
      );
      expect(e.textContent).toBe('');
    });

    itRenders('with context passed through to a grandchild', async render => {
      if (gate(flags => flags.disableLegacyContextForFunctionComponents)) {
        return;
      }
      /** `Grandchild`：封装当前用例复用的操作、回调或断言步骤。 */
      function Grandchild(props, context) {
        return <div>{context.text}</div>;
      }
      Grandchild.contextTypes = {text: PropTypes.string};

      /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
      const Child = props => <Grandchild />;

      const e = await render(
        <PurpleContext>
          <Child />
        </PurpleContext>,
        2,
      );
      expect(e.textContent).toBe('purple');
    });

    itRenders('a child context overriding a parent context', async render => {
      if (gate(flags => flags.disableLegacyContextForFunctionComponents)) {
        return;
      }
      /** `Grandchild`：封装当前用例复用的操作、回调或断言步骤。 */
      const Grandchild = (props, context) => {
        return <div>{context.text}</div>;
      };
      Grandchild.contextTypes = {text: PropTypes.string};

      const e = await render(
        <PurpleContext>
          <RedContext>
            <Grandchild />
          </RedContext>
        </PurpleContext>,
        2,
      );
      expect(e.textContent).toBe('red');
    });

    itRenders('a child context merged with a parent context', async render => {
      if (gate(flags => flags.disableLegacyContextForFunctionComponents)) {
        return;
      }
      /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Parent extends React.Component {
        /** `Parent.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
        getChildContext() {
          return {text1: 'purple'};
        }
        /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <Child />;
        }
      }
      Parent.childContextTypes = {text1: PropTypes.string};

      /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Child extends React.Component {
        /** `Child.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
        getChildContext() {
          return {text2: 'red'};
        }
        /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <Grandchild />;
        }
      }
      Child.childContextTypes = {text2: PropTypes.string};

      /** `Grandchild`：封装当前用例复用的操作、回调或断言步骤。 */
      const Grandchild = (props, context) => {
        return (
          <div>
            <div id="first">{context.text1}</div>
            <div id="second">{context.text2}</div>
          </div>
        );
      };
      Grandchild.contextTypes = {
        text1: PropTypes.string,
        text2: PropTypes.string,
      };

      const e = await render(<Parent />, 3);
      expect(e.querySelector('#first').textContent).toBe('purple');
      expect(e.querySelector('#second').textContent).toBe('red');
    });

    itRenders(
      'with a call to componentWillMount before getChildContext',
      async render => {
        if (gate(flags => flags.disableLegacyContextForFunctionComponents)) {
          return;
        }
        /** `WillMountContext`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
        class WillMountContext extends React.Component {
          /** `WillMountContext.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
          getChildContext() {
            return {text: this.state.text};
          }
          /** `WillMountContext.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
          UNSAFE_componentWillMount() {
            this.setState({text: 'foo'});
          }
          /** `WillMountContext.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
          render() {
            return <Child />;
          }
        }
        WillMountContext.childContextTypes = {text: PropTypes.string};

        /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
        const Child = (props, context) => {
          return <div>{context.text}</div>;
        };
        Child.contextTypes = {text: PropTypes.string};

        const e = await render(<WillMountContext />, 2);
        expect(e.textContent).toBe('foo');
      },
    );

    itRenders(
      'if getChildContext exists but childContextTypes is missing with a warning',
      async render => {
        if (gate(flags => flags.disableLegacyContextForFunctionComponents)) {
          return;
        }
        /** `HopefulChild`：封装当前用例复用的操作、回调或断言步骤。 */
        function HopefulChild(props, context) {
          return context.foo || 'nope';
        }
        HopefulChild.contextTypes = {
          foo: PropTypes.string,
        };
        /** `ForgetfulParent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
        class ForgetfulParent extends React.Component {
          /** `ForgetfulParent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
          render() {
            return <HopefulChild />;
          }
          /** `ForgetfulParent.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
          getChildContext() {
            return {foo: 'bar'};
          }
        }
        const e = await render(
          <ForgetfulParent />,
          // 某条警告未被去重，因此会在客户端重试渲染时再次记录。
          render === clientRenderOnBadMarkup ? 3 : 2,
        );
        expect(e.textContent).toBe('nope');
      },
    );

    itThrowsWhenRendering(
      'if getChildContext returns a value not in childContextTypes',
      render => {
        /** `MyComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
        class MyComponent extends React.Component {
          /** `MyComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
          render() {
            return <div />;
          }
          /** `MyComponent.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
          getChildContext() {
            return {value1: 'foo', value2: 'bar'};
          }
        }
        MyComponent.childContextTypes = {value1: PropTypes.string};
        return render(<MyComponent />);
      },
      'MyComponent.getChildContext(): key "value2" is not defined in childContextTypes.',
    );

    /** 测试场景：验证「warns when childContextTypes is not defined」描述的渲染、交互或错误处理结果。 */
    it('warns when childContextTypes is not defined', () => {
      /** `MyComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class MyComponent extends React.Component {
        /** `MyComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <div />;
        }
        /** `MyComponent.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
        getChildContext() {
          return {value1: 'foo', value2: 'bar'};
        }
      }

      ReactDOMServer.renderToString(<MyComponent />);
      assertConsoleErrorDev([
        'MyComponent.getChildContext(): childContextTypes must be defined in order to use getChildContext().\n' +
          '    in MyComponent (at **)',
      ]);
    });
  });
});
