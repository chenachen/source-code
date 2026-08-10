/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {DOMEventName} from '../events/DOMEventNames';
import type {Fiber, FiberRoot} from 'react-reconciler/src/ReactInternalTypes';
import type {
  BoundingRect,
  IntersectionObserverOptions,
  ObserveVisibleRectsCallback,
} from 'react-reconciler/src/ReactTestSelectors';
import type {ReactContext, ReactScopeInstance} from 'shared/ReactTypes';
import type {AncestorInfoDev} from './validateDOMNesting';
import type {FormStatus} from 'react-dom-bindings/src/shared/ReactDOMFormActions';
import type {
  CrossOriginEnum,
  PreloadImplOptions,
  PreloadModuleImplOptions,
  PreinitStyleOptions,
  PreinitScriptOptions,
  PreinitModuleScriptOptions,
} from 'react-dom/src/shared/ReactDOMTypes';
import type {TransitionTypes} from 'react/src/ReactTransitionType';

import {NotPending} from '../shared/ReactDOMFormActions';

import {setSrcObject} from './ReactDOMSrcObject';

import {getCurrentRootHostContainer} from 'react-reconciler/src/ReactFiberHostContext';
import {runWithFiberInDEV} from 'react-reconciler/src/ReactCurrentFiber';

import hasOwnProperty from 'shared/hasOwnProperty';
import {checkAttributeStringCoercion} from 'shared/CheckStringCoercion';
import {REACT_CONTEXT_TYPE} from 'shared/ReactSymbols';

export {
  setCurrentUpdatePriority,
  getCurrentUpdatePriority,
  resolveUpdatePriority,
} from './ReactDOMUpdatePriority';
import {
  precacheFiberNode,
  updateFiberProps,
  getFiberCurrentPropsFromNode,
  getInstanceFromNode,
  getClosestInstanceFromNode,
  getFiberFromScopeInstance,
  getInstanceFromNode as getInstanceFromNodeDOMTree,
  isContainerMarkedAsRoot,
  detachDeletedInstance,
  getResourcesFromRoot,
  isMarkedHoistable,
  markNodeAsHoistable,
  markNodeAsPendingLoad,
  clearPendingLoadOnNode,
  isNodePendingLoad,
  isOwnedInstance,
} from './ReactDOMComponentTree';
import {
  traverseFragmentInstancesAndTextInstances,
  getFragmentParentInstanceOrContainerFiber,
  getInstanceFromHostFiber,
  isFiberFollowing,
  isFiberPreceding,
  getFragmentInstanceOrTextInstanceSiblings,
  traverseFragmentInstancesAndTextInstancesDeeply,
  fiberIsPortaledIntoHost,
  isFiberContainedByFragment,
  isFragmentContainedByFiber,
} from 'react-reconciler/src/ReactFiberTreeReflection';
import {compareDocumentPositionForEmptyFragment} from 'shared/ReactDOMFragmentRefShared';

export {detachDeletedInstance};
import {hasRole} from './DOMAccessibilityRoles';
import type {SingletonType} from './ReactDOMComponent';
import {
  setInitialProperties,
  updateProperties,
  clearSingletonProperties,
  hydrateProperties,
  hydrateText,
  diffHydratedProperties,
  getPropsFromElement,
  diffHydratedText,
  trapClickOnNonInteractiveElement,
  clearClickListener,
} from './ReactDOMComponent';
import {hydrateInput} from './ReactDOMInput';
import {hydrateTextarea} from './ReactDOMTextarea';
import {hydrateSelect} from './ReactDOMSelect';
import {getSelectionInformation, restoreSelection} from './ReactInputSelection';
import setTextContent from './setTextContent';
import {
  validateDOMNesting,
  validateTextNesting,
  updatedAncestorInfoDev,
} from './validateDOMNesting';
import {
  isEnabled as ReactBrowserEventEmitterIsEnabled,
  setEnabled as ReactBrowserEventEmitterSetEnabled,
} from '../events/ReactDOMEventListener';
import {SVG_NAMESPACE, MATH_NAMESPACE} from './DOMNamespaces';
import {
  ELEMENT_NODE,
  TEXT_NODE,
  COMMENT_NODE,
  DOCUMENT_NODE,
  DOCUMENT_TYPE_NODE,
  DOCUMENT_FRAGMENT_NODE,
} from './HTMLNodeType';

import {
  flushEventReplaying,
  retryIfBlockedOn,
} from '../events/ReactDOMEventReplaying';

import {
  enableCreateEventHandleAPI,
  enableScopeAPI,
  enableTrustedTypesIntegration,
  disableLegacyMode,
  enableMoveBefore,
  disableCommentsAsDOMContainers,
  enableSuspenseyImages,
  enableSrcObject,
  enableViewTransition,
  enableHydrationChangeEvent,
  enableFragmentRefsScrollIntoView,
  enableProfilerTimer,
  enableFragmentRefsInstanceHandles,
  enableFragmentRefsTextNodes,
} from 'shared/ReactFeatureFlags';
import {
  HostComponent,
  HostHoistable,
  HostText,
  HostSingleton,
} from 'react-reconciler/src/ReactWorkTags';
import {listenToAllSupportedEvents} from '../events/DOMPluginEventSystem';
import {validateLinkPropsForStyleResource} from '../shared/ReactDOMResourceValidation';
import escapeSelectorAttributeValueInsideDoubleQuotes from './escapeSelectorAttributeValueInsideDoubleQuotes';
import {flushSyncWork as flushSyncWorkOnAllRoots} from 'react-reconciler/src/ReactFiberWorkLoop';
import {requestFormReset as requestFormResetOnFiber} from 'react-reconciler/src/ReactFiberHooks';

import ReactDOMSharedInternals from 'shared/ReactDOMSharedInternals';

export {default as rendererVersion} from 'shared/ReactVersion';

import noop from 'shared/noop';
import estimateBandwidth from './estimateBandwidth';

/** `rendererPackageName` 保存DOM Host Config 的宿主类型、props 与协议常量所需的稳定配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
export const rendererPackageName = 'react-dom';
/** `extraDevToolsConfig` 保存DOM Host Config 的宿主类型、props 与协议常量所需的稳定配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
export const extraDevToolsConfig = null;

/** `Type` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type Type = string;
/** `Props` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type Props = {
  /** `Props.autoFocus` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  autoFocus?: boolean,
  /** `Props.children` 表示由当前 Fiber 子树拥有的宿主子节点；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  children?: mixed,
  /** `Props.disabled` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  disabled?: boolean,
  /** `Props.hidden` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  hidden?: boolean,
  /** `Props.suppressHydrationWarning` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  suppressHydrationWarning?: boolean,
  /** `Props.dangerouslySetInnerHTML` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  dangerouslySetInnerHTML?: mixed,
  /** `Props.style` 表示宿主样式或布局位置状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  style?: {
    /** `Props.display` 表示宿主样式或布局位置状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
    display?: string,
    /** `Props.viewTransitionName` 表示View Transition 测量使用的几何快照；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
    viewTransitionName?: string,
    /** `Props.view-transition-name` 表示View Transition 测量使用的几何快照；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
    'view-transition-name'?: string,
    /** `Props.viewTransitionClass` 表示View Transition 测量使用的几何快照；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
    viewTransitionClass?: string,
    /** `Props.view-transition-class` 表示View Transition 测量使用的几何快照；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
    'view-transition-class'?: string,
    /** `Props.margin` 表示宿主样式或布局位置状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
    margin?: string,
    /** `Props.marginTop` 表示宿主样式或布局位置状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
    marginTop?: string,
    /** `Props.margin-top` 表示宿主样式或布局位置状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
    'margin-top'?: string,
    /** `Props.marginBottom` 表示宿主样式或布局位置状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
    marginBottom?: string,
    /** `Props.margin-bottom` 表示宿主样式或布局位置状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
    'margin-bottom'?: string,
    ...
  },
  /** `Props.bottom` 表示宿主样式或布局位置状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  bottom?: null | number,
  /** `Props.left` 表示宿主样式或布局位置状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  left?: null | number,
  /** `Props.right` 表示宿主样式或布局位置状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  right?: null | number,
  /** `Props.top` 表示宿主样式或布局位置状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  top?: null | number,
  /** `Props.is` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  is?: string,
  /** `Props.size` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  size?: number,
  /** `Props.value` 表示表单受控值及默认值边界；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  value?: string,
  /** `Props.defaultValue` 表示表单受控值及默认值边界；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  defaultValue?: string,
  /** `Props.checked` 表示表单受控值及默认值边界；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  checked?: boolean,
  /** `Props.defaultChecked` 表示表单受控值及默认值边界；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  defaultChecked?: boolean,
  /** `Props.multiple` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  multiple?: boolean,
  /** `Props.type` 表示宿主标签、资源或事件类别；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  type?: string,
  /** `Props.src` 表示资源去重和插入排序使用的键；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  src?: string | Blob | MediaSource | MediaStream, //待办事项：响应
  srcSet?: string,
  /** `Props.loading` 表示资源加载、引用计数或解除挂起状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  loading?: 'eager' | 'lazy',
  /** `Props.onLoad` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于DOM Host Config 的宿主类型、props 与协议常量。 */
  onLoad?: (event: any) => void,
  ...
};
/** `RawProps` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type RawProps = {
  /** `RawProps.string` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  [string]: mixed,
};
/** `EventTargetChildElement` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type EventTargetChildElement = {
  /** `EventTargetChildElement.type` 表示宿主标签、资源或事件类别；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  type: string,
  /** `EventTargetChildElement.props` 表示宿主元素最近提交或待 hydration 的 props；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  props: null | {
    /** `EventTargetChildElement.style` 表示宿主样式或布局位置状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
    style?: {
      /** `EventTargetChildElement.position` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
      position?: string,
      /** `EventTargetChildElement.zIndex` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
      zIndex?: number,
      /** `EventTargetChildElement.bottom` 表示宿主样式或布局位置状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
      bottom?: string,
      /** `EventTargetChildElement.left` 表示宿主样式或布局位置状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
      left?: string,
      /** `EventTargetChildElement.right` 表示宿主样式或布局位置状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
      right?: string,
      /** `EventTargetChildElement.top` 表示宿主样式或布局位置状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
      top?: string,
      ...
    },
    ...
  },
  ...
};

/** `Container` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type Container =
  | interface extends Element {
      /** 旧版根挂载在 Element 上的 FiberRoot 引用；仅用于兼容根查找。 */
      _reactRootContainer?: FiberRoot
    }
  | interface extends Document {
      /** 旧版根挂载在 Document 上的 FiberRoot 引用；仅用于兼容根查找。 */
      _reactRootContainer?: FiberRoot
    }
  | interface extends DocumentFragment {
      /** 旧版根挂载在 DocumentFragment 上的 FiberRoot 引用。 */
      _reactRootContainer?: FiberRoot
    };
/** `Instance` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type Instance = Element;
/** `TextInstance` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type TextInstance = Text;

/** `InstanceWithFragmentHandles` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type InstanceWithFragmentHandles = Instance & {
  /** `InstanceWithFragmentHandles.reactFragments` 表示Fragment handle 与 Fiber 的关联身份；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  reactFragments?: Set<FragmentInstanceType>,
};
/** `HostNodeWithFragmentHandles` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type HostNodeWithFragmentHandles = (Instance | TextInstance) & {
  /** `HostNodeWithFragmentHandles.reactFragments` 表示Fragment handle 与 Fiber 的关联身份；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  reactFragments?: Set<FragmentInstanceType>,
};

/** `ActivityInterface` 代表DOM Host Config 的宿主类型、props 与协议常量中的浏览器宿主对象类别；renderer 只持有引用，不自行构造其内部状态。 */
declare class ActivityInterface extends Comment {}
/** `SuspenseInterface` 代表DOM Host Config 的宿主类型、props 与协议常量中的浏览器宿主对象类别；renderer 只持有引用，不自行构造其内部状态。 */
declare class SuspenseInterface extends Comment {
  /** `_reactRetry` 表示边界解除阻塞后由 reconciler 注入的重试回调；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  _reactRetry: void | (() => void);
}

/** `ActivityInstance` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type ActivityInstance = ActivityInterface;
/** `SuspenseInstance` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type SuspenseInstance = SuspenseInterface;

/** `FormStateMarkerInstance` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type FormStateMarkerInstance = Comment;
/** `HydratableInstance` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type HydratableInstance =
  | Instance
  | TextInstance
  | ActivityInstance
  | SuspenseInstance
  | FormStateMarkerInstance;
/** `PublicInstance` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type PublicInstance = Element | Text;
/** `HostContextDev` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type HostContextDev = {
  /** `HostContextDev.context` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  context: HostContextProd,
  /** `HostContextDev.ancestorInfo` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  ancestorInfo: AncestorInfoDev,
};
/** `HostContextProd` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type HostContextProd = HostContextNamespace;
/** `HostContext` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type HostContext = HostContextDev | HostContextProd;
/** `UpdatePayload` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type UpdatePayload = Array<mixed>;
/** `ChildSet` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type ChildSet = void; //未使用
/** `TimeoutHandle` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type TimeoutHandle = TimeoutID;
/** `NoTimeout` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type NoTimeout = -1;
/** `RendererInspectionConfig` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type RendererInspectionConfig = $ReadOnly<{}>;

/** `TransitionStatus` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type TransitionStatus = FormStatus;

/** `ViewTransitionInstance` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type ViewTransitionInstance = {
  /** `ViewTransitionInstance.name` 表示View Transition 或伪元素定位标识；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  name: string,
  /** `ViewTransitionInstance.group` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  group: mixin$Animatable,
  /** `ViewTransitionInstance.imagePair` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  imagePair: mixin$Animatable,
  /** `ViewTransitionInstance.old` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  old: mixin$Animatable,
  /** `ViewTransitionInstance.new` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  new: mixin$Animatable,
};

/** `SelectionInformation` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type SelectionInformation = {
  /** `SelectionInformation.focusedElem` 表示提交前捕获的焦点与选择区；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  focusedElem: null | HTMLElement,
  /** `SelectionInformation.selectionRange` 表示提交前捕获的焦点与选择区；仅在DOM Host Config 的宿主类型、props 与协议常量生命周期内有效。 */
  selectionRange: mixed,
};

/** `SUPPRESS_HYDRATION_WARNING` 是DOM Host Config 的宿主类型、props 与协议常量使用的稳定协议值、超时或 DOM 标记；必须与消费者约定一致。 */
const SUPPRESS_HYDRATION_WARNING = 'suppressHydrationWarning';

/** `ACTIVITY_START_DATA` 是DOM Host Config 的宿主类型、props 与协议常量使用的稳定协议值、超时或 DOM 标记；必须与消费者约定一致。 */
const ACTIVITY_START_DATA = '&';
/** `ACTIVITY_END_DATA` 是DOM Host Config 的宿主类型、props 与协议常量使用的稳定协议值、超时或 DOM 标记；必须与消费者约定一致。 */
const ACTIVITY_END_DATA = '/&';
/** `SUSPENSE_START_DATA` 是DOM Host Config 的宿主类型、props 与协议常量使用的稳定协议值、超时或 DOM 标记；必须与消费者约定一致。 */
const SUSPENSE_START_DATA = '$';
/** `SUSPENSE_END_DATA` 是DOM Host Config 的宿主类型、props 与协议常量使用的稳定协议值、超时或 DOM 标记；必须与消费者约定一致。 */
const SUSPENSE_END_DATA = '/$';
/** `SUSPENSE_PENDING_START_DATA` 是DOM Host Config 的宿主类型、props 与协议常量使用的稳定协议值、超时或 DOM 标记；必须与消费者约定一致。 */
const SUSPENSE_PENDING_START_DATA = '$?';
/** `SUSPENSE_QUEUED_START_DATA` 是DOM Host Config 的宿主类型、props 与协议常量使用的稳定协议值、超时或 DOM 标记；必须与消费者约定一致。 */
const SUSPENSE_QUEUED_START_DATA = '$~';
/** `SUSPENSE_FALLBACK_START_DATA` 是DOM Host Config 的宿主类型、props 与协议常量使用的稳定协议值、超时或 DOM 标记；必须与消费者约定一致。 */
const SUSPENSE_FALLBACK_START_DATA = '$!';
/** `PREAMBLE_CONTRIBUTION_HTML` 是DOM Host Config 的宿主类型、props 与协议常量使用的稳定协议值、超时或 DOM 标记；必须与消费者约定一致。 */
const PREAMBLE_CONTRIBUTION_HTML = 'html';
/** `PREAMBLE_CONTRIBUTION_BODY` 是DOM Host Config 的宿主类型、props 与协议常量使用的稳定协议值、超时或 DOM 标记；必须与消费者约定一致。 */
const PREAMBLE_CONTRIBUTION_BODY = 'body';
/** `PREAMBLE_CONTRIBUTION_HEAD` 是DOM Host Config 的宿主类型、props 与协议常量使用的稳定协议值、超时或 DOM 标记；必须与消费者约定一致。 */
const PREAMBLE_CONTRIBUTION_HEAD = 'head';
/** `FORM_STATE_IS_MATCHING` 是DOM Host Config 的宿主类型、props 与协议常量使用的稳定协议值、超时或 DOM 标记；必须与消费者约定一致。 */
const FORM_STATE_IS_MATCHING = 'F!';
/** `FORM_STATE_IS_NOT_MATCHING` 是DOM Host Config 的宿主类型、props 与协议常量使用的稳定协议值、超时或 DOM 标记；必须与消费者约定一致。 */
const FORM_STATE_IS_NOT_MATCHING = 'F';

/** `DOCUMENT_READY_STATE_LOADING` 是DOM Host Config 的宿主类型、props 与协议常量使用的稳定协议值、超时或 DOM 标记；必须与消费者约定一致。 */
const DOCUMENT_READY_STATE_LOADING = 'loading';

/** `STYLE` 是DOM Host Config 的宿主类型、props 与协议常量使用的稳定协议值、超时或 DOM 标记；必须与消费者约定一致。 */
const STYLE = 'style';

/** `HostContextNamespace` 定义DOM Host Config 的宿主类型、props 与协议常量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
opaque type HostContextNamespace = 0 | 1 | 2;
/** `HostContextNamespaceNone` 保存DOM Host Config 的宿主类型、props 与协议常量所需的稳定配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
export const HostContextNamespaceNone: HostContextNamespace = 0;
/** `HostContextNamespaceSvg` 保存DOM Host Config 的宿主类型、props 与协议常量所需的稳定配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
const HostContextNamespaceSvg: HostContextNamespace = 1;
/** `HostContextNamespaceMath` 保存DOM Host Config 的宿主类型、props 与协议常量所需的稳定配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
const HostContextNamespaceMath: HostContextNamespace = 2;

let eventsEnabled: ?boolean = null;
let selectionInformation: null | SelectionInformation = null;

export * from 'react-reconciler/src/ReactFiberConfigWithNoPersistence';

/** `getOwnerDocumentFromRootContainer` 查询、匹配或计算所需结果；不适用时返回协议约定的空值；属于根/子宿主上下文、实例创建与调度桥接。 */
function getOwnerDocumentFromRootContainer(
  rootContainerElement: Element | Document | DocumentFragment,
): Document {
  return rootContainerElement.nodeType === DOCUMENT_NODE
    ? (rootContainerElement as any)
    : rootContainerElement.ownerDocument;
}

/** `getRootHostContext` 查询、匹配或计算所需结果；不适用时返回协议约定的空值；属于根/子宿主上下文、实例创建与调度桥接。 */
export function getRootHostContext(
  rootContainerInstance: Container,
): HostContext {
  let type;
  let context: HostContextProd;
  const nodeType = rootContainerInstance.nodeType;
  switch (nodeType) {
    case DOCUMENT_NODE:
    case DOCUMENT_FRAGMENT_NODE: {
      type = nodeType === DOCUMENT_NODE ? '#document' : '#fragment';
      const root = (rootContainerInstance as any).documentElement;
      if (root) {
        const namespaceURI = root.namespaceURI;
        context = namespaceURI
          ? getOwnHostContext(namespaceURI)
          : HostContextNamespaceNone;
      } else {
        context = HostContextNamespaceNone;
      }
      break;
    }
    default: {
      const container: any =
        !disableCommentsAsDOMContainers && nodeType === COMMENT_NODE
          ? rootContainerInstance.parentNode
          : rootContainerInstance;
      type = container.tagName;
      const namespaceURI = container.namespaceURI;
      if (!namespaceURI) {
        switch (type) {
          case 'svg':
            context = HostContextNamespaceSvg;
            break;
          case 'math':
            context = HostContextNamespaceMath;
            break;
          default:
            context = HostContextNamespaceNone;
            break;
        }
      } else {
        const ownContext = getOwnHostContext(namespaceURI);
        context = getChildHostContextProd(ownContext, type);
      }
      break;
    }
  }
  if (__DEV__) {
    const validatedTag = type.toLowerCase();
    const ancestorInfo = updatedAncestorInfoDev(null, validatedTag);
    return {context, ancestorInfo};
  }
  return context;
}

/** `getOwnHostContext` 查询、匹配或计算所需结果；不适用时返回协议约定的空值；属于根/子宿主上下文、实例创建与调度桥接。 */
function getOwnHostContext(namespaceURI: string): HostContextNamespace {
  switch (namespaceURI) {
    case SVG_NAMESPACE:
      return HostContextNamespaceSvg;
    case MATH_NAMESPACE:
      return HostContextNamespaceMath;
    default:
      return HostContextNamespaceNone;
  }
}

/** `getChildHostContextProd` 查询、匹配或计算所需结果；不适用时返回协议约定的空值；属于根/子宿主上下文、实例创建与调度桥接。 */
function getChildHostContextProd(
  parentNamespace: HostContextNamespace,
  type: string,
): HostContextNamespace {
  if (parentNamespace === HostContextNamespaceNone) {
    //没有（或默认）父命名空间：潜在的入口点。
    switch (type) {
      case 'svg':
        return HostContextNamespaceSvg;
      case 'math':
        return HostContextNamespaceMath;
      default:
        return HostContextNamespaceNone;
    }
  }
  if (parentNamespace === HostContextNamespaceSvg && type === 'foreignObject') {
    //我们正在离开SVG。
    return HostContextNamespaceNone;
  }
  //默认情况下，传递下面的命名空间。
  return parentNamespace;
}

/** `getChildHostContext` 查询、匹配或计算所需结果；不适用时返回协议约定的空值；属于根/子宿主上下文、实例创建与调度桥接。 */
export function getChildHostContext(
  parentHostContext: HostContext,
  type: string,
): HostContext {
  if (__DEV__) {
    const parentHostContextDev = parentHostContext as any as HostContextDev;
    const context = getChildHostContextProd(parentHostContextDev.context, type);
    const ancestorInfo = updatedAncestorInfoDev(
      parentHostContextDev.ancestorInfo,
      type,
    );
    return {context, ancestorInfo};
  }
  const parentNamespace = parentHostContext as any as HostContextProd;
  return getChildHostContextProd(parentNamespace, type);
}

/** `getPublicInstance` 查询、匹配或计算所需结果；不适用时返回协议约定的空值；属于根/子宿主上下文、实例创建与调度桥接。 */
export function getPublicInstance(instance: Instance): Instance {
  return instance;
}

/** `prepareForCommit` 建立阶段边界，确保后续提交看到已准备的 DOM 状态；属于根/子宿主上下文、实例创建与调度桥接。 */
export function prepareForCommit(containerInfo: Container): Object | null {
  eventsEnabled = ReactBrowserEventEmitterIsEnabled();
  selectionInformation = getSelectionInformation(containerInfo);
  let activeInstance = null;
  if (enableCreateEventHandleAPI) {
    const focusedElem = selectionInformation.focusedElem;
    if (focusedElem !== null) {
      activeInstance = getClosestInstanceFromNode(focusedElem);
    }
  }
  ReactBrowserEventEmitterSetEnabled(false);
  return activeInstance;
}

/** `beforeActiveInstanceBlur` 建立阶段边界，确保后续提交看到已准备的 DOM 状态；属于根/子宿主上下文、实例创建与调度桥接。 */
export function beforeActiveInstanceBlur(internalInstanceHandle: Object): void {
  if (enableCreateEventHandleAPI) {
    ReactBrowserEventEmitterSetEnabled(true);
    dispatchBeforeDetachedBlur(
      (selectionInformation as any).focusedElem,
      internalInstanceHandle,
    );
    ReactBrowserEventEmitterSetEnabled(false);
  }
}

/** `afterActiveInstanceBlur` 建立阶段边界，确保后续提交看到已准备的 DOM 状态；属于根/子宿主上下文、实例创建与调度桥接。 */
export function afterActiveInstanceBlur(): void {
  if (enableCreateEventHandleAPI) {
    ReactBrowserEventEmitterSetEnabled(true);
    dispatchAfterDetachedBlur((selectionInformation as any).focusedElem);
    ReactBrowserEventEmitterSetEnabled(false);
  }
}

/** `resetAfterCommit` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于根/子宿主上下文、实例创建与调度桥接。 */
export function resetAfterCommit(containerInfo: Container): void {
  restoreSelection(selectionInformation, containerInfo);
  ReactBrowserEventEmitterSetEnabled(eventsEnabled);
  eventsEnabled = null;
  selectionInformation = null;
}

/** `createHoistableInstance` 创建宿主对象或快照，并把所有权交给当前提交阶段；属于根/子宿主上下文、实例创建与调度桥接。 */
export function createHoistableInstance(
  type: string,
  props: Props,
  rootContainerInstance: Container,
  internalInstanceHandle: Object,
): Instance {
  const ownerDocument = getOwnerDocumentFromRootContainer(
    rootContainerInstance,
  );

  const domElement: Instance = ownerDocument.createElement(type);
  precacheFiberNode(internalInstanceHandle, domElement);
  updateFiberProps(domElement, props);
  setInitialProperties(domElement, type, props);
  markNodeAsHoistable(domElement);
  return domElement;
}

let didWarnScriptTags = false;
/** `isScriptDataBlock` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于根/子宿主上下文、实例创建与调度桥接。 */
function isScriptDataBlock(props: Props): boolean {
  const scriptType = props.type;
  if (typeof scriptType !== 'string' || scriptType === '') {
    return false;
  }
  const lower = scriptType.toLowerCase();
  //HTML 规范识别的特殊非 MIME 关键字 TODO: 也许不警告将这些类型解析为“解析器插入”的也可以
  if (
    lower === 'module' ||
    lower === 'importmap' ||
    lower === 'speculationrules'
  ) {
    return false;
  }
  //根据 https://mimesniff.spec.whatwg.org/#javascript-mime-type 的 JavaScript MIME 类型
  switch (lower) {
    case 'application/ecmascript':
    case 'application/javascript':
    case 'application/x-ecmascript':
    case 'application/x-javascript':
    case 'text/ecmascript':
    case 'text/javascript':
    case 'text/javascript1.0':
    case 'text/javascript1.1':
    case 'text/javascript1.2':
    case 'text/javascript1.3':
    case 'text/javascript1.4':
    case 'text/javascript1.5':
    case 'text/jscript':
    case 'text/livescript':
    case 'text/x-ecmascript':
    case 'text/x-javascript':
      return false;
  }
  //任何其他非空类型的值都表示这是一个数据块
  return true;
}
/** `warnedUnknownTags` 保存根/子宿主上下文、实例创建与调度桥接所需的稳定配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
const warnedUnknownTags: {
  /** `key` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在根/子宿主上下文、实例创建与调度桥接生命周期内有效。 */
  [key: string]: boolean,
} = {
  //<dialog> 有可用的 polyfill。让人们使用它。
  dialog: true,
  //Electron 提供了一个自定义的 <webview> 标签，用于在隔离的框架和进程中显示外部网页内容。这个标签在非 Electron 环境中不存在，例如 JSDom，JSDom 常用于测试目的。@see https://electronjs.org/docs/api/webview-tag
  webview: true,
};

/** `createInstance` 创建宿主对象或快照，并把所有权交给当前提交阶段；属于根/子宿主上下文、实例创建与调度桥接。 */
export function createInstance(
  type: string,
  props: Props,
  rootContainerInstance: Container,
  hostContext: HostContext,
  internalInstanceHandle: Object,
): Instance {
  let hostContextProd: HostContextProd;
  if (__DEV__) {
    //待办：在验证时考虑命名空间。
    const hostContextDev: HostContextDev = hostContext as any;
    validateDOMNesting(type, hostContextDev.ancestorInfo);
    hostContextProd = hostContextDev.context;
  } else {
    hostContextProd = hostContext as any;
  }

  const ownerDocument = getOwnerDocumentFromRootContainer(
    rootContainerInstance,
  );

  let domElement: Instance;
  switch (hostContextProd) {
    case HostContextNamespaceSvg:
      domElement = ownerDocument.createElementNS(SVG_NAMESPACE, type);
      break;
    case HostContextNamespaceMath:
      domElement = ownerDocument.createElementNS(MATH_NAMESPACE, type);
      break;
    default:
      switch (type) {
        case 'svg': {
          domElement = ownerDocument.createElementNS(SVG_NAMESPACE, type);
          break;
        }
        case 'math': {
          domElement = ownerDocument.createElementNS(MATH_NAMESPACE, type);
          break;
        }
        case 'script': {
          //通过 .innerHTML 创建脚本，这样它的“parser-inserted” 标志会被设置为 true 并且不会执行
          const div = ownerDocument.createElement('div');
          if (__DEV__) {
            if (
              enableTrustedTypesIntegration &&
              !didWarnScriptTags &&
              //数据块脚本无论如何都不会被 UA 执行，所以我们不需要警告：https://html.spec.whatwg.org/multipage/scripting.html#attr-script-type
              !isScriptDataBlock(props)
            ) {
              console.error(
                'Encountered a script tag while rendering React component. ' +
                  'Scripts inside React components are never executed when rendering ' +
                  'on the client. Consider using template tag instead ' +
                  '(https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template).',
              );
              didWarnScriptTags = true;
            }
          }
          div.innerHTML = '<script><' + '/script>';
          //这可以保证生成一个脚本元素。
          const firstChild = div.firstChild as any as HTMLScriptElement;
          domElement = div.removeChild(firstChild);
          break;
        }
        case 'select': {
          if (typeof props.is === 'string') {
            domElement = ownerDocument.createElement('select', {is: props.is});
          } else {
            //由于 Firefox 的一个 bug，请将 else 分支分开，而不要使用 `props.is || undefined`。请参阅 https://github.com/facebook/react/pull/6896 中的讨论和 https://bugzilla.mozilla.org/show_bug.cgi?id=1276240 中的讨论。
            domElement = ownerDocument.createElement('select');
          }
          if (props.multiple) {
            domElement.multiple = true;
          } else if (props.size) {
            //将大小设置为大于 1 会导致选择框表现得像 `multiple=true`，其中可能没有选项被选中。
            //
            //这仅在“单选模式”的选择中是必要的。
            domElement.size = props.size;
          }
          break;
        }
        default: {
          if (typeof props.is === 'string') {
            domElement = ownerDocument.createElement(type, {is: props.is});
          } else {
            //由于 Firefox 的一个 bug，请使用单独的 else 分支，而不是上面的 `props.is || undefined`。讨论见 https://github.com/facebook/react/pull/6896 和 https://bugzilla.mozilla.org/show_bug.cgi?id=1276240
            domElement = ownerDocument.createElement(type);
          }

          if (__DEV__) {
            if (type.indexOf('-') === -1) {
              //我们不是 SVG/MathML 并且我们没有连字符，所以我们不是自定义元素。即使你使用 `is`，这些也应该是已知类型并且小写。
              if (type !== type.toLowerCase()) {
                console.error(
                  '<%s /> is using incorrect casing. ' +
                    'Use PascalCase for React components, ' +
                    'or lowercase for HTML elements.',
                  type,
                );
              }
              if (
                // $FlowFixMe[method-unbinding]
                Object.prototype.toString.call(domElement) ===
                  '[object HTMLUnknownElement]' &&
                !hasOwnProperty.call(warnedUnknownTags, type)
              ) {
                warnedUnknownTags[type] = true;
                console.error(
                  'The tag <%s> is unrecognized in this browser. ' +
                    'If you meant to render a React component, start its name with ' +
                    'an uppercase letter.',
                  type,
                );
              }
            }
          }
        }
      }
  }
  precacheFiberNode(internalInstanceHandle, domElement);
  updateFiberProps(domElement, props);
  return domElement;
}

let didWarnForClone = false;

/** `cloneMutableInstance` 创建宿主对象或快照，并把所有权交给当前提交阶段；属于根/子宿主上下文、实例创建与调度桥接。 */
export function cloneMutableInstance(
  instance: Instance,
  keepChildren: boolean,
): Instance {
  if (__DEV__) {
    //警告问题
    const tagName = instance.tagName;
    switch (tagName) {
      case 'VIDEO':
      case 'IFRAME':
        if (!didWarnForClone) {
          didWarnForClone = true;
          //待办：一旦我们有能力避免克隆根元素，就建议使用绝对定位的 ViewTransition 作为解决方案。
          console.warn(
            'startGestureTransition() required cloning a <%s> element since it exists in ' +
              'both states of the gesture. This can be problematic since it will load it twice ' +
              'Try removing or hiding it with <Activity mode="offscreen"> in the optimistic state.',
            tagName.toLowerCase(),
          );
        }
        break;
    }
  }
  return instance.cloneNode(keepChildren);
}

