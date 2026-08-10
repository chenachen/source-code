/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** `React`：保存当前测试场景复用的夹具、状态或回调。 */
const React = require('react');
/** `ReactDOMClient`：保存当前测试场景复用的夹具、状态或回调。 */
const ReactDOMClient = require('react-dom/client');
/** `act`：保存当前测试场景复用的夹具、状态或回调。 */
const act = require('internal-test-utils').act;

/** `stripEmptyValues`：封装当前用例复用的操作、回调或断言步骤。 */
const stripEmptyValues = function (obj) {
  const ret = {};
  for (const name in obj) {
    if (!obj.hasOwnProperty(name)) {
      continue;
    }
    if (obj[name] !== null && obj[name] !== undefined) {
      ret[name] = obj[name];
    }
  }
  return ret;
};

let idCounter = 123;

/**
 * 包含内部静态内部状态，以测试更新现有子组件时不会重新初始化组件。 当移动子节点时 - 重用现有
 * DOM/内存资源。
 */
class StatusDisplay extends React.Component {
  /** `StatusDisplay.state`：记录测试夹具在当前场景中的状态。 */
  state = {internalState: idCounter++};

  /** `StatusDisplay.getStatus`：实现测试夹具的生命周期、渲染或交互步骤。 */
  getStatus() {
    return this.props.status;
  }

  /** `StatusDisplay.getInternalState`：实现测试夹具的生命周期、渲染或交互步骤。 */
  getInternalState() {
    return this.state.internalState;
  }

  /** `StatusDisplay.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
  componentDidMount() {
    this.props.onFlush();
  }

  /** `StatusDisplay.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
  componentDidUpdate() {
    this.props.onFlush();
  }

  /** `StatusDisplay.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
  render() {
    return <div>{this.props.contentKey}</div>;
  }
}

/**
 * 显示朋友的状态。
 */
class FriendsStatusDisplay extends React.Component {
  /** `FriendsStatusDisplay.displays`：记录测试夹具在当前场景中的状态。 */
  displays = {};

  /**
   * 获取每个渲染子元素的 `index` 字段直接的顺序。 Ref 不会按照渲染顺序进行维护。 没有任何一个
   * "代码"的.
   */
  getOriginalKeys() {
    const originalKeys = [];
    for (const key in this.props.usernameToStatus) {
      if (this.props.usernameToStatus[key]) {
        originalKeys.push(key);
      }
    }
    return originalKeys;
  }

  /**
   * 获取渲染后的子元素，并以友好的格式进行比较，以便与输入进行对比 `this.props.usernameToStatus`。
   */
  getStatusDisplays() {
    const res = {};
    const originalKeys = this.getOriginalKeys();
    for (let i = 0; i < originalKeys.length; i++) {
      const key = originalKeys[i];
      res[key] = this.displays[key];
    }
    return res;
  }

  /**
   * 验证某个子项提交时，排在它之前出现的 ref 都已经完成解析。
   * TODO：增量 reconciler 可能使这个假设失效，但内部层 API 目前依赖它；在让 ref 解析时序变得不确定
   * 之前，需要先把该 API 改成更具声明性的形式。
   */
  verifyPreviousRefsResolved(flushedKey) {
    const originalKeys = this.getOriginalKeys();
    for (let i = 0; i < originalKeys.length; i++) {
      const key = originalKeys[i];
      if (key === flushedKey) {
        // 我们只关心当前键及其之前的子项。
        return;
      }
      expect(this.displays[key]).toBeTruthy();
    }
  }

