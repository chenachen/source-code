/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  ReactNodeList,
  Thenable,
  PendingThenable,
  FulfilledThenable,
  RejectedThenable,
} from 'shared/ReactTypes';

import isArray from 'shared/isArray';
import noop from 'shared/noop';
import {
  getIteratorFn,
  REACT_ELEMENT_TYPE,
  REACT_LAZY_TYPE,
  REACT_PORTAL_TYPE,
  REACT_OPTIMISTIC_KEY,
} from 'shared/ReactSymbols';
import {enableOptimisticKey} from 'shared/ReactFeatureFlags';
import {checkKeyStringCoercion} from 'shared/CheckStringCoercion';

import {isValidElement, cloneAndReplaceKey} from './jsx/ReactJSXElement';

/** 根层级 key 路径前缀，区分 React 生成的路径与用户 key。 */
const SEPARATOR = '.';
/** 嵌套层级 key 路径分隔符。 */
const SUBSEPARATOR = ':';

/**
 * 转义并包裹用户 key，使其可以安全嵌入 React 的内部 key 路径。
 *
 * `=` 与 `:` 是内部编码字符，必须先替换；`$` 前缀标明后续部分来自显式 key。
 *
 * @param key 待转义的用户 key。
 * @returns 可安全拼入内部路径的 key。
 */
function escape(key: string): string {
  const escapeRegex = /[=:]/g;
  const escaperLookup = {
    '=': '=0',
    ':': '=2',
  };
  const escapedString = key.replace(escapeRegex, function (match) {
    // $FlowFixMe[invalid-computed-prop]
    return escaperLookup[match];
  });

  return '$' + escapedString;
}

/**
 * TODO：补充测试，确保单个子节点与只含一个元素的数组生成相同 key 模式。
 */
/** 是否已经报告过 Map 作为 children 的开发态告警，保证每个 React 副本只提示一次。 */
let didWarnAboutMaps = false;

/** 匹配用户 key 中连续的斜杠，以避免它们与映射结果路径分隔符混淆。 */
const userProvidedKeyEscapeRegex = /\/+/g;
/** 复制用户 key 中的斜杠，保留其边界后再拼接映射生成的 `/`。 */
function escapeUserProvidedKey(text: string): string {
  return text.replace(userProvidedKeyEscapeRegex, '$&/');
}

/**
 * 为集合中的元素生成稳定 key 片段。
 *
 * @param element 可能携带显式 key 的元素。
 * @param index 未提供显式 key 时使用的集合索引。
 * @returns 已转义的显式 key，或以 36 进制编码的隐式索引。
 */
function getElementKey(element: any, index: number): string {
  // 调用方会把任意 ReactNode 传入，因此只做最小形状检查；避免过度限制可能出现的未来 ES 类型。
  if (typeof element === 'object' && element !== null && element.key != null) {
    if (enableOptimisticKey && element.key === REACT_OPTIMISTIC_KEY) {
      // `React.Children` 不支持 optimisticKey；算法上把它视作没有 key，并退回索引。
      if (__DEV__) {
        console.error("React.Children helpers don't support optimisticKey.");
      }
      return index.toString(36);
    }
    // 显式 key 需要先验证字符串强制转换，再编码内部保留字符。
    if (__DEV__) {
      checkKeyStringCoercion(element.key);
    }
    return escape('' + element.key);
  }
  // 未提供显式 key 时，以集合索引生成紧凑且确定的隐式 key。
  return index.toString(36);
}

/**
 * 同步读取可探查 Thenable；必要时就地安装状态字段并启动一次订阅。
 *
 * 已兑现时返回值，已拒绝时抛错误，等待时抛 Thenable 交给上层 Suspense。安装监听后再次
 * 检查状态，以覆盖会在 `then` 注册期间同步落定的 Thenable。
 * @param thenable - 待作为 children 解包的异步对象；状态字段可能由 React 或 Flight 提供。
 * @returns 已 fulfilled 的 value；rejected 抛 reason，未落定抛原 thenable 作为挂起信号。
 * @remarks 自行插桩时先写 pending，再订阅；两个回调只在仍为 pending 时写终态，
 * 防止多次结算覆盖结果。读取字段、给冻结对象写状态或 then 注册抛错都直接传播；
 * 没有独立 WeakMap 状态表，也不生成新的 Promise 或提供取消/超时机制。
 */
