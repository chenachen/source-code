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

    /** 同一类型 MockComponent 在同一位置连续渲染两次；只挂载一次并更新一次、未卸载，验证子 Fiber 可复用。 */
    it('should update children when possible', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      const mockMount = jest.fn();
      const mockUpdate = jest.fn();
      const mockUnmount = jest.fn();

      /** 用生命周期 mock 观察同位置同类型子组件的复用。 */
      class MockComponent extends React.Component {

        /** 记录首次挂载，供与后续更新次数比较。 */
        componentDidMount = mockMount;

        /** 记录被复用实例的更新，而非新的挂载。 */
        componentDidUpdate = mockUpdate;

        /** 记录实例删除，确保同类型更新不触发卸载。 */
        componentWillUnmount = mockUnmount;

        /** 输出 div，保持主机结果稳定以聚焦组件身份。 */
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

    /** MockComponent 被同位置 span 替换，虽然最终都输出 div，原组件仍卸载；验证组件类型变化决定身份。 */
    it('should replace children with different constructors', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      const mockMount = jest.fn();
      const mockUnmount = jest.fn();

      /** 在类型替换场景中记录原组件的挂载和卸载。 */
      class MockComponent extends React.Component {

        /** 记录 MockComponent 的初次挂载。 */
        componentDidMount = mockMount;

        /** 记录类型变化引起的旧组件卸载。 */
        componentWillUnmount = mockUnmount;

        /** 输出 div，使测试证明主机输出相似也不等于组件类型相同。 */
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

    /** Wrapper 从自己创建 MockComponent 改为接收外部创建的同类型 child；key 和位置不变时保留实例，验证元素 owner 变化不构成替换条件。 */
    it('should NOT replace children with different owners', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      const mockMount = jest.fn();
      const mockUnmount = jest.fn();

      /** 记录 owner 变化场景中的组件实例生命周期。 */
      class MockComponent extends React.Component {

        /** 记录首次挂载，确认 owner 改变没有创建第二实例。 */
        componentDidMount = mockMount;

        /** 记录卸载，确认稳定 type/key/位置允许复用。 */
        componentWillUnmount = mockUnmount;

        /** 输出 div，将实例判据限定为生命周期。 */
        render() {
          return <span />;
        }
      }

      /** 既能自己创建 child，也能接收外部 child 的包装组件。 */
      class WrapperComponent extends React.Component {

        /** 有 props.children 时透传，否则创建 MockComponent；两路径改变元素 owner，保留同类型同位置。 */
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

    /** MockComponent 的 key 从 A 改成 B；旧实例卸载、新实例挂载，验证 key 参与子节点身份。 */
    it('should replace children with different keys', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      const mockMount = jest.fn();
      const mockUnmount = jest.fn();

      /** 用挂载与卸载计数验证不同 key 的组件身份。 */
      class MockComponent extends React.Component {

        /** 记录每个新 key 的实例挂载。 */
        componentDidMount = mockMount;

        /** 记录旧 key 的实例删除。 */
        componentWillUnmount = mockUnmount;

        /** 输出相同 div，排除主机输出差异对身份测试的影响。 */
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

    /** Parent 首次传一个 key=1 的 child，更新为两个同 key child；开发构建报告重复 key，并包含实际 div/Wrapper/Parent 栈。 */
    it('should warn for duplicated array keys with component stack info', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      /** 把数组 children 放在 div 中，让协调器检查重复 key。 */
      class WrapperComponent extends React.Component {

        /** 直接返回包含传入 children 的 div。 */
        render() {
          return <div>{this.props.children}</div>;
        }
      }

      /** 为重复数组 key 警告提供外层组件栈。 */
      class Parent extends React.Component {

        /** 通过 WrapperComponent 传递 children，保留警告的父组件路径。 */
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

    /** 用每次可创建新 iterator 的自定义 iterable 提供 child，更新后两元素 key 重复；开发警告与数组情形一致，验证 iterable 也检查唯一 key。 */
    it('should warn for duplicated iterable keys with component stack info', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      /** 把 iterable children 放入 div，覆盖迭代子节点的 key 校验。 */
      class WrapperComponent extends React.Component {

        /** 透传 iterable children 到主机父节点，不自行枚举或修改 key。 */
        render() {
          return <div>{this.props.children}</div>;
        }
      }

      /** 给 iterable 重复 key 场景提供外层创建栈。 */
      class Parent extends React.Component {

        /** 把 props.children 传给 WrapperComponent。 */
        render() {
          return (
            <div>
              <WrapperComponent>{this.props.children}</WrapperComponent>
            </div>
          );
        }
      }

      /** 把数组包装为可反复遍历对象，每次 @@iterator 调用从索引零开始。 */
      function createIterable(array) {
        return {

          /** 创建独立 iterator，保证 React 多轮读取不会共享耗尽索引。 */
          '@@iterator': function () {
            let i = 0;
            return {

              /** 按索引返回数组项，首次到数组长度时报告 done；正常消费者在该 done 后停止调用。 */
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

  /** Parent 返回 Map 的 foo/bar entries；开发构建提示不支持 Map child 并给出 Parent 栈，验证不把 entry 自动当键值 React children。 */
  it('should warn for using maps as children with owner info', async () => {

    /** 输出 Map 的类组件，触发不支持 Map children 的开发提示。 */
    class Parent extends React.Component {

      /** 创建 foo/bar Map entries，不把 entry 手动转为 React 元素数组。 */
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

  /** 生成器组件 Foo 本身依次 yield 两个带 key 的 h1；DOM 合成 HelloWorld 且不报生成器 child 警告，覆盖组件返回迭代结果的专门路径。 */
  it('should NOT warn for using generator functions as components', async () => {

    /** 生成器组件逐次 yield 带 key 的 h1，供协调器处理组件返回的迭代结果。 */
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

  /** Foo 将 getChildren() 生成器实例作为 div child；开发构建警告可变单次迭代器，仍输出 HelloWorld，第二轮新实例不重复警告。 */
  it('should warn for using generators as children props', async () => {

    /** 创建单次生成器实例，作为 div 的 child 与生成器组件路径区分。 */
    function* getChildren() {
      yield <h1 key="1">Hello</h1>;
      yield <h1 key="2">World</h1>;
    }

    /** 在 div 中传入 getChildren() 实例，观察开发警告及再次渲染时去重。 */
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

  /** Foo 返回 Symbol.iterator 返回自身、next 递增索引的单次迭代器；开发构建警告且正常输出两 h1，再渲染验证警告去重。 */
  it('should warn for using other types of iterators as children', async () => {

    /** 构造 iterator 返回自身的单次 iterable，模拟耗尽不可重启的子节点来源。 */
    function Foo() {
      let i = 0;
      const iterator = {

        /** 返回同一 iterator，显式暴露单次消费性质。 */
        [Symbol.iterator]() {
          return iterator;
        },

        /** 用递增索引先给两个 h1，再在后续调用中返回 done。 */
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

  /** 使用 @@iterator 每次创建新生成器的 iterable，连续渲染均为 HelloWorld；验证可重复遍历对象不触发单次生成器警告。 */
  it('should not warn for using generators in legacy iterables', async () => {
    const fooIterable = {

      /** 每次 @@iterator 调用生成新的遍历状态，区别单次 generator 对象。 */
      '@@iterator': function* () {
        yield <h1 key="1">Hello</h1>;
        yield <h1 key="2">World</h1>;
      },
    };

    /** 返回具有传统 @@iterator 入口的可重复遍历对象。 */
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

  /** 使用 Symbol.iterator 每次创建新生成器的 iterable，连续渲染均为 HelloWorld；覆盖现代迭代入口的重复遍历。 */
  it('should not warn for using generators in modern iterables', async () => {
    const fooIterable = {

      /** 每次 Symbol.iterator 调用生成新的遍历状态。 */
      [Symbol.iterator]: function* () {
        yield <h1 key="1">Hello</h1>;
        yield <h1 key="2">World</h1>;
      },
    };

    /** 返回现代 Symbol.iterator iterable，验证多轮渲染不耗尽对象本身。 */
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

  /** 将两组预选字母字符串逐项作为 key 渲染，Letter 禁止组件更新；更新后文本仍精确匹配第二组，验证保留项移动及新旧项增删无需重跑被复用组件。 */
  it('should reorder bailed-out children', async () => {

    /** 将单个字母输出到 div，供通过 key 移动保留主机节点。 */
    class LetterInner extends React.Component {

      /** 输出当前字符，便于父容器 textContent 校验最终次序。 */
      render() {
        return <div>{this.props.char}</div>;
      }
    }

    /** 禁止被复用实例更新的字母组件，让重排必须依赖协调移动。 */
    class Letter extends React.Component {

      /** 把字母传给 LetterInner，建立可复用的主机子树。 */
      render() {
        return <LetterInner char={this.props.char} />;
      }

      /** 始终返回 false，保留既有子树但允许父协调器移动其位置。 */
      shouldComponentUpdate() {
        return false;
      }
    }

    /** 把字符串映射为逐字母有 key 的 children 列表。 */
    class Letters extends React.Component {

      /** 以字符作为 key 创建 Letter，使两字符串可同时覆盖移动、插入和删除。 */
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

  /** 同 key 的 SpyA 全部替换成 SpyB，记录新 render 前置生命周期、旧卸载与新 didMount；验证新树准备在删除提交前完成，并区分 render 阶段与 DOM 提交顺序。 */
  it('prepares new children before unmounting old', async () => {
    const log = [];

    /** 记录新组件准备与旧实例删除的阶段，用名字区分替换双方。 */
    class Spy extends React.Component {

      /** 记录 render 阶段的挂载前生命周期，尚未表示 DOM 已提交。 */
      UNSAFE_componentWillMount() {
        log.push(this.props.name + ' componentWillMount');
      }

      /** 记录新子树准备并返回 div，供与旧卸载先后比较。 */
      render() {
        log.push(this.props.name + ' render');
        return <div />;
      }

      /** 记录布局提交中的新实例挂载完成。 */
      componentDidMount() {
        log.push(this.props.name + ' componentDidMount');
      }

      /** 记录提交删除过程中的旧实例卸载。 */
      componentWillUnmount() {
        log.push(this.props.name + ' componentWillUnmount');
      }
    }

    // SpyA 与 SpyB 是不同的组件类型；即使 key 相同，切换类型也会卸载旧子树并挂载新子树。

    /** 用独立函数类型包装 Spy，作为被替换的旧子类型。 */
    const SpyA = props => <Spy {...props} />;

    /** 用另一个函数类型包装 Spy，即使 key 相同也要求替换实例。 */
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
