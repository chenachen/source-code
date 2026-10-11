/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {
  REACT_ELEMENT_TYPE,
  REACT_FORWARD_REF_TYPE,
  REACT_LAZY_TYPE,
  REACT_MEMO_TYPE,
  REACT_SUSPENSE_TYPE,
  REACT_SUSPENSE_LIST_TYPE,
  REACT_VIEW_TRANSITION_TYPE,
} from 'shared/ReactSymbols';

import type {LazyComponent} from 'react/src/ReactLazy';

import isArray from 'shared/isArray';
import getPrototypeOf from 'shared/getPrototypeOf';

import {enableViewTransition} from 'shared/ReactFeatureFlags';

/** 开发期记录 props 对象由哪个 JSX type 创建，供序列化错误恢复源码上下文。 */
export const jsxPropsParents: WeakMap<any, any> = new WeakMap();
/** 开发期记录 children 数组由哪个 JSX type 创建。 */
export const jsxChildrenParents: WeakMap<any, any> = new WeakMap();

/** 识别当前 Object.prototype，或按空原型链与属性名判断另一 realm 的候选原型。 */
function isObjectPrototype(object: any): boolean {
  if (!object) {
    return false;
  }
  const ObjectPrototype = Object.prototype;
  if (object === ObjectPrototype) {
    return true;
  }
  // 另一 realm 的 Object prototype 不与当前引用相等，但仍可能是纯对象原型。
  if (getPrototypeOf(object)) {
    return false;
  }
  const names = Object.getOwnPropertyNames(object);
  for (let i = 0; i < names.length; i++) {
    if (!(names[i] in ObjectPrototype)) {
      return false;
    }
  }
  return true;
}

/**
 * 沿原型链查找属性描述符，判断实际命中的属性是否由 getter 提供。
 * @param object - 起始对象；查到 null 或当前 realm 的 Object.prototype 即停止。
 * @param name - 待检查字段名；最近的数据属性会遮住祖先 getter。
 * @returns 命中的描述符有 get 函数时为 true；不调用该 getter，但代理描述符操作仍可抛错。
 */
export function isGetter(object: any, name: string): boolean {
  const ObjectPrototype = Object.prototype;
  if (object === ObjectPrototype || object === null) {
    return false;
  }
  const descriptor = Object.getOwnPropertyDescriptor(object, name);
  if (descriptor === undefined) {
    return isGetter(getPrototypeOf(object), name);
  }
  return typeof descriptor.get === 'function';
}

/**
 * 检查 Flight 普通对象候选的原型和字符串自有字段可枚举性。
 * @param object - 待检查对象；其原型须被 isObjectPrototype 识别，null 原型对象在此不通过。
 * @returns 是否符合形状约束；非枚举 key/ref getter 是 React props 的兼容特例。
 * @remarks 不读取字段值，不拒绝 enumerable getter，也不枚举 Symbol 键；此结果不等于
 * 整个对象已可序列化，字段值和其他限制由 Flight 后续路径检查。
 */
export function isSimpleObject(object: any): boolean {
  if (!isObjectPrototype(getPrototypeOf(object))) {
    return false;
  }
  const names = Object.getOwnPropertyNames(object);
  for (let i = 0; i < names.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(object, names[i]);
    if (!descriptor) {
      return false;
    }
    if (!descriptor.enumerable) {
      if (
        (names[i] === 'key' || names[i] === 'ref') &&
        typeof descriptor.get === 'function'
      ) {
        // React 会给 props 的 key/ref 加 warning getter；它们不会传到客户端，属于允许的
        // 唯一非枚举 getter 特例。
        continue;
      }
      return false;
    }
  }
  return true;
}

/** 从 `Object.prototype.toString` 提取跨 realm 仍稳定的对象类型名。 */
export function objectName(object: mixed): string {
  // $FlowFixMe[method-unbinding]
  const name = Object.prototype.toString.call(object);
  // 例如从 `[object Object]` 提取 `Object`。
  return name.slice(8, name.length - 1);
}

/** 生成适合嵌入对象预览的 key；必要时保留 JSON 转义与引号。 */
function describeKeyForErrorMessage(key: string): string {
  const encodedKey = JSON.stringify(key);
  return '"' + key + '"' === encodedKey ? key : encodedKey;
}

