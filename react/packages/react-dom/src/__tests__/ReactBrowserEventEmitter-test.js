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

/** 把节点或名称按调用顺序记录到当前case数组，比较合成冒泡次序。 */
const recordID = function (id) {
  idCallOrder.push(id);
};

/** 先记录id再调用合成stopPropagation，让后续祖先监听不执行。 */
const recordIDAndStopPropagation = function (id, event) {
  recordID(id);
  event.stopPropagation();
};

/** 记录id但仅return false，作为不会自动停止合成传播的对照。 */
const recordIDAndReturnFalse = function (id, event) {
  recordID(id);
  return false;
};

/** 每次setup清空的历史监听mock；本文件当前场景未把它安装到树。 */
const LISTENER = jest.fn();

/** 统一使用onClick props键，putListener通过重渲染更新真实监听props。 */
const ON_CLICK_KEY = 'onClick';

let GRANDPARENT;
let PARENT;
let CHILD;
let BUTTON;

let renderTree;
let putListener;
let deleteAllListeners;

let container;

// 沿用按DOM节点身份指定监听的测试接口；实际通过props字典与root.render安装/删除监听。
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

    /** 输出child宿主div并记录DOM ref，props含监听且随包装组件透传。 */
    function Child(props) {
      return <div ref={c => (CHILD = c)} {...props} />;
    }

    /** Pure包装让祖先独立更新时子级可能跳过render，测试当前祖先监听仍更新。 */
    class ChildWrapper extends React.PureComponent {

      /** 透传自身props给Child，不添加额外DOM祖先。 */
      render() {
        return <Child {...this.props} />;
      }
    }

    const root = ReactDOMClient.createRoot(container);

    /** 在act中渲染固定三层树及disabled按钮，读取各节点ref；事件注册由props变更触发而非内部注册表。 */
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

    /** 按DOM身份修改对应层的props字典后await renderTree提交，替换同eventName的监听。 */
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

    /** 按DOM身份将对应props字典换成空对象并提交，使该层监听移除；不直接拆除根原生事件监听。 */
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

  /** CHILD/PARENT/GRANDPARENT先经props重渲染安装click监听；CHILD.click后记录依次为这三DOM对象，验证合成冒泡按内到外。 */
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

  /** 首轮child点击记录三层名称，再只换grandparent handler且Pure子树可跳过render；下次记录UPDATED_GRANDPARENT，验证派发读取当前祖先props。 */
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

  /** parent click记录后抛Handler interrupted，child/grandparent仍有监听；三层均执行且window error只一次含原Error，验证单监听错误不中止队列，finally清理原生error监听。 */
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

  /** 三层监听各断言event.currentTarget等于自身；CHILD点击仍三层顺序执行，验证每次调用前设置当前目标而非一直使用原target。 */
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

  /** parent监听调用stopPropagation；child→parent后停止，grandparent不执行，验证冒泡途中截断。 */
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

  /** parent只把合成isPropagationStopped改为返回true，未调用原生stop；child→parent后停止，验证分发检查合成谓词。 */
  it('should support overriding .isPropagationStopped()', async () => {
    await renderTree();
      // 这种处理并不理想；参见 D4504876。
    await putListener(CHILD, ON_CLICK_KEY, recordID.bind(null, CHILD));
    await putListener(PARENT, ON_CLICK_KEY, function (e) {
      recordID(PARENT, e);
      // 只改合成传播谓词，分发器会停止后续React监听；本例没有修改原生传播。
      /** 将本次合成事件传播停止谓词替换为true，不改原生事件，测试队列仅依合成标志停止。 */
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

  /** child第一监听即stopPropagation；只有child记录，验证目标处理器就能截断后续祖先。 */
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

  /** child仅return false；仍child→parent→grandparent三次，验证返回值不等于stopPropagation。 */
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

  /** child异步handler更新props删除parent监听；本次点击parent仍一次，验证本次派发已收集监听列表，随后删除不改变快照。 */
  it('should invoke handlers that were removed while bubbling', async () => {
    await renderTree();
    const handleParentClick = jest.fn();

    /** 点击中删除parent props监听并等待提交，本次事件的已收集监听列表应仍包含原parent handler。 */
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

  /** child异步handler给原本无监听parent新增click；本次parent零次，验证更新新增监听不会插入已收集的队列。 */
  it('should not invoke newly inserted handlers while bubbling', async () => {
    await renderTree();
    const handleParentClick = jest.fn();

    /** 点击中新增parent props监听，本次事件已有列表不能因此补入新handler。 */
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
