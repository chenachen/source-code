/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {OMITTED_PROP_ERROR} from 'shared/ReactFlightPropertyAccess';

import hasOwnProperty from 'shared/hasOwnProperty';
import isArray from 'shared/isArray';
import {REACT_ELEMENT_TYPE} from './ReactSymbols';
import getComponentNameFromType from './getComponentNameFromType';

/** 空数组，可直接显示为 `[]`。 */
const EMPTY_ARRAY = 0;
/** 含对象、函数、长字符串或 bigint 的复杂数组，需要分层展示。 */
const COMPLEX_ARRAY = 1;
/** 只含 `JSON.stringify` 可接受原始值的数组。 */
const PRIMITIVE_ARRAY = 2;
/** 由 `[string, value]` 元组组成的 entries 数组，例如 Headers/Map 展开值。 */
const ENTRIES_ARRAY = 3;

/** DevTools 单层最多展示 100 个字段；更宽对象既难读也可能阻塞页面。 */
const OBJECT_WIDTH_LIMIT = 100;

/** 在宽度上限内判断数组应内联、按 entries 展开还是作为复杂对象处理。 */
function getArrayKind(array: Object): 0 | 1 | 2 | 3 {
  let kind: 0 | 1 | 2 | 3 = EMPTY_ARRAY;
  for (let i = 0; i < array.length && i < OBJECT_WIDTH_LIMIT; i++) {
    const value = array[i];
    if (typeof value === 'object' && value !== null) {
      if (
        isArray(value) &&
        value.length === 2 &&
        typeof value[0] === 'string'
      ) {
        // `[string, value]` 可按键值 entry 展示；不能与普通原始值混用。
        if (kind !== EMPTY_ARRAY && kind !== ENTRIES_ARRAY) {
          return COMPLEX_ARRAY;
        }
        kind = ENTRIES_ARRAY;
      } else {
        return COMPLEX_ARRAY;
      }
    } else if (typeof value === 'function') {
      return COMPLEX_ARRAY;
    } else if (typeof value === 'string' && value.length > 50) {
      return COMPLEX_ARRAY;
    } else if (kind !== EMPTY_ARRAY && kind !== PRIMITIVE_ARRAY) {
      return COMPLEX_ARRAY;
    } else if (typeof value === 'bigint') {
      return COMPLEX_ARRAY;
    } else {
      kind = PRIMITIVE_ARRAY;
    }
  }
  return kind;
}

/**
 * 把对象的可展示自有字段递归追加到性能轨道属性行。
 *
 * @remarks 忽略 `_` 开头内部字段并限制单层宽度；TypedArray/DataView 不枚举，避免为
 * 数百万索引物化 key 而卡住页面。
 */
export function addObjectToProperties(
  object: Object,
  properties: Array<[string, string]>,
  indent: number,
  prefix: string,
): void {
  if (ArrayBuffer.isView(object)) {
    // Uint8Array/Float32Array 等可能含数百万项，for...in 会强迫引擎物化每个索引并冻结
    // 页面；其内容在这里也无帮助。DataView 本身没有需要展示的 enumerable 字段。
    return;
  }
  let addedProperties = 0;
  for (const key in object) {
    if (hasOwnProperty.call(object, key) && key[0] !== '_') {
      addedProperties++;
      const value = object[key];
      addValueToProperties(key, value, properties, indent, prefix);
      if (addedProperties >= OBJECT_WIDTH_LIMIT) {
        properties.push([
          prefix +
            '\xa0\xa0'.repeat(indent) +
            'Only ' +
            OBJECT_WIDTH_LIMIT +
            ' properties are shown. React will not log more properties of this object.',
          '',
        ]);
        break;
      }
    }
  }
}

/** 安全读取 ReactElement 标记；跨源 opaque window 不允许直接点取属性。 */
function readReactElementTypeof(value: Object): mixed {
  // 先用 `in` 与 own-property 检查，避免直接访问 opaque origin window 的 `$$typeof`。
  return '$$typeof' in value && hasOwnProperty.call(value, '$$typeof')
    ? value.$$typeof
    : undefined;
}