/** 把任意值压缩为短小、不会递归展开整个对象的错误消息片段。 */
export function describeValueForErrorMessage(value: mixed): string {
  switch (typeof value) {
    case 'string': {
      return JSON.stringify(
        value.length <= 10 ? value : value.slice(0, 10) + '...',
      );
    }
    case 'object': {
      if (isArray(value)) {
        return '[...]';
      }
      if (value !== null && value.$$typeof === CLIENT_REFERENCE_TAG) {
        return describeClientReference(value);
      }
      const name = objectName(value);
      if (name === 'Object') {
        return '{...}';
      }
      return name;
    }
    case 'function': {
      if ((value as any).$$typeof === CLIENT_REFERENCE_TAG) {
        return describeClientReference(value);
      }
      const name = (value as any).displayName || value.name;
      return name ? 'function ' + name : 'function';
    }
    default:
      // eslint-disable-next-line react-internal/safe-string-coercion
      return String(value);
  }
}

/**
 * 为序列化错误中的 JSX 外形递归解开 memo、forwardRef 和 lazy 类型。
 * @param type - 有效 JSX type 或包装描述对象；宿主标签直接返回原字符串。
 * @returns 已识别特殊边界或宿主标签名称；其他组件类型和无法解析的 lazy 返回空串。
 * @remarks lazy._init 可能首次启动加载、改变 payload，或抛出 thenable/错误；此分支
 * 吞掉该异常以继续生成诊断。其他属性读取没有统一 catch，也没有循环包装检测。
 */
function describeElementType(type: any): string {
  if (typeof type === 'string') {
    return type;
  }
  switch (type) {
    case REACT_SUSPENSE_TYPE:
      return 'Suspense';
    case REACT_SUSPENSE_LIST_TYPE:
      return 'SuspenseList';
    case REACT_VIEW_TRANSITION_TYPE:
      if (enableViewTransition) {
        return 'ViewTransition';
      }
  }
  if (typeof type === 'object') {
    switch (type.$$typeof) {
      case REACT_FORWARD_REF_TYPE:
        return describeElementType(type.render);
      case REACT_MEMO_TYPE:
        return describeElementType(type.type);
      case REACT_LAZY_TYPE: {
        const lazyComponent: LazyComponent<any, any> = type as any;
        const payload = lazyComponent._payload;
        const init = lazyComponent._init;
        try {
          // Lazy 可包装任意组件类型，解析 payload 后继续递归处理包装层。
          return describeElementType(init(payload));
        } catch (x) {}
      }
    }
  }
  return '';
}

/** 标识不能在服务端直接展开的 RSC 客户端引用。 */
const CLIENT_REFERENCE_TAG = Symbol.for('react.client.reference');

/** 为客户端引用返回不触碰其代理属性的安全占位描述。 */
function describeClientReference(ref: any) {
  return 'client';
}

/**
 * 把对象、数组或 JSX props/children 压缩成错误消息预览，并可用 `^` 标出指定字段。
 *
 * @remarks 普通子值达到长度阈值后改用省略号，expandedName 指定的字段完整展示；仍会
 * 遍历全部字段，因此不是固定长度预览。开发期 parent WeakMap 用于恢复 JSX 外形。
 * @param objectOrArray - 正在报错的值或 props/children 容器；非 Object/Array 仅返回类型名。
 * @param expandedName - 需要定位的直接字段名或十进制索引字符串；匹配时记录文本区间。
 * @returns 默认返回单行预览；指定字段后返回带缩进的文本，匹配到非空区间才加 ^ 标记。
 * @remarks 递归生成子摘要发生在长度检查之前，长度阈值不能限制递归成本；没有 visited
 * 集合，循环对象不会被自动折叠。getter、类型探测及普通递归异常向调用方传播。
 * parent WeakMap 仅恢复开发期 JSX 上下文，不拥有或延长 props/children 生命周期。
 */