/** `appendInitialChild` 登记或挂接目标，维持宿主顺序与资源引用计数；属于根/子宿主上下文、实例创建与调度桥接。 */
export function appendInitialChild(
  parentInstance: Instance,
  child: Instance | TextInstance,
): void {
  //注意：这不应该使用 moveBefore()，因为初始项是在未连接时追加的。
  parentInstance.appendChild(child);
}

/** `finalizeInitialChildren` 建立阶段边界，确保后续提交看到已准备的 DOM 状态；属于根/子宿主上下文、实例创建与调度桥接。 */
export function finalizeInitialChildren(
  domElement: Instance,
  type: string,
  props: Props,
  hostContext: HostContext,
): boolean {
  setInitialProperties(domElement, type, props);
  switch (type) {
    case 'button':
    case 'input':
    case 'select':
    case 'textarea':
      return !!props.autoFocus;
    case 'img':
      return true;
    default:
      return false;
  }
}

/** `finalizeHydratedChildren` 建立阶段边界，确保后续提交看到已准备的 DOM 状态；属于根/子宿主上下文、实例创建与调度桥接。 */
export function finalizeHydratedChildren(
  domElement: Instance,
  type: string,
  props: Props,
  hostContext: HostContext,
): boolean {
  //待办：考虑将此与 hydrateInstance 统一。
  if (!enableHydrationChangeEvent) {
    return false;
  }
  switch (type) {
    case 'input':
    case 'select':
    case 'textarea':
    case 'img':
      return true;
    default:
      return false;
  }
}

/** `shouldSetTextContent` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于根/子宿主上下文、实例创建与调度桥接。 */
export function shouldSetTextContent(type: string, props: Props): boolean {
  return (
    type === 'textarea' ||
    type === 'noscript' ||
    typeof props.children === 'string' ||
    typeof props.children === 'number' ||
    typeof props.children === 'bigint' ||
    (typeof props.dangerouslySetInnerHTML === 'object' &&
      props.dangerouslySetInnerHTML !== null &&
      props.dangerouslySetInnerHTML.__html != null)
  );
}

/** `createTextInstance` 创建宿主对象或快照，并把所有权交给当前提交阶段；属于根/子宿主上下文、实例创建与调度桥接。 */
export function createTextInstance(
  text: string,
  rootContainerInstance: Container,
  hostContext: HostContext,
  internalInstanceHandle: Object,
): TextInstance {
  if (__DEV__) {
    const hostContextDev = hostContext as any as HostContextDev;
    const ancestor = hostContextDev.ancestorInfo.current;
    if (ancestor != null) {
      validateTextNesting(
        text,
        ancestor.tag,
        hostContextDev.ancestorInfo.implicitRootScope,
      );
    }
  }
  const textNode: TextInstance = getOwnerDocumentFromRootContainer(
    rootContainerInstance,
  ).createTextNode(text);
  precacheFiberNode(internalInstanceHandle, textNode);
  return textNode;
}

/** `cloneMutableTextInstance` 创建宿主对象或快照，并把所有权交给当前提交阶段；属于根/子宿主上下文、实例创建与调度桥接。 */
export function cloneMutableTextInstance(
  textInstance: TextInstance,
): TextInstance {
  return textInstance.cloneNode(false);
}

let currentPopstateTransitionEvent: Event | null = null;
/** `shouldAttemptEagerTransition` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于根/子宿主上下文、实例创建与调度桥接。 */
export function shouldAttemptEagerTransition(): boolean {
  const event = window.event;
  if (event && event.type === 'popstate') {
    //这是一个 popstate 事件。尝试在此事件期间同步渲染任何过渡。除非我们已经在此事件期间尝试过。
    if (event === currentPopstateTransitionEvent) {
      //我们已经尝试同步呈现这个 popstate 转换。任何后续的尝试必须是由派生更新触发的，例如在 useEffect 内的 startTransition，或 useDV。在当前 popstate 事件期间，将所有剩余转换切换回默认行为。
      return false;
    } else {
      //缓存当前事件，以防派生转换被调度。（参考之前的分支。）
      currentPopstateTransitionEvent = event;
      return true;
    }
  }
  //我们不在 popstate 事件中。
  currentPopstateTransitionEvent = null;
  return false;
}

let schedulerEvent: void | Event = undefined;
/** `trackSchedulerEvent` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于根/子宿主上下文、实例创建与调度桥接。 */
export function trackSchedulerEvent(): void {
  schedulerEvent = window.event;
}

/** `resolveEventType` 查询、匹配或计算所需结果；不适用时返回协议约定的空值；属于根/子宿主上下文、实例创建与调度桥接。 */
export function resolveEventType(): null | string {
  const event = window.event;
  return event && event !== schedulerEvent ? event.type : null;
}

/** `resolveEventTimeStamp` 查询、匹配或计算所需结果；不适用时返回协议约定的空值；属于根/子宿主上下文、实例创建与调度桥接。 */
export function resolveEventTimeStamp(): number {
  const event = window.event;
  return event && event !== schedulerEvent ? event.timeStamp : -1.1;
}

/** `isPrimaryRenderer` 保存根/子宿主上下文、实例创建与调度桥接所需的稳定配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
export const isPrimaryRenderer = true;
/** `warnsIfNotActing` 保存根/子宿主上下文、实例创建与调度桥接所需的稳定配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
export const warnsIfNotActing = true;
//如果一个组件只是导入了 ReactDOM（例如用于 findDOMNode），这段初始化代码甚至可能在服务器环境中运行。有些环境可能没有 setTimeout 或 clearTimeout。
export const scheduleTimeout: any =
  typeof setTimeout === 'function' ? setTimeout : (undefined as any);
/** `cancelTimeout` 保存根/子宿主上下文、实例创建与调度桥接所需的稳定配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
export const cancelTimeout: any =
  typeof clearTimeout === 'function' ? clearTimeout : (undefined as any);
/** `noTimeout` 保存根/子宿主上下文、实例创建与调度桥接所需的稳定配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
export const noTimeout: -1 = -1;
/** `localPromise` 保存根/子宿主上下文、实例创建与调度桥接所需的稳定配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
const localPromise = typeof Promise === 'function' ? Promise : undefined;
/** `localRequestAnimationFrame` 保存根/子宿主上下文、实例创建与调度桥接所需的稳定配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
const localRequestAnimationFrame =
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : scheduleTimeout;

export {getClosestInstanceFromNode as getInstanceFromNode};

/** `preparePortalMount` 建立阶段边界，确保后续提交看到已准备的 DOM 状态；属于根/子宿主上下文、实例创建与调度桥接。 */
export function preparePortalMount(portalInstance: Instance): void {
  listenToAllSupportedEvents(portalInstance);
}

/** `prepareScopeUpdate` 建立阶段边界，确保后续提交看到已准备的 DOM 状态；属于根/子宿主上下文、实例创建与调度桥接。 */
export function prepareScopeUpdate(
  scopeInstance: ReactScopeInstance,
  internalInstanceHandle: Object,
): void {
  if (enableScopeAPI) {
    precacheFiberNode(internalInstanceHandle, scopeInstance);
  }
}

/** `getInstanceFromScope` 查询、匹配或计算所需结果；不适用时返回协议约定的空值；属于mutation 提交、节点插入移除及可见性切换。 */
export function getInstanceFromScope(
  scopeInstance: ReactScopeInstance,
): null | Object {
  if (enableScopeAPI) {
    return getFiberFromScopeInstance(scopeInstance);
  }
  return null;
}

// -------------------
//微任务
// -------------------
export const supportsMicrotasks = true;
/** `scheduleMicrotask` 保存mutation 提交、节点插入移除及可见性切换所需的稳定配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
export const scheduleMicrotask: any =
  typeof queueMicrotask === 'function'
    ? queueMicrotask
    : typeof localPromise !== 'undefined'
      ? callback =>
          localPromise.resolve(null).then(callback).catch(handleErrorInNextTick)
      : scheduleTimeout; //待办：在这里确定最佳备用方案。

/** `handleErrorInNextTick` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于mutation 提交、节点插入移除及可见性切换。 */
function handleErrorInNextTick(error: any) {
  setTimeout(() => {
    throw error;
  });
}

// -------------------
//突变
// -------------------

/** `supportsMutation` 声明 renderer 是否支持对应 Host Config 能力；reconciler 据此选择合法分支。 */
export const supportsMutation = true;

/** `commitMount` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于mutation 提交、节点插入移除及可见性切换。 */
export function commitMount(
  domElement: Instance,
  type: string,
  newProps: Props,
  internalInstanceHandle: Object,
): void {
  //尽管名称可能暗示其他情况，这种方法只有在挂载期间有 `Update` effect 被调度时才会触发。如果 `finalizeInitialChildren` 返回 `true`（它确实如此，以在客户端实现 `autoFocus` 属性），就会发生这种情况。但也有其他情况可能发生这种情况（例如在水合不匹配期间修补文本内容）。所以我们会再次检查这个问题。
  switch (type) {
    case 'button':
    case 'input':
    case 'select':
    case 'textarea':
      if (newProps.autoFocus) {
        (
          domElement as any as
            | HTMLButtonElement
            | HTMLInputElement
            | HTMLSelectElement
            | HTMLTextAreaElement
        ).focus();
      }
      return;
    case 'img': {
      //这里的技巧是分配 src 或 srcSet 属性以使浏览器发出新的加载事件。如果它还没有加载完成，它将在实际完成加载时触发。如果它已经加载，我们就错过了它，因此第二次加载仍然会是第一次执行任何相关 onLoad 属性的加载。即使我们有 srcSet，我们也更倾向于重新分配 src。原因是 Firefox 在仅分配 srcSet 时不会触发新的加载事件。Chrome 如果分配任一属性都会触发加载事件，所以我们只需要分配一个。而 Safari 根本不会触发新的加载事件，这意味着无论分配哪个属性，这种技巧实际上已经无效。如果浏览器在未来更新了这种机制，我们应该重新审视此方案。
      if (newProps.src) {
        const src = (newProps as any).src;
        if (enableSrcObject && typeof src === 'object') {
          //对于对象 src，我们不能仅仅将 src 再次设置为相同的 blob URL，因为如果之前已经加载过，它可能已经被撤销了。然而，我们可以创建一个新的 blob URL 并设置它。这相对来说开销不大，因为 blob 已经在内存中，但这可能会导致一些重复工作。待办事项：我们也许可以检测加载事件是否尚未触发，如果尚未触发，则可以重用该 URL。
          try {
            setSrcObject(domElement, type, src);
            return;
          } catch (x) {
            //如果 URL.createObjectURL() 出现错误，可能是其他类型的对象应该使用 toString 方法，因此我们只是继续走正常路径。
          }
        }
        (domElement as any as HTMLImageElement).src = src;
      } else if (newProps.srcSet) {
        (domElement as any as HTMLImageElement).srcset = (
          newProps as any
        ).srcSet;
      }
      return;
    }
  }
}

/** `commitHydratedInstance` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于mutation 提交、节点插入移除及可见性切换。 */
export function commitHydratedInstance(
  domElement: Instance,
  type: string,
  props: Props,
  internalInstanceHandle: Object,
): void {
  if (!enableHydrationChangeEvent) {
    return;
  }
  //如果一个已水合的实例在提交阶段需要做进一步的工作，这将在提交阶段触发。类似于 commitMount。然而，这不应该做那些已经发生的事情，例如设置自动聚焦，因为那会抢占焦点。只有当 finalizeHydratedChildren 返回 true 时才会安排它。
  switch (type) {
    case 'input': {
      hydrateInput(
        domElement,
        props.value,
        props.defaultValue,
        props.checked,
        props.defaultChecked,
      );
      break;
    }
    case 'select': {
      hydrateSelect(
        domElement,
        props.value,
        props.defaultValue,
        props.multiple,
      );
      break;
    }
    case 'textarea':
      hydrateTextarea(domElement, props.value, props.defaultValue);
      break;
    case 'img':
      //待办事项：我们应该重新播放 onLoad 事件吗？
      break;
  }
}

/** `commitUpdate` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于mutation 提交、节点插入移除及可见性切换。 */
export function commitUpdate(
  domElement: Instance,
  type: string,
  oldProps: Props,
  newProps: Props,
  internalInstanceHandle: Object,
): void {
  //比较并更新属性。
  updateProperties(domElement, type, oldProps, newProps);

  //更新 props 句柄，以便我们知道哪些 props 是带有当前事件处理程序的。
  updateFiberProps(domElement, newProps);
}

/** `resetTextContent` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于mutation 提交、节点插入移除及可见性切换。 */
export function resetTextContent(domElement: Instance): void {
  setTextContent(domElement, '');
}

/** `commitTextUpdate` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于mutation 提交、节点插入移除及可见性切换。 */
export function commitTextUpdate(
  textInstance: TextInstance,
  oldText: string,
  newText: string,
): void {
  textInstance.nodeValue = newText;
}

/** `supportsMoveBefore` 声明 renderer 是否支持对应 Host Config 能力；reconciler 据此选择合法分支。 */
const supportsMoveBefore =
  // $FlowFixMe[prop-missing]: We're doing the feature detection here.
  enableMoveBefore &&
  typeof window !== 'undefined' &&
  typeof window.Element.prototype.moveBefore === 'function';

/** `appendChild` 登记或挂接目标，维持宿主顺序与资源引用计数；属于mutation 提交、节点插入移除及可见性切换。 */
export function appendChild(
  parentInstance: Instance,
  child: Instance | TextInstance,
): void {
  if (supportsMoveBefore && child.parentNode !== null) {
    // $FlowFixMe[prop-missing]: We've checked this with supportsMoveBefore.
    parentInstance.moveBefore(child, null);
  } else {
    parentInstance.appendChild(child);
  }
}

/** `warnForReactChildrenConflict` 验证宿主不变量并构造开发期诊断，不改变生产语义；属于mutation 提交、节点插入移除及可见性切换。 */
function warnForReactChildrenConflict(container: Container): void {
  if (__DEV__) {
    if ((container as any).__reactWarnedAboutChildrenConflict) {
      return;
    }
    const props = getFiberCurrentPropsFromNode(container);
    if (props !== null) {
      const fiber = getInstanceFromNode(container);
      if (fiber !== null) {
        if (
          typeof props.children === 'string' ||
          typeof props.children === 'number'
        ) {
          (container as any).__reactWarnedAboutChildrenConflict = true;
          //使用容器的 Fiber 运行警告，以了解指定子组件的位置。我们也可能使用 Portal。当前的执行上下文是正在添加的子组件。
          runWithFiberInDEV(fiber, () => {
            console.error(
              'Cannot use a ref on a React element as a container to `createRoot` or `createPortal` ' +
                'if that element also sets "children" text content using React. It should be a leaf with no children. ' +
                "Otherwise it's ambiguous which children should be used.",
            );
          });
        } else if (props.dangerouslySetInnerHTML != null) {
          (container as any).__reactWarnedAboutChildrenConflict = true;
          runWithFiberInDEV(fiber, () => {
            console.error(
              'Cannot use a ref on a React element as a container to `createRoot` or `createPortal` ' +
                'if that element also sets "dangerouslySetInnerHTML" using React. It should be a leaf with no children. ' +
                "Otherwise it's ambiguous which children should be used.",
            );
          });
        }
      }
    }
  }
}

/** `appendChildToContainer` 登记或挂接目标，维持宿主顺序与资源引用计数；属于mutation 提交、节点插入移除及可见性切换。 */
export function appendChildToContainer(
  container: Container,
  child: Instance | TextInstance,
): void {
  if (__DEV__) {
    warnForReactChildrenConflict(container);
  }
  let parentNode: DocumentFragment | Element;
  if (container.nodeType === DOCUMENT_NODE) {
    parentNode = (container as any).body;
  } else if (
    !disableCommentsAsDOMContainers &&
    container.nodeType === COMMENT_NODE
  ) {
    parentNode = container.parentNode as any;
    if (supportsMoveBefore && child.parentNode !== null) {
      // $FlowFixMe[prop-missing]: We've checked this with supportsMoveBefore.
      parentNode.moveBefore(child, container);
    } else {
      parentNode.insertBefore(child, container);
    }
    return;
  } else if (container.nodeName === 'HTML') {
    parentNode = container.ownerDocument.body as any;
  } else {
    parentNode = container as any;
  }
  if (supportsMoveBefore && child.parentNode !== null) {
    // $FlowFixMe[prop-missing]: We've checked this with supportsMoveBefore.
    parentNode.moveBefore(child, null);
  } else {
    parentNode.appendChild(child);
  }

  //这个容器可能用于门户。如果点击门户内部的某个内容，该点击应该在 React 树中冒泡。然而，在移动端 Safari 上，点击事件除非存在带有 onclick 事件的祖先，否则永远不会在 *DOM* 树中冒泡。所以我们不会看到它，也无法分发它。这就是为什么我们确保非 React 根容器定义了内联 onclick。https://github.com/facebook/react/issues/11918
  const reactRootContainer = container._reactRootContainer;
  if (
    // $FlowFixMe[invalid-compare]
    (reactRootContainer === null || reactRootContainer === undefined) &&
    parentNode.onclick === null
  ) {
    //待办：此类型转换可能对 SVG、MathML 或自定义元素不安全。
    trapClickOnNonInteractiveElement(parentNode as any as HTMLElement);
  }
}

/** `insertBefore` 登记或挂接目标，维持宿主顺序与资源引用计数；属于mutation 提交、节点插入移除及可见性切换。 */
export function insertBefore(
  parentInstance: Instance,
  child: Instance | TextInstance,
  beforeChild: Instance | TextInstance | SuspenseInstance | ActivityInstance,
): void {
  if (supportsMoveBefore && child.parentNode !== null) {
    // $FlowFixMe[prop-missing]: We've checked this with supportsMoveBefore.
    parentInstance.moveBefore(child, beforeChild);
  } else {
    parentInstance.insertBefore(child, beforeChild);
  }
}

/** `insertInContainerBefore` 登记或挂接目标，维持宿主顺序与资源引用计数；属于mutation 提交、节点插入移除及可见性切换。 */
export function insertInContainerBefore(
  container: Container,
  child: Instance | TextInstance,
  beforeChild: Instance | TextInstance | SuspenseInstance | ActivityInstance,
): void {
  if (__DEV__) {
    warnForReactChildrenConflict(container);
  }
  let parentNode: DocumentFragment | Element;
  if (container.nodeType === DOCUMENT_NODE) {
    parentNode = (container as any).body;
  } else if (
    !disableCommentsAsDOMContainers &&
    container.nodeType === COMMENT_NODE
  ) {
    parentNode = container.parentNode as any;
  } else if (container.nodeName === 'HTML') {
    parentNode = container.ownerDocument.body as any;
  } else {
    parentNode = container as any;
  }
  if (supportsMoveBefore && child.parentNode !== null) {
    // $FlowFixMe[prop-missing]: We've checked this with supportsMoveBefore.
    parentNode.moveBefore(child, beforeChild);
  } else {
    parentNode.insertBefore(child, beforeChild);
  }
}

/** `isSingletonScope` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于mutation 提交、节点插入移除及可见性切换。 */
export function isSingletonScope(type: string): boolean {
  return type === 'head';
}

/** `createEvent` 创建宿主对象或快照，并把所有权交给当前提交阶段；属于mutation 提交、节点插入移除及可见性切换。 */
function createEvent(type: DOMEventName, bubbles: boolean): Event {
  const event = document.createEvent('Event');
  event.initEvent(type as any as string, bubbles, false);
  return event;
}

/** `dispatchBeforeDetachedBlur` 沿 Fragment 或事件边界执行 DOM 操作，限制影响范围；属于mutation 提交、节点插入移除及可见性切换。 */
function dispatchBeforeDetachedBlur(
  target: HTMLElement,
  internalInstanceHandle: Object,
): void {
  if (enableCreateEventHandleAPI) {
    const event = createEvent('beforeblur', true);
    //直接在目标上分发“beforeblur”，这样它会被事件系统捕获，并且可以在 React 内部树中传播。
    // $FlowFixMe[prop-missing]: internal field
    event._detachedInterceptFiber = internalInstanceHandle;
    target.dispatchEvent(event);
  }
}

/** `dispatchAfterDetachedBlur` 沿 Fragment 或事件边界执行 DOM 操作，限制影响范围；属于mutation 提交、节点插入移除及可见性切换。 */
function dispatchAfterDetachedBlur(target: HTMLElement): void {
  if (enableCreateEventHandleAPI) {
    const event = createEvent('afterblur', false);
    //因此我们知道被分离的内容，在“afterblur”事件中将 relatedTarget 设置为被分离的目标。
    (event as any).relatedTarget = target;
    //在文档上分发事件。
    document.dispatchEvent(event);
  }
}

/** `removeChild` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于mutation 提交、节点插入移除及可见性切换。 */
export function removeChild(
  parentInstance: Instance,
  child: Instance | TextInstance | SuspenseInstance | ActivityInstance,
): void {
  parentInstance.removeChild(child);
}

/** `removeChildFromContainer` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于mutation 提交、节点插入移除及可见性切换。 */
export function removeChildFromContainer(
  container: Container,
  child: Instance | TextInstance | SuspenseInstance | ActivityInstance,
): void {
  let parentNode: DocumentFragment | Element;
  if (container.nodeType === DOCUMENT_NODE) {
    parentNode = (container as any).body;
  } else if (
    !disableCommentsAsDOMContainers &&
    container.nodeType === COMMENT_NODE
  ) {
    parentNode = container.parentNode as any;
  } else if (container.nodeName === 'HTML') {
    parentNode = container.ownerDocument.body as any;
  } else {
    parentNode = container as any;
  }
  parentNode.removeChild(child);
}

/** `clearHydrationBoundary` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于mutation 提交、节点插入移除及可见性切换。 */
function clearHydrationBoundary(
  parentInstance: Instance,
  hydrationInstance: SuspenseInstance | ActivityInstance,
): void {
  let node: Node = hydrationInstance;
  //删除此 Suspense 边界内的所有节点。可能存在嵌套节点，所以我们需要跟踪当前的深度，并且只有在回到最顶层时才跳出。
  let depth = 0;
  do {
    const nextNode = node.nextSibling;
    parentInstance.removeChild(node);
    if (nextNode && nextNode.nodeType === COMMENT_NODE) {
      const data = (nextNode as any).data as string;
      if (data === SUSPENSE_END_DATA || data === ACTIVITY_END_DATA) {
        if (depth === 0) {
          parentInstance.removeChild(nextNode);
          //如果此处的任何事件重放被阻止，请重试。
          retryIfBlockedOn(hydrationInstance);
          return;
        } else {
          depth--;
        }
      } else if (
        data === SUSPENSE_START_DATA ||
        data === SUSPENSE_PENDING_START_DATA ||
        data === SUSPENSE_QUEUED_START_DATA ||
        data === SUSPENSE_FALLBACK_START_DATA ||
        data === ACTIVITY_START_DATA
      ) {
        depth++;
      } else if (data === PREAMBLE_CONTRIBUTION_HTML) {
        //如果在此边界范围内发现了前言贡献标记，则它对 HTML 标签有贡献，我们需要将其重置。
        const ownerDocument = parentInstance.ownerDocument;
        const documentElement: Element = ownerDocument.documentElement as any;
        clearSingletonPreambleContribution(documentElement);
      } else if (data === PREAMBLE_CONTRIBUTION_HEAD) {
        const ownerDocument = parentInstance.ownerDocument;
        const head: Element = ownerDocument.head as any;
        clearSingletonPreambleContribution(head);
        //我们需要清理头部，因为这是唯一一个可以拥有属于此边界但不在此边界内的子节点的单例。
        clearHead(head);
      } else if (data === PREAMBLE_CONTRIBUTION_BODY) {
        const ownerDocument = parentInstance.ownerDocument;
        const body: Element = ownerDocument.body as any;
        clearSingletonPreambleContribution(body);
      }
    }
    // $FlowFixMe[incompatible-type] we bail out when we get a null
    node = nextNode;
  } while (node);
  //待办：警告，我们未找到结束注释边界。如果有任何事件重放因这个被阻塞，请重试。
  retryIfBlockedOn(hydrationInstance);
}

/** `clearActivityBoundary` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于mutation 提交、节点插入移除及可见性切换。 */
export function clearActivityBoundary(
  parentInstance: Instance,
  activityInstance: ActivityInstance,
): void {
  clearHydrationBoundary(parentInstance, activityInstance);
}

/** `clearSuspenseBoundary` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于mutation 提交、节点插入移除及可见性切换。 */
export function clearSuspenseBoundary(
  parentInstance: Instance,
  suspenseInstance: SuspenseInstance,
): void {
  clearHydrationBoundary(parentInstance, suspenseInstance);
}

/** `clearHydrationBoundaryFromContainer` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于mutation 提交、节点插入移除及可见性切换。 */
function clearHydrationBoundaryFromContainer(
  container: Container,
  hydrationInstance: SuspenseInstance | ActivityInstance,
): void {
  let parentNode: DocumentFragment | Element;
  if (container.nodeType === DOCUMENT_NODE) {
    parentNode = (container as any).body;
  } else if (
    !disableCommentsAsDOMContainers &&
    container.nodeType === COMMENT_NODE
  ) {
    parentNode = container.parentNode as any;
  } else if (container.nodeName === 'HTML') {
    parentNode = container.ownerDocument.body as any;
  } else {
    parentNode = container as any;
  }
  clearHydrationBoundary(parentNode, hydrationInstance);
  //如果此处的任何事件重放被阻止，请重试。
  retryIfBlockedOn(container);
}

/** `clearActivityBoundaryFromContainer` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于mutation 提交、节点插入移除及可见性切换。 */
export function clearActivityBoundaryFromContainer(
  container: Container,
  activityInstance: ActivityInstance,
): void {
  clearHydrationBoundaryFromContainer(container, activityInstance);
}

/** `clearSuspenseBoundaryFromContainer` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于mutation 提交、节点插入移除及可见性切换。 */
export function clearSuspenseBoundaryFromContainer(
  container: Container,
  suspenseInstance: SuspenseInstance,
): void {
  clearHydrationBoundaryFromContainer(container, suspenseInstance);
}

/** `hideOrUnhideDehydratedBoundary` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于mutation 提交、节点插入移除及可见性切换。 */
function hideOrUnhideDehydratedBoundary(
  suspenseInstance: SuspenseInstance | ActivityInstance,
  isHidden: boolean,
) {
  let node: Node = suspenseInstance;
  //显示此悬念边界内的所有节点。
  let depth = 0;
  do {
    const nextNode = node.nextSibling;
    if (node.nodeType === ELEMENT_NODE) {
      const instance = node as any as HTMLElement & {
        /** 隐藏 dehydrated 边界前保存的 display；解除隐藏时恢复并清除空 style。 */
        _stashedDisplay?: string
      };
      if (isHidden) {
        instance._stashedDisplay = instance.style.display;
        instance.style.display = 'none';
      } else {
        instance.style.display = instance._stashedDisplay || '';
        if (instance.getAttribute('style') === '') {
          instance.removeAttribute('style');
        }
      }
    } else if (node.nodeType === TEXT_NODE) {
      const textNode = node as any as Text & {
        /** 隐藏 dehydrated 边界前保存的文本；解除隐藏时写回 nodeValue。 */
        _stashedText?: string
      };
      if (isHidden) {
        textNode._stashedText = textNode.nodeValue;
        textNode.nodeValue = '';
      } else {
        textNode.nodeValue = textNode._stashedText || '';
      }
    }
    if (nextNode && nextNode.nodeType === COMMENT_NODE) {
      const data = (nextNode as any).data as string;
      if (data === SUSPENSE_END_DATA) {
        if (depth === 0) {
          return;
        } else {
          depth--;
        }
      } else if (
        data === SUSPENSE_START_DATA ||
        data === SUSPENSE_PENDING_START_DATA ||
        data === SUSPENSE_QUEUED_START_DATA ||
        data === SUSPENSE_FALLBACK_START_DATA
      ) {
        depth++;
      }
      //待办：在这种情况下我们是否应该隐藏前言贡献？
    }
    // $FlowFixMe[incompatible-type] we bail out when we get a null
    node = nextNode;
  } while (node);
}

/** `hideDehydratedBoundary` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于mutation 提交、节点插入移除及可见性切换。 */
export function hideDehydratedBoundary(
  suspenseInstance: SuspenseInstance,
): void {
  hideOrUnhideDehydratedBoundary(suspenseInstance, true);
}

/** `hideInstance` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于mutation 提交、节点插入移除及可见性切换。 */
export function hideInstance(instance: Instance): void {
  //待办：这适用于所有元素类型吗？MathML 呢？我们应该将宿主上下文传递给此方法吗？
  instance = instance as any as HTMLElement;
  const style = instance.style;
  // $FlowFixMe[method-unbinding]
  if (typeof style.setProperty === 'function') {
    style.setProperty('display', 'none', 'important');
  } else {
    style.display = 'none';
  }
}

/** `hideTextInstance` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于mutation 提交、节点插入移除及可见性切换。 */
export function hideTextInstance(textInstance: TextInstance): void {
  textInstance.nodeValue = '';
}

/** `unhideDehydratedBoundary` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于mutation 提交、节点插入移除及可见性切换。 */
export function unhideDehydratedBoundary(
  dehydratedInstance: SuspenseInstance | ActivityInstance,
): void {
  hideOrUnhideDehydratedBoundary(dehydratedInstance, false);
}

/** `unhideInstance` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于mutation 提交、节点插入移除及可见性切换。 */
export function unhideInstance(instance: Instance, props: Props): void {
  instance = instance as any as HTMLElement;
  const styleProp = props[STYLE];
  const display =
    styleProp !== undefined &&
    // $FlowFixMe[invalid-compare]
    styleProp !== null &&
    styleProp.hasOwnProperty('display')
      ? styleProp.display
      : null;
  instance.style.display =
    display == null || typeof display === 'boolean'
      ? ''
      : //如果不安全的话，这个值早就出错了。
        // eslint-disable-next-line react-internal/safe-string-coercion
        ('' + display).trim();
}

/** `unhideTextInstance` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于mutation 提交、节点插入移除及可见性切换。 */
export function unhideTextInstance(
  textInstance: TextInstance,
  text: string,
): void {
  textInstance.nodeValue = text;
}

/** `warnForBlockInsideInline` 验证宿主不变量并构造开发期诊断，不改变生产语义；属于View Transition 样式暂存、克隆与几何测量。 */
function warnForBlockInsideInline(instance: HTMLElement) {
  if (__DEV__) {
    let nextNode = instance.firstChild;
    outer: while (nextNode != null) {
      let node: Node = nextNode;
      if (
        node.nodeType === ELEMENT_NODE &&
        getComputedStyle(node as any).display === 'block'
      ) {
        const fiber =
          getInstanceFromNode(node) || getInstanceFromNode(instance);
        runWithFiberInDEV(
          fiber,
          (parentTag: string, childTag: string) => {
            console.error(
              "You're about to start a <ViewTransition> around a display: inline " +
                'element <%s>, which itself has a display: block element <%s> inside it. ' +
                'This might trigger a bug in Safari which causes the View Transition to ' +
                'be skipped with a duplicate name error.\n' +
                'https://bugs.webkit.org/show_bug.cgi?id=290923',
              parentTag.toLocaleLowerCase(),
              childTag.toLocaleLowerCase(),
            );
          },
          instance.tagName,
          (node as any).tagName,
        );
        break;
      }
      if (node.firstChild != null) {
        nextNode = node.firstChild;
        continue;
      }
      if (node === instance) {
        break;
      }
      while (node.nextSibling == null) {
        if (node.parentNode == null || node.parentNode === instance) {
          break;
        }
        node = node.parentNode;
      }
      nextNode = node.nextSibling;
    }
  }
}

/** `countClientRects` 查询、匹配或计算所需结果；不适用时返回协议约定的空值；属于View Transition 样式暂存、克隆与几何测量。 */
function countClientRects(rects: Array<ClientRect>): number {
  if (rects.length === 1) {
    return 1;
  }
  //计算非零矩形。
  let count = 0;
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    if (rect.width > 0 && rect.height > 0) {
      count++;
    }
  }
  return count;
}

