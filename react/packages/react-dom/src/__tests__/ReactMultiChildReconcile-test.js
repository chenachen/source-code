/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** 固定本文件使用的 React 模块引用，供类 fixture 和元素创建。 */
const React = require('react');
/** 引入现代 DOM 根 API，所有序列在独立容器的 createRoot 中更新。 */
const ReactDOMClient = require('react-dom/client');
/** 引入 act，确保每轮 root.render 的提交结束后再读取 ref 和 DOM。 */
const act = require('internal-test-utils').act;

/** 仅收集对象自有且非 null/undefined 的键，用于把已清空 ref 与空状态项排除后比较。 */
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
 * 用唯一内部状态标识组件实例，验证按 key 移动子节点时保留原实例状态。
 */
/** 给每次实例挂载分配递增内部编号，用编号检查同 key 重排的状态保留。 */
class StatusDisplay extends React.Component {
  /** 为当前实例保存不可随 props 更新改变的编号；重新挂载会得到新号。 */
  state = {internalState: idCounter++};

  /** 读取最新 status prop，验证复用实例仍接到新状态。 */
  getStatus() {
    return this.props.status;
  }

  /** 返回挂载时编号，让序列比较实例状态是否保留。 */
  getInternalState() {
    return this.state.internalState;
  }

  /** 调用父 onFlush，在子挂载布局时检查排在其前面的 ref。 */
  componentDidMount() {
    this.props.onFlush();
  }

  /** 更新布局同样触发父 ref 顺序检查。 */
  componentDidUpdate() {
    this.props.onFlush();
  }

  /** 把 contentKey 写到 DOM，便于比较逻辑键与实际节点顺序。 */
  render() {
    return <div>{this.props.contentKey}</div>;
  }
}

/**
 * 显示朋友的状态。
 */
/** 按状态映射键创建有 key 的 StatusDisplay，并用 ref 表保存当前实例；空状态由 fixture 转为 null child。 */
class FriendsStatusDisplay extends React.Component {
  /** 按键收集 ref；卸载回调会写 null，枚举顺序不作为渲染顺序依据。 */
  displays = {};

  /**
   * 按 usernameToStatus 的键顺序收集状态为真值的子项；displays 的 ref 枚举顺序不代表渲染顺序。
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
  /** 按输入真值键顺序重新组装实例表，避免 ref 属性赋值历史影响逻辑顺序。 */
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
   * 每个子项在 didMount/didUpdate 中调用此检查；本测试据此约束同级 ref 的提交顺序。
   */
  /** 只验证 flushedKey 之前的兄弟 ref 已就绪；遇到当前键立即返回，不检查当前项自身。 */
  verifyPreviousRefsResolved(flushedKey) {
    const originalKeys = this.getOriginalKeys();
    for (let i = 0; i < originalKeys.length; i++) {
      const key = originalKeys[i];
      if (key === flushedKey) {
        // 只检查当前键之前的子项；当前项 ref 的赋值时机不由这里断言。
        return;
      }
      expect(this.displays[key]).toBeTruthy();
    }
  }

  /** 将假值状态转为 null，否则生成键控子组件；每轮新 ref 记录实例，onFlush 绑定当前键，prepareChildren 选择数组或 iterable 外形。 */
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

/** 按当前用户名建立内部编号快照，供下一轮检查保留项身份。 */
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
/** 对非空输入状态与非空 ref 双向逐项比较，并比较键顺序；不直接比较 DOM，DOM 顺序另由 verifyDomOrderingAccurate 检查。 */
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
 * 比较更新前后同 key 的 StatusDisplay 内部编号，验证重排会保留组件状态。
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
/** 将容器内各子 DOM 的文本 key 与按输入顺序组装的实例 props.contentKey 比较，验证物理节点次序。 */
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

/** 在独立根逐轮渲染状态序列：首轮只核对状态；后续每轮核对 props、原 key 编号和 DOM 次序，再更新编号快照。 */
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

/** 保留 children 数组原样，作为无迭代包装的基准路径。 */
function prepareChildrenArray(childrenArray) {
  return childrenArray;
}

/** 把 children 数组包装为每次能重新遍历的传统 @@iterator 对象。 */
function prepareChildrenLegacyIterable(childrenArray) {
  return {
    /** 每次创建新 generator 并顺序 yield 数组项，包括 fixture 的 null 占位。 */
    '@@iterator': function* () {
      // eslint-disable-next-line no-for-of-loops/no-for-of-loops
      for (const child of childrenArray) {
        yield child;
      }
    },
  };
}

/** 把同一 children 数组包装为 Symbol.iterator iterable。 */
function prepareChildrenModernIterable(childrenArray) {
  return {
    /** 每次迭代创建新 generator，保证多轮遍历不共享耗尽状态。 */
    [Symbol.iterator]: function* () {
      // eslint-disable-next-line no-for-of-loops/no-for-of-loops
      for (const child of childrenArray) {
        yield child;
      }
    },
  };
}

/** 用数组、@@iterator、Symbol.iterator 三种形式分别运行同一完整序列，使每种形式都有独立根和实例编号。 */
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

