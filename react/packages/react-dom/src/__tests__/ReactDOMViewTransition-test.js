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
let Suspense;
let SuspenseList;
let ViewTransition;
let act;
let assertLog;
let Scheduler;
let textCache;
let startTransition;

describe('ReactDOMViewTransition', () => {
  let container;

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    assertLog = require('internal-test-utils').assertLog;
    Suspense = React.Suspense;
    ViewTransition = React.ViewTransition;
    startTransition = React.startTransition;
    if (gate(flags => flags.enableSuspenseList)) {
      SuspenseList = React.unstable_SuspenseList;
    }
    container = document.createElement('div');
    document.body.appendChild(container);

    textCache = new Map();
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  /** `resolveText`：封装当前用例复用的操作、回调或断言步骤。 */
  function resolveText(text) {
    const record = textCache.get(text);
    if (record === undefined) {
      const newRecord = {
        status: 'resolved',
        value: text,
      };
      textCache.set(text, newRecord);
    } else if (record.status === 'pending') {
      const thenable = record.value;
      record.status = 'resolved';
      record.value = text;
      thenable.pings.forEach(t => t());
    }
  }

  /** `readText`：封装当前用例复用的操作、回调或断言步骤。 */
  function readText(text) {
    const record = textCache.get(text);
    if (record !== undefined) {
      switch (record.status) {
        case 'pending':
          Scheduler.log(`Suspend! [${text}]`);
          throw record.value;
        case 'rejected':
          throw record.value;
        case 'resolved':
          return record.value;
      }
    } else {
      Scheduler.log(`Suspend! [${text}]`);
      const thenable = {
        pings: [],
        /** `readText.then`：实现测试夹具的生命周期、渲染或交互步骤。 */
        then(resolve) {
          if (newRecord.status === 'pending') {
            thenable.pings.push(resolve);
          } else {
            Promise.resolve().then(() => resolve(newRecord.value));
          }
        },
      };

      const newRecord = {
        status: 'pending',
        value: thenable,
      };
      textCache.set(text, newRecord);

      throw thenable;
    }
  }

  /** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** `AsyncText`：封装当前用例复用的操作、回调或断言步骤。 */
  function AsyncText({text}) {
    readText(text);
    Scheduler.log(text);
    return text;
  }

  // @gate enableSuspenseList
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「handles ViewTransition wrapping Suspense inside SuspenseList」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('handles ViewTransition wrapping Suspense inside SuspenseList', async () => {
    /** `Card`：封装当前用例复用的操作、回调或断言步骤。 */
    function Card({id}) {
      return (
        <div>
          <AsyncText text={`Card ${id}`} />
        </div>
      );
    }

    /** `CardSkeleton`：封装当前用例复用的操作、回调或断言步骤。 */
    function CardSkeleton({n}) {
      return <Text text={`Skeleton ${n}`} />;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <SuspenseList revealOrder="together">
            <ViewTransition>
              <Suspense fallback={<CardSkeleton n={1} />}>
                <Card id={1} />
              </Suspense>
            </ViewTransition>
            <ViewTransition>
              <Suspense fallback={<CardSkeleton n={2} />}>
                <Card id={2} />
              </Suspense>
            </ViewTransition>
            <ViewTransition>
              <Suspense fallback={<CardSkeleton n={3} />}>
                <Card id={3} />
              </Suspense>
            </ViewTransition>
          </SuspenseList>
        </div>
      );
    }

    const root = ReactDOMClient.createRoot(container);

    // 初始渲染：所有卡片都应挂起。
    await act(() => {
      root.render(<App />);
    });

    assertLog([
      'Suspend! [Card 1]',
      'Skeleton 1',
      'Suspend! [Card 2]',
      'Skeleton 2',
      'Suspend! [Card 3]',
      'Skeleton 3',
      'Skeleton 1',
      'Skeleton 2',
      'Skeleton 3',
    ]);

    await act(() => {
      resolveText('Card 1');
      resolveText('Card 2');
      resolveText('Card 3');
    });

    assertLog(['Card 1', 'Card 2', 'Card 3']);

    // 所有卡片都应可见。
    expect(container.textContent).toContain('Card 1');
    expect(container.textContent).toContain('Card 2');
    expect(container.textContent).toContain('Card 3');
  });

  describe('ViewTransition event callbacks', () => {
    let originalGetBoundingClientRect;
    let originalGetAnimations;
    let originalAnimate;
    let originalStartViewTransition;

    beforeEach(() => {
      // 保存原始值
      originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
      originalGetAnimations = Element.prototype.getAnimations;
      originalAnimate = Element.prototype.animate;
      originalStartViewTransition = document.startViewTransition;

      // 模拟 CSS.escape 如果它不存在。
      if (typeof CSS === 'undefined') {
        global.CSS = {
          /** 测试环境使用恒等转义，避免缺失 CSS.escape 阻断选择器路径。 */
          escape: str => str
        };
      } else if (!CSS.escape) {
        CSS.escape = str => str;
      }

      // 模拟 document.fonts
      if (!document.fonts) {
        Object.defineProperty(document, 'fonts', {
          value: {status: 'loaded', ready: Promise.resolve()},
          configurable: true,
        });
      }

      // 模拟 Element.prototype 的 getAnimations 方法（Web Animations API)
      Element.prototype.getAnimations = function () {
        return [];
      };

      // 模拟动画在 Element.prototype (Web Animations API) 上
      Element.prototype.animate = function () {
        return {
          /** 模拟取消当前 Web Animation。 */
          cancel() {}, finished: Promise.resolve()
        };
      };

      // 模拟 getBoundingClientRect 方法以返回基于内容长度的尺寸，以便在文本更改时检测更新。
      Element.prototype.getBoundingClientRect = function () {
        const text = this.textContent || '';
        const width = text.length * 10 + 10;
        const height = 20;
        return new DOMRect(0, 0, width, height);
      };

      // 模拟 document.startViewTransition
      document.startViewTransition = function ({update}) {
        update();
        return {
          ready: Promise.resolve(),
          finished: Promise.resolve(),
          /** `skipTransition`：实现测试夹具的生命周期、渲染或交互步骤。 */
          skipTransition() {},
        };
      };
    });

    afterEach(() => {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      Element.prototype.getAnimations = originalGetAnimations;
      Element.prototype.animate = originalAnimate;
      if (originalStartViewTransition) {
        document.startViewTransition = originalStartViewTransition;
      } else {
        delete document.startViewTransition;
      }
    });

    // @gate enableViewTransition
    /** 测试场景：验证「fires onEnter when a ViewTransition mounts」描述的渲染、交互或错误处理结果。 */
    it('fires onEnter when a ViewTransition mounts', async () => {
      const onEnter = jest.fn();
      const startViewTransitionSpy = jest.fn(document.startViewTransition);
      document.startViewTransition = startViewTransitionSpy;

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({show}) {
        if (!show) {
          return null;
        }
        return (
          <ViewTransition onEnter={onEnter}>
            <div>Hello</div>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      // 初始渲染，没有 ViewTransition
      await act(() => {
        root.render(<App show={false} />);
      });
      expect(onEnter).not.toHaveBeenCalled();
      expect(startViewTransitionSpy).not.toHaveBeenCalled();

      // 挂载 ViewTransition 在 startTransition 之前
      await act(() => {
        startTransition(() => {
          root.render(<App show={true} />);
        });
      });

      expect(startViewTransitionSpy).toHaveBeenCalled();
      expect(onEnter).toHaveBeenCalledTimes(1);
    });

    // @gate enableViewTransition
    /** 测试场景：验证「fires onExit when a ViewTransition unmounts」描述的渲染、交互或错误处理结果。 */
    it('fires onExit when a ViewTransition unmounts', async () => {
      const onExit = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({show}) {
        if (!show) {
          return null;
        }
        return (
          <ViewTransition onExit={onExit}>
            <div>Goodbye</div>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      // 初始渲染，带有 ViewTransition
      await act(() => {
        startTransition(() => {
          root.render(<App show={true} />);
        });
      });
      expect(onExit).not.toHaveBeenCalled();

      // 卸载启动转换内部的 ViewTransition
      await act(() => {
        startTransition(() => {
          root.render(<App show={false} />);
        });
      });

      expect(onExit).toHaveBeenCalledTimes(1);
    });

    // @gate enableViewTransition
    /** 测试场景：验证「fires onUpdate when content inside a ViewTransition changes」描述的渲染、交互或错误处理结果。 */
    it('fires onUpdate when content inside a ViewTransition changes', async () => {
      const onUpdate = jest.fn();
      const onEnter = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({text}) {
        return (
          <ViewTransition onUpdate={onUpdate} onEnter={onEnter}>
            <div>{text}</div>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      // 初始渲染
      await act(() => {
        startTransition(() => {
          root.render(<App text="Short" />);
        });
      });

      onEnter.mockClear();
      expect(onUpdate).not.toHaveBeenCalled();

      // 更新 startTransition 内部的内容（不同的文本长度会导致我们的 mock 中的 getBoundingClientRect
      // 值不同）
      await act(() => {
        startTransition(() => {
          root.render(<App text="Much longer content here" />);
        });
      });

      expect(onUpdate).toHaveBeenCalledTimes(1);
      // onEnter 应该在更新时不会触发
      expect(onEnter).not.toHaveBeenCalled();
    });

    // @gate enableViewTransition
    /** 测试场景：验证「fires onShare for paired named transitions instead of onEnter/onExit」描述的渲染、交互或错误处理结果。 */
    it('fires onShare for paired named transitions instead of onEnter/onExit', async () => {
      const onShareA = jest.fn();
      const onExitA = jest.fn();
      const onShareB = jest.fn();
      const onEnterB = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({page}) {
        if (page === 'a') {
          return (
            <ViewTransition
              key="a"
              name="hero"
              onShare={onShareA}
              onExit={onExitA}>
              <div>Page A</div>
            </ViewTransition>
          );
        }
        return (
          <ViewTransition
            key="b"
            name="hero"
            onShare={onShareB}
            onEnter={onEnterB}>
            <div>Page B</div>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      // 渲染页面 A
      await act(() => {
        startTransition(() => {
          root.render(<App page="a" />);
        });
      });

      // 清除初始挂载阶段留下的 enter 回调记录。
      onShareA.mockClear();
      onExitA.mockClear();
      onShareB.mockClear();
      onEnterB.mockClear();

      // 从页 A 转到页 B 在 start转换
      await act(() => {
        startTransition(() => {
          root.render(<App page="b" />);
        });
      });

      // onShare 应该在退出侧（页面 A）触发。
      expect(onShareA).toHaveBeenCalledTimes(1);
      // share 优先时，不应触发退出侧的 onExit。
      expect(onExitA).not.toHaveBeenCalled();
      // 形成配对时，不应触发进入侧的 onEnter。
      expect(onEnterB).not.toHaveBeenCalled();
    });

    // @gate enableViewTransition
    /** 测试场景：验证「fires onEnter when Suspense content resolves」描述的渲染、交互或错误处理结果。 */
    it('fires onEnter when Suspense content resolves', async () => {
      const onEnter = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App() {
        return (
          <ViewTransition onEnter={onEnter}>
            <Suspense fallback={<div>Loading...</div>}>
              <div>
                <AsyncText text="Loaded" />
              </div>
            </Suspense>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      // 初始渲染：内容会挂起。
      await act(() => {
        startTransition(() => {
          root.render(<App />);
        });
      });

      assertLog(['Suspend! [Loaded]', 'Suspend! [Loaded]']);
      // fallback 出现时会触发 onEnter。
      const enterCallsAfterFallback = onEnter.mock.calls.length;
      onEnter.mockClear();

      // 恢复挂起的内容
      await act(() => {
        resolveText('Loaded');
      });
      assertLog(['Loaded']);

      expect(container.textContent).toBe('Loaded');
      // 已解析内容的显示应触发 enter（也可能已在初始 fallback 挂载时触发）。
      expect(
        onEnter.mock.calls.length + enterCallsAfterFallback,
      ).toBeGreaterThanOrEqual(1);
    });

    // @gate enableViewTransition
    /** 测试场景：验证「does not fire onExit/onEnter on nested ViewTransition when the subtree is removed as one unit」描述的渲染、交互或错误处理结果。 */
    it('does not fire onExit/onEnter on nested ViewTransition when the subtree is removed as one unit', async () => {
      const onParentExit = jest.fn();
      const onParentEnter = jest.fn();
      const onNestedExit = jest.fn();
      const onNestedEnter = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({show}) {
        if (!show) {
          return null;
        }
        return (
          <ViewTransition
            exit="page-exit"
            enter="page-enter"
            onExit={onParentExit}
            onEnter={onParentEnter}>
            <div>
              <ViewTransition
                exit="nested-exit"
                enter="nested-enter"
                onExit={onNestedExit}
                onEnter={onNestedEnter}>
                <div>Item</div>
              </ViewTransition>
            </div>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        startTransition(() => {
          root.render(<App show={false} />);
        });
      });

      onParentEnter.mockClear();
      onNestedEnter.mockClear();

      await act(() => {
        startTransition(() => {
          root.render(<App show={true} />);
        });
      });

      expect(onParentEnter).toHaveBeenCalledTimes(1);
      expect(onNestedEnter).not.toHaveBeenCalled();

      onParentExit.mockClear();
      onNestedExit.mockClear();

      await act(() => {
        startTransition(() => {
          root.render(<App show={false} />);
        });
      });

      expect(onParentExit).toHaveBeenCalledTimes(1);
      expect(onNestedExit).not.toHaveBeenCalled();
    });

    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    /** 测试场景：验证「fires onParentExit when ancestor ViewTransition exits」描述的渲染、交互或错误处理结果。 */
    it('fires onParentExit when ancestor ViewTransition exits', async () => {
      const onParentExit = jest.fn();
      const onNestedExit = jest.fn();
      const onParentExitNested = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({show}) {
        if (!show) {
          return null;
        }
        return (
          <ViewTransition exit="page-exit" onExit={onParentExit}>
            <div>
              <ViewTransition
                exit="nested-exit"
                onExit={onNestedExit}
                parentExit="nested-parent-exit"
                onParentExit={onParentExitNested}>
                <div>Item</div>
              </ViewTransition>
            </div>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        startTransition(() => {
          root.render(<App show={true} />);
        });
      });

      onParentExit.mockClear();
      onNestedExit.mockClear();
      onParentExitNested.mockClear();

      await act(() => {
        startTransition(() => {
          root.render(<App show={false} />);
        });
      });

      expect(onParentExit).toHaveBeenCalledTimes(1);
      expect(onNestedExit).not.toHaveBeenCalled();
      expect(onParentExitNested).toHaveBeenCalledTimes(1);
    });

    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    /** 测试场景：验证「fires onParentEnter when ancestor ViewTransition enters」描述的渲染、交互或错误处理结果。 */
    it('fires onParentEnter when ancestor ViewTransition enters', async () => {
      const onParentEnter = jest.fn();
      const onNestedEnter = jest.fn();
      const onParentEnterNested = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({show}) {
        if (!show) {
          return null;
        }
        return (
          <ViewTransition enter="page-enter" onEnter={onParentEnter}>
            <div>
              <ViewTransition
                enter="nested-enter"
                onEnter={onNestedEnter}
                parentEnter="nested-parent-enter"
                onParentEnter={onParentEnterNested}>
                <div>Item</div>
              </ViewTransition>
            </div>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        startTransition(() => {
          root.render(<App show={false} />);
        });
      });

      onParentEnter.mockClear();
      onNestedEnter.mockClear();
      onParentEnterNested.mockClear();

      await act(() => {
        startTransition(() => {
          root.render(<App show={true} />);
        });
      });

      expect(onParentEnter).toHaveBeenCalledTimes(1);
      expect(onNestedEnter).not.toHaveBeenCalled();
      expect(onParentEnterNested).toHaveBeenCalledTimes(1);
    });

    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    /** 测试场景：验证「breaks parentExit chain when intermediate ViewTransition lacks parentExit」描述的渲染、交互或错误处理结果。 */
    it('breaks parentExit chain when intermediate ViewTransition lacks parentExit', async () => {
      const onParentExit1 = jest.fn();
      const onParentExit2 = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({show}) {
        if (!show) {
          return null;
        }
        return (
          <ViewTransition exit="page-exit">
            <div>
              <ViewTransition parentExit="relay-exit">
                <div>
                  <ViewTransition>
                    <div>
                      <ViewTransition
                        parentExit="nested-exit"
                        onParentExit={onParentExit1}>
                        <div>Deep</div>
                      </ViewTransition>
                    </div>
                  </ViewTransition>
                </div>
              </ViewTransition>
              <ViewTransition
                parentExit="nested-exit"
                onParentExit={onParentExit2}>
                <div>Shallow</div>
              </ViewTransition>
            </div>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        startTransition(() => {
          root.render(<App show={true} />);
        });
      });

      onParentExit1.mockClear();
      onParentExit2.mockClear();

      await act(() => {
        startTransition(() => {
          root.render(<App show={false} />);
        });
      });

      expect(onParentExit1).not.toHaveBeenCalled();
      expect(onParentExit2).toHaveBeenCalledTimes(1);
    });

    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    /** 测试场景：验证「stops the parentExit relay when an intermediate class is "none"」描述的渲染、交互或错误处理结果。 */
    it('stops the parentExit relay when an intermediate class is "none"', async () => {
      const onParentExitDeep = jest.fn();
      const onParentExitSibling = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({show}) {
        if (!show) {
          return null;
        }
        return (
          <ViewTransition exit="page-exit">
            <div>
              <ViewTransition parentExit="none">
                <div>
                  <ViewTransition
                    parentExit="nested-exit"
                    onParentExit={onParentExitDeep}>
                    <div>Deep</div>
                  </ViewTransition>
                </div>
              </ViewTransition>
              <ViewTransition
                parentExit="nested-exit"
                onParentExit={onParentExitSibling}>
                <div>Shallow</div>
              </ViewTransition>
            </div>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        startTransition(() => {
          root.render(<App show={true} />);
        });
      });

      onParentExitDeep.mockClear();
      onParentExitSibling.mockClear();

      await act(() => {
        startTransition(() => {
          root.render(<App show={false} />);
        });
      });

      // `none` 类会截断传递，因此其下层的嵌套激活永远不会触发。
      expect(onParentExitDeep).not.toHaveBeenCalled();
      // 不位于 `none` 边界之后的 sibling 仍会继续传递。
      expect(onParentExitSibling).toHaveBeenCalledTimes(1);
    });

    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    /** 测试场景：验证「stops the parentEnter relay when an intermediate class is "none"」描述的渲染、交互或错误处理结果。 */
    it('stops the parentEnter relay when an intermediate class is "none"', async () => {
      const onParentEnterDeep = jest.fn();
      const onParentEnterSibling = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({show}) {
        if (!show) {
          return null;
        }
        return (
          <ViewTransition enter="page-enter">
            <div>
              <ViewTransition parentEnter="none">
                <div>
                  <ViewTransition
                    parentEnter="nested-enter"
                    onParentEnter={onParentEnterDeep}>
                    <div>Deep</div>
                  </ViewTransition>
                </div>
              </ViewTransition>
              <ViewTransition
                parentEnter="nested-enter"
                onParentEnter={onParentEnterSibling}>
                <div>Shallow</div>
              </ViewTransition>
            </div>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        startTransition(() => {
          root.render(<App show={false} />);
        });
      });

      await act(() => {
        startTransition(() => {
          root.render(<App show={true} />);
        });
      });

      // `none` 类会截断传递，因此其下层的嵌套激活永远不会触发。
      expect(onParentEnterDeep).not.toHaveBeenCalled();
      // 不位于 `none` 边界之后的 sibling 仍会继续传递。
      expect(onParentEnterSibling).toHaveBeenCalledTimes(1);
    });

    /** 测试场景：验证「does not fire onParentEnter when ancestor exits」描述的渲染、交互或错误处理结果。 */
    it('does not fire onParentEnter when ancestor exits', async () => {
      const onParentEnter = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({show}) {
        if (!show) {
          return null;
        }
        return (
          <ViewTransition exit="page-exit">
            <div>
              <ViewTransition parentExit="relay-exit">
                <ViewTransition
                  parentEnter="nested-enter"
                  onParentEnter={onParentEnter}>
                  <div>Item</div>
                </ViewTransition>
              </ViewTransition>
            </div>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        startTransition(() => {
          root.render(<App show={true} />);
        });
      });

      onParentEnter.mockClear();

      await act(() => {
        startTransition(() => {
          root.render(<App show={false} />);
        });
      });

      expect(onParentEnter).not.toHaveBeenCalled();
    });

    // @gate enableViewTransition
    /** 测试场景：验证「does not fire onParentExit when ancestor shares instead of exiting」描述的渲染、交互或错误处理结果。 */
    it('does not fire onParentExit when ancestor shares instead of exiting', async () => {
      const onShare = jest.fn();
      const onParentExit = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({page}) {
        if (page === 'a') {
          return (
            <ViewTransition key="a" name="hero" onShare={onShare}>
              <ViewTransition
                parentExit="child-parent-exit"
                onParentExit={onParentExit}>
                <div>Page A</div>
              </ViewTransition>
            </ViewTransition>
          );
        }
        return (
          <ViewTransition key="b" name="hero">
            <ViewTransition
              parentExit="child-parent-exit"
              onParentExit={onParentExit}>
              <div>Page B</div>
            </ViewTransition>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        startTransition(() => {
          root.render(<App page="a" />);
        });
      });

      onShare.mockClear();
      onParentExit.mockClear();

      await act(() => {
        startTransition(() => {
          root.render(<App page="b" />);
        });
      });

      expect(onShare).toHaveBeenCalledTimes(1);
      expect(onParentExit).not.toHaveBeenCalled();
    });

    // @gate enableViewTransition
    /** 测试场景：验证「does not fire onParentEnter when ancestor shares instead of entering」描述的渲染、交互或错误处理结果。 */
    it('does not fire onParentEnter when ancestor shares instead of entering', async () => {
      const onShare = jest.fn();
      const onParentEnter = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({page}) {
        if (page === 'a') {
          return (
            <ViewTransition key="a" name="hero" onShare={onShare}>
              <ViewTransition
                parentEnter="child-parent-enter"
                onParentEnter={onParentEnter}>
                <div>Page A</div>
              </ViewTransition>
            </ViewTransition>
          );
        }
        return (
          <ViewTransition key="b" name="hero">
            <ViewTransition
              parentEnter="child-parent-enter"
              onParentEnter={onParentEnter}>
              <div>Page B</div>
            </ViewTransition>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        startTransition(() => {
          root.render(<App page="a" />);
        });
      });

      onShare.mockClear();
      onParentEnter.mockClear();

      await act(() => {
        startTransition(() => {
          root.render(<App page="b" />);
        });
      });

      expect(onShare).toHaveBeenCalledTimes(1);
      expect(onParentEnter).not.toHaveBeenCalled();
    });

    /** 测试场景：验证「does not fire onParentExit when ancestor exit is none」描述的渲染、交互或错误处理结果。 */
    it('does not fire onParentExit when ancestor exit is none', async () => {
      const onParentExit = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({show}) {
        if (!show) {
          return null;
        }
        return (
          <ViewTransition exit="none">
            <ViewTransition
              parentExit="nested-parent-exit"
              onParentExit={onParentExit}>
              <div>Item</div>
            </ViewTransition>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        startTransition(() => {
          root.render(<App show={true} />);
        });
      });

      onParentExit.mockClear();

      await act(() => {
        startTransition(() => {
          root.render(<App show={false} />);
        });
      });

      expect(onParentExit).not.toHaveBeenCalled();
    });

    /** 测试场景：验证「does not fire onParentEnter when ancestor enter is none」描述的渲染、交互或错误处理结果。 */
    it('does not fire onParentEnter when ancestor enter is none', async () => {
      const onParentEnter = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({show}) {
        if (!show) {
          return null;
        }
        return (
          <ViewTransition enter="none">
            <ViewTransition
              parentEnter="nested-parent-enter"
              onParentEnter={onParentEnter}>
              <div>Item</div>
            </ViewTransition>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        startTransition(() => {
          root.render(<App show={false} />);
        });
      });

      onParentEnter.mockClear();

      await act(() => {
        startTransition(() => {
          root.render(<App show={true} />);
        });
      });

      expect(onParentEnter).not.toHaveBeenCalled();
    });

    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    /** 测试场景：验证「relays parentExit chain through unstyled parentExit」描述的渲染、交互或错误处理结果。 */
    it('relays parentExit chain through unstyled parentExit', async () => {
      const onParentExit = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({show}) {
        if (!show) {
          return null;
        }
        return (
          <ViewTransition exit="page-exit">
            <div>
              <ViewTransition parentExit="auto">
                <ViewTransition
                  parentExit="nested-exit"
                  onParentExit={onParentExit}>
                  <div>Item</div>
                </ViewTransition>
              </ViewTransition>
            </div>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        startTransition(() => {
          root.render(<App show={true} />);
        });
      });

      onParentExit.mockClear();

      await act(() => {
        startTransition(() => {
          root.render(<App show={false} />);
        });
      });

      expect(onParentExit).toHaveBeenCalledTimes(1);
    });

    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    /** 测试场景：验证「fires onParentExit when ancestor ViewTransition exits with handler only」描述的渲染、交互或错误处理结果。 */
    it('fires onParentExit when ancestor ViewTransition exits with handler only', async () => {
      const onParentExit = jest.fn();
      const onRelayParentExit = jest.fn();
      const onParentExitDeep = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({show}) {
        if (!show) {
          return null;
        }
        return (
          <ViewTransition onExit={onParentExit}>
            <div>
              <ViewTransition onParentExit={onRelayParentExit}>
                <ViewTransition onParentExit={onParentExitDeep}>
                  <div>Item</div>
                </ViewTransition>
              </ViewTransition>
            </div>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        startTransition(() => {
          root.render(<App show={true} />);
        });
      });

      onParentExit.mockClear();
      onRelayParentExit.mockClear();
      onParentExitDeep.mockClear();

      await act(() => {
        startTransition(() => {
          root.render(<App show={false} />);
        });
      });

      expect(onParentExit).toHaveBeenCalledTimes(1);
      expect(onRelayParentExit).toHaveBeenCalledTimes(1);
      expect(onParentExitDeep).toHaveBeenCalledTimes(1);
    });

    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    /** 测试场景：验证「fires onParentEnter when ancestor ViewTransition enters with handler only」描述的渲染、交互或错误处理结果。 */
    it('fires onParentEnter when ancestor ViewTransition enters with handler only', async () => {
      const onParentEnter = jest.fn();
      const onRelayParentEnter = jest.fn();
      const onParentEnterDeep = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({show}) {
        if (!show) {
          return null;
        }
        return (
          <ViewTransition onEnter={onParentEnter}>
            <div>
              <ViewTransition onParentEnter={onRelayParentEnter}>
                <ViewTransition onParentEnter={onParentEnterDeep}>
                  <div>Item</div>
                </ViewTransition>
              </ViewTransition>
            </div>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        startTransition(() => {
          root.render(<App show={false} />);
        });
      });

      onParentEnter.mockClear();
      onRelayParentEnter.mockClear();
      onParentEnterDeep.mockClear();

      await act(() => {
        startTransition(() => {
          root.render(<App show={true} />);
        });
      });

      expect(onParentEnter).toHaveBeenCalledTimes(1);
      expect(onRelayParentEnter).toHaveBeenCalledTimes(1);
      expect(onParentEnterDeep).toHaveBeenCalledTimes(1);
    });

    /** 测试场景：验证「does not fire onParentEnter when ancestor enter is none with handler only」描述的渲染、交互或错误处理结果。 */
    it('does not fire onParentEnter when ancestor enter is none with handler only', async () => {
      const onParentEnter = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({show}) {
        if (!show) {
          return null;
        }
        return (
          <ViewTransition enter="none">
            <ViewTransition onParentEnter={onParentEnter}>
              <div>Item</div>
            </ViewTransition>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        startTransition(() => {
          root.render(<App show={false} />);
        });
      });

      onParentEnter.mockClear();

      await act(() => {
        startTransition(() => {
          root.render(<App show={true} />);
        });
      });

      expect(onParentEnter).not.toHaveBeenCalled();
    });

    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    /** 测试场景：验证「relays parentEnter chain to handler-only child through intermediate divs」描述的渲染、交互或错误处理结果。 */
    it('relays parentEnter chain to handler-only child through intermediate divs', async () => {
      const onParentEnter = jest.fn();
      const onParentEnterNested = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({show}) {
        if (!show) {
          return null;
        }
        return (
          <ViewTransition onEnter={onParentEnter}>
            <div>
              <div>
                <ViewTransition onParentEnter={onParentEnterNested}>
                  <div>Item</div>
                </ViewTransition>
              </div>
            </div>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        startTransition(() => {
          root.render(<App show={false} />);
        });
      });

      onParentEnter.mockClear();
      onParentEnterNested.mockClear();

      await act(() => {
        startTransition(() => {
          root.render(<App show={true} />);
        });
      });

      expect(onParentEnter).toHaveBeenCalledTimes(1);
      expect(onParentEnterNested).toHaveBeenCalledTimes(1);
    });

    // @gate enableViewTransition
    /** 测试场景：验证「enters without props and does not fire handlers」描述的渲染、交互或错误处理结果。 */
    it('enters without props and does not fire handlers', async () => {
      const startViewTransitionSpy = jest.fn(document.startViewTransition);
      document.startViewTransition = startViewTransitionSpy;

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({show}) {
        if (!show) {
          return null;
        }
        return (
          <ViewTransition>
            <div>Hello</div>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<App show={false} />);
      });
      expect(startViewTransitionSpy).not.toHaveBeenCalled();

      await act(() => {
        startTransition(() => {
          root.render(<App show={true} />);
        });
      });

      expect(startViewTransitionSpy).toHaveBeenCalled();
    });

    // @gate enableViewTransition
    /** 测试场景：验证「exits without props and does not fire handlers」描述的渲染、交互或错误处理结果。 */
    it('exits without props and does not fire handlers', async () => {
      const startViewTransitionSpy = jest.fn(document.startViewTransition);
      document.startViewTransition = startViewTransitionSpy;

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({show}) {
        if (!show) {
          return null;
        }
        return (
          <ViewTransition>
            <div>Goodbye</div>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        startTransition(() => {
          root.render(<App show={true} />);
        });
      });
      startViewTransitionSpy.mockClear();

      await act(() => {
        startTransition(() => {
          root.render(<App show={false} />);
        });
      });

      expect(startViewTransitionSpy).toHaveBeenCalled();
    });

    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    /** 测试场景：验证「fires onParentEnter when ancestor ViewTransition has no props」描述的渲染、交互或错误处理结果。 */
    it('fires onParentEnter when ancestor ViewTransition has no props', async () => {
      const onParentEnterNested = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({show}) {
        if (!show) {
          return null;
        }
        return (
          <ViewTransition>
            <div>
              <ViewTransition onParentEnter={onParentEnterNested}>
                <div>Item</div>
              </ViewTransition>
            </div>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        startTransition(() => {
          root.render(<App show={false} />);
        });
      });

      onParentEnterNested.mockClear();

      await act(() => {
        startTransition(() => {
          root.render(<App show={true} />);
        });
      });

      expect(onParentEnterNested).toHaveBeenCalledTimes(1);
    });

    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    /** 测试场景：验证「fires onParentExit when ancestor ViewTransition has no props」描述的渲染、交互或错误处理结果。 */
    it('fires onParentExit when ancestor ViewTransition has no props', async () => {
      const onParentExitNested = jest.fn();

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App({show}) {
        if (!show) {
          return null;
        }
        return (
          <ViewTransition>
            <div>
              <ViewTransition onParentExit={onParentExitNested}>
                <div>Item</div>
              </ViewTransition>
            </div>
          </ViewTransition>
        );
      }

      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        startTransition(() => {
          root.render(<App show={true} />);
        });
      });

      onParentExitNested.mockClear();

      await act(() => {
        startTransition(() => {
          root.render(<App show={false} />);
        });
      });

      expect(onParentExitNested).toHaveBeenCalledTimes(1);
    });
  });
});