/** `applyViewTransitionName` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于View Transition 样式暂存、克隆与几何测量。 */
export function applyViewTransitionName(
  instance: Instance,
  name: string,
  className: ?string,
): void {
  instance = instance as any as HTMLElement;
  //如果名称不是有效的 CSS 标识符，则改为对名称进行 base64 编码。这不能让你在自定义 CSS 选择器中选择它，但在当前浏览器中可用。
  const escapedName =
    CSS.escape(name) !== name ? 'r-' + btoa(name).replace(/=/g, '') : name;
  // $FlowFixMe[prop-missing]
  instance.style.viewTransitionName = escapedName;
  if (className != null) {
    // $FlowFixMe[prop-missing]
    instance.style.viewTransitionClass = className;
  }
  const computedStyle = getComputedStyle(instance);
  if (computedStyle.display === 'inline') {
    //WebKit 有一个错误，当给 display: inline 元素分配名称时，如果它们有 display: block 子元素，会出现错误。我们尝试在简单情况下通过自动将其转换为 display: inline-block 来解决这个错误。https://bugs.webkit.org/show_bug.cgi?id=290923
    const rects = instance.getClientRects();
    if (
      // $FlowFixMe[incompatible-type]
      countClientRects(rects) === 1
    ) {
      //如果实例只有一个客户端矩形，这意味着它可以表示为 display: inline-block 或 block。这会导致布局抖动，但我们可以接受，因为内联视图过渡不常见。
      const style = instance.style;
      //如果实际上只有一个矩形，那么它很可能在单独一行上，就像一个行内块。如果有多个矩形，但除一个之外的所有矩形都是空的，这很可能是因为是一个块导致了换行。
      style.display = rects.length === 1 ? 'inline-block' : 'block';
      //边距不适用于行内元素，所以应该为零。然而，上下内边距适用于行内块布局，我们可以通过将边距设置为负内边距来抵消，以使其回到原来的位置。
      style.marginTop = '-' + computedStyle.paddingTop;
      style.marginBottom = '-' + computedStyle.paddingBottom;
    } else {
      //如果这个情况有阻塞，它无法轻易修复，但如果没有阻塞也没关系。因此，我们只在开发环境中警告这是一个问题。
      warnForBlockInsideInline(instance);
    }
  }
}

/** `restoreViewTransitionName` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于View Transition 样式暂存、克隆与几何测量。 */
export function restoreViewTransitionName(
  instance: Instance,
  props: Props,
): void {
  instance = instance as any as HTMLElement;
  const style = instance.style;
  const styleProp = props[STYLE];
  const viewTransitionName =
    styleProp != null
      ? styleProp.hasOwnProperty('viewTransitionName')
        ? styleProp.viewTransitionName
        : styleProp.hasOwnProperty('view-transition-name')
          ? styleProp['view-transition-name']
          : null
      : null;
  // $FlowFixMe[prop-missing]
  style.viewTransitionName =
    viewTransitionName == null || typeof viewTransitionName === 'boolean'
      ? ''
      : //如果不安全的话，这个值早就出错了。
        // eslint-disable-next-line react-internal/safe-string-coercion
        ('' + viewTransitionName).trim();
  const viewTransitionClass =
    styleProp != null
      ? styleProp.hasOwnProperty('viewTransitionClass')
        ? styleProp.viewTransitionClass
        : styleProp.hasOwnProperty('view-transition-class')
          ? styleProp['view-transition-class']
          : null
      : null;
  // $FlowFixMe[prop-missing]
  style.viewTransitionClass =
    viewTransitionClass == null || typeof viewTransitionClass === 'boolean'
      ? ''
      : //如果不安全的话，这个值早就出错了。
        // eslint-disable-next-line react-internal/safe-string-coercion
        ('' + viewTransitionClass).trim();
  if (style.display === 'inline-block') {
    //我们可能覆盖了样式。把它重置为应有的样式。
    if (styleProp == null) {
      style.display = style.margin = '';
    } else {
      const display = styleProp.display;
      style.display =
        display == null || typeof display === 'boolean' ? '' : display;
      const margin = styleProp.margin;
      if (margin != null) {
        style.margin = margin;
      } else {
        const marginTop = styleProp.hasOwnProperty('marginTop')
          ? styleProp.marginTop
          : styleProp['margin-top'];
        style.marginTop =
          marginTop == null || typeof marginTop === 'boolean' ? '' : marginTop;
        const marginBottom = styleProp.hasOwnProperty('marginBottom')
          ? styleProp.marginBottom
          : styleProp['margin-bottom'];
        style.marginBottom =
          marginBottom == null || typeof marginBottom === 'boolean'
            ? ''
            : marginBottom;
      }
    }
  }
}

/** `cancelViewTransitionName` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于View Transition 样式暂存、克隆与几何测量。 */
export function cancelViewTransitionName(
  instance: Instance,
  oldName: string,
  props: Props,
): void {
  //要取消“新建”状态并将此实例标记为父级的一部分，我们所要做的就是在退出 startViewTransition 之前移除 view-transition-name。
  restoreViewTransitionName(instance, props);
  //没有办法取消“旧”的状态，但我们可以通过动画将其隐藏。由于它已经从父元素的旧状态中移除，这种技术只有在父元素也没有进行过渡时才有效。因此，我们应该只取消最顶层的 ViewTransitions。
  const documentElement = instance.ownerDocument.documentElement;
  if (documentElement !== null) {
    documentElement.animate(
      {opacity: [0, 0], pointerEvents: ['none', 'none']},
      // $FlowFixMe[incompatible-type]
      {
        duration: 0,
        fill: 'forwards',
        pseudoElement: '::view-transition-group(' + oldName + ')',
      },
    );
  }
}

/** `cancelRootViewTransitionName` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于View Transition 样式暂存、克隆与几何测量。 */
export function cancelRootViewTransitionName(rootContainer: Container): void {
  const documentElement: null | HTMLElement =
    rootContainer.nodeType === DOCUMENT_NODE
      ? (rootContainer as any).documentElement
      : rootContainer.ownerDocument.documentElement;

  if (
    !disableCommentsAsDOMContainers &&
    rootContainer.nodeType === COMMENT_NODE
  ) {
    if (__DEV__) {
      console.warn(
        'Cannot cancel root view transition on a comment node. All view transitions will be globally scoped.',
      );
    }
    return;
  }

  if (
    documentElement !== null &&
    // $FlowFixMe[prop-missing]
    documentElement.style.viewTransitionName === ''
  ) {
    // $FlowFixMe[prop-missing]
    documentElement.style.viewTransitionName = 'none';
    documentElement.animate(
      {opacity: [0, 0], pointerEvents: ['none', 'none']},
      // $FlowFixMe[incompatible-type]
      {
        duration: 0,
        fill: 'forwards',
        pseudoElement: '::view-transition-group(root)',
      },
    );
    //默认情况下，根 ::view-transition 选择器会捕获所有指针事件，这意味着没有任何东西可以交互。我们希望在过渡期间，让未进行动画的部分保持可交互。为此，我们将大小设置为零，这样过渡就不会捕获任何点击。我们不会在这个上面设置 pointer-events，因为那会应用到所有正在运行的过渡。这允许正在运行的动画阻止点击，以免点击错误地落在动画下面的内容上。
    documentElement.animate(
      {width: [0, 0], height: [0, 0]},
      // $FlowFixMe[incompatible-call]
      // $FlowFixMe[incompatible-type]
      {
        duration: 0,
        fill: 'forwards',
        pseudoElement: '::view-transition',
      },
    );
  }
}

/** `restoreRootViewTransitionName` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于View Transition 样式暂存、克隆与几何测量。 */
export function restoreRootViewTransitionName(rootContainer: Container): void {
  let containerInstance: Instance;
  if (rootContainer.nodeType === DOCUMENT_NODE) {
    containerInstance = (rootContainer as any).body;
  } else if (rootContainer.nodeName === 'HTML') {
    containerInstance = rootContainer.ownerDocument.body as any;
  } else {
    //如果容器不是整个文档，那么理想情况下我们可能也应该在 React 之外克隆整个文档。
    containerInstance = rootContainer as any;
  }
  if (
    !disableCommentsAsDOMContainers &&
    containerInstance.nodeType === COMMENT_NODE
  ) {
    return;
  }
  if (
    // $FlowFixMe[prop-missing]
    containerInstance.style.viewTransitionName === 'root'
  ) {
    //如果我们在手势中将根视图的过渡名称移动到容器中，现在我们需要恢复它。
    containerInstance.style.viewTransitionName = '';
  }
  const documentElement: null | HTMLElement =
    containerInstance.ownerDocument.documentElement;
  if (
    documentElement !== null &&
    // $FlowFixMe[prop-missing]
    documentElement.style.viewTransitionName === 'none'
  ) {
    // $FlowFixMe[prop-missing]
    documentElement.style.viewTransitionName = '';
  }
}

/** `getComputedTransform` 查询、匹配或计算所需结果；不适用时返回协议约定的空值；属于View Transition 样式暂存、克隆与几何测量。 */
function getComputedTransform(style: CSSStyleDeclaration): string {
  //获取所有简写的合并变换。
  const computedStyle: any = style;
  let transform: string = computedStyle.transform;
  if (transform === 'none') {
    transform = '';
  }
  const scale: string = computedStyle.scale;
  if (scale !== 'none' && scale !== '') {
    const parts = scale.split(' ');
    transform =
      (parts.length === 3 ? 'scale3d' : 'scale') +
      '(' +
      parts.join(', ') +
      ') ' +
      transform;
  }
  const rotate: string = computedStyle.rotate;
  if (rotate !== 'none' && rotate !== '') {
    const parts = rotate.split(' ');
    if (parts.length === 1) {
      transform = 'rotate(' + parts[0] + ') ' + transform;
    } else if (parts.length === 2) {
      transform =
        'rotate' + parts[0].toUpperCase() + '(' + parts[1] + ') ' + transform;
    } else {
      transform = 'rotate3d(' + parts.join(', ') + ') ' + transform;
    }
  }
  const translate: string = computedStyle.translate;
  if (translate !== 'none' && translate !== '') {
    const parts = translate.split(' ');
    transform =
      (parts.length === 3 ? 'translate3d' : 'translate') +
      '(' +
      parts.join(', ') +
      ') ' +
      transform;
  }
  return transform;
}

/** `moveOutOfViewport` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于View Transition 样式暂存、克隆与几何测量。 */
function moveOutOfViewport(
  originalStyle: CSSStyleDeclaration,
  element: HTMLElement,
): void {
  //应用一个变换，将整个元素安全地放置在视口外，同时仍允许它将“旧”状态渲染到快照中。
  const transform = getComputedTransform(originalStyle);
  //清除长表单属性。
  // $FlowFixMe[prop-missing]
  element.style.translate = 'none';
  // $FlowFixMe[prop-missing]
  element.style.scale = 'none';
  // $FlowFixMe[prop-missing]
  element.style.rotate = 'none';
  //应用一个平移（translate）将它移出视口。这首先应用，这样它就在父元素的坐标空间中，而不是在应用其他变换之后。这就是为什么我们需要合并长格式属性的原因。TODO：理想情况下，我们应该调整父元素的旋转/缩放。否则，当我们将 ::view-transition-group 移回时，可能会超出或不足。
  element.style.transform = 'translate(-20000px, -20000px) ' + transform;
}

/** `moveOldFrameIntoViewport` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于View Transition 样式暂存、克隆与几何测量。 */
function moveOldFrameIntoViewport(keyframe: any): void {
  //在生成的视图转换动画中，第一个帧将被偏移。
  const computedTransform: ?string = keyframe.transform;
  if (computedTransform != null) {
    let transform = computedTransform === 'none' ? '' : computedTransform;
    transform = 'translate(20000px, 20000px) ' + transform;
    keyframe.transform = transform;
  }
}

/** `cloneRootViewTransitionContainer` 创建宿主对象或快照，并把所有权交给当前提交阶段；属于View Transition 样式暂存、克隆与几何测量。 */
export function cloneRootViewTransitionContainer(
  rootContainer: Container,
): Instance {
  //这意味着我们不会对根文档进行动画处理，而是对克隆进行动画处理，因此我们首先清除根容器的名称。
  const documentElement: null | HTMLElement =
    rootContainer.nodeType === DOCUMENT_NODE
      ? (rootContainer as any).documentElement
      : rootContainer.ownerDocument.documentElement;
  if (
    documentElement !== null &&
    // $FlowFixMe[prop-missing]
    documentElement.style.viewTransitionName === ''
  ) {
    // $FlowFixMe[prop-missing]
    documentElement.style.viewTransitionName = 'none';
  }

  let containerInstance: HTMLElement;
  if (rootContainer.nodeType === DOCUMENT_NODE) {
    containerInstance = (rootContainer as any).body;
  } else if (rootContainer.nodeName === 'HTML') {
    containerInstance = rootContainer.ownerDocument.body as any;
  } else if (
    !disableCommentsAsDOMContainers &&
    rootContainer.nodeType === COMMENT_NODE
  ) {
    throw new Error(
      'Cannot use a startGestureTransition() with a comment node root.',
    );
  } else {
    //如果容器不是整个文档，那么理想情况下我们可能也应该在 React 之外克隆整个文档。
    containerInstance = rootContainer as any;
  }

  const containerParent = containerInstance.parentNode;
  if (containerParent === null) {
    throw new Error(
      'Cannot use a startGestureTransition() on a detached root.',
    );
  }

  const clone: HTMLElement = containerInstance.cloneNode(false);

  const computedStyle = getComputedStyle(containerInstance);

  if (
    computedStyle.position === 'absolute' ||
    computedStyle.position === 'fixed'
  ) {
    //如果样式已经是绝对的，我们不需要做任何事情，因为它会出现在同一个位置。
  } else {
    //否则我们需要将克隆完全定位在与原件相同的位置。
    let positionedAncestor: HTMLElement = containerParent;
    while (
      positionedAncestor.parentNode != null &&
      positionedAncestor.parentNode.nodeType !== DOCUMENT_NODE
    ) {
      if (getComputedStyle(positionedAncestor).position !== 'static') {
        break;
      }
      // $FlowFixMe[incompatible-type]: This is refined.
      positionedAncestor = positionedAncestor.parentNode;
    }

    const positionedAncestorStyle: any = positionedAncestor.style;
    const containerInstanceStyle: any = containerInstance.style;
    //在测量时清除变换，因为它会影响边界客户端矩形。
    const prevAncestorTranslate = positionedAncestorStyle.translate;
    const prevAncestorScale = positionedAncestorStyle.scale;
    const prevAncestorRotate = positionedAncestorStyle.rotate;
    const prevAncestorTransform = positionedAncestorStyle.transform;
    const prevTranslate = containerInstanceStyle.translate;
    const prevScale = containerInstanceStyle.scale;
    const prevRotate = containerInstanceStyle.rotate;
    const prevTransform = containerInstanceStyle.transform;
    positionedAncestorStyle.translate = 'none';
    positionedAncestorStyle.scale = 'none';
    positionedAncestorStyle.rotate = 'none';
    positionedAncestorStyle.transform = 'none';
    containerInstanceStyle.translate = 'none';
    containerInstanceStyle.scale = 'none';
    containerInstanceStyle.rotate = 'none';
    containerInstanceStyle.transform = 'none';

    const ancestorRect = positionedAncestor.getBoundingClientRect();
    const rect = containerInstance.getBoundingClientRect();

    const cloneStyle = clone.style;
    cloneStyle.position = 'absolute';
    cloneStyle.top = rect.top - ancestorRect.top + 'px';
    cloneStyle.left = rect.left - ancestorRect.left + 'px';
    cloneStyle.width = rect.width + 'px';
    cloneStyle.height = rect.height + 'px';
    cloneStyle.margin = '0px';
    cloneStyle.boxSizing = 'border-box';

    positionedAncestorStyle.translate = prevAncestorTranslate;
    positionedAncestorStyle.scale = prevAncestorScale;
    positionedAncestorStyle.rotate = prevAncestorRotate;
    positionedAncestorStyle.transform = prevAncestorTransform;
    containerInstanceStyle.translate = prevTranslate;
    containerInstanceStyle.scale = prevScale;
    containerInstanceStyle.rotate = prevRotate;
    containerInstanceStyle.transform = prevTransform;
  }

  //对于这个过渡，容器将作为根。无论如何，外部的东西都不应该受到影响。这让我们可以从克隆的容器过渡到原始容器。
  // $FlowFixMe[prop-missing]
  clone.style.viewTransitionName = 'root';

  //移出视口，这样它仍会被快照绘制，但在快照发生的那一帧中不可见。
  moveOutOfViewport(computedStyle, clone);

  //将克隆插入到根容器之后，作为其兄弟节点。这可能会将一个 body 注入为现有 body 的下一个兄弟节点。document.body 仍然会指向第一个 body，任何 id 选择器仍然会找到第一个 body。这就是为什么它必须放在现有节点之后的重要原因。
  containerInstance.parentNode.insertBefore(
    clone,
    containerInstance.nextSibling,
  );

  return clone;
}

/** `removeRootViewTransitionClone` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于View Transition 样式暂存、克隆与几何测量。 */
export function removeRootViewTransitionClone(
  rootContainer: Container,
  clone: Instance,
): void {
  let containerInstance: Instance;
  if (rootContainer.nodeType === DOCUMENT_NODE) {
    containerInstance = (rootContainer as any).body;
  } else if (rootContainer.nodeName === 'HTML') {
    containerInstance = rootContainer.ownerDocument.body as any;
  } else {
    //如果容器不是整个文档，那么理想情况下我们可能也应该在 React 之外克隆整个文档。
    containerInstance = rootContainer as any;
  }
  const containerParent = containerInstance.parentNode;
  if (containerParent === null) {
    throw new Error(
      'Cannot use a startGestureTransition() on a detached root.',
    );
  }
  //我们假设克隆仍然在相同的父级中。
  containerParent.removeChild(clone);

  //现在根节点本身位于 containerInstance 上，直到我们调用 restoreRootViewTransitionName。
  containerInstance.style.viewTransitionName = 'root';
}

/** `InstanceMeasurement` 定义View Transition 样式暂存、克隆与几何测量的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type InstanceMeasurement = {
  /** `InstanceMeasurement.rect` 表示View Transition 测量使用的几何快照；仅在View Transition 样式暂存、克隆与几何测量生命周期内有效。 */
  rect: ClientRect | DOMRect,
  /** `InstanceMeasurement.abs` 表示View Transition 测量使用的几何快照；仅在View Transition 样式暂存、克隆与几何测量生命周期内有效。 */
  abs: boolean, //绝对定位
  clip: boolean, //是一个裁剪父母
  view: boolean, //在视口范围内
};

/** `createMeasurement` 创建宿主对象或快照，并把所有权交给当前提交阶段；属于View Transition 样式暂存、克隆与几何测量。 */
function createMeasurement(
  rect: ClientRect | DOMRect,
  computedStyle: CSSStyleDeclaration,
  element: Element,
): InstanceMeasurement {
  const ownerWindow = element.ownerDocument.defaultView;
  return {
    rect: rect,
    abs:
      //绝对定位的实例不会将它们的尺寸计入父元素。
      computedStyle.position === 'absolute' ||
      computedStyle.position === 'fixed',
    clip:
      //如果一个 ViewTransition 边界充当裁剪父组，我们应该始终将其标记为动画化，如果它的子元素也这样做，以便我们可以裁剪它们。这实际上还没有任何效果，直到浏览器实现分层捕获和嵌套视图过渡。
      computedStyle.clipPath !== 'none' ||
      computedStyle.overflow !== 'visible' ||
      computedStyle.filter !== 'none' ||
      computedStyle.mask !== 'none' ||
      computedStyle.mask !== 'none' ||
      computedStyle.borderRadius !== '0px',
    view:
      //如果实例位于视口的范围内。我们不太关心它是否完全被遮挡，因为它仍然可以弹出来。
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= ownerWindow.innerHeight &&
      rect.left <= ownerWindow.innerWidth,
  };
}

/** `measureInstance` 查询、匹配或计算所需结果；不适用时返回协议约定的空值；属于View Transition 样式暂存、克隆与几何测量。 */
export function measureInstance(instance: Instance): InstanceMeasurement {
  const rect = instance.getBoundingClientRect();
  const computedStyle = getComputedStyle(instance);
  return createMeasurement(rect, computedStyle, instance);
}

/** `measureClonedInstance` 查询、匹配或计算所需结果；不适用时返回协议约定的空值；属于View Transition 样式暂存、克隆与几何测量。 */
export function measureClonedInstance(instance: Instance): InstanceMeasurement {
  const measuredRect = instance.getBoundingClientRect();
  //根据将其置于视口外的平移调整 DOMRect。TODO：如果父元素也有变换，这可能不完全正确。
  const rect = new DOMRect(
    measuredRect.x + 20000,
    measuredRect.y + 20000,
    measuredRect.width,
    measuredRect.height,
  );
  const computedStyle = getComputedStyle(instance);
  return createMeasurement(rect, computedStyle, instance);
}

/** `wasInstanceInViewport` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于View Transition 样式暂存、克隆与几何测量。 */
export function wasInstanceInViewport(
  measurement: InstanceMeasurement,
): boolean {
  return measurement.view;
}

/** `hasInstanceChanged` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于View Transition 样式暂存、克隆与几何测量。 */
export function hasInstanceChanged(
  oldMeasurement: InstanceMeasurement,
  newMeasurement: InstanceMeasurement,
): boolean {
  //注意：在视图过渡的实例被替换的情况下，这并不保证来自同一个实例，但它仍然是相同的视图过渡实例。
  if (newMeasurement.clip) {
    //如果我们是一个裁剪父元素，只要我们的任何子元素有动画，我们就会进行动画处理，以便我们可以裁剪它们。直到浏览器实现分层捕获和嵌套视图过渡之前，这还不会发生。
    return true;
  }
  const oldRect = oldMeasurement.rect;
  const newRect = newMeasurement.rect;
  return (
    oldRect.y !== newRect.y ||
    oldRect.x !== newRect.x ||
    oldRect.height !== newRect.height ||
    oldRect.width !== newRect.width
  );
}

/** `hasInstanceAffectedParent` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于View Transition 样式暂存、克隆与几何测量。 */
export function hasInstanceAffectedParent(
  oldMeasurement: InstanceMeasurement,
  newMeasurement: InstanceMeasurement,
): boolean {
  //注意：在 ViewTransition 实例被替换的情况下，这并不保证来自同一个实例，但它仍然是相同的 ViewTransition 实例。如果实例已调整大小，可能会影响父布局。
  if (newMeasurement.abs) {
    //绝对定位的元素不会影响父元素的布局，除非它们之前不是绝对定位的。
    return !oldMeasurement.abs;
  }
  const oldRect = oldMeasurement.rect;
  const newRect = newMeasurement.rect;
  return oldRect.height !== newRect.height || oldRect.width !== newRect.width;
}

//在提交之前等待新字体加载的时间。屏幕会因此冻结。等待时间需要足够短，以免在新加载且速度慢时造成太大问题，同时又需要足够长，以便有机会加载字体。否则我们就是无故等待。这里的假设是你可能已经缓存了字体或之前预加载过。这个超时设置也用于在阻塞视图过渡时的 Suspense 式图片。
const SUSPENSEY_FONT_AND_IMAGE_TIMEOUT = 500;

/** `customizeViewTransitionError` 验证宿主不变量并构造开发期诊断，不改变生产语义；属于View Transition/Gesture 生命周期和伪元素时间线。 */
function customizeViewTransitionError(
  error: Object,
  ignoreAbort: boolean,
): mixed {
  if (typeof error === 'object' && error !== null) {
    switch (error.name) {
      case 'TimeoutError': {
        //我们假设超时发生的唯一原因是导航承诺。我们预计任何其他工作要么很快完成，要么有超时（字体）。
        if (__DEV__) {
          // eslint-disable-next-line react-internal/prod-error-codes
          return new Error(
            'A ViewTransition timed out because a Navigation stalled. ' +
              'This can happen if a Navigation is blocked on React itself. ' +
              "Such as if it's resolved inside useEffect. " +
              'This can be solved by moving the resolution to useLayoutEffect.',
            {cause: error},
          );
        }
        break;
      }
      case 'AbortError': {
        if (ignoreAbort) {
          return null;
        }
        if (__DEV__) {
          // eslint-disable-next-line react-internal/prod-error-codes
          return new Error(
            'A ViewTransition was aborted early. This might be because you have ' +
              'other View Transition libraries on the page and only one can run at ' +
              "a time. To avoid this, use only React's built-in <ViewTransition> " +
              'to coordinate.',
            {cause: error},
          );
        }
        break;
      }
      case 'InvalidStateError': {
        if (
          error.message ===
            'View transition was skipped because document visibility state is hidden.' ||
          error.message ===
            'Skipping view transition because document visibility state has become hidden.' ||
          error.message ===
            'Skipping view transition because viewport size changed.' ||
          //Chrome 使用通用错误消息而不是具体原因。它会在控制台记录更具体的原因，但用户可能不会去查看。某些错误很重要，需要显现出来，例如重复名称错误，但对于一些无法处理的情况（如文档被隐藏）则会显得过于噪杂。因此，我们隐藏了所有这些错误，并希望它们能在其他浏览器中显现。
          error.message === 'Transition was aborted because of invalid state'
        ) {
          //跳过记录。这不被视为错误。
          return null;
        }
        break;
      }
    }
  }
  return error;
}

/**
 * @noinline
 */
function forceLayout(ownerDocument: Document) {
  //此函数存在的目的是为了欺骗压缩工具不移除这个未使用的成员表达式。
  return (ownerDocument.documentElement as any).clientHeight;
}

/** `waitForImageToLoad` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于View Transition/Gesture 生命周期和伪元素时间线。 */
function waitForImageToLoad(this: HTMLImageElement, resolve: () => void) {
  //待办：一旦 https://issues.chromium.org/issues/420748301 的修复完全传播开来，在这里使用 decode() 替代 load 事件。
  this.addEventListener('load', resolve);
  this.addEventListener('error', resolve);
}

/** `startViewTransition` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于View Transition/Gesture 生命周期和伪元素时间线。 */
export function startViewTransition(
  suspendedState: null | SuspendedState,
  rootContainer: Container,
  transitionTypes: null | TransitionTypes,
  mutationCallback: () => void,
  layoutCallback: () => void,
  afterMutationCallback: () => void,
  spawnedWorkCallback: () => void,
  passiveCallback: () => mixed,
  errorCallback: mixed => void,
  blockedCallback: string => void, //仅限分析
  finishedAnimation: () => void, //仅限分析
): null | RunningViewTransition {
  const ownerDocument: Document =
    rootContainer.nodeType === DOCUMENT_NODE
      ? (rootContainer as any)
      : rootContainer.ownerDocument;
  try {
    // $FlowFixMe[prop-missing]
    const transition = ownerDocument.startViewTransition({
      /** `startViewTransition.update` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于View Transition/Gesture 生命周期和伪元素时间线。 */
      update() {
        //注意：我们在应用变更之前会先检查是否存在待处理的导航。这样我们就不会等待由此更新触发的导航。只有在此提交之前启动的导航才会被考虑。
        const ownerWindow = ownerDocument.defaultView;
        const pendingNavigation =
          ownerWindow.navigation && ownerWindow.navigation.transition;
        // $FlowFixMe[prop-missing]
        const previousFontLoadingStatus = ownerDocument.fonts.status;
        mutationCallback();
        const blockingPromises: Array<Promise<any>> = [];
        if (previousFontLoadingStatus === 'loaded') {
          //强制布局计算以触发字体加载。
          forceLayout(ownerDocument);
          if (
            // $FlowFixMe[prop-missing]
            ownerDocument.fonts.status === 'loading'
          ) {
            //该变异导致加载了新的字体。我们应该在继续之前等待它们。这可以避免等待可能与之前已经加载的字体无关的字体。无论是早期过渡中的，还是作为同步乐观状态的一部分。这不包括之前发生的预加载。
            blockingPromises.push(ownerDocument.fonts.ready);
          }
        }
        const blockingIndexSnapshot = blockingPromises.length;
        if (suspendedState !== null) {
          //暂停任何仍未加载且在视口中的图像。
          const suspenseyImages = suspendedState.suspenseyImages;
          let imgBytes = 0;
          for (let i = 0; i < suspenseyImages.length; i++) {
            const suspenseyImage = suspenseyImages[i];
            if (!suspenseyImage.complete) {
              const rect = suspenseyImage.getBoundingClientRect();
              const inViewport =
                rect.bottom > 0 &&
                rect.right > 0 &&
                rect.top < ownerWindow.innerHeight &&
                rect.left < ownerWindow.innerWidth;
              if (inViewport) {
                imgBytes += estimateImageBytes(suspenseyImage);
                if (imgBytes > estimatedBytesWithinLimit) {
                  //我们认为我们无法在超时内下载所有图像。放弃。如果有的话，只回退到只阻塞字体。
                  blockingPromises.length = blockingIndexSnapshot;
                  break;
                }
                const loadingImage = new Promise(
                  waitForImageToLoad.bind(suspenseyImage),
                );
                blockingPromises.push(loadingImage);
              }
            }
          }
        }
        if (blockingPromises.length > 0) {
          if (enableProfilerTimer) {
            const blockedReason =
              blockingIndexSnapshot > 0
                ? blockingPromises.length > blockingIndexSnapshot
                  ? 'Waiting on Fonts and Images'
                  : 'Waiting on Fonts'
                : 'Waiting on Images';
            blockedCallback(blockedReason);
          }
          const blockingReady = Promise.race([
            Promise.all(blockingPromises),
            new Promise(resolve =>
              setTimeout(resolve, SUSPENSEY_FONT_AND_IMAGE_TIMEOUT),
            ),
          ]).then(layoutCallback, layoutCallback);
          const allReady = pendingNavigation
            ? Promise.allSettled([pendingNavigation.finished, blockingReady])
            : blockingReady;
          return allReady.then(afterMutationCallback, afterMutationCallback);
        }
        layoutCallback();
        if (pendingNavigation) {
          return pendingNavigation.finished.then(
            afterMutationCallback,
            afterMutationCallback,
          );
        } else {
          afterMutationCallback();
        }
      },
      types: transitionTypes,
    });
    // $FlowFixMe[prop-missing]
    ownerDocument.__reactViewTransition = transition;

    const viewTransitionAnimations: Array<Animation> = [];

    /** `startViewTransition.readyCallback` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于View Transition/Gesture 生命周期和伪元素时间线。 */
    const readyCallback = () => {
      const documentElement: Element = ownerDocument.documentElement as any;
      //循环遍历所有视图过渡动画。
      // $FlowFixMe[prop-missing]
      // $FlowFixMe[incompatible-type]
      const animations = documentElement.getAnimations({subtree: true});
      for (let i = 0; i < animations.length; i++) {
        const animation = animations[i];
        const effect: KeyframeEffect = animation.effect as any;
        // $FlowFixMe[prop-missing]
        const pseudoElement: ?string = effect.pseudoElement;
        if (
          pseudoElement != null &&
          pseudoElement.startsWith('::view-transition')
        ) {
          viewTransitionAnimations.push(animation);
          const keyframes = effect.getKeyframes();
          //接下来，我们将尝试优化这个动画，以防自动生成的宽度/高度关键帧是多余的。
          let width;
          let height;
          let unchangedDimensions = true;
          for (let j = 0; j < keyframes.length; j++) {
            const keyframe = keyframes[j];
            const w = keyframe.width;
            if (width === undefined) {
              width = w;
            } else if (width !== w) {
              unchangedDimensions = false;
              break;
            }
            const h = keyframe.height;
            if (height === undefined) {
              height = h;
            } else if (height !== h) {
              unchangedDimensions = false;
              break;
            }
            //我们正在清除关键帧，以防我们要应用优化。
            delete keyframe.width;
            delete keyframe.height;
            if (keyframe.transform === 'none') {
              delete keyframe.transform;
            }
          }
          if (
            unchangedDimensions &&
            width !== undefined &&
            height !== undefined
          ) {
            //将关键帧替换为不会动画化宽度/高度的关键帧。
            // $FlowFixMe[incompatible-type]
            effect.setKeyframes(keyframes);
            //回放新的动画，以查看伪元素的底层宽度/高度是多少。
            const computedStyle = getComputedStyle(
              // $FlowFixMe[incompatible-type]
              effect.target,
              // $FlowFixMe[prop-missing]
              effect.pseudoElement,
            );
            if (
              computedStyle.width !== width ||
              computedStyle.height !== height
            ) {
              //哎呀。结果发现伪元素有不同的宽度/高度，所以我们需要允许它被覆盖。把它加回来。
              const first = keyframes[0];
              first.width = width;
              first.height = height;
              const last = keyframes[keyframes.length - 1];
              last.width = width;
              last.height = height;
              // $FlowFixMe[incompatible-type]
              effect.setKeyframes(keyframes);
            }
          }
        }
      }
      spawnedWorkCallback();
    };
    /** `startViewTransition.handleError` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于View Transition/Gesture 生命周期和伪元素时间线。 */
    const handleError = (error: mixed) => {
      // $FlowFixMe[prop-missing]
      if (ownerDocument.__reactViewTransition === transition) {
        // $FlowFixMe[prop-missing]
        ownerDocument.__reactViewTransition = null;
      }
      try {
        error = customizeViewTransitionError(error, false);
        if (error !== null) {
          errorCallback(error);
        }
      } finally {
        //继续重置工作。如果错误发生在更新回调被调用之前的快照阶段，那么我们需要先完成变更和布局阶段。如果它们已经被调用，进行状态检查后仍然可以安全地调用它们。
        mutationCallback();
        layoutCallback();
        //跳过 afterMutationCallback()，因为我们没有进行动画。
        spawnedWorkCallback();
        if (enableProfilerTimer) {
          finishedAnimation();
        }
      }
    };
    transition.ready.then(readyCallback, handleError);
    transition.finished.finally(() => {
      for (let i = 0; i < viewTransitionAnimations.length; i++) {
        //在 Safari 中，我们需要手动取消所有手动启动的动画，否则它会阻塞或干扰未来的过渡。由于 #35336，我们不能使用 getAnimations()，所以我们将它们收集到一个数组中。
        viewTransitionAnimations[i].cancel();
      }
      // $FlowFixMe[prop-missing]
      if (ownerDocument.__reactViewTransition === transition) {
        // $FlowFixMe[prop-missing]
        ownerDocument.__reactViewTransition = null;
      }
      if (enableProfilerTimer) {
        finishedAnimation();
      }
      passiveCallback();
    });
    return transition;
  } catch (x) {
    //我们使用错误作为特性检测。唯一应该抛出的情况是 startViewTransition 缺失或者它不接受对象形式。其他错误都是异步的。例如，这是在 View Transitions v2 规范之前。我们只支持 View Transitions v2，否则我们会回退到不进行动画，以确保我们不会使用错误的动画映射进行动画。同步刷新剩余的工作。
    mutationCallback();
    layoutCallback();
    //跳过 afterMutationCallback()。我们不需要它，因为我们没有在做动画。
    if (enableProfilerTimer) {
      finishedAnimation();
    }
    spawnedWorkCallback();
    //跳过 passiveCallback()。生成的工作将安排一个任务。
    return null;
  }
}

