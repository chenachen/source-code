/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

'use strict';

let React;
let ReactNoopFlightServer;
let ReactNoopFlightClient;
let cache;
let cacheSignal;

/** 覆盖 React Server cache 的参数身份 trie、异常缓存、包装器反射与 cacheSignal 生命周期。 */
describe('ReactCache', () => {
  /** 加载 react-server 条件导出及 Flight 两端，保存 cache API 后恢复客户端 React 模块环境。 */
  beforeEach(() => {
    jest.resetModules();
    jest.mock('react', () => require('react/react.react-server'));
    React = require('react');

    ReactNoopFlightServer = require('react-noop-renderer/flight-server');
    ReactNoopFlightClient = require('react-noop-renderer/flight-client');

    cache = React.cache;
    cacheSignal = React.cacheSignal;

    jest.resetModules();
    __unmockReact();
  });

  /** Given–When–Then：Given cache wrapper 接收字符串、null、对象、同/异对象、Symbol 与 NaN 的多参数组合；When经多次 Flight server render 调用；Then相同参数序列复用结果，顺序、参数个数或对象身份变化产生不同结果。通过 Same/Flipped/Fewer/More 输出验证参数 trie 的 Object.is/WeakMap 分支。 */
  it('cache objects and primitive arguments and a mix of them', async () => {
    /** 按 a/b 参数序列缓存其类型描述；返回对象身份用于检测命中与分叉。 */
    const types = cache((a, b) => ({a: typeof a, b: typeof b}));
    /** 输出两参数类型，确认不同值种类能进入 cache 并返回正确结果。 */
    function Print({a, b}) {
      return types(a, b).a + ' ' + types(a, b).b + ' ';
    }
    /** 同一 render 内以完全相同参数调用两次，检查结果对象引用复用。 */
    function Same({a, b}) {
      const x = types(a, b);
      const y = types(a, b);
      return (x === y).toString() + ' ';
    }
    /** 交换参数顺序，验证 cache key trie 对位置敏感。 */
    function FlippedOrder({a, b}) {
      return (types(a, b) === types(b, a)).toString() + ' ';
    }
    /** 比较双参数与单参数调用，验证缺少尾参数会形成不同 key 路径。 */
    function FewerArgs({a, b}) {
      return (types(a, b) === types(a)).toString() + ' ';
    }
    /** 比较单参数与双参数调用，验证新增尾参数不会误命中前缀节点。 */
    function MoreArgs({a, b}) {
      return (types(a) === types(a, b)).toString() + ' ';
    }

    expect(
      (
        await ReactNoopFlightClient.read(
          ReactNoopFlightServer.render(
            <>
              <Print a="e" b="f" />
              <Same a="a" b="b" />
              <FlippedOrder a="c" b="d" />
              <FewerArgs a="e" b="f" />
              <MoreArgs a="g" b="h" />
            </>,
          ),
        )
      ).join(''),
    ).toEqual('string string true false false false ');

    expect(
      (
        await ReactNoopFlightClient.read(
          ReactNoopFlightServer.render(
            <>
              <Print a="e" b={null} />
              <Same a="a" b={null} />
              <FlippedOrder a="c" b={null} />
              <FewerArgs a="e" b={null} />
              <MoreArgs a="g" b={null} />
            </>,
          ),
        )
      ).join(''),
    ).toEqual('string object true false false false ');

    const obj = {};
    expect(
      (
        await ReactNoopFlightClient.read(
          ReactNoopFlightServer.render(
            <>
              <Print a="e" b={obj} />
              <Same a="a" b={obj} />
              <FlippedOrder a="c" b={obj} />
              <FewerArgs a="e" b={obj} />
              <MoreArgs a="g" b={obj} />
            </>,
          ),
        )
      ).join(''),
    ).toEqual('string object true false false false ');

    const sameObj = {};
    expect(
      (
        await ReactNoopFlightClient.read(
          ReactNoopFlightServer.render(
            <>
              <Print a={sameObj} b={sameObj} />
              <Same a={sameObj} b={sameObj} />
              <FlippedOrder a={sameObj} b={sameObj} />
              <FewerArgs a={sameObj} b={sameObj} />
              <MoreArgs a={sameObj} b={sameObj} />
            </>,
          ),
        )
      ).join(''),
    ).toEqual('object object true true false false ');

    const objA = {};
    const objB = {};
    expect(
      (
        await ReactNoopFlightClient.read(
          ReactNoopFlightServer.render(
            <>
              <Print a={objA} b={objB} />
              <Same a={objA} b={objB} />
              <FlippedOrder a={objA} b={objB} />
              <FewerArgs a={objA} b={objB} />
              <MoreArgs a={objA} b={objB} />
            </>,
          ),
        )
      ).join(''),
    ).toEqual('object object true false false false ');

    const sameSymbol = Symbol();
    expect(
      (
        await ReactNoopFlightClient.read(
          ReactNoopFlightServer.render(
            <>
              <Print a={sameSymbol} b={sameSymbol} />
              <Same a={sameSymbol} b={sameSymbol} />
              <FlippedOrder a={sameSymbol} b={sameSymbol} />
              <FewerArgs a={sameSymbol} b={sameSymbol} />
              <MoreArgs a={sameSymbol} b={sameSymbol} />
            </>,
          ),
        )
      ).join(''),
    ).toEqual('symbol symbol true true false false ');

    const notANumber = +'nan';
    expect(
      (
        await ReactNoopFlightClient.read(
          ReactNoopFlightServer.render(
            <>
              <Print a={1} b={notANumber} />
              <Same a={1} b={notANumber} />
              <FlippedOrder a={1} b={notANumber} />
              <FewerArgs a={1} b={notANumber} />
              <MoreArgs a={1} b={notANumber} />
            </>,
          ),
        )
      ).join(''),
    ).toEqual('number number true false false false ');
  });

  /** Given–When–Then：Given被 cache 包装的函数按参数抛出 Error；When参数 1 调用两次、参数 2 调用一次；Then前两次捕获同一 Error 对象，参数 2 得到不同对象。通过引用相等验证异常结果也被 memoize。 */
  it('cached functions that throw should cache the error', async () => {
    const throws = cache(v => {
      throw new Error(v);
    });
    let x;
    let y;
    let z;
    /** 在 render 中捕获三次 throws 结果，保留 Error 引用供参数级缓存比较。 */
    function Test() {
      try {
        throws(1);
      } catch (e) {
        x = e;
      }
      try {
        throws(1);
      } catch (e) {
        y = e;
      }
      try {
        throws(2);
      } catch (e) {
        z = e;
      }

      return 'Blank';
    }

    ReactNoopFlightServer.render(<Test />);
    expect(x).toBe(y);
    expect(z).not.toBe(x);
  });

  /** Given–When–Then：Given带三参数和 displayName 的 foo；When分别在 server 或 variant client 上调用 cache；Then wrapper 不是原函数，length 为 0 且不继承 displayName。通过反射属性验证两端包装器外观一致。 */
  it('introspection of returned wrapper function is same on client and server', async () => {
    // variant 开启时改测客户端 `cache`，其余构建使用 react-server 版本。
    if (gate(flags => flags.variant)) {
      jest.resetModules();
      jest.mock('react', () => jest.requireActual('react'));
      const ClientReact = require('react');
      cache = ClientReact.cache;
    }

    /** 原始三参数函数；其 length/displayName 用于检查 cache wrapper 的公开反射形状。 */
    function foo(a, b, c) {
      return a + b + c;
    }
    foo.displayName = 'Custom display name';

    const cachedFoo = cache(foo);
    expect(cachedFoo).not.toBe(foo);
    expect(cachedFoo.length).toBe(0);
    expect(cachedFoo.displayName).toBe(undefined);
  });

  /** Given–When–Then：Given当前不在 React Server render/cache 生命周期；When直接调用 cacheSignal；Then返回 null。通过同步返回值验证上下文缺省边界。 */
  it('cacheSignal() returns null outside a render', async () => {
    expect(cacheSignal()).toBe(null);
  });

  /** Given–When–Then：Given异步 Server Component 捕获 cacheSignal 并等待 promise；When promise 解决、Flight 渲染和客户端读取成功完成；Then signal 从未中止变为中止，reason 表示成功完成，且无 onError。通过信号状态与 Flight 结果验证 cache 生命周期清理。 */
  it('cacheSignal() aborts when the render finishes normally', async () => {
    let renderedCacheSignal = null;

    let resolve;
    const promise = new Promise(r => (resolve = r));

    /** 捕获当前 cacheSignal，等待外部 promise 后正常返回 Hi。 */
    async function Test() {
      renderedCacheSignal = cacheSignal();
      await promise;
      return 'Hi';
    }

    const controller = new AbortController();
    const errors = [];
    const result = ReactNoopFlightServer.render(<Test />, {
      signal: controller.signal,
      /** 收集非预期服务端错误；正常完成路径应从不调用。 */
      onError(x) {
        errors.push(x);
      },
    });
    expect(errors).toEqual([]);
    expect(renderedCacheSignal).not.toBe(controller.signal); // 当前内部 cacheSignal 与外部 controller.signal 不同；未来可能统一。
    expect(renderedCacheSignal.aborted).toBe(false);
    await resolve();
    await 0;
    await 0;

    expect(await ReactNoopFlightClient.read(result)).toBe('Hi');

    expect(errors).toEqual([]);
    expect(renderedCacheSignal.aborted).toBe(true);
    expect(renderedCacheSignal.reason.message).toContain(
      'This render completed successfully.',
    );
  });

  /** Given–When–Then：Given异步 Server Component 永久等待并捕获 cacheSignal；When外部 controller 以 Timed out 中止 Flight；Then内部 signal 同步携带同一 reason，onError 记录错误，客户端得到 digest。通过错误身份、signal 与 Flight 错误验证取消传播。 */
  it('cacheSignal() aborts when the render is aborted', async () => {
    let renderedCacheSignal = null;

    const promise = new Promise(() => {});

    /** 捕获当前 cacheSignal 后永久等待，使渲染只能由外部 abort 结束。 */
    async function Test() {
      renderedCacheSignal = cacheSignal();
      await promise;
      return 'Hi';
    }

    const controller = new AbortController();
    const errors = [];
    const result = ReactNoopFlightServer.render(<Test />, {
      signal: controller.signal,
      /** 收集中止原因并返回固定 digest，供 Flight 客户端错误验证。 */
      onError(x) {
        errors.push(x);
        return 'hi';
      },
    });
    expect(errors).toEqual([]);
    expect(renderedCacheSignal).not.toBe(controller.signal); // 当前内部 cacheSignal 与外部 controller.signal 不同；未来可能统一。
    expect(renderedCacheSignal.aborted).toBe(false);
    const reason = new Error('Timed out');
    controller.abort(reason);
    expect(errors).toEqual([reason]);
    expect(renderedCacheSignal.aborted).toBe(true);
    expect(renderedCacheSignal.reason).toBe(reason);

    let clientError = null;
    try {
      await ReactNoopFlightClient.read(result);
    } catch (x) {
      clientError = x;
    }
    expect(clientError).not.toBe(null);
    if (__DEV__) {
      expect(clientError.message).toBe('Timed out');
    }
    expect(clientError.digest).toBe('hi');
  });
});
