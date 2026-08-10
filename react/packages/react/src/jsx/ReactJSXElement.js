/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import getComponentNameFromType from 'shared/getComponentNameFromType';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import hasOwnProperty from 'shared/hasOwnProperty';
import assign from 'shared/assign';
import {
  REACT_ELEMENT_TYPE,
  REACT_FRAGMENT_TYPE,
  REACT_LAZY_TYPE,
  REACT_OPTIMISTIC_KEY,
} from 'shared/ReactSymbols';
import {checkKeyStringCoercion} from 'shared/CheckStringCoercion';
import isArray from 'shared/isArray';
import {ownerStackLimit, enableOptimisticKey} from 'shared/ReactFeatureFlags';

/**
 * 创建开发工具异步任务的可选平台钩子；生产环境及不支持 `console.createTask` 的环境返回空值。
 */
const createTask =
  // eslint-disable-next-line react-internal/no-production-logging
  __DEV__ && console.createTask
    ? // eslint-disable-next-line react-internal/no-production-logging
      console.createTask
    : () => null;

/** 根据元素类型生成开发工具任务名，同时避免为 Lazy 类型提前执行初始化器。 */
function getTaskName(type) {
  if (type === REACT_FRAGMENT_TYPE) {
    return '<>';
  }
  if (
    typeof type === 'object' &&
    type !== null &&
    type.$$typeof === REACT_LAZY_TYPE
  ) {
    // 开发环境也不能为取得名称而提前初始化 Lazy，否则会改变加载时机；因此使用未知占位名。
    return '<...>';
  }
  try {
    const name = getComponentNameFromType(type);
    return name ? '<' + name + '>' : '<...>';
  } catch (x) {
    return '<...>';
  }
}

/** 从当前异步 dispatcher 读取创建元素的 owner；没有 renderer 上下文时返回空。 */
function getOwner() {
  if (__DEV__) {
    const dispatcher = ReactSharedInternals.A;
    if (dispatcher === null) {
      return null;
    }
    return dispatcher.getOwner();
  }
  return null;
}

/**
 * owner 栈采集深度。V8 默认 10，SpiderMonkey 不支持 `Error.stackTraceLimit`，JSC 默认 100；
 * 太低可能到不了 `react_stack_bottom_frame`，太高会拖慢未连接调试器时的 `Error()`。
 * V8 在调试器检查期间不受该限制影响。
 */
const ownerStackTraceLimit = 10;

/**
 * 为采样额度耗尽后的元素生成统一未知 owner 栈。
 * @noinline
 */
function UnknownOwner() {
  /** @noinline */
  return (() => Error('react-stack-top-frame'))();
}
/** 通过具名底帧调用栈工厂，让错误栈裁剪逻辑找到稳定边界。 */
const createFakeCallStack = {
  /** 执行传入的栈构造函数，同时保留 `react_stack_bottom_frame` 函数名。 */
  react_stack_bottom_frame: function (callStackForError) {
    return callStackForError();
  },
};

/** 是否已提示过读取特殊 `key` prop，避免重复告警。 */
let specialPropKeyWarningShown;
/** 按组件名记录 `element.ref` 弃用告警。 */
let didWarnAboutElementRef;
/** 是否已提示应用仍使用旧 JSX transform。 */
let didWarnAboutOldJSXRuntime;
/** 复用的未知 owner 调试栈，避免采样额度耗尽后继续创建 Error。 */
let unknownOwnerDebugStack;
/** 与未知 owner 栈配套的复用调试任务。 */
let unknownOwnerDebugTask;

if (__DEV__) {
  didWarnAboutElementRef = {};

  // 通过对象属性绑定调用，诱使压缩器保留作为栈裁剪边界的函数名。
  unknownOwnerDebugStack = createFakeCallStack.react_stack_bottom_frame.bind(
    createFakeCallStack,
    UnknownOwner,
  )();
  unknownOwnerDebugTask = createTask(getTaskName(UnknownOwner));
}

/** 判断配置是否显式提供有效 ref，并过滤 React 自己安装的警告 getter。 */
function hasValidRef(config) {
  if (__DEV__) {
    if (hasOwnProperty.call(config, 'ref')) {
      const getter = Object.getOwnPropertyDescriptor(config, 'ref').get;
      if (getter && getter.isReactWarning) {
        return false;
      }
    }
  }
  return config.ref !== undefined;
}

