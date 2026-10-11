/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * SyntheticEvent 类的 Flow 类型，同时包含其私有属性。
 * @flow
 */

import type {Fiber} from 'react-reconciler/src/ReactInternalTypes';
import type {DOMEventName} from './DOMEventNames';

/** 事件插件的旧注册配置类型，描述原生依赖和 React handler 名称。 */
export type DispatchConfig = {
  /** 产生此事件的原生事件名列表。 */
  dependencies?: Array<DOMEventName>,
  /** 分别对应捕获与冒泡的 React handler 名称。 */
  phasedRegistrationNames: {
    /** 冒泡阶段 React handler 名。 */
    bubbled: null | string,
    /** 捕获阶段 React handler 名。 */
    captured: null | string,
  },
  /** 直接注册的 React handler 名。 */
  registrationName?: string,
};

/** 合成事件共享字段；派发时临时设置 currentTarget。 */
type BaseSyntheticEvent = {
  /** 现代 DOM 实现恒为 true，事件不放回池中。 */
  isPersistent: () => boolean,
  /** 读取 stopPropagation 改变的传播停止状态。 */
  isPropagationStopped: () => boolean,
  /** 旧事件派发字段，表示对应的 Fiber 身份。 */
  _dispatchInstances?: null | Array<Fiber | null> | Fiber,
  /** 旧事件派发字段，表示待调用回调。 */
  _dispatchListeners?: null | Array<Function> | Function,
  /** 创建合成事件时记录的目标 Fiber，可为 null。 */
  _targetInst: Fiber,
  /** 合成事件所包装的原生浏览器事件。 */
  nativeEvent: Event,
  /** 原生 target 经 getEventTarget 归一化后的目标。 */
  target?: mixed,
  /** 进入/离开等事件的关联目标。 */
  relatedTarget?: mixed,
  /** 对用户暴露的合成事件类型，可与原生类型不同。 */
  type: string,
  /** 当前 handler 对应的宿主目标；调用结束后清空。 */
  currentTarget: null | EventTarget,
};

/** 具有已知 React on* 注册名称的合成事件。 */
export type KnownReactSyntheticEvent = BaseSyntheticEvent & {
  /** 此合成事件对应的 React on* 注册名。 */
  _reactName: string,
};
/** 只通过 createEventHandle 等内部路径派发、没有 React on* 名的合成事件。 */
export type UnknownReactSyntheticEvent = BaseSyntheticEvent & {
  /** 无 React on* 名称的事件固定为 null。 */
  _reactName: null,
};

/** 已知与未知注册名的合成事件联合。 */
export type ReactSyntheticEvent =
  | KnownReactSyntheticEvent
  | UnknownReactSyntheticEvent;
