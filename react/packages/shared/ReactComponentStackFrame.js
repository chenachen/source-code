/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {disableLogs, reenableLogs} from 'shared/ConsolePatchingDev';

import ReactSharedInternals from 'shared/ReactSharedInternals';

import DefaultPrepareStackTrace from 'shared/DefaultPrepareStackTrace';

import {formatOwnerStack} from './ReactOwnerStackFrames';

let prefix;
let suffix;
/** 使用当前 VM 的原生栈前缀，为内建 React 类型合成一个对齐的 frame。 */
export function describeBuiltInComponentFrame(name: string): string {
  if (prefix === undefined) {
    // 首次调用时从真实 Error 中提取当前 VM 每行使用的前缀与匿名位置后缀。
    try {
      throw Error();
    } catch (x) {
      const match = x.stack.trim().match(/\n( *(at )?)/);
      prefix = (match && match[1]) || '';
      suffix =
        x.stack.indexOf('\n    at') > -1
          ? // V8
            ' (<anonymous>)'
          : // JSC/Spidermonkey
            x.stack.indexOf('@') > -1
            ? '@unknown:0:0'
            : // 其他引擎
              '';
    }
  }
  // 复用原生前缀，使合成行与浏览器/VM 产生的 frame 对齐。
  return '\n' + prefix + name + suffix;
}

/** 优先从 debug location 恢复真实 frame，否则按名称和环境合成 frame。 */
export function describeDebugInfoFrame(
  name: string,
  env: ?string,
  location: ?Error,
): string {
  if (location != null) {
    // location 是 child 的 owner stack；最底部 frame 对应该函数的创建位置。
    const childStack = formatOwnerStack(location);
    const idx = childStack.lastIndexOf('\n');
    const lastLine = idx === -1 ? childStack : childStack.slice(idx + 1);
    if (lastLine.indexOf(name) !== -1) {
      // 异步 stack 可能缺少 owner；只有 frame 明确含函数名时才采用，避免错配位置。
      return '\n' + lastLine;
    }
  }

  return describeBuiltInComponentFrame(name + (env ? ' [' + env + ']' : ''));
}

let reentry = false;
let componentFrameCache;
if (__DEV__) {
  // 以组件函数为键缓存采样结果；WeakMap 不阻止函数回收，旧环境的 Map 回退则会保留这些开发诊断引用。
  const PossiblyWeakMap = typeof WeakMap === 'function' ? WeakMap : Map;
  componentFrameCache = new PossiblyWeakMap<Function, string>();
}

/**
 * 借助浏览器/VM 的原生错误栈，为单个组件恢复文件名、行列等 frame 信息。
 *
 * @remarks
 * 先在受控函数中抛出并捕获 control error，再调用组件得到 sample error，最后比较两条
 * stack，找出只存在于 sample 的组件 frame。重放期间会清空 dispatcher、屏蔽 console
 * 并替换 `Error.prepareStackTrace`，进入取样 try 后的退出路径都经 `finally` 恢复。
 * 初始化 dispatcher/console 的 patch 在该 try 之前；初始化本身若抛错，不属于下方 finally 的保护范围。
 * DEV 缓存按组件函数存 frame，命中时不会再次执行组件；无法取样时缓存按名称合成的回退行。
 * @param construct - class 路径需通过构造调用制造 sample 栈；函数路径直接调用 fn，刻意不给真实 props/Hook dispatcher。
 * @returns 代表目标组件的单行原生或合成 frame；重入和无可用名称时可以为空串。
 */
