/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** 加载React类、createRef及命令句柄hook，构造各ref协议fixture。 */
const React = require('react');

/** 创建现代根并用unmount检查ref清理。 */
const ReactDOMClient = require('react-dom/client');

/** 等待commit与ref attach/detach完成后检查身份/次数。 */
const act = require('internal-test-utils').act;

/**
 * 测试 ref 在多个子节点之间切换时，我们能否正确跟踪它。
 */
describe('ref swapping', () => {
  let RefHopsAround;
  beforeEach(() => {
    /** count驱动同一hopRef轮流附到三div，另三独立ref用于确认其余节点身份。 */
    RefHopsAround = class extends React.Component {

      /** 保存父DOM，按class查找三目标节点，不以ref自身充当身份预期。 */
      container = null;

      /** 初count0指向first，每次递增后对3取模。 */
      state = {count: 0};

      /** 会跨节点迁移的共享对象ref，detach/attach后应指向本轮目标。 */
      hopRef = React.createRef();

      /** first未占hopRef时使用的独立ref。 */
      divOneRef = React.createRef();

      /** second未占hopRef时使用的独立ref。 */
      divTwoRef = React.createRef();

      /** third未占hopRef时使用的独立ref。 */
      divThreeRef = React.createRef();

      /** 将count增加一次，驱动hopRef下一位置；每次由测试独立act提交。 */
      moveRef = () => {
        this.setState({count: this.state.count + 1});
      };

      /** 按count%3给一个div分配hopRef、其它分配独立ref，宿主位置不变只换ref。 */
      render() {
        const count = this.state.count;
        /**
         * 这里有三个带 ref 的 div（div1/div2/div3），以及一个会在三者之间移动的
         * `hopRef`。多次调用 `moveRef()`，确认 `hopRef` 每次都指向正确的 div。
         */
        return (
          <div ref={current => (this.container = current)}>
            <div
              className="first"
              ref={count % 3 === 0 ? this.hopRef : this.divOneRef}
            />
            <div
              className="second"
              ref={count % 3 === 1 ? this.hopRef : this.divTwoRef}
            />
            <div
              className="third"
              ref={count % 3 === 2 ? this.hopRef : this.divThreeRef}
            />
          </div>
        );
      }
    };
  });

  /** RefHopsAround初count0，三次moveRef使hopRef在first→second→third→first；每轮其它独立ref对应原DOM，验证同一对象ref迁移解绑/绑定顺序。 */
  it('Allow refs to hop around children correctly', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    let refHopsAround;
    await act(() => {
      root.render(<RefHopsAround ref={current => (refHopsAround = current)} />);
    });

    const firstDiv = refHopsAround.container.querySelector('.first');
    const secondDiv = refHopsAround.container.querySelector('.second');
    const thirdDiv = refHopsAround.container.querySelector('.third');

    expect(refHopsAround.hopRef.current).toEqual(firstDiv);
    expect(refHopsAround.divTwoRef.current).toEqual(secondDiv);
    expect(refHopsAround.divThreeRef.current).toEqual(thirdDiv);

    await act(() => {
      refHopsAround.moveRef();
    });
    expect(refHopsAround.divOneRef.current).toEqual(firstDiv);
    expect(refHopsAround.hopRef.current).toEqual(secondDiv);
    expect(refHopsAround.divThreeRef.current).toEqual(thirdDiv);

    await act(() => {
      refHopsAround.moveRef();
    });
    expect(refHopsAround.divOneRef.current).toEqual(firstDiv);
    expect(refHopsAround.divTwoRef.current).toEqual(secondDiv);
    expect(refHopsAround.hopRef.current).toEqual(thirdDiv);

    /**
     * 确保在第三次之后， 我们回到了起点，并且所有的引用都完全恢复了。
     */
    await act(() => {
      refHopsAround.moveRef();
    });
    expect(refHopsAround.hopRef.current).toEqual(firstDiv);
    expect(refHopsAround.divTwoRef.current).toEqual(secondDiv);
    expect(refHopsAround.divThreeRef.current).toEqual(thirdDiv);
  });

  /** 无字符串ref的类Component挂载后instance.refs真值存在，验证旧refs容器初始形状。 */
  it('always has a value for this.refs', async () => {

    /** 未使用旧字符串ref的类，仍应有refs容器。 */
    class Component extends React.Component {

      /** 输出div，实例ref用于检查this.refs真值。 */
      render() {
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let instance;
    await act(() => {
      root.render(<Component ref={current => (instance = current)} />);
    });
    expect(!!instance.refs).toBe(true);
  });

  /** Outer稳定saveA callback透过函数Inner挂到a，didMount setState重渲染；refCalled仅1，验证同函数/同宿主更新不重新attach。 */
  it('ref called correctly for stateless component', async () => {
    let refCalled = 0;

    /** 函数中间层，把saveA prop作为真实a的ref，不给函数组件本身附ref。 */
    function Inner(props) {
      return <a ref={props.saveA} />;
    }

    /** 用稳定类字段saveA并挂载后setState空对象，测试更新不重attach。 */
    class Outer extends React.Component {

      /** 每次ref回调递增计数，本例只应一次且不返回cleanup。 */
      saveA = () => {
        refCalled++;
      };

      /** 触发同树更新，saveA身份不变。 */
      componentDidMount() {
        this.setState({});
      }

      /** 把稳定saveA透传Inner，宿主a同类型。 */
      render() {
        return <Inner saveA={this.saveA} />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Outer />);
    });

    expect(refCalled).toBe(1);
  });

  /** div.ref分别数字10、布尔true、Symbol foo；act前两次拒绝任意错误，第三次匹配Expected ref to be a function，验证非法ref类型；前两次未匹配具体AggregateError内容。 */
  it('provides an error for invalid refs', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(async () => {
      await act(() => {
        root.render(<div ref={10} />);
      });
      // TODO：这里会抛出 AggregateError，需要更新测试基础设施以支持匹配该错误。
    }).rejects.toThrow();
    await expect(async () => {
      await act(() => {
        root.render(<div ref={true} />);
      });
      // TODO：这里会抛出 AggregateError，需要更新测试基础设施以支持匹配该错误。
    }).rejects.toThrow();
    await expect(async () => {
      await act(() => {
        root.render(<div ref={Symbol('foo')} />);
      });
    }).rejects.toThrow('Expected ref to be a function');
  });
});

