/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactInternalTypes';
import type {Lanes} from './ReactFiberLane';
import type {UpdateQueue} from './ReactFiberClassUpdateQueue';

import {
  LayoutStatic,
  Update,
  Snapshot,
  MountLayoutDev,
} from './ReactFiberFlags';
import {
  disableLegacyContext,
  enableSchedulingProfiler,
} from 'shared/ReactFeatureFlags';
import ReactStrictModeWarnings from './ReactStrictModeWarnings';
import {get as getInstance, set as setInstance} from 'shared/ReactInstanceMap';
import shallowEqual from 'shared/shallowEqual';
import getComponentNameFromFiber from 'react-reconciler/src/getComponentNameFromFiber';
import getComponentNameFromType from 'shared/getComponentNameFromType';
import assign from 'shared/assign';
import isArray from 'shared/isArray';
import {REACT_CONTEXT_TYPE, REACT_CONSUMER_TYPE} from 'shared/ReactSymbols';

import {NoMode, StrictLegacyMode, StrictEffectsMode} from './ReactTypeOfMode';

import {
  enqueueUpdate,
  entangleTransitions,
  processUpdateQueue,
  checkHasForceUpdateAfterProcessing,
  resetHasForceUpdateBeforeProcessing,
  createUpdate,
  ReplaceState,
  ForceUpdate,
  initializeUpdateQueue,
  cloneUpdateQueue,
  suspendIfUpdateReadFromEntangledAsyncAction,
} from './ReactFiberClassUpdateQueue';
import {NoLanes} from './ReactFiberLane';
import {
  cacheContext,
  getMaskedContext,
  getUnmaskedContext,
  hasContextChanged,
  emptyContextObject,
} from './ReactFiberLegacyContext';
import {readContext, checkIfContextChanged} from './ReactFiberNewContext';
import {requestUpdateLane, scheduleUpdateOnFiber} from './ReactFiberWorkLoop';
import {
  markForceUpdateScheduled,
  markStateUpdateScheduled,
  setIsStrictModeForDevtools,
} from './ReactFiberDevToolsHook';
import {startUpdateTimerByLane} from './ReactProfilerTimer';

/** DEV 中暴露给旧调试入口的冻结哨兵，真实 Fiber 映射由 ReactInstanceMap 私下维护。 */
const fakeInternalInstance = {};

let didWarnAboutStateAssignmentForComponent;
let didWarnAboutUninitializedState;
let didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate;
let didWarnAboutLegacyLifecyclesAndDerivedState;
let didWarnAboutUndefinedDerivedState;
let didWarnAboutDirectlyAssigningPropsToState;
let didWarnAboutContextTypeAndContextTypes;
let didWarnAboutContextTypes;
let didWarnAboutChildContextTypes;
let didWarnAboutInvalidateContextType;
let didWarnOnInvalidCallback;

if (__DEV__) {
  didWarnAboutStateAssignmentForComponent = new Set<string>();
  didWarnAboutUninitializedState = new Set<string>();
  didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate = new Set<string>();
  didWarnAboutLegacyLifecyclesAndDerivedState = new Set<string>();
  didWarnAboutDirectlyAssigningPropsToState = new Set<string>();
  didWarnAboutUndefinedDerivedState = new Set<string>();
  didWarnAboutContextTypeAndContextTypes = new Set<string>();
  didWarnAboutContextTypes = new Set<mixed>();
  didWarnAboutChildContextTypes = new Set<mixed>();
  didWarnAboutInvalidateContextType = new Set<string>();
  didWarnOnInvalidCallback = new Set<string>();

  Object.freeze(fakeInternalInstance);
}

/** 对 setState/replaceState/forceUpdate 的非法 callback 按 String(callback) 去重警告；不同值的同一字符串只报一次。 */
function warnOnInvalidCallback(callback: mixed) {
  if (__DEV__) {
    if (callback === null || typeof callback === 'function') {
      return;
    }
    // eslint-disable-next-line react-internal/safe-string-coercion
    const key = String(callback);
    if (!didWarnOnInvalidCallback.has(key)) {
      didWarnOnInvalidCallback.add(key);
      console.error(
        'Expected the last optional `callback` argument to be a ' +
          'function. Instead received: %s.',
        callback,
      );
    }
  }
}

/** 当 getDerivedStateFromProps 返回 undefined 而非对象/null 时按组件名警告一次。 */
function warnOnUndefinedDerivedState(type: any, partialState: any) {
  if (__DEV__) {
    if (partialState === undefined) {
      const componentName = getComponentNameFromType(type) || 'Component';
      if (!didWarnAboutUndefinedDerivedState.has(componentName)) {
        didWarnAboutUndefinedDerivedState.add(componentName);
        console.error(
          '%s.getDerivedStateFromProps(): A valid state object (or null) must be returned. ' +
            'You have returned undefined.',
          componentName,
        );
      }
    }
  }
}

/**
 * 调用静态 getDerivedStateFromProps 并把 partial state 浅合并到旧状态。
 * StrictLegacyMode 在 DEV 中额外调用一次并使用第二次结果；仅当工作 Fiber 没有剩余
 * lanes 时把派生结果写入 baseState，有跳过的更新时保留原重放起点。
 * nextProps 是已解析 defaultProps/ref 的实例 props；用户方法在 render 阶段运行，
 * 抛错直接交给工作循环，DevTools 的 StrictMode 标志通过 finally 复原。
 */