/** 判断配置是否显式提供有效 key，并过滤 React 自己安装的警告 getter。 */
function hasValidKey(config) {
  if (__DEV__) {
    if (hasOwnProperty.call(config, 'key')) {
      const getter = Object.getOwnPropertyDescriptor(config, 'key').get;
      if (getter && getter.isReactWarning) {
        return false;
      }
    }
  }
  return config.key !== undefined;
}

/**
 * 在 props 上安装开发态 `key` 警告 getter；key 属于元素身份，不应被组件当作普通 prop 读取。
 */
function defineKeyPropWarningGetter(props, displayName) {
  if (__DEV__) {
    /** 首次读取 `props.key` 时报告特殊 prop 误用。 */
    const warnAboutAccessingKey = function () {
      if (!specialPropKeyWarningShown) {
        specialPropKeyWarningShown = true;
        console.error(
          '%s: `key` is not a prop. Trying to access it will result ' +
            'in `undefined` being returned. If you need to access the same ' +
            'value within the child component, you should pass it as a different ' +
            'prop. (https://react.dev/link/special-props)',
          displayName,
        );
      }
    };
    warnAboutAccessingKey.isReactWarning = true;
    Object.defineProperty(props, 'key', {
      get: warnAboutAccessingKey,
      configurable: true,
    });
  }
}

/** 兼容读取旧 `element.ref`，按组件去重报告弃用，并把未定义 ref 归一为 `null`。 */
function elementRefGetterWithDeprecationWarning() {
  if (__DEV__) {
    const componentName = getComponentNameFromType(this.type);
    if (!didWarnAboutElementRef[componentName]) {
      didWarnAboutElementRef[componentName] = true;
      console.error(
        'Accessing element.ref was removed in React 19. ref is now a ' +
          'regular prop. It will be removed from the JSX Element ' +
          'type in a future release.',
      );
    }

    // 为兼容旧元素形状，把未定义的 `element.ref` 归一为 `null`。
    const refProp = this.props.ref;
    return refProp !== undefined ? refProp : null;
  }
}

/**
 * 创建不可变 ReactElement 记录的内部工厂。
 *
 * 它不再采用类模式，不能通过 `new` 调用，`instanceof` 也无效；应比较 `$$typeof` 与
 * `Symbol.for('react.transitional.element')` 来判断 ReactElement。开发构建另外安装校验、
 * owner 与调试字段，并冻结公开形状；生产构建只保留 renderer 所需字段。
 *
 * @internal
 */
function ReactElement(type, key, props, owner, debugStack, debugTask) {
  // `props.ref` 是唯一事实来源，忽略旧签名可能传入的独立 ref。`element.ref` 只为读取时的
  // 弃用兼容而存在，后续版本可连同旧参数一起删除。
  const refProp = props.ref;

  // 为兼容旧元素形状，把未定义 ref 归一为 `null`。
  const ref = refProp !== undefined ? refProp : null;

  let element;
  if (__DEV__) {
    // 开发环境把 `ref` 定义为带警告的不可枚举属性，避免测试 matcher/序列化器遍历时误触告警。
    //
    // 未来版本会从元素对象彻底移除该兼容属性。
    element = {
      // 品牌字段让 renderer 与公共校验 API 唯一识别 ReactElement。
      $$typeof: REACT_ELEMENT_TYPE,

      // 元素自身携带的内建身份字段。
      type,
      key,

      props,

      // 记录创建该元素的组件，供开发态 owner 栈与 key 告警使用。
      _owner: owner,
    };
    if (ref !== null) {
      Object.defineProperty(element, 'ref', {
        enumerable: false,
        get: elementRefGetterWithDeprecationWarning,
      });
    } else {
      // 没有 ref 时直接定义空值而不安装 getter，减少测试序列化器通过
      // `getOwnPropertyDescriptors`（如 Jest）绕过不可枚举性所造成的误告警。
      //
      // 相应地，真正含 ref 的元素在 Jest 打印如下 diff 时仍可能误触告警：
      //
      //   expect(<div ref={ref} />).toEqual(<span ref={ref} />);
      //
      // 这是折中方案，但与多年沿用的 `props.key`/`props.ref` getter 行为一致。
      Object.defineProperty(element, 'ref', {
        enumerable: false,
        value: null,
      });
    }
  } else {
    // 生产环境中 `ref` 是普通属性，且不保留仅供诊断的 `_owner`。
    element = {
      // 品牌字段让 renderer 与公共校验 API 唯一识别 ReactElement。
      $$typeof: REACT_ELEMENT_TYPE,

      // renderer 消费的内建元素字段。
      type,
      key,
      ref,

      props,
    };
  }

  if (__DEV__) {
    // 校验标记仍需可变，因此放入外部 backing store，元素主体才能整体冻结。等目标开发环境
    // 普遍具备合适 WeakMap 支持后，可改为真正的外部弱映射。
    element._store = {};

    // 把校验标记设为不可枚举，使测试框架比较 ReactElement 时忽略内部状态；测试目标环境均应支持。
    Object.defineProperty(element._store, 'validated', {
      configurable: false,
      enumerable: false,
      writable: true,
      value: 0,
    });
    // `_debugInfo` 保存服务端组件传递下来的调试信息，且不参与元素结构比较。
    Object.defineProperty(element, '_debugInfo', {
      configurable: false,
      enumerable: false,
      writable: true,
      value: null,
    });
    Object.defineProperty(element, '_debugStack', {
      configurable: false,
      enumerable: false,
      writable: true,
      value: debugStack,
    });
    Object.defineProperty(element, '_debugTask', {
      configurable: false,
      enumerable: false,
      writable: true,
      value: debugTask,
    });
    if (Object.freeze) {
      Object.freeze(element.props);
      Object.freeze(element);
    }
  }

  return element;
}

