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
let ReactDOMClient;
let act;
let Scheduler;
let assertLog;
let TestComponent;
let testComponentInstance;
let assertConsoleErrorDev;

describe('ReactCompositeComponent-state', () => {
  beforeEach(() => {
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
    Scheduler = require('scheduler');

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;

    /** 透传children并在每次passive effect记commit color，区分render/layout callback与提交后日志。 */
    function LogAfterCommit({children, color}) {
      React.useEffect(() => {
        Scheduler.log(`commit ${color}`);
      });
      return children;
    }

    /** 用完整类生命周期/更新器日志观察state队列，颜色变化与回调顺序均由case逐段断言。 */
    TestComponent = class extends React.Component {

      /** 在给state赋red前记录getInitialState标签并保存实例，标签沿用旧命名而非调用getInitialState方法。 */
      constructor(props) {
        super(props);
        this.peekAtState('getInitialState', undefined, props);
        this.state = {color: 'red'};
        testComponentInstance = this;
      }

      /** 记录来源与给定或当前state.color；props参数保留签名但本实现未使用。 */
      peekAtState = (from, state = this.state, props = this.props) => {
        Scheduler.log(`${from} ${state && state.color}`);
      };

      /** 返回提交回调，执行时读取当时this.state而非排队时state，比较最终颜色。 */
      peekAtCallback = from => {
        return () => this.peekAtState(from);
      };

      /** 排对象color更新及有名称的提交回调，验证外部方法setState。 */
      setFavoriteColor(nextColor) {
        this.setState(
          {color: nextColor},
          this.peekAtCallback('setFavoriteColor'),
        );
      }

      /** 记录render当前color并包LogAfterCommit，DOM/passive日志对应该次状态。 */
      render() {
        this.peekAtState('render');
        return (
          <LogAfterCommit color={this.state.color}>
            <div>{this.state.color}</div>
          </LogAfterCommit>
        );
      }

      /** 依次插入只观察的函数更新、sunrise与orange对象更新及回调；生命周期内this.state仍red，处理队列时观察更新器间的中间值。 */
      UNSAFE_componentWillMount() {
        this.peekAtState('componentWillMount-start');
        this.setState(function (state) {
          this.peekAtState('before-setState-sunrise', state);
        });
        this.setState(
          {color: 'sunrise'},
          this.peekAtCallback('setState-sunrise'),
        );
        this.setState(function (state) {
          this.peekAtState('after-setState-sunrise', state);
        });
        this.peekAtState('componentWillMount-after-sunrise');
        this.setState(
          {color: 'orange'},
          this.peekAtCallback('setState-orange'),
        );
        this.setState(function (state) {
          this.peekAtState('after-setState-orange', state);
        });
        this.peekAtState('componentWillMount-end');
      }

      /** 挂载后排yellow并记前后仍orange；yellow下一提交处理，不能回写当前提交回调观察值。 */
      componentDidMount() {
        this.peekAtState('componentDidMount-start');
        this.setState(
          {color: 'yellow'},
          this.peekAtCallback('setState-yellow'),
        );
        this.peekAtState('componentDidMount-end');
      }

      /** 收到nextColor时排函数更新、内部replaceState(color undefined)、再次函数更新及回调；观察替换与后续浅合并的顺序。 */
      UNSAFE_componentWillReceiveProps(newProps) {
        this.peekAtState('componentWillReceiveProps-start');
        if (newProps.nextColor) {
          this.setState(function (state) {
            this.peekAtState('before-setState-receiveProps', state);
            return {color: newProps.nextColor};
          });
          // 不再是一个公开的 API。 但我们可以通过进入更新器来检测它是否内部工作.
          this.updater.enqueueReplaceState(this, {color: undefined});
          this.setState(function (state) {
            this.peekAtState('before-setState-again-receiveProps', state);
            return {color: newProps.nextColor};
          }, this.peekAtCallback('setState-receiveProps'));
          this.setState(function (state) {
            this.peekAtState('after-setState-receiveProps', state);
          });
        }
        this.peekAtState('componentWillReceiveProps-end');
      }

      /** 记录旧this.state与已计算nextState后返回true，验证SCU尚未替换实例状态。 */
      shouldComponentUpdate(nextProps, nextState) {
        this.peekAtState('shouldComponentUpdate-currentState');
        this.peekAtState('shouldComponentUpdate-nextState', nextState);
        return true;
      }

      /** 更新前同时记录旧/新状态，不另发更新。 */
      UNSAFE_componentWillUpdate(nextProps, nextState) {
        this.peekAtState('componentWillUpdate-currentState');
        this.peekAtState('componentWillUpdate-nextState', nextState);
      }

      /** 提交后记录新this.state及prevState，证明实例状态此时已更新。 */
      componentDidUpdate(prevProps, prevState) {
        this.peekAtState('componentDidUpdate-currentState');
        this.peekAtState('componentDidUpdate-prevState', prevState);
      }

      /** 卸载前读最后state颜色，验证删除生命周期仍可访问实例状态。 */
      componentWillUnmount() {
        this.peekAtState('componentWillUnmount');
      }
    };
  });

  /** 类初red，willMount排sunrise/orange，didMount再yellow，随后props green含replaceState、方法blue、forceUpdate再卸载；逐段日志验证队列读取旧this.state、更新器顺序、提交回调读取最终状态及force跳过SCU。 */
  it('should support setting state', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<TestComponent />);
    });

    assertLog([
      // 构造器在赋初始red前使用getInitialState日志标签，此时state尚未初始化。
      'getInitialState undefined',
      'componentWillMount-start red',
      // setState() 只会把待处理状态入队。
      'componentWillMount-after-sunrise red',
      'componentWillMount-end red',
      // 待定状态排队处理
      'before-setState-sunrise red',
      'after-setState-sunrise sunrise',
      'after-setState-orange orange',
      // 待处理状态已应用。
      'render orange',
      'componentDidMount-start orange',
      // setState-sunrise 与 setState-orange 应在这里触发；这是修复 #1740 后的顺序。
      // componentDidMount() 的 yellow 更新先入队；当前提交回调完成后再同步处理下一次提交。
      'componentDidMount-end orange',
      'setState-sunrise orange',
      'setState-orange orange',
      'commit orange',
      'shouldComponentUpdate-currentState orange',
      'shouldComponentUpdate-nextState yellow',
      'componentWillUpdate-currentState orange',
      'componentWillUpdate-nextState yellow',
      'render yellow',
      'componentDidUpdate-currentState yellow',
      'componentDidUpdate-prevState orange',
      'setState-yellow yellow',
      'commit yellow',
    ]);

    await act(() => {
      root.render(<TestComponent nextColor="green" />);
    });

    assertLog([
      'componentWillReceiveProps-start yellow',
      // setState({color:'green'}) 只会把待处理状态入队。
      'componentWillReceiveProps-end yellow',
      // 处理函数更新后执行enqueueReplaceState的对象替换；下一个更新器先看到color undefined。
      'before-setState-receiveProps yellow',
      'before-setState-again-receiveProps undefined',
      'after-setState-receiveProps green',
      'shouldComponentUpdate-currentState yellow',
      'shouldComponentUpdate-nextState green',
      'componentWillUpdate-currentState yellow',
      'componentWillUpdate-nextState green',
      'render green',
      'componentDidUpdate-currentState green',
      'componentDidUpdate-prevState yellow',
      'setState-receiveProps green',
      'commit green',
    ]);

    await act(() => {
      testComponentInstance.setFavoriteColor('blue');
    });

    assertLog([
      // setFavoriteColor('blue')
      'shouldComponentUpdate-currentState green',
      'shouldComponentUpdate-nextState blue',
      'componentWillUpdate-currentState green',
      'componentWillUpdate-nextState blue',
      'render blue',
      'componentDidUpdate-currentState blue',
      'componentDidUpdate-prevState green',
      'setFavoriteColor blue',
      'commit blue',
    ]);
    await act(() => {
      testComponentInstance.forceUpdate(
        testComponentInstance.peekAtCallback('forceUpdate'),
      );
    });
    assertLog([
      // forceUpdate()
      'componentWillUpdate-currentState blue',
      'componentWillUpdate-nextState blue',
      'render blue',
      'componentDidUpdate-currentState blue',
      'componentDidUpdate-prevState blue',
      'forceUpdate blue',
      'commit blue',
    ]);

    root.unmount();

    assertLog([
      // unmount()
      // `componentWillUnmount()` 内仍可读取 state。
      'componentWillUnmount blue',
    ]);
  });

  /** Parent/Child同batch更新state，初Intermediate允许render、后令其SCU=false仍独立Child更新；两轮日志child did update在parent前，验证子提交先于父且祖先bailout不吞子更新。 */
  it('should call componentDidUpdate of children first', async () => {
    const container = document.createElement('div');

    let child = null;
    let parent = null;

    /** 独立有state更新的子类，通过didUpdate日志比较父子提交顺序。 */
    class Child extends React.Component {

      /** 初bar=false，测试两次独立子更新true/false。 */
      state = {bar: false};

      /** 保存child实例供batch显式setState。 */
      componentDidMount() {
        child = this;
      }

      /** 记录child did update，应该先于parent did update。 */
      componentDidUpdate() {
        Scheduler.log('child did update');
      }

      /** 固定div输出，状态内容与DOM变化无关，只测生命周期。 */
      render() {
        return <div />;
      }
    }

    let shouldUpdate = true;

    /** 返回Child但SCU由外部shouldUpdate控制，构造祖先bailout。 */
    class Intermediate extends React.Component {

      /** 返回case设置的shouldUpdate，false时仍允许已排Child更新继续。 */
      shouldComponentUpdate() {
        return shouldUpdate;
      }

      /** 返回Child，为父/子之间添加可跳过复合层。 */
      render() {
        return <Child />;
      }
    }

    /** 持有foo的父类，与子bar同batch更新。 */
    class Parent extends React.Component {

      /** 初foo=false，两轮切true/false。 */
      state = {foo: false};

      /** 保存parent实例让case直接排更新。 */
      componentDidMount() {
        parent = this;
      }

      /** 记录父didUpdate，应在子之后。 */
      componentDidUpdate() {
        Scheduler.log('parent did update');
      }

      /** 返回Intermediate，父更新与中间SCU路径关联。 */
      render() {
        return <Intermediate />;
      }
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });

    await act(() => {
      parent.setState({foo: true});
      child.setState({bar: true});
    });

    // 当我们按部就班地在批处理中渲染更改时， 子组件的 componentDidUpdate 在父组件之前。
    assertLog(['child did update', 'parent did update']);

    shouldUpdate = false;

    await act(() => {
      parent.setState({foo: false});
      child.setState({bar: false});
    });

    // 即使在中途提前退出，也应发生相同结果。
    assertLog(['child did update', 'parent did update']);
  });

  /** Outer正卸载时Inner.componentWillUnmount设父showInner=false；root.unmount不抛错，验证删除子树期间的父更新不会重新进入已卸载树。本例不是forceUpdate。 */
  it('should batch unmounts', async () => {
    let outer;

    /** 正被删除的Inner，其卸载钩子再次给Outer排状态更新。 */
    class Inner extends React.Component {

      /** 固定div宿主，保持删除路径简单。 */
      render() {
        return <div />;
      }

      /** 卸载期间设置outer.showInner=false，父也正在根卸载，不应重渲染已删除实例。 */
      componentWillUnmount() {
        // Inner卸载时给也在删除中的Outer排setState，根卸载应完成而不重新进入该树。
        outer.setState({showInner: false});
      }
    }

    /** 拥有条件Inner的父类，保存实例供Inner卸载更新。 */
    class Outer extends React.Component {

      /** 初showInner=true，确保有子删除钩子。 */
      state = {showInner: true};

      /** 保存outer引用供Inner使用。 */
      componentDidMount() {
        outer = this;
      }

      /** 按showInner输出Inner，但本case通过根卸载删除整个父树。 */
      render() {
        return <div>{this.state.showInner && <Inner />}</div>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Outer />);
    });

    expect(() => {
      root.unmount();
    }).not.toThrow();
  });

  /** Parent初value=one，再同类型render触发Child.cWRP设父two；本轮Child仍one，随后父/子render two，验证子旧生命周期排父更新不即时改当前props，updated标记防循环。 */
  it('should update state when called from child cWRP', async () => {

    /** 持有one/two的父类，把自身实例和value传Child。 */
    class Parent extends React.Component {

      /** 初value=one，在Child.cWRP中被设two。 */
      state = {value: 'one'};

      /** 记录当前父值并传parent=this，制造子旧生命周期更新父的链。 */
      render() {
        Scheduler.log('parent render ' + this.state.value);
        return <Child parent={this} value={this.state.value} />;
      }
    }
    let updated = false;

    /** cWRP仅首次排父two的子类，updated外部标记防重复。 */
    class Child extends React.Component {

      /** 第一次记录旧this.props.value并排父two，当前Child render仍one，父随后再更新。 */
      UNSAFE_componentWillReceiveProps() {
        if (updated) {
          return;
        }
        Scheduler.log('child componentWillReceiveProps ' + this.props.value);
        this.props.parent.setState({value: 'two'});
        Scheduler.log(
          'child componentWillReceiveProps done ' + this.props.value,
        );
        updated = true;
      }

      /** 记录并输出this.props.value，比较旧轮与追加父更新轮。 */
      render() {
        Scheduler.log('child render ' + this.props.value);
        return <div>{this.props.value}</div>;
      }
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });

    assertLog(['parent render one', 'child render one']);
    await act(() => {
      root.render(<Parent />);
    });

    assertLog([
      'parent render one',
      'child componentWillReceiveProps one',
      'child componentWillReceiveProps done one',
      'child render one',
      'parent render two',
      'child render two',
    ]);
  });

  /** Test初state a，SCU始终false，连续setState b/c；SCU日志当前键a→a,b再a,b→a,b,c，验证跳过render仍提交浅合并状态。 */
  it('should merge state when sCU returns false', async () => {
    let test;

    /** SCU始终false的类，验证状态浅合并不依赖render执行。 */
    class Test extends React.Component {

      /** 初只有键a，后续加入b/c应保留旧键。 */
      state = {a: 0};

      /** 保存test实例，供case更新状态。 */
      componentDidMount() {
        test = this;
      }

      /** 空输出，不用DOM变化判state，SCU日志检查状态键。 */
      render() {
        return null;
      }

      /** 记录this.state/nextState键再false，下一次this.state仍应包含前次合并。 */
      shouldComponentUpdate(nextProps, nextState) {
        Scheduler.log(
          'scu from ' +
            Object.keys(this.state) +
            ' to ' +
            Object.keys(nextState),
        );
        return false;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Test />);
    });
    await act(() => {
      test.setState({b: 0});
    });

    assertLog(['scu from a to a,b']);
    await act(() => {
      test.setState({c: 0});
    });
    assertLog(['scu from a,b to a,b,c']);
  });

  /** cWRP先setState step2带callback再直接赋state step3；DEV弃用警告，render与callback均step3且extra被删，再重复更新不警告，验证直接赋值按replace而回调保留。 */
  it('should treat assigning to this.state inside cWRP as a replaceState, with a warning', async () => {

    /** 在cWRP先setState再直接赋state的类，测试替换与回调。 */
    class Test extends React.Component {

      /** 初step1/extra=true，直接替换step3应删除extra。 */
      state = {step: 1, extra: true};

      /** 排step2及提交回调后直接赋step3，renderer将赋值视作replaceState而不丢已有回调。 */
      UNSAFE_componentWillReceiveProps() {
        this.setState({step: 2}, () => {
          // 测试早期的 setState 回调不会被丢弃
          Scheduler.log(
            `callback -- step: ${this.state.step}, extra: ${!!this.state
              .extra}`,
          );
        });
        // 像 replaceState
        this.state = {step: 3};
      }

      /** 记录最终step与extra布尔后返回null，比较替换状态。 */
      render() {
        Scheduler.log(
          `render -- step: ${this.state.step}, extra: ${!!this.state.extra}`,
        );
        return null;
      }
    }

    // 挂载。
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Test />);
    });
    // 更新。
    ReactDOM.flushSync(() => {
      root.render(<Test />);
    });
    assertConsoleErrorDev([
      'Test.componentWillReceiveProps(): Assigning directly to ' +
        "this.state is deprecated (except inside a component's constructor). " +
        'Use setState instead.\n' +
        '    in Test (at **)',
    ]);

    assertLog([
      'render -- step: 1, extra: true',
      'render -- step: 3, extra: false',
      'callback -- step: 3, extra: false',
    ]);

    // 检查去重；（预期不会有额外的警告）
    expect(() => {
      ReactDOM.flushSync(() => {
        root.render(<Test />);
      });
    }).not.toThrow();
  });

  /** cWM初step1/extra，先排step2 callback再直接赋step3；flushSync警告，断言两轮render/callback均step3/extra false，验证挂载直接赋值替换旧字段且不丢前回调。 */
  it('should treat assigning to this.state inside cWM as a replaceState, with a warning', () => {

    /** 在cWM直接赋state的挂载fixture，与接收props路径对照。 */
    class Test extends React.Component {

      /** 初step1/extra=true，赋step3后extra不应保留。 */
      state = {step: 1, extra: true};

      /** 先排step2回调再赋step3，DEV诊断且提交回调读取最终替换结果。 */
      UNSAFE_componentWillMount() {
        this.setState({step: 2}, () => {
          // 测试早期的 setState 回调不会被丢弃
          Scheduler.log(
            `callback -- step: ${this.state.step}, extra: ${!!this.state
              .extra}`,
          );
        });
        // 像 replaceState
        this.state = {step: 3};
      }

      /** 记录step/extra，断言包含两轮相同结果，不增加DOM。 */
      render() {
        Scheduler.log(
          `render -- step: ${this.state.step}, extra: ${!!this.state.extra}`,
        );
        return null;
      }
    }

    // 挂载。
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    ReactDOM.flushSync(() => {
      root.render(<Test />);
    });
    assertConsoleErrorDev([
      'Test.componentWillMount(): Assigning directly to ' +
        "this.state is deprecated (except inside a component's constructor). " +
        'Use setState instead.\n' +
        '    in Test (at **)',
    ]);

    assertLog([
      'render -- step: 3, extra: false',
      'callback -- step: 3, extra: false',

      // 重试时再执行一次。
      'render -- step: 3, extra: false',
      'callback -- step: 3, extra: false',
    ]);
  });

  /** 现代根由A换B，B willMount安装subscription更新自身，A卸载调用它；DEV提示B尚未挂载的state更新，验证删除旧兄弟时不能把新树的未挂实例当已挂载；未断言最终文字。 */
  it('should not support setState in componentWillUnmount', async () => {
    let subscription;

    /** 现代根先挂A，替换为B时A卸载触发安装好的subscription。 */
    class A extends React.Component {

      /** 调用B在willMount提供的更新函数，新B尚未完成挂载而应诊断。 */
      componentWillUnmount() {
        subscription();
      }

      /** 返回A文字，确认替换起点。 */
      render() {
        return 'A';
      }
    }

    /** 现代根新挂B，旧A卸载时试图更新此实例。 */
    class B extends React.Component {

      /** 初siblingUnmounted=false，非法时点更新不应当正常已挂状态处理。 */
      state = {siblingUnmounted: false};

      /** 把更新自身状态的subscription放到外部，供A删除钩子调用。 */
      UNSAFE_componentWillMount() {
        /** 设置B.siblingUnmounted=true，但现代case触发时B尚未挂载，作为诊断输入。 */
        subscription = () => this.setState({siblingUnmounted: true});
      }

      /** 输出B及条件No Sibling，现代case主要断言警告而非最终文字。 */
      render() {
        return 'B' + (this.state.siblingUnmounted ? ' No Sibling' : '');
      }
    }

    const el = document.createElement('div');
    const root = ReactDOMClient.createRoot(el);
    await act(() => {
      root.render(<A />);
    });
    expect(el.textContent).toBe('A');

    ReactDOM.flushSync(() => {
      root.render(<B />);
    });
    assertConsoleErrorDev([
      "Can't perform a React state update on a component that hasn't mounted yet. " +
        'This indicates that you have a side-effect in your render function that ' +
        'asynchronously tries to update the component. ' +
        'Move this work to useEffect instead.\n' +
        '    in B (at **)',
    ]);
  });

  // @gate !disableLegacyMode

  /** legacy开启时同A→B替换与subscription；最终B No Sibling，验证legacy删除阶段允许该挂载路径状态更新生效。 */
  it('Legacy mode should support setState in componentWillUnmount (#18851)', () => {
    let subscription;

    /** legacy根的旧A，替换删除时也调用subscription。 */
    class A extends React.Component {

      /** 调用新B的状态更新函数，legacy挂载路径允许其生效。 */
      componentWillUnmount() {
        subscription();
      }

      /** 输出A确认legacy初始内容。 */
      render() {
        return 'A';
      }
    }

    /** legacy新B由旧A卸载触发状态更新，最终应带No Sibling。 */
    class B extends React.Component {

      /** 初siblingUnmounted=false，随后状态队列设true。 */
      state = {siblingUnmounted: false};

      /** 在legacy挂载前暴露更新函数供旧A卸载使用。 */
      UNSAFE_componentWillMount() {
        /** 把B.siblingUnmounted设true，legacy模式最终读取该合并状态。 */
        subscription = () => this.setState({siblingUnmounted: true});
      }

      /** 按状态输出B No Sibling，验证legacy行为与现代诊断区别。 */
      render() {
        return 'B' + (this.state.siblingUnmounted ? ' No Sibling' : '');
      }
    }

    const el = document.createElement('div');
    ReactDOM.render(<A />, el);
    expect(el.textContent).toBe('A');

    ReactDOM.render(<B />, el);
    expect(el.textContent).toBe('B No Sibling');
  });
});
