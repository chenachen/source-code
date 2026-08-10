let React;
let ReactNoop;
let Scheduler;
let act;
let Suspense;
let useEffect;
let getCacheForType;

let caches;
let seededCache;
let assertLog;

/** 回归验证 legacy Suspense 从不完整挂起 Fiber 重试时，不会误判新出现的 PassiveStatic 子树标记。 */
describe('ReactSuspenseWithNoopRenderer', () => {
  /** 重置模块、cache 列表与 seed，并绑定 legacy 根、Suspense 和 effect 日志工具。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    Suspense = React.Suspense;
    useEffect = React.useEffect;

    getCacheForType = React.unstable_getCacheForType;

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;

    caches = [];
    seededCache = null;
  });

  /** 创建带版本号的文本资源 cache；支持预置 cache，并以 pending/resolved/rejected 状态驱动重试。 */
  function createTextCache() {
    if (seededCache !== null) {
      // 在正式创建 cache 前注入预置记录。
      // TODO: 仍需要内建 API 在首次 render 前预置数据；
      // 此时尚无挂载内容，不能借助 refresh。
      const cache = seededCache;
      seededCache = null;
      return cache;
    }

    const data = new Map();
    const version = caches.length + 1;
    const cache = {
      version,
      data,
      /** 将缺失或 pending 文本转为 resolved，并唤醒该 thenable 的全部 ping。 */
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
      /** 将缺失或 pending 文本转为 rejected，并唤醒等待者使错误在重试中抛出。 */
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

  /** 从当前 React cache 读取文本：pending/rejected 抛出，resolved 返回 cache 版本，缺失时创建可订阅 thenable。 */
  function readText(text) {
    const textCache = getCacheForType(createTextCache);
    const record = textCache.data.get(text);
    if (record !== undefined) {
      // 状态机边界：pending/rejected 必须抛出，只有 resolved 能返回当前 cache 版本。
      switch (record.status) {
        case 'pending':
          Scheduler.log(`Suspend! [${text}]`);
          throw record.value;
        case 'rejected':
          Scheduler.log(`Error! [${text}]`);
          throw record.value;
        case 'resolved':
          return textCache.version;
      }
    } else {
      Scheduler.log(`Suspend! [${text}]`);

      const thenable = {
        pings: [],
        /** pending 时登记 ping；若状态已结束，则排入微任务异步通知以满足 thenable 合约。 */
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

  /** 解决最新 cache 中的文本；无 cache 时明确报错，防止测试静默命中错误资源代。 */
  function resolveMostRecentTextCache(text) {
    if (caches.length === 0) {
      throw Error('Cache does not exist.');
    } else {
      // 默认解决最新创建的 cache；旧 cache 可通过
      // `caches[index].resolve(text)` 单独解决。
      caches[caches.length - 1].resolve(text);
    }
  }

  /** 测试使用的语义化别名，始终指向最新 cache 的解决入口。 */
  const resolveText = resolveMostRecentTextCache;

  /** Given legacy Suspense 首次在 Child 到达 useEffect 前挂起；When文本解决后重试并首次添加 PassiveStatic；Then不会发出 subtreeFlags 静态标记误报，且 Async/Effect 正常提交。通过日志与宿主输出验证 bailout 静态标记校验的 legacy 例外。 */
  // @gate enableLegacyCache && !disableLegacyMode
  it('regression: false positive for legacy suspense', async () => {
    /** 先读取可挂起文本，再注册 passive effect；故首轮与重试轮的静态 effect 标记刻意不同。 */
    const Child = ({text}) => {
      // text 未解决时，readText 会抛出并提前退出，
      // 因而下方 useEffect 尚未添加 PassiveStatic 标记。
      readText(text);

      useEffect(() => {
        Scheduler.log('Effect');
      }, []);

      Scheduler.log(text);
      return text;
    };

    /** 用 legacy Suspense 包裹 Child，并提供 Loading 回退以提交不完整主树。 */
    function App() {
      return (
        <Suspense fallback="Loading...">
          <Child text="Async" />
        </Suspense>
      );
    }

    const root = ReactNoop.createLegacyRoot(null);

    // 初次 legacy 挂载时，被挂起组件以不完整状态提交，
    // 尚无 passive static effect 标记。
    await act(() => {
      root.render(<App />);
    });
    assertLog(['Suspend! [Async]']);
    expect(root).toMatchRenderedOutput('Loading...');

    // promise 解决后的重试才添加 passive static effect 标记。
    // 历史缺陷会因上一 Fiber 没有该标记而误报
    // “缺少预期静态标记”。
    await act(() => {
      resolveText('Async');
    });
    assertLog(['Async', 'Effect']);
    expect(root).toMatchRenderedOutput('Async');
  });
});
