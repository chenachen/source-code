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

/** 载入五模式旧Context与错误渲染helper，legacy开关由suite/各case显式控制。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let PropTypes;
let React;
let ReactDOMClient;
let ReactDOMServer;
let assertConsoleErrorDev;

/** 重置模块、加载PropTypes/React两DOM入口及诊断断言，返回helper当前入口。 */
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

/** 取得五模式、错误匹配和badMarkup身份，用模式差异决定诊断预算。 */
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
      /** disableLegacyContext开启时只注册并执行空占位it后整组返回，无渲染或断言；目的为Jest保留至少一个测试，不能当legacy行为验证。 */
      it('empty test to stop Jest from being a complainy complainer', () => {});
      return;
    }

    let PurpleContext, RedContext;
    beforeEach(() => {
      /** 旧Context提供器，以text prop构造声明过的text字段。 */
      class Parent extends React.Component {
        /** 返回text供旧上下文合并；childContextTypes定义在类外。 */
        getChildContext() {
          return {text: this.props.text};
        }
        /** 直接返回children，不增加宿主节点。 */
        render() {
          return this.props.children;
        }
      }
      Parent.childContextTypes = {text: PropTypes.string};

      /** 固定旧Provider text=purple，供继承/覆盖测试。 */
      PurpleContext = props => <Parent text="purple">{props.children}</Parent>;
      /** 固定旧Provider text=red，供嵌套覆盖测试。 */
      RedContext = props => <Parent text="red">{props.children}</Parent>;
    });

    /** legacy Context启用时，Parent提供text=purple，类子级声明text contextTypes；五模式文字purple，预期两条legacy诊断，验证声明过滤与传递。 */
    itRenders('class child with context', async render => {
      /** 声明contextTypes.text的类子级，读取旧上下文。 */
      class ClassChildWithContext extends React.Component {
        /** 输出this.context.text，验证声明字段注入。 */
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

    /** 若函数legacy Context禁用则直接返回；否则函数第二参数context声明text，五模式purple并预期两条诊断，验证函数旧Context。 */
    itRenders('stateless child with context', async render => {
      if (gate(flags => flags.disableLegacyContextForFunctionComponents)) {
        return;
      }
      /** 使用函数第二参数context的旧消费者，只有函数legacy未禁用才运行。 */
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

    /** Parent提供text但类子级无contextTypes；五模式文字空、仅父诊断，验证未声明字段不注入。 */
    itRenders('class child without context', async render => {
      /** 未声明contextTypes的类，读text应undefined。 */
      class ClassChildWithoutContext extends React.Component {
        /** 将被过滤掉的text放div，最终空文字。 */
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

    /** 函数legacy Context禁用时不执行渲染；启用时子函数无contextTypes，五模式文字空，验证函数上下文按声明过滤。 */
    itRenders('stateless child without context', async render => {
      if (gate(flags => flags.disableLegacyContextForFunctionComponents)) {
        return;
      }
      /** 未声明contextTypes的函数，context.text不注入。 */
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

    /** 类子级只声明foo却读取text；五模式空并预期两诊断，验证错字段不能越过contextTypes。 */
    itRenders('class child with wrong context', async render => {
      /** 类仅声明foo却读取text，制造字段声明不匹配。 */
      class ClassChildWithWrongContext extends React.Component {
        /** 输出未声明text，预期为空而非purple。 */
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

    /** 函数legacy Context禁用则返回；否则只声明foo却读text，五模式空，验证函数声明也过滤未声明键。 */
    itRenders('stateless child with wrong context', async render => {
      if (gate(flags => flags.disableLegacyContextForFunctionComponents)) {
        return;
      }
      /** 函数仅声明foo却读text，用第二参数检查过滤。 */
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

    /** 函数legacy Context启用时，未声明的中间Child透传到声明text的Grandchild；五模式purple，验证中间不消费也传播上下文。 */
    itRenders('with context passed through to a grandchild', async render => {
      if (gate(flags => flags.disableLegacyContextForFunctionComponents)) {
        return;
      }
      /** 声明text的孙函数，经过未消费中间Child读取purple。 */
      function Grandchild(props, context) {
        return <div>{context.text}</div>;
      }
      Grandchild.contextTypes = {text: PropTypes.string};

      /** 中间函数不声明contextTypes，只返回Grandchild，旧上下文仍向下传播。 */
      const Child = props => <Grandchild />;

      const e = await render(
        <PurpleContext>
          <Child />
        </PurpleContext>,
        2,
      );
      expect(e.textContent).toBe('purple');
    });

    /** 函数legacy Context启用时，Purple外层、Red内层提供同text；Grandchild五模式red，验证最近旧Provider覆盖同名字段。 */
    itRenders('a child context overriding a parent context', async render => {
      if (gate(flags => flags.disableLegacyContextForFunctionComponents)) {
        return;
      }
      /** 声明text的孙函数，读取Red覆盖后的最近值。 */
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

    /** 函数legacy Context启用时，Parent提供text1=purple、Child提供text2=red，Grandchild声明两字段；五模式分别purple/red并预期三诊断，验证旧Context合并而非整体替换。 */
    itRenders('a child context merged with a parent context', async render => {
      if (gate(flags => flags.disableLegacyContextForFunctionComponents)) {
        return;
      }
      /** 提供text1的旧父类，与子类的text2合并。 */
      class Parent extends React.Component {
        /** 返回text1=purple，不包含text2。 */
        getChildContext() {
          return {text1: 'purple'};
        }
        /** 输出提供text2的Child，不引入额外DOM。 */
        render() {
          return <Child />;
        }
      }
      Parent.childContextTypes = {text1: PropTypes.string};

      /** 子Provider仅提供text2，父text1应保留。 */
      class Child extends React.Component {
        /** 返回text2=red，由renderer合并到父Context。 */
        getChildContext() {
          return {text2: 'red'};
        }
        /** 返回同时读取两字段的Grandchild。 */
        render() {
          return <Grandchild />;
        }
      }
      Child.childContextTypes = {text2: PropTypes.string};

      /** 通过函数context第二参数输出text1/text2到两个id。 */
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

    /** 函数legacy Context启用时，WillMountContext先setState(text=foo)再getChildContext读state；五模式foo，验证挂载前状态更新早于提供上下文。 */
    itRenders(
      'with a call to componentWillMount before getChildContext',
      async render => {
        if (gate(flags => flags.disableLegacyContextForFunctionComponents)) {
          return;
        }
        /** 挂载前更新state后从getChildContext提供值的类。 */
        class WillMountContext extends React.Component {
          /** 读取已被willMount更新的state.text，提供foo。 */
          getChildContext() {
            return {text: this.state.text};
          }
          /** setState text=foo，验证SSR也处理当前挂载实例的状态队列。 */
          UNSAFE_componentWillMount() {
            this.setState({text: 'foo'});
          }
          /** 返回声明text的Child，检查上下文更新顺序。 */
          render() {
            return <Child />;
          }
        }
        WillMountContext.childContextTypes = {text: PropTypes.string};

        /** 读声明后的context.text并输出foo。 */
        const Child = (props, context) => {
          return <div>{context.text}</div>;
        };
        Child.contextTypes = {text: PropTypes.string};

        const e = await render(<WillMountContext />, 2);
        expect(e.textContent).toBe('foo');
      },
    );

    /** 函数legacy Context启用时，ForgetfulParent有getChildContext但无childContextTypes；HopefulChild读foo为空而返回nope，五模式nope，badMarkup多一次诊断预算，验证缺失声明使提供器失效。 */
    itRenders(
      'if getChildContext exists but childContextTypes is missing with a warning',
      async render => {
        if (gate(flags => flags.disableLegacyContextForFunctionComponents)) {
          return;
        }
        /** 声明foo的函数消费者，未收到时返回nope。 */
        function HopefulChild(props, context) {
          return context.foo || 'nope';
        }
        HopefulChild.contextTypes = {
          foo: PropTypes.string,
        };
        /** 故意缺childContextTypes但有getChildContext，验证提供器诊断与失效。 */
        class ForgetfulParent extends React.Component {
          /** 返回HopefulChild，让输出暴露foo未注入。 */
          render() {
            return <HopefulChild />;
          }
          /** 返回foo=bar但因缺类声明不能成为有效旧Provider。 */
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

    /** legacy启用时MyComponent返回value1/value2却只声明value1；渲染错误helper按各适用模式拒绝并匹配未声明value2消息，验证Provider输出校验。 */
    itThrowsWhenRendering(
      'if getChildContext returns a value not in childContextTypes',
      render => {
        /** 声明只含value1却提供两个值，制造未声明键错误。 */
        class MyComponent extends React.Component {
          /** 返回空div，错误应来自Context校验而非宿主内容。 */
          render() {
            return <div />;
          }
          /** 返回value1/value2，让value2与childContextTypes不一致。 */
          getChildContext() {
            return {value1: 'foo', value2: 'bar'};
          }
        }
        MyComponent.childContextTypes = {value1: PropTypes.string};
        return render(<MyComponent />);
      },
      'MyComponent.getChildContext(): key "value2" is not defined in childContextTypes.',
    );

    /** 同步SSR的MyComponent有getChildContext但无childContextTypes；DEV诊断必须声明且含组件栈，验证缺失Provider声明的独立错误提示。 */
    it('warns when childContextTypes is not defined', () => {
      /** 未声明childContextTypes的同步SSR诊断fixture。 */
      class MyComponent extends React.Component {
        /** 返回空div，使测试只检查Provider诊断。 */
        render() {
          return <div />;
        }
        /** 提供两个值但缺类型声明，renderer应警告而忽略旧Context。 */
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