  /** `FriendsStatusDisplay.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
  render() {
    const children = [];
    for (const key in this.props.usernameToStatus) {
      const status = this.props.usernameToStatus[key];
      children.push(
        !status ? null : (
          <StatusDisplay
            key={key}
            ref={current => {
              this.displays[key] = current;
            }}
            contentKey={key}
            onFlush={this.verifyPreviousRefsResolved.bind(this, key)}
            status={status}
          />
        ),
      );
    }
    const childrenToRender = this.props.prepareChildren(children);
    return <div>{childrenToRender}</div>;
  }
}

/** `getInternalStateByUserName`：封装当前用例复用的操作、回调或断言步骤。 */
function getInternalStateByUserName(statusDisplays) {
  return Object.keys(statusDisplays).reduce((acc, key) => {
    acc[key] = statusDisplays[key].getInternalState();
    return acc;
  }, {});
}

/**
 * 验证渲染的 `StatusDisplay` 实例与负责分配它们的 `props` 匹配。 检查用户状态消息的内容以及它
 * 们的顺序。
 */
function verifyStatuses(statusDisplays, props) {
  const nonEmptyStatusDisplays = stripEmptyValues(statusDisplays);
  const nonEmptyStatusProps = stripEmptyValues(props.usernameToStatus);
  let username;
  expect(Object.keys(nonEmptyStatusDisplays).length).toEqual(
    Object.keys(nonEmptyStatusProps).length,
  );
  for (username in nonEmptyStatusDisplays) {
    if (!nonEmptyStatusDisplays.hasOwnProperty(username)) {
      continue;
    }
    expect(nonEmptyStatusDisplays[username].getStatus()).toEqual(
      nonEmptyStatusProps[username],
    );
  }

  // 现在转向确保我们没有遗漏任何东西。
  for (username in nonEmptyStatusProps) {
    if (!nonEmptyStatusProps.hasOwnProperty(username)) {
      continue;
    }
    expect(nonEmptyStatusDisplays[username].getStatus()).toEqual(
      nonEmptyStatusProps[username],
    );
  }

  expect(Object.keys(nonEmptyStatusDisplays)).toEqual(
    Object.keys(nonEmptyStatusProps),
  );
}

/**
 * 对于序列中所有存在的状态显示，都存在。 确保状态已保留在组件中。 `StatusDisplay` 包含一个唯一
 * 数字，用于在排序移动期间跟踪内部状态。
 */
function verifyStatesPreserved(lastInternalStates, statusDisplays) {
  let key;
  for (key in statusDisplays) {
    if (!statusDisplays.hasOwnProperty(key)) {
      continue;
    }
    if (lastInternalStates[key]) {
      expect(lastInternalStates[key]).toEqual(
        statusDisplays[key].getInternalState(),
      );
    }
  }
}

/**
 * 验证一组 `renderedChildren` 的内部表示是否准确反映了 DOM 中的内容。
 */
function verifyDomOrderingAccurate(outerContainer, statusDisplays) {
  const containerNode = outerContainer.firstChild;
  const statusDisplayNodes = containerNode.childNodes;
  const orderedDomKeys = [];
  for (let i = 0; i < statusDisplayNodes.length; i++) {
    const contentKey = statusDisplayNodes[i].textContent;
    orderedDomKeys.push(contentKey);
  }

  const orderedLogicalKeys = [];
  let username;
  for (username in statusDisplays) {
    if (!statusDisplays.hasOwnProperty(username)) {
      continue;
    }
    const statusDisplay = statusDisplays[username];
    orderedLogicalKeys.push(statusDisplay.props.contentKey);
  }
  expect(orderedDomKeys).toEqual(orderedLogicalKeys);
}

/** `testPropsSequenceWithPreparedChildren`：封装当前用例复用的操作、回调或断言步骤。 */
async function testPropsSequenceWithPreparedChildren(
  sequence,
  prepareChildren,
) {
  const container = document.createElement('div');
  const root = ReactDOMClient.createRoot(container);
  let parentInstance;
  await act(() => {
    root.render(
      <FriendsStatusDisplay
        {...sequence[0]}
        prepareChildren={prepareChildren}
        ref={current => {
          if (parentInstance === undefined) {
            parentInstance = current;
          }
        }}
      />,
    );
  });
  let statusDisplays = parentInstance.getStatusDisplays();
  let lastInternalStates = getInternalStateByUserName(statusDisplays);
  verifyStatuses(statusDisplays, sequence[0]);

  for (let i = 1; i < sequence.length; i++) {
    await act(() => {
      root.render(
        <FriendsStatusDisplay
          {...sequence[i]}
          prepareChildren={prepareChildren}
        />,
      );
    });

    statusDisplays = parentInstance.getStatusDisplays();
    verifyStatuses(statusDisplays, sequence[i]);
    verifyStatesPreserved(lastInternalStates, statusDisplays);
    verifyDomOrderingAccurate(container, statusDisplays);

    lastInternalStates = getInternalStateByUserName(statusDisplays);
  }
}

/** `prepareChildrenArray`：封装当前用例复用的操作、回调或断言步骤。 */
function prepareChildrenArray(childrenArray) {
  return childrenArray;
}

/** `prepareChildrenLegacyIterable`：封装当前用例复用的操作、回调或断言步骤。 */
function prepareChildrenLegacyIterable(childrenArray) {
  return {
    /** `prepareChildrenLegacyIterable.@@iterator`：封装当前用例复用的操作、回调或断言步骤。 */
    '@@iterator': function* () {
      // eslint-disable-next-line no-for-of-loops/no-for-of-loops
      for (const child of childrenArray) {
        yield child;
      }
    },
  };
}

/** `prepareChildrenModernIterable`：封装当前用例复用的操作、回调或断言步骤。 */
function prepareChildrenModernIterable(childrenArray) {
  return {
    /** `Symbol.iterator`：封装当前用例复用的操作、回调或断言步骤。 */
    [Symbol.iterator]: function* () {
      // eslint-disable-next-line no-for-of-loops/no-for-of-loops
      for (const child of childrenArray) {
        yield child;
      }
    },
  };
}

/** `testPropsSequence`：封装当前用例复用的操作、回调或断言步骤。 */
async function testPropsSequence(sequence) {
  await testPropsSequenceWithPreparedChildren(sequence, prepareChildrenArray);
  await testPropsSequenceWithPreparedChildren(
    sequence,
    prepareChildrenLegacyIterable,
  );
  await testPropsSequenceWithPreparedChildren(
    sequence,
    prepareChildrenModernIterable,
  );
}

describe('ReactMultiChildReconcile', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should reset internal state if removed then readded in an array」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should reset internal state if removed then readded in an array', async () => {
    // 测试基础。
    const props = {
      usernameToStatus: {
        jcw: 'jcwStatus',
      },
    };

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let parentInstance;
    await act(() => {
      root.render(
        <FriendsStatusDisplay
          {...props}
          prepareChildren={prepareChildrenArray}
          ref={current => {
            if (parentInstance === undefined) {
              parentInstance = current;
            }
          }}
        />,
      );
    });
    let statusDisplays = parentInstance.getStatusDisplays();
    const startingInternalState = statusDisplays.jcw.getInternalState();

    // 移除子节点。
    await act(() => {
      root.render(
        <FriendsStatusDisplay prepareChildren={prepareChildrenArray} />,
      );
    });

    statusDisplays = parentInstance.getStatusDisplays();
    expect(statusDisplays.jcw).toBeFalsy();

    // 现在重置导致有子元素的属性
    await act(() => {
      root.render(
        <FriendsStatusDisplay
          {...props}
          prepareChildren={prepareChildrenArray}
        />,
      );
    });

    statusDisplays = parentInstance.getStatusDisplays();
    expect(statusDisplays.jcw).toBeTruthy();
    expect(statusDisplays.jcw.getInternalState()).not.toBe(
      startingInternalState,
    );
  });

