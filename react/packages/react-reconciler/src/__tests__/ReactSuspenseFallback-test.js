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
let Suspense;
let getCacheForType;
let caches;
let seededCache;
let waitForAll;

/** 验证显式、null、undefined 与嵌套 Suspense fallback 的捕获和预热语义。 */
describe('ReactSuspenseFallback', () => {
  /** 重置模块、cache 代次和 seed，并绑定 Suspense 与全量调度日志。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    Suspense = React.Suspense;
    getCacheForType = React.unstable_getCacheForType;
    caches = [];
    seededCache = null;

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
  });

  /** 创建版本化文本 cache；支持 seed，并以 pending/resolved/rejected 状态唤醒 Suspense 重试。 */
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
      /** 将文本置为 resolved；若已有 pending thenable，则更新记录并广播全部 ping。 */
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
      /** 将文本置为 rejected；若已有等待者，则广播 ping 让错误在重试中抛出。 */
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

  /** 从当前 React cache 读取文本；未就绪/失败时抛出，缺失时创建可订阅 thenable。 */
  function readText(text) {
    const textCache = getCacheForType(createTextCache);
    const record = textCache.data.get(text);
    if (record !== undefined) {
      // 状态机边界：pending/rejected 通过抛出交给 Suspense/错误路径，resolved 才返回版本。
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
        /** pending 时登记 ping，后续 resolve/reject 会同步广播；已落定后的新订阅则在微任务通知。 */
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

  /** 记录并渲染同步 span，作为可见 fallback 的输出探针。 */
  function Text({text}) {
    Scheduler.log(text);
    return <span prop={text} />;
  }

  /** 读取可能挂起的文本，并可把 cache 版本编码进宿主 prop 以区分资源代次。 */
  function AsyncText({text, showVersion}) {
    const version = readText(text);
    const fullText = showVersion ? `${text} [v${version}]` : text;
    Scheduler.log(fullText);
    return <span prop={fullText} />;
  }

  /** Given–When–Then：Given A 未解决且边界提供 Loading 元素；When主树挂起并执行预热；Then提交 Loading span。通过挂起/回退/预热日志验证最近 Suspense 的显式 fallback。 */
  // @gate enableLegacyCache
  it('suspends and shows fallback', async () => {
    ReactNoop.render(
      <Suspense fallback={<Text text="Loading..." />}>
        <AsyncText text="A" />
      </Suspense>,
    );

    await waitForAll([
      'Suspend! [A]',
      'Loading...',
      // 预热被挂起的主树。
      'Suspend! [A]',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);
  });

  /** Given–When–Then：Given A 未解决且 fallback 显式为 null；When主树挂起并预热；Then边界提交空输出。通过日志与 null 宿主树验证 null 是有效回退值。 */
  // @gate enableLegacyCache
  it('suspends and shows null fallback', async () => {
    ReactNoop.render(
      <Suspense fallback={null}>
        <AsyncText text="A" />
      </Suspense>,
    );

    await waitForAll([
      'Suspend! [A]',
      // 回退输出为 null。
      // 预热被挂起的主树。
      'Suspend! [A]',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(null);
  });

  /** Given–When–Then：Given A 未解决且 Suspense 未提供 fallback；When主树挂起；Then undefined fallback 规范化为空输出。通过宿主 null 验证缺省回退语义。 */
  // @gate enableLegacyCache
  it('suspends and shows undefined fallback', async () => {
    ReactNoop.render(
      <Suspense>
        <AsyncText text="A" />
      </Suspense>,
    );

    await waitForAll([
      'Suspend! [A]',
      // 回退输出为 null。
      // 预热被挂起的主树。
      'Suspend! [A]',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(null);
  });

  /** Given–When–Then：Given嵌套边界中 A 在内层挂起，内层提供 Loading、外层提供 Should not show；When冒泡选择捕获边界；Then最近的内层 fallback 提交，外层不显示。通过日志和宿主输出验证 capture 边界选择。 */
  // @gate enableLegacyCache
  it('suspends and shows inner fallback', async () => {
    ReactNoop.render(
      <Suspense fallback={<Text text="Should not show..." />}>
        <Suspense fallback={<Text text="Loading..." />}>
          <AsyncText text="A" />
        </Suspense>
      </Suspense>,
    );

    await waitForAll([
      'Suspend! [A]',
      'Loading...',
      // 预热被挂起的主树。
      'Suspend! [A]',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);
  });

  /** Given–When–Then：Given内层 Suspense 未提供 fallback、外层有可见回退；When A 在内层挂起；Then内层仍以空回退捕获，不冒泡到外层。通过未出现 Should not show 验证 undefined fallback 仍建立边界。 */
  // @gate enableLegacyCache
  it('suspends and shows inner undefined fallback', async () => {
    ReactNoop.render(
      <Suspense fallback={<Text text="Should not show..." />}>
        <Suspense>
          <AsyncText text="A" />
        </Suspense>
      </Suspense>,
    );

    await waitForAll([
      'Suspend! [A]',
      // 回退输出为 null。
      // 预热被挂起的主树。
      'Suspend! [A]',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(null);
  });

  /** Given–When–Then：Given内层 fallback 显式 null、外层有可见回退；When A 挂起；Then内层提交空输出并阻止外层回退。通过 null 宿主树验证显式空 fallback 的捕获语义。 */
  // @gate enableLegacyCache
  it('suspends and shows inner null fallback', async () => {
    ReactNoop.render(
      <Suspense fallback={<Text text="Should not show..." />}>
        <Suspense fallback={null}>
          <AsyncText text="A" />
        </Suspense>
      </Suspense>,
    );

    await waitForAll([
      'Suspend! [A]',
      // 回退输出为 null。
      // 预热被挂起的主树。
      'Suspend! [A]',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(null);
  });
});
