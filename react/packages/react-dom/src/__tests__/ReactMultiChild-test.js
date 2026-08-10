/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

describe('ReactMultiChild', () => {
  let React;
  let ReactDOMClient;
  let act;
  let assertConsoleErrorDev;

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
  });

  describe('reconciliation', () => {
    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「should update children when possible」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
     */
    it('should update children when possible', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      const mockMount = jest.fn();
      const mockUpdate = jest.fn();
      const mockUnmount = jest.fn();

      /** `MockComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class MockComponent extends React.Component {
        /** `MockComponent.componentDidMount`：记录测试夹具在当前场景中的状态。 */
        componentDidMount = mockMount;
        /** `MockComponent.componentDidUpdate`：记录测试夹具在当前场景中的状态。 */
        componentDidUpdate = mockUpdate;
        /** `MockComponent.componentWillUnmount`：记录测试夹具在当前场景中的状态。 */
        componentWillUnmount = mockUnmount;
        /** `MockComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <span />;
        }
      }

      expect(mockMount).toHaveBeenCalledTimes(0);
      expect(mockUpdate).toHaveBeenCalledTimes(0);
      expect(mockUnmount).toHaveBeenCalledTimes(0);

      await act(async () => {
        root.render(
          <div>
            <MockComponent />
          </div>,
        );
      });

      expect(mockMount).toHaveBeenCalledTimes(1);
      expect(mockUpdate).toHaveBeenCalledTimes(0);
      expect(mockUnmount).toHaveBeenCalledTimes(0);

      await act(async () => {
        root.render(
          <div>
            <MockComponent />
          </div>,
        );
      });

      expect(mockMount).toHaveBeenCalledTimes(1);
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockUnmount).toHaveBeenCalledTimes(0);
    });

    /** 测试场景：验证「should replace children with different constructors」描述的渲染、交互或错误处理结果。 */
    it('should replace children with different constructors', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      const mockMount = jest.fn();
      const mockUnmount = jest.fn();

      /** `MockComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class MockComponent extends React.Component {
        /** `MockComponent.componentDidMount`：记录测试夹具在当前场景中的状态。 */
        componentDidMount = mockMount;
        /** `MockComponent.componentWillUnmount`：记录测试夹具在当前场景中的状态。 */
        componentWillUnmount = mockUnmount;
        /** `MockComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <span />;
        }
      }

      expect(mockMount).toHaveBeenCalledTimes(0);
      expect(mockUnmount).toHaveBeenCalledTimes(0);

      await act(async () => {
        root.render(
          <div>
            <MockComponent />
          </div>,
        );
      });

      expect(mockMount).toHaveBeenCalledTimes(1);
      expect(mockUnmount).toHaveBeenCalledTimes(0);

      await act(async () => {
        root.render(
          <div>
            <span />
          </div>,
        );
      });

      expect(mockMount).toHaveBeenCalledTimes(1);
      expect(mockUnmount).toHaveBeenCalledTimes(1);
    });

    /** 测试场景：验证「should NOT replace children with different owners」描述的渲染、交互或错误处理结果。 */
    it('should NOT replace children with different owners', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      const mockMount = jest.fn();
      const mockUnmount = jest.fn();

      /** `MockComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class MockComponent extends React.Component {
        /** `MockComponent.componentDidMount`：记录测试夹具在当前场景中的状态。 */
        componentDidMount = mockMount;
        /** `MockComponent.componentWillUnmount`：记录测试夹具在当前场景中的状态。 */
        componentWillUnmount = mockUnmount;
        /** `MockComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <span />;
        }
      }

      /** `WrapperComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class WrapperComponent extends React.Component {
        /** `WrapperComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return this.props.children || <MockComponent />;
        }
      }

      expect(mockMount).toHaveBeenCalledTimes(0);
      expect(mockUnmount).toHaveBeenCalledTimes(0);

      await act(async () => {
        root.render(<WrapperComponent />);
      });

      expect(mockMount).toHaveBeenCalledTimes(1);
      expect(mockUnmount).toHaveBeenCalledTimes(0);

      await act(async () => {
        root.render(
          <WrapperComponent>
            <MockComponent />
          </WrapperComponent>,
        );
      });

      expect(mockMount).toHaveBeenCalledTimes(1);
      expect(mockUnmount).toHaveBeenCalledTimes(0);
    });

    /** 测试场景：验证「should replace children with different keys」描述的渲染、交互或错误处理结果。 */
    it('should replace children with different keys', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      const mockMount = jest.fn();
      const mockUnmount = jest.fn();

      /** `MockComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class MockComponent extends React.Component {
        /** `MockComponent.componentDidMount`：记录测试夹具在当前场景中的状态。 */
        componentDidMount = mockMount;
        /** `MockComponent.componentWillUnmount`：记录测试夹具在当前场景中的状态。 */
        componentWillUnmount = mockUnmount;
        /** `MockComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <span />;
        }
      }

      expect(mockMount).toHaveBeenCalledTimes(0);
      expect(mockUnmount).toHaveBeenCalledTimes(0);

      await act(async () => {
        root.render(
          <div>
            <MockComponent key="A" />
          </div>,
        );
      });

      expect(mockMount).toHaveBeenCalledTimes(1);
      expect(mockUnmount).toHaveBeenCalledTimes(0);

      await act(async () => {
        root.render(
          <div>
            <MockComponent key="B" />
          </div>,
        );
      });

      expect(mockMount).toHaveBeenCalledTimes(2);
      expect(mockUnmount).toHaveBeenCalledTimes(1);
    });

    /** 测试场景：验证「should warn for duplicated array keys with component stack info」描述的渲染、交互或错误处理结果。 */
    it('should warn for duplicated array keys with component stack info', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      /** `WrapperComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class WrapperComponent extends React.Component {
        /** `WrapperComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <div>{this.props.children}</div>;
        }
      }

      /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Parent extends React.Component {
        /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return (
            <div>
              <WrapperComponent>{this.props.children}</WrapperComponent>
            </div>
          );
        }
      }
      await act(async () => {
        root.render(<Parent>{[<div key="1" />]}</Parent>);
      });

      await act(async () => {
        root.render(<Parent>{[<div key="1" />, <div key="1" />]}</Parent>);
      });
      assertConsoleErrorDev([
        'Encountered two children with the same key, `1`. ' +
          'Keys should be unique so that components maintain their identity ' +
          'across updates. Non-unique keys may cause children to be ' +
          'duplicated and/or omitted — the behavior is unsupported and ' +
          'could change in a future version.\n' +
          '    in div (at **)',
      ]);
    });

    /** 测试场景：验证「should warn for duplicated iterable keys with component stack info」描述的渲染、交互或错误处理结果。 */
    it('should warn for duplicated iterable keys with component stack info', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      /** `WrapperComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class WrapperComponent extends React.Component {
        /** `WrapperComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <div>{this.props.children}</div>;
        }
      }

      /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Parent extends React.Component {
        /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return (
            <div>
              <WrapperComponent>{this.props.children}</WrapperComponent>
            </div>
          );
        }
      }

      /** `createIterable`：封装当前用例复用的操作、回调或断言步骤。 */
      function createIterable(array) {
        return {
          /** `createIterable.@@iterator`：封装当前用例复用的操作、回调或断言步骤。 */
          '@@iterator': function () {
            let i = 0;
            return {
              /** `@@iterator.next`：实现测试夹具的生命周期、渲染或交互步骤。 */
              next() {
                const next = {
                  value: i < array.length ? array[i] : undefined,
                  done: i === array.length,
                };
                i++;
                return next;
              },
            };
          },
        };
      }
      await act(async () => {
        root.render(<Parent>{createIterable([<div key="1" />])}</Parent>);
      });

      await act(async () => {
        root.render(
          <Parent>{createIterable([<div key="1" />, <div key="1" />])}</Parent>,
        );
      });
      assertConsoleErrorDev([
        'Encountered two children with the same key, `1`. ' +
          'Keys should be unique so that components maintain their identity ' +
          'across updates. Non-unique keys may cause children to be ' +
          'duplicated and/or omitted — the behavior is unsupported and ' +
          'could change in a future version.\n' +
          '    in div (at **)',
      ]);
    });
  });

  /** 测试场景：验证「should warn for using maps as children with owner info」描述的渲染、交互或错误处理结果。 */
  it('should warn for using maps as children with owner info', async () => {
    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            {
              new Map([
                ['foo', 0],
                ['bar', 1],
              ])
            }
          </div>
        );
      }
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<Parent />);
    });
    assertConsoleErrorDev([
      'Using Maps as children is not supported. ' +
        'Use an array of keyed ReactElements instead.\n' +
        '    in div (at **)\n' +
        '    in Parent (at **)',
    ]);
  });

  /** 测试场景：验证「should NOT warn for using generator functions as components」描述的渲染、交互或错误处理结果。 */
  it('should NOT warn for using generator functions as components', async () => {
    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function* Foo() {
      yield <h1 key="1">Hello</h1>;
      yield <h1 key="2">World</h1>;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<Foo />);
    });

    expect(container.textContent).toBe('HelloWorld');
  });

  /** 测试场景：验证「should warn for using generators as children props」描述的渲染、交互或错误处理结果。 */
  it('should warn for using generators as children props', async () => {
    /** `getChildren`：封装当前用例复用的操作、回调或断言步骤。 */
    function* getChildren() {
      yield <h1 key="1">Hello</h1>;
      yield <h1 key="2">World</h1>;
    }

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      const children = getChildren();
      return <div>{children}</div>;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<Foo />);
    });
    assertConsoleErrorDev([
      'Using Iterators as children is unsupported and will likely yield ' +
        'unexpected results because enumerating a generator mutates it. ' +
        'You may convert it to an array with `Array.from()` or the ' +
        '`[...spread]` operator before rendering. You can also use an ' +
        'Iterable that can iterate multiple times over the same items.\n' +
        '    in div (at **)\n' +
        '    in Foo (at **)',
    ]);

    expect(container.textContent).toBe('HelloWorld');

    // 测试去重
    await act(async () => {
      root.render(<Foo />);
    });
  });

  /** 测试场景：验证「should warn for using other types of iterators as children」描述的渲染、交互或错误处理结果。 */
  it('should warn for using other types of iterators as children', async () => {
    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      let i = 0;
      const iterator = {
        /** `Symbol.iterator`：实现测试夹具的生命周期、渲染或交互步骤。 */
        [Symbol.iterator]() {
          return iterator;
        },
        /** `Foo.next`：实现测试夹具的生命周期、渲染或交互步骤。 */
        next() {
          switch (i++) {
            case 0:
              return {done: false, value: <h1 key="1">Hello</h1>};
            case 1:
              return {done: false, value: <h1 key="2">World</h1>};
            default:
              return {done: true, value: undefined};
          }
        },
      };
      return iterator;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<Foo />);
    });
    assertConsoleErrorDev([
      'Using Iterators as children is unsupported and will likely yield ' +
        'unexpected results because enumerating a generator mutates it. ' +
        'You may convert it to an array with `Array.from()` or the ' +
        '`[...spread]` operator before rendering. You can also use an ' +
        'Iterable that can iterate multiple times over the same items.\n' +
        '    in Foo (at **)',
    ]);

    expect(container.textContent).toBe('HelloWorld');

    // 测试去重
    await act(async () => {
      root.render(<Foo />);
    });
  });

  /** 测试场景：验证「should not warn for using generators in legacy iterables」描述的渲染、交互或错误处理结果。 */
  it('should not warn for using generators in legacy iterables', async () => {
    const fooIterable = {
      /** `@@iterator`：封装当前用例复用的操作、回调或断言步骤。 */
      '@@iterator': function* () {
        yield <h1 key="1">Hello</h1>;
        yield <h1 key="2">World</h1>;
      },
    };

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return fooIterable;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<Foo />);
    });
    expect(container.textContent).toBe('HelloWorld');

    await act(async () => {
      root.render(<Foo />);
    });
    expect(container.textContent).toBe('HelloWorld');
  });

  /** 测试场景：验证「should not warn for using generators in modern iterables」描述的渲染、交互或错误处理结果。 */
  it('should not warn for using generators in modern iterables', async () => {
    const fooIterable = {
      /** `Symbol.iterator`：封装当前用例复用的操作、回调或断言步骤。 */
      [Symbol.iterator]: function* () {
        yield <h1 key="1">Hello</h1>;
        yield <h1 key="2">World</h1>;
      },
    };

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return fooIterable;
    }

    const div = document.createElement('div');
    const root = ReactDOMClient.createRoot(div);
    await act(async () => {
      root.render(<Foo />);
    });
    expect(div.textContent).toBe('HelloWorld');

    await act(async () => {
      root.render(<Foo />);
    });
    expect(div.textContent).toBe('HelloWorld');
  });

  /** 测试场景：验证「should reorder bailed-out children」描述的渲染、交互或错误处理结果。 */
  it('should reorder bailed-out children', async () => {
    /** `LetterInner`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class LetterInner extends React.Component {
      /** `LetterInner.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.props.char}</div>;
      }
    }

    /** `Letter`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Letter extends React.Component {
      /** `Letter.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <LetterInner char={this.props.char} />;
      }
      /** `Letter.shouldComponentUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      shouldComponentUpdate() {
        return false;
      }
    }

    /** `Letters`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Letters extends React.Component {
      /** `Letters.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        const letters = this.props.letters.split('');
        return (
          <div>
            {letters.map(c => (
              <Letter key={c} char={c} />
            ))}
          </div>
        );
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    // 生成两个随机字符串 -- 包含一些附加内容。 一些移除操作。 一些移动操作
    await act(async () => {
      root.render(<Letters letters="XKwHomsNjIkBcQWFbiZU" />);
    });
    expect(container.textContent).toBe('XKwHomsNjIkBcQWFbiZU');
    await act(async () => {
      root.render(<Letters letters="EHCjpdTUuiybDvhRJwZt" />);
    });
    expect(container.textContent).toBe('EHCjpdTUuiybDvhRJwZt');
  });

  /** 测试场景：验证「prepares new children before unmounting old」描述的渲染、交互或错误处理结果。 */
  it('prepares new children before unmounting old', async () => {
    const log = [];

    /** `Spy`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Spy extends React.Component {
      /** `Spy.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push(this.props.name + ' componentWillMount');
      }
      /** `Spy.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        log.push(this.props.name + ' render');
        return <div />;
      }
      /** `Spy.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push(this.props.name + ' componentDidMount');
      }
      /** `Spy.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        log.push(this.props.name + ' componentWillUnmount');
      }
    }

    // 它们是参考不等式的,所以即使它们有相匹配的密钥,它们也会被交换.
    /** `SpyA`：封装当前用例复用的操作、回调或断言步骤。 */
    const SpyA = props => <Spy {...props} />;
    /** `SpyB`：封装当前用例复用的操作、回调或断言步骤。 */
    const SpyB = props => <Spy {...props} />;

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(
        <div>
          <SpyA key="one" name="oneA" />
          <SpyA key="two" name="twoA" />
        </div>,
      );
    });
    await act(async () => {
      root.render(
        <div>
          <SpyB key="one" name="oneB" />
          <SpyB key="two" name="twoB" />
        </div>,
      );
    });

    expect(log).toEqual([
      'oneA componentWillMount',
      'oneA render',
      'twoA componentWillMount',
      'twoA render',
      'oneA componentDidMount',
      'twoA componentDidMount',

      'oneB componentWillMount',
      'oneB render',
      'twoB componentWillMount',
      'twoB render',
      'oneA componentWillUnmount',
      'twoA componentWillUnmount',

      'oneB componentDidMount',
      'twoB componentDidMount',
    ]);
  });
});
