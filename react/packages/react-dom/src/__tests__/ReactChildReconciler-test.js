/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

// 重复 key 用例同时检查元素来源栈；Parent 通过 cloneElement 转交已有 child，预期栈保留其创建者链。

'use strict';

let React;
let ReactDOMClient;
let act;
let assertConsoleErrorDev;

describe('ReactChildReconciler', () => {
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
  });

  /** 用 @@iterator 包装数组，每次创建独立索引迭代器，使重复 key case 进入 iterable 协调分支。 */
  function createIterable(array) {
    return {
      /** 从 i=0 创建迭代器，不共用跨渲染的消费进度。 */
      '@@iterator': function () {
        let i = 0;
        return {
          /** 依次返回数组元素，i 等于长度时 done=true；返回后递增，使协调器消费到一次完成记录。 */
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

  /** 给空函数附加单元素 @@iterator；输入同时是 callable 与 iterable，用于验证函数子节点优先被拒绝。 */
  function makeIterableFunction(value) {
    /** 空函数仅作为函数类型身份，实际迭代能力由随后附加的 @@iterator 提供。 */
    const fn = () => {};
    /** 每次建立单元素迭代器，第一项返回 value，之后 done；React 不应因该属性而接受函数本身作为 children。 */
    fn['@@iterator'] = function iterator() {
      let timesCalled = 0;
      return {
        /** 第一次返回 done=false 与输入值，第二次起返回 done=true，构造可正常消费但应被类型分支拒绝的 iterable 函数。 */
        next() {
          const done = timesCalled++ > 0;
          return {done, value: done ? undefined : value};
        },
      };
    };
    return fn;
  }

  /** 把带 @@iterator 且可产出 foo 的函数本身作为 h1 child；DEV 应报函数不是有效 React child，验证 typeof function 分支不会因迭代器属性而当集合渲染。本 case 的 toContain("") 不独立证明 h1 内容为空，主要证据是诊断。 */
  it('does not treat functions as iterables', async () => {
    const iterableFunction = makeIterableFunction('foo');

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <div>
          <h1>{iterableFunction}</h1>
        </div>,
      );
    });
    assertConsoleErrorDev([
      'Functions are not valid as a React child. ' +
        'This may happen if you return fn instead of <fn /> from render. ' +
        'Or maybe you meant to call this function rather than return it.\n' +
        '  <h1>{fn}</h1>\n' +
        '    in h1 (at **)',
    ]);
    const node = container.firstChild;

    expect(node.innerHTML).toContain(''); // h1
  });

  /** 类 fixture 返回含两个相同 key=1 的 div 数组；DEV 应一次报告重复 key 并附 div/Component 栈，验证数组兄弟身份冲突。 */
  it('warns for duplicated array keys', async () => {
    /** 提供同一数组中两个 key=1 的 JSX child，触发最小重复 key 诊断。 */
    class Component extends React.Component {
      /** 返回两个重复键 div 的数组，宿主父 div 是唯一性检查的兄弟集合边界。 */
      render() {
        return <div>{[<div key="1" />, <div key="1" />]}</div>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component />);
    });
    assertConsoleErrorDev([
      'Encountered two children with the same key, `1`. ' +
        'Keys should be unique so that components maintain their identity across updates. ' +
        'Non-unique keys may cause children to be duplicated and/or omitted — ' +
        'the behavior is unsupported and could change in a future version.\n' +
        '    in div (at **)\n' +
        '    in Component (at **)',
    ]);
  });

  /** 重复 key 数组经过 GrandParent 创建元素、Parent cloneElement 转交；DEV 仍报告冲突且栈为 div/Component/GrandParent，验证元素创建者链中的来源信息。 */
  it('warns for duplicated array keys with component stack info', async () => {
    /** 提供经过父组件转交的重复键数组，用以核对诊断来源栈。 */
    class Component extends React.Component {
      /** 在 Component 创建重复键元素，使冲突来源指向该组件。 */
      render() {
        return <div>{[<div key="1" />, <div key="1" />]}</div>;
      }
    }

    /** 通过 cloneElement 转交 GrandParent 创建的 Component，测试元素来源栈经过克隆仍可追踪。 */
    class Parent extends React.Component {
      /** 克隆已有 child 而不替换其 props/ref，保留原元素创建者信息。 */
      render() {
        return React.cloneElement(this.props.child);
      }
    }

    /** 创建交给 Parent 的 Component 元素，作为诊断栈的上层创建来源。 */
    class GrandParent extends React.Component {
      /** 输出 Parent 并在 child 参数中创建 Component，建立预期 GrandParent 来源帧。 */
      render() {
        return <Parent child={<Component />} />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<GrandParent />);
    });
    assertConsoleErrorDev([
      'Encountered two children with the same key, `1`. ' +
        'Keys should be unique so that components maintain their identity ' +
        'across updates. Non-unique keys may cause children to be ' +
        'duplicated and/or omitted — the behavior is unsupported and ' +
        'could change in a future version.\n' +
        '    in div (at **)\n' +
        '    in Component (at **)\n' +
        '    in GrandParent (at **)',
    ]);
  });

  /** 把相同 key=1 的两个 div 包进自定义 @@iterator 集合；DEV 应报告重复 key 与 div/Component 栈，验证 iterable 与数组执行同样的 key 唯一性检查。 */
  it('warns for duplicated iterable keys', async () => {
    /** 提供自定义 iterable 内两个重复 key 的宿主子节点，覆盖另一种集合协调入口。 */
    class Component extends React.Component {
      /** 把重复键 div 放入 createIterable，而非直接数组 children。 */
      render() {
        return <div>{createIterable([<div key="1" />, <div key="1" />])}</div>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component />);
    });
    assertConsoleErrorDev([
      'Encountered two children with the same key, `1`. ' +
        'Keys should be unique so that components maintain their identity ' +
        'across updates. Non-unique keys may cause children to be ' +
        'duplicated and/or omitted — the behavior is unsupported and ' +
        'could change in a future version.\n' +
        '    in div (at **)\n' +
        '    in Component (at **)',
    ]);
  });

  /** 重复 key iterable 经过 GrandParent 与 cloneElement 转交；DEV 应保留 div/Component/GrandParent 来源栈，验证集合迭代分支的诊断来源信息。 */
  it('warns for duplicated iterable keys with component stack info', async () => {
    /** 提供跨组件转交的重复 key iterable，用以核对迭代分支组件来源栈。 */
    class Component extends React.Component {
      /** 在 Component 内建立重复键 iterable，保留冲突节点的创建来源。 */
      render() {
        return <div>{createIterable([<div key="1" />, <div key="1" />])}</div>;
      }
    }

    /** 克隆并转交包含 iterable 的 Component 元素，与数组 case 保持同样来源关系。 */
    class Parent extends React.Component {
      /** 原样 cloneElement child，令 iterable 场景只改变集合形式而不改变组件创建者关系。 */
      render() {
        return React.cloneElement(this.props.child);
      }
    }

    /** 创建 iterable Component 并经 Parent 转交，提供诊断中的 GrandParent 来源。 */
    class GrandParent extends React.Component {
      /** 组合 Parent 与 child Component，覆盖克隆转交后的 iterable 重复键诊断。 */
      render() {
        return <Parent child={<Component />} />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<GrandParent />);
    });
    assertConsoleErrorDev([
      'Encountered two children with the same key, `1`. ' +
        'Keys should be unique so that components maintain their identity ' +
        'across updates. Non-unique keys may cause children to be ' +
        'duplicated and/or omitted — the behavior is unsupported and ' +
        'could change in a future version.\n' +
        '    in div (at **)\n' +
        '    in Component (at **)\n' +
        '    in GrandParent (at **)',
    ]);
  });
});