function applyDerivedStateFromProps(
  workInProgress: Fiber,
  ctor: any,
  getDerivedStateFromProps: (props: any, state: any) => any,
  nextProps: any,
) {
  const prevState = workInProgress.memoizedState;
  let partialState = getDerivedStateFromProps(nextProps, prevState);
  if (__DEV__) {
    if (workInProgress.mode & StrictLegacyMode) {
      setIsStrictModeForDevtools(true);
      try {
        // 额外调用一次，以帮助发现非幂等副作用。
        partialState = getDerivedStateFromProps(nextProps, prevState);
      } finally {
        setIsStrictModeForDevtools(false);
      }
    }
    warnOnUndefinedDerivedState(ctor, partialState);
  }
  // 将 partial state 与旧状态浅合并。
  const memoizedState =
    partialState === null || partialState === undefined
      ? prevState
      : assign({}, prevState, partialState);
  workInProgress.memoizedState = memoizedState;

  // 更新队列清空后，把派生状态持久化为 baseState。
  if (workInProgress.lanes === NoLanes) {
    // 类组件的更新队列始终非空。
    const updateQueue: UpdateQueue<any> = workInProgress.updateQueue as any;
    updateQueue.baseState = memoizedState;
  }
}

/**
 * 注入类实例的 updater：把面向用户的状态 API 转换为带 Lane 的 Fiber Update，入队后
 * 调度 Root、纠缠 Transition，并向 Scheduling Profiler 记录更新种类。
 */
const classComponentUpdater = {
  // $FlowFixMe[missing-local-annot]
  /** 将实例映射到 Fiber，按当前 Transition/事件/render 上下文选 lane，把对象或 updater 函数保存在 payload；这里只入队和调度，不直接调用函数或更新 inst.state。可选 callback 留到实际提交。 */
  enqueueSetState(inst: any, payload: any, callback) {
    const fiber = getInstance(inst);
    const lane = requestUpdateLane(fiber);

    const update = createUpdate(lane);
    update.payload = payload;
    if (callback !== undefined && callback !== null) {
      if (__DEV__) {
        warnOnInvalidCallback(callback);
      }
      update.callback = callback;
    }

    const root = enqueueUpdate(fiber, update, lane);
    if (root !== null) {
      startUpdateTimerByLane(lane, 'this.setState()', fiber);
      scheduleUpdateOnFiber(root, fiber, lane);
      entangleTransitions(root, fiber, lane);
    }

    if (enableSchedulingProfiler) {
      markStateUpdateScheduled(fiber, lane);
    }
  },
  /** 以 ReplaceState 标签入队，供旧 createClass/legacy 生命周期的整状态替换使用；处理队列时覆盖此前累积 state，跳过的旧更新仍按队列规则保留重放，不在此删除。 */
  enqueueReplaceState(inst: any, payload: any, callback: null) {
    const fiber = getInstance(inst);
    const lane = requestUpdateLane(fiber);

    const update = createUpdate(lane);
    update.tag = ReplaceState;
    update.payload = payload;

    if (callback !== undefined && callback !== null) {
      if (__DEV__) {
        warnOnInvalidCallback(callback);
      }
      update.callback = callback;
    }

    const root = enqueueUpdate(fiber, update, lane);
    if (root !== null) {
      startUpdateTimerByLane(lane, 'this.replaceState()', fiber);
      scheduleUpdateOnFiber(root, fiber, lane);
      entangleTransitions(root, fiber, lane);
    }

    if (enableSchedulingProfiler) {
      markStateUpdateScheduled(fiber, lane);
    }
  },
  // $FlowFixMe[missing-local-annot]
  /** 入队无 state payload 的 ForceUpdate，队列处理设置 hasForceUpdate 使本次类组件跳过 SCU 否决；依然经过 lane 调度、Transition 纠缠与正常 render/commit，不直接调用生命周期。 */
  enqueueForceUpdate(inst: any, callback) {
    const fiber = getInstance(inst);
    const lane = requestUpdateLane(fiber);

    const update = createUpdate(lane);
    update.tag = ForceUpdate;

    if (callback !== undefined && callback !== null) {
      if (__DEV__) {
        warnOnInvalidCallback(callback);
      }
      update.callback = callback;
    }

    const root = enqueueUpdate(fiber, update, lane);
    if (root !== null) {
      startUpdateTimerByLane(lane, 'this.forceUpdate()', fiber);
      scheduleUpdateOnFiber(root, fiber, lane);
      entangleTransitions(root, fiber, lane);
    }

    if (enableSchedulingProfiler) {
      markForceUpdateScheduled(fiber, lane);
    }
  },
};

/**
 * 决定类组件是否重新渲染：优先调用实例 shouldComponentUpdate，PureComponent 则浅比较
 * props/state，其余默认更新。StrictLegacyMode 会重复调用用户函数以探测副作用。
 * old/new props 已解析默认值，state 来自更新队列前后结果；nextContext 传给用户 SCU。
 * 此函数只返回 SCU/PureComponent 结果，现代 Context 依赖变化绕过 SCU 的判断由调用者另加。
 */
function checkShouldComponentUpdate(
  workInProgress: Fiber,
  ctor: any,
  oldProps: any,
  newProps: any,
  oldState: any,
  newState: any,
  nextContext: any,
) {
  const instance = workInProgress.stateNode;
  if (typeof instance.shouldComponentUpdate === 'function') {
    let shouldUpdate = instance.shouldComponentUpdate(
      newProps,
      newState,
      nextContext,
    );
    if (__DEV__) {
      if (workInProgress.mode & StrictLegacyMode) {
        setIsStrictModeForDevtools(true);
        try {
          // 额外调用一次，以帮助发现非幂等副作用。
          shouldUpdate = instance.shouldComponentUpdate(
            newProps,
            newState,
            nextContext,
          );
        } finally {
          setIsStrictModeForDevtools(false);
        }
      }
      if (shouldUpdate === undefined) {
        console.error(
          '%s.shouldComponentUpdate(): Returned undefined instead of a ' +
            'boolean value. Make sure to return true or false.',
          getComponentNameFromType(ctor) || 'Component',
        );
      }
    }

    return shouldUpdate;
  }

  if (ctor.prototype && ctor.prototype.isPureReactComponent) {
    return (
      !shallowEqual(oldProps, newProps) || !shallowEqual(oldState, newState)
    );
  }

  return true;
}

