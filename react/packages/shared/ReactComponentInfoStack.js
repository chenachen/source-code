/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactComponentInfo} from 'shared/ReactTypes';

import {describeBuiltInComponentFrame} from 'shared/ReactComponentStackFrame';

import {formatOwnerStack} from 'shared/ReactOwnerStackFrames';

/**
 * 沿 Server Component 的 `owner`/`debugStack` 链生成开发期 owner stack。
 *
 * @remarks 无 owner 的根组件没有可提取 frame，因此合成一个内建 frame；格式化失败只
 * 返回诊断文本，不能让生成错误信息的辅助路径再次抛错。
 */
export function getOwnerStackByComponentInfoInDev(
  componentInfo: ReactComponentInfo,
): string {
  if (!__DEV__) {
    return '';
  }
  try {
    let info = '';

    // 当前组件的 owner stack 指向它在 owner 内部的创建位置，不包含当前执行组件名；
    // 当前名通常来自正在执行的普通 stack。根组件没有 owner frame，因此需合成其名称，
    // 让调用方仍能知道哪个根组件正在执行。
    if (!componentInfo.owner && typeof componentInfo.name === 'string') {
      return describeBuiltInComponentFrame(componentInfo.name);
    }

    let owner: void | null | ReactComponentInfo = componentInfo;

    while (owner) {
      const ownerStack: ?Error = owner.debugStack;
      if (ownerStack != null) {
        // Server Component 的 debugStack 属于当前 owner；继续上移后再格式化上一层。
        owner = owner.owner;
        if (owner) {
          // TODO：评估是否应缓存格式化后的 owner frame。
          info += '\n' + formatOwnerStack(ownerStack);
        }
      } else {
        break;
      }
    }
    return info;
  } catch (x) {
    return '\nError generating stack: ' + x.message + '\n' + x.stack;
  }
}