/** `RunningViewTransition` 定义View Transition/Gesture 生命周期和伪元素时间线的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type RunningViewTransition = {
  /** `RunningViewTransition.skipTransition` 约定View Transition/Gesture 生命周期和伪元素时间线暴露的可调用能力；实现必须保持 DOM/Fiber 身份与副作用边界。 */
  skipTransition(): void,
  /** `RunningViewTransition.finished` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在View Transition/Gesture 生命周期和伪元素时间线生命周期内有效。 */
  finished: Promise<void>,
  ...
};

/** `mergeTranslate` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于View Transition/Gesture 生命周期和伪元素时间线。 */
function mergeTranslate(translateA: ?string, translateB: ?string): string {
  if (!translateA || translateA === 'none') {
    return translateB || '';
  }
  if (!translateB || translateB === 'none') {
    // $FlowFixMe[constant-condition]
    return translateA || '';
  }
  const partsA = translateA.split(' ');
  const partsB = translateB.split(' ');
  let i;
  let result = '';
  for (i = 0; i < partsA.length && i < partsB.length; i++) {
    if (i > 0) {
      result += ' ';
    }
    result += 'calc(' + partsA[i] + ' + ' + partsB[i] + ')';
  }
  for (; i < partsA.length; i++) {
    result += ' ' + partsA[i];
  }
  for (; i < partsB.length; i++) {
    result += ' ' + partsB[i];
  }
  return result;
}

/** `animateGesture` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于View Transition/Gesture 生命周期和伪元素时间线。 */
function animateGesture(
  keyframes: any,
  targetElement: Element,
  pseudoElement: string,
  timeline: GestureTimeline,
  viewTransitionAnimations: Array<Animation>,
  customTimelineCleanup: Array<() => void>,
  rangeStart: number,
  rangeEnd: number,
  moveFirstFrameIntoViewport: boolean,
  moveAllFramesIntoViewport: boolean,
) {
  let width;
  let height;
  let unchangedDimensions = true;
  for (let i = 0; i < keyframes.length; i++) {
    const keyframe = keyframes[i];
    //删除任何缓动，因为我们总是对手势应用线性缓动。
    delete keyframe.easing;
    delete keyframe.computedOffset;
    const w = keyframe.width;
    if (width === undefined) {
      width = w;
    } else if (width !== w) {
      unchangedDimensions = false;
    }
    const h = keyframe.height;
    if (height === undefined) {
      height = h;
    } else if (height !== h) {
      unchangedDimensions = false;
    }
    //Chrome 对宽度/高度返回“auto”，这不是一个有效的动画值。同样，transform: “none”实际上表示没有变换。
    if (keyframe.width === 'auto') {
      delete keyframe.width;
    }
    if (keyframe.height === 'auto') {
      delete keyframe.height;
    }
    if (keyframe.transform === 'none') {
      delete keyframe.transform;
    }
    if (moveAllFramesIntoViewport) {
      if (keyframe.transform == null) {
        //如果没有明确指定变换来覆盖伪元素上自动生成的变换，那么我们需要调整它以将其放回视口中。我们不知道相对于屏幕的偏移量，因此我们改用 translate 属性进行相对调整。TODO：如果伪元素本身的“transform”被手动覆盖，而不再是自动生成的，那么我们不应进行调整。我不确定如何检测这一点。
        if (keyframe.translate == null || keyframe.translate === '') {
          //TODO：如果已经有一个 CSS 规则针对伪元素的 translate，我们需要将其合并。
          const elementTranslate: ?string = (
            getComputedStyle(targetElement, pseudoElement) as any
          ).translate;
          keyframe.translate = mergeTranslate(
            elementTranslate,
            '20000px 20000px',
          );
        } else {
          keyframe.translate = mergeTranslate(
            keyframe.translate,
            '20000px 20000px',
          );
        }
      }
    }
  }
  if (moveFirstFrameIntoViewport) {
    //如果这是生成的动画，它从旧位置进行 FLIP 矩阵平移，我们需要从视口外位置进行调整。如果这是从旧位置到新位置，它只适用于第一个关键帧。否则，它适用于每一个关键帧。
    moveOldFrameIntoViewport(keyframes[0]);
  }
  if (unchangedDimensions && width !== undefined && height !== undefined) {
    //读取伪元素的基础宽度/高度。之前的动画应该已经被取消，因此我们应该观察基础元素。
    const computedStyle = getComputedStyle(targetElement, pseudoElement);
    if (computedStyle.width === width && computedStyle.height === height) {
      for (let i = 0; i < keyframes.length; i++) {
        const keyframe = keyframes[i];
        delete keyframe.width;
        delete keyframe.height;
      }
    }
  }

  //待办：如果原方向是反向，则将反向再反向回来。
  const reverse = rangeStart > rangeEnd;
  if (timeline instanceof AnimationTimeline) {
    //原生时间线
    // $FlowFixMe[incompatible-type]
    const animation = targetElement.animate(keyframes, {
      pseudoElement: pseudoElement,
      //将时间线设置为当前手势时间线以驱动更新。
      timeline: timeline,
      //我们将所有缓动函数重置为线性，以便让你感觉对过渡有直接影响，并避免滚动反弹导致的二次弹跳。
      easing: 'linear',
      //我们为过度滚动填充两个方向。
      fill: 'both', //TODO：我们是否应该改为保留填充？我们将所有手势倒放，除非我们处于反向时，这种情况下我们需要倒放倒放的手势。
      direction: reverse ? 'normal' : 'reverse',
      //范围起点需要高于范围终点。如果顺序相反，我们将反转下面的整个动画。
      rangeStart: (reverse ? rangeEnd : rangeStart) + '%',
      rangeEnd: (reverse ? rangeStart : rangeEnd) + '%',
    });
    viewTransitionAnimations.push(animation);
  } else {
    //自定义时间轴
    // $FlowFixMe[incompatible-type]
    const animation = targetElement.animate(keyframes, {
      pseudoElement: pseudoElement,
      //我们将所有缓动函数重置为线性，以便让你感觉对过渡有直接影响，并避免滚动反弹导致的二次弹跳。
      easing: 'linear',
      //我们为过度滚动填充两个方向。
      fill: 'both', //TODO：我们是否应该改为保留填充？我们将所有手势倒放，除非我们处于反向时，这种情况下我们需要倒放倒放的手势。
      direction: reverse ? 'normal' : 'reverse',
      //我们设置延迟和持续时间以表示范围的跨度。
      delay: reverse ? rangeEnd : rangeStart,
      duration: reverse ? rangeStart - rangeEnd : rangeEnd - rangeStart,
    });
    viewTransitionAnimations.push(animation);
    //让自定义时间线控制动画的驱动。
    const cleanup = timeline.animate(animation);
    if (cleanup) {
      customTimelineCleanup.push(cleanup);
    }
  }
}

/** `startGestureTransition` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于View Transition/Gesture 生命周期和伪元素时间线。 */
export function startGestureTransition(
  suspendedState: null | SuspendedState,
  rootContainer: Container,
  timeline: GestureTimeline,
  rangeStart: number,
  rangeEnd: number,
  transitionTypes: null | TransitionTypes,
  mutationCallback: () => void,
  animateCallback: () => void,
  errorCallback: mixed => void,
  finishedAnimation: () => void, //仅限分析
): null | RunningViewTransition {
  const ownerDocument: Document =
    rootContainer.nodeType === DOCUMENT_NODE
      ? (rootContainer as any)
      : rootContainer.ownerDocument;
  try {
    //在我们开始过渡之前强制布局。这可以解决 Safari 中的一个错误，如果其中一个克隆最终是一个未加载或未缓存的样式表。https://bugs.webkit.org/show_bug.cgi?id=290146
    forceLayout(ownerDocument);
    // $FlowFixMe[prop-missing]
    const transition = ownerDocument.startViewTransition({
      update: mutationCallback,
      types: transitionTypes,
    });
    // $FlowFixMe[prop-missing]
    ownerDocument.__reactViewTransition = transition;
    const customTimelineCleanup: Array<() => void> = []; //清理动画在自定义时间轴中启动
    const viewTransitionAnimations: Array<Animation> = [];
    /** `startGestureTransition.readyCallback` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于View Transition/Gesture 生命周期和伪元素时间线。 */
    const readyCallback = () => {
      const documentElement: Element = ownerDocument.documentElement as any;
      //循环遍历所有视图过渡动画。
      // $FlowFixMe[prop-missing]
      // $FlowFixMe[incompatible-type]
      const animations = documentElement.getAnimations({subtree: true});
      //首先进行一次遍历，收集所有已知的组和新项目，这样我们以后就可以查找它们是否存在。
      const foundGroups: Set<string> = new Set();
      const foundNews: Set<string> = new Set();
      //收集任何视图切换动画（包括延迟）的最长持续时间。
      let longestDuration = 0;
      for (let i = 0; i < animations.length; i++) {
        const effect: KeyframeEffect = animations[i].effect as any;
        // $FlowFixMe[prop-missing]
        const pseudoElement: ?string = effect.pseudoElement;
        if (pseudoElement == null) {
        } else if (
          pseudoElement.startsWith('::view-transition') &&
          effect.target === documentElement
        ) {
          const timing = effect.getTiming();
          const duration =
            // $FlowFixMe[prop-missing]
            typeof timing.duration === 'number' ? timing.duration : 0;
          //待办：考虑迭代次数大于1。
          // $FlowFixMe[prop-missing]
          // $FlowFixMe[unsafe-addition]
          const durationWithDelay = timing.delay + duration;
          if (durationWithDelay > longestDuration) {
            longestDuration = durationWithDelay;
          }
          if (pseudoElement.startsWith('::view-transition-group')) {
            foundGroups.add(pseudoElement.slice(23));
          } else if (pseudoElement.startsWith('::view-transition-new')) {
            //待办：这并不是真正充分的检测，因为新的伪元素可能存在，但其动画被禁用了。
            foundNews.add(pseudoElement.slice(21));
          }
        }
      }
      const durationToRangeMultipler =
        (rangeEnd - rangeStart) / longestDuration;
      for (let i = 0; i < animations.length; i++) {
        const anim = animations[i];
        if (anim.playState !== 'running') {
          continue;
        }
        const effect: KeyframeEffect = anim.effect as any;
        // $FlowFixMe[prop-missing]
        const pseudoElement: ?string = effect.pseudoElement;
        if (
          pseudoElement != null &&
          pseudoElement.startsWith('::view-transition') &&
          effect.target === documentElement
        ) {
          //理想情况下，我们可以修改现有的动画，但不幸的是，可变的 API 似乎测试较少，因此存在不足或错误。因此，我们选择创建一个新的动画。
          anim.cancel();
          let isGeneratedGroupAnim = false;
          let isExitGroupAnim = false;
          if (pseudoElement.startsWith('::view-transition-group')) {
            const groupName = pseudoElement.slice(23);
            if (foundNews.has(groupName)) {
              //如果这同时具有“新”和“旧”状态，我们预计这是一个在视口外部开始的自动生成动画。我们需要将第一帧调整到视口内。
              // $FlowFixMe[prop-missing]
              const animationName: ?string = anim.animationName;
              isGeneratedGroupAnim =
                animationName != null &&
                // $FlowFixMe[prop-missing]
                animationName.startsWith('-ua-view-transition-group-anim-');
            } else {
              //如果这只有一个“旧”状态，那么伪元素将位于视口之外。如果任何关键帧没有覆盖“transform”，我们需要调整它们。
              isExitGroupAnim = true;
            }
            //待办：如果这只有旧状态而没有新状态，
          }
          //根据动画按时间计算应运行的时长调整范围。由于我们是以相反的方式运行动画，因此时间是从 rangeEnd 到开始。
          const timing = effect.getTiming();
          const duration =
            // $FlowFixMe[prop-missing]
            typeof timing.duration === 'number' ? timing.duration : 0;
          let adjustedRangeStart =
            // $FlowFixMe[unsafe-addition]
            // $FlowFixMe[prop-missing]
            rangeEnd - (duration + timing.delay) * durationToRangeMultipler;
          let adjustedRangeEnd =
            rangeEnd -
            // $FlowFixMe[prop-missing]
            // $FlowFixMe[unsafe-arithmetic]
            timing.delay * durationToRangeMultipler;
          if (
            timing.direction === 'reverse' ||
            timing.direction === 'alternate-reverse'
          ) {
            //这个动画最初是反向的，所以我们必须在翻转的范围内播放它。
            const temp = adjustedRangeStart;
            adjustedRangeStart = adjustedRangeEnd;
            adjustedRangeEnd = temp;
          }
          animateGesture(
            effect.getKeyframes(),
            // $FlowFixMe[incompatible-type]: Always documentElement atm.
            effect.target,
            pseudoElement,
            timeline,
            viewTransitionAnimations,
            customTimelineCleanup,
            adjustedRangeStart,
            adjustedRangeEnd,
            isGeneratedGroupAnim,
            isExitGroupAnim,
          );
          if (pseudoElement.startsWith('::view-transition-old')) {
            const groupName = pseudoElement.slice(21);
            if (!foundGroups.has(groupName) && !foundNews.has(groupName)) {
              foundGroups.add(groupName);
              //我们没有看到任何具有此名称的组动画。由于旧状态位于视口之外，我们需要将其放回去。由于我们无法以编程方式定位元素本身，我们使用动画来调整它。这通常发生在元素具有旧位置的退出动画中。如果我们还有一个“新”状态，那么我们会跳过此操作，因为这意味着有人手动禁用了自动生成的动画。我们需要将旧状态视为具有“新”状态的位置，这将默认发生。
              const pseudoElementName = '::view-transition-group' + groupName;
              animateGesture(
                [{}, {}],
                // $FlowFixMe[incompatible-type]: Always documentElement atm.
                effect.target,
                pseudoElementName,
                timeline,
                viewTransitionAnimations,
                customTimelineCleanup,
                rangeStart,
                rangeEnd,
                false,
                true, //我们让助手进行翻译
              );
            }
          }
        }
      }
      //使用 ScrollTimeline 的视图过渡有一个特殊情况，就是一旦 ScrollTimeline 达到 100% 就会结束，但这并不意味着我们完成了，因为你可以再次向回滑动。我们可以通过添加一个永远不会停止的暂停动画来防止这种情况。这似乎可以保持所有运行中的动画活着，直到我们明确中止（或某些情况强制视图过渡取消）。
      // $FlowFixMe[incompatible-call]
      // $FlowFixMe[incompatible-type]
      const blockingAnim = documentElement.animate([{}, {}], {
        pseudoElement: '::view-transition',
        duration: 1,
      });
      blockingAnim.pause();
      viewTransitionAnimations.push(blockingAnim);
      animateCallback();
    };
    //在 Chrome 中，“新的”动画在 ready 回调中尚未准备好。我们必须等待 requestAnimationFrame 才能通过 getAnimations() 观察它们。然而，在 Safari 中，这会导致闪烁，因为我们应用它们的时间太晚。待办事项：考虑为此设计一个功能检测。
    const readyForAnimations =
      navigator.userAgent.indexOf('Chrome') !== -1
        ? () => requestAnimationFrame(readyCallback)
        : readyCallback;
    /** `startGestureTransition.handleError` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于View Transition/Gesture 生命周期和伪元素时间线。 */
    const handleError = (error: mixed) => {
      // $FlowFixMe[prop-missing]
      if (ownerDocument.__reactViewTransition === transition) {
        // $FlowFixMe[prop-missing]
        ownerDocument.__reactViewTransition = null;
      }
      try {
        error = customizeViewTransitionError(error, true);
        if (error !== null) {
          errorCallback(error);
        }
      } finally {
        //继续重置工作。如果错误发生在更新回调被调用之前的快照阶段，那么我们需要先完成变更和布局阶段。如果它们已经被调用，进行状态检查后仍然可以安全地调用它们。
        mutationCallback();
        //跳过 readyCallback()，直接进入 animateCallback()，因为我们没有进行动画。仍然需要 animateCallback() 来恢复状态。
        animateCallback();
        if (enableProfilerTimer) {
          finishedAnimation();
        }
      }
    };
    transition.ready.then(readyForAnimations, handleError);
    transition.finished.finally(() => {
      for (let i = 0; i < viewTransitionAnimations.length; i++) {
        //在 Safari 中，我们需要手动取消所有手动启动的动画，否则它会阻塞或干扰未来的过渡。由于 #35336，我们不能使用 getAnimations()，所以我们将它们收集到一个数组中。
        viewTransitionAnimations[i].cancel();
      }
      for (let i = 0; i < customTimelineCleanup.length; i++) {
        const cleanup = customTimelineCleanup[i];
        cleanup();
      }
      // $FlowFixMe[prop-missing]
      if (ownerDocument.__reactViewTransition === transition) {
        // $FlowFixMe[prop-missing]
        ownerDocument.__reactViewTransition = null;
      }
      if (enableProfilerTimer) {
        //表示过渡无法继续。我们在这里这样做，而不是在停止正在运行的视图过渡时这样做，以确保涵盖其他因素过早停止的情况。
        finishedAnimation();
      }
    });
    return transition;
  } catch (x) {
    //我们使用错误作为特性检测。唯一应该抛出的情况是 startViewTransition 缺失或者它不接受对象形式。其他错误都是异步的。也就是说，这是在 View Transitions v2 规范之前。我们只支持 View Transitions v2，否则我们会回退到不动画，以确保不会使用错误的动画进行动画操作。运行整个序列以将状态恢复到一致状态。
    mutationCallback();
    animateCallback();
    if (enableProfilerTimer) {
      finishedAnimation();
    }
    return null;
  }
}

/** `stopViewTransition` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于View Transition/Gesture 生命周期和伪元素时间线。 */
export function stopViewTransition(transition: RunningViewTransition) {
  transition.skipTransition();
}

/** `addViewTransitionFinishedListener` 登记或挂接目标，维持宿主顺序与资源引用计数；属于View Transition/Gesture 生命周期和伪元素时间线。 */
export function addViewTransitionFinishedListener(
  transition: RunningViewTransition,
  callback: () => void,
) {
  transition.finished.finally(callback);
}

/** `ViewTransitionPseudoElementType` 定义View Transition/Gesture 生命周期和伪元素时间线的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
interface ViewTransitionPseudoElementType extends mixin$Animatable {
  /** `ViewTransitionPseudoElementType._scope` 表示View Transition 或伪元素定位标识；仅在View Transition/Gesture 生命周期和伪元素时间线生命周期内有效。 */
  _scope: HTMLElement;
  /** `ViewTransitionPseudoElementType._selector` 表示View Transition 或伪元素定位标识；仅在View Transition/Gesture 生命周期和伪元素时间线生命周期内有效。 */
  _selector: string;
  /** `ViewTransitionPseudoElementType.getComputedStyle` 约定View Transition/Gesture 生命周期和伪元素时间线暴露的可调用能力；实现必须保持 DOM/Fiber 身份与副作用边界。 */
  getComputedStyle(): CSSStyleDeclaration;
}

/** `ViewTransitionPseudoElement` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于View Transition/Gesture 生命周期和伪元素时间线。 */
function ViewTransitionPseudoElement(
  this: ViewTransitionPseudoElementType,
  pseudo: string,
  name: string,
) {
  //待办：从根容器获取所属文档。
  this._scope = document.documentElement as any;
  this._selector = '::view-transition-' + pseudo + '(' + name + ')';
}
// $FlowFixMe[prop-missing]
ViewTransitionPseudoElement.prototype.animate = function (
  this: ViewTransitionPseudoElementType,
  keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
  options?: number | KeyframeAnimationOptions,
): Animation {
  const opts: any =
    typeof options === 'number'
      ? {
          duration: options,
        }
      : Object.assign(
          // $FlowFixMe[prop-missing]
          // $FlowFixMe[incompatible-type]
          {} as KeyframeAnimationOptions,
          options,
        );
  opts.pseudoElement = this._selector;
  //待办事项：处理多个子实例。
  return this._scope.animate(keyframes, opts);
};
// $FlowFixMe[prop-missing]
ViewTransitionPseudoElement.prototype.getAnimations = function (
  this: ViewTransitionPseudoElementType,
  options?: GetAnimationsOptions,
): Animation[] {
  const scope = this._scope;
  const selector = this._selector;
  const animations = scope.getAnimations(
    // $FlowFixMe[prop-missing]
    // $FlowFixMe[incompatible-type]
    {subtree: true},
  );
  const result = [];
  for (let i = 0; i < animations.length; i++) {
    const effect: null | {
      /** `target` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在View Transition/Gesture 生命周期和伪元素时间线生命周期内有效。 */
      target?: Element,
      /** `pseudoElement` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在View Transition/Gesture 生命周期和伪元素时间线生命周期内有效。 */
      pseudoElement?: string,
      ...
    } = animations[i].effect as any;
    //待办事项：处理多个子实例。
    if (
      effect !== null &&
      effect.target === scope &&
      effect.pseudoElement === selector
    ) {
      result.push(animations[i]);
    }
  }
  return result;
};
// $FlowFixMe[prop-missing]
ViewTransitionPseudoElement.prototype.getComputedStyle = function (
  this: ViewTransitionPseudoElementType,
): CSSStyleDeclaration {
  const scope = this._scope;
  const selector = this._selector;
  return getComputedStyle(scope, selector);
};

/** `createViewTransitionInstance` 创建宿主对象或快照，并把所有权交给当前提交阶段；属于View Transition/Gesture 生命周期和伪元素时间线。 */
export function createViewTransitionInstance(
  name: string,
): ViewTransitionInstance {
  return {
    name: name,
    group: new (ViewTransitionPseudoElement as any)('group', name),
    imagePair: new (ViewTransitionPseudoElement as any)('image-pair', name),
    old: new (ViewTransitionPseudoElement as any)('old', name),
    new: new (ViewTransitionPseudoElement as any)('new', name),
  };
}

/** `CustomTimeline` 定义View Transition/Gesture 生命周期和伪元素时间线的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
interface CustomTimeline {
  /** `CustomTimeline.currentTime` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在View Transition/Gesture 生命周期和伪元素时间线生命周期内有效。 */
  currentTime: number;
  /** `CustomTimeline.animate` 约定View Transition/Gesture 生命周期和伪元素时间线暴露的可调用能力；实现必须保持 DOM/Fiber 身份与副作用边界。 */
  animate(animation: Animation): void | (() => void);
}

/** `GestureTimeline` 定义View Transition/Gesture 生命周期和伪元素时间线的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type GestureTimeline = AnimationTimeline | CustomTimeline;

/** `getCurrentGestureOffset` 查询、匹配或计算所需结果；不适用时返回协议约定的空值；属于View Transition/Gesture 生命周期和伪元素时间线。 */
export function getCurrentGestureOffset(timeline: GestureTimeline): number {
  const time = timeline.currentTime;
  if (time === null) {
    throw new Error(
      'Cannot start a gesture with a disconnected AnimationTimeline.',
    );
  }
  return typeof time === 'number' ? time : time.value;
}

/** `StoredEventListener` 定义View Transition/Gesture 生命周期和伪元素时间线的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type StoredEventListener = {
  /** `StoredEventListener.type` 表示宿主标签、资源或事件类别；仅在View Transition/Gesture 生命周期和伪元素时间线生命周期内有效。 */
  type: string,
  /** `StoredEventListener.listener` 表示事件监听器及其原生注册选项；仅在View Transition/Gesture 生命周期和伪元素时间线生命周期内有效。 */
  listener: EventListener,
  /** `StoredEventListener.optionsOrUseCapture` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在View Transition/Gesture 生命周期和伪元素时间线生命周期内有效。 */
  optionsOrUseCapture: void | EventListenerOptionsOrUseCapture,
};

/** `FragmentInstanceType` 定义View Transition/Gesture 生命周期和伪元素时间线的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type FragmentInstanceType = {
  /** `FragmentInstanceType._fragmentFiber` 表示Fragment handle 与 Fiber 的关联身份；仅在View Transition/Gesture 生命周期和伪元素时间线生命周期内有效。 */
  _fragmentFiber: Fiber,
  /** `FragmentInstanceType._eventListeners` 表示事件监听器及其原生注册选项；仅在View Transition/Gesture 生命周期和伪元素时间线生命周期内有效。 */
  _eventListeners: null | Array<StoredEventListener>,
  /** `FragmentInstanceType._observers` 表示绑定到 Fragment 子节点的观察器集合；仅在View Transition/Gesture 生命周期和伪元素时间线生命周期内有效。 */
  _observers: null | Set<IntersectionObserver | ResizeObserver>,
  /** `FragmentInstanceType.addEventListener` 约定View Transition/Gesture 生命周期和伪元素时间线暴露的可调用能力；实现必须保持 DOM/Fiber 身份与副作用边界。 */
  addEventListener(
    type: string,
    listener: EventListener,
    optionsOrUseCapture?: EventListenerOptionsOrUseCapture,
  ): void,
  /** `FragmentInstanceType.removeEventListener` 约定Fragment handle 的事件、焦点、观察器与 DOM 顺序投影暴露的可调用能力；实现必须保持 DOM/Fiber 身份与副作用边界。 */
  removeEventListener(
    type: string,
    listener: EventListener,
    optionsOrUseCapture?: EventListenerOptionsOrUseCapture,
  ): void,
  /** `FragmentInstanceType.dispatchEvent` 约定Fragment handle 的事件、焦点、观察器与 DOM 顺序投影暴露的可调用能力；实现必须保持 DOM/Fiber 身份与副作用边界。 */
  dispatchEvent(event: Event): boolean,
  /** `FragmentInstanceType.focus` 约定Fragment handle 的事件、焦点、观察器与 DOM 顺序投影暴露的可调用能力；实现必须保持 DOM/Fiber 身份与副作用边界。 */
  focus(focusOptions?: FocusOptions): void,
  /** `FragmentInstanceType.focusLast` 约定Fragment handle 的事件、焦点、观察器与 DOM 顺序投影暴露的可调用能力；实现必须保持 DOM/Fiber 身份与副作用边界。 */
  focusLast(focusOptions?: FocusOptions): void,
  /** `FragmentInstanceType.blur` 约定Fragment handle 的事件、焦点、观察器与 DOM 顺序投影暴露的可调用能力；实现必须保持 DOM/Fiber 身份与副作用边界。 */
  blur(): void,
  /** `FragmentInstanceType.observeUsing` 约定Fragment handle 的事件、焦点、观察器与 DOM 顺序投影暴露的可调用能力；实现必须保持 DOM/Fiber 身份与副作用边界。 */
  observeUsing(observer: IntersectionObserver | ResizeObserver): void,
  /** `FragmentInstanceType.unobserveUsing` 约定Fragment handle 的事件、焦点、观察器与 DOM 顺序投影暴露的可调用能力；实现必须保持 DOM/Fiber 身份与副作用边界。 */
  unobserveUsing(observer: IntersectionObserver | ResizeObserver): void,
  /** `FragmentInstanceType.getClientRects` 约定Fragment handle 的事件、焦点、观察器与 DOM 顺序投影暴露的可调用能力；实现必须保持 DOM/Fiber 身份与副作用边界。 */
  getClientRects(): Array<DOMRect>,
  /** `FragmentInstanceType.getRootNode` 约定Fragment handle 的事件、焦点、观察器与 DOM 顺序投影暴露的可调用能力；实现必须保持 DOM/Fiber 身份与副作用边界。 */
  getRootNode(getRootNodeOptions?: {
    /** `FragmentInstanceType.composed` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在Fragment handle 的事件、焦点、观察器与 DOM 顺序投影生命周期内有效。 */
    composed: boolean,
  }): Document | ShadowRoot | FragmentInstanceType,
  /** `FragmentInstanceType.compareDocumentPosition` 约定Fragment handle 的事件、焦点、观察器与 DOM 顺序投影暴露的可调用能力；实现必须保持 DOM/Fiber 身份与副作用边界。 */
  compareDocumentPosition(otherNode: Instance): number,
  /** `FragmentInstanceType.scrollIntoView` 约定Fragment handle 的事件、焦点、观察器与 DOM 顺序投影暴露的可调用能力；实现必须保持 DOM/Fiber 身份与副作用边界。 */
  scrollIntoView(alignToTop?: boolean): void,
};