export function describeNativeComponentFrame(
  fn: Function,
  construct: boolean,
): string {
  // fake render 内再次请求 stack 会递归重放，直接忽略。
  if (!fn || reentry) {
    return '';
  }

  if (__DEV__) {
    const frame = componentFrameCache.get(fn);
    if (frame !== undefined) {
      return frame;
    }
  }

  reentry = true;
  const previousPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = DefaultPrepareStackTrace;
  let previousDispatcher = null;

  if (__DEV__) {
    previousDispatcher = ReactSharedInternals.H;
    // 此辅助函数可能在为 render warning 取栈时调用；清空 dispatcher，避免重放组件把
    // hooks 当作真实 render 执行。
    ReactSharedInternals.H = null;
    disableLogs();
  }
  try {
    /**
     * 不同 VM 截断 stack 的方式和深度不同，直接猜共同 frame 不可靠。这里让 sample 与
     * control 都经过同一个对象方法，并固定其 `name`/`displayName`，从而主动注入两条
     * stack 都应包含的 `DetermineComponentFrameRoot` 锚点。
     */
    const RunInRootFrame = {
      /** 在同一命名根方法中分别捕获 sample/control stack，供外层做差分。 */
      DetermineComponentFrameRoot(): [?string, ?string] {
        let control;
        try {
          // 两个分支都必须有意抛错，才能得到可比较的原生 stack。
          if (construct) {
            // class constructor 通常会设置 props；用抛错 setter 固定 sample/control 位置。
            /** 构造 control stack，并在 `props` 被赋值时抛错。 */
            const Fake = function () {
              throw Error();
            };
            // $FlowFixMe[prop-missing]
            Object.defineProperty(Fake.prototype, 'props', {
              /** 非 strict mode 下也能稳定抛错的 props setter。 */
              set: function () {
                // frozen/non-writable props 在非 strict mode 中不一定抛错，因此使用 setter。
                throw Error();
              },
            });
            if (typeof Reflect === 'object' && Reflect.construct) {
              // Reflect.construct 会增加额外 frame，control 必须走同一构造路径。
              try {
                Reflect.construct(Fake, []);
              } catch (x) {
                control = x;
              }
              Reflect.construct(fn, [], Fake);
            } else {
              try {
                Fake.call();
              } catch (x) {
                control = x;
              }

              let prototypeModified = false;
              let prevProps;
              try {
                prevProps = Object.getOwnPropertyDescriptor(
                  fn.prototype,
                  'props',
                );
                Object.defineProperty(fn.prototype, 'props', {
                  configurable: true,
                  /** 在 class constructor 写 props 时产生 sample stack。 */
                  set() {
                    throw Error();
                  },
                });
                prototypeModified = true;

                // eslint-disable-next-line no-new
                new fn();
              } finally {
                if (prototypeModified) {
                  if (prevProps !== undefined) {
                    Object.defineProperty(fn.prototype, 'props', prevProps);
                  } else {
                    delete fn.prototype.props;
                  }
                }
              }
            }
          } else {
            try {
              throw Error();
            } catch (x) {
              control = x;
            }
            // TODO(luna)：当前只有函数组件访问 React/ReactDOM/props 时才会抛错；简单组件
            // 也应有稳定的取样触发点。
            const maybePromise = fn();

            // 返回 Promise 通常表示尚不支持的 async client component；挂空 catch 避免
            // 仅为取 stack 的重放产生未处理 rejection。
            // TODO：实现 async client component 的 component stack。
            if (maybePromise && typeof maybePromise.catch === 'function') {
              maybePromise.catch(() => {});
            }
          }
        } catch (sample) {
          // Closure 未自动内联该短路径，这里手工保持直接返回以减少 frame 噪音。
          if (sample && control && typeof sample.stack === 'string') {
            return [sample.stack, control.stack];
          }
        }
        return [null, null];
      },
    };
    // $FlowFixMe[prop-missing]
    RunInRootFrame.DetermineComponentFrameRoot.displayName =
      'DetermineComponentFrameRoot';
    const namePropDescriptor = Object.getOwnPropertyDescriptor(
      RunInRootFrame.DetermineComponentFrameRoot,
      'name',
    );
    // ES6 之前函数 `name` 不可配置，只在 descriptor 允许时固定锚点名。
    if (namePropDescriptor && namePropDescriptor.configurable) {
      // V8 生成 stack 时读取函数 `name`。
      Object.defineProperty(
        RunInRootFrame.DetermineComponentFrameRoot,
        // configurable property 即使 writable 为 false 也能重新 define。
        // $FlowFixMe[cannot-write]
        'name',
        {value: 'DetermineComponentFrameRoot'},
      );
    }

    const [sampleStack, controlStack] =
      RunInRootFrame.DetermineComponentFrameRoot();
    if (sampleStack && controlStack) {
      // 提取 sample 中首个不属于 control 的 frame，并跳过调用二者的共同外层 frame。
      const sampleLines = sampleStack.split('\n');
      const controlLines = controlStack.split('\n');
      let s = 0;
      let c = 0;
      while (
        s < sampleLines.length &&
        !sampleLines[s].includes('DetermineComponentFrameRoot')
      ) {
        s++;
      }
      while (
        c < controlLines.length &&
        !controlLines[c].includes('DetermineComponentFrameRoot')
      ) {
        c++;
      }
      // 若 VM 截断了主动注入的根锚点，则从 control 底部寻找另一个共同根 frame。
      if (s === sampleLines.length || c === controlLines.length) {
        s = sampleLines.length - 1;
        c = controlLines.length - 1;
        while (s >= 1 && c >= 0 && sampleLines[s] !== controlLines[c]) {
          // 两条 stack 至少应共享一个根 frame。达到 VM 最大深度时二者可能在不同位置被
          // 截断；假定 sample 不短于 control，在 control 中反向寻找 sample 的最底 frame。
          c--;
        }
      }
      for (; s >= 1 && c >= 0; s--, c--) {
        // 共同尾部向上遇到的首个差异，应是进入 sample 组件与 control 的分叉 frame。
        if (sampleLines[s] !== controlLines[c]) {
          // V8 首行是错误消息而其他 VM 未必如此。若差异落在双方首行，通常表示 sample
          // 在进入组件前就与 control 同行抛错，例如把 class 或非函数当函数组件调用；
          // 该结果不能代表组件 frame。
          if (s !== 1 || c !== 1) {
            do {
              s--;
              c--;
              // construct 可能插入相似中间 frame，继续寻找下一处差异。
              if (c < 0 || sampleLines[s] !== controlLines[c]) {
                // V8 会给原生 class 添加 `new` 前缀；移除后与普通组件 frame 格式一致。
                let frame = '\n' + sampleLines[s].replace(' at new ', ' at ');

                // VM 标为 `<anonymous>` 而用户提供 displayName 时，用后者提升可读性。
                if (fn.displayName && frame.includes('<anonymous>')) {
                  frame = frame.replace('<anonymous>', fn.displayName);
                }

                if (__DEV__) {
                  if (typeof fn === 'function') {
                    componentFrameCache.set(fn, frame);
                  }
                }
                // 只返回代表目标组件的单行 frame。
                return frame;
              }
            } while (s >= 1 && c >= 0);
          }
          break;
        }
      }
    }
  } finally {
    reentry = false;
    if (__DEV__) {
      ReactSharedInternals.H = previousDispatcher;
      reenableLogs();
    }
    Error.prepareStackTrace = previousPrepareStackTrace;
  }
  // 无法稳定制造 sample error 时，退回按 displayName/name 合成 frame。
  const name = fn ? fn.displayName || fn.name : '';
  const syntheticFrame = name ? describeBuiltInComponentFrame(name) : '';
  if (__DEV__) {
    if (typeof fn === 'function') {
      componentFrameCache.set(fn, syntheticFrame);
    }
  }
  return syntheticFrame;
}

/** 以 constructor 模式为 class component 恢复原生 frame。 */
export function describeClassComponentFrame(ctor: Function): string {
  return describeNativeComponentFrame(ctor, true);
}

/** 以直接调用模式为 function component 恢复原生 frame。 */
export function describeFunctionComponentFrame(fn: Function): string {
  return describeNativeComponentFrame(fn, false);
}