describe('root level refs', () => {

  /** 根分别宿主div、类Comp、含类/数字/宿主的数组；ref初次给对应DOM/类实例、卸载给null且次数2；null根无节点、数字5根为Text，验证公用实例与原始值差别。 */
  it('attaches and detaches root refs', async () => {
    let inst = null;

    // 宿主节点
    let ref = jest.fn(value => (inst = value));
    const container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<div ref={ref} />);
    });
    let result = container.firstChild;
    expect(ref).toHaveBeenCalledTimes(1);
    expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLDivElement);
    expect(result).toBe(ref.mock.calls[0][0]);
    await act(() => {
      root.unmount();
    });
    expect(ref).toHaveBeenCalledTimes(2);
    expect(ref.mock.calls[1][0]).toBe(null);

    // 复合类组件

    /** 类公用实例fixture，带method可确认ref得到类实例。 */
    class Comp extends React.Component {

      /** 返回true，用于证明类ref可调用实例方法而非DOM节点。 */
      method() {
        return true;
      }

      /** 输出Comp div，ref附在类时公用实例仍为Comp。 */
      render() {
        return <div>Comp</div>;
      }
    }

    inst = null;
    ref = jest.fn(value => (inst = value));
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Comp ref={ref} />);
    });

    expect(ref).toHaveBeenCalledTimes(1);
    expect(inst).toBeInstanceOf(Comp);

    // 确保我们有一个正确的实例。
    expect(inst.method()).toBe(true);

    await act(() => {
      root.unmount();
    });
    expect(ref).toHaveBeenCalledTimes(2);
    expect(ref.mock.calls[1][0]).toBe(null);

    // 片段
    inst = null;
    ref = jest.fn(value => (inst = value));
    let divInst = null;
    const ref2 = jest.fn(value => (divInst = value));
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render([
        <Comp ref={ref} key="a" />,
        5,
        <div ref={ref2} key="b">
          Hello
        </div>,
      ]);
    });

    // 第一次调用应该为 `Comp`
    expect(ref).toHaveBeenCalledTimes(1);
    expect(ref.mock.calls[0][0]).toBeInstanceOf(Comp);

    expect(ref2).toHaveBeenCalledTimes(1);
    expect(divInst).toBeInstanceOf(HTMLDivElement);

    await act(() => {
      root.unmount();
    });
    expect(ref).toHaveBeenCalledTimes(2);
    expect(ref.mock.calls[1][0]).toBe(null);
    expect(ref2).toHaveBeenCalledTimes(2);
    expect(ref2.mock.calls[1][0]).toBe(null);

    // null
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(null);
    });
    result = container.firstChild;
    expect(result).toBe(null);

    // 基本类型
    await act(() => {
      root.render(5);
    });
    result = container.firstChild;
    expect(result).toBeInstanceOf(Text);
  });
});