  /** 测试场景：验证「should reset internal state if removed then readded in a legacy iterable」描述的渲染、交互或错误处理结果。 */
  it('should reset internal state if removed then readded in a legacy iterable', async () => {
    // 测试基础。
    const props = {
      usernameToStatus: {
        jcw: 'jcwStatus',
      },
    };

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let parentInstance;
    await act(() => {
      root.render(
        <FriendsStatusDisplay
          {...props}
          prepareChildren={prepareChildrenLegacyIterable}
          ref={current => {
            if (parentInstance === undefined) {
              parentInstance = current;
            }
          }}
        />,
      );
    });

    let statusDisplays = parentInstance.getStatusDisplays();
    const startingInternalState = statusDisplays.jcw.getInternalState();

    // 移除子节点。
    await act(() => {
      root.render(
        <FriendsStatusDisplay
          prepareChildren={prepareChildrenLegacyIterable}
        />,
      );
    });

    statusDisplays = parentInstance.getStatusDisplays();
    expect(statusDisplays.jcw).toBeFalsy();

    // 现在重置导致有子元素的属性
    await act(() => {
      root.render(
        <FriendsStatusDisplay
          {...props}
          prepareChildren={prepareChildrenLegacyIterable}
        />,
      );
    });

    statusDisplays = parentInstance.getStatusDisplays();
    expect(statusDisplays.jcw).toBeTruthy();
    expect(statusDisplays.jcw.getInternalState()).not.toBe(
      startingInternalState,
    );
  });

