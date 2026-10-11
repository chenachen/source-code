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
let act;
let Scheduler;
let waitForAll;
let waitFor;
let assertLog;
let assertConsoleErrorDev;

/**
 * 规范化组件栈中at/in行，移除名称的点号前缀并把含数字的位置统一为(at **)；假值短路原样返回，其他未匹配文本保留。
 * @param str 错误组件栈文本或假值。
 * @returns 稳定化栈文本。
 */
function normalizeCodeLocInfo(str) {
  return (
    str &&
    str.replace(/^ +(?:at|in) ([\S]+)[^\n]*/gm, function (m, name) {
      const dot = name.lastIndexOf('.');
      if (dot !== -1) {
        name = name.slice(dot + 1);
      }
      return '    in ' + name + (/\d/.test(m) ? ' (at **)' : '');
    })
  );
}

// 每例resetModules重新加载React/DOM、mock Scheduler及internal-test-utils，使用统一act与日志等待工具；findDOMNode取当前DOM内部入口。
describe('ReactUpdates', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    findDOMNode =
      ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
        .findDOMNode;
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
    Scheduler = require('scheduler');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    waitFor = InternalTestUtils.waitFor;
    assertLog = InternalTestUtils.assertLog;
  });

  // 注意：这基于 www 中使用的同类组件；额外的 div wrapper 不再必要后即可删除本组件。

  /**
   * 测试用LegacyHidden包装：外层div负责真实hidden属性，内部把hidden模式改为unstable-defer-without-hiding，让DOM隐藏与低优先级渲染分开控制。
   * @param children 延后或正常渲染的子树。
   * @param mode LegacyHidden模式。
   * @returns 双层包装。
   */
  function LegacyHiddenDiv({children, mode}) {
    return (
      <div hidden={mode === 'hidden'}>
        <React.unstable_LegacyHidden
          mode={mode === 'hidden' ? 'unstable-defer-without-hiding' : mode}>
          {children}
        </React.unstable_LegacyHidden>
      </div>
    );
  }

  /** 初值0，同一act依次setState(1)、setState(2)；回调内部状态探针/DOM仍0且无commit，结束后均2、仅一次layout Commit，验证同Hook更新合批。 */
  it('should batch state when updating state twice', async () => {
    let componentState;
    let setState;

    /**
     * 发布Hook state与setter到测试探针，layout effect每次提交记Commit，DOM显示当前值，用于同Hook双更新合批。
     * @returns 状态div。
     */
    function Component() {
      const [state, _setState] = React.useState(0);
      componentState = state;
      setState = _setState;
      React.useLayoutEffect(() => {
        Scheduler.log('Commit');
      });

      return <div>{state}</div>;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component />);
    });

    assertLog(['Commit']);
    expect(container.firstChild.textContent).toBe('0');

    await act(() => {
      setState(1);
      setState(2);
      expect(componentState).toBe(0);
      expect(container.firstChild.textContent).toBe('0');
      assertLog([]);
    });

    expect(componentState).toBe(2);
    assertLog(['Commit']);
    expect(container.firstChild.textContent).toBe('2');
  });

  /** 两个Hook初值均0，同一act分别更新为1/2；批次内探针与DOM仍0 0，结束后1 2且一次Commit，验证不同Hook共享一次提交。 */
  it('should batch state when updating two different states', async () => {
    let componentStateA;
    let componentStateB;
    let setStateA;
    let setStateB;

    /**
     * 发布两个独立Hook的值与setter，每次layout提交仅记一次Commit，DOM同时显示A/B，观察跨Hook合批。
     * @returns 双状态div。
     */
    function Component() {
      const [stateA, _setStateA] = React.useState(0);
      const [stateB, _setStateB] = React.useState(0);
      componentStateA = stateA;
      componentStateB = stateB;
      setStateA = _setStateA;
      setStateB = _setStateB;

      React.useLayoutEffect(() => {
        Scheduler.log('Commit');
      });

      return (
        <div>
          {stateA} {stateB}
        </div>
      );
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component />);
    });

    assertLog(['Commit']);
    expect(container.firstChild.textContent).toBe('0 0');

    await act(() => {
      setStateA(1);
      setStateB(2);
      expect(componentStateA).toBe(0);
      expect(componentStateB).toBe(0);
      expect(container.firstChild.textContent).toBe('0 0');
      assertLog([]);
    });

    expect(componentStateA).toBe(1);
    expect(componentStateB).toBe(2);
    assertLog(['Commit']);
    expect(container.firstChild.textContent).toBe('1 2');
  });

  /** 同act将root prop从0改1并将Hook state改2；批次内旧prop/state/DOM保留，结束后1 2且一次Commit，验证root输入与组件更新合批。 */
  it('should batch state and props together', async () => {
    let setState;
    let componentProp;
    let componentState;

    /**
     * 把prop与Hook state发布到外部探针并显示在DOM，layout记录Commit，比较root输入更新和本地更新是否一起提交。
     * @param prop 根传入的数值。
     * @returns prop/state div。
     */
    function Component({prop}) {
      const [state, _setState] = React.useState(0);
      componentProp = prop;
      componentState = state;
      setState = _setState;

      React.useLayoutEffect(() => {
        Scheduler.log('Commit');
      });

      return (
        <div>
          {prop} {state}
        </div>
      );
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component prop={0} />);
    });

    assertLog(['Commit']);
    expect(container.firstChild.textContent).toBe('0 0');

    await act(() => {
      root.render(<Component prop={1} />);
      setState(2);
      expect(componentProp).toBe(0);
      expect(componentState).toBe(0);
      expect(container.firstChild.textContent).toBe('0 0');
      assertLog([]);
    });

    expect(componentProp).toBe(1);
    expect(componentState).toBe(2);
    assertLog(['Commit']);
    expect(container.firstChild.textContent).toBe('1 2');
  });

  /** 父/子Hook均0，先更新父1再子2；批次内DOM不变，结束后子显示1 2，layout日志Child Commit→Parent Commit，验证父先入队的合批与提交顺序。 */
  it('should batch parent/child state updates together', async () => {
    let childRef;
    let parentState;
    let childState;
    let setParentState;
    let setChildState;

    /**
     * 发布父Hook state/setter，将state传Child prop，layout记录Parent Commit，用于父先排更新场景。
     * @returns Child包装。
     */
    function Parent() {
      const [state, _setState] = React.useState(0);
      parentState = state;
      setParentState = _setState;

      React.useLayoutEffect(() => {
        Scheduler.log('Parent Commit');
      });

      return (
        <div>
          <Child prop={state} />
        </div>
      );
    }

    /**
     * 发布子Hook值/setter，ref保存实际div，layout记录Child Commit，显示父prop与本地state。
     * @param prop 父state值。
     * @returns 观测div。
     */
    function Child({prop}) {
      const [state, _setState] = React.useState(0);
      childState = state;
      setChildState = _setState;

      React.useLayoutEffect(() => {
        Scheduler.log('Child Commit');
      });

      return (
        <div
          ref={ref => {
            childRef = ref;
          }}>
          {prop} {state}
        </div>
      );
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });

    assertLog(['Child Commit', 'Parent Commit']);
    expect(childRef.textContent).toBe('0 0');

    await act(() => {
      // 先更新父组件。
      setParentState(1);
      setChildState(2);
      expect(parentState).toBe(0);
      expect(childState).toBe(0);
      expect(childRef.textContent).toBe('0 0');
      assertLog([]);
    });

    expect(parentState).toBe(1);
    expect(childState).toBe(2);
    expect(childRef.textContent).toBe('1 2');
    assertLog(['Child Commit', 'Parent Commit']);
  });

  /** 父/子Hook均0，改为先子2再父1；仍在批次结束显示1 2并Child→Parent Commit，验证入队顺序不导致两次提交。 */
  it('should batch child/parent state updates together', async () => {
    let childRef;
    let parentState;
    let childState;
    let setParentState;
    let setChildState;

    /**
     * 发布父状态和setter并把state交给Child，用layout日志比较子先入队时的提交顺序。
     * @returns Child包装。
     */
    function Parent() {
      const [state, _setState] = React.useState(0);
      parentState = state;
      setParentState = _setState;

      React.useLayoutEffect(() => {
        Scheduler.log('Parent Commit');
      });

      return (
        <div>
          <Child prop={state} />
        </div>
      );
    }

    /**
     * 发布子状态/setter并保存DOM ref，显示父prop及本地state，用layout记录子提交。
     * @param prop 父状态值。
     * @returns 状态div。
     */
    function Child({prop}) {
      const [state, _setState] = React.useState(0);
      childState = state;
      setChildState = _setState;

      React.useLayoutEffect(() => {
        Scheduler.log('Child Commit');
      });

      return (
        <div
          ref={ref => {
            childRef = ref;
          }}>
          {prop} {state}
        </div>
      );
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });

    assertLog(['Child Commit', 'Parent Commit']);
    expect(childRef.textContent).toBe('0 0');

    await act(() => {
      // 子组件先更新。
      setChildState(2);
      setParentState(1);
      expect(parentState).toBe(0);
      expect(childState).toBe(0);
      expect(childRef.textContent).toBe('0 0');
      assertLog([]);
    });

    expect(parentState).toBe(1);
    expect(childState).toBe(2);
    expect(childRef.textContent).toBe('1 2');
    assertLog(['Child Commit', 'Parent Commit']);
  });

  /** 类state.x=0，setState(1)的提交回调中再setState(2)；两层回调各读到对应state/DOM并各一次didUpdate，最终x=2且内层回调执行，验证提交回调串联后续批次。 */
  it('should support chained state updates', async () => {
    let instance;

    /** 类更新回调链夹具，公开实例并在didUpdate记录Update，用state.x和DOM对比每次提交完成。 */
    class Component extends React.Component {

      /** x初值0，后续两层setState回调分别将其更新为1和2。 */
      state = {x: 0};

      /**
       * 调用父构造器并把this发布为instance，供测试排带提交回调的更新。
       * @param props 初始组件输入。
       */
      constructor(props) {
        super(props);
        instance = this;
      }

      /** 每次更新提交记Update，嵌套setState回调分别消费各自提交日志。 */
      componentDidUpdate() {
        Scheduler.log('Update');
      }

      /**
       * 将state.x显示到div，供提交回调核对DOM与state同步。
       * @returns 状态div。
       */
      render() {
        return <div>{this.state.x}</div>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component />);
    });

    expect(instance.state.x).toBe(0);
    expect(container.firstChild.textContent).toBe('0');

    let innerCallbackRun = false;
    await act(() => {
      instance.setState({x: 1}, function () {
        instance.setState({x: 2}, function () {
          innerCallbackRun = true;
          expect(instance.state.x).toBe(2);
          expect(container.firstChild.textContent).toBe('2');
          assertLog(['Update']);
        });
        expect(instance.state.x).toBe(1);
        expect(container.firstChild.textContent).toBe('1');
        assertLog(['Update']);
      });
      expect(instance.state.x).toBe(0);
      expect(container.firstChild.textContent).toBe('0');
      assertLog([]);
    });

    assertLog([]);
    expect(instance.state.x).toBe(2);
    expect(innerCallbackRun).toBeTruthy();
    expect(container.firstChild.textContent).toBe('2');
  });

  /** 同act入队setState(1)及forceUpdate，各附回调；批次内仍0，结束后1且shouldComponentUpdate调用数0，日志Update→callback→forceUpdate，验证强制更新与state合并且回调依入队顺序。 */
  it('should batch forceUpdate together', async () => {
    let instance;
    let shouldUpdateCount = 0;

    /** state与forceUpdate合批夹具，记录shouldComponentUpdate调用数与提交日志。 */
    class Component extends React.Component {

      /** x从0起步，同批普通setState把它改1，forceUpdate保留该结果。 */
      state = {x: 0};

      /**
       * 初始化React实例并发布为instance，供测试同时排普通和强制更新。
       * @param props 初始输入。
       */
      constructor(props) {
        super(props);
        instance = this;
      }

      /** 只累加shouldUpdateCount，返回undefined；本例forceUpdate必须绕过此方法，因此预期调用数0。 */
      shouldComponentUpdate() {
        shouldUpdateCount++;
      }

      /** 更新提交时记Update，用于核对它先于两个更新回调。 */
      componentDidUpdate() {
        Scheduler.log('Update');
      }

      /**
       * 输出state.x到div，比较批次内旧值与提交后新值。
       * @returns 状态div。
       */
      render() {
        return <div>{this.state.x}</div>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component />);
    });

    assertLog([]);
    expect(instance.state.x).toBe(0);

    await act(() => {
      instance.setState({x: 1}, function () {
        Scheduler.log('callback');
      });
      instance.forceUpdate(function () {
        Scheduler.log('forceUpdate');
      });
      assertLog([]);
      expect(instance.state.x).toBe(0);
      expect(container.firstChild.textContent).toBe('0');
    });

    // shouldComponentUpdate 不应被调用，因为我们强制执行了。
    expect(shouldUpdateCount).toBe(0);
    assertLog(['Update', 'callback', 'forceUpdate']);
    expect(instance.state.x).toBe(1);
    expect(container.firstChild.textContent).toBe('1');
  });

  /** Parent的shouldComponentUpdate始终false，先改父state无新render，再改ref指向Child的state仅记录Child render，验证父bailout仍允许子自身更新。 */
  it('should update children even if parent blocks updates', async () => {
    let instance;

    /** 始终拒绝父render更新的类夹具，用childRef允许测试单独对子实例排更新。 */
    class Parent extends React.Component {

      /** 保存Child实例，供父bailout后直接触发子state更新。 */
      childRef = React.createRef();

      /**
       * 初始化实例并发布为instance，让测试更新父与子两个独立队列。
       * @param props 初始输入。
       */
      constructor(props) {
        super(props);
        instance = this;
      }

      /**
       * 固定false阻止父本次render，但不清除子组件自身的待处理更新。
       * @returns false。
       */
      shouldComponentUpdate() {
        return false;
      }

      /**
       * 记录Parent render并创建带实例ref的Child。
       * @returns Child。
       */
      render() {
        Scheduler.log('Parent render');
        return <Child ref={this.childRef} />;
      }
    }

    /** 可自身排state更新的子夹具，输出与state无关但render日志可观察更新是否执行。 */
    class Child extends React.Component {

      /**
       * 记录Child render并返回空div，检查父阻止更新后子仍能render。
       * @returns div。
       */
      render() {
        Scheduler.log('Child render');
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });

    assertLog(['Parent render', 'Child render']);

    await act(() => {
      instance.setState({x: 1});
    });

    assertLog([]);

    await act(() => {
      instance.childRef.current.setState({x: 1});
    });

    assertLog(['Child render']);
  });

  /** Top创建Bottom元素并作为Middle的children，Middle挂载后forceUpdate但仍返回同一children对象；日志Middle→Bottom→Middle，验证相同子元素身份复用使Bottom跳过第二次render。 */
  it('should not reconcile children passed via props', async () => {

    /** owner夹具，只在首挂创建Bottom元素并作为Middle children传入。 */
    class Top extends React.Component {

      /**
       * 创建Middle及Bottom元素，后续Middle自身forceUpdate不重新执行此owner。
       * @returns Middle树。
       */
      render() {
        return (
          <Middle>
            <Bottom />
          </Middle>
        );
      }
    }

    /** 透传同一children对象并在挂载后forceUpdate的夹具，验证子元素身份复用。 */
    class Middle extends React.Component {

      /** 挂载提交后forceUpdate自身，安排第二次Middle render而不重新创建Bottom元素。 */
      componentDidMount() {
        this.forceUpdate();
      }

      /**
       * 记录Middle并用Children.only取唯一children，返回的是owner创建的同一元素对象。
       * @returns 唯一子元素。
       */
      render() {
        Scheduler.log('Middle');
        return React.Children.only(this.props.children);
      }
    }

    /** 日志叶子夹具，判断Middle再次render是否连带执行Bottom。 */
    class Bottom extends React.Component {

      /**
       * 记录Bottom并返回null，初挂一次、相同元素复用时不再调用。
       * @returns null。
       */
      render() {
        Scheduler.log('Bottom');
        return null;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Top />);
    });

    assertLog(['Middle', 'Bottom', 'Middle']);
  });

  /** 对Switcher/Box/Child的不同组合正序、逆序setState，用mixin采集will/did日志；然而expectUpdates用i<数组而非数组.length，非数值字符串数组转NaN使断言循环不执行，仅清空日志，不能据此证明列出的生命周期顺序。 */
  it('should flow updates correctly', async () => {
    let willUpdates = [];
    let didUpdates = [];
    let instance;

    const UpdateLoggingMixin = {

      /** mixin更新前记录this.constructor.displayName；本例类未另设displayName，且expectUpdates循环未有效检查列表。 */
      UNSAFE_componentWillUpdate: function () {
        willUpdates.push(this.constructor.displayName);
      },

      /** mixin更新后记录this.constructor.displayName，供预期顺序列表使用；现有helper未执行该列表断言。 */
      componentDidUpdate: function () {
        didUpdates.push(this.constructor.displayName);
      },
    };

    /** Switcher的包装类，保存div DOM ref并透传children，可由测试独立setState。 */
    class Box extends React.Component {

      /** 保存Box对应的宿主div，和类实例ref区分。 */
      boxDivRef = React.createRef();

      /**
       * 以boxDivRef挂接div并透传children，更新逻辑来自prototype mixin。
       * @returns div。
       */
      render() {
        return <div ref={this.boxDivRef}>{this.props.children}</div>;
      }
    }
    Object.assign(Box.prototype, UpdateLoggingMixin);

    /** 可独立更新的Child类，用spanRef保留DOM，更新生命周期通过mixin加入。 */
    class Child extends React.Component {

      /** 保存Child实际span节点，区分于App的Child实例ref。 */
      spanRef = React.createRef();

      /**
       * 输出固定child文本并挂接spanRef，供更新遍历树使用。
       * @returns span。
       */
      render() {
        return <span ref={this.spanRef}>child</span>;
      }
    }
    Object.assign(Child.prototype, UpdateLoggingMixin);

    /** 按tabKey决定包装div显示状态的Switcher，children对象由App创建，Box实例可独立更新。 */
    class Switcher extends React.Component {

      /** tabKey初值hello，与Child元素key匹配时使style.display为空字符串。 */
      state = {tabKey: 'hello'};

      /** 保存内部Box类实例，供testUpdates把Box加入更新组合。 */
      boxRef = React.createRef();

      /** 保存Switcher内部宿主div。 */
      switcherDivRef = React.createRef();

      /**
       * 读取children.key比较state.tabKey，设置内部div display并透传同一children到Box；本例不修改tabKey。
       * @returns Box包装树。
       */
      render() {
        const child = this.props.children;

        return (
          <Box ref={this.boxRef}>
            <div
              ref={this.switcherDivRef}
              style={{
                display: this.state.tabKey === child.key ? '' : 'none',
              }}>
              {child}
            </div>
          </Box>
        );
      }
    }
    Object.assign(Switcher.prototype, UpdateLoggingMixin);

    /** 持有Switcher/Child实例ref的owner夹具，为多组件更新组合提供引用。 */
    class App extends React.Component {

      /** 保存Switcher实例，间接访问其Box实例。 */
      switcherRef = React.createRef();

      /** 保存Child实例，使其能与Switcher/Box组合更新。 */
      childRef = React.createRef();

      /**
       * 初始化并发布App实例，供测试取得两个实例ref。
       * @param props 初始输入。
       */
      constructor(props) {
        super(props);
        instance = this;
      }

      /**
       * 创建key=hello的Child作为Switcher children；子元素owner为App，DOM层级由Switcher/Box安排。
       * @returns Switcher树。
       */
      render() {
        return (
          <Switcher ref={this.switcherRef}>
            <Child key="hello" ref={this.childRef} />
          </Switcher>
        );
      }
    }
    Object.assign(App.prototype, UpdateLoggingMixin);

    const container = document.createElement('div');
    await act(() => {
      ReactDOMClient.createRoot(container).render(<App />);
    });

    /**
     * 原意检查will/did成员后清空日志；实际循环条件把i与整个期望数组比较，字符串数组转NaN使两循环跳过。本helper目前只清空列表，不能证明生命周期顺序。
     * @param desiredWillUpdates 期望will名称数组。
     * @param desiredDidUpdates 期望did名称数组。
     */
    function expectUpdates(desiredWillUpdates, desiredDidUpdates) {
      let i;
      for (i = 0; i < desiredWillUpdates; i++) {
        expect(willUpdates).toContain(desiredWillUpdates[i]);
      }
      for (i = 0; i < desiredDidUpdates; i++) {
        expect(didUpdates).toContain(desiredDidUpdates[i]);
      }
      willUpdates = [];
      didUpdates = [];
    }

    /**
     * 对传入类实例排state.x=1，即使其render不读x也触发更新遍历。
     * @param c 要更新的组件实例。
     */
    function triggerUpdate(c) {
      c.setState({x: 1});
    }

    /**
     * 分别正序和逆序遍历components，在独立act批次内triggerUpdate，再调用expectUpdates；注意后者的循环缺陷使期望日志未有效断言。
     * @param components 更新实例数组。
     * @param desiredWillUpdates 期望will名称列表。
     * @param desiredDidUpdates 期望did名称列表。
     * @returns 两批更新完成的promise。
     */
    async function testUpdates(
      components,
      desiredWillUpdates,
      desiredDidUpdates,
    ) {
      let i;

      await act(() => {
        for (i = 0; i < components.length; i++) {
          triggerUpdate(components[i]);
        }
      });

      expectUpdates(desiredWillUpdates, desiredDidUpdates);

      // 尝试从后向前排列它们。

      await act(() => {
        for (i = components.length - 1; i >= 0; i--) {
          triggerUpdate(components[i]);
        }
      });

      expectUpdates(desiredWillUpdates, desiredDidUpdates);
    }
    await testUpdates(
      [
        instance.switcherRef.current.boxRef.current,
        instance.switcherRef.current,
      ],
      // 此处列出Switcher→Box父子更新的期望顺序；expectUpdates当前循环未执行列表断言。
      ['Switcher', 'Box'],
      ['Box', 'Switcher'],
    );

    await testUpdates(
      [instance.childRef.current, instance.switcherRef.current.boxRef.current],
      // 此处希望比较独立排队的Box/Child更新；当前helper未核验这些期望数组。
      ['Box', 'Child'],
      ['Box', 'Child'],
    );

    await testUpdates(
      [instance.childRef.current, instance.switcherRef.current],
      // Switcher创建Box，Child元素由App创建并作为children透传；此处期望数组未被helper有效核验。
      ['Switcher', 'Box', 'Child'],
      ['Box', 'Switcher', 'Child'],
    );
  });

  /** 标题称不同roots，但B实际是A同一根的Portal、DOM落在bContainer。A/B同批setState(1)，A.didUpdate断言Portal B DOM已为B1且aUpdated为true，验证同根跨容器mutation先于layout。 */
  it('should queue mount-ready handlers across different roots', async () => {
    // B由A同一根的Portal渲染到另一容器；A的componentDidUpdate检查B的DOM已完成mutation。

    const bContainer = document.createElement('div');
    let a;
    let b;

    let aUpdated = false;

    /** 跨容器提交夹具A，Portal B与A同属一个FiberRoot；A.didUpdate检查B的DOM已先完成mutation。 */
    class A extends React.Component {

      /** A的x初值0，与Portal B同批改1。 */
      state = {x: 0};

      /**
       * 初始化并发布a实例，供测试同步排A/B更新。
       * @param props 初始输入。
       */
      constructor(props) {
        super(props);
        a = this;
      }

      /** 断言Portal B的DOM为B1后标记aUpdated，验证子Portal mutation已先于A的layout生命周期。 */
      componentDidUpdate() {
        expect(findDOMNode(b).textContent).toBe('B1');
        aUpdated = true;
      }

      /**
       * 输出A状态并在bContainer创建Portal B，ref把B实例发布到b；没有创建第二个root。
       * @returns A div与Portal。
       */
      render() {
        let portal = null;
        portal = ReactDOM.createPortal(<B ref={n => (b = n)} />, bContainer);
        return (
          <div>
            A{this.state.x}
            {portal}
          </div>
        );
      }
    }

    /** Portal内的B类夹具，与A共享根而使用独立DOM容器。 */
    class B extends React.Component {

      /** B的x初值0，同批更新1供A.didUpdate检查。 */
      state = {x: 0};

      /**
       * 把B前缀与state.x写入div，findDOMNode(b)读取此文本。
       * @returns B状态div。
       */
      render() {
        return <div>B{this.state.x}</div>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<A />);
    });

    await act(() => {
      a.setState({x: 1});
      b.setState({x: 1});
    });

    expect(aUpdated).toBe(true);
  });

  /** Outer更新1，didUpdate再更新Inner，Outer提交回调又排Outer2；精确日志核对第二批Outer2/Inner1及最后Inner2的render、didUpdate、回调顺序，验证嵌套提交更新排队。 */
  it('should flush updates in the correct order', async () => {
    const updates = [];
    let instance;

    /** 嵌套提交更新的Outer夹具，didUpdate排Inner更新，测试setState回调继续排Outer下一值。 */
    class Outer extends React.Component {

      /** x初值0，依次由测试回调链更新1、2。 */
      state = {x: 0};

      /** 保存Inner实例，供Outer.didUpdate排本地state更新。 */
      innerRef = React.createRef();

      /**
       * 初始化并发布Outer实例，供测试启动更新回调链。
       * @param props 初始输入。
       */
      constructor(props) {
        super(props);
        instance = this;
      }

      /**
       * 记录Outer当前state.x并把它作为Inner prop，分离Inner props值与其本地state。
       * @returns Inner包装div。
       */
      render() {
        updates.push('Outer-render-' + this.state.x);
        return (
          <div>
            <Inner x={this.state.x} ref={this.innerRef} />
          </div>
        );
      }

      /** 记录Outer提交及即将排给Inner的x，再setState并让其提交回调记Inner-callback-x；该更新进入后续批次。 */
      componentDidUpdate() {
        const x = this.state.x;
        updates.push('Outer-didUpdate-' + x);
        updates.push('Inner-setState-' + x);
        this.innerRef.current.setState({x: x}, function () {
          updates.push('Inner-callback-' + x);
        });
      }
    }

    /** 同时记录prop.x与state.x的Inner，便于观察父更新与提交期本地更新的合并顺序。 */
    class Inner extends React.Component {

      /** 本地x初值0，与Outer prop输入独立变化。 */
      state = {x: 0};

      /**
       * 按props.x/state.x记录Inner-render，DOM为空div，仅日志承担顺序证据。
       * @returns div。
       */
      render() {
        updates.push('Inner-render-' + this.props.x + '-' + this.state.x);
        return <div />;
      }

      /** 记录Inner-didUpdate及当前props/state，供精确更新日志序列断言。 */
      componentDidUpdate() {
        updates.push('Inner-didUpdate-' + this.props.x + '-' + this.state.x);
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Outer />);
    });

    await act(() => {
      updates.push('Outer-setState-1');
      instance.setState({x: 1}, function () {
        updates.push('Outer-callback-1');
        updates.push('Outer-setState-2');
        instance.setState({x: 2}, function () {
          updates.push('Outer-callback-2');
        });
      });
    });

    expect(updates).toEqual([
      'Outer-render-0',
      'Inner-render-0-0',

      'Outer-setState-1',
      'Outer-render-1',
      'Inner-render-1-0',
      'Inner-didUpdate-1-0',
      'Outer-didUpdate-1',
      // 发生在批处理中，所以不要立即重新渲染。
      'Inner-setState-1',
      'Outer-callback-1',

      // 在批次中发生
      'Outer-setState-2',

    // 一次性冲刷全部批量更新。
      'Outer-render-2',
      'Inner-render-2-1',
      'Inner-didUpdate-2-1',
      'Inner-callback-1',
      'Outer-didUpdate-2',
      'Inner-setState-2',
      'Outer-callback-2',
      'Inner-render-2-2',
      'Inner-didUpdate-2-2',
      'Inner-callback-2',
    ]);
  });

  /** MockComponent挂载时在自身DOM创建下一独立root，depth0到2；初挂与逐实例forceUpdate日志均0→1→2，验证多个真实根的更新执行顺序。 */
  it('should flush updates in the correct order across roots', async () => {
    const instances = [];
    const updates = [];

    /** 递归创建独立root的类夹具，depth与count控制根链长度。 */
    class MockComponent extends React.Component {

      /**
       * 记录props.depth并返回div，成为下一独立root的容器。
       * @returns div。
       */
      render() {
        updates.push(this.props.depth);
        return <div />;
      }

      /** 保存this到instances，depth<count时在自身宿主节点createRoot并渲染下一depth；形成真实多根链。 */
      componentDidMount() {
        instances.push(this);
        if (this.props.depth < this.props.count) {
          const root = ReactDOMClient.createRoot(findDOMNode(this));
          root.render(
            <MockComponent
              depth={this.props.depth + 1}
              count={this.props.count}
            />,
          );
        }
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<MockComponent depth={0} count={2} />);
    });

    expect(updates).toEqual([0, 1, 2]);

    await act(() => {
      // 从上到下依次模拟每个组件的更新。
      instances.forEach(function (instance) {
        instance.forceUpdate();
      });
    });

    expect(updates).toEqual([0, 1, 2, 0, 1, 2]);
  });

  /** 两个独立root中Y更新触发Z.willUpdate，回调让X连续state.s=1/0/1；最终X DOM从0变1，验证其他根render阶段排出的更新不会丢失。 */
  it('should queue nested updates', async () => {
  // 参见 https://github.com/facebook/react/issues/1147 。

    /** 其他根render阶段连续更新的目标类，用两种DOM形状观察最终s。 */
    class X extends React.Component {

      /** s初值0，go依次入队1/0/1，最终为1。 */
      state = {s: 0};

      /**
       * s=0时div内含span0，其他值直接div1，检查批次最终结果。
       * @returns 当前状态div。
       */
      render() {
        if (this.state.s === 0) {
          return (
            <div>
              <span>0</span>
            </div>
          );
        } else {
          return <div>1</div>;
        }
      }

      /** 连续setState s为1、0、1，供Z.willUpdate从另一个根重入更新队列。 */
      go = () => {
        this.setState({s: 1});
        this.setState({s: 0});
        this.setState({s: 1});
      };
    }

    /** 第二根owner夹具，forceUpdate会重新创建Z元素，触发其willUpdate。 */
    class Y extends React.Component {

      /**
       * 在div内创建Z，作为跨根重入更新入口。
       * @returns Z包装。
       */
      render() {
        return (
          <div>
            <Z />
          </div>
        );
      }
    }

    /** 第二根叶子，在更新前调用第一根X.go排三项state更新。 */
    class Z extends React.Component {

      /**
       * 返回空div，输出不承担状态证据。
       * @returns div。
       */
      render() {
        return <div />;
      }

      /** 调用外部x.go，测试在Y更新期间向另一个根排更新。 */
      UNSAFE_componentWillUpdate() {
        x.go();
      }
    }

    let container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);
    let x;
    await act(() => {
      root.render(<X ref={current => (x = current)} />);
    });

    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    let y;
    await act(() => {
      root.render(<Y ref={current => (y = current)} />);
    });

    expect(findDOMNode(x).textContent).toBe('0');

    await act(() => {
      y.forceUpdate();
    });
    expect(findDOMNode(x).textContent).toBe('1');
  });

  /** 兄弟A先在willMount发布实例，B.willMount对A setState(1)，批次完成DOM为A1，验证挂载过程中对已开始挂载兄弟的更新排队。 */
  it('should queue updates from during mount', async () => {
  // 参见 https://github.com/facebook/react/issues/1353 。
    let a;

    /** 先挂载的兄弟A夹具，在willMount发布实例供B更新。 */
    class A extends React.Component {

      /** x初值0，兄弟B挂载时改为1。 */
      state = {x: 0};

      /** 将this保存到a，使随后B.willMount能向正在挂载的A排state更新。 */
      UNSAFE_componentWillMount() {
        a = this;
      }

      /**
       * 输出A前缀与state.x，最终A1证明挂载阶段更新已提交。
       * @returns A状态div。
       */
      render() {
        return <div>A{this.state.x}</div>;
      }
    }

    /** 后挂载的B夹具，在willMount更新前一个兄弟A。 */
    class B extends React.Component {

      /** 调用a.setState(x:1)，触发同一挂载批次中已进入挂载的兄弟更新。 */
      UNSAFE_componentWillMount() {
        a.setState({x: 1});
      }

      /**
       * 返回空div，B本身不输出文本。
       * @returns div。
       */
      render() {
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(
        <div>
          <A />
          <B />
        </div>,
      );
    });

    expect(container.firstChild.textContent).toBe('A1');
  });

  /** A初值x=1，另一act将prop改2，willReceiveProps setState并附回调；回调断言state已等于nextProps并记录Callback一次，验证接收props阶段更新回调的提交时点。 */
  it('calls componentWillReceiveProps setState callback properly', async () => {

    /** 在willReceiveProps同步prop.x到state.x并附回调的类夹具。 */
    class A extends React.Component {

      /** 从首个this.props.x初始化本地状态，随后由新props更新。 */
      state = {x: this.props.x};

      /**
       * 读取nextProps.x并setState，提交回调以this.state核对新值并记录Callback。
       * @param nextProps 下一次根输入。
       */
      UNSAFE_componentWillReceiveProps(nextProps) {
        const newX = nextProps.x;
        this.setState({x: newX}, function () {
          // 调用此回调时，state 应已完成更新。
          expect(this.state.x).toBe(newX);
          Scheduler.log('Callback');
        });
      }

      /**
       * 输出本地state.x，用props更新后的状态作为DOM内容。
       * @returns 状态div。
       */
      render() {
        return <div>{this.state.x}</div>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<A x={1} />);
    });
    assertLog([]);

    // 必须放在单独的 act 中，否则会被批处理。
    await act(() => {
      root.render(<A x={2} />);
    });

    assertLog(['Callback']);
  });

  /** A初始挂B，批次先对B更新再让A删除B；结束没有B render日志，验证待更新子组件先被父树删除后不再执行render。 */
  it('does not call render after a component as been deleted', async () => {
    let componentA = null;
    let componentB = null;

    /** 待删除且已排更新的B夹具，render日志用于检查删除后不会再执行。 */
    class B extends React.Component {

      /** updates初值0，批次内设1但在处理前由父删除。 */
      state = {updates: 0};

      /** 保存B实例到componentB，使测试在删除批次中先排其更新。 */
      componentDidMount() {
        componentB = this;
      }

      /**
       * 记录B并返回空div，删除后预期无此日志。
       * @returns div。
       */
      render() {
        Scheduler.log('B');
        return <div />;
      }
    }

    /** 可通过showB删除子B的父类，测试用父更新覆盖子待处理更新。 */
    class A extends React.Component {

      /** showB初始true，批次中改false以删除B。 */
      state = {showB: true};

      /** 发布父实例componentA供测试改showB。 */
      componentDidMount() {
        componentA = this;
      }

      /**
       * showB为真创建B，否则空div，使同批删除跳过B的待更新render。
       * @returns B或div。
       */
      render() {
        return this.state.showB ? <B /> : <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<A />);
    });
    assertLog(['B']);

    await act(() => {
      // B 将会安排一个更新，但批处理应该确保其更新永远不会触发。
      componentB.setState({updates: 1});
      componentA.setState({showB: false});
    });

    assertLog([]);
  });

  /** 分别用新根传字符串、普通对象、Foo实例作为setState callback；act拒绝非法callback错误，前两项核对DEV警告，验证commit回调类型校验与不同值的格式化。 */
  it('throws in setState if the update callback is not a function', async () => {

    /** 构造带a/b自有字段的普通Foo实例，作为非法setState callback输入，覆盖对象诊断。 */
    function Foo() {
      this.a = 1;
      this.b = 2;
    }

    /** 空state类夹具，允许测试排附非法callback的setState。 */
    class A extends React.Component {

      /** 空对象state，更新内容也为空，使失败来源限定为callback类型。 */
      state = {};

      /**
       * 输出空div，仅提供可挂载类实例。
       * @returns div。
       */
      render() {
        return <div />;
      }
    }

    let container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);
    let component;
    await act(() => {
      root.render(<A ref={current => (component = current)} />);
    });

    await expect(async () => {
      await act(() => {
        component.setState({}, 'no');
      });
    }).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: no',
    );
    assertConsoleErrorDev([
      'Expected the last optional `callback` argument to be ' +
        'a function. Instead received: no.',
    ]);
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<A ref={current => (component = current)} />);
    });

    await expect(async () => {
      await act(() => {
        component.setState({}, {foo: 'bar'});
      });
    }).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: [object Object]',
    );
    assertConsoleErrorDev([
      'Expected the last optional `callback` argument to be ' +
        "a function. Instead received: { foo: 'bar' }.",
    ]);
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<A ref={current => (component = current)} />);
    });

    await expect(
      act(() => {
        component.setState({}, new Foo());
      }),
    ).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: [object Object]',
    );
  });

  /** 分别在新根以字符串、对象、Foo实例作为forceUpdate callback；act拒绝非法callback错误，前两项核对DEV警告，后续同类对象警告去重，验证forceUpdate回调校验。 */
  it('throws in forceUpdate if the update callback is not a function', async () => {

    /** 构造带a/b字段的普通对象实例，作为非法forceUpdate callback输入。 */
    function Foo() {
      this.a = 1;
      this.b = 2;
    }

    /** 可forceUpdate的空state类夹具，测试不同非法callback值。 */
    class A extends React.Component {

      /** 空state，forceUpdate校验与state内容无关。 */
      state = {};

      /**
       * 输出空div并允许ref获取类实例。
       * @returns div。
       */
      render() {
        return <div />;
      }
    }

    let container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);
    let component;
    await act(() => {
      root.render(<A ref={current => (component = current)} />);
    });

    await expect(async () => {
      await act(() => {
        component.forceUpdate('no');
      });
    }).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: no',
    );
    assertConsoleErrorDev([
      'Expected the last optional `callback` argument to be ' +
        'a function. Instead received: no.',
    ]);
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<A ref={current => (component = current)} />);
    });

    await expect(async () => {
      await act(() => {
        component.forceUpdate({foo: 'bar'});
      });
    }).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: [object Object]',
    );
    assertConsoleErrorDev([
      'Expected the last optional `callback` argument to be ' +
        "a function. Instead received: { foo: 'bar' }.",
    ]);
    // 确保警告被去重，并且不再重复触发
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<A ref={current => (component = current)} />);
    });

    await expect(
      act(() => {
        component.forceUpdate(new Foo());
      }),
    ).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: [object Object]',
    );
  });

  /** 父/子同批forceUpdate，Child.willUpdate只一次额外setState；render与didMount/didUpdate各断言计数相邻，expect.assertions(6)限制总检查数，验证同批不会对同一组件重复提交render。 */
  it('does not update one component twice in a batch (#2410)', async () => {
    let parent;

    /** 持Child实例ref的父夹具，便于父子在同批forceUpdate。 */
    class Parent extends React.Component {

      /** 保存子实例，getChild向测试返回它。 */
      childRef = React.createRef();

      /** 挂载后将this发布到parent，供测试取子并排双更新。 */
      componentDidMount() {
        parent = this;
      }

      /**
       * 返回childRef.current实例，测试用它与父一起forceUpdate。
       * @returns Child实例。
       */
      getChild = () => {
        return this.childRef.current;
      };

      /**
       * 创建带实例ref的Child，让父forceUpdate也遍历到子。
       * @returns Child。
       */
      render() {
        return <Child ref={this.childRef} />;
      }
    }

    let renderCount = 0;
    let postRenderCount = 0;
    let once = false;

    /** 用renderCount/postRenderCount严格配对render和提交的子夹具，willUpdate只一次追加state。 */
    class Child extends React.Component {

      /** updated初值false，一次willUpdate设true以制造同批追加更新。 */
      state = {updated: false};

      /** 外部once首次false时置true并setState(updated:true)，之后不再排更新，避免无穷递归。 */
      UNSAFE_componentWillUpdate() {
        if (!once) {
          once = true;
          this.setState({updated: true});
        }
      }

      /** 断言render已比提交计数多一，再递增postRenderCount，检查初挂配对。 */
      componentDidMount() {
        expect(renderCount).toBe(postRenderCount + 1);
        postRenderCount++;
      }

      /** 断言render只领先提交一次，再递增postRenderCount，检查更新提交配对。 */
      componentDidUpdate() {
        expect(renderCount).toBe(postRenderCount + 1);
        postRenderCount++;
      }

      /**
       * 断言renderCount等于已提交计数再递增，确保新render不在前一次提交前重复发生。
       * @returns div。
       */
      render() {
        expect(renderCount).toBe(postRenderCount);
        renderCount++;
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });

    const child = parent.getChild();
    await act(() => {
      parent.forceUpdate();
      child.forceUpdate();
    });

    expect.assertions(6);
  });

  /** App挂载后删除EmitsChangeOnUnmount，卸载触发已订阅ForceUpdatesOnChange.forceUpdate；订阅组件挂载也先forceUpdate并换随机key。act正常结束且仅恒真断言，覆盖此重入回归不抛错，未独立统计render次数。 */
  it('does not update one component twice in a batch (#6371)', async () => {
    let callbacks = [];

    /** 按注册顺序同步调用callbacks，卸载组件用它通知ForceUpdatesOnChange更新。 */
    function emitChange() {
      callbacks.forEach(c => c());
    }

    /** 挂载提交后删除EmitsChangeOnUnmount的父类，制造卸载通知与订阅者forceUpdate重入。 */
    class App extends React.Component {

      /**
       * 初始化showChild=true，使通知源先挂载。
       * @param props 初始输入。
       */
      constructor(props) {
        super(props);
        this.state = {showChild: true};
      }

      /** setState showChild=false，在挂载后下一次提交删除通知源。 */
      componentDidMount() {
        this.setState({showChild: false});
      }

      /**
       * 始终保留ForceUpdatesOnChange，按showChild决定EmitsChangeOnUnmount，卸载通知触发前者更新。
       * @returns 两兄弟div。
       */
      render() {
        return (
          <div>
            <ForceUpdatesOnChange />
            {this.state.showChild && <EmitsChangeOnUnmount />}
          </div>
        );
      }
    }

    /** 只在卸载时发送变更通知的空输出夹具。 */
    class EmitsChangeOnUnmount extends React.Component {

      /** 调用emitChange，向同树订阅者排forceUpdate。 */
      componentWillUnmount() {
        emitChange();
      }

      /**
       * 返回null，不生成DOM，只有卸载回调承担触发作用。
       * @returns null。
       */
      render() {
        return null;
      }
    }

    /** 挂载时forceUpdate并订阅变更、卸载时取消订阅的类夹具，随机宿主key使自身更新包含DOM替换。 */
    class ForceUpdatesOnChange extends React.Component {

      /** 建立onChange闭包先调用forceUpdate再加入callbacks；初挂提交因此已有待更新项。 */
      componentDidMount() {
        /** 实例变更订阅回调，调用当前this.forceUpdate；挂载先执行再注册，卸载按函数身份移除。 */
        this.onChange = () => this.forceUpdate();
        this.onChange();
        callbacks.push(this.onChange);
      }

      /** 从callbacks滤除当前onChange，防止卸载后继续接收变更。 */
      componentWillUnmount() {
        callbacks = callbacks.filter(c => c !== this.onChange);
      }

      /**
       * 每次返回随机key的div并带空click handler，制造更新时宿主重建；本例只验证流程不抛错。
       * @returns div。
       */
      render() {
        return <div key={Math.random()} onClick={function () {}} />;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<App />);
    });

    // 不应抛出错误。
    expect(true).toBe(true);
  });

  /** Editor.didMount通过onChange将rendered改true并再次root.render，随后另一批将text改goodbye；断言Mount仅一次、onChange执行、最终goodbye，验证提交期重入仍复用实例。入口是createRoot。 */
  it('handles reentrant mounting in synchronous mode', async () => {
    let onChangeCalled = false;

    /** 挂载提交通过onChange重入root.render的Editor，rendered prop避免重复发通知。 */
    class Editor extends React.Component {

      /**
       * 输出props.text，后续goodbye输入用于确认实例复用后的普通更新。
       * @returns 文本div。
       */
      render() {
        return <div>{this.props.text}</div>;
      }

      /** 记录Mount，仅rendered为false时发onChange(rendered:true)，回调让相同root重入render。 */
      componentDidMount() {
        Scheduler.log('Mount');
        // 这里只应调用一次，但仍加上保护以防万一。
        if (!this.props.rendered) {
          this.props.onChange({rendered: true});
        }
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    /** 向同一root渲染Editor并传当前外部props，onChange合并newProps后递归调用此入口；guard保证只一次重入。 */
    function render() {
      root.render(
        <Editor
          onChange={newProps => {
            onChangeCalled = true;
            props = {...props, ...newProps};
            render();
          }}
          {...props}
        />,
      );
    }

    let props = {text: 'hello', rendered: false};
    await act(() => {
      render();
    });
    assertLog(['Mount']);
    props = {...props, text: 'goodbye'};
    await act(() => {
      render();
    });

    assertLog([]);
    expect(container.textContent).toBe('goodbye');
    expect(onChangeCalled).toBeTruthy();
  });

  /** 同一act先root.render Hello再root.unmount(container)，两步后及批次结束container始终为空，验证首次挂载尚未提交即卸载不会显示中间内容。 */
  it('mounts and unmounts are batched', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<div>Hello</div>);
      expect(container.textContent).toBe('');
      root.unmount(container);
      expect(container.textContent).toBe('');
    });

    expect(container.textContent).toBe('');
  });

  /** 类render排函数式setState，baseStep=0时升1、之后返回null；DEV警告render中更新，日志base/memoized为0/0再1/1，验证render阶段更新用正确累计基础state。 */
  it('uses correct base state for setState inside render phase', async () => {

    /** 类render阶段函数式setState的夹具，比较render捕获memoizedStep与队列处理baseState。 */
    class Foo extends React.Component {

      /** step初值0，函数式更新只把0变1，其后返回null结束递归。 */
      state = {step: 0};

      /**
       * 捕获本轮step后排函数式更新，回调记录base/memoized并仅0→1；返回null，DEV故意触发render更新警告。
       * @returns null。
       */
      render() {
        const memoizedStep = this.state.step;
        this.setState(baseState => {
          const baseStep = baseState.step;
          Scheduler.log(`base: ${baseStep}, memoized: ${memoizedStep}`);
          return baseStep === 0 ? {step: 1} : null;
        });
        return null;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Foo />);
    });
    assertConsoleErrorDev([
      'Cannot update during an existing state transition (such as within `render`). ' +
        'Render methods should be a pure function of props and state.\n' +
        '    in Foo (at **)',
    ]);

    assertLog(['base: 0, memoized: 0', 'base: 1, memoized: 1']);
  });

  /** 已挂类组件以setState(()=>null)更新；初挂有render日志，之后没有，验证空更新结果跳过render。 */
  it('does not re-render if state update is null', async () => {
    const container = document.createElement('div');

    let instance;

    /** 空更新结果bailout的类夹具，以render日志观察setState(()=>null)不再执行。 */
    class Foo extends React.Component {

      /**
       * 发布实例并记录render，返回空div以隔离state变化。
       * @returns div。
       */
      render() {
        instance = this;
        Scheduler.log('render');
        return <div />;
      }
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Foo />);
    });

    assertLog(['render']);
    await act(() => {
      instance.setState(() => null);
    });
    assertLog([]);
  });

  /** 普通div hidden=true包Bar，旁有Baz；挂载与更新日志均Foo→Bar→Baz，验证HTML hidden属性本身不延后React子树render。 */
  it('synchronously renders hidden subtrees', async () => {
    const container = document.createElement('div');

    /**
     * 记录Baz并返回null，作为普通hidden子树之后的兄弟。
     * @returns null。
     */
    function Baz() {
      Scheduler.log('Baz');
      return null;
    }

    /**
     * 记录Bar并返回null，观察HTML hidden属性不会延后该组件render。
     * @returns null。
     */
    function Bar() {
      Scheduler.log('Bar');
      return null;
    }

    /**
     * 记录Foo，把Bar放普通hidden div内、Baz放外面，挂载及更新都按相同render顺序。
     * @returns hidden属性测试树。
     */
    function Foo() {
      Scheduler.log('Foo');
      return (
        <div>
          <div hidden={true}>
            <Bar />
          </div>
          <Baz />
        </div>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      // 挂载。
      root.render(<Foo />);
    });
    assertLog(['Foo', 'Bar', 'Baz']);

    await act(() => {
      // 更新。
      root.render(<Foo />);
    });
    assertLog(['Foo', 'Bar', 'Baz']);
  });

  /** www配置下LegacyHiddenDiv把hidden转换为unstable-defer-without-hiding；先Foo/Baz/effect提交而隐藏div空，再Offscreen渲染Bar0。flushSync(setCounter1)仍保持0，后续低优先级工作变1，验证延后子树更新。 */
  // @gate www

  it('delays sync updates inside hidden subtrees in Concurrent Mode', async () => {
    const container = document.createElement('div');

    /**
     * 记录Baz并输出p baz，作为LegacyHidden分支外的立即渲染兄弟。
     * @returns p。
     */
    function Baz() {
      Scheduler.log('Baz');
      return <p>baz</p>;
    }

    let setCounter;

    /**
     * 发布counter setter并记录Bar，输出计数p，观察Offscreen低优先级挂载及更新。
     * @returns 计数p。
     */
    function Bar() {
      const [counter, _setCounter] = React.useState(0);
      setCounter = _setCounter;
      Scheduler.log('Bar');
      return <p>bar {counter}</p>;
    }

    /**
     * 记录render与passive effect，将Bar放LegacyHiddenDiv hidden模式，Baz在外，观察主提交先于延后子树。
     * @returns 双分支div。
     */
    function Foo() {
      Scheduler.log('Foo');
      React.useEffect(() => {
        Scheduler.log('Foo#effect');
      });
      return (
        <div>
          <LegacyHiddenDiv mode="hidden">
            <Bar />
          </LegacyHiddenDiv>
          <Baz />
        </div>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    let hiddenDiv;
    await act(async () => {
      root.render(<Foo />);
      await waitFor(['Foo', 'Baz', 'Foo#effect']);
      hiddenDiv = container.firstChild.firstChild;
      expect(hiddenDiv.hidden).toBe(true);
      expect(hiddenDiv.innerHTML).toBe('');
      // 运行 Offscreen 更新。
      await waitForAll(['Bar']);
      expect(hiddenDiv.hidden).toBe(true);
      expect(hiddenDiv.innerHTML).toBe('<p>bar 0</p>');
    });

    ReactDOM.flushSync(() => {
      setCounter(1);
    });
    // 此时不应冲刷。
    expect(hiddenDiv.innerHTML).toBe('<p>bar 0</p>');

    // 运行 Offscreen 更新。
    await waitForAll(['Bar']);
    expect(hiddenDiv.innerHTML).toBe('<p>bar 1</p>');
  });

  /** Foo.didMount创建1200个独立root，仅最后Component passive effect发一次setState；act无Maximum错误且Trigger一次，验证大量独立根不误算为递归深度。 */
  it('can render ridiculously large number of roots without triggering infinite update loop error', async () => {

    /**
     * Hook初值0，仅trigger为真时passive effect记录Trigger并函数式加1；无trigger的1199个根不排更新。
     * @param trigger 是否发一次effect更新。
     * @returns 状态div。
     */
    function Component({trigger}) {
      const [state, setState] = React.useState(0);

      React.useEffect(() => {
        if (trigger) {
          Scheduler.log('Trigger');
          setState(c => c + 1);
        }
      }, [trigger]);

      return <div>{state}</div>;
    }

    /** 挂载时建立1200个独立root的压力夹具，本身无DOM输出。 */
    class Foo extends React.Component {

      /** 循环createRoot并render Component，只有末项trigger=true，测试根数量不误算为嵌套更新深度。 */
      componentDidMount() {
        const limit = 1200;
        for (let i = 0; i < limit; i++) {
          if (i < limit - 1) {
            ReactDOMClient.createRoot(document.createElement('div')).render(
              <Component />,
            );
          } else {
            // 直到调用 setState 时，才会抛出“nested update limit”错误。
            ReactDOMClient.createRoot(document.createElement('div')).render(
              <Component trigger={true} />,
            );
          }
        }
      }

      /**
       * 返回null，1200个子根由didMount命令式创建而非此render children。
       * @returns null。
       */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Foo />);
    });

    // 确保触发 setState 的路径确实执行。
    assertLog(['Trigger']);
  });

  /** EventuallyTerminating由didUpdate递增到limit，55时抛Maximum，降到45后可新挂并两次从0走到45；再升55抛错且ref清空，验证无关批次重置嵌套计数。 */
  it('resets the update counter for unrelated updates', async () => {
    const container = document.createElement('div');
    const ref = React.createRef();

    /** didUpdate递增到可调整limit的类夹具，分别测试超过限制、无关批次计数重置及再次超过。 */
    class EventuallyTerminating extends React.Component {

      /** step初值0，挂载后起步1，再逐次更新到外部limit。 */
      state = {step: 0};

      /** 设step1启动连续提交更新。 */
      componentDidMount() {
        this.setState({step: 1});
      }

      /** step<limit时排step+1，否则停止；limit55超过嵌套门限，45允许结束。 */
      componentDidUpdate() {
        if (this.state.step < limit) {
          this.setState({step: this.state.step + 1});
        }
      }

      /**
       * 返回step文本，检查批次是否达到limit以及错误后的重挂状态。
       * @returns 数值step。
       */
      render() {
        return this.state.step;
      }
    }

    let limit = 55;
    const root = ReactDOMClient.createRoot(container);
    await expect(async () => {
      await act(() => {
        root.render(<EventuallyTerminating ref={ref} />);
      });
    }).rejects.toThrow('Maximum');

    // 确保我们不会超过限制，即使这些更新是无关的。
    limit -= 10;
    await act(() => {
      root.render(<EventuallyTerminating ref={ref} />);
    });
    expect(container.textContent).toBe(limit.toString());

    await act(() => {
      ref.current.setState({step: 0});
    });
    expect(container.textContent).toBe(limit.toString());

    await act(() => {
      ref.current.setState({step: 0});
    });
    expect(container.textContent).toBe(limit.toString());

    limit += 10;
    await expect(async () => {
      await act(() => {
        ref.current.setState({step: 0});
      });
    }).rejects.toThrow('Maximum');
    expect(ref.current).toBe(null);
  });

  /** 类didMount设step1，每次didUpdate再设step2，即使值相同仍排更新；act拒绝Maximum，验证连续提交递归终止而不无限挂起。 */
  it('does not fall into an infinite update loop', async () => {

    /** didUpdate始终排step2的无限提交夹具，故相同数值仍可形成连续类更新。 */
    class NonTerminating extends React.Component {

      /** step初值0，didMount设1，后续反复设2。 */
      state = {step: 0};

      /** 排step1启动提交递归。 */
      componentDidMount() {
        this.setState({step: 1});
      }

      /** 每次提交都setState(step:2)，不设终止条件，触发Maximum限制。 */
      componentDidUpdate() {
        this.setState({step: 2});
      }

      /**
       * 输出Hello、name及step，文本是否变化不阻止此类更新循环。
       * @returns 状态div。
       */
      render() {
        return (
          <div>
            Hello {this.props.name}
            {this.state.step}
          </div>
        );
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await expect(async () => {
      await act(() => {
        root.render(<NonTerminating />);
      });
    }).rejects.toThrow('Maximum');
  });

  /** 无依赖layout effect每次把Hook step加1，act拒绝Maximum，验证layout提交期无限同步更新限制。 */
  it('does not fall into an infinite update loop with useLayoutEffect', async () => {

    /**
     * 无依赖layout effect每次函数式加step，造成同步提交递归，由最大更新深度检查中止。
     * @returns step。
     */
    function NonTerminating() {
      const [step, setStep] = React.useState(0);
      React.useLayoutEffect(() => {
        setStep(x => x + 1);
      });
      return step;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(async () => {
      await act(() => {
        root.render(<NonTerminating />);
      });
    }).rejects.toThrow('Maximum');
  });

  /** NonTerminating连续didUpdate更新导致Maximum，随后相同root渲染只挂载更新一次的Terminating得到1；重复失败→恢复仍成功，验证根可从更新循环错误重新使用。 */
  it('can recover after falling into an infinite update loop', async () => {

    /** 恢复测试中的无限类更新夹具，连续didUpdate排step2直到根报告错误。 */
    class NonTerminating extends React.Component {

      /** step初值0，挂载起步1、更新反复2。 */
      state = {step: 0};

      /** 排step1启动无限更新。 */
      componentDidMount() {
        this.setState({step: 1});
      }

      /** 无条件排step2，使相同值仍触发下一提交。 */
      componentDidUpdate() {
        this.setState({step: 2});
      }

      /**
       * 直接输出step，作为循环根的内容。
       * @returns step。
       */
      render() {
        return this.state.step;
      }
    }

    /** 只在挂载提交排一次更新的有限类夹具，用于失败根上的恢复。 */
    class Terminating extends React.Component {

      /** step初值0，仅didMount将其更新为1。 */
      state = {step: 0};

      /** 排step1后不再在didUpdate排更新，故恢复可结束。 */
      componentDidMount() {
        this.setState({step: 1});
      }

      /**
       * 返回step，最终DOM1证明根重新可用。
       * @returns step。
       */
      render() {
        return this.state.step;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(async () => {
      await act(() => {
        root.render(<NonTerminating />);
      });
    }).rejects.toThrow('Maximum');

    await act(() => {
      root.render(<Terminating />);
    });
    expect(container.textContent).toBe('1');

    await expect(async () => {
      await act(() => {
        root.render(<NonTerminating />);
      });
    }).rejects.toThrow('Maximum');
    await act(() => {
      root.render(<Terminating />);
    });
    expect(container.textContent).toBe('1');
  });

  /** 同一root的A/B各在didMount渲染另一组件形成重挂循环；act拒绝Maximum，验证同根互相mount的递归限制。 */
  it('does not fall into mutually recursive infinite update loop with same container', async () => {
    // 注意： 如果有两个或多个不同的根,这个测试会失败.
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    /** 同根交替重挂夹具A，挂载后root.render B。 */
    class A extends React.Component {

      /** 在同一root渲染B，类型变化导致下一次重挂。 */
      componentDidMount() {
        root.render(<B />);
      }

      /**
       * 返回null，循环由didMount驱动而非DOM事件。
       * @returns null。
       */
      render() {
        return null;
      }
    }

    /** 同根交替重挂夹具B，挂载后root.render A。 */
    class B extends React.Component {

      /** 在同一root渲染A，闭合A/B挂载循环。 */
      componentDidMount() {
        root.render(<A />);
      }

      /**
       * 返回null，不引入DOM变化探针。
       * @returns null。
       */
      render() {
        return null;
      }
    }

    await expect(async () => {
      await act(() => {
        root.render(<A />);
      });
    }).rejects.toThrow('Maximum');
  });

  /** BadRender总抛error，ErrorBoundary.didCatch先无操作state更新再让父step递增、换key重挂同错误树；act拒绝Maximum，验证错误恢复重挂也受递归限制。 */
  it('does not fall into an infinite error loop', async () => {

    /**
     * 始终抛error，令每次新的ErrorBoundary实例都进入错误恢复。
     * @throws Error(error)。
     */
    function BadRender() {
      throw new Error('error');
    }

    /** 每次捕获错误便请求父重挂自己的边界夹具，测试错误恢复递归限制。 */
    class ErrorBoundary extends React.Component {

      /** 先setState({})满足DEV捕获路径的更新要求，再调用props.parent.remount改变key，重新创建同样出错的边界。 */
      componentDidCatch() {
        // 调度一次无操作 state 更新，避免测试在 DEV 中触发警告。
        this.setState({});

        this.props.parent.remount();
      }

      /**
       * 无条件返回BadRender，故重挂也再次出错，无法稳定显示fallback。
       * @returns BadRender。
       */
      render() {
        return <BadRender />;
      }
    }

    /** 通过step作为ErrorBoundary key不断重挂的父类，错误捕获回调持续调用remount。 */
    class NonTerminating extends React.Component {

      /** step初值0，每次remount加1，值承担实例key而非业务显示。 */
      state = {step: 0};

      /** 以函数式setState增加step，形成新的错误边界实例。 */
      remount() {
        this.setState(state => ({step: state.step + 1}));
      }

      /**
       * 把this作为parent及step作为key传给ErrorBoundary，闭合捕获→父更新→重挂循环。
       * @returns ErrorBoundary。
       */
      render() {
        return <ErrorBoundary key={this.state.step} parent={this} />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(async () => {
      await act(() => {
        root.render(<NonTerminating />);
      });
    }).rejects.toThrow('Maximum');
  });

  /** 一次根挂1200个Child收集实例，同act对所有实例setState(value:update)；无Maximum错误且subscribers长度1200，验证批次宽度不等于递归深度；未逐项断言state值。 */
  it('can schedule ridiculously many updates within the same batch without triggering a maximum update error', async () => {
    const subscribers = [];
    const limit = 1200;

    /** 1200个同批更新对象之一，挂载时把实例收集到subscribers，本身无DOM输出。 */
    class Child extends React.Component {

      /** value初始initial，同批都设update；测试只检查实例数量与流程正常结束。 */
      state = {value: 'initial'};

      /** 把this加入subscribers，供之后同一act遍历排更新。 */
      componentDidMount() {
        subscribers.push(this);
      }

      /**
       * 返回null，避免DOM规模影响大量更新队列测试。
       * @returns null。
       */
      render() {
        return null;
      }
    }

    /** 创建1200个带稳定数字key的Child，比较批次宽度与递归深度。 */
    class App extends React.Component {

      /**
       * 循环构造Child数组作为直接children，不在render阶段排state更新。
       * @returns Child元素数组。
       */
      render() {
        const children = [];
        for (let i = 0; i < limit; i++) {
          children.push(<Child key={i} />);
        }
        return children;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App />);
    });

    await act(() => {
      subscribers.forEach(s => {
        s.setState({value: 'update'});
      });
    });

    expect(subscribers.length).toBe(limit);
  });

  /** 仅DEV且循环检测开启、forceThrow关闭时运行；Child render更新父Hook形成同步递归，console.error捕捉Maximum警告记stop。等待stop后finally恢复console，验证警告可观测；本例未断言最终DOM。 */
  it("warns about potential infinite loop if there's a synchronous render phase update on another component", async () => {
    if (
      !__DEV__ ||
      gate(
        flags =>
          !flags.enableInfiniteRenderLoopDetection ||
          flags.enableInfiniteRenderLoopDetectionForceThrow,
      )
    ) {
      return;
    }
    let setState;

    /**
     * 保存父Hook setter并返回Child，使子render能对不同组件排更新。
     * @returns Child。
     */
    function App() {
      const [, _setState] = React.useState(0);
      setState = _setState;
      return <Child />;
    }

    /**
     * render时函数式更新父Hook形成同步递归，step形参实际接收props但未读取，返回null。
     * @param step 本例未使用的输入。
     * @returns null。
     */
    function Child(step) {
      // 这将导致无限更新循环，并在开发时引发警告。
      setState(n => n + 1);
      return null;
    }

    const originalConsoleError = console.error;
    /**
     * 只把新循环检测的Maximum警告首句映射为Scheduler stop，其他console输出被忽略；finally恢复原console.error。
     * @param e 控制台第一项消息。
     */
    console.error = e => {
      if (
        typeof e === 'string' &&
        e.startsWith(
          'Maximum update depth exceeded. This could be an infinite loop.',
        )
      ) {
        Scheduler.log('stop');
      }
    };
    try {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      root.render(<App />);
      await waitFor(['stop']);
    } finally {
      console.error = originalConsoleError;
    }
  });

  /** 仅DEV循环检测警告模式运行，初始root.render包startTransition，Child render更新父Hook；拦截Maximum警告并等待stop，finally恢复console，覆盖非同步入口的循环警告。 */
  it("warns about potential infinite loop if there's an async render phase update on another component", async () => {
    if (
      !__DEV__ ||
      gate(
        flags =>
          !flags.enableInfiniteRenderLoopDetection ||
          flags.enableInfiniteRenderLoopDetectionForceThrow,
      )
    ) {
      return;
    }
    let setState;

    /**
     * 发布父Hook setter并返回Child，初始入口在transition中，供非同步render循环警告测试。
     * @returns Child。
     */
    function App() {
      const [, _setState] = React.useState(0);
      setState = _setState;
      return <Child />;
    }

    /**
     * 每次render更新父Hook，没有终止条件；step输入未读取，警告拦截器使测试观察到stop。
     * @param step 本例未使用的输入。
     * @returns null。
     */
    function Child(step) {
      // 这将导致无限更新循环，并在开发时引发警告。
      setState(n => n + 1);
      return null;
    }

    const originalConsoleError = console.error;
    /**
     * transition入口的警告探针，只遇到Maximum新消息才记stop，finally恢复原console.error。
     * @param e 控制台第一项消息。
     */
    console.error = e => {
      if (
        typeof e === 'string' &&
        e.startsWith(
          'Maximum update depth exceeded. This could be an infinite loop.',
        )
      ) {
        Scheduler.log('stop');
      }
    };
    try {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      React.startTransition(() => root.render(<App />));
      await waitFor(['stop']);
    } finally {
      console.error = originalConsoleError;
    }
  });

  // TODO：用 @gate pragma 替换此分支。
  if (__DEV__) {

    /** 仅DEV定义，无依赖useEffect反复更新step；console.error记录错误、ownerStack和原生stack并记stop。断言Maximum、stack含myEffect、ownerStack含App，验证passive循环警告上下文。 */
    it('warns about a deferred infinite update loop with useEffect', async () => {

      /**
       * 无依赖passive effect反复函数式加step，effect命名myEffect供原生错误栈检查。
       * @returns step。
       */
      function NonTerminating() {
        const [step, setStep] = React.useState(0);
        React.useEffect(/** 每次passive effect函数式加step，没有依赖数组，因此持续产生后续提交；myEffect名称供原生debugStack断言。 */ function myEffect() {
          setStep(x => x + 1);
        });
        return step;
      }

      /**
       * 创建NonTerminating，作为captureOwnerStack中应出现的owner。
       * @returns NonTerminating。
       */
      function App() {
        return <NonTerminating />;
      }

      let error = null;
      let ownerStack = null;
      let debugStack = null;
      const originalConsoleError = console.error;
      /**
       * 保存警告原值，并在console回调执行时捕获ownerStack与原生stack、记stop；finally恢复原console以避免跨测试泄漏。
       * @param e 控制台警告值。
       */
      console.error = e => {
        error = e;
        ownerStack = React.captureOwnerStack();
        debugStack = new Error().stack;
        Scheduler.log('stop');
      };
      try {
        const container = document.createElement('div');
        const root = ReactDOMClient.createRoot(container);
        root.render(<App />);
        await waitFor(['stop']);
      } finally {
        console.error = originalConsoleError;
      }

      expect(error).toContain('Maximum update depth exceeded');
      // 当前正在执行的 effect 应位于原生调用栈中。
      expect(debugStack).toContain('at myEffect');
      expect(ownerStack).toContain('at App');
    });

    /** 仅DEV定义，passive effect在step<50时加1；日志0至50、DOM50，另批重置0仍回到50，验证未超限制的连续更新与批次计数重置。 */
    it('can have nested updates if they do not cross the limit', async () => {
      let _setStep;
      const LIMIT = 50;

      /**
       * 保存setter，passive effect只在step<50时增加；每render记录step并返回，允许下一独立批次重置再完成。
       * @returns step。
       */
      function Terminating() {
        const [step, setStep] = React.useState(0);
        _setStep = setStep;
        React.useEffect(() => {
          if (step < LIMIT) {
            setStep(x => x + 1);
          }
        });
        Scheduler.log(step);
        return step;
      }

      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Terminating />);
      });

      assertLog(Array.from({length: LIMIT + 1}, (_, k) => k));
      expect(container.textContent).toBe('50');
      await act(() => {
        _setStep(0);
      });
      expect(container.textContent).toBe('50');
    });

    /** 仅DEV定义，初挂passive effect一次循环排1000个函数式更新；日志Done一次且DOM1000，验证同一effect批次很多更新不误报递归循环。 */
    it('can have many updates inside useEffect without triggering a warning', async () => {

      /**
       * 空依赖passive effect一次入队1000个函数式增量并记Done，更新合批为1000后不再触发effect。
       * @returns step。
       */
      function Terminating() {
        const [step, setStep] = React.useState(0);
        React.useEffect(() => {
          for (let i = 0; i < 1000; i++) {
            setStep(x => x + 1);
          }
          Scheduler.log('Done');
        }, []);
        return step;
      }

      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Terminating />);
      });

      assertLog(['Done']);
      expect(container.textContent).toBe('1000');
    });
  }

  /** 依赖step的passive effect每次flushSync排step+1，屏蔽预期flushSync警告；onUncaughtError精确收Maximum及NonTerminating组件栈，验证effect触发同步循环最终被捕获。 */
  it('prevents infinite update loop triggered by synchronous updates in useEffect', async () => {
    // 忽略 flushSync 警告。
    spyOnDev(console, 'error').mockImplementation(() => {});

    /**
     * 依赖step的passive effect调用flushSync排step+1，使每次提交都触发下一同步更新，供onUncaughtError捕获深度限制。
     * @returns step。
     */
    function NonTerminating() {
      const [step, setStep] = React.useState(0);
      React.useEffect(() => {
        // useEffect 中其他同步更新示例还包括 `el.focus` 这类命令式事件派发，以及 useSyncExternalStore；
        // 后者若发现 store 自初始渲染后已变更，可能在订阅时调度同步更新。
        // 本测试最初使用 `el.focus`，但错误会在 JSDOM 事件中派发，无法可靠捕获以免测试失败。
        ReactDOM.flushSync(() => {
          setStep(step + 1);
        });
      }, [step]);
      return step;
    }

    const container = document.createElement('div');
    const errors = [];
    const root = ReactDOMClient.createRoot(container, {

      /**
       * 组合Maximum错误message与规范化componentStack，记录passive effect同步递归的唯一未捕获错误。
       * @param error 深度限制错误。
       * @param errorInfo 含组件栈的信息。
       */
      onUncaughtError: (error, errorInfo) => {
        errors.push(
          `${error.message}${normalizeCodeLocInfo(errorInfo.componentStack)}`,
        );
      },
    });
    await act(() => {
      ReactDOM.flushSync(() => {
        root.render(<NonTerminating />);
      });
    });

    expect(errors).toEqual([
      'Maximum update depth exceeded. ' +
        'This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate. ' +
        'React limits the number of nested updates to prevent infinite loops.' +
        '\n    in NonTerminating (at **)',
    ]);
  });

  /** DEV循环检测警告模式下，子每render抛新thenable，父layout先同步兑现订阅再setState。首次Maximum警告将shouldStop置true，act得以结束；断言已停且onUncaughtError为空，验证commit期间ping循环警告而非抛错。 */
  it('warns instead of throwing when infinite Suspense ping loop is detected via enableInfiniteRenderLoopDetection during commit phase', async () => {
    if (
      !__DEV__ ||
      gate(
        flags =>
          !flags.enableInfiniteRenderLoopDetection ||
          flags.enableInfiniteRenderLoopDetectionForceThrow,
      )
    ) {
      return;
    }

    // 当 Suspense 子节点抛出 thenable 时，React 注册两条监听路径：1）渲染阶段 attachPingListener
    // 的 ping，经 pingSuspendedRoot 到 markRootPinged；2）提交阶段 attachSuspenseRetryListeners 的
    // retry，到 resolveRetryWakeable。ping 路径会由 markRootPinged 调用
    // throwIfInfiniteUpdateLoopDetected(true)，没有先经过 getRootForUpdatedFiber 内的非插桩检查。当它在
    // CommitContext 而非 RenderContext 中触发时，
    // isFromInfiniteRenderLoopDetectionInstrumentation=true 保证只警告而不抛错。若仍传 false，条件
    // 在 CommitContext 中会计算为 false 并错误地抛出。
    let currentResolve = null;
    let shouldStop = false;

    /**
     * layout每轮先清空并调用currentResolve兑现暂停子订阅，再setState制造同步后续提交；shouldStop后不再调度，子返回null终止循环。
     * @returns Suspense树。
     */
    function App() {
      const [, setState] = React.useState(0);

      React.useLayoutEffect(() => {
        if (shouldStop) {
          return;
        }
        // 在提交阶段（CommitContext）兑现挂起的 thenable。渲染期间先注册的 ping 回调会先触发，进而调用 markRootPinged → throwIfInfiniteUpdateLoopDetected(true)。
        if (currentResolve !== null) {
          const resolve = currentResolve;
          currentResolve = null;
          resolve();
        }
        // 调度同步更新，使 flushSpawnedWork 收尾时把本轮递归归为 NESTED_UPDATE_SYNC_LANE。
        setState(n => n + 1);
      });

      return (
        <React.Suspense fallback="loading">
          <SuspendingChild />
        </React.Suspense>
      );
    }

    /**
     * 每render创建新thenable并抛出，then收集root ping和边界retry；shouldStop后直接null，让警告处理能结束act。
     * @returns 停止后的null。
     * @throws 新thenable。
     */
    function SuspendingChild() {
      if (shouldStop) {
        return null;
      }
      // 每次 render 抛出新 thenable。then 收集 render 的 root ping 与 commit 的边界 retry 订阅；
      // resolve 按注册顺序通知，故先触发 ping，再触发 retry。
      const callbacks = [];
      const thenable = {

        /**
         * 将onFulfilled按注册顺序加入callbacks，重建currentResolve为遍历通知闭包；同一thenable可有render ping及commit retry两条订阅。
         * @param onFulfilled ping或retry通知。
         */
        then(onFulfilled) {
          callbacks.push(onFulfilled);
          /** 按then订阅注册顺序同步调用callbacks，父layout先清空currentResolve再执行它，使render root ping先于commit边界retry。 */
          currentResolve = () => {
            for (let i = 0; i < callbacks.length; i++) {
              callbacks[i]();
            }
          };
        },
      };

      throw thenable;
    }

    const container = document.createElement('div');
    const errors = [];
    const root = ReactDOMClient.createRoot(container, {

      /**
       * 收集未捕获错误message；本例commit ping循环应仅警告，故数组为空。
       * @param error 未捕获错误。
       */
      onUncaughtError: error => {
        errors.push(error.message);
      },
    });

    const originalConsoleError = console.error;
    /**
     * 检测Maximum新警告后置shouldStop，停止layout更新与子暂停，让act结束；finally恢复console。
     * @param e 控制台消息。
     */
    console.error = e => {
      if (
        typeof e === 'string' &&
        e.startsWith(
          'Maximum update depth exceeded. This could be an infinite loop.',
        )
      ) {
        // 首次警告后停止循环，让 act() 能够结束。
        shouldStop = true;
      }
    };

    try {
      await act(() => {
        root.render(<App />);
      });
    } finally {
      console.error = originalConsoleError;
    }

    // 修复后，markRootPinged 中的 throwIfInfiniteUpdateLoopDetected(true) 会通过 enableInfiniteRenderLoopDetection 插桩发现循环并产生警告。未修复而传入 false 时，同一检查会因 executionContext 是 CommitContext 而不是 RenderContext 直接抛错。
    expect(shouldStop).toBe(true);
    expect(errors).toEqual([]);
  });

  /** 循环检测及forceThrow开启，Child render更新父Hook形成同步循环；三个错误回调共用captureError并停止排更新，过滤跨组件更新DEV警告。断言至少一条Maximum新消息，验证强制抛错路径；不限定报告次数。 */
  // @gate enableInfiniteRenderLoopDetection && enableInfiniteRenderLoopDetectionForceThrow

  it('throws when sync render-phase update loop is detected with force-throw enabled', async () => {
    // 在另一个组件的钩子上进行渲染阶段的setState会产生同步递归更新。 启用 ForceThrow 时，应该通过
    // throwForcedInfiniteRenderLoopError 来抛出错误，而不是仅在 DEV 模式下发出警告。
    let setState;
    let shouldStop = false;

    /**
     * 发布父Hook setter并输出Child，制造forceThrow下同步render阶段跨组件递归。
     * @returns Child。
     */
    function App() {
      const [, _setState] = React.useState(0);
      setState = _setState;
      return <Child />;
    }

    /**
     * shouldStop为真时返回null，否则函数式更新父Hook并返回null；错误回调停止后续递归。
     * @returns null。
     */
    function Child() {
      if (shouldStop) {
        return null;
      }
      setState(n => n + 1);
      return null;
    }

    const container = document.createElement('div');
    const errors = [];

    /**
     * 收集任一根错误回调的message并置shouldStop，三个回调共用此函数使不同配置路径都能终止。
     * @param error 根报告错误。
     */
    const captureError = error => {
      errors.push(error.message);
      // 停止调度新更新，让测试以及 gate 关闭、legacy 错误路径可恢复的变体都能正常结束，
      // 且不会触发 Babel 无限循环保护器。
      shouldStop = true;
    };
    const root = ReactDOMClient.createRoot(container, {
      onUncaughtError: captureError,
      onRecoverableError: captureError,
      onCaughtError: captureError,
    });

    // 渲染阶段在另一组件上调用 setState，还会在每次递归时产生仅 DEV 环境出现的“Cannot update a component while rendering a different component” console.error。这里吞掉这些错误，避免测试框架要求逐条断言。
    const originalConsoleError = console.error;
    /**
     * 只吞跨组件render更新的DEV警告，其他消息交原console.error；finally恢复，避免掩盖循环错误。
     * @param msg 首项控制台消息。
     */
    console.error = msg => {
      if (
        typeof msg === 'string' &&
        msg.startsWith('Cannot update a component')
      ) {
        return;
      }
      originalConsoleError(msg);
    };
    try {
      await act(() => {
        root.render(<App />);
      });
    } finally {
      console.error = originalConsoleError;
    }

    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]).toContain(
      'Maximum update depth exceeded. This could be an infinite loop.',
    );
  });

  /** forceThrow配置下初始startTransition，Child render更新父Hook并设100次硬上限；onUncaughtError收错误并停止，过滤跨组件警告。断言至少一条Maximum新消息，验证phase-spawn循环检测，硬上限只为未启用变体止损。 */
  // @gate enableInfiniteRenderLoopDetection && enableInfiniteRenderLoopDetectionForceThrow

  it('throws when phase-spawn update loop is detected with force-throw enabled', async () => {
    // 把初始渲染包在 startTransition 中，会让渲染阶段的 setState 继承非同步 transition lane。
    // 提交后下一次渲染仍非同步，因此循环检测器会把递归归类为 NESTED_UPDATE_PHASE_SPAWN，而非
    // SYNC_LANE。启用 ForceThrow 后，此分支应通过 throwForcedInfiniteRenderLoopError 抛错，
    // 而不是只在 DEV 中警告。
    let setState;
    let shouldStop = false;
    // 硬性限制 Child 的渲染次数。未启用无限渲染循环检测时，PHASE_SPAWN 分支完全关闭，不会抛错，
    // 循环会一直执行到 Babel 的无限循环保护器介入。
    let renderCount = 0;
    const RENDER_CAP = 100;

    /**
     * 发布父Hook setter并创建Child，初始transition使render阶段更新继承非同步入口。
     * @returns Child。
     */
    function App() {
      const [, _setState] = React.useState(0);
      setState = _setState;
      return <Child />;
    }

    /**
     * shouldStop或renderCount达到100即返回null，否则计数并更新父Hook；硬上限防未启用变体无限执行。
     * @returns null。
     */
    function Child() {
      if (shouldStop || renderCount >= RENDER_CAP) {
        return null;
      }
      renderCount++;
      setState(n => n + 1);
      return null;
    }

    const container = document.createElement('div');
    const errors = [];
    const root = ReactDOMClient.createRoot(container, {

      /**
       * 保存未捕获循环错误message并置shouldStop，停止phase-spawn递归。
       * @param error 未捕获错误。
       */
      onUncaughtError: error => {
        errors.push(error.message);
        shouldStop = true;
      },
    });

    const originalConsoleError = console.error;
    /**
     * 过滤跨组件render更新DEV警告，其余消息转原console.error；用于phase-spawn强制抛错测试并在finally恢复。
     * @param msg 控制台消息。
     */
    console.error = msg => {
      if (
        typeof msg === 'string' &&
        msg.startsWith('Cannot update a component')
      ) {
        return;
      }
      originalConsoleError(msg);
    };
    try {
      await act(() => {
        React.startTransition(() => root.render(<App />));
      });
    } finally {
      console.error = originalConsoleError;
    }

    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]).toContain(
      'Maximum update depth exceeded. This could be an infinite loop.',
    );
  });

  /** div的每次ref挂接连续派发50个reducer更新，新ref身份使提交继续排更新；onUncaughtError收唯一Maximum及div/TooManyRefUpdates栈，验证ref回调造成的嵌套更新限制。 */
  it('prevents infinite update loop triggered by too many updates in ref callbacks', async () => {
    let scheduleUpdate;

    /**
     * 每次创建新的ref回调，挂接时连续dispatch50个reducer更新；count输出后又提交新ref，使多轮嵌套更新触发限制。
     * @returns 计数div。
     */
    function TooManyRefUpdates() {
      const [count, _scheduleUpdate] = React.useReducer(c => c + 1, 0);
      scheduleUpdate = _scheduleUpdate;

      return (
        <div
          ref={() => {
            for (let i = 0; i < 50; i++) {
              scheduleUpdate(1);
            }
          }}>
          {count}
        </div>
      );
    }

    const container = document.createElement('div');
    const errors = [];
    const root = ReactDOMClient.createRoot(container, {

      /**
       * 保存Maximum消息与规范化组件栈，核对ref更新循环来源包含div及TooManyRefUpdates。
       * @param error 深度限制错误。
       * @param errorInfo 组件栈信息。
       */
      onUncaughtError: (error, errorInfo) => {
        errors.push(
          `${error.message}${normalizeCodeLocInfo(errorInfo.componentStack)}`,
        );
      },
    });
    await act(() => {
      root.render(<TooManyRefUpdates />);
    });

    expect(errors).toEqual([
      'Maximum update depth exceeded. ' +
        'This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate. ' +
        'React limits the number of nested updates to prevent infinite loops.' +
        '\n    in div' +
        '\n    in TooManyRefUpdates (at **)',
    ]);
  });
});
