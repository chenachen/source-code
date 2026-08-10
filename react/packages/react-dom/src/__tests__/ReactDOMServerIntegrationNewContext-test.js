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

  // 让他们可以帮助.
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

  describe('context', function () {
    let Context, PurpleContextProvider, RedContextProvider, Consumer;
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
      Consumer = Context.Consumer;
      PurpleContextProvider = props => (
        <Parent text="purple">{props.children}</Parent>
      );
      RedContextProvider = props => (
        <Parent text="red">{props.children}</Parent>
      );
    });

    itRenders('class child with context', async render => {
      /** `ClassChildWithContext`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class ClassChildWithContext extends React.Component {
        /** `ClassChildWithContext.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return (
            <div>
              <Consumer>{text => text}</Consumer>
            </div>
          );
        }
      }

      const e = await render(
        <PurpleContextProvider>
          <ClassChildWithContext />
        </PurpleContextProvider>,
      );
      expect(e.textContent).toBe('purple');
    });

    itRenders('stateless child with context', async render => {
      /** `FunctionChildWithContext`：封装当前用例复用的操作、回调或断言步骤。 */
      function FunctionChildWithContext(props) {
        return <Consumer>{text => text}</Consumer>;
      }

      const e = await render(
        <PurpleContextProvider>
          <FunctionChildWithContext />
        </PurpleContextProvider>,
      );
      expect(e.textContent).toBe('purple');
    });

    itRenders('class child with default context', async render => {
      /** `ClassChildWithWrongContext`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class ClassChildWithWrongContext extends React.Component {
        /** `ClassChildWithWrongContext.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return (
            <div id="classWrongChild">
              <Consumer>{text => text}</Consumer>
            </div>
          );
        }
      }

      const e = await render(<ClassChildWithWrongContext />);
      expect(e.textContent).toBe('none');
    });

    itRenders('stateless child with wrong context', async render => {
      /** `FunctionChildWithWrongContext`：封装当前用例复用的操作、回调或断言步骤。 */
      function FunctionChildWithWrongContext(props) {
        return (
          <div id="statelessWrongChild">
            <Consumer>{text => text}</Consumer>
          </div>
        );
      }

      const e = await render(<FunctionChildWithWrongContext />);
      expect(e.textContent).toBe('none');
    });

    itRenders('with context passed through to a grandchild', async render => {
      /** `Grandchild`：封装当前用例复用的操作、回调或断言步骤。 */
      function Grandchild(props) {
        return (
          <div>
            <Consumer>{text => text}</Consumer>
          </div>
        );
      }

      /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
      const Child = props => <Grandchild />;

      const e = await render(
        <PurpleContextProvider>
          <Child />
        </PurpleContextProvider>,
      );
      expect(e.textContent).toBe('purple');
    });

    itRenders('a child context overriding a parent context', async render => {
      /** `Grandchild`：封装当前用例复用的操作、回调或断言步骤。 */
      const Grandchild = props => {
        return (
          <div>
            <Consumer>{text => text}</Consumer>
          </div>
        );
      };

      const e = await render(
        <PurpleContextProvider>
          <RedContextProvider>
            <Grandchild />
          </RedContextProvider>
        </PurpleContextProvider>,
      );
      expect(e.textContent).toBe('red');
    });

    itRenders('readContext() in different components', async render => {
      /** `readContext`：封装当前用例复用的操作、回调或断言步骤。 */
      function readContext(Ctx) {
        const dispatcher =
          React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
            .H;
        return dispatcher.readContext(Ctx);
      }

      /** `Cls`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Cls extends React.Component {
        /** `Cls.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return readContext(Context);
        }
      }
      /** `Fn`：封装当前用例复用的操作、回调或断言步骤。 */
      function Fn() {
        return readContext(Context);
      }
      const Memo = React.memo(() => {
        return readContext(Context);
      });
      const FwdRef = React.forwardRef((props, ref) => {
        return readContext(Context);
      });

      const e = await render(
        <PurpleContextProvider>
          <RedContextProvider>
            <span>
              <Fn />
              <Cls />
              <Memo />
              <FwdRef />
              <Consumer>{() => readContext(Context)}</Consumer>
            </span>
          </RedContextProvider>
        </PurpleContextProvider>,
      );
      expect(e.textContent).toBe('redredredredred');
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

      /** `Grandchild`：封装当前用例复用的操作、回调或断言步骤。 */
      const Grandchild = props => {
        return (
          <div>
            <Theme.Consumer>
              {theme => <div id="theme">{theme}</div>}
            </Theme.Consumer>
            <Language.Consumer>
              {language => <div id="language">{language}</div>}
            </Language.Consumer>
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

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      const App = () => (
        <div>
          <Theme.Provider value="light">
            <Language.Provider value="english">
              <Theme.Provider value="dark">
                <Theme.Consumer>
                  {theme => <div id="theme1">{theme}</div>}
                </Theme.Consumer>
              </Theme.Provider>
              <Theme.Consumer>
                {theme => <div id="theme2">{theme}</div>}
              </Theme.Consumer>
              <Language.Provider value="sanskrit">
                <Theme.Provider value="blue">
                  <Theme.Provider value="red">
                    <Language.Consumer>
                      {() => (
                        <Language.Provider value="chinese">
                          <Language.Provider value="hungarian" />
                          <Language.Consumer>
                            {language => <div id="language1">{language}</div>}
                          </Language.Consumer>
                        </Language.Provider>
                      )}
                    </Language.Consumer>
                  </Theme.Provider>
                  <Language.Consumer>
                    {language => (
                      <>
                        <Theme.Consumer>
                          {theme => <div id="theme3">{theme}</div>}
                        </Theme.Consumer>
                        <div id="language2">{language}</div>
                      </>
                    )}
                  </Language.Consumer>
                </Theme.Provider>
              </Language.Provider>
            </Language.Provider>
          </Theme.Provider>
          <Language.Consumer>
            {language => <div id="language3">{language}</div>}
          </Language.Consumer>
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

    itRenders('should treat Context as Context.Provider', async render => {
      const Theme = React.createContext('dark');
      const Language = React.createContext('french');

      expect(Theme.Provider).toBe(Theme);

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      const App = () => (
        <div>
          <Theme value="light">
            <Language value="english">
              <Theme value="dark">
                <Theme.Consumer>
                  {theme => <div id="theme1">{theme}</div>}
                </Theme.Consumer>
              </Theme>
            </Language>
          </Theme>
        </div>
      );

      const e = await render(<App />, 0);
      expect(e.textContent).toBe('dark');
    });

    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「does not pollute sync renders after an error」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：断言覆盖 react-dom 的服务端流适配层；完整 Fizz 状态机位于 react-server。
     */
    it('does not pollute sync renders after an error', () => {
      const LoggedInUser = React.createContext('default');
      /** `Crash`：封装当前用例复用的操作、回调或断言步骤。 */
      const Crash = () => {
        throw new Error('Boo!');
      };
      /** `AppWithUser`：封装当前用例复用的操作、回调或断言步骤。 */
      const AppWithUser = user => (
        <LoggedInUser.Provider value={user}>
          <LoggedInUser.Consumer>{whoAmI => whoAmI}</LoggedInUser.Consumer>
          <Crash />
        </LoggedInUser.Provider>
      );

      expect(() => {
        ReactDOMServer.renderToString(AppWithUser('Casper'));
      }).toThrow('Boo');

      // 失败的渲染不应遗留并报告 context 值。
      expect(
        ReactDOMServer.renderToString(
          <LoggedInUser.Consumer>{whoAmI => whoAmI}</LoggedInUser.Consumer>,
        ),
      ).toBe('default');
    });
  });
});
