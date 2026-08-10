/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {AnyNativeEvent} from '../PluginModuleType';
import type {DOMEventName} from '../DOMEventNames';
import type {DispatchQueue} from '../DOMPluginEventSystem';
import type {EventSystemFlags} from '../EventSystemFlags';
import type {Fiber} from 'react-reconciler/src/ReactInternalTypes';
import type {FormStatus} from 'react-dom-bindings/src/shared/ReactDOMFormActions';

import {enableTrustedTypesIntegration} from 'shared/ReactFeatureFlags';
import {getFiberCurrentPropsFromNode} from '../../client/ReactDOMComponentTree';
import {startHostTransition} from 'react-reconciler/src/ReactFiberReconciler';
import {didCurrentEventScheduleTransition} from 'react-reconciler/src/ReactFiberRootScheduler';
import sanitizeURL from 'react-dom-bindings/src/shared/sanitizeURL';
import {checkAttributeStringCoercion} from 'shared/CheckStringCoercion';

import {SyntheticEvent} from '../SyntheticEvent';

/** coerceFormActionProp 执行把 form submit 提取为 action 合成事件并协调 transition、FormData 与阻塞状态的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
function coerceFormActionProp(
  actionProp: mixed,
): string | (FormData => void | Promise<void>) | null {
  // 该逻辑必须与 ReactDOMComponent 保持一致。
  if (
    actionProp == null ||
    typeof actionProp === 'symbol' ||
    typeof actionProp === 'boolean'
  ) {
    return null;
  } else if (typeof actionProp === 'function') {
    return actionProp as any;
  } else {
    if (__DEV__) {
      checkAttributeStringCoercion(actionProp, 'action');
    }
    return sanitizeURL(
      enableTrustedTypesIntegration ? actionProp : '' + (actionProp as any),
    ) as any;
  }
}

/**
 * 若表单没有阻止默认行为，该插件会调用 form、input 或 button 上的 action 函数。
 */
/** extractEvents 从原生事件和 Fiber 路径收集把 form submit 提取为 action 合成事件并协调 transition、FormData 与阻塞状态所需数据；只生成满足插件条件的 listener/event。 */
function extractEvents(
  dispatchQueue: DispatchQueue,
  domEventName: DOMEventName,
  maybeTargetInst: null | Fiber,
  nativeEvent: AnyNativeEvent,
  nativeEventTarget: null | EventTarget,
  eventSystemFlags: EventSystemFlags,
  targetContainer: EventTarget,
) {
  if (domEventName !== 'submit') {
    return;
  }
  if (!maybeTargetInst || maybeTargetInst.stateNode !== nativeEventTarget) {
    // 若当前根嵌套在另一个父根中，
    // 父根得到的最深 target 不会是真正提交的 form。
    return;
  }
  const formInst = maybeTargetInst;
  const form: HTMLFormElement = nativeEventTarget as any;
  let action = coerceFormActionProp(
    (getFiberCurrentPropsFromNode(form) as any).action,
  );
  let submitter: null | void | HTMLInputElement | HTMLButtonElement = (
    nativeEvent as any
  ).submitter;
  let submitterAction;
  if (submitter) {
    const submitterProps = getFiberCurrentPropsFromNode(submitter);
    submitterAction = submitterProps
      ? coerceFormActionProp((submitterProps as any).formAction)
      : // Flow 内建类型为 ?string，比规范允许范围更宽。
        (submitter.getAttribute('formAction') as any as string | null);
    if (submitterAction !== null) {
      // submitter 上的 formAction 会覆盖 form action。
      action = submitterAction;
      // 若 action 是函数，不应把 submitter 的 name
      // 值写入 FormData，因为该字段由服务端控制。
      submitter = null;
    }
  }

  const event = new SyntheticEvent(
    'action',
    'action',
    null,
    nativeEvent,
    nativeEventTarget,
  );

  /** submitForm 执行把 form submit 提取为 action 合成事件并协调 transition、FormData 与阻塞状态的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
  function submitForm() {
    if (nativeEvent.defaultPrevented) {
      // 较早的事件已阻止表单提交；若同时调度了 transition 更新，
      // 即使没有提供 action 函数，也应触发 pending form status。
      // 此分支只维护表单状态，不调用 action。
      if (didCurrentEventScheduleTransition()) {
        // 接下来会设置 pending form status；但由于提交
        // 已被阻止，不能执行 action 函数。
        const formData = new FormData(form, submitter);
        const pendingState: FormStatus = {
          pending: true,
          data: formData,
          method: form.method,
          action: action,
        };
        if (__DEV__) {
          Object.freeze(pendingState);
        }
        startHostTransition(
          formInst,
          pendingState,
          // 将 `null` 作为 action 传入。
          // TODO：考虑把 startHostTransition 拆成两个
          // 函数：一个设置 form status，另一个调用
    // action 函数。
          null,
          formData,
        );
      } else {
        // 没有更早的事件调度 transition，因此退出且不设置
      // pending form status 状态。
      }
    } else if (typeof action === 'function') {
      // 已提供 form action，需要阻止原生导航。
      event.preventDefault();

      // 分发 action，并设置 pending form status。
      const formData = new FormData(form, submitter);
      const pendingState: FormStatus = {
        pending: true,
        data: formData,
        method: form.method,
        action: action,
      };
      if (__DEV__) {
        Object.freeze(pendingState);
      }
      startHostTransition(formInst, pendingState, action, formData);
    } else {
      // 先前没有事件阻止默认提交，也没有提供 action，
      // 因此退出且不设置 pending form status。
    }
  }

  dispatchQueue.push({
    event,
    listeners: [
      {
        instance: null,
        listener: submitForm,
        currentTarget: form,
      },
    ],
  });
}

export {extractEvents};

/** dispatchReplayedFormAction 推进把 form submit 提取为 action 合成事件并协调 transition、FormData 与阻塞状态的分发或重放状态机；阻塞时保留事件，解除后按原优先级继续。 */
export function dispatchReplayedFormAction(
  formInst: Fiber,
  form: HTMLFormElement,
  action: FormData => void | Promise<void>,
  formData: FormData,
): void {
  const pendingState: FormStatus = {
    pending: true,
    data: formData,
    method: form.method,
    action: action,
  };
  if (__DEV__) {
    Object.freeze(pendingState);
  }
  startHostTransition(formInst, pendingState, action, formData);
}