/**
 * 自动 JSX transform 在生产语义下调用的元素工厂（RFC 107）。
 *
 * 它从编译器提供的新配置对象中提取 key；未展开 key 时可直接复用配置对象，减少一次复制。
 * 规范背景：https://github.com/reactjs/rfcs/pull/107
 *
 * @param type 元素类型。
 * @param config 编译器生成的 props 配置对象。
 * @param maybeKey 独立传入的静态 key，优先级低于配置中的有效 key。
 * @returns 新建的 ReactElement。
 */
export function jsxProd(type, config, maybeKey) {
  let key = null;

  // 当前仍允许通过展开 props 带入 key，与显式 key 并存时会产生优先级歧义（例如两种展开
  // 顺序）。在彻底弃用 key 展开前，除 `<div {...props} key="Hi" />` 外统一走 jsxDEV；
  // 该特例仍无法区分显式 `undefined` 与未声明 key。
  if (maybeKey !== undefined) {
    if (enableOptimisticKey && maybeKey === REACT_OPTIMISTIC_KEY) {
      key = REACT_OPTIMISTIC_KEY;
    } else {
      if (__DEV__) {
        checkKeyStringCoercion(maybeKey);
      }
      key = '' + maybeKey;
    }
  }

  if (hasValidKey(config)) {
    if (enableOptimisticKey && maybeKey === REACT_OPTIMISTIC_KEY) {
      key = REACT_OPTIMISTIC_KEY;
    } else {
      if (__DEV__) {
        checkKeyStringCoercion(config.key);
      }
      key = '' + config.key;
    }
  }

  let props;
  if (!('key' in config)) {
    // 未展开 key 时直接复用原 props 对象。仅 `jsx` 可安全这样做，因为编译器保证每次传入
    // 新对象；手工可调用的 `createElement` 不能作此假设。
    //
    // 开发态会对展开 key 告警。未来版本计划即使告警也不再从 props 删除 key，而总是原样透传。
    props = config;
  } else {
    // key 出现在配置对象时新建 props 并复制非保留字段。避免使用 `delete`，因为 V8 会把对象
    // 退化为字典模式；`ref` 已是普通 prop，此处实际只剔除 key。
    props = {};
    for (const propName in config) {
      // 跳过属于元素身份而非组件 props 的保留名称。
      if (propName !== 'key') {
        props[propName] = config[propName];
      }
    }
  }

  return ReactElement(type, key, props, getOwner(), undefined, undefined);
}

/**
 * 开发构建中实现生产 `jsx` 签名的动态 children 适配器。
 *
 * `jsxDEV` 不会在生产运行，但开发环境必须接受第三方依赖预编译出的生产 `jsx/jsxs` 调用，
 * 才能继续提供校验告警。仅开发态允许多一层调用；生产实现不采用此模式，以免增加栈帧。
 */
