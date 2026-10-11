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
let PropTypes;

let act;
let assertConsoleErrorDev;

describe('ReactLegacyCompositeComponent', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    findDOMNode =
      ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
        .findDOMNode;
    PropTypes = require('prop-types');
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
  });

  // @gate !disableLegacyMode

  /** legacy类render在state=0时排setState(1)，开发报纯render警告；两次render得到1，后续根更新复用实例，卸载重挂验证警告去重。 */
  it('should warn about `setState` in render in legacy mode', () => {
    const container = document.createElement('div');

    let renderedState = -1;
    let renderPasses = 0;

    /** 在legacy render内排state更新并计数，验证警告和实例复用。 */
    class Component extends React.Component {

      /** 初始value=0，只在首次render排到1。 */
      state = {value: 0};

      /** 每次记录state，0时setState(1)；第二轮应稳定为1。 */
      render() {
        renderPasses++;
        renderedState = this.state.value;
        if (this.state.value === 0) {
          this.setState({value: 1});
        }
        return <div />;
      }
    }
    const instance = ReactDOM.render(<Component />, container);
    assertConsoleErrorDev([
      'Cannot update during an existing state transition (such as within ' +
        '`render`). Render methods should be a pure function of props and state.\n' +
        '    in Component (at **)',
    ]);

    // 本例在 render 中排队 setState，随后第二次 render 得到 1；DEV 同时诊断 render 内更新。
    expect(renderPasses).toBe(2);
    expect(renderedState).toBe(1);
    expect(instance.state.value).toBe(1);

    // 同一 root 再渲染该组件时复用实例，并保留已经得到的 state=1。
    const instance2 = ReactDOM.render(<Component prop={123} />, container);
    expect(instance).toBe(instance2);
    expect(renderedState).toBe(1);
    expect(instance2.state.value).toBe(1);

    // 测试去重；（不期望出现额外警告）。
    ReactDOM.unmountComponentAtNode(container);
    ReactDOM.render(<Component prop={123} />, container);
  });

  // @gate !disableLegacyContext

  /** Parent创建Grandchild元素交给Child，Child提供旧context foo=bar但不是其owner；Grandchild仍显示bar并报旧API警告，验证context按渲染祖先传递。 */
  it('should pass context to children when not owner', async () => {

    /** 创建Grandchild元素并交Child渲染，区分owner与context祖先。 */
    class Parent extends React.Component {

      /** 返回Child包住预创建Grandchild，Child不是该元素owner。 */
      render() {
        return (
          <Child>
            <Grandchild />
          </Child>
        );
      }
    }

    /** 向渲染子树提供旧foo上下文的包装组件。 */
    class Child extends React.Component {

      /** 声明允许提供foo字符串，启用旧child context协议。 */
      static childContextTypes = {
        foo: PropTypes.string,
      };

      /** 为后代提供foo=bar。 */
      getChildContext() {
        return {
          foo: 'bar',
        };
      }

      /** 只返回唯一传入child，让非owner祖先的context生效。 */
      render() {
        return React.Children.only(this.props.children);
      }
    }

    /** 声明消费foo并把它输出为DOM的类。 */
    class Grandchild extends React.Component {

      /** 只订阅foo键，其他旧context不会暴露给本实例。 */
      static contextTypes = {
        foo: PropTypes.string,
      };

      /** 输出this.context.foo，供findDOMNode文本验证。 */
      render() {
        return <div>{this.context.foo}</div>;
      }
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let component;
    await act(() => {
      root.render(<Parent ref={current => (component = current)} />);
    });
    assertConsoleErrorDev([
      'Child uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
      'Grandchild uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
    ]);
    expect(findDOMNode(component).innerHTML).toBe('bar');
  });

  // @gate !disableLegacyContext

  /** Parent旧context flag从false改true，Middle透传静态Child元素；Child.context随更新变化，验证元素引用稳定仍接收上下文变化。 */
  it('should pass context when re-rendered for static child', async () => {
    let parentInstance = null;
    let childInstance = null;

    /** 由自身flag驱动旧上下文，但透传稳定children的提供者。 */
    class Parent extends React.Component {

      /** 声明提供foo与flag，验证类型掩码与合并。 */
      static childContextTypes = {
        foo: PropTypes.string,
        flag: PropTypes.bool,
      };

      /** 初始flag=false，后续独立setState改true。 */
      state = {
        flag: false,
      };

      /** 固定foo=bar并从当前state提供flag。 */
      getChildContext() {
        return {
          foo: 'bar',
          flag: this.state.flag,
        };
      }

      /** 返回同一props.children元素，不主动重建Child。 */
      render() {
        return React.Children.only(this.props.children);
      }
    }

    /** 不订阅旧context的透传中间组件。 */
    class Middle extends React.Component {

      /** 返回传入children，保留静态元素引用。 */
      render() {
        return this.props.children;
      }
    }

    /** 读取foo/flag并暴露实例的消费者。 */
    class Child extends React.Component {

      /** 声明订阅foo与flag。 */
      static contextTypes = {
        foo: PropTypes.string,
        flag: PropTypes.bool,
      };

      /** 保存当前实例，DOM固定Child以直接检查context对象。 */
      render() {
        childInstance = this;
        return <span>Child</span>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(
        <Parent ref={current => (parentInstance = current)}>
          <Middle>
            <Child />
          </Middle>
        </Parent>,
      );
    });

    expect(parentInstance.state.flag).toBe(false);
    expect(childInstance.context).toEqual({foo: 'bar', flag: false});

    assertConsoleErrorDev([
      'Parent uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
      'Child uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Child (at **)',
    ]);

    await act(() => {
      parentInstance.setState({flag: true});
    });
    expect(parentInstance.state.flag).toBe(true);
    expect(childInstance.context).toEqual({foo: 'bar', flag: true});
  });

  // @gate !disableLegacyContext

  /** Wrapper持稳定Parent/Child ref，Parent独立state从true改false而Wrapper未更新；Child.context仍改变，验证复合包装中的静态child传播。 */
  it('should pass context when re-rendered for static child within a composite component', async () => {

    /** 在Wrapper内部独立改变flag的旧context提供者。 */
    class Parent extends React.Component {

      /** 声明只提供flag。 */
      static childContextTypes = {
        flag: PropTypes.bool,
      };

      /** 初始flag=true，更新false用于传播。 */
      state = {
        flag: true,
      };

      /** 将当前flag state送入旧context。 */
      getChildContext() {
        return {
          flag: this.state.flag,
        };
      }

      /** 把静态children包进div，不按flag重新创建子元素。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    /** 声明消费flag的静态Child。 */
    class Child extends React.Component {

      /** 订阅flag键。 */
      static contextTypes = {
        flag: PropTypes.bool,
      };

      /** 输出固定div，让测试通过ref检查context变化。 */
      render() {
        return <div />;
      }
    }

    /** 保持Parent与Child对象ref的外层包装。 */
    class Wrapper extends React.Component {

      /** 保存Parent实例供测试触发其独立setState。 */
      parentRef = React.createRef();

      /** 保存Child实例供读取context。 */
      childRef = React.createRef();

      /** 创建Parent/Child并连接稳定对象ref。 */
      render() {
        return (
          <Parent ref={this.parentRef}>
            <Child ref={this.childRef} />
          </Parent>
        );
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let wrapper;
    await act(() => {
      root.render(<Wrapper ref={current => (wrapper = current)} />);
    });

    assertConsoleErrorDev([
      'Parent uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Wrapper (at **)',
      'Child uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Wrapper (at **)',
    ]);

    expect(wrapper.parentRef.current.state.flag).toEqual(true);
    expect(wrapper.childRef.current.context).toEqual({flag: true});

    // 更新 <Parent />；相对于这次更新，<Child /> 仍是未变化的静态 prop。
    await act(() => {
      wrapper.parentRef.current.setState({flag: false});
    });

    expect(wrapper.parentRef.current.state.flag).toEqual(false);
    expect(wrapper.childRef.current.context).toEqual({flag: false});
  });

  // @gate !disableLegacyContext

  /** Parent提供foo/depth=0，Child消费并只提供depth+1，Grandchild接foo与depth=1；验证旧context合并继承而非完全替换。 */
  it('should pass context transitively', async () => {
    let childInstance = null;
    let grandchildInstance = null;

    /** 提供foo与初始depth的祖先。 */
    class Parent extends React.Component {

      /** 声明提供foo和depth键。 */
      static childContextTypes = {
        foo: PropTypes.string,
        depth: PropTypes.number,
      };

      /** 固定提供foo=bar、depth=0。 */
      getChildContext() {
        return {
          foo: 'bar',
          depth: 0,
        };
      }

      /** 返回同时消费与派生context的Child。 */
      render() {
        return <Child />;
      }
    }

    /** 消费完整父context但只重提供depth，检验剩余foo继承。 */
    class Child extends React.Component {

      /** 声明消费foo/depth。 */
      static contextTypes = {
        foo: PropTypes.string,
        depth: PropTypes.number,
      };

      /** 只声明提供新的depth，不替换父foo。 */
      static childContextTypes = {
        depth: PropTypes.number,
      };

      /** 按消费的depth加一，派生后代层数。 */
      getChildContext() {
        return {
          depth: this.context.depth + 1,
        };
      }

      /** 保存Child实例并返回Grandchild。 */
      render() {
        childInstance = this;
        return <Grandchild />;
      }
    }

    /** 消费合并后foo与depth的最内层组件。 */
    class Grandchild extends React.Component {

      /** 声明消费两键，供断言继承和覆盖。 */
      static contextTypes = {
        foo: PropTypes.string,
        depth: PropTypes.number,
      };

      /** 保存实例并返回div。 */
      render() {
        grandchildInstance = this;
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });

    assertConsoleErrorDev([
      'Parent uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
      'Child uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
      'Child uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
      'Grandchild uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Child (at **)\n' +
        '    in Parent (at **)',
    ]);

    expect(childInstance.context).toEqual({foo: 'bar', depth: 0});
    expect(grandchildInstance.context).toEqual({foo: 'bar', depth: 1});
  });

  // @gate !disableLegacyContext

  /** Parent初始flag=false只输出主机span，更新true首次挂载Child；新Child接foo/depth且旧API警告在挂载时出现，验证更新引入消费者仍获当前context。 */
  it('should pass context when re-rendered', async () => {
    let parentInstance = null;
    let childInstance = null;

    /** 按flag从主机span切到context消费者，验证更新首次引入子类。 */
    class Parent extends React.Component {

      /** 声明foo与depth提供协议。 */
      static childContextTypes = {
        foo: PropTypes.string,
        depth: PropTypes.number,
      };

      /** 初始flag=false，避免Child首次挂载。 */
      state = {
        flag: false,
      };

      /** 保持foo=bar/depth=0的上下文输出。 */
      getChildContext() {
        return {
          foo: 'bar',
          depth: 0,
        };
      }

      /** flag=false返回span，true返回Child，因此更新是新挂载消费者。 */
      render() {
        let output = <Child />;
        if (!this.state.flag) {
          output = <span>Child</span>;
        }
        return output;
      }
    }

    /** 更新才挂载的旧context消费者。 */
    class Child extends React.Component {

      /** 订阅foo/depth。 */
      static contextTypes = {
        foo: PropTypes.string,
        depth: PropTypes.number,
      };

      /** 保存新实例并输出固定span，供检查当前context。 */
      render() {
        childInstance = this;
        return <span>Child</span>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent ref={current => (parentInstance = current)} />);
    });
    assertConsoleErrorDev([
      'Parent uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
    ]);

    expect(childInstance).toBeNull();

    expect(parentInstance.state.flag).toBe(false);
    await act(() => {
      parentInstance.setState({flag: true});
    });
    assertConsoleErrorDev([
      'Child uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
    ]);

    expect(parentInstance.state.flag).toBe(true);

    expect(childInstance.context).toEqual({foo: 'bar', depth: 0});
  });

  // @gate !disableLegacyContext
  // @gate !disableLegacyMode

  /** Parent context noise经未声明context的Intermediary到Leaf；更新bar时中间生命周期看不到foo、Leaf看到，文本改bar但手工id仍保留，验证未掩码上下文穿透与消费者掩码。 */
  it('unmasked context propagates through updates', () => {

    /** 在两更新生命周期中检查掩码foo并把它输出到DOM。 */
    class Leaf extends React.Component {

      /** 订阅必需foo，令Leaf的nextContext包含该键。 */
      static contextTypes = {
        foo: PropTypes.string.isRequired,
      };

      /** 检查即将接收的context含foo。 */
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        expect('foo' in nextContext).toBe(true);
      }

      /** 检查SCU的nextContext含foo并允许更新。 */
      shouldComponentUpdate(nextProps, nextState, nextContext) {
        expect('foo' in nextContext).toBe(true);
        return true;
      }

      /** 输出当前foo文本，供外部DOM改写后的上下文更新校验。 */
      render() {
        return <span>{this.context.foo}</span>;
      }
    }

    /** 未订阅context但仍把完整祖先context向Leaf传播的中间类。 */
    class Intermediary extends React.Component {

      /** 确认未声明contextTypes的自身nextContext不包含foo。 */
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        expect('foo' in nextContext).toBe(false);
      }

      /** 确认SCU也看不到foo，但允许更新。 */
      shouldComponentUpdate(nextProps, nextState, nextContext) {
        expect('foo' in nextContext).toBe(false);
        return true;
      }

      /** 返回订阅foo的Leaf，不屏蔽后代所需完整context。 */
      render() {
        return <Leaf />;
      }
    }

    /** 以cntxt prop作为foo值的提供者。 */
    class Parent extends React.Component {

      /** 声明提供foo。 */
      static childContextTypes = {
        foo: PropTypes.string,
      };

      /** 从当前cntxt prop读出foo，支持noise到bar更新。 */
      getChildContext() {
        return {
          foo: this.props.cntxt,
        };
      }

      /** 返回未订阅context的Intermediary。 */
      render() {
        return <Intermediary />;
      }
    }

    const div = document.createElement('div');
    ReactDOM.render(<Parent cntxt="noise" />, div);
    assertConsoleErrorDev([
      'Parent uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
      'Leaf uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Intermediary (at **)\n' +
        '    in Parent (at **)',
    ]);
    expect(div.children[0].innerHTML).toBe('noise');
    div.children[0].innerHTML = 'aliens';
    div.children[0].id = 'aliens';
    expect(div.children[0].innerHTML).toBe('aliens');
    expect(div.children[0].id).toBe('aliens');
    ReactDOM.render(<Parent cntxt="bar" />, div);
    expect(div.children[0].innerHTML).toBe('bar');
    expect(div.children[0].id).toBe('aliens');
  });

  // @gate !disableLegacyContext
  // @gate !disableLegacyMode

  /** Parent state foo从abc改def，静态children包含两个GrandChild和一个有context Child；props引用变化为0、context变化为3，验证仅声明消费者收到receiveProps上下文变动。 */
  it('should trigger componentWillReceiveProps for context changes', () => {
    let contextChanges = 0;
    let propChanges = 0;

    /** 订阅foo并分别累计props/context引用变化的叶类。 */
    class GrandChild extends React.Component {

      /** 订阅必需foo。 */
      static contextTypes = {
        foo: PropTypes.string.isRequired,
      };

      /** 检查nextContext含foo，只有nextProps/nextContext引用改变才分别累加。 */
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        expect('foo' in nextContext).toBe(true);

        if (nextProps !== this.props) {
          propChanges++;
        }

        if (nextContext !== this.context) {
          contextChanges++;
        }
      }

      /** 返回固定类名span中的静态children。 */
      render() {
        return <span className="grand-child">{this.props.children}</span>;
      }
    }

    /** 订阅foo的中间包装，参与context更新计数。 */
    class ChildWithContext extends React.Component {

      /** 订阅必需foo。 */
      static contextTypes = {
        foo: PropTypes.string.isRequired,
      };

      /** 区分props身份未变与context身份变化，累计两类更新。 */
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        expect('foo' in nextContext).toBe(true);

        if (nextProps !== this.props) {
          propChanges++;
        }

        if (nextContext !== this.context) {
          contextChanges++;
        }
      }

      /** 保留children并输出带类名div。 */
      render() {
        return <div className="child-with">{this.props.children}</div>;
      }
    }

    /** 不订阅context的包装，计数应不包含foo上下文变化。 */
    class ChildWithoutContext extends React.Component {

      /** 确认foo不在nextContext，并按引用比较累计两种变化。 */
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        expect('foo' in nextContext).toBe(false);

        if (nextProps !== this.props) {
          propChanges++;
        }

        if (nextContext !== this.context) {
          contextChanges++;
        }
      }

      /** 透传children到div，让更深的GrandChild仍消费完整context。 */
      render() {
        return <div className="child-without">{this.props.children}</div>;
      }
    }

    /** state驱动foo提供者，children元素保持原引用。 */
    class Parent extends React.Component {

      /** 声明foo提供类型。 */
      static childContextTypes = {
        foo: PropTypes.string,
      };

      /** 初始foo=abc，随后setState改def。 */
      state = {
        foo: 'abc',
      };

      /** 从当前state提供foo。 */
      getChildContext() {
        return {
          foo: this.state.foo,
        };
      }

      /** 原样输出稳定children，用于将变更来源限制为context。 */
      render() {
        return <div className="parent">{this.props.children}</div>;
      }
    }

    const div = document.createElement('div');

    let parentInstance = null;
    ReactDOM.render(
      <Parent ref={inst => (parentInstance = inst)}>
        <ChildWithoutContext>
          A1
          <GrandChild>A2</GrandChild>
        </ChildWithoutContext>

        <ChildWithContext>
          B1
          <GrandChild>B2</GrandChild>
        </ChildWithContext>
      </Parent>,
      div,
    );
    assertConsoleErrorDev([
      'Parent uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
      'GrandChild uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in GrandChild (at **)',
      'ChildWithContext uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in ChildWithContext (at **)',
    ]);

    parentInstance.setState({
      foo: 'def',
    });

    expect(propChanges).toBe(0);
    expect(contextChanges).toBe(3); // ChildWithContext 一次，GrandChild 两次。
  });

  // @gate !disableLegacyMode

  /** legacy props.update从0改1，receiveProps内setState(updated=true)；只增加一次render且同轮state生效，验证生命周期更新合并。 */
  it('only renders once if updated in componentWillReceiveProps in legacy mode', () => {
    let renders = 0;

    /** 在receiveProps排setState的legacy类，记录总render次数。 */
    class Component extends React.Component {

      /** 保存updated标记，初始false。 */
      state = {updated: false};

      /** 接update=1时检查尚无额外render，排updated=true仍不重入render。 */
      UNSAFE_componentWillReceiveProps(props) {
        expect(props.update).toBe(1);
        expect(renders).toBe(1);
        this.setState({updated: true});
        expect(renders).toBe(1);
      }

      /** 只增加render计数并输出div。 */
      render() {
        renders++;
        return <div />;
      }
    }

    const container = document.createElement('div');
    const instance = ReactDOM.render(<Component update={0} />, container);
    expect(renders).toBe(1);
    expect(instance.state.updated).toBe(false);
    ReactDOM.render(<Component update={1} />, container);
    expect(renders).toBe(2);
    expect(instance.state.updated).toBe(true);
  });

  // @gate !disableLegacyMode

  /** 相同props更新放在unstable_batchedUpdates中，receiveProps排state仍只增加一次render；覆盖旧批量入口合并。 */
  it('only renders once if updated in componentWillReceiveProps when batching in legacy mode', () => {
    let renders = 0;

    /** 相同fixture置于旧批量入口，检查receiveProps更新合并。 */
    class Component extends React.Component {

      /** 初始updated=false。 */
      state = {updated: false};

      /** 检查更新输入与当前render次数，排state但不立即递归render。 */
      UNSAFE_componentWillReceiveProps(props) {
        expect(props.update).toBe(1);
        expect(renders).toBe(1);
        this.setState({updated: true});
        expect(renders).toBe(1);
      }

      /** 记录render次数，期望批内props/state合成一轮。 */
      render() {
        renders++;
        return <div />;
      }
    }

    const container = document.createElement('div');
    const instance = ReactDOM.render(<Component update={0} />, container);
    expect(renders).toBe(1);
    expect(instance.state.updated).toBe(false);
    ReactDOM.unstable_batchedUpdates(() => {
      ReactDOM.render(<Component update={1} />, container);
    });
    expect(renders).toBe(2);
    expect(instance.state.updated).toBe(true);
  });

  // @gate !disableLegacyMode

  /** 两个key=A/B的Static总SCU=false，父flip调换key与对象ref配对；refs对应文本交换但ignored新children未渲染，验证跳过子render仍更新ref身份。 */
  it('should update refs if shouldComponentUpdate gives false in legacy mode', () => {

    /** 永远SCU=false的子类，保留第一次内容但允许外部ref更新。 */
    class Static extends React.Component {

      /** 始终拒绝后续render，不拒绝协调器更新ref与位置。 */
      shouldComponentUpdate() {
        return false;
      }

      /** 首次输出children，之后被复用时不接收ignored新输出。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    /** 用flip调换两个key与ref配对的父类。 */
    class Component extends React.Component {

      /** 第一位置ref，flip后应改指key B实例。 */
      static0Ref = React.createRef();

      /** 第二位置ref，flip后应改指key A实例。 */
      static1Ref = React.createRef();

      /** key身份保持A/B，flip交换位置及对象ref；给的新children用于证明SCU仍阻止子render。 */
      render() {
        if (this.props.flipped) {
          return (
            <div>
              <Static ref={this.static0Ref} key="B">
                B (ignored)
              </Static>
              <Static ref={this.static1Ref} key="A">
                A (ignored)
              </Static>
            </div>
          );
        } else {
          return (
            <div>
              <Static ref={this.static0Ref} key="A">
                A
              </Static>
              <Static ref={this.static1Ref} key="B">
                B
              </Static>
            </div>
          );
        }
      }
    }

    const container = document.createElement('div');
    const comp = ReactDOM.render(<Component flipped={false} />, container);
    expect(findDOMNode(comp.static0Ref.current).textContent).toBe('A');
    expect(findDOMNode(comp.static1Ref.current).textContent).toBe('B');

      // 翻转顺序时，即使实际内容未变，refs 也应更新。
    ReactDOM.render(<Component flipped={true} />, container);
    expect(findDOMNode(comp.static0Ref.current).textContent).toBe('B');
    expect(findDOMNode(comp.static1Ref.current).textContent).toBe('A');
  });

  // @gate !disableLegacyMode

  /** legacy挂载和willUnmount都findDOMNode(this)，两次非空且同一节点；验证删除生命周期执行时主机节点仍可查。 */
  it('should allow access to findDOMNode in componentWillUnmount in legacy mode', () => {
    let a = null;
    let b = null;

    /** 在挂载与卸载生命周期读取同一主机节点的类。 */
    class Component extends React.Component {

      /** 挂载后保存findDOMNode结果并确认非空。 */
      componentDidMount() {
        a = findDOMNode(this);
        expect(a).not.toBe(null);
      }

      /** 删除生命周期中再次findDOMNode，尚可拿到同一节点。 */
      componentWillUnmount() {
        b = findDOMNode(this);
        expect(b).not.toBe(null);
      }

      /** 返回被查询的div。 */
      render() {
        return <div />;
      }
    }

    const container = document.createElement('div');
    expect(a).toBe(container.firstChild);
    ReactDOM.render(<Component />, container);
    ReactDOM.unmountComponentAtNode(container);
    expect(a).toBe(b);
  });

  // @gate !disableLegacyContext || !__DEV__
  // @gate !disableLegacyMode

  /** 旧Parent提供foo=bar、Component声明必需foo，legacy挂载只有旧API警告；当前用例不读取context值，主要覆盖该组合可执行而非值内容断言。 */
  it('context should be passed down from the parent', () => {

    /** 旧context foo提供者，用于声明必需context的兼容挂载。 */
    class Parent extends React.Component {

      /** 声明提供字符串foo。 */
      static childContextTypes = {
        foo: PropTypes.string,
      };

      /** 提供固定bar。 */
      getChildContext() {
        return {
          foo: 'bar',
        };
      }

      /** 在div内保留children，使旧context向内传播。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    /** 仅声明foo必需类型的消费者，本例不输出或断言其值。 */
    class Component extends React.Component {

      /** 订阅必需foo，触发旧context API开发提示。 */
      static contextTypes = {
        foo: PropTypes.string.isRequired,
      };

      /** 返回空div，当前验证重点是可挂载与警告。 */
      render() {
        return <div />;
      }
    }

    const div = document.createElement('div');
    ReactDOM.render(
      <Parent>
        <Component />
      </Parent>,
      div,
    );
    assertConsoleErrorDev([
      'Parent uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
      'Component uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Component (at **)',
    ]);
  });

  /** 现代createRoot挂载Moo state{x:1}，通过内部updater enqueueReplaceState替为{y:2}；x消失、y=2，验证替换而非合并，标题legacy指内部旧API并非根模式。 */
  it('should replace state in legacy mode', async () => {

    /** 现代根类实例，通过内部旧替换状态API检查覆盖语义。 */
    class Moo extends React.Component {

      /** 初始{x:1}，后续replace应移除x。 */
      state = {x: 1};

      /** 返回div，状态结果直接从实例读取。 */
      render() {
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let moo;
    await act(() => {
      root.render(<Moo ref={current => (moo = current)} />);
    });

    // 不再是一个公开的 API。 但我们可以通过进入更新器来检测它是否内部工作.
    await act(() => {
      moo.updater.enqueueReplaceState(moo, {y: 2});
    });
    expect('x' in moo.state).toBe(false);
    expect(moo.state.y).toBe(2);
  });

  /** 现代根state使用带原型对象，replaceState保留对象身份/方法，setState浅合并丢原型；混合排队顺序决定最后替换保原型或随后合并丢原型，验证更新类型与顺序。 */
  it('should support objects with prototypes as state in legacy mode', async () => {

    /** 把str放在有自定义原型的对象上，区分替换保身份与浅合并成普通对象。 */
    const NotActuallyImmutable = function (str) {
      this.str = str;
    };
    /** 原型方法返回true，作为state是否保留该原型的检测器。 */
    NotActuallyImmutable.prototype.amIImmutable = function () {
      return true;
    };

    /** 以带原型state挂载并暴露内部replaceState包装的类。 */
    class Moo extends React.Component {

      /** 初始有str及原型方法的对象，后续检查其保留或丢失。 */
      state = new NotActuallyImmutable('first');
      // 不再是一个公开的 API。 但我们可以通过进入更新器来检测它是否内部工作.

      /** 把传入对象直接送内部enqueueReplaceState，不做setState浅合并。 */
      _replaceState = update => this.updater.enqueueReplaceState(this, update);

      /** 返回空div，所有结果从实例state检查。 */
      render() {
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let moo;
    await act(() => {
      root.render(<Moo ref={current => (moo = current)} />);
    });

    expect(moo.state.str).toBe('first');
    expect(moo.state.amIImmutable()).toBe(true);

    const secondState = new NotActuallyImmutable('second');
    await act(() => {
      moo._replaceState(secondState);
    });
    expect(moo.state.str).toBe('second');
    expect(moo.state.amIImmutable()).toBe(true);
    expect(moo.state).toBe(secondState);

    await act(() => {
      moo.setState({str: 'third'});
    });
    expect(moo.state.str).toBe('third');
    // 我们失去了原型。
    expect(moo.state.amIImmutable).toBe(undefined);

    // 当多个状态更新被排队时， 我们有相同的实现。
    const fifthState = new NotActuallyImmutable('fifth');
    await act(() => {
      moo.setState({str: 'fourth'});
      moo._replaceState(fifthState);
    });
    expect(moo.state).toBe(fifthState);

    // 当多个状态更新被排队时， 我们有相同的实现。
    const sixthState = new NotActuallyImmutable('sixth');
    await act(() => {
      moo._replaceState(sixthState);
      moo.setState({str: 'seventh'});
    });
    expect(moo.state.str).toBe('seventh');
    expect(moo.state.amIImmutable).toBe(undefined);
  });

  // @gate !disableLegacyMode

  /** Component挂载另一个legacy layer根，自己卸载时卸载layer；删除Outer子树流程完成且无额外警告断言，框架console检查约束跨根卸载不报重入警告。 */
  it('should not warn about unmounting during unmounting in legacy mode', () => {
    const container = document.createElement('div');
    const layer = document.createElement('div');

    /** 在自己的挂载/卸载生命周期管理另一个layer旧根。 */
    class Component extends React.Component {

      /** 把div挂到独立layer容器。 */
      componentDidMount() {
        ReactDOM.render(<div />, layer);
      }

      /** 卸载layer根，验证不同根的卸载可在当前删除生命周期内完成。 */
      componentWillUnmount() {
        ReactDOM.unmountComponentAtNode(layer);
      }

      /** 输出当前主树div。 */
      render() {
        return <div />;
      }
    }

    /** 保留或删除Component child的外层类。 */
    class Outer extends React.Component {

      /** 透传children到div，更新为空children时触发Component删除。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    ReactDOM.render(
      <Outer>
        <Component />
      </Outer>,
      container,
    );
    ReactDOM.render(<Outer />, container);
  });
});