export function describeObjectForErrorMessage(
  objectOrArray:
    {
        /** 待预览对象允许的字符串或数字键。 */
        +[key: string | number]: mixed,
        ...
      }
    | $ReadOnlyArray<mixed>,
  expandedName?: string,
): string {
  const objKind = objectName(objectOrArray);
  if (objKind !== 'Object' && objKind !== 'Array') {
    return objKind;
  }
  let str = '';
  let start = -1;
  let length = 0;
  if (isArray(objectOrArray)) {
    if (__DEV__ && jsxChildrenParents.has(objectOrArray)) {
      // 按 JSX children 而非普通数组格式打印，并恢复父元素 type。
      const type = jsxChildrenParents.get(objectOrArray);
      str = '<' + describeElementType(type) + '>';
      const array: $ReadOnlyArray<mixed> = objectOrArray;
      for (let i = 0; i < array.length; i++) {
        const value = array[i];
        let substr;
        if (typeof value === 'string') {
          substr = value;
        } else if (typeof value === 'object' && value !== null) {
          substr = '{' + describeObjectForErrorMessage(value) + '}';
        } else {
          substr = '{' + describeValueForErrorMessage(value) + '}';
        }
        if ('' + i === expandedName) {
          start = str.length;
          length = substr.length;
          str += substr;
        } else if (substr.length < 15 && str.length + substr.length < 40) {
          str += substr;
        } else {
          str += '{...}';
        }
      }
      str += '</' + describeElementType(type) + '>';
    } else {
      // 普通数组只展开短值，避免错误消息本身变得巨大。
      str = '[';
      const array: $ReadOnlyArray<mixed> = objectOrArray;
      for (let i = 0; i < array.length; i++) {
        if (i > 0) {
          str += ', ';
        }
        const value = array[i];
        let substr;
        if (typeof value === 'object' && value !== null) {
          substr = describeObjectForErrorMessage(value);
        } else {
          substr = describeValueForErrorMessage(value);
        }
        if ('' + i === expandedName) {
          start = str.length;
          length = substr.length;
          str += substr;
        } else if (substr.length < 10 && str.length + substr.length < 40) {
          str += substr;
        } else {
          str += '...';
        }
      }
      str += ']';
    }
  } else {
    if (objectOrArray.$$typeof === REACT_ELEMENT_TYPE) {
      str = '<' + describeElementType(objectOrArray.type) + '/>';
    } else if (objectOrArray.$$typeof === CLIENT_REFERENCE_TAG) {
      return describeClientReference(objectOrArray);
    } else if (__DEV__ && jsxPropsParents.has(objectOrArray)) {
      // 按 JSX props 打印，并用 parent WeakMap 恢复元素 type。
      const type = jsxPropsParents.get(objectOrArray);
      str = '<' + (describeElementType(type) || '...');
      const object: {
        /** JSX props 预览允许的字符串或数字键。 */
        +[key: string | number]: mixed,
        ...
      } = objectOrArray;
      const names = Object.keys(object);
      for (let i = 0; i < names.length; i++) {
        str += ' ';
        const name = names[i];
        str += describeKeyForErrorMessage(name) + '=';
        const value = object[name];
        let substr;
        if (
          name === expandedName &&
          typeof value === 'object' &&
          value !== null
        ) {
          substr = describeObjectForErrorMessage(value);
        } else {
          substr = describeValueForErrorMessage(value);
        }
        if (typeof value !== 'string') {
          substr = '{' + substr + '}';
        }
        if (name === expandedName) {
          start = str.length;
          length = substr.length;
          str += substr;
        } else if (substr.length < 10 && str.length + substr.length < 40) {
          str += substr;
        } else {
          str += '...';
        }
      }
      str += '>';
    } else {
      // 普通对象使用 `key: value` 预览，并对过长子值折叠为省略号。
      str = '{';
      const object: {
        /** 普通对象预览允许的字符串或数字键。 */
        +[key: string | number]: mixed,
        ...
      } = objectOrArray;
      const names = Object.keys(object);
      for (let i = 0; i < names.length; i++) {
        if (i > 0) {
          str += ', ';
        }
        const name = names[i];
        str += describeKeyForErrorMessage(name) + ': ';
        const value = object[name];
        let substr;
        if (typeof value === 'object' && value !== null) {
          substr = describeObjectForErrorMessage(value);
        } else {
          substr = describeValueForErrorMessage(value);
        }
        if (name === expandedName) {
          start = str.length;
          length = substr.length;
          str += substr;
        } else if (substr.length < 10 && str.length + substr.length < 40) {
          str += substr;
        } else {
          str += '...';
        }
      }
      str += '}';
    }
  }
  if (expandedName === undefined) {
    return str;
  }
  if (start > -1 && length > 0) {
    const highlight = ' '.repeat(start) + '^'.repeat(length);
    return '\n  ' + str + '\n  ' + highlight;
  }
  return '\n  ' + str;
}