/**
 * DEV 下检查类实例契约与常见拼写/生命周期误用，并按组件或构造器去重警告。
 * 只诊断，不改变实例行为；生产构建会消除整条路径。
 */
function checkClassInstance(workInProgress: Fiber, ctor: any, newProps: any) {
  const instance = workInProgress.stateNode;
  if (__DEV__) {
    const name = getComponentNameFromType(ctor) || 'Component';
    const renderPresent = instance.render;

    if (!renderPresent) {
      if (ctor.prototype && typeof ctor.prototype.render === 'function') {
        console.error(
          'No `render` method found on the %s ' +
            'instance: did you accidentally return an object from the constructor?',
          name,
        );
      } else {
        console.error(
          'No `render` method found on the %s ' +
            'instance: you may have forgotten to define `render`.',
          name,
        );
      }
    }

    if (
      instance.getInitialState &&
      !instance.getInitialState.isReactClassApproved &&
      !instance.state
    ) {
      console.error(
        'getInitialState was defined on %s, a plain JavaScript class. ' +
          'This is only supported for classes created using React.createClass. ' +
          'Did you mean to define a state property instead?',
        name,
      );
    }
    if (
      instance.getDefaultProps &&
      !instance.getDefaultProps.isReactClassApproved
    ) {
      console.error(
        'getDefaultProps was defined on %s, a plain JavaScript class. ' +
          'This is only supported for classes created using React.createClass. ' +
          'Use a static property to define defaultProps instead.',
        name,
      );
    }
    if (instance.contextType) {
      console.error(
        'contextType was defined as an instance property on %s. Use a static ' +
          'property to define contextType instead.',
        name,
      );
    }

    if (disableLegacyContext) {
      if (ctor.childContextTypes && !didWarnAboutChildContextTypes.has(ctor)) {
        didWarnAboutChildContextTypes.add(ctor);
        console.error(
          '%s uses the legacy childContextTypes API which was removed in React 19. ' +
            'Use React.createContext() instead. (https://react.dev/link/legacy-context)',
          name,
        );
      }
      if (ctor.contextTypes && !didWarnAboutContextTypes.has(ctor)) {
        didWarnAboutContextTypes.add(ctor);
        console.error(
          '%s uses the legacy contextTypes API which was removed in React 19. ' +
            'Use React.createContext() with static contextType instead. ' +
            '(https://react.dev/link/legacy-context)',
          name,
        );
      }
    } else {
      if (instance.contextTypes) {
        console.error(
          'contextTypes was defined as an instance property on %s. Use a static ' +
            'property to define contextTypes instead.',
          name,
        );
      }

      if (
        ctor.contextType &&
        ctor.contextTypes &&
        !didWarnAboutContextTypeAndContextTypes.has(ctor)
      ) {
        didWarnAboutContextTypeAndContextTypes.add(ctor);
        console.error(
          '%s declares both contextTypes and contextType static properties. ' +
            'The legacy contextTypes property will be ignored.',
          name,
        );
      }
      if (ctor.childContextTypes && !didWarnAboutChildContextTypes.has(ctor)) {
        didWarnAboutChildContextTypes.add(ctor);
        console.error(
          '%s uses the legacy childContextTypes API which will soon be removed. ' +
            'Use React.createContext() instead. (https://react.dev/link/legacy-context)',
          name,
        );
      }
      if (ctor.contextTypes && !didWarnAboutContextTypes.has(ctor)) {
        didWarnAboutContextTypes.add(ctor);
        console.error(
          '%s uses the legacy contextTypes API which will soon be removed. ' +
            'Use React.createContext() with static contextType instead. ' +
            '(https://react.dev/link/legacy-context)',
          name,
        );
      }
    }

    if (typeof instance.componentShouldUpdate === 'function') {
      console.error(
        '%s has a method called ' +
          'componentShouldUpdate(). Did you mean shouldComponentUpdate()? ' +
          'The name is phrased as a question because the function is ' +
          'expected to return a value.',
        name,
      );
    }
    if (
      ctor.prototype &&
      ctor.prototype.isPureReactComponent &&
      typeof instance.shouldComponentUpdate !== 'undefined'
    ) {
      console.error(
        '%s has a method called shouldComponentUpdate(). ' +
          'shouldComponentUpdate should not be used when extending React.PureComponent. ' +
          'Please extend React.Component if shouldComponentUpdate is used.',
        getComponentNameFromType(ctor) || 'A pure component',
      );
    }
    if (typeof instance.componentDidUnmount === 'function') {
      console.error(
        '%s has a method called ' +
          'componentDidUnmount(). But there is no such lifecycle method. ' +
          'Did you mean componentWillUnmount()?',
        name,
      );
    }
    if (typeof instance.componentDidReceiveProps === 'function') {
      console.error(
        '%s has a method called ' +
          'componentDidReceiveProps(). But there is no such lifecycle method. ' +
          'If you meant to update the state in response to changing props, ' +
          'use componentWillReceiveProps(). If you meant to fetch data or ' +
          'run side-effects or mutations after React has updated the UI, use componentDidUpdate().',
        name,
      );
    }
    if (typeof instance.componentWillRecieveProps === 'function') {
      console.error(
        '%s has a method called ' +
          'componentWillRecieveProps(). Did you mean componentWillReceiveProps()?',
        name,
      );
    }
    if (typeof instance.UNSAFE_componentWillRecieveProps === 'function') {
      console.error(
        '%s has a method called ' +
          'UNSAFE_componentWillRecieveProps(). Did you mean UNSAFE_componentWillReceiveProps()?',
        name,
      );
    }
    const hasMutatedProps = instance.props !== newProps;
    if (instance.props !== undefined && hasMutatedProps) {
      console.error(
        'When calling super() in `%s`, make sure to pass ' +
          "up the same props that your component's constructor was passed.",
        name,
      );
    }
    if (instance.defaultProps) {
      console.error(
        'Setting defaultProps as an instance property on %s is not supported and will be ignored.' +
          ' Instead, define defaultProps as a static property on %s.',
        name,
        name,
      );
    }

    if (
      typeof instance.getSnapshotBeforeUpdate === 'function' &&
      typeof instance.componentDidUpdate !== 'function' &&
      !didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate.has(ctor)
    ) {
      didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate.add(ctor);
      console.error(
        '%s: getSnapshotBeforeUpdate() should be used with componentDidUpdate(). ' +
          'This component defines getSnapshotBeforeUpdate() only.',
        getComponentNameFromType(ctor),
      );
    }

    if (typeof instance.getDerivedStateFromProps === 'function') {
      console.error(
        '%s: getDerivedStateFromProps() is defined as an instance method ' +
          'and will be ignored. Instead, declare it as a static method.',
        name,
      );
    }
    if (typeof instance.getDerivedStateFromError === 'function') {
      console.error(
        '%s: getDerivedStateFromError() is defined as an instance method ' +
          'and will be ignored. Instead, declare it as a static method.',
        name,
      );
    }
    if (typeof ctor.getSnapshotBeforeUpdate === 'function') {
      console.error(
        '%s: getSnapshotBeforeUpdate() is defined as a static method ' +
          'and will be ignored. Instead, declare it as an instance method.',
        name,
      );
    }
    const state = instance.state;
    if (state && (typeof state !== 'object' || isArray(state))) {
      console.error('%s.state: must be set to an object or null', name);
    }
    if (
      typeof instance.getChildContext === 'function' &&
      typeof ctor.childContextTypes !== 'object'
    ) {
      console.error(
        '%s.getChildContext(): childContextTypes must be defined in order to ' +
          'use getChildContext().',
        name,
      );
    }
  }
}