/** `FragmentInstance` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
function FragmentInstance(this: FragmentInstanceType, fragmentFiber: Fiber) {
  this._fragmentFiber = fragmentFiber;
  this._eventListeners = null;
  this._observers = null;
}

// $FlowFixMe[prop-missing]
FragmentInstance.prototype.addEventListener = function (
  this: FragmentInstanceType,
  type: string,
  listener: EventListener,
  optionsOrUseCapture?: EventListenerOptionsOrUseCapture,
): void {
  if (this._eventListeners === null) {
    this._eventListeners = [];
  }

  const listeners = this._eventListeners;
  //Element.addEventListener 默认只会唯一地应用新的事件监听器。由于我们需要收集这些监听器以应用到附加的子元素，我们自己跟踪它们并对选项使用自定义的相等性检查。
  const isNewEventListener =
    indexOfEventListener(listeners, type, listener, optionsOrUseCapture) === -1;
  if (isNewEventListener) {
    listeners.push({type, listener, optionsOrUseCapture});
    traverseFragmentInstancesAndTextInstances(
      this._fragmentFiber,
      addEventListenerToChild,
      type,
      listener,
      optionsOrUseCapture,
    );
  }
  this._eventListeners = listeners;
};
/** `addEventListenerToChild` 登记或挂接目标，维持宿主顺序与资源引用计数；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
function addEventListenerToChild(
  child: Fiber,
  type: string,
  listener: EventListener,
  optionsOrUseCapture?: EventListenerOptionsOrUseCapture,
): boolean {
  const instance = getInstanceFromHostFiber<Instance | TextInstance>(child);
  instance.addEventListener(type, listener, optionsOrUseCapture);
  return false;
}
// $FlowFixMe[prop-missing]
FragmentInstance.prototype.removeEventListener = function (
  this: FragmentInstanceType,
  type: string,
  listener: EventListener,
  optionsOrUseCapture?: EventListenerOptionsOrUseCapture,
): void {
  const listeners = this._eventListeners;
  if (listeners === null) {
    return;
  }
  if (typeof listeners !== 'undefined' && listeners.length > 0) {
    traverseFragmentInstancesAndTextInstances(
      this._fragmentFiber,
      removeEventListenerFromChild,
      type,
      listener,
      optionsOrUseCapture,
    );
    const index = indexOfEventListener(
      listeners,
      type,
      listener,
      optionsOrUseCapture,
    );
    if (this._eventListeners !== null) {
      this._eventListeners.splice(index, 1);
    }
  }
};
/** `removeEventListenerFromChild` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
function removeEventListenerFromChild(
  child: Fiber,
  type: string,
  listener: EventListener,
  optionsOrUseCapture?: EventListenerOptionsOrUseCapture,
): boolean {
  const instance = getInstanceFromHostFiber<Instance | TextInstance>(child);
  instance.removeEventListener(type, listener, optionsOrUseCapture);
  return false;
}
/** `normalizeListenerOptions` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
function normalizeListenerOptions(
  opts: ?EventListenerOptionsOrUseCapture,
): string {
  if (opts == null) {
    return '0';
  }

  if (typeof opts === 'boolean') {
    return `c=${opts ? '1' : '0'}`;
  }

  return `c=${opts.capture ? '1' : '0'}`;
}
/** `indexOfEventListener` 查询、匹配或计算所需结果；不适用时返回协议约定的空值；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
function indexOfEventListener(
  eventListeners: Array<StoredEventListener>,
  type: string,
  listener: EventListener,
  optionsOrUseCapture: void | EventListenerOptionsOrUseCapture,
): number {
  if (eventListeners.length === 0) {
    return -1;
  }
  const normalizedOptions = normalizeListenerOptions(optionsOrUseCapture);
  for (let i = 0; i < eventListeners.length; i++) {
    const item = eventListeners[i];
    if (
      item.type === type &&
      item.listener === listener &&
      normalizeListenerOptions(item.optionsOrUseCapture) === normalizedOptions
    ) {
      return i;
    }
  }
  return -1;
}
// $FlowFixMe[prop-missing]
FragmentInstance.prototype.dispatchEvent = function (
  this: FragmentInstanceType,
  event: Event,
): boolean {
  const parentHostFiber = getFragmentParentInstanceOrContainerFiber(
    this._fragmentFiber,
  );
  if (parentHostFiber === null) {
    return true;
  }
  const parentHostInstance = getInstanceFromHostFiber<Instance | Container>(
    parentHostFiber,
  );
  const eventListeners = this._eventListeners;
  if (
    (eventListeners !== null && eventListeners.length > 0) ||
    !event.bubbles
  ) {
    const temp = document.createTextNode('');
    if (eventListeners) {
      for (let i = 0; i < eventListeners.length; i++) {
        const {type, listener, optionsOrUseCapture} = eventListeners[i];
        temp.addEventListener(type, listener, optionsOrUseCapture);
      }
    }
    parentHostInstance.appendChild(temp);
    const cancelable = temp.dispatchEvent(event);
    if (eventListeners) {
      for (let i = 0; i < eventListeners.length; i++) {
        const {type, listener, optionsOrUseCapture} = eventListeners[i];
        temp.removeEventListener(type, listener, optionsOrUseCapture);
      }
    }
    parentHostInstance.removeChild(temp);
    return cancelable;
  } else {
    return parentHostInstance.dispatchEvent(event);
  }
};
// $FlowFixMe[prop-missing]
FragmentInstance.prototype.focus = function (
  this: FragmentInstanceType,
  focusOptions?: FocusOptions,
): void {
  traverseFragmentInstancesAndTextInstancesDeeply(
    this._fragmentFiber,
    setFocusOnFiberIfFocusable,
    focusOptions,
  );
};
/** `setFocusOnFiberIfFocusable` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
function setFocusOnFiberIfFocusable(
  fiber: Fiber,
  focusOptions?: FocusOptions,
): boolean {
  if (enableFragmentRefsTextNodes) {
    //跳过文本节点 - 它们不能获得焦点
    if (fiber.tag === HostText) {
      return false;
    }
  }
  const instance = getInstanceFromHostFiber<Instance>(fiber);
  return setFocusIfFocusable(instance, focusOptions);
}
// $FlowFixMe[prop-missing]
FragmentInstance.prototype.focusLast = function (
  this: FragmentInstanceType,
  focusOptions?: FocusOptions,
): void {
  const children: Array<Fiber> = [];
  traverseFragmentInstancesAndTextInstancesDeeply(
    this._fragmentFiber,
    collectChildren,
    children,
  );
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (setFocusOnFiberIfFocusable(child, focusOptions)) {
      break;
    }
  }
};
/** `collectChildren` 沿 Fragment 或事件边界执行 DOM 操作，限制影响范围；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
function collectChildren(child: Fiber, collection: Array<Fiber>): boolean {
  collection.push(child);
  return false;
}
// $FlowFixMe[prop-missing]
FragmentInstance.prototype.blur = function (this: FragmentInstanceType): void {
  //如果 activeElement 不在片段的父元素内，则提前退出
  const parentHostFiber = getFragmentParentInstanceOrContainerFiber(
    this._fragmentFiber,
  );
  if (parentHostFiber === null) {
    return;
  }
  const parentInstanceOrContainer = getInstanceFromHostFiber<
    Instance | Container,
  >(parentHostFiber);
  //实例被包含在 DOM 的容器类型中。
  const ownerDocument = getOwnerDocumentFromRootContainer(
    parentInstanceOrContainer,
  );
  const activeElement = ownerDocument.activeElement;
  if (
    activeElement === null ||
    !parentInstanceOrContainer.contains(activeElement)
  ) {
    return;
  }

  traverseFragmentInstancesAndTextInstances(
    this._fragmentFiber,
    blurActiveElementWithinFragment,
    activeElement,
  );
};
/** `blurActiveElementWithinFragment` 沿 Fragment 或事件边界执行 DOM 操作，限制影响范围；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
function blurActiveElementWithinFragment(
  child: Fiber,
  activeElement: Element,
): boolean {
  //跳过文本节点 - 它们无法被聚焦
  if (enableFragmentRefsTextNodes && child.tag === HostText) {
    return false;
  }
  const instance = getInstanceFromHostFiber<Instance>(child);
  if (instance === activeElement || instance.contains(activeElement)) {
    // $FlowFixMe[prop-missing]
    activeElement.blur();
    return true;
  }
  return false;
}
// $FlowFixMe[prop-missing]
FragmentInstance.prototype.observeUsing = function (
  this: FragmentInstanceType,
  observer: IntersectionObserver | ResizeObserver,
): void {
  if (__DEV__) {
    if (enableFragmentRefsTextNodes) {
      let hasText = false;
      let hasElement = false;
      traverseFragmentInstancesAndTextInstances(
        this._fragmentFiber,
        (child: Fiber) => {
          if (child.tag === HostText) {
            hasText = true;
          } else {
            //停止遍历，找到元素
            hasElement = true;
            return true;
          }
          return false;
        },
      );
      if (hasText && !hasElement) {
        console.error(
          'observeUsing() was called on a FragmentInstance with only text children. ' +
            'Observers do not work on text nodes.',
        );
      }
    }
  }
  if (this._observers === null) {
    this._observers = new Set();
  }
  this._observers.add(observer);
  traverseFragmentInstancesAndTextInstances(
    this._fragmentFiber,
    observeChild,
    observer,
  );
};
/** `observeChild` 登记或挂接目标，维持宿主顺序与资源引用计数；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
function observeChild(
  child: Fiber,
  observer: IntersectionObserver | ResizeObserver,
) {
  if (enableFragmentRefsTextNodes) {
    //跳过文本节点 - 观察者对它们不起作用
    if (child.tag === HostText) {
      return false;
    }
  }
  const instance = getInstanceFromHostFiber<Instance>(child);
  observer.observe(instance);
  return false;
}
// $FlowFixMe[prop-missing]
FragmentInstance.prototype.unobserveUsing = function (
  this: FragmentInstanceType,
  observer: IntersectionObserver | ResizeObserver,
): void {
  const observers = this._observers;
  if (observers === null || !observers.has(observer)) {
    if (__DEV__) {
      console.error(
        'You are calling unobserveUsing() with an observer that is not being observed with this fragment ' +
          'instance. First attach the observer with observeUsing()',
      );
    }
  } else {
    observers.delete(observer);
    traverseFragmentInstancesAndTextInstances(
      this._fragmentFiber,
      unobserveChild,
      observer,
    );
  }
};
/** `unobserveChild` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
function unobserveChild(
  child: Fiber,
  observer: IntersectionObserver | ResizeObserver,
) {
  if (enableFragmentRefsTextNodes) {
    //跳过文本节点——它们从未被观察到
    if (child.tag === HostText) {
      return false;
    }
  }
  const instance = getInstanceFromHostFiber<Instance>(child);
  observer.unobserve(instance);
  return false;
}
// $FlowFixMe[prop-missing]
FragmentInstance.prototype.getClientRects = function (
  this: FragmentInstanceType,
): Array<DOMRect> {
  const rects: Array<DOMRect> = [];
  traverseFragmentInstancesAndTextInstances(
    this._fragmentFiber,
    collectClientRects,
    rects,
  );
  return rects;
};
/** `collectClientRects` 沿 Fragment 或事件边界执行 DOM 操作，限制影响范围；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
function collectClientRects(child: Fiber, rects: Array<DOMRect>): boolean {
  if (enableFragmentRefsTextNodes && child.tag === HostText) {
    const textNode: Text = child.stateNode;
    const range = textNode.ownerDocument.createRange();
    range.selectNodeContents(textNode);
    // $FlowFixMe[method-unbinding]
    rects.push.apply(rects, range.getClientRects());
  } else {
    const instance = getInstanceFromHostFiber<Instance>(child);
    // $FlowFixMe[method-unbinding]
    rects.push.apply(rects, instance.getClientRects());
  }
  return false;
}
// $FlowFixMe[prop-missing]
FragmentInstance.prototype.getRootNode = function (
  this: FragmentInstanceType,
  getRootNodeOptions?: {
    /** 是否允许查询穿过 ShadowRoot，语义与原生 getRootNode 选项一致。 */
    composed: boolean
  },
): Document | ShadowRoot | FragmentInstanceType {
  const parentHostFiber = getFragmentParentInstanceOrContainerFiber(
    this._fragmentFiber,
  );
  if (parentHostFiber === null) {
    return this;
  }
  const parentHostInstance = getInstanceFromHostFiber<Instance | Container>(
    parentHostFiber,
  );
  const rootNode =
    // $FlowFixMe[incompatible-type] Flow expects Node
    parentHostInstance.getRootNode(getRootNodeOptions) as Document | ShadowRoot;
  return rootNode;
};
// $FlowFixMe[prop-missing]
FragmentInstance.prototype.compareDocumentPosition = function (
  this: FragmentInstanceType,
  otherNode: Instance,
): number {
  const parentHostFiber = getFragmentParentInstanceOrContainerFiber(
    this._fragmentFiber,
  );
  if (parentHostFiber === null) {
    return Node.DOCUMENT_POSITION_DISCONNECTED;
  }
  const children: Array<Fiber> = [];
  traverseFragmentInstancesAndTextInstances(
    this._fragmentFiber,
    collectChildren,
    children,
  );
  const parentHostInstance = getInstanceFromHostFiber<Instance | Container>(
    parentHostFiber,
  );

  if (children.length === 0) {
    return compareDocumentPositionForEmptyFragment(
      this._fragmentFiber,
      parentHostInstance,
      otherNode,
      getInstanceFromHostFiber,
    );
  }

  const firstNode = getInstanceFromHostFiber<Instance | TextInstance>(
    children[0],
  );
  const lastNode = getInstanceFromHostFiber<Instance | TextInstance>(
    children[children.length - 1],
  );

  //如果该片段已被传送到另一个宿主实例，我们需要尽力猜测使用子实例的父级，而不是 fiber 树的宿主父级。
  const parentHostInstanceFromDOM = fiberIsPortaledIntoHost(this._fragmentFiber)
    ? (firstNode.parentElement as ?Instance)
    : parentHostInstance;

  if (parentHostInstanceFromDOM == null) {
    return Node.DOCUMENT_POSITION_DISCONNECTED;
  }

  //在把第一个和最后一个节点作为其他包含节点的真实来源之前，先检查它们是否确实在预期的文档位置
  const firstNodeIsContained =
    parentHostInstanceFromDOM.compareDocumentPosition(firstNode) &
    Node.DOCUMENT_POSITION_CONTAINED_BY;
  const lastNodeIsContained =
    parentHostInstanceFromDOM.compareDocumentPosition(lastNode) &
    Node.DOCUMENT_POSITION_CONTAINED_BY;
  const firstResult = firstNode.compareDocumentPosition(otherNode);
  const lastResult = lastNode.compareDocumentPosition(otherNode);

  const otherNodeIsFirstOrLastChild =
    (firstNodeIsContained && firstNode === otherNode) ||
    (lastNodeIsContained && lastNode === otherNode);
  const otherNodeIsFirstOrLastChildDisconnected =
    (!firstNodeIsContained && firstNode === otherNode) ||
    (!lastNodeIsContained && lastNode === otherNode);
  const otherNodeIsWithinFirstOrLastChild =
    firstResult & Node.DOCUMENT_POSITION_CONTAINED_BY ||
    lastResult & Node.DOCUMENT_POSITION_CONTAINED_BY;
  const otherNodeIsBetweenFirstAndLastChildren =
    firstNodeIsContained &&
    lastNodeIsContained &&
    firstResult & Node.DOCUMENT_POSITION_FOLLOWING &&
    lastResult & Node.DOCUMENT_POSITION_PRECEDING;

  let result = Node.DOCUMENT_POSITION_DISCONNECTED;
  if (
    otherNodeIsFirstOrLastChild ||
    otherNodeIsWithinFirstOrLastChild ||
    otherNodeIsBetweenFirstAndLastChildren
  ) {
    result = Node.DOCUMENT_POSITION_CONTAINED_BY;
  } else if (otherNodeIsFirstOrLastChildDisconnected) {
    //otherNode 已被传送到另一个容器中
    result = Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC;
  } else {
    result = firstResult;
  }

  if (
    result & Node.DOCUMENT_POSITION_DISCONNECTED ||
    result & Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC
  ) {
    return result;
  }

  //现在我们已经得到了来自 DOM API 的结果，我们会再次检查它是否与 React 树的状态匹配。如果不匹配，那就是存在使用 portal 或其他方式注入的元素的情况，我们将返回 DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC。
  const documentPositionMatchesFiberPosition =
    validateDocumentPositionWithFiberTree(
      result,
      this._fragmentFiber,
      children[0],
      children[children.length - 1],
      otherNode,
    );
  if (documentPositionMatchesFiberPosition) {
    return result;
  }
  return Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC;
};

/** `validateDocumentPositionWithFiberTree` 验证宿主不变量并构造开发期诊断，不改变生产语义；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
function validateDocumentPositionWithFiberTree(
  documentPosition: number,
  fragmentFiber: Fiber,
  precedingBoundaryFiber: Fiber,
  followingBoundaryFiber: Fiber,
  otherNode: Instance,
): boolean {
  const otherFiber = getClosestInstanceFromNode(otherNode);
  if (documentPosition & Node.DOCUMENT_POSITION_CONTAINED_BY) {
    return (
      !!otherFiber && isFiberContainedByFragment(otherFiber, fragmentFiber)
    );
  }
  if (documentPosition & Node.DOCUMENT_POSITION_CONTAINS) {
    if (otherFiber === null) {
      //如果 otherFiber 是文档或 body 元素，它可能为 null
      const ownerDocument = otherNode.ownerDocument;
      // $FlowFixMe[invalid-compare]
      return otherNode === ownerDocument || otherNode === ownerDocument.body;
    }
    return isFragmentContainedByFiber(fragmentFiber, otherFiber);
  }
  if (documentPosition & Node.DOCUMENT_POSITION_PRECEDING) {
    return (
      !!otherFiber &&
      (otherFiber === precedingBoundaryFiber ||
        isFiberPreceding(precedingBoundaryFiber, otherFiber))
    );
  }
  if (documentPosition & Node.DOCUMENT_POSITION_FOLLOWING) {
    return (
      !!otherFiber &&
      (otherFiber === followingBoundaryFiber ||
        isFiberFollowing(followingBoundaryFiber, otherFiber))
    );
  }

  return false;
}

/** `scrollTextNodeIntoView` 沿 Fragment 或事件边界执行 DOM 操作，限制影响范围；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
function scrollTextNodeIntoView(
  textNode: TextInstance,
  resolvedAlignToTop: boolean,
): void {
  const range = textNode.ownerDocument.createRange();
  range.selectNodeContents(textNode);
  const rect = range.getBoundingClientRect();
  const scrollY = resolvedAlignToTop
    ? window.scrollY + rect.top
    : window.scrollY + rect.bottom - window.innerHeight;
  window.scrollTo(window.scrollX + rect.left, scrollY);
}

if (enableFragmentRefsScrollIntoView) {
  // $FlowFixMe[prop-missing]
  FragmentInstance.prototype.scrollIntoView = function (
    this: FragmentInstanceType,
    alignToTop?: boolean,
  ): void {
    if (typeof alignToTop === 'object') {
      throw new Error(
        'FragmentInstance.scrollIntoView() does not support ' +
          'scrollIntoViewOptions. Use the alignToTop boolean instead.',
      );
    }
    //首先，获取子节点
    const children: Array<Fiber> = [];
    traverseFragmentInstancesAndTextInstances(
      this._fragmentFiber,
      collectChildren,
      children,
    );

    const resolvedAlignToTop = alignToTop !== false;

    //如果没有子节点，我们可以使用父节点和兄弟节点来确定位置
    if (children.length === 0) {
      const hostSiblings = getFragmentInstanceOrTextInstanceSiblings(
        this._fragmentFiber,
      );
      const targetFiber = resolvedAlignToTop
        ? hostSiblings[1] ||
          hostSiblings[0] ||
          getFragmentParentInstanceOrContainerFiber(this._fragmentFiber)
        : hostSiblings[0] || hostSiblings[1];

      if (targetFiber === null) {
        if (__DEV__) {
          console.warn(
            'You are attempting to scroll a FragmentInstance that has no ' +
              'children, siblings, or parent. No scroll was performed.',
          );
        }
        return;
      }
      //对于文本节点的兄弟节点，使用 Range API 滚动到它们的位置
      if (enableFragmentRefsTextNodes && targetFiber.tag === HostText) {
        const textNode = getInstanceFromHostFiber<TextInstance>(targetFiber);
        scrollTextNodeIntoView(textNode, resolvedAlignToTop);
        return;
      }
      const target = getInstanceFromHostFiber<Instance | Container>(
        targetFiber,
      );
      //如果父宿主 fiber 是 HostRoot，则目标是一个容器，它不一定是具有 scrollIntoView 方法的元素。
      if (target.nodeType === DOCUMENT_NODE) {
        //一个文档始终处于可见状态。
      } else if (target.nodeType === DOCUMENT_FRAGMENT_NODE) {
        const fragment = target as any as DocumentFragment;
        //ShadowRoot 总是有一个 host：https://dom.spec.whatwg.org/#ref-for-concept-documentfragment-host%E2%91%A5 通用的 DocumentFragment 不实现此属性，但从概念上讲，host 是一个可为空的 Element：https://dom.spec.whatwg.org/#concept-documentfragment-host
        const host =
          'host' in fragment ? (fragment as any as ShadowRoot).host : null;
        if (host !== null) {
          //ShadowRoot 的宿主元素标记了片段内容将出现的位置。
          host.scrollIntoView(alignToTop);
        } else if (__DEV__) {
          console.warn(
            'You are attempting to scroll a FragmentInstance that is only ' +
              'mounted inside a detached DocumentFragment. No scroll was ' +
              'performed.',
          );
        }
        return;
      } else {
        //通过上面的 nodeType 检查缩小到 Element，但 Flow 并不知道这一点。
        const element = target as any as Element;
        element.scrollIntoView(alignToTop);
      }
    }

    let i = resolvedAlignToTop ? children.length - 1 : 0;
    while (i !== (resolvedAlignToTop ? -1 : children.length)) {
      const child = children[i];
      //对于文本节点，使用 Range API 滚动到它们的位置
      if (enableFragmentRefsTextNodes && child.tag === HostText) {
        const textNode = getInstanceFromHostFiber<TextInstance>(child);
        scrollTextNodeIntoView(textNode, resolvedAlignToTop);
        i += resolvedAlignToTop ? -1 : 1;
        continue;
      }
      const instance = getInstanceFromHostFiber<Instance>(child);
      instance.scrollIntoView(alignToTop);
      i += resolvedAlignToTop ? -1 : 1;
    }
  };
}

/** `addFragmentHandleToFiber` 登记或挂接目标，维持宿主顺序与资源引用计数；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
function addFragmentHandleToFiber(
  child: Fiber,
  fragmentInstance: FragmentInstanceType,
): boolean {
  if (enableFragmentRefsInstanceHandles) {
    const instance = getInstanceFromHostFiber<Instance | TextInstance>(
      child,
    ) as any as HostNodeWithFragmentHandles;
    addFragmentHandleToInstance(instance, fragmentInstance);
  }
  return false;
}

/** `addFragmentHandleToInstance` 登记或挂接目标，维持宿主顺序与资源引用计数；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
function addFragmentHandleToInstance(
  instance: HostNodeWithFragmentHandles,
  fragmentInstance: FragmentInstanceType,
): void {
  if (enableFragmentRefsInstanceHandles) {
    if (instance.reactFragments == null) {
      instance.reactFragments = new Set();
    }
    instance.reactFragments.add(fragmentInstance);
  }
}

/** `createFragmentInstance` 创建宿主对象或快照，并把所有权交给当前提交阶段；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
export function createFragmentInstance(
  fragmentFiber: Fiber,
): FragmentInstanceType {
  const fragmentInstance = new (FragmentInstance as any)(fragmentFiber);
  if (enableFragmentRefsInstanceHandles) {
    traverseFragmentInstancesAndTextInstances(
      fragmentFiber,
      addFragmentHandleToFiber,
      fragmentInstance,
    );
  }
  return fragmentInstance;
}

/** `updateFragmentInstanceFiber` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
export function updateFragmentInstanceFiber(
  fragmentFiber: Fiber,
  instance: FragmentInstanceType,
): void {
  instance._fragmentFiber = fragmentFiber;
}

/** `commitNewChildToFragmentInstance` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
export function commitNewChildToFragmentInstance(
  childInstance: InstanceWithFragmentHandles | Text,
  fragmentInstance: FragmentInstanceType,
): void {
  if (childInstance.nodeType === TEXT_NODE) {
    return;
  }
  const instance: InstanceWithFragmentHandles = childInstance as any;
  const eventListeners = fragmentInstance._eventListeners;
  if (eventListeners !== null) {
    for (let i = 0; i < eventListeners.length; i++) {
      const {type, listener, optionsOrUseCapture} = eventListeners[i];
      instance.addEventListener(type, listener, optionsOrUseCapture);
    }
  }
  if (fragmentInstance._observers !== null) {
    fragmentInstance._observers.forEach(observer => {
      observer.observe(instance);
    });
  }
  if (enableFragmentRefsInstanceHandles) {
    addFragmentHandleToInstance(instance, fragmentInstance);
  }
}

/** `deleteChildFromFragmentInstance` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
export function deleteChildFromFragmentInstance(
  childInstance: InstanceWithFragmentHandles | Text,
  fragmentInstance: FragmentInstanceType,
): void {
  if (childInstance.nodeType === TEXT_NODE) {
    return;
  }
  const instance: InstanceWithFragmentHandles = childInstance as any;
  const eventListeners = fragmentInstance._eventListeners;
  if (eventListeners !== null) {
    for (let i = 0; i < eventListeners.length; i++) {
      const {type, listener, optionsOrUseCapture} = eventListeners[i];
      instance.removeEventListener(type, listener, optionsOrUseCapture);
    }
  }
  if (enableFragmentRefsInstanceHandles) {
    if (instance.reactFragments != null) {
      instance.reactFragments.delete(fragmentInstance);
    }
  }
}

/** `clearContainer` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
export function clearContainer(container: Container): void {
  const nodeType = container.nodeType;
  if (nodeType === DOCUMENT_NODE) {
    clearContainerSparingly(container);
  } else if (nodeType === ELEMENT_NODE) {
    switch (container.nodeName) {
      case 'HEAD':
      case 'HTML':
      case 'BODY':
        clearContainerSparingly(container);
        return;
      default: {
        container.textContent = '';
      }
    }
  }
}

/** `clearContainerSparingly` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
function clearContainerSparingly(container: Node) {
  let node;
  let nextNode: ?Node = container.firstChild;
  if (nextNode && nextNode.nodeType === DOCUMENT_TYPE_NODE) {
    nextNode = nextNode.nextSibling;
  }
  while (nextNode) {
    node = nextNode;
    nextNode = nextNode.nextSibling;
    switch (node.nodeName) {
      case 'HTML':
      case 'HEAD':
      case 'BODY': {
        const element: Element = node as any;
        clearContainerSparingly(element);
        //如果这些单例实例之前已经使用 React 渲染过，它们可能仍然保留对之前 fiber 树的引用。我们会前瞻性地将它们分离，以将它们重置到基准起始状态，因为我们无法创建新的实例。
        detachDeletedInstance(element);
        continue;
      }
      //保留 script 标签是为了避免一个边缘情况的错误。通常情况下，如果脚本被插入到 DOM 中，它们会执行。然而，在流式传输时，如果一个 script 标签已经打开但尚未关闭，一些浏览器会创建并插入脚本 DOM 节点，但脚本在解析到闭合标签之前无法执行。如果在该 DOM 节点还在文档中但尚不可执行的时候，有某些操作导致 React 调用 clearContainer，这个 DOM 节点将会从文档中移除，当脚本闭合标签到达时，脚本将不会运行。目前这似乎在 Chrome/Firefox 中会发生，但在 Safari 中不会，尽管这不一定是规格化的行为，所以在未来的浏览器版本中可能会改变。虽然保留所有脚本比严格必要的要宽泛，但这是避免这个破坏性边缘情况所需的最少额外代码。
      //
      //保留样式标签，因为它们可能来自第三方脚本和扩展
      case 'SCRIPT':
      case 'STYLE': {
        continue;
      }
      //保留样式表标签，因为它们很可能来自第三方脚本和扩展
      case 'LINK': {
        if (
          (node as any as HTMLLinkElement).rel.toLowerCase() === 'stylesheet'
        ) {
          continue;
        }
      }
    }
    container.removeChild(node);
  }
  return;
}

/** `clearHead` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
function clearHead(head: Element): void {
  let node = head.firstChild;
  while (node) {
    const nextNode = node.nextSibling;
    const nodeName = node.nodeName;
    if (
      isMarkedHoistable(node) ||
      nodeName === 'SCRIPT' ||
      nodeName === 'STYLE' ||
      (nodeName === 'LINK' &&
        (node as any as HTMLLinkElement).rel.toLowerCase() === 'stylesheet')
    ) {
      //保留这些节点
    } else {
      head.removeChild(node);
    }
    node = nextNode;
  }
  return;
}

//制作这个是为了我们最终可以将所有实例缓存移到提交阶段。目前，这仅用于将 fiber 和 props 关联到实例，以便为 HostSingletons 进行水化。我们需要在这里这样做的原因是我们只想在提交时进行这种绑定，因为一次只能有一个 fiber 拥有实例，并且渲染可能会失败或重新启动。
/** `bindInstance` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于Fragment handle 的事件、焦点、观察器与 DOM 顺序投影。 */
export function bindInstance(
  instance: Instance,
  props: Props,
  internalInstanceHandle: mixed,
) {
  precacheFiberNode(internalInstanceHandle as any, instance);
  updateFiberProps(instance, props);
}

// -------------------
//补水
// -------------------

/** `supportsHydration` 声明 renderer 是否支持对应 Host Config 能力；reconciler 据此选择合法分支。 */
export const supportsHydration = true;

/** `canHydrateInstance` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function canHydrateInstance(
  instance: HydratableInstance,
  type: string,
  props: Props,
  inRootOrSingleton: boolean,
): null | Instance {
  while (instance.nodeType === ELEMENT_NODE) {
    const element: Element = instance as any;
    const anyProps = props as any;
    if (element.nodeName.toLowerCase() !== type.toLowerCase()) {
      if (!inRootOrSingleton) {
        //通常我们会因为标签不匹配而出错。
        if (
          element.nodeName === 'INPUT' &&
          (element as any).type === 'hidden'
        ) {
          //如果我们有额外的隐藏输入，我们就不会不匹配。这使我们能够在原始表单中嵌入额外的表单数据。
        } else {
          return null;
        }
      }
      //在根节点或单例父节点中，我们会跳过不匹配的实例。
    } else if (!inRootOrSingleton) {
      //比赛
      if (type === 'input' && (element as any).type === 'hidden') {
        if (__DEV__) {
          checkAttributeStringCoercion(anyProps.name, 'name');
        }
        const name = anyProps.name == null ? null : '' + anyProps.name;
        if (
          anyProps.type !== 'hidden' ||
          element.getAttribute('name') !== name
        ) {
          //除非那正是我们要找的，否则跳过隐藏输入。这允许我们在原始表单中嵌入额外的表单数据。
        } else {
          return element;
        }
      } else {
        return element;
      }
    } else if (isMarkedHoistable(element)) {
      //我们已经把这个声明为可提升的，但这种方式没有被水化，所以我们跳过它。
    } else {
      //我们有一个类型正确的元素。如果我们能够明确地识别它是被提升的节点，或者我们能够猜测该节点可能被提升，或者是由第三方脚本或浏览器扩展使用某些类型的高熵属性插入的，那么我们将尝试排除它。这种技术对于像扩展在 <body> 中前置 <div> 这样的奇怪插入是会失败的，但那之前已经会出错了，而且这是一个边缘情况。
      switch (type) {
        // case 'title':
        //我们假设所有标题都是可匹配的。文档中应仅有一个标题，至少在可提升的范围内，如果你是类型为 title 的 HostComponent，我们必须要么处于 <svg> 上下文中，要么该标题必须有一个 `itemProp` 属性。
        case 'meta': {
          //唯一的方式来选择不提升元标签是给它一个 itemprop 属性。我们假设不会有第三方元标签被提前添加，接受这种情况不成立的例子，因为元标签通常只对 SSR 有作用，所以即使在我们确实绑定到一个被注入的标签的罕见情况下，运行时的影响也是最小的。
          if (!element.hasAttribute('itemprop')) {
            //这是一个可升降的
            break;
          }
          return element;
        }
        case 'link': {
          //链接有多种形式，我们确实预计第三方会将它们注入 <head> / <body>。我们排除已知资源，然后使用高熵属性，如 href，这些属性几乎总是被使用，而且几乎总是唯一的，从而过滤掉不太可能匹配的情况。
          const rel = element.getAttribute('rel');
          if (rel === 'stylesheet' && element.hasAttribute('data-precedence')) {
            //这是一个样式表资源
            break;
          } else if (
            rel !== anyProps.rel ||
            element.getAttribute('href') !==
              (anyProps.href == null || anyProps.href === ''
                ? null
                : anyProps.href) ||
            element.getAttribute('crossorigin') !==
              (anyProps.crossOrigin == null ? null : anyProps.crossOrigin) ||
            element.getAttribute('title') !==
              (anyProps.title == null ? null : anyProps.title)
          ) {
            //rel + href 通常足以唯一标识一个链接，然而对于 rel=preconnect，crossOrigin 可能会有所不同，而对于 rel=alternate，title 可能会有所不同
            break;
          }
          return element;
        }
        case 'style': {
          //样式很难正确匹配。我们可以排除已知资源，但除此之外，我们接受这样一个事实：由于其在文档中的位置以及它们可能包含全局样式，<head> 或 <body> 中的非提升样式标签很可能永远不会被卸载。
          if (element.hasAttribute('data-precedence')) {
            //这是一个风格资源
            break;
          }
          return element;
        }
        case 'script': {
          //脚本有点棘手，我们排除已知资源，然后类似于链接，尝试使用高熵属性来拒绝不匹配的项。脚本的一个挑战是内联脚本。我们不会尝试检查文本内容，理论上，如果第三方在 React 渲染节点之前注入了内联脚本，可能会导致后期水合错误。如果发生这种情况，回退到客户端渲染应该是无缝的，因此我们会尝试这个启发式方法，如果发现存在问题，我们会在以后重新评估。
          const srcAttr = element.getAttribute('src');
          if (
            srcAttr !== (anyProps.src == null ? null : anyProps.src) ||
            element.getAttribute('type') !==
              (anyProps.type == null ? null : anyProps.type) ||
            element.getAttribute('crossorigin') !==
              (anyProps.crossOrigin == null ? null : anyProps.crossOrigin)
          ) {
            //此脚本用于不同的 src/type/crossOrigin。它可能是一个脚本资源，也可能只是一个不匹配
            if (
              srcAttr &&
              element.hasAttribute('async') &&
              !element.hasAttribute('itemprop')
            ) {
              //这是一个异步脚本资源
              break;
            }
          }
          return element;
        }
        default: {
          //我们已经排除了最可能的可提升标签、第三方脚本插入的标签以及浏览器扩展插入的标签之间的不匹配情况。虽然这有可能不是正确的匹配，但这是一个不错的启发式方法，应该能在绝大多数情况下起作用。
          return element;
        }
      }
    }
    const nextInstance = getNextHydratableSibling(element);
    if (nextInstance === null) {
      break;
    }
    instance = nextInstance;
  }
  //这是一个 Suspense 边界或文本节点，或者我们已经到了结尾。Suspense 边界从不应由第三方注入。如果我们看到一个边界，它应该被匹配，否则这就是一个水合错误。文本节点也不应由第三方注入。对于 <body>，这一点的保证性较低，但将其视为一个水合错误似乎是合理且保守的做法。
  return null;
}

/** `canHydrateTextInstance` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function canHydrateTextInstance(
  instance: HydratableInstance,
  text: string,
  inRootOrSingleton: boolean,
): null | TextInstance {
  //空字符串不会被 HTML 解析，所以这里不会有正确的匹配。
  if (text === '') return null;

  while (instance.nodeType !== TEXT_NODE) {
    if (
      instance.nodeType === ELEMENT_NODE &&
      instance.nodeName === 'INPUT' &&
      (instance as any).type === 'hidden'
    ) {
      //如果我们有额外的隐藏输入，我们就不会不匹配。这使我们能够在原始表单中嵌入额外的表单数据。
    } else if (!inRootOrSingleton) {
      return null;
    }
    const nextInstance = getNextHydratableSibling(instance);
    if (nextInstance === null) {
      return null;
    }
    instance = nextInstance;
  }
  //这现在已被精炼为一个文本节点。
  return instance as any as TextInstance;
}

/** `canHydrateHydrationBoundary` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于hydration 匹配、重试、差异诊断与边界推进。 */
function canHydrateHydrationBoundary(
  instance: HydratableInstance,
  inRootOrSingleton: boolean,
): null | SuspenseInstance | ActivityInstance {
  while (instance.nodeType !== COMMENT_NODE) {
    if (
      instance.nodeType === ELEMENT_NODE &&
      instance.nodeName === 'INPUT' &&
      (instance as any).type === 'hidden'
    ) {
      //如果我们有额外的隐藏输入，我们就不会不匹配。这使我们能够在原始表单中嵌入额外的表单数据。
    } else if (!inRootOrSingleton) {
      return null;
    }
    const nextInstance = getNextHydratableSibling(instance);
    if (nextInstance === null) {
      return null;
    }
    instance = nextInstance;
  }
  //这现在已经被改进为一个水合边界节点。
  return instance as any;
}

