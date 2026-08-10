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

/** DispatchConfig 定义 Flow 数据形状，用于集中声明 React 合成事件及 native event 的 Flow 类型边界；类型边界阻止插件、原生事件与 Fiber 状态混用。 */
export type DispatchConfig = {
  /** DispatchConfig.dependencies 描述集中声明 React 合成事件及 native event 的 Flow 类型边界的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  dependencies?: Array<DOMEventName>,
  /** DispatchConfig.phasedRegistrationNames 描述集中声明 React 合成事件及 native event 的 Flow 类型边界的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  phasedRegistrationNames: {
    /** DispatchConfig.bubbled 描述集中声明 React 合成事件及 native event 的 Flow 类型边界的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
    bubbled: null | string,
    /** DispatchConfig.captured 描述集中声明 React 合成事件及 native event 的 Flow 类型边界的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
    captured: null | string,
  },
  /** DispatchConfig.registrationName 描述集中声明 React 合成事件及 native event 的 Flow 类型边界的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  registrationName?: string,
};

/** BaseSyntheticEvent 定义 Flow 数据形状，用于集中声明 React 合成事件及 native event 的 Flow 类型边界；类型边界阻止插件、原生事件与 Fiber 状态混用。 */
type BaseSyntheticEvent = {
  /** BaseSyntheticEvent.isPersistent 是集中声明 React 合成事件及 native event 的 Flow 类型边界的可调用属性；它在读取或归一化该字段时保持宿主事件语义。 */
  isPersistent: () => boolean,
  /** BaseSyntheticEvent.isPropagationStopped 是集中声明 React 合成事件及 native event 的 Flow 类型边界的可调用属性；它在读取或归一化该字段时保持宿主事件语义。 */
  isPropagationStopped: () => boolean,
  /** BaseSyntheticEvent._dispatchInstances 描述集中声明 React 合成事件及 native event 的 Flow 类型边界的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  _dispatchInstances?: null | Array<Fiber | null> | Fiber,
  /** BaseSyntheticEvent._dispatchListeners 描述集中声明 React 合成事件及 native event 的 Flow 类型边界的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  _dispatchListeners?: null | Array<Function> | Function,
  /** BaseSyntheticEvent._targetInst 描述集中声明 React 合成事件及 native event 的 Flow 类型边界的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  _targetInst: Fiber,
  /** BaseSyntheticEvent.nativeEvent 描述集中声明 React 合成事件及 native event 的 Flow 类型边界的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  nativeEvent: Event,
  /** BaseSyntheticEvent.target 描述集中声明 React 合成事件及 native event 的 Flow 类型边界的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  target?: mixed,
  /** BaseSyntheticEvent.relatedTarget 描述集中声明 React 合成事件及 native event 的 Flow 类型边界的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  relatedTarget?: mixed,
  /** BaseSyntheticEvent.type 描述集中声明 React 合成事件及 native event 的 Flow 类型边界的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  type: string,
  /** BaseSyntheticEvent.currentTarget 描述集中声明 React 合成事件及 native event 的 Flow 类型边界的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  currentTarget: null | EventTarget,
};

/** KnownReactSyntheticEvent 定义 Flow 数据形状，用于集中声明 React 合成事件及 native event 的 Flow 类型边界；类型边界阻止插件、原生事件与 Fiber 状态混用。 */
export type KnownReactSyntheticEvent = BaseSyntheticEvent & {
  /** KnownReactSyntheticEvent._reactName 描述集中声明 React 合成事件及 native event 的 Flow 类型边界的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  _reactName: string,
};
/** UnknownReactSyntheticEvent 定义 Flow 数据形状，用于集中声明 React 合成事件及 native event 的 Flow 类型边界；类型边界阻止插件、原生事件与 Fiber 状态混用。 */
export type UnknownReactSyntheticEvent = BaseSyntheticEvent & {
  /** UnknownReactSyntheticEvent._reactName 描述集中声明 React 合成事件及 native event 的 Flow 类型边界的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  _reactName: null,
};

/** ReactSyntheticEvent 定义 Flow 数据形状，用于集中声明 React 合成事件及 native event 的 Flow 类型边界；类型边界阻止插件、原生事件与 Fiber 状态混用。 */
export type ReactSyntheticEvent =
  | KnownReactSyntheticEvent
  | UnknownReactSyntheticEvent;