/**
 * 构造类组件实例并把它双向连接到 workInProgress Fiber。
 *
 * 先解析新/旧 Context，StrictLegacyMode 在 DEV 中二次构造以探测副作用；随后初始化
 * state/updater 与实例映射，并校验新生命周期和 legacy 生命周期不能混用。
 * 构造器可能在 render 重试中再次执行；DEV 严格模式保留第二个实例，未采用的第一个
 * 实例没有绑定 Fiber。这里只完成构造和映射，更新队列与挂载标志由 mountClassInstance 建立。
 */
function constructClassInstance(
  workInProgress: Fiber,
  ctor: any,
  props: any,
): any {
  let isLegacyContextConsumer = false;
  let unmaskedContext = emptyContextObject;
  let context = emptyContextObject;
  const contextType = ctor.contextType;

  if (__DEV__) {
    if ('contextType' in ctor) {
      const isValid =
        // 允许用 null 表达条件式声明。
        contextType === null ||
        (contextType !== undefined &&
          contextType.$$typeof === REACT_CONTEXT_TYPE);

      if (!isValid && !didWarnAboutInvalidateContextType.has(ctor)) {
        didWarnAboutInvalidateContextType.add(ctor);

        let addendum = '';
        if (contextType === undefined) {
          addendum =
            ' However, it is set to undefined. ' +
            'This can be caused by a typo or by mixing up named and default imports. ' +
            'This can also happen due to a circular dependency, so ' +
            'try moving the createContext() call to a separate file.';
        } else if (typeof contextType !== 'object') {
          addendum = ' However, it is set to a ' + typeof contextType + '.';
        } else if (contextType.$$typeof === REACT_CONSUMER_TYPE) {
          addendum = ' Did you accidentally pass the Context.Consumer instead?';
        } else {
          addendum =
            ' However, it is set to an object with keys {' +
            Object.keys(contextType).join(', ') +
            '}.';
        }
        console.error(
          '%s defines an invalid contextType. ' +
            'contextType should point to the Context object returned by React.createContext().%s',
          getComponentNameFromType(ctor) || 'Component',
          addendum,
        );
      }
    }
  }

  if (typeof contextType === 'object' && contextType !== null) {
    context = readContext(contextType as any);
  } else if (!disableLegacyContext) {
    unmaskedContext = getUnmaskedContext(workInProgress, ctor, true);
    const contextTypes = ctor.contextTypes;
    isLegacyContextConsumer =
      contextTypes !== null && contextTypes !== undefined;
    context = isLegacyContextConsumer
      ? getMaskedContext(workInProgress, unmaskedContext)
      : emptyContextObject;
  }

  let instance = new ctor(props, context);
  // DEV StrictLegacyMode 中构造两次，以帮助发现构造器副作用。
  if (__DEV__) {
    if (workInProgress.mode & StrictLegacyMode) {
      setIsStrictModeForDevtools(true);
      try {
        instance = new ctor(props, context);
      } finally {
        setIsStrictModeForDevtools(false);
      }
    }
  }

  const state = (workInProgress.memoizedState =
    instance.state !== null && instance.state !== undefined
      ? instance.state
      : null);
  instance.updater = classComponentUpdater;
  workInProgress.stateNode = instance;
  // 实例需要访问 Fiber，才能从 this.setState 等入口调度更新。
  setInstance(instance, workInProgress);
  if (__DEV__) {
    instance._reactInternalInstance = fakeInternalInstance;
  }

  if (__DEV__) {
    if (typeof ctor.getDerivedStateFromProps === 'function' && state === null) {
      const componentName = getComponentNameFromType(ctor) || 'Component';
      if (!didWarnAboutUninitializedState.has(componentName)) {
        didWarnAboutUninitializedState.add(componentName);
        console.error(
          '`%s` uses `getDerivedStateFromProps` but its initial state is ' +
            '%s. This is not recommended. Instead, define the initial state by ' +
            'assigning an object to `this.state` in the constructor of `%s`. ' +
            'This ensures that `getDerivedStateFromProps` arguments have a consistent shape.',
          componentName,
          instance.state === null ? 'null' : 'undefined',
          componentName,
        );
      }
    }

    // 定义新组件 API 后不会调用 unsafe 生命周期；若仍声明则警告，但忽略
    // react-lifecycles-compat 注入且显式抑制弃用提示的方法。
    if (
      typeof ctor.getDerivedStateFromProps === 'function' ||
      typeof instance.getSnapshotBeforeUpdate === 'function'
    ) {
      let foundWillMountName = null;
      let foundWillReceivePropsName = null;
      let foundWillUpdateName = null;
      if (
        typeof instance.componentWillMount === 'function' &&
        instance.componentWillMount.__suppressDeprecationWarning !== true
      ) {
        foundWillMountName = 'componentWillMount';
      } else if (typeof instance.UNSAFE_componentWillMount === 'function') {
        foundWillMountName = 'UNSAFE_componentWillMount';
      }
      if (
        typeof instance.componentWillReceiveProps === 'function' &&
        instance.componentWillReceiveProps.__suppressDeprecationWarning !== true
      ) {
        foundWillReceivePropsName = 'componentWillReceiveProps';
      } else if (
        typeof instance.UNSAFE_componentWillReceiveProps === 'function'
      ) {
        foundWillReceivePropsName = 'UNSAFE_componentWillReceiveProps';
      }
      if (
        typeof instance.componentWillUpdate === 'function' &&
        instance.componentWillUpdate.__suppressDeprecationWarning !== true
      ) {
        foundWillUpdateName = 'componentWillUpdate';
      } else if (typeof instance.UNSAFE_componentWillUpdate === 'function') {
        foundWillUpdateName = 'UNSAFE_componentWillUpdate';
      }
      if (
        foundWillMountName !== null ||
        foundWillReceivePropsName !== null ||
        foundWillUpdateName !== null
      ) {
        const componentName = getComponentNameFromType(ctor) || 'Component';
        const newApiName =
          typeof ctor.getDerivedStateFromProps === 'function'
            ? 'getDerivedStateFromProps()'
            : 'getSnapshotBeforeUpdate()';
        if (!didWarnAboutLegacyLifecyclesAndDerivedState.has(componentName)) {
          didWarnAboutLegacyLifecyclesAndDerivedState.add(componentName);
          console.error(
            'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
              '%s uses %s but also contains the following legacy lifecycles:%s%s%s\n\n' +
              'The above lifecycles should be removed. Learn more about this warning here:\n' +
              'https://react.dev/link/unsafe-component-lifecycles',
            componentName,
            newApiName,
            foundWillMountName !== null ? `\n  ${foundWillMountName}` : '',
            foundWillReceivePropsName !== null
              ? `\n  ${foundWillReceivePropsName}`
              : '',
            foundWillUpdateName !== null ? `\n  ${foundWillUpdateName}` : '',
          );
        }
      }
    }
  }

  // 缓存未遮罩 Context，避免不必要地重建 masked Context；新实例尚不能由
  // ReactFiberLegacyContext 的常规更新路径写入该缓存。
  if (isLegacyContextConsumer) {
    cacheContext(workInProgress, unmaskedContext, context);
  }

  return instance;
}