export function jsxProdSignatureRunningInDevWithDynamicChildren(
  type,
  config,
  maybeKey,
) {
  if (__DEV__) {
    const isStaticChildren = false;
    const trackActualOwner =
      __DEV__ &&
      ReactSharedInternals.recentlyCreatedOwnerStacks++ < ownerStackLimit;
    let debugStackDEV = false;
    if (__DEV__) {
      if (trackActualOwner) {
        const previousStackTraceLimit = Error.stackTraceLimit;
        Error.stackTraceLimit = ownerStackTraceLimit;
        debugStackDEV = Error('react-stack-top-frame');
        Error.stackTraceLimit = previousStackTraceLimit;
      } else {
        debugStackDEV = unknownOwnerDebugStack;
      }
    }

    return jsxDEVImpl(
      type,
      config,
      maybeKey,
      isStaticChildren,
      debugStackDEV,
      __DEV__ &&
        (trackActualOwner
          ? createTask(getTaskName(type))
          : unknownOwnerDebugTask),
    );
  }
}

/**
 * 开发构建中实现生产 `jsxs` 签名的静态 children 适配器。
 * 静态标记让 `jsxDEVImpl` 逐项校验并冻结编译器生成的 children 数组。
 */
export function jsxProdSignatureRunningInDevWithStaticChildren(
  type,
  config,
  maybeKey,
) {
  if (__DEV__) {
    const isStaticChildren = true;
    const trackActualOwner =
      __DEV__ &&
      ReactSharedInternals.recentlyCreatedOwnerStacks++ < ownerStackLimit;
    let debugStackDEV = false;
    if (__DEV__) {
      if (trackActualOwner) {
        const previousStackTraceLimit = Error.stackTraceLimit;
        Error.stackTraceLimit = ownerStackTraceLimit;
        debugStackDEV = Error('react-stack-top-frame');
        Error.stackTraceLimit = previousStackTraceLimit;
      } else {
        debugStackDEV = unknownOwnerDebugStack;
      }
    }
    return jsxDEVImpl(
      type,
      config,
      maybeKey,
      isStaticChildren,
      debugStackDEV,
      __DEV__ &&
        (trackActualOwner
          ? createTask(getTaskName(type))
          : unknownOwnerDebugTask),
    );
  }
}

/** 按组件与 props 形状去重记录 key 展开告警。 */
const didWarnAboutKeySpread = {};

/**
 * 自动 JSX transform 的开发入口（RFC 107），采集 owner 栈后委托统一实现。
 *
 * 规范背景：https://github.com/reactjs/rfcs/pull/107
 *
 * @param type 元素类型。
 * @param config 编译器生成的 props 配置对象。
 * @param maybeKey 独立传入的静态 key。
 * @param isStaticChildren children 是否由编译器判定为静态数组。
 * @returns 带开发态校验与调试信息的 ReactElement。
 */
export function jsxDEV(type, config, maybeKey, isStaticChildren) {
  const trackActualOwner =
    __DEV__ &&
    ReactSharedInternals.recentlyCreatedOwnerStacks++ < ownerStackLimit;
  let debugStackDEV = false;
  if (__DEV__) {
    if (trackActualOwner) {
      const previousStackTraceLimit = Error.stackTraceLimit;
      Error.stackTraceLimit = ownerStackTraceLimit;
      debugStackDEV = Error('react-stack-top-frame');
      Error.stackTraceLimit = previousStackTraceLimit;
    } else {
      debugStackDEV = unknownOwnerDebugStack;
    }
  }
  return jsxDEVImpl(
    type,
    config,
    maybeKey,
    isStaticChildren,
    debugStackDEV,
    __DEV__ &&
      (trackActualOwner
        ? createTask(getTaskName(type))
        : unknownOwnerDebugTask),
  );
}

/**
 * 执行开发 JSX 的 children/key 校验、props 归一化与元素创建。
 *
 * 无效元素类型的错误由 renderer 报告，因为只有具体 renderer 知道可接受类型；这里仍完成
 * 与类型无关的 key 校验，保证修复类型后不会掩盖下一层问题。
 */
