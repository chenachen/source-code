/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactInternalTypes';

import {runWithFiberInDEV} from './ReactCurrentFiber';
import getComponentNameFromFiber from 'react-reconciler/src/getComponentNameFromFiber';
import {StrictLegacyMode} from './ReactTypeOfMode';

/** 同一 StrictMode 根下需要汇总警告的 Fiber 列表。 */
type FiberArray = Array<Fiber>;
/** StrictMode 根到其遗留 Context 使用者列表的映射。 */
type FiberToFiberComponentsMap = Map<Fiber, FiberArray>;

/**
 * StrictMode 开发期警告的延迟收集器。
 *
 * 渲染阶段只登记不安全生命周期和遗留 Context；随后由工作循环统一 flush，按组件
 * 去重并集中输出，避免同一组件或同一批渲染产生重复日志。生产环境保留空实现，
 * 使调用点无需分支。
 */
const ReactStrictModeWarnings = {
  /** 记录类实例采用的不安全或已弃用生命周期。 */
  recordUnsafeLifecycleWarnings: (fiber: Fiber, instance: any): void => {},
  /** 汇总组件名称并输出本批次所有生命周期警告。 */
  flushPendingUnsafeLifecycleWarnings: (): void => {},
  /** 记录 StrictMode 子树中使用遗留 Context API 的组件。 */
  recordLegacyContextWarning: (fiber: Fiber, instance: any): void => {},
  /** 按 StrictMode 根汇总并输出遗留 Context 警告。 */
  flushLegacyContextWarning: (): void => {},
  /** 丢弃尚未输出的本批次警告，用于放弃渲染时复位。 */
  discardPendingWarnings: (): void => {},
};

