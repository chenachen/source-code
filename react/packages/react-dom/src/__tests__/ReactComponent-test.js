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
let ReactDOMServer;
let act;
let assertConsoleErrorDev;

describe('ReactComponent', () => {
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
  });

  // @gate !disableLegacyMode
  /** legacy render 接收 NodeList 或 null 容器，均在挂载前拒绝为无效容器；验证容器校验不会将集合当单个 DOM 节点。 */
  it('should throw on invalid render targets in legacy roots', () => {
    const container = document.createElement('div');
    // 数组或 jQuery 一类的集合不是 DOM 容器；即使其中包含有效节点，也会被拒绝。
    expect(function () {
      ReactDOM.render(<div />, [container]);
    }).toThrowError(/Target container is not a DOM element./);

    expect(function () {
      ReactDOM.render(<div />, null);
    }).toThrowError(/Target container is not a DOM element./);
  });

  /** Wrapper 在 render 中改写已创建元素的 children 数组；开发构建应因冻结而抛 TypeError，生产分支只验证该改写可执行。 */
  it('should throw (in dev) when children are mutated during render', async () => {
    /** 故意在 render 改写 props.children 的函数组件，触发开发元素冻结约束。 */
    function Wrapper(props) {
      props.children[1] = <p key={1} />; // 开发环境冻结了此 children 数组，赋值会抛错。
      return <div>{props.children}</div>;
    }
    if (__DEV__) {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await expect(
        act(() => {
          root.render(
            <Wrapper>
              <span key={0} />
              <span key={1} />
              <span key={2} />
            </Wrapper>,
          );
        }),
      ).rejects.toThrowError(/Cannot assign to read only property.*/);
    } else {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          <Wrapper>
            <span key={0} />
            <span key={1} />
            <span key={2} />
          </Wrapper>,
        );
      });
    }
  });

  /** Wrapper 在 didMount 改写 children 后 forceUpdate；开发构建拒绝改写冻结数组，生产分支允许后续重渲染。 */
  it('should throw (in dev) when children are mutated during update', async () => {
    /** 把 children 改写延迟到挂载生命周期的 fixture，区分创建时冻结与生命周期执行。 */
    class Wrapper extends React.Component {
      /** 挂载后改写第二个 child 并 forceUpdate；开发分支会在改写处失败。 */
      componentDidMount() {
        this.props.children[1] = <p key={1} />; // 开发环境冻结了此 children 数组，赋值会抛错。
        this.forceUpdate();
      }

      /** 用 p 包装传入的 children，保留待改写数组引用。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    if (__DEV__) {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await expect(
        act(() => {
          root.render(
            <Wrapper>
              <span key={0} />
              <span key={1} />
              <span key={2} />
            </Wrapper>,
          );
        }),
      ).rejects.toThrowError(/Cannot assign to read only property.*/);
    } else {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          <Wrapper>
            <span key={0} />
            <span key={1} />
            <span key={2} />
          </Wrapper>,
        );
      });
    }
  });

  /** Parent 创建带字符串 ref 的 children，但 Child 不返回这些 children；Parent 挂载后 refs.test 仍为空，验证未进入输出树的元素不会赋 ref。 */
  it('should not have string refs on unmounted components', async () => {
    /** 创建最终被 Child 丢弃的带 ref 子元素，检查未挂载元素不进入父 refs。 */
    class Parent extends React.Component {
      /** 向 Child 传带字符串 ref 的 div；此元素只被创建，未进入 Child 输出。 */
      render() {
        return (
          <Child>
            <div ref="test" />
          </Child>
        );
      }

      /** 挂载后检查 refs.test 未赋值，观察未使用 children 的 ref 边界。 */
      componentDidMount() {
        expect(this.refs && this.refs.test).toEqual(undefined);
      }
    }

    /** 忽略传入 children 的类组件，制造创建但不挂载的元素。 */
    class Child extends React.Component {
      /** 只返回独立 div，使 Parent 提供的 children 不参与协调。 */
      render() {
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent child={<span />} />);
    });
  });

  /** 外层 Component 的回调 ref 接到 Wrapper 和其 div；在 Component.didMount 读取两个对象均已正确赋值，验证子树 ref 先于父布局生命周期。 */
  it('should support callback-style refs', async () => {
    const innerObj = {};
    const outerObj = {};

    /** 提供可由 ref 读取的方法，并把传入回调 ref 安装到内部主机节点。 */
    class Wrapper extends React.Component {
      /** 返回 Wrapper 所属对象，供父 didMount 验证组件 ref 已绑定。 */
      getObject = () => {
        return this.props.object;
      };

      /** 把 object 引用之外的 DOM ref 回调传给内部 div。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    let mounted = false;

    /** 同时保存组件与 DOM 回调 ref 的父 fixture。 */
    class Component extends React.Component {
      /** 渲染 Wrapper 并用两个回调分别写入 outer/inner 引用。 */
      render() {
        const inner = (
          <Wrapper object={innerObj} ref={c => (this.innerRef = c)} />
        );
        const outer = (
          <Wrapper object={outerObj} ref={c => (this.outerRef = c)}>
            {inner}
          </Wrapper>
        );
        return outer;
      }

      /** 在父布局生命周期读取两个已绑定 ref，验证子 ref 与布局顺序。 */
      componentDidMount() {
        expect(this.innerRef.getObject()).toEqual(innerObj);
        expect(this.outerRef.getObject()).toEqual(outerObj);
        mounted = true;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component />);
    });

    expect(mounted).toBe(true);
  });

  /** 用 createRef 保存 Wrapper 与其 div，父 didMount 读取 current 并验证方法和类名；覆盖对象 ref 的挂载赋值时机。 */
  it('should support object-style refs', async () => {
    const innerObj = {};
    const outerObj = {};

    /** 对象 ref 场景中的 Wrapper，暴露实例方法并转交 DOM ref。 */
    class Wrapper extends React.Component {
      /** 返回本 Wrapper 持有对象，验证 outerRef.current 的实例身份。 */
      getObject = () => {
        return this.props.object;
      };

      /** 在 div 上安装从父接收的对象 ref。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    let mounted = false;

    /** 在构造器创建两个稳定对象 ref，分别观察类实例与 DOM 节点。 */
    class Component extends React.Component {
      /** 调用父构造器并建立 innerRef/outerRef，令两引用跨 render 稳定。 */
      constructor() {
        super();
        this.innerRef = React.createRef();
        this.outerRef = React.createRef();
      }
      /** 将 outerRef 给 Wrapper，把 innerRef 作为内部 div 的 ref 输入。 */
      render() {
        const inner = <Wrapper object={innerObj} ref={this.innerRef} />;
        const outer = (
          <Wrapper object={outerObj} ref={this.outerRef}>
            {inner}
          </Wrapper>
        );
        return outer;
      }

      /** 读取两个 current 的方法/类名，确认父 didMount 前已赋值。 */
      componentDidMount() {
        expect(this.innerRef.current.getObject()).toEqual(innerObj);
        expect(this.outerRef.current.getObject()).toEqual(outerObj);
        mounted = true;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component />);
    });

    expect(mounted).toBe(true);
  });

  /** Component.getInner 由 Wrapper.render 调用并创建 div，回调闭包仍归 Component；挂载后同时读取 Wrapper 方法与内部 div，验证创建元素的调用层级不改变 ref 接收者。 */
  it('should support new-style refs with mixed-up owners', async () => {
    /** 调用父提供的 getContent 的 Wrapper，用于改变元素创建的调用链。 */
    class Wrapper extends React.Component {
      /** 返回固定标题，供外部组件 ref 验证 Wrapper 实例。 */
      getTitle = () => {
        return this.props.title;
      };

      /** 在自己的 render 中执行 getContent，并返回生成的内部元素。 */
      render() {
        return this.props.getContent();
      }
    }

    let mounted = false;

    /** 把内容生成函数传给 Wrapper，同时在自己的闭包里收集内外 ref。 */
    class Component extends React.Component {
      /** 创建 inner div 并把回调 ref 写回 Component，而非正在调用的 Wrapper。 */
      getInner = () => {
        // Wrapper 调用 getContent 期间创建 div；callback ref 的闭包仍把节点写到外层 Component 实例。
        return <div className="inner" ref={c => (this.innerRef = c)} />;
      };

      /** 连接 Wrapper 实例 ref 与 getInner，保持创建者闭包可见。 */
      render() {
        return (
          <Wrapper
            title="wrapper"
            ref={c => (this.wrapperRef = c)}
            getContent={this.getInner}
          />
        );
      }

      /** 检查 Wrapper 方法及 inner div，确认两种 ref 均写到 Component。 */
      componentDidMount() {
        // 检查 props.title 确保我们得到了正确的元素。
        expect(this.wrapperRef.getTitle()).toBe('wrapper');
        expect(this.innerRef.className).toBe('inner');
        mounted = true;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<Component />);
    });

    expect(mounted).toBe(true);
  });

  /** 两个 Inner 与 Outer 依次挂载、重渲染和卸载；记录 render、生命周期及每轮新回调 ref 的解绑/绑定，验证子布局与父布局及删除遍历的具体先后。 */
  it('should call refs at the correct time', async () => {
    const log = [];

    /** 记录每个子实例的 render、布局与卸载，形成有名字的时序日志。 */
    class Inner extends React.Component {
      /** 记录当前子名的 render，并输出 span。 */
      render() {
        log.push(`inner ${this.props.id} render`);
        return <div />;
      }

      /** 记录子组件挂载布局时机，供与 ref 绑定及父布局比较。 */
      componentDidMount() {
        log.push(`inner ${this.props.id} componentDidMount`);
      }

      /** 记录子组件更新布局时机，供与旧/新回调 ref 比较。 */
      componentDidUpdate() {
        log.push(`inner ${this.props.id} componentDidUpdate`);
      }

      /** 记录删除遍历进入当前子实例的时机。 */
      componentWillUnmount() {
        log.push(`inner ${this.props.id} componentWillUnmount`);
      }
    }

    /** 同时渲染两个有名 Inner，并为每次 render 创建新的回调 ref。 */
    class Outer extends React.Component {
      /** 记录子 ref 的实例或 null；回调身份每次变化，因此更新时会解绑旧 ref 再绑定新 ref。 */
      render() {
        return (
          <div>
            <Inner
              id={1}
              ref={c => {
                log.push(`ref 1 got ${c ? `instance ${c.props.id}` : 'null'}`);
              }}
            />
            <Inner
              id={2}
              ref={c => {
                log.push(`ref 2 got ${c ? `instance ${c.props.id}` : 'null'}`);
              }}
            />
          </div>
        );
      }

      /** 记录父挂载布局，位于两个子布局与 ref 完成之后。 */
      componentDidMount() {
        log.push('outer componentDidMount');
      }

      /** 记录父更新布局，供与两子更新及回调 ref 比较。 */
      componentDidUpdate() {
        log.push('outer componentDidUpdate');
      }

      /** 记录父卸载开始，随后删除遍历才进入各子 ref 和子生命周期。 */
      componentWillUnmount() {
        log.push('outer componentWillUnmount');
      }
    }

    // 依次挂载、从根更新同一组件树、卸载，检查 render、ref 和生命周期日志的顺序。
    const el = document.createElement('div');
    log.push('start mount');
    const root = ReactDOMClient.createRoot(el);
    await act(() => {
      root.render(<Outer />);
    });
    log.push('start update');
    await act(() => {
      root.render(<Outer />);
    });
    log.push('start unmount');
    await act(() => {
      root.unmount();
    });

    expect(log).toEqual([
      'start mount',
      'inner 1 render',
      'inner 2 render',
      'inner 1 componentDidMount',
      'ref 1 got instance 1',
      'inner 2 componentDidMount',
      'ref 2 got instance 2',
      'outer componentDidMount',
      'start update',
      // 先完成 render，再在提交阶段清空旧 callback ref；新的 ref 随子组件布局生命周期重新绑定。
      'inner 1 render',
      'inner 2 render',
      'ref 1 got null',
      'ref 2 got null',
      'inner 1 componentDidUpdate',
      'ref 1 got instance 1',
      'inner 2 componentDidUpdate',
      'ref 2 got instance 2',
      'outer componentDidUpdate',
      'start unmount',
      'outer componentWillUnmount',
      'ref 1 got null',
      'inner 1 componentWillUnmount',
      'ref 2 got null',
      'inner 2 componentWillUnmount',
    ]);
  });

  // @gate !disableLegacyMode
  /** legacy render 连续挂载 div、更新 div 类名、替换为 span；各完成回调依次记录 1/2/3，验证更新和替换都会调用回调。 */
  it('fires the callback after a component is rendered in legacy roots', () => {
    const callback = jest.fn();
    const container = document.createElement('div');
    ReactDOM.render(<div />, container, callback);
    expect(callback).toHaveBeenCalledTimes(1);
    ReactDOM.render(<div className="foo" />, container, callback);
    expect(callback).toHaveBeenCalledTimes(2);
    ReactDOM.render(<span />, container, callback);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  /** 把 undefined、null、boolean 当组件类型传给根；开发构建提示实际无效类型，undefined 另带导出提示，生产构建保留简化错误。 */
  it('throws usefully when rendering badly-typed elements', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    const X = undefined;
    const XElement = <X />;
    await expect(async () => {
      await act(() => {
        root.render(XElement);
      });
    }).rejects.toThrowError(
      'Element type is invalid: expected a string (for built-in components) ' +
        'or a class/function (for composite components) but got: undefined.' +
        (__DEV__
          ? " You likely forgot to export your component from the file it's " +
            'defined in, or you might have mixed up default and named imports.'
          : ''),
    );

    const Y = null;
    const YElement = <Y />;
    await expect(async () => {
      await act(() => {
        root.render(YElement);
      });
    }).rejects.toThrowError(
      'Element type is invalid: expected a string (for built-in components) ' +
        'or a class/function (for composite components) but got: null.',
    );

    const Z = true;
    const ZElement = <Z />;
    await expect(async () => {
      await act(() => {
        root.render(ZElement);
      });
    }).rejects.toThrowError(
      'Element type is invalid: expected a string (for built-in components) ' +
        'or a class/function (for composite components) but got: boolean.',
    );
  });

  /** Bar 创建类型为 undefined 的元素，经 Indirection 透传给 div；开发错误仍指向创建者 Bar，验证 owner 来源不会被传递者覆盖。 */
  it('includes owner name in the error about badly-typed elements', async () => {
    const X = undefined;

    /** 仅把传入 child 放进 div，不改变错误元素最初的 owner。 */
    function Indirection(props) {
      return <div>{props.children}</div>;
    }

    /** 创建无效 X 元素，再经 Indirection 传递，作为错误创建栈来源。 */
    function Bar() {
      return (
        <Indirection>
          <X />
        </Indirection>
      );
    }

    /** 返回 Bar，增加调用层级以检验错误仍定位元素创建者。 */
    function Foo() {
      return <Bar />;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(async () => {
      await act(() => {
        root.render(<Foo />);
      });
    }).rejects.toThrowError(
      'Element type is invalid: expected a string (for built-in components) ' +
        'or a class/function (for composite components) but got: undefined.' +
        (__DEV__
          ? " You likely forgot to export your component from the file it's " +
            'defined in, or you might have mixed up default and named imports.' +
            '\n\nCheck the render method of `Bar`.'
          : ''),
    );
  });

  /** 把含 x/y/z 的普通对象放进 children 数组，客户端根渲染拒绝并列出对象键；验证对象不能冒充可渲染 child。 */
  it('throws if a plain object is used as a child', async () => {
    const children = {
      x: <span />,
      y: <span />,
      z: <span />,
    };
    const element = <div>{[children]}</div>;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(element);
      }),
    ).rejects.toThrowError(
      'Objects are not valid as a React child (found: object with keys {x, y, z}). ' +
        'If you meant to render a collection of children, use an array instead.',
    );
  });

  /** 构造带旧 react.element 符号的元素对象，根渲染应报告旧版 React 元素不受支持；与普通对象的诊断区分。 */
  it('throws if a legacy element is used as a child', async () => {
    const inlinedElement = {
      $$typeof: Symbol.for('react.element'),
      type: 'div',
      key: null,
      ref: null,
      props: {},
      _owner: null,
    };
    const element = <div>{[inlinedElement]}</div>;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(element);
      }),
    ).rejects.toThrowError(
      'A React Element from an older version of React was rendered. ' +
        'This is not supported. It can happen if:\n' +
        '- Multiple copies of the "react" package is used.\n' +
        '- A library pre-bundled an old copy of "react" or "react/jsx-runtime".\n' +
        '- A compiler tries to "inline" JSX instead of using the runtime.',
    );
  });

  /** Foo 返回含 a/b/c 普通对象的 children 数组；客户端渲染拒绝该对象并在开发构建给出 Foo 的创建栈。 */
  it('throws if a plain object even if it is in an owner', async () => {
    /** 输出包含普通对象的类 fixture，让客户端校验嵌套 render 结果。 */
    class Foo extends React.Component {
      /** 把 a/b/c 对象作为数组 child 返回，触发无效对象诊断。 */
      render() {
        const children = {
          a: <span />,
          b: <span />,
          c: <span />,
        };
        return <div>{[children]}</div>;
      }
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(<Foo />);
      }),
    ).rejects.toThrowError(
      'Objects are not valid as a React child (found: object with keys {a, b, c}).' +
        ' If you meant to render a collection of children, use an array ' +
        'instead.',
    );
  });

  /** 服务端 renderToString 接到包含 x/y/z 对象的 div，同步抛对象 child 错误；验证服务端也执行 child 类型校验。 */
  it('throws if a plain object is used as a child when using SSR', async () => {
    const children = {
      x: <span />,
      y: <span />,
      z: <span />,
    };
    const element = <div>{[children]}</div>;
    expect(() => {
      ReactDOMServer.renderToString(element);
    }).toThrowError(
      'Objects are not valid as a React child (found: object with keys {x, y, z}). ' +
        'If you meant to render a collection of children, use ' +
        'an array instead.',
    );
  });

  /** 服务端渲染 Foo，其输出数组含 a/b/c 对象；同步抛相同对象 child 错误，验证嵌套组件输出的校验。 */
  it('throws if a plain object even if it is in an owner when using SSR', async () => {
    /** 输出无效对象的服务端 fixture，复用客户端对象 child 的语义。 */
    class Foo extends React.Component {
      /** 返回含 a/b/c 对象的数组 child，使 renderToString 同步拒绝。 */
      render() {
        const children = {
          a: <span />,
          b: <span />,
          c: <span />,
        };
        return <div>{[children]}</div>;
      }
    }
    const container = document.createElement('div');
    expect(() => {
      ReactDOMServer.renderToString(<Foo />, container);
    }).toThrowError(
      'Objects are not valid as a React child (found: object with keys {a, b, c}). ' +
        'If you meant to render a collection of children, use ' +
        'an array instead.',
    );
  });

  describe('with new features', () => {
    /** 函数组件 Foo 直接返回函数 Foo 自身，开发构建报告函数不能作为 child；验证返回函数不会自动调用为组件。 */
    it('warns on function as a return value from a function', async () => {
      /** 故意返回函数自身，验证 React 不将函数 child 自动当组件执行。 */
      function Foo() {
        return Foo;
      }
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Foo />);
      });
      assertConsoleErrorDev([
        'Functions are not valid as a React child. This may happen if ' +
          'you return Foo instead of <Foo /> from render. ' +
          'Or maybe you meant to call this function rather than return it.\n' +
          '  <Foo>{Foo}</Foo>\n' +
          '    in Foo (at **)',
      ]);
    });

    /** 类组件 Foo.render 返回类 Foo 本身，开发构建报告函数 child；覆盖类构造函数误作输出的情况。 */
    it('warns on function as a return value from a class', async () => {
      /** 故意把类构造函数作为 render 输出的 fixture。 */
      class Foo extends React.Component {
        /** 返回 Foo 构造函数而非元素，触发函数 child 警告。 */
        render() {
          return Foo;
        }
      }
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<Foo />);
      });
      assertConsoleErrorDev([
        'Functions are not valid as a React child. This may happen if ' +
          'you return Foo instead of <Foo /> from render. ' +
          'Or maybe you meant to call this function rather than return it.\n' +
          '  <Foo>{Foo}</Foo>\n' +
          '    in Foo (at **)',
      ]);
    });

    /** Foo 将函数自身嵌在 span 中，开发提示指向 span 的 child；验证主机父节点的错误上下文。 */
    it('warns on function as a child to host component', async () => {
      /** 把函数自身放进 span，令警告上下文是实际主机父节点。 */
      function Foo() {
        return (
          <div>
            <span>{Foo}</span>
          </div>
        );
      }
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Foo />);
      });
      assertConsoleErrorDev([
        'Functions are not valid as a React child. This may happen if ' +
          'you return Foo instead of <Foo /> from render. ' +
          'Or maybe you meant to call this function rather than return it.\n' +
          '  <span>{Foo}</span>\n' +
          '    in span (at **)\n' +
          '    in Foo (at **)',
      ]);
    });

    /** Bar 显式调用 children 函数，函数返回 Hello；最终 DOM 为 Hello 且无函数 child 警告，验证 render prop 应由组件调用。 */
    it('does not warn for function-as-a-child that gets resolved', async () => {
      /** 显式执行传入 children 函数，把 render prop 转换为可渲染结果。 */
      function Bar(props) {
        return props.children();
      }
      /** 提供返回 Hello 的 children 函数，验证经调用后能渲染。 */
      function Foo() {
        return <Bar>{() => 'Hello'}</Bar>;
      }
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Foo />);
      });

      expect(container.innerHTML).toBe('Hello');
    });

    /** PureComponent 在 div/span 中各重复放两个 Foo 函数；开发构建各报一次，setState 后不再重复，验证警告按父类型 div/span 去重而非按每个无效 child 计数。 */
    it('deduplicates function type warnings based on component type', async () => {
      /** 重复输出无效函数 child 的 PureComponent，用不同主机父类型观察警告去重。 */
      class Foo extends React.PureComponent {
        /** 初始化可更新状态，允许随后 setState 再跑相同无效 child。 */
        constructor() {
          super();
          this.state = {type: 'mushrooms'};
        }
        /** 在 div 与 span 各输出两次 Foo 函数；警告缓存按父类型分别记一次。 */
        render() {
          return (
            <div>
              {Foo}
              {Foo}
              <span>
                {Foo}
                {Foo}
              </span>
            </div>
          );
        }
      }
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      let component;
      await act(() => {
        root.render(<Foo ref={current => (component = current)} />);
      });
      assertConsoleErrorDev([
        'Functions are not valid as a React child. This may happen if ' +
          'you return Foo instead of <Foo /> from render. ' +
          'Or maybe you meant to call this function rather than return it.\n' +
          '  <div>{Foo}</div>\n' +
          '    in div (at **)\n' +
          '    in Foo (at **)',
        'Functions are not valid as a React child. This may happen if ' +
          'you return Foo instead of <Foo /> from render. ' +
          'Or maybe you meant to call this function rather than return it.\n' +
          '  <span>{Foo}</span>\n' +
          '    in span (at **)\n' +
          '    in Foo (at **)',
      ]);
      await act(() => {
        component.setState({type: 'portobello mushrooms'});
      });
    });
  });
});