function jsxDEVImpl(
  type,
  config,
  maybeKey,
  isStaticChildren,
  debugStack,
  debugTask,
) {
  if (__DEV__) {
    // 此处不对无效元素类型告警：owner 栈已允许 renderer 在掌握自身合法类型集合时给出更准确错误。

    // 旧逻辑会因 key 校验不接受非字符串/函数类型而跳过无效类型，避免开发/生产异常行为不同；
    // owner 栈方案不再依赖这里的类型，因此现在即使类型无效也可安全执行下方 key 校验。
    const children = config.children;
    if (children !== undefined) {
      if (isStaticChildren) {
        if (isArray(children)) {
          for (let i = 0; i < children.length; i++) {
            validateChildKeys(children[i]);
          }

          if (Object.freeze) {
            Object.freeze(children);
          }
        } else {
          console.error(
            'React.jsx: Static children should always be an array. ' +
              'You are likely explicitly calling React.jsxs or React.jsxDEV. ' +
              'Use the Babel transform instead.',
          );
        }
      } else {
        validateChildKeys(children);
      }
    }

    // 无论元素类型是否合法都报告 key 展开，因为该问题只取决于配置对象形状。
    if (hasOwnProperty.call(config, 'key')) {
      const componentName = getComponentNameFromType(type);
      const keys = Object.keys(config).filter(k => k !== 'key');
      const beforeExample =
        keys.length > 0
          ? '{key: someKey, ' + keys.join(': ..., ') + ': ...}'
          : '{key: someKey}';
      if (!didWarnAboutKeySpread[componentName + beforeExample]) {
        const afterExample =
          keys.length > 0 ? '{' + keys.join(': ..., ') + ': ...}' : '{}';
        console.error(
          'A props object containing a "key" prop is being spread into JSX:\n' +
            '  let props = %s;\n' +
            '  <%s {...props} />\n' +
            'React keys must be passed directly to JSX without using spread:\n' +
            '  let props = %s;\n' +
            '  <%s key={someKey} {...props} />',
          beforeExample,
          componentName,
          afterExample,
          componentName,
        );
        didWarnAboutKeySpread[componentName + beforeExample] = true;
      }
    }

    let key = null;

    // 当前仍允许通过展开 props 带入 key，与显式 key 并存时会产生优先级歧义。弃用过渡期除
    // `<div {...props} key="Hi" />` 外统一走 jsxDEV；该特例仍无法区分显式 `undefined`。
    if (maybeKey !== undefined) {
      if (enableOptimisticKey && maybeKey === REACT_OPTIMISTIC_KEY) {
        key = REACT_OPTIMISTIC_KEY;
      } else {
        if (__DEV__) {
          checkKeyStringCoercion(maybeKey);
        }
        key = '' + maybeKey;
      }
    }

    if (hasValidKey(config)) {
      if (enableOptimisticKey && config.key === REACT_OPTIMISTIC_KEY) {
        key = REACT_OPTIMISTIC_KEY;
      } else {
        if (__DEV__) {
          checkKeyStringCoercion(config.key);
        }
        key = '' + config.key;
      }
    }

    let props;
    if (!('key' in config)) {
      // 未展开 key 时直接复用原 props。编译器保证 `jsx` 每次传入新对象；手工可调用的
      // `createElement` 不具备这一保证。
      //
      // 未来版本计划对展开 key 继续告警，但不再从对象删除它，而总是原样透传。
      props = config;
    } else {
      // key 出现在配置对象时新建 props 并复制非保留字段；避免 `delete` 导致 V8 对象退化为
      // 字典模式。`ref` 已是普通 prop，此处实际只剔除 key。
      props = {};
      for (const propName in config) {
        // 跳过属于元素身份而非组件 props 的保留名称。
        if (propName !== 'key') {
          props[propName] = config[propName];
        }
      }
    }

    if (key) {
      const displayName =
        typeof type === 'function'
          ? type.displayName || type.name || 'Unknown'
          : type;
      defineKeyPropWarningGetter(props, displayName);
    }

    return ReactElement(type, key, props, getOwner(), debugStack, debugTask);
  }
}

/**
 * 创建并返回给定类型的 ReactElement。
 *
 * 与编译器专用 `jsx` 不同，此 API 可手工调用，因此总是复制配置对象；同时支持可变数量 children、
 * `defaultProps` 与旧 JSX transform 诊断。
 * 参考：https://reactjs.org/docs/react-api.html#createelement
 */