/**
 * 把任意值格式化为 DevTools 性能轨道使用的属性行。
 *
 * @remarks JSX、Promise、数组和普通对象按各自结构处理；递归深度与宽度受限，长字符串
 * 截断。函数和对象只显示足以定位变化的摘要，不执行用户 getter。
 */
export function addValueToProperties(
  propertyName: string,
  value: mixed,
  properties: Array<[string, string]>,
  indent: number,
  prefix: string,
): void {
  let desc;
  switch (typeof value) {
    case 'object':
      if (value === null) {
        desc = 'null';
        break;
      } else {
        if (readReactElementTypeof(value) === REACT_ELEMENT_TYPE) {
          // JSX 在浅层展开 key/props，深层或仅 children 时使用紧凑标签摘要。
          const typeName = getComponentNameFromType(value.type) || '\u2026';
          const key = value.key;
          const props: any = value.props;
          const propsKeys = Object.keys(props);
          const propsLength = propsKeys.length;
          if (key == null && propsLength === 0) {
            desc = '<' + typeName + ' />';
            break;
          }
          if (
            indent < 3 ||
            (propsLength === 1 && propsKeys[0] === 'children' && key == null)
          ) {
            desc = '<' + typeName + ' \u2026 />';
            break;
          }
          properties.push([
            prefix + '\xa0\xa0'.repeat(indent) + propertyName,
            '<' + typeName,
          ]);
          if (key !== null) {
            addValueToProperties('key', key, properties, indent + 1, prefix);
          }
          let hasChildren = false;
          let addedProperties = 0;
          for (const propKey in props) {
            addedProperties++;
            if (propKey === 'children') {
              if (
                props.children != null &&
                (!isArray(props.children) || props.children.length > 0)
              ) {
                hasChildren = true;
              }
            } else if (
              hasOwnProperty.call(props, propKey) &&
              propKey[0] !== '_'
            ) {
              addValueToProperties(
                propKey,
                props[propKey],
                properties,
                indent + 1,
                prefix,
              );
            }

            if (addedProperties >= OBJECT_WIDTH_LIMIT) {
              break;
            }
          }
          properties.push([
            '',
            hasChildren ? '>\u2026</' + typeName + '>' : '/>',
          ]);
          return;
        }
        // $FlowFixMe[method-unbinding]
        const objectToString = Object.prototype.toString.call(value);
        let objectName = objectToString.slice(8, objectToString.length - 1);
        if (ArrayBuffer.isView(value)) {
          // TypedArray 只显示类型与长度，比枚举每项更有用且避免灾难性开销；DataView
          // 没有 length，只显示类型。
          const length = (value as any).length;
          desc =
            typeof length === 'number'
              ? objectName + '(' + length + ')'
              : objectName;
          break;
        }
        if (objectName === 'Array') {
          const array: Array<any> = value as any;
          const didTruncate = array.length > OBJECT_WIDTH_LIMIT;
          const kind = getArrayKind(array);
          if (kind === PRIMITIVE_ARRAY || kind === EMPTY_ARRAY) {
            desc = JSON.stringify(
              didTruncate
                ? array.slice(0, OBJECT_WIDTH_LIMIT).concat('…')
                : array,
            );
            break;
          } else if (kind === ENTRIES_ARRAY) {
            properties.push([
              prefix + '\xa0\xa0'.repeat(indent) + propertyName,
              '',
            ]);
            for (let i = 0; i < array.length && i < OBJECT_WIDTH_LIMIT; i++) {
              const entry = array[i];
              addValueToProperties(
                entry[0],
                entry[1],
                properties,
                indent + 1,
                prefix,
              );
            }
            if (didTruncate) {
              addValueToProperties(
                OBJECT_WIDTH_LIMIT.toString(),
                '…',
                properties,
                indent + 1,
                prefix,
              );
            }
            return;
          }
        }
        if (objectName === 'Promise') {
          if (value.status === 'fulfilled') {
            // fulfilled Promise 展开缓存值，再给首行类型包上 Promise 描述。
            const idx = properties.length;
            addValueToProperties(
              propertyName,
              value.value,
              properties,
              indent,
              prefix,
            );
            if (properties.length > idx) {
              // 保留内部值摘要，同时明确其 Promise 容器。
              const insertedEntry = properties[idx];
              insertedEntry[1] =
                'Promise<' + (insertedEntry[1] || 'Object') + '>';
              return;
            }
          } else if (value.status === 'rejected') {
            // rejected Promise 展开缓存 reason，并标记拒绝状态。
            const idx = properties.length;
            addValueToProperties(
              propertyName,
              value.reason,
              properties,
              indent,
              prefix,
            );
            if (properties.length > idx) {
              // 保留 reason 摘要，同时明确这是 rejected Promise。
              const insertedEntry = properties[idx];
              insertedEntry[1] = 'Rejected Promise<' + insertedEntry[1] + '>';
              return;
            }
          }
          properties.push([
            '\xa0\xa0'.repeat(indent) + propertyName,
            'Promise',
          ]);
          return;
        }
        if (objectName === 'Object') {
          const proto: any = Object.getPrototypeOf(value);
          if (proto && typeof proto.constructor === 'function') {
            objectName = proto.constructor.name;
          }
        }
        properties.push([
          prefix + '\xa0\xa0'.repeat(indent) + propertyName,
          objectName === 'Object' ? (indent < 3 ? '' : '\u2026') : objectName,
        ]);
        if (indent < 3) {
          addObjectToProperties(value, properties, indent + 1, prefix);
        }
        return;
      }
    case 'function':
      const functionName = value.name;
      if (
        functionName === '' ||
        // 例如代理函数，或把静态 `name` 覆盖成非字符串的 class。
        typeof functionName !== 'string'
      ) {
        desc = '() => {}';
      } else {
        desc = functionName + '() {}';
      }
      break;
    case 'string':
      if (value === OMITTED_PROP_ERROR) {
        desc = '\u2026'; // 用省略号替代服务端主动省略的大对象。
      } else {
        desc = JSON.stringify(
          value.length >= 1024
            ? value.slice(0, 1023) + '\u2026' // 最多保留 1023 个字符再加省略号。
            : value,
        );
      }
      break;
    case 'undefined':
      desc = 'undefined';
      break;
    case 'boolean':
      desc = value ? 'true' : 'false';
      break;
    default:
      // eslint-disable-next-line react-internal/safe-string-coercion
      desc = String(value);
  }
  properties.push([prefix + '\xa0\xa0'.repeat(indent) + propertyName, desc]);
}

