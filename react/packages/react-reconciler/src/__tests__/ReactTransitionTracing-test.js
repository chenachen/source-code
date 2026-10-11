/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

let React;
let ReactNoop;
let Scheduler;
let act;
let waitForAll;
let assertLog;
let assertConsoleErrorDev;

let getCacheForType;
let useState;
let Suspense;
let Activity;
let startTransition;

let caches;
let seededCache;

/**
 * 具名 transition 的追踪：root 聚合其 Suspense 阻塞集合，Marker 记录局部集合。
 * processTransitionCallbacks 按 start、Marker progress/complete/incomplete、
 * transition progress/complete 的类别顺序分发；某类没有待处理记录时便跳过。
 * progress 中的 pending 是此轮回调读取的边界记录数组，endTime 是本轮处理时间，
 * 并不表示转换已经结束。删除相关边界会使追踪记录 incomplete，其他分支仍可更新。
 * 下面把回调参数转换成日志，与各阶段的资源解析和渲染日志一起断言。
 */
describe('ReactInteractionTracing', () => {
  /** stringifyDeletions 对每条删除记录的键排序后串联，确保 Marker 不完整事件的对象日志稳定可断言。 */
  function stringifyDeletions(deletions) {
    return deletions
      .map(
        d =>
          `{${Object.keys(d)
            .map(key => `${key}: ${d[key]}`)
            .sort()
            .join(', ')}}`,
      )
      .join(', ');
  }
  /** 重置模块，重新加载 React、Noop、Scheduler 及断言工具，并清空本套件的资源缓存。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');

    const InternalTestUtils = require('internal-test-utils');
    act = InternalTestUtils.act;
    waitForAll = InternalTestUtils.waitForAll;
    assertLog = InternalTestUtils.assertLog;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;

    useState = React.useState;
    startTransition = React.startTransition;
    Suspense = React.Suspense;
    Activity = React.Activity;

    getCacheForType = React.unstable_getCacheForType;

    caches = [];
    seededCache = null;
  });

  /** 创建按文本索引的资源缓存；seededCache 仅消费一次。记录从 pending 转为 resolved 或 rejected 后不再被 resolve/reject 覆盖。 */
  function createTextCache() {
    if (seededCache !== null) {
      const cache = seededCache;
      seededCache = null;
      return cache;
    }

    const data = new Map();
    const cache = {
      data,
      /** createTextCache.resolve 将缺失记录直接预置为 resolved，或把 pending 原地转为 resolved 并唤醒全部 ping；终态记录保持不变。 */
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
      /** createTextCache.reject 将缺失记录预置为 rejected，或把 pending 原地转为 rejected 并唤醒重试；不覆盖既有终态。 */
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

  /** readText 从当前 React cache 读取文本：resolved 返回值，rejected 抛错误，pending 或首次读取抛 thenable 交给 Suspense。 */
  function readText(text) {
    const textCache = getCacheForType(createTextCache);
    const record = textCache.data.get(text);
    if (record !== undefined) {
      switch (record.status) {
        case 'pending':
          Scheduler.log(`Suspend [${text}]`);
          throw record.value;
        case 'rejected':
          Scheduler.log(`Error [${text}]`);
          throw record.value;
        case 'resolved':
          return record.value;
      }
    } else {
      Scheduler.log(`Suspend [${text}]`);

      const thenable = {
        pings: [],
        /** pending 时收集重试订阅；结算后订阅则用微任务通知。这里只实现 ping 所需的 then(resolve)，拒绝状态由下一次 readText 抛出错误。 */
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

  /** AsyncText 通过 readText 驱动 Suspense，并只在资源 resolved 后记录及返回完整文本。 */
  function AsyncText({text}) {
    const fullText = readText(text);
    Scheduler.log(fullText);
    return fullText;
  }

  /** Text 作为同步对照组件，直接记录并返回文本，不参与资源挂起状态机。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** 解析最近由 createTextCache 创建并登记的资源缓存；无缓存时抛错，较早缓存可按 caches 索引解析。 */
  function resolveMostRecentTextCache(text) {
    if (caches.length === 0) {
      throw Error('Cache does not exist');
    } else {
      // 解析最近创建的缓存；更早创建的缓存可以通过
      // `caches[index].resolve(text)` 定向解析。
      caches[caches.length - 1].resolve(text);
    }
  }

  const resolveText = resolveMostRecentTextCache;

  /** 推进 Jest 虚拟时钟，再经 Promise 微任务让出一次；Scheduler 的模拟时间由 ReactNoop.expire 单独推进。 */
  function advanceTimers(ms) {
    // 注意：这里只推进 Jest 的虚拟时间，不推进 React 的时间；
    // React 的过期时间需使用 ReactNoop.expire 推进。
    if (typeof ms !== 'number') {
      throw new Error('Must specify ms');
    }
    jest.advanceTimersByTime(ms);
    // 经 Promise 微任务让出一次，让此前排入的微任务获得执行机会。
    // 这里使用了伪计时器，因此不能再靠 timer 等待。
    return Promise.resolve().then(() => {});
  }

  /**
   * 场景：未命名转换不会触发追踪回调。
   * Given：根已安装 transition 与 Marker callbacks，App 可同步切换页面。
   * When：先执行未提供 name 的 startTransition，再执行具名转换。
   * Then：无名转换只提交 UI；具名转换产生一次 start 与 complete，且同步 Marker 不额外阻塞。
   * 验证机制：waitForAll 同时断言页面日志和 callback 序列，明确第一次更新没有任何追踪事件。
   * 对应源码：packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js 的 processTransitionCallbacks()；packages/react-reconciler/src/ReactFiberWorkLoop.js。
   */
  // @gate enableTransitionTracing
  it('should not call callbacks when transition is not defined', async () => {
    const transitionCallbacks = {

      /**
       * 区分无名称更新与 name transition 的回调归属。
       * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
       */
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },

      /**
       * 区分无名称更新与 name transition 的回调归属。
       * 把 pending 边界名称按传入顺序写入日志，无名称时显示 <null>。startTime 是转换起点，名为 endTime 的实参此时是进度快照时间，并非转换已经完成。
       */
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 区分无名称更新与 name transition 的回调归属。
       * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
       */
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },

      /**
       * 区分无名称更新与 name transition 的回调归属。
       * 记录转换与 Marker 的名称、起始时间和本次进度时间（Scheduler 毫秒），并序列化该 Marker 仍等待的边界；不自行增删 pending。
       */
      onMarkerProgress: (
        transitioName,
        markerName,
        startTime,
        currentTime,
        pending,
      ) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onMarkerProgress(${transitioName}, ${markerName}, ${startTime}, ${currentTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 区分无名称更新与 name transition 的回调归属。
       * 记录转换名称、Marker 名称及起止 Scheduler 毫秒时间；这只证明该 Marker 的完成事件，根转换是否完成由另一个回调验证。
       */
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.log(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };

    /** App 依据 navigate 在普通页面与同步 Marker 页面间切换，用同一根区分无名称转换和具名转换的追踪入口。 */
    function App({navigate}) {
      return (
        <div>
          {navigate ? (
            <React.unstable_TracingMarker name="marker">
              <Text text="Page Two" />
            </React.unstable_TracingMarker>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App navigate={false} />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll(['Page One']);

      await act(async () => {
        startTransition(() => root.render(<App navigate={true} />));

        ReactNoop.expire(1000);
        await advanceTimers(1000);

        // 未命名转换不会调用 transition 或 marker 回调。
        await waitForAll(['Page Two']);

        startTransition(() => root.render(<App navigate={false} />), {
          name: 'transition',
        });
        await waitForAll([
          'Page One',
          'onTransitionStart(transition, 2000)',
          'onTransitionComplete(transition, 2000, 2000)',
        ]);
      });
    });
  });

  /**
   * 场景：同步基础转换形成完整生命周期。
   * Given：App 已提交初始页面，根注册 start、progress、complete callbacks。
   * When：用具名 startTransition 同步更新 navigate 状态并推进虚拟时间。
   * Then：转换只产生一次 start 与一次 complete，不产生带 pending 的 progress。
   * 验证机制：waitForAll 对 name、startTime、endTime 和事件顺序做精确字符串断言。
   * 对应源码：packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js 的 processTransitionCallbacks()。
   */
  // @gate enableTransitionTracing
  it('should correctly trace basic interaction', async () => {
    const transitionCallbacks = {

      /**
       * 核对同步页面切换只产生一次起止事件。
       * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
       */
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },

      /**
       * 核对同步页面切换只产生一次起止事件。
       * 把 pending 边界名称按传入顺序写入日志，无名称时显示 <null>。startTime 是转换起点，名为 endTime 的实参此时是进度快照时间，并非转换已经完成。
       */
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 核对同步页面切换只产生一次起止事件。
       * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
       */
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    let navigateToPageTwo;
    /** App 持有 navigate 状态并暴露更新入口，以一次同步页面切换形成最小具名转换生命周期。 */
    function App() {
      const [navigate, setNavigate] = useState(false);
      /**
       * 将 App 的 navigate 从 false 设为 true，供 basic interaction 的转换作用域调入；不在此处直接 render root。
       */
      navigateToPageTwo = () => {
        setNavigate(true);
      };

      return (
        <div>
          {navigate ? <Text text="Page Two" /> : <Text text="Page One" />}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll(['Page One']);

      await act(async () => {
        startTransition(() => navigateToPageTwo(), {name: 'page transition'});

        ReactNoop.expire(1000);
        await advanceTimers(1000);

        await waitForAll([
          'Page Two',
          'onTransitionStart(page transition, 1000)',
          'onTransitionComplete(page transition, 1000, 2000)',
        ]);
      });
    });
  });

  /**
   * 场景：同一转换内多次更新只登记一次生命周期。
   * Given：App 暴露页面和文本两个独立状态更新，二者尚未触发。
   * When：在同一个 startTransition 回调内连续执行两个更新。
   * Then：两个更新合并进同一 transition，start/complete 各调用一次。
   * 验证机制：最终 UI 同时包含两项更新，日志只允许一对相同 name 的生命周期事件。
   * 对应源码：packages/react-reconciler/src/ReactFiberWorkLoop.js 的 addTransitionToLanesMap() 调用；ReactFiberTracingMarkerComponent.js。
   */
  // @gate enableTransitionTracing
  it('multiple updates in transition callback should only result in one transitionStart/transitionComplete call', async () => {
    const transitionCallbacks = {

      /**
       * 核对同一转换中的两个 setter 共用一组起止事件。
       * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
       */
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },

      /**
       * 核对同一转换中的两个 setter 共用一组起止事件。
       * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
       */
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    let navigateToPageTwo;
    let setText;
    /** App 同时持有页面与文本状态，使一个 startTransition 内的两次更新共享同一追踪记录。 */
    function App() {
      const [navigate, setNavigate] = useState(false);
      const [text, _setText] = useState('hide');
      /**
       * 把 navigate 置为 true，和下方文本 setter 在同一转换中入队，验证一条转换覆盖两个状态更新。
       */
      navigateToPageTwo = () => setNavigate(true);
      /**
       * 把文本状态改为 show，和页面导航共用同一转换；组件渲染时才产生新的日志。
       */
      setText = () => _setText('show');

      return (
        <div>
          {navigate ? (
            <Text text={`Page Two: ${text}`} />
          ) : (
            <Text text={`Page One: ${text}`} />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll(['Page One: hide']);

      await act(async () => {
        startTransition(
          () => {
            navigateToPageTwo();
            setText();
          },
          {name: 'page transition'},
        );

        ReactNoop.expire(1000);
        await advanceTimers(1000);

        await waitForAll([
          'Page Two: show',
          'onTransitionStart(page transition, 1000)',
          'onTransitionComplete(page transition, 1000, 2000)',
        ]);
      });
    });
  });

  /**
   * 场景：异步根按 Suspense 阻塞集合报告进度。
   * Given：导航目标 AsyncText 未解析，并位于具名 Suspense 内。
   * When：启动具名导航、观察挂起，再解析最近缓存中的 Page Two。
   * Then：先 start 并以 suspense page 为 pending 报 progress；解析后 pending 清空并 complete。
   * 验证机制：waitForAll 分阶段核对预热挂起、pending 名称、时间推进和最终完成顺序。
   * 对应源码：packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js 的 processTransitionCallbacks()；packages/react-reconciler/src/ReactFiberWorkLoop.js。
   */
  // @gate enableTransitionTracing
  it('should correctly trace interactions for async roots', async () => {
    const transitionCallbacks = {

      /**
       * 跟踪 Page Two 挂起到解除挂起的 pending 集合。
       * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
       */
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },

      /**
       * 跟踪 Page Two 挂起到解除挂起的 pending 集合。
       * 把 pending 边界名称按传入顺序写入日志，无名称时显示 <null>。startTime 是转换起点，名为 endTime 的实参此时是进度快照时间，并非转换已经完成。
       */
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 跟踪 Page Two 挂起到解除挂起的 pending 集合。
       * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
       */
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };
    let navigateToPageTwo;
    /** App 将导航后的异步文本包进具名 Suspense，使挂起集合从非空推进到清空。 */
    function App() {
      const [navigate, setNavigate] = useState(false);
      /**
       * 将页面切换到会读取未解析 Page Two 的分支，使该转换产生 Suspense 进度事件。
       */
      navigateToPageTwo = () => {
        setNavigate(true);
      };

      return (
        <div>
          {navigate ? (
            <Suspense
              fallback={<Text text="Loading..." />}
              name="suspense page">
              <AsyncText text="Page Two" />
            </Suspense>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll(['Page One']);
    });

    await act(async () => {
      startTransition(() => navigateToPageTwo(), {name: 'page transition'});

      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Suspend [Page Two]',
        'Loading...',
        // 预热阶段
        'Suspend [Page Two]',
        // 预热结束
        'onTransitionStart(page transition, 1000)',
        'onTransitionProgress(page transition, 1000, 2000, [suspense page])',
      ]);

      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await resolveText('Page Two');

      await waitForAll([
        'Page Two',
        'onTransitionProgress(page transition, 1000, 3000, [])',
        'onTransitionComplete(page transition, 1000, 3000)',
      ]);
    });
  });

  /**
   * 场景：同一根上的顺序转换互不污染。
   * Given：页面导航与附加文本各有独立状态及 Suspense，且第一次转换可先完成。
   * When：依次启动 page transition 与 text transition，并分别解析对应资源。
   * Then：每个转换保留自己的名称、起止时间和 pending 集合，均独立完成。
   * 验证机制：两轮 waitForAll 分别断言 callback 时间窗，任何跨转换残留都会改变日志。
   * 对应源码：packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js 的 processTransitionCallbacks()。
   */
  // @gate enableTransitionTracing
  it('should correctly trace multiple separate root interactions', async () => {
    const transitionCallbacks = {

      /**
       * 区分先后独立的页面转换与文本转换。
       * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
       */
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },

      /**
       * 区分先后独立的页面转换与文本转换。
       * 把 pending 边界名称按传入顺序写入日志，无名称时显示 <null>。startTime 是转换起点，名为 endTime 的实参此时是进度快照时间，并非转换已经完成。
       */
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 区分先后独立的页面转换与文本转换。
       * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
       */
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    let navigateToPageTwo;
    let showTextFn;
    /** App 暴露导航和附加文本两个状态入口，按顺序创建互不重叠的根转换。 */
    function App() {
      const [navigate, setNavigate] = useState(false);
      const [showText, setShowText] = useState(false);

      /**
       * 触发页面导航，供先发生的 page transition 与后发生的独立文本转换对比。
       */
      navigateToPageTwo = () => {
        setNavigate(true);
      };

      /**
       * 显示异步 Text，作为另一条 text transition 的独立更新入口。
       */
      showTextFn = () => {
        setShowText(true);
      };

      return (
        <div>
          {navigate ? (
            <>
              {showText ? (
                <Suspense
                  name="show text"
                  fallback={<Text text="Show Text Loading..." />}>
                  <AsyncText text="Show Text" />
                </Suspense>
              ) : null}
              <Suspense
                fallback={<Text text="Loading..." />}
                name="suspense page">
                <AsyncText text="Page Two" />
              </Suspense>
            </>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll(['Page One']);
    });

    await act(async () => {
      startTransition(() => navigateToPageTwo(), {name: 'page transition'});

      await waitForAll([
        'Suspend [Page Two]',
        'Loading...',
        // 预热阶段
        'Suspend [Page Two]',
        // 预热结束
        'onTransitionStart(page transition, 1000)',
        'onTransitionProgress(page transition, 1000, 1000, [suspense page])',
      ]);

      await resolveText('Page Two');
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll([
        'Page Two',
        'onTransitionProgress(page transition, 1000, 2000, [])',
        'onTransitionComplete(page transition, 1000, 2000)',
      ]);

      startTransition(() => showTextFn(), {name: 'text transition'});
      await waitForAll([
        'Suspend [Show Text]',
        'Show Text Loading...',
        'Page Two',
        // 预热阶段
        'Suspend [Show Text]',
        // 预热结束
        'onTransitionStart(text transition, 2000)',
        'onTransitionProgress(text transition, 2000, 2000, [show text])',
      ]);

      await resolveText('Show Text');
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll([
        'Show Text',
        'onTransitionProgress(text transition, 2000, 3000, [])',
        'onTransitionComplete(text transition, 2000, 3000)',
      ]);
    });
  });

  /**
   * 场景：同一根上的交错转换独立结算。
   * Given：page transition 尚因 Page Two 挂起时，可启动 show text 转换。
   * When：先后启动两个转换，再按资源分别解析。
   * Then：后发转换不会覆盖先发记录；各自只在所属 Suspense 解除后 complete。
   * 验证机制：分阶段日志按 transition name 校验 pending 与完成时间，捕获错误合并或提前完成。
   * 对应源码：packages/react-reconciler/src/ReactFiberWorkLoop.js 的 transition-to-lane 映射；ReactFiberTracingMarkerComponent.js。
   */
  // @gate enableTransitionTracing
  it('should correctly trace multiple intertwined root interactions', async () => {
    const transitionCallbacks = {

      /**
       * 区分页面先完成、文本后完成的交错转换。
       * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
       */
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },

      /**
       * 区分页面先完成、文本后完成的交错转换。
       * 把 pending 边界名称按传入顺序写入日志，无名称时显示 <null>。startTime 是转换起点，名为 endTime 的实参此时是进度快照时间，并非转换已经完成。
       */
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 区分页面先完成、文本后完成的交错转换。
       * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
       */
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };
    let navigateToPageTwo;
    let showTextFn;
    /** App 暴露两个可重叠更新入口，让后发转换与仍挂起的先发转换分别结算。 */
    function App() {
      const [navigate, setNavigate] = useState(false);
      const [showText, setShowText] = useState(false);
      /**
       * 将页面切入 Page Two 的挂起分支，保留其转换以便和稍后的文本转换交错解析。
       */
      navigateToPageTwo = () => {
        setNavigate(true);
      };

      /**
       * 显示 Text 的挂起分支，验证页面完成后此转换仍等待自己的资源。
       */
      showTextFn = () => {
        setShowText(true);
      };

      return (
        <div>
          {navigate ? (
            <>
              {showText ? (
                <Suspense
                  name="show text"
                  fallback={<Text text="Show Text Loading..." />}>
                  <AsyncText text="Show Text" />
                </Suspense>
              ) : null}
              <Suspense
                fallback={<Text text="Loading..." />}
                name="suspense page">
                <AsyncText text="Page Two" />
              </Suspense>
            </>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll(['Page One']);
    });

    await act(async () => {
      startTransition(() => navigateToPageTwo(), {name: 'page transition'});
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Suspend [Page Two]',
        'Loading...',
        // 预热阶段
        'Suspend [Page Two]',
        // 预热结束
        'onTransitionStart(page transition, 1000)',
        'onTransitionProgress(page transition, 1000, 2000, [suspense page])',
      ]);
    });

    await act(async () => {
      startTransition(() => showTextFn(), {name: 'show text'});

      await waitForAll([
        'Suspend [Show Text]',
        'Show Text Loading...',
        'Suspend [Page Two]',
        'Loading...',
        // 预热阶段
        'Suspend [Show Text]',
        'Suspend [Page Two]',
        // 预热结束
        'onTransitionStart(show text, 2000)',
        'onTransitionProgress(show text, 2000, 2000, [show text])',
      ]);
    });

    await act(async () => {
      await resolveText('Page Two');
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Page Two',
        'onTransitionProgress(page transition, 1000, 3000, [])',
        'onTransitionComplete(page transition, 1000, 3000)',
      ]);

      await resolveText('Show Text');
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Show Text',
        'onTransitionProgress(show text, 2000, 4000, [])',
        'onTransitionComplete(show text, 2000, 4000)',
      ]);
    });
  });

  /**
   * 场景：父 Suspense 解除后 pending 转移到嵌套与同级边界。
   * Given：导航树包含外层 Suspense 以及两个更深的具名 Suspense。
   * When：启动导航并依次解析外层文本、子文本一和子文本二。
   * Then：pending 从外层边界转为两个子边界，再逐个缩减为空，最后完成转换。
   * 验证机制：每次资源解析后的 waitForAll 精确断言 pending 名称集合及顺序。
   * 对应源码：packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js 的 pendingBoundaries 聚合与 processTransitionCallbacks()。
   */
  // @gate enableTransitionTracing
  it('trace interaction with nested and sibling suspense boundaries', async () => {
    const transitionCallbacks = {

      /**
       * 跟踪父 Suspense 解除后才成为可见待完成项的两个子边界。
       * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
       */
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },

      /**
       * 跟踪父 Suspense 解除后才成为可见待完成项的两个子边界。
       * 把 pending 边界名称按传入顺序写入日志，无名称时显示 <null>。startTime 是转换起点，名为 endTime 的实参此时是进度快照时间，并非转换已经完成。
       */
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 跟踪父 Suspense 解除后才成为可见待完成项的两个子边界。
       * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
       */
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    let navigateToPageTwo;
    /** App 构造嵌套及同级 Suspense，验证父边界解除后 pending 集合转移到更深子边界。 */
    function App() {
      const [navigate, setNavigate] = useState(false);
      /**
       * 切入含外层和嵌套两个子 Suspense 的页面，资源按父边界再子边界顺序解析。
       */
      navigateToPageTwo = () => {
        setNavigate(true);
      };

      return (
        <div>
          {navigate ? (
            <>
              <Suspense
                fallback={<Text text="Loading..." />}
                name="suspense page">
                <AsyncText text="Page Two" />
                <Suspense
                  name="show text one"
                  fallback={<Text text="Show Text One Loading..." />}>
                  <AsyncText text="Show Text One" />
                </Suspense>
                <div>
                  <Suspense
                    name="show text two"
                    fallback={<Text text="Show Text Two Loading..." />}>
                    <AsyncText text="Show Text Two" />
                  </Suspense>
                </div>
              </Suspense>
            </>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll(['Page One']);
    });

    await act(async () => {
      startTransition(() => navigateToPageTwo(), {name: 'page transition'});
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Suspend [Page Two]',
        'Loading...',
        // 预热阶段
        'Suspend [Page Two]',
        'Suspend [Show Text One]',
        'Show Text One Loading...',
        'Suspend [Show Text Two]',
        'Show Text Two Loading...',
        // 预热结束
        'onTransitionStart(page transition, 1000)',
        'onTransitionProgress(page transition, 1000, 2000, [suspense page])',
      ]);

      resolveText('Page Two');
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Page Two',
        'Suspend [Show Text One]',
        'Show Text One Loading...',
        'Suspend [Show Text Two]',
        'Show Text Two Loading...',
        // 预热阶段
        'Suspend [Show Text One]',
        'Suspend [Show Text Two]',
        // 预热结束
        'onTransitionProgress(page transition, 1000, 3000, [show text one, show text two])',
      ]);

      resolveText('Show Text One');
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Show Text One',
        'onTransitionProgress(page transition, 1000, 4000, [show text two])',
      ]);

      resolveText('Show Text Two');
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Show Text Two',
        'onTransitionProgress(page transition, 1000, 5000, [])',
        'onTransitionComplete(page transition, 1000, 5000)',
      ]);
    });
  });

  /**
   * 场景：共享 Suspense 的转换纠缠仍保留独立完成条件。
   * Given：navigate 与 show text one 共享挂起路径，show text two 属于后发独立转换。
   * When：并行启动前两个转换，再启动第三个，并按不同顺序解析三个资源。
   * Then：第三个转换可先完成；纠缠的前两个须等共享边界解除后同时完成。
   * 验证机制：日志逐步验证各 name 的 pending 集合和 complete 出现时机，防止错误的全局结算。
   * 对应源码：packages/react-reconciler/src/ReactFiberWorkLoop.js 的 entangledRenderLanes；ReactFiberTracingMarkerComponent.js。
   */
  // @gate enableTransitionTracing
  it('trace interactions with the same child suspense boundaries', async () => {
    const transitionCallbacks = {

      /**
       * 区分共用挂起子树的两条转换与后来独立的 Text Two 转换。
       * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
       */
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },

      /**
       * 区分共用挂起子树的两条转换与后来独立的 Text Two 转换。
       * 把 pending 边界名称按传入顺序写入日志，无名称时显示 <null>。startTime 是转换起点，名为 endTime 的实参此时是进度快照时间，并非转换已经完成。
       */
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 区分共用挂起子树的两条转换与后来独立的 Text Two 转换。
       * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
       */
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    let setNavigate;
    let setShowTextOne;
    let setShowTextTwo;
    /** App 用三个状态让两个转换共享部分 Suspense，并保留各自独立的完成条件。 */
    function App() {
      const [navigate, _setNavigate] = useState(false);
      const [showTextOne, _setShowTextOne] = useState(false);
      const [showTextTwo, _setShowTextTwo] = useState(false);

      /**
       * 把导航状态置真，使转换进入多个共享挂起子树的页面。
       */
      setNavigate = () => _setNavigate(true);
      /**
       * 显示 Text One，让 text one transition 与 page transition 共同等待该子树。
       */
      setShowTextOne = () => _setShowTextOne(true);
      /**
       * 显示 Text Two，创建后来可独立于前两条转换完成的子边界。
       */
      setShowTextTwo = () => _setShowTextTwo(true);

      return (
        <div>
          {navigate ? (
            <>
              <Suspense
                fallback={<Text text="Loading..." />}
                name="suspense page">
                <AsyncText text="Page Two" />
                {/* showTextOne 与 navigate 发生纠缠 */}
                {showTextOne ? (
                  <Suspense
                    name="show text one"
                    fallback={<Text text="Show Text One Loading..." />}>
                    <AsyncText text="Show Text One" />
                  </Suspense>
                ) : null}
                <Suspense fallback={<Text text="Show Text Loading..." />}>
                  <AsyncText text="Show Text" />
                </Suspense>
                {/* showTextTwo 的 Suspense 不应阻止 navigate 的 Suspense
                 完成 */}
                {showTextTwo ? (
                  <Suspense
                    name="show text two"
                    fallback={<Text text="Show Text Two Loading..." />}>
                    <AsyncText text="Show Text Two" />
                  </Suspense>
                ) : null}
              </Suspense>
            </>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll(['Page One']);
    });

    await act(async () => {
      startTransition(() => setNavigate(), {name: 'navigate'});
      startTransition(() => setShowTextOne(), {name: 'show text one'});
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Suspend [Page Two]',
        'Loading...',
        // 预热阶段
        'Suspend [Page Two]',
        'Suspend [Show Text One]',
        'Show Text One Loading...',
        'Suspend [Show Text]',
        'Show Text Loading...',
        // 预热结束
        'onTransitionStart(navigate, 1000)',
        'onTransitionStart(show text one, 1000)',
        'onTransitionProgress(navigate, 1000, 2000, [suspense page])',
        'onTransitionProgress(show text one, 1000, 2000, [suspense page])',
      ]);

      resolveText('Page Two');
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll([
        'Page Two',
        'Suspend [Show Text One]',
        'Show Text One Loading...',
        'Suspend [Show Text]',
        'Show Text Loading...',
        // 预热阶段
        'Suspend [Show Text One]',
        'Suspend [Show Text]',
        // 预热结束
        'onTransitionProgress(navigate, 1000, 3000, [show text one, <null>])',
        'onTransitionProgress(show text one, 1000, 3000, [show text one, <null>])',
      ]);

      startTransition(() => setShowTextTwo(), {name: 'show text two'});
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Page Two',
        'Suspend [Show Text One]',
        'Show Text One Loading...',
        'Suspend [Show Text]',
        'Show Text Loading...',
        'Suspend [Show Text Two]',
        'Show Text Two Loading...',
        // 预热阶段
        'Suspend [Show Text One]',
        'Suspend [Show Text]',
        'Suspend [Show Text Two]',
        // 预热结束
        'onTransitionStart(show text two, 3000)',
        'onTransitionProgress(show text two, 3000, 4000, [show text two])',
      ]);

      // 这一步不应结束 navigate，因为它仍与
      // show text one 纠缠。
      resolveText('Show Text');
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Show Text',
        'onTransitionProgress(navigate, 1000, 5000, [show text one])',
        'onTransitionProgress(show text one, 1000, 5000, [show text one])',
      ]);

      // 这一步只应结束 show text two，不应结束其他转换。
      resolveText('Show Text Two');
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll([
        'Show Text Two',
        'onTransitionProgress(show text two, 3000, 6000, [])',
        'onTransitionComplete(show text two, 3000, 6000)',
      ]);

      // 这一步应让其余所有转换完成。
      resolveText('Show Text One');
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Show Text One',
        'onTransitionProgress(navigate, 1000, 7000, [])',
        'onTransitionProgress(show text one, 1000, 7000, [])',
        'onTransitionComplete(navigate, 1000, 7000)',
        'onTransitionComplete(show text one, 1000, 7000)',
      ]);
    });
  });

  /**
   * 场景：同步 TracingMarker 与转换在同次提交完成。
   * Given：页面切换会挂载新的 keyed TracingMarker，但其子树不挂起。
   * When：启动具名页面转换并推进提交。
   * Then：先报告 transition start，再报告新 Marker complete，最后 transition complete。
   * 验证机制：waitForAll 对三类回调的严格顺序及相同时间窗进行断言。
   * 对应源码：packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js 的 processTransitionCallbacks()。
   */
  // @gate enableTransitionTracing
  it('should correctly trace basic interaction with tracing markers', async () => {
    const transitionCallbacks = {

      /**
       * 区分换 key 后新 Marker 的完成与根转换的完成。
       * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
       */
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },

      /**
       * 区分换 key 后新 Marker 的完成与根转换的完成。
       * 把 pending 边界名称按传入顺序写入日志，无名称时显示 <null>。startTime 是转换起点，名为 endTime 的实参此时是进度快照时间，并非转换已经完成。
       */
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 区分换 key 后新 Marker 的完成与根转换的完成。
       * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
       */
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },

      /**
       * 区分换 key 后新 Marker 的完成与根转换的完成。
       * 记录转换与 Marker 的名称、起始时间和本次进度时间（Scheduler 毫秒），并序列化该 Marker 仍等待的边界；不自行增删 pending。
       */
      onMarkerProgress: (
        transitioName,
        markerName,
        startTime,
        currentTime,
        pending,
      ) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onMarkerProgress(${transitioName}, ${markerName}, ${startTime}, ${currentTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 区分换 key 后新 Marker 的完成与根转换的完成。
       * 记录转换名称、Marker 名称及起止 Scheduler 毫秒时间；这只证明该 Marker 的完成事件，根转换是否完成由另一个回调验证。
       */
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.log(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };

    let navigateToPageTwo;
    /** 切换页面时为第二个 Marker 指定新 key，使其重新挂载；同步子树可与转换一起完成。 */
    function App() {
      const [navigate, setNavigate] = useState(false);
      /**
       * 将 key 从 markerOne 切为 markerTwo 并显示 Page Two；转换因此关联重新挂载的 Marker。
       */
      navigateToPageTwo = () => {
        setNavigate(true);
      };

      return (
        <div>
          {navigate ? (
            <React.unstable_TracingMarker name="marker two" key="marker two">
              <Text text="Page Two" />
            </React.unstable_TracingMarker>
          ) : (
            <React.unstable_TracingMarker name="marker one">
              <Text text="Page One" />
            </React.unstable_TracingMarker>
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll(['Page One']);

      await act(async () => {
        startTransition(() => navigateToPageTwo(), {name: 'page transition'});

        ReactNoop.expire(1000);
        await advanceTimers(1000);

        await waitForAll([
          'Page Two',
          'onTransitionStart(page transition, 1000)',
          'onMarkerComplete(page transition, marker two, 1000, 2000)',
          'onTransitionComplete(page transition, 1000, 2000)',
        ]);
      });
    });
  });

  /**
   * 场景：同步与异步 Marker 使用不同终态路径。
   * Given：同一转换树含空的同步 Marker 和内部仍挂起的异步 Marker。
   * When：先解析外层 Page Two，再解析 Marker Text。
   * Then：外层 Page Two 解析并提交后，同步 Marker complete；异步 Marker 先 progress，待自身 pending 清空后 complete，随后转换完成。
   * 验证机制：分两次 waitForAll 校验 Marker 级 pending、完成顺序和 transition 终态。
   * 对应源码：packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js 的 markerProgress/markerComplete 分发。
   */
  // @gate enableTransitionTracing
  it('should correctly trace interactions for tracing markers', async () => {
    const transitionCallbacks = {

      /**
       * 核对同步 Marker 先完成而异步 Marker 继续等待资源。
       * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
       */
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },

      /**
       * 核对同步 Marker 先完成而异步 Marker 继续等待资源。
       * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
       */
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },

      /**
       * 核对同步 Marker 先完成而异步 Marker 继续等待资源。
       * 记录转换与 Marker 的名称、起始时间和本次进度时间（Scheduler 毫秒），并序列化该 Marker 仍等待的边界；不自行增删 pending。
       */
      onMarkerProgress: (
        transitioName,
        markerName,
        startTime,
        currentTime,
        pending,
      ) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onMarkerProgress(${transitioName}, ${markerName}, ${startTime}, ${currentTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 核对同步 Marker 先完成而异步 Marker 继续等待资源。
       * 记录转换名称、Marker 名称及起止 Scheduler 毫秒时间；这只证明该 Marker 的完成事件，根转换是否完成由另一个回调验证。
       */
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.log(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };
    let navigateToPageTwo;
    /** 外层 Suspense 中并置同步与异步 Marker：前者等待外层揭示，后者还要等待内部资源。 */
    function App() {
      const [navigate, setNavigate] = useState(false);
      /**
       * 显示同时含同步与异步 Marker 的 Page Two，验证各 Marker 的完成时点不同。
       */
      navigateToPageTwo = () => {
        setNavigate(true);
      };

      return (
        <div>
          {navigate ? (
            <Suspense
              fallback={<Text text="Loading..." />}
              name="suspense page">
              <AsyncText text="Page Two" />
              <React.unstable_TracingMarker name="sync marker" />
              <React.unstable_TracingMarker name="async marker">
                <Suspense
                  fallback={<Text text="Loading..." />}
                  name="marker suspense">
                  <AsyncText text="Marker Text" />
                </Suspense>
              </React.unstable_TracingMarker>
            </Suspense>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll(['Page One']);
    });

    await act(async () => {
      startTransition(() => navigateToPageTwo(), {name: 'page transition'});

      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Suspend [Page Two]',
        'Loading...',
        // 预热阶段
        'Suspend [Page Two]',
        'Suspend [Marker Text]',
        'Loading...',
        // 预热结束
        'onTransitionStart(page transition, 1000)',
      ]);

      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await resolveText('Page Two');

      await waitForAll([
        'Page Two',
        'Suspend [Marker Text]',
        'Loading...',
        // 预热阶段
        'Suspend [Marker Text]',
        // 预热结束
        'onMarkerProgress(page transition, async marker, 1000, 3000, [marker suspense])',
        'onMarkerComplete(page transition, sync marker, 1000, 3000)',
      ]);

      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await resolveText('Marker Text');

      await waitForAll([
        'Marker Text',
        'onMarkerProgress(page transition, async marker, 1000, 4000, [])',
        'onMarkerComplete(page transition, async marker, 1000, 4000)',
        'onTransitionComplete(page transition, 1000, 4000)',
      ]);
    });
  });

  /**
   * 场景：多层 Marker 沿祖先链汇总 Suspense 进度。
   * Given：外层 Marker 包含两个内层 Marker及多个 Suspense，资源完成顺序可控。
   * When：依次解析内层二、外层文本、内层一。
   * Then：外层 Marker 的 pending 集合随子边界缩减；子 Marker 分别完成，外层最后完成。
   * 验证机制：日志验证每次 progress 的 Marker 名、pending 名及内外层 complete 顺序。
   * 对应源码：packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js 的 markerInstanceStack 与 processTransitionCallbacks()。
   */
  // @gate enableTransitionTracing
  it('trace interaction with multiple tracing markers', async () => {
    const transitionCallbacks = {

      /**
       * 核对外层 Marker 等待两个内层 Marker 的资源归属。
       * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
       */
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },

      /**
       * 核对外层 Marker 等待两个内层 Marker 的资源归属。
       * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
       */
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },

      /**
       * 核对外层 Marker 等待两个内层 Marker 的资源归属。
       * 记录转换与 Marker 的名称、起始时间和本次进度时间（Scheduler 毫秒），并序列化该 Marker 仍等待的边界；不自行增删 pending。
       */
      onMarkerProgress: (
        transitioName,
        markerName,
        startTime,
        currentTime,
        pending,
      ) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onMarkerProgress(${transitioName}, ${markerName}, ${startTime}, ${currentTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 核对外层 Marker 等待两个内层 Marker 的资源归属。
       * 记录转换名称、Marker 名称及起止 Scheduler 毫秒时间；这只证明该 Marker 的完成事件，根转换是否完成由另一个回调验证。
       */
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.log(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };

    let navigateToPageTwo;
    /** App 构造外层 Marker、两个内层 Marker 与三层 Suspense，验证进度沿 Marker 祖先链聚合。 */
    function App() {
      const [navigate, setNavigate] = useState(false);
      /**
       * 进入含两个内层 Marker 的 Page Two，外层 Marker 保持等待内层未解析资源。
       */
      navigateToPageTwo = () => {
        setNavigate(true);
      };

      return (
        <div>
          {navigate ? (
            <React.unstable_TracingMarker name="outer marker">
              <Suspense fallback={<Text text="Outer..." />} name="outer">
                <AsyncText text="Outer Text" />
                <Suspense
                  fallback={<Text text="Inner One..." />}
                  name="inner one">
                  <React.unstable_TracingMarker name="marker one">
                    <AsyncText text="Inner Text One" />
                  </React.unstable_TracingMarker>
                </Suspense>
                <Suspense
                  fallback={<Text text="Inner Two..." />}
                  name="inner two">
                  <React.unstable_TracingMarker name="marker two">
                    <AsyncText text="Inner Text Two" />
                  </React.unstable_TracingMarker>
                </Suspense>
              </Suspense>
            </React.unstable_TracingMarker>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll(['Page One']);
    });

    await act(async () => {
      startTransition(() => navigateToPageTwo(), {name: 'page transition'});

      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Suspend [Outer Text]',
        'Outer...',
        // 预热阶段
        'Suspend [Outer Text]',
        'Suspend [Inner Text One]',
        'Inner One...',
        'Suspend [Inner Text Two]',
        'Inner Two...',
        // 预热结束
        'onTransitionStart(page transition, 1000)',
        'onMarkerProgress(page transition, outer marker, 1000, 2000, [outer])',
      ]);

      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await resolveText('Inner Text Two');
      await waitForAll([]);

      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await resolveText('Outer Text');
      await waitForAll([
        'Outer Text',
        'Suspend [Inner Text One]',
        'Inner One...',
        'Inner Text Two',
        // 预热阶段
        'Suspend [Inner Text One]',
        // 预热结束
        'onMarkerProgress(page transition, outer marker, 1000, 4000, [inner one])',
        'onMarkerComplete(page transition, marker two, 1000, 4000)',
      ]);

      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await resolveText('Inner Text One');
      await waitForAll([
        'Inner Text One',
        'onMarkerProgress(page transition, outer marker, 1000, 5000, [])',
        'onMarkerComplete(page transition, marker one, 1000, 5000)',
        'onMarkerComplete(page transition, outer marker, 1000, 5000)',
        'onTransitionComplete(page transition, 1000, 5000)',
      ]);
    });
  });

  /**
   * 场景：保留但跳过的 Marker 改名历史期望。
   * Given：被跳过的回归场景中，具名 Marker 仍有 Suspense 挂起。
   * When：复用同一 Marker 实例但把 name 从 marker one 改为 marker two。
   * Then：此历史断言期望旧 Marker 的 incomplete 记录包含 newName，并期望资源解析后转换完成。
   * 验证状态：it.skip 不执行此回归；当前 processTransitionCallbacks 只转换 type、name、endTime，且更新同一 Marker 的 name 会警告，不支持此处的 newName 期望。
   * 对应源码：packages/react-reconciler/src/ReactFiberCommitWork.js 的 abortTracingMarkerTransitions()；ReactFiberTracingMarkerComponent.js。
   */
  // @gate enableTransitionTracing
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('warn and calls marker incomplete if name changes before transition completes', async () => {
    const transitionCallbacks = {

      /**
       * 保留已跳过的历史改名场景的事件观测口，不作为本版已验证行为。
       * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
       */
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },

      /**
       * 保留已跳过的历史改名场景的事件观测口，不作为本版已验证行为。
       * 把 pending 边界名称按传入顺序写入日志，无名称时显示 <null>。startTime 是转换起点，名为 endTime 的实参此时是进度快照时间，并非转换已经完成。
       */
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 保留已跳过的历史改名场景的事件观测口，不作为本版已验证行为。
       * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
       */
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },

      /**
       * 保留已跳过的历史改名场景的事件观测口，不作为本版已验证行为。
       * 记录转换与 Marker 的名称、起始时间和本次进度时间（Scheduler 毫秒），并序列化该 Marker 仍等待的边界；不自行增删 pending。
       */
      onMarkerProgress: (
        transitioName,
        markerName,
        startTime,
        currentTime,
        pending,
      ) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onMarkerProgress(${transitioName}, ${markerName}, ${startTime}, ${currentTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 保留已跳过的历史改名场景的事件观测口，不作为本版已验证行为。
       * 用 stringifyDeletions 排序序列化终止记录的键，保留 type/name/endTime；该日志区分删除导致的不完整与正常完成。
       */
      onMarkerIncomplete: (
        transitionName,
        markerName,
        startTime,
        deletions,
      ) => {
        Scheduler.log(
          `onMarkerIncomplete(${transitionName}, ${markerName}, ${startTime}, [${stringifyDeletions(
            deletions,
          )}])`,
        );
      },

      /**
       * 保留已跳过的历史改名场景的事件观测口，不作为本版已验证行为。
       * 记录转换名称、Marker 名称及起止 Scheduler 毫秒时间；这只证明该 Marker 的完成事件，根转换是否完成由另一个回调验证。
       */
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.log(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };

    /** 历史夹具复用同一 Marker 并修改 name；该用例被跳过，下面的 incomplete 预期不代表当前实现保证。 */
    function App({navigate, markerName}) {
      return (
        <div>
          {navigate ? (
            <React.unstable_TracingMarker name={markerName}>
              <Suspense fallback={<Text text="Loading..." />}>
                <AsyncText text="Page Two" />
              </Suspense>
            </React.unstable_TracingMarker>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App navigate={false} markerName="marker one" />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll(['Page One']);

      startTransition(
        () => root.render(<App navigate={true} markerName="marker one" />),
        {
          name: 'transition one',
        },
      );
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Suspend [Page Two]',
        'Loading...',
        'onTransitionStart(transition one, 1000)',
        'onMarkerProgress(transition one, marker one, 1000, 2000, [<null>])',
        'onTransitionProgress(transition one, 1000, 2000, [<null>])',
      ]);

      root.render(<App navigate={true} markerName="marker two" />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Suspend [Page Two]',
        'Loading...',
        'onMarkerIncomplete(transition one, marker one, 1000, [{endTime: 3000, name: marker one, newName: marker two, type: marker}])',
      ]);

      resolveText('Page Two');
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll([
        'Page Two',
        'onMarkerProgress(transition one, marker one, 1000, 4000, [])',
        'onTransitionProgress(transition one, 1000, 4000, [])',
        'onTransitionComplete(transition one, 1000, 4000)',
      ]);
    });
  });

  /**
   * 场景：删除子 Marker 只使相关祖先不完整。
   * Given：父 Marker 内含可删除子 Marker和持续存在的同级 Marker，两者均挂起。
   * When：转换进行中移除子 Marker，随后重新渲染并分别解析资源。
   * Then：子 Marker 与父 Marker收到 incomplete；同级 Marker 继续 progress/complete，不应被误删。
   * 验证机制：waitForAll 核对删除记录、剩余 pending 集合，并验证不完整祖先与转换不产生 complete，幸存兄弟仍可完成。
   * 对应源码：packages/react-reconciler/src/ReactFiberCommitWork.js 的 abortTracingMarkerTransitions()；ReactFiberTracingMarkerComponent.js。
   */
  // @gate enableTransitionTracing
  it('marker incomplete for tree with parent and sibling tracing markers', async () => {
    const transitionCallbacks = {

      /**
       * 跟踪删除 Marker 子树后祖先不完整、兄弟仍可完成的分支。
       * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
       */
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },

      /**
       * 跟踪删除 Marker 子树后祖先不完整、兄弟仍可完成的分支。
       * 把 pending 边界名称按传入顺序写入日志，无名称时显示 <null>。startTime 是转换起点，名为 endTime 的实参此时是进度快照时间，并非转换已经完成。
       */
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 跟踪删除 Marker 子树后祖先不完整、兄弟仍可完成的分支。
       * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
       */
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },

      /**
       * 跟踪删除 Marker 子树后祖先不完整、兄弟仍可完成的分支。
       * 记录转换与 Marker 的名称、起始时间和本次进度时间（Scheduler 毫秒），并序列化该 Marker 仍等待的边界；不自行增删 pending。
       */
      onMarkerProgress: (
        transitioName,
        markerName,
        startTime,
        currentTime,
        pending,
      ) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onMarkerProgress(${transitioName}, ${markerName}, ${startTime}, ${currentTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 跟踪删除 Marker 子树后祖先不完整、兄弟仍可完成的分支。
       * 用 stringifyDeletions 排序序列化终止记录的键，保留 type/name/endTime；该日志区分删除导致的不完整与正常完成。
       */
      onMarkerIncomplete: (
        transitionName,
        markerName,
        startTime,
        deletions,
      ) => {
        Scheduler.log(
          `onMarkerIncomplete(${transitionName}, ${markerName}, ${startTime}, [${stringifyDeletions(
            deletions,
          )}])`,
        );
      },

      /**
       * 跟踪删除 Marker 子树后祖先不完整、兄弟仍可完成的分支。
       * 记录转换名称、Marker 名称及起止 Scheduler 毫秒时间；这只证明该 Marker 的完成事件，根转换是否完成由另一个回调验证。
       */
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.log(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };

    /** App 可移除父 Marker 内的子 Marker，同时保留同级 Marker，验证删除只污染相关祖先。 */
    function App({navigate, showMarker}) {
      return (
        <div>
          {navigate ? (
            <React.unstable_TracingMarker name="parent">
              {showMarker ? (
                <React.unstable_TracingMarker name="marker one">
                  <Suspense
                    name="suspense page"
                    fallback={<Text text="Loading..." />}>
                    <AsyncText text="Page Two" />
                  </Suspense>
                </React.unstable_TracingMarker>
              ) : (
                <Suspense
                  name="suspense page"
                  fallback={<Text text="Loading..." />}>
                  <AsyncText text="Page Two" />
                </Suspense>
              )}
              <React.unstable_TracingMarker name="sibling">
                <Suspense
                  name="suspense sibling"
                  fallback={<Text text="Sibling Loading..." />}>
                  <AsyncText text="Sibling Text" />
                </Suspense>
              </React.unstable_TracingMarker>
            </React.unstable_TracingMarker>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App navigate={false} showMarker={true} />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll(['Page One']);

      startTransition(
        () => root.render(<App navigate={true} showMarker={true} />),
        {
          name: 'transition one',
        },
      );
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll([
        'Suspend [Page Two]',
        'Loading...',
        'Suspend [Sibling Text]',
        'Sibling Loading...',
        // 预热阶段
        'Suspend [Page Two]',
        'Suspend [Sibling Text]',
        // 预热结束
        'onTransitionStart(transition one, 1000)',
        'onMarkerProgress(transition one, parent, 1000, 2000, [suspense page, suspense sibling])',
        'onMarkerProgress(transition one, marker one, 1000, 2000, [suspense page])',
        'onMarkerProgress(transition one, sibling, 1000, 2000, [suspense sibling])',
        'onTransitionProgress(transition one, 1000, 2000, [suspense page, suspense sibling])',
      ]);
      root.render(<App navigate={true} showMarker={false} />);

      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll([
        'Suspend [Page Two]',
        'Loading...',
        'Suspend [Sibling Text]',
        'Sibling Loading...',
        // 预热阶段
        'Suspend [Page Two]',
        'Suspend [Sibling Text]',
        // 预热结束
        'onMarkerProgress(transition one, parent, 1000, 3000, [suspense sibling])',
        'onMarkerIncomplete(transition one, marker one, 1000, [{endTime: 3000, name: marker one, type: marker}, {endTime: 3000, name: suspense page, type: suspense}])',
        'onMarkerIncomplete(transition one, parent, 1000, [{endTime: 3000, name: marker one, type: marker}, {endTime: 3000, name: suspense page, type: suspense}])',
      ]);

      root.render(<App navigate={true} showMarker={true} />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll([
        'Suspend [Page Two]',
        'Loading...',
        'Suspend [Sibling Text]',
        'Sibling Loading...',
        // 预热阶段
        'Suspend [Page Two]',
        'Suspend [Sibling Text]',
      ]);
    });

    resolveText('Page Two');
    ReactNoop.expire(1000);
    await advanceTimers(1000);
    await waitForAll(['Page Two']);

    resolveText('Sibling Text');
    ReactNoop.expire(1000);
    await advanceTimers(1000);
    await waitForAll([
      'Sibling Text',
      'onMarkerProgress(transition one, parent, 1000, 6000, [])',
      'onMarkerProgress(transition one, sibling, 1000, 6000, [])',
      // 尝试结算仍有效的父级；已标记不完整的祖先会过滤 complete。
      'onMarkerComplete(transition one, sibling, 1000, 6000)',
      'onTransitionProgress(transition one, 1000, 6000, [])',
    ]);
  });

  /**
   * 场景：删除仍挂起的 Marker 子树传播不完整状态。
   * Given：父 Marker 下的 one 与 two 分支同时挂起。
   * When：转换中删除 one 分支，再解析 two。
   * Then：one 与父级收到 incomplete；two 仍可 progress/complete，但已不完整的父级和转换不再 complete。
   * 验证机制：日志同时验证 deletions 传播和后续只出现 progress、不出现父级终态。
   * 对应源码：packages/react-reconciler/src/ReactFiberCommitWork.js 的 abortTracingMarkerTransitions()；ReactFiberTracingMarkerComponent.js。
   */
  // @gate enableTransitionTracing
  it('marker gets deleted', async () => {
    const transitionCallbacks = {

      /**
       * 区分被删除 Marker 的终止记录与幸存兄弟的完成记录。
       * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
       */
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },

      /**
       * 区分被删除 Marker 的终止记录与幸存兄弟的完成记录。
       * 把 pending 边界名称按传入顺序写入日志，无名称时显示 <null>。startTime 是转换起点，名为 endTime 的实参此时是进度快照时间，并非转换已经完成。
       */
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 区分被删除 Marker 的终止记录与幸存兄弟的完成记录。
       * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
       */
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },

      /**
       * 区分被删除 Marker 的终止记录与幸存兄弟的完成记录。
       * 记录转换与 Marker 的名称、起始时间和本次进度时间（Scheduler 毫秒），并序列化该 Marker 仍等待的边界；不自行增删 pending。
       */
      onMarkerProgress: (
        transitioName,
        markerName,
        startTime,
        currentTime,
        pending,
      ) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onMarkerProgress(${transitioName}, ${markerName}, ${startTime}, ${currentTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 区分被删除 Marker 的终止记录与幸存兄弟的完成记录。
       * 用 stringifyDeletions 排序序列化终止记录的键，保留 type/name/endTime；该日志区分删除导致的不完整与正常完成。
       */
      onMarkerIncomplete: (
        transitionName,
        markerName,
        startTime,
        deletions,
      ) => {
        Scheduler.log(
          `onMarkerIncomplete(${transitionName}, ${markerName}, ${startTime}, [${stringifyDeletions(
            deletions,
          )}])`,
        );
      },

      /**
       * 区分被删除 Marker 的终止记录与幸存兄弟的完成记录。
       * 记录转换名称、Marker 名称及起止 Scheduler 毫秒时间；这只证明该 Marker 的完成事件，根转换是否完成由另一个回调验证。
       */
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.log(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };

    /** App 可删除仍挂起的 Marker 分支，验证删除记录向父 Marker 传播且其余分支继续推进。 */
    function App({navigate, deleteOne}) {
      return (
        <div>
          {navigate ? (
            <React.unstable_TracingMarker name="parent">
              {!deleteOne ? (
                <div>
                  <React.unstable_TracingMarker name="one">
                    <Suspense
                      name="suspense one"
                      fallback={<Text text="Loading One..." />}>
                      <AsyncText text="Page One" />
                    </Suspense>
                  </React.unstable_TracingMarker>
                </div>
              ) : null}
              <React.unstable_TracingMarker name="two">
                <Suspense
                  name="suspense two"
                  fallback={<Text text="Loading Two..." />}>
                  <AsyncText text="Page Two" />
                </Suspense>
              </React.unstable_TracingMarker>
            </React.unstable_TracingMarker>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }
    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App navigate={false} deleteOne={false} />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll(['Page One']);

      startTransition(
        () => root.render(<App navigate={true} deleteOne={false} />),
        {
          name: 'transition',
        },
      );
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll([
        'Suspend [Page One]',
        'Loading One...',
        'Suspend [Page Two]',
        'Loading Two...',
        // 预热阶段
        'Suspend [Page One]',
        'Suspend [Page Two]',
        // 预热结束
        'onTransitionStart(transition, 1000)',
        'onMarkerProgress(transition, parent, 1000, 2000, [suspense one, suspense two])',
        'onMarkerProgress(transition, one, 1000, 2000, [suspense one])',
        'onMarkerProgress(transition, two, 1000, 2000, [suspense two])',
        'onTransitionProgress(transition, 1000, 2000, [suspense one, suspense two])',
      ]);

      root.render(<App navigate={true} deleteOne={true} />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll([
        'Suspend [Page Two]',
        'Loading Two...',
        // 预热阶段
        'Suspend [Page Two]',
        // 预热结束
        'onMarkerProgress(transition, parent, 1000, 3000, [suspense two])',
        'onMarkerIncomplete(transition, one, 1000, [{endTime: 3000, name: one, type: marker}, {endTime: 3000, name: suspense one, type: suspense}])',
        'onMarkerIncomplete(transition, parent, 1000, [{endTime: 3000, name: one, type: marker}, {endTime: 3000, name: suspense one, type: suspense}])',
      ]);

      await resolveText('Page Two');
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll([
        'Page Two',
        // Marker 标记不完整后仍报告 progress，但不再报告 marker complete。
        'onMarkerProgress(transition, parent, 1000, 4000, [])',
        'onMarkerProgress(transition, two, 1000, 4000, [])',
        'onMarkerComplete(transition, two, 1000, 4000)',
        // 转换标记不完整后仍报告 progress，但不再报告 transition complete。
        'onTransitionProgress(transition, 1000, 4000, [])',
      ]);
    });
  });

  /**
   * 场景：删除转换新增的 Suspense 只记录仍相关的后代。
   * Given：转换新增的 Marker 子树包含已解除、未真正渲染及仍挂起的不同边界。
   * When：先解析 Page One，再删除整个 one 分支，最后解析 two。
   * Then：incomplete 删除清单排除已完成和未加入追踪的节点，只保留有效受影响项。
   * 验证机制：waitForAll 对过滤后的 deletion 对象和剩余 Marker/transition 进度做逐项断言。
   * 对应源码：packages/react-reconciler/src/ReactFiberCommitWork.js 的 abortTracingMarkerTransitions()。
   */
  // @gate enableTransitionTracing
  it('Suspense boundary added by the transition is deleted', async () => {
    const transitionCallbacks = {

      /**
       * 只记录删除时仍挂起的 child，排除已完成和未提交的后代。
       * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
       */
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },

      /**
       * 只记录删除时仍挂起的 child，排除已完成和未提交的后代。
       * 把 pending 边界名称按传入顺序写入日志，无名称时显示 <null>。startTime 是转换起点，名为 endTime 的实参此时是进度快照时间，并非转换已经完成。
       */
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 只记录删除时仍挂起的 child，排除已完成和未提交的后代。
       * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
       */
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },

      /**
       * 只记录删除时仍挂起的 child，排除已完成和未提交的后代。
       * 记录转换与 Marker 的名称、起始时间和本次进度时间（Scheduler 毫秒），并序列化该 Marker 仍等待的边界；不自行增删 pending。
       */
      onMarkerProgress: (
        transitioName,
        markerName,
        startTime,
        currentTime,
        pending,
      ) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onMarkerProgress(${transitioName}, ${markerName}, ${startTime}, ${currentTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 只记录删除时仍挂起的 child，排除已完成和未提交的后代。
       * 用 stringifyDeletions 排序序列化终止记录的键，保留 type/name/endTime；该日志区分删除导致的不完整与正常完成。
       */
      onMarkerIncomplete: (
        transitionName,
        markerName,
        startTime,
        deletions,
      ) => {
        Scheduler.log(
          `onMarkerIncomplete(${transitionName}, ${markerName}, ${startTime}, [${stringifyDeletions(
            deletions,
          )}])`,
        );
      },

      /**
       * 只记录删除时仍挂起的 child，排除已完成和未提交的后代。
       * 记录转换名称、Marker 名称及起止 Scheduler 毫秒时间；这只证明该 Marker 的完成事件，根转换是否完成由另一个回调验证。
       */
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.log(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };

    /** App 可删除转换本次新增的 Suspense 子树，覆盖已完成、未渲染与仍挂起后代的过滤边界。 */
    function App({navigate, deleteOne}) {
      return (
        <div>
          {navigate ? (
            <React.unstable_TracingMarker name="parent">
              <React.unstable_TracingMarker name="one">
                {!deleteOne ? (
                  <Suspense
                    name="suspense one"
                    fallback={<Text text="Loading One..." />}>
                    <AsyncText text="Page One" />
                    <React.unstable_TracingMarker name="page one" />
                    <Suspense
                      name="suspense child"
                      fallback={<Text text="Loading Child..." />}>
                      <React.unstable_TracingMarker name="child" />
                      <AsyncText text="Child" />
                    </Suspense>
                  </Suspense>
                ) : null}
              </React.unstable_TracingMarker>
              <React.unstable_TracingMarker name="two">
                <Suspense
                  name="suspense two"
                  fallback={<Text text="Loading Two..." />}>
                  <AsyncText text="Page Two" />
                </Suspense>
              </React.unstable_TracingMarker>
            </React.unstable_TracingMarker>
          ) : (
            <Text text="Page One" />
          )}
        </div>
      );
    }
    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      root.render(<App navigate={false} deleteOne={false} />);

      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll(['Page One']);

      startTransition(
        () => root.render(<App navigate={true} deleteOne={false} />),
        {
          name: 'transition',
        },
      );
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll([
        'Suspend [Page One]',
        'Loading One...',
        'Suspend [Page Two]',
        'Loading Two...',
        // 预热阶段
        'Suspend [Page One]',
        'Suspend [Child]',
        'Loading Child...',
        'Suspend [Page Two]',
        // 预热结束
        'onTransitionStart(transition, 1000)',
        'onMarkerProgress(transition, parent, 1000, 2000, [suspense one, suspense two])',
        'onMarkerProgress(transition, one, 1000, 2000, [suspense one])',
        'onMarkerProgress(transition, two, 1000, 2000, [suspense two])',
        'onTransitionProgress(transition, 1000, 2000, [suspense one, suspense two])',
      ]);

      await resolveText('Page One');
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll([
        'Page One',
        'Suspend [Child]',
        'Loading Child...',
        // 预热阶段
        'Suspend [Child]',
        // 预热结束
        'onMarkerProgress(transition, parent, 1000, 3000, [suspense two, suspense child])',
        'onMarkerProgress(transition, one, 1000, 3000, [suspense child])',
        'onMarkerComplete(transition, page one, 1000, 3000)',
        'onTransitionProgress(transition, 1000, 3000, [suspense two, suspense child])',
      ]);

      root.render(<App navigate={true} deleteOne={true} />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll([
        'Suspend [Page Two]',
        'Loading Two...',
        // 预热阶段
        'Suspend [Page Two]',
        // 预热结束

        // "suspense one" 已解除挂起，不应计入删除清单。
        // tracing marker "page one" 已完成，不应计入删除清单。
        // "suspense child" 的子节点尚未渲染，不应计入删除清单。
        'onMarkerProgress(transition, one, 1000, 4000, [])',
        'onMarkerProgress(transition, parent, 1000, 4000, [suspense two])',
        'onMarkerIncomplete(transition, one, 1000, [{endTime: 4000, name: suspense child, type: suspense}])',
        'onMarkerIncomplete(transition, parent, 1000, [{endTime: 4000, name: suspense child, type: suspense}])',
      ]);

      await resolveText('Page Two');
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll([
        'Page Two',
        'onMarkerProgress(transition, parent, 1000, 5000, [])',
        'onMarkerProgress(transition, two, 1000, 5000, [])',
        'onMarkerComplete(transition, two, 1000, 5000)',
        'onTransitionProgress(transition, 1000, 5000, [])',
      ]);
    });
  });

  /**
   * 场景：非转换新增或删除的 Suspense 不进入既有转换。
   * Given：初始转换只追踪 child；随后同步追加的 appended child 不属于该转换。
   * When：在转换未完成时普通渲染追加再删除 appended child，最后解析原 child。
   * Then：追加/删除均不触发 callbacks；仅原 child 清空后完成父 Marker 和转换。
   * 验证机制：中间两轮 waitForAll 只允许渲染日志，最终一轮才允许 progress/complete。
   * 对应源码：packages/react-reconciler/src/ReactFiberTracingMarkerComponent.js 的 transition 归属过滤。
   */
  // @gate enableTransitionTracing
  it('Suspense boundary not added by the transition is deleted', async () => {
    const transitionCallbacks = {

      /**
       * 验证普通更新新增的 Suspense 不加入原转换。
       * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
       */
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },

      /**
       * 验证普通更新新增的 Suspense 不加入原转换。
       * 把 pending 边界名称按传入顺序写入日志，无名称时显示 <null>。startTime 是转换起点，名为 endTime 的实参此时是进度快照时间，并非转换已经完成。
       */
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 验证普通更新新增的 Suspense 不加入原转换。
       * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
       */
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },

      /**
       * 验证普通更新新增的 Suspense 不加入原转换。
       * 记录转换与 Marker 的名称、起始时间和本次进度时间（Scheduler 毫秒），并序列化该 Marker 仍等待的边界；不自行增删 pending。
       */
      onMarkerProgress: (
        transitioName,
        markerName,
        startTime,
        currentTime,
        pending,
      ) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onMarkerProgress(${transitioName}, ${markerName}, ${startTime}, ${currentTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 验证普通更新新增的 Suspense 不加入原转换。
       * 用 stringifyDeletions 排序序列化终止记录的键，保留 type/name/endTime；该日志区分删除导致的不完整与正常完成。
       */
      onMarkerIncomplete: (
        transitionName,
        markerName,
        startTime,
        deletions,
      ) => {
        Scheduler.log(
          `onMarkerIncomplete(${transitionName}, ${markerName}, ${startTime}, [${stringifyDeletions(
            deletions,
          )}])`,
        );
      },

      /**
       * 验证普通更新新增的 Suspense 不加入原转换。
       * 记录转换名称、Marker 名称及起止 Scheduler 毫秒时间；这只证明该 Marker 的完成事件，根转换是否完成由另一个回调验证。
       */
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.log(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };

    /** App 在既有转换外追加再删除 Suspense，验证非归属边界不会进入该转换的回调集合。 */
    function App({show}) {
      return (
        <React.unstable_TracingMarker name="parent">
          {show ? (
            <Suspense name="appended child">
              <AsyncText text="Appended child" />
            </Suspense>
          ) : null}
          <Suspense name="child">
            <AsyncText text="Child" />
          </Suspense>
        </React.unstable_TracingMarker>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      startTransition(() => root.render(<App show={false} />), {
        name: 'transition',
      });
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Suspend [Child]',
        // 预热阶段
        'Suspend [Child]',
        // 预热结束
        'onTransitionStart(transition, 0)',
        'onMarkerProgress(transition, parent, 0, 1000, [child])',
        'onTransitionProgress(transition, 0, 1000, [child])',
      ]);

      root.render(<App show={true} />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      // 新追加的子节点不属于该转换，因此
      // 不调用任何 callback。
      await waitForAll([
        'Suspend [Appended child]',
        'Suspend [Child]',
        // 预热阶段
        'Suspend [Appended child]',
        'Suspend [Child]',
      ]);

      // 被删除的子节点不属于该转换，因此
      // 不调用任何 callbacks。
      root.render(<App show={false} />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll([
        'Suspend [Child]',
        // 预热阶段
        'Suspend [Child]',
      ]);

      await resolveText('Child');
      ReactNoop.expire(1000);
      await advanceTimers(1000);

      await waitForAll([
        'Child',
        'onMarkerProgress(transition, parent, 0, 4000, [])',
        'onMarkerComplete(transition, parent, 0, 4000)',
        'onTransitionProgress(transition, 0, 4000, [])',
        'onTransitionComplete(transition, 0, 4000)',
      ]);
    });
  });

  /**
   * 场景：删除非归属 Suspense 会使所属新 Marker 不完整。
   * Given：transition one 追踪既有 child，transition two 新增 Marker 及其 Suspense。
   * When：普通更新仅移除 transition two 的 Suspense，再解析 transition one 的 child。
   * Then：新 Marker 收到 incomplete；transition one 的 Marker 和转换仍独立完成。
   * 验证机制：assertLog 按四个阶段隔离两条转换，验证删除事件不会串入旧转换。
   * 对应源码：packages/react-reconciler/src/ReactFiberCommitWork.js 的 abortTracingMarkerTransitions()；ReactFiberTracingMarkerComponent.js。
   */
  // @gate enableTransitionTracing
  it('marker incomplete gets called properly if child suspense marker is not part of it', async () => {
    const transitionCallbacks = {

      /**
       * 区分 transition two 的删除记录与 transition one 的独立完成。
       * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
       */
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },

      /**
       * 区分 transition two 的删除记录与 transition one 的独立完成。
       * 把 pending 边界名称按传入顺序写入日志，无名称时显示 <null>。startTime 是转换起点，名为 endTime 的实参此时是进度快照时间，并非转换已经完成。
       */
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 区分 transition two 的删除记录与 transition one 的独立完成。
       * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
       */
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },

      /**
       * 区分 transition two 的删除记录与 transition one 的独立完成。
       * 记录转换与 Marker 的名称、起始时间和本次进度时间（Scheduler 毫秒），并序列化该 Marker 仍等待的边界；不自行增删 pending。
       */
      onMarkerProgress: (
        transitioName,
        markerName,
        startTime,
        currentTime,
        pending,
      ) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onMarkerProgress(${transitioName}, ${markerName}, ${startTime}, ${currentTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 区分 transition two 的删除记录与 transition one 的独立完成。
       * 用 stringifyDeletions 排序序列化终止记录的键，保留 type/name/endTime；该日志区分删除导致的不完整与正常完成。
       */
      onMarkerIncomplete: (
        transitionName,
        markerName,
        startTime,
        deletions,
      ) => {
        Scheduler.log(
          `onMarkerIncomplete(${transitionName}, ${markerName}, ${startTime}, [${stringifyDeletions(
            deletions,
          )}])`,
        );
      },

      /**
       * 区分 transition two 的删除记录与 transition one 的独立完成。
       * 记录转换名称、Marker 名称及起止 Scheduler 毫秒时间；这只证明该 Marker 的完成事件，根转换是否完成由另一个回调验证。
       */
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.log(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };

    /** App 分别控制新增 Marker 与其 Suspense，验证只删除非归属子边界时 Marker 的不完整记录。 */
    function App({show, showSuspense}) {
      return (
        <React.unstable_TracingMarker name="parent">
          {show ? (
            <React.unstable_TracingMarker name="appended child">
              {showSuspense ? (
                <Suspense name="appended child">
                  <AsyncText text="Appended child" />
                </Suspense>
              ) : null}
            </React.unstable_TracingMarker>
          ) : null}
          <Suspense name="child">
            <AsyncText text="Child" />
          </Suspense>
        </React.unstable_TracingMarker>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });

    await act(async () => {
      startTransition(
        () => root.render(<App show={false} showSuspense={false} />),
        {
          name: 'transition one',
        },
      );

      ReactNoop.expire(1000);
      await advanceTimers(1000);
    });

    assertLog([
      'Suspend [Child]',
      // 预热阶段
      'Suspend [Child]',
      // 预热结束
      'onTransitionStart(transition one, 0)',
      'onMarkerProgress(transition one, parent, 0, 1000, [child])',
      'onTransitionProgress(transition one, 0, 1000, [child])',
    ]);

    await act(async () => {
      startTransition(
        () => root.render(<App show={true} showSuspense={true} />),
        {
          name: 'transition two',
        },
      );

      ReactNoop.expire(1000);
      await advanceTimers(1000);
    });

    assertLog([
      'Suspend [Appended child]',
      'Suspend [Child]',
      // 预热阶段
      'Suspend [Appended child]',
      'Suspend [Child]',
      // 预热结束
      'onTransitionStart(transition two, 1000)',
      'onMarkerProgress(transition two, appended child, 1000, 2000, [appended child])',
      'onTransitionProgress(transition two, 1000, 2000, [appended child])',
    ]);

    await act(async () => {
      root.render(<App show={true} showSuspense={false} />);
      ReactNoop.expire(1000);
      await advanceTimers(1000);
    });

    assertLog([
      'Suspend [Child]',
      // 预热阶段
      'Suspend [Child]',
      // 预热结束
      'onMarkerProgress(transition two, appended child, 1000, 3000, [])',
      'onMarkerIncomplete(transition two, appended child, 1000, [{endTime: 3000, name: appended child, type: suspense}])',
    ]);

    await act(async () => {
      resolveText('Child');
      ReactNoop.expire(1000);
      await advanceTimers(1000);
    });

    assertLog([
      'Child',
      'onMarkerProgress(transition one, parent, 0, 4000, [])',
      'onMarkerComplete(transition one, parent, 0, 4000)',
      'onTransitionProgress(transition one, 0, 4000, [])',
      'onTransitionComplete(transition one, 0, 4000)',
    ]);
  });

  /**
   * 场景：Marker 改名与更换 key 走不同身份边界。
   * Given：同一 key 代表复用 Marker 实例，新 key 代表重新挂载。
   * When：先保持 key 改名，再用新 key 再次改名。
   * Then：复用改名发出开发警告且不调用 Marker complete；换 key 无警告并正常 complete。
   * 验证机制：waitForAll 与 assertConsoleErrorDev 联合验证 callback 缺席、警告栈和重挂载终态。
   * 对应源码：packages/react-reconciler/src/ReactFiberBeginWork.js 的 TracingMarker 更新；ReactFiberTracingMarkerComponent.js。
   */
  // @gate enableTransitionTracing
  it('warns when marker name changes', async () => {
    const transitionCallbacks = {

      /**
       * 区分同 key 改名警告与新 key 重挂载后的 Marker 完成。
       * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
       */
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },

      /**
       * 区分同 key 改名警告与新 key 重挂载后的 Marker 完成。
       * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
       */
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },

      /**
       * 区分同 key 改名警告与新 key 重挂载后的 Marker 完成。
       * 用 stringifyDeletions 排序序列化终止记录的键，保留 type/name/endTime；该日志区分删除导致的不完整与正常完成。
       */
      onMarkerIncomplete: (
        transitionName,
        markerName,
        startTime,
        deletions,
      ) => {
        Scheduler.log(
          `onMarkerIncomplete(${transitionName}, ${markerName}, ${startTime}, [${stringifyDeletions(
            deletions,
          )}])`,
        );
      },

      /**
       * 区分同 key 改名警告与新 key 重挂载后的 Marker 完成。
       * 记录转换名称、Marker 名称及起止 Scheduler 毫秒时间；这只证明该 Marker 的完成事件，根转换是否完成由另一个回调验证。
       */
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.log(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };
    /** App 以 markerName 与 markerKey 控制复用或重挂载，区分非法改名和合法新实例。 */
    function App({markerName, markerKey}) {
      return (
        <React.unstable_TracingMarker name={markerName} key={markerKey}>
          <Text text={markerName} />
        </React.unstable_TracingMarker>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(async () => {
      startTransition(
        () => root.render(<App markerName="one" markerKey="key" />),
        {
          name: 'transition one',
        },
      );
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      await waitForAll([
        'one',
        'onTransitionStart(transition one, 0)',
        'onMarkerComplete(transition one, one, 0, 1000)',
        'onTransitionComplete(transition one, 0, 1000)',
      ]);
      startTransition(
        () => root.render(<App markerName="two" markerKey="key" />),
        {
          name: 'transition two',
        },
      );
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      // 复用旧 key 并修改名称的转换不应调用
      // onMarkerComplete 回调。
      await waitForAll([
        'two',
        'onTransitionStart(transition two, 1000)',
        'onTransitionComplete(transition two, 1000, 2000)',
      ]);
      assertConsoleErrorDev([
        'Changing the name of a tracing marker after mount is not supported. ' +
          'To remount the tracing marker, pass it a new key.\n' +
          '    in App (at **)',
      ]);
      startTransition(
        () => root.render(<App markerName="three" markerKey="new key" />),
        {
          name: 'transition three',
        },
      );
      ReactNoop.expire(1000);
      await advanceTimers(1000);
      // 更换 key 会重挂载，因此不应警告，并应调用 onMarkerComplete。
      await waitForAll([
        'three',
        'onTransitionStart(transition three, 2000)',
        'onMarkerComplete(transition three, three, 2000, 3000)',
        'onTransitionComplete(transition three, 2000, 3000)',
      ]);
    });
  });

  /**
   * 场景：隐藏 Activity 的挂起不阻塞可见转换完成。
   * Given：Marker 同时包含可见 Suspense 和 mode 为 hidden 的 Activity 子树。
   * When：启动转换，先解析可见 Text，再解析 Hidden Text。
   * Then：可见分支完成即触发 Marker/transition complete；隐藏资源稍后仅提交内容，不再发追踪事件。
   * 验证机制：三段 assertLog 明确隐藏挂起出现但不进入完成条件，且后续 callback 为空。
   * 对应源码：packages/react-reconciler/src/ReactFiberCommitWork.js 的 commitTracingMarkerPassiveMountEffect()；ReactFiberTracingMarkerComponent.js。
   */
  // @gate enableTransitionTracing
  it('offscreen trees should not stop transition from completing', async () => {
    const transitionCallbacks = {

      /**
       * 验证隐藏 Activity 的挂起不会延迟可见转换完成。
       * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
       */
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },

      /**
       * 验证隐藏 Activity 的挂起不会延迟可见转换完成。
       * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
       */
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },

      /**
       * 验证隐藏 Activity 的挂起不会延迟可见转换完成。
       * 记录转换名称、Marker 名称及起止 Scheduler 毫秒时间；这只证明该 Marker 的完成事件，根转换是否完成由另一个回调验证。
       */
      onMarkerComplete: (transitioName, markerName, startTime, endTime) => {
        Scheduler.log(
          `onMarkerComplete(${transitioName}, ${markerName}, ${startTime}, ${endTime})`,
        );
      },
    };

    /** App 将可见 Suspense 与隐藏 Activity 并置，验证隐藏树的挂起不延迟可见转换完成。 */
    function App() {
      return (
        <React.unstable_TracingMarker name="marker">
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncText text="Text" />
          </Suspense>
          <Activity mode="hidden">
            <Suspense fallback={<Text text="Hidden Loading..." />}>
              <AsyncText text="Hidden Text" />
            </Suspense>
          </Activity>
        </React.unstable_TracingMarker>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });
    await act(() => {
      startTransition(() => root.render(<App />), {name: 'transition'});
      ReactNoop.expire(1000);
      advanceTimers(1000);
    });
    assertLog([
      'Suspend [Text]',
      'Loading...',
      // 预热阶段
      'Suspend [Text]',
      'onTransitionStart(transition, 0)',
      'Suspend [Hidden Text]',
      'Hidden Loading...',
    ]);

    await act(() => {
      resolveText('Text');
      ReactNoop.expire(1000);
      advanceTimers(1000);
    });
    assertLog([
      'Text',
      'onMarkerComplete(transition, marker, 0, 2000)',
      'onTransitionComplete(transition, 0, 2000)',
    ]);

    await act(() => {
      resolveText('Hidden Text');
      ReactNoop.expire(1000);
      advanceTimers(1000);
    });
    assertLog(['Hidden Text']);
  });

  /**
   * 场景：离散事件优先级不改变转换追踪语义。
   * Given：未解析的 Page Two 位于具名 Suspense，更新由 discreteUpdates 包裹。
   * When：在离散事件中启动转换，再在离散事件中解析资源。
   * Then：仍按 start、非空 progress、空 progress、complete 的标准生命周期结算。
   * 验证机制：两段 assertLog 精确核对离散更新前后的 pending 集合与时间。
   * 对应源码：packages/react-reconciler/src/ReactFiberWorkLoop.js 的 transition 调度；ReactFiberTracingMarkerComponent.js。
   */
  // @gate enableTransitionTracing
  it('discrete events', async () => {
    const transitionCallbacks = {

      /**
       * 核对离散事件入口下转换仍按挂起集合结算。
       * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
       */
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },

      /**
       * 核对离散事件入口下转换仍按挂起集合结算。
       * 把 pending 边界名称按传入顺序写入日志，无名称时显示 <null>。startTime 是转换起点，名为 endTime 的实参此时是进度快照时间，并非转换已经完成。
       */
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 核对离散事件入口下转换仍按挂起集合结算。
       * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
       */
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    /** App 固定渲染一个异步 Suspense，用离散更新入口验证优先级不改变追踪生命周期。 */
    function App() {
      return (
        <Suspense fallback={<Text text="Loading..." />} name="suspense page">
          <AsyncText text="Page Two" />
        </Suspense>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });

    await act(async () => {
      ReactNoop.discreteUpdates(() =>
        startTransition(() => root.render(<App />), {name: 'page transition'}),
      );
      ReactNoop.expire(1000);
      await advanceTimers(1000);
    });

    assertLog([
      'Suspend [Page Two]',
      'Loading...',
      // 预热阶段
      'Suspend [Page Two]',
      // 预热结束
      'onTransitionStart(page transition, 0)',
      'onTransitionProgress(page transition, 0, 1000, [suspense page])',
    ]);
    await act(async () => {
      ReactNoop.discreteUpdates(() => resolveText('Page Two'));
      ReactNoop.expire(1000);
      await advanceTimers(1000);
    });

    assertLog([
      'Page Two',
      'onTransitionProgress(page transition, 0, 2000, [])',
      'onTransitionComplete(page transition, 0, 2000)',
    ]);
  });

  /**
   * 场景：绘制前多次提交合并为最终进度快照。
   * Given：首次提交挂起两个边界，布局 Effect 在绘制前解析 Text 并触发第二次提交。
   * When：启动转换并让布局更新连续提交，再解析 Text Two。
   * Then：callbacks 刷出时只把仍挂起的 two 作为 pending；资源清空后转换完成。
   * 验证机制：首段 assertLog 同时包含多次提交日志但仅一组 start/progress，次段验证终态。
   * 对应源码：packages/react-reconciler/src/ReactFiberWorkLoop.js 的提交后 callback 处理；ReactFiberTracingMarkerComponent.js。
   */
  // @gate enableTransitionTracing
  it('multiple commits happen before a paint', async () => {
    const transitionCallbacks = {

      /**
       * 核对绘制前连续提交合并后的最终 pending 快照。
       * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
       */
      onTransitionStart: (name, startTime) => {
        Scheduler.log(`onTransitionStart(${name}, ${startTime})`);
      },

      /**
       * 核对绘制前连续提交合并后的最终 pending 快照。
       * 把 pending 边界名称按传入顺序写入日志，无名称时显示 <null>。startTime 是转换起点，名为 endTime 的实参此时是进度快照时间，并非转换已经完成。
       */
      onTransitionProgress: (name, startTime, endTime, pending) => {
        const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
        Scheduler.log(
          `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}])`,
        );
      },

      /**
       * 核对绘制前连续提交合并后的最终 pending 快照。
       * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
       */
      onTransitionComplete: (name, startTime, endTime) => {
        Scheduler.log(
          `onTransitionComplete(${name}, ${startTime}, ${endTime})`,
        );
      },
    };

    /** App 在布局阶段同步解析一个边界并触发重渲染，使绘制前多次提交合并为一次进度快照。 */
    function App() {
      const [, setRerender] = useState(false);
      React.useLayoutEffect(() => {
        resolveText('Text');
        setRerender(true);
      });
      return (
        <>
          <Suspense name="one" fallback={<Text text="Loading..." />}>
            <AsyncText text="Text" />
          </Suspense>
          <Suspense name="two" fallback={<Text text="Loading Two..." />}>
            <AsyncText text="Text Two" />
          </Suspense>
        </>
      );
    }

    const root = ReactNoop.createRoot({
      unstable_transitionCallbacks: transitionCallbacks,
    });

    await act(() => {
      startTransition(() => root.render(<App />), {name: 'transition'});
      ReactNoop.expire(1000);
      advanceTimers(1000);
    });

    assertLog([
      'Suspend [Text]',
      'Loading...',
      'Suspend [Text Two]',
      'Loading Two...',
      'Text',
      'Suspend [Text Two]',
      'Loading Two...',
      // 预热阶段
      'Suspend [Text Two]',
      // 预热结束
      'onTransitionStart(transition, 0)',
      'onTransitionProgress(transition, 0, 1000, [two])',
      // 预热阶段
      'Suspend [Text Two]',
    ]);

    await act(() => {
      resolveText('Text Two');
      ReactNoop.expire(1000);
      advanceTimers(1000);
    });
    assertLog([
      'Text Two',
      'onTransitionProgress(transition, 0, 2000, [])',
      'onTransitionComplete(transition, 0, 2000)',
    ]);
  });

  /**
   * 场景：多个根的转换回调与缓存状态互相隔离。
   * Given：两个 ReactNoop 根拥有带 root 标签的独立 callback 对象及各自缓存。
   * When：同一 act 中分别启动 transition one/two，再按根缓存顺序解析。
   * Then：两个根共享 Scheduler 模拟时钟，各自只报告所属 transition 和 pending；按缓存解析顺序分别在 2000、3000 完成。
   * 验证机制：日志中的 /root one/ 与 /root two/ 标签及分根解析顺序共同验证归属。
   * 对应源码：packages/react-reconciler/src/ReactFiberRoot.js 的 transitionCallbacks；ReactFiberTracingMarkerComponent.js。
   */
  // @gate enableTransitionTracing
  it('transition callbacks work for multiple roots', async () => {
    /** getTransitionCallbacks 捕获根标签并生成一组根专属 transition callbacks，使相同转换事件可按 root 归属独立断言。 */
    const getTransitionCallbacks = transitionName => {
      return {

        /**
         * 把闭包捕获的根标签附在事件后，核对两个根的缓存与回调归属。
         * 记录具名转换的名称与起始 Scheduler 毫秒时间；此回调只写日志，不触发页面更新。
         */
        onTransitionStart: (name, startTime) => {
          Scheduler.log(
            `onTransitionStart(${name}, ${startTime}) /${transitionName}/`,
          );
        },

        /**
         * 把闭包捕获的根标签附在事件后，核对两个根的缓存与回调归属。
         * 把 pending 边界名称按传入顺序写入日志，无名称时显示 <null>。startTime 是转换起点，名为 endTime 的实参此时是进度快照时间，并非转换已经完成。
         */
        onTransitionProgress: (name, startTime, endTime, pending) => {
          const suspenseNames = pending.map(p => p.name || '<null>').join(', ');
          Scheduler.log(
            `onTransitionProgress(${name}, ${startTime}, ${endTime}, [${suspenseNames}]) /${transitionName}/`,
          );
        },

        /**
         * 把闭包捕获的根标签附在事件后，核对两个根的缓存与回调归属。
         * 记录该转换等待集合清空后的名称、起始时间和完成快照时间（Scheduler 毫秒）；供断言区分各转换的终态。
         */
        onTransitionComplete: (name, startTime, endTime) => {
          Scheduler.log(
            `onTransitionComplete(${name}, ${startTime}, ${endTime}) /${transitionName}/`,
          );
        },
      };
    };

    /** App 以根名称构造独立 Suspense，供两个根验证缓存解析与 callback 归属互不串线。 */
    function App({name}) {
      return (
        <>
          <Suspense name={name} fallback={<Text text={`Loading ${name}...`} />}>
            <AsyncText text={`Text ${name}`} />
          </Suspense>
        </>
      );
    }

    const rootOne = ReactNoop.createRoot({
      unstable_transitionCallbacks: getTransitionCallbacks('root one'),
    });

    const rootTwo = ReactNoop.createRoot({
      unstable_transitionCallbacks: getTransitionCallbacks('root two'),
    });

    await act(() => {
      startTransition(() => rootOne.render(<App name="one" />), {
        name: 'transition one',
      });
      startTransition(() => rootTwo.render(<App name="two" />), {
        name: 'transition two',
      });
      ReactNoop.expire(1000);
      advanceTimers(1000);
    });

    assertLog([
      'Suspend [Text one]',
      'Loading one...',
      'Suspend [Text two]',
      'Loading two...',
      // 预热阶段
      'Suspend [Text one]',
      'Suspend [Text two]',
      // 预热结束
      'onTransitionStart(transition one, 0) /root one/',
      'onTransitionProgress(transition one, 0, 1000, [one]) /root one/',
      'onTransitionStart(transition two, 0) /root two/',
      'onTransitionProgress(transition two, 0, 1000, [two]) /root two/',
    ]);

    await act(() => {
      caches[0].resolve('Text one');
      ReactNoop.expire(1000);
      advanceTimers(1000);
    });

    assertLog([
      'Text one',
      'onTransitionProgress(transition one, 0, 2000, []) /root one/',
      'onTransitionComplete(transition one, 0, 2000) /root one/',
    ]);

    await act(() => {
      resolveText('Text two');
      ReactNoop.expire(1000);
      advanceTimers(1000);
    });

    assertLog([
      'Text two',
      'onTransitionProgress(transition two, 0, 3000, []) /root two/',
      'onTransitionComplete(transition two, 0, 3000) /root two/',
    ]);
  });
});
