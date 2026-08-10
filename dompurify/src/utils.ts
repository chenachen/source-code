/**
 * 缓存后续净化流程依赖的 `Object` 原生函数。
 *
 * @remarks
 * `entries` 枚举自有可枚举项；`setPrototypeOf` 构造无原型查询表；`isFrozen` 保护共享
 * 预设；`getPrototypeOf` 与 `getOwnPropertyDescriptor` 供描述符级安全查找。提前捕获可
 * 避免运行期间同名属性被覆盖后改变行为。
 */
const {
  entries,
  setPrototypeOf,
  isFrozen,
  getPrototypeOf,
  getOwnPropertyDescriptor,
} = Object;

/**
 * 缓存并导出对象冻结、密封和无原型对象创建函数。
 *
 * @remarks
 * `freeze`、`seal` 为兼容旧环境而保持可变绑定，缺失时分别替换为保持输入不变的
 * 回退函数；`create` 直接使用启动时捕获的 `Object.create`。
 */
let { freeze, seal, create } = Object; // eslint-disable-line import/no-mutable-exports
/**
 * 缓存 `Reflect.apply` 与 `Reflect.construct`；旧环境缺失时写入兼容调用路径。
 * 可变绑定只在模块初始化期间选择一次实现，之后供所有无绑定包装器复用。
 */
let { apply, construct } = typeof Reflect !== 'undefined' && Reflect;

if (!freeze) {
  /** 旧环境缺少 `Object.freeze` 时保留输入引用，不承诺运行时不可变。 */
  freeze = function <T>(x: T): T {
    return x;
  };
}

if (!seal) {
  /** 旧环境缺少 `Object.seal` 时保留输入引用，不承诺运行时密封。 */
  seal = function <T>(x: T): T {
    return x;
  };
}

if (!apply) {
  /** 旧环境缺少 `Reflect.apply` 时通过目标函数的 `.apply()` 路径完成调用。 */
  apply = function <T>(
    func: (thisArg: any, ...args: any[]) => T,
    thisArg: any,
    ...args: any[]
  ): T {
    return func.apply(thisArg, args);
  };
}

if (!construct) {
  /** 旧环境缺少 `Reflect.construct` 时使用 `new` 调用目标构造器。 */
  construct = function <T>(Func: new (...args: any[]) => T, ...args: any[]): T {
    return new Func(...args);
  };
}

/** 无绑定调用捕获的 `Array.prototype.forEach`，避免从待净化对象读取同名方法。 */
const arrayForEach = unapply(Array.prototype.forEach);
/** 无绑定调用捕获的 `Array.prototype.indexOf`。 */
const arrayIndexOf = unapply(Array.prototype.indexOf);
/** 无绑定调用捕获的 `Array.prototype.lastIndexOf`，供删除指定 hook 时反向定位。 */
const arrayLastIndexOf = unapply(Array.prototype.lastIndexOf);
/** 无绑定调用捕获的 `Array.prototype.pop`，供栈式 hook 移除等路径使用。 */
const arrayPop = unapply(Array.prototype.pop);
/** 无绑定调用捕获的 `Array.prototype.push`，避免数组实例上的同名属性干扰写入。 */
const arrayPush = unapply(Array.prototype.push);
/** 无绑定调用捕获的 `Array.prototype.slice`。 */
const arraySlice = unapply(Array.prototype.slice);
/** 无绑定调用捕获的 `Array.prototype.splice`，供精确移除 hook 使用。 */
const arraySplice = unapply(Array.prototype.splice);
/** 缓存数组品牌检查，配置中的集合选项必须先通过该检查。 */
const arrayIsArray = Array.isArray;

/** 无绑定调用捕获的小写转换，用作标签和属性查询表的默认规范化函数。 */
const stringToLowerCase = unapply(String.prototype.toLowerCase);
/** 无绑定调用捕获的字符串品牌转换；命名空间键需要保留大小写时使用。 */
const stringToString = unapply(String.prototype.toString);
/** 无绑定调用捕获的字符串匹配函数。 */
const stringMatch = unapply(String.prototype.match);
/** 无绑定调用捕获的字符串替换函数，供 URI 清理和模板表达式擦除使用。 */
const stringReplace = unapply(String.prototype.replace);
/** 无绑定调用捕获的字符串索引查询函数。 */
const stringIndexOf = unapply(String.prototype.indexOf);
/** 无绑定调用捕获的字符串首尾空白清理函数。 */
const stringTrim = unapply(String.prototype.trim);

/** 捕获数字到字符串的品牌转换，避免读取输入值上的方法。 */
const numberToString = unapply(Number.prototype.toString);
/** 捕获布尔值到字符串的品牌转换，避免读取输入值上的方法。 */
const booleanToString = unapply(Boolean.prototype.toString);
/** 在环境支持 BigInt 时捕获其字符串转换；不支持时以 `null` 标记回退分支。 */
const bigintToString =
  typeof BigInt === 'undefined' ? null : unapply(BigInt.prototype.toString);
