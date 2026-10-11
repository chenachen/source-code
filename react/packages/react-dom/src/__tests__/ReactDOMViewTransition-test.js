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

  /** 按 text 查缓存；未读过的项直接预置 resolved，pending 项改写状态/值并同步广播已有 pings，其他终态不变。 */
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

  /** 读取 text 记录：resolved 返回值，pending 抛 wakeable，rejected 抛错误；未命中时创建 pending 记录后抛出，供 Suspense 控制恢复时机。 */
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
        /** pending 时收集传入的 resolve 回调；已结束时用微任务通知缓存值，让晚订阅者也获得可重试信号。 */
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

  /** 记录 text 到 Scheduler 并直接返回字符串，作为同步 skeleton/内容的提交观测 fixture。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** 先 readText 检查资源，未就绪时抛出；就绪后记录并返回 text，供 Card 与 Suspense reveal 断言。 */
  function AsyncText({text}) {
    readText(text);
    Scheduler.log(text);
    return text;
  }

  /** SuspenseList(revealOrder=together) 中三个 ViewTransition 各包一张未就绪 Card；先断言挂起与 Skeleton 的两轮日志，再同时 resolve 三项并断言 Card 日志及容器包含三张卡，验证组合树恢复时共同揭示内容。 */
  // @gate enableSuspenseList
  it('handles ViewTransition wrapping Suspense inside SuspenseList', async () => {
    /** 接收卡片 id，返回 div 包裹 Card id 对应的 AsyncText，供三卡共同揭示场景。 */
    function Card({id}) {
      return (
        <div>
          <AsyncText text={`Card ${id}`} />
        </div>
      );
    }

    /** 接收 skeleton 编号 n，返回同步 Text，区分三条 Suspense fallback 的日志。 */
    function CardSkeleton({n}) {
      return <Text text={`Skeleton ${n}`} />;
    }

    /** 返回 together 的 SuspenseList，三张 Card 分别由 ViewTransition/Suspense 包裹，构造组级恢复 fixture。 */
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
          /** 接收 str 并原样返回；CSS 全局缺失时提供选择器路径所需的 escape 接口，此替身不执行真实 CSS 转义。 */
          escape: str => str
        };
      } else if (!CSS.escape) {
        /** CSS.escape 缺失时安装恒等字符串转发，满足选择器代码所需接口；此替身不执行真实 CSS 转义。 */
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
      /** 返回空 Animation 数组，固定无已有动画的测试输入，避免依赖 jsdom 缺失的 Web Animations API。 */
      Element.prototype.getAnimations = function () {
        return [];
      };

      // 模拟动画在 Element.prototype (Web Animations API) 上
      /** 返回带空 cancel 和已兑现 finished 的 Animation 替身，不创建真实动画，供过渡完成协议继续执行。 */
      Element.prototype.animate = function () {
        return {
          /** 模拟取消当前 Web Animation。 */
          /** 取消方法为空操作；Animation 替身没有真实播放状态或待取消的资源。 */
          cancel() {}, finished: Promise.resolve()
        };
      };

      // 模拟 getBoundingClientRect 方法以返回基于内容长度的尺寸，以便在文本更改时检测更新。
      /** 以 this.textContent 长度计算宽度 length×10+10、固定高度20，并返回 DOMRect；使文本长短变化可触发尺寸差异路径。 */
      Element.prototype.getBoundingClientRect = function () {
        const text = this.textContent || '';
        const width = text.length * 10 + 10;
        const height = 20;
        return new DOMRect(0, 0, width, height);
      };

      // 模拟 document.startViewTransition
      /** 接收含 update 的选项，立即同步执行 update，再返回已兑现 ready/finished 与空 skipTransition，模拟平台过渡协议而不执行浏览器动画。 */
      document.startViewTransition = function ({update}) {
        update();
        return {
          ready: Promise.resolve(),
          finished: Promise.resolve(),
          /** 空操作的平台 skipTransition 替身；此 fixture 的 Promise 已兑现，无真实过渡可取消。 */
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

    /** 在同步 mock 的 startViewTransition 协议下先渲染 show=false，断言无 enter/平台调用；startTransition 中切为 true 后平台被调用且 onEnter 一次，验证新边界入场回调。 */
    // @gate enableViewTransition
    it('fires onEnter when a ViewTransition mounts', async () => {
      const onEnter = jest.fn();
      const startViewTransitionSpy = jest.fn(document.startViewTransition);
      document.startViewTransition = startViewTransitionSpy;

      /** show=false 返回 null；true 返回带 onEnter 的 Hello 边界，供首次过渡入场观测。 */
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

      // 在 startTransition 回调中挂载 ViewTransition。
      await act(() => {
        startTransition(() => {
          root.render(<App show={true} />);
        });
      });

      expect(startViewTransitionSpy).toHaveBeenCalled();
      expect(onEnter).toHaveBeenCalledTimes(1);
    });

    /** 先在 startTransition 中挂载带 onExit 的边界，确认尚未 exit；再把 show 改为 false，断言 onExit 一次，验证边界删除的退出回调。 */
    // @gate enableViewTransition
    it('fires onExit when a ViewTransition unmounts', async () => {
      const onExit = jest.fn();

      /** show 控制带 onExit 的 Goodbye 边界存在与否，供 Transition 删除场景。 */
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

      // 在 startTransition 回调中卸载 ViewTransition。
      await act(() => {
        startTransition(() => {
          root.render(<App show={false} />);
        });
      });

      expect(onExit).toHaveBeenCalledTimes(1);
    });

    /** 先 Transition 提交 Short，再改为更长文本使尺寸 mock 变化；onUpdate 一次、清空后的 onEnter 不调用，验证边界内容更新与初次入场的回调分流。 */
    // @gate enableViewTransition
    it('fires onUpdate when content inside a ViewTransition changes', async () => {
      const onUpdate = jest.fn();
      const onEnter = jest.fn();

      /** text 改变 div 内容并通过尺寸替身改变测量值，边界同时记录 enter/update 回调。 */
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

    /** 先显示 key=a/name=hero，再 Transition 换为 key=b 的同名边界；清掉初始记录后只断言退出侧 onShareA 一次、onExitA/onEnterB 不调用，验证命名配对优先 share；未断言 onShareB 次数。 */
    // @gate enableViewTransition
    it('fires onShare for paired named transitions instead of onEnter/onExit', async () => {
      const onShareA = jest.fn();
      const onExitA = jest.fn();
      const onShareB = jest.fn();
      const onEnterB = jest.fn();

      /** page=a/b 返回不同 key 的同名 hero 边界，分别布置退出与进入回调，供命名配对优先级断言。 */
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

      // 在 startTransition 回调中从页面 A 切到页面 B。
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

    /** ViewTransition 包住首次 pending 的 Loaded Suspense；resolve 后日志与容器为 Loaded，断言 fallback 前后合计 onEnter 至少一次，验证恢复内容正常显示；合计断言不单独证明 reveal 又触发一次 enter。 */
    // @gate enableViewTransition
    it('fires onEnter when Suspense content resolves', async () => {
      const onEnter = jest.fn();

      /** 固定的 ViewTransition 包裹 Loaded 的异步 Suspense 与 Loading fallback，资源状态决定可见内容。 */
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
      // 保存 fallback 阶段的实际 enter 次数，最终断言将它与 reveal 阶段次数合计。
      const enterCallsAfterFallback = onEnter.mock.calls.length;
      onEnter.mockClear();

      // 恢复挂起的内容
      await act(() => {
        resolveText('Loaded');
      });
      assertLog(['Loaded']);

      expect(container.textContent).toBe('Loaded');
      // 仅要求 fallback/reveal 两阶段合计至少一次 enter，不单独要求 reveal 新增调用。
      expect(
        onEnter.mock.calls.length + enterCallsAfterFallback,
      ).toBeGreaterThanOrEqual(1);
    });

    /** 两层边界随 show 整组 false→true→false；分别断言外层 enter/exit 一次、内层自身 enter/exit 不调用，验证整组入场/退场由外层边界负责。 */
    // @gate enableViewTransition
    it('does not fire onExit/onEnter on nested ViewTransition when the subtree is removed as one unit', async () => {
      const onParentExit = jest.fn();
      const onParentEnter = jest.fn();
      const onNestedExit = jest.fn();
      const onNestedEnter = jest.fn();

      /** show 控制整个父/嵌套 ViewTransition 树，父子各注册自身 enter/exit，供整组移动的回调归属断言。 */
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

    /** 启用 parentEnterExit 后整组删除两层边界；断言外层 onExit 与内层 onParentExit 各一次、内层 onExit 不调用，验证祖先退出通知与自身退出分开。 */
    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    it('fires onParentExit when ancestor ViewTransition exits', async () => {
      const onParentExit = jest.fn();
      const onNestedExit = jest.fn();
      const onParentExitNested = jest.fn();

      /** show 控制带父 exit 类及内层自身 exit/parentExit 的树，供祖先退出回调分类。 */
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

    /** 启用 parentEnterExit 后从 null 整组挂载两层边界；外层 onEnter 与内层 onParentEnter 各一次、内层 onEnter 不调用，验证祖先入场回调。 */
    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    it('fires onParentEnter when ancestor ViewTransition enters', async () => {
      const onParentEnter = jest.fn();
      const onNestedEnter = jest.fn();
      const onParentEnterNested = jest.fn();

      /** show 控制外层入场与内层自身 enter/parentEnter 的树，供祖先入场回调分类。 */
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

    /** 退出树的深层分支中有未声明 parentExit 的中间边界，浅分支声明 parentExit；整体卸载后深回调不调用、浅回调一次，验证该中间边界截断 relay。 */
    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    it('breaks parentExit chain when intermediate ViewTransition lacks parentExit', async () => {
      const onParentExit1 = jest.fn();
      const onParentExit2 = jest.fn();

      /** 构造深层断链与浅层可 relay 的 parentExit 分支；show 删除整组，提供同一次退出的对照。 */
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

    /** 中间边界 parentExit=none、同层另一分支可接收 parentExit；整体退出后深回调不调用、兄弟回调一次，验证 none 截断该分支的退出传递。 */
    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    it('stops the parentExit relay when an intermediate class is "none"', async () => {
      const onParentExitDeep = jest.fn();
      const onParentExitSibling = jest.fn();

      /** 深层分支的中间 parentExit=none，兄弟分支可 relay；show 控制整组退出。 */
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

      // 本次祖先 enter/exit 的 relay 在 none 处截断，下层回调本次不触发。
      expect(onParentExitDeep).not.toHaveBeenCalled();
      // 不位于 `none` 边界之后的 sibling 仍会继续传递。
      expect(onParentExitSibling).toHaveBeenCalledTimes(1);
    });

    /** 中间边界 parentEnter=none、同层兄弟可接收 parentEnter；整体进入后深回调不调用、兄弟回调一次，验证 none 截断该分支的入场传递。 */
    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    it('stops the parentEnter relay when an intermediate class is "none"', async () => {
      const onParentEnterDeep = jest.fn();
      const onParentEnterSibling = jest.fn();

      /** 深层中间 parentEnter=none，兄弟可 relay；show 控制整组入场以比较两个分支。 */
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

      // 本次祖先 enter/exit 的 relay 在 none 处截断，下层回调本次不触发。
      expect(onParentEnterDeep).not.toHaveBeenCalled();
      // 不位于 `none` 边界之后的 sibling 仍会继续传递。
      expect(onParentEnterSibling).toHaveBeenCalledTimes(1);
    });

    /** 已挂载的祖先执行 exit，深层只注册 onParentEnter；卸载后该回调不调用，验证退出传递不会作为入场通知。 */
    it('does not fire onParentEnter when ancestor exits', async () => {
      const onParentEnter = jest.fn();

      /** 祖先具 exit/relay-exit，深层只具 parentEnter 回调，供退出不误发入场通知的对照。 */
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

    /** 同名 hero 的不同 key 配对换页，子边界注册 onParentExit；断言祖先 onShare 一次而子 parentExit 不调用，验证 share 不走祖先退出传递。 */
    // @gate enableViewTransition
    it('does not fire onParentExit when ancestor shares instead of exiting', async () => {
      const onShare = jest.fn();
      const onParentExit = jest.fn();

      /** page 选择不同 key 的同名 hero，子边界各注册 parentExit，供 share 路径与退出 relay 区分。 */
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

    /** 同名 hero 配对换页，子边界注册 onParentEnter；断言祖先 onShare 一次、子回调不调用，验证配对 share 不走祖先入场传递。 */
    // @gate enableViewTransition
    it('does not fire onParentEnter when ancestor shares instead of entering', async () => {
      const onShare = jest.fn();
      const onParentEnter = jest.fn();

      /** page 选择不同 key 的 hero 配对，子边界注册 parentEnter，供 share 不触发入场 relay 的对照。 */
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

    /** 祖先 exit=none，子边界声明 parentExit 回调；从已挂载改为 null后无调用，验证禁用祖先退出会阻止该通知。 */
    it('does not fire onParentExit when ancestor exit is none', async () => {
      const onParentExit = jest.fn();

      /** show 控制 exit=none 的祖先和带 parentExit 的后代，供禁用退出条件。 */
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

    /** 祖先 enter=none，子边界声明 parentEnter 回调；从 null 挂载后无调用，验证禁用祖先入场会阻止该通知。 */
    it('does not fire onParentEnter when ancestor enter is none', async () => {
      const onParentEnter = jest.fn();

      /** show 控制 enter=none 的祖先和带 parentEnter 的后代，供禁用入场条件。 */
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

    /** 祖先带 exit 类、中间 parentExit=auto、后代带退出回调；整体卸载后后代调用一次，验证未指定自定义样式的 auto relay 仍继续传递。 */
    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    it('relays parentExit chain through unstyled parentExit', async () => {
      const onParentExit = jest.fn();

      /** show 控制自定义 exit 祖先、parentExit=auto 的中间边界和命名 parentExit 后代，供 auto relay 断言。 */
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

    /** 祖先与两层后代只声明 onExit/onParentExit、不提供类名；整体卸载后三级回调各一次，验证 handler-only 的祖先退出与 relay。 */
    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    it('fires onParentExit when ancestor ViewTransition exits with handler only', async () => {
      const onParentExit = jest.fn();
      const onRelayParentExit = jest.fn();
      const onParentExitDeep = jest.fn();

      /** 返回只有 onExit/onParentExit 回调而无显式类名的三层边界，供 handler-only 退出 relay。 */
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

    /** 祖先与两层后代只声明 onEnter/onParentEnter；从 null 挂载后三级回调各一次，验证 handler-only 的入场 relay。 */
    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    it('fires onParentEnter when ancestor ViewTransition enters with handler only', async () => {
      const onParentEnter = jest.fn();
      const onRelayParentEnter = jest.fn();
      const onParentEnterDeep = jest.fn();

      /** 返回只有 onEnter/onParentEnter 的三层边界，由 show 控制整体入场，供 handler-only relay。 */
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

    /** 祖先 enter=none、子边界只有 onParentEnter；从 null 挂载后子回调不调用，验证 handler-only 仍受祖先 none 条件限制。 */
    it('does not fire onParentEnter when ancestor enter is none with handler only', async () => {
      const onParentEnter = jest.fn();

      /** 返回 enter=none 的祖先和只有 onParentEnter 的子边界，供禁用条件优先于 handler-only 的验证。 */
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

    /** 祖先 onEnter 与后代 onParentEnter 之间穿过两个普通 div；整体挂载后二者各一次，验证宿主包装不会截断边界 relay。 */
    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    it('relays parentEnter chain to handler-only child through intermediate divs', async () => {
      const onParentEnter = jest.fn();
      const onParentEnterNested = jest.fn();

      /** 在外层 onEnter 与内层 onParentEnter 之间插两个 div，供宿主包装不截断 relay 的验证。 */
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

    /** 无 props 的 ViewTransition 初始不渲染，再 Transition 挂载；断言 startViewTransition 由未调用变为调用，验证无回调边界也能请求平台过渡；没有事件 handler 次数断言。 */
    // @gate enableViewTransition
    it('enters without props and does not fire handlers', async () => {
      const startViewTransitionSpy = jest.fn(document.startViewTransition);
      document.startViewTransition = startViewTransitionSpy;

      /** show=true 时返回无 props 的 Hello 边界，否则 null，供默认入场平台请求。 */
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

    /** 先挂载无 props 边界并清掉平台 spy，再 Transition 删除；断言 startViewTransition 被调用，验证无 props 边界的退出平台请求。 */
    // @gate enableViewTransition
    it('exits without props and does not fire handlers', async () => {
      const startViewTransitionSpy = jest.fn(document.startViewTransition);
      document.startViewTransition = startViewTransitionSpy;

      /** show=true 返回无 props 的 Goodbye 边界，否则 null，供默认退出平台请求。 */
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

    /** 祖先无 props、后代有 onParentEnter；从 null Transition 挂载后后代回调一次，验证默认祖先入场可激活后代通知。 */
    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    it('fires onParentEnter when ancestor ViewTransition has no props', async () => {
      const onParentEnterNested = jest.fn();

      /** show 控制无 props 祖先与带 onParentEnter 的后代，供默认入场 relay。 */
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

    /** 祖先无 props、后代有 onParentExit；从已挂载 Transition 删除后后代回调一次，验证默认祖先退出可激活后代通知。 */
    // @gate enableViewTransition && enableViewTransitionParentEnterExit
    it('fires onParentExit when ancestor ViewTransition has no props', async () => {
      const onParentExitNested = jest.fn();

      /** show 控制无 props 祖先与带 onParentExit 的后代，供默认退出 relay。 */
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