  /** 测试场景：验证「should reset internal state if removed then readded in a modern iterable」描述的渲染、交互或错误处理结果。 */
  it('should reset internal state if removed then readded in a modern iterable', async () => {
    // 测试基础。
    const props = {
      usernameToStatus: {
        jcw: 'jcwStatus',
      },
    };

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let parentInstance;
    await act(() => {
      root.render(
        <FriendsStatusDisplay
          {...props}
          prepareChildren={prepareChildrenModernIterable}
          ref={current => {
            if (parentInstance === undefined) {
              parentInstance = current;
            }
          }}
        />,
      );
    });

    let statusDisplays = parentInstance.getStatusDisplays();
    const startingInternalState = statusDisplays.jcw.getInternalState();

    // 移除子节点。
    await act(() => {
      root.render(
        <FriendsStatusDisplay
          prepareChildren={prepareChildrenModernIterable}
        />,
      );
    });

    statusDisplays = parentInstance.getStatusDisplays();
    expect(statusDisplays.jcw).toBeFalsy();

    // 现在重置导致有子元素的属性
    await act(() => {
      root.render(
        <FriendsStatusDisplay
          {...props}
          prepareChildren={prepareChildrenModernIterable}
        />,
      );
    });

    statusDisplays = parentInstance.getStatusDisplays();
    expect(statusDisplays.jcw).toBeTruthy();
    expect(statusDisplays.jcw.getInternalState()).not.toBe(
      startingInternalState,
    );
  });

  /** 测试场景：验证「should create unique identity」描述的渲染、交互或错误处理结果。 */
  it('should create unique identity', async () => {
    // 测试基础。
    const usernameToStatus = {
      jcw: 'jcwStatus',
      awalke: 'awalkeStatus',
      bob: 'bobStatus',
    };

    await testPropsSequence([{usernameToStatus: usernameToStatus}]);
  });

  /** 测试场景：验证「should preserve order if children order has not changed」描述的渲染、交互或错误处理结果。 */
  it('should preserve order if children order has not changed', async () => {
    const PROPS_SEQUENCE = [
      {
        usernameToStatus: {
          jcw: 'jcwStatus',
          jordanjcw: 'jordanjcwStatus',
        },
      },
      {
        usernameToStatus: {
          jcw: 'jcwstatus2',
          jordanjcw: 'jordanjcwstatus2',
        },
      },
    ];
    await testPropsSequence(PROPS_SEQUENCE);
  });

  /** 测试场景：验证「should transition from zero to one children correctly」描述的渲染、交互或错误处理结果。 */
  it('should transition from zero to one children correctly', async () => {
    const PROPS_SEQUENCE = [
      {usernameToStatus: {}},
      {
        usernameToStatus: {
          first: 'firstStatus',
        },
      },
    ];
    await testPropsSequence(PROPS_SEQUENCE);
  });

  /** 测试场景：验证「should transition from one to zero children correctly」描述的渲染、交互或错误处理结果。 */
  it('should transition from one to zero children correctly', async () => {
    const PROPS_SEQUENCE = [
      {
        usernameToStatus: {
          first: 'firstStatus',
        },
      },
      {usernameToStatus: {}},
    ];
    await testPropsSequence(PROPS_SEQUENCE);
  });

  /** 测试场景：验证「should transition from one child to null children」描述的渲染、交互或错误处理结果。 */
  it('should transition from one child to null children', async () => {
    await testPropsSequence([
      {
        usernameToStatus: {
          first: 'firstStatus',
        },
      },
      {},
    ]);
  });

  /** 测试场景：验证「should transition from null children to one child」描述的渲染、交互或错误处理结果。 */
  it('should transition from null children to one child', async () => {
    await testPropsSequence([
      {},
      {
        usernameToStatus: {
          first: 'firstStatus',
        },
      },
    ]);
  });

  /** 测试场景：验证「should transition from zero children to null children」描述的渲染、交互或错误处理结果。 */
  it('should transition from zero children to null children', async () => {
    await testPropsSequence([
      {
        usernameToStatus: {},
      },
      {},
    ]);
  });

  /** 测试场景：验证「should transition from null children to zero children」描述的渲染、交互或错误处理结果。 */
  it('should transition from null children to zero children', async () => {
    await testPropsSequence([
      {},
      {
        usernameToStatus: {},
      },
    ]);
  });

