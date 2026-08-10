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

/** 缓存 trie 节点的状态联合；状态只能从未完成进入一个终态。 */
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
 * 在当前异步 dispatcher 的请求级缓存域中，按函数与完整参数序列记忆结果。
 *
 * @remarks 参数序列形成 trie：对象/函数进入 WeakMap，原始值进入 Map。叶节点会缓存
 * 首次返回值或首次异常；若当前没有 dispatcher，则直接调用原函数而不跨请求共享数据。
 */
export function cache<A: Iterable<mixed>, T>(fn: (...A) => T): (...A) => T {
  return function () {
    const dispatcher = ReactSharedInternals.A;
    if (!dispatcher) {
      // 无 dispatcher 表示当前不处于可安全隔离的缓存域，因此直接计算。
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
        // 原始值无法作为 WeakMap 键，进入普通 Map。
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
 * @remarks 这与无 dispatcher 时 `cache` 允许调用但不缓存的语义保持一致：该作用域既
 * 不是永不结束的缓存，也不是已经结束的缓存，因此不能伪造 AbortSignal。
 */
export function cacheSignal(): null | AbortSignal {
  const dispatcher = ReactSharedInternals.A;
  if (!dispatcher) {
    // 无 dispatcher 时没有与缓存绑定的生命周期信号。
    return null;
  }
  return dispatcher.cacheSignal();
}
