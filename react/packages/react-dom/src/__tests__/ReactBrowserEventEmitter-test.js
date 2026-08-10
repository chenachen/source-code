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

let idCallOrder;
/** `recordID`：封装当前用例复用的操作、回调或断言步骤。 */
const recordID = function (id) {
  idCallOrder.push(id);
};
/** `recordIDAndStopPropagation`：封装当前用例复用的操作、回调或断言步骤。 */
const recordIDAndStopPropagation = function (id, event) {
  recordID(id);
  event.stopPropagation();
};
/** `recordIDAndReturnFalse`：封装当前用例复用的操作、回调或断言步骤。 */
const recordIDAndReturnFalse = function (id, event) {
  recordID(id);
  return false;
};
/** `LISTENER`：保存当前测试场景复用的夹具、状态或回调。 */
const LISTENER = jest.fn();
/** `ON_CLICK_KEY`：保存当前测试场景复用的夹具、状态或回调。 */
const ON_CLICK_KEY = 'onClick';

let GRANDPARENT;
let PARENT;
let CHILD;
let BUTTON;

let renderTree;
let putListener;
let deleteAllListeners;

let container;

// 这项测试是以一种奇怪的方式写的,因为它以前使用了内部. 我们应该重新写,但我们将保留它,以获得更
// 多的报道.
describe('ReactBrowserEventEmitter', () => {
  beforeEach(() => {
    jest.resetModules();
    LISTENER.mockClear();

    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
    container = document.createElement('div');
    document.body.appendChild(container);

    let GRANDPARENT_PROPS = {};
    let PARENT_PROPS = {};
    let CHILD_PROPS = {};
    let BUTTON_PROPS = {};

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child(props) {
      return <div ref={c => (CHILD = c)} {...props} />;
    }

    /** `ChildWrapper`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ChildWrapper extends React.PureComponent {
      /** `ChildWrapper.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <Child {...this.props} />;
      }
    }

    const root = ReactDOMClient.createRoot(container);

    renderTree = async function () {
      await act(() => {
        root.render(
          <div ref={c => (GRANDPARENT = c)} {...GRANDPARENT_PROPS}>
            <div ref={c => (PARENT = c)} {...PARENT_PROPS}>
              <ChildWrapper {...CHILD_PROPS} />
              <button
                disabled={true}
                ref={c => (BUTTON = c)}
                {...BUTTON_PROPS}
              />
            </div>
          </div>,
        );
      });
    };

    putListener = async function (node, eventName, listener) {
      switch (node) {
        case CHILD:
          CHILD_PROPS[eventName] = listener;
          break;
        case PARENT:
          PARENT_PROPS[eventName] = listener;
          break;
        case GRANDPARENT:
          GRANDPARENT_PROPS[eventName] = listener;
          break;
        case BUTTON:
          BUTTON_PROPS[eventName] = listener;
          break;
      }
      // 重新渲染时添加新的事件监听器
      await renderTree();
    };

    deleteAllListeners = async function (node) {
      switch (node) {
        case CHILD:
          CHILD_PROPS = {};
          break;
        case PARENT:
          PARENT_PROPS = {};
          break;
        case GRANDPARENT:
          GRANDPARENT_PROPS = {};
          break;
        case BUTTON:
          BUTTON_PROPS = {};
          break;
      }
      await renderTree();
    };

    idCallOrder = [];
  });

  afterEach(() => {
    document.body.removeChild(container);
    container = null;
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should bubble simply」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：事件断言连接 DOMPluginEventSystem 的委托、合成与传播路径。
   */
  it('should bubble simply', async () => {
    await renderTree();
    await putListener(CHILD, ON_CLICK_KEY, recordID.bind(null, CHILD));
    await putListener(PARENT, ON_CLICK_KEY, recordID.bind(null, PARENT));
    await putListener(
      GRANDPARENT,
      ON_CLICK_KEY,
      recordID.bind(null, GRANDPARENT),
    );
    await act(() => {
      CHILD.click();
    });
    expect(idCallOrder.length).toBe(3);
    expect(idCallOrder[0]).toBe(CHILD);
    expect(idCallOrder[1]).toBe(PARENT);
    expect(idCallOrder[2]).toBe(GRANDPARENT);
  });

  /** 测试场景：验证「should bubble to the right handler after an update」描述的渲染、交互或错误处理结果。 */
  it('should bubble to the right handler after an update', async () => {
    await renderTree();
    await putListener(
      GRANDPARENT,
      ON_CLICK_KEY,
      recordID.bind(null, 'GRANDPARENT'),
    );
    await putListener(PARENT, ON_CLICK_KEY, recordID.bind(null, 'PARENT'));
    await putListener(CHILD, ON_CLICK_KEY, recordID.bind(null, 'CHILD'));
    await act(() => {
      CHILD.click();
    });
    expect(idCallOrder).toEqual(['CHILD', 'PARENT', 'GRANDPARENT']);

    idCallOrder = [];

    // 只更新父组件，而不更新子组件。
    await putListener(
      GRANDPARENT,
      ON_CLICK_KEY,
      recordID.bind(null, 'UPDATED_GRANDPARENT'),
    );

    await act(() => {
      CHILD.click();
    });
    expect(idCallOrder).toEqual(['CHILD', 'PARENT', 'UPDATED_GRANDPARENT']);
  });

  /** 测试场景：验证「should continue bubbling if an error is thrown」描述的渲染、交互或错误处理结果。 */
  it('should continue bubbling if an error is thrown', async () => {
    await renderTree();
    await putListener(CHILD, ON_CLICK_KEY, recordID.bind(null, CHILD));
    await putListener(PARENT, ON_CLICK_KEY, function (event) {
      recordID(PARENT);
      throw new Error('Handler interrupted');
    });
    await putListener(
      GRANDPARENT,
      ON_CLICK_KEY,
      recordID.bind(null, GRANDPARENT),
    );
    const errorHandler = jest.fn(event => {
      event.preventDefault();
    });
    window.addEventListener('error', errorHandler);
    try {
      CHILD.click();
      expect(idCallOrder.length).toBe(3);
      expect(idCallOrder[0]).toBe(CHILD);
      expect(idCallOrder[1]).toBe(PARENT);
      expect(idCallOrder[2]).toBe(GRANDPARENT);
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          error: expect.any(Error),
          message: 'Handler interrupted',
        }),
      );
    } finally {
      window.removeEventListener('error', errorHandler);
    }
  });

  /** 测试场景：验证「should set currentTarget」描述的渲染、交互或错误处理结果。 */
  it('should set currentTarget', async () => {
    await renderTree();
    await putListener(CHILD, ON_CLICK_KEY, function (event) {
      recordID(CHILD);
      expect(event.currentTarget).toBe(CHILD);
    });
    await putListener(PARENT, ON_CLICK_KEY, function (event) {
      recordID(PARENT);
      expect(event.currentTarget).toBe(PARENT);
    });
    await putListener(GRANDPARENT, ON_CLICK_KEY, function (event) {
      recordID(GRANDPARENT);
      expect(event.currentTarget).toBe(GRANDPARENT);
    });
    await act(() => {
      CHILD.click();
    });
    expect(idCallOrder.length).toBe(3);
    expect(idCallOrder[0]).toBe(CHILD);
    expect(idCallOrder[1]).toBe(PARENT);
    expect(idCallOrder[2]).toBe(GRANDPARENT);
  });

  /** 测试场景：验证「should support stopPropagation()」描述的渲染、交互或错误处理结果。 */
  it('should support stopPropagation()', async () => {
    await renderTree();
    await putListener(CHILD, ON_CLICK_KEY, recordID.bind(null, CHILD));
    await putListener(
      PARENT,
      ON_CLICK_KEY,
      recordIDAndStopPropagation.bind(null, PARENT),
    );
    await putListener(
      GRANDPARENT,
      ON_CLICK_KEY,
      recordID.bind(null, GRANDPARENT),
    );
    await act(() => {
      CHILD.click();
    });
    expect(idCallOrder.length).toBe(2);
    expect(idCallOrder[0]).toBe(CHILD);
    expect(idCallOrder[1]).toBe(PARENT);
  });

  /** 测试场景：验证「should support overriding .isPropagationStopped()」描述的渲染、交互或错误处理结果。 */
  it('should support overriding .isPropagationStopped()', async () => {
    await renderTree();
      // 这种处理并不理想；参见 D4504876。
    await putListener(CHILD, ON_CLICK_KEY, recordID.bind(null, CHILD));
    await putListener(PARENT, ON_CLICK_KEY, function (e) {
      recordID(PARENT, e);
      // 这样就能阻止React ,但避免触摸原生事件
      e.isPropagationStopped = () => true;
    });
    await putListener(
      GRANDPARENT,
      ON_CLICK_KEY,
      recordID.bind(null, GRANDPARENT),
    );
    await act(() => {
      CHILD.click();
    });
    expect(idCallOrder.length).toBe(2);
    expect(idCallOrder[0]).toBe(CHILD);
    expect(idCallOrder[1]).toBe(PARENT);
  });

  /** 测试场景：验证「should stop after first dispatch if stopPropagation」描述的渲染、交互或错误处理结果。 */
  it('should stop after first dispatch if stopPropagation', async () => {
    await renderTree();
    await putListener(
      CHILD,
      ON_CLICK_KEY,
      recordIDAndStopPropagation.bind(null, CHILD),
    );
    await putListener(PARENT, ON_CLICK_KEY, recordID.bind(null, PARENT));
    await putListener(
      GRANDPARENT,
      ON_CLICK_KEY,
      recordID.bind(null, GRANDPARENT),
    );
    await act(() => {
      CHILD.click();
    });
    expect(idCallOrder.length).toBe(1);
    expect(idCallOrder[0]).toBe(CHILD);
  });

  /** 测试场景：验证「should not stopPropagation if false is returned」描述的渲染、交互或错误处理结果。 */
  it('should not stopPropagation if false is returned', async () => {
    await renderTree();
    await putListener(
      CHILD,
      ON_CLICK_KEY,
      recordIDAndReturnFalse.bind(null, CHILD),
    );
    await putListener(PARENT, ON_CLICK_KEY, recordID.bind(null, PARENT));
    await putListener(
      GRANDPARENT,
      ON_CLICK_KEY,
      recordID.bind(null, GRANDPARENT),
    );
    await act(() => {
      CHILD.click();
    });
    expect(idCallOrder.length).toBe(3);
    expect(idCallOrder[0]).toBe(CHILD);
    expect(idCallOrder[1]).toBe(PARENT);
    expect(idCallOrder[2]).toBe(GRANDPARENT);
  });

  /**
   * 整个事件注册状态应在事件发生时应为 "locked-in"。 这主要是为了处理从较低层级的监听器导致在较
   * 高层级的结构变化时出现的许多边缘情况。 如果此较低层级的节点导致在更高层级渲染新内容，则需要
   * 进行处理。 我们需要小心不要调用这些新的监听器。
   */

  /** 测试场景：验证「should invoke handlers that were removed while bubbling」描述的渲染、交互或错误处理结果。 */
  it('should invoke handlers that were removed while bubbling', async () => {
    await renderTree();
    const handleParentClick = jest.fn();
    /** `handleChildClick`：封装当前用例复用的操作、回调或断言步骤。 */
    const handleChildClick = async function (event) {
      await deleteAllListeners(PARENT);
    };
    await putListener(CHILD, ON_CLICK_KEY, handleChildClick);
    await putListener(PARENT, ON_CLICK_KEY, handleParentClick);
    await act(() => {
      CHILD.click();
    });
    expect(handleParentClick).toHaveBeenCalledTimes(1);
  });

  /** 测试场景：验证「should not invoke newly inserted handlers while bubbling」描述的渲染、交互或错误处理结果。 */
  it('should not invoke newly inserted handlers while bubbling', async () => {
    await renderTree();
    const handleParentClick = jest.fn();
    /** `handleChildClick`：封装当前用例复用的操作、回调或断言步骤。 */
    const handleChildClick = async function (event) {
      await putListener(PARENT, ON_CLICK_KEY, handleParentClick);
    };
    await putListener(CHILD, ON_CLICK_KEY, handleChildClick);
    await act(() => {
      CHILD.click();
    });
    expect(handleParentClick).toHaveBeenCalledTimes(0);
  });
});