  /**
   * 当渲染为 null 时，将其转换为空子元素（这是 `FriendsStatusDisplay` 的约定）。 与 React 或这些
   * 测试用例无关。
   */
  /** 测试场景：验证「should remove nulled out children at the beginning」描述的渲染、交互或错误处理结果。 */
  it('should remove nulled out children at the beginning', async () => {
    const PROPS_SEQUENCE = [
      {
        usernameToStatus: {
          jcw: 'jcwStatus',
          jordanjcw: 'jordanjcwStatus',
        },
      },
      {
        usernameToStatus: {
          jcw: null,
          jordanjcw: 'jordanjcwstatus2',
        },
      },
    ];
    await testPropsSequence(PROPS_SEQUENCE);
  });

  /** 测试场景：验证「should remove nulled out children at the end」描述的渲染、交互或错误处理结果。 */
  it('should remove nulled out children at the end', async () => {
    const PROPS_SEQUENCE = [
      {
        usernameToStatus: {
          jcw: 'jcwStatus',
          jordanjcw: 'jordanjcwStatus',
        },
      },
      {
        usernameToStatus: {
          jcw: 'jcwstatus2',
          jordanjcw: null,
        },
      },
    ];
    await testPropsSequence(PROPS_SEQUENCE);
  });

  /** 测试场景：验证「should reverse the order of two children」描述的渲染、交互或错误处理结果。 */
  it('should reverse the order of two children', async () => {
    const PROPS_SEQUENCE = [
      {
        usernameToStatus: {
          userOne: 'userOneStatus',
          userTwo: 'userTwoStatus',
        },
      },
      {
        usernameToStatus: {
          userTwo: 'userTwoStatus',
          userOne: 'userOneStatus',
        },
      },
    ];
    await testPropsSequence(PROPS_SEQUENCE);
  });

  /** 测试场景：验证「should reverse the order of more than two children」描述的渲染、交互或错误处理结果。 */
  it('should reverse the order of more than two children', async () => {
    const PROPS_SEQUENCE = [
      {
        usernameToStatus: {
          userOne: 'userOneStatus',
          userTwo: 'userTwoStatus',
          userThree: 'userThreeStatus',
        },
      },
      {
        usernameToStatus: {
          userThree: 'userThreeStatus',
          userTwo: 'userTwoStatus',
          userOne: 'userOneStatus',
        },
      },
    ];
    await testPropsSequence(PROPS_SEQUENCE);
  });

  /** 测试场景：验证「should cycle order correctly」描述的渲染、交互或错误处理结果。 */
  it('should cycle order correctly', async () => {
    const PROPS_SEQUENCE = [
      {
        usernameToStatus: {
          userOne: 'userOneStatus',
          userTwo: 'userTwoStatus',
          userThree: 'userThreeStatus',
          userFour: 'userFourStatus',
        },
      },
      {
        usernameToStatus: {
          userTwo: 'userTwoStatus',
          userThree: 'userThreeStatus',
          userFour: 'userFourStatus',
          userOne: 'userOneStatus',
        },
      },
      {
        usernameToStatus: {
          userThree: 'userThreeStatus',
          userFour: 'userFourStatus',
          userOne: 'userOneStatus',
          userTwo: 'userTwoStatus',
        },
      },
      {
        usernameToStatus: {
          userFour: 'userFourStatus',
          userOne: 'userOneStatus',
          userTwo: 'userTwoStatus',
          userThree: 'userThreeStatus',
        },
      },
      {
        usernameToStatus: {
          // 完成循环！
          userOne: 'userOneStatus',
          userTwo: 'userTwoStatus',
          userThree: 'userThreeStatus',
          userFour: 'userFourStatus',
        },
      },
    ];
    await testPropsSequence(PROPS_SEQUENCE);
  });