/**
 * 调用 legacy componentWillMount/UNSAFE 变体，并把生命周期内直接赋值 state 转换成
 * ReplaceState Update，使其仍经过统一更新队列。
 */
function callComponentWillMount(workInProgress: Fiber, instance: any) {
  const oldState = instance.state;

  if (typeof instance.componentWillMount === 'function') {
    instance.componentWillMount();
  }
  if (typeof instance.UNSAFE_componentWillMount === 'function') {
    instance.UNSAFE_componentWillMount();
  }

  if (oldState !== instance.state) {
    if (__DEV__) {
      console.error(
        '%s.componentWillMount(): Assigning directly to this.state is ' +
          "deprecated (except inside a component's " +
          'constructor). Use setState instead.',
        getComponentNameFromFiber(workInProgress) || 'Component',
      );
    }
    classComponentUpdater.enqueueReplaceState(instance, instance.state, null);
  }
}

/**
 * 调用 legacy componentWillReceiveProps/UNSAFE 变体；若用户直接替换 state，则去重
 * 警告并转换为 ReplaceState Update。
 */
function callComponentWillReceiveProps(
  workInProgress: Fiber,
  instance: any,
  newProps: any,
  nextContext: any,
) {
  const oldState = instance.state;
  if (typeof instance.componentWillReceiveProps === 'function') {
    instance.componentWillReceiveProps(newProps, nextContext);
  }
  if (typeof instance.UNSAFE_componentWillReceiveProps === 'function') {
    instance.UNSAFE_componentWillReceiveProps(newProps, nextContext);
  }

  if (instance.state !== oldState) {
    if (__DEV__) {
      const componentName =
        getComponentNameFromFiber(workInProgress) || 'Component';
      if (!didWarnAboutStateAssignmentForComponent.has(componentName)) {
        didWarnAboutStateAssignmentForComponent.add(componentName);
        console.error(
          '%s.componentWillReceiveProps(): Assigning directly to ' +
            "this.state is deprecated (except inside a component's " +
            'constructor). Use setState instead.',
          componentName,
        );
      }
    }
    classComponentUpdater.enqueueReplaceState(instance, instance.state, null);
  }
}