/** `canHydrateActivityInstance` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function canHydrateActivityInstance(
  instance: HydratableInstance,
  inRootOrSingleton: boolean,
): null | ActivityInstance {
  const hydratableInstance = canHydrateHydrationBoundary(
    instance,
    inRootOrSingleton,
  );
  if (
    hydratableInstance !== null &&
    hydratableInstance.data === ACTIVITY_START_DATA
  ) {
    return hydratableInstance as any;
  }
  return null;
}

/** `canHydrateSuspenseInstance` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function canHydrateSuspenseInstance(
  instance: HydratableInstance,
  inRootOrSingleton: boolean,
): null | SuspenseInstance {
  const hydratableInstance = canHydrateHydrationBoundary(
    instance,
    inRootOrSingleton,
  );
  if (
    hydratableInstance !== null &&
    hydratableInstance.data !== ACTIVITY_START_DATA
  ) {
    return hydratableInstance as any;
  }
  return null;
}

/** `isSuspenseInstancePending` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function isSuspenseInstancePending(instance: SuspenseInstance): boolean {
  return (
    instance.data === SUSPENSE_PENDING_START_DATA ||
    instance.data === SUSPENSE_QUEUED_START_DATA
  );
}

/** `isSuspenseInstanceFallback` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function isSuspenseInstanceFallback(
  instance: SuspenseInstance,
): boolean {
  return (
    instance.data === SUSPENSE_FALLBACK_START_DATA ||
    (instance.data === SUSPENSE_PENDING_START_DATA &&
      instance.ownerDocument.readyState !== DOCUMENT_READY_STATE_LOADING)
  );
}

/** `getSuspenseInstanceFallbackErrorDetails` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function getSuspenseInstanceFallbackErrorDetails(
  instance: SuspenseInstance,
): {
  /** `getSuspenseInstanceFallbackErrorDetails.digest` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在hydration 匹配、重试、差异诊断与边界推进生命周期内有效。 */
  digest: ?string,
  /** `getSuspenseInstanceFallbackErrorDetails.message` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在hydration 匹配、重试、差异诊断与边界推进生命周期内有效。 */
  message?: string,
  /** `getSuspenseInstanceFallbackErrorDetails.stack` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在hydration 匹配、重试、差异诊断与边界推进生命周期内有效。 */
  stack?: string,
  /** `getSuspenseInstanceFallbackErrorDetails.componentStack` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在hydration 匹配、重试、差异诊断与边界推进生命周期内有效。 */
  componentStack?: string,
} {
  const dataset =
    instance.nextSibling &&
    (instance.nextSibling as any as HTMLElement).dataset;
  let digest, message, stack, componentStack;
  if (dataset) {
    digest = dataset.dgst;
    if (__DEV__) {
      message = dataset.msg;
      stack = dataset.stck;
      componentStack = dataset.cstck;
    }
  }
  if (__DEV__) {
    return {
      message,
      digest,
      stack,
      componentStack,
    };
  } else {
    //如果对象在尾部位置构造并且与调用点的解构匹配，则会被 DCE。
    return {
      digest,
    };
  }
}

/** `registerSuspenseInstanceRetry` 登记或挂接目标，维持宿主顺序与资源引用计数；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function registerSuspenseInstanceRetry(
  instance: SuspenseInstance,
  callback: () => void,
) {
  const ownerDocument = instance.ownerDocument;
  if (instance.data === SUSPENSE_QUEUED_START_DATA) {
    //Fizz 运行时已经将此边界排队等待显示。我们等待它被显示，然后重试。
    instance._reactRetry = callback;
  } else if (
    //Fizz 运行时一定是在渲染完成后但提交之前，将这个边界置于客户端渲染或完成状态。我们现在需要调用回调，而不是等待
    instance.data !== SUSPENSE_PENDING_START_DATA ||
    //边界仍然处于待处理状态，但文档在我们能够注册那个会在加载时安排重试的事件处理程序之前就已经加载完成，所以我们现在调用回调。
    ownerDocument.readyState !== DOCUMENT_READY_STATE_LOADING
  ) {
    callback();
  } else {
    //我们仍处于待处理状态，文档仍在加载中，因此我们将监听器附加到文档加载事件，并在实例上暴露重试，以便 Fizz 运行时在最终解析此边界时触发
    /** `registerSuspenseInstanceRetry.listener` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于hydration 匹配、重试、差异诊断与边界推进。 */
    const listener = () => {
      callback();
      ownerDocument.removeEventListener('DOMContentLoaded', listener);
    };
    ownerDocument.addEventListener('DOMContentLoaded', listener);
    instance._reactRetry = listener;
  }
}

/** `canHydrateFormStateMarker` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function canHydrateFormStateMarker(
  instance: HydratableInstance,
  inRootOrSingleton: boolean,
): null | FormStateMarkerInstance {
  while (instance.nodeType !== COMMENT_NODE) {
    if (!inRootOrSingleton) {
      return null;
    }
    const nextInstance = getNextHydratableSibling(instance);
    if (nextInstance === null) {
      return null;
    }
    instance = nextInstance;
  }
  const nodeData = (instance as any).data;
  if (
    nodeData === FORM_STATE_IS_MATCHING ||
    nodeData === FORM_STATE_IS_NOT_MATCHING
  ) {
    const markerInstance: FormStateMarkerInstance = instance as any;
    return markerInstance;
  }
  return null;
}

/** `isFormStateMarkerMatching` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function isFormStateMarkerMatching(
  markerInstance: FormStateMarkerInstance,
): boolean {
  return markerInstance.data === FORM_STATE_IS_MATCHING;
}

/** `getNextHydratable` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hydration 匹配、重试、差异诊断与边界推进。 */
function getNextHydratable(node: ?Node) {
  //跳过不可水合的节点。
  for (; node != null; node = (node as any as Node).nextSibling) {
    const nodeType = node.nodeType;
    if (nodeType === ELEMENT_NODE || nodeType === TEXT_NODE) {
      break;
    }
    if (nodeType === COMMENT_NODE) {
      const data = (node as any).data;
      if (
        data === SUSPENSE_START_DATA ||
        data === SUSPENSE_FALLBACK_START_DATA ||
        data === SUSPENSE_PENDING_START_DATA ||
        data === SUSPENSE_QUEUED_START_DATA ||
        data === ACTIVITY_START_DATA ||
        data === FORM_STATE_IS_MATCHING ||
        data === FORM_STATE_IS_NOT_MATCHING
      ) {
        break;
      }
      if (data === SUSPENSE_END_DATA || data === ACTIVITY_END_DATA) {
        return null;
      }
    }
  }
  return node as any;
}

/** `getNextHydratableSibling` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function getNextHydratableSibling(
  instance: HydratableInstance,
): null | HydratableInstance {
  return getNextHydratable(instance.nextSibling);
}

/** `getFirstHydratableChild` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function getFirstHydratableChild(
  parentInstance: Instance,
): null | HydratableInstance {
  return getNextHydratable(parentInstance.firstChild);
}

/** `getFirstHydratableChildWithinContainer` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function getFirstHydratableChildWithinContainer(
  parentContainer: Container,
): null | HydratableInstance {
  let parentElement: Element;
  switch (parentContainer.nodeType) {
    case DOCUMENT_NODE:
      parentElement = (parentContainer as any).body;
      break;
    default: {
      if (parentContainer.nodeName === 'HTML') {
        parentElement = (parentContainer as any).ownerDocument.body;
      } else {
        parentElement = parentContainer as any;
      }
    }
  }
  return getNextHydratable(parentElement.firstChild);
}

/** `getFirstHydratableChildWithinActivityInstance` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function getFirstHydratableChildWithinActivityInstance(
  parentInstance: ActivityInstance,
): null | HydratableInstance {
  return getNextHydratable(parentInstance.nextSibling);
}

/** `getFirstHydratableChildWithinSuspenseInstance` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function getFirstHydratableChildWithinSuspenseInstance(
  parentInstance: SuspenseInstance,
): null | HydratableInstance {
  return getNextHydratable(parentInstance.nextSibling);
}

//如果在 DOM 树中可能存在多个作用域单例，我们需要将其建模为一个堆栈，但由于你只能有一个 <head>，并且 head 是 DOM 中唯一作为作用域的单例，我们可以仅通过跟踪单个值来解决这个问题。
let previousHydratableOnEnteringScopedSingleton: null | HydratableInstance =
  null;

/** `getFirstHydratableChildWithinSingleton` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function getFirstHydratableChildWithinSingleton(
  type: string,
  singletonInstance: Instance,
  currentHydratableInstance: null | HydratableInstance,
): null | HydratableInstance {
  if (isSingletonScope(type)) {
    previousHydratableOnEnteringScopedSingleton = currentHydratableInstance;
    return getNextHydratable(singletonInstance.firstChild);
  } else {
    return currentHydratableInstance;
  }
}

/** `getNextHydratableSiblingAfterSingleton` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function getNextHydratableSiblingAfterSingleton(
  type: string,
  currentHydratableInstance: null | HydratableInstance,
): null | HydratableInstance {
  if (isSingletonScope(type)) {
    const previousHydratableInstance =
      previousHydratableOnEnteringScopedSingleton;
    previousHydratableOnEnteringScopedSingleton = null;
    return previousHydratableInstance;
  } else {
    return currentHydratableInstance;
  }
}

/** `describeHydratableInstanceForDevWarnings` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function describeHydratableInstanceForDevWarnings(
  instance: HydratableInstance,
): string | {
  /** 反向构造的宿主标签名，供 hydration diff 展示。 */
  type: string,
  /** 从现有 DOM 提取的只读 props 快照。 */
  props: $ReadOnly<Props>
} {
  //从可水化实例反向工程一个伪 React 元素
  if (instance.nodeType === ELEMENT_NODE) {
    //反向工程一组可以打印开发警告的属性
    return {
      type: instance.nodeName.toLowerCase(),
      props: getPropsFromElement(instance as any),
    };
  } else if (instance.nodeType === COMMENT_NODE) {
    if (instance.data === ACTIVITY_START_DATA) {
      return {
        type: 'Activity',
        props: {},
      };
    }
    return {
      type: 'Suspense',
      props: {},
    };
  } else {
    return instance.nodeValue;
  }
}

/** `validateHydratableInstance` 验证宿主不变量并构造开发期诊断，不改变生产语义；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function validateHydratableInstance(
  type: string,
  props: Props,
  hostContext: HostContext,
): boolean {
  if (__DEV__) {
    //待办：在验证时考虑命名空间。
    const hostContextDev: HostContextDev = hostContext as any;
    return validateDOMNesting(type, hostContextDev.ancestorInfo);
  }
  return true;
}

/** `hydrateInstance` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function hydrateInstance(
  instance: Instance,
  type: string,
  props: Props,
  hostContext: HostContext,
  internalInstanceHandle: Object,
): boolean {
  precacheFiberNode(internalInstanceHandle, instance);
  //待办：可能将此延迟到提交阶段，在所有事件都被附加时处理。
  updateFiberProps(instance, props);

  return hydrateProperties(instance, type, props, hostContext);
}

//返回服务器上不同属性的映射。
/** `diffHydratedPropsForDevWarnings` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function diffHydratedPropsForDevWarnings(
  instance: Instance,
  type: string,
  props: Props,
  hostContext: HostContext,
): null | $ReadOnly<Props> {
  return diffHydratedProperties(instance, type, props, hostContext);
}

/** `validateHydratableTextInstance` 验证宿主不变量并构造开发期诊断，不改变生产语义；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function validateHydratableTextInstance(
  text: string,
  hostContext: HostContext,
): boolean {
  if (__DEV__) {
    const hostContextDev = hostContext as any as HostContextDev;
    const ancestor = hostContextDev.ancestorInfo.current;
    if (ancestor != null) {
      return validateTextNesting(
        text,
        ancestor.tag,
        hostContextDev.ancestorInfo.implicitRootScope,
      );
    }
  }
  return true;
}

/** `hydrateTextInstance` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function hydrateTextInstance(
  textInstance: TextInstance,
  text: string,
  internalInstanceHandle: Object,
  parentInstanceProps: null | Props,
): boolean {
  precacheFiberNode(internalInstanceHandle, textInstance);

  return hydrateText(textInstance, text, parentInstanceProps);
}

//如果服务器文本与客户端不同，则返回服务器文本。
/** `diffHydratedTextForDevWarnings` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function diffHydratedTextForDevWarnings(
  textInstance: TextInstance,
  text: string,
  parentProps: null | Props,
): null | string {
  if (
    parentProps === null ||
    parentProps[SUPPRESS_HYDRATION_WARNING] !== true
  ) {
    return diffHydratedText(textInstance, text);
  }
  return null;
}

/** `hydrateActivityInstance` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function hydrateActivityInstance(
  activityInstance: ActivityInstance,
  internalInstanceHandle: Object,
) {
  precacheFiberNode(internalInstanceHandle, activityInstance);
}

/** `hydrateSuspenseInstance` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function hydrateSuspenseInstance(
  suspenseInstance: SuspenseInstance,
  internalInstanceHandle: Object,
) {
  precacheFiberNode(internalInstanceHandle, suspenseInstance);
}

/** `getNextHydratableInstanceAfterHydrationBoundary` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hydration 匹配、重试、差异诊断与边界推进。 */
function getNextHydratableInstanceAfterHydrationBoundary(
  hydrationInstance: SuspenseInstance | ActivityInstance,
): null | HydratableInstance {
  let node = hydrationInstance.nextSibling;
  //跳过此 suspense 边界内的所有节点。可能会有嵌套节点，所以我们需要跟踪当前的深度，并且只有在回到最顶部时才退出。
  let depth = 0;
  while (node) {
    if (node.nodeType === COMMENT_NODE) {
      const data = (node as any).data as string;
      if (data === SUSPENSE_END_DATA || data === ACTIVITY_END_DATA) {
        if (depth === 0) {
          return getNextHydratableSibling(node as any);
        } else {
          depth--;
        }
      } else if (
        data === SUSPENSE_START_DATA ||
        data === SUSPENSE_FALLBACK_START_DATA ||
        data === SUSPENSE_PENDING_START_DATA ||
        data === SUSPENSE_QUEUED_START_DATA ||
        data === ACTIVITY_START_DATA
      ) {
        depth++;
      }
    }
    node = node.nextSibling;
  }
  //待办：警告，我们未找到结束注释边界。
  return null;
}

/** `getNextHydratableInstanceAfterActivityInstance` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function getNextHydratableInstanceAfterActivityInstance(
  activityInstance: ActivityInstance,
): null | HydratableInstance {
  return getNextHydratableInstanceAfterHydrationBoundary(activityInstance);
}

/** `getNextHydratableInstanceAfterSuspenseInstance` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function getNextHydratableInstanceAfterSuspenseInstance(
  suspenseInstance: SuspenseInstance,
): null | HydratableInstance {
  return getNextHydratableInstanceAfterHydrationBoundary(suspenseInstance);
}

//如果该节点是 SuspenseInstance 的直接子节点，则返回 SuspenseInstance。即，如果其前一个兄弟节点是带有 SUSPENSE_x_START_DATA 的注释。否则，返回 null。
/** `getParentHydrationBoundary` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function getParentHydrationBoundary(
  targetInstance: Node,
): null | SuspenseInstance | ActivityInstance {
  let node = targetInstance.previousSibling;
  //跳过此 suspense 边界内的所有节点。可能会有嵌套节点，所以我们需要跟踪当前的深度，并且只有在返回到最顶部时才退出。
  let depth = 0;
  while (node) {
    if (node.nodeType === COMMENT_NODE) {
      const data = (node as any).data as string;
      if (
        data === SUSPENSE_START_DATA ||
        data === SUSPENSE_FALLBACK_START_DATA ||
        data === SUSPENSE_PENDING_START_DATA ||
        data === SUSPENSE_QUEUED_START_DATA ||
        data === ACTIVITY_START_DATA
      ) {
        if (depth === 0) {
          return node as any as SuspenseInstance | ActivityInstance;
        } else {
          depth--;
        }
      } else if (data === SUSPENSE_END_DATA || data === ACTIVITY_END_DATA) {
        depth++;
      }
    }
    node = node.previousSibling;
  }
  return null;
}

/** `commitHydratedContainer` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function commitHydratedContainer(container: Container): void {
  //如果此处的任何事件重放被阻止，请重试。
  retryIfBlockedOn(container);
}

/** `commitHydratedActivityInstance` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function commitHydratedActivityInstance(
  activityInstance: ActivityInstance,
): void {
  //如果此处的任何事件重放被阻止，请重试。
  retryIfBlockedOn(activityInstance);
}

/** `commitHydratedSuspenseInstance` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function commitHydratedSuspenseInstance(
  suspenseInstance: SuspenseInstance,
): void {
  //如果此处的任何事件重放被阻止，请重试。
  retryIfBlockedOn(suspenseInstance);
}

/** `flushHydrationEvents` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function flushHydrationEvents(): void {
  if (enableHydrationChangeEvent) {
    flushEventReplaying();
  }
}

/** `shouldDeleteUnhydratedTailInstances` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function shouldDeleteUnhydratedTailInstances(
  parentType: string,
): boolean {
  return parentType !== 'form' && parentType !== 'button';
}

// -------------------
//测试选择器
// -------------------

/** `supportsTestSelectors` 声明 renderer 是否支持对应 Host Config 能力；reconciler 据此选择合法分支。 */
export const supportsTestSelectors = true;

/** `findFiberRoot` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function findFiberRoot(node: Instance): null | FiberRoot {
  const stack = [node];
  let index = 0;
  while (index < stack.length) {
    const current = stack[index++];
    if (isContainerMarkedAsRoot(current)) {
      return getInstanceFromNodeDOMTree(current) as any as FiberRoot;
    }
    stack.push(...current.children);
  }
  return null;
}

/** `getBoundingRect` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于测试选择器与可观察 DOM 状态查询。 */
export function getBoundingRect(node: Instance): BoundingRect {
  const rect = node.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/** `matchAccessibilityRole` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于测试选择器与可观察 DOM 状态查询。 */
export function matchAccessibilityRole(node: Instance, role: string): boolean {
  if (hasRole(node, role)) {
    return true;
  }

  return false;
}

/** `getTextContent` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于测试选择器与可观察 DOM 状态查询。 */
export function getTextContent(fiber: Fiber): string | null {
  switch (fiber.tag) {
    case HostHoistable:
    case HostSingleton:
    case HostComponent:
      let textContent = '';
      const childNodes = fiber.stateNode.childNodes;
      for (let i = 0; i < childNodes.length; i++) {
        const childNode = childNodes[i];
        if (childNode.nodeType === Node.TEXT_NODE) {
          textContent += childNode.textContent;
        }
      }
      return textContent;
    case HostText:
      return fiber.stateNode.textContent;
  }

  return null;
}

/** `isHiddenSubtree` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于测试选择器与可观察 DOM 状态查询。 */
export function isHiddenSubtree(fiber: Fiber): boolean {
  return fiber.tag === HostComponent && fiber.memoizedProps.hidden === true;
}

/** `setFocusIfFocusable` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于测试选择器、singleton 与文档级宿主节点管理。 */
export function setFocusIfFocusable(
  node: Instance,
  focusOptions?: FocusOptions,
): boolean {
  //确定一个元素是否可聚焦的逻辑有点复杂，而且由于我们无论如何都想实际更改焦点——我们可以直接跳过它。相反，我们只需监听“focus”事件来验证焦点是否已设置。
  //
  //我们可以在聚焦后将该节点与 document.activeElement 进行比较，但这无法处理应用程序代码自动模糊管理焦点的情况。
  const element = node as any as HTMLElement;

  //如果这个元素已经是活动元素，它是可聚焦的并且已经获得焦点。对它调用 .focus() 将不会有任何操作（不会触发焦点事件），所以我们在这里短路处理。
  if (element.ownerDocument.activeElement === element) {
    return true;
  }

  let didFocus = false;
  /** `setFocusIfFocusable.handleFocus` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于测试选择器、singleton 与文档级宿主节点管理。 */
  const handleFocus = () => {
    didFocus = true;
  };

  try {
    //在捕获阶段监听文档，以便即使焦点落在与我们调用 .focus() 的元素不同的元素上，也能检测到焦点。这种情况发生在 <label> 元素（焦点委托给相关输入）以及具有 delegatesFocus 的 shadow hosts 上。
    element.ownerDocument.addEventListener('focus', handleFocus, true);
    // $FlowFixMe[method-unbinding]
    (element.focus || HTMLElement.prototype.focus).call(element, focusOptions);
  } finally {
    element.ownerDocument.removeEventListener('focus', handleFocus, true);
  }

  return didFocus;
}

/** `RectRatio` 定义测试选择器、singleton 与文档级宿主节点管理的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type RectRatio = {
  /** `RectRatio.ratio` 表示选择器或可见性计算使用的几何快照；仅在测试选择器、singleton 与文档级宿主节点管理生命周期内有效。 */
  ratio: number,
  /** `RectRatio.rect` 表示选择器或可见性计算使用的几何快照；仅在测试选择器、singleton 与文档级宿主节点管理生命周期内有效。 */
  rect: BoundingRect,
};

/** `setupIntersectionObserver` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于测试选择器与可观察 DOM 状态查询。 */
export function setupIntersectionObserver(
  targets: Array<Instance>,
  callback: ObserveVisibleRectsCallback,
  options?: IntersectionObserverOptions,
): {
  /** `setupIntersectionObserver.disconnect` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于测试选择器与可观察 DOM 状态查询。 */
  disconnect: () => void,
  /** `setupIntersectionObserver.observe` 登记或挂接目标，维持宿主顺序与资源引用计数；属于测试选择器与可观察 DOM 状态查询。 */
  observe: (instance: Instance) => void,
  /** `setupIntersectionObserver.unobserve` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于测试选择器与可观察 DOM 状态查询。 */
  unobserve: (instance: Instance) => void,
} {
  const rectRatioCache: Map<Instance, RectRatio> = new Map();
  targets.forEach(target => {
    rectRatioCache.set(target, {
      rect: getBoundingRect(target),
      ratio: 0,
    });
  });

  /** `setupIntersectionObserver.handleIntersection` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于测试选择器与可观察 DOM 状态查询。 */
  const handleIntersection = (entries: Array<IntersectionObserverEntry>) => {
    entries.forEach(entry => {
      const {boundingClientRect, intersectionRatio, target} = entry;
      rectRatioCache.set(target, {
        rect: {
          x: boundingClientRect.left,
          y: boundingClientRect.top,
          width: boundingClientRect.width,
          height: boundingClientRect.height,
        },
        ratio: intersectionRatio,
      });
    });

    callback(Array.from(rectRatioCache.values()));
  };

  const observer = new IntersectionObserver(handleIntersection, options);
  targets.forEach(target => {
    observer.observe(target as any);
  });

  return {
    /** `setupIntersectionObserver.disconnect` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于测试选择器与可观察 DOM 状态查询。 */
    disconnect: () => observer.disconnect(),
    /** `setupIntersectionObserver.observe` 登记或挂接目标，维持宿主顺序与资源引用计数；属于测试选择器与可观察 DOM 状态查询。 */
    observe: target => {
      rectRatioCache.set(target, {
        rect: getBoundingRect(target),
        ratio: 0,
      });
      observer.observe(target as any);
    },
    /** `setupIntersectionObserver.unobserve` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于测试选择器与可观察 DOM 状态查询。 */
    unobserve: target => {
      rectRatioCache.delete(target);
      observer.unobserve(target as any);
    },
  };
}

/** `requestPostPaintCallback` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于测试选择器与可观察 DOM 状态查询。 */
export function requestPostPaintCallback(callback: (time: number) => void) {
  localRequestAnimationFrame(() => {
    localRequestAnimationFrame(time => callback(time));
  });
}

// -------------------
//单例
// -------------------

/** `supportsSingletons` 声明 renderer 是否支持对应 Host Config 能力；reconciler 据此选择合法分支。 */
export const supportsSingletons = true;

/** `isHostSingletonType` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于document/head/body singleton 的获取、占用与释放。 */
export function isHostSingletonType(type: string): boolean {
  return type === 'html' || type === 'head' || type === 'body';
}

/** `resolveSingletonInstance` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于document/head/body singleton 的获取、占用与释放。 */
export function resolveSingletonInstance(
  type: string,
  props: Props,
  rootContainerInstance: Container,
  hostContext: HostContext,
  validateDOMNestingDev: boolean,
): Instance {
  if (__DEV__) {
    const hostContextDev = hostContext as any as HostContextDev;
    if (validateDOMNestingDev) {
      validateDOMNesting(type, hostContextDev.ancestorInfo);
    }
  }
  const ownerDocument = getOwnerDocumentFromRootContainer(
    rootContainerInstance,
  );
  switch (type) {
    case 'html': {
      const documentElement = ownerDocument.documentElement;
      if (!documentElement) {
        throw new Error(
          'React expected an <html> element (document.documentElement) to exist in the Document but one was' +
            ' not found. React never removes the documentElement for any Document it renders into so' +
            ' the cause is likely in some other script running on this page.',
        );
      }
      return documentElement;
    }
    case 'head': {
      const head = ownerDocument.head;
      if (!head) {
        throw new Error(
          'React expected a <head> element (document.head) to exist in the Document but one was' +
            ' not found. React never removes the head for any Document it renders into so' +
            ' the cause is likely in some other script running on this page.',
        );
      }
      return head;
    }
    case 'body': {
      const body = ownerDocument.body;
      if (!body) {
        throw new Error(
          'React expected a <body> element (document.body) to exist in the Document but one was' +
            ' not found. React never removes the body for any Document it renders into so' +
            ' the cause is likely in some other script running on this page.',
        );
      }
      return body;
    }
    default: {
      throw new Error(
        'resolveSingletonInstance was called with an element type that is not supported. This is a bug in React.',
      );
    }
  }
}

/** `acquireSingletonInstance` 登记或挂接目标，维持宿主顺序与资源引用计数；属于document/head/body singleton 的获取、占用与释放。 */
export function acquireSingletonInstance(
  type: string,
  props: Props,
  instance: Instance,
  internalInstanceHandle: Object,
): void {
  if (__DEV__) {
    if (
      //如果此实例是容器，那么作为单例获取它是无效的，然而 DOM 嵌套验证已经会发出警告，并且下面的消息在语义上与您需要进行的实际修正不一致，因此在这种情况下我们省略该警告
      !isContainerMarkedAsRoot(instance) &&
      //如果此实例不是根实例，但当前由不同的 HostSingleton 实例拥有，那么我们需要警告你同时渲染多个单例。
      getInstanceFromNodeDOMTree(instance)
    ) {
      const tagName = instance.tagName.toLowerCase();
      console.error(
        'You are mounting a new %s component when a previous one has not first unmounted. It is an' +
          ' error to render more than one %s component at a time and attributes and children of these' +
          ' components will likely fail in unpredictable ways. Please only render a single instance of' +
          ' <%s> and if you need to mount a new one, ensure any previous ones have unmounted first.',
        tagName,
        tagName,
        tagName,
      );
    }
    switch (type) {
      case 'html':
      case 'head':
      case 'body': {
        break;
      }
      default: {
        console.error(
          'acquireSingletonInstance was called with an element type that is not supported. This is a bug in React.',
        );
      }
    }
  }

  const attributes = instance.attributes;
  while (attributes.length) {
    instance.removeAttributeNode(attributes[0]);
  }

  setInitialProperties(instance, type, props);
  precacheFiberNode(internalInstanceHandle, instance);
  updateFiberProps(instance, props);
}

/** `releaseSingletonInstance` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于document/head/body singleton 的获取、占用与释放。 */
export function releaseSingletonInstance(
  instance: Instance,
  type: SingletonType,
  props: Props,
): void {
  //移除此 Fiber 所拥有的属性和基于属性的状态。
  clearSingletonProperties(instance, type, props);

  //当它们的下一个值为 null 时，updateProperties 不会清除这些属性。通常这是通过替换/移除宿主实例来处理的，但单例不能被移除。TODO：当 dangerouslySetInnerHTML 变为 undefined 时，HostSingleton 更新目前不会调度 ContentReset，因此普通更新可能会保留之前的 HTML。这仅处理释放路径。
  if (props.dangerouslySetInnerHTML != null) {
    instance.textContent = '';
  }
  clearClickListener(instance as any as HTMLElement);

  //只移除此 Fiber 的 props 所表示的状态。在 React 拥有该单例期间以命令式添加的属性必须保留。
  detachDeletedInstance(instance);
}

/** `clearSingletonPreambleContribution` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于document/head/body singleton 的获取、占用与释放。 */
function clearSingletonPreambleContribution(instance: Instance): void {
  //当清理包含 Fizz 前导贡献标记的脱水边界时，此路径才会被使用。该标记告诉我们边界贡献给了哪个单例，但它不包括所贡献的属性，并且没有 HostSingleton Fiber 来提供它们。因此，我们无法区分哪些属性来自 React，哪些是由脚本或第三方以命令式方式添加的。目前，清除每个属性被视为一个可接受的边缘情况。TODO：在标记中包含所贡献的属性，以便此清理操作只删除边界拥有的属性。
  const attributes = instance.attributes;
  while (attributes.length) {
    instance.removeAttributeNode(attributes[0]);
  }
  detachDeletedInstance(instance);
}

// -------------------
//资源
// -------------------

/** `supportsResources` 声明 renderer 是否支持对应 Host Config 能力；reconciler 据此选择合法分支。 */
export const supportsResources = true;

/** `HoistableTagType` 定义hoistable resource 的去重、预加载、获取、挂载与释放的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type HoistableTagType = 'link' | 'meta' | 'title';
/** `TResource` 定义hoistable resource 的去重、预加载、获取、挂载与释放的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type TResource<
  T: 'stylesheet' | 'style' | 'script' | 'void',
  S: null | {...},
> = {
  /** `TResource.type` 表示宿主标签、资源或事件类别；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  type: T,
  /** `TResource.instance` 表示DOM、资源或边界实例身份；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  instance: null | Instance,
  /** `TResource.count` 表示资源加载、引用计数或解除挂起状态；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  count: number,
  /** `TResource.state` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  state: S,
};
/** `StylesheetResource` 定义hoistable resource 的去重、预加载、获取、挂载与释放的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type StylesheetResource = TResource<'stylesheet', StylesheetState>;
/** `StyleTagResource` 定义hoistable resource 的去重、预加载、获取、挂载与释放的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type StyleTagResource = TResource<'style', null>;
/** `StyleResource` 定义hoistable resource 的去重、预加载、获取、挂载与释放的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type StyleResource = StyleTagResource | StylesheetResource;
/** `ScriptResource` 定义hoistable resource 的去重、预加载、获取、挂载与释放的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type ScriptResource = TResource<'script', null>;
/** `VoidResource` 定义hoistable resource 的去重、预加载、获取、挂载与释放的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type VoidResource = TResource<'void', null>;
/** `Resource` 定义hoistable resource 的去重、预加载、获取、挂载与释放的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type Resource = StyleResource | ScriptResource | VoidResource;

/** `LoadingState` 定义hoistable resource 的去重、预加载、获取、挂载与释放的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type LoadingState = number;
/** `NotLoaded` 保存测试选择器、singleton 与文档级宿主节点管理所需的配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
const NotLoaded = /*       */ 0b000;
/** `Loaded` 保存测试选择器、singleton 与文档级宿主节点管理所需的配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
const Loaded = /*          */ 0b001;
/** `Errored` 保存测试选择器、singleton 与文档级宿主节点管理所需的配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
const Errored = /*         */ 0b010;
/** `Settled` 保存测试选择器、singleton 与文档级宿主节点管理所需的配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
const Settled = /*         */ 0b011;
/** `Inserted` 保存测试选择器、singleton 与文档级宿主节点管理所需的配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
const Inserted = /*        */ 0b100;

