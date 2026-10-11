/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

// 注意：本文件原则上直接验证不经过 JSX 的经典 `React.createElement` 路径。
// TODO：该说明已部分过时，因为文件内仍有 JSX 用例；应将其迁为 `React.createElement`，
// 并确认 JSX runtime 测试中存在对应覆盖。

let React;
let ReactDOMClient;
let act;
let assertConsoleErrorDev;

describe('ReactElementValidator', () => {
  let ComponentClass;

  // 每例重置模块并重新定义共享类，隔离 key 告警按类型去重与 owner 调试状态。
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
    /** 共享透传类，每例重新定义；其 render 成为动态 children 的直接父级，供 key 告警归属检查。 */
    ComponentClass = class extends React.Component {
      /** 透传 this.props.children 给宿主 div，使共享类可以作为动态列表校验的直接渲染父级。 */
      render() {
        return React.createElement('div', null, this.props.children);
      }
    };
  });

  /** createElement 的 children 参数传入两个无 key ComponentClass 数组，act 挂载后要求列表 key 诊断归属 ComponentClass，验证动态数组校验。 */
  it('warns for keys for arrays of elements in rest args', async () => {
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() =>
      root.render(
        React.createElement(ComponentClass, null, [
          React.createElement(ComponentClass),
          React.createElement(ComponentClass),
        ]),
      ),
    );
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.\n\n' +
        'Check the render method of `ComponentClass`. See https://react.dev/link/warning-keys for more information.\n' +
        '    in ComponentClass (at **)',
    ]);
  });

  /** Wrapper 创建无 key 数组经 childSet 交给 Inner，再传入 ComponentClass；挂载诊断既指出校验 render 又保留创建者 Wrapper，验证跨组件 owner 来源。 */
  it('warns for keys for arrays of elements with owner info', async () => {
    /** 接收 Wrapper 创建的 childSet 再交给共享 ComponentClass，形成创建者和校验父级不同的路径。 */
    class InnerClass extends React.Component {
      /** 把 props.childSet 作为 ComponentClass children，保留原 element 的创建 owner。 */
      render() {
        return React.createElement(ComponentClass, null, this.props.childSet);
      }
    }

    /** 在自身 render 创建无 key 子数组，再作为 childSet prop 交给 InnerClass，供 owner 来源诊断。 */
    class ComponentWrapper extends React.Component {
      /** 创建两无 key ComponentClass 并经 childSet 传递，使诊断能保留 Wrapper 创建者。 */
      render() {
        return React.createElement(InnerClass, {
          childSet: [
            React.createElement(ComponentClass),
            React.createElement(ComponentClass),
          ],
        });
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => root.render(React.createElement(ComponentWrapper)));
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.' +
        '\n\nCheck the render method of `ComponentClass`. ' +
        'It was passed a child from ComponentWrapper. ' +
        'See https://react.dev/link/warning-keys for more information.\n' +
        '    in ComponentWrapper (at **)',
    ]);
  });

  /** 组件函数 name 人为设 undefined，外部创建无 key div 数组再挂载；诊断退回顶层 div 且栈从 div 开始，验证匿名 owner 缺失时的提示。 */
  it('warns for keys for arrays with no owner or parent info', async () => {
    /** 把 children 包在 div；随后 name 被清空，供诊断在无函数名时退回宿主上下文。 */
    function Anonymous({children}) {
      return <div>{children}</div>;
    }
    Object.defineProperty(Anonymous, 'name', {value: undefined});

    const divs = [<div />, <div />];

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => root.render(<Anonymous>{divs}</Anonymous>));
    assertConsoleErrorDev([
      // owner stack 校验的直接父节点是 div，因此诊断栈应从该层开始。
      'Each child in a list should have a unique ' +
        '"key" prop.' +
        '\n\nCheck the top-level render call using <div>. ' +
        'See https://react.dev/link/warning-keys for more information.\n' +
        '    in div (at **)',
    ]);
  });

  /** 组件外创建无 key div 数组，放在顶层 div 后挂载；诊断用顶层 render 的 div 作上下文，验证没有 owner 的列表告警。 */
  it('warns for keys for arrays of elements with no owner info', async () => {
    const divs = [<div />, <div />];

    const root = ReactDOMClient.createRoot(document.createElement('div'));

    await act(() => root.render(<div>{divs}</div>));
    assertConsoleErrorDev([
      'Each child in a list should have a unique ' +
        '"key" prop.' +
        '\n\nCheck the top-level render call using <div>. ' +
        'See https://react.dev/link/warning-keys for more information.\n' +
        '    in div (at **)',
    ]);
  });

  /** GrandParent 创建 Component 元素，Parent 克隆透传，Component render 返回无 key div 数组；诊断包含 div/Component/GrandParent 而不加入克隆器 Parent，验证创建者栈。 */
  it('warns for keys with component stack info', async () => {
    /** render 返回两无 key div 的数组，作为实际列表告警来源。 */
    function Component() {
      return <div>{[<div />, <div />]}</div>;
    }

    /** 克隆 props.child 后直接返回；克隆保留 element owner，使诊断不把此透传器混入创建者栈。 */
    function Parent(props) {
      return React.cloneElement(props.child);
    }

    /** 创建 Component element 并通过 Parent 转交，供克隆保留 owner 的诊断栈断言。 */
    function GrandParent() {
      return <Parent child={<Component />} />;
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => root.render(<GrandParent />));
    assertConsoleErrorDev([
      'Each child in a list should have a unique ' +
        '"key" prop.\n\nCheck the render method of `Component`. See ' +
        'https://react.dev/link/warning-keys for more information.\n' +
        '    in div (at **)\n' +
        '    in Component (at **)\n' +
        '    in GrandParent (at **)',
    ]);
  });

  /** Wrapper 接收两个静态 span 并与 footer 并列透传，act 挂载完成且无预期 key 诊断，验证静态 children 转交不误当未标记动态列表。 */
  it('does not warn for keys when passing children down', async () => {
    /** 把 props.children 与静态 footer 并列输出，验证已标记的静态子节点透传不新增 key 告警。 */
    function Wrapper(props) {
      return (
        <div>
          {props.children}
          <footer />
        </div>
      );
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() =>
      root.render(
        <Wrapper>
          <span />
          <span />
        </Wrapper>,
      ),
    );
  });

  /** 可重复 iterator 产出两个无 key ComponentClass，作为 createElement children 挂载；要求 ComponentClass 列表告警及传入来源，验证 iterable 的动态叶检查。 */
  it('warns for keys for iterables of elements in rest args', async () => {
    const iterable = {
      /** 创建无 key 子元素的迭代器入口，用于触发经典元素校验器的列表诊断。 */
      '@@iterator': function () {
        let i = 0;
        return {
          /** 逐个返回无 key 元素，并在两个元素后进入 done 终态。 */
          next: function () {
            const done = ++i > 2;
            return {
              value: done ? undefined : React.createElement(ComponentClass),
              done: done,
            };
          },
        };
      },
    };

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() =>
      root.render(React.createElement(ComponentClass, null, iterable)),
    );
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.\n\n' +
        'Check the render method of `ComponentClass`. It was passed a child from div. ' +
        'See https://react.dev/link/warning-keys for more information.\n' +
        '    in ComponentClass (at **)',
    ]);
  });

  /** 只创建 children 为 #1/#2 keyed 元素数组的 element，没有 renderer 挂载或输出断言；验证创建入口可接收合法显式 key，不能据此证明完整渲染行为。 */
  it('does not warns for arrays of elements with keys', () => {
    React.createElement(ComponentClass, null, [
      React.createElement(ComponentClass, {key: '#1'}),
      React.createElement(ComponentClass, {key: '#2'}),
    ]);
  });

  /** 只创建 children 为 keyed 两叶 iterable 的 element；iterator 每次重建，未执行 renderer 挂载，验证创建入口接受该形状。 */
  it('does not warns for iterable elements with keys', () => {
    const iterable = {
      /** 创建带 key 子元素的迭代器入口，用于验证合法 iterable 不产生警告。 */
      '@@iterator': function () {
        let i = 0;
        return {
          /** 逐个返回带稳定 key 的元素，并在两个元素后进入 done 终态。 */
          next: function () {
            const done = ++i > 2;
            return {
              value: done
                ? undefined
                : React.createElement(ComponentClass, {key: '#' + i}),
              done: done,
            };
          },
        };
      },
    };

    React.createElement(ComponentClass, null, iterable);
  });

  /** 把两个无 key element 分别作为 createElement 的静态 children 实参，仅执行创建；验证静态实参路径不要求动态列表 key。 */
  it('does not warn when the element is directly in rest args', () => {
    React.createElement(
      ComponentClass,
      null,
      React.createElement(ComponentClass),
      React.createElement(ComponentClass),
    );
  });

  /** 把两个普通对象作为 children 数组只执行 createElement；验证创建期列表 key 校验跳过非 element，并未证明这些对象可被 renderer 渲染。 */
  it('does not warn when the array contains a non-element', () => {
    React.createElement(ComponentClass, null, [{}, {}]);
  });

  /** ParentComp 渲染 MyComp，MyComp 返回一项无 key div 数组；挂载诊断包含 ParentComp 校验上下文、MyComp 创建来源及完整 owner 栈，验证嵌套数组提示。 */
  it('should give context for errors in nested components.', async () => {
    /** 返回一项无 key div 数组，形成嵌套函数组件的 key 诊断来源。 */
    function MyComp() {
      return [React.createElement('div')];
    }
    /** 返回 MyComp 元素，提供外层 owner 上下文以检查嵌套诊断。 */
    function ParentComp() {
      return React.createElement(MyComp);
    }
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => root.render(React.createElement(ParentComp)));
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.' +
        '\n\nCheck the render method of `ParentComp`. It was passed a child from MyComp. ' +
        'See https://react.dev/link/warning-keys for more information.\n' +
        '    in div (at **)\n' +
        '    in MyComp (at **)\n' +
        '    in ParentComp (at **)',
    ]);
  });

  /** 循环渲染 undefined/null/boolean、普通对象、element 字面量及伪品牌九种非法 type，onUncaughtError 收集消息；逐项比较 DEV 含导出/字面量建议、生产简短类型描述，验证 renderer 错误格式。cases 的第二列旧 createElement 文案未被循环读取。 */
  it('gives a helpful error when passing invalid types', async () => {
    /** 空函数仅作为 element 字面量的 type，用于非法 type=element 场景展示 Foo 名称；本例不调用它渲染。 */
    function Foo() {}
    const errors = [];
    const root = ReactDOMClient.createRoot(document.createElement('div'), {
      /** 把 renderer 报告的 error.message 按调用顺序存入 errors，供九种非法 type 的文案比较；不重新抛错。 */
      onUncaughtError(error) {
        errors.push(error.message);
      },
    });
    const cases = [
      [
        () => React.createElement(undefined),
        'React.createElement: type is invalid -- expected a string ' +
          '(for built-in components) or a class/function (for composite ' +
          'components) but got: undefined. You likely forgot to export your ' +
          "component from the file it's defined in, or you might have mixed up " +
          'default and named imports.',
      ],
      [
        () => React.createElement(null),
        'React.createElement: type is invalid -- expected a string ' +
          '(for built-in components) or a class/function (for composite ' +
          'components) but got: null.',
      ],
      [
        () => React.createElement(true),
        'React.createElement: type is invalid -- expected a string ' +
          '(for built-in components) or a class/function (for composite ' +
          'components) but got: boolean.',
      ],
      [
        () => React.createElement({x: 17}),
        'React.createElement: type is invalid -- expected a string ' +
          '(for built-in components) or a class/function (for composite ' +
          'components) but got: object.',
      ],
      [
        () => React.createElement({}),
        'React.createElement: type is invalid -- expected a string ' +
          '(for built-in components) or a class/function (for composite ' +
          'components) but got: object. You likely forgot to export your ' +
          "component from the file it's defined in, or you might have mixed up " +
          'default and named imports.',
      ],
      [
        () => React.createElement(React.createElement('div')),
        'React.createElement: type is invalid -- expected a string ' +
          '(for built-in components) or a class/function (for composite ' +
          'components) but got: <div />. Did you accidentally export a JSX literal ' +
          'instead of a component?',
      ],
      [
        () => React.createElement(React.createElement(Foo)),
        'React.createElement: type is invalid -- expected a string ' +
          '(for built-in components) or a class/function (for composite ' +
          'components) but got: <Foo />. Did you accidentally export a JSX literal ' +
          'instead of a component?',
      ],
      [
        () =>
          React.createElement(
            React.createElement(React.createContext().Consumer),
          ),
        'React.createElement: type is invalid -- expected a string ' +
          '(for built-in components) or a class/function (for composite ' +
          'components) but got: <Context.Consumer />. Did you accidentally ' +
          'export a JSX literal instead of a component?',
      ],
      [
        () => React.createElement({$$typeof: 'non-react-thing'}),
        'React.createElement: type is invalid -- expected a string ' +
          '(for built-in components) or a class/function (for composite ' +
          'components) but got: object.',
      ],
    ];
    for (let i = 0; i < cases.length; i++) {
      await act(async () => root.render(cases[i][0]()));
    }

    expect(errors).toEqual(
      __DEV__
        ? [
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: undefined. You likely forgot to export your ' +
              "component from the file it's defined in, or you might have mixed up " +
              'default and named imports.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: null.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: boolean.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: object.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: object. You likely forgot to export your ' +
              "component from the file it's defined in, or you might have mixed up " +
              'default and named imports.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: <div />. Did you accidentally export a JSX literal ' +
              'instead of a component?',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: <Foo />. Did you accidentally export a JSX literal ' +
              'instead of a component?',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: <Context.Consumer />. Did you accidentally ' +
              'export a JSX literal instead of a component?',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: object.',
          ]
        : [
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: undefined.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: null.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: boolean.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: object.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: object.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: object.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: object.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: object.',
            'Element type is invalid: expected a string ' +
              '(for built-in components) or a class/function (for composite ' +
              'components) but got: object.',
          ],
    );

    // 最后仅创建合法 div；这里没有再次渲染非法类型，也没有单独断言告警去重。
    React.createElement('div');
  });

  /** 本体仅覆盖 ParentComp 返回 type=null 的元素；act 拒绝的消息在 DEV 加 ParentComp render 来源，生产省略，验证 owner 提示而非标题列出的所有类型。 */
  it('includes the owner name when passing null, undefined, boolean, or number', async () => {
    /** 故意返回 type=null 的 element，供 renderer 错误附加当前创建者名称。 */
    function ParentComp() {
      return React.createElement(null);
    }

    await expect(async () => {
      const root = ReactDOMClient.createRoot(document.createElement('div'));
      await act(() => root.render(React.createElement(ParentComp)));
    }).rejects.toThrowError(
      'Element type is invalid: expected a string (for built-in components) ' +
        'or a class/function (for composite components) but got: null.' +
        (__DEV__ ? '\n\nCheck the render method of `ParentComp`.' : ''),
    );
  });

  /** Foo 用 createElement 构造 Fragment 且带 a=1；挂载告警列出合法 props，按 Fragment ref 开关包含/不包含 ref，验证非法属性校验和门控文案。 */
  it('warns for fragments with illegal attributes', async () => {
    /** 返回带非法 a 属性的 Fragment 的类，供合法 props 文案随 Fragment ref 开关变化。 */
    class Foo extends React.Component {
      /** 构造 Fragment({a:1},123)，在挂载路径触发 Fragment props 校验。 */
      render() {
        return React.createElement(React.Fragment, {a: 1}, '123');
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => root.render(React.createElement(Foo)));
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

  /** DOMContainer 接收真实 DOM 节点但 render 只输出空 div，didMount 手动 appendChild；act 完成且无预期 key 诊断，验证 props 传递和命令式插入，并未让 React 直接渲染 DOM 对象。 */
  it('does not warn when using DOM node as children', async () => {
    /** 把收到的 DOM 对象作为普通 prop 保留，提交后手动插入；不把该对象返回为 React children。 */
    class DOMContainer extends React.Component {
      /** 保存提交时的宿主 div，供 componentDidMount 命令式 appendChild。 */
      ref;
      /** 返回空 div，callback ref 保存节点到实例；实际 DOM children 在提交钩子另插入。 */
      render() {
        return <div ref={n => (this.ref = n)} />;
      }
      /** 将 props.children 中的 DOM 节点追加到已挂载 div；异常直接由提交错误通道处理，本例输入为真实节点。 */
      componentDidMount() {
        this.ref.appendChild(this.props.children);
      }
    }

    const node = document.createElement('div');
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      // DOM 节点仅作为组件 prop，提交钩子手动插入；不把它交给 React 子节点协调。
      root.render(<DOMContainer>{node}</DOMContainer>);
    });
  });

  /** Number.prototype 安装调用即抛错的 iterator 后仅创建含 5/12/13 的 JSX element，finally 删除扩展；创建完成，验证数字不被创建期逻辑错误枚举。 */
  it('should not enumerate enumerable numbers (#4776)', () => {
    /*eslint-disable no-extend-native */
    /** 若数字被误枚举就抛错；finally 清理原型扩展，供创建期数字叶检查。 */
    Number.prototype['@@iterator'] = function () {
      throw new Error('number iterator called');
    };
    /*eslint-enable no-extend-native */

    try {
      void (
        <div>
          {5}
          {12}
          {13}
        </div>
      );
    } finally {
      delete Number.prototype['@@iterator'];
    }
  });

  /** 手写 element 形状缺 _store，用它创建 div 的数组 children；只有创建无异常检查，验证开发校验面对内联形状不崩溃。 */
  it('does not blow up with inlined children', () => {
    // 不推荐这种会吞掉多类警告的做法，但校验器也不能因此崩溃。

    const child = {
      $$typeof: (<div />).$$typeof,
      type: 'span',
      key: null,
      ref: null,
      props: {},
      _owner: null,
    };

    void (<div>{[child]}</div>);
  });

  /** Foo=undefined 时创建带无 key div 数组的 JSX element；不挂载，验证创建期诊断路径处理未定义父类型不额外崩溃。 */
  it('does not blow up on key warning with undefined type', () => {
    const Foo = undefined;
    void (<Foo>{[<div />]}</Foo>);
  });

  /** lazy ctor 会设置 didCall，创建 Lazy element 后断言仍 false；验证 createElement 不启动 lazy 载入，返回 thenable 的订阅入口本例不应执行。 */
  it('does not call lazy initializers eagerly', () => {
    let didCall = false;
    const Lazy = React.lazy(() => {
      didCall = true;
      return {
        /** 占位 thenable 订阅入口；只创建 lazy element 的本例不应调用 ctor 或该方法。 */
        then() {}
      };
    });
    React.createElement(Lazy);
    expect(didCall).toBe(false);
  });

  /** 通过 spread 把 __self=Hello 与 __source=world 交给 JSX Child，act 挂载输出 Hello world!；验证自动 JSX runtime config 中同名字段是普通 props，区别于经典入口过滤。 */
  it('__self and __source are treated as normal props', async () => {
    // 本例经过自动 JSX runtime：它把调试 source/self 放在独立参数中，config 中的同名字段
    // 会作为普通 props 传给 Child；经典 createElement 仍过滤这两个字段。
    /** 将 config 中作为普通 props 的 __self/__source 相加返回文本，供自动 JSX runtime 字段透传断言。 */
    function Child({__self, __source}) {
      return __self + __source;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    // 注意：Babel 转换会把直接出现的这些 props 视为语法错误，但 runtime 本身没有该限制。
    // 这里用 spread 绕过转换期检查，证明运行时会按普通 props 处理。
    const props = {
      __self: 'Hello ',
      __source: 'world!',
    };
    await act(() => root.render(<Child {...props} />));
    expect(container.textContent).toBe('Hello world!');
  });
});
