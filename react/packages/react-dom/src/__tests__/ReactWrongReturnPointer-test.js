/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

let React;
let ReactNoop;
let Scheduler;
let act;
let Suspense;
let SuspenseList;
let getCacheForType;
let caches;
let seededCache;
let assertLog;

beforeEach(() => {
  React = require('react');
  ReactNoop = require('react-noop-renderer');
  Scheduler = require('scheduler');
  act = require('internal-test-utils').act;

  const InternalTestUtils = require('internal-test-utils');
  assertLog = InternalTestUtils.assertLog;

  Suspense = React.Suspense;
  if (gate(flags => flags.enableSuspenseList)) {
    SuspenseList = React.unstable_SuspenseList;
  }

  getCacheForType = React.unstable_getCacheForType;

  caches = [];
  seededCache = null;
});

/** 为 React cache 作用域创建带版本号和状态 Map 的文本缓存；seededCache 若存在则只消费一次，后续新缓存写入 caches 供手动解析。 */
function createTextCache() {
  if (seededCache !== null) {
    // 预填下一份尚未挂载的缓存，并在创建时消费一次；它不是对已有树的 cache refresh。
    // TODO：为初次渲染前的数据预填提供内置 API。
    const cache = seededCache;
    seededCache = null;
    return cache;
  }

  const data = new Map();
  const version = caches.length + 1;
  const cache = {
    version,
    data,
    /** 把缺失文本直接记为 resolved，或完成 pending 记录后通知全部 ping；先改状态再通知，使重试读到已完成值。 */
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
    /** 把缺失文本记为 rejected，或拒绝 pending 记录后通知 ping；后续读取抛同一个 Error。 */
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

/** 从当前 React cache 读取记录，resolved 返回缓存版本，pending/rejected 分别抛 thenable/Error；缺失时建立稳定 thenable 并挂起，日志暴露每次重试。 */
function readText(text) {
  const textCache = getCacheForType(createTextCache);
  const record = textCache.data.get(text);
  if (record !== undefined) {
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
      /** 记录 pending 的唤醒回调；若记录已完成则在 Promise 微任务通知，覆盖订阅前完成的时序。 */
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

/** 记录同步文本并输出带 prop 的 Noop span，作为 SuspenseList 内容与 fallback 的调度探针。 */
function Text({text}) {
  Scheduler.log(text);
  return <span prop={text} />;
}

/** 先读取可能挂起的文本，再按 showVersion 选择是否把 cache 版本写进输出与日志。 */
function AsyncText({text, showVersion}) {
  const version = readText(text);
  const fullText = showVersion ? `${text} [v${version}]` : text;
  Scheduler.log(fullText);
  return <span prop={fullText} />;
}

// function seedNextTextCache(text) {
//   if (seededCache === null) {
//     seededCache = createTextCache();
//   }
//   seededCache.resolve(text);
// }

/** 只解析 caches 中最新一份缓存；没有已创建缓存则抛错，避免误把未启动渲染当可完成的请求。 */
function resolveMostRecentTextCache(text) {
  if (caches.length === 0) {
    throw Error('Cache does not exist.');
  } else {
    // 解析最近创建的缓存；旧缓存可通过 `caches[index].resolve(text)` 解析。
    caches[caches.length - 1].resolve(text);
  }
}

/** 测试的文本解析别名，固定转给最近创建的 React cache 实例。 */
const resolveText = resolveMostRecentTextCache;

// @gate enableLegacyCache
// @gate enableSuspenseList
/** Noop 根挂载 forwards/visible SuspenseList，首行异步文本 0 挂起使后行先显示 fallback；解析 0 后出现 0/Tail，再把同一组件状态改为 1 重新挂起。各轮调度日志应匹配预热与 fallback 顺序且不崩溃，回归删除/复用隐藏尾部树之前 return 指针必须正确的路径。 */
test('regression (#20932): return pointer is correct before entering deleted tree', async () => {
  // 基于生产中的一个bug。 设计用于触发特定的实现路径。
  /** 同步内容 Tail 外包一层 Suspense，让 SuspenseList 尾部隐藏/揭示路径拥有独立 fallback。 */
  function Tail() {
    return (
      <Suspense fallback={<Text text="Loading Tail..." />}>
        <Text text="Tail" />
      </Suspense>
    );
  }

  /** 按 forwards/visible 顺序组合异步首行与 Tail，重现尾部树被隐藏复用时的 return 指针路径。 */
  function App() {
    return (
      <SuspenseList revealOrder="forwards" tail="visible">
        <Suspense fallback={<Text text="Loading Async..." />}>
          <Async />
        </Suspense>
        <Tail />
      </SuspenseList>
    );
  }

  let setAsyncText;
  /** 保存 useState 更新器到外部变量，以同一组件从文本 0 更新到 1 触发第二次悬挂。 */
  function Async() {
    const [c, _setAsyncText] = React.useState(0);
    setAsyncText = _setAsyncText;
    return <AsyncText text={c} />;
  }

  const root = ReactNoop.createRoot();
  await act(() => {
    root.render(<App />);
  });
  assertLog([
    'Suspend! [0]',
    'Loading Async...',
    'Loading Tail...',
    // 预热阶段
    'Suspend! [0]',
  ]);
  await act(() => {
    resolveText(0);
  });
  assertLog([0, 'Tail']);
  await act(() => {
    setAsyncText(x => x + 1);
  });
  assertLog([
    'Suspend! [1]',
    'Loading Async...',
    'Suspend! [1]',
    'Loading Async...',
    // 预热阶段
    'Suspend! [1]',
  ]);
});
