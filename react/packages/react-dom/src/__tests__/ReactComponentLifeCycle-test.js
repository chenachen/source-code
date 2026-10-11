/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let act;

let React;
let ReactDOMClient;
let assertConsoleErrorDev;
let assertConsoleWarnDev;

/**
 * 把本测试只含布尔字段的JSON状态复制成独立对象并返回；journal必须保留各阶段当时值，不能随后续直接修改state一起变化。仅用于这里的可序列化快照。
 */
const clone = function (o) {
  return JSON.parse(JSON.stringify(o));
};

/**
 * 构造器初始化完成的布尔快照基准；四个生命周期标记均false，用来核对willMount入口仍持有初始状态。
 */
const GET_INIT_STATE_RETURN_VAL = {
  hasWillMountCompleted: false,
  hasRenderCompleted: false,
  hasDidMountCompleted: false,
  hasWillUnmountCompleted: false,
};

/**
 * 首render入口基准：willMount已完成，render/didMount/卸载尚未完成。
 */
const INIT_RENDER_STATE = {
  hasWillMountCompleted: true,
  hasRenderCompleted: false,
  hasDidMountCompleted: false,
  hasWillUnmountCompleted: false,
};

/**
 * didMount入口基准：willMount与首render标记已true，但didMount自己的setState尚未执行，卸载仍false。
 */
const DID_MOUNT_STATE = {
  hasWillMountCompleted: true,
  hasRenderCompleted: true,
  hasDidMountCompleted: false,
  hasWillUnmountCompleted: false,
};

/**
 * didMount状态更新后的后续render基准：前三阶段均true、卸载仍false。
 */
const NEXT_RENDER_STATE = {
  hasWillMountCompleted: true,
  hasRenderCompleted: true,
  hasDidMountCompleted: true,
  hasWillUnmountCompleted: false,
};

/**
 * willUnmount入口基准：挂载与render均完成，清理标记尚未置true。
 */
const WILL_UNMOUNT_STATE = {
  hasWillMountCompleted: true,
  hasDidMountCompleted: true,
  hasRenderCompleted: true,
  hasWillUnmountCompleted: false,
};

/**
 * willUnmount返回后实例残留state基准：四标记均true；用于读取已卸载实例的最终直接写入结果。
 */
const POST_WILL_UNMOUNT_STATE = {
  hasWillMountCompleted: true,
  hasDidMountCompleted: true,
  hasRenderCompleted: true,
  hasWillUnmountCompleted: true,
};

/**
 * 核对类实例的初始化、更新与卸载顺序。constructor 中的 setState 使用未挂载 updater，
 * 而 UNSAFE_componentWillMount 中的更新会在初次 render 前处理；下方分别断言两条路径。
 */
