/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** `React`：保存当前测试场景复用的夹具、状态或回调。 */
const React = require('react');
/** `ReactDOMClient`：保存当前测试场景复用的夹具、状态或回调。 */
const ReactDOMClient = require('react-dom/client');
/** `act`：保存当前测试场景复用的夹具、状态或回调。 */
const act = require('internal-test-utils').act;

/**
 * 测试 ref 在多个子节点之间切换时，我们能否正确跟踪它。
 */
describe('ref swapping', () => {
  let RefHopsAround;
  beforeEach(() => {
    RefHopsAround = class extends React.Component {
      /** `container`：记录测试夹具在当前场景中的状态。 */
      container = null;
      /** `state`：记录测试夹具在当前场景中的状态。 */
      state = {count: 0};
      /** `hopRef`：记录测试夹具在当前场景中的状态。 */
      hopRef = React.createRef();
      /** `divOneRef`：记录测试夹具在当前场景中的状态。 */
      divOneRef = React.createRef();
      /** `divTwoRef`：记录测试夹具在当前场景中的状态。 */
      divTwoRef = React.createRef();
      /** `divThreeRef`：记录测试夹具在当前场景中的状态。 */
      divThreeRef = React.createRef();

      /** `moveRef`：封装当前用例复用的操作、回调或断言步骤。 */
      moveRef = () => {
        this.setState({count: this.state.count + 1});
      };

      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「Allow refs to hop around children correctly」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
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

  /** 测试场景：验证「always has a value for this.refs」描述的渲染、交互或错误处理结果。 */
  it('always has a value for this.refs', async () => {
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「ref called correctly for stateless component」描述的渲染、交互或错误处理结果。 */
  it('ref called correctly for stateless component', async () => {
    let refCalled = 0;
    /** `Inner`：封装当前用例复用的操作、回调或断言步骤。 */
    function Inner(props) {
      return <a ref={props.saveA} />;
    }

    /** `Outer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Outer extends React.Component {
      /** `Outer.saveA`：封装当前用例复用的操作、回调或断言步骤。 */
      saveA = () => {
        refCalled++;
      };

      /** `Outer.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        this.setState({});
      }

      /** `Outer.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「provides an error for invalid refs」描述的渲染、交互或错误处理结果。 */
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
  /** 测试场景：验证「attaches and detaches root refs」描述的渲染、交互或错误处理结果。 */
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

    // composite 组件
    /** `Comp`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Comp extends React.Component {
      /** `Comp.method`：实现测试夹具的生命周期、渲染或交互步骤。 */
      method() {
        return true;
      }
      /** `Comp.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
  /** 测试场景：验证「calls clean up function if it exists」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「handles ref functions with stable identity」描述的渲染、交互或错误处理结果。 */
  it('handles ref functions with stable identity', async () => {
    const container = document.createElement('div');
    const cleanUp = jest.fn();
    const setup = jest.fn();

    /** `_onRefChange`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「handles detaching refs with either cleanup function or null argument」描述的渲染、交互或错误处理结果。 */
  it('handles detaching refs with either cleanup function or null argument', async () => {
    const container = document.createElement('div');
    const cleanUp = jest.fn();
    const setup = jest.fn();
    const setup2 = jest.fn();
    const nullHandler = jest.fn();

    /** `_onRefChangeWithCleanup`：封装当前用例复用的操作、回调或断言步骤。 */
    function _onRefChangeWithCleanup(_ref) {
      if (_ref) {
        setup(_ref.id);
      } else {
        nullHandler();
      }
      return cleanUp;
    }

    /** `_onRefChangeWithoutCleanup`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「calls cleanup function on unmount」描述的渲染、交互或错误处理结果。 */
  it('calls cleanup function on unmount', async () => {
    const container = document.createElement('div');
    const cleanUp = jest.fn();
    const setup = jest.fn();
    const nullHandler = jest.fn();

    /** `_onRefChangeWithCleanup`：封装当前用例复用的操作、回调或断言步骤。 */
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
  const ImperativeHandleComponent = React.forwardRef(({name}, ref) => {
    React.useImperativeHandle(
      ref,
      () => ({
        /** `greet`：实现测试夹具的生命周期、渲染或交互步骤。 */
        greet() {
          return `Hello ${name}`;
        },
      }),
      [name],
    );
    return null;
  });

  /** 测试场景：验证「should work with object style refs」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should work with callback style refs」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should work with callback style refs with cleanup function」描述的渲染、交互或错误处理结果。 */
  it('should work with callback style refs with cleanup function', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    let cleanupCalls = 0;
    let createCalls = 0;
    let current = null;

    /** `ref`：封装当前用例复用的操作、回调或断言步骤。 */
    const ref = r => {
      current = r;
      createCalls++;
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
