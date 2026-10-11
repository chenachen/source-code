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

/**
 * 为 console.createTask 生成元素类型标签；Fragment 为 <>、lazy 为 <...>，不调用 lazy._init。
 * @param type 待显示的宿主/函数/包装类型。
 * @returns 带尖括号的名称或未知占位。普通名称解析错误被捕获；lazy 品牌检查在 try 外，其 getter 错误仍可传播。
 */
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

/**
 * 读取创建元素时异步 dispatcher 的 owner，供 ReactElement._owner 诊断；不是当前宿主父级。DEV 无 dispatcher 返回 null，生产直接 null；dispatcher.getOwner 错误原样传播，不缓存 owner。
 */
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

/**
 * 检查 config.ref 是否不是 undefined，供 cloneElement 决定 owner 是否转移；null 也是显式有效值。
 * @param config 非空配置对象；DEV 自有属性若是 React 警告 getter 则不读它。
 * @returns ref 是否提供；继承的 ref 也可被读取，用户 getter/proxy 异常不捕获。
 */
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

/**
 * 检查 config.key 是否不是 undefined，供工厂提取身份；null/空字符串仍是提供的值。
 * @param config 非空配置对象；DEV 过滤自有的 React 特殊 prop 警告 getter。
 * @returns key 是否提供；继承属性和用户 getter 可参与读取，异常直接传播。
 */
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
 * 在 DEV 的 props 上安装不可枚举、可配置的 key getter，阻止组件把元素身份当普通 prop。
 * @param props 即将交给 element 的配置对象；可能就是 JSX 调用者传入的 config。
 * @param displayName 首次告警使用的组件/宿主标签。
 * @returns 无结果；getter 返回 undefined，模块级布尔使所有类型合计只告警一次。属性安装失败不捕获，生产无操作。
 */
