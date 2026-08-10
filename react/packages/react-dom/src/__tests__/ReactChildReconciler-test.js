/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

// 注意：这里刻意不使用 JSX，以便在 Babel 不添加源码位置信息时测试当前的 stack addendum。

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

  /** `makeIterableFunction`：封装当前用例复用的操作、回调或断言步骤。 */
  function makeIterableFunction(value) {
    /** `makeIterableFunction.fn`：封装当前用例复用的操作、回调或断言步骤。 */
    const fn = () => {};
    fn['@@iterator'] = function iterator() {
      let timesCalled = 0;
      return {
        /** `iterator.next`：实现测试夹具的生命周期、渲染或交互步骤。 */
        next() {
          const done = timesCalled++ > 0;
          return {done, value: done ? undefined : value};
        },
      };
    };
    return fn;
  }

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「does not treat functions as iterables」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
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

  /** 测试场景：验证「warns for duplicated array keys」描述的渲染、交互或错误处理结果。 */
  it('warns for duplicated array keys', async () => {
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「warns for duplicated array keys with component stack info」描述的渲染、交互或错误处理结果。 */
  it('warns for duplicated array keys with component stack info', async () => {
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{[<div key="1" />, <div key="1" />]}</div>;
      }
    }

    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return React.cloneElement(this.props.child);
      }
    }

    /** `GrandParent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class GrandParent extends React.Component {
      /** `GrandParent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「warns for duplicated iterable keys」描述的渲染、交互或错误处理结果。 */
  it('warns for duplicated iterable keys', async () => {
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「warns for duplicated iterable keys with component stack info」描述的渲染、交互或错误处理结果。 */
  it('warns for duplicated iterable keys with component stack info', async () => {
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{createIterable([<div key="1" />, <div key="1" />])}</div>;
      }
    }

    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return React.cloneElement(this.props.child);
      }
    }

    /** `GrandParent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class GrandParent extends React.Component {
      /** `GrandParent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
