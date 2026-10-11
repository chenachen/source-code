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

/** 提供统一跨SSR/客户端/hydration测试展开器及错误入口包装，render返回可断言的DOM节点。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let React;
let ReactDOMClient;
let ReactDOMServer;

/** 重置模块及警告缓存，重载React/client/server后把入口交给集成工具；每次模式切换隔离模块级状态。 */
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

/** 取模块重置器与五模式场景展开器，让同一上下文输入覆盖SSR及客户端入口。 */
const {resetModules, itRenders} = ReactDOMServerIntegrationUtils(initModules);

describe('ReactDOMServerIntegration', () => {
  beforeEach(() => {
    resetModules();
  });

  describe('class contextType', function () {
    let PurpleContext, RedContext, Context;
    beforeEach(() => {
      Context = React.createContext('none');

      /** 用Context.Provider将props.text提供给children，作为purple/red颜色上下文包装的实现。 */
      class Parent extends React.Component {

        /** 输出当前Context Provider，value来自props.text，直接透传children。 */
        render() {
          return (
            <Context.Provider value={this.props.text}>
              {this.props.children}
            </Context.Provider>
          );
        }
      }
      /** 将text=purple交给Parent并透传children，建立外层颜色值。 */
      PurpleContext = props => <Parent text="purple">{props.children}</Parent>;
      /** 将text=red交给Parent并透传children，用来覆盖同一Context的外层purple。 */
      RedContext = props => <Parent text="red">{props.children}</Parent>;
    });

    /**
     * 代表场景（Given–When–Then）：
     * Given `itRenders` 在服务端、客户端与 hydration 模式中复用同一 Context fixture；
     * When class 子组件通过 contextType 读取上下文；
     * Then 断言各模式输出一致的上下文内容。
     *
     * 验证机制：集成工具串联 react-dom server/client 公开适配边界并比较 DOM。
     */
    /** 经 itRenders 的五种 SSR/客户端/hydration 模式执行；PurpleContext提供purple，类声明contextType=Context；textContent为purple，验证静态消费字段绑定this.context。 */
    itRenders('class child with context', async render => {

      /** 声明contextType的类消费者，从this.context直接输出当前字符串。 */
      class ClassChildWithContext extends React.Component {

        /** 把this.context绑定到颜色Context。 */
        static contextType = Context;

        /** 将当前context字符串输出div，预期最近Provider的purple。 */
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

    /** 经 itRenders 的五种 SSR/客户端/hydration 模式执行；PurpleContext提供purple但类未声明contextType；只渲染字符串context否则空，结果为空，验证Provider不会向任意类自动供值。 */
    itRenders('class child without context', async render => {

      /** 不声明contextType，用字符串检查区分未订阅的类默认context与Provider值。 */
      class ClassChildWithoutContext extends React.Component {

        /** 只输出字符串context，否则空字符串，验证未订阅类不会读取purple。 */
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

    /** 经 itRenders 的五种 SSR/客户端/hydration 模式执行；类订阅的Context值是字符串purple却读取this.context.foo；输出为空，验证contextType不把字符串包装成旧上下文对象。 */
    itRenders('class child with wrong context', async render => {

      /** 订阅字符串Context但故意读取foo字段，测试错误形状读取的空输出。 */
      class ClassChildWithWrongContext extends React.Component {

        /** 绑定与其它颜色消费者相同的字符串Context。 */
        static contextType = Context;

        /** 读取this.context.foo，字符串上不存在该字段，因此div内容为空。 */
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

    /** 经 itRenders 的五种 SSR/客户端/hydration 模式执行；中间函数Child未消费上下文但渲染声明contextType的Grandchild；结果purple，验证传递穿过普通组件边界。 */
    itRenders('with context passed through to a grandchild', async render => {

      /** 订阅颜色Context的孙组件，使普通中间组件不消费也可透传上下文。 */
      class Grandchild extends React.Component {

        /** 把孙类的this.context绑定同一颜色Context，最近Provider生效。 */
        static contextType = Context;

        /** 把当前颜色context写div，分别验证purple穿透或red内层覆盖。 */
        render() {
          return <div>{this.context}</div>;
        }
      }

      /** 不读取颜色context，直接渲染Grandchild，提供中间组件边界。 */
      const Child = props => <Grandchild />;

      const e = await render(
        <PurpleContext>
          <Child />
        </PurpleContext>,
      );
      expect(e.textContent).toBe('purple');
    });

    /** 经 itRenders 的五种 SSR/客户端/hydration 模式执行；Purple外层、Red内层提供同一Context；Grandchild输出red，验证最近Provider覆盖外层值。 */
    itRenders('a child context overriding a parent context', async render => {

      /** 订阅颜色Context的孙组件，使普通中间组件不消费也可透传上下文。 */
      class Grandchild extends React.Component {

        /** 把孙类的this.context绑定同一颜色Context，最近Provider生效。 */
        static contextType = Context;

        /** 把当前颜色context写div，分别验证purple穿透或red内层覆盖。 */
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

    /** 经 itRenders 的五种 SSR/客户端/hydration 模式执行；Theme与Language分别嵌套提供light/english，两个类各订阅一种；DOM分别为light/english，验证独立上下文栈不会混值。 */
    itRenders('multiple contexts', async render => {
      const Theme = React.createContext('dark');
      const Language = React.createContext('french');

      /** 提供Theme=light后返回Child，作为多上下文fixture的最外层类。 */
      class Parent extends React.Component {

        /** 输出Theme Provider固定light并渲染Child，不使用颜色props.text。 */
        render() {
          return (
            <Theme.Provider value="light">
              <Child />
            </Theme.Provider>
          );
        }
      }

      /** 提供Language=english并返回Grandchild，构造独立Language层。 */
      function Child() {
        return (
          <Language.Provider value="english">
            <Grandchild />
          </Language.Provider>
        );
      }

      /** 只订阅Theme的类消费者，与Language消费者共享宿主父级但读独立上下文。 */
      class ThemeComponent extends React.Component {

        /** 将this.context绑定Theme。 */
        static contextType = Theme;

        /** 输出theme id与Theme当前值light，供独立查询。 */
        render() {
          return <div id="theme">{this.context}</div>;
        }
      }

      /** 只订阅Language的类消费者，验证不同Context不共享当前值槽。 */
      class LanguageComponent extends React.Component {

        /** 将this.context绑定Language。 */
        static contextType = Language;

        /** 输出language id与Language当前值english。 */
        render() {
          return <div id="language">{this.context}</div>;
        }
      }

      /** 同时输出ThemeComponent与LanguageComponent，供两个独立contextType消费者比较。 */
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

    /** 经 itRenders 的五种 SSR/客户端/hydration 模式执行；交错多层Theme/Language Provider及同级Consumer；theme1/2/3应为dark/light/blue，language1/2/3为chinese/sanskrit/french，验证子Provider退出后恢复父值并最终回默认值。 */
    itRenders('nested context unwinding', async render => {
      const Theme = React.createContext('dark');
      const Language = React.createContext('french');

      /** 用contextType读取Theme后交给children函数，便于嵌套Provider退出后的值比较。 */
      class ThemeConsumer extends React.Component {

        /** 绑定Theme，使render prop获得最近Theme值。 */
        static contextType = Theme;

        /** 将this.context传入children回调，回调决定当前断言节点位置。 */
        render() {
          return this.props.children(this.context);
        }
      }

      /** 用contextType读取Language并通过children函数构造下层树。 */
      class LanguageConsumer extends React.Component {

        /** 绑定Language，其栈与Theme保持独立。 */
        static contextType = Language;

        /** 把当前Language值传给children函数，可继续嵌套Provider或输出断言节点。 */
        render() {
          return this.props.children(this.context);
        }
      }

      /** 构造交错Theme/Language Provider及消费者树，覆盖内层覆盖、同级恢复、出栈后默认值三种读取点。 */
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