describe('refs return clean up function', () => {

  /** 多次更换inline ref：首次返回cleanup、次不返回、次空ref，再重置计数连续两次返回cleanup；解绑有清理时调用cleanup无参数，无清理时旧callback收到null，验证两种detach协议。 */
  it('calls clean up function if it exists', async () => {
    const container = document.createElement('div');
    let cleanUp = jest.fn();
    let setup = jest.fn();

    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(
        <div
          ref={_ref => {
            setup(_ref);
            return cleanUp;
          }}
        />,
      );
    });

    await act(() => {
      root.render(
        <div
          ref={_ref => {
            setup(_ref);
          }}
        />,
      );
    });

    expect(setup).toHaveBeenCalledTimes(2);
    expect(cleanUp).toHaveBeenCalledTimes(1);
    expect(cleanUp.mock.calls[0][0]).toBe(undefined);

    await act(() => {
      root.render(<div ref={_ref => {}} />);
    });

    expect(cleanUp).toHaveBeenCalledTimes(1);
    expect(setup).toHaveBeenCalledTimes(3);
    expect(setup.mock.calls[2][0]).toBe(null);

    cleanUp = jest.fn();
    setup = jest.fn();

    await act(() => {
      root.render(
        <div
          ref={_ref => {
            setup(_ref);
            return cleanUp;
          }}
        />,
      );
    });

    expect(setup).toHaveBeenCalledTimes(1);
    expect(cleanUp).toHaveBeenCalledTimes(0);

    await act(() => {
      root.render(
        <div
          ref={_ref => {
            setup(_ref);
            return cleanUp;
          }}
        />,
      );
    });

    expect(setup).toHaveBeenCalledTimes(2);
    expect(cleanUp).toHaveBeenCalledTimes(1);
  });

  /** 稳定_onRefChange返回cleanup；仅className更新不会再次setup/cleanup，去除ref后cleanup一次，验证身份稳定与宿主属性更新独立。 */
  it('handles ref functions with stable identity', async () => {
    const container = document.createElement('div');
    const cleanUp = jest.fn();
    const setup = jest.fn();

    /** 记录收到的DOM并返回稳定cleanUp，让同ref更新无需重建、移除时调用清理。 */
    function _onRefChange(_ref) {
      setup(_ref);
      return cleanUp;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<div ref={_onRefChange} />);
    });

    expect(setup).toHaveBeenCalledTimes(1);
    expect(cleanUp).toHaveBeenCalledTimes(0);

    await act(() => {
      root.render(<div className="niceClassName" ref={_onRefChange} />);
    });

    expect(setup).toHaveBeenCalledTimes(1);
    expect(cleanUp).toHaveBeenCalledTimes(0);

    await act(() => {
      root.render(<div />);
    });

    expect(setup).toHaveBeenCalledTimes(1);
    expect(cleanUp).toHaveBeenCalledTimes(1);
  });

  /** 从带cleanup ref切到不带，再切回，id依次test-div/2/3；有cleanup解绑不回调null，无cleanup解绑nullHandler一次，各新setup正确，验证两协议互斥。 */
  it('handles detaching refs with either cleanup function or null argument', async () => {
    const container = document.createElement('div');
    const cleanUp = jest.fn();
    const setup = jest.fn();
    const setup2 = jest.fn();
    const nullHandler = jest.fn();

    /** 非null时按id setup，否则记nullHandler，但返回cleanUp；正确detach不应再用null调用它。 */
    function _onRefChangeWithCleanup(_ref) {
      if (_ref) {
        setup(_ref.id);
      } else {
        nullHandler();
      }
      return cleanUp;
    }

    /** 非null时按id setup2、null时记nullHandler，不返回cleanup，作为回调null协议对照。 */
    function _onRefChangeWithoutCleanup(_ref) {
      if (_ref) {
        setup2(_ref.id);
      } else {
        nullHandler();
      }
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<div id="test-div" ref={_onRefChangeWithCleanup} />);
    });

    expect(setup).toBeCalledWith('test-div');
    expect(setup).toHaveBeenCalledTimes(1);
    expect(cleanUp).toHaveBeenCalledTimes(0);

    await act(() => {
      root.render(<div id="test-div2" ref={_onRefChangeWithoutCleanup} />);
    });

    // 现有 setup 回调未再次调用。
    expect(setup).toHaveBeenCalledTimes(1);
    // 由于返回了 cleanup，ref 回调不会以 null 调用。
    expect(nullHandler).toHaveBeenCalledTimes(0);
    // 此时 cleanup 已被调用。
    expect(cleanUp).toHaveBeenCalledTimes(1);

    // 新 ref 已完成 setup。
    expect(setup2).toBeCalledWith('test-div2');
    expect(setup2).toHaveBeenCalledTimes(1);

    // 现在，再次使用原始 ref 进行渲染。
    await act(() => {
      root.render(<div id="test-div3" ref={_onRefChangeWithCleanup} />);
    });

    // 新 ref 的 setup 未再次调用。
    expect(setup2).toBeCalledWith('test-div2');
    expect(setup2).toHaveBeenCalledTimes(1);

    // 由于未返回 cleanup，null handler 被调用。
    expect(nullHandler).toHaveBeenCalledTimes(1);

    // 原始 setup 又被调用一次。
    expect(setup).toHaveBeenCalledTimes(2);
  });

  /** 带cleanup ref挂test-div后root.unmount；setup仍一次、cleanup一次、nullHandler零，验证卸载优先清理返回函数。 */
  it('calls cleanup function on unmount', async () => {
    const container = document.createElement('div');
    const cleanUp = jest.fn();
    const setup = jest.fn();
    const nullHandler = jest.fn();

    /** 挂载按id setup并返回cleanUp，卸载应调用该函数而不回调null分支。 */
    function _onRefChangeWithCleanup(_ref) {
      if (_ref) {
        setup(_ref.id);
      } else {
        nullHandler();
      }
      return cleanUp;
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<div id="test-div" ref={_onRefChangeWithCleanup} />);
    });

    expect(setup).toHaveBeenCalledTimes(1);
    expect(cleanUp).toHaveBeenCalledTimes(0);
    expect(nullHandler).toHaveBeenCalledTimes(0);

    root.unmount();

    expect(setup).toHaveBeenCalledTimes(1);
    // 此时 cleanup 已被调用。
    expect(cleanUp).toHaveBeenCalledTimes(1);
    // 返回 cleanup 时，ref 回调绝不会以 null 调用。
    expect(nullHandler).toHaveBeenCalledTimes(0);
  });
});