function resolveThenable<T>(thenable: Thenable<T>): T {
  switch (thenable.status) {
    case 'fulfilled': {
      const fulfilledValue: T = thenable.value;
      return fulfilledValue;
    }
    case 'rejected': {
      const rejectedError = thenable.reason;
      throw rejectedError;
    }
    default: {
      if (typeof thenable.status === 'string') {
        // 已有字符串 `status` 时保留用户态插桩。若字符串不是 fulfilled/rejected，
        // 此处按等待态处理。仍挂空监听以触发惰性初始化，例如 Flight 只在真正订阅
        // 值时才解析 JSON。
        thenable.then(noop, noop);
      } else {
        // 没有字符串状态时由 React 安装探查字段：先标记等待态，再用回调写入终态。

        // TODO：检测未缓存 Promise 导致的无限 ping 循环。

        const pendingThenable: PendingThenable<T> = thenable as any;
        pendingThenable.status = 'pending';
        pendingThenable.then(
          fulfilledValue => {
            if (thenable.status === 'pending') {
              const fulfilledThenable: FulfilledThenable<T> = thenable as any;
              fulfilledThenable.status = 'fulfilled';
              fulfilledThenable.value = fulfilledValue;
            }
          },
          (error: mixed) => {
            if (thenable.status === 'pending') {
              const rejectedThenable: RejectedThenable<T> = thenable as any;
              rejectedThenable.status = 'rejected';
              rejectedThenable.reason = error;
            }
          },
        );
      }

      // 再检查一次，以覆盖 `then` 在注册监听时同步兑现或拒绝的实现。
      switch ((thenable as Thenable<T>).status) {
        case 'fulfilled': {
          const fulfilledThenable: FulfilledThenable<T> = thenable as any;
          return fulfilledThenable.value;
        }
        case 'rejected': {
          const rejectedThenable: RejectedThenable<T> = thenable as any;
          const rejectedError = rejectedThenable.reason;
          throw rejectedError;
        }
      }
    }
  }
  throw thenable;
}

/**
 * 深度优先遍历 children，把叶节点映射、展平并写入目标数组，同时返回叶节点计数。
 *
 * `nameSoFar` 表示输入树路径，`escapedPrefix` 表示映射回调额外产生的路径；两者同时保留，
 * 让映射结果保留原层级路径和新增 key；没有显式 key 的位置仍依赖索引，移动时路径会变化。
 * Lazy 与 Thenable 会先解析再递归；等待时抛出异步对象，在 render 内可交给 Suspense 处理。
 * @param children - 当前输入子树；数组/同步 iterable 递归，element/portal 作为叶，不进入其 props.children。
 * @param array - 映射结果共享数组；只对回调返回的数组继续展平，其他非空返回值直接追加。
 * @param escapedPrefix - 映射额外产生的 key 路径前缀，区别于原输入层级。
 * @param nameSoFar - 原输入树到当前位置的编码路径，用显式 key 或索引建立同级身份。
 * @param callback - 每个叶的转换规则，空叶也以 null 调用；映射成空值仍计一个输入叶。
 * @returns 当前输入子树的叶数，不是输出数组长度；多个返回节点仍来自一个输入叶。
 * @remarks 数组空槽/undefined/boolean 都计入叶遍历，顶层 null/undefined 是否进入由
 * mapChildren 决定。函数、symbol 等未识别原始值不调用 callback。Map 只发 DEV 告警，
 * 随后仍按 entries 的嵌套结构遍历；迭代或回调中断时没有 try/finally 调用 iterator.return。
 */