export function createElement(type, config, children) {
  if (__DEV__) {
    // 此处不对无效元素类型告警；具体 renderer 才知道自身可接受类型，并能结合 owner 栈报错。

    // 逐个校验位置参数中的 children key；类型错误会在渲染阶段先报告，修复后 key 告警仍可出现。
    for (let i = 2; i < arguments.length; i++) {
      validateChildKeys(arguments[i]);
    }

    // 与编译器 `jsx()` 不同，手工 `createElement()` 不对 key 展开发出迁移告警。
  }

  let propName;

  // props 使用新对象承载，保留名称会在复制时单独提取或过滤。
  const props = {};

  let key = null;

  if (config != null) {
    if (__DEV__) {
      if (
        !didWarnAboutOldJSXRuntime &&
        '__self' in config &&
        // 若存在 key，不能据此判定为旧 JSX transform：现代 transform 有时也会输出
        // `createElement`，以保留静态 key 与展开 key 的优先级；因此有 key 时不告警，避免误报。
        !('key' in config)
      ) {
        didWarnAboutOldJSXRuntime = true;
        console.warn(
          'Your app (or one of its dependencies) is using an outdated JSX ' +
            'transform. Update to the modern JSX transform for ' +
            'faster performance: https://react.dev/link/new-jsx-transform',
        );
      }
    }

    if (hasValidKey(config)) {
      if (enableOptimisticKey && config.key === REACT_OPTIMISTIC_KEY) {
        key = REACT_OPTIMISTIC_KEY;
      } else {
        if (__DEV__) {
          checkKeyStringCoercion(config.key);
        }
        key = '' + config.key;
      }
    }

    // 把剩余自有属性复制到新 props 对象。
    for (propName in config) {
      if (
        hasOwnProperty.call(config, propName) &&
        // 跳过属于元素身份而非组件 props 的保留名称。
        propName !== 'key' &&
        // 运行时已不再使用 `__self`/`__source`，但仍不应把它们暴露为 props。`createElement`
        // 需要显式过滤；自动 JSX transform 会通过独立参数传递，因此没有此问题。
        propName !== '__self' &&
        propName !== '__source'
      ) {
        props[propName] = config[propName];
      }
    }
  }

  // children 可以是多个位置参数；一个值直接保存，多个值按顺序打包到新数组。
  const childrenLength = arguments.length - 2;
  if (childrenLength === 1) {
    props.children = children;
  } else if (childrenLength > 1) {
    const childArray = Array(childrenLength);
    for (let i = 0; i < childrenLength; i++) {
      childArray[i] = arguments[i + 2];
    }
    if (__DEV__) {
      if (Object.freeze) {
        Object.freeze(childArray);
      }
    }
    props.children = childArray;
  }

  // 仅用 defaultProps 填充值为 `undefined` 的字段，显式 `null` 等值保持不变。
  if (type && type.defaultProps) {
    const defaultProps = type.defaultProps;
    for (propName in defaultProps) {
      if (props[propName] === undefined) {
        props[propName] = defaultProps[propName];
      }
    }
  }
  if (__DEV__) {
    if (key) {
      const displayName =
        typeof type === 'function'
          ? type.displayName || type.name || 'Unknown'
          : type;
      defineKeyPropWarningGetter(props, displayName);
    }
  }
  const trackActualOwner =
    __DEV__ &&
    ReactSharedInternals.recentlyCreatedOwnerStacks++ < ownerStackLimit;
  let debugStackDEV = false;
  if (__DEV__) {
    if (trackActualOwner) {
      const previousStackTraceLimit = Error.stackTraceLimit;
      Error.stackTraceLimit = ownerStackTraceLimit;
      debugStackDEV = Error('react-stack-top-frame');
      Error.stackTraceLimit = previousStackTraceLimit;
    } else {
      debugStackDEV = unknownOwnerDebugStack;
    }
  }
  return ReactElement(
    type,
    key,
    props,
    getOwner(),
    debugStackDEV,
    __DEV__ &&
      (trackActualOwner
        ? createTask(getTaskName(type))
        : unknownOwnerDebugTask),
  );
}

/**
 * 只替换元素 key，并继承 props、owner、调试信息与开发态 key 校验状态。
 * `React.Children` 用它在展平/映射后重写身份而不改变元素载荷。
 */
export function cloneAndReplaceKey(oldElement, newKey) {
  const clonedElement = ReactElement(
    oldElement.type,
    newKey,
    oldElement.props,
    !__DEV__ ? undefined : oldElement._owner,
    __DEV__ && oldElement._debugStack,
    __DEV__ && oldElement._debugTask,
  );
  if (__DEV__) {
    // 克隆元素继承原元素的 key 校验状态，避免重写 key 后重复或丢失告警。
    if (oldElement._store) {
      clonedElement._store.validated = oldElement._store.validated;
    }
  }
  return clonedElement;
}