/**
 * 初始化从未渲染过的类实例并调用挂载前生命周期。
 *
 * 建立 props/state/refs/Context 与更新队列，应用派生状态；新生命周期存在时跳过 unsafe
 * 生命周期，否则处理其中产生的更新，最后为 componentDidMount 与 Strict Effects 打标。
 * renderLanes 限制挂载前生命周期入队的更新是否本轮处理；纠缠异步 Action 仍未完成时
 * suspendIfUpdateReadFromEntangledAsyncAction 可以抛出挂起控制流。didMount 此处只标记，
 * 真正用户回调留到 layout 提交阶段，不在挂载前调用。
 */
function mountClassInstance(
  workInProgress: Fiber,
  ctor: any,
  newProps: any,
  renderLanes: Lanes,
): void {
  if (__DEV__) {
    checkClassInstance(workInProgress, ctor, newProps);
  }

  const instance = workInProgress.stateNode;
  instance.props = newProps;
  instance.state = workInProgress.memoizedState;
  instance.refs = {};

  initializeUpdateQueue(workInProgress);

  const contextType = ctor.contextType;
  if (typeof contextType === 'object' && contextType !== null) {
    instance.context = readContext(contextType);
  } else if (disableLegacyContext) {
    instance.context = emptyContextObject;
  } else {
    const unmaskedContext = getUnmaskedContext(workInProgress, ctor, true);
    instance.context = getMaskedContext(workInProgress, unmaskedContext);
  }

  if (__DEV__) {
    if (instance.state === newProps) {
      const componentName = getComponentNameFromType(ctor) || 'Component';
      if (!didWarnAboutDirectlyAssigningPropsToState.has(componentName)) {
        didWarnAboutDirectlyAssigningPropsToState.add(componentName);
        console.error(
          '%s: It is not recommended to assign props directly to state ' +
            "because updates to props won't be reflected in state. " +
            'In most cases, it is better to use props directly.',
          componentName,
        );
      }
    }

    if (workInProgress.mode & StrictLegacyMode) {
      ReactStrictModeWarnings.recordLegacyContextWarning(
        workInProgress,
        instance,
      );
    }

    ReactStrictModeWarnings.recordUnsafeLifecycleWarnings(
      workInProgress,
      instance,
    );
  }

  instance.state = workInProgress.memoizedState;

  const getDerivedStateFromProps = ctor.getDerivedStateFromProps;
  if (typeof getDerivedStateFromProps === 'function') {
    applyDerivedStateFromProps(
      workInProgress,
      ctor,
      getDerivedStateFromProps,
      newProps,
    );
    instance.state = workInProgress.memoizedState;
  }

  // 为兼容 react-lifecycles-compat，使用新 API 的组件不得调用 unsafe 生命周期。
  if (
    typeof ctor.getDerivedStateFromProps !== 'function' &&
    typeof instance.getSnapshotBeforeUpdate !== 'function' &&
    (typeof instance.UNSAFE_componentWillMount === 'function' ||
      typeof instance.componentWillMount === 'function')
  ) {
    callComponentWillMount(workInProgress, instance);
    // 立即处理该生命周期中新产生的 state 更新。
    processUpdateQueue(workInProgress, newProps, instance, renderLanes);
    suspendIfUpdateReadFromEntangledAsyncAction();
    instance.state = workInProgress.memoizedState;
  }

  if (typeof instance.componentDidMount === 'function') {
    workInProgress.flags |= Update | LayoutStatic;
  }
  if (__DEV__ && (workInProgress.mode & StrictEffectsMode) !== NoMode) {
    workInProgress.flags |= MountLayoutDev;
  }
}

/**
 * 恢复曾开始但尚未提交的类实例挂载，并判断本次是否需要重新渲染。
 *
 * 重新解析 props/Context、重放 UpdateQueue 与派生状态；即使 bailout 也保留挂载 effect，
 * 正常走到函数末端时把实例指针推进到本轮 props/state/context；队列处理后的快速
 * bailout 提前返回，不经过末尾写入。返回值只决定是否 render，didMount 即使 bailout 仍可打标。
 */