describe('useImerativeHandle refs', () => {
  /** forwardRef接收外部ref，useImperativeHandle按name创建含greet的句柄；组件无宿主输出，依赖变化/卸载仍要清理句柄。 */
  const ImperativeHandleComponent = React.forwardRef(({name}, ref) => {
    React.useImperativeHandle(
      ref,
      () => ({

        /** 闭包捕获当前name，句柄依赖变化后返回Alice或Bob问候。 */
        greet() {
          return `Hello ${name}`;
        },
      }),
      [name],
    );
    return null;
  });

  /** forwardRef useImperativeHandle给对象ref创建Alice greet，render null后ref.current=null，验证空宿主组件仍可暴露命令句柄并清理。 */
  it('should work with object style refs', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    const ref = React.createRef();

    await act(async () => {
      root.render(<ImperativeHandleComponent name="Alice" ref={ref} />);
    });
    expect(ref.current.greet()).toBe('Hello Alice');
    await act(() => {
      root.render(null);
    });
    expect(ref.current).toBe(null);
  });

  /** 相同命令句柄通过callback ref写current；Alice greet可调用、卸载current=null，验证未返回cleanup时以null解绑。 */
  it('should work with callback style refs', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let current = null;

    await act(async () => {
      root.render(
        <ImperativeHandleComponent
          name="Alice"
          ref={r => {
            current = r;
          }}
        />,
      );
    });
    expect(current.greet()).toBe('Hello Alice');
    await act(() => {
      root.render(null);
    });
    expect(current).toBe(null);
  });

  /** callback ref返回清理函数，Alice→Bob依赖name变化使create2/cleanup1，卸载cleanup2且current=null，验证useImperativeHandle依赖重建与清理时序。 */
  it('should work with callback style refs with cleanup function', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    let cleanupCalls = 0;
    let createCalls = 0;
    let current = null;

    /** 保存新句柄并计create，返回清理函数将current置null并计cleanup；name变化与卸载分别触发清理。 */
    const ref = r => {
      current = r;
      createCalls++;
      /** 解绑旧句柄时先清current并计数，返回新句柄前必须执行旧清理。 */
      return () => {
        current = null;
        cleanupCalls++;
      };
    };

    await act(async () => {
      root.render(<ImperativeHandleComponent name="Alice" ref={ref} />);
    });
    expect(current.greet()).toBe('Hello Alice');
    expect(createCalls).toBe(1);
    expect(cleanupCalls).toBe(0);

    // 更新依赖项时应重新创建 ref
    await act(async () => {
      root.render(<ImperativeHandleComponent name="Bob" ref={ref} />);
    });
    expect(current.greet()).toBe('Hello Bob');
    expect(createCalls).toBe(2);
    expect(cleanupCalls).toBe(1);

    // 卸载时应调用 cleanup。
    await act(() => {
      root.render(null);
    });
    expect(current).toBe(null);
    expect(createCalls).toBe(2);
    expect(cleanupCalls).toBe(2);
  });
});