/** `StylesheetState` 定义hoistable resource 的去重、预加载、获取、挂载与释放的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type StylesheetState = {
  /** `StylesheetState.loading` 表示资源加载、引用计数或解除挂起状态；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  loading: LoadingState,
  /** `StylesheetState.preload` 表示资源加载、引用计数或解除挂起状态；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  preload: null | HTMLLinkElement,
};

/** `StyleTagProps` 定义hoistable resource 的去重、预加载、获取、挂载与释放的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type StyleTagProps = {
  /** `StyleTagProps.data-href` 表示资源去重和插入排序使用的键；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  'data-href': string,
  /** `StyleTagProps.data-precedence` 表示资源去重和插入排序使用的键；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  'data-precedence': string,
  /** `StyleTagProps.string` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  [string]: mixed,
};
/** `StylesheetProps` 定义hoistable resource 的去重、预加载、获取、挂载与释放的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type StylesheetProps = {
  /** `StylesheetProps.rel` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  rel: 'stylesheet',
  /** `StylesheetProps.href` 表示资源去重和插入排序使用的键；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  href: string,
  /** `StylesheetProps.data-precedence` 表示资源去重和插入排序使用的键；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  'data-precedence': string,
  /** `StylesheetProps.string` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  [string]: mixed,
};

/** `ScriptProps` 定义hoistable resource 的去重、预加载、获取、挂载与释放的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type ScriptProps = {
  /** `ScriptProps.src` 表示资源去重和插入排序使用的键；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  src: string,
  /** `ScriptProps.async` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  async: true,
  /** `ScriptProps.string` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  [string]: mixed,
};

/** `PreloadProps` 定义hoistable resource 的去重、预加载、获取、挂载与释放的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type PreloadProps = {
  /** `PreloadProps.rel` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  rel: 'preload',
  /** `PreloadProps.href` 表示资源去重和插入排序使用的键；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  href: ?string,
  /** `PreloadProps.string` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  [string]: mixed,
};
/** `PreloadModuleProps` 定义hoistable resource 的去重、预加载、获取、挂载与释放的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type PreloadModuleProps = {
  /** `PreloadModuleProps.rel` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  rel: 'modulepreload',
  /** `PreloadModuleProps.href` 表示资源去重和插入排序使用的键；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  href: string,
  /** `PreloadModuleProps.string` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  [string]: mixed,
};

/** `RootResources` 定义hoistable resource 的去重、预加载、获取、挂载与释放的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type RootResources = {
  /** `RootResources.hoistableStyles` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  hoistableStyles: Map<string, StyleResource>,
  /** `RootResources.hoistableScripts` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  hoistableScripts: Map<string, ScriptResource>,
};

/** `prepareToCommitHoistables` 建立阶段边界，确保后续提交看到已准备的 DOM 状态；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
export function prepareToCommitHoistables() {
  tagCaches = null;
}

//全球资源集合
const preloadPropsMap: Map<string, PreloadProps | PreloadModuleProps> =
  new Map();
/** `preconnectsSet` 保存hoistable resource 的去重、预加载、获取、挂载与释放所需的配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
const preconnectsSet: Set<string> = new Set();

/** `HoistableRoot` 定义hoistable resource 的去重、预加载、获取、挂载与释放的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type HoistableRoot = Document | ShadowRoot;

//IE 和旧版本 jsdom 缺少 getRootNode
/** `getHoistableRoot` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
export function getHoistableRoot(container: Container): HoistableRoot {
  // $FlowFixMe[method-unbinding]
  if (typeof container.getRootNode === 'function') {
    const rootNode = container.getRootNode();
    if (rootNode.nodeType === DOCUMENT_NODE) {
      return rootNode as any as Document;
    }
    if (rootNode.nodeType === DOCUMENT_FRAGMENT_NODE) {
      return rootNode as any as ShadowRoot;
    }
  }
  return container.nodeType === DOCUMENT_NODE
    ? (container as any as Document)
    : container.ownerDocument;
}

/** `getCurrentResourceRoot` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function getCurrentResourceRoot(): null | HoistableRoot {
  const currentContainer = getCurrentRootHostContainer();
  return currentContainer ? getHoistableRoot(currentContainer) : null;
}

/** `getDocumentFromRoot` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function getDocumentFromRoot(root: HoistableRoot): Document {
  return root.ownerDocument || root;
}

/** `previousDispatcher` 保存hoistable resource 的去重、预加载、获取、挂载与释放所需的配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
const previousDispatcher =
  ReactDOMSharedInternals.d; /*ReactDOM当前调度器*/
ReactDOMSharedInternals.d /*ReactDOM当前调度器*/ = {
  f /*同步刷新工作*/: disableLegacyMode
    ? flushSyncWork
    : previousDispatcher.f /*同步刷新工作*/,
  r: requestFormReset,
  D /*预取DNS*/: prefetchDNS,
  C /*预连接*/: preconnect,
  L /*预加载*/: preload,
  m /*预加载模块*/: preloadModule,
  X /*预初始化脚本*/: preinitScript,
  S /*预初始化样式*/: preinitStyle,
  M /*预初始化模块脚本*/: preinitModuleScript,
};

/** `flushSyncWork` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function flushSyncWork() {
  if (disableLegacyMode) {
    const previousWasRendering = previousDispatcher.f(); /*同步刷新工作*/
    const wasRendering = flushSyncWorkOnAllRoots();
    //由于多个调度器可以在单次 flushSync 调用中刷新同步工作，如果其中任何一个正在渲染，我们需要返回 true。
    return previousWasRendering || wasRendering;
  } else {
    throw new Error(
      'flushSyncWork should not be called from builds that support legacy mode. This is a bug in React.',
    );
  }
}

/** `requestFormReset` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function requestFormReset(form: HTMLFormElement) {
  const formInst = getInstanceFromNodeDOMTree(form);
  if (
    formInst !== null &&
    formInst.tag === HostComponent &&
    formInst.type === 'form'
  ) {
    requestFormResetOnFiber(formInst);
  } else {
    //这个表单要么没有被这个 React 渲染器渲染（或者它的类型无效）。请尝试下一个。
    //
    //序列中的最后一个实现将抛出错误。
    previousDispatcher.r(/*请求表单重置*/ form);
  }
}

//我们预计这将被内联。这是一个函数，主要用于传达我们如何解析 ReactDOM.pre*() 方法的 HoistableRoot 的特殊性质。因为我们支持在 render 之外调用这些方法，所以无法确定哪个 Document 或 ShadowRoot 是“作用域内的”，因此我们必须回退到某种通用的方法。目前我们只是引用全局的 document。这一点值得注意，因为在 ReactDOM 的其他地方，我们实际上不引用全局的 document 或 window，因为我们可能在 iframe 内进行渲染。
const globalDocument = typeof document === 'undefined' ? null : document;
/** `getGlobalDocument` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function getGlobalDocument(): ?Document {
  return globalDocument;
}

/** `preconnectAs` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function preconnectAs(
  rel: 'preconnect' | 'dns-prefetch',
  href: string,
  crossOrigin: ?CrossOriginEnum,
) {
  const ownerDocument = getGlobalDocument();
  if (ownerDocument && typeof href === 'string' && href) {
    const limitedEscapedHref =
      escapeSelectorAttributeValueInsideDoubleQuotes(href);
    let key = `link[rel="${rel}"][href="${limitedEscapedHref}"]`;
    if (typeof crossOrigin === 'string') {
      key += `[crossorigin="${crossOrigin}"]`;
    }
    if (!preconnectsSet.has(key)) {
      preconnectsSet.add(key);

      const preconnectProps = {rel, crossOrigin, href};
      if (null === ownerDocument.querySelector(key)) {
        const instance = ownerDocument.createElement('link');
        setInitialProperties(instance, 'link', preconnectProps);
        markNodeAsHoistable(instance);
        (ownerDocument.head as any).appendChild(instance);
      }
    }
  }
}

/** `prefetchDNS` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function prefetchDNS(href: string) {
  previousDispatcher.D(/*预取DNS*/ href);
  preconnectAs('dns-prefetch', href, null);
}

/** `preconnect` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function preconnect(href: string, crossOrigin?: ?CrossOriginEnum) {
  previousDispatcher.C(/*预连接*/ href, crossOrigin);
  preconnectAs('preconnect', href, crossOrigin);
}

/** `preload` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function preload(href: string, as: string, options?: ?PreloadImplOptions) {
  previousDispatcher.L(/*预加载*/ href, as, options);
  const ownerDocument = getGlobalDocument();
  if (ownerDocument && href && as) {
    let preloadSelector = `link[rel="preload"][as="${escapeSelectorAttributeValueInsideDoubleQuotes(
      as,
    )}"]`;
    if (as === 'image') {
      if (options && options.imageSrcSet) {
        preloadSelector += `[imagesrcset="${escapeSelectorAttributeValueInsideDoubleQuotes(
          options.imageSrcSet,
        )}"]`;
        if (typeof options.imageSizes === 'string') {
          preloadSelector += `[imagesizes="${escapeSelectorAttributeValueInsideDoubleQuotes(
            options.imageSizes,
          )}"]`;
        }
      } else {
        preloadSelector += `[href="${escapeSelectorAttributeValueInsideDoubleQuotes(
          href,
        )}"]`;
      }
    } else {
      preloadSelector += `[href="${escapeSelectorAttributeValueInsideDoubleQuotes(
        href,
      )}"]`;
    }
    //有些预加载根据它们的选择器进行键控。当预加载用于任意类型时，就会发生这种情况。其他预加载根据它们表示的资源键进行键控。在这里，我们确定使用哪个键来判断是否已经有预加载。
    let key = preloadSelector;
    switch (as) {
      case 'style':
        key = getStyleKey(href);
        break;
      case 'script':
        key = getScriptKey(href);
        break;
    }
    if (!preloadPropsMap.has(key)) {
      const preloadProps = Object.assign(
        {
          rel: 'preload',
          //Safari 中存在一个 bug，即在预加载链接上不尊重 imageSrcSet，因此如果我们有 imageSrcSet，这里会省略 href，因为 Safari 会加载错误的图像。这会影响不支持 imageSrcSet 的较老浏览器，使它们的预加载无法正常工作，但这部分用户正在快速减少，数量已经很少，所以我们接受这个权衡。
          href:
            as === 'image' && options && options.imageSrcSet ? undefined : href,
          as,
        } as PreloadProps,
        options,
      );
      preloadPropsMap.set(key, preloadProps);

      if (null === ownerDocument.querySelector(preloadSelector)) {
        if (
          as === 'style' &&
          ownerDocument.querySelector(getStylesheetSelectorFromKey(key))
        ) {
          //我们已经有了这个键的样式表。我们不需要预加载它。
          return;
        } else if (
          as === 'script' &&
          ownerDocument.querySelector(getScriptSelectorFromKey(key))
        ) {
          //我们已经有了这个键的脚本。我们不需要预加载它。
          return;
        }
        const instance = ownerDocument.createElement('link');
        setInitialProperties(instance, 'link', preloadProps);
        if (as === 'style') {
          //在预加载链接上存储一个加载状态。一旦完成，它会自行清理
          markNodeAsPendingLoad(instance);
          instance.onload = instance.onerror = () => {
            clearPendingLoadOnNode(instance);
          };
        }
        markNodeAsHoistable(instance);
        (ownerDocument.head as any).appendChild(instance);
      }
    }
  }
}

/** `preloadModule` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function preloadModule(href: string, options?: ?PreloadModuleImplOptions) {
  previousDispatcher.m(/*预加载模块*/ href, options);
  const ownerDocument = getGlobalDocument();
  if (ownerDocument && href) {
    const as =
      options && typeof options.as === 'string' ? options.as : 'script';
    const preloadSelector = `link[rel="modulepreload"][as="${escapeSelectorAttributeValueInsideDoubleQuotes(
      as,
    )}"][href="${escapeSelectorAttributeValueInsideDoubleQuotes(href)}"]`;
    //有些预加载根据它们的选择器进行键控。当预加载用于任意类型时，就会发生这种情况。其他预加载根据它们所表示的资源键进行键控。在这里，我们确定使用哪个键来判断我们是否已经有预加载。
    let key = preloadSelector;
    switch (as) {
      case 'audioworklet':
      case 'paintworklet':
      case 'serviceworker':
      case 'sharedworker':
      case 'worker':
      case 'script': {
        key = getScriptKey(href);
        break;
      }
    }

    if (!preloadPropsMap.has(key)) {
      const props: PreloadModuleProps = Object.assign(
        {
          rel: 'modulepreload',
          href,
        } as PreloadModuleProps,
        options,
      );
      preloadPropsMap.set(key, props);

      if (null === ownerDocument.querySelector(preloadSelector)) {
        switch (as) {
          case 'audioworklet':
          case 'paintworklet':
          case 'serviceworker':
          case 'sharedworker':
          case 'worker':
          case 'script': {
            if (ownerDocument.querySelector(getScriptSelectorFromKey(key))) {
              return;
            }
          }
        }
        const instance = ownerDocument.createElement('link');
        setInitialProperties(instance, 'link', props);
        markNodeAsHoistable(instance);
        (ownerDocument.head as any).appendChild(instance);
      }
    }
  }
}

/** `preinitStyle` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function preinitStyle(
  href: string,
  precedence: ?string,
  options?: ?PreinitStyleOptions,
) {
  previousDispatcher.S(/*预初始化样式*/ href, precedence, options);

  const ownerDocument = getGlobalDocument();
  if (ownerDocument && href) {
    const styles = getResourcesFromRoot(ownerDocument).hoistableStyles;

    const key = getStyleKey(href);
    precedence = precedence || 'default';

    //检查此资源是否已存在
    let resource = styles.get(key);
    if (resource) {
      //我们可以提前返回。资源已经存在，没有更多事情需要做
      return;
    }

    const state = {
      loading: NotLoaded,
      preload: null,
    };

    //尝试从 DOM 对实例进行水合
    let instance: null | Instance = ownerDocument.querySelector(
      getStylesheetSelectorFromKey(key),
    );
    if (instance) {
      state.loading = Loaded | Inserted;
    } else {
      //构建一个新实例并插入它
      const stylesheetProps = Object.assign(
        {
          rel: 'stylesheet',
          href,
          'data-precedence': precedence,
        } as StylesheetProps,
        options,
      );
      const preloadProps = preloadPropsMap.get(key);
      if (preloadProps) {
        adoptPreloadPropsForStylesheet(stylesheetProps, preloadProps);
      }
      const link = (instance = ownerDocument.createElement('link'));
      markNodeAsHoistable(link);
      setInitialProperties(link, 'link', stylesheetProps);

      (link as any)._p = new Promise((resolve, reject) => {
        link.onload = resolve;
        link.onerror = reject;
      });
      link.addEventListener('load', () => {
        state.loading |= Loaded;
      });
      link.addEventListener('error', () => {
        state.loading |= Errored;
      });

      state.loading |= Inserted;
      insertStylesheet(instance, precedence, ownerDocument);
    }

    //构建资源并缓存它
    // $FlowFixMe[incompatible-type]
    resource = {
      type: 'stylesheet',
      instance,
      count: 1,
      state,
    };
    // $FlowFixMe[incompatible-type]
    styles.set(key, resource);
    return;
  }
}

/** `preinitScript` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function preinitScript(src: string, options?: ?PreinitScriptOptions) {
  previousDispatcher.X(/*预初始化脚本*/ src, options);

  const ownerDocument = getGlobalDocument();
  if (ownerDocument && src) {
    const scripts = getResourcesFromRoot(ownerDocument).hoistableScripts;

    const key = getScriptKey(src);

    //检查此资源是否已存在
    let resource = scripts.get(key);
    if (resource) {
      //我们可以提前返回。资源存在，没有其他需要做的事情
      return;
    }

    //尝试从 DOM 对实例进行水合
    let instance: null | Instance = ownerDocument.querySelector(
      getScriptSelectorFromKey(key),
    );
    if (!instance) {
      //构建一个新实例并插入它
      const scriptProps = Object.assign(
        {
          src,
          async: true,
        } as ScriptProps,
        options,
      );
      // 继承预加载阶段已经确定的部分 prop。
      const preloadProps = preloadPropsMap.get(key);
      if (preloadProps) {
        adoptPreloadPropsForScript(scriptProps, preloadProps);
      }
      instance = ownerDocument.createElement('script');
      markNodeAsHoistable(instance);
      setInitialProperties(instance, 'link', scriptProps);
      (ownerDocument.head as any).appendChild(instance);
    }

    //构建资源并缓存它
    resource = {
      type: 'script',
      instance,
      count: 1,
      state: null,
    };
    scripts.set(key, resource);
    return;
  }
}

/** `preinitModuleScript` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function preinitModuleScript(
  src: string,
  options?: ?PreinitModuleScriptOptions,
) {
  previousDispatcher.M(/*预初始化模块脚本*/ src, options);

  const ownerDocument = getGlobalDocument();
  if (ownerDocument && src) {
    const scripts = getResourcesFromRoot(ownerDocument).hoistableScripts;

    const key = getScriptKey(src);

    //检查此资源是否已存在
    let resource = scripts.get(key);
    if (resource) {
      //我们可以提前返回。资源存在，没有其他需要做的事情
      return;
    }

    //尝试从 DOM 对实例进行 hydrate
    let instance: null | Instance = ownerDocument.querySelector(
      getScriptSelectorFromKey(key),
    );
    if (!instance) {
      //构建一个新实例并插入它
      const scriptProps = Object.assign(
        {
          src,
          async: true,
          type: 'module',
        } as ScriptProps,
        options,
      );
      // 继承预加载阶段已经确定的部分 prop。
      const preloadProps = preloadPropsMap.get(key);
      if (preloadProps) {
        adoptPreloadPropsForScript(scriptProps, preloadProps);
      }
      instance = ownerDocument.createElement('script');
      markNodeAsHoistable(instance);
      setInitialProperties(instance, 'link', scriptProps);
      (ownerDocument.head as any).appendChild(instance);
    }

    //构建资源并缓存它
    resource = {
      type: 'script',
      instance,
      count: 1,
      state: null,
    };
    scripts.set(key, resource);
    return;
  }
}

/** `StyleTagQualifyingProps` 定义hoistable resource 的去重、预加载、获取、挂载与释放的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type StyleTagQualifyingProps = {
  /** `StyleTagQualifyingProps.href` 表示资源去重和插入排序使用的键；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  href: string,
  /** `StyleTagQualifyingProps.precedence` 表示资源去重和插入排序使用的键；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  precedence: string,
  /** `StyleTagQualifyingProps.string` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  [string]: mixed,
};

/** `StylesheetQualifyingProps` 定义hoistable resource 的去重、预加载、获取、挂载与释放的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type StylesheetQualifyingProps = {
  /** `StylesheetQualifyingProps.rel` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  rel: 'stylesheet',
  /** `StylesheetQualifyingProps.href` 表示资源去重和插入排序使用的键；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  href: string,
  /** `StylesheetQualifyingProps.precedence` 表示资源去重和插入排序使用的键；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  precedence: string,
  /** `StylesheetQualifyingProps.string` 表示所属 Host Config 契约跨阶段传递的受限状态；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  [string]: mixed,
};

//此函数在开始工作时被调用，我们应该始终设置一个 currentDocument
/** `getResource` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
export function getResource(
  type: string,
  currentProps: any,
  pendingProps: any,
  currentResource: null | Resource,
): null | Resource {
  const resourceRoot = getCurrentResourceRoot();
  if (!resourceRoot) {
    throw new Error(
      '"resourceRoot" was expected to exist. This is a bug in React.',
    );
  }
  switch (type) {
    case 'meta':
    case 'title': {
      return null;
    }
    case 'style': {
      if (
        typeof pendingProps.precedence === 'string' &&
        typeof pendingProps.href === 'string'
      ) {
        const key = getStyleKey(pendingProps.href);
        const styles = getResourcesFromRoot(resourceRoot).hoistableStyles;
        let resource = styles.get(key);
        if (!resource) {
          resource = {
            type: 'style',
            instance: null,
            count: 0,
            state: null,
          };
          styles.set(key, resource);
        }
        return resource;
      }
      return {
        type: 'void',
        instance: null,
        count: 0,
        state: null,
      };
    }
    case 'link': {
      if (
        pendingProps.rel === 'stylesheet' &&
        typeof pendingProps.href === 'string' &&
        typeof pendingProps.precedence === 'string'
      ) {
        const qualifiedProps: StylesheetQualifyingProps = pendingProps;
        const key = getStyleKey(qualifiedProps.href);

        const styles = getResourcesFromRoot(resourceRoot).hoistableStyles;

        let resource = styles.get(key);
        if (!resource) {
          //我们在上面已经断言了这一点，但 Flow 无法判断该类型是否符合
          const ownerDocument = getDocumentFromRoot(resourceRoot);
          resource = {
            type: 'stylesheet',
            instance: null,
            count: 0,
            state: {
              loading: NotLoaded,
              preload: null,
            },
          } as StylesheetResource;
          styles.set(key, resource);
          const instance = ownerDocument.querySelector(
            getStylesheetSelectorFromKey(key),
          );
          if (instance) {
            const loadingState: ?Promise<mixed> = (instance as any)._p;
            if (loadingState) {
              //此实例作为边界显示的一部分被插入，尚未加载
            } else {
              //此实例已加载
              resource.instance = instance;
              resource.state.loading = Loaded | Inserted;
            }
          } else {
            //我们没有实例，我们需要预加载它
            // $FlowFixMe[incompatible-type] -- the key we use here can only match non module preloads
            let preloadProps: void | PreloadProps = preloadPropsMap.get(key);
            if (!preloadProps) {
              preloadProps = preloadPropsFromStylesheet(qualifiedProps);
              preloadPropsMap.set(key, preloadProps);
            }

            preloadStylesheet(ownerDocument, key, preloadProps, resource.state);
          }
        }
        if (currentProps && currentResource === null) {
          //此节点以前是实例类型，现在正在变成资源类型。目前我们报错，因为我们不支持类型更改
          let diff = '';
          if (__DEV__) {
            diff = `

  - ${describeLinkForResourceErrorDEV(currentProps)}
  + ${describeLinkForResourceErrorDEV(pendingProps)}`;
          }
          throw new Error(
            'Expected <link> not to update to be updated to a stylesheet with precedence.' +
              ' Check the `rel`, `href`, and `precedence` props of this component.' +
              ' Alternatively, check whether two different <link> components render in the same slot or share the same key.' +
              diff,
          );
        }
        return resource;
      } else {
        if (currentProps && currentResource !== null) {
          //此节点以前是资源类型，现在正在变成实例类型。目前我们报错，因为我们不支持类型更改
          let diff = '';
          if (__DEV__) {
            diff = `

  - ${describeLinkForResourceErrorDEV(currentProps)}
  + ${describeLinkForResourceErrorDEV(pendingProps)}`;
          }
          throw new Error(
            'Expected stylesheet with precedence to not be updated to a different kind of <link>.' +
              ' Check the `rel`, `href`, and `precedence` props of this component.' +
              ' Alternatively, check whether two different <link> components render in the same slot or share the same key.' +
              diff,
          );
        }
        return null;
      }
    }
    case 'script': {
      const async = pendingProps.async;
      const src = pendingProps.src;
      if (
        typeof src === 'string' &&
        async &&
        typeof async !== 'function' &&
        typeof async !== 'symbol'
      ) {
        const key = getScriptKey(src);
        const scripts = getResourcesFromRoot(resourceRoot).hoistableScripts;

        let resource = scripts.get(key);
        if (!resource) {
          resource = {
            type: 'script',
            instance: null,
            count: 0,
            state: null,
          };
          scripts.set(key, resource);
        }
        return resource;
      }
      return {
        type: 'void',
        instance: null,
        count: 0,
        state: null,
      };
    }
    default: {
      throw new Error(
        `getResource encountered a type it did not expect: "${type}". this is a bug in React.`,
      );
    }
  }
}

/** `describeLinkForResourceErrorDEV` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function describeLinkForResourceErrorDEV(props: any) {
  if (__DEV__) {
    let describedProps = 0;

    let description = '<link';
    if (typeof props.rel === 'string') {
      describedProps++;
      description += ` rel="${props.rel}"`;
    } else if (hasOwnProperty.call(props, 'rel')) {
      describedProps++;
      description += ` rel="${
        props.rel === null ? 'null' : 'invalid type ' + typeof props.rel
      }"`;
    }
    if (typeof props.href === 'string') {
      describedProps++;
      description += ` href="${props.href}"`;
    } else if (hasOwnProperty.call(props, 'href')) {
      describedProps++;
      description += ` href="${
        props.href === null ? 'null' : 'invalid type ' + typeof props.href
      }"`;
    }
    if (typeof props.precedence === 'string') {
      describedProps++;
      description += ` precedence="${props.precedence}"`;
    } else if (hasOwnProperty.call(props, 'precedence')) {
      describedProps++;
      description += ` precedence={${
        props.precedence === null
          ? 'null'
          : 'invalid type ' + typeof props.precedence
      }}`;
    }
    if (Object.getOwnPropertyNames(props).length > describedProps) {
      description += ' ...';
    }
    description += ' />';
    return description;
  }
  return '';
}

/** `styleTagPropsFromRawProps` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function styleTagPropsFromRawProps(
  rawProps: StyleTagQualifyingProps,
): StyleTagProps {
  return {
    ...rawProps,
    'data-href': rawProps.href,
    'data-precedence': rawProps.precedence,
    href: null,
    precedence: null,
  };
}

/** `getStyleKey` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function getStyleKey(href: string) {
  const limitedEscapedHref =
    escapeSelectorAttributeValueInsideDoubleQuotes(href);
  return `href="${limitedEscapedHref}"`;
}

/** `getStyleTagSelector` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于测试选择器与可观察 DOM 状态查询。 */
function getStyleTagSelector(href: string) {
  const limitedEscapedHref =
    escapeSelectorAttributeValueInsideDoubleQuotes(href);
  return `style[data-href~="${limitedEscapedHref}"]`;
}

/** `getStylesheetSelectorFromKey` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于测试选择器与可观察 DOM 状态查询。 */
function getStylesheetSelectorFromKey(key: string) {
  return `link[rel="stylesheet"][${key}]`;
}

/** `getPreloadStylesheetSelectorFromKey` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于测试选择器与可观察 DOM 状态查询。 */
function getPreloadStylesheetSelectorFromKey(key: string) {
  return `link[rel="preload"][as="style"][${key}]`;
}

/** `stylesheetPropsFromRawProps` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function stylesheetPropsFromRawProps(
  rawProps: StylesheetQualifyingProps,
): StylesheetProps {
  return {
    ...rawProps,
    'data-precedence': rawProps.precedence,
    precedence: null,
  };
}
/** `preloadStylesheet` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function preloadStylesheet(
  ownerDocument: Document,
  key: string,
  preloadProps: PreloadProps,
  state: StylesheetState,
) {
  let instance = ownerDocument.querySelector(
    getPreloadStylesheetSelectorFromKey(key),
  );
  if (instance) {
    if (!isNodePendingLoad(instance)) {
      //如果我们发现已经有预加载，它是通过 SSR 生成的，我们将无法跟踪实际的加载状态。目前我们将假设它已经加载完成
      state.loading = Loaded;
      return;
    } else {
      //穿透并附加加载监听器
    }
  } else {
    instance = ownerDocument.createElement('link');
    markNodeAsPendingLoad(instance);
    instance.onload = instance.onerror = clearPendingLoadOnNode.bind(
      null,
      instance,
    );
    setInitialProperties(instance, 'link', preloadProps);
    markNodeAsHoistable(instance);
    (ownerDocument.head as any).appendChild(instance);
  }
  // $FlowFixMe[incompatible-type] -- if instance is an Element it will also be an HTMLLinkElement
  state.preload = instance;
  instance.addEventListener('load', () => (state.loading |= Loaded));
  instance.addEventListener('error', () => (state.loading |= Errored));
}

/** `preloadPropsFromStylesheet` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function preloadPropsFromStylesheet(
  props: StylesheetQualifyingProps,
): PreloadProps {
  return {
    rel: 'preload',
    as: 'style',
    href: props.href,
    crossOrigin: props.crossOrigin,
    integrity: props.integrity,
    media: props.media,
    hrefLang: props.hrefLang,
    referrerPolicy: props.referrerPolicy,
  };
}

/** `getScriptKey` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function getScriptKey(src: string): string {
  const limitedEscapedSrc = escapeSelectorAttributeValueInsideDoubleQuotes(src);
  return `[src="${limitedEscapedSrc}"]`;
}

/** `getScriptSelectorFromKey` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于测试选择器与可观察 DOM 状态查询。 */
function getScriptSelectorFromKey(key: string): string {
  return 'script[async]' + key;
}