  /** 数组 child jcw 挂载后删除，再用相同 key 加回；ref 消失后重新出现且内部编号改变，验证跨删除提交不保留实例状态。 */
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

  /** 用 @@iterator iterable 执行 jcw 挂载→删除→同 key 加回；重新挂载编号不同，覆盖传统迭代入口下的状态重置。 */
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

  /** 用 Symbol.iterator iterable 执行 jcw 挂载→删除→同 key 加回；重新挂载编号不同，覆盖现代迭代入口下的状态重置。 */
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

  /** 仅挂载 jcw/awalke/bob 三项，分别用数组、传统及现代 iterable 比较 ref 状态与输入键；此单步序列不做跨轮内部编号保留检查。 */
  it('should create unique identity', async () => {
    // 测试基础。
    const usernameToStatus = {
      jcw: 'jcwStatus',
      awalke: 'awalkeStatus',
      bob: 'bobStatus',
    };

    await testPropsSequence([{usernameToStatus: usernameToStatus}]);
  });

  /** jcw/jordanjcw 顺序保持、仅更新状态字符串；三种 children 形式均更新 props、保留内部编号且 DOM 顺序不变。 */
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

  /** 从空状态映射加入 first；三种 children 形式均出现对应状态与 DOM，验证零到一的插入。 */
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

  /** 从 first 单项改为空映射；三种 children 形式均删除 DOM 与状态项，验证一到零。 */
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

  /** 从 first 单项改为未提供 usernameToStatus；fixture 生成空 children，三种形式均删除原项。 */
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

  /** 从未提供 usernameToStatus 改为 first 单项；三种 children 形式均生成新项及对应 DOM。 */
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

  /** 从空映射改为缺省 usernameToStatus；三种 children 形式均保持无项，验证两种空输入转换。 */
  it('should transition from zero children to null children', async () => {
    await testPropsSequence([
      {
        usernameToStatus: {},
      },
      {},
    ]);
  });

  /** 从缺省 usernameToStatus 改为空映射；三种 children 形式仍无项，覆盖反向空输入转换。 */
  it('should transition from null children to zero children', async () => {
    await testPropsSequence([
      {},
      {
        usernameToStatus: {},
      },
    ]);
  });

  /**
   * 状态为 null 时，FriendsStatusDisplay 生成 null child；本组验证该 fixture 过滤与保留键的协调结果。
   */
  /** 把首项 jcw 状态置 null、保留并更新 jordanjcw；fixture 过滤空项，验证剩余项编号和 DOM 顺序。 */
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

  /** 把尾项 jordanjcw 置 null、更新 jcw；验证尾部删除后 jcw 状态与实例编号保留。 */
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

  /** userOne/userTwo 交换输入键顺序；三种 children 形式均交换 DOM、保持各自内部编号，验证 key 移动。 */
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

  /** 三项顺序完全反转；验证 DOM 与新输入顺序相符而每个原 key 的内部状态不变。 */
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

  /** 四项每轮把首项移到末尾，完整循环回原顺序；每轮验证 props、编号保留和 DOM 顺序，覆盖多次连续移动。 */
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

  /** 四项每轮把末项移到首位，完整反向循环；逐轮验证状态与 DOM，覆盖相反方向的移动。 */
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

  /** 保留 jordanjcw、将旧 jcw 置 null 并增加 another:null；fixture 不渲染两空项，验证删除与忽略新空项同时发生。 */
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

  /** 四项输入改为 jordanjcw/joe/jcw，删除 john 并移动其余项；验证现存 key 编号保留和 DOM 新次序。 */
  it('should remove nulled out children and reorder remaining', async () => {
    const PROPS_SEQUENCE = [
      {
        usernameToStatus: {
          jcw: 'jcwStatus',
          jordanjcw: 'jordanjcwStatus',
          john: 'johnStatus', // 下一轮删除 john，同时移动保留的 jcw。
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

  /** 在 jcw/jordanjcw 后追加一个新 key；验证原两项状态保留、新项出现且 DOM 追加到末尾。 */
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

  /** 在原两项后追加两个新 key；验证多个新节点尾部插入与现存实例复用。 */
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

  /** 在原两项前插入 newUsername；验证新项在首位而两原 key 内部编号不变。 */
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

  /** 在原两项前插入两个新 key；验证多项前插与旧节点次序、状态保留。 */
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

  /** 在原两项前加入 emptyUsername:null；fixture 过滤它，三种形式均保持原 DOM 两项。 */
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

  /** 在原两项尾部加入 null 状态项；验证不创建额外 DOM 且原实例状态不变。 */
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

  /** 在两项中间加入三个 null 状态，同时更新两端状态；验证空占位不输出 DOM，真实项更新且保留实例。 */
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

  /** 在原两项中间插入一个真值项并更新两端状态；验证中间位置正确、原项编号保留。 */
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

  /** 在两端之间插入三个真值项；验证连续中间插入和两原 key 的状态保留。 */
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

  /** 初始中间三个 key 均为 null，更新成真值状态；验证原来未挂载的空位置生成节点，而两端实例继续复用。 */
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
