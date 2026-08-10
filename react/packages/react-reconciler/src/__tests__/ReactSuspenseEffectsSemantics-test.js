/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

let React;
let ReactNoop;
let Scheduler;
let act;
let Suspense;
let getCacheForType;
let caches;
let seededCache;
let ErrorBoundary;
let waitForAll;
let waitFor;
let assertLog;

// TODO：这些场景在 persistent 模式尚未通过，需要补齐对应实现。

/** 验证 Suspense 隐藏、揭示、重挂起与错误路径中的 insertion/layout/passive/ref 语义。 */
describe('ReactSuspenseEffectsSemantics', () => {
  /**
   * 重建 Noop 环境、版本化文本 cache 与通用错误边界；每个场景独享 effect 日志和资源状态。
   */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    Suspense = React.Suspense;

    getCacheForType = React.unstable_getCacheForType;

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    waitFor = InternalTestUtils.waitFor;
    assertLog = InternalTestUtils.assertLog;

    caches = [];
    seededCache = null;

    ErrorBoundary = class extends React.Component {
      /** 保存提交阶段捕获的副作用错误。 */
      state = {error: null};
      /** 把生命周期/effect/ref 错误写入 state，驱动 fallback。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** 记录尝试/捕获分支，并在 children 与指定 fallback 间切换。 */
      render() {
        if (this.state.error) {
          Scheduler.log('ErrorBoundary render: catch');
          return this.props.fallback;
        }
        Scheduler.log('ErrorBoundary render: try');
        return this.props.children;
      }
    };
  });

  /**
   * 创建当前 cache 生命周期的文本资源表并赋予递增版本号；可消费一次预置 cache。
   * `resolve`/`reject` 都从 pending 单向进入终态并唤醒全部 retry ping。
   */
  function createTextCache() {
    if (seededCache !== null) {
      // 在 cache 被 React 请求前注入预置实例。
      // TODO：需要内建 API 支持初次 render 前播种数据；此时尚未挂载，不能称作 refresh。
      const cache = seededCache;
      seededCache = null;
      return cache;
    }

    const data = new Map();
    const version = caches.length + 1;
    const cache = {
      version,
      data,
      /** 完成指定文本并唤醒当前 cache 的订阅者。 */
      resolve(text) {
        const record = data.get(text);
        if (record === undefined) {
          const newRecord = {
            status: 'resolved',
            value: text,
          };
          data.set(text, newRecord);
        } else if (record.status === 'pending') {
          const thenable = record.value;
          record.status = 'resolved';
          record.value = text;
          thenable.pings.forEach(t => t());
        }
      },
      /** 拒绝指定文本并唤醒订阅者，使下一次读取抛出错误。 */
      reject(text, error) {
        const record = data.get(text);
        if (record === undefined) {
          const newRecord = {
            status: 'rejected',
            value: error,
          };
          data.set(text, newRecord);
        } else if (record.status === 'pending') {
          const thenable = record.value;
          record.status = 'rejected';
          record.value = error;
          thenable.pings.forEach(t => t());
        }
      },
    };
    caches.push(cache);
    return cache;
  }

  /** 从当前 React cache 读取文本；pending/rejected 时记录并抛出，resolved 时返回 cache 版本。 */
  function readText(text) {
    const textCache = getCacheForType(createTextCache);
    const record = textCache.data.get(text);
    if (record !== undefined) {
      switch (record.status) {
        case 'pending':
          Scheduler.log(`Suspend:${text}`);
          throw record.value;
        case 'rejected':
          Scheduler.log(`Error:${text}`);
          throw record.value;
        case 'resolved':
          return textCache.version;
      }
    } else {
      Scheduler.log(`Suspend:${text}`);

      const thenable = {
        pings: [],
        /** pending 时登记 retry，终态后以微任务回放。 */
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
      textCache.data.set(text, newRecord);

      throw thenable;
    }
  }

  /**
   * 记录 render，并安装 insertion、layout、passive 三类 effect 及对应 cleanup。
   * 用同一 text 标签串起各提交阶段，便于验证创建/销毁顺序。
   */
  function Text({children = null, text}) {
    Scheduler.log(`Text:${text} render`);
    React.useInsertionEffect(() => {
      Scheduler.log(`Text:${text} create insertion`);
      return () => {
        Scheduler.log(`Text:${text} destroy insertion`);
      };
    }, []);

    React.useLayoutEffect(() => {
      Scheduler.log(`Text:${text} create layout`);
      return () => {
        Scheduler.log(`Text:${text} destroy layout`);
      };
    }, []);
    React.useEffect(() => {
      Scheduler.log(`Text:${text} create passive`);
      return () => {
        Scheduler.log(`Text:${text} destroy passive`);
      };
    }, []);
    return <span prop={text}>{children}</span>;
  }

  /** 先读取异步文本，再记录 render，并安装 layout/passive effect 与 cleanup。 */
  function AsyncText({children = null, text}) {
    readText(text);
    Scheduler.log(`AsyncText:${text} render`);
    React.useLayoutEffect(() => {
      Scheduler.log(`AsyncText:${text} create layout`);
      return () => {
        Scheduler.log(`AsyncText:${text} destroy layout`);
      };
    }, []);
    React.useEffect(() => {
      Scheduler.log(`AsyncText:${text} create passive`);
      return () => {
        Scheduler.log(`AsyncText:${text} destroy passive`);
      };
    }, []);
    return <span prop={text}>{children}</span>;
  }

  /** 完成最近创建 cache 中的文本；旧 cache 可由测试直接按索引选择。 */
  function resolveMostRecentTextCache(text) {
    if (caches.length === 0) {
      throw Error('Cache does not exist.');
    } else {
      // 默认完成最新 cache；旧 cache 可通过 `caches[index].resolve(text)` 精确选择。
      caches[caches.length - 1].resolve(text);
    }
  }

  const resolveText = resolveMostRecentTextCache;

  /** 推进 Jest 虚拟时间并在当前 tick 末尾恢复；不会推进 React Noop 自身时间。 */
  function advanceTimers(ms) {
    // 这里只推进 Jest 虚拟时间；React 时间需使用 ReactNoop.expire。
    if (typeof ms !== 'number') {
      throw new Error('Must specify ms');
    }
    jest.advanceTimersByTime(ms);
    // 等待当前 tick 结束；计时器已被伪造，不能再用 timer 实现。
    return Promise.resolve().then(() => {});
  }

  /** 对比并发根与旧同步根首次挂起时 effect 的创建、隐藏与最终清理。 */
  describe('when a component suspends during initial mount', () => {
    /**
     * 场景（Given–When–Then）：给定并发根首次挂载时 Async 挂起；当 fallback 提交、主资源完成、
     * 最后卸载；那么主树 effect 只在 reveal 创建，fallback 先销毁，全部 cleanup 顺序稳定。
     * 对应机制：并发 Suspense 初挂不提交隐藏主树，后台预热也不运行 effect。
     */
    // @gate enableLegacyCache
    it('should not change behavior in concurrent mode', async () => {
      /** 记录类节点 render 与 mount/update/unmount 生命周期。 */
      class ClassText extends React.Component {
        /** 记录主树类节点挂载。 */
        componentDidMount() {
          const {text} = this.props;
          Scheduler.log(`ClassText:${text} componentDidMount`);
        }
        /** 记录主树类节点更新。 */
        componentDidUpdate() {
          const {text} = this.props;
          Scheduler.log(`ClassText:${text} componentDidUpdate`);
        }
        /** 记录主树类节点卸载。 */
        componentWillUnmount() {
          const {text} = this.props;
          Scheduler.log(`ClassText:${text} componentWillUnmount`);
        }
        /** 记录 render 并输出带 prop 的 span。 */
        render() {
          const {children, text} = this.props;
          Scheduler.log(`ClassText:${text} render`);
          return <span prop={text}>{children}</span>;
        }
      }

      /** 包裹可挂起 children，并在边界外保留一个稳定 Text。 */
      function App({children = null}) {
        Scheduler.log('App render');
        React.useLayoutEffect(() => {
          Scheduler.log('App create layout');
          return () => {
            Scheduler.log('App destroy layout');
          };
        }, []);
        React.useEffect(() => {
          Scheduler.log('App create passive');
          return () => {
            Scheduler.log('App destroy passive');
          };
        }, []);
        return (
          <>
            <Suspense fallback={<Text text="Fallback" />}>
              <Text text="Inside:Before" />
              {children}
              <ClassText text="Inside:After" />
            </Suspense>
            <Text text="Outside" />
          </>
        );
      }

      // 初次挂载并挂起。
      await act(() => {
        ReactNoop.render(
          <App>
            <AsyncText text="Async" />
          </App>,
        );
      });
      assertLog([
        'App render',
        'Text:Inside:Before render',
        'Suspend:Async',
        'Text:Fallback render',
        'Text:Outside render',
        'Text:Fallback create insertion',
        'Text:Outside create insertion',
        'Text:Fallback create layout',
        'Text:Outside create layout',
        'App create layout',
        'Text:Fallback create passive',
        'Text:Outside create passive',
        'App create passive',
        // 后台预热主树，不创建 effect。
        'Text:Inside:Before render',
        'Suspend:Async',
        'ClassText:Inside:After render',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Fallback" />
          <span prop="Outside" />
        </>,
      );

      // 完成资源后销毁 fallback，并为主树创建 effect。
      await act(async () => {
        await resolveText('Async');
      });
      assertLog([
        'Text:Inside:Before render',
        'AsyncText:Async render',
        'ClassText:Inside:After render',
        'Text:Fallback destroy insertion',
        'Text:Fallback destroy layout',
        'Text:Inside:Before create insertion',
        'Text:Inside:Before create layout',
        'AsyncText:Async create layout',
        'ClassText:Inside:After componentDidMount',
        'Text:Fallback destroy passive',
        'Text:Inside:Before create passive',
        'AsyncText:Async create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Inside:Before" />
          <span prop="Async" />
          <span prop="Inside:After" />
          <span prop="Outside" />
        </>,
      );

      await act(() => {
        ReactNoop.render(null);
      });
      assertLog([
        'App destroy layout',
        'Text:Inside:Before destroy insertion',
        'Text:Inside:Before destroy layout',
        'AsyncText:Async destroy layout',
        'ClassText:Inside:After componentWillUnmount',
        'Text:Outside destroy insertion',
        'Text:Outside destroy layout',
        'App destroy passive',
        'Text:Inside:Before destroy passive',
        'AsyncText:Async destroy passive',
        'Text:Outside destroy passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(null);
    });

    /**
     * 场景（Given–When–Then）：给定 legacy 同步根首次挂起；当 fallback 提交时；那么已完成主树
     * 节点以 hidden 形式挂载并运行 effect，资源完成仅补上 Async、揭示现有节点。
     * 对应机制：旧模式初挂保留隐藏主树，区别于并发根。
     */
    // @gate enableLegacyCache && !disableLegacyMode
    it('should not change behavior in sync', async () => {
      /** 记录旧模式主树类节点的 render 与生命周期。 */
      class ClassText extends React.Component {
        /** 记录类节点首次挂载。 */
        componentDidMount() {
          const {text} = this.props;
          Scheduler.log(`ClassText:${text} componentDidMount`);
        }
        /** 记录类节点更新。 */
        componentDidUpdate() {
          const {text} = this.props;
          Scheduler.log(`ClassText:${text} componentDidUpdate`);
        }
        /** 记录类节点卸载。 */
        componentWillUnmount() {
          const {text} = this.props;
          Scheduler.log(`ClassText:${text} componentWillUnmount`);
        }
        /** 记录 render 并输出带 prop 的 span。 */
        render() {
          const {children, text} = this.props;
          Scheduler.log(`ClassText:${text} render`);
          return <span prop={text}>{children}</span>;
        }
      }

      /** 包裹可挂起 children，并在边界外保留稳定 Text。 */
      function App({children = null}) {
        Scheduler.log('App render');
        React.useLayoutEffect(() => {
          Scheduler.log('App create layout');
          return () => {
            Scheduler.log('App destroy layout');
          };
        }, []);
        React.useEffect(() => {
          Scheduler.log('App create passive');
          return () => {
            Scheduler.log('App destroy passive');
          };
        }, []);
        return (
          <>
            <Suspense fallback={<Text text="Fallback" />}>
              <Text text="Inside:Before" />
              {children}
              <ClassText text="Inside:After" />
            </Suspense>
            <Text text="Outside" />
          </>
        );
      }

      // 旧同步根初次挂载并挂起。
      await act(() => {
        ReactNoop.renderLegacySyncRoot(
          <App>
            <AsyncText text="Async" />
          </App>,
        );
      });
      assertLog([
        'App render',
        'Text:Inside:Before render',
        'Suspend:Async',
        'ClassText:Inside:After render',
        'Text:Fallback render',
        'Text:Outside render',
        'Text:Inside:Before create insertion',
        'Text:Fallback create insertion',
        'Text:Outside create insertion',
        'Text:Inside:Before create layout',
        'ClassText:Inside:After componentDidMount',
        'Text:Fallback create layout',
        'Text:Outside create layout',
        'App create layout',
        'Text:Inside:Before create passive',
        'Text:Fallback create passive',
        'Text:Outside create passive',
        'App create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Inside:Before" hidden={true} />
          <span prop="Inside:After" hidden={true} />
          <span prop="Fallback" />
          <span prop="Outside" />
        </>,
      );

      // 完成资源后只补挂 Async 并销毁 fallback，既有隐藏 effect 不重建。
      await act(async () => {
        await resolveText('Async');
      });
      assertLog([
        'AsyncText:Async render',
        'Text:Fallback destroy insertion',
        'Text:Fallback destroy layout',
        'AsyncText:Async create layout',
        'Text:Fallback destroy passive',
        'AsyncText:Async create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Inside:Before" />
          <span prop="Async" />
          <span prop="Inside:After" />
          <span prop="Outside" />
        </>,
      );

      await act(() => {
        ReactNoop.renderLegacySyncRoot(null);
      });
      assertLog([
        'App destroy layout',
        'Text:Inside:Before destroy insertion',
        'Text:Inside:Before destroy layout',
        'AsyncText:Async destroy layout',
        'ClassText:Inside:After componentWillUnmount',
        'Text:Outside destroy insertion',
        'Text:Outside destroy layout',
        'App destroy passive',
        'Text:Inside:Before destroy passive',
        'AsyncText:Async destroy passive',
        'Text:Outside destroy passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(null);
    });
  });

  /** 覆盖已显示主树在更新中再次挂起时 effect 的断开、恢复、嵌套与错误处理。 */
  describe('effects within a tree that re-suspends in an update', () => {
    /**
     * 场景（Given–When–Then）：给定 legacy 根已显示主树；当更新加入 Async 而再次挂起；那么
     * 旧主树仅隐藏、effect 不销毁，资源完成时也不重建既有 effect，只处理新增 Async/fallback。
     * 对应机制：旧模式 update fallback 不断开 layout/passive effects。
     */
    // @gate enableLegacyCache && !disableLegacyMode
    it('should not be destroyed or recreated in legacy roots', async () => {
      /** 安装 App layout/passive effect，并包裹可重挂起的主树。 */
      function App({children = null}) {
        Scheduler.log('App render');
        React.useLayoutEffect(() => {
          Scheduler.log('App create layout');
          return () => {
            Scheduler.log('App destroy layout');
          };
        }, []);
        React.useEffect(() => {
          Scheduler.log('App create passive');
          return () => {
            Scheduler.log('App destroy passive');
          };
        }, []);
        return (
          <>
            <Suspense fallback={<Text text="Fallback" />}>
              <Text text="Inside:Before" />
              {children}
              <Text text="Inside:After" />
            </Suspense>
            <Text text="Outside" />
          </>
        );
      }

      // 初次挂载完整主树。
      await act(() => {
        ReactNoop.renderLegacySyncRoot(<App />);
      });
      assertLog([
        'App render',
        'Text:Inside:Before render',
        'Text:Inside:After render',
        'Text:Outside render',
        'Text:Inside:Before create insertion',
        'Text:Inside:After create insertion',
        'Text:Outside create insertion',
        'Text:Inside:Before create layout',
        'Text:Inside:After create layout',
        'Text:Outside create layout',
        'App create layout',
        'Text:Inside:Before create passive',
        'Text:Inside:After create passive',
        'Text:Outside create passive',
        'App create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Inside:Before" />
          <span prop="Inside:After" />
          <span prop="Outside" />
        </>,
      );

      // 更新加入 Async，使边界再次挂起。
      await act(() => {
        ReactNoop.renderLegacySyncRoot(
          <App>
            <AsyncText text="Async" />
          </App>,
        );
      });
      assertLog([
        'App render',
        'Text:Inside:Before render',
        'Suspend:Async',
        'Text:Inside:After render',
        'Text:Fallback render',
        'Text:Outside render',
        'Text:Fallback create insertion',
        'Text:Fallback create layout',
        'Text:Fallback create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Inside:Before" hidden={true} />
          <span prop="Inside:After" hidden={true} />
          <span prop="Fallback" />
          <span prop="Outside" />
        </>,
      );

      await advanceTimers(1000);

      // 同步根已经提交 fallback，推进计时器不会改变输出。
      assertLog([]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Inside:Before" hidden={true} />
          <span prop="Inside:After" hidden={true} />
          <span prop="Fallback" />
          <span prop="Outside" />
        </>,
      );

      // 完成资源只创建新增 Async effect，不重建旧主树 effect。
      await act(async () => {
        await resolveText('Async');
      });
      assertLog([
        'AsyncText:Async render',
        'Text:Fallback destroy insertion',
        'Text:Fallback destroy layout',
        'AsyncText:Async create layout',
        'Text:Fallback destroy passive',
        'AsyncText:Async create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Inside:Before" />
          <span prop="Async" />
          <span prop="Inside:After" />
          <span prop="Outside" />
        </>,
      );

      await act(() => {
        ReactNoop.renderLegacySyncRoot(null);
      });
      assertLog([
        'App destroy layout',
        'Text:Inside:Before destroy insertion',
        'Text:Inside:Before destroy layout',
        'AsyncText:Async destroy layout',
        'Text:Inside:After destroy insertion',
        'Text:Inside:After destroy layout',
        'Text:Outside destroy insertion',
        'Text:Outside destroy layout',
        'App destroy passive',
        'Text:Inside:Before destroy passive',
        'AsyncText:Async destroy passive',
        'Text:Inside:After destroy passive',
        'Text:Outside destroy passive',
      ]);
    });

    /**
     * 场景（Given–When–Then）：给定并发根已显示函数组件 effect；当更新重挂起并提交 fallback；
     * 那么隐藏主树 layout effect 被销毁，揭示时重建，passive effect 保持挂载到真实删除。
     * 对应机制：Offscreen 隐藏/揭示断开并恢复 layout effects。
     */
    // @gate enableLegacyCache
    it('should be destroyed and recreated for function components', async () => {
      /** 安装 App effect，并在边界内外组合 Text 探针。 */
      function App({children = null}) {
        Scheduler.log('App render');
        React.useLayoutEffect(() => {
          Scheduler.log('App create layout');
          return () => {
            Scheduler.log('App destroy layout');
          };
        }, []);
        React.useEffect(() => {
          Scheduler.log('App create passive');
          return () => {
            Scheduler.log('App destroy passive');
          };
        }, []);
        return (
          <>
            <Suspense fallback={<Text text="Fallback" />}>
              <Text text="Inside:Before" />
              {children}
              <Text text="Inside:After" />
            </Suspense>
            <Text text="Outside" />
          </>
        );
      }

      await act(() => {
        ReactNoop.render(<App />);
      });
      assertLog([
        'App render',
        'Text:Inside:Before render',
        'Text:Inside:After render',
        'Text:Outside render',
        'Text:Inside:Before create insertion',
        'Text:Inside:After create insertion',
        'Text:Outside create insertion',
        'Text:Inside:Before create layout',
        'Text:Inside:After create layout',
        'Text:Outside create layout',
        'App create layout',
        'Text:Inside:Before create passive',
        'Text:Inside:After create passive',
        'Text:Outside create passive',
        'App create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Inside:Before" />
          <span prop="Inside:After" />
          <span prop="Outside" />
        </>,
      );

      // 更新加入 Async，使并发边界重挂起。
      await act(async () => {
        ReactNoop.render(
          <App>
            <AsyncText text="Async" />
          </App>,
        );
        await waitFor([
          'App render',
          'Text:Inside:Before render',
          'Suspend:Async',
          'Text:Fallback render',
          'Text:Outside render',
          'Text:Inside:Before destroy layout',
          'Text:Inside:After destroy layout',
          'Text:Fallback create insertion',
          'Text:Fallback create layout',
        ]);
        await waitForAll([
          'Text:Fallback create passive',
          // 后台预热隐藏主树。
          'Text:Inside:Before render',
          'Suspend:Async',
          'Text:Inside:After render',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="Inside:Before" hidden={true} />
            <span prop="Inside:After" hidden={true} />
            <span prop="Fallback" />
            <span prop="Outside" />
          </>,
        );
      });

      // 完成资源后重建隐藏主树 layout effect。
      await act(async () => {
        await resolveText('Async');
      });
      assertLog([
        'Text:Inside:Before render',
        'AsyncText:Async render',
        'Text:Inside:After render',
        'Text:Fallback destroy insertion',
        'Text:Fallback destroy layout',
        'Text:Inside:Before create layout',
        'AsyncText:Async create layout',
        'Text:Inside:After create layout',
        'Text:Fallback destroy passive',
        'AsyncText:Async create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Inside:Before" />
          <span prop="Async" />
          <span prop="Inside:After" />
          <span prop="Outside" />
        </>,
      );

      await act(() => {
        ReactNoop.render(null);
      });
      assertLog([
        'App destroy layout',
        'Text:Inside:Before destroy insertion',
        'Text:Inside:Before destroy layout',
        'AsyncText:Async destroy layout',
        'Text:Inside:After destroy insertion',
        'Text:Inside:After destroy layout',
        'Text:Outside destroy insertion',
        'Text:Outside destroy layout',
        'App destroy passive',
        'Text:Inside:Before destroy passive',
        'AsyncText:Async destroy passive',
        'Text:Inside:After destroy passive',
        'Text:Outside destroy passive',
      ]);
    });

    /**
     * 场景（Given–When–Then）：给定并发根主树使用类生命周期；当更新重挂起；那么隐藏时调用
     * componentWillUnmount，揭示时再次 componentDidMount，边界外节点只 update。
     * 对应机制：Offscreen layout disconnect 对类组件模拟卸载/挂载。
     */
    // @gate enableLegacyCache
    it('should be destroyed and recreated for class components', async () => {
      /** 记录类节点 render 与 mount/update/unmount。 */
      class ClassText extends React.Component {
        /** 记录类节点挂载或重新揭示。 */
        componentDidMount() {
          const {text} = this.props;
          Scheduler.log(`ClassText:${text} componentDidMount`);
        }
        /** 记录仍可见类节点的更新。 */
        componentDidUpdate() {
          const {text} = this.props;
          Scheduler.log(`ClassText:${text} componentDidUpdate`);
        }
        /** 记录隐藏断开或真实删除。 */
        componentWillUnmount() {
          const {text} = this.props;
          Scheduler.log(`ClassText:${text} componentWillUnmount`);
        }
        /** 记录 render 并输出带 prop 的 span。 */
        render() {
          const {children, text} = this.props;
          Scheduler.log(`ClassText:${text} render`);
          return <span prop={text}>{children}</span>;
        }
      }

      /** 用 ClassText 构成 fallback、边界内外生命周期探针。 */
      function App({children = null}) {
        Scheduler.log('App render');
        React.useLayoutEffect(() => {
          Scheduler.log('App create layout');
          return () => {
            Scheduler.log('App destroy layout');
          };
        }, []);
        React.useEffect(() => {
          Scheduler.log('App create passive');
          return () => {
            Scheduler.log('App destroy passive');
          };
        }, []);
        return (
          <>
            <Suspense fallback={<ClassText text="Fallback" />}>
              <ClassText text="Inside:Before" />
              {children}
              <ClassText text="Inside:After" />
            </Suspense>
            <ClassText text="Outside" />
          </>
        );
      }

      // 初次挂载完整主树。
      await act(() => {
        ReactNoop.render(<App />);
      });
      assertLog([
        'App render',
        'ClassText:Inside:Before render',
        'ClassText:Inside:After render',
        'ClassText:Outside render',
        'ClassText:Inside:Before componentDidMount',
        'ClassText:Inside:After componentDidMount',
        'ClassText:Outside componentDidMount',
        'App create layout',
        'App create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Inside:Before" />
          <span prop="Inside:After" />
          <span prop="Outside" />
        </>,
      );

      // 更新加入 Async，使边界重挂起。
      await act(async () => {
        ReactNoop.render(
          <App>
            <AsyncText text="Async" />
          </App>,
        );

        await waitFor([
          'App render',
          'ClassText:Inside:Before render',
          'Suspend:Async',
          'ClassText:Fallback render',
          'ClassText:Outside render',
          'ClassText:Inside:Before componentWillUnmount',
          'ClassText:Inside:After componentWillUnmount',
          'ClassText:Fallback componentDidMount',
          'ClassText:Outside componentDidUpdate',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="Inside:Before" hidden={true} />
            <span prop="Inside:After" hidden={true} />
            <span prop="Fallback" />
            <span prop="Outside" />
          </>,
        );
      });
      // 后台预热隐藏主树。
      assertLog([
        'ClassText:Inside:Before render',
        'Suspend:Async',
        'ClassText:Inside:After render',
      ]);

      // 完成资源后为隐藏类节点重新执行挂载语义。
      await act(async () => {
        await resolveText('Async');
      });
      assertLog([
        'ClassText:Inside:Before render',
        'AsyncText:Async render',
        'ClassText:Inside:After render',
        'ClassText:Fallback componentWillUnmount',
        'ClassText:Inside:Before componentDidMount',
        'AsyncText:Async create layout',
        'ClassText:Inside:After componentDidMount',
        'AsyncText:Async create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Inside:Before" />
          <span prop="Async" />
          <span prop="Inside:After" />
          <span prop="Outside" />
        </>,
      );
      await act(() => {
        ReactNoop.render(null);
      });
      assertLog([
        'App destroy layout',
        'ClassText:Inside:Before componentWillUnmount',
        'AsyncText:Async destroy layout',
        'ClassText:Inside:After componentWillUnmount',
        'ClassText:Outside componentWillUnmount',
        'App destroy passive',
        'AsyncText:Async destroy passive',
      ]);
    });

    /**
     * 场景（Given–When–Then）：给定 Outer/Inner effect 嵌套在宿主 span 下；当祖先边界重挂起；
     * 那么 layout cleanup 仍深入宿主后代按父子顺序断开，揭示时按子到父重建。
     * 对应机制：Offscreen effect traversal 不因 HostComponent 边界停止。
     */
    // @gate enableLegacyCache
    it('should be destroyed and recreated when nested below host components', async () => {
      /** 在一个可重挂起边界内嵌套 Outer/Inner Text。 */
      function App({children = null}) {
        Scheduler.log('App render');
        React.useLayoutEffect(() => {
          Scheduler.log('App create layout');
          return () => {
            Scheduler.log('App destroy layout');
          };
        }, []);
        React.useEffect(() => {
          Scheduler.log('App create passive');
          return () => {
            Scheduler.log('App destroy passive');
          };
        }, []);
        return (
          <Suspense fallback={<Text text="Fallback" />}>
            {children}
            <Text text="Outer">
              <Text text="Inner" />
            </Text>
          </Suspense>
        );
      }

      // 初次挂载嵌套 effect 树。
      await act(() => {
        ReactNoop.render(<App />);
      });
      assertLog([
        'App render',
        'Text:Outer render',
        'Text:Inner render',
        'Text:Inner create insertion',
        'Text:Outer create insertion',
        'Text:Inner create layout',
        'Text:Outer create layout',
        'App create layout',
        'Text:Inner create passive',
        'Text:Outer create passive',
        'App create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <span prop="Outer">
          <span prop="Inner" />
        </span>,
      );

      // 更新加入 Async，使祖先边界重挂起。
      await act(async () => {
        ReactNoop.render(
          <App>
            <AsyncText text="Async" />
          </App>,
        );
        await waitFor([
          'App render',
          'Suspend:Async',
          'Text:Fallback render',
          'Text:Outer destroy layout',
          'Text:Inner destroy layout',
          'Text:Fallback create insertion',
          'Text:Fallback create layout',
        ]);
        await waitForAll([
          'Text:Fallback create passive',
          // 后台预热隐藏主树。
          'Suspend:Async',
          'Text:Outer render',
          'Text:Inner render',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span hidden={true} prop="Outer">
              <span prop="Inner" />
            </span>
            <span prop="Fallback" />
          </>,
        );
      });

      // 完成资源后重建宿主后代中的 layout effects。
      await act(async () => {
        await resolveText('Async');
      });
      assertLog([
        'AsyncText:Async render',
        'Text:Outer render',
        'Text:Inner render',
        'Text:Fallback destroy insertion',
        'Text:Fallback destroy layout',
        'AsyncText:Async create layout',
        'Text:Inner create layout',
        'Text:Outer create layout',
        'Text:Fallback destroy passive',
        'AsyncText:Async create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Async" />
          <span prop="Outer">
            <span prop="Inner" />
          </span>
        </>,
      );

      await act(() => {
        ReactNoop.render(null);
      });
      assertLog([
        'App destroy layout',
        'AsyncText:Async destroy layout',
        'Text:Outer destroy insertion',
        'Text:Outer destroy layout',
        'Text:Inner destroy insertion',
        'Text:Inner destroy layout',
        'App destroy passive',
        'AsyncText:Async destroy passive',
        'Text:Outer destroy passive',
        'Text:Inner destroy passive',
      ]);
    });

    /**
     * 场景（Given–When–Then）：给定 MemoizedInner 永远 props bailout；当祖先 Suspense 隐藏再揭示；
     * 那么其 render 可跳过，但 layout cleanup/create 仍执行。
     * 对应机制：Offscreen 可见性 effect flags 穿透 memo bailout 的克隆子树。
     */
    // @gate enableLegacyCache
    it('should be destroyed and recreated even if there is a bailout because of memoization', async () => {
      const MemoizedText = React.memo(Text, () => true);

      /** 在 Outer 下放置永远 memo bailout 的 Inner effect 探针。 */
      function App({children = null}) {
        Scheduler.log('App render');
        React.useLayoutEffect(() => {
          Scheduler.log('App create layout');
          return () => {
            Scheduler.log('App destroy layout');
          };
        }, []);
        React.useEffect(() => {
          Scheduler.log('App create passive');
          return () => {
            Scheduler.log('App destroy passive');
          };
        }, []);
        return (
          <Suspense fallback={<Text text="Fallback" />}>
            {children}
            <Text text="Outer">
              <MemoizedText text="MemoizedInner" />
            </Text>
          </Suspense>
        );
      }

      // 初次挂载 memo 化子树。
      await act(() => {
        ReactNoop.render(<App />);
      });
      assertLog([
        'App render',
        'Text:Outer render',
        'Text:MemoizedInner render',
        'Text:MemoizedInner create insertion',
        'Text:Outer create insertion',
        'Text:MemoizedInner create layout',
        'Text:Outer create layout',
        'App create layout',
        'Text:MemoizedInner create passive',
        'Text:Outer create passive',
        'App create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <span prop="Outer">
          <span prop="MemoizedInner" />
        </span>,
      );

      // 更新加入 Async，使祖先边界重挂起。
      await act(async () => {
        ReactNoop.render(
          <App>
            <AsyncText text="Async" />
          </App>,
        );
        await waitFor([
          'App render',
          'Suspend:Async',
          // MemoizedInner 因 memo 比较跳过 render。
          'Text:Fallback render',
          'Text:Outer destroy layout',
          'Text:MemoizedInner destroy layout',
          'Text:Fallback create insertion',
          'Text:Fallback create layout',
        ]);
        await waitForAll([
          'Text:Fallback create passive',
          // 后台预热，Inner 仍保持 bailout。
          'Suspend:Async',
          'Text:Outer render',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span hidden={true} prop="Outer">
              <span prop="MemoizedInner" />
            </span>
            <span prop="Fallback" />
          </>,
        );
      });

      // 完成资源后即使未重渲染 Inner，也必须重建其 layout effect。
      await act(async () => {
        await resolveText('Async');
      });
      assertLog([
        'AsyncText:Async render',
        'Text:Outer render',
        'Text:Fallback destroy insertion',
        'Text:Fallback destroy layout',
        'AsyncText:Async create layout',
        'Text:MemoizedInner create layout',
        'Text:Outer create layout',
        'Text:Fallback destroy passive',
        'AsyncText:Async create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Async" />
          <span prop="Outer">
            <span prop="MemoizedInner" />
          </span>
        </>,
      );

      await act(() => {
        ReactNoop.render(null);
      });
      assertLog([
        'App destroy layout',
        'AsyncText:Async destroy layout',
        'Text:Outer destroy insertion',
        'Text:Outer destroy layout',
        'Text:MemoizedInner destroy insertion',
        'Text:MemoizedInner destroy layout',
        'App destroy passive',
        'AsyncText:Async destroy passive',
        'Text:Outer destroy passive',
        'Text:MemoizedInner destroy passive',
      ]);
    });

    /**
     * 场景（Given–When–Then）：给定内外两层已显示边界；当依次挂起/揭示内层、外层；那么每次只
     * 断开当前被隐藏可见域的 layout effects，祖先已隐藏时内层状态变化不重复创建/销毁。
     * 对应机制：嵌套 Offscreen visibility 边界独立跟踪 effect 连接状态。
     */
    // @gate enableLegacyCache
    it('should respect nested suspense boundaries', async () => {
      /** 接受内外异步 children，组成两层带 effect 探针的 Suspense。 */
      function App({innerChildren = null, outerChildren = null}) {
        return (
          <Suspense fallback={<Text text="OuterFallback" />}>
            <Text text="Outer" />
            {outerChildren}
            <Suspense fallback={<Text text="InnerFallback" />}>
              <Text text="Inner" />
              {innerChildren}
            </Suspense>
          </Suspense>
        );
      }

      // 初次挂载两层主树。
      await act(() => {
        ReactNoop.render(<App />);
      });
      assertLog([
        'Text:Outer render',
        'Text:Inner render',
        'Text:Outer create insertion',
        'Text:Inner create insertion',
        'Text:Outer create layout',
        'Text:Inner create layout',
        'Text:Outer create passive',
        'Text:Inner create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Outer" />
          <span prop="Inner" />
        </>,
      );

      // 只挂起内层；仅销毁内层 effects。
      await act(() => {
        ReactNoop.render(
          <App innerChildren={<AsyncText text="InnerAsync_1" />} />,
        );
      });
      assertLog([
        'Text:Outer render',
        'Text:Inner render',
        'Suspend:InnerAsync_1',
        'Text:InnerFallback render',
        'Text:Inner destroy layout',
        'Text:InnerFallback create insertion',
        'Text:InnerFallback create layout',
        'Text:InnerFallback create passive',
        // 后台预热内层。
        'Text:Inner render',
        'Suspend:InnerAsync_1',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Outer" />
          <span prop="Inner" hidden={true} />
          <span prop="InnerFallback" />
        </>,
      );

      // 再挂起外层；销毁外层和当前内层 fallback effects，并避免重复销毁已隐藏内容。
      await act(() => {
        ReactNoop.render(
          <App
            outerChildren={<AsyncText text="OuterAsync_1" />}
            innerChildren={<AsyncText text="InnerAsync_1" />}
          />,
        );
      });
      await advanceTimers(1000);
      assertLog([
        'Text:Outer render',
        'Suspend:OuterAsync_1',
        'Text:OuterFallback render',
        'Text:Outer destroy layout',
        'Text:InnerFallback destroy layout',
        'Text:OuterFallback create insertion',
        'Text:OuterFallback create layout',
        'Text:OuterFallback create passive',
        // 在外层隐藏域中预热整棵主树。
        'Text:Outer render',
        'Suspend:OuterAsync_1',
        'Text:Inner render',
        'Suspend:InnerAsync_1',
        'Text:InnerFallback render',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Outer" hidden={true} />
          <span prop="Inner" hidden={true} />
          <span prop="InnerFallback" hidden={true} />
          <span prop="OuterFallback" />
        </>,
      );

      // 外层仍隐藏时完成内层；不应重建任何 effects。
      await act(async () => {
        await resolveText('InnerAsync_1');
      });
      assertLog([
        'Text:Outer render',
        'Suspend:OuterAsync_1',
        // 外层仍挂起，只更新其后台树。
        'Text:Outer render',
        'Suspend:OuterAsync_1',
        'Text:Inner render',
        'AsyncText:InnerAsync_1 render',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Outer" hidden={true} />
          <span prop="Inner" hidden={true} />
          <span prop="InnerFallback" hidden={true} />
          <span prop="OuterFallback" />
        </>,
      );

      // 外层仍隐藏时让内层再次挂起；不应重复销毁 effects。
      await act(() => {
        ReactNoop.render(
          <App
            outerChildren={<AsyncText text="OuterAsync_1" />}
            innerChildren={<AsyncText text="InnerAsync_2" />}
          />,
        );
      });
      await advanceTimers(1000);
      assertLog([
        'Text:Outer render',
        'Suspend:OuterAsync_1',
        'Text:OuterFallback render',
        // 在隐藏外层中预热新的内层状态。
        'Text:Outer render',
        'Suspend:OuterAsync_1',
        'Text:Inner render',
        'Suspend:InnerAsync_2',
        'Text:InnerFallback render',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Outer" hidden={true} />
          <span prop="Inner" hidden={true} />
          <span prop="InnerFallback" hidden={true} />
          <span prop="OuterFallback" />
        </>,
      );

      // 完成外层；只恢复当前可见域（外层与内 fallback）的 effects。
      await act(async () => {
        await resolveText('OuterAsync_1');
      });
      assertLog([
        'Text:Outer render',
        'AsyncText:OuterAsync_1 render',
        'Text:Inner render',
        'Suspend:InnerAsync_2',
        'Text:InnerFallback render',
        'Text:OuterFallback destroy insertion',
        'Text:OuterFallback destroy layout',
        'Text:Outer create layout',
        'AsyncText:OuterAsync_1 create layout',
        'Text:InnerFallback create layout',
        'Text:OuterFallback destroy passive',
        'AsyncText:OuterAsync_1 create passive',
        // 内层仍挂起，后台预热其主树。
        'Text:Inner render',
        'Suspend:InnerAsync_2',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Outer" />
          <span prop="OuterAsync_1" />
          <span prop="Inner" hidden={true} />
          <span prop="InnerFallback" />
        </>,
      );

      // 完成内层；只恢复内层主树 effects。
      await act(async () => {
        await resolveText('InnerAsync_2');
      });
      assertLog([
        'Text:Inner render',
        'AsyncText:InnerAsync_2 render',
        'Text:InnerFallback destroy insertion',
        'Text:InnerFallback destroy layout',
        'Text:Inner create layout',
        'AsyncText:InnerAsync_2 create layout',
        'Text:InnerFallback destroy passive',
        'AsyncText:InnerAsync_2 create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Outer" />
          <span prop="OuterAsync_1" />
          <span prop="Inner" />
          <span prop="InnerAsync_2" />
        </>,
      );

      // 再挂起外层；当前整棵可见主树的 effects 都应断开。
      await act(() => {
        ReactNoop.render(
          <App
            outerChildren={<AsyncText text="OuterAsync_2" />}
            innerChildren={<AsyncText text="InnerAsync_2" />}
          />,
        );
      });
      assertLog([
        'Text:Outer render',
        'Suspend:OuterAsync_2',
        'Text:OuterFallback render',
        'Text:Outer destroy layout',
        'AsyncText:OuterAsync_1 destroy layout',
        'Text:Inner destroy layout',
        'AsyncText:InnerAsync_2 destroy layout',
        'Text:OuterFallback create insertion',
        'Text:OuterFallback create layout',
        'Text:OuterFallback create passive',
        // 后台预热外层主树。
        'Text:Outer render',
        'Suspend:OuterAsync_2',
        'Text:Inner render',
        'AsyncText:InnerAsync_2 render',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Outer" hidden={true} />
          <span prop="OuterAsync_1" hidden={true} />
          <span prop="Inner" hidden={true} />
          <span prop="InnerAsync_2" hidden={true} />
          <span prop="OuterFallback" />
        </>,
      );

      // 完成外层；整棵主树 effects 都应恢复。
      await act(async () => {
        await resolveText('OuterAsync_2');
      });
      assertLog([
        'Text:Outer render',
        'AsyncText:OuterAsync_2 render',
        'Text:Inner render',
        'AsyncText:InnerAsync_2 render',
        'Text:OuterFallback destroy insertion',
        'Text:OuterFallback destroy layout',
        'Text:Outer create layout',
        'AsyncText:OuterAsync_2 create layout',
        'Text:Inner create layout',
        'AsyncText:InnerAsync_2 create layout',
        'Text:OuterFallback destroy passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Outer" />
          <span prop="OuterAsync_2" />
          <span prop="Inner" />
          <span prop="InnerAsync_2" />
        </>,
      );
    });

    /**
     * 场景（Given–When–Then）：给定内外边界都显示 fallback；当新 render 使内层不再挂起、外层仍挂起；
     * 那么该 render 不提交，内层旧 fallback 不会意外揭示或让 div 重现。
     * 对应机制：外层 suspended 完成树阻止内层可见性 mutation 单独提交。
     */
    // @gate enableLegacyCache
    it('should wait to reveal an inner child when inner one reveals first', async () => {
      /** 通过内外 children 分别控制两层边界挂起。 */
      function App({outerChildren, innerChildren}) {
        return (
          <Suspense fallback={<Text text="OuterFallback" />} name="Outer">
            <Suspense fallback={<Text text="InnerFallback" />} name="Inner">
              <div>{innerChildren}</div>
            </Suspense>
            {outerChildren}
          </Suspense>
        );
      }

      // 初次挂载空内层 div。
      await act(() => {
        ReactNoop.render(<App />);
      });
      assertLog([]);
      expect(ReactNoop).toMatchRenderedOutput(<div />);

      // 让内层边界挂起并显示其 fallback。
      await act(() => {
        ReactNoop.render(
          <App
            outerChildren={null}
            innerChildren={<AsyncText text="InnerAsync" />}
          />,
        );
      });
      assertLog([
        'Suspend:InnerAsync',
        'Text:InnerFallback render',
        'Text:InnerFallback create insertion',
        'Text:InnerFallback create layout',
        'Text:InnerFallback create passive',
        'Suspend:InnerAsync',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <div hidden={true} />
          <span prop="InnerFallback" />
        </>,
      );

      // 让内外两层同时挂起，外 fallback 接管可见输出。
      await act(() => {
        ReactNoop.render(
          <App
            outerChildren={<AsyncText text="OuterAsync" />}
            innerChildren={<AsyncText text="InnerAsync" />}
          />,
        );
      });
      assertLog([
        'Suspend:InnerAsync',
        'Text:InnerFallback render',
        'Suspend:OuterAsync',
        'Text:OuterFallback render',
        'Text:InnerFallback destroy layout',
        'Text:OuterFallback create insertion',
        'Text:OuterFallback create layout',
        'Text:OuterFallback create passive',
        'Suspend:InnerAsync',
        'Text:InnerFallback render',
        'Suspend:OuterAsync',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <div hidden={true} />
          <span prop="InnerFallback" hidden={true} />
          <span prop="OuterFallback" />
        </>,
      );

      // 只解除内层挂起；因外层仍挂起，该树不会提交，否则 div 可能错误重现。
      await act(() => {
        ReactNoop.render(
          <App
            outerChildren={<AsyncText text="OuterAsync" />}
            innerChildren={null}
          />,
        );
      });
      assertLog([
        'Suspend:OuterAsync',
        'Text:OuterFallback render',
        'Suspend:OuterAsync',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <div hidden={true} />
          <span prop="InnerFallback" hidden={true} />
          <span prop="OuterFallback" />
        </>,
      );
    });

    /**
     * 场景（Given–When–Then）：给定内外边界均隐藏各自主树；当两个资源在同一 act 中完成；
     * 那么一次提交同时揭示所有嵌套宿主节点并恢复两层 effects。
     * 对应机制：合并 ping 后从外边界完成一致的 visibility mutation。
     */
    // @gate enableLegacyCache
    it('should show nested host nodes if multiple boundaries resolve at the same time', async () => {
      /** 组成可由两个资源独立挂起、同时完成的嵌套边界。 */
      function App({innerChildren = null, outerChildren = null}) {
        return (
          <Suspense fallback={<Text text="OuterFallback" />}>
            <Text text="Outer" />
            {outerChildren}
            <Suspense fallback={<Text text="InnerFallback" />}>
              <Text text="Inner" />
              {innerChildren}
            </Suspense>
          </Suspense>
        );
      }

      // 初次挂载两层主树。
      await act(() => {
        ReactNoop.render(<App />);
      });
      assertLog([
        'Text:Outer render',
        'Text:Inner render',
        'Text:Outer create insertion',
        'Text:Inner create insertion',
        'Text:Outer create layout',
        'Text:Inner create layout',
        'Text:Outer create passive',
        'Text:Inner create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Outer" />
          <span prop="Inner" />
        </>,
      );

      // 先挂起内层，仅断开内层 effects。
      await act(() => {
        ReactNoop.render(
          <App innerChildren={<AsyncText text="InnerAsync_1" />} />,
        );
      });
      assertLog([
        'Text:Outer render',
        'Text:Inner render',
        'Suspend:InnerAsync_1',
        'Text:InnerFallback render',
        'Text:Inner destroy layout',
        'Text:InnerFallback create insertion',
        'Text:InnerFallback create layout',
        'Text:InnerFallback create passive',
        // 后台预热内层。
        'Text:Inner render',
        'Suspend:InnerAsync_1',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Outer" />
          <span prop="Inner" hidden={true} />
          <span prop="InnerFallback" />
        </>,
      );

      // 再挂起外层，断开外层和内 fallback effects，同时避免重复处理已隐藏主树。
      await act(() => {
        ReactNoop.render(
          <App
            outerChildren={<AsyncText text="OuterAsync_1" />}
            innerChildren={<AsyncText text="InnerAsync_1" />}
          />,
        );
      });
      assertLog([
        'Text:Outer render',
        'Suspend:OuterAsync_1',
        'Text:OuterFallback render',
        'Text:Outer destroy layout',
        'Text:InnerFallback destroy layout',
        'Text:OuterFallback create insertion',
        'Text:OuterFallback create layout',
        'Text:OuterFallback create passive',
        // 在外层隐藏域中预热主树。
        'Text:Outer render',
        'Suspend:OuterAsync_1',
        'Text:Inner render',
        'Suspend:InnerAsync_1',
        'Text:InnerFallback render',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Outer" hidden={true} />
          <span prop="Inner" hidden={true} />
          <span prop="InnerFallback" hidden={true} />
          <span prop="OuterFallback" />
        </>,
      );

      // 同批完成内外资源并揭示全部宿主节点。
      await act(async () => {
        await resolveText('OuterAsync_1');
        await resolveText('InnerAsync_1');
      });
      assertLog([
        'Text:Outer render',
        'AsyncText:OuterAsync_1 render',
        'Text:Inner render',
        'AsyncText:InnerAsync_1 render',
        'Text:OuterFallback destroy insertion',
        'Text:OuterFallback destroy layout',
        'Text:InnerFallback destroy insertion',
        'Text:Outer create layout',
        'AsyncText:OuterAsync_1 create layout',
        'Text:Inner create layout',
        'AsyncText:InnerAsync_1 create layout',
        'Text:OuterFallback destroy passive',
        'Text:InnerFallback destroy passive',
        'AsyncText:OuterAsync_1 create passive',
        'AsyncText:InnerAsync_1 create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Outer" />
          <span prop="OuterAsync_1" />
          <span prop="Inner" />
          <span prop="InnerAsync_1" />
        </>,
      );
    });

    /**
     * 场景（Given–When–Then）：给定外边界 fallback 自身含会挂起的内边界；当外主树先挂起、
     * fallback 再挂起；那么 fallback 内已显示 effects 也被清理，两个资源同批完成后只恢复主树。
     * 对应机制：fallback 子树同样参与 Offscreen layout disconnect。
     */
    // @gate enableLegacyCache
    it('should be cleaned up inside of a fallback that suspends', async () => {
      /** 构造含嵌套 Suspense 的 fallback，并分别控制主树与 fallback 资源。 */
      function App({fallbackChildren = null, outerChildren = null}) {
        return (
          <>
            <Suspense
              fallback={
                <>
                  <Suspense fallback={<Text text="Fallback:Fallback" />}>
                    <Text text="Fallback:Inside" />
                    {fallbackChildren}
                  </Suspense>
                  <Text text="Fallback:Outside" />
                </>
              }>
              <Text text="Inside" />
              {outerChildren}
            </Suspense>
            <Text text="Outside" />
          </>
        );
      }

      // 初次挂载外主树。
      await act(() => {
        ReactNoop.render(<App />);
      });
      assertLog([
        'Text:Inside render',
        'Text:Outside render',
        'Text:Inside create insertion',
        'Text:Outside create insertion',
        'Text:Inside create layout',
        'Text:Outside create layout',
        'Text:Inside create passive',
        'Text:Outside create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Inside" />
          <span prop="Outside" />
        </>,
      );

      // 先挂起外层 shell，显示完整 fallback。
      await act(async () => {
        ReactNoop.render(
          <App outerChildren={<AsyncText text="OutsideAsync" />} />,
        );
        await waitFor([
          'Text:Inside render',
          'Suspend:OutsideAsync',
          'Text:Fallback:Inside render',
          'Text:Fallback:Outside render',
          'Text:Outside render',
          'Text:Inside destroy layout',
          'Text:Fallback:Inside create insertion',
          'Text:Fallback:Outside create insertion',
          'Text:Fallback:Inside create layout',
          'Text:Fallback:Outside create layout',
        ]);
        await waitForAll([
          'Text:Fallback:Inside create passive',
          'Text:Fallback:Outside create passive',
          // 后台预热外主树。
          'Text:Inside render',
          'Suspend:OutsideAsync',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="Inside" hidden={true} />
            <span prop="Fallback:Inside" />
            <span prop="Fallback:Outside" />
            <span prop="Outside" />
          </>,
        );
      });

      // 再让 fallback 内层挂起，验证其已显示 effects 也会清理。
      await act(async () => {
        ReactNoop.render(
          <App
            fallbackChildren={<AsyncText text="FallbackAsync" />}
            outerChildren={<AsyncText text="OutsideAsync" />}
          />,
        );
        await waitFor([
          'Text:Inside render',
          'Suspend:OutsideAsync',
          'Text:Fallback:Inside render',
          'Suspend:FallbackAsync',
          'Text:Fallback:Fallback render',
          'Text:Fallback:Outside render',
          'Text:Outside render',
          'Text:Fallback:Inside destroy layout',
          'Text:Fallback:Fallback create insertion',
          'Text:Fallback:Fallback create layout',
        ]);
        await waitForAll([
          'Text:Fallback:Fallback create passive',
          // 后台预热外主树和 fallback 主分支。
          'Text:Inside render',
          'Suspend:OutsideAsync',
          'Text:Fallback:Inside render',
          'Suspend:FallbackAsync',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="Inside" hidden={true} />
            <span prop="Fallback:Inside" hidden={true} />
            <span prop="Fallback:Fallback" />
            <span prop="Fallback:Outside" />
            <span prop="Outside" />
          </>,
        );
      });

      // 同批完成两资源，清理全部 fallback effects 并恢复外主树。
      await act(async () => {
        await resolveText('FallbackAsync');
        await resolveText('OutsideAsync');
      });
      assertLog([
        'Text:Inside render',
        'AsyncText:OutsideAsync render',
        'Text:Fallback:Inside destroy insertion',
        'Text:Fallback:Fallback destroy insertion',
        'Text:Fallback:Fallback destroy layout',
        'Text:Fallback:Outside destroy insertion',
        'Text:Fallback:Outside destroy layout',
        'Text:Inside create layout',
        'AsyncText:OutsideAsync create layout',
        'Text:Fallback:Inside destroy passive',
        'Text:Fallback:Fallback destroy passive',
        'Text:Fallback:Outside destroy passive',
        'AsyncText:OutsideAsync create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Inside" />
          <span prop="OutsideAsync" />
          <span prop="Outside" />
        </>,
      );
    });

    /**
     * 场景（Given–When–Then）：给定首次更新就让外主树与 fallback 内层同时挂起；当先完成 fallback
     * 资源、再完成外资源；那么中间正确显示 fallback 主分支，最终完整清理它并揭示外主树。
     * 对应机制：嵌套 fallback 的分阶段 reveal/cleanup。
     */
    // @gate enableLegacyCache
    it('should be cleaned up inside of a fallback that suspends (alternate)', async () => {
      /** 构造可同时挂起主树和 fallback 主分支的嵌套边界。 */
      function App({fallbackChildren = null, outerChildren = null}) {
        return (
          <>
            <Suspense
              fallback={
                <>
                  <Suspense fallback={<Text text="Fallback:Fallback" />}>
                    <Text text="Fallback:Inside" />
                    {fallbackChildren}
                  </Suspense>
                  <Text text="Fallback:Outside" />
                </>
              }>
              <Text text="Inside" />
              {outerChildren}
            </Suspense>
            <Text text="Outside" />
          </>
        );
      }

      // 初次挂载外主树。
      await act(() => {
        ReactNoop.render(<App />);
      });
      assertLog([
        'Text:Inside render',
        'Text:Outside render',
        'Text:Inside create insertion',
        'Text:Outside create insertion',
        'Text:Inside create layout',
        'Text:Outside create layout',
        'Text:Inside create passive',
        'Text:Outside create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Inside" />
          <span prop="Outside" />
        </>,
      );

      // 同次更新让外边界和 fallback 内边界挂起。
      await act(() => {
        ReactNoop.render(
          <App
            outerChildren={<AsyncText text="OutsideAsync" />}
            fallbackChildren={<AsyncText text="FallbackAsync" />}
          />,
        );
      });
      assertLog([
        'Text:Inside render',
        'Suspend:OutsideAsync',
        'Text:Fallback:Inside render',
        'Suspend:FallbackAsync',
        'Text:Fallback:Fallback render',
        'Text:Fallback:Outside render',
        'Text:Outside render',
        'Text:Inside destroy layout',
        'Text:Fallback:Fallback create insertion',
        'Text:Fallback:Outside create insertion',
        'Text:Fallback:Fallback create layout',
        'Text:Fallback:Outside create layout',
        'Text:Fallback:Fallback create passive',
        'Text:Fallback:Outside create passive',
        // 后台预热两个主分支。
        'Text:Inside render',
        'Suspend:OutsideAsync',
        'Text:Fallback:Inside render',
        'Suspend:FallbackAsync',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Inside" hidden={true} />
          <span prop="Fallback:Fallback" />
          <span prop="Fallback:Outside" />
          <span prop="Outside" />
        </>,
      );

      // 先完成 fallback 内部资源，揭示 fallback 主分支。
      await act(async () => {
        await resolveText('FallbackAsync');
      });
      assertLog([
        'Text:Fallback:Inside render',
        'AsyncText:FallbackAsync render',
        'Text:Fallback:Fallback destroy insertion',
        'Text:Fallback:Fallback destroy layout',
        'Text:Fallback:Inside create insertion',
        'Text:Fallback:Inside create layout',
        'AsyncText:FallbackAsync create layout',
        'Text:Fallback:Fallback destroy passive',
        'Text:Fallback:Inside create passive',
        'AsyncText:FallbackAsync create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Inside" hidden={true} />
          <span prop="Fallback:Inside" />
          <span prop="FallbackAsync" />
          <span prop="Fallback:Outside" />
          <span prop="Outside" />
        </>,
      );

      // 再完成外主树资源，清理 fallback 并揭示最终内容。
      await act(async () => {
        await resolveText('OutsideAsync');
      });
      assertLog([
        'Text:Inside render',
        'AsyncText:OutsideAsync render',
        'Text:Fallback:Inside destroy insertion',
        'Text:Fallback:Inside destroy layout',
        'AsyncText:FallbackAsync destroy layout',
        'Text:Fallback:Outside destroy insertion',
        'Text:Fallback:Outside destroy layout',
        'Text:Inside create layout',
        'AsyncText:OutsideAsync create layout',
        'Text:Fallback:Inside destroy passive',
        'AsyncText:FallbackAsync destroy passive',
        'Text:Fallback:Outside destroy passive',
        'AsyncText:OutsideAsync create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Inside" />
          <span prop="OutsideAsync" />
          <span prop="Outside" />
        </>,
      );
    });

    /**
     * 场景（Given–When–Then）：给定真正抛 thenable 的 ConditionalSuspense 位于更深函数组件中；
     * 当 shouldSuspend 变 true；那么祖先边界仍能找到并断开 Inside effect，Outside 不受影响。
     * 对应机制：挂起源深度不改变 Offscreen 可见域遍历。
     */
    // @gate enableLegacyCache
    it('should be cleaned up deeper inside of a subtree that suspends', async () => {
      /** 根据 prop 在深层调用 `readText` 挂起，否则输出 Inside effect 探针。 */
      function ConditionalSuspense({shouldSuspend}) {
        if (shouldSuspend) {
          readText('Suspend');
        }
        return <Text text="Inside" />;
      }

      /** 在边界内渲染深层挂起器，并在边界外保留 Outside。 */
      function App({children = null, shouldSuspend}) {
        return (
          <>
            <Suspense fallback={<Text text="Fallback" />}>
              <ConditionalSuspense shouldSuspend={shouldSuspend} />
            </Suspense>
            <Text text="Outside" />
          </>
        );
      }

      // 初次挂载未挂起的主树。
      await act(() => {
        ReactNoop.render(<App shouldSuspend={false} />);
      });
      assertLog([
        'Text:Inside render',
        'Text:Outside render',
        'Text:Inside create insertion',
        'Text:Outside create insertion',
        'Text:Inside create layout',
        'Text:Outside create layout',
        'Text:Inside create passive',
        'Text:Outside create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Inside" />
          <span prop="Outside" />
        </>,
      );

      // 中间组件挂起时，仍必须清理更深后代的 effects。
      await act(async () => {
        ReactNoop.render(<App shouldSuspend={true} />);
        await waitFor([
          'Suspend:Suspend',
          'Text:Fallback render',
          'Text:Outside render',
          'Text:Inside destroy layout',
          'Text:Fallback create insertion',
          'Text:Fallback create layout',
        ]);
        await waitForAll([
          'Text:Fallback create passive',
          // 后台预热挂起路径。
          'Suspend:Suspend',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="Inside" hidden={true} />
            <span prop="Fallback" />
            <span prop="Outside" />
          </>,
        );
      });

      // 完成资源后销毁 fallback 并恢复 Inside layout effect。
      await act(async () => {
        await resolveText('Suspend');
      });
      assertLog([
        'Text:Inside render',
        'Text:Fallback destroy insertion',
        'Text:Fallback destroy layout',
        'Text:Inside create layout',
        'Text:Fallback destroy passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Inside" />
          <span prop="Outside" />
        </>,
      );
    });

    /** 覆盖 effect/lifecycle 创建或销毁抛错时，剩余提交工作与整树清理仍能完成。 */
    describe('that throw errors', () => {
      /**
       * 场景（Given–When–Then）：给定隐藏类节点在 reveal 的 componentDidMount 抛错；当提交继续；
       * 那么后续 layout create 仍执行，随后完整清理错误树并由 ErrorBoundary 提交 Error。
       * 对应机制：commit layout 错误捕获不截断当前 effect traversal。
       */
      // @gate enableLegacyCache
      it('are properly handled for componentDidMount', async () => {
        let componentDidMountShouldThrow = false;

        /** 可切换为在 componentDidMount 抛错，并记录卸载。 */
        class ThrowsInDidMount extends React.Component {
          /** 记录隐藏断开或错误树删除。 */
          componentWillUnmount() {
            Scheduler.log('ThrowsInDidMount componentWillUnmount');
          }
          /** 记录挂载，并按测试开关抛出 expected。 */
          componentDidMount() {
            Scheduler.log('ThrowsInDidMount componentDidMount');
            if (componentDidMountShouldThrow) {
              throw Error('expected');
            }
          }
          /** 记录 render 并输出宿主 span。 */
          render() {
            Scheduler.log('ThrowsInDidMount render');
            return <span prop="ThrowsInDidMount" />;
          }
        }

        /** 把可抛错类节点与后续 Text 放在同一可重挂起边界。 */
        function App({children = null}) {
          Scheduler.log('App render');
          React.useLayoutEffect(() => {
            Scheduler.log('App create layout');
            return () => {
              Scheduler.log('App destroy layout');
            };
          }, []);
          return (
            <>
              <Suspense fallback={<Text text="Fallback" />}>
                {children}
                <ThrowsInDidMount />
                <Text text="Inside" />
              </Suspense>
              <Text text="Outside" />
            </>
          );
        }

        await act(() => {
          ReactNoop.render(
            <ErrorBoundary fallback={<Text text="Error" />}>
              <App />
            </ErrorBoundary>,
          );
        });
        assertLog([
          'ErrorBoundary render: try',
          'App render',
          'ThrowsInDidMount render',
          'Text:Inside render',
          'Text:Outside render',
          'Text:Inside create insertion',
          'Text:Outside create insertion',
          'ThrowsInDidMount componentDidMount',
          'Text:Inside create layout',
          'Text:Outside create layout',
          'App create layout',
          'Text:Inside create passive',
          'Text:Outside create passive',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="ThrowsInDidMount" />
            <span prop="Inside" />
            <span prop="Outside" />
          </>,
        );

        // 更新加入 Async，使类节点先因隐藏执行卸载。
        await act(() => {
          ReactNoop.render(
            <ErrorBoundary fallback={<Text text="Error" />}>
              <App>
                <AsyncText text="Async" />
              </App>
            </ErrorBoundary>,
          );
        });
        assertLog([
          'ErrorBoundary render: try',
          'App render',
          'Suspend:Async',
          'Text:Fallback render',
          'Text:Outside render',
          'ThrowsInDidMount componentWillUnmount',
          'Text:Inside destroy layout',
          'Text:Fallback create insertion',
          'Text:Fallback create layout',
          'Text:Fallback create passive',
          // 后台预热主树。
          'Suspend:Async',
          'ThrowsInDidMount render',
          'Text:Inside render',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="ThrowsInDidMount" hidden={true} />
            <span prop="Inside" hidden={true} />
            <span prop="Fallback" />
            <span prop="Outside" />
          </>,
        );

        // 完成资源并让重新挂载生命周期抛错。
        componentDidMountShouldThrow = true;
        await act(async () => {
          await resolveText('Async');
        });
        assertLog([
          'AsyncText:Async render',
          'ThrowsInDidMount render',
          'Text:Inside render',
          'Text:Fallback destroy insertion',
          'Text:Fallback destroy layout',
          'AsyncText:Async create layout',

          // componentDidMount 抛错后，后续 layout effect 仍应创建，以便随后统一清理。
          'ThrowsInDidMount componentDidMount',
          'Text:Inside create layout',

          // 完成当前进行中的 commit。
          'Text:Fallback destroy passive',
          'AsyncText:Async create passive',

          // 销毁错误树的 insertion、layout 与 passive effects。
          'App destroy layout',
          'AsyncText:Async destroy layout',
          'ThrowsInDidMount componentWillUnmount',
          'Text:Inside destroy insertion',
          'Text:Inside destroy layout',
          'Text:Outside destroy insertion',
          'Text:Outside destroy layout',
          'AsyncText:Async destroy passive',
          'Text:Inside destroy passive',
          'Text:Outside destroy passive',

          // 渲染错误边界 fallback。
          'ErrorBoundary render: catch',
          'Text:Error render',
          'Text:Error create insertion',
          'Text:Error create layout',
          'Text:Error create passive',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Error" />);
      });

      /**
       * 场景（Given–When–Then）：给定类节点在 Suspense 隐藏阶段 componentWillUnmount 抛错；
       * 当 fallback 提交；那么后续 layout cleanup 和当前 commit 仍完成，再清理整树并显示 Error。
       * 对应机制：commit mutation/layout 错误收集后继续遍历兄弟 effects。
       */
      // @gate enableLegacyCache
      it('are properly handled for componentWillUnmount', async () => {
        /** 在隐藏断开时抛错的类节点。 */
        class ThrowsInWillUnmount extends React.Component {
          /** 记录正常初次挂载。 */
          componentDidMount() {
            Scheduler.log('ThrowsInWillUnmount componentDidMount');
          }
          /** 记录后抛出 expected，模拟 layout disconnect 失败。 */
          componentWillUnmount() {
            Scheduler.log('ThrowsInWillUnmount componentWillUnmount');
            throw Error('expected');
          }
          /** 记录 render 并输出宿主 span。 */
          render() {
            Scheduler.log('ThrowsInWillUnmount render');
            return <span prop="ThrowsInWillUnmount" />;
          }
        }

        /** 将抛错类节点和后续 Text 放在同一可重挂起边界。 */
        function App({children = null}) {
          Scheduler.log('App render');
          React.useLayoutEffect(() => {
            Scheduler.log('App create layout');
            return () => {
              Scheduler.log('App destroy layout');
            };
          }, []);
          return (
            <>
              <Suspense fallback={<Text text="Fallback" />}>
                {children}
                <ThrowsInWillUnmount />
                <Text text="Inside" />
              </Suspense>
              <Text text="Outside" />
            </>
          );
        }

        await act(() => {
          ReactNoop.render(
            <ErrorBoundary fallback={<Text text="Error" />}>
              <App />
            </ErrorBoundary>,
          );
        });
        assertLog([
          'ErrorBoundary render: try',
          'App render',
          'ThrowsInWillUnmount render',
          'Text:Inside render',
          'Text:Outside render',
          'Text:Inside create insertion',
          'Text:Outside create insertion',
          'ThrowsInWillUnmount componentDidMount',
          'Text:Inside create layout',
          'Text:Outside create layout',
          'App create layout',
          'Text:Inside create passive',
          'Text:Outside create passive',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="ThrowsInWillUnmount" />
            <span prop="Inside" />
            <span prop="Outside" />
          </>,
        );

        // 更新挂起并触发 componentWillUnmount 错误。
        await act(() => {
          ReactNoop.render(
            <ErrorBoundary fallback={<Text text="Error" />}>
              <App>
                <AsyncText text="Async" />
              </App>
            </ErrorBoundary>,
          );
        });
        assertLog([
          'ErrorBoundary render: try',
          'App render',
          'Suspend:Async',
          'Text:Fallback render',
          'Text:Outside render',

          // componentWillUnmount 抛错后，后续 layout effects 仍应销毁。
          'ThrowsInWillUnmount componentWillUnmount',
          'Text:Inside destroy layout',

          // 完成当前进行中的 commit。
          'Text:Fallback create insertion',
          'Text:Fallback create layout',
          'Text:Fallback create passive',

          // 销毁错误树余下的 layout 与 passive effects。
          'App destroy layout',
          'Text:Inside destroy insertion',
          'Text:Fallback destroy insertion',
          'Text:Fallback destroy layout',
          'Text:Outside destroy insertion',
          'Text:Outside destroy layout',
          'Text:Inside destroy passive',
          'Text:Fallback destroy passive',
          'Text:Outside destroy passive',

          // 渲染错误边界 fallback。
          'ErrorBoundary render: catch',
          'Text:Error render',
          'Text:Error create insertion',
          'Text:Error create layout',
          'Text:Error create passive',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Error" />);
      });

      /**
       * 场景（Given–When–Then）：给定函数组件在 reveal 的 layout effect create 抛错；当主树提交；
       * 那么后续 layout creates 仍执行，再完整销毁错误树并显示 Error。
       * 对应机制：layout effect mount 错误不会截断 effect list。
       */
      // @gate enableLegacyCache
      it('are properly handled for layout effect creation', async () => {
        let useLayoutEffectShouldThrow = false;

        /** 可切换为在 layout create 阶段抛错的函数组件。 */
        function ThrowsInLayoutEffect({unused}) {
          Scheduler.log('ThrowsInLayoutEffect render');
          React.useLayoutEffect(() => {
            Scheduler.log('ThrowsInLayoutEffect useLayoutEffect create');
            if (useLayoutEffectShouldThrow) {
              throw Error('expected');
            }
            return () => {
              Scheduler.log('ThrowsInLayoutEffect useLayoutEffect destroy');
            };
          }, []);
          return <span prop="ThrowsInLayoutEffect" />;
        }

        /** 将抛错 effect 与后续 Text 放在同一可重挂起边界。 */
        function App({children = null}) {
          Scheduler.log('App render');
          React.useLayoutEffect(() => {
            Scheduler.log('App create layout');
            return () => {
              Scheduler.log('App destroy layout');
            };
          }, []);
          return (
            <>
              <Suspense fallback={<Text text="Fallback" />}>
                {children}
                <ThrowsInLayoutEffect />
                <Text text="Inside" />
              </Suspense>
              <Text text="Outside" />
            </>
          );
        }

        await act(() => {
          ReactNoop.render(
            <ErrorBoundary fallback={<Text text="Error" />}>
              <App />
            </ErrorBoundary>,
          );
        });
        assertLog([
          'ErrorBoundary render: try',
          'App render',
          'ThrowsInLayoutEffect render',
          'Text:Inside render',
          'Text:Outside render',
          'Text:Inside create insertion',
          'Text:Outside create insertion',
          'ThrowsInLayoutEffect useLayoutEffect create',
          'Text:Inside create layout',
          'Text:Outside create layout',
          'App create layout',
          'Text:Inside create passive',
          'Text:Outside create passive',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="ThrowsInLayoutEffect" />
            <span prop="Inside" />
            <span prop="Outside" />
          </>,
        );

        // 更新加入 Async，使当前 layout effect 先销毁。
        await act(() => {
          ReactNoop.render(
            <ErrorBoundary fallback={<Text text="Error" />}>
              <App>
                <AsyncText text="Async" />
              </App>
            </ErrorBoundary>,
          );
        });
        assertLog([
          'ErrorBoundary render: try',
          'App render',
          'Suspend:Async',
          'Text:Fallback render',
          'Text:Outside render',
          'ThrowsInLayoutEffect useLayoutEffect destroy',
          'Text:Inside destroy layout',
          'Text:Fallback create insertion',
          'Text:Fallback create layout',
          'Text:Fallback create passive',
          // 后台预热主树。
          'Suspend:Async',
          'ThrowsInLayoutEffect render',
          'Text:Inside render',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="ThrowsInLayoutEffect" hidden={true} />
            <span prop="Inside" hidden={true} />
            <span prop="Fallback" />
            <span prop="Outside" />
          </>,
        );

        // 完成资源并让 layout create 抛错。
        useLayoutEffectShouldThrow = true;
        await act(async () => {
          await resolveText('Async');
        });
        assertLog([
          'AsyncText:Async render',
          'ThrowsInLayoutEffect render',
          'Text:Inside render',

          'Text:Fallback destroy insertion',
          'Text:Fallback destroy layout',

          // useLayoutEffect 抛错后，后续 layout effects 仍应创建。
          'AsyncText:Async create layout',
          'ThrowsInLayoutEffect useLayoutEffect create',
          'Text:Inside create layout',

          // 完成当前进行中的 commit。
          'Text:Fallback destroy passive',
          'AsyncText:Async create passive',

          // 销毁错误树的 layout 与 passive effects。
          'App destroy layout',
          'AsyncText:Async destroy layout',
          'Text:Inside destroy insertion',
          'Text:Inside destroy layout',
          'Text:Outside destroy insertion',
          'Text:Outside destroy layout',
          'AsyncText:Async destroy passive',
          'Text:Inside destroy passive',
          'Text:Outside destroy passive',

          // 渲染错误边界 fallback。
          'ErrorBoundary render: catch',
          'Text:Error render',
          'Text:Error create insertion',
          'Text:Error create layout',
          'Text:Error create passive',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Error" />);
      });

      /**
       * 场景（Given–When–Then）：给定函数组件在 Suspense 隐藏的 layout cleanup 中抛错；当更新挂起；
       * 那么其余 cleanup 和 fallback commit 仍完成，随后 ErrorBoundary 接管。
       * 对应机制：layout effect unmount 错误隔离与继续遍历。
       */
      // @gate enableLegacyCache
      it('are properly handled for layout effect destruction', async () => {
        /** 安装一个 cleanup 必定抛出 expected 的 layout effect。 */
        function ThrowsInLayoutEffectDestroy({unused}) {
          Scheduler.log('ThrowsInLayoutEffectDestroy render');
          React.useLayoutEffect(() => {
            Scheduler.log('ThrowsInLayoutEffectDestroy useLayoutEffect create');
            return () => {
              Scheduler.log(
                'ThrowsInLayoutEffectDestroy useLayoutEffect destroy',
              );
              throw Error('expected');
            };
          }, []);
          return <span prop="ThrowsInLayoutEffectDestroy" />;
        }

        /** 将抛错 cleanup 与后续 Text 放在同一可重挂起边界。 */
        function App({children = null}) {
          Scheduler.log('App render');
          React.useLayoutEffect(() => {
            Scheduler.log('App create layout');
            return () => {
              Scheduler.log('App destroy layout');
            };
          }, []);
          return (
            <>
              <Suspense fallback={<Text text="Fallback" />}>
                {children}
                <ThrowsInLayoutEffectDestroy />
                <Text text="Inside" />
              </Suspense>
              <Text text="Outside" />
            </>
          );
        }

        await act(() => {
          ReactNoop.render(
            <ErrorBoundary fallback={<Text text="Error" />}>
              <App />
            </ErrorBoundary>,
          );
        });
        assertLog([
          'ErrorBoundary render: try',
          'App render',
          'ThrowsInLayoutEffectDestroy render',
          'Text:Inside render',
          'Text:Outside render',
          'Text:Inside create insertion',
          'Text:Outside create insertion',
          'ThrowsInLayoutEffectDestroy useLayoutEffect create',
          'Text:Inside create layout',
          'Text:Outside create layout',
          'App create layout',
          'Text:Inside create passive',
          'Text:Outside create passive',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="ThrowsInLayoutEffectDestroy" />
            <span prop="Inside" />
            <span prop="Outside" />
          </>,
        );

        // 更新挂起并触发 layout cleanup 错误。
        await act(() => {
          ReactNoop.render(
            <ErrorBoundary fallback={<Text text="Error" />}>
              <App>
                <AsyncText text="Async" />
              </App>
            </ErrorBoundary>,
          );
        });
        assertLog([
          'ErrorBoundary render: try',
          'App render',
          'Suspend:Async',
          'Text:Fallback render',
          'Text:Outside render',

          // layout cleanup 抛错后，后续 layout effects 仍应销毁。
          'ThrowsInLayoutEffectDestroy useLayoutEffect destroy',
          'Text:Inside destroy layout',

          // 完成当前进行中的 commit。
          'Text:Fallback create insertion',
          'Text:Fallback create layout',
          'Text:Fallback create passive',

          // 销毁错误树余下的 layout 与 passive effects。
          'App destroy layout',
          'Text:Inside destroy insertion',
          'Text:Fallback destroy insertion',
          'Text:Fallback destroy layout',
          'Text:Outside destroy insertion',
          'Text:Outside destroy layout',
          'Text:Inside destroy passive',
          'Text:Fallback destroy passive',
          'Text:Outside destroy passive',

          // 渲染错误边界 fallback。
          'ErrorBoundary render: catch',
          'Text:Error render',
          'Text:Error create insertion',
          'Text:Error create layout',
          'Text:Error create passive',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Error" />);
      });
    });

    /**
     * 场景（Given–When–Then）：给定同一边界更新中 Async_1/Async_2 两处挂起；当第一处完成仍被
     * 第二处阻塞；那么 Function/Class layout cleanup 只在首次隐藏执行一次，最终揭示时只重建一次。
     * 对应机制：Offscreen visibility 状态防止多个 suspension 重复 disconnect。
     */
    // @gate enableLegacyCache
    it('should be only destroy layout effects once if a tree suspends in multiple places', async () => {
      /** 记录边界内类节点的 mount/update/unmount。 */
      class ClassText extends React.Component {
        /** 记录类节点挂载或揭示。 */
        componentDidMount() {
          const {text} = this.props;
          Scheduler.log(`ClassText:${text} componentDidMount`);
        }
        /** 记录类节点可见更新。 */
        componentDidUpdate() {
          const {text} = this.props;
          Scheduler.log(`ClassText:${text} componentDidUpdate`);
        }
        /** 记录隐藏断开或删除。 */
        componentWillUnmount() {
          const {text} = this.props;
          Scheduler.log(`ClassText:${text} componentWillUnmount`);
        }
        /** 记录 render 并输出带 prop 的 span。 */
        render() {
          const {children, text} = this.props;
          Scheduler.log(`ClassText:${text} render`);
          return <span prop={text}>{children}</span>;
        }
      }

      /** 在 Function/Class 探针之间插入多个可挂起 children。 */
      function App({children = null}) {
        return (
          <Suspense fallback={<ClassText text="Fallback" />}>
            <Text text="Function" />
            {children}
            <ClassText text="Class" />
          </Suspense>
        );
      }

      await act(() => {
        ReactNoop.render(<App />);
      });
      assertLog([
        'Text:Function render',
        'ClassText:Class render',
        'Text:Function create insertion',
        'Text:Function create layout',
        'ClassText:Class componentDidMount',
        'Text:Function create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Function" />
          <span prop="Class" />
        </>,
      );

      // 更新加入两个异步资源，使同一树多处挂起。
      await act(async () => {
        ReactNoop.render(
          <App>
            <AsyncText text="Async_1" />
            <AsyncText text="Async_2" />
          </App>,
        );
        await waitFor([
          'Text:Function render',
          'Suspend:Async_1',
          'ClassText:Fallback render',
          'Text:Function destroy layout',
          'ClassText:Class componentWillUnmount',
          'ClassText:Fallback componentDidMount',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="Function" hidden={true} />
            <span prop="Class" hidden={true} />
            <span prop="Fallback" />
          </>,
        );
      });

      // 后台预热发现第二处挂起，但不重复销毁 effects。
      assertLog([
        'Text:Function render',
        'Suspend:Async_1',
        'Suspend:Async_2',
        'ClassText:Class render',
      ]);

      // 只完成 Async_1；Async_2 仍阻塞，不得重建 effects。
      await act(async () => {
        await resolveText('Async_1');
      });
      assertLog([
        'Text:Function render',
        'AsyncText:Async_1 render',
        'Suspend:Async_2',
        // 后台预热仍发现 Async_2。
        'Text:Function render',
        'AsyncText:Async_1 render',
        'Suspend:Async_2',
        'ClassText:Class render',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Function" hidden={true} />
          <span prop="Class" hidden={true} />
          <span prop="Fallback" />
        </>,
      );

      // 完成最后资源，主树只重建一次 layout effects。
      await act(async () => {
        await resolveText('Async_2');
      });
      assertLog([
        'Text:Function render',
        'AsyncText:Async_1 render',
        'AsyncText:Async_2 render',
        'ClassText:Class render',
        'ClassText:Fallback componentWillUnmount',
        'Text:Function create layout',
        'AsyncText:Async_1 create layout',
        'AsyncText:Async_2 create layout',
        'ClassText:Class componentDidMount',
        'AsyncText:Async_1 create passive',
        'AsyncText:Async_2 create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Function" />
          <span prop="Async_1" />
          <span prop="Async_2" />
          <span prop="Class" />
        </>,
      );

      await act(() => {
        ReactNoop.render(null);
      });
      assertLog([
        'Text:Function destroy insertion',
        'Text:Function destroy layout',
        'AsyncText:Async_1 destroy layout',
        'AsyncText:Async_2 destroy layout',
        'ClassText:Class componentWillUnmount',
        'Text:Function destroy passive',
        'AsyncText:Async_1 destroy passive',
        'AsyncText:Async_2 destroy passive',
      ]);
    });

    /**
     * 场景（Given–When–Then）：给定单个 Suspender 先读取 A、A 完成后又改读 B；当两次连续挂起；
     * 那么边界 layout effects 只首次销毁，直到 B 完成才一次重建。
     * 对应机制：同一组件多次 retry 仍复用已隐藏 Offscreen 状态。
     */
    // @gate enableLegacyCache
    it('should be only destroy layout effects once if a component suspends multiple times', async () => {
      /** 记录类节点的 mount/update/unmount。 */
      class ClassText extends React.Component {
        /** 记录类节点挂载或揭示。 */
        componentDidMount() {
          const {text} = this.props;
          Scheduler.log(`ClassText:${text} componentDidMount`);
        }
        /** 记录类节点可见更新。 */
        componentDidUpdate() {
          const {text} = this.props;
          Scheduler.log(`ClassText:${text} componentDidUpdate`);
        }
        /** 记录隐藏断开或删除。 */
        componentWillUnmount() {
          const {text} = this.props;
          Scheduler.log(`ClassText:${text} componentWillUnmount`);
        }
        /** 记录 render 并输出带 prop 的 span。 */
        render() {
          const {children, text} = this.props;
          Scheduler.log(`ClassText:${text} render`);
          return <span prop={text}>{children}</span>;
        }
      }

      let textToRead = null;

      /** 读取测试当前指定的资源；null 时不挂起。 */
      function Suspender() {
        Scheduler.log(`Suspender "${textToRead}" render`);
        if (textToRead !== null) {
          readText(textToRead);
        }
        return <span prop="Suspender" />;
      }

      /** 把 Suspender 放在 Function/Class layout 探针之间。 */
      function App({children = null}) {
        return (
          <Suspense fallback={<ClassText text="Fallback" />}>
            <Text text="Function" />
            <Suspender />
            <ClassText text="Class" />
          </Suspense>
        );
      }

      await act(() => {
        ReactNoop.render(<App />);
      });
      assertLog([
        'Text:Function render',
        'Suspender "null" render',
        'ClassText:Class render',
        'Text:Function create insertion',
        'Text:Function create layout',
        'ClassText:Class componentDidMount',
        'Text:Function create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Function" />
          <span prop="Suspender" />
          <span prop="Class" />
        </>,
      );

      // 改读 A，使组件首次挂起并隐藏主树。
      textToRead = 'A';
      await act(async () => {
        ReactNoop.render(<App />);
        await waitFor([
          'Text:Function render',
          'Suspender "A" render',
          'Suspend:A',
          'ClassText:Fallback render',
          'Text:Function destroy layout',
          'ClassText:Class componentWillUnmount',
          'ClassText:Fallback componentDidMount',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="Function" hidden={true} />
            <span prop="Suspender" hidden={true} />
            <span prop="Class" hidden={true} />
            <span prop="Fallback" />
          </>,
        );
      });

      // 后台预热 A，不重复销毁 effects。
      assertLog([
        'Text:Function render',
        'Suspender "A" render',
        'Suspend:A',
        'ClassText:Class render',
      ]);

      // A 完成前切换目标为 B；retry 再次挂起但仍不重建 effects。
      textToRead = 'B';
      await act(async () => {
        await resolveText('A');
      });
      assertLog([
        'Text:Function render',
        'Suspender "B" render',
        'Suspend:B',
        // 后台预热 B。
        'Text:Function render',
        'Suspender "B" render',
        'Suspend:B',
        'ClassText:Class render',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Function" hidden={true} />
          <span prop="Suspender" hidden={true} />
          <span prop="Class" hidden={true} />
          <span prop="Fallback" />
        </>,
      );

      // B 完成后一次性重建主树 layout effects。
      await act(async () => {
        await resolveText('B');
      });
      assertLog([
        'Text:Function render',
        'Suspender "B" render',
        'ClassText:Class render',
        'ClassText:Fallback componentWillUnmount',
        'Text:Function create layout',
        'ClassText:Class componentDidMount',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Function" />
          <span prop="Suspender" />
          <span prop="Class" />
        </>,
      );

      await act(() => {
        ReactNoop.render(null);
      });
      assertLog([
        'Text:Function destroy insertion',
        'Text:Function destroy layout',
        'ClassText:Class componentWillUnmount',
        'Text:Function destroy passive',
      ]);
    });
  });

  /** 对比对象 ref、callback ref、类/宿主/imperative ref 在隐藏、揭示与错误路径中的清空语义。 */
  describe('refs within a tree that re-suspends in an update', () => {
    /**
     * 为目标 Component 同时安装对象 ref 与 callback ref，并在 layout 阶段记录它们是否已附着。
     * `manualRef` 镜像 callback ref 当前值，使内外组件能用统一方式观察 detach/attach 顺序。
     */
    function RefCheckerOuter({Component}) {
      const refObject = React.useRef(null);

      const manualRef = React.useMemo(() => ({current: null}), []);
      const refCallback = React.useCallback(value => {
        Scheduler.log(`RefCheckerOuter refCallback value? ${value != null}`);
        manualRef.current = value;
      }, []);

      Scheduler.log(`RefCheckerOuter render`);

      React.useLayoutEffect(() => {
        Scheduler.log(
          `RefCheckerOuter create layout refObject? ${
            refObject.current != null
          } refCallback? ${manualRef.current != null}`,
        );
        return () => {
          Scheduler.log(
            `RefCheckerOuter destroy layout refObject? ${
              refObject.current != null
            } refCallback? ${manualRef.current != null}`,
          );
        };
      }, []);

      return (
        <>
          <Component ref={refObject} prop="refObject">
            <RefCheckerInner forwardedRef={refObject} text="refObject" />
          </Component>
          <Component ref={refCallback} prop="refCallback">
            <RefCheckerInner forwardedRef={manualRef} text="refCallback" />
          </Component>
        </>
      );
    }

    /** 在后代 layout create/destroy 阶段检查外层 ref 当前是否已经 attach/detach。 */
    function RefCheckerInner({forwardedRef, text}) {
      Scheduler.log(`RefCheckerInner:${text} render`);
      React.useLayoutEffect(() => {
        Scheduler.log(
          `RefCheckerInner:${text} create layout ref? ${
            forwardedRef.current != null
          }`,
        );
        return () => {
          Scheduler.log(
            `RefCheckerInner:${text} destroy layout ref? ${
              forwardedRef.current != null
            }`,
          );
        };
      }, []);
      return null;
  }

    /**
     * 场景（Given–When–Then）：给定 legacy 根中类实例的对象/callback refs 已附着；当边界重挂起
     * 并揭示；那么 refs 与 layout effects 都不断开，只在真实根卸载时清空。
     * 对应机制：旧模式 fallback 不执行 Offscreen ref detach。
     */
    // @gate enableLegacyCache && !disableLegacyMode
    it('should not be cleared within legacy roots', async () => {
      /** 将 ref 附着到类实例，并透传 RefCheckerInner children。 */
      class ClassComponent extends React.Component {
        /** 记录类实例 render 并返回 children。 */
        render() {
          Scheduler.log(`ClassComponent:${this.props.prop} render`);
          return this.props.children;
        }
      }

      /** 把可挂起 children 与类 ref 探针放入同一边界。 */
      function App({children}) {
        Scheduler.log(`App render`);
        return (
          <Suspense fallback={<Text text="Fallback" />}>
            {children}
            <RefCheckerOuter Component={ClassComponent} />
          </Suspense>
        );
      }

      await act(() => {
        ReactNoop.renderLegacySyncRoot(<App />);
      });
      assertLog([
        'App render',
        'RefCheckerOuter render',
        'ClassComponent:refObject render',
        'RefCheckerInner:refObject render',
        'ClassComponent:refCallback render',
        'RefCheckerInner:refCallback render',
        'RefCheckerInner:refObject create layout ref? false',
        'RefCheckerInner:refCallback create layout ref? false',
        'RefCheckerOuter refCallback value? true',
        'RefCheckerOuter create layout refObject? true refCallback? true',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(null);

      // legacy 根中挂起边界，不应清空类 refs 或断开其 layout effects。
      await act(() => {
        ReactNoop.renderLegacySyncRoot(
          <App children={<AsyncText text="Async" />} />,
        );
      });
      await advanceTimers(1000);
      assertLog([
        'App render',
        'Suspend:Async',
        'RefCheckerOuter render',
        'ClassComponent:refObject render',
        'RefCheckerInner:refObject render',
        'ClassComponent:refCallback render',
        'RefCheckerInner:refCallback render',
        'Text:Fallback render',
        'Text:Fallback create insertion',
        'Text:Fallback create layout',
        'Text:Fallback create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Fallback" />);

      // 完成资源只处理 Async/fallback，既有 ref/effect 不重建。
      await act(async () => {
        await resolveText('Async');
      });
      assertLog([
        'AsyncText:Async render',
        'Text:Fallback destroy insertion',
        'Text:Fallback destroy layout',
        'AsyncText:Async create layout',
        'Text:Fallback destroy passive',
        'AsyncText:Async create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Async" />);

      await act(() => {
        ReactNoop.renderLegacySyncRoot(null);
      });
      assertLog([
        'AsyncText:Async destroy layout',
        'RefCheckerOuter destroy layout refObject? true refCallback? true',
        'RefCheckerInner:refObject destroy layout ref? false',
        'RefCheckerOuter refCallback value? false',
        'RefCheckerInner:refCallback destroy layout ref? false',
        'AsyncText:Async destroy passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(null);
    });

    /**
     * 场景（Given–When–Then）：给定宿主 span 的对象/callback refs；当并发边界隐藏再揭示；那么
     * 隐藏阶段先让外 layout cleanup 看到 refs 已附着，再 detach，揭示阶段先 attach 后外 layout create。
     * 对应机制：HostComponent ref mutation 与 Offscreen layout 阶段的固定顺序。
     */
    // @gate enableLegacyCache
    it('should be cleared and reset for host components', async () => {
      /** 把宿主 span ref 探针与可挂起 children 放入同一边界。 */
      function App({children}) {
        Scheduler.log(`App render`);
        return (
          <Suspense fallback={<Text text="Fallback" />}>
            {children}
            <RefCheckerOuter Component="span" />
          </Suspense>
        );
      }

      // 初次挂载两种宿主 ref。
      await act(() => {
        ReactNoop.render(<App />);
      });
      assertLog([
        'App render',
        'RefCheckerOuter render',
        'RefCheckerInner:refObject render',
        'RefCheckerInner:refCallback render',
        'RefCheckerInner:refObject create layout ref? false',
        'RefCheckerInner:refCallback create layout ref? false',
        'RefCheckerOuter refCallback value? true',
        'RefCheckerOuter create layout refObject? true refCallback? true',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="refObject" />
          <span prop="refCallback" />
        </>,
      );

      // 挂起边界，断开 layout effects 并清空宿主 refs。
      await act(() => {
        ReactNoop.render(<App children={<AsyncText text="Async" />} />);
      });
      await advanceTimers(1000);
      assertLog([
        'App render',
        'Suspend:Async',
        'Text:Fallback render',
        'RefCheckerOuter destroy layout refObject? true refCallback? true',
        'RefCheckerInner:refObject destroy layout ref? false',
        'RefCheckerOuter refCallback value? false',
        'RefCheckerInner:refCallback destroy layout ref? false',
        'Text:Fallback create insertion',
        'Text:Fallback create layout',
        'Text:Fallback create passive',
        // 后台预热主树，不重新附着 refs。
        'Suspend:Async',
        'RefCheckerOuter render',
        'RefCheckerInner:refObject render',
        'RefCheckerInner:refCallback render',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="refObject" hidden={true} />
          <span prop="refCallback" hidden={true} />
          <span prop="Fallback" />
        </>,
      );

      // 完成资源，重新附着 refs 后恢复 layout effects。
      await act(async () => {
        await resolveText('Async');
      });
      assertLog([
        'AsyncText:Async render',
        'RefCheckerOuter render',
        'RefCheckerInner:refObject render',
        'RefCheckerInner:refCallback render',
        'Text:Fallback destroy insertion',
        'Text:Fallback destroy layout',
        'AsyncText:Async create layout',
        'RefCheckerInner:refObject create layout ref? false',
        'RefCheckerInner:refCallback create layout ref? false',
        'RefCheckerOuter refCallback value? true',
        'RefCheckerOuter create layout refObject? true refCallback? true',
        'Text:Fallback destroy passive',
        'AsyncText:Async create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Async" />
          <span prop="refObject" />
          <span prop="refCallback" />
        </>,
      );

      await act(() => {
        ReactNoop.render(null);
      });
      assertLog([
        'AsyncText:Async destroy layout',
        'RefCheckerOuter destroy layout refObject? true refCallback? true',
        'RefCheckerInner:refObject destroy layout ref? false',
        'RefCheckerOuter refCallback value? false',
        'RefCheckerInner:refCallback destroy layout ref? false',
        'AsyncText:Async destroy passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(null);
    });

    /**
     * 场景（Given–When–Then）：给定并发根类实例 refs；当边界隐藏再揭示；那么类 refs 同宿主 refs
     * 一样 detach/attach，layout 探针观察到相同顺序。对应机制：ClassComponent Ref flag 参与可见性提交。
     */
    // @gate enableLegacyCache
    it('should be cleared and reset for class components', async () => {
      /** 将 ref 附着到类实例并透传 children。 */
      class ClassComponent extends React.Component {
        /** 记录类实例 render 并返回 children。 */
        render() {
          Scheduler.log(`ClassComponent:${this.props.prop} render`);
          return this.props.children;
        }
      }

      /** 把类 ref 探针与可挂起 children 放入同一边界。 */
      function App({children}) {
        Scheduler.log(`App render`);
        return (
          <Suspense fallback={<Text text="Fallback" />}>
            {children}
            <RefCheckerOuter Component={ClassComponent} />
          </Suspense>
        );
      }

      // 初次挂载类 refs。
      await act(() => {
        ReactNoop.render(<App />);
      });
      assertLog([
        'App render',
        'RefCheckerOuter render',
        'ClassComponent:refObject render',
        'RefCheckerInner:refObject render',
        'ClassComponent:refCallback render',
        'RefCheckerInner:refCallback render',
        'RefCheckerInner:refObject create layout ref? false',
        'RefCheckerInner:refCallback create layout ref? false',
        'RefCheckerOuter refCallback value? true',
        'RefCheckerOuter create layout refObject? true refCallback? true',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(null);

      // 挂起边界，清空类 refs 并断开 layout effects。
      await act(() => {
        ReactNoop.render(<App children={<AsyncText text="Async" />} />);
      });
      await advanceTimers(1000);
      assertLog([
        'App render',
        'Suspend:Async',
        'Text:Fallback render',
        'RefCheckerOuter destroy layout refObject? true refCallback? true',
        'RefCheckerInner:refObject destroy layout ref? false',
        'RefCheckerOuter refCallback value? false',
        'RefCheckerInner:refCallback destroy layout ref? false',
        'Text:Fallback create insertion',
        'Text:Fallback create layout',
        'Text:Fallback create passive',
        // 后台预热主树，不重新附着 refs。
        'Suspend:Async',
        'RefCheckerOuter render',
        'ClassComponent:refObject render',
        'RefCheckerInner:refObject render',
        'ClassComponent:refCallback render',
        'RefCheckerInner:refCallback render',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Fallback" />);

      // 完成资源，重新附着类 refs 并恢复 layout effects。
      await act(async () => {
        await resolveText('Async');
      });
      assertLog([
        'AsyncText:Async render',
        'RefCheckerOuter render',
        'ClassComponent:refObject render',
        'RefCheckerInner:refObject render',
        'ClassComponent:refCallback render',
        'RefCheckerInner:refCallback render',
        'Text:Fallback destroy insertion',
        'Text:Fallback destroy layout',
        'AsyncText:Async create layout',
        'RefCheckerInner:refObject create layout ref? false',
        'RefCheckerInner:refCallback create layout ref? false',
        'RefCheckerOuter refCallback value? true',
        'RefCheckerOuter create layout refObject? true refCallback? true',
        'Text:Fallback destroy passive',
        'AsyncText:Async create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Async" />);

      await act(() => {
        ReactNoop.render(null);
      });
      assertLog([
        'AsyncText:Async destroy layout',
        'RefCheckerOuter destroy layout refObject? true refCallback? true',
        'RefCheckerInner:refObject destroy layout ref? false',
        'RefCheckerOuter refCallback value? false',
        'RefCheckerInner:refCallback destroy layout ref? false',
        'AsyncText:Async destroy passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(null);
    });

    /**
     * 场景（Given–When–Then）：给定 forwardRef 通过 useImperativeHandle 暴露对象；当边界隐藏再揭示；
     * 那么 imperative ref 按与宿主/类 ref 相同顺序清空和重建。
     * 对应机制：useImperativeHandle 本质是带 Ref 语义的 layout effect。
     */
    // @gate enableLegacyCache
    it('should be cleared and reset for function components with useImperativeHandle', async () => {
      /** 通过 imperative handle 为对象/callback ref 创建稳定的命令对象。 */
      const FunctionComponent = React.forwardRef((props, ref) => {
        Scheduler.log('FunctionComponent render');
        React.useImperativeHandle(
          ref,
          () => ({
            // 空实现占位。
          }),
          [],
        );
        return props.children;
      });
      FunctionComponent.displayName = 'FunctionComponent';

      /** 把 imperative ref 探针与可挂起 children 放入同一边界。 */
      function App({children}) {
        Scheduler.log(`App render`);
        return (
          <Suspense fallback={<Text text="Fallback" />}>
            {children}
            <RefCheckerOuter Component={FunctionComponent} />
          </Suspense>
        );
      }

      // 初次挂载 imperative refs。
      await act(() => {
        ReactNoop.render(<App />);
      });
      assertLog([
        'App render',
        'RefCheckerOuter render',
        'FunctionComponent render',
        'RefCheckerInner:refObject render',
        'FunctionComponent render',
        'RefCheckerInner:refCallback render',
        'RefCheckerInner:refObject create layout ref? false',
        'RefCheckerInner:refCallback create layout ref? false',
        'RefCheckerOuter refCallback value? true',
        'RefCheckerOuter create layout refObject? true refCallback? true',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(null);

      // 挂起边界，清空 imperative refs 并断开 layout effects。
      await act(() => {
        ReactNoop.render(<App children={<AsyncText text="Async" />} />);
      });
      await advanceTimers(1000);
      assertLog([
        'App render',
        'Suspend:Async',
        'Text:Fallback render',
        'RefCheckerOuter destroy layout refObject? true refCallback? true',
        'RefCheckerInner:refObject destroy layout ref? false',
        'RefCheckerOuter refCallback value? false',
        'RefCheckerInner:refCallback destroy layout ref? false',
        'Text:Fallback create insertion',
        'Text:Fallback create layout',
        'Text:Fallback create passive',
        // 后台预热主树，不重新建立 imperative handles。
        'Suspend:Async',
        'RefCheckerOuter render',
        'FunctionComponent render',
        'RefCheckerInner:refObject render',
        'FunctionComponent render',
        'RefCheckerInner:refCallback render',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Fallback" />);

      // 完成资源，重新建立 imperative refs 并恢复 layout effects。
      await act(async () => {
        await resolveText('Async');
      });
      assertLog([
        'AsyncText:Async render',
        'RefCheckerOuter render',
        'FunctionComponent render',
        'RefCheckerInner:refObject render',
        'FunctionComponent render',
        'RefCheckerInner:refCallback render',
        'Text:Fallback destroy insertion',
        'Text:Fallback destroy layout',
        'AsyncText:Async create layout',
        'RefCheckerInner:refObject create layout ref? false',
        'RefCheckerInner:refCallback create layout ref? false',
        'RefCheckerOuter refCallback value? true',
        'RefCheckerOuter create layout refObject? true refCallback? true',
        'Text:Fallback destroy passive',
        'AsyncText:Async create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Async" />);

      await act(() => {
        ReactNoop.render(null);
      });
      assertLog([
        'AsyncText:Async destroy layout',
        'RefCheckerOuter destroy layout refObject? true refCallback? true',
        'RefCheckerInner:refObject destroy layout ref? false',
        'RefCheckerOuter refCallback value? false',
        'RefCheckerInner:refCallback destroy layout ref? false',
        'AsyncText:Async destroy passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(null);
    });

    /**
     * 场景（Given–When–Then）：给定 useRef 初值是用户数据字符串 `test`、从未传给 JSX ref；当边界
     * 隐藏再揭示；那么 React 不得把它清空，所有 layout create/destroy 都观察到原值。
     * 对应机制：仅标记为 ref target 的 ref 由 React detach，普通可变容器归用户管理。
     */
    // @gate enableLegacyCache
    it('should not reset for user-managed values', async () => {
      /** 在 layout create/destroy 中检查用户管理 ref 始终等于 `test`。 */
      function RefChecker({forwardedRef}) {
        Scheduler.log(`RefChecker render`);
        React.useLayoutEffect(() => {
          Scheduler.log(
            `RefChecker create layout ref? ${forwardedRef.current === 'test'}`,
          );
          return () => {
            Scheduler.log(
              `RefChecker destroy layout ref? ${
                forwardedRef.current === 'test'
              }`,
            );
          };
        }, []);
        return null;
      }

      /** 创建用户 ref 并把它传给探针，而非作为 JSX ref 属性。 */
      function App({children = null}) {
        const ref = React.useRef('test');
        Scheduler.log(`App render`);
        React.useLayoutEffect(() => {
          Scheduler.log(`App create layout ref? ${ref.current === 'test'}`);
          return () => {
            Scheduler.log(`App destroy layout ref? ${ref.current === 'test'}`);
          };
        }, []);
        return (
          <Suspense fallback={<Text text="Fallback" />}>
            {children}
            <RefChecker forwardedRef={ref} />
          </Suspense>
        );
      }

      // 初次挂载用户管理 ref。
      await act(() => {
        ReactNoop.render(<App />);
      });
      assertLog([
        'App render',
        'RefChecker render',
        'RefChecker create layout ref? true',
        'App create layout ref? true',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(null);

      // 挂起边界只断开 effects，不应改写用户 ref。
      await act(() => {
        ReactNoop.render(<App children={<AsyncText text="Async" />} />);
      });
      await advanceTimers(1000);
      assertLog([
        'App render',
        'Suspend:Async',
        'Text:Fallback render',
        'RefChecker destroy layout ref? true',
        'Text:Fallback create insertion',
        'Text:Fallback create layout',
        'Text:Fallback create passive',
        // 后台预热主树。
        'Suspend:Async',
        'RefChecker render',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Fallback" />);

      // 完成资源并恢复 effects，用户 ref 仍保持原值。
      await act(async () => {
        await resolveText('Async');
      });
      assertLog([
        'AsyncText:Async render',
        'RefChecker render',
        'Text:Fallback destroy insertion',
        'Text:Fallback destroy layout',
        'AsyncText:Async create layout',
        'RefChecker create layout ref? true',
        'Text:Fallback destroy passive',
        'AsyncText:Async create passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Async" />);

      await act(() => {
        ReactNoop.render(null);
      });
      assertLog([
        'App destroy layout ref? true',
        'AsyncText:Async destroy layout',
        'RefChecker destroy layout ref? true',
        'AsyncText:Async destroy passive',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(null);
    });

    /** 覆盖 ref attach/detach 回调抛错时，其余 layout 与错误边界提交仍能完成。 */
    describe('that throw errors', () => {
      /**
       * 场景（Given–When–Then）：给定 ref callback 在 reveal attach 阶段抛错；当资源完成；那么后续
       * layout create 仍执行，再 detach/清理整棵错误树并由 ErrorBoundary 显示 Error。
       * 对应机制：commitAttachRef 错误捕获不截断 layout traversal。
       */
      // @gate enableLegacyCache
      it('are properly handled in ref callbacks', async () => {
        let useRefCallbackShouldThrow = false;

        /** 安装一个可切换为 attach/detach 时抛错的宿主 ref callback。 */
        function ThrowsInRefCallback({unused}) {
          Scheduler.log('ThrowsInRefCallback render');
          const refCallback = React.useCallback(value => {
            Scheduler.log('ThrowsInRefCallback refCallback ref? ' + !!value);
            if (useRefCallbackShouldThrow) {
              throw Error('expected');
            }
          }, []);
          return <span ref={refCallback} prop="ThrowsInRefCallback" />;
        }

        /** 把可抛错 ref 与后续 Text 放入同一可重挂起边界。 */
        function App({children = null}) {
          Scheduler.log('App render');
          React.useLayoutEffect(() => {
            Scheduler.log('App create layout');
            return () => {
              Scheduler.log('App destroy layout');
            };
          }, []);
          return (
            <>
              <Suspense fallback={<Text text="Fallback" />}>
                {children}
                <ThrowsInRefCallback />
                <Text text="Inside" />
              </Suspense>
              <Text text="Outside" />
            </>
          );
        }

        await act(() => {
          ReactNoop.render(
            <ErrorBoundary fallback={<Text text="Error" />}>
              <App />
            </ErrorBoundary>,
          );
        });
        assertLog([
          'ErrorBoundary render: try',
          'App render',
          'ThrowsInRefCallback render',
          'Text:Inside render',
          'Text:Outside render',
          'Text:Inside create insertion',
          'Text:Outside create insertion',
          'ThrowsInRefCallback refCallback ref? true',
          'Text:Inside create layout',
          'Text:Outside create layout',
          'App create layout',
          'Text:Inside create passive',
          'Text:Outside create passive',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="ThrowsInRefCallback" />
            <span prop="Inside" />
            <span prop="Outside" />
          </>,
        );

        // 更新加入 Async，使 ref 先 detach。
        await act(() => {
          ReactNoop.render(
            <ErrorBoundary fallback={<Text text="Error" />}>
              <App>
                <AsyncText text="Async" />
              </App>
            </ErrorBoundary>,
          );
        });
        assertLog([
          'ErrorBoundary render: try',
          'App render',
          'Suspend:Async',
          'Text:Fallback render',
          'Text:Outside render',
          'ThrowsInRefCallback refCallback ref? false',
          'Text:Inside destroy layout',
          'Text:Fallback create insertion',
          'Text:Fallback create layout',
          'Text:Fallback create passive',
          // 后台预热主树。
          'Suspend:Async',
          'ThrowsInRefCallback render',
          'Text:Inside render',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="ThrowsInRefCallback" hidden={true} />
            <span prop="Inside" hidden={true} />
            <span prop="Fallback" />
            <span prop="Outside" />
          </>,
        );

        // 完成资源，并让 reveal 的 ref attach 抛错。
        useRefCallbackShouldThrow = true;
        await act(async () => {
          await resolveText('Async');
        });
        assertLog([
          'AsyncText:Async render',
          'ThrowsInRefCallback render',
          'Text:Inside render',

          // refCallback 抛错后，后续 layout effects 仍应创建。
          'Text:Fallback destroy insertion',
          'Text:Fallback destroy layout',
          'AsyncText:Async create layout',
          'ThrowsInRefCallback refCallback ref? true',
          'Text:Inside create layout',

          // 完成当前进行中的 commit。
          'Text:Fallback destroy passive',
          'AsyncText:Async create passive',

          // detach ref，并销毁错误树的 insertion、layout 与 passive effects。
          'App destroy layout',
          'AsyncText:Async destroy layout',
          'ThrowsInRefCallback refCallback ref? false',
          'Text:Inside destroy insertion',
          'Text:Inside destroy layout',
          'Text:Outside destroy insertion',
          'Text:Outside destroy layout',
          'AsyncText:Async destroy passive',
          'Text:Inside destroy passive',
          'Text:Outside destroy passive',

          // 渲染错误边界 fallback。
          'ErrorBoundary render: catch',
          'Text:Error render',
          'Text:Error create insertion',
          'Text:Error create layout',
          'Text:Error create passive',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Error" />);
      });
    });
  });
});
