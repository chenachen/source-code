/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

'use strict';

let React;
let ReactDOMServer;
let PropTypes;
let ReactSharedInternals;
let assertConsoleErrorDev;

describe('ReactDOMServer', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    PropTypes = require('prop-types');
    ReactDOMServer = require('react-dom/server');
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
    ReactSharedInternals =
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  });

  describe('renderToString', () => {

    /** Given：span包含hello world；When：renderToString；Then：响应匹配span标记及原文本。目的：基础SSR序列化。 */
    it('should generate simple markup', () => {
      const response = ReactDOMServer.renderToString(<span>hello world</span>);
      expect(response).toMatch(new RegExp('<span' + '>hello world</span>'));
    });

    /** Given：空img；When：renderToString；Then：响应匹配<img/>。目的：void标签以自闭合形式输出。 */
    it('should generate simple markup for self-closing tags', () => {
      const response = ReactDOMServer.renderToString(<img />);
      expect(response).toMatch(new RegExp('<img' + '/>'));
    });

    /** Given：类NullComponent返回null；When：renderToString；Then：响应严格为空字符串。目的：实际断言没有注释占位，不能照标题声称生成comment。 */
    it('should generate comment markup for component returns null', () => {

      /** 返回null的类fixture，验证字符串SSR为空而不是标题提到的注释占位。 */
      class NullComponent extends React.Component {

        /**
         * 声明无UI的类render。
         * @returns null。
         */
        render() {
          return null;
        }
      }

      const response = ReactDOMServer.renderToString(<NullComponent />);
      expect(response).toBe('');
    });

    // TODO：测试监听器是否注册到任何文档/容器上。

    /** Given：Parent的div包含name=child的Child；When：renderToString；Then：匹配嵌套div/span及My name is与child间的<!-- -->。目的：类组合及相邻文本分隔。 */
    it('should render composite components', () => {

      /** 构造div/Child嵌套的父类fixture。 */
      class Parent extends React.Component {

        /**
         * 向Child传name=child并包装div。
         * @returns 父div元素。
         */
        render() {
          return (
            <div>
              <Child name="child" />
            </div>
          );
        }
      }

      /** 把props.name作为第二段文本输出的类fixture。 */
      class Child extends React.Component {

        /**
         * 用常量前缀与动态name制造相邻文本边界。
         * @returns My name is文本span。
         */
        render() {
          return <span>My name is {this.props.name}</span>;
        }
      }

      const response = ReactDOMServer.renderToString(<Parent />);
      expect(response).toMatch(
        new RegExp(
          '<div>' +
            '<span' +
            '>' +
            'My name is <!-- -->child' +
            '</span>' +
            '</div>',
        ),
      );
    });

    /** Given：TestComponent记录构造和各生命周期，state.name为TestComponent；When：runTest执行renderToString；Then：标记匹配名称，日志仅getInitialState/componentWillMount/render。目的：服务器构造/挂载前render而不执行commit或更新/卸载阶段。 */
    it('should only execute certain lifecycle methods', () => {

      /**
       * 新建生命周期日志并执行一次字符串SSR，核对只有构造、挂载前与render会执行。
       * @returns 无返回值，expect失败使当前用例失败。
       */
      function runTest() {
        const lifecycle = [];

        /** 记录所有阶段的类fixture，用未出现的日志证明SSR没有commit/更新/卸载。 */
        class TestComponent extends React.Component {

          /**
           * 初始化state.name并登记getInitialState日志。
           * @param props - 调用者传入props，转交父构造器。
           */
          constructor(props) {
            super(props);
            lifecycle.push('getInitialState');
            this.state = {name: 'TestComponent'};
          }

          /**
           * 登记挂载前日志，不执行DOM副作用。
           * @returns 无返回值。
           */
          UNSAFE_componentWillMount() {
            lifecycle.push('componentWillMount');
          }

          /**
           * 登记commit挂载日志；本SSR用例要求它不被调用。
           * @returns 无返回值。
           */
          componentDidMount() {
            lifecycle.push('componentDidMount');
          }

          /**
           * 登记render并按state.name输出文本。
           * @returns 名称span，字符串SSR在两段文本间加分隔注释。
           */
          render() {
            lifecycle.push('render');
            return <span>Component name: {this.state.name}</span>;
          }

          /**
           * 登记更新前日志；仅服务器首次挂载不会进入此阶段。
           * @returns 无返回值。
           */
          UNSAFE_componentWillUpdate() {
            lifecycle.push('componentWillUpdate');
          }

          /**
           * 登记更新commit日志；本SSR用例要求没有此日志。
           * @returns 无返回值。
           */
          componentDidUpdate() {
            lifecycle.push('componentDidUpdate');
          }

          /**
           * 登记更新判断日志；SSR首次挂载不会询问更新许可。
           * @returns undefined，方法不显式返回判断值。
           */
          shouldComponentUpdate() {
            lifecycle.push('shouldComponentUpdate');
          }

          /**
           * 登记接收新props日志；一次SSR没有后续props更新。
           * @returns 无返回值。
           */
          UNSAFE_componentWillReceiveProps() {
            lifecycle.push('componentWillReceiveProps');
          }

          /**
           * 登记卸载日志；SSR结束请求不模拟客户端unmount。
           * @returns 无返回值。
           */
          componentWillUnmount() {
            lifecycle.push('componentWillUnmount');
          }
        }

        const response = ReactDOMServer.renderToString(<TestComponent />);

        expect(response).toMatch(
          new RegExp(
            '<span>' + 'Component name: <!-- -->TestComponent' + '</span>',
          ),
        );
        expect(lifecycle).toEqual([
          'getInitialState',
          'componentWillMount',
          'render',
        ]);
      }

      runTest();
    });

    /** Given：顶层输入普通对象{x:123}；When：调用绑定的renderToString；Then：抛Objects are not valid并指出keys x。目的：拒绝非法child。 */
    it('should throw with silly args', () => {
      expect(
        ReactDOMServer.renderToString.bind(ReactDOMServer, {x: 123}),
      ).toThrowError(
        'Objects are not valid as a React child (found: object with keys {x})',
      );
    });

    /** Given：iframe的style为字符串border:none；When：renderToString；Then：抛style要求属性值映射的错误。目的：宿主样式输入必须为对象。 */
    it('should throw prop mapping error for an <iframe /> with invalid props', () => {
      expect(() => {
        ReactDOMServer.renderToString(<iframe style="border:none;" />);
      }).toThrowError(
        'The `style` prop expects a mapping from style properties to values, not ' +
          "a string. For example, style={{marginRight: spacing + 'em'}} when using JSX.",
      );
    });

    /** Given：div的hasOwnProperty prop为poison且span带unknown=test；When：renderToString；Then：消费未知大小写属性警告，HTML仍包含span unknown=test。目的：用户属性不能破坏内部自有属性检测。 */
    it('should not crash on poisoned hasOwnProperty', () => {
      const html = ReactDOMServer.renderToString(
        <div hasOwnProperty="poison">
          <span unknown="test" />
        </div>,
      );
      assertConsoleErrorDev([
        'React does not recognize the `hasOwnProperty` prop on a DOM element. ' +
          'If you intentionally want it to appear in the DOM as a custom attribute, ' +
          'spell it as lowercase `hasownproperty` instead. ' +
          'If you accidentally passed it from a parent component, remove it from the DOM element.\n' +
          '    in div (at **)',
      ]);
      expect(html).toContain('<span unknown="test">');
    });
  });

  describe('renderToStaticMarkup', () => {

    /** Given：TestComponent用span包装NestedComponent的div；When：renderToStaticMarkup；Then：严格为<span><div>inner text</div></span>。目的：静态输出没有额外React标记或校验信息。 */
    it('should not put checksum and React ID on components', () => {

      /** 生成内层静态div的类fixture。 */
      class NestedComponent extends React.Component {

        /**
         * 返回inner text宿主内容。
         * @returns div(inner text)。
         */
        render() {
          return <div>inner text</div>;
        }
      }

      /** 用span包住NestedComponent验证无额外标记。 */
      class TestComponent extends React.Component {

        /**
         * 生成可严格比较的span/div静态树。
         * @returns 含NestedComponent的span。
         */
        render() {
          return (
            <span>
              <NestedComponent />
            </span>
          );
        }
      }

      const response = ReactDOMServer.renderToStaticMarkup(<TestComponent />);

      expect(response).toBe('<span><div>inner text</div></span>');
    });

    /** Given：span包含hello、空格、world三个文本输入；When：renderToStaticMarkup；Then：严格为<span>hello world</span>。目的：静态文本不加hydration分隔注释。 */
    it('should not put checksum and React ID on text components', () => {

      /** 输出多段文本的静态类fixture，验证不插hydration分隔符。 */
      class TestComponent extends React.Component {

        /**
         * 返回hello、空格与world作为span children。
         * @returns 文本span。
         */
        render() {
          return (
            <span>
              {'hello'} {'world'}
            </span>
          );
        }
      }

      const response = ReactDOMServer.renderToStaticMarkup(<TestComponent />);

      expect(response).toBe('<span>hello world</span>');
    });

    /** Given：TestComponent返回null；When：renderToStaticMarkup；Then：严格为空字符串。目的：空节点不产生注释。 */
    it('should not use comments for empty nodes', () => {

      /** 静态SSR空节点fixture。 */
      class TestComponent extends React.Component {

        /**
         * 返回无UI结果。
         * @returns null。
         */
        render() {
          return null;
        }
      }

      const response = ReactDOMServer.renderToStaticMarkup(<TestComponent />);

      expect(response).toBe('');
    });

    /** Given：类记录所有生命周期且初始名称为TestComponent；When：runTest执行静态SSR；Then：严格名称span，日志仅构造/componentWillMount/render。目的：静态API也不执行commit、更新或卸载生命周期。 */
    it('should only execute certain lifecycle methods', () => {

      /**
       * 独立记录静态SSR生命周期，与字符串API对照相同的阶段限制。
       * @returns 无返回值。
       */
      function runTest() {
        const lifecycle = [];

        /** 记录全部生命周期但只允许构造/挂载前/render的静态fixture。 */
        class TestComponent extends React.Component {

          /**
           * 登记getInitialState并设置名称state。
           * @param props - 转发到父构造器的props。
           */
          constructor(props) {
            super(props);
            lifecycle.push('getInitialState');
            this.state = {name: 'TestComponent'};
          }

          /**
           * 登记componentWillMount，属于SSR允许的挂载前阶段。
           * @returns 无返回值。
           */
          UNSAFE_componentWillMount() {
            lifecycle.push('componentWillMount');
          }

          /**
           * 登记componentDidMount，静态SSR不应调用。
           * @returns 无返回值。
           */
          componentDidMount() {
            lifecycle.push('componentDidMount');
          }

          /**
           * 记录render并返回state中的名称。
           * @returns 名称span，静态模式不插注释。
           */
          render() {
            lifecycle.push('render');
            return <span>Component name: {this.state.name}</span>;
          }

          /**
           * 记录componentWillUpdate，首次静态SSR不应调用。
           * @returns 无返回值。
           */
          UNSAFE_componentWillUpdate() {
            lifecycle.push('componentWillUpdate');
          }

          /**
           * 记录componentDidUpdate，静态SSR无更新commit。
           * @returns 无返回值。
           */
          componentDidUpdate() {
            lifecycle.push('componentDidUpdate');
          }

          /**
           * 记录shouldComponentUpdate；首次静态挂载不调用。
           * @returns undefined。
           */
          shouldComponentUpdate() {
            lifecycle.push('shouldComponentUpdate');
          }

          /**
           * 记录接收props阶段；单次静态请求没有后续props更新。
           * @returns 无返回值。
           */
          UNSAFE_componentWillReceiveProps() {
            lifecycle.push('componentWillReceiveProps');
          }

          /**
           * 记录unmount；静态请求结束不触发客户端卸载协议。
           * @returns 无返回值。
           */
          componentWillUnmount() {
            lifecycle.push('componentWillUnmount');
          }
        }

        const response = ReactDOMServer.renderToStaticMarkup(<TestComponent />);

        expect(response).toBe('<span>Component name: TestComponent</span>');
        expect(lifecycle).toEqual([
          'getInitialState',
          'componentWillMount',
          'render',
        ]);
      }

      runTest();
    });

    /** Given：静态API输入{x:123}；When：调用绑定的renderToStaticMarkup；Then：抛非法React child且指出keys x。目的：静态SSR保持child类型校验。 */
    it('should throw with silly args', () => {
      expect(
        ReactDOMServer.renderToStaticMarkup.bind(ReactDOMServer, {x: 123}),
      ).toThrowError(
        'Objects are not valid as a React child (found: object with keys {x})',
      );
    });

    /** Given：无自定义constructor的类在UNSAFE_componentWillMount setState hello, world；When：静态SSR；Then：标记包含该文本。目的：服务器挂载前更新在不使用DOM时可影响本轮render。 */
    it('allows setState in componentWillMount without using DOM', () => {

      /** 没有自定义constructor、在挂载前创建state的类fixture。 */
      class Component extends React.Component {

        /**
         * 在服务器允许的挂载前阶段setState文本。
         * @returns 无返回值；更新由本轮类挂载消费。
         */
        UNSAFE_componentWillMount() {
          this.setState({text: 'hello, world'});
        }

        /**
         * 读取挂载前更新后的state.text。
         * @returns 文本div。
         */
        render() {
          return <div>{this.state.text}</div>;
        }
      }
      const markup = ReactDOMServer.renderToStaticMarkup(<Component />);
      expect(markup).toContain('hello, world');
    });

    /** Given：constructor初值default state，挂载前setState hello, world；When：静态SSR；Then：标记包含更新值。目的：自定义初始state也消费挂载前更新。 */
    it('allows setState in componentWillMount with custom constructor', () => {

      /** 构造默认state后在挂载前改写的类fixture。 */
      class Component extends React.Component {

        /** 调用父构造器并设置text=default state。 */
        constructor() {
          super();
          this.state = {text: 'default state'};
        }

        /**
         * 把初始文本更新为hello, world，验证本轮SSR消费setState。
         * @returns 无返回值。
         */
        UNSAFE_componentWillMount() {
          this.setState({text: 'hello, world'});
        }

        /**
         * 输出更新后的state.text。
         * @returns 文本div。
         */
        render() {
          return <div>{this.state.text}</div>;
        }
      }
      const markup = ReactDOMServer.renderToStaticMarkup(<Component />);
      expect(markup).toContain('hello, world');
    });

    /** Given：constructor只super()，props.text由元素传hello, world；When：静态SSR；Then：标记包含该文本。目的：renderer为自定义构造类建立最终props。 */
    it('renders with props when using custom constructor', () => {

      /** constructor只super()，检查renderer随后安装props的类fixture。 */
      class Component extends React.Component {

        /** 仅初始化父类，没有把props显式传给super。 */
        constructor() {
          super();
        }

        /**
         * 读取最终this.props.text。
         * @returns 文本div。
         */
        render() {
          return <div>{this.props.text}</div>;
        }
      }

      const markup = ReactDOMServer.renderToStaticMarkup(
        <Component text="hello, world" />,
      );
      expect(markup).toContain('hello, world');
    });
    /** Given：仅!disableLegacyContext分支，Provider给text且Component构造未传context；When：静态SSR；Then：两种legacy API警告且标记含hello, world。目的：旧Context在构造后的类上下文安装，不扩大到禁用构建。 */

    // @gate !disableLegacyContext

    it('renders with context when using custom constructor', () => {

      /** legacy Context gate内的消费者类，构造不显式传context。 */
      class Component extends React.Component {

        /** 只调用super，后续context由服务器类挂载建立。 */
        constructor() {
          super();
        }

        /**
         * 读取legacy this.context.text。
         * @returns Context文本div。
         */
        render() {
          return <div>{this.context.text}</div>;
        }
      }

      Component.contextTypes = {
        text: PropTypes.string.isRequired,
      };

      /** 通过旧childContextTypes协议提供text，仅gate允许的构建执行。 */
      class ContextProvider extends React.Component {

        /**
         * 给子组件安装旧Context值。
         * @returns text=hello, world的对象。
         */
        getChildContext() {
          return {
            text: 'hello, world',
          };
        }

        /**
         * 转发props.children而不加DOM包装。
         * @returns 原children。
         */
        render() {
          return this.props.children;
        }
      }

      ContextProvider.childContextTypes = {
        text: PropTypes.string,
      };

      const markup = ReactDOMServer.renderToStaticMarkup(
        <ContextProvider>
          <Component />
        </ContextProvider>,
      );
      assertConsoleErrorDev([
        'ContextProvider uses the legacy childContextTypes API which will soon be removed. ' +
          'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
          '    in ContextProvider (at **)',
        'Component uses the legacy contextTypes API which will soon be removed. ' +
          'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
          '    in Component (at **)',
      ]);
      expect(markup).toContain('hello, world');
    });

    /** Given：Context默认0，外Provider=1、内Provider分别2与3，并经Fragment间接消费；When：静态SSR后提取数字；Then：[2,1,3,1]。目的：嵌套Provider退出时恢复外值。 */
    it('renders with new context API', () => {
      const Context = React.createContext(0);

      /**
       * 通过Context.Consumer回调渲染当前Provider值。
       * @param props - 本fixture未使用。
       * @returns 以Result前缀输出值的Consumer元素。
       */
      function Consumer(props) {
        return (
          <Context.Consumer>{value => 'Result: ' + value}</Context.Consumer>
        );
      }

      const Indirection = React.Fragment;

      /**
       * 建立外值及2/3内值，验证退出内Provider后恢复外值。
       * @param props - value为外Provider值1。
       * @returns 四个消费者的Provider树。
       */
      function App(props) {
        return (
          <Context.Provider value={props.value}>
            <Context.Provider value={2}>
              <Consumer />
            </Context.Provider>
            <Indirection>
              <Indirection>
                <Consumer />
                <Context.Provider value={3}>
                  <Consumer />
                </Context.Provider>
              </Indirection>
            </Indirection>
            <Consumer />
          </Context.Provider>
        );
      }

      const markup = ReactDOMServer.renderToStaticMarkup(<App value={1} />);
      // 提取消费者渲染的数字
      const results = markup.match(/\d+/g).map(Number);
      expect(results).toEqual([2, 1, 3, 1]);
    });

    /** Given：同样的1/2/3嵌套Context树，Consumer使用dispatcher.readContext；When：静态SSR后提取数字；Then：[2,1,3,1]。目的：内部读取遵循当前Provider栈。 */
    it('renders with dispatcher.readContext mechanism', () => {
      const Context = React.createContext(0);

      /**
       * 通过服务器当前dispatcher读取Context。
       * @param context - 待读Context对象。
       * @returns 当前Provider值。
       */
      function readContext(context) {
        return ReactSharedInternals.H.readContext(context);
      }

      /**
       * 把内部readContext值变成可提取数字的文本。
       * @param props - 本fixture未使用。
       * @returns Result前缀字符串。
       */
      function Consumer(props) {
        return 'Result: ' + readContext(Context);
      }

      const Indirection = React.Fragment;

      /**
       * 构造与公开Consumer测试相同的Provider层级。
       * @param props - value为外值1。
       * @returns 四个内部读取消费者的Context树。
       */
      function App(props) {
        return (
          <Context.Provider value={props.value}>
            <Context.Provider value={2}>
              <Consumer />
            </Context.Provider>
            <Indirection>
              <Indirection>
                <Consumer />
                <Context.Provider value={3}>
                  <Consumer />
                </Context.Provider>
              </Indirection>
            </Indirection>
            <Consumer />
          </Context.Provider>
        );
      }

      const markup = ReactDOMServer.renderToStaticMarkup(<App value={1} />);
      // 提取消费者渲染的数字
      const results = markup.match(/\d+/g).map(Number);
      expect(results).toEqual([2, 1, 3, 1]);
    });

    /** Given：外App Provider=1，Reentrant在render中另起reentrant=false的SSR请求；When：静态SSR；Then：外标记与重入标记数字均[2,1,3,1]。目的：重入请求保存/恢复Context读取环境。 */
    it('renders context API, reentrancy', () => {
      const Context = React.createContext(0);

      /**
       * 重入测试的公开Context消费者。
       * @param props - 本fixture未使用。
       * @returns Result文本的Consumer元素。
       */
      function Consumer(props) {
        return (
          <Context.Consumer>{value => 'Result: ' + value}</Context.Consumer>
        );
      }

      let reentrantMarkup;

      /**
       * 在外请求render期间同步发起另一静态请求，记录标记；关闭reentrant避免无限自调用。
       * @returns null，不把内请求结果插入外树。
       */
      function Reentrant() {
        reentrantMarkup = ReactDOMServer.renderToStaticMarkup(
          <App value={1} reentrant={false} />,
        );
        return null;
      }

      const Indirection = React.Fragment;

      /**
       * 可选插入Reentrant后按相同Provider层级消费值。
       * @param props - value是外值；reentrant控制是否再发起请求。
       * @returns Provider/Consumer树。
       */
      function App(props) {
        return (
          <Context.Provider value={props.value}>
            {props.reentrant && <Reentrant />}
            <Context.Provider value={2}>
              <Consumer />
            </Context.Provider>
            <Indirection>
              <Indirection>
                <Consumer />
                <Context.Provider value={3}>
                  <Consumer />
                </Context.Provider>
              </Indirection>
            </Indirection>
            <Consumer />
          </Context.Provider>
        );
      }

      const markup = ReactDOMServer.renderToStaticMarkup(
        <App value={1} reentrant={true} />,
      );
      // 提取消费者渲染的数字
      const results = markup.match(/\d+/g).map(Number);
      const reentrantResults = reentrantMarkup.match(/\d+/g).map(Number);
      expect(results).toEqual([2, 1, 3, 1]);
      expect(reentrantResults).toEqual([2, 1, 3, 1]);
    });

    /** Given：StaticComponent在render中嵌套静态SSR图像，另一类挂载前setState；When：外层renderToString；Then：不抛错，未额外断言完整HTML。目的：两种服务器API重入与挂载前更新能共存。 */
    it('renders components with different batching strategies', () => {

      /** 在类render中调用静态API并通过HTML注入复用其结果的fixture。 */
      class StaticComponent extends React.Component {

        /**
         * 生成包含img的静态HTML再交给外请求的div注入。
         * @returns dangerouslySetInnerHTML div。
         */
        render() {
          const staticContent = ReactDOMServer.renderToStaticMarkup(
            <div>
              <img src="foo-bar.jpg" />
            </div>,
          );
          return <div dangerouslySetInnerHTML={{__html: staticContent}} />;
        }
      }

      /** 与嵌套静态请求并列、在挂载前更新state的类fixture。 */
      class Component extends React.Component {

        /**
         * 设置hello, world文本供本轮服务器render读取。
         * @returns 无返回值。
         */
        UNSAFE_componentWillMount() {
          this.setState({text: 'hello, world'});
        }

        /**
         * 显示挂载前更新值。
         * @returns 文本div。
         */
        render() {
          return <div>{this.state.text}</div>;
        }
      }

      expect(
        ReactDOMServer.renderToString.bind(
          ReactDOMServer,
          <div>
            <StaticComponent />
            <Component />
          </div>,
        ),
      ).not.toThrow();
    });

    /** Given：lazy返回thenable，其then同步resolve默认Foo；When：静态SSR并传id=foo；Then：严格<div id="foo">lazy</div>。目的：同步兑现直接取得组件，不进入fallback。 */
    it('renders synchronously resolved lazy component', () => {
      const LazyFoo = React.lazy(() => ({

        /**
         * lazy加载器返回的同步thenable订阅；调用resolve后payload可直接终结。
         * @param resolve - 接收含默认Foo的模块对象。
         * @returns 无返回值，不安排异步任务。
         */
        then(resolve) {
          resolve({

            /**
             * 同步兑现模块的default函数组件属性。
             * @param id - lazy元素转发的DOM id。
             * @returns id对应且文本为lazy的div。
             */
            default: /** Foo是同步兑现lazy模块的默认组件；接收id并返回带此id的div(lazy)，不再抛thenable挂起。 */ function Foo({id}) {
              return <div id={id}>lazy</div>;
            },
          });
        },
      }));

      expect(ReactDOMServer.renderToStaticMarkup(<LazyFoo id="foo" />)).toEqual(
        '<div id="foo">lazy</div>',
      );
    });

    /** Given：lazy的then同步reject Error(Bad lazy)；When：静态SSR；Then：抛Bad lazy。目的：拒绝终态传播原错误。 */
    it('throws error from synchronously rejected lazy component', () => {
      const LazyFoo = React.lazy(() => ({

        /**
         * 同步拒绝lazy加载，注册Error(Bad lazy)终态。
         * @param resolve - 此fixture不调用。
         * @param reject - 立即接收Bad lazy错误。
         * @returns 无返回值。
         */
        then(resolve, reject) {
          reject(new Error('Bad lazy'));
        },
      }));

      expect(() => ReactDOMServer.renderToStaticMarkup(<LazyFoo />)).toThrow(
        'Bad lazy',
      );
    });

    /** Given：Suspender抛永不兑现Promise且Suspense fallback为fallback；When：同步静态SSR；Then：严格fallback。目的：同步API结束挂起任务，不等待Promise。 */
    it('aborts synchronously any suspended tasks and renders their fallbacks', () => {
      const promise = new Promise(res => {});

      /**
       * 每次读取抛同一个永不兑现Promise，保持Suspense未完成。
       * @returns 不返回；通过thenable进入fallback。
       */
      function Suspender() {
        throw promise;
      }
      const response = ReactDOMServer.renderToStaticMarkup(
        <React.Suspense fallback={'fallback'}>
          <Suspender />
        </React.Suspense>,
      );
      expect(response).toEqual('fallback');
    });
  });

  /** Given：Foo挂载前setState hello，并登记timer再setState error；When：字符串SSR后runOnlyPendingTimers，再静态SSR；Then：异步更新no-op警告一次、静态标记仍<div>hello</div>，再跑timer不重复警告。目的：服务器只接受挂载中的类更新并按类型去重诊断。 */
  it('warns with a no-op when an async setState is triggered', () => {

    /** 挂载前设置hello、定时器结束后尝试error的服务器类fixture。 */
    class Foo extends React.Component {

      /**
       * 先排挂载内setState再登记挂载结束后的更新；后者用于验证no-op及警告去重。
       * @returns 无返回值。
       */
      UNSAFE_componentWillMount() {
        this.setState({text: 'hello'});
        setTimeout(() => {
          this.setState({text: 'error'});
        });
      }

      /**
       * 按state.text输出div，onClick函数不进入服务器HTML属性。
       * @returns 文本div。
       */
      render() {
        return <div onClick={() => {}}>{this.state.text}</div>;
      }
    }

    ReactDOMServer.renderToString(<Foo />);
    jest.runOnlyPendingTimers();
    assertConsoleErrorDev([
      'Can only update a mounting component. ' +
        'This usually means you called setState() outside componentWillMount() on the server. ' +
        'This is a no-op.\n' +
        '\n' +
        'Please check the code for the Foo component.',
    ]);

    const markup = ReactDOMServer.renderToStaticMarkup(<Foo />);
    expect(markup).toBe('<div>hello</div>');
    // 无额外警告预期。
    jest.runOnlyPendingTimers();
  });

  /** Given：Baz挂载前forceUpdate并登记timer再次forceUpdate；When：字符串SSR后跑待定timer，再静态SSR；Then：异步forceUpdate no-op警告且静态标记<div></div>。目的：结束挂载后的强制更新同样无效。 */
  it('warns with a no-op when an async forceUpdate is triggered', () => {

    /** 在挂载前和延时回调中分别forceUpdate的类fixture。 */
    class Baz extends React.Component {

      /**
       * 当前挂载中的forceUpdate被允许，timer中的调用将成为服务器no-op。
       * @returns 无返回值。
       */
      UNSAFE_componentWillMount() {
        this.forceUpdate();
        setTimeout(() => {
          this.forceUpdate();
        });
      }

      /**
       * 输出无children的带事件div。
       * @returns 空div；事件回调不序列化。
       */
      render() {
        return <div onClick={() => {}} />;
      }
    }

    ReactDOMServer.renderToString(<Baz />);
    jest.runOnlyPendingTimers();
    assertConsoleErrorDev([
      'Can only update a mounting component. ' +
        'This usually means you called forceUpdate() outside componentWillMount() on the server. ' +
        'This is a no-op.\n' +
        '\n' +
        'Please check the code for the Baz component.',
    ]);
    const markup = ReactDOMServer.renderToStaticMarkup(<Baz />);
    expect(markup).toBe('<div></div>');
  });

  /** Given：Bad组件直接throw null；When：renderToString并手工catch；Then：didError为true且error严格为null。目的：用独立标志区分抛空值与未发生异常。 */
  it('does not get confused by throwing null', () => {

    /**
     * 直接抛null，验证SSR保留空的非Error抛值。
     * @returns 不返回。
     */
    function Bad() {
      // eslint-disable-next-line no-throw-literal
      throw null;
    }

    let didError;
    let error;
    try {
      ReactDOMServer.renderToString(<Bad />);
    } catch (err) {
      didError = true;
      error = err;
    }
    expect(didError).toBe(true);
    expect(error).toBe(null);
  });

  /** Given：Bad组件直接throw undefined；When：SSR并catch；Then：didError为true、error为undefined。目的：不能用error本身的真值性判断失败。 */
  it('does not get confused by throwing undefined', () => {

    /**
     * 直接抛undefined，配合didError标志证明异常确实发生。
     * @returns 不返回。
     */
    function Bad() {
      // eslint-disable-next-line no-throw-literal
      throw undefined;
    }

    let didError;
    let error;
    try {
      ReactDOMServer.renderToString(<Bad />);
    } catch (err) {
      didError = true;
      error = err;
    }
    expect(didError).toBe(true);
    expect(error).toBe(undefined);
  });

  /** Given：Bad组件throw字符串foo；When：SSR并catch；Then：didError为true且error为foo。目的：保留非Error抛值。 */
  it('does not get confused by throwing a primitive', () => {

    /**
     * 直接抛字符串foo而非Error实例。
     * @returns 不返回。
     */
    function Bad() {
      // eslint-disable-next-line no-throw-literal
      throw 'foo';
    }

    let didError;
    let error;
    try {
      ReactDOMServer.renderToString(<Bad />);
    } catch (err) {
      didError = true;
      error = err;
    }
    expect(didError).toBe(true);
    expect(error).toBe('foo');
  });

  /** Given：Wrapper在render将三个span中的第2个child改为p；When：静态SSR；Then：DEV抛只读属性错误，production输出包含p。目的：DEV浅冻结child数组阻止原地修改，生产输入未冻结。 */
  it('should throw (in dev) when children are mutated during render', () => {

    /**
     * 故意原地改children数组第2项；DEV冻结导致抛错，production可改成p。
     * @param props - children是三个带key的span组成的数组。
     * @returns 修改后children的div。
     */
    function Wrapper(props) {
      props.children[1] = <p key={1} />; // 突变是违法的
      return <div>{props.children}</div>;
    }
    if (__DEV__) {
      expect(() => {
        ReactDOMServer.renderToStaticMarkup(
          <Wrapper>
            <span key={0} />
            <span key={1} />
            <span key={2} />
          </Wrapper>,
        );
      }).toThrowError(/Cannot assign to read only property.*/);
    } else {
      expect(
        ReactDOMServer.renderToStaticMarkup(
          <Wrapper>
            <span key={0} />
            <span key={1} />
            <span key={2} />
          </Wrapper>,
        ),
      ).toContain('<p>');
    }
  });

  /** Given：HTML inPUT、SVG内linearGradient、foreignObject内iFrame经CompositeG包装；When：静态SSR；Then：仅消费inPUT和iFrame大小写警告，不含linearGradient。目的：SVG命名空间经组件传递且foreignObject切回HTML。 */
  it('warns about lowercase html but not in svg tags', () => {

    /**
     * 用复合组件包住SVG g，保持当前命名空间传给children。
     * @param props - children包括linearGradient与foreignObject。
     * @returns g元素。
     */
    function CompositeG(props) {
      // 确保命名空间通过复合组件传递
      return <g>{props.children}</g>;
    }
    ReactDOMServer.renderToStaticMarkup(
      <div>
        <inPUT />
        <svg>
          <CompositeG>
            <linearGradient />
            <foreignObject>
              {/* 回到 HTML */}
              <iFrame />
            </foreignObject>
          </CompositeG>
        </svg>
      </div>,
    );
    assertConsoleErrorDev([
      '<inPUT /> is using incorrect casing. ' +
        'Use PascalCase for React components, ' +
        'or lowercase for HTML elements.\n' +
        '    in inPUT (at **)',
      // linearGradient 不会警告
      '<iFrame /> is using incorrect casing. ' +
        'Use PascalCase for React components, ' +
        'or lowercase for HTML elements.\n' +
        '    in iFrame (at **)',
    ]);
  });

  /** Given：contentEditable div同时有children空串；When：renderToString；Then：消费React管理children的编辑冲突警告。目的：即使文字为空，显式children配置也触发检查。 */
  it('should warn about contentEditable and children', () => {
    ReactDOMServer.renderToString(<div contentEditable={true} children="" />);
    assertConsoleErrorDev([
      'A component is `contentEditable` and contains `children` ' +
        'managed by React. It is now your responsibility to guarantee that ' +
        'none of those nodes are unexpectedly modified or duplicated. This ' +
        'is probably not intentional.\n' +
        '    in div (at **)',
    ]);
  });

  /** Given：带render方法却未extends React.Component的类；When：两次SSR；Then：两次均抛TypeError，首次消费类协议警告、再次不重复。目的：诊断去重不吞运行时错误。 */
  it('should warn when server rendering a class with a render method that does not extend React.Component', () => {

    /** 故意不继承React.Component却定义render，触发诊断及类作为普通函数调用的TypeError。 */
    class ClassWithRenderNotExtended {

      /**
       * 声明一个看似类组件的render，正常识别失败路径不会按有效类协议调用它。
       * @returns 空div。
       */
      render() {
        return <div />;
      }
    }

    expect(() =>
      ReactDOMServer.renderToString(<ClassWithRenderNotExtended />),
    ).toThrow(TypeError);
    assertConsoleErrorDev([
      'The <ClassWithRenderNotExtended /> component appears to have a render method, ' +
        "but doesn't extend React.Component. This is likely to cause errors. " +
        'Change ClassWithRenderNotExtended to extend React.Component instead.\n' +
        '    in ClassWithRenderNotExtended (at **)',
    ]);

    // 测试去重逻辑。
    expect(() => {
      ReactDOMServer.renderToString(<ClassWithRenderNotExtended />);
    }).toThrow(TypeError);
  });

  // 我们只是测试导入，而不是使用它。 这是因为即使是在是模块化组件中，它也可能导入它。

  /** Given：Node中window/requestAnimationFrame/requestIdleCallback完全不存在，否则fixture主动失败；When：resetModules后require react-dom；Then：不抛错。目的：只证明无浏览器全局时可导入，不证明能调用DOM API。 */
  it('can import react-dom in Node environment', () => {
    if (
      typeof requestAnimationFrame !== 'undefined' ||
      global.hasOwnProperty('requestAnimationFrame') ||
      typeof requestIdleCallback !== 'undefined' ||
      global.hasOwnProperty('requestIdleCallback') ||
      typeof window !== 'undefined' ||
      global.hasOwnProperty('window')
    ) {
      // 不要删除此检查：本测试专门验证这些全局变量不存在时的行为，否则测试没有意义。
      throw new Error('Expected this test to run in a Node environment.');
    }
    jest.resetModules();
    expect(() => {
      require('react-dom');
    }).not.toThrow();
  });

  /** Given：App/Child/B/C包装里span误写ariaTypo和ariaTypo2；When：SSR；Then：两条警告分别携带span/B/Child/App与span/Child/App路径。目的：诊断栈标出产生无效属性的创建链。 */
  it('includes a useful stack in warnings', () => {

    /**
     * 返回null的无警告兄弟组件，帮助测试栈定位跳过无关分支。
     * @returns null。
     */
    function A() {
      return null;
    }

    /**
     * 在font/C内创建ariaTypo错名span，验证owner诊断栈包含B。
     * @returns 嵌套元素树。
     */
    function B() {
      return (
        <font>
          <C>
            <span ariaTypo="no" />
          </C>
        </font>
      );
    }

    /** 渲染children的类包装，测试警告栈不把无关父宿主包装混作创建者。 */
    class C extends React.Component {

      /**
       * 用b包住原children。
       * @returns b元素。
       */
      render() {
        return <b>{this.props.children}</b>;
      }
    }

    /**
     * 组合无UI A、含ARIA错误的B及另一个错名span。
     * @returns 三个带key的children。
     */
    function Child() {
      return [<A key="1" />, <B key="2" />, <span ariaTypo2="no" key="3" />];
    }

    /**
     * 构造外App的div/section/span/Child路径。
     * @returns 带诊断fixture的宿主树。
     */
    function App() {
      return (
        <div>
          <section />
          <span>
            <Child />
          </span>
        </div>
      );
    }

    ReactDOMServer.renderToString(<App />);
    assertConsoleErrorDev([
      'Invalid ARIA attribute `ariaTypo`. ARIA attributes follow the pattern aria-* and must be lowercase.\n' +
        '    in span (at **)\n' +
        '    in B (at **)\n' +
        '    in Child (at **)\n' +
        '    in App (at **)',
      'Invalid ARIA attribute `ariaTypo2`. ARIA attributes follow the pattern aria-* and must be lowercase.\n' +
        '    in span (at **)\n' +
        '    in Child (at **)\n' +
        '    in App (at **)',
    ]);
  });

  /** Given：App内Child→App2→blink形成多层renderToString重入及五个ARIA错名；When：外SSR；Then：五条警告顺序和各自App/Child/App2/Child2路径匹配。目的：重入建立并恢复可读组件栈。 */
  it('reports stacks with re-entrant renderToString() calls', () => {

    /**
     * 给span添ariaTypo3并容纳内层SSR字符串。
     * @param props - children为内请求结果字符串。
     * @returns 错名属性span。
     */
    function Child2(props) {
      return <span ariaTypo3="no">{props.children}</span>;
    }

    /**
     * 在自己的render中再次SSR blink，形成第二层请求重入。
     * @returns 包含内标记文字的Child2元素。
     */
    function App2() {
      return (
        <Child2>
          {ReactDOMServer.renderToString(<blink ariaTypo2="no" />)}
        </Child2>
      );
    }

    /**
     * 再调用App2的字符串SSR并把其标记作为文本children。
     * @returns 带ariaTypo4的span。
     */
    function Child() {
      return (
        <span ariaTypo4="no">{ReactDOMServer.renderToString(<App2 />)}</span>
      );
    }

    /**
     * 外层请求制造首尾ARIA错名，并在中间触发Child重入。
     * @returns div内三分支。
     */
    function App() {
      return (
        <div>
          <span ariaTypo="no" />
          <Child />
          <font ariaTypo5="no" />
        </div>
      );
    }

    ReactDOMServer.renderToString(<App />);
    assertConsoleErrorDev([
      // ReactDOMServer(App > div > span)
      'Invalid ARIA attribute `ariaTypo`. ARIA attributes follow the pattern aria-* and must be lowercase.\n' +
        '    in span (at **)\n' +
        '    in App (at **)',
      // ReactDOMServer(App > div > Child) >>> ReactDOMServer(App2) >>> ReactDOMServer(blink)
      'Invalid ARIA attribute `ariaTypo2`. ARIA attributes follow the pattern aria-* and must be lowercase.\n' +
        '    in blink (at **)\n' +
        '    in App2 (at **)\n' +
        '    in Child (at **)\n' +
        '    in App (at **)',
      // ReactDOMServer(App > div > Child) >>> ReactDOMServer(App2 > Child2 > span)
      'Invalid ARIA attribute `ariaTypo3`. ARIA attributes follow the pattern aria-* and must be lowercase.\n' +
        '    in span (at **)\n' +
        '    in Child2 (at **)\n' +
        '    in App2 (at **)\n' +
        '    in Child (at **)\n' +
        '    in App (at **)',
      // ReactDOMServer(App > div > Child > span)
      'Invalid ARIA attribute `ariaTypo4`. ARIA attributes follow the pattern aria-* and must be lowercase.\n' +
        '    in span (at **)\n' +
        '    in Child (at **)\n' +
        '    in App (at **)',
      // ReactDOMServer(App > div > font)
      'Invalid ARIA attribute `ariaTypo5`. ARIA attributes follow the pattern aria-* and must be lowercase.\n' +
        '    in font (at **)\n' +
        '    in App (at **)',
    ]);
  });

  /** Given：ComponentA.contextType=Context.Consumer，B.contextType=Context.Provider；When：两次渲染A后渲染B；Then：A仅首次警告Consumer误用，B不警告。目的：按组件类型去重；本版本Provider就是Context对象。 */
  it('should warn if an invalid contextType is defined', () => {
    const Context = React.createContext();

    /** 误把Context.Consumer配置为contextType的类fixture。 */
    class ComponentA extends React.Component {

      /** 故意使用Consumer描述符而非Context对象，首次渲染按类型诊断。 */
      static contextType = Context.Consumer;

      /**
       * 返回空div以单独观察contextType校验警告。
       * @returns 空div。
       */
      render() {
        return <div />;
      }
    }

    ReactDOMServer.renderToString(<ComponentA />);
    assertConsoleErrorDev([
      'ComponentA defines an invalid contextType. ' +
        'contextType should point to the Context object returned by React.createContext(). ' +
        'Did you accidentally pass the Context.Consumer instead?\n' +
        '    in ComponentA (at **)',
    ]);

    // 警告应按组件类型去重
    ReactDOMServer.renderToString(<ComponentA />);

    /** 把Context.Provider配置为contextType的对照类；本版本Provider引用Context自身，所以合法。 */
    class ComponentB extends React.Component {

      /** Context.Provider与Context对象同一身份，此配置不应警告。 */
      static contextType = Context.Provider;

      /**
       * 返回空div，无额外Context字段读取。
       * @returns 空div。
       */
      render() {
        return <div />;
      }
    }
    // 不会警告，因为 Context 等于 Context.Provider。
    ReactDOMServer.renderToString(<ComponentB />);
  });

  /** Given：Foo.contextType=null且render读this.context.hello.world；When：SSR；Then：抛读取world的错误，未配置contextType诊断断言。目的：null合法禁用Context，组件自己错误访问仍会失败。 */
  it('should not warn when class contextType is null', () => {

    /** contextType=null的类fixture；无Context警告但错误嵌套读取仍会抛。 */
    class Foo extends React.Component {

      /** 显式关闭Context关联的合法空配置，用于条件式声明。 */
      static contextType = null; // 用于条件声明的便捷方法

      /**
       * 故意读取未提供的hello.world以区分配置合法性与用户render错误。
       * @returns 实际不返回，读取world时抛错。
       */
      render() {
        return this.context.hello.world;
      }
    }

    expect(() => {
      ReactDOMServer.renderToString(<Foo />);
    }).toThrow("Cannot read property 'world' of undefined");
  });

  /** Given：Foo.contextType=undefined且render读嵌套字段；When：SSR；Then：读取world错误并消费undefined contextType提示。目的：区别合法null与疑似错导入的undefined。 */
  it('should warn when class contextType is undefined', () => {

    /** undefined contextType的类fixture，模拟未定义Context引用。 */
    class Foo extends React.Component {
      // 这通常发生在循环依赖中 https://github.com/facebook/react/issues/13969
      /** 非法undefined配置；现有issue说明其可能来自循环导入，测试只证明诊断输入。 */
      static contextType = undefined;

      /**
       * 在未取得有效Context值时错误读取嵌套字段。
       * @returns 实际读取world时抛错。
       */
      render() {
        return this.context.hello.world;
      }
    }

    expect(() => {
      ReactDOMServer.renderToString(<Foo />);
    }).toThrow("Cannot read property 'world' of undefined");
    assertConsoleErrorDev([
      'Foo defines an invalid contextType. ' +
        'contextType should point to the Context object returned by React.createContext(). ' +
        'However, it is set to undefined. ' +
        'This can be caused by a typo or by mixing up named and default imports. ' +
        'This can also happen due to a circular dependency, ' +
        'so try moving the createContext() call to a separate file.\n' +
        '    in Foo (at **)',
    ]);
  });

  /** Given：Foo.contextType为{x:42,y:hello}普通对象；When：SSR；Then：读取hello错误及列出keys x/y的诊断。目的：普通对象不满足Context品牌协议。 */
  it('should warn when class contextType is an object', () => {

    /** 普通对象contextType fixture，验证错误消息列出对象键。 */
    class Foo extends React.Component {
      // 可能是由于拼写错误引起的。
      /** 包含x/y的普通对象不具Context品牌，不能用作contextType。 */
      static contextType = {
        x: 42,
        y: 'hello',
      };

      /**
       * 非法Context读取后访问hello.world。
       * @returns 不返回，读取hello时抛错。
       */
      render() {
        return this.context.hello.world;
      }
    }

    expect(() => {
      ReactDOMServer.renderToString(<Foo />);
    }).toThrow("Cannot read property 'hello' of undefined");
    assertConsoleErrorDev([
      'Foo defines an invalid contextType. ' +
        'contextType should point to the Context object returned by React.createContext(). ' +
        'However, it is set to an object with keys {x, y}.\n' +
        '    in Foo (at **)',
    ]);
  });

  /** Given：Foo.contextType为字符串foo；When：SSR；Then：读取world错误及contextType字符串诊断。目的：原语不能作为Context对象。 */
  it('should warn when class contextType is a primitive', () => {

    /** 以字符串代替Context的类fixture。 */
    class Foo extends React.Component {

      /** 故意传字符串foo，验证原语Context配置诊断。 */
      static contextType = 'foo';

      /**
       * 错误读取this.context.hello.world。
       * @returns 不返回，读取world时抛错。
       */
      render() {
        return this.context.hello.world;
      }
    }

    expect(() => {
      ReactDOMServer.renderToString(<Foo />);
    }).toThrow("Cannot read property 'world' of undefined");
    assertConsoleErrorDev([
      'Foo defines an invalid contextType. ' +
        'contextType should point to the Context object returned by React.createContext(). ' +
        'However, it is set to a string.\n' +
        '    in Foo (at **)',
    ]);
  });

  describe('custom element server rendering', () => {

    /** Given：my-custom-element的foo为bar字符串；When：字符串SSR；Then：严格输出foo="bar"。目的：可序列化的自定义属性进入HTML。 */
    it('String properties should be server rendered for custom elements', () => {
      const output = ReactDOMServer.renderToString(
        <my-custom-element foo="bar" />,
      );
      expect(output).toBe(`<my-custom-element foo="bar"></my-custom-element>`);
    });

    /** Given：自定义元素foo为数值5；When：字符串SSR；Then：严格输出foo="5"。目的：数值属性可序列化。 */
    it('Number properties should be server rendered for custom elements', () => {
      const output = ReactDOMServer.renderToString(
        <my-custom-element foo={5} />,
      );
      expect(output).toBe(`<my-custom-element foo="5"></my-custom-element>`);
    });

    /** Given：自定义元素foo为对象{foo:bar}；When：字符串SSR；Then：严格为空属性的自定义标签。目的：服务器不把对象强制字符串化。 */
    it('Object properties should not be server rendered for custom elements', () => {
      const output = ReactDOMServer.renderToString(
        <my-custom-element foo={{foo: 'bar'}} />,
      );
      expect(output).toBe(`<my-custom-element></my-custom-element>`);
    });

    /** Given：自定义元素foo为数组foo/bar；When：字符串SSR；Then：严格为空属性标签。目的：数组属于非序列化属性输入。 */
    it('Array properties should not be server rendered for custom elements', () => {
      const output = ReactDOMServer.renderToString(
        <my-custom-element foo={['foo', 'bar']} />,
      );
      expect(output).toBe(`<my-custom-element></my-custom-element>`);
    });

    /** Given：自定义元素foo为打印bar的函数；When：字符串SSR；Then：严格为空属性标签。目的：函数不输出为HTML属性，也未被调用。 */
    it('Function properties should not be server rendered for custom elements', () => {
      const output = ReactDOMServer.renderToString(
        <my-custom-element foo={() => console.log('bar')} />,
      );
      expect(output).toBe(`<my-custom-element></my-custom-element>`);
    });
  });
});