  /** 测试场景：验证「should cycle order correctly in the other direction」描述的渲染、交互或错误处理结果。 */
  it('should cycle order correctly in the other direction', async () => {
    const PROPS_SEQUENCE = [
      {
        usernameToStatus: {
          userOne: 'userOneStatus',
          userTwo: 'userTwoStatus',
          userThree: 'userThreeStatus',
          userFour: 'userFourStatus',
        },
      },
      {
        usernameToStatus: {
          userFour: 'userFourStatus',
          userOne: 'userOneStatus',
          userTwo: 'userTwoStatus',
          userThree: 'userThreeStatus',
        },
      },
      {
        usernameToStatus: {
          userThree: 'userThreeStatus',
          userFour: 'userFourStatus',
          userOne: 'userOneStatus',
          userTwo: 'userTwoStatus',
        },
      },
      {
        usernameToStatus: {
          userTwo: 'userTwoStatus',
          userThree: 'userThreeStatus',
          userFour: 'userFourStatus',
          userOne: 'userOneStatus',
        },
      },
      {
        usernameToStatus: {
          // 完成循环！
          userOne: 'userOneStatus',
          userTwo: 'userTwoStatus',
          userThree: 'userThreeStatus',
          userFour: 'userFourStatus',
        },
      },
    ];
    await testPropsSequence(PROPS_SEQUENCE);
  });

  /** 测试场景：验证「should remove nulled out children and ignore new null children」描述的渲染、交互或错误处理结果。 */
  it('should remove nulled out children and ignore new null children', async () => {
    const PROPS_SEQUENCE = [
      {
        usernameToStatus: {
          jcw: 'jcwStatus',
          jordanjcw: 'jordanjcwStatus',
        },
      },
      {
        usernameToStatus: {
          jordanjcw: 'jordanjcwstatus2',
          jcw: null,
          another: null,
        },
      },
    ];
    await testPropsSequence(PROPS_SEQUENCE);
  });

  /** 测试场景：验证「should remove nulled out children and reorder remaining」描述的渲染、交互或错误处理结果。 */
  it('should remove nulled out children and reorder remaining', async () => {
    const PROPS_SEQUENCE = [
      {
        usernameToStatus: {
          jcw: 'jcwStatus',
          jordanjcw: 'jordanjcwStatus',
          john: 'johnStatus', // 约翰会走了
          joe: 'joeStatus',
        },
      },
      {
        usernameToStatus: {
          jordanjcw: 'jordanjcwStatus',
          joe: 'joeStatus',
          jcw: 'jcwStatus',
        },
      },
    ];
    await testPropsSequence(PROPS_SEQUENCE);
  });

  /** 测试场景：验证「should append children to the end」描述的渲染、交互或错误处理结果。 */
  it('should append children to the end', async () => {
    const PROPS_SEQUENCE = [
      {
        usernameToStatus: {
          jcw: 'jcwStatus',
          jordanjcw: 'jordanjcwStatus',
        },
      },
      {
        usernameToStatus: {
          jcw: 'jcwStatus',
          jordanjcw: 'jordanjcwStatus',
          jordanjcwnew: 'jordanjcwnewStatus',
        },
      },
    ];
    await testPropsSequence(PROPS_SEQUENCE);
  });

  /** 测试场景：验证「should append multiple children to the end」描述的渲染、交互或错误处理结果。 */
  it('should append multiple children to the end', async () => {
    const PROPS_SEQUENCE = [
      {
        usernameToStatus: {
          jcw: 'jcwStatus',
          jordanjcw: 'jordanjcwStatus',
        },
      },
      {
        usernameToStatus: {
          jcw: 'jcwStatus',
          jordanjcw: 'jordanjcwStatus',
          jordanjcwnew: 'jordanjcwnewStatus',
          jordanjcwnew2: 'jordanjcwnewStatus2',
        },
      },
    ];
    await testPropsSequence(PROPS_SEQUENCE);
  });

  /** 测试场景：验证「should prepend children to the beginning」描述的渲染、交互或错误处理结果。 */
  it('should prepend children to the beginning', async () => {
    const PROPS_SEQUENCE = [
      {
        usernameToStatus: {
          jcw: 'jcwStatus',
          jordanjcw: 'jordanjcwStatus',
        },
      },
      {
        usernameToStatus: {
          newUsername: 'newUsernameStatus',
          jcw: 'jcwStatus',
          jordanjcw: 'jordanjcwStatus',
        },
      },
    ];
    await testPropsSequence(PROPS_SEQUENCE);
  });

  /** 测试场景：验证「should prepend multiple children to the beginning」描述的渲染、交互或错误处理结果。 */
  it('should prepend multiple children to the beginning', async () => {
    const PROPS_SEQUENCE = [
      {
        usernameToStatus: {
          jcw: 'jcwStatus',
          jordanjcw: 'jordanjcwStatus',
        },
      },
      {
        usernameToStatus: {
          newNewUsername: 'newNewUsernameStatus',
          newUsername: 'newUsernameStatus',
          jcw: 'jcwStatus',
          jordanjcw: 'jordanjcwStatus',
        },
      },
    ];
    await testPropsSequence(PROPS_SEQUENCE);
  });