/** `acquireResource` 登记或挂接目标，维持宿主顺序与资源引用计数；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
export function acquireResource(
  hoistableRoot: HoistableRoot,
  resource: Resource,
  props: any,
): null | Instance {
  resource.count++;
  if (resource.instance === null) {
    switch (resource.type) {
      case 'style': {
        const qualifiedProps: StyleTagQualifyingProps = props;

        //尝试从 DOM 对实例进行水合
        let instance: null | Instance = hoistableRoot.querySelector(
          getStyleTagSelector(qualifiedProps.href),
        );
        if (instance) {
          resource.instance = instance;
          markNodeAsHoistable(instance);
          return instance;
        }

        const styleProps = styleTagPropsFromRawProps(props);
        const ownerDocument = getDocumentFromRoot(hoistableRoot);
        instance = ownerDocument.createElement('style');

        markNodeAsHoistable(instance);
        setInitialProperties(instance, 'style', styleProps);

        //待办事项: `style` 没有用于跟踪插入的加载状态。我猜是因为这些不是 suspense 风格的？不确定这是否是重构味道。resource.state.loading |= Inserted;
        insertStylesheet(instance, qualifiedProps.precedence, hoistableRoot);
        resource.instance = instance;

        return instance;
      }
      case 'stylesheet': {
        //这个类型由 `getResource` 强制执行。如果我们在那里的逻辑更改了什么算作样式表资源，我们需要确保这个转换仍然合理；
        const qualifiedProps: StylesheetQualifyingProps = props;
        const key = getStyleKey(qualifiedProps.href);

        //尝试从 DOM 对实例进行水合
        let instance: null | Instance = hoistableRoot.querySelector(
          getStylesheetSelectorFromKey(key),
        );
        if (instance) {
          resource.state.loading |= Inserted;
          resource.instance = instance;
          markNodeAsHoistable(instance);
          return instance;
        }

        const stylesheetProps = stylesheetPropsFromRawProps(props);
        const preloadProps = preloadPropsMap.get(key);
        if (preloadProps) {
          adoptPreloadPropsForStylesheet(stylesheetProps, preloadProps);
        }

        //构建并插入一个新实例
        const ownerDocument = getDocumentFromRoot(hoistableRoot);
        instance = ownerDocument.createElement('link');
        markNodeAsHoistable(instance);
        const linkInstance: HTMLLinkElement = instance as any;
        (linkInstance as any)._p = new Promise((resolve, reject) => {
          linkInstance.onload = resolve;
          linkInstance.onerror = reject;
        });
        setInitialProperties(instance, 'link', stylesheetProps);
        resource.state.loading |= Inserted;
        insertStylesheet(instance, qualifiedProps.precedence, hoistableRoot);
        resource.instance = instance;

        return instance;
      }
      case 'script': {
        //这个类型由 `getResource` 强制执行。如果我们在那里的逻辑更改了什么算作样式表资源，我们需要确保这个转换仍然合理；
        const borrowedScriptProps: ScriptProps = props;
        const key = getScriptKey(borrowedScriptProps.src);

        //尝试从 DOM 对实例进行水合
        let instance: null | Instance = hoistableRoot.querySelector(
          getScriptSelectorFromKey(key),
        );
        if (instance) {
          resource.instance = instance;
          markNodeAsHoistable(instance);
          return instance;
        }

        let scriptProps = borrowedScriptProps;
        const preloadProps = preloadPropsMap.get(key);
        if (preloadProps) {
          scriptProps = {...borrowedScriptProps};
          adoptPreloadPropsForScript(scriptProps, preloadProps);
        }

        //构建并插入一个新实例
        const ownerDocument = getDocumentFromRoot(hoistableRoot);
        instance = ownerDocument.createElement('script');
        markNodeAsHoistable(instance);
        setInitialProperties(instance, 'link', scriptProps);
        (ownerDocument.head as any).appendChild(instance);
        resource.instance = instance;

        return instance;
      }
      case 'void': {
        return null;
      }
      default: {
        throw new Error(
          `acquireResource encountered a resource type it did not expect: "${resource.type}". this is a bug in React.`,
        );
      }
    }
  } else {
    //在样式表的情况下，它们可能已经在 `suspendResource` 期间被分配了一个实例。但这并不意味着它们已经被插入，因为提交可能被中断。所以我们现在需要检查。
    //
    //其他资源类型不受影响，因为它们还没有被挂起。
    //
    //TODO：这里略有代码异味。应考虑重构
    // `suspendResource` 与 `acquireResource` 的协作方式；设计意图是
    // `suspendResource` 除插入动作外，执行与 `acquireResource` 相同的工作。
    if (
      resource.type === 'stylesheet' &&
      (resource.state.loading & Inserted) === NotLoaded
    ) {
      const qualifiedProps: StylesheetQualifyingProps = props;
      const instance: Instance = resource.instance;
      resource.state.loading |= Inserted;
      insertStylesheet(instance, qualifiedProps.precedence, hoistableRoot);
    }
  }
  return resource.instance;
}

/** `releaseResource` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
export function releaseResource(resource: Resource): void {
  resource.count--;
}

/** `insertStylesheet` 登记或挂接目标，维持宿主顺序与资源引用计数；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function insertStylesheet(
  instance: Element,
  precedence: string,
  root: HoistableRoot,
): void {
  const nodes = root.querySelectorAll(
    'link[rel="stylesheet"][data-precedence],style[data-precedence]',
  );
  const last = nodes.length ? nodes[nodes.length - 1] : null;
  let prior = last;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    // $FlowFixMe[prop-missing]
    const nodePrecedence = node.dataset.precedence;
    if (nodePrecedence === precedence) {
      prior = node;
    } else if (prior !== last) {
      break;
    }
  }

  if (prior) {
    //我们从文档中获取先验信息，所以我们知道它在树中。我们也知道链接不可能是最顶层的节点，所以 parentNode 必须存在。
    (prior.parentNode as any as Node).insertBefore(instance, prior.nextSibling);
  } else {
    const parent =
      root.nodeType === DOCUMENT_NODE
        ? ((root as any as Document).head as any as Element)
        : (root as any as ShadowRoot);
    parent.insertBefore(instance, parent.firstChild);
  }
}

/** `adoptPreloadPropsForStylesheet` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function adoptPreloadPropsForStylesheet(
  stylesheetProps: StylesheetProps,
  preloadProps: PreloadProps | PreloadModuleProps,
): void {
  if (stylesheetProps.crossOrigin == null)
    stylesheetProps.crossOrigin = preloadProps.crossOrigin;
  if (stylesheetProps.referrerPolicy == null)
    stylesheetProps.referrerPolicy = preloadProps.referrerPolicy;
  if (stylesheetProps.title == null) stylesheetProps.title = preloadProps.title;
}

/** `adoptPreloadPropsForScript` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function adoptPreloadPropsForScript(
  scriptProps: ScriptProps,
  preloadProps: PreloadProps | PreloadModuleProps,
): void {
  if (scriptProps.crossOrigin == null)
    scriptProps.crossOrigin = preloadProps.crossOrigin;
  if (scriptProps.referrerPolicy == null)
    scriptProps.referrerPolicy = preloadProps.referrerPolicy;
  if (scriptProps.integrity == null)
    scriptProps.integrity = preloadProps.integrity;
}

/** `KeyedTagCache` 定义hoistable resource 的去重、预加载、获取、挂载与释放的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type KeyedTagCache = Map<string, Array<Element>>;
/** `DocumentTagCaches` 定义hoistable resource 的去重、预加载、获取、挂载与释放的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
type DocumentTagCaches = Map<Document, KeyedTagCache>;
let tagCaches: null | DocumentTagCaches = null;

/** `hydrateHoistable` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于hydration 匹配、重试、差异诊断与边界推进。 */
export function hydrateHoistable(
  hoistableRoot: HoistableRoot,
  type: HoistableTagType,
  props: any,
  internalInstanceHandle: Object,
): Instance {
  const ownerDocument = getDocumentFromRoot(hoistableRoot);

  let instance: ?Instance = null;
  getInstance: switch (type) {
    case 'title': {
      instance = ownerDocument.getElementsByTagName('title')[0];
      if (
        !instance ||
        isOwnedInstance(instance) ||
        instance.namespaceURI === SVG_NAMESPACE ||
        instance.hasAttribute('itemprop')
      ) {
        instance = ownerDocument.createElement(type);
        (ownerDocument.head as any).insertBefore(
          instance,
          ownerDocument.querySelector('head > title'),
        );
      }
      setInitialProperties(instance, type, props);
      precacheFiberNode(internalInstanceHandle, instance);
      markNodeAsHoistable(instance);
      return instance;
    }
    case 'link': {
      const cache = getHydratableHoistableCache('link', 'href', ownerDocument);
      const key = type + (props.href || '');
      const maybeNodes = cache.get(key);
      if (maybeNodes) {
        const nodes = maybeNodes;
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (
            node.getAttribute('href') !==
              (props.href == null || props.href === '' ? null : props.href) ||
            node.getAttribute('rel') !==
              (props.rel == null ? null : props.rel) ||
            node.getAttribute('title') !==
              (props.title == null ? null : props.title) ||
            node.getAttribute('crossorigin') !==
              (props.crossOrigin == null ? null : props.crossOrigin)
          ) {
            //不匹配，尝试下一个节点；
            continue;
          }
          instance = node;
          nodes.splice(i, 1);
          break getInstance;
        }
      }
      instance = ownerDocument.createElement(type);
      setInitialProperties(instance, type, props);
      (ownerDocument.head as any).appendChild(instance);
      break;
    }
    case 'meta': {
      const cache = getHydratableHoistableCache(
        'meta',
        'content',
        ownerDocument,
      );
      const key = type + (props.content || '');
      const maybeNodes = cache.get(key);
      if (maybeNodes) {
        const nodes = maybeNodes;
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];

          //我们将内容强制转换为字符串，因为它最可能使用 `toString` 支持的值。对于其他情况，我们只是进行相同匹配，传递非字符串在这里并不真正有效。
          if (__DEV__) {
            checkAttributeStringCoercion(props.content, 'content');
          }
          if (
            node.getAttribute('content') !==
              (props.content == null ? null : '' + props.content) ||
            node.getAttribute('name') !==
              (props.name == null ? null : props.name) ||
            node.getAttribute('property') !==
              (props.property == null ? null : props.property) ||
            node.getAttribute('http-equiv') !==
              (props.httpEquiv == null ? null : props.httpEquiv) ||
            node.getAttribute('charset') !==
              (props.charSet == null ? null : props.charSet)
          ) {
            //不匹配，尝试下一个节点；
            continue;
          }
          instance = node;
          nodes.splice(i, 1);
          break getInstance;
        }
      }
      instance = ownerDocument.createElement(type);
      setInitialProperties(instance, type, props);
      (ownerDocument.head as any).appendChild(instance);
      break;
    }
    default:
      throw new Error(
        `getNodesForType encountered a type it did not expect: "${type}". This is a bug in React.`,
      );
  }

  //这个节点匹配
  precacheFiberNode(internalInstanceHandle, instance);
  markNodeAsHoistable(instance);
  return instance;
}

/** `getHydratableHoistableCache` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于hydration 匹配、重试、差异诊断与边界推进。 */
function getHydratableHoistableCache(
  type: HoistableTagType,
  keyAttribute: string,
  ownerDocument: Document,
): KeyedTagCache {
  let cache: KeyedTagCache;
  let caches: DocumentTagCaches;
  if (tagCaches === null) {
    cache = new Map();
    caches = tagCaches = new Map();
    caches.set(ownerDocument, cache);
  } else {
    caches = tagCaches;
    const maybeCache = caches.get(ownerDocument);
    if (!maybeCache) {
      cache = new Map();
      caches.set(ownerDocument, cache);
    } else {
      cache = maybeCache;
    }
  }

  if (cache.has(type)) {
    //我们使用 type 作为一个特殊键，表示这个缓存已为该类型进行了初始化
    return cache;
  }

  //将此类型的缓存标记为已播种
  cache.set(type, null as any);

  const nodes = ownerDocument.getElementsByTagName(type);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (
      !isOwnedInstance(node) &&
      (type !== 'link' || node.getAttribute('rel') !== 'stylesheet') &&
      node.namespaceURI !== SVG_NAMESPACE
    ) {
      const nodeKey = node.getAttribute(keyAttribute) || '';
      const key = type + nodeKey;
      const existing = cache.get(key);
      if (existing) {
        existing.push(node);
      } else {
        cache.set(key, [node]);
      }
    }
  }

  return cache;
}

/** `mountHoistable` 登记或挂接目标，维持宿主顺序与资源引用计数；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
export function mountHoistable(
  hoistableRoot: HoistableRoot,
  type: HoistableTagType,
  instance: Instance,
): void {
  const ownerDocument = getDocumentFromRoot(hoistableRoot);
  (ownerDocument.head as any).insertBefore(
    instance,
    type === 'title' ? ownerDocument.querySelector('head > title') : null,
  );
}

/** `unmountHoistable` 清理对应宿主状态；重复或延迟清理不得破坏其他根；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
export function unmountHoistable(instance: Instance): void {
  (instance.parentNode as any).removeChild(instance);
}

/** `isHostHoistableType` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
export function isHostHoistableType(
  type: string,
  props: RawProps,
  hostContext: HostContext,
): boolean {
  let outsideHostContainerContext: boolean;
  let hostContextProd: HostContextProd;
  if (__DEV__) {
    const hostContextDev: HostContextDev = hostContext as any;
    //只有当我们不处于主机容器上下文中时，我们才能渲染资源
    outsideHostContainerContext =
      !hostContextDev.ancestorInfo.containerTagInScope;
    hostContextProd = hostContextDev.context;
  } else {
    hostContextProd = hostContext as any;
  }

  //全局禁止对 SVG 命名空间中的任何内容或 itemScope 内带有 itemProp 的任何内容进行提升
  if (hostContextProd === HostContextNamespaceSvg || props.itemProp != null) {
    if (__DEV__) {
      if (
        outsideHostContainerContext &&
        props.itemProp != null &&
        (type === 'meta' ||
          type === 'title' ||
          type === 'style' ||
          type === 'link' ||
          type === 'script')
      ) {
        console.error(
          'Cannot render a <%s> outside the main document if it has an `itemProp` prop. `itemProp` suggests the tag belongs to an' +
            ' `itemScope` which can appear anywhere in the DOM. If you were intending for React to hoist this <%s> remove the `itemProp` prop.' +
            ' Otherwise, try moving this tag into the <head> or <body> of the Document.',
          type,
          type,
        );
      }
    }
    return false;
  }

  switch (type) {
    case 'meta':
    case 'title': {
      return true;
    }
    case 'style': {
      if (
        typeof props.precedence !== 'string' ||
        typeof props.href !== 'string' ||
        props.href === ''
      ) {
        if (__DEV__) {
          if (outsideHostContainerContext) {
            console.error(
              'Cannot render a <style> outside the main document without knowing its precedence and a unique href key.' +
                ' React can hoist and deduplicate <style> tags if you provide a `precedence` prop along with an `href` prop that' +
                ' does not conflict with the `href` values used in any other hoisted <style> or <link rel="stylesheet" ...> tags. ' +
                ' Note that hoisting <style> tags is considered an advanced feature that most will not use directly.' +
                ' Consider moving the <style> tag to the <head> or consider adding a `precedence="default"` and `href="some unique resource identifier"`.',
            );
          }
        }
        return false;
      }
      return true;
    }
    case 'link': {
      if (
        typeof props.rel !== 'string' ||
        typeof props.href !== 'string' ||
        props.href === '' ||
        props.onLoad ||
        props.onError
      ) {
        if (__DEV__) {
          if (
            props.rel === 'stylesheet' &&
            typeof props.precedence === 'string'
          ) {
            validateLinkPropsForStyleResource(props);
          }
          if (outsideHostContainerContext) {
            if (
              typeof props.rel !== 'string' ||
              typeof props.href !== 'string' ||
              props.href === ''
            ) {
              console.error(
                'Cannot render a <link> outside the main document without a `rel` and `href` prop.' +
                  ' Try adding a `rel` and/or `href` prop to this <link> or moving the link into the <head> tag',
              );
            } else if (props.onError || props.onLoad) {
              console.error(
                'Cannot render a <link> with onLoad or onError listeners outside the main document.' +
                  ' Try removing onLoad={...} and onError={...} or moving it into the root <head> tag or' +
                  ' somewhere in the <body>.',
              );
            }
          }
        }
        return false;
      }
      switch (props.rel) {
        case 'stylesheet': {
          const {precedence, disabled} = props;
          if (__DEV__) {
            if (typeof precedence !== 'string') {
              if (outsideHostContainerContext) {
                console.error(
                  'Cannot render a <link rel="stylesheet" /> outside the main document without knowing its precedence.' +
                    ' Consider adding precedence="default" or moving it into the root <head> tag.',
                );
              }
            }
          }
          return typeof precedence === 'string' && disabled == null;
        }
        default: {
          return true;
        }
      }
    }
    case 'script': {
      const isAsync =
        props.async &&
        typeof props.async !== 'function' &&
        typeof props.async !== 'symbol';
      if (
        !isAsync ||
        props.onLoad ||
        props.onError ||
        !props.src ||
        typeof props.src !== 'string'
      ) {
        if (__DEV__) {
          if (outsideHostContainerContext) {
            if (!isAsync) {
              console.error(
                'Cannot render a sync or defer <script> outside the main document without knowing its order.' +
                  ' Try adding async="" or moving it into the root <head> tag.',
              );
            } else if (props.onLoad || props.onError) {
              console.error(
                'Cannot render a <script> with onLoad or onError listeners outside the main document.' +
                  ' Try removing onLoad={...} and onError={...} or moving it into the root <head> tag or' +
                  ' somewhere in the <body>.',
              );
            } else {
              console.error(
                'Cannot render a <script> outside the main document without `async={true}` and a non-empty `src` prop.' +
                  ' Ensure there is a valid `src` and either make the script async or move it into the root <head> tag or' +
                  ' somewhere in the <body>.',
              );
            }
          }
        }
        return false;
      }
      return true;
    }
    case 'noscript':
    case 'template': {
      if (__DEV__) {
        if (outsideHostContainerContext) {
          console.error(
            'Cannot render <%s> outside the main document. Try moving it into the root <head> tag.',
            type,
          );
        }
      }
      return false;
    }
  }
  return false;
}

/** `maySuspendCommit` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于suspensey commit 的资源等待、超时估算与解除挂起。 */
export function maySuspendCommit(type: Type, props: Props): boolean {
  if (!enableSuspenseyImages && !enableViewTransition) {
    return false;
  }
  //悬念感的图像是默认的，除非你选择通过 loading="lazy" 或 onLoad={...} 退出，这意味着你可以等待。
  return (
    type === 'img' &&
    props.src != null &&
    props.src !== '' &&
    props.onLoad == null &&
    props.loading !== 'lazy'
  );
}

/** `maySuspendCommitOnUpdate` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于suspensey commit 的资源等待、超时估算与解除挂起。 */
export function maySuspendCommitOnUpdate(
  type: Type,
  oldProps: Props,
  newProps: Props,
): boolean {
  return (
    maySuspendCommit(type, newProps) &&
    (newProps.src !== oldProps.src || newProps.srcSet !== oldProps.srcSet)
  );
}

/** `maySuspendCommitInSyncRender` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于suspensey commit 的资源等待、超时估算与解除挂起。 */
export function maySuspendCommitInSyncRender(
  type: Type,
  props: Props,
): boolean {
  //待办：允许同步通道也可以挂起，需选择加入。
  return false;
}

/** `mayResourceSuspendCommit` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
export function mayResourceSuspendCommit(resource: Resource): boolean {
  return (
    resource.type === 'stylesheet' &&
    (resource.state.loading & Inserted) === NotLoaded
  );
}

/** `preloadInstance` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
export function preloadInstance(
  instance: Instance,
  type: Type,
  props: Props,
): boolean {
  //我们不需要预加载 Suspense 风格的图像，因为一旦我们设置了 src，浏览器会提前加载它们。如果我们在这里返回 true，我们仍然会在预提交阶段收到 suspendInstance 调用，以确定我们是否仍然需要解码图像，或者图像是否已从缓存中删除。这只是避免渲染 Suspense 回退。
  return !!(instance as any).complete;
}

/** `preloadResource` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
export function preloadResource(resource: Resource): boolean {
  if (
    resource.type === 'stylesheet' &&
    (resource.state.loading & Settled) === NotLoaded
  ) {
    //返回 false 表示此资源应该挂起
    return false;
  }

  //返回 true 表示此资源不应挂起
  return true;
}

/** `SuspendedState` 定义suspensey commit 的资源等待、超时估算与解除挂起的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export opaque type SuspendedState = {
  /** `SuspendedState.stylesheets` 表示资源加载、引用计数或解除挂起状态；仅在hoistable resource 的去重、预加载、获取、挂载与释放生命周期内有效。 */
  stylesheets: null | Map<StylesheetResource, HoistableRoot>,
  /** `SuspendedState.count` 表示资源加载、引用计数或解除挂起状态；仅在suspensey commit 的资源等待、超时估算与解除挂起生命周期内有效。 */
  count: number, //悬念式 CSS 和活动视图转换
  imgCount: number, //悬疑的图像正在加载
  imgBytes: number, //我们估计需要下载的字节数
  suspenseyImages: Array<HTMLImageElement>, //悬疑图片的实例（无论是否已加载）
  waitingForImages: boolean, //当我们不再阻塞图像时为假
  waitingForViewTransition: boolean,
  /** `SuspendedState.unsuspend` 表示解除阻塞后唤醒 reconciler 的幂等回调；仅在suspensey commit 的资源等待、超时估算与解除挂起生命周期内有效。 */
  unsuspend: null | (() => void),
};

/** `startSuspendingCommit` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于suspensey commit 的资源等待、超时估算与解除挂起。 */
export function startSuspendingCommit(): SuspendedState {
  return {
    stylesheets: null,
    count: 0,
    imgCount: 0,
    imgBytes: 0,
    suspenseyImages: [],
    waitingForImages: true,
    waitingForViewTransition: false,
    //当我们开始挂起时，我们使用一个 noop 函数，因为如果可能的话，我们希望 waitfor 步骤同步完成。如果不能完成，我们将返回一个函数以提供实际的解除挂起函数，当计数达到零时该函数将完成，或者如果根开始新的工作，它将被取消。
    unsuspend: noop,
  };
}

/** `estimateImageBytes` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于suspensey commit 的资源等待、超时估算与解除挂起。 */
function estimateImageBytes(instance: HTMLImageElement): number {
  const width: number = instance.width || 100;
  const height: number = instance.height || 100;
  const pixelRatio: number =
    typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  const pixelsToDownload = width * height * pixelRatio;
  const AVERAGE_BYTE_PER_PIXEL = 0.25;
  return pixelsToDownload * AVERAGE_BYTE_PER_PIXEL;
}

/** `suspendInstance` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于suspensey commit 的资源等待、超时估算与解除挂起。 */
export function suspendInstance(
  state: SuspendedState,
  instance: Instance,
  type: Type,
  props: Props,
): void {
  if (!enableSuspenseyImages && !enableViewTransition) {
    return;
  }
  if (
    // $FlowFixMe[prop-missing]
    typeof instance.decode === 'function'
  ) {
    //如果这个浏览器支持 decode() API，我们就用它来暂停对图像的等待。此时加载应该已经开始，所以只需调用 decode() 就够了，它也会等待数据加载完成。
    state.imgCount++;
    //根据 props 中指定的宽度/高度，估算我们即将下载的字节大小。这是提前了解的最佳做法，但如果未指定，我们将回退到 100x100 像素的猜测。
    if (!(instance as any).complete) {
      state.imgBytes += estimateImageBytes(instance as any);
      state.suspenseyImages.push(instance as any);
    }
    const ping = onUnsuspendImg.bind(state);
    // $FlowFixMe[prop-missing]
    instance.decode().then(ping, ping);
  }
}

/** `suspendResource` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
export function suspendResource(
  state: SuspendedState,
  hoistableRoot: HoistableRoot,
  resource: Resource,
  props: any,
): void {
  if (resource.type === 'stylesheet') {
    if (typeof props.media === 'string') {
      //如果我们当前不匹配媒体，我们会避免暂停此资源，并让它在变异路径上插入
      if (matchMedia(props.media).matches === false) {
        return;
      }
    }
    if ((resource.state.loading & Inserted) === NotLoaded) {
      if (resource.instance === null) {
        const qualifiedProps: StylesheetQualifyingProps = props;
        const key = getStyleKey(qualifiedProps.href);

        //尝试从 DOM 对实例进行水合
        let instance: null | Instance = hoistableRoot.querySelector(
          getStylesheetSelectorFromKey(key),
        );
        if (instance) {
          //如果此实例有加载状态，则它来自 Fizz 运行时。如果没有加载状态，则假定它已作为序言的一部分通过服务器渲染，因此是同步加载的。然而，它可能已经出错，我们仍然没有方法来检测。暂时，我们假定它已加载。
          const maybeLoadingState: ?Promise<mixed> = (instance as any)._p;
          if (
            maybeLoadingState !== null &&
            typeof maybeLoadingState === 'object' &&
            // $FlowFixMe[method-unbinding]
            typeof maybeLoadingState.then === 'function'
          ) {
            const loadingState = maybeLoadingState;
            state.count++;
            const ping = onUnsuspend.bind(state);
            loadingState.then(ping, ping);
          }
          resource.state.loading |= Inserted;
          resource.instance = instance;
          markNodeAsHoistable(instance);
          return;
        }

        const ownerDocument = getDocumentFromRoot(hoistableRoot);

        const stylesheetProps = stylesheetPropsFromRawProps(props);
        const preloadProps = preloadPropsMap.get(key);
        if (preloadProps) {
          adoptPreloadPropsForStylesheet(stylesheetProps, preloadProps);
        }

        //构建并插入一个新实例
        instance = ownerDocument.createElement('link');
        markNodeAsHoistable(instance);
        const linkInstance: HTMLLinkElement = instance as any;
        //这个 Promise 是 Fizz 运行时使用的加载状态。我们需要它，以防在这个资源在客户端渲染和在延迟完成的边界渲染之间发生竞争。
        (linkInstance as any)._p = new Promise((resolve, reject) => {
          linkInstance.onload = resolve;
          linkInstance.onerror = reject;
        });
        setInitialProperties(instance, 'link', stylesheetProps);
        resource.instance = instance;
      }

      if (state.stylesheets === null) {
        state.stylesheets = new Map();
      }
      state.stylesheets.set(resource, hoistableRoot);

      const preloadEl = resource.state.preload;
      if (preloadEl && (resource.state.loading & Settled) === NotLoaded) {
        state.count++;
        const ping = onUnsuspend.bind(state);
        preloadEl.addEventListener('load', ping);
        preloadEl.addEventListener('error', ping);
      }
    }
  }
}

/** `suspendOnActiveViewTransition` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于suspensey commit 的资源等待、超时估算与解除挂起。 */
export function suspendOnActiveViewTransition(
  state: SuspendedState,
  rootContainer: Container,
): void {
  const ownerDocument =
    rootContainer.nodeType === DOCUMENT_NODE
      ? rootContainer
      : rootContainer.ownerDocument;
  // $FlowFixMe[prop-missing]
  const activeViewTransition = ownerDocument.__reactViewTransition;
  if (activeViewTransition == null) {
    return;
  }
  state.count++;
  state.waitingForViewTransition = true;
  const ping = onUnsuspend.bind(state);
  activeViewTransition.finished.then(ping, ping);
}

/** `SUSPENSEY_STYLESHEET_TIMEOUT` 是hoistable resource 的去重、预加载、获取、挂载与释放使用的稳定协议值、超时或 DOM 标记；必须与消费者约定一致。 */
const SUSPENSEY_STYLESHEET_TIMEOUT = 60000;

/** `SUSPENSEY_IMAGE_TIMEOUT` 是suspensey commit 的资源等待、超时估算与解除挂起使用的稳定协议值、超时或 DOM 标记；必须与消费者约定一致。 */
const SUSPENSEY_IMAGE_TIMEOUT = 800;

/** `SUSPENSEY_IMAGE_TIME_ESTIMATE` 是suspensey commit 的资源等待、超时估算与解除挂起使用的稳定协议值、超时或 DOM 标记；必须与消费者约定一致。 */
const SUSPENSEY_IMAGE_TIME_ESTIMATE = 500;

let estimatedBytesWithinLimit: number = 0;

/** `waitForCommitToBeReady` 启动异步或资源阶段，并通过回调/计数器封闭完成边界；属于suspensey commit 的资源等待、超时估算与解除挂起。 */
export function waitForCommitToBeReady(
  state: SuspendedState,
  timeoutOffset: number,
): null | ((() => void) => () => void) {
  if (state.stylesheets && state.count === 0) {
    //我们目前没有被阻塞，但还没有插入所有样式表。如果这个插入发生并且同步加载或出错，那么我们可以避免暂停提交。为此，我们会在之后立即再次检查计数。
    insertSuspendedStylesheets(state, state.stylesheets);
  }

  //我们需要再次检查数量，因为插入的样式表可能导致出现需要等待的新任务。
  if (state.count > 0 || state.imgCount > 0) {
    return commit => {
      //我们几乎从不希望在样式加载之前显示内容。但最终我们会放弃，并允许无样式的内容。因此，这个数字有些随意——足够大，以至于你只会在极端情况下达到它。TODO：弄清楚浏览器引擎在初始页面加载期间会做什么，并考虑让我们的行为与之保持一致。
      const stylesheetTimer = setTimeout(() => {
        if (state.stylesheets) {
          insertSuspendedStylesheets(state, state.stylesheets);
        }
        if (state.unsuspend) {
          const unsuspend = state.unsuspend;
          state.unsuspend = null;
          unsuspend();
        }
      }, SUSPENSEY_STYLESHEET_TIMEOUT + timeoutOffset);

      if (state.imgBytes > 0 && estimatedBytesWithinLimit === 0) {
        //估算我们在500毫秒内可以下载多少字节。
        const mbps = estimateBandwidth();
        estimatedBytesWithinLimit = mbps * 125 * SUSPENSEY_IMAGE_TIME_ESTIMATE;
      }
      //如果我们要下载的图像比预期在超时内能处理的更多，那么不要等待超过50毫秒的图像。50毫秒仍然允许我们进行解码并命中缓存，如果图像已经在HTTP缓存中。
      const imgTimeout =
        state.imgBytes > estimatedBytesWithinLimit
          ? 50
          : SUSPENSEY_IMAGE_TIMEOUT;
      const imgTimer = setTimeout(() => {
        //我们不再被图片阻塞。如果 CSS 之后解决了，我们可以提交。
        state.waitingForImages = false;
        if (state.count === 0) {
          if (state.stylesheets) {
            insertSuspendedStylesheets(state, state.stylesheets);
          }
          if (state.unsuspend) {
            const unsuspend = state.unsuspend;
            state.unsuspend = null;
            unsuspend();
          }
        }
      }, imgTimeout + timeoutOffset);

      state.unsuspend = commit;

      return () => {
        state.unsuspend = null;
        clearTimeout(stylesheetTimer);
        clearTimeout(imgTimer);
      };
    };
  }
  return null;
}

/** `getSuspendedCommitReason` 查询、匹配或计算结果；不适用时返回协议约定的空值；属于suspensey commit 的资源等待、超时估算与解除挂起。 */
export function getSuspendedCommitReason(
  state: SuspendedState,
  rootContainer: Container,
): null | string {
  if (state.waitingForViewTransition) {
    return 'Waiting for the previous Animation';
  }
  if (state.count > 0) {
    if (state.imgCount > 0) {
      return 'Suspended on CSS and Images';
    }
    return 'Suspended on CSS';
  }
  if (state.imgCount === 1) {
    return 'Suspended on an Image';
  }
  if (state.imgCount > 0) {
    return 'Suspended on Images';
  }
  return null;
}

/** `checkIfFullyUnsuspended` 判断当前宿主能力或状态分支，只读 DOM/Fiber 快照；属于suspensey commit 的资源等待、超时估算与解除挂起。 */
function checkIfFullyUnsuspended(state: SuspendedState) {
  if (state.count === 0 && (state.imgCount === 0 || !state.waitingForImages)) {
    if (state.stylesheets) {
      //如果我们还没有实际插入样式表，我们现在需要在开始提交之前插入它们。我们之所以在其他所有操作完成之后才这样做，是因为我们希望在进行变更之前让所有样式表同步加载。理想情况下，新样式只会在新树上引起一次重新计算。当我们填充样式表时，我们只包括具有匹配媒体属性的样式表，因此我们会等待它们加载完毕后才实际继续。我们预计这会使计数增至零以上。
      insertSuspendedStylesheets(state, state.stylesheets);
    } else if (state.unsuspend) {
      const unsuspend = state.unsuspend;
      state.unsuspend = null;
      unsuspend();
    }
  }
}

/** `onUnsuspend` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于suspensey commit 的资源等待、超时估算与解除挂起。 */
function onUnsuspend(this: SuspendedState) {
  this.count--;
  checkIfFullyUnsuspended(this);
}

/** `onUnsuspendImg` 实现 reconciler 请求的宿主操作，并把副作用限制在当前根或实例；属于suspensey commit 的资源等待、超时估算与解除挂起。 */
function onUnsuspendImg(this: SuspendedState) {
  this.imgCount--;
  checkIfFullyUnsuspended(this);
}

//我们使用一种类型不同于优先级的值来跟踪哪一个是最后的。这确保了不会与用户定义的优先级发生冲突。通常我们会在模块作用域中跟踪这个值，但由于优先级是按可提升根（HoistableRoot）跟踪的，我们需要将其关联到某个非全局作用域的东西，这就是为什么我们首先尝试将它与优先级映射放在一起的原因
const LAST_PRECEDENCE = null;

//这里被强制转换为非空类型，因为它在读取之前总是会被设置。重要的是，除非栈保证它存在，否则不要使用它。目前这仅在 insertSuspendedStylesheet 期间使用。
let precedencesByRoot: Map<
  HoistableRoot,
  Map<string | typeof LAST_PRECEDENCE, Instance>,
> = null as any;

/** `insertSuspendedStylesheets` 登记或挂接目标，维持宿主顺序与资源引用计数；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function insertSuspendedStylesheets(
  state: SuspendedState,
  resources: Map<StylesheetResource, HoistableRoot>,
): void {
  //我们需要清理这个，这样在样式表加载之后我们就不会尝试重新插入
  state.stylesheets = null;

  if (state.unsuspend === null) {
    //挂起的提交已被取消。我们不需要插入任何样式表。
    return;
  }

  //临时增加计数。我们不希望任何同步加载的样式表在我们完成插入所有样式表之前尝试取消挂起。
  state.count++;

  precedencesByRoot = new Map();
  resources.forEach(insertStylesheetIntoRoot, state);
  precedencesByRoot = null as any;

  //我们可以移除我们的临时计数，如果仍然为零，我们可以取消挂起。如果我们在同步阶段，在决定提交是否应该挂起之前，并且最终进入取消挂起的路径，它将只调用无操作的取消挂起。
  onUnsuspend.call(state);
}

/** `insertStylesheetIntoRoot` 登记或挂接目标，维持宿主顺序与资源引用计数；属于hoistable resource 的去重、预加载、获取、挂载与释放。 */
function insertStylesheetIntoRoot(
  this: SuspendedState,
  root: HoistableRoot,
  resource: StylesheetResource,
  map: Map<StylesheetResource, HoistableRoot>,
) {
  if (resource.state.loading & Inserted) {
    //该资源是由另一个根提交插入的，我们不需要再次插入它
    return;
  }

  let last;
  let precedences = precedencesByRoot.get(root);
  if (!precedences) {
    precedences = new Map();
    precedencesByRoot.set(root, precedences);
    const nodes = root.querySelectorAll(
      'link[data-precedence],style[data-precedence]',
    );
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (
        node.nodeName === 'LINK' ||
        //我们省略带有 media="not all" 的样式标签，因为它们位置不正确，并且将会很快被 Fizz 运行时提升。
        node.getAttribute('media') !== 'not all'
      ) {
        precedences.set(
          // $FlowFixMe[prop-missing]
          node.dataset.precedence,
          node,
        );
        last = node;
      }
    }
    if (last) {
      precedences.set(LAST_PRECEDENCE, last);
    }
  } else {
    last = precedences.get(LAST_PRECEDENCE);
  }

  //我们只在构造了实例之后才调用它，所以这里我们假设它已经存在
  const instance: HTMLLinkElement = resource.instance as any;
  //我们将始终优先考虑样式表实例
  const precedence: string = instance.getAttribute('data-precedence') as any;

  const prior = precedences.get(precedence) || last;
  if (prior === last) {
    precedences.set(LAST_PRECEDENCE, instance);
  }
  precedences.set(precedence, instance);

  this.count++;
  const onComplete = onUnsuspend.bind(this);
  instance.addEventListener('load', onComplete);
  instance.addEventListener('error', onComplete);

  if (prior) {
    (prior.parentNode as any).insertBefore(instance, prior.nextSibling);
  } else {
    const parent =
      root.nodeType === DOCUMENT_NODE
        ? ((root as any as Document).head as any as Element)
        : (root as any as ShadowRoot);
    parent.insertBefore(instance, parent.firstChild);
  }
  resource.state.loading |= Inserted;
}

/** `NotPendingTransition` 保存suspensey commit 的资源等待、超时估算与解除挂起所需的配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
export const NotPendingTransition: TransitionStatus = NotPending;
/** `HostTransitionContext` 保存suspensey commit 的资源等待、超时估算与解除挂起所需的配置、缓存或模块级状态；生命周期覆盖当前 renderer。 */
export const HostTransitionContext: ReactContext<TransitionStatus> = {
  $$typeof: REACT_CONTEXT_TYPE,
  Provider: null as any,
  Consumer: null as any,
  _currentValue: NotPendingTransition,
  _currentValue2: NotPendingTransition,
  _threadCount: 0,
};

/** `FormInstance` 定义suspensey commit 的资源等待、超时估算与解除挂起的数据契约；字段共同约束所有权、状态迁移和跨阶段传递边界。 */
export type FormInstance = HTMLFormElement;
/** `resetFormInstance` 同步宿主状态，并保持 DOM、Fiber 与提交快照一致；属于suspensey commit 的资源等待、超时估算与解除挂起。 */
export function resetFormInstance(form: FormInstance): void {
  ReactBrowserEventEmitterSetEnabled(true);
  form.reset();
  ReactBrowserEventEmitterSetEnabled(false);
}