function defineKeyPropWarningGetter(props, displayName) {
  if (__DEV__) {
    /** key 访问器：第一次读取置模块去重标记并输出 displayName 诊断，每次均返回 undefined；不是读取 element.key 的代理。 */
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

/**
 * 以 element 为 this 兼容读取旧 ref；权威来源是 this.props.ref。DEV 按解析出的组件名去重（同名类型共享槽），undefined 归一为 null，其余值原样返回。名称/props getter 或 console 异常直接传播；生产不会安装此 getter，函数直接调用也无返回值。
 */
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
 * 由 JSX、createElement、克隆器共同构造带 $$typeof 品牌的普通对象，renderer 消费 type/key/props。
 * @param type 宿主标签、组件函数或 React 包装类型；此层不验证 renderer 是否接受。
 * @param key 已提取/编码的元素身份（通常 string/null，实验开关可为 optimistic Symbol）。
 * @param props 非空 props 对象，ref 保留为普通字段；这里不深复制，读取其 getter 可抛错。
 * @param owner DEV 创建者，供 key 诊断和 owner 栈；生产不存。
 * @param debugStack DEV 已采样 Error 或复用的未知栈，归属于元素创建位置。
 * @param debugTask DEV console task，供异步调试关联；此函数不结束/清理任务。
 * @returns 新 element；无 ref 的兼容字段为 null，DEV 有 ref 时安装弃用 getter。
 * DEV 浅冻结 element/props，嵌套数据仍共享；_store 是独立可变对象，validated 可更新。_debugInfo 等字段在 freeze 前设置，冻结后不能再改；生产不冻结也无调试字段。
 */
function ReactElement(type, key, props, owner, debugStack, debugTask) {
  // ref 从普通 prop 读取；element.ref 保留旧读取协议，DEV 的非空 ref getter 会报告弃用。
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
 * 自动 JSX 生产签名工厂，接收编译器每次新建的 config；生成 element，不挂载、不解析 lazy、不填 defaultProps。
 * @param type 原元素类型，具体合法性由 renderer 检查。
 * @param config 非空 props 配置，未含 key 时直接复用为 props；含（包括继承）key 时 for-in 复制除 key 外的可枚举字段，ref 不删除。
 * @param maybeKey 独立传入的 key，先采用它，再由有效 config.key 覆盖；字符串化可执行用户转换并抛错。
 * @returns 新 ReactElement；复用 config 时 DEV ReactElement 还会浅冻结调用者该对象。
 * 实验 optimistic 分支中本函数的 config-key 判断仍检查 maybeKey===REACT_OPTIMISTIC_KEY；因此与 jsxDEVImpl 检查 config.key 的分支不完全相同，不能把两者的所有 Symbol 输入概括为一致。
 */
export function jsxProd(type, config, maybeKey) {
  let key = null;

  // 先采用编译器独立传入的 key，再让 config 中的有效 key 覆盖它。静态 key 位于 spread
  // 之后且需保持属性顺序时，转换器可改用 createElement；本工厂本身不重建该源码顺序。
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
 * 开发构建接受已预编译的生产 jsx(type,config,maybeKey) 调用，固定 isStaticChildren=false 后委派 jsxDEVImpl。
 * type/config/maybeKey 分别是元素类型、非空编译 props 和独立 key；返回 DEV element，生产直接调用此适配器返回 undefined。
 * 每次创建消耗最近 owner 栈采样计数，额度内新建 Error/task，耗尽后共享未知栈/task；计数窗口由外部机制重置。本层临时修改 Error.stackTraceLimit 后普通赋值恢复，没有 finally；Error 构造异常可打断恢复。
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
 * 开发构建接受预编译的 jsxs(type,config,maybeKey)，固定 isStaticChildren=true 后委派 jsxDEVImpl。
 * type/config/maybeKey 是元素类型、非空编译 props 和独立 key；静态 children 必须是数组，将逐叶标记并浅冻结数组。返回 DEV element，生产直接调用此适配器返回 undefined。
 * 按 owner 栈额度采样或复用未知 Error/task；Error.stackTraceLimit 的临时设置仅在普通路径恢复，没有 finally。只标记静态位置，不展开 iterable 或启动 lazy。
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
 * 自动 JSX 开发编译入口，采样 owner 调试栈后委派 jsxDEVImpl。
 * @param type 元素类型，由 renderer 验证合法性。
 * @param config 非空编译器 props，可能被复用、装 key getter 和浅冻结。
 * @param maybeKey 独立 key，普通情况下低于有效 config.key。
 * @param isStaticChildren 静态数组标记；false 表示动态 children。
 * @returns DEV element；生产直接调用此函数会委派到无返回值的 DEV 实现。
 * recent owner 计数先递增，额度外共享未知 Error/task；临时 stackTraceLimit 普通路径恢复但无 finally。错误原样传播；本层不调 renderer、不执行组件或 lazy。
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
 * 统一开发 JSX 的 key、静态 children、props 复制与 owner 记录；具体 type 合法性留给 renderer，避免工厂抢先用不完整类型集合报错。
 * @param type 原元素类型。
 * @param config 非空编译 props；无 key 属性时直接复用，有 key 时 for-in 复制可枚举非 key 字段（可含继承字段）。
 * @param maybeKey 独立 key，先采用再由有效 config.key 覆盖；optimistic Symbol 由各输入自身判定。
 * @param isStaticChildren 静态 children 数组标记；为真但非数组只告警，不拒绝创建。
 * @param debugStack 创建位置采样 Error 或共享未知栈。
 * @param debugTask console task 或共享未知任务，不在本函数清理。
 * @returns DEV element；生产无操作、返回 undefined。
 * 静态数组逐项标记 validated 后冻结；动态值只标记直接 element，不展开数组/iterator/lazy。config 自有 key 按组件名和其余键形状去重告警；非空 key 才安装特殊 prop getter。无 defaultProps 合并；props/品牌 getter、字符串转换和调试调用异常直接传播。
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

    // 普通 key 先取独立参数再由 config 覆盖；optimistic 分支此处看 config.key，生产 jsxProd 的对应分支仍看 maybeKey。
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
 * 公开经典工厂，从 type/config 和可变 children 参数生成新的 ReactElement；与 JSX 工厂不同，每次建独立 props 对象。
 * @param type 原元素类型；此层不检查 renderer 接受的类型，不调用函数或 lazy。
 * @param config 可空输入，仅复制自有可枚举字段；提取 key，过滤旧 __self/__source，ref 作为普通 prop 保留。
 * @param children 第三个起的位置参数：没有参数保留 config.children，一个（包括 null/undefined）直接覆盖，多个变新数组且 DEV 浅冻结。
 * @returns 新 element；type.defaultProps 只填 undefined 字段，用户 getter/转换异常直接传播。
 * DEV 静态位置只标记直接 element，后续 renderer 再检查动态列表；旧 transform 提示依据 __self 存在且无 key，并全模块只告警一次。owner采样额度外共享未知调试数据；stackTraceLimit 临时设置无 finally。
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
 * Children 展平/映射时只替换 element.key，生成新外壳并复用原 props、type、DEV owner 和创建调试栈/task。
 * @param oldElement 已知 element；不重新验证品牌，读取其字段/getter 可抛错。
 * @param newKey 调用者已编码的映射路径，本层不字符串化或执行 key 合法性检查。
 * @returns 新 element，DEV 若旧 _store 存在则复制 validated 值；_store 本身新建且与旧对象分离，props 仍共享。
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
 * 公开克隆工厂，浅复制旧 props 并按 config/位置 children 合并；type 与创建 debugStack/task 保留，生成新外壳不挂载。
 * @param element 旧 element；只显式拒绝 null/undefined，其余无效形状可能在字段读取中失败，不先用 isValidElement 过滤。
 * @param config 可空配置，仅复制自有可枚举非 key/__self/__source 字段；undefined ref 被视为省略，自有 null ref 则显式覆盖且 DEV owner 改为当前创建者；继承的有效 ref 也会触发 owner 转移，但复制只取自有字段。
 * @param children 第三个起的位置参数：省略保留旧 children，一个（含 undefined）覆盖，多个变新数组，此处不显式冻结 childArray。
 * @returns 新 element，key 省略时沿用，有效新 key 替换；不重新按 defaultProps 填入 config 的 undefined。
 * 先创建外壳再标记位置 children 的 validated，可能共享并修改子元素 _store；字段 getter/用户转换异常直接传播，不回滚已触发的用户副作用。
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
        // 与经典 createElement 保持兼容，过滤旧 transform 的调试字段；自动 JSX runtime
        // 通过独立参数传入调试信息，其 props 中同名字段可以作为普通属性。
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
 * 标记直接处于静态位置的 element 已合法（_store.validated=1），供 renderer 对动态列表决定是否告警；不是遍历并报告全部缺 key 的校验器。
 * @param node 任意 child；数组/iterable 不在此展开。lazy 若 payload.status=fulfilled 则标记其已兑现 element，否则仅在自身有 _store 时标记。
 * @returns 无结果，生产无操作；不调用 lazy._init/then，不提前加载。只用品牌识别，伪 lazy 缺 _payload 或用户 getter 错误可抛出；元素冻结但 _store 仍可变。
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
 * 只通过非 null object 和 $$typeof 品牌判断当前 ReactElement 协议，不验证 type/props/key 完整性或所属 renderer。
 * @param object 任意待查值，函数和 null 返回 false；对象品牌 getter/proxy 错误可传播。
 * @returns 是否带当前品牌；手写含同一品牌的对象也能通过。
 * @final
 */
export function isValidElement(object) {
  return (
    typeof object === 'object' &&
    object !== null &&
    object.$$typeof === REACT_ELEMENT_TYPE
  );
}

/**
 * 只通过非 null object 和 $$typeof 品牌判断 lazy 描述形状，不检查 _payload/_init 是否存在，不执行初始化。
 * @param object 任意待查值；品牌 getter/proxy 错误可传播。
 * @returns 是否带 REACT_LAZY_TYPE 品牌；不能据此认定后续 payload 读取一定安全。
 */
export function isLazyType(object) {
  return (
    typeof object === 'object' &&
    object !== null &&
    object.$$typeof === REACT_LAZY_TYPE
  );
}
