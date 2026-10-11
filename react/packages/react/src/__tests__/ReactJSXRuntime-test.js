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
let JSXRuntime;
let JSXDEVRuntime;
let act;
let assertConsoleErrorDev;

// 注意：测试应优先直接调用 JSXRuntime，确保断言针对 runtime 行为，
// 而不是测试配置中 Babel 转换生成的中间代码。
describe('ReactJSXRuntime', () => {
  // 每例重置模块并重取 React/runtime/act，隔离 key/特殊 prop 诊断的模块级去重。
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    JSXRuntime = require('react/jsx-runtime');
    JSXDEVRuntime = require('react/jsx-dev-runtime');
    ReactDOMClient = require('react-dom/client');
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
  });

  /** class 增加 someStaticMethod，jsx 创建 element 后通过 element.type 调用返回固定字符串，验证 type 保留原构造器身份。 */
  it('allows static methods to be called using the type property', () => {
    /** 创建带静态方法的 class type，供 element.type 原身份断言。 */
    class StaticMethodComponentClass extends React.Component {
      /** 返回空 div；静态方法用例只创建 element，不挂载此 render。 */
      render() {
        return JSXRuntime.jsx('div', {});
      }
    }
    /** 返回固定值，供 element.type 保留原构造器静态方法的断言。 */
    StaticMethodComponentClass.someStaticMethod = () => 'someReturnValue';

    const element = JSXRuntime.jsx(StaticMethodComponentClass, {});
    expect(element.type.someStaticMethod()).toBe('someReturnValue');
  });

  /** jsx 创建 div element 后比较 constructor 与普通对象相同，验证 element 使用普通对象形状，不涉及冻结或品牌全部字段。 */
  it('is indistinguishable from a plain object', () => {
    const element = JSXRuntime.jsx('div', {className: 'foo'});
    const object = {};
    expect(element.constructor).toBe(object.constructor);
  });

  /** class 默认 fruit=persimmon，先以 mango 挂载再移除 prop；宿主文本 mango→persimmon，验证缺失 prop 恢复类默认值。 */
  it('should use default prop value when removing a prop', async () => {
    /** fruit 默认值类，将实际 props 渲染为文本，观察省略 prop 的恢复。 */
    class Component extends React.Component {
      /** 将 props.fruit 包为 span children 数组，供宿主文本 mango/默认值检查。 */
      render() {
        return JSXRuntime.jsx('span', {children: [this.props.fruit]});
      }
    }
    Component.defaultProps = {fruit: 'persimmon'};

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(JSXRuntime.jsx(Component, {fruit: 'mango'}));
    });
    expect(container.firstChild.textContent).toBe('mango');

    await act(() => {
      root.render(JSXRuntime.jsx(Component, {}));
    });
    expect(container.firstChild.textContent).toBe('persimmon');
  });

  /** class 默认 prop=testKey，两个独立 root 分别省略和显式 null；ref 实例 props 分别为默认值与 null，验证默认值不覆盖 null。 */
  it('should normalize props with default values', async () => {
    /** 默认 prop 类，通过 ref 暴露实例 props，检查省略与显式 null。 */
    class Component extends React.Component {
      /** 输出 props.prop 的 span，供两个 root 分别正常提交实例 ref。 */
      render() {
        return JSXRuntime.jsx('span', {children: this.props.prop});
      }
    }
    Component.defaultProps = {prop: 'testKey'};

    let container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);
    let instance;
    await act(() => {
      root.render(
        JSXRuntime.jsx(Component, {
          /** 捕获首次渲染的 class 实例，供默认 props 断言读取。 */
          ref: current => (instance = current)
        }),
      );
    });

    expect(instance.props.prop).toBe('testKey');

    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    let inst2;
    await act(() => {
      root.render(
        JSXRuntime.jsx(Component, {
          prop: null,
          /** 捕获显式 null props 场景的实例，证明默认值不会覆盖 null。 */
          ref: current => (inst2 = current),
        }),
      );
    });

    expect(inst2.props.prop).toBe(null);
  });

  /** Outer render 创建 className=moo 的 element 再改为 quack；DEV 写入抛错且 DOM 为 moo，生产允许修改且 DOM 为 quack，验证 props 冻结边界。 */
  it('throws when changing a prop (in dev) after element creation', async () => {
    /** 在 render 内修改已有 element props 的类，检查 DEV 冻结与生产可变边界。 */
    class Outer extends React.Component {
      /** 创建 moo div，再尝试改 className 为 quack；内部分构建断言并返回同一 element，供 DOM 比较。 */
      render() {
        const el = JSXRuntime.jsx('div', {className: 'moo'});

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
      root.render(JSXRuntime.jsx(Outer, {color: 'orange'}));
    });

    const outer = container.firstChild;
    if (__DEV__) {
      expect(outer.className).toBe('moo');
    } else {
      expect(outer.className).toBe('quack');
    }
  });

  /** Outer render 创建仅含 children 的 element 再添 className；DEV 添加抛错、DOM 类名空，生产为 quack，文本均 meow，验证冻结阻止新增字段。 */
  it('throws when adding a prop (in dev) after element creation', async () => {
    const container = document.createElement('div');
    /** 在 render 内给 element props 添字段的类，检查新增字段的冻结边界。 */
    class Outer extends React.Component {
      /** 创建带默认 sound 文本的 div，再尝试添 className；分构建断言并返回 element，验证最终 DOM。 */
      render() {
        const el = JSXRuntime.jsx('div', {children: this.props.sound});

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
      root.render(JSXRuntime.jsx(Outer, {}));
    });
    expect(container.firstChild.textContent).toBe('meow');
    if (__DEV__) {
      expect(container.firstChild.className).toBe('');
    } else {
      expect(container.firstChild.className).toBe('quack');
    }
  });

  /** value=+undefined 产生 NaN，jsx 创建并挂载 class 后 ref 读取仍 NaN且无预期诊断，验证 runtime 不误拒绝 NaN prop。 */
  it('does not warn for NaN props', async () => {
    /** 接收 NaN 普通 prop 的类，ref 暴露实例供值检查，不把 NaN 传给宿主属性。 */
    class Test extends React.Component {
      /** 返回空 div，使 NaN 仅留在类 props，避免混入宿主属性诊断。 */
      render() {
        return JSXRuntime.jsx('div', {});
      }
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let test;
    await act(() => {
      root.render(
        JSXRuntime.jsx(Test, {
          value: +undefined,
          /** 捕获宿主测试组件实例，供 NaN props 断言读取。 */
          ref: current => (test = current),
        }),
      );
    });

    expect(test.props.value).toBeNaN();
  });

  /** Parent 用 jsxs 包三 keyed Child，Child render 读取 this.props.key；挂载只要求一次特殊 key 诊断并带 Parent 来源，验证 key 不作为普通 prop。 */
  it('should warn when `key` is being accessed on composite element', async () => {
    const container = document.createElement('div');
    /** 故意读取 key 的类，供特殊 prop 访问器告警。 */
    class Child extends React.Component {
      /** 读取 this.props.key 并作为 div children，触发 DEV 特殊 prop 诊断。 */
      render() {
        return JSXRuntime.jsx('div', {children: this.props.key});
      }
    }
    /** 用 jsxs 创建三 keyed Child 的父类，供 key 访问告警的 owner 栈。 */
    class Parent extends React.Component {
      /** 以独立 key 参数创建 0/1/2 三 Child，使用 jsxs 返回静态数组。 */
      render() {
        return JSXRuntime.jsxs('div', {
          children: [
            JSXRuntime.jsx(Child, {}, '0'),
            JSXRuntime.jsx(Child, {}, '1'),
            JSXRuntime.jsx(Child, {}, '2'),
          ],
        });
      }
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(JSXRuntime.jsx(Parent, {}));
    });
    assertConsoleErrorDev([
      'Child: `key` is not a prop. Trying to access it will result ' +
        'in `undefined` being returned. If you need to access the same ' +
        'value within the child component, you should pass it as a different ' +
        'prop. (https://react.dev/link/special-props)\n' +
        '    in Parent (at **)',
    ]);
  });

  /** 显式 jsxs 声明静态 children 却传字符串 foo，act 挂载后要求静态 children 应为数组的诊断，验证 runtime 形状检查。 */
  it('warns when a jsxs is passed something that is not an array', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(JSXRuntime.jsxs('div', {children: 'foo'}, null));
    });
    assertConsoleErrorDev([
      'React.jsx: Static children should always be an array. ' +
        'You are likely explicitly calling React.jsxs or React.jsxDEV. ' +
        'Use the Babel transform instead.',
    ]);
  });

  /** 创建 key=3 的宿主 element 并读 props.key，不挂载；要求 div 特殊 key 诊断，验证开发访问器在工厂输出上生效。 */
  it('should warn when `key` is being accessed on a host element', () => {
    const element = JSXRuntime.jsxs('div', {}, '3');
    void element.props.key;
    assertConsoleErrorDev([
      'div: `key` is not a prop. Trying to access it will result ' +
        'in `undefined` being returned. If you need to access the same ' +
        'value within the child component, you should pass it as a different ' +
        'prop. (https://react.dev/link/special-props)',
    ]);
  });

  /** Parent 用 jsx 传三无 key Child 数组，挂载要求 Parent 的列表 key 诊断，验证动态入口。 */
  it('should warn when unkeyed children are passed to jsx', async () => {
    const container = document.createElement('div');

    /** 动态无 key 列表的叶类，供 Parent 归属告警。 */
    class Child extends React.Component {
      /** 返回空 div，不额外触发诊断，使测试只检查缺少列表 key。 */
      render() {
        return JSXRuntime.jsx('div', {});
      }
    }
    /** 用 jsx 创建三无 key Child 数组的父类，供动态 key 检查。 */
    class Parent extends React.Component {
      /** 使用 jsx 将三无 key Child 作为动态 children 数组传入 div。 */
      render() {
        return JSXRuntime.jsx('div', {
          children: [
            JSXRuntime.jsx(Child, {}),
            JSXRuntime.jsx(Child, {}),
            JSXRuntime.jsx(Child, {}),
          ],
        });
      }
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(JSXRuntime.jsx(Parent, {}));
    });
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.\n\n' +
        'Check the render method of `Parent`. See https://react.dev/link/warning-keys for more information.\n' +
        '    in Parent (at **)',
    ]);
  });

  /** Child 的 key=0 放进 config 而非独立参数，挂载要求 spread key 迁移建议，验证 runtime 检查 key 的传递位置。 */
  it('should warn when keys are passed as part of props', async () => {
    const container = document.createElement('div');
    /** config spread key 的叶类，供传递位置告警。 */
    class Child extends React.Component {
      /** 返回空 div，使测试只观察创建时 config.key 的 spread 告警。 */
      render() {
        return JSXRuntime.jsx('div', {});
      }
    }
    /** 把 Child key 填在 config 的父类，供 spread key 迁移诊断。 */
    class Parent extends React.Component {
      /** 以 config={key:0,prop:hi} 创建 Child，放入 jsx div 的数组 children。 */
      render() {
        return JSXRuntime.jsx('div', {
          children: [JSXRuntime.jsx(Child, {key: '0', prop: 'hi'})],
        });
      }
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(JSXRuntime.jsx(Parent, {}));
    });
    assertConsoleErrorDev([
      'A props object containing a "key" prop is being spread into JSX:\n' +
        '  let props = {key: someKey, prop: ...};\n' +
        '  <Child {...props} />\n' +
        'React keys must be passed directly to JSX without using spread:\n' +
        '  let props = {prop: ...};\n' +
        '  <Child key={someKey} {...props} />\n' +
        '    in Parent (at **)',
    ]);
  });

  /** Parent 用 jsxs 传三无 key Child 数组，act 挂载完成且无预期诊断；末尾 true 断言只是占位，实际观察静态 children 路径不触发 key 告警。 */
  it('should not warn when unkeyed children are passed to jsxs', async () => {
    const container = document.createElement('div');
    /** 静态无 key 列表的叶类，供 jsxs 标记免列表告警。 */
    class Child extends React.Component {
      /** 返回空 div，使静态 children 挂载路径完成。 */
      render() {
        return JSXRuntime.jsx('div', {});
      }
    }
    /** 用 jsxs 创建三无 key Child 的父类，供静态标记与动态入口对比。 */
    class Parent extends React.Component {
      /** 使用 jsxs 将三无 key Child 作为静态数组传入 div，供无预期 key 告警场景。 */
      render() {
        return JSXRuntime.jsxs('div', {
          children: [
            JSXRuntime.jsx(Child, {}),
            JSXRuntime.jsx(Child, {}),
            JSXRuntime.jsx(Child, {}),
          ],
        });
      }
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(JSXRuntime.jsx(Parent, {}));
    });

    // 静态 children 路径挂载完成且没有预期 key 诊断；下面 true 断言仅是占位。
    expect(true).toBe(true);
  });

  /** DEV 直接 jsxDEV、生产 jsx 创建 Lazy，ctor 的 didCall 探针仍 false；验证两工厂都不提前启动 lazy。 */
  it('does not call lazy initializers eagerly', () => {
    let didCall = false;
    const Lazy = React.lazy(() => {
      didCall = true;
      return {
        /** 占位 thenable；本例只创建 lazy element，不应执行 ctor 或订阅。 */
        then() {}
      };
    });
    if (__DEV__) {
      JSXDEVRuntime.jsxDEV(Lazy, {});
    } else {
      JSXRuntime.jsx(Lazy, {});
    }
    expect(didCall).toBe(false);
  });

  /** 无 key config 直接传工厂，element.props 与 config 同引用；加入 config.key 后要求 spread key 诊断且 props 改为复制对象，验证去掉保留 key 的复制分支。标题提 ref，本体仅显式覆盖 key。 */
  it('does not clone props object if key and ref is not spread', async () => {
    const config = {
      foo: 'foo',
      bar: 'bar',
    };

    const element = __DEV__
      ? JSXDEVRuntime.jsxDEV('div', config)
      : JSXRuntime.jsx('div', config);
    expect(Object.is(element.props, config)).toBe(true);

    const configWithKey = {
      foo: 'foo',
      bar: 'bar',
    // 只有通过 spread 传入的 key 会走该分支；静态 key 会作为独立参数传给 `jsx()` runtime。
      key: 'key',
    };

    const elementWithSpreadKey = __DEV__
      ? JSXDEVRuntime.jsxDEV('div', configWithKey)
      : JSXRuntime.jsx('div', configWithKey);
    assertConsoleErrorDev([
      'A props object containing a "key" prop is being spread into JSX:\n' +
        '  let props = {key: someKey, foo: ..., bar: ...};\n' +
        '  <div {...props} />\n' +
        'React keys must be passed directly to JSX without using spread:\n' +
        '  let props = {foo: ..., bar: ...};\n' +
        '  <div key={someKey} {...props} />',
    ]);
    expect(elementWithSpreadKey.props).not.toBe(configWithKey);
  });
});
