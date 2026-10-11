/**
 * Copyright (c) Meta Platforms, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import ReactSharedInternals from 'shared/ReactSharedInternals';

/** 尚未计算，节点可转移到成功或异常终态。 */
const UNTERMINATED = 0;
/** 已成功计算，`v` 保存可复用结果。 */
const TERMINATED = 1;
/** 首次计算抛错，`v` 保存需重复抛出的同一异常。 */
const ERRORED = 2;

/** 参数路径已建立、但目标函数尚未完成计算的缓存节点。 */
type UnterminatedCacheNode<T> = {
  /** 状态判别值：未开始或尚未结束。 */
  s: 0,
  /** 未完成节点没有可读结果。 */
  v: void,
  /** 后续对象/函数参数使用的弱引用分支。 */
  o: null | WeakMap<Function | Object, CacheNode<T>>,
  /** 后续原始值参数使用的强引用分支。 */
  p: null | Map<string | number | null | void | symbol | boolean, CacheNode<T>>,
};

/** 计算成功后的缓存终态；同一参数路径直接返回 `v`。 */
type TerminatedCacheNode<T> = {
  /** 状态判别值：成功终态。 */
  s: 1,
  /** 首次成功调用得到的结果。 */
  v: T,
  /** 共享前缀下对象/函数参数的后续分支。 */
  o: null | WeakMap<Function | Object, CacheNode<T>>,
  /** 共享前缀下原始值参数的后续分支。 */
  p: null | Map<string | number | null | void | symbol | boolean, CacheNode<T>>,
};

/** 首次计算失败后的缓存终态；同一参数路径重复抛出 `v`。 */
type ErroredCacheNode<T> = {
  /** 状态判别值：异常终态。 */
  s: 2,
  /** 首次调用捕获的异常值。 */
  v: mixed,
  /** 共享前缀下对象/函数参数的后续分支。 */
  o: null | WeakMap<Function | Object, CacheNode<T>>,
  /** 共享前缀下原始值参数的后续分支。 */
  p: null | Map<string | number | null | void | symbol | boolean, CacheNode<T>>,
};

/**
 * 缓存 trie 节点的状态联合；普通非重入调用从未完成写入成功或异常终态。
 * 同步计算期间仍保持 0，没有独立 computing 标记；同参数重入可能再次计算并覆盖结果。
 */
type CacheNode<T> =
  | TerminatedCacheNode<T>
  | UnterminatedCacheNode<T>
  | ErroredCacheNode<T>;

/** 为一个 dispatcher 缓存域创建按被包装函数索引的弱引用根。 */
function createCacheRoot<T>(): WeakMap<Function | Object, CacheNode<T>> {
  return new WeakMap();
}

/** 创建可继续挂接参数分支的未完成节点。 */
function createCacheNode<T>(): CacheNode<T> {
  return {
    s: UNTERMINATED, // 状态：判定缓存计算尚未完成、已返回或已抛错。
    v: undefined, // 值：依状态保存成功结果或异常。
    o: null, // 对象缓存：用 WeakMap 保存非原始参数，避免缓存阻止回收。
    p: null, // 原始值缓存：用普通 Map 保存可稳定比较的参数。
  };
}

/**
 * 在当前异步 dispatcher 提供的缓存域中，按原函数与完整参数序列记忆结果。
 *
 * @remarks 参数序列形成 trie：对象/函数进入 WeakMap，原始值进入 Map。叶节点会缓存
 * 返回值或同步抛出的异常；返回 Promise 时缓存的是 Promise 本身，不等待它落定。
 * 缓存域的寿命由 renderer 决定：Server Components 按请求隔离，客户端实现可绑定缓存边界。
 * 无 dispatcher 时直接执行原函数。多个包装器包装同一个 `fn` 时，共用该域内的参数 trie。
 * @param fn - 结果要在 renderer 缓存域内复用的原函数；函数引用本身也是根层弱键。
 * @returns 新包装函数，转发原参数序列但以 null 调用 fn，不继承调用点 this。
 * @remarks 参数数量也是路径的一部分，零参数与一个 undefined 不同；原始键采用 Map
 * 的 SameValueZero，NaN 可命中自身，+0/-0 合并；对象键只按引用命中，不做内容比较。
 * 原始值分支与结果强引用直到缓存域释放；WeakMap 只保证对象键本身不被该键表保活。
 * try/catch 仅覆盖 fn 的实际调用；dispatcher/参数 trie 操作失败不成为该叶的缓存异常。
 * 尚未结束的同步计算没有去重锁，同参数重入会再调用 fn；正常结束才写入终态。
 */