/** 在环境支持 Symbol 时捕获其字符串转换；不支持时以 `null` 标记回退分支。 */
const symbolToString =
  typeof Symbol === 'undefined' ? null : unapply(Symbol.prototype.toString);

/** 无绑定调用捕获的自有属性检查，阻断被污染原型提供的伪成员。 */
const objectHasOwnProperty = unapply(Object.prototype.hasOwnProperty);
/** 捕获通用对象品牌字符串转换，作为安全字符串化的最终回退。 */
const objectToString = unapply(Object.prototype.toString);

/** 无绑定调用捕获的正则测试；包装层会先把正则 `lastIndex` 归零。 */
const regExpTest = unapply(RegExp.prototype.test);

/** 无绑定构造 `TypeError`，使错误创建不依赖可被替换的全局调用方式。 */
const typeErrorCreate = unconstruct(TypeError);

/**
 * 把捕获的原型方法转换为显式接收 `thisArg` 的无绑定调用函数。
 *
 * @remarks
 * 正则实例是有状态对象；每次调用前必须把 `lastIndex` 归零，才能安全复用带全局标志的
 * 模块级表达式。其余调用统一经模块初始化时选定的 `apply` 实现分派。
 *
 * @param func - 启动时捕获、需要解除接收者绑定的原生函数。
 * @returns 首个参数为接收者、其余参数原样转发的调用函数。
 */
function unapply<T>(
  func: (thisArg: any, ...args: any[]) => T
): (thisArg: any, ...args: any[]) => T {
  return (thisArg: any, ...args: any[]): T => {
    if (thisArg instanceof RegExp) {
      thisArg.lastIndex = 0;
    }

    return apply(func, thisArg, args);
  };
}

/**
 * 把构造器转换为普通可调用的实例创建函数。
 *
 * @remarks 下游主要用它缓存 `TypeError` 创建路径，避免净化过程中依赖动态全局属性。
 * @param Func - 启动时捕获的构造器。
 * @returns 收集实参并交给初始化时选定 `construct` 实现的函数。
 */
function unconstruct<T>(
  Func: new (...args: any[]) => T
): (...args: any[]) => T {
  return (...args: any[]): T => construct(Func, args);
}

/**
 * 将数组成员规范化后写入布尔查询表。
 *
 * @remarks
 * 目标对象支持时会先移除原型，使 `in` 与真值查询不受 `Object.prototype` 或原型 setter
 * 影响。默认把字符串转成小写；未冻结输入会同步写回规范化值，冻结的内置预设保持
 * 原样。非数组输入直接返回目标表。
 *
 * @param set - 接收 `成员名 -> true` 的查询表。
 * @param array - 待加入的成员数组。
 * @param transformCaseFunc - 字符串键规范化函数；默认转小写，命名空间可传原样转换。
 * @returns 原位扩充且尽可能移除原型的同一查询表。
 */
function addToSet(
  set: Record<string, boolean>,
  array: readonly unknown[],
  transformCaseFunc: ReturnType<typeof unapply<string>> = stringToLowerCase
): Record<string, boolean> {
  if (setPrototypeOf) {
    // 让 `in` 和 `Boolean(set.constructor)` 等真值检查不依赖 Object.prototype，
    // 同时阻止原型 setter 把查询表作为接收者拦截写入。
    setPrototypeOf(set, null);
  }

  if (!arrayIsArray(array)) {
    return set;
  }

  let l = array.length;
  while (l--) {
    let element = array[l];

    if (typeof element === 'string') {
      const lcElement = transformCaseFunc(element);

      if (lcElement !== element) {
        // 支持冻结的环境中内置配置预设不可变；这里只回写尚未冻结的数组。
        if (!isFrozen(array)) {
          (array as unknown[])[l] = lcElement;
        }

        element = lcElement;
      }
    }

    set[element as string] = true;
  }

  return set;
}

/**
 * 用自有 `null` 值填满稀疏数组的空槽，抵御客户端原型污染（CSPP）。
 *
 * @remarks
 * 若保留空槽，按索引读取可能落到 `Array.prototype` 上的污染值。函数原位修改数组，
 * 已有自有元素保持不变。
 *
 * @param array - 需要消除空槽的数组。
 * @returns 同一数组；原空槽已成为值为 `null` 的自有元素。
 */
function cleanArray<T>(array: T[]): Array<T | null> {
  for (let index = 0; index < array.length; index++) {
    const isPropertyExist = objectHasOwnProperty(array, index);

    if (!isPropertyExist) {
      array[index] = null;
    }
  }

  return array;
}

