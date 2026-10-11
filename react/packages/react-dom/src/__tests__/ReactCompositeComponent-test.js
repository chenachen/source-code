/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let ChildUpdates;
let MorphingComponent;
let React;
let ReactDOM;
let ReactDOMClient;
let ReactSharedInternals;
let Scheduler;
let assertLog;
let act;
let assertConsoleErrorDev;

describe('ReactCompositeComponent', () => {
  const hasOwnProperty = Object.prototype.hasOwnProperty;

  /**
   * 以 Object.is 比较 objA/objB identity，非空对象再逐个比较可枚举字符串键及对应字段；缺失键或不同引用返回 false，不递归深入数组/对象，也不比较 symbol 键。供 class SCU 模拟浅比较策略。
   */
  function shallowEqual(objA: mixed, objB: mixed): boolean {
    if (Object.is(objA, objB)) {
      return true;
    }
    if (
      typeof objA !== 'object' ||
      objA === null ||
      typeof objB !== 'object' ||
      objB === null
    ) {
      return false;
    }
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);
    if (keysA.length !== keysB.length) {
      return false;
    }
    for (let i = 0; i < keysA.length; i++) {
      if (
        !hasOwnProperty.call(objB, keysA[i]) ||
        !Object.is(objA[keysA[i]], objB[keysA[i]])
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * 比较 instance 当前 props/state 与 nextProps/nextState；任一浅比较不同即返回 true，供 shouldComponentUpdate 决定是否进入该 fixture render。
   */
  function shallowCompare(instance, nextProps, nextState) {
    return (
      !shallowEqual(instance.props, nextProps) ||
      !shallowEqual(instance.state, nextState)
    );
  }

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ReactSharedInternals =
      require('react').__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    Scheduler = require('scheduler');
    assertLog = require('internal-test-utils').assertLog;
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
  });

  describe('MorphingComponent', () => {
    let instance;
    let childInstance;

    beforeEach(() => {
      /**
       * 在 a/b 两种宿主类型间切换的 class fixture；共享对象 ref 观察节点替换，事件和外部方法都可切换 activated。
       */
      MorphingComponent = class extends React.Component {
        /**
         * activated=false 先输出 a，toggle 反转后输出 b；状态控制类型而非单个 DOM 属性更新。
         */
        state = {activated: false};
        /**
         * 跨宿主类型共用的对象 ref；提交删除旧节点再指向新节点，断言读取当前 tagName。
         */
        xRef = React.createRef();

        /**
         * 把已提交组件实例保存给测试，后续可调用 toggle；不在 render 阶段暴露未提交实例。
         */
        componentDidMount() {
          instance = this;
        }

        /**
         * 用当前 activated 的反值 setState，供 DOM click 和测试直接调用；无返回值，act 负责等待更新提交。
         */
        _toggleActivatedState = () => {
          this.setState({activated: !this.state.activated});
        };

        /**
         * activated 决定返回 a 或 b，两者使用同一 xRef 和 toggle handler；替换必须同时更新 ref 与事件目标。
         */
        render() {
          const toggleActivatedState = this._toggleActivatedState;
          return !this.state.activated ? (
            <a ref={this.xRef} onClick={toggleActivatedState} />
          ) : (
            <b ref={this.xRef} onClick={toggleActivatedState} />
          );
        }
      };

      /**
       * 反复删除重建 a 的 fixture；renderAnchor 控制 a/b 类型，anchorClassOn 仅改变 a 的 class。
       */
      ChildUpdates = class extends React.Component {
        /**
         * 保存 a 的对象 ref；换成 b 时解绑，重新生成 a 后应指向新节点。
         */
        anchorRef = React.createRef();

        /**
         * 把已提交实例保存为 childInstance，让用例在多次根更新后读取当前 anchor。
         */
        componentDidMount() {
          childInstance = this;
        }

        /**
         * 返回 anchorRef.current，暴露当前已提交 a 而非缓存之前 DOM；a 不存在时可为 null。
         */
        getAnchor = () => {
          return this.anchorRef.current;
        };

        /**
         * renderAnchor 为真返回带 ref/className 的 a，否则返回无该 ref 的 b；重新挂载 a 时 className 从当前 prop 计算。
         */
        render() {
          const className = this.props.anchorClassOn ? 'anchorClass' : '';
          return this.props.renderAnchor ? (
            <a ref={this.anchorRef} className={className} />
          ) : (
            <b />
          );
        }
      };
    });
    /**
     * MorphingComponent 初始 activated=false 返回 a，连续调用 toggle 两次；ref.tagName 为 A→B→A，证明 class 状态更新可替换宿主类型并指向当前节点。
     */
    it('should support rendering to different child types over time', async () => {
      const root = ReactDOMClient.createRoot(document.createElement('div'));
      await act(() => {
        root.render(<MorphingComponent />);
      });
      expect(instance.xRef.current.tagName).toBe('A');

      await act(() => {
        instance._toggleActivatedState();
      });
      expect(instance.xRef.current.tagName).toBe('B');

      await act(() => {
        instance._toggleActivatedState();
      });
      expect(instance.xRef.current.tagName).toBe('A');
    });

    /**
     * 容器加入 document 后挂载 a，点击其真实 DOM；handler 切换状态后 ref 指向 B，finally 移除容器并卸载根，验证事件回调能驱动类型替换。
     */
    it('should react to state changes from callbacks', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      try {
        await act(() => {
          root.render(<MorphingComponent />);
        });
        expect(instance.xRef.current.tagName).toBe('A');
        await act(() => {
          instance.xRef.current.click();
        });
        expect(instance.xRef.current.tagName).toBe('B');
      } finally {
        document.body.removeChild(container);
        root.unmount();
      }
    });

    /**
     * 同一对象 ref 跨 a/b/a 类型切换；每次 act 后 tagName 正确，验证旧宿主 ref 解绑与新节点挂接，而非保留已删除 DOM。
     */
    it('should rewire refs when rendering to different child types', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<MorphingComponent />);
      });
      expect(instance.xRef.current.tagName).toBe('A');

      await act(() => {
        instance._toggleActivatedState();
      });
      expect(instance.xRef.current.tagName).toBe('B');

      await act(() => {
        instance._toggleActivatedState();
      });
      expect(instance.xRef.current.tagName).toBe('A');
    });

    /**
     * ChildUpdates 先 a 无 class、给旧 a 加 class、换 b、再生成新 a 无 class；最终 getAnchor().className 为空，证明新类型挂载不复用旧宿主属性缓存。
     */
    it('should not cache old DOM nodes when switching constructors', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<ChildUpdates renderAnchor={true} anchorClassOn={false} />);
      });
      await act(() => {
        root.render(
          // 先更新现有锚点的 class，再测试移除后的节点替换。
          <ChildUpdates renderAnchor={true} anchorClassOn={true} />,
        );
      });
      await act(() => {
        root.render(
          // 移除锚点。
          <ChildUpdates renderAnchor={false} anchorClassOn={true} />,
        );
      });
      await act(() => {
        root.render(
          // 重新渲染
          <ChildUpdates renderAnchor={true} anchorClassOn={false} />,
        );
      });
      expect(childInstance.getAnchor().className).toBe('');
    });
  });

  /**
   * Child 函数返回带 render 方法的普通对象；act 拒绝 object with keys render，容器文本为空，证明函数返回值按 React child 校验而不采用 module pattern。
   */
  it('should not support module pattern components', async () => {
    /**
     * 接收 test 却返回带 render 方法的普通对象，故意制造已不支持的 module pattern；React 应按 invalid child 拒绝对象。
     */
    function Child({test}) {
      return {
        /**
         * 对象中的 render 若被调用会返回 test div，但本测试要求 React 不采用该协议；实际函数返回值会在调用此方法前被拒绝。
         */
        render() {
          return <div>{test}</div>;
        },
      };
    }

    const el = document.createElement('div');
    const root = ReactDOMClient.createRoot(el);
    await expect(async () => {
      await act(() => {
        root.render(<Child test="test" />);
      });
    }).rejects.toThrow(
      'Objects are not valid as a React child (found: object with keys {render}).',
    );

    expect(el.textContent).toBe('');
  });

  /**
   * class defaultProps.prop=testKey，依次省略、传 undefined、传 null；实例 props 为默认、默认、null，验证仅 undefined 使用默认值。
   */
  it('should use default values for undefined props', async () => {
    /**
     * 使用静态默认 prop 的 class fixture；不同 ref 暴露 resolved props 以比较省略/undefined/null。
     */
    class Component extends React.Component {
      /**
       * 默认 prop=testKey，仅对应 undefined 输入；显式 null 必须保留。
       */
      static defaultProps = {prop: 'testKey'};

      /**
       * 返回空 span，输出不读取 prop；实际断言通过实例 props 验证默认值解析。
       */
      render() {
        return <span />;
      }
    }

    /**
     * 保存首轮 class ref 到 instance1，供省略 prop 的 resolved props 断言；解绑 null 也会覆盖变量。
     */
    function refFn1(ref) {
      instance1 = ref;
    }

    /**
     * 保存第二轮 ref 到 instance2，用来读取 undefined 输入采用默认值后的 props。
     */
    function refFn2(ref) {
      instance2 = ref;
    }

    /**
     * 保存第三轮 ref 到 instance3，检查显式 null 未被默认值替换。
     */
    function refFn3(ref) {
      instance3 = ref;
    }

    let instance1;
    let instance2;
    let instance3;
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Component ref={refFn1} />);
    });
    expect(instance1.props).toEqual({prop: 'testKey'});

    await act(() => {
      root.render(<Component ref={refFn2} prop={undefined} />);
    });
    expect(instance2.props).toEqual({prop: 'testKey'});

    await act(() => {
      root.render(<Component ref={refFn3} prop={null} />);
    });
    expect(instance3.props).toEqual({prop: null});
  });

  /**
   * 把空 inputProps 展开传给含 defaultProps 的 class；实例 prop=testKey，而 inputProps.prop 仍未定义，证明补默认值不回写调用方对象。
   */
  it('should not mutate passed-in props object', async () => {
    /**
     * 静态默认 prop 的 class fixture；用展开的空 inputProps 验证默认值只补到元素/实例 props。
     */
    class Component extends React.Component {
      /**
       * 默认 prop=testKey，让实例得到值同时输入对象仍不含该字段。
       */
      static defaultProps = {prop: 'testKey'};

      /**
       * 返回不依赖 props 的 span，避免 DOM 行为干扰输入对象未被回写的断言。
       */
      render() {
        return <span />;
      }
    }

    const inputProps = {};
    let instance1;
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Component {...inputProps} ref={ref => (instance1 = ref)} />);
    });
    expect(instance1.props.prop).toBe('testKey');

    // defaultProps 补到元素的 props 中，不会回写调用者传入的 inputProps。
    expect(inputProps.prop).not.toBeDefined();
  });

  /**
   * 构造器内 forceUpdate 在实例挂载前发生；首次 flushSync 断言 DEV no-op 警告，再挂同类到第二根并得到 foo，验证警告去重且正常输出不受影响。
   */
  it('should warn about `forceUpdate` on not-yet-mounted components', async () => {
    /**
     * 构造器提前 forceUpdate 的警告 fixture；第二根重复挂载验证提示去重而正常输出可用。
     */
    class MyComponent extends React.Component {
      /**
       * super(props) 后立即 forceUpdate，此时还使用未挂载 updater；制造 no-op DEV 提示，不返回替代实例。
       */
      constructor(props) {
        super(props);
        this.forceUpdate();
      }
      /**
       * 返回 foo div，使构造器误用 updater 后仍可验证普通挂载成功。
       */
      render() {
        return <div>foo</div>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    ReactDOM.flushSync(() => {
      root.render(<MyComponent />);
    });
    assertConsoleErrorDev([
      "Can't call forceUpdate on a component that is not yet mounted. " +
        'This is a no-op, but it might indicate a bug in your application. ' +
        'Instead, assign to `this.state` directly or define a `state = {};` ' +
        'class property with the desired state in the MyComponent component.\n' +
        '    in MyComponent (at **)',
    ]);

    // 不应记录任何额外的警告。
    const container2 = document.createElement('div');
    const root2 = ReactDOMClient.createRoot(container2);
    await act(() => {
      root2.render(<MyComponent />);
    });
    expect(container2.firstChild.textContent).toBe('foo');
  });

  /**
   * 构造器内无参数 setState 发生在挂载前；首次断言 DEV no-op 提示，再挂第二根输出 foo，覆盖同类警告去重与成功挂载。
   */
  it('should warn about `setState` on not-yet-mounted components', async () => {
    /**
     * 构造器提前 setState 的 no-op 警告 fixture。
     */
    class MyComponent extends React.Component {
      /**
       * super(props) 后调用无参数 setState；实例未挂载，不能以此驱动合法更新。
       */
      constructor(props) {
        super(props);
        this.setState();
      }
      /**
       * 返回 foo div，让重复挂载证明提示不会阻止正常 UI。
       */
      render() {
        return <div>foo</div>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    ReactDOM.flushSync(() => {
      root.render(<MyComponent />);
    });
    assertConsoleErrorDev([
      "Can't call setState on a component that is not yet mounted. " +
        'This is a no-op, but it might indicate a bug in your application. ' +
        'Instead, assign to `this.state` directly or define a `state = {};` ' +
        'class property with the desired state in the MyComponent component.\n' +
        '    in MyComponent (at **)',
    ]);

    // 不应记录任何额外的警告。
    const container2 = document.createElement('div');
    const root2 = ReactDOMClient.createRoot(container2);
    await act(() => {
      root2.render(<MyComponent />);
    });
    expect(container2.firstChild.textContent).toBe('foo');
  });

  /**
   * 先确认 element 对象本身没有 forceUpdate，再取得已挂载实例并更新，卸载后连续调用两次 forceUpdate；正文只观察调用完成，无显式 DOM 或 console 次数断言。
   */
  it('should not warn about `forceUpdate` on unmounted components', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    let instance;
    /**
     * 保存已提交实例供卸载后 forceUpdate 调用的 class fixture。
     */
    class Component extends React.Component {
      /**
       * didMount 时保存 this；测试随后在实例已删除后继续使用该引用。
       */
      componentDidMount() {
        instance = this;
      }

      /**
       * 返回空 div，DOM 内容不参与卸载后 forceUpdate 的断言。
       */
      render() {
        return <div />;
      }
    }

    const component = <Component />;
    expect(component.forceUpdate).not.toBeDefined();
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(component);
    });

    instance.forceUpdate();

    root.unmount(container);

    instance.forceUpdate();
    instance.forceUpdate();
  });

  /**
   * 实例初始 render0，setState(1) 产生 render1；根更新删除该实例后再 setState(2)，日志为空，证明保留实例引用不让卸载组件重新 render。
   */
  it('should not warn about `setState` on unmounted components', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    /**
     * value 状态只用于 render 日志，便于识别已卸载实例的后续 setState 是否误重渲染。
     */
    class Component extends React.Component {
      /**
       * value=0 建立初挂日志，已提交更新到1后删除，再请求2应不产生 render。
       */
      state = {value: 0};

      /**
       * 记录 state.value 并返回 div，日志用作挂载/更新与卸载后空操作的唯一渲染观测。
       */
      render() {
        Scheduler.log('render ' + this.state.value);
        return <div />;
      }
    }

    let ref;
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <div>
          <span>
            <Component ref={c => (ref = c || ref)} />
          </span>
        </div>,
      );
    });

    assertLog(['render 0']);

    await act(() => {
      ref.setState({value: 1});
    });
    assertLog(['render 1']);

    await act(() => {
      root.render(<div />);
    });

    await act(() => {
      ref.setState({value: 2});
    });
      // 对已经卸载的组件调用 setState 是空操作。
    assertLog([]);
  });

  /**
   * 组件 willUnmount 内 setState(2,callback)；断言调用不抛且卸载后 callback flag=false，证明删除中的更新不会提交 callback。
   */
  it('should silently allow `setState`, not call cb on unmounting components', async () => {
    let cbCalled = false;
    const container = document.createElement('div');
    document.body.appendChild(container);

    /**
     * willUnmount 内排队状态及 callback 的 fixture，验证删除中的更新不会提交回调。
     */
    class Component extends React.Component {
      /**
       * value=0 为正常挂载状态，后续1是已挂载更新，卸载时请求2仅用于测试空操作。
       */
      state = {value: 0};

      /**
       * 在清理钩子内 setState(value2,callback)，断言调用不抛；callback 若被执行会置 flag，根卸载后必须仍 false。
       */
      componentWillUnmount() {
        expect(() => {
          this.setState({value: 2}, function () {
            cbCalled = true;
          });
        }).not.toThrow();
      }

      /**
       * 返回 div，值不出现在 DOM，实际结果由卸载 callback flag 判断。
       */
      render() {
        return <div />;
      }
    }
    let instance;
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component ref={c => (instance = c)} />);
    });
    await act(() => {
      instance.setState({value: 1});
    });
    instance.setState({value: 1});

    root.unmount();
    expect(cbCalled).toBe(false);
  });

  /**
   * 普通 ES class 有 render 却未 extends React.Component；act 拒绝 TypeError 并提示继承要求，第二次 render 同样拒绝而不要求重复警告，覆盖错误与诊断去重。
   */
  it('should warn when rendering a class with a render method that does not extend React.Component', async () => {
    const container = document.createElement('div');
    /**
     * 有 render 但不继承 React.Component 的普通 ES class，作为分类与诊断校验的非法输入。
     */
    class ClassWithRenderNotExtended {
      /**
       * 若合法实例化会返回 div，但本例应以函数组件调用失败并提示继承要求。
       */
      render() {
        return <div />;
      }
    }
    const root = ReactDOMClient.createRoot(container);
    await expect(async () => {
      await act(() => {
        root.render(<ClassWithRenderNotExtended />);
      });
    }).rejects.toThrow(TypeError);
    assertConsoleErrorDev([
      'The <ClassWithRenderNotExtended /> component appears to have a render method, ' +
        "but doesn't extend React.Component. This is likely to cause errors. " +
        'Change ClassWithRenderNotExtended to extend React.Component instead.\n' +
        '    in ClassWithRenderNotExtended (at **)',
    ]);

    // 测试去重逻辑。
    await expect(async () => {
      await act(() => {
        root.render(<ClassWithRenderNotExtended />);
      });
    }).rejects.toThrow(TypeError);
  });

  /**
   * Component render0 内 setState(1)；flushSync 后 DEV 纯 render 警告、日志 render0/render1、实例 state=1；再改根 prop 仅 render1，证明警告不意味着更新被丢弃。
   */
  it('should warn about `setState` in render', async () => {
    const container = document.createElement('div');

    /**
     * render 内更新自身的 class fixture；只在 value0 时安排一次补丁，避免无限循环掩盖警告路径。
     */
    class Component extends React.Component {
      /**
       * value=0 触发 render 阶段 setState，补丁1使下一 render 停止继续排队。
       */
      state = {value: 0};

      /**
       * 先记 value 日志，value0 时 setState(1)，再返回当前值 div；这次非法副作用产生警告，后续 render 仍应用更新。
       */
      render() {
        Scheduler.log('render ' + this.state.value);
        if (this.state.value === 0) {
          this.setState({value: 1});
        }
        return <div>foo {this.state.value}</div>;
      }
    }

    let instance;
    const root = ReactDOMClient.createRoot(container);
    ReactDOM.flushSync(() => {
      root.render(<Component ref={ref => (instance = ref)} />);
    });
    assertConsoleErrorDev([
      'Cannot update during an existing state transition (such as within ' +
        '`render`). Render methods should be a pure function of props and state.\n' +
        '    in Component (at **)',
    ]);

    // render 中的 setState 触发警告，并排入同一组件的后续渲染；本用例观察到 render 0 后紧接 render 1。
    assertLog(['render 0', 'render 1']);
    expect(instance.state.value).toBe(1);

    // 再从根传入新的 prop，验证组件用已更新的 state 渲染。
    await act(() => {
      root.render(<Component prop={123} />);
    });
    assertLog(['render 1']);
  });

  /**
   * BadComponent 保存 ReactSharedInternals.A 后 render 抛错；act 拒绝，前后 A 均 null；DEV stashedDispatcher.getOwner() 为 null、生产无此方法，验证异常退出恢复 async dispatcher 与 owner 状态。
   */
  it('should cleanup even if render() fatals', async () => {
    const ownerEnabled = __DEV__;

    let stashedDispatcher;
    /**
     * render 失败后全局 AsyncDispatcher 清理 probe；把当时 A 保存给测试检查 owner 槽也复位。
     */
    class BadComponent extends React.Component {
      /**
       * 保存 ReactSharedInternals.A 后抛 Error，不返回 UI；不能把 A 当成 Hooks 的 H dispatcher，测试检查异常后的 A/owner 恢复。
       */
      render() {
    // 保存渲染期间可用的 dispatcher，以便检查其内部状态也已重置。
        stashedDispatcher = ReactSharedInternals.A;
        throw new Error();
      }
    }

    const instance = <BadComponent />;
    expect(ReactSharedInternals.A).toBe(null);

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await expect(async () => {
      await act(() => {
        root.render(instance);
      });
    }).rejects.toThrow();

    expect(ReactSharedInternals.A).toBe(null);
    if (ownerEnabled) {
      expect(stashedDispatcher.getOwner()).toBe(null);
    } else {
      expect(stashedDispatcher.getOwner).toBe(undefined);
    }
  });

  /**
   * 父组件有 Inner 及文本，挂载后卸载根；Inner.willUnmount 置 flag=true，断言 flag，验证复合组件删除遍历确实执行子清理钩子。
   */
  it('should call componentWillUnmount before unmounting', async () => {
    const container = document.createElement('div');
    let innerUnmounted = false;

    /**
     * 包含 Inner 与文本的父 fixture，供根卸载遍历到子清理。
     */
    class Component extends React.Component {
      /**
       * 返回 div(Inner,Text)，既有复合子节点也有 HostText，使删除路径不能只处理宿主节点。
       */
      render() {
        return (
          <div>
            <Inner />
            Text
          </div>
        );
      }
    }

    /**
     * 卸载 flag probe 组件，确认 class 子实例清理被访问。
     */
    class Inner extends React.Component {
      /**
       * 把 innerUnmounted=true，不排队更新；作为删除遍历执行证据。
       */
      componentWillUnmount() {
        innerUnmounted = true;
      }

      /**
       * 返回 div，正常挂载后才有可执行 willUnmount 的实例。
       */
      render() {
        return <div />;
      }
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component />);
    });
    root.unmount();
    expect(innerUnmounted).toBe(true);
  });

  /**
   * ClassComponent.shouldComponentUpdate 返回 undefined；首次正常挂载后 setState(bogus=true)，断言 DEV 要求返回 boolean 的提示，覆盖更新判定方法返回值校验。
   */
  it('should warn when shouldComponentUpdate() returns undefined', async () => {
    /**
     * shouldComponentUpdate 故意返回 undefined 的校验 fixture；通过状态更新触发而非首挂调用。
     */
    class ClassComponent extends React.Component {
      /**
       * bogus=false 初始状态，改true用于进入更新判定分支。
       */
      state = {bogus: false};

      /**
       * 返回 undefined 触发要求 boolean 的 DEV 警告，不提供真实 bailout 策略。
       */
      shouldComponentUpdate() {
        return undefined;
      }

      /**
       * 返回空 div，SCU返回值警告是此例观察重点。
       */
      render() {
        return <div />;
      }
    }
    let instance;
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<ClassComponent ref={ref => (instance = ref)} />);
    });

    ReactDOM.flushSync(() => {
      instance.setState({bogus: true});
    });
    assertConsoleErrorDev([
      'ClassComponent.shouldComponentUpdate(): Returned undefined instead of a ' +
        'boolean value. Make sure to return true or false.\n' +
        '    in ClassComponent (at **)',
    ]);
  });

  /**
   * 定义不存在的 componentDidUnmount 方法再挂载；DEV 提示应使用 componentWillUnmount，此例不执行错误命名方法。
   */
  it('should warn when componentDidUnmount method is defined', async () => {
    /**
     * 故意误命名卸载方法的 fixture，验证 React 开发校验而非清理功能。
     */
    class Component extends React.Component {
      /**
       * 空 componentDidUnmount 函数属性；此名字没有生命周期语义，挂载时应给出 componentWillUnmount 提示。
       */
      componentDidUnmount = () => {};

      /**
       * 返回空 div 以触发 class 实例校验。
       */
      render() {
        return <div />;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    ReactDOM.flushSync(() => {
      root.render(<Component />);
    });
    assertConsoleErrorDev([
      'Component has a method called ' +
        'componentDidUnmount(). But there is no such lifecycle method. ' +
        'Did you mean componentWillUnmount()?\n' +
        '    in Component (at **)',
    ]);
  });

  /**
   * 定义不存在的 componentDidReceiveProps 方法再挂载；DEV 提示旧 props/提交更新生命周期的适用场景，不把该方法当真实生命周期调用。
   */
  it('should warn when componentDidReceiveProps method is defined', () => {
    /**
     * 误命名接收 props 方法的 fixture，用于 DEV API 名称提示。
     */
    class Component extends React.Component {
      /**
       * 空 componentDidReceiveProps 属性；React 不把它作为真实生命周期，验证开发警告。
       */
      componentDidReceiveProps = () => {};

      /**
       * 返回 div，使实例进入正常挂载校验。
       */
      render() {
        return <div />;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));

    ReactDOM.flushSync(() => {
      root.render(<Component />);
    });
    assertConsoleErrorDev([
      'Component has a method called ' +
        'componentDidReceiveProps(). But there is no such lifecycle method. ' +
        'If you meant to update the state in response to changing props, ' +
        'use componentWillReceiveProps(). If you meant to fetch data or ' +
        'run side-effects or mutations after React has updated the UI, use componentDidUpdate().\n' +
        '    in Component (at **)',
    ]);
  });

  /**
   * 构造器把 defaultProps 写在实例上；挂载后 DEV 提示该写法忽略、应使用静态属性，验证默认值声明位置校验。
   */
  it('should warn when defaultProps was defined as an instance property', () => {
    /**
     * 把默认值误写为实例属性的 fixture，用来对照正确静态 defaultProps。
     */
    class Component extends React.Component {
      /**
       * super(props) 后设置 this.defaultProps{name:Abhay}；故意使默认值不在构造函数静态位置，触发忽略提示。
       */
      constructor(props) {
        super(props);
        this.defaultProps = {name: 'Abhay'};
      }

      /**
       * 返回 div，不用该实例默认值修改 UI；本例只断言声明位置警告。
       */
      render() {
        return <div />;
      }
    }
    const root = ReactDOMClient.createRoot(document.createElement('div'));

    ReactDOM.flushSync(() => {
      root.render(<Component />);
    });
    assertConsoleErrorDev([
      'Setting defaultProps as an instance property on Component is not supported ' +
        'and will be ignored. Instead, define defaultProps as a static property on Component.\n' +
        '    in Component (at **)',
    ]);
  });

  /**
   * 两轮都新建 Parent element，但 children 重用同一个 Child element；首次 Child render 后第二轮空日志，证明无待处理子更新时稳定元素 identity 允许复用 child。
   */
  it('should skip update when rerendering element in container', async () => {
    /**
     * 反复接收相同 Child element 的父 fixture，父 element 可重建但 child identity 保持。
     */
    class Parent extends React.Component {
      /**
       * 把 children 放入 div，不复制 Child element，用于 child 无待处理更新时的 identity bailout。
       */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    /**
     * render 计数日志 fixture，检测稳定 child element 第二次是否被重渲染。
     */
    class Child extends React.Component {
      /**
       * 只记 Child render 并返回 div；第二轮空日志表明该子节点复用。
       */
      render() {
        Scheduler.log('Child render');
        return <div />;
      }
    }

    const container = document.createElement('div');
    const child = <Child />;
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent>{child}</Parent>);
    });
    assertLog(['Child render']);

    await act(() => {
      root.render(<Parent>{child}</Parent>);
    });
    assertLog([]);
  });

  /**
   * Outer.render 内对同一个 root 调用 render(Inner)；flushSync 断言 render 必须纯且不可嵌套根更新的 DEV 警告，正文未断言最终 DOM 选择。
   */
  it('should disallow nested render calls', () => {
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    /**
     * 被嵌套 root.render 指定的 class fixture，本身 render 没有更新副作用。
     */
    class Inner extends React.Component {
      /**
       * 返回空 div，供 Outer render 内的非法根更新请求使用。
       */
      render() {
        return <div />;
      }
    }

    /**
     * render 中向同 root 再提交 Inner 的 fixture，制造嵌套组件更新 DEV 警告。
     */
    class Outer extends React.Component {
      /**
       * 先 root.render(Inner) 再返回 div，故更新发生在当前 render 内而非提交回调。
       */
      render() {
        root.render(<Inner />);
        return <div />;
      }
    }

    ReactDOM.flushSync(() => {
      root.render(<Outer />);
    });
    assertConsoleErrorDev([
      'Render methods should be a pure function of props and state; ' +
        'triggering nested component updates from render is not allowed. If ' +
        'necessary, trigger nested updates in componentDidUpdate.\n\n' +
        'Check the render method of Outer.\n' +
        '    in Outer (at **)',
    ]);
  });

  /**
   * 初挂 update=0 且 updated=false，再以 update=1 更新；willReceiveProps 内 setState(updated=true) 当下不增加 render 次数，更新后总 renders=2、state=true，证明补丁并入这轮处理。
   */
  it('only renders once if updated in componentWillReceiveProps', async () => {
    let renders = 0;

    /**
     * 接收新 props 时 setState 的 fixture，renders 计数检验补丁并入本轮而不重入 render。
     */
    class Component extends React.Component {
      /**
       * updated=false 为初始基准，willReceiveProps 新输入到来时改true。
       */
      state = {updated: false};

      /**
       * 验证新 props.update=1 与此前 render次数1，再 setState(updated=true)；立即仍次数1，返回后队列在这轮更新处理。
       */
      UNSAFE_componentWillReceiveProps(props) {
        expect(props.update).toBe(1);
        expect(renders).toBe(1);
        this.setState({updated: true});
        expect(renders).toBe(1);
      }

      /**
       * 递增 renders 并返回 div，最终总次数2证明初挂+一次更新。
       */
      render() {
        renders++;
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let instance;

    await act(() => {
      root.render(<Component update={0} ref={ref => (instance = ref)} />);
    });
    expect(renders).toBe(1);
    expect(instance.state.updated).toBe(false);

    await act(() => {
      root.render(<Component update={1} ref={ref => (instance = ref)} />);
    });
    expect(renders).toBe(2);
    expect(instance.state.updated).toBe(true);
  });

  /**
   * 标题含 batching，正文与前例一样使用两次 act render，没有单独 batchedUpdates；断言 willReceiveProps 中不重入 render，最终总次数2、updated=true，验证实际调用范围。
   */
  it('only renders once if updated in componentWillReceiveProps when batching', async () => {
    let renders = 0;

    /**
     * 同前例的 act 批处理 fixture；正文没有另加 unstable_batchedUpdates 调用。
     */
    class Component extends React.Component {
      /**
       * updated=false 让用例验证接收新props后真实合并状态。
       */
      state = {updated: false};

      /**
       * 接收 update1 时检查 render 尚未重入，再排队 updated=true 并保持当下 renders1。
       */
      UNSAFE_componentWillReceiveProps(props) {
        expect(props.update).toBe(1);
        expect(renders).toBe(1);
        this.setState({updated: true});
        expect(renders).toBe(1);
      }

      /**
       * 每次 render 递增计数，返回 div，供最后总次数2断言。
       */
      render() {
        renders++;
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let instance;
    await act(() => {
      root.render(<Component update={0} ref={ref => (instance = ref)} />);
    });
    expect(renders).toBe(1);
    expect(instance.state.updated).toBe(false);
    await act(() => {
      root.render(<Component update={1} ref={ref => (instance = ref)} />);
    });
    expect(renders).toBe(2);
    expect(instance.state.updated).toBe(true);
  });

  /**
   * Foo 构造器接收 idx=qwe，却构造 idx=qwe! 的新对象传 super；DEV 提示必须传收到的同一 props，验证构造实例 props 所有权约束，并非对输入对象原地修改。
   */
  it('should warn when mutated props are passed', async () => {
    const container = document.createElement('div');

    /**
     * 把收到 props 改成新对象再传 super 的故障 fixture；不直接修改外部原对象。
     */
    class Foo extends React.Component {
      /**
       * 由 props.idx 构造加感叹号的新 _props 并传 super；故意违反保留构造器输入 props 的约定，触发 DEV 提示。
       */
      constructor(props) {
        const _props = {idx: props.idx + '!'};
        super(_props);
      }

      /**
       * 返回 span，构造器身份校验是本例重点。
       */
      render() {
        return <span />;
      }
    }

    const root = ReactDOMClient.createRoot(container);
    ReactDOM.flushSync(() => {
      root.render(<Foo idx="qwe" />);
    });
    assertConsoleErrorDev([
      'When calling super() in `Foo`, make sure to pass ' +
        "up the same props that your component's constructor was passed.\n" +
        '    in Foo (at **)',
    ]);
  });

  /**
   * App stage1 先挂载故障子，stage2 删除；子 willUnmount 给 App setState、计数并抛错；act 拒绝但 count=1，证明提交错误恢复不会再次调用同一已删除实例卸载。
   */
  it('should only call componentWillUnmount once', async () => {
    let app;
    let count = 0;

    /**
     * stage 控制故障子组件是否保留的父 fixture，并把实例保留给子卸载时排队父更新。
     */
    class App extends React.Component {
      /**
       * stage1 返回 UnunmountableComponent，其余返回null，第二轮明确触发子删除。
       */
      render() {
        if (this.props.stage === 1) {
          return <UnunmountableComponent />;
        } else {
          return null;
        }
      }
    }

    /**
     * 卸载时更新父、计数并抛错的 fixture，用来验证删除失败不会重入同一清理方法。
     */
    class UnunmountableComponent extends React.Component {
      /**
       * 先 app.setState({})，再 count++，最后抛 always fails；无返回值，提交恢复仍必须把这枚实例视为已处理删除。
       */
      componentWillUnmount() {
        app.setState({});
        count++;
        throw Error('always fails');
      }

      /**
       * 返回 Hello/name div，先正常提交后才能在stage2测试 willUnmount。
       */
      render() {
        return <div>Hello {this.props.name}</div>;
      }
    }

    const container = document.createElement('div');

    /**
     * 仅非空 ref 更新 app，保留卸载中的父引用；null 时不清空，保证子清理能调用父 setState。
     */
    const setRef = ref => {
      if (ref) {
        app = ref;
      }
    };

    const root = ReactDOMClient.createRoot(container);
    await expect(async () => {
      await act(() => {
        root.render(<App ref={setRef} stage={1} />);
      });
      await act(() => {
        root.render(<App ref={setRef} stage={2} />);
      });
    }).rejects.toThrow();
    expect(count).toBe(1);
  });

  /**
   * Wrapper 用 name 作 Spy key，A→B；日志 B willMount/render 在 A willUnmount 前，B didMount 在后，证明新候选在 render 准备、旧清理与新挂载在 commit 顺序执行。
   */
  it('prepares new child before unmounting old', async () => {
    /**
     * 记录 render/挂载/清理阶段的 keyed fixture，比较换 key 时新候选准备与旧实例删除顺序。
     */
    class Spy extends React.Component {
      /**
       * 记录 name 的 willMount，属于候选render前而非真实提交挂载。
       */
      UNSAFE_componentWillMount() {
        Scheduler.log(this.props.name + ' componentWillMount');
      }
      /**
       * 记录 name render 并返回 div；新B此日志可先于旧A卸载。
       */
      render() {
        Scheduler.log(this.props.name + ' render');
        return <div />;
      }
      /**
       * 记录 name didMount，必须在旧节点删除与新宿主提交之后。
       */
      componentDidMount() {
        Scheduler.log(this.props.name + ' componentDidMount');
      }
      /**
       * 记录 name willUnmount，作为旧A在mutation删除阶段的观测。
       */
      componentWillUnmount() {
        Scheduler.log(this.props.name + ' componentWillUnmount');
      }
    }

    /**
     * 以name同时作为Spy key与日志标签的父包装，强制A→B身份替换而非prop更新。
     */
    class Wrapper extends React.Component {
      /**
       * 返回 keyed Spy，key改变让协调器创建新实例并删除旧实例。
       */
      render() {
        return <Spy key={this.props.name} name={this.props.name} />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Wrapper name="A" />);
    });

    assertLog(['A componentWillMount', 'A render', 'A componentDidMount']);
    await act(() => {
      root.render(<Wrapper name="B" />);
    });

    assertLog([
      'B componentWillMount',
      'B render',
      'A componentWillUnmount',
      'B componentDidMount',
    ]);
  });

  /**
   * Apple 以 shallowCompare 控制更新：父 color green 不新增子 render，red 会；cut 改状态触发 render，重复 cut 空日志，eatSlice 触发 red/true/9，验证 props/state 字段级 Object.is 判定。
   */
  it('respects a shallow shouldComponentUpdate implementation', async () => {
    /**
     * 通过自身color状态驱动Apple props的父夹具；appleRef允许测试单独更新子状态。
     */
    class PlasticWrap extends React.Component {
      /**
       * 保存props/context，初始化color=green及子对象ref；构造状态基准，随后测试有变化/无变化的浅比较。
       */
      constructor(props, context) {
        super(props, context);
        this.state = {
          color: 'green',
        };
        this.appleRef = React.createRef();
      }

      /**
       * 返回Apple(color,appleRef)，父更新本身无日志，观测的是子SCU是否允许render。
       */
      render() {
        return <Apple color={this.state.color} ref={this.appleRef} />;
      }
    }

    /**
     * 使用字段级浅比较的classfixture，分别响应color prop与cut/slices状态变化。
     */
    class Apple extends React.Component {
      /**
       * cut=false、slices=1，切片方法第一次改为true/10，重复相同补丁应被SCU挡住。
       */
      state = {
        cut: false,
        slices: 1,
      };

      /**
       * 把当前实例与nextProps/nextState交给shallowCompare，返回是否有顶层字段差异；不是深比较。
       */
      shouldComponentUpdate(nextProps, nextState) {
        return shallowCompare(this, nextProps, nextState);
      }

      /**
       * 设置cut=true和slices=10；重复调用在浅比较相等时仍处理状态补丁但不重render。
       */
      cut() {
        this.setState({
          cut: true,
          slices: 10,
        });
      }

      /**
       * 把slices减1排队更新；此例在单个act内调用，不模拟多个并发累计操作。
       */
      eatSlice() {
        this.setState({
          slices: this.state.slices - 1,
        });
      }

      /**
       * 读取color/cut/slices并写日志，返回div；日志直接显示允许render的最新props/state组合。
       */
      render() {
        const {color} = this.props;
        const {cut, slices} = this.state;

        Scheduler.log(`${color} ${cut} ${slices}`);
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let instance;
    await act(() => {
      root.render(<PlasticWrap ref={ref => (instance = ref)} />);
    });
    assertLog(['green false 1']);

    // 不要基于 props 重新渲染
    await act(() => {
      instance.setState({color: 'green'});
    });
    assertLog([]);

    // 基于 props 重新渲染
    await act(() => {
      instance.setState({color: 'red'});
    });
    assertLog(['red false 1']);

    // 基于状态重新渲染
    await act(() => {
      instance.appleRef.current.cut();
    });
    assertLog(['red true 10']);

    // 基于状态不重新渲染
    await act(() => {
      instance.appleRef.current.cut();
    });
    assertLog([]);

    // 重新渲染基于状态
    await act(() => {
      instance.appleRef.current.eatSlice();
    });
    assertLog(['red true 9']);
  });

  /**
   * Component state 含数组/对象；用相同字段引用补丁无 render，换成内容相同新数组或新对象均有 render，证明浅比较不递归比较集合内容。
   */
  it('does not do a deep comparison for a shallow shouldComponentUpdate implementation', async () => {
    /**
     * 每次创建内容相同但引用新鲜的foo数组/bar对象，返回初始状态；用于区别深内容相等与浅引用不等。
     */
    function getInitialState() {
      return {
        foo: [1, 2, 3],
        bar: {a: 4, b: 5, c: 6},
      };
    }

    const initialSettings = getInitialState();

    /**
     * 嵌套集合state的浅比较fixture；render日志文本相同也可能源于不同字段引用。
     */
    class Component extends React.Component {
      /**
       * 先使用initialSettings对象，后续setState浅合并其字段；测试替换foo引用，而非要求state根对象identity固定。
       */
      state = initialSettings;

      /**
       * 返回shallowCompare结果，仅比较props/state顶层字段identity。
       */
      shouldComponentUpdate(nextProps, nextState) {
        return shallowCompare(this, nextProps, nextState);
      }

      /**
       * 把foo/bar内容格式化记日志并返回div；日志只能证明render发生，不作为深比较依据。
       */
      render() {
        const {foo, bar} = this.state;
        Scheduler.log(`{foo:[${foo}],bar:{a:${bar.a},b:${bar.b},c:${bar.c}}`);
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let instance;
    await act(() => {
      root.render(<Component ref={ref => (instance = ref)} />);
    });
    assertLog(['{foo:[1,2,3],bar:{a:4,b:5,c:6}']);

    // 不要重新渲染，如果状态相等
    const settings = {
      foo: initialSettings.foo,
      bar: initialSettings.bar,
    };
    await act(() => {
      instance.setState(settings);
    });
    assertLog([]);

    // 重新渲染因为有一个字段发生变化。
    initialSettings.foo = [1, 2, 3];
    await act(() => {
      instance.setState(initialSettings);
    });
    assertLog(['{foo:[1,2,3],bar:{a:4,b:5,c:6}']);

    // 重新渲染因为对象改变了
    await act(() => {
      instance.setState(getInitialState());
    });
    assertLog(['{foo:[1,2,3],bar:{a:4,b:5,c:6}']);
  });

  /**
   * didMount 内 setState({},restCallback) 保存实参；act 后 mockArgs.length=0，验证提交 setState callback 不接收 state/props 参数。
   */
  it('should call setState callback with no arguments', async () => {
    let mockArgs;
    /**
     * didMount触发setState提交callback的fixture，用rest参数探测callback实参。
     */
    class Component extends React.Component {
      /**
       * 挂载后setState空补丁，回调保存args；act等待该提交，预期args为空数组。
       */
      componentDidMount() {
        this.setState({}, (...args) => (mockArgs = args));
      }
      /**
       * 返回false，不创建宿主节点；callback协议不要求非空DOM输出。
       */
      render() {
        return false;
      }
    }
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Component />);
    });

    expect(mockArgs.length).toEqual(0);
  });

  /**
   * 初始 hasUpdatedState=false，在 willMount setState(true,callback)；callback 读取 this.state 后 flag=true，证明回调运行时挂载状态补丁已应用。
   */
  it('this.state should be updated on setState callback inside componentWillMount', async () => {
    const div = document.createElement('div');
    let stateSuccessfullyUpdated = false;

    /**
     * willMount排队状态及读取回调的fixture，确认callback看到应用后的挂载状态。
     */
    class Component extends React.Component {
      /**
       * 保存props/context并初始化hasUpdatedState=false，使willMount补丁true有明确基准。
       */
      constructor(props, context) {
        super(props, context);
        this.state = {
          hasUpdatedState: false,
        };
      }

      /**
       * 排队hasUpdatedState=true，callback读取this.state再保存flag；callback应在补丁已应用的提交阶段运行。
       */
      UNSAFE_componentWillMount() {
        this.setState(
          {hasUpdatedState: true},
          () => (stateSuccessfullyUpdated = this.state.hasUpdatedState),
        );
      }

      /**
       * 返回包children的div，状态结果通过callbackflag而非DOM文本验证。
       */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    const root = ReactDOMClient.createRoot(div);
    await act(() => {
      root.render(<Component />);
    });

    expect(stateSuccessfullyUpdated).toBe(true);
  });

  /**
   * shouldComponentUpdate mock=false，初挂不调用该方法；后续 setState(true,callback) 时 mock 已调用、实例 state 已true、callback仍记录，证明 render bailout 不丢提交回调。
   */
  it('should call the setState callback even if shouldComponentUpdate = false', async () => {
    const mockFn = jest.fn().mockReturnValue(false);
    const div = document.createElement('div');

    /**
     * SCU=false但仍要求setState callback提交的fixture，区分render bailout与回调消费。
     */
    class Component extends React.Component {
      /**
       * 保存props/context并初始化hasUpdatedState=false。
       */
      constructor(props, context) {
        super(props, context);
        this.state = {
          hasUpdatedState: false,
        };
      }

      /**
       * willMount保存实例引用；首次挂载不调用SCU，之后才由测试对该实例更新。
       */
      UNSAFE_componentWillMount() {
        instance = this;
      }

      /**
       * 调用mockFn并返回false，挡住更新render但不丢掉state补丁或callback。
       */
      shouldComponentUpdate() {
        return mockFn();
      }

      /**
       * 返回state布尔children的div；布尔值不生成文本，最终结果通过实例state与callback日志验证。
       */
      render() {
        return <div>{this.state.hasUpdatedState}</div>;
      }
    }

    const root = ReactDOMClient.createRoot(div);
    let instance;
    await act(() => {
      root.render(<Component ref={ref => (instance = ref)} />);
    });

    expect(instance).toBeDefined();
    expect(mockFn).not.toBeCalled();

    await act(() => {
      instance.setState({hasUpdatedState: true}, () => {
        expect(mockFn).toBeCalled();
        expect(instance.state.hasUpdatedState).toBe(true);
        Scheduler.log('setState callback called');
      });
    });

    assertLog(['setState callback called']);
  });

  /**
   * 派生构造器返回 {something:false} 替换实例；act 拒绝且两轮 render 尝试均提示未找到 render，帮助定位 constructor 返回普通对象导致实例方法丢失。
   */
  it('should return a meaningful warning when constructor is returned', async () => {
    /**
     * 构造器返回普通对象替换this的非法fixture，触发缺少render方法的诊断。
     */
    class RenderTextInvalidConstructor extends React.Component {
      /**
       * super(props)后返回{something:false}；返回对象替代class实例，因此原型render不再可用。
       */
      constructor(props) {
        super(props);
        return {something: false};
      }

      /**
       * 原型render返回div，但非法构造返回值使该方法不会成为实际实例的render。
       */
      render() {
        return <div />;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await expect(async () => {
      await act(() => {
        root.render(<RenderTextInvalidConstructor />);
      });
    }).rejects.toThrow();
    assertConsoleErrorDev([
      'No `render` method found on the RenderTextInvalidConstructor instance: ' +
        'did you accidentally return an object from the constructor?\n' +
        '    in RenderTextInvalidConstructor (at **)',
      'No `render` method found on the RenderTextInvalidConstructor instance: ' +
        'did you accidentally return an object from the constructor?\n' +
        '    in RenderTextInvalidConstructor (at **)',
    ]);
  });

  /**
   * Bad.render 重新赋 this.props 的浅复制并返回 null；DEV 提示不支持重分配，空 didMount/didUpdate 只是正常提交钩子，没有额外断言。
   */
  it('should warn about reassigning this.props while rendering', () => {
    /**
     * render内重分配自身props的故障fixture，空提交钩子不产生其他副作用。
     */
    class Bad extends React.Component {
      /**
       * 空挂载钩子，确保props误赋值诊断与正常layout方法存在无关。
       */
      componentDidMount() {}
      /**
       * 空更新钩子，不改状态或props；本例仅挂载读取DEV提示。
       */
      componentDidUpdate() {}
      /**
       * 把props浅复制后写回this.props并返回null，故意破坏React拥有实例props的约定。
       */
      render() {
        this.props = {...this.props};
        return null;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    ReactDOM.flushSync(() => {
      root.render(<Bad />);
    });
    assertConsoleErrorDev([
      'It looks like Bad is reassigning its own `this.props` while rendering. ' +
        'This is not supported and can lead to confusing bugs.\n' +
        '    in Bad (at **)',
    ]);
  });

  /**
   * 组件继承 React.Component 但完全没有 render；act 拒绝并记录两次诊断，覆盖失败 render 的重试而非静默输出空 UI。
   */
  it('should return error if render is not defined', async () => {
    /**
     * 继承React.Component却未声明render的非法输入，测试应拒绝并给出缺失方法诊断。
     */
    class RenderTestUndefinedRender extends React.Component {}

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await expect(async () => {
      await act(() => {
        root.render(<RenderTestUndefinedRender />);
      });
    }).rejects.toThrow();
    assertConsoleErrorDev([
      'No `render` method found on the RenderTestUndefinedRender instance: ' +
        'you may have forgotten to define `render`.\n' +
        '    in RenderTestUndefinedRender (at **)',
      'No `render` method found on the RenderTestUndefinedRender instance: ' +
        'you may have forgotten to define `render`.\n' +
        '    in RenderTestUndefinedRender (at **)',
    ]);
  });

  // 回归测试，用于检测意外的破坏性更改 https://github.com/facebook/react/issues/13580
  /**
   * issue13580 的 Shadow 以实例方法覆盖 isReactComponent；挂载成功且首子 DIV，证明 class 判定只需原型标记存在而不要求标记仍是原对象。
   */
  it('should support classes shadowing isReactComponent', async () => {
    /**
     * 实例方法覆盖isReactComponent标记的fixture，验证class检测不要求标记值是特定对象。
     */
    class Shadow extends React.Component {
      /**
       * 空同名方法只用于遮蔽继承标记；测试不调用该方法，关键是原型属性仍存在。
       */
      isReactComponent() {}
      /**
       * 返回div，让成功挂载成为class身份识别的DOM证据。
       */
      render() {
        return <div />;
      }
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Shadow />);
    });
    expect(container.firstChild.tagName).toBe('DIV');
  });

  /**
   * A 先暴露 Hook setter，B willMount 调用 setState(1)；act 后 A DOM 为1，覆盖旧挂载生命周期更新另一函数组件；正文无显式 console 次数断言。
   */
  it('should not warn on updating function component from componentWillMount', async () => {
    let setState;
    let ref;
    /**
     * useState初始null，把setter暴露给后续B，返回挂ref的状态div；外部断言通过DOM读取跨组件更新结果。
     */
    function A() {
      const [state, _setState] = React.useState(null);
      setState = _setState;
      return <div ref={r => (ref = r)}>{state}</div>;
    }
    /**
     * 无宿主输出的classfixture，在旧式willMount调用已由A暴露的Hook setter，以区分生命周期阶段与render内非法更新。
     */
    class B extends React.Component {
      /**
       * 在挂载前调用A的setState(1)，不修改自身状态或返回UI；本例由act冲刷A更新。
       */
      UNSAFE_componentWillMount() {
        setState(1);
      }
      /**
       * 返回null，B不生成DOM，唯一行为在对应旧生命周期更新A。
       */
      render() {
        return null;
      }
    }
    /**
     * 按A先B顺序返回同级children；A先暴露setter，使B随后能调用它，父div不改变跨组件更新目标。
     */
    function Parent() {
      return (
        <div>
          <A />
          <B />
        </div>
      );
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });

    expect(ref.textContent).toBe('1');
  });

  /**
   * A/B 首挂后重渲染，B willUpdate 调 A setter(1)；A DOM 为1，覆盖更新前旧生命周期中的跨组件更新。
   */
  it('should not warn on updating function component from componentWillUpdate', async () => {
    let setState;
    let ref;
    /**
     * useState初始undefined，把setter暴露给后续B，返回挂ref的状态div；外部断言通过DOM读取跨组件更新结果。
     */
    function A() {
      const [state, _setState] = React.useState();
      setState = _setState;
      return <div ref={r => (ref = r)}>{state}</div>;
    }
    /**
     * 无宿主输出的classfixture，在旧式willUpdate调用已由A暴露的Hook setter，以区分生命周期阶段与render内非法更新。
     */
    class B extends React.Component {
      /**
       * 在更新前调用A的setState(1)，不修改自身状态或返回UI；本例由act冲刷A更新。
       */
      UNSAFE_componentWillUpdate() {
        setState(1);
      }
      /**
       * 返回null，B不生成DOM，唯一行为在对应旧生命周期更新A。
       */
      render() {
        return null;
      }
    }
    /**
     * 按A先B顺序返回同级children；A先暴露setter，使B随后能调用它，父div不改变跨组件更新目标。
     */
    function Parent() {
      return (
        <div>
          <A />
          <B />
        </div>
      );
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });
    await act(() => {
      root.render(<Parent />);
    });

    expect(ref.textContent).toBe('1');
  });

  /**
   * A/B 首挂后重渲染，B willReceiveProps 调 A setter(1)；A DOM 为1，验证该旧生命周期更新进入正确队列。
   */
  it('should not warn on updating function component from componentWillReceiveProps', async () => {
    let setState;
    let ref;
    /**
     * useState初始undefined，把setter暴露给后续B，返回挂ref的状态div；外部断言通过DOM读取跨组件更新结果。
     */
    function A() {
      const [state, _setState] = React.useState();
      setState = _setState;
      return <div ref={r => (ref = r)}>{state}</div>;
    }

    /**
     * 无宿主输出的classfixture，在旧式willReceiveProps调用已由A暴露的Hook setter，以区分生命周期阶段与render内非法更新。
     */
    class B extends React.Component {
      /**
       * 在接收新props调用A的setState(1)，不修改自身状态或返回UI；本例由act冲刷A更新。
       */
      UNSAFE_componentWillReceiveProps() {
        setState(1);
      }
      /**
       * 返回null，B不生成DOM，唯一行为在对应旧生命周期更新A。
       */
      render() {
        return null;
      }
    }
    /**
     * 按A先B顺序返回同级children；A先暴露setter，使B随后能调用它，父div不改变跨组件更新目标。
     */
    function Parent() {
      return (
        <div>
          <A />
          <B />
        </div>
      );
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });
    await act(() => {
      root.render(<Parent />);
    });

    expect(ref.textContent).toBe('1');
  });

  /**
   * B.render 调 A 函数 updater(c+1)；首次 flushSync DEV 跨组件 render 更新警告但 DOM1，再重渲染 DOM2，验证诊断去重且每轮更新仍应用。
   */
  it('should warn on updating function component from render', () => {
    let setState;
    let ref;
    /**
     * useState初始0，把setter暴露给后续B，返回挂ref的状态div；外部断言通过DOM读取跨组件更新结果。
     */
    function A() {
      const [state, _setState] = React.useState(0);
      setState = _setState;
      return <div ref={r => (ref = r)}>{state}</div>;
    }

    /**
     * 在render内更新兄弟A的classfixture；专门用于跨组件render更新DEV警告与去重。
     */
    class B extends React.Component {
      /**
       * 调用A函数updater(c=>c+1)后返回null；候选render的跨组件副作用会警告，但测试仍验证每轮加1提交。
       */
      render() {
        setState(c => c + 1);
        return null;
      }
    }
    /**
     * 按A先B顺序返回同级children；A先暴露setter，使B随后能调用它，父div不改变跨组件更新目标。
     */
    function Parent() {
      return (
        <div>
          <A />
          <B />
        </div>
      );
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    ReactDOM.flushSync(() => {
      root.render(<Parent />);
    });
    assertConsoleErrorDev([
      'Cannot update a component (`A`) while rendering a different component (`B`). ' +
        'To locate the bad setState() call inside `B`, ' +
        'follow the stack trace as described in https://react.dev/link/setstate-in-render\n' +
        '    in Parent (at **)',
    ]);

    // 开发环境记录了跨组件 render 阶段更新的警告，但该 state 更新仍会生效。
    expect(ref.textContent).toBe('1');

    // 去重。
    ReactDOM.flushSync(() => {
      root.render(<Parent />);
    });

    // 开发环境记录了跨组件 render 阶段更新的警告，但该 state 更新仍会生效。
    expect(ref.textContent).toBe('2');
  });
});