/** diff 行前缀：字段只存在于旧对象。 */
const REMOVED = '-\xa0';
/** diff 行前缀：字段只存在于新对象。 */
const ADDED = '+\xa0';
/** diff 行前缀：容器本身保留，但内部可能有变化。 */
const UNCHANGED = '\u2007\xa0';

/**
 * 递归比较前后对象并追加适合性能轨道的紧凑 diff。
 *
 * @returns 值在受检深度内是否深度相等；引用不同但深度相等会给出 memoization 提示。
 * @remarks 单层字段超过上限时停止；顶层 children 与同 type/key 元素只记为变化，不重复
 * 展开会在其他轨道出现的子树 props。
 */
export function addObjectDiffToProperties(
  prev: Object,
  next: Object,
  properties: Array<[string, string]>,
  indent: number,
): boolean {
  // 这里也比较继承字段；双方共享的字段自然保持一致。字段新增/删除只输出名称并省略旧值，
  // 以降低序列化成本并保留最相关信息。
  let isDeeplyEqual = true;
  let prevPropertiesChecked = 0;
  for (const key in prev) {
    if (prevPropertiesChecked > OBJECT_WIDTH_LIMIT) {
      properties.push([
        'Previous object has more than ' +
          OBJECT_WIDTH_LIMIT +
          ' properties. React will not attempt to diff objects with too many properties.',
        '',
      ]);
      isDeeplyEqual = false;
      break;
    }

    if (!(key in next)) {
      properties.push([REMOVED + '\xa0\xa0'.repeat(indent) + key, '\u2026']);
      isDeeplyEqual = false;
    }
    prevPropertiesChecked++;
  }

  let nextPropertiesChecked = 0;
  for (const key in next) {
    if (nextPropertiesChecked > OBJECT_WIDTH_LIMIT) {
      properties.push([
        'Next object has more than ' +
          OBJECT_WIDTH_LIMIT +
          ' properties. React will not attempt to diff objects with too many properties.',
        '',
      ]);
      isDeeplyEqual = false;
      break;
    }

    if (key in prev) {
      const prevValue = prev[key];
      const nextValue = next[key];
      if (prevValue !== nextValue) {
        if (indent === 0 && key === 'children') {
          // 顶层 children 会随任意子树变化而改变，内部 props 也会在别处记录；这里只标记
          // 它是 render 原因，不重复展开。
          const line = '\xa0\xa0'.repeat(indent) + key;
          properties.push([REMOVED + line, '\u2026'], [ADDED + line, '\u2026']);
          isDeeplyEqual = false;
          continue;
        }
        if (indent >= 3) {
          // 深度达到 3 后直接打印前后摘要，不再递归嵌套字段。
        } else if (
          typeof prevValue === 'object' &&
          typeof nextValue === 'object' &&
          prevValue !== null &&
          nextValue !== null &&
          readReactElementTypeof(prevValue) ===
            readReactElementTypeof(nextValue)
        ) {
          if (readReactElementTypeof(nextValue) === REACT_ELEMENT_TYPE) {
            if (
              prevValue.type === nextValue.type &&
              prevValue.key === nextValue.key
            ) {
              // 嵌套元素 type/key 不变时，变化只来自 props；该 props diff 通常会在别处
              // 表示，这里用同一元素摘要避免重复。
              const typeName =
                getComponentNameFromType(nextValue.type) || '\u2026';
              const line = '\xa0\xa0'.repeat(indent) + key;
              const desc = '<' + typeName + ' \u2026 />';
              properties.push([REMOVED + line, desc], [ADDED + line, desc]);
              isDeeplyEqual = false;
              continue;
            }
          } else {
            // $FlowFixMe[method-unbinding]
            const prevKind = Object.prototype.toString.call(prevValue);
            // $FlowFixMe[method-unbinding]
            const nextKind = Object.prototype.toString.call(nextValue);
            if (
              prevKind === nextKind &&
              (nextKind === '[object Object]' || nextKind === '[object Array]')
            ) {
              // 只有同种普通 Object/Array 才递归做结构 diff。
              const entry = [
                UNCHANGED + '\xa0\xa0'.repeat(indent) + key,
                nextKind === '[object Array]' ? 'Array' : '',
              ];
              properties.push(entry);
              const prevLength = properties.length;
              const nestedEqual = addObjectDiffToProperties(
                prevValue,
                nextValue,
                properties,
                indent + 1,
              );
              if (!nestedEqual) {
                isDeeplyEqual = false;
              } else if (prevLength === properties.length) {
                // 嵌套值没有可见变化，只是引用不同；明确提示可考虑 memoization。
                entry[1] =
                  'Referentially unequal but deeply equal objects. Consider memoization.';
              }
              continue;
            }
          }
        } else if (
          typeof prevValue === 'function' &&
          typeof nextValue === 'function' &&
          prevValue.name === nextValue.name &&
          prevValue.length === nextValue.length
        ) {
          // $FlowFixMe[method-unbinding]
          const prevSrc = Function.prototype.toString.call(prevValue);
          // $FlowFixMe[method-unbinding]
          const nextSrc = Function.prototype.toString.call(nextValue);
          if (prevSrc === nextSrc) {
            // 源码、名称和 arity 都相同，通常是每次 render 新建了等价 closure。
            let desc;
            if (nextValue.name === '') {
              desc = '() => {}';
            } else {
              desc = nextValue.name + '() {}';
            }
            properties.push([
              UNCHANGED + '\xa0\xa0'.repeat(indent) + key,
              desc +
                ' Referentially unequal function closure. Consider memoization.',
            ]);
            continue;
          }
        }

        // 其他变化分别输出旧值和新值摘要。
        addValueToProperties(key, prevValue, properties, indent, REMOVED);
        addValueToProperties(key, nextValue, properties, indent, ADDED);
        isDeeplyEqual = false;
      }
    } else {
      properties.push([ADDED + '\xa0\xa0'.repeat(indent) + key, '\u2026']);
      isDeeplyEqual = false;
    }

    nextPropertiesChecked++;
  }
  return isDeeplyEqual;
}