function resumeMountClassInstance(
  workInProgress: Fiber,
  ctor: any,
  newProps: any,
  renderLanes: Lanes,
): boolean {
  const instance = workInProgress.stateNode;

  const unresolvedOldProps = workInProgress.memoizedProps;
  const oldProps = resolveClassComponentProps(ctor, unresolvedOldProps);
  instance.props = oldProps;

  const oldContext = instance.context;
  const contextType = ctor.contextType;
  let nextContext = emptyContextObject;
  if (typeof contextType === 'object' && contextType !== null) {
    nextContext = readContext(contextType);
  } else if (!disableLegacyContext) {
    const nextLegacyUnmaskedContext = getUnmaskedContext(
      workInProgress,
      ctor,
      true,
    );
    nextContext = getMaskedContext(workInProgress, nextLegacyUnmaskedContext);
  }

  const getDerivedStateFromProps = ctor.getDerivedStateFromProps;
  const hasNewLifecycles =
    typeof getDerivedStateFromProps === 'function' ||
    typeof instance.getSnapshotBeforeUpdate === 'function';

  // 判断 props 是否变化要比较 Fiber 保存的未解析对象；实例上的对象可能因补 defaultProps
  // 或移除 ref 而被克隆，不能代表调用方是否传入了新 props。
  const unresolvedNewProps = workInProgress.pendingProps;
  const didReceiveNewProps = unresolvedNewProps !== unresolvedOldProps;

  // 这些挂载前生命周期读取的是上次“尝试渲染”的 instance.props/state，不一定是 current；
  // componentDidUpdate 则会收到真正 current 的 props。

  // 为兼容 react-lifecycles-compat，使用新 API 的组件不得调用 unsafe 生命周期。
  if (
    !hasNewLifecycles &&
    (typeof instance.UNSAFE_componentWillReceiveProps === 'function' ||
      typeof instance.componentWillReceiveProps === 'function')
  ) {
    if (didReceiveNewProps || oldContext !== nextContext) {
      callComponentWillReceiveProps(
        workInProgress,
        instance,
        newProps,
        nextContext,
      );
    }
  }

  resetHasForceUpdateBeforeProcessing();

  const oldState = workInProgress.memoizedState;
  let newState = (instance.state = oldState);
  processUpdateQueue(workInProgress, newProps, instance, renderLanes);
  suspendIfUpdateReadFromEntangledAsyncAction();
  newState = workInProgress.memoizedState;
  if (
    !didReceiveNewProps &&
    oldState === newState &&
    !hasContextChanged() &&
    !checkHasForceUpdateAfterProcessing()
  ) {
    // 即使 bailout，若更新曾启动也要安排 Update effect，使相应挂载/更新后回调得到调用。
    if (typeof instance.componentDidMount === 'function') {
      workInProgress.flags |= Update | LayoutStatic;
    }
    if (__DEV__ && (workInProgress.mode & StrictEffectsMode) !== NoMode) {
      workInProgress.flags |= MountLayoutDev;
    }
    return false;
  }

  if (typeof getDerivedStateFromProps === 'function') {
    applyDerivedStateFromProps(
      workInProgress,
      ctor,
      getDerivedStateFromProps,
      newProps,
    );
    newState = workInProgress.memoizedState;
  }

  const shouldUpdate =
    checkHasForceUpdateAfterProcessing() ||
    checkShouldComponentUpdate(
      workInProgress,
      ctor,
      oldProps,
      newProps,
      oldState,
      newState,
      nextContext,
    );

  if (shouldUpdate) {
    // 为兼容 react-lifecycles-compat，使用新 API 的组件不得调用 unsafe 生命周期。
    if (
      !hasNewLifecycles &&
      (typeof instance.UNSAFE_componentWillMount === 'function' ||
        typeof instance.componentWillMount === 'function')
    ) {
      if (typeof instance.componentWillMount === 'function') {
        instance.componentWillMount();
      }
      if (typeof instance.UNSAFE_componentWillMount === 'function') {
        instance.UNSAFE_componentWillMount();
      }
    }
    if (typeof instance.componentDidMount === 'function') {
      workInProgress.flags |= Update | LayoutStatic;
    }
    if (__DEV__ && (workInProgress.mode & StrictEffectsMode) !== NoMode) {
      workInProgress.flags |= MountLayoutDev;
    }
  } else {
    // 即使 bailout，若更新曾启动也保留 Update effect，使挂载后生命周期得到调用。
    if (typeof instance.componentDidMount === 'function') {
      workInProgress.flags |= Update | LayoutStatic;
    }
    if (__DEV__ && (workInProgress.mode & StrictEffectsMode) !== NoMode) {
      workInProgress.flags |= MountLayoutDev;
    }

    // shouldComponentUpdate 为 false 仍推进 memoized 值，标记本轮工作可复用。
    workInProgress.memoizedProps = newProps;
    workInProgress.memoizedState = newState;
  }

  // 即使 shouldComponentUpdate 为 false，也推进实例的 state/props/context 指针。
  instance.props = newProps;
  instance.state = newState;
  instance.context = nextContext;

  return shouldUpdate;
}

/**
 * 重放已挂载类实例的更新队列与生命周期，并返回是否需要重新渲染。
 *
 * 它克隆 current 队列、解析 Context/派生状态，组合 ForceUpdate、SCU 和 Context 变化；
 * bailout 时若本轮旧值已经不同于 current，仍为 didUpdate/snapshot 打标，保留前次尝试
 * 已产生的提交职责；这些回调接收真正 current 的旧 props/state。快速 bailout 提前返回，
 * 其它路径即使 SCU 为 false 也写入实例公开字段及 memoized 状态。
 * current 与 workInProgress 共用类实例，队列外壳先克隆；renderLanes 控制哪些更新进入
 * 本轮 state，跳过项留作 rebase。ForceUpdate 或已记录 Context 依赖变化均能绕过 SCU 否决。
 */
