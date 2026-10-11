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
let ReactDOMClient;
let act;
let assertConsoleErrorDev;

// TODO：此模块历史上用于确认 JSX 转换输出；但 JSX 通常由 Babel 或 TypeScript 完成，
// 转换器本身并非 React runtime 的组成部分，因此这里实质是 Babel 转换集成测试。
// 可考虑删除，并优先在 ReactCreateElement-test 与 ReactJSXRuntime-test 中直接验证 runtime；
// 在迁移完成前，这些模块之间会保留部分重复覆盖。
describe('ReactJSXTransformIntegration', () => {
  let Component;

  // 每例重置模块并重取 React/runtime/act，隔离 key/特殊 prop 诊断的模块级去重。
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));

    /** 共享测试类每例重新定义，避免类型身份和告警去重状态跨用例复用。 */
    Component = class extends React.Component {
      /** 共享类返回空 div，供 element type、ref 实例及类 defaultProps 的转换集成断言。 */
      render() {
        return <div />;
      }
    };
  });

  /** 定义 JSX App 后读函数源码，DEV 包含 jsxDEV、生产包含 jsx，均不含 React.createElement；验证当前测试转换环境确实使用自动 JSX runtime。 */
  it('sanity check: test environment is configured to compile JSX to the jsx() runtime', async () => {
    /** 最小 JSX 函数，仅将 toString 暴露转换后的 jsxDEV/jsx 调用；本例不挂载。 */
    function App() {
      return <div />;
    }
    const source = App.toString();
    if (__DEV__) {
      expect(source).toContain('jsxDEV(');
    } else {
      expect(source).toContain('jsx(');
    }
    expect(source).not.toContain('React.createElement');
  });

  /** 创建 Component JSX，断言 type 是原类、key/ref 为 null、props 空对象，验证基本 element 字段。 */
  it('returns a complete element according to spec', () => {
    const element = <Component />;
    expect(element.type).toBe(Component);
    expect(element.key).toBe(null);
    expect(element.ref).toBe(null);
    const expectation = {};
    Object.freeze(expectation);
    expect(element.props).toEqual(expectation);
  });

  /** 小写 div JSX 断言 type=div、key/ref null、props 空，验证宿主标签转换。 */
  it('allows a lower-case to be passed as the string type', () => {
    const element = <div />;
    expect(element.type).toBe('div');
    expect(element.key).toBe(null);
    expect(element.ref).toBe(null);
    const expectation = {};
    Object.freeze(expectation);
    expect(element.props).toEqual(expectation);
  });

  /** 变量 TagName=div 作为 JSX 标签，输出 type 仍字符串 div 且空 props，验证表达式 type 传递。 */
  it('allows a string to be passed as the type', () => {
    const TagName = 'div';
    const element = <TagName />;
    expect(element.type).toBe('div');
    expect(element.key).toBe(null);
    expect(element.ref).toBe(null);
    const expectation = {};
    Object.freeze(expectation);
    expect(element.props).toEqual(expectation);
  });

  /** 创建 Component element 后修改 type；DEV 抛错、生产不抛错，验证 element 外壳冻结的构建边界。 */
  it('returns an immutable element', () => {
    const element = <Component />;
    if (__DEV__) {
      expect(() => (element.type = 'div')).toThrow();
    } else {
      expect(() => (element.type = 'div')).not.toThrow();
    }
  });

  /** JSX spread config.foo=1 后改原对象为 2，element.props.foo 仍 1，验证转换器形成独立 props 输入；此例不能归因为 runtime 总会复制 config。 */
  it('does not reuse the object that is spread into props', () => {
    const config = {foo: 1};
    const element = <Component {...config} />;
    expect(element.props.foo).toBe(1);
    config.foo = 2;
    expect(element.props.foo).toBe(1);
  });

  /** JSX key=12/foo=56，element.key 为字符串且 props 只含 foo，验证 key 与普通 props 分离。 */
  it('extracts key from the rest of the props', () => {
    const element = <Component key="12" foo="56" />;
    expect(element.type).toBe(Component);
    expect(element.key).toBe('12');
    const expectation = {foo: '56'};
    Object.freeze(expectation);
    expect(element.props).toEqual(expectation);
  });

  /** JSX ref 与 foo 输入，element.props 包含同一 ref；读旧 element.ref 要求 React19 弃用诊断，验证 ref 已是普通 prop。 */
  it('does not extract ref from the rest of the props', () => {
    const ref = React.createRef();
    const element = <Component ref={ref} foo="56" />;
    expect(element.type).toBe(Component);
    expect(element.ref).toBe(ref);
    assertConsoleErrorDev([
      'Accessing element.ref was removed in React 19. ref is now a ' +
        'regular prop. It will be removed from the JSX Element ' +
        'type in a future release.',
    ]);
    const expectation = {foo: '56', ref};
    Object.freeze(expectation);
    expect(element.props).toEqual(expectation);
  });

  /** 数值 JSX key=12 转为字符串 12，ref null且 props 保留 foo，验证 key 字符串化。 */
  it('coerces the key to a string', () => {
    const element = <Component key={12} foo="56" />;
    expect(element.type).toBe(Component);
    expect(element.key).toBe('12');
    expect(element.ref).toBe(null);
    const expectation = {foo: '56'};
    Object.freeze(expectation);
    expect(element.props).toEqual(expectation);
  });

  /** 显式 children=text 又带 JSX child=1，结果 children=1，验证嵌套 JSX child 优先。 */
  it('merges JSX children onto the children prop', () => {
    const a = 1;
    const element = <Component children="text">{a}</Component>;
    expect(element.props.children).toBe(a);
  });

  /** 只有 children=text 属性且无嵌套 child，结果仍 text，验证省略子节点不覆盖。 */
  it('does not override children if no JSX children are provided', () => {
    const element = <Component children="text" />;
    expect(element.props.children).toBe('text');
  });

  /** children=text 加显式 null 子节点，结果为 null，验证空子节点仍覆盖属性。 */
  it('overrides children if null is provided as a JSX child', () => {
    const element = <Component children="text">{null}</Component>;
    expect(element.props.children).toBe(null);
  });

  /** children=text 加显式 undefined 子节点以及 cloneElement 的 undefined 实参，两输出均 undefined，验证提供实参和省略实参有别。 */
  it('overrides children if undefined is provided as an argument', () => {
    const element = <Component children="text">{undefined}</Component>;
    expect(element.props.children).toBe(undefined);

    const element2 = React.cloneElement(
      <Component children="text" />,
      {},
      undefined,
    );
    expect(element2.props.children).toBe(undefined);
  });

  /** 三 JSX 子节点 1/2/3 生成 children 数组并保持顺序，验证多静态子节点形状。 */
  it('merges JSX children onto the children prop in an array', () => {
    const a = 1;
    const b = 2;
    const c = 3;
    const element = (
      <Component>
        {a}
        {b}
        {c}
      </Component>
    );
    expect(element.props.children).toEqual([1, 2, 3]);
  });

  /** 普通类 type 有静态方法，创建 JSX 后通过 element.type 调用返回固定字符串；没有挂载该类，验证构造器身份。 */
  it('allows static methods to be called using the type property', () => {
    /** 普通类仅作为 JSX type 保留静态方法身份，本例不由 renderer 挂载。 */
    class StaticMethodComponent {
      /** 返回固定 someReturnValue，供 element.type 上的静态方法调用断言。 */
      static someStaticMethod() {
        return 'someReturnValue';
      }
      /** 返回 div；本例只创建 element 并调用静态方法，不执行此 render。 */
      render() {
        return <div />;
      }
    }

    const element = <StaticMethodComponent />;
    expect(element.type.someStaticMethod()).toBe('someReturnValue');
  });

  /** 宿主/组件 element 被 isValidElement 接受，null/boolean/普通对象/string/组件类型/缺品牌形状被拒绝，验证品牌判定而非仅 type/props 字段。 */
  it('identifies valid elements', () => {
    expect(React.isValidElement(<div />)).toEqual(true);
    expect(React.isValidElement(<Component />)).toEqual(true);

    expect(React.isValidElement(null)).toEqual(false);
    expect(React.isValidElement(true)).toEqual(false);
    expect(React.isValidElement({})).toEqual(false);
    expect(React.isValidElement('string')).toEqual(false);
    expect(React.isValidElement(Component)).toEqual(false);
    expect(React.isValidElement({type: 'div', props: {}})).toEqual(false);
  });

  /** div JSX 的 constructor 与普通对象相同，验证普通对象外壳，不说明所有属性枚举规则。 */
  it('is indistinguishable from a plain object', () => {
    const element = <div className="foo" />;
    const object = {};
    expect(element.constructor).toBe(object.constructor);
  });

  /** 共享类默认 fruit=persimmon，先 mango 后省略并通过 ref 读 props，值恢复默认；验证自动 JSX 转换接入类默认值。 */
  it('should use default prop value when removing a prop', async () => {
    Component.defaultProps = {fruit: 'persimmon'};

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let instance;
    await act(() => {
      root.render(<Component fruit="mango" ref={ref => (instance = ref)} />);
    });
    expect(instance.props.fruit).toBe('mango');

    await act(() => {
      root.render(<Component ref={ref => (instance = ref)} />);
    });
    expect(instance.props.fruit).toBe('persimmon');
  });

  /** 独立 class 默认 prop=testKey，两个 root 省略与显式 null 时实例分别读默认值/null，验证默认值不覆盖 null。 */
  it('should normalize props with default values', async () => {
    /** 默认 prop 类，通过 ref 暴露 props，检查省略值与显式 null 的差别。 */
    class NormalizingComponent extends React.Component {
      /** 输出 props.prop 的 span，使两个独立 root 的挂载/ref 检查完成。 */
      render() {
        return <span>{this.props.prop}</span>;
      }
    }
    NormalizingComponent.defaultProps = {prop: 'testKey'};

    let container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);
    let instance;
    await act(() => {
      root.render(
        <NormalizingComponent ref={current => (instance = current)} />,
      );
    });

    expect(instance.props.prop).toBe('testKey');

    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    let inst2;
    await act(() => {
      root.render(
        <NormalizingComponent prop={null} ref={current => (inst2 = current)} />,
      );
    });

    expect(inst2.props.prop).toBe(null);
  });
});
