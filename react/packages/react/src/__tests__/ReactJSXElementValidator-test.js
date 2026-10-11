/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

// TODO：在 JSX 配合 Flow 时，这些动态警告最终应升级为静态错误。
let act;
let React;
let ReactDOMClient;
let assertConsoleErrorDev;

describe('ReactJSXElementValidator', () => {
  let Component;
  let RequiredPropComponent;

  // 每例重置模块并重取 React/runtime/act，隔离 key/特殊 prop 诊断的模块级去重。
  beforeEach(() => {
    jest.resetModules();

    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
    React = require('react');
    ReactDOMClient = require('react-dom/client');

    /** 共享测试类每例重新定义，避免类型身份和告警去重状态跨用例复用。 */
    Component = class extends React.Component {
      /** 透传 props.children 到 div，成为动态列表 key 检查的直接宿主父级。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    };

    /** 共享测试类每例重新定义，避免类型身份和告警去重状态跨用例复用。 */
    RequiredPropComponent = class extends React.Component {
      /** 输出 props.prop 的 span；此共享 RequiredPropComponent 当前没有被测试主体使用。 */
      render() {
        return <span>{this.props.prop}</span>;
      }
    };
    RequiredPropComponent.displayName = 'RequiredPropComponent';
  });

  /** 无 key Component JSX 数组放在 children 位置，act 挂载后要求 Component 列表诊断，验证动态 children 的 key 检查。 */
  it('warns for keys for arrays of elements in children position', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<Component>{[<Component />, <Component />]}</Component>);
    });
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.\n\n' +
        'Check the render method of `Component`. See https://react.dev/link/warning-keys for more information.\n' +
        '    in Component (at **)',
    ]);
  });

  /** Wrapper 创建无 key 数组经 Inner.childSet 转交 Component，挂载诊断包含校验父级和 Wrapper 创建来源，验证跨组件 owner 保留。 */
  it('warns for keys for arrays of elements with owner info', async () => {
    /** 把 Wrapper 创建的 childSet 转交共享 Component，分开创建者与校验父级。 */
    class InnerComponent extends React.Component {
      /** 将 props.childSet 原样作为 Component children，保留原 element owner。 */
      render() {
        return <Component>{this.props.childSet}</Component>;
      }
    }

    /** 自身 render 创建两无 key Component，以 childSet 转交 Inner，供 owner 来源断言。 */
    class ComponentWrapper extends React.Component {
      /** 创建两叶数组作为 Inner.childSet，供诊断指出 Wrapper 创建者。 */
      render() {
        return <InnerComponent childSet={[<Component />, <Component />]} />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<ComponentWrapper />);
    });
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.' +
        '\n\nCheck the render method of `Component`. ' +
        'It was passed a child from ComponentWrapper. See https://react.dev/link/warning-keys for more information.\n' +
        '    in ComponentWrapper (at **)',
    ]);
  });

  /** 可重复 iterator 产出两无 key Component，挂载后要求列表 key 和传入来源诊断，验证 iterable 动态叶校验。 */
  it('warns for keys for iterables of elements in rest args', async () => {
    const iterable = {
      /** 创建无 key JSX 子元素的迭代器入口，用于触发列表 key 诊断。 */
      '@@iterator': function () {
        let i = 0;
        return {
          /** 逐个返回无 key JSX 元素，并在两个元素后进入 done 终态。 */
          next: function () {
            const done = ++i > 2;
            return {value: done ? undefined : <Component />, done: done};
          },
        };
      },
    };

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<Component>{iterable}</Component>);
    });
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.\n\n' +
        'Check the render method of `Component`. It was passed a child from div. ' +
        'See https://react.dev/link/warning-keys for more information.\n' +
        '    in Component (at **)',
    ]);
  });

  /** children 数组元素 key=#1/#2，act 挂载完成且无预期诊断，验证合法数组 key。 */
  it('does not warn for arrays of elements with keys', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(
        <Component>
          {[<Component key="#1" />, <Component key="#2" />]}
        </Component>,
      );
    });
  });

  /** 可重复 iterator 产出两 keyed Component，act 挂载完成且无预期诊断，验证合法 iterable key。 */
  it('does not warn for iterable elements with keys', async () => {
    const iterable = {
      /** 创建带 key JSX 子元素的迭代器入口，用于验证合法 iterable 不产生警告。 */
      '@@iterator': function () {
        let i = 0;
        return {
          /** 逐个返回带稳定 key 的 JSX 元素，并在两个元素后进入 done 终态。 */
          next: function () {
            const done = ++i > 2;
            return {
              value: done ? undefined : <Component key={'#' + i} />,
              done: done,
            };
          },
        };
      },
    };

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<Component>{iterable}</Component>);
    });
  });

  /** Map 风格 entries 与 iterator 指向同一函数，条目是数值加无 key 元素；本例只创建 JSX element 不挂载，验证工厂不遍历，不证明 renderer 支持 Map children。 */
  it('does not warn for numeric keys in entry iterable as a child', async () => {
    const iterable = {
      /** 构造 Map 风格的 entry 迭代器；这里只创建元素，验证工厂不提前遍历它。 */
      '@@iterator': function () {
        let i = 0;
        return {
          /** 逐个返回 `[数值 key, 元素]` entry，并在两个 entry 后结束。 */
          next: function () {
            const done = ++i > 2;
            return {value: done ? undefined : [i, <Component />], done: done};
          },
        };
      },
    };
    iterable.entries = iterable['@@iterator'];

    // 这里只创建元素，没有进入 renderer；渲染时才遍历并报告 Map 风格 children 不受支持。
    <Component>{iterable}</Component>;
  });

  /** 两无 key Component 直接静态并列为 children，act 挂载完成且无预期诊断，验证静态 JSX 子节点不要求动态列表 key。 */
  it('does not warn when the element is directly as children', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <Component>
          <Component />
          <Component />
        </Component>,
      );
    });
  });

  /** children 为两个普通对象的数组，仅创建 JSX element；验证创建期跳过非 element key 校验，并未证明对象可渲染。 */
  it('does not warn when the child array contains non-elements', () => {
    void (<Component>{[{}, {}]}</Component>);
  });

  /** ParentComp 渲染返回一项无 key div 数组的 MyComp；挂载诊断包含外层上下文、内层创建来源及 owner 栈，验证嵌套数组提示。 */
  it('should give context for errors in nested components.', async () => {
    /** 返回一项无 key div 数组的类，构造嵌套 key 告警。 */
    class MyComp extends React.Component {
      /** 返回动态一项 div 数组，供列表校验观察缺 key。 */
      render() {
        return [<div />];
      }
    }
    /** MyComp 的创建者，供诊断同时显示外层 owner 与内层数组来源。 */
    class ParentComp extends React.Component {
      /** 创建 MyComp element 并返回，形成嵌套 owner 链。 */
      render() {
        return <MyComp />;
      }
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<ParentComp />);
    });
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.' +
        '\n\nCheck the render method of `ParentComp`. It was passed a child from MyComp. ' +
        'See https://react.dev/link/warning-keys for more information.\n' +
        '    in div (at **)\n' +
        '    in MyComp (at **)\n' +
        '    in ParentComp (at **)',
    ]);
  });

  /** Foo 渲染 a=1 的 Fragment，诊断列出合法 props 并按 Fragment ref 门控决定是否含 ref，验证非法属性文案。 */
  it('warns for fragments with illegal attributes', async () => {
    /** 输出非法 Fragment 属性的类，检查合法 props 文案。 */
    class Foo extends React.Component {
      /** 创建 a=1 的 Fragment 和 hello 文本，触发 Fragment 属性校验。 */
      render() {
        return <React.Fragment a={1}>hello</React.Fragment>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Foo />);
    });
    assertConsoleErrorDev([
      gate('enableFragmentRefs')
        ? 'Invalid prop `a` supplied to `React.Fragment`. React.Fragment ' +
          'can only have `key`, `ref`, and `children` props.\n' +
          '    in Foo (at **)'
        : 'Invalid prop `a` supplied to `React.Fragment`. React.Fragment ' +
          'can only have `key` and `children` props.\n' +
          '    in Foo (at **)',
    ]);
  });

  /** Foo 给 Fragment callback ref，开启 refs 时诊断列表为空、关闭时要求非法 ref 文案，验证实验开关对接受属性的影响；不额外断言 ref 值。 */
  it('warns for fragments with refs', async () => {
    /** 给 Fragment 安装 callback ref 的类，检查实验开关下的接受/告警差异。 */
    class Foo extends React.Component {
      /** 创建 Fragment ref 回调把实例写入 this.foo；本例只检查诊断，不读取该字段。 */
      render() {
        return (
          <React.Fragment
            ref={bar => {
              this.foo = bar;
            }}>
            hello
          </React.Fragment>
        );
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Foo />);
    });
    assertConsoleErrorDev(
      gate('enableFragmentRefs')
        ? []
        : [
            'Invalid prop `ref` supplied to `React.Fragment`.' +
              ' React.Fragment can only have `key` and `children` props.\n' +
              '    in Foo (at **)',
          ],
    );
  });

  /** Fragment 中两个静态无 key span，act 挂载完成且无预期告警，验证 Fragment 静态 children 规则。 */
  it('does not warn for fragments of multiple elements without keys', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <>
          <span>1</span>
          <span>2</span>
        </>,
      );
    });
  });

  /** Fragment 内三 span 的 key=a/a/b，挂载要求重复 a 的身份诊断，验证静态列表仍检查显式 key 冲突。 */
  it('warns for fragments of multiple elements with same key', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <>
          <span key="a">1</span>
          <span key="a">2</span>
          <span key="b">3</span>
        </>,
      );
    });
    assertConsoleErrorDev([
      'Encountered two children with the same key, `a`. ' +
        'Keys should be unique so that components maintain their identity across updates. ' +
        'Non-unique keys may cause children to be duplicated and/or omitted — ' +
        'the behavior is unsupported and could change in a future version.\n' +
        '    in span (at **)',
    ]);
  });

  /** lazy ctor 会设置 didCall，创建 Lazy JSX 后仍 false；验证 JSX 工厂不提前加载，then 占位方法本例不会执行。 */
  it('does not call lazy initializers eagerly', () => {
    let didCall = false;
    const Lazy = React.lazy(() => {
      didCall = true;
      return {
        /** 占位 thenable；本例只创建 lazy element，不应执行 ctor 或订阅。 */
        then() {}
      };
    });
    <Lazy />;
    expect(didCall).toBe(false);
  });
});