  /** 测试场景：验证「should not prepend an empty child to the beginning」描述的渲染、交互或错误处理结果。 */
  it('should not prepend an empty child to the beginning', async () => {
    const PROPS_SEQUENCE = [
      {
        usernameToStatus: {
          jcw: 'jcwStatus',
          jordanjcw: 'jordanjcwStatus',
        },
      },
      {
        usernameToStatus: {
          emptyUsername: null,
          jcw: 'jcwStatus',
          jordanjcw: 'jordanjcwStatus',
        },
      },
    ];
    await testPropsSequence(PROPS_SEQUENCE);
  });

  /** 测试场景：验证「should not append an empty child to the end」描述的渲染、交互或错误处理结果。 */
  it('should not append an empty child to the end', async () => {
    const PROPS_SEQUENCE = [
      {
        usernameToStatus: {
          jcw: 'jcwStatus',
          jordanjcw: 'jordanjcwStatus',
        },
      },
      {
        usernameToStatus: {
          jcw: 'jcwStatus',
          jordanjcw: 'jordanjcwStatus',
          emptyUsername: null,
        },
      },
    ];
    await testPropsSequence(PROPS_SEQUENCE);
  });

  /** 测试场景：验证「should not insert empty children in the middle」描述的渲染、交互或错误处理结果。 */
  it('should not insert empty children in the middle', async () => {
    const PROPS_SEQUENCE = [
      {
        usernameToStatus: {
          jcw: 'jcwStatus',
          jordanjcw: 'jordanjcwStatus',
        },
      },
      {
        usernameToStatus: {
          jcw: 'jcwstatus2',
          skipOverMe: null,
          skipOverMeToo: null,
          definitelySkipOverMe: null,
          jordanjcw: 'jordanjcwstatus2',
        },
      },
    ];
    await testPropsSequence(PROPS_SEQUENCE);
  });

  /** 测试场景：验证「should insert one new child in the middle」描述的渲染、交互或错误处理结果。 */
  it('should insert one new child in the middle', async () => {
    const PROPS_SEQUENCE = [
      {
        usernameToStatus: {
          jcw: 'jcwStatus',
          jordanjcw: 'jordanjcwStatus',
        },
      },
      {
        usernameToStatus: {
          jcw: 'jcwstatus2',
          insertThis: 'insertThisStatus',
          jordanjcw: 'jordanjcwstatus2',
        },
      },
    ];
    await testPropsSequence(PROPS_SEQUENCE);
  });

  /** 测试场景：验证「should insert multiple new truthy children in the middle」描述的渲染、交互或错误处理结果。 */
  it('should insert multiple new truthy children in the middle', async () => {
    const PROPS_SEQUENCE = [
      {
        usernameToStatus: {
          jcw: 'jcwStatus',
          jordanjcw: 'jordanjcwStatus',
        },
      },
      {
        usernameToStatus: {
          jcw: 'jcwstatus2',
          insertThis: 'insertThisStatus',
          insertThisToo: 'insertThisTooStatus',
          definitelyInsertThisToo: 'definitelyInsertThisTooStatus',
          jordanjcw: 'jordanjcwstatus2',
        },
      },
    ];
    await testPropsSequence(PROPS_SEQUENCE);
  });

  /** 测试场景：验证「should insert non-empty children in middle where nulls were」描述的渲染、交互或错误处理结果。 */
  it('should insert non-empty children in middle where nulls were', async () => {
    const PROPS_SEQUENCE = [
      {
        usernameToStatus: {
          jcw: 'jcwStatus',
          insertThis: null,
          insertThisToo: null,
          definitelyInsertThisToo: null,
          jordanjcw: 'jordanjcwStatus',
        },
      },
      {
        usernameToStatus: {
          jcw: 'jcwstatus2',
          insertThis: 'insertThisStatus',
          insertThisToo: 'insertThisTooStatus',
          definitelyInsertThisToo: 'definitelyInsertThisTooStatus',
          jordanjcw: 'jordanjcwstatus2',
        },
      },
    ];
    await testPropsSequence(PROPS_SEQUENCE);
  });
});