if (__DEV__) {
  /** 从当前 Fiber 向上寻找最外层仍带 StrictLegacyMode 的祖先。 */
  const findStrictRoot = (fiber: Fiber): Fiber | null => {
    let maybeStrictRoot = null;

    let node: null | Fiber = fiber;
    while (node !== null) {
      if (node.mode & StrictLegacyMode) {
        maybeStrictRoot = node;
      }
      node = node.return;
    }

    return maybeStrictRoot;
  };

  /** 把去重后的组件名称稳定排序并连接为日志文本。 */
  const setToSortedString = (set: Set<string>) => {
    const array = [];
    set.forEach(value => {
      array.push(value);
    });
    return array.sort().join(', ');
  };

  let pendingComponentWillMountWarnings: Array<Fiber> = [];
  let pendingUNSAFE_ComponentWillMountWarnings: Array<Fiber> = [];
  let pendingComponentWillReceivePropsWarnings: Array<Fiber> = [];
  let pendingUNSAFE_ComponentWillReceivePropsWarnings: Array<Fiber> = [];
  let pendingComponentWillUpdateWarnings: Array<Fiber> = [];
  let pendingUNSAFE_ComponentWillUpdateWarnings: Array<Fiber> = [];

  // 记录已经输出过生命周期警告的组件类型，跨批次继续去重。
  const didWarnAboutUnsafeLifecycles = new Set<mixed>();

  ReactStrictModeWarnings.recordUnsafeLifecycleWarnings = (
    fiber: Fiber,
    instance: any,
  ) => {
    // 去重策略：每种组件类型只警告一次。
    if (didWarnAboutUnsafeLifecycles.has(fiber.type)) {
      return;
    }

    if (
      typeof instance.componentWillMount === 'function' &&
      // react-lifecycles-compat 注入并显式抑制的兼容生命周期不警告。
      instance.componentWillMount.__suppressDeprecationWarning !== true
    ) {
      pendingComponentWillMountWarnings.push(fiber);
    }

    if (
      fiber.mode & StrictLegacyMode &&
      typeof instance.UNSAFE_componentWillMount === 'function'
    ) {
      pendingUNSAFE_ComponentWillMountWarnings.push(fiber);
    }

    if (
      typeof instance.componentWillReceiveProps === 'function' &&
      instance.componentWillReceiveProps.__suppressDeprecationWarning !== true
    ) {
      pendingComponentWillReceivePropsWarnings.push(fiber);
    }

    if (
      fiber.mode & StrictLegacyMode &&
      typeof instance.UNSAFE_componentWillReceiveProps === 'function'
    ) {
      pendingUNSAFE_ComponentWillReceivePropsWarnings.push(fiber);
    }

    if (
      typeof instance.componentWillUpdate === 'function' &&
      instance.componentWillUpdate.__suppressDeprecationWarning !== true
    ) {
      pendingComponentWillUpdateWarnings.push(fiber);
    }

    if (
      fiber.mode & StrictLegacyMode &&
      typeof instance.UNSAFE_componentWillUpdate === 'function'
    ) {
      pendingUNSAFE_ComponentWillUpdateWarnings.push(fiber);
    }
  };

  ReactStrictModeWarnings.flushPendingUnsafeLifecycleWarnings = () => {
    // 第一遍收集并去重组件名称，同时清空本批次队列。
    const componentWillMountUniqueNames = new Set<string>();
    if (pendingComponentWillMountWarnings.length > 0) {
      pendingComponentWillMountWarnings.forEach(fiber => {
        componentWillMountUniqueNames.add(
          getComponentNameFromFiber(fiber) || 'Component',
        );
        didWarnAboutUnsafeLifecycles.add(fiber.type);
      });
      pendingComponentWillMountWarnings = [];
    }

    const UNSAFE_componentWillMountUniqueNames = new Set<string>();
    if (pendingUNSAFE_ComponentWillMountWarnings.length > 0) {
      pendingUNSAFE_ComponentWillMountWarnings.forEach(fiber => {
        UNSAFE_componentWillMountUniqueNames.add(
          getComponentNameFromFiber(fiber) || 'Component',
        );
        didWarnAboutUnsafeLifecycles.add(fiber.type);
      });
      pendingUNSAFE_ComponentWillMountWarnings = [];
    }

    const componentWillReceivePropsUniqueNames = new Set<string>();
    if (pendingComponentWillReceivePropsWarnings.length > 0) {
      pendingComponentWillReceivePropsWarnings.forEach(fiber => {
        componentWillReceivePropsUniqueNames.add(
          getComponentNameFromFiber(fiber) || 'Component',
        );
        didWarnAboutUnsafeLifecycles.add(fiber.type);
      });

      pendingComponentWillReceivePropsWarnings = [];
    }

    const UNSAFE_componentWillReceivePropsUniqueNames = new Set<string>();
    if (pendingUNSAFE_ComponentWillReceivePropsWarnings.length > 0) {
      pendingUNSAFE_ComponentWillReceivePropsWarnings.forEach(fiber => {
        UNSAFE_componentWillReceivePropsUniqueNames.add(
          getComponentNameFromFiber(fiber) || 'Component',
        );
        didWarnAboutUnsafeLifecycles.add(fiber.type);
      });

      pendingUNSAFE_ComponentWillReceivePropsWarnings = [];
    }

    const componentWillUpdateUniqueNames = new Set<string>();
    if (pendingComponentWillUpdateWarnings.length > 0) {
      pendingComponentWillUpdateWarnings.forEach(fiber => {
        componentWillUpdateUniqueNames.add(
          getComponentNameFromFiber(fiber) || 'Component',
        );
        didWarnAboutUnsafeLifecycles.add(fiber.type);
      });

      pendingComponentWillUpdateWarnings = [];
    }

    const UNSAFE_componentWillUpdateUniqueNames = new Set<string>();
    if (pendingUNSAFE_ComponentWillUpdateWarnings.length > 0) {
      pendingUNSAFE_ComponentWillUpdateWarnings.forEach(fiber => {
        UNSAFE_componentWillUpdateUniqueNames.add(
          getComponentNameFromFiber(fiber) || 'Component',
        );
        didWarnAboutUnsafeLifecycles.add(fiber.type);
      });

      pendingUNSAFE_ComponentWillUpdateWarnings = [];
    }

    // 最后统一输出；先输出更醒目的 UNSAFE_ 警告，再输出旧名称弃用警告。
    if (UNSAFE_componentWillMountUniqueNames.size > 0) {
      const sortedNames = setToSortedString(
        UNSAFE_componentWillMountUniqueNames,
      );
      console.error(
        'Using UNSAFE_componentWillMount in strict mode is not recommended and may indicate bugs in your code. ' +
          'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
          '* Move code with side effects to componentDidMount, and set initial state in the constructor.\n' +
          '\nPlease update the following components: %s',
        sortedNames,
      );
    }

    if (UNSAFE_componentWillReceivePropsUniqueNames.size > 0) {
      const sortedNames = setToSortedString(
        UNSAFE_componentWillReceivePropsUniqueNames,
      );
      console.error(
        'Using UNSAFE_componentWillReceiveProps in strict mode is not recommended ' +
          'and may indicate bugs in your code. ' +
          'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
          '* Move data fetching code or side effects to componentDidUpdate.\n' +
          "* If you're updating state whenever props change, " +
          'refactor your code to use memoization techniques or move it to ' +
          'static getDerivedStateFromProps. Learn more at: https://react.dev/link/derived-state\n' +
          '\nPlease update the following components: %s',
        sortedNames,
      );
    }

    if (UNSAFE_componentWillUpdateUniqueNames.size > 0) {
      const sortedNames = setToSortedString(
        UNSAFE_componentWillUpdateUniqueNames,
      );
      console.error(
        'Using UNSAFE_componentWillUpdate in strict mode is not recommended ' +
          'and may indicate bugs in your code. ' +
          'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
          '* Move data fetching code or side effects to componentDidUpdate.\n' +
          '\nPlease update the following components: %s',
        sortedNames,
      );
    }

    if (componentWillMountUniqueNames.size > 0) {
      const sortedNames = setToSortedString(componentWillMountUniqueNames);

      console.warn(
        'componentWillMount has been renamed, and is not recommended for use. ' +
          'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
          '* Move code with side effects to componentDidMount, and set initial state in the constructor.\n' +
          '* Rename componentWillMount to UNSAFE_componentWillMount to suppress ' +
          'this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. ' +
          'To rename all deprecated lifecycles to their new names, you can run ' +
          '`npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n' +
          '\nPlease update the following components: %s',
        sortedNames,
      );
    }

    if (componentWillReceivePropsUniqueNames.size > 0) {
      const sortedNames = setToSortedString(
        componentWillReceivePropsUniqueNames,
      );

      console.warn(
        'componentWillReceiveProps has been renamed, and is not recommended for use. ' +
          'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
          '* Move data fetching code or side effects to componentDidUpdate.\n' +
          "* If you're updating state whenever props change, refactor your " +
          'code to use memoization techniques or move it to ' +
          'static getDerivedStateFromProps. Learn more at: https://react.dev/link/derived-state\n' +
          '* Rename componentWillReceiveProps to UNSAFE_componentWillReceiveProps to suppress ' +
          'this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. ' +
          'To rename all deprecated lifecycles to their new names, you can run ' +
          '`npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n' +
          '\nPlease update the following components: %s',
        sortedNames,
      );
    }

    if (componentWillUpdateUniqueNames.size > 0) {
      const sortedNames = setToSortedString(componentWillUpdateUniqueNames);

      console.warn(
        'componentWillUpdate has been renamed, and is not recommended for use. ' +
          'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
          '* Move data fetching code or side effects to componentDidUpdate.\n' +
          '* Rename componentWillUpdate to UNSAFE_componentWillUpdate to suppress ' +
          'this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. ' +
          'To rename all deprecated lifecycles to their new names, you can run ' +
          '`npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n' +
          '\nPlease update the following components: %s',
        sortedNames,
      );
    }
  };

  let pendingLegacyContextWarning: FiberToFiberComponentsMap = new Map();

  // 记录已经输出过遗留 Context 警告的组件类型，跨批次继续去重。
  const didWarnAboutLegacyContext = new Set<mixed>();

  ReactStrictModeWarnings.recordLegacyContextWarning = (
    fiber: Fiber,
    instance: any,
  ) => {
    const strictRoot = findStrictRoot(fiber);
    if (strictRoot === null) {
      console.error(
        'Expected to find a StrictMode component in a strict mode tree. ' +
          'This error is likely caused by a bug in React. Please file an issue.',
      );
      return;
    }

    // 去重策略：每种组件类型只警告一次。
    if (didWarnAboutLegacyContext.has(fiber.type)) {
      return;
    }

    let warningsForRoot = pendingLegacyContextWarning.get(strictRoot);

    if (
      fiber.type.contextTypes != null ||
      fiber.type.childContextTypes != null ||
      (instance !== null && typeof instance.getChildContext === 'function')
    ) {
      if (warningsForRoot === undefined) {
        warningsForRoot = [];
        pendingLegacyContextWarning.set(strictRoot, warningsForRoot);
      }
      warningsForRoot.push(fiber);
    }
  };

  ReactStrictModeWarnings.flushLegacyContextWarning = () => {
    (pendingLegacyContextWarning as any as FiberToFiberComponentsMap).forEach(
      (fiberArray: FiberArray, strictRoot) => {
        if (fiberArray.length === 0) {
          return;
        }
        const firstFiber = fiberArray[0];

        const uniqueNames = new Set<string>();
        fiberArray.forEach(fiber => {
          uniqueNames.add(getComponentNameFromFiber(fiber) || 'Component');
          didWarnAboutLegacyContext.add(fiber.type);
        });

        const sortedNames = setToSortedString(uniqueNames);

        runWithFiberInDEV(firstFiber, () => {
          console.error(
            'Legacy context API has been detected within a strict-mode tree.' +
              '\n\nThe old API will be supported in all 16.x releases, but applications ' +
              'using it should migrate to the new version.' +
              '\n\nPlease update the following components: %s' +
              '\n\nLearn more about this warning here: https://react.dev/link/legacy-context',
            sortedNames,
          );
        });
      },
    );
  };

  ReactStrictModeWarnings.discardPendingWarnings = () => {
    pendingComponentWillMountWarnings = [];
    pendingUNSAFE_ComponentWillMountWarnings = [];
    pendingComponentWillReceivePropsWarnings = [];
    pendingUNSAFE_ComponentWillReceivePropsWarnings = [];
    pendingComponentWillUpdateWarnings = [];
    pendingUNSAFE_ComponentWillUpdateWarnings = [];
    pendingLegacyContextWarning = new Map();
  };
}

export default ReactStrictModeWarnings;
