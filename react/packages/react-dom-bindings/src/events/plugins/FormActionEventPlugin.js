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

/** 函数 action 保持原值；不支持类型变为 null，其他值字符串化并清洗 URL。 */
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
 * 仅为当前根拥有的 form submit 提取 action 事件；嵌套父根看到的替代 target 不处理。
 * 从节点缓存读取最新 form action，submitter 的非空 formAction 可覆盖它，再把
 * submitForm 排在普通 onSubmit 监听器之后，使其读取用户处理后的 defaultPrevented。
 * 是否调用函数 action、仅更新 pending 状态或让浏览器继续导航，延后到该监听器决定。
 */
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
      // 有独立 formAction 时清掉 submitter，后续 FormData 不再加入其 name/value；
      // 该分支对函数和字符串覆盖值都成立。
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

  /**
   * 在 onSubmit 之后决定提交行为。已阻止默认且本事件调度过 Transition 时，以
   * null action 启动宿主 transition，仅提供 pending 表单状态；未调度则直接退出。
   * 默认未阻止且 action 为函数时阻止导航、构造提交时的 FormData 并执行 action；
   * 字符串或空 action 保留浏览器默认提交，也不在此设置 pending 状态。
   */
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

/** 把 hydration 后已解析的 form action 和 FormData 交给 startHostTransition。 */
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