export function cache<A: Iterable<mixed>, T>(fn: (...A) => T): (...A) => T {
  return function () {
    const dispatcher = ReactSharedInternals.A;
    if (!dispatcher) {
      // 当前没有 renderer 提供缓存域，不建立全局缓存，直接计算。
      // $FlowFixMe[incompatible-type]: We don't want to use rest arguments since we transpile the code.
      return fn.apply(null, arguments);
    }
    const fnMap: WeakMap<any, CacheNode<T>> = dispatcher.getCacheForType(
      createCacheRoot,
    );
    const fnNode = fnMap.get(fn);
    let cacheNode: CacheNode<T>;
    if (fnNode === undefined) {
      cacheNode = createCacheNode();
      fnMap.set(fn, cacheNode);
    } else {
      cacheNode = fnNode;
    }
    for (let i = 0, l = arguments.length; i < l; i++) {
      const arg = arguments[i];
      if (
        typeof arg === 'function' ||
        // $FlowFixMe[invalid-compare]
        (typeof arg === 'object' && arg !== null)
      ) {
        // 对象进入 WeakMap，使缓存键不延长对象生命周期。
        let objectCache = cacheNode.o;
        if (objectCache === null) {
          cacheNode.o = objectCache = new WeakMap();
        }
        const objectNode = objectCache.get(arg);
        if (objectNode === undefined) {
          cacheNode = createCacheNode();
          objectCache.set(arg, cacheNode);
        } else {
          cacheNode = objectNode;
        }
      } else {
        // 本实现把其余参数放入 Map，按 Map 的键比较规则复用参数路径。
        let primitiveCache = cacheNode.p;
        if (primitiveCache === null) {
          cacheNode.p = primitiveCache = new Map();
        }
        const primitiveNode = primitiveCache.get(arg);
        if (primitiveNode === undefined) {
          cacheNode = createCacheNode();
          primitiveCache.set(arg, cacheNode);
        } else {
          cacheNode = primitiveNode;
        }
      }
    }
    if (cacheNode.s === TERMINATED) {
      return cacheNode.v;
    }
    if (cacheNode.s === ERRORED) {
      throw cacheNode.v;
    }
    try {
      // $FlowFixMe[incompatible-type]: We don't want to use rest arguments since we transpile the code.
      const result = fn.apply(null, arguments);
      const terminatedNode: TerminatedCacheNode<T> = cacheNode as any;
      terminatedNode.s = TERMINATED;
      terminatedNode.v = result;
      return result;
    } catch (error) {
      // 异常也是稳定结果：保存首次异常，后续相同调用重复抛出它而不再次执行函数。
      const erroredNode: ErroredCacheNode<T> = cacheNode as any;
      erroredNode.s = ERRORED;
      erroredNode.v = error;
      throw error;
    }
  };
}

/**
 * 返回当前缓存域的生命周期信号；无 dispatcher 时返回 `null`。
 *
 * @remarks dispatcher 负责提供与缓存域同寿命的 AbortSignal；公共包装器不创建自己的信号。
 * @returns 当前域的 AbortSignal 或 null；取消表示该 renderer 缓存域结束，不代表任意
 * 返回 Promise 的成功/失败。dispatcher.cacheSignal 的异常直接传播。
 */
export function cacheSignal(): null | AbortSignal {
  const dispatcher = ReactSharedInternals.A;
  if (!dispatcher) {
    // 无 dispatcher 时没有与缓存绑定的生命周期信号。
    return null;
  }
  return dispatcher.cacheSignal();
}