function updateClassInstance(
  current: Fiber,
  workInProgress: Fiber,
  ctor: any,
  newProps: any,
  renderLanes: Lanes,
): boolean {
  const instance = workInProgress.stateNode;

  cloneUpdateQueue(current, workInProgress);

  const unresolvedOldProps = workInProgress.memoizedProps;
  const oldProps = resolveClassComponentProps(ctor, unresolvedOldProps);
  instance.props = oldProps;
  const unresolvedNewProps = workInProgress.pendingProps;

  const oldContext = instance.context;
  const contextType = ctor.contextType;
  let nextContext = emptyContextObject;
  if (typeof contextType === 'object' && contextType !== null) {
    nextContext = readContext(contextType);
  } else if (!disableLegacyContext) {
    const nextUnmaskedContext = getUnmaskedContext(workInProgress, ctor, true);
    nextContext = getMaskedContext(workInProgress, nextUnmaskedContext);
  }

  const getDerivedStateFromProps = ctor.getDerivedStateFromProps;
  const hasNewLifecycles =
    typeof getDerivedStateFromProps === 'function' ||
    typeof instance.getSnapshotBeforeUpdate === 'function';

  // 这些更新前生命周期读取的是上次“尝试渲染”的 instance.props/state，不一定是 current；
  // componentDidUpdate 则会收到真正 current 的 props。

  // 为兼容 react-lifecycles-compat，使用新 API 的组件不得调用 unsafe 生命周期。
  if (
    !hasNewLifecycles &&
    (typeof instance.UNSAFE_componentWillReceiveProps === 'function' ||
      typeof instance.componentWillReceiveProps === 'function')
  ) {
    if (
      unresolvedOldProps !== unresolvedNewProps ||
      oldContext !== nextContext
    ) {
      callComponentWillReceiveProps(
        workInProgress,
        instance,
        newProps,
        nextContext,
      );
    }
  }

  resetHasForceUpdateBeforeProcessing();

  const oldState = workInProgress.memoizedState;
  let newState = (instance.state = oldState);
  processUpdateQueue(workInProgress, newProps, instance, renderLanes);
  suspendIfUpdateReadFromEntangledAsyncAction();
  newState = workInProgress.memoizedState;

  if (
    unresolvedOldProps === unresolvedNewProps &&
    oldState === newState &&
    !hasContextChanged() &&
    !checkHasForceUpdateAfterProcessing() &&
    !(
      // prettier-ignore
      // $FlowFixMe[invalid-compare]
      (current !== null &&
        current.dependencies !== null &&
        checkIfContextChanged(current.dependencies))
    )
  ) {
    // 即使 bailout，若 current 与本轮旧值不同也保留 didUpdate/snapshot effect。
    if (typeof instance.componentDidUpdate === 'function') {
      if (
        unresolvedOldProps !== current.memoizedProps ||
        oldState !== current.memoizedState
      ) {
        workInProgress.flags |= Update;
      }
    }
    if (typeof instance.getSnapshotBeforeUpdate === 'function') {
      if (
        unresolvedOldProps !== current.memoizedProps ||
        oldState !== current.memoizedState
      ) {
        workInProgress.flags |= Snapshot;
      }
    }
    return false;
  }

  if (typeof getDerivedStateFromProps === 'function') {
    applyDerivedStateFromProps(
      workInProgress,
      ctor,
      getDerivedStateFromProps,
      newProps,
    );
    newState = workInProgress.memoizedState;
  }

  const shouldUpdate =
    checkHasForceUpdateAfterProcessing() ||
    checkShouldComponentUpdate(
      workInProgress,
      ctor,
      oldProps,
      newProps,
      oldState,
      newState,
      nextContext,
    ) ||
    // TODO：memoized 组件有时会在 shouldComponentUpdate 前后各检查一次 Context；不理想，
    // 但发生频率不高，重构此函数需谨慎。
    // $FlowFixMe[invalid-compare]
    (current !== null &&
      current.dependencies !== null &&
      checkIfContextChanged(current.dependencies));

  if (shouldUpdate) {
    // 为兼容 react-lifecycles-compat，使用新 API 的组件不得调用 unsafe 生命周期。
    if (
      !hasNewLifecycles &&
      (typeof instance.UNSAFE_componentWillUpdate === 'function' ||
        typeof instance.componentWillUpdate === 'function')
    ) {
      if (typeof instance.componentWillUpdate === 'function') {
        instance.componentWillUpdate(newProps, newState, nextContext);
      }
      if (typeof instance.UNSAFE_componentWillUpdate === 'function') {
        instance.UNSAFE_componentWillUpdate(newProps, newState, nextContext);
      }
    }
    if (typeof instance.componentDidUpdate === 'function') {
      workInProgress.flags |= Update;
    }
    if (typeof instance.getSnapshotBeforeUpdate === 'function') {
      workInProgress.flags |= Snapshot;
    }
  } else {
    // 即使 bailout，若 current 与本轮旧值不同也保留 didUpdate/snapshot effect。
    if (typeof instance.componentDidUpdate === 'function') {
      if (
        unresolvedOldProps !== current.memoizedProps ||
        oldState !== current.memoizedState
      ) {
        workInProgress.flags |= Update;
      }
    }
    if (typeof instance.getSnapshotBeforeUpdate === 'function') {
      if (
        unresolvedOldProps !== current.memoizedProps ||
        oldState !== current.memoizedState
      ) {
        workInProgress.flags |= Snapshot;
      }
    }

    // shouldComponentUpdate 为 false 仍推进 memoized props/state，标记本轮工作可复用。
    workInProgress.memoizedProps = newProps;
    workInProgress.memoizedState = newState;
  }

  // 即使 shouldComponentUpdate 为 false，也推进实例的 state/props/context 指针。
  instance.props = newProps;
  instance.state = newState;
  instance.context = nextContext;

  return shouldUpdate;
}

/**
 * 生成类实例实际接收的 props：移除保留的 ref，并为 undefined 字段补上 defaultProps。
 * 无 ref 且无 truthy defaultProps 时保留输入引用；只要存在 defaultProps 就会克隆，
 * 即使所有属性均已定义。默认值只填 undefined，null 保持原值；本函数不改 baseProps。
 */
export function resolveClassComponentProps(
  Component: any,
  baseProps: Object,
): Object {
  let newProps = baseProps;

  // 若存在 ref，从公开 props 对象移除。
  if ('ref' in baseProps) {
    newProps = {} as any;
    for (const propName in baseProps) {
      if (propName !== 'ref') {
        newProps[propName] = baseProps[propName];
      }
    }
  }

  // 解析 defaultProps。
  const defaultProps = Component.defaultProps;
  if (defaultProps) {
    // 若移除 ref 时已复制，可直接修改；否则先用 Object.assign 克隆。
    if (newProps === baseProps) {
      newProps = assign({}, newProps);
    }
    // 逻辑沿用旧 JSX runtime；此前 defaultProps 在那里解析。
    for (const propName in defaultProps) {
      if (newProps[propName] === undefined) {
        newProps[propName] = defaultProps[propName];
      }
    }
  }

  return newProps;
}

export {
  constructClassInstance,
  mountClassInstance,
  resumeMountClassInstance,
  updateClassInstance,
};
