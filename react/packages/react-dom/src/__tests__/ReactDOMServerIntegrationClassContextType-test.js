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

let React;
let ReactDOMClient;
let ReactDOMServer;

/** `initModules`：封装当前用例复用的操作、回调或断言步骤。 */
function initModules() {
  // 重置警告缓存。
  jest.resetModules();
  React = require('react');
  ReactDOMClient = require('react-dom/client');
  ReactDOMServer = require('react-dom/server');

    // 将这些方法暴露给测试辅助函数。
  return {
    ReactDOMClient,
    ReactDOMServer,
  };
}

/** `{resetModules, itRenders}`：保存当前测试场景复用的夹具、状态或回调。 */
const {resetModules, itRenders} = ReactDOMServerIntegrationUtils(initModules);

describe('ReactDOMServerIntegration', () => {
  beforeEach(() => {
    resetModules();
  });

  describe('class contextType', function () {
    let PurpleContext, RedContext, Context;
    beforeEach(() => {
      Context = React.createContext('none');

      /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Parent extends React.Component {
        /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return (
            <Context.Provider value={this.props.text}>
              {this.props.children}
            </Context.Provider>
          );
        }
      }
      PurpleContext = props => <Parent text="purple">{props.children}</Parent>;
      RedContext = props => <Parent text="red">{props.children}</Parent>;
    });

    /**
     * 代表场景（Given–When–Then）：
     * Given `itRenders` 在服务端、客户端与 hydration 模式中复用同一 Context fixture；
     * When class 子组件通过 contextType 读取上下文；
     * Then 断言各模式输出一致的上下文内容。
     *
     * 验证机制：集成工具串联 react-dom server/client 公开适配边界并比较 DOM；完整 Fizz 状态机位于
     * 范围外的 `packages/react-server`。
     */
    itRenders('class child with context', async render => {
      /** `ClassChildWithContext`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class ClassChildWithContext extends React.Component {
        /** `ClassChildWithContext.contextType`：记录测试夹具在当前场景中的状态。 */
        static contextType = Context;
        /** `ClassChildWithContext.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          const text = this.context;
          return <div>{text}</div>;
        }
      }

      const e = await render(
        <PurpleContext>
          <ClassChildWithContext />
        </PurpleContext>,
      );
      expect(e.textContent).toBe('purple');
    });

    itRenders('class child without context', async render => {
      /** `ClassChildWithoutContext`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class ClassChildWithoutContext extends React.Component {
        /** `ClassChildWithoutContext.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          // 此组件不会收到 context，因此应渲染为空白。
          return (
            <div>{typeof this.context === 'string' ? this.context : ''}</div>
          );
        }
      }

      const e = await render(
        <PurpleContext>
          <ClassChildWithoutContext />
        </PurpleContext>,
      );
      expect(e.textContent).toBe('');
    });

    itRenders('class child with wrong context', async render => {
      /** `ClassChildWithWrongContext`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class ClassChildWithWrongContext extends React.Component {
        /** `ClassChildWithWrongContext.contextType`：记录测试夹具在当前场景中的状态。 */
        static contextType = Context;
        /** `ClassChildWithWrongContext.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          // 这应该是空白的; context.foo 并没有传递到这个组件.
          return <div id="classWrongChild">{this.context.foo}</div>;
        }
      }

      const e = await render(
        <PurpleContext>
          <ClassChildWithWrongContext />
        </PurpleContext>,
      );
      expect(e.textContent).toBe('');
    });

    itRenders('with context passed through to a grandchild', async render => {
      /** `Grandchild`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Grandchild extends React.Component {
        /** `Grandchild.contextType`：记录测试夹具在当前场景中的状态。 */
        static contextType = Context;
        /** `Grandchild.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <div>{this.context}</div>;
        }
      }

      /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
      const Child = props => <Grandchild />;

      const e = await render(
        <PurpleContext>
          <Child />
        </PurpleContext>,
      );
      expect(e.textContent).toBe('purple');
    });

    itRenders('a child context overriding a parent context', async render => {
      /** `Grandchild`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Grandchild extends React.Component {
        /** `Grandchild.contextType`：记录测试夹具在当前场景中的状态。 */
        static contextType = Context;
        /** `Grandchild.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <div>{this.context}</div>;
        }
      }

      const e = await render(
        <PurpleContext>
          <RedContext>
            <Grandchild />
          </RedContext>
        </PurpleContext>,
      );
      expect(e.textContent).toBe('red');
    });

    itRenders('multiple contexts', async render => {
      const Theme = React.createContext('dark');
      const Language = React.createContext('french');
      /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Parent extends React.Component {
        /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return (
            <Theme.Provider value="light">
              <Child />
            </Theme.Provider>
          );
        }
      }

      /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
      function Child() {
        return (
          <Language.Provider value="english">
            <Grandchild />
          </Language.Provider>
        );
      }

      /** `ThemeComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class ThemeComponent extends React.Component {
        /** `ThemeComponent.contextType`：记录测试夹具在当前场景中的状态。 */
        static contextType = Theme;
        /** `ThemeComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <div id="theme">{this.context}</div>;
        }
      }

      /** `LanguageComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class LanguageComponent extends React.Component {
        /** `LanguageComponent.contextType`：记录测试夹具在当前场景中的状态。 */
        static contextType = Language;
        /** `LanguageComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <div id="language">{this.context}</div>;
        }
      }

      /** `Grandchild`：封装当前用例复用的操作、回调或断言步骤。 */
      const Grandchild = props => {
        return (
          <div>
            <ThemeComponent />
            <LanguageComponent />
          </div>
        );
      };

      const e = await render(<Parent />);
      expect(e.querySelector('#theme').textContent).toBe('light');
      expect(e.querySelector('#language').textContent).toBe('english');
    });

    itRenders('nested context unwinding', async render => {
      const Theme = React.createContext('dark');
      const Language = React.createContext('french');

      /** `ThemeConsumer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class ThemeConsumer extends React.Component {
        /** `ThemeConsumer.contextType`：记录测试夹具在当前场景中的状态。 */
        static contextType = Theme;
        /** `ThemeConsumer.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return this.props.children(this.context);
        }
      }

      /** `LanguageConsumer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class LanguageConsumer extends React.Component {
        /** `LanguageConsumer.contextType`：记录测试夹具在当前场景中的状态。 */
        static contextType = Language;
        /** `LanguageConsumer.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return this.props.children(this.context);
        }
      }

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      const App = () => (
        <div>
          <Theme.Provider value="light">
            <Language.Provider value="english">
              <Theme.Provider value="dark">
                <ThemeConsumer>
                  {theme => <div id="theme1">{theme}</div>}
                </ThemeConsumer>
              </Theme.Provider>
              <ThemeConsumer>
                {theme => <div id="theme2">{theme}</div>}
              </ThemeConsumer>
              <Language.Provider value="sanskrit">
                <Theme.Provider value="blue">
                  <Theme.Provider value="red">
                    <LanguageConsumer>
                      {() => (
                        <Language.Provider value="chinese">
                          <Language.Provider value="hungarian" />
                          <LanguageConsumer>
                            {language => <div id="language1">{language}</div>}
                          </LanguageConsumer>
                        </Language.Provider>
                      )}
                    </LanguageConsumer>
                  </Theme.Provider>
                  <LanguageConsumer>
                    {language => (
                      <>
                        <ThemeConsumer>
                          {theme => <div id="theme3">{theme}</div>}
                        </ThemeConsumer>
                        <div id="language2">{language}</div>
                      </>
                    )}
                  </LanguageConsumer>
                </Theme.Provider>
              </Language.Provider>
            </Language.Provider>
          </Theme.Provider>
          <LanguageConsumer>
            {language => <div id="language3">{language}</div>}
          </LanguageConsumer>
        </div>
      );
      const e = await render(<App />);
      expect(e.querySelector('#theme1').textContent).toBe('dark');
      expect(e.querySelector('#theme2').textContent).toBe('light');
      expect(e.querySelector('#theme3').textContent).toBe('blue');
      expect(e.querySelector('#language1').textContent).toBe('chinese');
      expect(e.querySelector('#language2').textContent).toBe('sanskrit');
      expect(e.querySelector('#language3').textContent).toBe('french');
    });
  });
});