function mapIntoArray(
  children: ?ReactNodeList,
  array: Array<React$Node>,
  escapedPrefix: string,
  nameSoFar: string,
  callback: (?React$Node) => ?ReactNodeList,
): number {
  const type = typeof children;

  if (type === 'undefined' || type === 'boolean') {
    // `undefined` 与布尔值在 children 语义中都等价于空节点，回调统一接收 `null`。
    children = null;
  }

  let invokeCallback = false;

  if (children === null) {
    invokeCallback = true;
  } else {
    switch (type) {
      case 'bigint':
      case 'string':
      case 'number':
        invokeCallback = true;
        break;
      case 'object':
        switch ((children as any).$$typeof) {
          case REACT_ELEMENT_TYPE:
          case REACT_PORTAL_TYPE:
            invokeCallback = true;
            break;
          case REACT_LAZY_TYPE:
            const payload = (children as any)._payload;
            const init = (children as any)._init;
            return mapIntoArray(
              init(payload),
              array,
              escapedPrefix,
              nameSoFar,
              callback,
            );
        }
    }
  }

  if (invokeCallback) {
    const child = children;
    let mappedChild = callback(child);
    // 即使是唯一子节点，也按被数组包裹的方式生成路径；将来子节点数量增长时 key 形态不变。
    const childKey =
      nameSoFar === '' ? SEPARATOR + getElementKey(child, 0) : nameSoFar;
    if (isArray(mappedChild)) {
      let escapedChildKey = '';
      if (childKey != null) {
        escapedChildKey = escapeUserProvidedKey(childKey) + '/';
      }
      mapIntoArray(mappedChild, array, escapedChildKey, '', c => c);
    } else if (mappedChild != null) {
      if (isValidElement(mappedChild)) {
        if (__DEV__) {
          // 这里的 `if` 会阻止安全强制转换 ESLint 规则自动豁免，因此下方需显式禁用该规则。
          // $FlowFixMe[incompatible-type] Flow incorrectly thinks React.Portal doesn't have a key
          if (mappedChild.key != null) {
            if (!child || child.key !== mappedChild.key) {
              checkKeyStringCoercion(mappedChild.key);
            }
          }
        }
        const newChild = cloneAndReplaceKey(
          mappedChild,
          // 若映射结果 key 与输入 key 不同，同时保留二者；这延续旧 `traverseAllChildren`
          // 处理对象 children 的兼容语义，避免映射回调意外破坏身份。
          escapedPrefix +
            // $FlowFixMe[incompatible-type] Flow incorrectly thinks React.Portal doesn't have a key
            (mappedChild.key != null &&
            (!child || child.key !== mappedChild.key)
              ? escapeUserProvidedKey(
                  // $FlowFixMe[unsafe-addition]
                  '' + mappedChild.key, // eslint-disable-line react-internal/safe-string-coercion
                ) + '/'
              : '') +
            childKey,
        );
        if (__DEV__) {
          // 若输入元素没有 key，必须在给映射结果分配合成 key 前保留“本应校验”的事实。
          // $FlowFixMe[incompatible-type] Flow incorrectly thinks React.Portal doesn't have a key
          if (
            nameSoFar !== '' &&
            child != null &&
            isValidElement(child) &&
            child.key == null
          ) {
            // 检查 `child._store.validated` 真值而不是严格比较 `!== 1`，为可能篡改该私有字段的
            // 旧库（例如 `fbt`）保留兼容性。
            if (child._store && !child._store.validated) {
              // 标记校验失败，但把警告延迟给真正 renderer；它掌握更完整的 owner/组件栈。
              newChild._store.validated = 2;
            }
          }
        }
        mappedChild = newChild;
      }
      array.push(mappedChild);
    }
    return 1;
  }

  let child;
  let nextName;
  let subtreeCount = 0; // 当前子树已发现的叶节点数，递归返回后逐层累加。
  const nextNamePrefix =
    nameSoFar === '' ? SEPARATOR : nameSoFar + SUBSEPARATOR;

  if (isArray(children)) {
    for (let i = 0; i < children.length; i++) {
      child = children[i];
      nextName = nextNamePrefix + getElementKey(child, i);
      subtreeCount += mapIntoArray(
        child,
        array,
        escapedPrefix,
        nextName,
        callback,
      );
    }
  } else {
    const iteratorFn = getIteratorFn(children);
    if (typeof iteratorFn === 'function') {
      const iterableChildren: Iterable<React$Node> & {
        /** Map 等可迭代对象的 entries 方法，用于开发态识别不受支持的 Map children。 */
        entries: any,
      } = children as any;

      if (__DEV__) {
        // Map 迭代的是 `[key, value]` 对，与 React 节点序列语义不兼容，因此只告警一次。
        if (iteratorFn === iterableChildren.entries) {
          if (!didWarnAboutMaps) {
            console.warn(
              'Using Maps as children is not supported. ' +
                'Use an array of keyed ReactElements instead.',
            );
          }
          didWarnAboutMaps = true;
        }
      }

      const iterator = iteratorFn.call(iterableChildren);
      let step;
      let ii = 0;
      // $FlowFixMe[incompatible-use] `iteratorFn` might return null according to typing.
      while (!(step = iterator.next()).done) {
        child = step.value;
        nextName = nextNamePrefix + getElementKey(child, ii++);
        subtreeCount += mapIntoArray(
          child,
          array,
          escapedPrefix,
          nextName,
          callback,
        );
      }
    } else if (type === 'object') {
      if (typeof (children as any).then === 'function') {
        return mapIntoArray(
          resolveThenable(children as any),
          array,
          escapedPrefix,
          nameSoFar,
          callback,
        );
      }

      // eslint-disable-next-line react-internal/safe-string-coercion
      const childrenString = String(children as any);

      throw new Error(
        `Objects are not valid as a React child (found: ${
          childrenString === '[object Object]'
            ? 'object with keys {' +
              Object.keys(children as any).join(', ') +
              '}'
            : childrenString
        }). ` +
          'If you meant to render a collection of children, use an array ' +
          'instead.',
      );
    }
  }

  return subtreeCount;
}