/**
 * 以现有元素为起点，合并配置与 children 后返回新的 ReactElement。
 *
 * 新 key/ref 会改变对应身份或 owner，其余 props 覆盖原值；调试栈仍指向原元素创建位置。
 * 参考：https://reactjs.org/docs/react-api.html#cloneelement
 */
export function cloneElement(element, config, children) {
  if (element === null || element === undefined) {
    throw new Error(
      `The argument must be a React element, but you passed ${element}.`,
    );
  }

  let propName;

  // 先浅复制原 props，确保克隆过程不修改输入元素。
  const props = assign({}, element.props);

  // key 属于元素身份，单独提取而不放进 props。
  let key = element.key;

  // 默认保留原 owner；显式覆盖 ref 时，责任转移给当前创建者。
  let owner = !__DEV__ ? undefined : element._owner;

  if (config != null) {
    if (hasValidRef(config)) {
      owner = __DEV__ ? getOwner() : undefined;
    }
    if (hasValidKey(config)) {
      if (enableOptimisticKey && config.key === REACT_OPTIMISTIC_KEY) {
        key = REACT_OPTIMISTIC_KEY;
      } else {
        if (__DEV__) {
          checkKeyStringCoercion(config.key);
        }
        key = '' + config.key;
      }
    }

    // 剩余配置字段覆盖已复制的原 props。
    for (propName in config) {
      if (
        hasOwnProperty.call(config, propName) &&
        // 跳过属于元素身份而非组件 props 的保留名称。
        propName !== 'key' &&
        // `__self`/`__source` 仍被开发态告警和调试信息依赖，暂时过滤而不复制。自动 JSX runtime
        // 通过独立参数传递它们；长期目标是完全解除依赖，以便从 Fiber 内部字段删除。
        propName !== '__self' &&
        propName !== '__source' &&
        // `cloneElement` 把值为 `undefined` 的 ref 视作未提供，保留旧 ref；这是历史兼容语义。
        !(propName === 'ref' && config.ref === undefined)
      ) {
        props[propName] = config[propName];
      }
    }
  }

  // children 位置参数会覆盖原 props.children：一个值直接保存，多个值按顺序打包。
  const childrenLength = arguments.length - 2;
  if (childrenLength === 1) {
    props.children = children;
  } else if (childrenLength > 1) {
    const childArray = Array(childrenLength);
    for (let i = 0; i < childrenLength; i++) {
      childArray[i] = arguments[i + 2];
    }
    props.children = childArray;
  }

  const clonedElement = ReactElement(
    element.type,
    key,
    props,
    owner,
    __DEV__ && element._debugStack,
    __DEV__ && element._debugTask,
  );

  for (let i = 2; i < arguments.length; i++) {
    validateChildKeys(arguments[i]);
  }

  return clonedElement;
}

/**
 * 标记静态位置中的元素已经通过 key 校验。
 *
 * 静态 JSX 位置不需要显式 key；数组/动态位置则由后续 renderer 依据该标记决定是否告警。
 * 已兑现 Lazy 会把标记传递给其元素值，未兑现 Lazy 则记录在自身 store 上。
 *
 * @internal
 * @param node 静态传入的任意 React 子节点。
 */
function validateChildKeys(node) {
  if (__DEV__) {
    // 标记元素位于合法静态 child 位置，因此无需显式 key。
    if (isValidElement(node)) {
      if (node._store) {
        node._store.validated = 1;
      }
    } else if (isLazyType(node)) {
      if (node._payload.status === 'fulfilled') {
        if (isValidElement(node._payload.value) && node._payload.value._store) {
          node._payload.value._store.validated = 1;
        }
      } else if (node._store) {
        node._store.validated = 1;
      }
    }
  }
}

/**
 * 通过对象形状与品牌字段验证值是否为 ReactElement。
 * 参考：https://reactjs.org/docs/react-api.html#isvalidelement
 *
 * @param object 待检查的任意值。
 * @returns 值是否为当前协议的 ReactElement。
 * @final
 */
export function isValidElement(object) {
  return (
    typeof object === 'object' &&
    object !== null &&
    object.$$typeof === REACT_ELEMENT_TYPE
  );
}

/** 通过对象形状与品牌字段判断值是否为 React Lazy 类型描述符。 */
export function isLazyType(object) {
  return (
    typeof object === 'object' &&
    object !== null &&
    object.$$typeof === REACT_LAZY_TYPE
  );
}
