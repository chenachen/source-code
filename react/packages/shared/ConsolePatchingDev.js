/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 在为组件栈重放 render 函数时临时屏蔽 console，避免诊断重放产生重复日志。当前只惰性替换 console
// 对象上的方法；若用户早已提取方法引用则无法屏蔽，未来也可考虑提前 patch。

let disabledDepth = 0;
let prevLog;
let prevInfo;
let prevWarn;
let prevError;
let prevGroup;
let prevGroupCollapsed;
let prevGroupEnd;

/** 作为 console 方法占位，丢弃重放期间产生的日志。 */
function disabledLog() {}
disabledLog.__reactDisabledLog = true;

/**
 * 屏蔽组件栈诊断重放期间的 console 方法。
 *
 * @remarks `disabledDepth` 允许嵌套调用；只有从 0 变为 1 时保存并替换原方法。
 */
export function disableLogs(): void {
  if (__DEV__) {
    if (disabledDepth === 0) {
      /* eslint-disable react-internal/no-production-logging */
      prevLog = console.log;
      prevInfo = console.info;
      prevWarn = console.warn;
      prevError = console.error;
      prevGroup = console.group;
      prevGroupCollapsed = console.groupCollapsed;
      prevGroupEnd = console.groupEnd;
      // 用 defineProperties 替换仍可配置但不可直接赋值的方法，兼容 issue 19099；
      // 真正被冻结、不可配置的属性仍不能被重新定义。
      // https://github.com/facebook/react/issues/19099
      const props = {
        configurable: true,
        enumerable: true,
        value: disabledLog,
        writable: true,
      };
      // $FlowFixMe[cannot-write] Flow thinks console is immutable.
      Object.defineProperties(console, {
        info: props,
        log: props,
        warn: props,
        error: props,
        group: props,
        groupCollapsed: props,
        groupEnd: props,
      });
    }
    disabledDepth++;
  }
}

/** 恢复 `disableLogs` 保存的 console 方法；只有最外层调用退出时真正恢复。 */
export function reenableLogs(): void {
  if (__DEV__) {
    disabledDepth--;
    if (disabledDepth === 0) {
      const props = {
        configurable: true,
        enumerable: true,
        writable: true,
      };
      // $FlowFixMe[cannot-write] Flow thinks console is immutable.
      Object.defineProperties(console, {
        log: {...props, value: prevLog},
        info: {...props, value: prevInfo},
        warn: {...props, value: prevWarn},
        error: {...props, value: prevError},
        group: {...props, value: prevGroup},
        groupCollapsed: {...props, value: prevGroupCollapsed},
        groupEnd: {...props, value: prevGroupEnd},
      });
    }
    if (disabledDepth < 0) {
      console.error(
        'disabledDepth fell below zero. ' +
          'This is a bug in React. Please file an issue.',
      );
    }
  }
}
