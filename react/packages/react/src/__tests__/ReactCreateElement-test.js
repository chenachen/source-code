/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let act;

let React;
let ReactDOMClient;
let assertConsoleErrorDev;
let assertConsoleWarnDev;

// 注意：此模块验证旧版“经典”JSX runtime，即 `React.createElement`。
// 为避免 Babel 转换遮蔽被测入口，必须直接调用 `React.createElement`，不使用 JSX 语法。
describe('ReactCreateElement', () => {
  let ComponentClass;

  // 每例隔离元素创建模块的key/旧转换器告警去重状态，并准备可挂载的class类型。
  beforeEach(() => {
    jest.resetModules();

    ({
      act,
      assertConsoleErrorDev,
      assertConsoleWarnDev,
    } = require('internal-test-utils'));

    React = require('react');
    ReactDOMClient = require('react-dom/client');
    /** 共享最小 class type 每例重新定义，只渲染 div，供经典 element 创建、defaultProps 与实例 ref 检查。 */
    ComponentClass = class extends React.Component {
      /** 输出最小 div，为元素type/defaultProps测试提供可挂载class类型，不额外读取本例props。 */
      render() {
        return React.createElement('div');
      }
    };
  });

  /** 不传 config 创建 class element；type 保留构造器、key/ref 为 null、props 为空，开发构建冻结 element 与 props；验证描述对象的基本字段与开发只读契约。 */
  it('returns a complete element according to spec', () => {
    const element = React.createElement(ComponentClass);
    expect(element.type).toBe(ComponentClass);
    expect(element.key).toBe(null);
    expect(element.ref).toBe(null);
    if (__DEV__) {
      expect(Object.isFrozen(element)).toBe(true);
      expect(Object.isFrozen(element.props)).toBe(true);
    }
    expect(element.props).toEqual({});
  });

  /** 父组件创建三个带 key 的 Child，Child 在 render 读取 props.key；挂载应报特殊属性告警，验证协调 key 没有作为普通 prop 传入子组件。 */
  it('should warn when `key` is being accessed on composite element', async () => {
    /** 主动读取特殊 key prop 的夹具，使开发 getter 诊断发生在子组件render中。 */
    class Child extends React.Component {
      /** 读取 props.key 并作为div内容，触发特殊属性诊断而非直接读取element.key。 */
      render() {
        return React.createElement('div', null, this.props.key);
      }
    }
    /** 一次创建三个带不同key的Child，检查特殊prop诊断在同类读取中是否去重。 */
    class Parent extends React.Component {
      /** 以经典createElement生成带key的三个子元素，保留被测API而不借助JSX转换。 */
      render() {
        return React.createElement(
          'div',
          null,
          React.createElement(Child, {key: '0'}),
          React.createElement(Child, {key: '1'}),
          React.createElement(Child, {key: '2'}),
        );
      }
    }
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(React.createElement(Parent));
    });
    assertConsoleErrorDev([
      'Child: `key` is not a prop. Trying to access it will result ' +
        'in `undefined` being returned. If you need to access the same ' +
        'value within the child component, you should pass it as a different ' +
        'prop. (https://react.dev/link/special-props)\n' +
        '    in Parent (at **)',
    ]);
  });

  /** 创建 key=3 的 div element 后读取 props.key，开发构建应告警；验证宿主元素也使用特殊属性 getter，而非只对组件类型校验。 */
  it('should warn when `key` is being accessed on a host element', () => {
    const element = React.createElement('div', {key: '3'});
    void element.props.key;
    assertConsoleErrorDev([
      'div: `key` is not a prop. Trying to access it will result ' +
        'in `undefined` being returned. If you need to access the same ' +
        'value within the child component, you should pass it as a different ' +
        'prop. (https://react.dev/link/special-props)',
    ]);
  });

  /** 用字符串 div 创建 element，type 应保留字符串且 props 为空；开发冻结检查与 class 类型例对照，验证宿主类型不必是构造函数。 */
  it('allows a string to be passed as the type', () => {
    const element = React.createElement('div');
    expect(element.type).toBe('div');
    expect(element.key).toBe(null);
    expect(element.ref).toBe(null);
    if (__DEV__) {
      expect(Object.isFrozen(element)).toBe(true);
      expect(Object.isFrozen(element.props)).toBe(true);
    }
    expect(element.props).toEqual({});
  });

  /** 创建 class element 后尝试把 type 改成 div；开发构建应抛错，生产构建不抛，验证冻结是开发保护而非所有构建共有的写入限制。 */
  it('returns an immutable element', () => {
    const element = React.createElement(ComponentClass);
    if (__DEV__) {
      expect(() => (element.type = 'div')).toThrow();
    } else {
      expect(() => (element.type = 'div')).not.toThrow();
    }
  });

  /** 以 config.foo=1 创建 element 后将原 config 改为2，element.props.foo 应仍为1；验证 props 顶层拷贝隔离调用者后续赋值。 */
  it('does not reuse the original config object', () => {
    const config = {foo: 1};
    const element = React.createElement(ComponentClass, config);
    expect(element.props.foo).toBe(1);
    config.foo = 2;
    expect(element.props.foo).toBe(1);
  });

  /** 传入无原型对象且包含可枚举 foo=1，创建出的 props 应包含 foo；验证读取 config 不依赖对象自身的 hasOwnProperty 方法。 */
  it('does not fail if config has no prototype', () => {
    const config = Object.create(null, {foo: {value: 1, enumerable: true}});
    const element = React.createElement(ComponentClass, config);
    expect(element.props.foo).toBe(1);
  });

  /** 以 key=12、foo=56 创建 element，key 单独保存而 props 只含 foo；验证协调身份字段从普通属性集合分离。 */
  it('extracts key from the rest of the props', () => {
    const element = React.createElement(ComponentClass, {
      key: '12',
      foo: '56',
    });
    expect(element.type).toBe(ComponentClass);
    expect(element.key).toBe('12');
    const expectation = {foo: '56'};
    Object.freeze(expectation);
    expect(element.props).toEqual(expectation);
  });

  /** 传 createRef 对象创建 element，ref 应保留在 props；读取兼容 element.ref 同时触发开发迁移提示，验证 React19 的 ref 普通 prop 契约。 */
  it('does not extract ref from the rest of the props', () => {
    const ref = React.createRef();
    const element = React.createElement(ComponentClass, {
      key: '12',
      ref: ref,
      foo: '56',
    });
    expect(element.type).toBe(ComponentClass);
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

  /** 显式 key=null 时 element.key 应为字符串 null，props 不含 key；与未传 key 的真正 null 区分，验证显式值会参与字符串化。 */
  it('extracts null key', () => {
    const element = React.createElement(ComponentClass, {
      key: null,
      foo: '12',
    });
    expect(element.type).toBe(ComponentClass);
    expect(element.key).toBe('null');
    if (__DEV__) {
      expect(Object.isFrozen(element)).toBe(true);
      expect(Object.isFrozen(element.props)).toBe(true);
    }
    expect(element.props).toEqual({foo: '12'});
  });

  /** config 显式含 undefined key/ref 和 foo=56；最终 key/ref 为 null且 props只含foo，验证 undefined 特殊字段不产生身份或 ref 值。 */
  it('ignores undefined key and ref', () => {
    const props = {
      foo: '56',
      key: undefined,
      ref: undefined,
    };
    const element = React.createElement(ComponentClass, props);
    expect(element.type).toBe(ComponentClass);
    expect(element.key).toBe(null);
    expect(element.ref).toBe(null);
    if (__DEV__) {
      expect(Object.isFrozen(element)).toBe(true);
      expect(Object.isFrozen(element.props)).toBe(true);
    }
    expect(element.props).toEqual({foo: '56'});
  });

  /** 把已创建 div 的 props 当成下一次 config，key/ref 仍为 null；验证特殊 getter 不被误当成用户提供的有效特殊字段。 */
  it('ignores key and ref warning getters', () => {
    const elementA = React.createElement('div');
    const elementB = React.createElement('div', elementA.props);
    expect(elementB.key).toBe(null);
    expect(elementB.ref).toBe(null);
  });

  /** 传数字 key=12 和 foo=56，element.key 应为字符串12且props只含foo；检查身份规范化不改变普通 prop 值。 */
  it('coerces the key to a string', () => {
    const element = React.createElement(ComponentClass, {
      key: 12,
      foo: '56',
    });
    expect(element.type).toBe(ComponentClass);
    expect(element.key).toBe('12');
    expect(element.ref).toBe(null);
    if (__DEV__) {
      expect(Object.isFrozen(element)).toBe(true);
      expect(Object.isFrozen(element.props)).toBe(true);
    }
    expect(element.props).toEqual({foo: '56'});
  });

  /** Wrapper 在 render 内创建子 element，并在 didMount 保存实例；开发 _owner.stateNode 应是该实例，生产没有 _owner，验证创建者记录属于开发 Fiber 元数据。 */
  it('preserves the owner on the element', async () => {
    let element;
    let instance;

    /** 在自己的render创建element，并暴露挂载实例供_owner.stateNode断言比较。 */
    class Wrapper extends React.Component {
      /** 保存实际挂载的class实例，作为开发owner Fiber关联的比较目标。 */
      componentDidMount() {
        instance = this;
      }
      /** 在组件执行上下文创建子element并保存它，使_owner指向Wrapper而不是外部创建位置。 */
      render() {
        element = React.createElement(ComponentClass);
        return element;
      }
    }
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => root.render(React.createElement(Wrapper)));
    if (__DEV__) {
      expect(element._owner.stateNode).toBe(instance);
    } else {
      expect('_owner' in element).toBe(false);
    }
  });

  /** config.children=text 后再传一个位置参数1，children 应被1覆盖；验证单个显式子参数优先于 config.children。 */
  it('merges an additional argument onto the children prop', () => {
    const a = 1;
    const element = React.createElement(
      ComponentClass,
      {
        children: 'text',
      },
      a,
    );
    expect(element.props.children).toBe(a);
  });

  /** 只在 config 中传 children=text而没有额外子参数，结果仍为text；检查没有位置参数时不凭空覆盖已有 children。 */
  it('does not override children if no rest args are provided', () => {
    const element = React.createElement(ComponentClass, {
      children: 'text',
    });
    expect(element.props.children).toBe('text');
  });

  /** config.children=text 后显式传 null 子参数，结果应是 null；验证显式空值与完全省略子参数有不同覆盖行为。 */
  it('overrides children if null is provided as an argument', () => {
    const element = React.createElement(
      ComponentClass,
      {
        children: 'text',
      },
      null,
    );
    expect(element.props.children).toBe(null);
  });

  /** 连续传三个子参数1/2/3，props.children 应成为同序数组；验证多子参数聚合而不是只取首项或末项。 */
  it('merges rest arguments onto the children prop in an array', () => {
    const a = 1;
    const b = 2;
    const c = 3;
    const element = React.createElement(ComponentClass, null, a, b, c);
    expect(element.props.children).toEqual([1, 2, 3]);
  });

  /** 给 class 构造器挂静态方法并创建 element，通过 element.type 调用应返回原方法结果；验证 type 保存原构造器引用。 */
  it('allows static methods to be called using the type property', () => {
    /** 带可调用静态方法的class类型，检查element.type是否保持原构造器。 */
    class StaticMethodComponentClass extends React.Component {
      /** 返回最小div满足组件形状；静态方法断言只调用element.type，不依赖挂载。 */
      render() {
        return React.createElement('div');
      }
    // 静态方法挂在原构造器上；element.type保留该引用，所以调用能读取同一个返回值。
    }
    /** 返回固定标记，用 element.type 的调用结果检查静态方法仍属于原构造器。 */
    StaticMethodComponentClass.someStaticMethod = () => 'someReturnValue';

    const element = React.createElement(StaticMethodComponentClass);
    expect(element.type.someStaticMethod()).toBe('someReturnValue');
  });

  /** 创建 div element 并比较其 constructor 与普通对象的 constructor；验证描述对象不是专用 element 类的实例。 */
  it('is indistinguishable from a plain object', () => {
    const element = React.createElement('div', {className: 'foo'});
    const object = {};
    expect(element.constructor).toBe(object.constructor);
  });

  /** 初挂 class 显式 fruit=mango，下一次省略fruit，已有实例应收到默认persimmon；验证每次创建element都重新用defaultProps补缺省值。 */
  it('should use default prop value when removing a prop', async () => {
    /** 持有默认fruit的可复用实例，让更新后props缺省处理可以直接从同一实例观察。 */
    class Component extends React.Component {
      /** 返回固定span，排除DOM文本变化，让本例专注实例props是否从mango回退到默认值。 */
      render() {
        return React.createElement('span');
      }
    }
    Component.defaultProps = {fruit: 'persimmon'};

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    const ref = React.createRef();
    await act(() => {
      root.render(React.createElement(Component, {ref, fruit: 'mango'}));
    });
    const instance = ref.current;
    expect(instance.props.fruit).toBe('mango');

    await act(() => {
      root.render(React.createElement(Component));
    });
    expect(instance.props.fruit).toBe('persimmon');
  });

  /** 省略prop挂载应使用默认testKey，更新时显式prop=null应保持null；验证defaultProps只补undefined或缺失，不覆盖显式null。 */
  it('should normalize props with default values', async () => {
    let instance;
    /** 在挂载时保存实例，并把prop写入文本，构造默认值与显式null的对照。 */
    class Component extends React.Component {
      /** 保存初挂实例，供后续更新读取同一class实例的props。 */
      componentDidMount() {
        instance = this;
      }
      /** 把prop作为span内容，使默认prop参与真实渲染而不是只检查未使用的配置。 */
      render() {
        return React.createElement('span', null, this.props.prop);
      }
    }
    Component.defaultProps = {prop: 'testKey'};

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(React.createElement(Component));
    });
    expect(instance.props.prop).toBe('testKey');

    await act(() => {
      root.render(React.createElement(Component, {prop: null}));
    });
    expect(instance.props.prop).toBe(null);
  });

  /** render 内改已存在的 className；开发写入抛错并提交moo，生产允许写入并提交quack，验证冻结会实际影响传给宿主的props。 */
  it('throws when changing a prop (in dev) after element creation', async () => {
    /** 在render中修改已存在的element.props.className，对比开发冻结与生产可写行为。 */
    class Outer extends React.Component {
      /** 创建moo类名后尝试改为quack，先检查写入结果，再返回该element让宿主提交同一props。 */
      render() {
        const el = React.createElement('div', {className: 'moo'});

        if (__DEV__) {
          expect(function () {
            el.props.className = 'quack';
          }).toThrow();
          expect(el.props.className).toBe('moo');
        } else {
          el.props.className = 'quack';
          expect(el.props.className).toBe('quack');
        }

        return el;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(React.createElement(Outer, {color: 'orange'}));
    });
    if (__DEV__) {
      expect(container.firstChild.className).toBe('moo');
    } else {
      expect(container.firstChild.className).toBe('quack');
    }
  });

  /** 在没有className的element.props上增添字段；开发抛错且DOM类名为空，生产接收quack；文本仍为默认meow，区分新增字段保护与普通children输出。 */
  it('throws when adding a prop (in dev) after element creation', async () => {
    const container = document.createElement('div');
    /** 在render中给props增添className，用固定默认文本区分属性增写与children传递。 */
    class Outer extends React.Component {
      /** 创建没有className的div后尝试增添quack；开发断言冻结错误，生产把新增类名交给DOM。 */
      render() {
        const el = React.createElement('div', null, this.props.sound);

        if (__DEV__) {
          expect(function () {
            el.props.className = 'quack';
          }).toThrow();
          expect(el.props.className).toBe(undefined);
        } else {
          el.props.className = 'quack';
          expect(el.props.className).toBe('quack');
        }

        return el;
      }
    }
    Outer.defaultProps = {sound: 'meow'};
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(React.createElement(Outer));
    });
    expect(container.firstChild.textContent).toBe('meow');
    if (__DEV__) {
      expect(container.firstChild.className).toBe('');
    } else {
      expect(container.firstChild.className).toBe('quack');
    }
  });

  /** 以 +undefined 得到的 NaN 作为value挂载class并读取实例props，值应仍为NaN；验证元素创建不会把NaN正规化或当成非法prop拒绝。 */
  it('does not warn for NaN props', async () => {
    let test;
    /** 保存接收NaN prop的真实class实例，验证值在创建与挂载过程中保留。 */
    class Test extends React.Component {
      /** 将当前实例暴露给用例，供isNaN断言读取实际收到的props。 */
      componentDidMount() {
        test = this;
      }
      /** 返回无额外props的div，避免把NaN传入宿主属性校验而扩大本例覆盖范围。 */
      render() {
        return React.createElement('div');
      }
    }
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(React.createElement(Test, {value: +undefined}));
    });
    expect(test.props.value).toBeNaN();
  });

  /** 创建带__self但无key的div触发一次开发warn，再创建相同形状元素不应新增未预期warn；检查旧转换器诊断条件及模块级去重。 */
  it('warns if outdated JSX transform is detected', async () => {
    // 检测到 `__self` 时发出警告，因为该字段只应由旧编译器转换注入。
    React.createElement('div', {className: 'foo', __self: this});
    assertConsoleWarnDev([
      'Your app (or one of its dependencies) is using an outdated JSX ' +
        'transform. Update to the modern JSX transform for ' +
        'faster performance: https://react.dev/link/new-jsx-transform',
    ]);

    // 该诊断只输出一次；后续元素应被去重，避免重复污染控制台。
    React.createElement('div', {className: 'foo', __self: this});
  });

  /** 同时提供key与__self创建div，未登记任何预期warn；此形状可能来自现代转换器的createElement回退，验证key存在时跳过旧转换器诊断。 */
  it('do not warn about outdated JSX transform if `key` is present', () => {
    // 当静态 `key` 位于 spread 之后时，现代 JSX 转换会输出 `createElement` 而非 `jsx`。
    // 原因是 `jsx` 中 spread key 始终覆盖静态 key，而 `createElement` 会遵循属性出现顺序。
    //
    // 只要存在 `key` 属性便跳过该警告，避免把转换器有意选择的 `createElement` 路径误报为旧转换器。
    React.createElement('div', {key: 'foo', __self: this});
  });
});