describe('ReactComponentLifeCycle', () => {
  beforeEach(() => {
    jest.resetModules();

    ({
      act,
      assertConsoleErrorDev,
      assertConsoleWarnDev,
    } = require('internal-test-utils'));

    React = require('react');
    ReactDOMClient = require('react-dom/client');
  });

  /**
   * 同一个 StatefulComponent element 在旧根卸载后重新 createRoot/render；firstInstance/secondInstance 实际保存容器首 DOM，断言节点 identity 不同，证明重挂未复用旧宿主节点，正文没有直接比较 class 实例。
   */
  it('should not reuse an instance when it has been unmounted', async () => {
    const container = document.createElement('div');

    /**
     * 重挂对照class；同一个element可再次使用，但根卸载后宿主节点必须重新创建。
     */
    class StatefulComponent extends React.Component {

      /**
       * 初始化空state，保持fixture为普通stateful class；正文不直接断言class state identity。
       */
      state = {};

      /**
       * 返回div，容器首子就是两轮比较的实际对象。
       */
      render() {
        return <div />;
      }
    }

    const element = <StatefulComponent />;
    let root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(element);
    });

    const firstInstance = container.firstChild;
    await act(() => {
      root.unmount();
    });
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(element);
    });

    const secondInstance = container.firstChild;
    expect(firstInstance).not.toBe(secondInstance);
  });


  /**
   * SwitcherParent 初挂不含 Child，didMount 调 switchIt 排队显示 Child；journal 为父构造、父 didMount、子 didMount，验证一次 act 内提交更新可随后挂载新子，onDOMReady 仅是历史日志名。
   */
  it('should fire onDOMReady when already in onDOMReady', async () => {
    const _testJournal = [];

    /**
     * 父didMount更新后才新挂载的Child，记录真实挂载提交而非历史onDOMReady API。
     */
    class Child extends React.Component {

      /**
       * 向journal记录Child:onDOMReady；方法属于componentDidMount，证明该子在父更新后才提交。
       */
      componentDidMount() {
        _testJournal.push('Child:onDOMReady');
      }

      /**
       * 返回div供新子节点正常挂载，日志来自提交钩子。
       */
      render() {
        return <div />;
      }
    }

    /**
     * 首挂只显示占位div，didMount更新状态后挂载Child的父fixture。
     */
    class SwitcherParent extends React.Component {

      /**
       * super(props)后记构造日志，初始化showHasOnDOMReadyComponent=false，保证第一次提交没有Child。
       */
      constructor(props) {
        super(props);
        _testJournal.push('SwitcherParent:getInitialState');
        this.state = {showHasOnDOMReadyComponent: false};
      }

      /**
       * 先记父didMount，再调用switchIt，使Child在后续更新中挂载而非混入第一次render。
       */
      componentDidMount() {
        _testJournal.push('SwitcherParent:onDOMReady');
        this.switchIt();
      }

      /**
       * setState把show开关置true，无返回值，act最终冲刷新子挂载。
       */
      switchIt = () => {
        this.setState({showHasOnDOMReadyComponent: true});
      };

      /**
       * show开关选择Child或占位div，外层div稳定，用日志区分父首挂与子后挂。
       */
      render() {
        return (
          <div>
            {this.state.showHasOnDOMReadyComponent ? <Child /> : <div />}
          </div>
        );
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<SwitcherParent />);
    });

    expect(_testJournal).toEqual([
      'SwitcherParent:getInitialState',
      'SwitcherParent:onDOMReady',
      'Child:onDOMReady',
    ]);
  });

        // 此类没有初始化 state；UNSAFE_componentWillMount 实际读取 this.state.yada，因此触发空状态访问错误。

  /**
   * StatefulComponent 未初始化 state，willMount 读取 this.state.yada；await act 拒绝，覆盖空初始状态的访问错误而非禁止所有 willMount state 读取。
   */
  it('throws when accessing state in componentWillMount', async () => {

    /**
     * 不设置初始state却在willMount读取字段的故障fixture；测试等待act拒绝。
     */
    class StatefulComponent extends React.Component {

      /**
       * 读取this.state.yada；初始state为空会抛错，不返回补丁或输出。
       */
      UNSAFE_componentWillMount() {
        void this.state.yada;
      }

      /**
       * 正常路径返回div，但本例willMount错误阻止该输出提交。
       */
      render() {
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(<StatefulComponent />);
      }),
    ).rejects.toThrow();
  });

  /**
   * fixture 在 willMount setState(stateField=something)；实际 matcher 对 async 函数使用 not.toThrow，只检查调用当下不抛且没有 await 返回 Promise，也没有状态/DOM断言，不能以此证明异步 act 成功完成。
   */
  it('should allow update state inside of componentWillMount', () => {

    /**
     * willMount调用setState的fixture；测试matcher没有等待其async返回，注释不能把它当完整异步成功证明。
     */
    class StatefulComponent extends React.Component {

      /**
       * 挂载前排队stateField=something；挂载队列处理会在首render前读取，实际case未断言最终字段。
       */
      UNSAFE_componentWillMount() {
        this.setState({stateField: 'something'});
      }

      /**
       * 返回div，状态不写到DOM，此例没有可见state断言。
       */
      render() {
        return <div />;
      }
    }

    expect(async function () {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<StatefulComponent />);
      });
    }).not.toThrow();
  });

  /**
   * 构造器令 this.state===props；正常挂载后 DEV 提示不推荐直接赋 props，原因是之后 props 更新不会自动写入既有 state，正文未进行后续 prop 更新。
   */
  it("warns if setting 'this.state = props'", async () => {

    /**
     * 构造器令state与props引用相同的警告fixture。
     */
    class StatefulComponent extends React.Component {

      /**
       * super(props,context)后直接this.state=props；不复制对象，使React检测出不推荐的props/state别名。
       */
      constructor(props, context) {
        super(props, context);
        this.state = props;
      }

      /**
       * 返回div，唯一目标为初始化状态约定的DEV提示。
       */
      render() {
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<StatefulComponent />);
    });
    assertConsoleErrorDev([
      'StatefulComponent: It is not recommended to assign props directly to state ' +
        "because updates to props won't be reflected in state. " +
        'In most cases, it is better to use props directly.\n' +
        '    in StatefulComponent (at **)',
    ]);
  });

  /**
   * 标题写 getInitialState，实际在 ES class constructor 中先 setState(something) 再直接 state=somethingelse；首次挂载 DEV 未挂载 updater 警告，第二根同类挂载用于去重，未读取最终 state。
   */
  it('should not allow update state inside of getInitialState', async () => {

    /**
     * 构造器setState与直接state赋值的对照fixture；前者使用未挂载updater，后者是合法初始化输入。
     */
    class StatefulComponent extends React.Component {

      /**
       * 先super保存props/context，再setState(something)制造no-op提示，随后state=somethingelse初始化；测试并未读取最后字段。
       */
      constructor(props, context) {
        super(props, context);
        this.setState({stateField: 'something'});

        this.state = {stateField: 'somethingelse'};
      }

      /**
       * 返回div，正常挂载完成用于验证构造器误更新没有阻断后续挂载。
       */
      render() {
        return <div />;
      }
    }

    let container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<StatefulComponent />);
    });
    assertConsoleErrorDev([
      "Can't call setState on a component that is not yet mounted. " +
        'This is a no-op, but it might indicate a bug in your application. ' +
        'Instead, assign to `this.state` directly or define a `state = {};` ' +
        'class property with the desired state in the StatefulComponent component.\n' +
        '    in StatefulComponent (at **)',
    ]);

    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<StatefulComponent />);
    });
  });

  /**
   * LifeCycleComponent 用深复制 journal 记录构造、willMount、首 render、didMount、后续 render、卸载前后布尔标记；首次 act 已包含 didMount setState 导致的第二 render，随后未 await 的 forceUpdate 不能独立证明同步冲刷；最后断言卸载后 direct state 标记保留。
   */
  it('should carry through each of the phases of setup', async () => {

    /**
     * 用journal保存每阶段状态快照的探针；直接修改布尔标记仅服务顺序观察，不能作为业务组件更新模式。
     */
    class LifeCycleComponent extends React.Component {

      /**
       * 保存props/context，建立journal及全false的initState；先clone保存构造快照再把同一initState交给state，避免日志跟着后续变动。
       */
      constructor(props, context) {
        super(props, context);
        this._testJournal = {};
        const initState = {
          hasWillMountCompleted: false,
          hasDidMountCompleted: false,
          hasRenderCompleted: false,
          hasWillUnmountCompleted: false,
        };
        this._testJournal.returnedFromGetInitialState = clone(initState);
        this.state = initState;
      }

      /**
       * 先clone记录willMount入口state，再直接置hasWillMountCompleted；下一render快照应反映这一顺序。
       */
      UNSAFE_componentWillMount() {
        this._testJournal.stateAtStartOfWillMount = clone(this.state);
        this.state.hasWillMountCompleted = true;
      }

      /**
       * 先记录didMount入口state，再setState(hasDidMountCompleted=true)，安排第二render，journal必须保留补丁前快照。
       */
      componentDidMount() {
        this._testJournal.stateAtStartOfDidMount = clone(this.state);
        this.setState({hasDidMountCompleted: true});
      }

      /**
       * 按hasRenderCompleted选择首/后续快照，记录后直接置render标记并返回div；每次new ref只是本探针输出，不用于identity断言。
       */
      render() {
        const isInitialRender = !this.state.hasRenderCompleted;
        if (isInitialRender) {
          this._testJournal.stateInInitialRender = clone(this.state);
        } else {
          this._testJournal.stateInLaterRender = clone(this.state);
        }
        // 此处直接写入只服务阶段探针，不主动安排新 render；入口 clone 保留修改前的快照。
        this.state.hasRenderCompleted = true;
        return <div ref={React.createRef()}>I am the inner DIV</div>;
      }

      /**
       * 记录清理入口快照再直接置卸载标记；保留实例引用的测试在root.unmount返回后读取最终state。
       */
      componentWillUnmount() {
        this._testJournal.stateAtStartOfWillUnmount = clone(this.state);
        this.state.hasWillUnmountCompleted = true;
      }
    }

    // 创建 root 还不会构造类实例；下面的 root.render 才会执行 constructor 与挂载。
    const root = ReactDOMClient.createRoot(document.createElement('div'));

    const instanceRef = React.createRef();
    await act(() => {
      root.render(<LifeCycleComponent ref={instanceRef} />);
    });
    const instance = instanceRef.current;

    // getInitialState
    expect(instance._testJournal.returnedFromGetInitialState).toEqual(
      GET_INIT_STATE_RETURN_VAL,
    );

    // componentWillMount
    expect(instance._testJournal.stateAtStartOfWillMount).toEqual(
      instance._testJournal.returnedFromGetInitialState,
    );

    // componentDidMount
    expect(instance._testJournal.stateAtStartOfDidMount).toEqual(
      DID_MOUNT_STATE,
    );

    // 初始渲染
    expect(instance._testJournal.stateInInitialRender).toEqual(
      INIT_RENDER_STATE,
    );

    // 现在更新组件
    instance.forceUpdate();

    // 第二次渲染
    expect(instance._testJournal.stateInLaterRender).toEqual(NEXT_RENDER_STATE);

    await act(() => {
      root.unmount();
    });

    expect(instance._testJournal.stateAtStartOfWillUnmount).toEqual(
      WILL_UNMOUNT_STATE,
    );
      // root.unmount 已运行 componentWillUnmount，其中直接写入的 state 标记仍可从实例读取。

      // 该引用指向已卸载实例，下面检查其最终 state。
    expect(instance.state).toEqual(POST_WILL_UNMOUNT_STATE);
  });

  /**
   * Tooltip didMount 创建独立辅助 root 并 render tooltip，父 text/tooltipText 从uno/one→dos/two；两次 await act 完成，正文没有辅助DOM断言或辅助root卸载，目的为owner存在时根级更新调用不失败。
   */
  it('should not throw when updating an auxiliary component', async () => {

    /**
     * 把tooltip元素渲染到独立辅助root的classfixture；逻辑owner存在不妨碍元素成为另一个根的输出。
     */
    class Tooltip extends React.Component {

      /**
       * 返回包住props.children的div，主root展示text，辅助root单独展示tooltip。
       */
      render() {
        return <div>{this.props.children}</div>;
      }

      /**
       * 新建辅助div与root保存到this.root，再调用updateTooltip；此fixture未定义辅助root卸载清理。
       */
      componentDidMount() {
        const container = document.createElement('div');
        this.root = ReactDOMClient.createRoot(container);
        this.updateTooltip();
      }

      /**
       * 主实例props提交后重新render辅助tooltip，使新tooltipText传播到第二root。
       */
      componentDidUpdate() {
        this.updateTooltip();
      }

      /**
       * 向this.root提交props.tooltip；第二参数this.container未赋值为undefined，实际目标容器来自didMount创建的root，不由此参数决定；无返回值。
       */
      updateTooltip = () => {
        // 尽管 this.props.tooltip 有 owner，但它作为根组件挂载，因此在这里更新不应抛错。
        this.root.render(this.props.tooltip, this.container);
      };
    }

    /**
     * 为Tooltip提供主text和独立tooltipText的父fixture，两轮更新同时改变两份element输入。
     */
    class Component extends React.Component {

      /**
       * 返回Tooltip，把text作为children、tooltipText包装成另一个div element；该element虽有owner但可在辅助root挂载。
       */
      render() {
        return (
          <Tooltip
            ref={React.createRef()}
            tooltip={<div>{this.props.tooltipText}</div>}>
            {this.props.text}
          </Tooltip>
        );
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Component text="uno" tooltipText="one" />);
    });

    // 再向主 root 提交新的 Component props，Tooltip 的 didUpdate 会把新的 tooltip element 提交给辅助 root。
    await act(() => {
      root.render(<Component text="dos" tooltipText="two" />);
    });
  });

  /**
   * stateField 初始取 hello，didMount setState 取 goodbye；await act 后实例字段为 goodbye，验证挂载提交中的更新会在 act 结束前应用。
   */
  it('should allow state updates in componentDidMount', async () => {
    /**
     * 挂载提交中setState的fixture，用实例ref验证更新完成而不依赖DOM字段。
     */
    class SetStateInComponentDidMount extends React.Component {

      /**
       * stateField取valueToUseInitially，初始hello给didMount补丁goodbye提供基准。
       */
      state = {
        stateField: this.props.valueToUseInitially,
      };

      /**
       * setState改为valueToUseInOnDOMReady；历史prop名对应真实didMount时机，不是独立onDOMReady生命周期。
       */
      componentDidMount() {
        this.setState({stateField: this.props.valueToUseInOnDOMReady});
      }

      /**
       * 返回div，测试通过实例state而非DOM文本检查补丁。
       */
      render() {
        return <div />;
      }
    }

    let instance;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <SetStateInComponentDidMount
          ref={current => (instance = current)}
          valueToUseInitially="hello"
          valueToUseInOnDOMReady="goodbye"
        />,
      );
    });

    expect(instance.state.stateField).toBe('goodbye');
  });

  /**
   * Outer包Inner，x1首挂、x2更新、卸载；日志 mount前置父→子、didMount子→父、更新前置父→子、didUpdate子→父、willUnmount父→子，证明render准备与commit遍历顺序不同。
   */
  it('should call nested legacy lifecycle methods in the right order', async () => {
    let log;

    /**
     * 接收msg并返回闭包：每次调用向当前log追加msg且返回true；SCU用true放行，其余生命周期忽略返回值，方便复用同一记录器比较顺序。
     */
    const logger = function (msg) {
      return function () {
        // 从 shouldComponentUpdate 返回 true。
        log.push(msg);
        return true;
      };
    };

    /**
     * 包裹Inner的旧生命周期顺序fixture；x仅驱动一次更新，记录器覆盖render前与提交清理阶段。
     */
    class Outer extends React.Component {

      /**
       * 由logger创建的outer componentWillMount记录器，在首次render前追加标签；返回值true由React忽略，不修改state或重新安排更新。
       */
      UNSAFE_componentWillMount = logger('outer componentWillMount');

      /**
       * 由logger创建的outer componentDidMount记录器，在layout挂载提交追加标签；返回值true由React忽略，不修改state或重新安排更新。
       */
      componentDidMount = logger('outer componentDidMount');

      /**
       * 由logger创建的outer componentWillReceiveProps记录器，在接收新props追加标签；返回值true由React忽略，不修改state或重新安排更新。
       */
      UNSAFE_componentWillReceiveProps = logger(
        'outer componentWillReceiveProps',
      );

      /**
       * 由logger创建的outer shouldComponentUpdate记录器，在更新render判定追加标签；返回true放行更新render。
       */
      shouldComponentUpdate = logger('outer shouldComponentUpdate');

      /**
       * 由logger创建的outer componentWillUpdate记录器，在更新render前追加标签；返回值true由React忽略，不修改state或重新安排更新。
       */
      UNSAFE_componentWillUpdate = logger('outer componentWillUpdate');

      /**
       * 由logger创建的outer componentDidUpdate记录器，在layout更新提交追加标签；返回值true由React忽略，不修改state或重新安排更新。
       */
      componentDidUpdate = logger('outer componentDidUpdate');

      /**
       * 由logger创建的outer componentWillUnmount记录器，在已提交实例删除清理追加标签；返回值true由React忽略，不修改state或重新安排更新。
       */
      componentWillUnmount = logger('outer componentWillUnmount');

      /**
       * 返回div内Inner并透传x，建立外→内逻辑关系；方法本身不追加日志。
       */
      render() {
        return (
          <div>
            <Inner x={this.props.x} />
          </div>
        );
      }
    }

    /**
     * 旧生命周期顺序的内层fixture；父props.x驱动其更新，提交回调应在父之前。
     */
    class Inner extends React.Component {

      /**
       * 由logger创建的inner componentWillMount记录器，在首次render前追加标签；返回值true由React忽略，不修改state或重新安排更新。
       */
      UNSAFE_componentWillMount = logger('inner componentWillMount');

      /**
       * 由logger创建的inner componentDidMount记录器，在layout挂载提交追加标签；返回值true由React忽略，不修改state或重新安排更新。
       */
      componentDidMount = logger('inner componentDidMount');

      /**
       * 由logger创建的inner componentWillReceiveProps记录器，在接收新props追加标签；返回值true由React忽略，不修改state或重新安排更新。
       */
      UNSAFE_componentWillReceiveProps = logger(
        'inner componentWillReceiveProps',
      );

      /**
       * 由logger创建的inner shouldComponentUpdate记录器，在更新render判定追加标签；返回true放行更新render。
       */
      shouldComponentUpdate = logger('inner shouldComponentUpdate');

      /**
       * 由logger创建的inner componentWillUpdate记录器，在更新render前追加标签；返回值true由React忽略，不修改state或重新安排更新。
       */
      UNSAFE_componentWillUpdate = logger('inner componentWillUpdate');

      /**
       * 由logger创建的inner componentDidUpdate记录器，在layout更新提交追加标签；返回值true由React忽略，不修改state或重新安排更新。
       */
      componentDidUpdate = logger('inner componentDidUpdate');

      /**
       * 由logger创建的inner componentWillUnmount记录器，在已提交实例删除清理追加标签；返回值true由React忽略，不修改state或重新安排更新。
       */
      componentWillUnmount = logger('inner componentWillUnmount');

      /**
       * 返回props.x的span，产生真实宿主更新但顺序观测由生命周期记录器承担。
       */
      render() {
        return <span>{this.props.x}</span>;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    log = [];
    await act(() => {
      root.render(<Outer x={1} />);
    });
    expect(log).toEqual([
      'outer componentWillMount',
      'inner componentWillMount',
      'inner componentDidMount',
      'outer componentDidMount',
    ]);

    // 清空挂载日志后更新 x；后续日志只记录本次更新阶段。
    log = [];
    await act(() => {
      root.render(<Outer x={2} />);
    });
    expect(log).toEqual([
      'outer componentWillReceiveProps',
      'outer shouldComponentUpdate',
      'outer componentWillUpdate',
      'inner componentWillReceiveProps',
      'inner shouldComponentUpdate',
      'inner componentWillUpdate',
      'inner componentDidUpdate',
      'outer componentDidUpdate',
    ]);

    log = [];
    await act(() => {
      root.unmount();
    });
    expect(log).toEqual([
      'outer componentWillUnmount',
      'inner componentWillUnmount',
    ]);
  });

  /**
   * Outer/Inner均有派生状态与snapshot；首挂派生父→子、didMount子→父，更新SCU父→子、snapshot子→父、didUpdate子→父，卸载父→子，覆盖三类新API阶段顺序。
   */
  it('should call nested new lifecycle methods in the right order', async () => {
    let log;

    /**
     * 为新API阶段生成记录器：追加msg并返回true；SCU用它放行，snapshot把true作为返回快照但本例只断言调用日志，其他钩子忽略该返回。
     */
    const logger = function (msg) {
      return function () {
        // 从 shouldComponentUpdate 返回 true。
        log.push(msg);
        return true;
      };
    };

    /**
     * 包含Inner的新API顺序fixture，使用gDSFP/snapshot替代旧render前生命周期。
     */
    class Outer extends React.Component {

      /**
       * 初始化空state以满足派生API的状态形状要求，避免额外警告干扰顺序日志。
       */
      state = {};

      /**
       * 接收props/prevState但只记录outer派生访问并返回null；保持state不变，让测试专注render准备顺序。
       */
      static getDerivedStateFromProps(props, prevState) {
        log.push('outer getDerivedStateFromProps');
        return null;
      }

      /**
       * 由logger创建的outer componentDidMount记录器，在layout挂载提交追加标签；返回值true由React忽略，不修改state或重新安排更新。
       */
      componentDidMount = logger('outer componentDidMount');

      /**
       * 由logger创建的outer shouldComponentUpdate记录器，在更新render判定追加标签；返回true放行更新render。
       */
      shouldComponentUpdate = logger('outer shouldComponentUpdate');

      /**
       * 由logger创建的outer getSnapshotBeforeUpdate记录器，在before-mutation快照追加标签；返回true作为snapshot，但该用例只检查阶段日志。
       */
      getSnapshotBeforeUpdate = logger('outer getSnapshotBeforeUpdate');

      /**
       * 由logger创建的outer componentDidUpdate记录器，在layout更新提交追加标签；返回值true由React忽略，不修改state或重新安排更新。
       */
      componentDidUpdate = logger('outer componentDidUpdate');

      /**
       * 由logger创建的outer componentWillUnmount记录器，在已提交实例删除清理追加标签；返回值true由React忽略，不修改state或重新安排更新。
       */
      componentWillUnmount = logger('outer componentWillUnmount');

      /**
       * 返回div(Inner x)，让更新遍历先进入父的派生/SCU再下降到子。
       */
      render() {
        return (
          <div>
            <Inner x={this.props.x} />
          </div>
        );
      }
    }

    /**
     * 新API顺序的内层fixture；snapshot与didUpdate日志应先于父层。
     */
    class Inner extends React.Component {

      /**
       * 空初始state配合gDSFP=null，不引入状态更新，只记录API顺序。
       */
      state = {};

      /**
       * 记录inner派生访问后返回null，props/prevState不用于计算；建立父先子后的render准备证据。
       */
      static getDerivedStateFromProps(props, prevState) {
        log.push('inner getDerivedStateFromProps');
        return null;
      }

      /**
       * 由logger创建的inner componentDidMount记录器，在layout挂载提交追加标签；返回值true由React忽略，不修改state或重新安排更新。
       */
      componentDidMount = logger('inner componentDidMount');

      /**
       * 由logger创建的inner shouldComponentUpdate记录器，在更新render判定追加标签；返回true放行更新render。
       */
      shouldComponentUpdate = logger('inner shouldComponentUpdate');

      /**
       * 由logger创建的inner getSnapshotBeforeUpdate记录器，在before-mutation快照追加标签；返回true作为snapshot，但该用例只检查阶段日志。
       */
      getSnapshotBeforeUpdate = logger('inner getSnapshotBeforeUpdate');

      /**
       * 由logger创建的inner componentDidUpdate记录器，在layout更新提交追加标签；返回值true由React忽略，不修改state或重新安排更新。
       */
      componentDidUpdate = logger('inner componentDidUpdate');

      /**
       * 由logger创建的inner componentWillUnmount记录器，在已提交实例删除清理追加标签；返回值true由React忽略，不修改state或重新安排更新。
       */
      componentWillUnmount = logger('inner componentWillUnmount');

      /**
       * 返回x文本span，使snapshot与layout围绕一次真实宿主文本更新执行。
       */
      render() {
        return <span>{this.props.x}</span>;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));

    log = [];
    await act(() => {
      root.render(<Outer x={1} />);
    });
    expect(log).toEqual([
      'outer getDerivedStateFromProps',
      'inner getDerivedStateFromProps',
      'inner componentDidMount',
      'outer componentDidMount',
    ]);

    // 清空挂载日志后更新 x；后续日志只记录本次更新阶段。
    log = [];
    await act(() => {
      root.render(<Outer x={2} />);
    });
    expect(log).toEqual([
      'outer getDerivedStateFromProps',
      'outer shouldComponentUpdate',
      'inner getDerivedStateFromProps',
      'inner shouldComponentUpdate',
      'inner getSnapshotBeforeUpdate',
      'outer getSnapshotBeforeUpdate',
      'inner componentDidUpdate',
      'outer componentDidUpdate',
    ]);

    log = [];
    await act(() => {
      root.unmount();
    });
    expect(log).toEqual([
      'outer componentWillUnmount',
      'inner componentWillUnmount',
    ]);
  });

  /**
   * 组件同时声明gDSFP与三个会抛unexpected的旧名生命周期，正文只首挂；挂载成功且DEV列出兼容警告、三种旧名弃用提示，直接证明willMount被抑制，未另行触发两个更新钩子。
   */
  it('should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new static gDSFP is present', async () => {

    /**
     * gDSFP与三个旧名方法共存，首次挂载验证旧willMount被抑制和声明提示。
     */
    class Component extends React.Component {

      /**
       * 初始化空state，避免新API的初始state缺失提示干扰待测旧方法共存诊断。
       */
      state = {};

      /**
       * 返回null不改变state；此方法的存在选择新API模式，禁止调用同类旧render前生命周期。
       */
      static getDerivedStateFromProps() {
        return null;
      }

      /**
       * 旧式componentWillMount故障探针，一旦调用即抛unexpected；新API模式应跳过该钩子。
       */
      componentWillMount() {
        throw Error('unexpected');
      }

      /**
       * 旧式componentWillReceiveProps故障探针，一旦调用即抛unexpected；新API模式应跳过该钩子。
       */
      componentWillReceiveProps() {
        throw Error('unexpected');
      }

      /**
       * 旧式componentWillUpdate故障探针，一旦调用即抛unexpected；新API模式应跳过该钩子。
       */
      componentWillUpdate() {
        throw Error('unexpected');
      }

      /**
       * 返回null，不产生宿主输出；让用例专注新旧生命周期声明校验及调用抑制。
       */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Component />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'Component uses getDerivedStateFromProps() but also contains the following legacy lifecycles:\n' +
        '  componentWillMount\n' +
        '  componentWillReceiveProps\n' +
        '  componentWillUpdate\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in Component (at **)',
    ]);
    assertConsoleWarnDev([
      'componentWillMount has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move code with side effects to componentDidMount, and set initial state in the constructor.\n' +
        '* Rename componentWillMount to UNSAFE_componentWillMount to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: Component',
      'componentWillReceiveProps has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        "* If you're updating state whenever props change, refactor your code to use " +
        'memoization techniques or move it to static getDerivedStateFromProps. ' +
        'Learn more at: https://react.dev/link/derived-state\n' +
        '* Rename componentWillReceiveProps to UNSAFE_componentWillReceiveProps to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: Component',
      'componentWillUpdate has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        '* Rename componentWillUpdate to UNSAFE_componentWillUpdate to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: Component',
    ]);
  });

  /**
   * snapshot与三个会抛错的旧名生命周期共存；首挂DEV兼容/改名警告，随后value1→2更新仍成功，覆盖新API模式下旧挂载与更新钩子均不执行。
   */
  it('should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new getSnapshotBeforeUpdate is present', async () => {

    /**
     * snapshot与三个旧名方法共存，挂载及value更新验证旧前置方法被抑制。
     */
    class Component extends React.Component {

      /**
       * 初始化空state，避免新API的初始state缺失提示干扰待测旧方法共存诊断。
       */
      state = {};

      /**
       * 声明snapshot使组件选择新API模式；返回null为合法快照，更新可执行。
       */
      getSnapshotBeforeUpdate() {
        return null;
      }

      /**
       * 旧式componentWillMount故障探针，一旦调用即抛unexpected；新API模式应跳过该钩子。
       */
      componentWillMount() {
        throw Error('unexpected');
      }

      /**
       * 旧式componentWillReceiveProps故障探针，一旦调用即抛unexpected；新API模式应跳过该钩子。
       */
      componentWillReceiveProps() {
        throw Error('unexpected');
      }

      /**
       * 旧式componentWillUpdate故障探针，一旦调用即抛unexpected；新API模式应跳过该钩子。
       */
      componentWillUpdate() {
        throw Error('unexpected');
      }

      /**
       * 提供空更新提交钩子，与snapshot成对；不另排队状态或增加日志。
       */
      componentDidUpdate() {}

      /**
       * 返回null，不产生宿主输出；让用例专注新旧生命周期声明校验及调用抑制。
       */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Component value={1} />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'Component uses getSnapshotBeforeUpdate() but also contains the following legacy lifecycles:\n' +
        '  componentWillMount\n' +
        '  componentWillReceiveProps\n' +
        '  componentWillUpdate\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in Component (at **)',
    ]);
    assertConsoleWarnDev([
      'componentWillMount has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move code with side effects to componentDidMount, and set initial state in the constructor.\n' +
        '* Rename componentWillMount to UNSAFE_componentWillMount to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: Component',
      'componentWillReceiveProps has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        "* If you're updating state whenever props change, refactor your code to use " +
        'memoization techniques or move it to static getDerivedStateFromProps. ' +
        'Learn more at: https://react.dev/link/derived-state\n' +
        '* Rename componentWillReceiveProps to UNSAFE_componentWillReceiveProps to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: Component',
      'componentWillUpdate has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        '* Rename componentWillUpdate to UNSAFE_componentWillUpdate to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: Component',
    ]);

    await act(() => {
      root.render(<Component value={2} />);
    });
  });

  /**
   * gDSFP与三个UNSAFE_生命周期共存，首挂value1再更新value2均成功；DEV兼容提示列出三个UNSAFE_名称，验证改名不会绕过新API对旧前置生命周期的抑制。
   */
  it('should not invoke new unsafe lifecycles (cWM/cWRP/cWU) if static gDSFP is present', async () => {

    /**
     * gDSFP与三个UNSAFE_方法共存，挂载/更新都不能执行旧前置钩子。
     */
    class Component extends React.Component {

      /**
       * 初始化空state，避免新API的初始state缺失提示干扰待测旧方法共存诊断。
       */
      state = {};

      /**
       * 返回null不改变state；此方法的存在选择新API模式，禁止调用同类旧render前生命周期。
       */
      static getDerivedStateFromProps() {
        return null;
      }

      /**
       * 旧式UNSAFE_componentWillMount故障探针，一旦调用即抛unexpected；新API模式应跳过该钩子。
       */
      UNSAFE_componentWillMount() {
        throw Error('unexpected');
      }

      /**
       * 旧式UNSAFE_componentWillReceiveProps故障探针，一旦调用即抛unexpected；新API模式应跳过该钩子。
       */
      UNSAFE_componentWillReceiveProps() {
        throw Error('unexpected');
      }

      /**
       * 旧式UNSAFE_componentWillUpdate故障探针，一旦调用即抛unexpected；新API模式应跳过该钩子。
       */
      UNSAFE_componentWillUpdate() {
        throw Error('unexpected');
      }

      /**
       * 返回null，不产生宿主输出；让用例专注新旧生命周期声明校验及调用抑制。
       */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Component value={1} />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'Component uses getDerivedStateFromProps() but also contains the following legacy lifecycles:\n' +
        '  UNSAFE_componentWillMount\n' +
        '  UNSAFE_componentWillReceiveProps\n' +
        '  UNSAFE_componentWillUpdate\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in Component (at **)',
    ]);
    await act(() => {
      root.render(<Component value={2} />);
    });
  });

  /**
   * 依次挂四种gDSFP+旧生命周期组合；每种DEV兼容提示准确列出存在的方法，只有未加UNSAFE_前缀的名称出现改名警告；此例检查声明诊断而不比较更新顺序。
   */
  it('should warn about deprecated lifecycles (cWM/cWRP/cWU) if new static gDSFP is present', async () => {

    /**
     * gDSFP与旧名willMount/willUpdate、UNSAFE_receiveProps混用，首挂检查准确的兼容列表。
     */
    class AllLegacyLifecycles extends React.Component {

      /**
       * 初始化空state，避免新API的初始state缺失提示干扰待测旧方法共存诊断。
       */
      state = {};

      /**
       * 返回null不改变state；此方法的存在选择新API模式，禁止调用同类旧render前生命周期。
       */
      static getDerivedStateFromProps() {
        return null;
      }

      /**
       * 旧式componentWillMount故障探针，空方法仅制造共存声明；用例由DEV提示检查其名称，不以返回值观察执行。
       */
      componentWillMount() {}

      /**
       * 旧式UNSAFE_componentWillReceiveProps故障探针，空方法仅制造共存声明；用例由DEV提示检查其名称，不以返回值观察执行。
       */
      UNSAFE_componentWillReceiveProps() {}

      /**
       * 旧式componentWillUpdate故障探针，空方法仅制造共存声明；用例由DEV提示检查其名称，不以返回值观察执行。
       */
      componentWillUpdate() {}

      /**
       * 返回null，不产生宿主输出；让用例专注新旧生命周期声明校验及调用抑制。
       */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<AllLegacyLifecycles />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'AllLegacyLifecycles uses getDerivedStateFromProps() but also contains the following legacy lifecycles:\n' +
        '  componentWillMount\n' +
        '  UNSAFE_componentWillReceiveProps\n' +
        '  componentWillUpdate\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in AllLegacyLifecycles (at **)',
    ]);
    assertConsoleWarnDev([
      'componentWillMount has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move code with side effects to componentDidMount, and set initial state in the constructor.\n' +
        '* Rename componentWillMount to UNSAFE_componentWillMount to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: AllLegacyLifecycles',
      'componentWillUpdate has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        '* Rename componentWillUpdate to UNSAFE_componentWillUpdate to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: AllLegacyLifecycles',
    ]);

    /**
     * gDSFP仅搭配UNSAFE_willMount，首挂检查单项兼容提示。
     */
    class WillMount extends React.Component {

      /**
       * 初始化空state，避免新API的初始state缺失提示干扰待测旧方法共存诊断。
       */
      state = {};

      /**
       * 返回null不改变state；此方法的存在选择新API模式，禁止调用同类旧render前生命周期。
       */
      static getDerivedStateFromProps() {
        return null;
      }

      /**
       * 旧式UNSAFE_componentWillMount故障探针，空方法仅制造共存声明；用例由DEV提示检查其名称，不以返回值观察执行。
       */
      UNSAFE_componentWillMount() {}

      /**
       * 返回null，不产生宿主输出；让用例专注新旧生命周期声明校验及调用抑制。
       */
      render() {
        return null;
      }
    }

    await act(() => {
      root.render(<WillMount />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'WillMount uses getDerivedStateFromProps() but also contains the following legacy lifecycles:\n' +
        '  UNSAFE_componentWillMount\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in WillMount (at **)',
    ]);

    /**
     * gDSFP搭配旧名willMount和UNSAFE_willUpdate，首挂区分兼容提示与旧名改名提示。
     */
    class WillMountAndUpdate extends React.Component {

      /**
       * 初始化空state，避免新API的初始state缺失提示干扰待测旧方法共存诊断。
       */
      state = {};

      /**
       * 返回null不改变state；此方法的存在选择新API模式，禁止调用同类旧render前生命周期。
       */
      static getDerivedStateFromProps() {
        return null;
      }

      /**
       * 旧式componentWillMount故障探针，空方法仅制造共存声明；用例由DEV提示检查其名称，不以返回值观察执行。
       */
      componentWillMount() {}

      /**
       * 旧式UNSAFE_componentWillUpdate故障探针，空方法仅制造共存声明；用例由DEV提示检查其名称，不以返回值观察执行。
       */
      UNSAFE_componentWillUpdate() {}

      /**
       * 返回null，不产生宿主输出；让用例专注新旧生命周期声明校验及调用抑制。
       */
      render() {
        return null;
      }
    }

    await act(() => {
      root.render(<WillMountAndUpdate />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'WillMountAndUpdate uses getDerivedStateFromProps() but also contains the following legacy lifecycles:\n' +
        '  componentWillMount\n' +
        '  UNSAFE_componentWillUpdate\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in WillMountAndUpdate (at **)',
    ]);
    assertConsoleWarnDev([
      'componentWillMount has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move code with side effects to componentDidMount, and set initial state in the constructor.\n' +
        '* Rename componentWillMount to UNSAFE_componentWillMount to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: WillMountAndUpdate',
    ]);

    /**
     * gDSFP仅搭配旧名willReceiveProps，首挂检查声明列表，未触发该更新钩子。
     */
    class WillReceiveProps extends React.Component {

      /**
       * 初始化空state，避免新API的初始state缺失提示干扰待测旧方法共存诊断。
       */
      state = {};

      /**
       * 返回null不改变state；此方法的存在选择新API模式，禁止调用同类旧render前生命周期。
       */
      static getDerivedStateFromProps() {
        return null;
      }

      /**
       * 旧式componentWillReceiveProps故障探针，空方法仅制造共存声明；用例由DEV提示检查其名称，不以返回值观察执行。
       */
      componentWillReceiveProps() {}

      /**
       * 返回null，不产生宿主输出；让用例专注新旧生命周期声明校验及调用抑制。
       */
      render() {
        return null;
      }
    }

    await act(() => {
      root.render(<WillReceiveProps />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'WillReceiveProps uses getDerivedStateFromProps() but also contains the following legacy lifecycles:\n' +
        '  componentWillReceiveProps\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in WillReceiveProps (at **)',
    ]);
    assertConsoleWarnDev([
      'componentWillReceiveProps has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        "* If you're updating state whenever props change, refactor your code to use " +
        'memoization techniques or move it to static getDerivedStateFromProps. ' +
        'Learn more at: https://react.dev/link/derived-state\n' +
        '* Rename componentWillReceiveProps to UNSAFE_componentWillReceiveProps to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: WillReceiveProps',
    ]);
  });

  /**
   * 依次挂四种snapshot+旧生命周期组合，每类提供配套didUpdate；断言DEV兼容列表及旧名改名警告，首挂不调用snapshot，不把其空返回误讲成已经验证更新快照。
   */
  it('should warn about deprecated lifecycles (cWM/cWRP/cWU) if new getSnapshotBeforeUpdate is present', async () => {

    /**
     * snapshot搭配三种混用旧名称并有didUpdate，首挂仅检查声明兼容列表。
     */
    class AllLegacyLifecycles extends React.Component {

      /**
       * 初始化空state，避免新API的初始state缺失提示干扰待测旧方法共存诊断。
       */
      state = {};

      /**
       * 声明snapshot使组件选择新API模式；空方法隐式undefined，但本fixture只首挂，不会进入更新snapshot，待测的是声明共存诊断。
       */
      getSnapshotBeforeUpdate() {}

      /**
       * 旧式componentWillMount故障探针，空方法仅制造共存声明；用例由DEV提示检查其名称，不以返回值观察执行。
       */
      componentWillMount() {}

      /**
       * 旧式UNSAFE_componentWillReceiveProps故障探针，空方法仅制造共存声明；用例由DEV提示检查其名称，不以返回值观察执行。
       */
      UNSAFE_componentWillReceiveProps() {}

      /**
       * 旧式componentWillUpdate故障探针，空方法仅制造共存声明；用例由DEV提示检查其名称，不以返回值观察执行。
       */
      componentWillUpdate() {}

      /**
       * 提供空更新提交钩子，与snapshot成对；不另排队状态或增加日志。
       */
      componentDidUpdate() {}

      /**
       * 返回null，不产生宿主输出；让用例专注新旧生命周期声明校验及调用抑制。
       */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<AllLegacyLifecycles />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'AllLegacyLifecycles uses getSnapshotBeforeUpdate() but also contains the following legacy lifecycles:\n' +
        '  componentWillMount\n' +
        '  UNSAFE_componentWillReceiveProps\n' +
        '  componentWillUpdate\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in AllLegacyLifecycles (at **)',
    ]);
    assertConsoleWarnDev([
      'componentWillMount has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move code with side effects to componentDidMount, and set initial state in the constructor.\n' +
        '* Rename componentWillMount to UNSAFE_componentWillMount to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: AllLegacyLifecycles',
      'componentWillUpdate has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        '* Rename componentWillUpdate to UNSAFE_componentWillUpdate to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: AllLegacyLifecycles',
    ]);

    /**
     * snapshot只搭配UNSAFE_willMount并有didUpdate，首挂检查单项兼容提示。
     */
    class WillMount extends React.Component {

      /**
       * 初始化空state，避免新API的初始state缺失提示干扰待测旧方法共存诊断。
       */
      state = {};

      /**
       * 声明snapshot使组件选择新API模式；空方法隐式undefined，但本fixture只首挂，不会进入更新snapshot，待测的是声明共存诊断。
       */
      getSnapshotBeforeUpdate() {}

      /**
       * 旧式UNSAFE_componentWillMount故障探针，空方法仅制造共存声明；用例由DEV提示检查其名称，不以返回值观察执行。
       */
      UNSAFE_componentWillMount() {}

      /**
       * 提供空更新提交钩子，与snapshot成对；不另排队状态或增加日志。
       */
      componentDidUpdate() {}

      /**
       * 返回null，不产生宿主输出；让用例专注新旧生命周期声明校验及调用抑制。
       */
      render() {
        return null;
      }
    }

    await act(() => {
      root.render(<WillMount />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'WillMount uses getSnapshotBeforeUpdate() but also contains the following legacy lifecycles:\n' +
        '  UNSAFE_componentWillMount\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in WillMount (at **)',
    ]);

    /**
     * snapshot搭配旧willMount及UNSAFE_willUpdate并有didUpdate，首挂检查列表和改名提示。
     */
    class WillMountAndUpdate extends React.Component {

      /**
       * 初始化空state，避免新API的初始state缺失提示干扰待测旧方法共存诊断。
       */
      state = {};

      /**
       * 声明snapshot使组件选择新API模式；空方法隐式undefined，但本fixture只首挂，不会进入更新snapshot，待测的是声明共存诊断。
       */
      getSnapshotBeforeUpdate() {}

      /**
       * 旧式componentWillMount故障探针，空方法仅制造共存声明；用例由DEV提示检查其名称，不以返回值观察执行。
       */
      componentWillMount() {}

      /**
       * 旧式UNSAFE_componentWillUpdate故障探针，空方法仅制造共存声明；用例由DEV提示检查其名称，不以返回值观察执行。
       */
      UNSAFE_componentWillUpdate() {}

      /**
       * 提供空更新提交钩子，与snapshot成对；不另排队状态或增加日志。
       */
      componentDidUpdate() {}

      /**
       * 返回null，不产生宿主输出；让用例专注新旧生命周期声明校验及调用抑制。
       */
      render() {
        return null;
      }
    }

    await act(() => {
      root.render(<WillMountAndUpdate />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'WillMountAndUpdate uses getSnapshotBeforeUpdate() but also contains the following legacy lifecycles:\n' +
        '  componentWillMount\n' +
        '  UNSAFE_componentWillUpdate\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in WillMountAndUpdate (at **)',
    ]);
    assertConsoleWarnDev([
      'componentWillMount has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move code with side effects to componentDidMount, and set initial state in the constructor.\n' +
        '* Rename componentWillMount to UNSAFE_componentWillMount to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: WillMountAndUpdate',
    ]);

    /**
     * snapshot搭配旧willReceiveProps并有didUpdate，首挂检查更新方法声明，未执行snapshot。
     */
    class WillReceiveProps extends React.Component {

      /**
       * 初始化空state，避免新API的初始state缺失提示干扰待测旧方法共存诊断。
       */
      state = {};

      /**
       * 声明snapshot使组件选择新API模式；空方法隐式undefined，但本fixture只首挂，不会进入更新snapshot，待测的是声明共存诊断。
       */
      getSnapshotBeforeUpdate() {}

      /**
       * 旧式componentWillReceiveProps故障探针，空方法仅制造共存声明；用例由DEV提示检查其名称，不以返回值观察执行。
       */
      componentWillReceiveProps() {}

      /**
       * 提供空更新提交钩子，与snapshot成对；不另排队状态或增加日志。
       */
      componentDidUpdate() {}

      /**
       * 返回null，不产生宿主输出；让用例专注新旧生命周期声明校验及调用抑制。
       */
      render() {
        return null;
      }
    }

    await act(() => {
      root.render(<WillReceiveProps />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'WillReceiveProps uses getSnapshotBeforeUpdate() but also contains the following legacy lifecycles:\n' +
        '  componentWillReceiveProps\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in WillReceiveProps (at **)',
    ]);
    assertConsoleWarnDev([
      'componentWillReceiveProps has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        "* If you're updating state whenever props change, refactor your code to use " +
        'memoization techniques or move it to static getDerivedStateFromProps. ' +
        'Learn more at: https://react.dev/link/derived-state\n' +
        '* Rename componentWillReceiveProps to UNSAFE_componentWillReceiveProps to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: WillReceiveProps',
    ]);
  });

  /**
   * gDSFP 空函数返回undefined、state已初始化；首挂DEV要求状态对象或null，再重复render用于警告去重，验证返回协议校验。
   */
  it('should warn if getDerivedStateFromProps returns undefined', async () => {

    /**
     * gDSFP无返回值的错误协议fixture；state已初始化，排除初始状态缺失的其他警告。
     */
    class MyComponent extends React.Component {

      /**
       * 初始化空state，使唯一待测问题是派生返回undefined。
       */
      state = {};

      /**
       * 空派生方法隐式返回undefined，故意触发要求对象或null的DEV诊断。
       */
      static getDerivedStateFromProps() {}

      /**
       * 返回null，不生成UI；重复root render用于同组件类型警告去重。
       */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<MyComponent />);
    });
    assertConsoleErrorDev([
      'MyComponent.getDerivedStateFromProps(): A valid state object (or null) must ' +
        'be returned. You have returned undefined.\n' +
        '    in MyComponent (at **)',
    ]);

    // 去重
    await act(() => {
      root.render(<MyComponent />);
    });
  });

  /**
   * gDSFP返回null但实例未初始化state；首挂DEV初始state形状提示，再重复render检查去重，区分初始state缺失与派生返回值错误。
   */
  it('should warn if state is not initialized before getDerivedStateFromProps', async () => {

    /**
     * 有gDSFP但不初始化state的fixture；返回null本身合法，待测问题是初始state形状。
     */
    class MyComponent extends React.Component {

      /**
       * 返回null不修改状态；没有初始state的搭配触发初始化提示，而不是返回值错误。
       */
      static getDerivedStateFromProps() {
        return null;
      }

      /**
       * 返回null，输出不干扰初始state诊断与去重。
       */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<MyComponent />);
    });
    assertConsoleErrorDev([
      '`MyComponent` uses `getDerivedStateFromProps` but its initial state is ' +
        'undefined. This is not recommended. Instead, define the initial state by ' +
        'assigning an object to `this.state` in the constructor of `MyComponent`. ' +
        'This ensures that `getDerivedStateFromProps` arguments have a consistent shape.\n' +
        '    in MyComponent (at **)',
    ]);

    // 去重
    await act(() => {
      root.render(<MyComponent />);
    });
  });

  /**
   * 同类同时定义旧名与UNSAFE_两套旧生命周期，且不定义gDSFP/snapshot；首挂按旧名→UNSAFE_ willMount，更新按两次receiveProps后两次willUpdate，证明两套名称均被调用并保留旧名警告。
   */
  it('should invoke both deprecated and new lifecycles if both are present', async () => {
    const log = [];

    /**
     * 同时声明旧名与UNSAFE_两组旧生命周期的顺序fixture；不使用gDSFP/snapshot，所以两组方法都可执行。
     */
    class MyComponent extends React.Component {

      /**
       * 向log追加componentWillMount标签，无返回值；本类无gDSFP/snapshot，所以旧名和UNSAFE_方法都按阶段依次调用。
       */
      componentWillMount() {
        log.push('componentWillMount');
      }

      /**
       * 向log追加componentWillReceiveProps标签，无返回值；本类无gDSFP/snapshot，所以旧名和UNSAFE_方法都按阶段依次调用。
       */
      componentWillReceiveProps() {
        log.push('componentWillReceiveProps');
      }

      /**
       * 向log追加componentWillUpdate标签，无返回值；本类无gDSFP/snapshot，所以旧名和UNSAFE_方法都按阶段依次调用。
       */
      componentWillUpdate() {
        log.push('componentWillUpdate');
      }

      /**
       * 向log追加UNSAFE_componentWillMount标签，无返回值；本类无gDSFP/snapshot，所以旧名和UNSAFE_方法都按阶段依次调用。
       */
      UNSAFE_componentWillMount() {
        log.push('UNSAFE_componentWillMount');
      }

      /**
       * 向log追加UNSAFE_componentWillReceiveProps标签，无返回值；本类无gDSFP/snapshot，所以旧名和UNSAFE_方法都按阶段依次调用。
       */
      UNSAFE_componentWillReceiveProps() {
        log.push('UNSAFE_componentWillReceiveProps');
      }

      /**
       * 向log追加UNSAFE_componentWillUpdate标签，无返回值；本类无gDSFP/snapshot，所以旧名和UNSAFE_方法都按阶段依次调用。
       */
      UNSAFE_componentWillUpdate() {
        log.push('UNSAFE_componentWillUpdate');
      }

      /**
       * 返回null，所有有效观测来自同一阶段旧名与UNSAFE_日志的先后。
       */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<MyComponent foo="bar" />);
    });
    assertConsoleWarnDev([
      'componentWillMount has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move code with side effects to componentDidMount, and set initial state in the constructor.\n' +
        '* Rename componentWillMount to UNSAFE_componentWillMount to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: MyComponent',
      'componentWillReceiveProps has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        "* If you're updating state whenever props change, refactor your code to use " +
        'memoization techniques or move it to static getDerivedStateFromProps. ' +
        'Learn more at: https://react.dev/link/derived-state\n' +
        '* Rename componentWillReceiveProps to UNSAFE_componentWillReceiveProps to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: MyComponent',
      'componentWillUpdate has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        '* Rename componentWillUpdate to UNSAFE_componentWillUpdate to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: MyComponent',
    ]);
    expect(log).toEqual(['componentWillMount', 'UNSAFE_componentWillMount']);

    log.length = 0;

    await act(() => {
      root.render(<MyComponent foo="baz" />);
    });
    expect(log).toEqual([
      'componentWillReceiveProps',
      'UNSAFE_componentWillReceiveProps',
      'componentWillUpdate',
      'UNSAFE_componentWillUpdate',
    ]);
  });

  /**
   * Child派生spread prevState并同步remote prop，updateState同时子函数式local+1与父remote+1；直接方法和DOM点击后分别remote1/local1、remote2/local2，证明派生收到已处理本轮补丁的state而不覆盖local为旧值。
   */
  it('should not override state with stale values if prevState is spread within getDerivedStateFromProps', async () => {
    const divRef = React.createRef();
    let childInstance;

    /**
     * 同时接收remote prop和维护local状态的Child；派生展开prevState检验本轮本地补丁不会被旧值覆盖。
     */
    class Child extends React.Component {

      /**
       * local=0初始计数，remote由派生从父prop补入，两个通道必须独立递增。
       */
      state = {local: 0};

      /**
       * 接收本轮已处理更新后的prevState，展开其字段并覆盖remote=nextProps.remote；返回状态补丁而不是再次setState，local保持最新值。
       */
      static getDerivedStateFromProps(nextProps, prevState) {
        return {...prevState, remote: nextProps.remote};
      }

      /**
       * 先用函数updater排队local+1，再onChange读取当前已提交remote+1通知父；两更新可同批处理，派生必须保留新的local。
       */
      updateState = () => {
        this.setState(state => ({local: state.local + 1}));
        this.props.onChange(this.state.remote + 1);
      };

      /**
       * 把实例暴露给测试，返回带updateState click及divRef的remote/local文本div；方法调用与真实DOM事件使用同一状态路径。
       */
      render() {
        childInstance = this;
        return (
          <div
            onClick={this.updateState}
            ref={
              divRef
            }>{`remote:${this.state.remote}, local:${this.state.local}`}</div>
        );
      }
    }

    /**
     * 以value状态提供Child.remote的父fixture，和子local更新一起构造同批派生回归。
     */
    class Parent extends React.Component {

      /**
       * value=0初始化remote基准，handleChange接收子通知后的新值。
       */
      state = {value: 0};

      /**
       * 接收新的远端value并setState，不返回结果；与子local补丁一起进入本轮队列。
       */
      handleChange = value => {
        this.setState({value});
      };

      /**
       * 返回Child(remote=value,onChange)，父不持有或修改Child.local。
       */
      render() {
        return <Child remote={this.state.value} onChange={this.handleChange} />;
      }
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<Parent />);
    });
    expect(divRef.current.textContent).toBe('remote:0, local:0');

    // 触发 setState() 调用
    await act(() => {
      childInstance.updateState();
    });
    expect(divRef.current.textContent).toBe('remote:1, local:1');

    // 触发批量 setState() 调用。
    await act(() => {
      divRef.current.click();
    });
    expect(divRef.current.textContent).toBe('remote:2, local:2');
    document.body.removeChild(container);
  });

  /**
   * gDSFP每轮把value加1，props foo→bar→baz；snapshot与didUpdate均接收旧props/旧state，snapshot字符串abc完整传入didUpdate；初挂只有render、删除无更新日志，验证快照协议的阶段和参数。
   */
  it('should pass the return value from getSnapshotBeforeUpdate to componentDidUpdate', async () => {
    const log = [];

    /**
     * 每轮派生递增state并返回固定snapshot的参数协议fixture；日志区分旧props/state与新render。
     */
    class MyComponent extends React.Component {

      /**
       * value=0起点，首挂派生变1，每次更新再加1，便于核对prevState参数。
       */
      state = {
        value: 0,
      };

      /**
       * 用prevState.value+1返回补丁，nextProps未参与计算；每轮都改变state以生成可识别旧值。
       */
      static getDerivedStateFromProps(nextProps, prevState) {
        return {
          value: prevState.value + 1,
        };
      }

      /**
       * 记录prevProps.value和prevState.value，返回abc作为commit前snapshot；只在更新调用，首挂没有snapshot。
       */
      getSnapshotBeforeUpdate(prevProps, prevState) {
        log.push(
          `getSnapshotBeforeUpdate() prevProps:${prevProps.value} prevState:${prevState.value}`,
        );
        return 'abc';
      }

      /**
       * 接收旧props/旧state和abc snapshot，记日志供传递一致性断言；不排队新更新。
       */
      componentDidUpdate(prevProps, prevState, snapshot) {
        log.push(
          `componentDidUpdate() prevProps:${prevProps.value} prevState:${prevState.value} snapshot:${snapshot}`,
        );
      }

      /**
       * 记录render并返回null，避免DOM变化混入参数传递测试。
       */
      render() {
        log.push('render');
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(
        <div>
          <MyComponent value="foo" />
        </div>,
      );
    });
    expect(log).toEqual(['render']);
    log.length = 0;

    await act(() => {
      root.render(
        <div>
          <MyComponent value="bar" />
        </div>,
      );
    });
    expect(log).toEqual([
      'render',
      'getSnapshotBeforeUpdate() prevProps:foo prevState:1',
      'componentDidUpdate() prevProps:foo prevState:1 snapshot:abc',
    ]);
    log.length = 0;

    await act(() => {
      root.render(
        <div>
          <MyComponent value="baz" />
        </div>,
      );
    });
    expect(log).toEqual([
      'render',
      'getSnapshotBeforeUpdate() prevProps:bar prevState:2',
      'componentDidUpdate() prevProps:bar prevState:2 snapshot:abc',
    ]);
    log.length = 0;

    await act(() => {
      root.render(<div />);
    });
    expect(log).toEqual([]);
  });

  /**
   * 构造器state.value取initial，gDSFP把新prop推到nextState，SCU比较nextState与this.state；更新prop后DOM为updated，证明SCU看到实例旧state而非提前替换成派生新state。
   */
  it('should pass previous state to shouldComponentUpdate even with getDerivedStateFromProps', async () => {
    const divRef = React.createRef();

    /**
     * 派生nextState与实例旧state比较的SCUfixture，验证提前更新实例state会错误bailout的回归场景。
     */
    class SimpleComponent extends React.Component {

      /**
       * 保存props并以props.value初始化state.value，建立首次提交基准。
       */
      constructor(props) {
        super(props);
        this.state = {
          value: props.value,
        };
      }

      /**
       * 新prop value与prevState相等时返回null，否则返回value补丁；nextState代表本轮候选派生结果。
       */
      static getDerivedStateFromProps(nextProps, prevState) {
        if (nextProps.value === prevState.value) {
          return null;
        }
        return {value: nextProps.value};
      }

      /**
       * 比较nextState.value与仍为旧值的this.state.value，返回是否改变；nextProps未读取，成功更新证明两份state不会过早混成同一值。
       */
      shouldComponentUpdate(nextProps, nextState) {
        return nextState.value !== this.state.value;
      }

      /**
       * 返回带divRef的state文本，让SCU判定是否放行可直接从DOM观察。
       */
      render() {
        return <div ref={divRef}>value: {this.state.value}</div>;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<SimpleComponent value="initial" />);
    });
    expect(divRef.current.textContent).toBe('value: initial');
    await act(() => {
      root.render(<SimpleComponent value="updated" />);
    });
    expect(divRef.current.textContent).toBe('value: updated');
  });

  /**
   * 组件value foo→bar；snapshot中ref DOM仍foo，didUpdate中已经bar且snapshot=foobar，日志render→snapshot→didUpdate，证明before-mutation读取旧宿主树、layout读取新宿主树。
   */
  it('should call getSnapshotBeforeUpdate before mutations are committed', async () => {
    const log = [];

    /**
     * snapshot读旧DOM、didUpdate读新DOM的阶段探针；divRef保持同一宿主节点。
     */
    class MyComponent extends React.Component {

      /**
       * 对象ref保存已提交div，snapshot与layout两阶段读取相同节点但不同已提交文本。
       */
      divRef = React.createRef();

      /**
       * before-mutation记录日志并断言DOM仍匹配prevProps.value，返回foobar；prevState未用，宿主修改还没发生。
       */
      getSnapshotBeforeUpdate(prevProps, prevState) {
        log.push('getSnapshotBeforeUpdate');
        expect(this.divRef.current.textContent).toBe(
          `value:${prevProps.value}`,
        );
        return 'foobar';
      }

      /**
       * layout记录日志，断言DOM匹配当前props.value且snapshot=foobar；prevProps/prevState虽传入但不用于这里的DOM比较。
       */
      componentDidUpdate(prevProps, prevState, snapshot) {
        log.push('componentDidUpdate');
        expect(this.divRef.current.textContent).toBe(
          `value:${this.props.value}`,
        );
        expect(snapshot).toBe('foobar');
      }

      /**
       * 记录render并返回当前value文本div；候选输出先算好，实际DOM直到mutation才改变。
       */
      render() {
        log.push('render');
        return <div ref={this.divRef}>{`value:${this.props.value}`}</div>;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<MyComponent value="foo" />);
    });
    expect(log).toEqual(['render']);
    log.length = 0;

    await act(() => {
      root.render(<MyComponent value="bar" />);
    });
    expect(log).toEqual([
      'render',
      'getSnapshotBeforeUpdate',
      'componentDidUpdate',
    ]);
    log.length = 0;
  });

  /**
   * snapshot空函数搭配didUpdate，首挂正常，foo→bar更新后DEV要求快照值或null；baz再更新用于去重，避免把初挂不调用snapshot误当返回值校验。
   */
  it('should warn if getSnapshotBeforeUpdate returns undefined', async () => {

    /**
     * snapshot隐式undefined的更新协议fixture；配套didUpdate使诊断聚焦快照返回值。
     */
    class MyComponent extends React.Component {

      /**
       * 空snapshot隐式返回undefined，第二轮更新才触发DEV返回协议提示，首挂不会调用它。
       */
      getSnapshotBeforeUpdate() {}

      /**
       * 空didUpdate，作为snapshot合法搭配的消费钩子，不产生另一个缺失方法警告。
       */
      componentDidUpdate() {}

      /**
       * 返回null，foo/bar/baz prop变化仅用于触发更新钩子及提示去重。
       */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<MyComponent value="foo" />);
    });

    await act(() => {
      root.render(<MyComponent value="bar" />);
    });
    assertConsoleErrorDev([
      'MyComponent.getSnapshotBeforeUpdate(): A snapshot value (or null) must ' +
        'be returned. You have returned undefined.\n' +
        '    in MyComponent (at **)',
    ]);

    // 去重
    await act(() => {
      root.render(<MyComponent value="baz" />);
    });
  });

  /**
   * 只定义snapshot返回null，没有didUpdate；首挂即DEV要求两方法配对，重复render去重；问题是消费钩子缺失而非快照返回值错误。
   */
  it('should warn if getSnapshotBeforeUpdate is defined with no componentDidUpdate', async () => {

    /**
     * 只定义snapshot却缺少didUpdate的fixture，验证方法成对声明的开发提示。
     */
    class MyComponent extends React.Component {

      /**
       * 返回合法null快照，但组件没有后续didUpdate消费钩子；本例首挂直接检查声明诊断。
       */
      getSnapshotBeforeUpdate() {
        return null;
      }

      /**
       * 返回null，重复render只验证提示去重。
       */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<MyComponent />);
    });
    assertConsoleErrorDev([
      'MyComponent: getSnapshotBeforeUpdate() should be used with componentDidUpdate(). ' +
        'This component defines getSnapshotBeforeUpdate() only.\n' +
        '    in MyComponent (at **)',
    ]);

    // 去重
    await act(() => {
      root.render(<MyComponent />);
    });
  });

  /**
   * 仅定义三个旧名空生命周期；首次挂载断言三种改名提示，再更新同实例及换key建新实例都不新增已去重提示，覆盖按组件类型去重。
   */
  it('warns about deprecated unsafe lifecycles', async () => {

    /**
     * 仅声明三个未加UNSAFE_前缀的旧生命周期，用来验证改名提示按组件类型去重。
     */
    class MyComponent extends React.Component {

      /**
       * 空旧名componentWillMount方法，制造相应改名提示；不排队状态、不提供日志，后续实例用于检查按组件类型去重。
       */
      componentWillMount() {}

      /**
       * 空旧名componentWillReceiveProps方法，制造相应改名提示；不排队状态、不提供日志，后续实例用于检查按组件类型去重。
       */
      componentWillReceiveProps() {}

      /**
       * 空旧名componentWillUpdate方法，制造相应改名提示；不排队状态、不提供日志，后续实例用于检查按组件类型去重。
       */
      componentWillUpdate() {}

      /**
       * 返回null；更新同实例及换key建新实例都不应重新产生已报告提示。
       */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));

    await act(() => {
      root.render(<MyComponent x={1} />);
    });
    assertConsoleWarnDev([
      `componentWillMount has been renamed, and is not recommended for use. See https://react.dev/link/unsafe-component-lifecycles for details.

* Move code with side effects to componentDidMount, and set initial state in the constructor.
* Rename componentWillMount to UNSAFE_componentWillMount to suppress this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, you can run \`npx react-codemod rename-unsafe-lifecycles\` in your project source folder.

Please update the following components: MyComponent`,
      `componentWillReceiveProps has been renamed, and is not recommended for use. See https://react.dev/link/unsafe-component-lifecycles for details.

* Move data fetching code or side effects to componentDidUpdate.
* If you're updating state whenever props change, refactor your code to use memoization techniques or move it to static getDerivedStateFromProps. Learn more at: https://react.dev/link/derived-state
* Rename componentWillReceiveProps to UNSAFE_componentWillReceiveProps to suppress this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, you can run \`npx react-codemod rename-unsafe-lifecycles\` in your project source folder.

Please update the following components: MyComponent`,
      `componentWillUpdate has been renamed, and is not recommended for use. See https://react.dev/link/unsafe-component-lifecycles for details.

* Move data fetching code or side effects to componentDidUpdate.
* Rename componentWillUpdate to UNSAFE_componentWillUpdate to suppress this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, you can run \`npx react-codemod rename-unsafe-lifecycles\` in your project source folder.

Please update the following components: MyComponent`,
    ]);

    // 去重检查（更新现有组件并实例化新组件）。
    await act(() => {
      root.render(<MyComponent x={2} />);
    });
    await act(() => {
      root.render(<MyComponent key="new" x={1} />);
    });
  });

  describe('react-lifecycles-compat', () => {
    const {polyfill} = require('react-lifecycles-compat');

    /**
     * 先对含gDSFP的class调用react-lifecycles-compat polyfill，再在StrictMode挂载；await act完成且没有预期警告列表，验证兼容标记不触发旧API告警，不据此推断方法调用次数。
     */
    it('should not warn for components with polyfilled getDerivedStateFromProps', async () => {

      /**
       * 经react-lifecycles-compat标记的gDSFPfixture；StrictMode首挂用于确保polyfill不会引入未预期旧API提示。
       */
      class PolyfilledComponent extends React.Component {

        /**
         * 空state与派生null搭配，使测试聚焦兼容标记而非初始state警告。
         */
        state = {};

        /**
         * 返回null不改变state，polyfill/React仅需识别新API与兼容标记。
         */
        static getDerivedStateFromProps() {
          return null;
        }

        /**
         * 返回null，不提供方法调用次数日志；本例只观察StrictMode挂载完成。
         */
        render() {
          return null;
        }
      }

      polyfill(PolyfilledComponent);

      const root = ReactDOMClient.createRoot(document.createElement('div'));
      await act(() => {
        root.render(
          <React.StrictMode>
            <PolyfilledComponent />
          </React.StrictMode>,
        );
      });
    });

    /**
     * 含snapshot/null和空didUpdate的class先polyfill，再StrictMode首挂；用例没有后续更新或快照顺序断言，观察是兼容组件挂载完成且不产生未预期警告。
     */
    it('should not warn for components with polyfilled getSnapshotBeforeUpdate', async () => {

      /**
       * 经compat polyfill的snapshot fixture，配套didUpdate；本例只有StrictMode首挂，没有实际更新快照调用。
       */
      class PolyfilledComponent extends React.Component {

        /**
         * 返回合法nullsnapshot，供polyfill识别能力；初挂时snapshot不会执行。
         */
        getSnapshotBeforeUpdate() {
          return null;
        }

        /**
         * 空didUpdate，与snapshot成对避免缺失消费钩子提示。
         */
        componentDidUpdate() {}

        /**
         * 返回null，让兼容标记检查不受宿主输出干扰。
         */
        render() {
          return null;
        }
      }

      polyfill(PolyfilledComponent);

      const root = ReactDOMClient.createRoot(document.createElement('div'));
      await act(() => {
        root.render(
          <React.StrictMode>
            <PolyfilledComponent />
          </React.StrictMode>,
        );
      });
    });
  });
});