/**
 * 把配置对象复制到无原型对象，并递归处理普通对象成员。
 *
 * @remarks
 * 这不是纯浅拷贝：普通 `Object` 成员会递归复制；数组不会复制，只会经 `cleanArray()`
 * 原位填洞后复用引用；DOM、RegExp、函数等其他值也复用引用。只复制源对象的自有可
 * 枚举属性，从而隔离配置对象原型。
 *
 * @param object - 待复制的配置或嵌套普通对象。
 * @returns 具有空原型的新对象。
 */
function clone<T extends Record<string, any>>(object: T): T {
  const newObject = create(null);

  for (const [property, value] of entries(object)) {
    const isPropertyExist = objectHasOwnProperty(object, property);

    if (isPropertyExist) {
      if (arrayIsArray(value)) {
        newObject[property] = cleanArray(value);
      } else if (
        value &&
        typeof value === 'object' &&
        value.constructor === Object
      ) {
        newObject[property] = clone(value);
      } else {
        newObject[property] = value;
      }
    }
  }

  return newObject;
}

/**
 * 不依赖输入值直接属性访问地将非节点输入转换为字符串。
 *
 * @remarks
 * 基本类型使用启动时捕获的品牌转换；对象和函数通过描述符查找 `toString` getter 或
 * 方法并以原对象为接收者调用。自定义转换未返回字符串时，使用捕获的
 * `Object.prototype.toString` 处理结果。转换过程抛出的异常由调用方处理。
 *
 * @param value - `sanitize()` 在转入 DOM 解析前收到的非节点值。
 * @returns 输入的字符串表示。
 */
function stringifyValue(value: unknown): string {
  switch (typeof value) {
    case 'string': {
      return value;
    }

    case 'number': {
      return numberToString(value);
    }

    case 'boolean': {
      return booleanToString(value);
    }

    case 'bigint': {
      return bigintToString ? bigintToString(value) : '0';
    }

    case 'symbol': {
      return symbolToString ? symbolToString(value) : 'Symbol()';
    }

    case 'undefined': {
      return objectToString(value);
    }

    case 'function':
    case 'object': {
      if (value === null) {
        return objectToString(value);
      }

      const valueAsRecord = value as Record<string, any>;
      const valueToString = lookupGetter(valueAsRecord, 'toString');

      if (typeof valueToString === 'function') {
        const stringified = valueToString(valueAsRecord);

        return typeof stringified === 'string'
          ? stringified
          : objectToString(stringified);
      }

      return objectToString(value);
    }

    default: {
      return objectToString(value);
    }
  }
}

/**
 * 沿原型链按描述符查找 getter 或函数值属性，并返回无绑定调用包装器。
 *
 * @remarks
 * 核心用它缓存 DOM 原型 getter/方法，避免直接读取可能被 DOM Clobbering 遮蔽的实例
 * 属性。查找只检查描述符，不触发 getter；未找到可调用描述符时返回恒为 `null` 的
 * 回退函数。
 *
 * @param object - 原型链查找起点。
 * @param prop - 目标属性名。
 * @returns 以首个参数作为接收者的包装器，或返回 `null` 的回退函数。
 */
function lookupGetter<T extends Record<string, any>>(
  object: T,
  prop: string
): ReturnType<typeof unapply<any>> | (() => null) {
  while (object !== null) {
    const desc = getOwnPropertyDescriptor(object, prop);

    if (desc) {
      if (desc.get) {
        return unapply(desc.get);
      }

      if (typeof desc.value === 'function') {
        return unapply(desc.value);
      }
    }

    object = getPrototypeOf(object);
  }

  /** 表示原型链中不存在可调用描述符，使调用方可沿统一函数路径得到空结果。 */
  function fallbackValue(): null {
    return null;
  }

  return fallbackValue;
}

/**
 * 通过捕获的 `RegExp.prototype.test` 执行内部槽品牌检查。
 *
 * @remarks `instanceof` 会受 realm 边界影响；不兼容接收者抛出的异常在此转换为 `false`。
 */
function isRegex(value: unknown): value is RegExp {
  try {
    regExpTest(value as RegExp, '');
    return true;
  } catch {
    return false;
  }
}

export {
  // 数组原生函数
  arrayForEach,
  arrayIndexOf,
  arrayIsArray,
  arrayLastIndexOf,
  arrayPop,
  arrayPush,
  arraySlice,
  arraySplice,
  // 对象原生函数与对象工具
  entries,
  freeze,
  getPrototypeOf,
  getOwnPropertyDescriptor,
  isFrozen,
  setPrototypeOf,
  seal,
  clone,
  create,
  objectHasOwnProperty,
  objectToString,
  // 正则表达式
  regExpTest,
  isRegex,
  // 字符串原生函数
  stringIndexOf,
  stringMatch,
  stringReplace,
  stringToLowerCase,
  stringToString,
  stringTrim,
  // 其他转换
  stringifyValue,
  // 错误创建
  typeErrorCreate,
  // 其他工具
  lookupGetter,
  addToSet,
  // 反射调用包装
  unapply,
  unconstruct,
};