/** `Children.map` 对每个叶节点调用的映射函数签名。 */
type MapFunc = (child: ?React$Node, index: number) => ?ReactNodeList;

/**
 * 映射通常来自 `props.children` 的子节点树，并返回按遍历顺序展平的结果。
 *
 * 参考：https://reactjs.org/docs/react-api.html#reactchildrenmap
 *
 * 对每个叶节点调用一次 `func(child, index)`；回调返回的数组也会继续展平并重新生成 key。
 *
 * @param children 待遍历的子节点树。
 * @param func 叶节点映射函数。
 * @param context 调用映射函数时绑定的 `this`。
 * @returns 有序映射结果；输入为空时保持原来的 `null`/`undefined`。
 */
function mapChildren(
  children: ?ReactNodeList,
  func: MapFunc,
  context: mixed,
): ?Array<React$Node> {
  if (children == null) {
    // $FlowFixMe[incompatible-type] limitation refining abstract types in Flow
    return children;
  }
  const result: Array<React$Node> = [];
  let count = 0;
  mapIntoArray(children, result, '', '', function (child) {
    return func.call(context, child, count++);
  });
  return result;
}

/**
 * 统计通常来自 `props.children` 的叶节点数量。
 *
 * 参考：https://reactjs.org/docs/react-api.html#reactchildrencount
 *
 * @param children 待遍历的子节点树。
 * @returns 按 `Children` 遍历语义计算的叶节点数量。
 * @remarks 数组中的空值也计数，element/portal 不展开自身子树；顶层 null/undefined 为 0。
 * 映射回调返回值不会影响计数，lazy/thenable 的解析失败或挂起仍向调用方传播。
 */
function countChildren(children: ?ReactNodeList): number {
  let n = 0;
  mapChildren(children, () => {
    n++;
    // 不返回值，避免计数回调产生额外映射节点。
  });
  return n;
}

/** `Children.forEach` 对每个叶节点调用的副作用函数签名。 */
type ForEachFunc = (child: ?React$Node) => void;

/**
 * 按与 `Children.map` 相同的顺序遍历通常来自 `props.children` 的子节点。
 *
 * 参考：https://reactjs.org/docs/react-api.html#reactchildrenforeach
 *
 * 对每个叶节点调用一次 `forEachFunc(child, index)`，但不保留回调返回值。
 *
 * @param children 待遍历的子节点树。
 * @param forEachFunc 叶节点副作用函数。
 * @param forEachContext 调用函数时绑定的 `this`。
 */
function forEachChildren(
  children: ?ReactNodeList,
  forEachFunc: ForEachFunc,
  forEachContext: mixed,
): void {
  mapChildren(
    children,
    // $FlowFixMe[missing-this-annot]
    function () {
      forEachFunc.apply(this, arguments);
      // 明确丢弃回调结果，使 `forEach` 不具备映射语义。
    },
    forEachContext,
  );
}

/**
 * 展平通常来自 `props.children` 的子节点树，并返回已经正确重写 key 的数组。
 *
 * 参考：https://reactjs.org/docs/react-api.html#reactchildrentoarray
 * @param children - 可能嵌套的输入节点序列，沿用 mapChildren 的叶遍历与异常语义。
 * @returns 新的扁平结果数组；空叶被身份映射后过滤，空输入也总返回 []。
 */
function toArray(children: ?ReactNodeList): Array<React$Node> {
  return mapChildren(children, child => child) || [];
}

/**
 * 验证参数本身是单个 ReactElement，并原样返回它。
 *
 * 参考：https://reactjs.org/docs/react-api.html#reactchildrenonly
 *
 * 当前实现要求单个子节点不带数组等包装；公共辅助函数仍封装了这一结构约束，调用方无需
 * 依赖内部表示。
 *
 * @param children 预期为唯一 ReactElement 的值。
 * @returns 经验证后的同一个 ReactElement。
 */
function onlyChild<T>(children: T): T {
  if (!isValidElement(children)) {
    throw new Error(
      'React.Children.only expected to receive a single React element child.',
    );
  }

  return children;
}

export {
  forEachChildren as forEach,
  mapChildren as map,
  countChildren as count,
  onlyChild as only,
  toArray,
};
