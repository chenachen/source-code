/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ViewTransitionClass, ViewTransitionProps} from 'shared/ReactTypes';
import type {FiberRoot} from './ReactInternalTypes';
import type {ViewTransitionInstance, Instance} from './ReactFiberConfig';

import {
  getCommittingRoot,
  getPendingTransitionTypes,
} from './ReactFiberWorkLoop';

/** 单个 ViewTransition Fiber 跨 render/commit 保存的宿主配对与命名状态。 */
export type ViewTransitionState = {
  /** 未显式指定 name 时首次 commit 生成并稳定复用的 view-transition-name。 */
  autoName: null | string,
  /** commit 配对 old/new 边界期间临时指向另一侧状态。 */
  paired: null | ViewTransitionState,
  /** gesture apply 阶段为测量/动画克隆的宿主实例。 */
  clones: null | Array<Instance>,
  /** 当前暴露给 ref 的 HostConfig transition 实例，可随生命周期替换。 */
  ref: null | ViewTransitionInstance,
};

/** 当前客户端 realm 生成自动 transition 名称的单调编号。 */
let globalClientIdCounter: number = 0;

/** 返回显式名称或为当前 root 生成带 identifierPrefix 的稳定自动名称。 */
export function getViewTransitionName(
  props: ViewTransitionProps,
  instance: ViewTransitionState,
): string {
  if (props.name != null && props.name !== 'auto') {
    return props.name;
  }
  if (instance.autoName !== null) {
    return instance.autoName;
  }

  // 调用点必须位于 commit 阶段，才能从 work loop 读取 committing root。
  const root = getCommittingRoot() as any as FiberRoot;
  const identifierPrefix = root.identifierPrefix;
  const globalClientId = globalClientIdCounter++;
  const name =
    '_' + identifierPrefix + 't_' + globalClientId.toString(32) + '_';
  instance.autoName = name;
  return name;
}

/**
 * 按当前 pending transition types 解析 class 配置。
 * 字符串直接返回；映射中 `none` 优先于所有命中，多类型 class 以空格合并，无命中回退 default。
 */
function getClassNameByType(classByType: ?ViewTransitionClass): ?string {
  if (classByType == null || typeof classByType === 'string') {
    return classByType;
  }
  let className: ?string = null;
  const activeTypes = getPendingTransitionTypes();
  if (activeTypes !== null) {
    for (let i = 0; i < activeTypes.length; i++) {
      const match = classByType[activeTypes[i]];
      if (match != null) {
        if (match === 'none') {
          // 任一类型命中 "none" 都压过其他 class。
          return 'none';
        }
        if (className == null) {
          className = match;
        } else {
          className += ' ' + match;
        }
      }
    }
  }
  if (className == null) {
    // 没有活动类型命中时采用配置 default。
    return classByType.default;
  }
  return className;
}

/** 组合边界默认 class 与具体事件 class；事件配置存在时覆盖默认，`auto` 表示交给浏览器。 */
export function getViewTransitionClassName(
  defaultClass: ?ViewTransitionClass,
  eventClass: ?ViewTransitionClass,
): ?string {
  const className: ?string = getClassNameByType(defaultClass);
  const eventClassName: ?string = getClassNameByType(eventClass);
  if (eventClassName == null) {
    return className === 'auto' ? null : className;
  }
  if (eventClassName === 'auto') {
    return null;
  }
  return eventClassName;
}
