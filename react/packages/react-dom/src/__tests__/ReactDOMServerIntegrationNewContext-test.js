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

/** 载入五种SSR/客户端模式helper，让相同Context输入跨模式比较。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let React;
let ReactDOMClient;
let ReactDOMServer;

/** 重置模块与Context/诊断缓存，加载两DOM入口返回helper使用。 */
function initModules() {
  // 重置警告缓存。
  jest.resetModules();
  React = require('react');
  ReactDOMClient = require('react-dom/client');
  ReactDOMServer = require('react-dom/server');

  // 返回当前DOM入口供模块重置helper使用。
  return {
    ReactDOMClient,
    ReactDOMServer,
  };
}

/** 绑定当前模块初始化器，获取resetModules及五模式itRenders包装。 */
const {resetModules, itRenders} = ReactDOMServerIntegrationUtils(initModules);

describe('ReactDOMServerIntegration', () => {
  beforeEach(() => {
    resetModules();
  });

  describe('context', function () {
    let Context, PurpleContextProvider, RedContextProvider, Consumer;
    beforeEach(() => {
      Context = React.createContext('none');

      /** 以props.text提供同Context，透传children以形成Provider作用域。 */
      class Parent extends React.Component {

        /** 包Context.Provider而不引入DOM，供purple/red实例共享同一种Provider类。 */
        render() {
          return (
            <Context.Provider value={this.props.text}>
              {this.props.children}
            </Context.Provider>
          );
        }
      }
      Consumer = Context.Consumer;
      /** 固定text=purple的Provider包装，形成外层值。 */
      PurpleContextProvider = props => (
        <Parent text="purple">{props.children}</Parent>
      );
      /** 固定text=red的Provider包装，形成嵌套覆盖值。 */
      RedContextProvider = props => (
        <Parent text="red">{props.children}</Parent>
      );
    });

    /** 五种render模式下Purple Provider包类Consumer；DOM文字purple，验证类子树读取最近的新Context值。 */
    itRenders('class child with context', async render => {

      /** 类子级通过Consumer读Context并包div，不使用contextType。 */
      class ClassChildWithContext extends React.Component {

        /** 把Consumer回调收到的text直接输出，验证purple值。 */
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

    /** Purple Provider包函数Consumer；五模式文字purple，验证函数组件中的Consumer。 */
    itRenders('stateless child with context', async render => {

      /** 函数子级使用Consumer返回当前text，与类路径对照。 */
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

    /** 类Consumer无Provider；五模式文字none，验证createContext默认值。 */
    itRenders('class child with default context', async render => {

      /** 未放Provider的类Consumer fixture，读取createContext默认none。 */
      class ClassChildWithWrongContext extends React.Component {

        /** id=classWrongChild仅定位宿主，Consumer实际读取默认值而非错误Context对象。 */
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

    /** 函数Consumer无Provider；五模式文字none，旧标题wrong实际没有另一个Provider，验证默认上下文。 */
    itRenders('stateless child with wrong context', async render => {

      /** 未放Provider的函数Consumer fixture，输出默认none。 */
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

    /** Purple Provider经过不消费Context的Child到Grandchild Consumer；五模式purple，验证中间组件不阻断传播。 */
    itRenders('with context passed through to a grandchild', async render => {

      /** 祖孙传播用Grandchild，读取Context输出到div。 */
      function Grandchild(props) {
        return (
          <div>
            <Consumer>{text => text}</Consumer>
          </div>
        );
      }

      /** 中间Child不消费也不提供Context，只返回Grandchild。 */
      const Child = props => <Grandchild />;

      const e = await render(
        <PurpleContextProvider>
          <Child />
        </PurpleContextProvider>,
      );
      expect(e.textContent).toBe('purple');
    });

    /** Purple外层包Red内层与Grandchild；五模式red，验证同Context最近Provider覆盖。 */
    itRenders('a child context overriding a parent context', async render => {

      /** 嵌套Purple/Red内的Grandchild，读最近red Provider。 */
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

    /** Red在Purple内，Fn/Cls/Memo/FwdRef/Consumer均调用内部dispatcher.readContext；五模式文字red连续五次，验证各渲染类型共享当前Context读入口。 */
    itRenders('readContext() in different components', async render => {

      /** 从当前React内部H dispatcher调用readContext，要求正处于组件渲染/Consumer回调中。 */
      function readContext(Ctx) {
        const dispatcher =
          React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
            .H;
        return dispatcher.readContext(Ctx);
      }

      /** 用类render调用内部readContext的fixture。 */
      class Cls extends React.Component {

        /** 返回当前Context值，和其它类型拼接成五个red。 */
        render() {
          return readContext(Context);
        }
      }

      /** 函数render调用相同内部Context读取入口。 */
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

    /** Theme默认dark、Language默认french，Parent给light而Child给english；五模式两个目标分别light/english，验证不同Context独立栈。 */
    itRenders('multiple contexts', async render => {
      const Theme = React.createContext('dark');
      const Language = React.createContext('french');

      /** 只提供Theme=light的父类，Language由子组件另提供。 */
      class Parent extends React.Component {

        /** 包Theme Provider并返回Child，保持两Context作用域独立。 */
        render() {
          return (
            <Theme.Provider value="light">
              <Child />
            </Theme.Provider>
          );
        }
      }

      /** 提供Language=english并返回Grandchild，不改Theme值。 */
      function Child() {
        return (
          <Language.Provider value="english">
            <Grandchild />
          </Language.Provider>
        );
      }

      /** 分别用Theme/Language Consumer输出到两个id，检查独立栈。 */
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

    /** 嵌套Theme/Language多次覆盖且含空hungarian Provider；五模式六处为dark/light/blue/chinese/sanskrit/french，验证退出子树后恢复各自父值、空兄弟Provider不泄漏。 */
    itRenders('nested context unwinding', async render => {
      const Theme = React.createContext('dark');
      const Language = React.createContext('french');

      /** 构造多层交错Theme/Language Provider和退出后的消费者，包含无children的hungarian兄弟以检查栈恢复。 */
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

    /** 断言Theme.Provider就是Theme，用直接<Theme value>嵌套light/dark；五模式最终dark且零错误，验证Context对象可作为Provider。 */
    itRenders('should treat Context as Context.Provider', async render => {
      const Theme = React.createContext('dark');
      const Language = React.createContext('french');

      expect(Theme.Provider).toBe(Theme);

      /** 用Context对象本身当Provider，嵌套light/dark，验证.Provider别名。 */
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

    /** 同步SSR在LoggedInUser=Casper下Crash抛Boo；下一次无Provider的Consumer字符串default，验证错误展开后不污染后续请求Context栈。 */
    it('does not pollute sync renders after an error', () => {
      const LoggedInUser = React.createContext('default');

      /** 抛Boo的函数fixture，在已提供用户值的SSR中强制错误展开。 */
      const Crash = () => {
        throw new Error('Boo!');
      };

      /** 提供指定user、先消费再Crash，下一次请求应重新得到默认值。 */
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
