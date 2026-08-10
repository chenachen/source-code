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

/** `createTextCache`：封装当前用例复用的操作、回调或断言步骤。 */
function createTextCache() {
  if (seededCache !== null) {
    // 种子一个尚未存在的缓存的技巧。 TODO：需要一个内置的 API 来在初始渲染之前填充数据 (i.e。) 这
    // 不是刷新，因为还没有挂载任何内容。
    const cache = seededCache;
    seededCache = null;
    return cache;
  }

  const data = new Map();
  const version = caches.length + 1;
  const cache = {
    version,
    data,
    /** `createTextCache.resolve`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
    /** `createTextCache.reject`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

/** `readText`：封装当前用例复用的操作、回调或断言步骤。 */
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
    textCache.data.set(text, newRecord);

    throw thenable;
  }
}

/** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
function Text({text}) {
  Scheduler.log(text);
  return <span prop={text} />;
}

/** `AsyncText`：封装当前用例复用的操作、回调或断言步骤。 */
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

/** `resolveMostRecentTextCache`：封装当前用例复用的操作、回调或断言步骤。 */
function resolveMostRecentTextCache(text) {
  if (caches.length === 0) {
    throw Error('Cache does not exist.');
  } else {
    // 解析最近创建的缓存；旧缓存可通过 `caches[index].resolve(text)` 解析。
    caches[caches.length - 1].resolve(text);
  }
}

/** `resolveText`：保存当前测试场景复用的夹具、状态或回调。 */
const resolveText = resolveMostRecentTextCache;

// @gate enableLegacyCache
// @gate enableSuspenseList
/**
 * 代表场景（Given–When–Then）：
 * Given 当前文件已建立所需 DOM、React 根与测试夹具；
 * When 执行「regression (#20932): return pointer is correct before entering deleted tree」描述的渲染或交互；
 * Then 通过本用例的 DOM、日志或调度断言确认行为。
 *
 * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
 */
test('regression (#20932): return pointer is correct before entering deleted tree', async () => {
  // 基于生产中的一个bug。 设计用于触发特定的实现路径。
  /** `Tail`：封装当前用例复用的操作、回调或断言步骤。 */
  function Tail() {
    return (
      <Suspense fallback={<Text text="Loading Tail..." />}>
        <Text text="Tail" />
      </Suspense>
    );
  }

  /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
  /** `Async`：封装当前用例复用的操作、回调或断言步骤。 */
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
