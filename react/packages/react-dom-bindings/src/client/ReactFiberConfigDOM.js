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

/** `rendererPackageName` 提供给 DevTools 的 renderer 包名。 */
export const rendererPackageName = 'react-dom';
/** `extraDevToolsConfig` 此 renderer 没有额外的 DevTools 检查配置。 */
export const extraDevToolsConfig = null;

/** `Type` 宿主元素的标签名。 */
export type Type = string;
/** `Props` 此 HostConfig 读取的 DOM props；未列出的属性仍可由开放对象携带。 */
export type Props = {
  /** `Props.autoFocus` 初次客户端挂载后是否自动聚焦；hydration 不再次自动聚焦。 */
  autoFocus?: boolean,
  /** `Props.children` React 子内容；字符串等直接文本内容可由宿主设置。 */
  children?: mixed,
  /** `Props.disabled` 控件的禁用状态，也用于排除可共享的 stylesheet link。 */
  disabled?: boolean,
  /** `Props.hidden` DOM hidden 属性；测试选择器据此跳过 HostComponent 子树。 */
  hidden?: boolean,
  /** `Props.suppressHydrationWarning` 抑制本元素属性或直接文本的 hydration 差异警告。 */
  suppressHydrationWarning?: boolean,
  /** `Props.dangerouslySetInnerHTML` 直接写入宿主元素 HTML 的 __html 包装对象。 */
  dangerouslySetInnerHTML?: mixed,
  /** `Props.style` DOM 内联样式；隐藏和 View Transition 恢复路径从这里读取当前声明值。 */
  style?: {
    /** `Props.display` 当前声明的 CSS display，隐藏/解除隐藏时用于恢复。 */
    display?: string,
    /** `Props.viewTransitionName` 声明的 CSS view-transition-name；临时过渡名称恢复时读取。 */
    viewTransitionName?: string,
    /** `Props.view-transition-name` view-transition-name 的 CSS 拼写形式。 */
    'view-transition-name'?: string,
    /** `Props.viewTransitionClass` 声明的 CSS view-transition-class，用于匹配过渡伪元素样式。 */
    viewTransitionClass?: string,
    /** `Props.view-transition-class` view-transition-class 的 CSS 拼写形式。 */
    'view-transition-class'?: string,
    /** `Props.margin` 声明的 CSS margin；临时 inline-block 调整恢复时读取。 */
    margin?: string,
    /** `Props.marginTop` 声明的 CSS margin-top。 */
    marginTop?: string,
    /** `Props.margin-top` margin-top 的 CSS 拼写形式。 */
    'margin-top'?: string,
    /** `Props.marginBottom` 声明的 CSS margin-bottom。 */
    marginBottom?: string,
    /** `Props.margin-bottom` margin-bottom 的 CSS 拼写形式。 */
    'margin-bottom'?: string,
    ...
  },
  /** `Props.bottom` props 类型保留的可选数值 bottom 字段。 */
  bottom?: null | number,
  /** `Props.left` props 类型保留的可选数值 left 字段。 */
  left?: null | number,
  /** `Props.right` props 类型保留的可选数值 right 字段。 */
  right?: null | number,
  /** `Props.top` props 类型保留的可选数值 top 字段。 */
  top?: null | number,
  /** `Props.is` 创建定制内置元素时传给 createElement 的 is 选项。 */
  is?: string,
  /** `Props.size` select 等控件的可见尺寸；创建 select 时需在添加 option 前设置。 */
  size?: number,
  /** `Props.value` 表单控件当前的受控值。 */
  value?: string,
  /** `Props.defaultValue` 表单控件的默认值，供初始状态和原生 reset 使用。 */
  defaultValue?: string,
  /** `Props.checked` input 当前的受控勾选状态。 */
  checked?: boolean,
  /** `Props.defaultChecked` input 的默认勾选状态。 */
  defaultChecked?: boolean,
  /** `Props.multiple` select 是否允许多选，创建时需在添加 option 前确定。 */
  multiple?: boolean,
  /** `Props.type` DOM type 属性；script 分支用它区分可执行脚本与数据块。 */
  type?: string,
  /** `Props.src` 图片、脚本等元素的来源；启用 srcObject 时也可接收 Blob 或媒体对象。 */
  src?: string | Blob | MediaSource | MediaStream, //TODO：支持 Response。
  /** 图片候选 URL 与像素密度/尺寸描述；创建时晚于 sizes 等请求相关属性写入。 */
  srcSet?: string,
  /** `Props.loading` 图片 eager/lazy 加载模式；lazy 图片不参与此 HostConfig 的提交等待。 */
  loading?: 'eager' | 'lazy',
  /** `Props.onLoad` 用户的加载事件回调；显式提供时图片退出自动提交等待。 */
  onLoad?: (event: any) => void,
  ...
};
/** `RawProps` 尚未按宿主标签细化的原始 props。 */
type RawProps = {
  /** `RawProps.string` 其余 DOM 属性或资源选项，保留原始值。 */
  [string]: mixed,
};
/** `EventTargetChildElement` 事件目标子元素的标签与可选样式描述。 */
export type EventTargetChildElement = {
  /** `EventTargetChildElement.type` 子元素的宿主标签名。 */
  type: string,
  /** `EventTargetChildElement.props` 子元素的可选 props，包含定位样式描述。 */
  props: null | {
    /** `EventTargetChildElement.style` 子元素的可选内联样式。 */
    style?: {
      /** `EventTargetChildElement.position` 子元素的 CSS 定位模式。 */
      position?: string,
      /** `EventTargetChildElement.zIndex` 子元素的 CSS 层叠顺序。 */
      zIndex?: number,
      /** `EventTargetChildElement.bottom` CSS bottom 偏移。 */
      bottom?: string,
      /** `EventTargetChildElement.left` CSS left 偏移。 */
      left?: string,
      /** `EventTargetChildElement.right` CSS right 偏移。 */
      right?: string,
      /** `EventTargetChildElement.top` CSS top 偏移。 */
      top?: string,
      ...
    },
    ...
  },
  ...
};

/** `Container` 根或 Portal 的 DOM 容器；兼容旧版根的 _reactRootContainer 字段。 */
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
/** `Instance` HostComponent 对应的 DOM Element。 */
export type Instance = Element;
/** `TextInstance` HostText 对应的 DOM Text 节点。 */
export type TextInstance = Text;

/** `InstanceWithFragmentHandles` 可记录所属 Fragment 句柄集合的宿主元素。 */
type InstanceWithFragmentHandles = Instance & {
  /** `InstanceWithFragmentHandles.reactFragments` 包含此元素的 Fragment 句柄集合。 */
  reactFragments?: Set<FragmentInstanceType>,
};
/** `HostNodeWithFragmentHandles` 可记录所属 Fragment 句柄集合的元素或文本节点。 */
type HostNodeWithFragmentHandles = (Instance | TextInstance) & {
  /** `HostNodeWithFragmentHandles.reactFragments` 包含此宿主节点的 Fragment 句柄集合。 */
  reactFragments?: Set<FragmentInstanceType>,
};

/** `ActivityInterface` SSR Activity 边界的起始注释节点类型。 */
declare class ActivityInterface extends Comment {}
/** `SuspenseInterface` SSR Suspense 边界的起始注释节点，并携带 Fizz 可调用的重试入口。 */
declare class SuspenseInterface extends Comment {
  /** `_reactRetry` 客户端注册的边界重试回调，供 Fizz 完成或显示该边界时调用。 */
  _reactRetry: void | (() => void);
}

/** `ActivityInstance` SSR Activity 起始标记的宿主表示。 */
export type ActivityInstance = ActivityInterface;
/** `SuspenseInstance` SSR Suspense 起始标记的宿主表示。 */
export type SuspenseInstance = SuspenseInterface;

/** `FormStateMarkerInstance` Fizz 写出的表单 action 状态匹配注释。 */
type FormStateMarkerInstance = Comment;
/** `HydratableInstance` hydration 能认领的元素、文本、边界起始标记或表单状态标记。 */
export type HydratableInstance =
  | Instance
  | TextInstance
  | ActivityInstance
  | SuspenseInstance
  | FormStateMarkerInstance;
/** `PublicInstance` 公开给宿主 ref 等调用者的原生元素或文本节点。 */
export type PublicInstance = Element | Text;
/** `HostContextDev` 开发构建同时携带命名空间和 DOM 嵌套校验的祖先记录。 */
export type HostContextDev = {
  /** `HostContextDev.context` 当前 DOM 命名空间。 */
  context: HostContextProd,
  /** `HostContextDev.ancestorInfo` DOM 嵌套校验需要的宿主祖先记录。 */
  ancestorInfo: AncestorInfoDev,
};
/** `HostContextProd` 生产构建只需传递当前宿主命名空间。 */
type HostContextProd = HostContextNamespace;
/** `HostContext` 创建和校验后代 DOM 节点所需的命名空间上下文。 */
export type HostContext = HostContextDev | HostContextProd;
/** `UpdatePayload` HostConfig 导出的更新数据类型；本文件的 commitUpdate 直接比较新旧 props。 */
export type UpdatePayload = Array<mixed>;
/** `ChildSet` DOM mutation renderer 不使用 persistence 的子节点集合。 */
export type ChildSet = void; //未使用
/** `TimeoutHandle` 浏览器定时器返回的句柄。 */
export type TimeoutHandle = TimeoutID;
/** `NoTimeout` 未安排定时器的 -1 哨兵类型。 */
export type NoTimeout = -1;
/** `RendererInspectionConfig` 此 renderer 的额外检查配置为空对象。 */
export type RendererInspectionConfig = $ReadOnly<{}>;

/** `TransitionStatus` 宿主 form action 通过 context 暴露的 FormStatus。 */
export type TransitionStatus = FormStatus;

/** `ViewTransitionInstance` 一个名称对应的四种 View Transition 伪元素操作句柄。 */
export type ViewTransitionInstance = {
  /** `ViewTransitionInstance.name` 快照名称，四个伪元素句柄均使用它构造选择器。 */
  name: string,
  /** `ViewTransitionInstance.group` ::view-transition-group(name) 操作句柄。 */
  group: mixin$Animatable,
  /** `ViewTransitionInstance.imagePair` ::view-transition-image-pair(name) 操作句柄。 */
  imagePair: mixin$Animatable,
  /** `ViewTransitionInstance.old` ::view-transition-old(name) 旧快照操作句柄。 */
  old: mixin$Animatable,
  /** `ViewTransitionInstance.new` ::view-transition-new(name) 新快照操作句柄。 */
  new: mixin$Animatable,
};

/** `SelectionInformation` mutation 前保存的焦点元素和选择区，供 resetAfterCommit 恢复。 */
type SelectionInformation = {
  /** `SelectionInformation.focusedElem` 提交前捕获的焦点元素。 */
  focusedElem: null | HTMLElement,
  /** `SelectionInformation.selectionRange` 该元素提交前的文本选择区。 */
  selectionRange: mixed,
};

/** `SUPPRESS_HYDRATION_WARNING` 读取 props 中 suppressHydrationWarning 的属性名。 */
const SUPPRESS_HYDRATION_WARNING = 'suppressHydrationWarning';

/** `ACTIVITY_START_DATA` Fizz Activity 边界的起始注释内容。 */
const ACTIVITY_START_DATA = '&';
/** `ACTIVITY_END_DATA` Fizz Activity 边界的结束注释内容。 */
const ACTIVITY_END_DATA = '/&';
/** `SUSPENSE_START_DATA` 内容已完成的 Fizz Suspense 边界起始标记。 */
const SUSPENSE_START_DATA = '$';
/** `SUSPENSE_END_DATA` Fizz Suspense 边界的结束标记。 */
const SUSPENSE_END_DATA = '/$';
/** `SUSPENSE_PENDING_START_DATA` 仍等待服务器内容的 Suspense 起始标记。 */
const SUSPENSE_PENDING_START_DATA = '$?';
/** `SUSPENSE_QUEUED_START_DATA` Fizz 已将完成内容排队等待显示的 Suspense 起始标记。 */
const SUSPENSE_QUEUED_START_DATA = '$~';
/** `SUSPENSE_FALLBACK_START_DATA` 服务器放弃完成、需转为客户端渲染的 Suspense 起始标记。 */
const SUSPENSE_FALLBACK_START_DATA = '$!';
/** `PREAMBLE_CONTRIBUTION_HTML` 边界向文档 html 单例贡献属性的 Fizz 标记。 */
const PREAMBLE_CONTRIBUTION_HTML = 'html';
/** `PREAMBLE_CONTRIBUTION_BODY` 边界向文档 body 单例贡献属性的 Fizz 标记。 */
const PREAMBLE_CONTRIBUTION_BODY = 'body';
/** `PREAMBLE_CONTRIBUTION_HEAD` 边界向文档 head 单例贡献属性或子节点的 Fizz 标记。 */
const PREAMBLE_CONTRIBUTION_HEAD = 'head';
/** `FORM_STATE_IS_MATCHING` 此 action 状态槽与服务器返回的表单状态匹配的标记。 */
const FORM_STATE_IS_MATCHING = 'F!';
/** `FORM_STATE_IS_NOT_MATCHING` 此 action 状态槽与服务器返回的表单状态不匹配的标记。 */
const FORM_STATE_IS_NOT_MATCHING = 'F';

/** `DOCUMENT_READY_STATE_LOADING` 文档还在解析时的 readyState 值，用于决定是否继续等待 Fizz。 */
const DOCUMENT_READY_STATE_LOADING = 'loading';

/** `STYLE` 读取 props 中 style 对象的属性名。 */
const STYLE = 'style';

/** `HostContextNamespace` 以 0、1、2 区分默认、SVG、MathML 宿主命名空间。 */
opaque type HostContextNamespace = 0 | 1 | 2;
/** `HostContextNamespaceNone` 默认 HTML 命名空间上下文。 */
export const HostContextNamespaceNone: HostContextNamespace = 0;
/** `HostContextNamespaceSvg` SVG 命名空间上下文。 */
const HostContextNamespaceSvg: HostContextNamespace = 1;
/** `HostContextNamespaceMath` MathML 命名空间上下文。 */
const HostContextNamespaceMath: HostContextNamespace = 2;

let eventsEnabled: ?boolean = null;
let selectionInformation: null | SelectionInformation = null;

export * from 'react-reconciler/src/ReactFiberConfigWithNoPersistence';

/** `getOwnerDocumentFromRootContainer` 容器为 Document 时直接返回它，否则取 ownerDocument，确保节点创建在容器所属文档。 */
function getOwnerDocumentFromRootContainer(
  rootContainerElement: Element | Document | DocumentFragment,
): Document {
  return rootContainerElement.nodeType === DOCUMENT_NODE
    ? (rootContainerElement as any)
    : rootContainerElement.ownerDocument;
}

/** `getRootHostContext` 从根容器的命名空间计算后代上下文；开发构建还初始化 DOM 祖先校验记录。 */
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

/** `getOwnHostContext` 将 DOM namespaceURI 映射为默认、SVG 或 MathML 上下文。 */
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

/** `getChildHostContextProd` 处理 svg/math 入口和 SVG foreignObject 出口，其余后代继承父命名空间。 */
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

/** `getChildHostContext` 计算后代命名空间；开发构建同时推进祖先校验记录。 */
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

/** `getPublicInstance` DOM renderer 直接将原生实例公开给 ref 等调用者。 */
export function getPublicInstance(instance: Instance): Instance {
  return instance;
}

/** `prepareForCommit` mutation 前保存焦点、选择区和事件开关，并暂停 React 事件分发；可返回当前焦点的 Fiber。 */
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

/** `beforeActiveInstanceBlur` 焦点子树移除或隐藏前，临时启用事件分发并发送 beforeblur，再关闭分发。 */
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

/** `afterActiveInstanceBlur` 焦点子树处理后，临时启用事件分发，在 document 上发送 afterblur，再关闭分发。 */
export function afterActiveInstanceBlur(): void {
  if (enableCreateEventHandleAPI) {
    ReactBrowserEventEmitterSetEnabled(true);
    dispatchAfterDetachedBlur((selectionInformation as any).focusedElem);
    ReactBrowserEventEmitterSetEnabled(false);
  }
}

/** `resetAfterCommit` mutation 后、layout 前恢复选择区和原事件开关，并清空提交快照。 */
export function resetAfterCommit(containerInfo: Container): void {
  restoreSelection(selectionInformation, containerInfo);
  ReactBrowserEventEmitterSetEnabled(eventsEnabled);
  eventsEnabled = null;
  selectionInformation = null;
}

/** `createHoistableInstance` beginWork 创建可提升的 DOM 元素，设置初始 props 并关联 Fiber；插入由后续 commit 路径负责。 */
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
/** `isScriptDataBlock` 根据 script 的非空 type 排除 JavaScript MIME 与特殊执行类型，判断是否为数据块脚本。 */
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
/** `warnedUnknownTags` 记录已经警告或允许的未知 HTML 标签，避免重复警告。 */
const warnedUnknownTags: {
  /** `key` 已允许或已发出未知标签警告的标签名。 */
  [key: string]: boolean,
} = {
  //<dialog> 有可用的 polyfill。让人们使用它。
  dialog: true,
  //Electron 提供了一个自定义的 <webview> 标签，用于在隔离的框架和进程中显示外部网页内容。这个标签在非 Electron 环境中不存在，例如 JSDom，JSDom 常用于测试目的。@see https://electronjs.org/docs/api/webview-tag
  webview: true,
};

/** `createInstance` completeWork 按命名空间创建未挂载元素并缓存 Fiber/props；通用初始属性在 finalizeInitialChildren 设置。 */
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

/** `cloneMutableInstance` 为手势过渡克隆元素，keepChildren 决定是否深克隆；开发构建警告 video/iframe 的重复加载风险。 */
export function cloneMutableInstance(
  instance: Instance,
  keepChildren: boolean,
): Instance {
  if (__DEV__) {
    //克隆 video/iframe 可能重复加载，开发期对此发出一次警告。
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

/** `appendInitialChild` completeWork 将子节点组装到尚未挂载的父元素，直接使用 appendChild。 */
export function appendInitialChild(
  parentInstance: Instance,
  child: Instance | TextInstance,
): void {
  //注意：这不应该使用 moveBefore()，因为初始项是在未连接时追加的。
  parentInstance.appendChild(child);
}

/** `finalizeInitialChildren` completeWork 设置初始 DOM 属性；返回 true 为 autoFocus 控件或 img 安排后续 layout 的 commitMount。 */
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

/** `finalizeHydratedChildren` 开启 hydration change event 时，为表单控件和 img 标记后续 commitHydratedInstance 工作。 */
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

/** `shouldSetTextContent` 判断内容是否由宿主直接设置，以便 reconciler 跳过普通子 Fiber 的创建。 */
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

/** `createTextInstance` completeWork 在容器所属文档创建未挂载 Text 并缓存 Fiber；开发构建先校验文本嵌套。 */
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

/** `cloneMutableTextInstance` 为手势过渡复制 Text 节点。 */
export function cloneMutableTextInstance(
  textInstance: TextInstance,
): TextInstance {
  return textInstance.cloneNode(false);
}

let currentPopstateTransitionEvent: Event | null = null;
/** `shouldAttemptEagerTransition` 同一个 popstate 事件只允许一次 eager transition 尝试，并缓存事件以识别后续派生更新。 */
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
/** `trackSchedulerEvent` 记住进入 Scheduler 时的 window.event，后续事件查询排除这个旧事件。 */
export function trackSchedulerEvent(): void {
  schedulerEvent = window.event;
}

/** `resolveEventType` 返回不同于已记录 Scheduler 事件的当前事件类型；没有新事件时返回 null。 */
export function resolveEventType(): null | string {
  const event = window.event;
  return event && event !== schedulerEvent ? event.type : null;
}

/** `resolveEventTimeStamp` 返回不同于已记录 Scheduler 事件的时间戳；没有新事件时返回 -1.1。 */
export function resolveEventTimeStamp(): number {
  const event = window.event;
  return event && event !== schedulerEvent ? event.timeStamp : -1.1;
}

/** `isPrimaryRenderer` DOM 使用 React context 的主 renderer 存储槽。 */
export const isPrimaryRenderer = true;
/** `warnsIfNotActing` 允许 reconciler 在测试更新未被 act 包裹时发出警告。 */
export const warnsIfNotActing = true;
/** 缓存可用的setTimeout供reconciler调度宿主延迟任务；仅导入ReactDOM也会初始化本模块，无该全局API的环境导出undefined而不在导入时抛错。 */
export const scheduleTimeout: any =
  typeof setTimeout === 'function' ? setTimeout : (undefined as any);
/** `cancelTimeout` 使用可用的 clearTimeout 取消宿主定时器；非浏览器环境可能没有该函数。 */
export const cancelTimeout: any =
  typeof clearTimeout === 'function' ? clearTimeout : (undefined as any);
/** `noTimeout` 表示当前没有定时器的 -1 哨兵。 */
export const noTimeout: -1 = -1;
/** `localPromise` 缓存可用的 Promise 构造器，作为 queueMicrotask 的备用实现。 */
const localPromise = typeof Promise === 'function' ? Promise : undefined;
/** `localRequestAnimationFrame` 使用 requestAnimationFrame；不可用时退回宿主定时器。 */
const localRequestAnimationFrame =
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : scheduleTimeout;

export {getClosestInstanceFromNode as getInstanceFromNode};

/** `preparePortalMount` 为 Portal 容器安装 React 支持的事件监听器。 */
export function preparePortalMount(portalInstance: Instance): void {
  listenToAllSupportedEvents(portalInstance);
}

/** `prepareScopeUpdate` 开启 Scope API 时，将 Scope 实例关联到当前 Fiber。 */
export function prepareScopeUpdate(
  scopeInstance: ReactScopeInstance,
  internalInstanceHandle: Object,
): void {
  if (enableScopeAPI) {
    precacheFiberNode(internalInstanceHandle, scopeInstance);
  }
}

/** `getInstanceFromScope` 开启 Scope API 时读取 Scope 关联的 Fiber，否则返回 null。 */
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
/** reconciler 可使用宿主微任务入口安排根调度，具体备用实现由 scheduleMicrotask 决定。 */
export const supportsMicrotasks = true;
/** `scheduleMicrotask` 优先 queueMicrotask，其次 Promise，最后定时器；Promise 回调错误交给下一任务重新抛出。 */
export const scheduleMicrotask: any =
  typeof queueMicrotask === 'function'
    ? queueMicrotask
    : typeof localPromise !== 'undefined'
      ? callback =>
          localPromise.resolve(null).then(callback).catch(handleErrorInNextTick)
      : scheduleTimeout; //待办：在这里确定最佳备用方案。

/** `handleErrorInNextTick` 在定时器任务中重新抛出 Promise 微任务回调的错误。 */
function handleErrorInNextTick(error: any) {
  setTimeout(() => {
    throw error;
  });
}

// -------------------
//mutation
// -------------------

/** `supportsMutation` DOM 通过 mutation 提交修改现有节点。 */
export const supportsMutation = true;

/** `commitMount` 初次挂载的 layout 工作：聚焦 autoFocus 控件，或重新设置 img 的 src/srcSet 以补获加载事件。 */
export function commitMount(
  domElement: Instance,
  type: string,
  newProps: Props,
  internalInstanceHandle: Object,
): void {
  //初次客户端挂载的 Update 标记来自 finalizeInitialChildren；此时节点已经插入，layout 路径调用本函数。hydration 使用单独的 commitHydratedInstance。
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
      //render 设置 src 时图片可能已发出 load，但节点尚未提交。这里重新赋值，给浏览器再次发出 load 的机会；优先 src，只有缺少 src 才使用 srcSet。
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

/**
 * hydration-change 特性开启时的 layout 工作：以初始 props 建立表单 tracker 或比较 option 选择，保留已有用户输入。
 * 发现 DOM 与初始 props 不同时由 hydrateInput/hydrateSelect/hydrateTextarea 排队 change 事件。
 * img 当前仅保留分支占位；不重新执行 autoFocus。
 */
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

/** `commitUpdate` mutation 中比较新旧 props 并更新 DOM，随后缓存新 props 供事件系统读取。 */
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

/** `resetTextContent` ContentReset 的宿主操作，清空原本由父元素直接管理的文本内容。 */
export function resetTextContent(domElement: Instance): void {
  setTextContent(domElement, '');
}

/**
 * 将 Text 节点的 nodeValue 直接写成第三个实参，不比较当前值也不读取 oldText。
 * 普通 commitHostTextUpdate 以 oldText/newText 顺序调用；gesture 克隆路径实际反向传入
 * finished/current 文本，因此该次写入取 current 文本，不能仅按调用方变量名判断结果。
 *
 * @param textInstance 要更新的原 Text 或克隆 Text 节点。
 * @param oldText HostConfig 兼容参数，本 DOM 实现不消费。
 * @param newText 实际写入 nodeValue 的第三个位置参数。
 */
export function commitTextUpdate(
  textInstance: TextInstance,
  oldText: string,
  newText: string,
): void {
  textInstance.nodeValue = newText;
}

/** `supportsMoveBefore` 同时检查 feature flag 与浏览器 moveBefore 能力，决定移动已挂载节点时采用哪个 API。 */
const supportsMoveBefore =
  // $FlowFixMe[prop-missing]: We're doing the feature detection here.
  enableMoveBefore &&
  typeof window !== 'undefined' &&
  typeof window.Element.prototype.moveBefore === 'function';

/** `appendChild` mutation 中将节点放到父元素末尾；节点已有 parentNode 且支持 moveBefore 时使用移动 API。 */
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

/** `warnForReactChildrenConflict` 开发期检查容器是否同时由 React 的文本 children 或 innerHTML 管理，并记录一次警告。 */
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
          //用容器 Fiber 的组件堆栈报告冲突；当前执行中的 Fiber 是新插入的子节点，不能指出定义容器内容的位置。
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

/** `appendChildToContainer` 将节点追加到根或 Portal；Document/html 使用 body，旧注释容器插到标记前，并为普通容器补点击冒泡兼容。 */
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

/** `insertBefore` mutation 中将节点放到宿主兄弟前，已有 parentNode 的节点可使用 moveBefore。 */
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

/** `insertInContainerBefore` 解析根或 Portal 的实际父节点，再将节点插到指定宿主兄弟前。 */
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

/** `isSingletonScope` head 单例拥有独立 hydration 游标作用域；html/body 沿用当前游标。 */
export function isSingletonScope(type: string): boolean {
  return type === 'head';
}

/** `createEvent` 创建并初始化 beforeblur/afterblur 使用的原生 Event。 */
function createEvent(type: DOMEventName, bubbles: boolean): Event {
  const event = document.createEvent('Event');
  event.initEvent(type as any as string, bubbles, false);
  return event;
}

/** `dispatchBeforeDetachedBlur` 在即将失去焦点的目标上发送冒泡 beforeblur，并附上被移除子树的 Fiber 供事件系统截断传播。 */
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

/** `dispatchAfterDetachedBlur` 在 document 上发送不冒泡的 afterblur，relatedTarget 指向被分离的焦点元素。 */
function dispatchAfterDetachedBlur(target: HTMLElement): void {
  if (enableCreateEventHandleAPI) {
    const event = createEvent('afterblur', false);
    //因此我们知道被分离的内容，在“afterblur”事件中将 relatedTarget 设置为被分离的目标。
    (event as any).relatedTarget = target;
    //在文档上分发事件。
    document.dispatchEvent(event);
  }
}

/** `removeChild` 从指定宿主父元素移除该 DOM 节点。 */
export function removeChild(
  parentInstance: Instance,
  child: Instance | TextInstance | SuspenseInstance | ActivityInstance,
): void {
  parentInstance.removeChild(child);
}

/** `removeChildFromContainer` 解析根或 Portal 的实际父节点，再移除该 DOM 节点。 */
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

/** `clearHydrationBoundary` 按嵌套深度移除边界起止标记及中间兄弟节点，清理其单例贡献，并重试被边界阻塞的事件。 */
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

/** `clearActivityBoundary` 在宿主父元素中删除 Activity 的 dehydrated 标记范围。 */
export function clearActivityBoundary(
  parentInstance: Instance,
  activityInstance: ActivityInstance,
): void {
  clearHydrationBoundary(parentInstance, activityInstance);
}

/** `clearSuspenseBoundary` 在宿主父元素中删除 Suspense 的 dehydrated 标记范围。 */
export function clearSuspenseBoundary(
  parentInstance: Instance,
  suspenseInstance: SuspenseInstance,
): void {
  clearHydrationBoundary(parentInstance, suspenseInstance);
}

/** `clearHydrationBoundaryFromContainer` 解析容器实际父节点后删除 dehydrated 范围，并重试被容器阻塞的事件。 */
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

/** `clearActivityBoundaryFromContainer` 从根或 Portal 容器删除 Activity 的 dehydrated 标记范围。 */
export function clearActivityBoundaryFromContainer(
  container: Container,
  activityInstance: ActivityInstance,
): void {
  clearHydrationBoundaryFromContainer(container, activityInstance);
}

/** `clearSuspenseBoundaryFromContainer` 从根或 Portal 容器删除 Suspense 的 dehydrated 标记范围。 */
export function clearSuspenseBoundaryFromContainer(
  container: Container,
  suspenseInstance: SuspenseInstance,
): void {
  clearHydrationBoundaryFromContainer(container, suspenseInstance);
}

/** `hideOrUnhideDehydratedBoundary` 沿 dehydrated 范围的兄弟节点保存或恢复 display/nodeValue；以 Suspense 起止标记维护嵌套深度。 */
function hideOrUnhideDehydratedBoundary(
  suspenseInstance: SuspenseInstance | ActivityInstance,
  isHidden: boolean,
) {
  let node: Node = suspenseInstance;
  //沿标记范围隐藏或恢复元素和文本；此循环以 Suspense 标记处理嵌套深度。
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

/** `hideDehydratedBoundary` 暂存并隐藏 dehydrated Suspense 范围的元素和文本。 */
export function hideDehydratedBoundary(
  suspenseInstance: SuspenseInstance,
): void {
  hideOrUnhideDehydratedBoundary(suspenseInstance, true);
}

/** `hideInstance` mutation 中用 display:none 隐藏保留的宿主元素；支持 setProperty 时加 important。 */
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

/** `hideTextInstance` 清空保留的 Text 节点，使隐藏子树不显示文本。 */
export function hideTextInstance(textInstance: TextInstance): void {
  textInstance.nodeValue = '';
}

/** `unhideDehydratedBoundary` 恢复 dehydrated 范围中暂存的 display 和文本内容。 */
export function unhideDehydratedBoundary(
  dehydratedInstance: SuspenseInstance | ActivityInstance,
): void {
  hideOrUnhideDehydratedBoundary(dehydratedInstance, false);
}

/** `unhideInstance` 按当前 props.style.display 恢复元素，未指定 display 时清除 React 临时隐藏样式。 */
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

/** `unhideTextInstance` 将保留 Text 的 nodeValue 恢复为当前文本。 */
export function unhideTextInstance(
  textInstance: TextInstance,
  text: string,
): void {
  textInstance.nodeValue = text;
}

/** `warnForBlockInsideInline` 开发期遍历 inline 元素的 DOM 后代，发现 block 子元素时警告 Safari View Transition 名称问题。 */
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

/** `countClientRects` 单矩形直接计为 1；多矩形时只统计宽高均大于零的矩形。 */
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

/** `applyViewTransitionName` 为快照写入临时 transition name/class；单矩形 inline 元素还调整 display 和上下 margin。 */
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
      //只有一个非空矩形时，临时改为 inline-block 或 block 以绕过 WebKit 的快照问题；这次样式写入可能触发布局计算。
      const style = instance.style;
      //如果实际上只有一个矩形，那么它很可能在单独一行上，就像一个行内块。如果有多个矩形，但除一个之外的所有矩形都是空的，这很可能是因为是一个块导致了换行。
      style.display = rects.length === 1 ? 'inline-block' : 'block';
      //边距不适用于行内元素，所以应该为零。然而，上下内边距适用于行内块布局，我们可以通过将边距设置为负内边距来抵消，以使其回到原来的位置。
      style.marginTop = '-' + computedStyle.paddingTop;
      style.marginBottom = '-' + computedStyle.paddingBottom;
    } else {
      //多个非空矩形无法直接改成单一块盒；仅在发现 block 后代时发出开发期警告。
      warnForBlockInsideInline(instance);
    }
  }
}

/** `restoreViewTransitionName` 从当前 props 恢复 transition name/class，并在临时 inline-block 分支恢复 display 和 margin。 */
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

/** `cancelViewTransitionName` 捕获新快照前恢复元素名称，并用零时长动画隐藏已捕获的旧 group。 */
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

/** `cancelRootViewTransitionName` 未自定义根名称时关闭默认 root 快照，并将顶层过渡层缩为零，保留未动画区域的交互。 */
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

/** `restoreRootViewTransitionName` 清除手势容器临时的 root 名称，以及 documentElement 临时的 none 名称。 */
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

/** `getComputedTransform` 把 computed translate、rotate、scale 与 transform 按应用顺序合为一个 transform 字符串。 */
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

/** `moveOutOfViewport` 合并原变换并加入 -20000px 平移，使手势克隆仍可被捕获而不出现在可见视口。 */
function moveOutOfViewport(
  originalStyle: CSSStyleDeclaration,
  element: HTMLElement,
): void {
  //应用一个变换，将整个元素安全地放置在视口外，同时仍允许它将“旧”状态渲染到快照中。
  const transform = getComputedTransform(originalStyle);
  //清除 translate/scale/rotate 独立属性，避免与合并后的 transform 重复应用。
  // $FlowFixMe[prop-missing]
  element.style.translate = 'none';
  // $FlowFixMe[prop-missing]
  element.style.scale = 'none';
  // $FlowFixMe[prop-missing]
  element.style.rotate = 'none';
  //应用一个平移（translate）将它移出视口。这首先应用，这样它就在父元素的坐标空间中，而不是在应用其他变换之后。这就是为什么我们需要合并长格式属性的原因。TODO：理想情况下，我们应该调整父元素的旋转/缩放。否则，当我们将 ::view-transition-group 移回时，可能会超出或不足。
  element.style.transform = 'translate(-20000px, -20000px) ' + transform;
}

/** `moveOldFrameIntoViewport` 给旧关键帧的 transform 加回 20000px 平移，抵消克隆的视口外偏移。 */
function moveOldFrameIntoViewport(keyframe: any): void {
  //补偿自动生成动画首帧的克隆偏移。
  const computedTransform: ?string = keyframe.transform;
  if (computedTransform != null) {
    let transform = computedTransform === 'none' ? '' : computedTransform;
    transform = 'translate(20000px, 20000px) ' + transform;
    keyframe.transform = transform;
  }
}

/** `cloneRootViewTransitionContainer` 浅克隆根容器，按原位置绝对定位后移出视口，插为原容器的后继兄弟并赋予 root 快照名称。 */
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

  //用克隆容器承载 root 旧快照，随后将同名快照接回原始容器。
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

/** `removeRootViewTransitionClone` 删除手势根克隆，并把临时 root 名称转回原容器，等待 restoreRootViewTransitionName 清除。 */
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

/** `InstanceMeasurement` View Transition 比较用的矩形、脱离文档流、裁剪和视口相交信息。 */
export type InstanceMeasurement = {
  /** `InstanceMeasurement.rect` 捕获时的元素位置和尺寸。 */
  rect: ClientRect | DOMRect,
  /** `InstanceMeasurement.abs` position 为 absolute/fixed，表示元素脱离普通文档流。 */
  abs: boolean, //绝对定位
  /** computed style 存在裁剪条件；新测量命中时 hasInstanceChanged 直接让该边界参与快照。 */
  clip: boolean, //样式可能裁剪后代快照。
  /** 捕获矩形与所属 window 视口相交；不检查被其他元素遮挡。 */
  view: boolean, //矩形与视口相交。
};

/** `createMeasurement` 将矩形与 computed style 汇总为快照，记录是否脱离文档流、可能裁剪和位于视口范围内。 */
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
      //记录可能裁剪后代的样式条件，后续比较会让这样的边界参与快照过渡。
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

/** `measureInstance` 读取元素矩形与 computed style，形成 View Transition 比较快照。 */
export function measureInstance(instance: Instance): InstanceMeasurement {
  const rect = instance.getBoundingClientRect();
  const computedStyle = getComputedStyle(instance);
  return createMeasurement(rect, computedStyle, instance);
}

/** `measureClonedInstance` 测量视口外克隆，并将坐标加回 20000px 后形成比较快照。 */
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

/** `wasInstanceInViewport` 读取测量时保存的视口相交结果。 */
export function wasInstanceInViewport(
  measurement: InstanceMeasurement,
): boolean {
  return measurement.view;
}

/** `hasInstanceChanged` 裁剪边界直接判为变化，否则比较两次矩形的位置和尺寸。 */
export function hasInstanceChanged(
  oldMeasurement: InstanceMeasurement,
  newMeasurement: InstanceMeasurement,
): boolean {
  //注意：在视图过渡的实例被替换的情况下，这并不保证来自同一个实例，但它仍然是相同的视图过渡实例。
  if (newMeasurement.clip) {
    //新测量带有裁剪条件时直接返回 true，使该边界参与过渡以保留后代快照的裁剪。
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

/** `hasInstanceAffectedParent` 比较尺寸变化是否影响父布局；新旧均脱离文档流时不影响父布局。 */
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

/** View Transition应用mutation后等待新字体/视口图片的500ms race上限；资源完成、失败或超时都进入layout，此值不限制另行等待的navigation.finished。 */
const SUSPENSEY_FONT_AND_IMAGE_TIMEOUT = 500;

/** `customizeViewTransitionError` 过滤可忽略的中止或无效状态错误；开发期为部分错误补充说明，其他错误原样返回。 */
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

/** 读取 documentElement.clientHeight 强制布局，触发新字体加载；把读取结果返回以保留压缩后的副作用。 */
/**
 * @noinline
 */
function forceLayout(ownerDocument: Document) {
  //此函数存在的目的是为了欺骗压缩工具不移除这个未使用的成员表达式。
  return (ownerDocument.documentElement as any).clientHeight;
}

/** `waitForImageToLoad` 将图片 load/error 事件接到等待 Promise 的 resolve，任一结果都解除等待。 */
function waitForImageToLoad(this: HTMLImageElement, resolve: () => void) {
  //待办：一旦 https://issues.chromium.org/issues/420748301 的修复完全传播开来，在这里使用 decode() 替代 load 事件。
  this.addEventListener('load', resolve);
  this.addEventListener('error', resolve);
}

/**
 * 启动浏览器 View Transition，把 reconciler 提交阶段接到旧/新快照捕获之间的 update 回调。
 * mutation 后最多等 500ms 新字体与预算内视口图片，再执行 layout；提交前已存在的导航完成后执行 after-mutation。
 * ready 收集动画并放行 spawned work，finished 清理动画和当前过渡引用并冲刷 passive。
 * ready 拒绝或启动同步失败时，通过 reconciler 回调的阶段守卫补完 mutation/layout/spawned work，跳过动画测量。
 *
 * @param suspendedState - 先前提交资源收集得到的图片列表；不等待不可见图片，预算不足时撤回图片等待但保留字体等待。
 */
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
      /** `startViewTransition.update` 先记录既有导航，再执行 mutation；按需等待新字体和视口图片后执行 layout，导航结束后执行 after-mutation。 */
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

    /** `startViewTransition.readyCallback` 快照就绪后收集伪元素动画，尝试移除冗余尺寸关键帧，再放行 spawned work。 */
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
              //伪元素基础尺寸与关键帧不同，恢复首末关键帧的宽高覆盖。
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
    /** `startViewTransition.handleError` 报告未忽略的 ready 错误，并通过 reconciler 的阶段守卫补完 mutation/layout/spawned work，跳过动画测量。 */
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
    //startViewTransition 缺失、不支持对象参数等同步失败时，补完提交阶段并回退到无动画路径。
    mutationCallback();
    layoutCallback();
    //跳过 afterMutationCallback()。我们不需要它，因为我们没有在做动画。
    if (enableProfilerTimer) {
      finishedAnimation();
    }
    spawnedWorkCallback();
    //此处不直接调用 passiveCallback；spawnedWorkCallback 会按 lanes 和剩余工作安排或冲刷 passive。
    return null;
  }
}

/** `RunningViewTransition` 浏览器运行中过渡的最小接口，供 reconciler 跳过动画或等待结束。 */
export type RunningViewTransition = {
  /** `RunningViewTransition.skipTransition` 请求浏览器跳过当前过渡动画。 */
  skipTransition(): void,
  /** `RunningViewTransition.finished` 过渡结束的 Promise；中止时也可能拒绝。 */
  finished: Promise<void>,
  ...
};

/** `mergeTranslate` 按坐标分量用 CSS calc 合并两个 translate；空值或 none 直接使用另一个值。 */
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

/** `animateGesture` 调整快照关键帧的视口偏移与尺寸，将线性动画绑定到原生或自定义手势时间线，并保存清理入口。 */
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
      //原生 rangeStart 需不大于 rangeEnd；反向范围交换端点，并用 direction 调整播放方向。
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

/** `startGestureTransition` 捕获手势目标快照，ready 时将浏览器动画改由手势时间线驱动；失败时仍完成 mutation 和状态恢复。 */
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
    /** `startGestureTransition.readyCallback` 收集 group/new 动画和最长时长，映射为手势范围并校正旧快照偏移，最后调用 animateCallback 恢复提交状态。 */
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
                true, //由 animateGesture 补偿视口外平移。
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
    /** Chrome 等下一帧才能查询 new 伪元素动画，其他浏览器直接执行 readyCallback，避免 Safari 延迟设置产生闪烁。 */
    const readyForAnimations =
      navigator.userAgent.indexOf('Chrome') !== -1
        ? () => requestAnimationFrame(readyCallback)
        : readyCallback;
    /** `startGestureTransition.handleError` 过滤允许忽略的中止错误，并补完 mutation/animateCallback 以恢复手势提交状态。 */
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
    //startViewTransition 缺失、不支持对象参数等同步失败时，补做 mutation 和 animateCallback，恢复手势提交状态。
    mutationCallback();
    animateCallback();
    if (enableProfilerTimer) {
      finishedAnimation();
    }
    return null;
  }
}

/** `stopViewTransition` 调用浏览器 skipTransition，提前结束该过渡的动画。 */
export function stopViewTransition(transition: RunningViewTransition) {
  transition.skipTransition();
}

/** `addViewTransitionFinishedListener` 在 finished Promise 成功或失败后运行结束回调。 */
export function addViewTransitionFinishedListener(
  transition: RunningViewTransition,
  callback: () => void,
) {
  transition.finished.finally(callback);
}

/** `ViewTransitionPseudoElementType` 将伪元素选择器包装为动画、动画查询和样式查询接口。 */
interface ViewTransitionPseudoElementType extends mixin$Animatable {
  /** `ViewTransitionPseudoElementType._scope` 承载伪元素动画的 documentElement。 */
  _scope: HTMLElement;
  /** `ViewTransitionPseudoElementType._selector` 当前名称对应的完整伪元素选择器。 */
  _selector: string;
  /** `ViewTransitionPseudoElementType.getComputedStyle` 读取该伪元素的 computed style。 */
  getComputedStyle(): CSSStyleDeclaration;
}

/** `ViewTransitionPseudoElement` 保存全局 documentElement 和指定名称的伪元素选择器；原型方法将操作转发到该作用域。 */
function ViewTransitionPseudoElement(
  this: ViewTransitionPseudoElementType,
  pseudo: string,
  name: string,
) {
  //待办：从根容器获取所属文档。
  this._scope = document.documentElement as any;
  this._selector = '::view-transition-' + pseudo + '(' + name + ')';
}
/** 把 Animation 选项复制成对象并绑定本句柄的伪元素选择器，再转发 documentElement.animate。 */
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
/** 查询作用域下的动画，仅返回 effect.target 和 pseudoElement 都匹配当前句柄的项。 */
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
      /** `target` 该动画 effect 的目标元素，用于排除其他作用域的动画。 */
      target?: Element,
      /** `pseudoElement` 该动画 effect 的伪元素选择器，用于匹配当前句柄。 */
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
/** 读取此句柄选择器对应的伪元素 computed style，沿用创建时保存的 documentElement。 */
// $FlowFixMe[prop-missing]
ViewTransitionPseudoElement.prototype.getComputedStyle = function (
  this: ViewTransitionPseudoElementType,
): CSSStyleDeclaration {
  const scope = this._scope;
  const selector = this._selector;
  return getComputedStyle(scope, selector);
};

/** `createViewTransitionInstance` 为一个名称构造 group、image-pair、old、new 四个伪元素句柄。 */
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

/** `CustomTimeline` 调用者提供的手势时间线：提供当前数值并接管 Animation 的驱动。 */
interface CustomTimeline {
  /** `CustomTimeline.currentTime` 当前手势进度的数值，供 offset 查询读取。 */
  currentTime: number;
  /** `CustomTimeline.animate` 接管给定 Animation 的驱动，可返回结束时的清理函数。 */
  animate(animation: Animation): void | (() => void);
}

/** `GestureTimeline` 手势支持原生 AnimationTimeline 或调用者实现的 CustomTimeline。 */
export type GestureTimeline = AnimationTimeline | CustomTimeline;

/** `getCurrentGestureOffset` 读取时间线当前数值；原生百分比时间取 value，未连接的时间线抛错。 */
export function getCurrentGestureOffset(timeline: GestureTimeline): number {
  const time = timeline.currentTime;
  if (time === null) {
    throw new Error(
      'Cannot start a gesture with a disconnected AnimationTimeline.',
    );
  }
  return typeof time === 'number' ? time : time.value;
}

/** `StoredEventListener` Fragment 保存的原生监听器注册记录，用于当前及后续加入的宿主子节点。 */
type StoredEventListener = {
  /** `StoredEventListener.type` 原生事件类型。 */
  type: string,
  /** `StoredEventListener.listener` 原生事件回调。 */
  listener: EventListener,
  /** `StoredEventListener.optionsOrUseCapture` 传给原生监听 API 的选项；本地查找只比较 capture。 */
  optionsOrUseCapture: void | EventListenerOptionsOrUseCapture,
};

/** `FragmentInstanceType` Fragment ref 的虚拟句柄，按 Fiber 子树向宿主节点投射事件、焦点、观察和位置操作。 */
export type FragmentInstanceType = {
  /** `FragmentInstanceType._fragmentFiber` 当前已提交的 Fragment Fiber，作为每次子树遍历的起点。 */
  _fragmentFiber: Fiber,
  /** `FragmentInstanceType._eventListeners` 登记到当前及未来宿主子节点的监听器记录。 */
  _eventListeners: null | Array<StoredEventListener>,
  /** `FragmentInstanceType._observers` 登记到当前及未来宿主子元素的观察器。 */
  _observers: null | Set<IntersectionObserver | ResizeObserver>,
  /** `FragmentInstanceType.addEventListener` 保存去重后的监听器并应用到 Fragment 的宿主子节点。 */
  addEventListener(
    type: string,
    listener: EventListener,
    optionsOrUseCapture?: EventListenerOptionsOrUseCapture,
  ): void,
  /** `FragmentInstanceType.removeEventListener` 从宿主子节点和保存记录中移除监听器。 */
  removeEventListener(
    type: string,
    listener: EventListener,
    optionsOrUseCapture?: EventListenerOptionsOrUseCapture,
  ): void,
  /** `FragmentInstanceType.dispatchEvent` 从宿主父节点或临时 Text 发送原生事件，使虚拟 Fragment 的监听器也能接收。 */
  dispatchEvent(event: Event): boolean,
  /** `FragmentInstanceType.focus` 深度遍历宿主后代，聚焦第一个成功的元素。 */
  focus(focusOptions?: FocusOptions): void,
  /** `FragmentInstanceType.focusLast` 反向尝试深度收集的宿主后代，聚焦最后一个可聚焦元素。 */
  focusLast(focusOptions?: FocusOptions): void,
  /** `FragmentInstanceType.blur` 仅当当前焦点属于 Fragment 宿主子树时清除焦点。 */
  blur(): void,
  /** `FragmentInstanceType.observeUsing` 保存观察器并观察宿主子元素；文本不可观察。 */
  observeUsing(observer: IntersectionObserver | ResizeObserver): void,
  /** `FragmentInstanceType.unobserveUsing` 移除已登记观察器，并取消观察当前宿主子元素。 */
  unobserveUsing(observer: IntersectionObserver | ResizeObserver): void,
  /** `FragmentInstanceType.getClientRects` 收集宿主子节点的矩形；文本支持开启时使用 Range 测量。 */
  getClientRects(): Array<DOMRect>,
  /** `FragmentInstanceType.getRootNode` 返回宿主父节点的原生 getRootNode 结果；没有宿主父节点时返回句柄自身。 */
  getRootNode(getRootNodeOptions?: {
    /** `FragmentInstanceType.composed` 是否跨过 ShadowRoot，沿用原生 getRootNode 选项。 */
    composed: boolean,
  }): Document | ShadowRoot | FragmentInstanceType,
  /** `FragmentInstanceType.compareDocumentPosition` 结合 DOM 范围与 Fiber 顺序返回位置位掩码，顺序不一致时标记 implementation-specific。 */
  compareDocumentPosition(otherNode: Instance): number,
  /** `FragmentInstanceType.scrollIntoView` 滚动宿主子节点使 Fragment 顶部或底部对齐；空 Fragment 使用邻近宿主位置。 */
  scrollIntoView(alignToTop?: boolean): void,
};

/** `FragmentInstance` 初始化 Fragment 对应的 Fiber、监听器列表和观察器集合。 */
function FragmentInstance(this: FragmentInstanceType, fragmentFiber: Fiber) {
  this._fragmentFiber = fragmentFiber;
  this._eventListeners = null;
  this._observers = null;
}

/**
 * 登记 Fragment 原生 listener，并应用到当前宿主子节点；后续插入节点由 commitNewChildToFragmentInstance 补注册。
 * 按 type、回调身份和 normalizeListenerOptions 去重；未传选项的键与显式 capture=false 的键在当前实现中不同。
 */
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
/** `addEventListenerToChild` 在遍历到的宿主子节点注册原生监听器，返回 false 让 Fragment 遍历继续。 */
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
/**
 * 从当前宿主子节点移除 listener，再从 Fragment 登记列表删除匹配的 type/回调/capture 记录。
 * 当前实现对未匹配的 -1 索引仍调用 splice，因此非空列表下未登记参数会删除列表末项。
 */
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
/** `removeEventListenerFromChild` 从遍历到的宿主子节点移除原生监听器，返回 false 继续遍历。 */
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
/** `normalizeListenerOptions` 未传选项返回 0 键，boolean/object 按 capture 生成 c=0/c=1 键；passive/once 不参与查找。 */
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
/** `indexOfEventListener` 按事件类型、回调身份和归一化 capture 选项查找注册记录，未找到返回 -1。 */
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
/**
 * 把 Fragment 的虚拟事件投射到宿主父节点；有 Fragment listener 或不冒泡时用临时 Text 作为实际 target。
 * 临时节点先装已保存的 listener，派发后移除 listener 与节点；没有宿主父节点时直接返回 true。
 * 返回原生 dispatchEvent 的结果，false 表示可取消事件被 preventDefault。
 */
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
/** 深度遍历 Fragment 宿主后代，直到原生 focus 实际改变焦点才停止；跳过 Text 并透传 FocusOptions。 */
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
/** `setFocusOnFiberIfFocusable` 跳过支持范围内的 HostText，尝试聚焦宿主元素；成功返回 true 让遍历停止。 */
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
/** 先收集深度宿主顺序，再反向尝试 focus，保证从 Fragment 最后一个可聚焦后代开始选择。 */
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
/** `collectChildren` 将遍历到的宿主 Fiber 收集进数组，返回 false 继续遍历。 */
function collectChildren(child: Fiber, collection: Array<Fiber>): boolean {
  collection.push(child);
  return false;
}
/** 先用宿主父节点排除无关焦点，再查 Fragment 宿主子树；仅其元素包含 activeElement 时调用 blur。 */
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
/** `blurActiveElementWithinFragment` 宿主子节点包含当前焦点时调用 blur 并停止遍历；文本节点跳过。 */
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
/** 把 observer 保存到 Fragment 并观察当前宿主元素；后续加入节点继续应用，Text 跳过，纯文本 Fragment 开发期提示不可观察。 */
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
/** `observeChild` 让观察器观察遍历到的宿主元素，跳过不支持观察的文本节点。 */
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
/** 移除已登记 observer 并取消观察当前宿主元素；未登记时开发期报错，保留现有观察器集合。 */
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
/** `unobserveChild` 取消观察遍历到的宿主元素，跳过文本节点。 */
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
/** 汇总 Fragment 顶层宿主子节点的矩形；支持 Text 的路径使用 Range，不为虚拟 Fragment 创建包裹元素。 */
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
/** `collectClientRects` 收集宿主元素的 client rects；支持文本时通过 Range 取得其矩形。 */
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
/** 转发宿主父节点的 getRootNode（可透传 composed）；没有宿主父节点时用 Fragment 句柄自身表示根。 */
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
/**
 * 用 Fragment 首末宿主节点定义 DOM 范围，再以 Fiber 包含/前后顺序校验结果。
 * 空 Fragment 按附近宿主位置比较；Portal 或外部 DOM 插入使两种顺序不一致时返回 IMPLEMENTATION_SPECIFIC。
 * 无宿主父节点或 DOM 父节点则返回 DISCONNECTED，不把虚拟句柄当成真实 DOM 节点。
 */
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

/** `validateDocumentPositionWithFiberTree` 用 Fiber 包含与前后顺序校验 DOM 位置信息，供 Fragment 标出 Portal 等造成的顺序差异。 */
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

/** `scrollTextNodeIntoView` 以 Range 测量文本，再滚动 window 将其顶部或底部对齐视口。 */
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
  /**
   * 依次滚动宿主子节点，alignToTop 时逆序调用让首节点最后对齐，底部对齐时顺序相反。
   * 空 Fragment 借相邻宿主或父容器定位；Text 用 Range 测量、ShadowRoot 用 host，独立 DocumentFragment 不能滚动。
   * 仅支持 boolean 对齐方式，传选项对象直接抛错。
   */
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

/** `addFragmentHandleToFiber` 启用实例句柄关联时，将 Fragment 句柄登记到宿主 Fiber 的 DOM 节点。 */
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

/** `addFragmentHandleToInstance` 将 Fragment 句柄加入 DOM 节点的 reactFragments 集合。 */
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

/** `createFragmentInstance` 创建虚拟 Fragment 句柄；启用实例关联时遍历已有宿主子节点登记该句柄。 */
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

/** `updateFragmentInstanceFiber` 更新句柄指向的已提交 Fragment Fiber，后续方法据此遍历当前子树。 */
export function updateFragmentInstanceFiber(
  fragmentFiber: Fiber,
  instance: FragmentInstanceType,
): void {
  instance._fragmentFiber = fragmentFiber;
}

/** `commitNewChildToFragmentInstance` 将已保存监听器、观察器及 Fragment 关联应用到新宿主元素；文本节点直接跳过。 */
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

/** `deleteChildFromFragmentInstance` 从离开的宿主元素移除已保存监听器和 Fragment 关联；文本节点直接跳过。 */
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

/** `clearContainer` 普通 Element 清空 textContent；Document/html/head/body 使用保留单例和资源节点的清理路径。 */
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

/** `clearContainerSparingly` 递归保留 html/head/body、script/style 与 stylesheet link，移除其余子节点并解除旧单例的 Fiber 关联。 */
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
        //单例 DOM 会继续复用，因此解除它与旧 Fiber/props 的关联，供新树重新绑定。
        detachDeletedInstance(element);
        continue;
      }
      //保留 script，避免清除尚未解析到闭合标签、仍未执行的流式脚本节点。
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

/** `clearHead` 删除 head 中非 hoistable、非 script/style/stylesheet 的节点，保留共享或外部资源。 */
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

//HostSingleton 复用文档中的同一个元素。直到提交时才绑定 Fiber/props，避免失败或重启的 render 改写其当前所有者。
/** `bindInstance` 在提交时将已有单例关联到其 Fiber 和 props，避免失败 render 抢占共享 DOM 实例。 */
export function bindInstance(
  instance: Instance,
  props: Props,
  internalInstanceHandle: mixed,
) {
  precacheFiberNode(internalInstanceHandle as any, instance);
  updateFiberProps(instance, props);
}

// -------------------
//hydration
// -------------------

/** `supportsHydration` DOM 支持从服务器现有节点认领宿主实例。 */
export const supportsHydration = true;

/** `canHydrateInstance` 按标签和资源特征寻找可认领元素；根/单例可跳过不匹配节点，普通父节点只额外容忍隐藏 input。 */
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
      //标签已匹配。
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
      //根/单例允许跳过外部节点。标签相同仍需按资源标记和 href/src 等属性排除不应由普通 HostComponent 认领的候选。
      switch (type) {
        // case 'title':
        //我们假设所有标题都是可匹配的。文档中应仅有一个标题，至少在可提升的范围内，如果你是类型为 title 的 HostComponent，我们必须要么处于 <svg> 上下文中，要么该标题必须有一个 `itemProp` 属性。
        case 'meta': {
          //普通 HostComponent 只认领带 itemprop 的 meta；其余 meta 交给 hoistable 路径。
          if (!element.hasAttribute('itemprop')) {
            //这是可提升的 meta，交给 hoistable 路径匹配。
            break;
          }
          return element;
        }
        case 'link': {
          //跳过带 precedence 的 stylesheet 资源；其他 link 用 rel/href/crossOrigin/title 筛选候选。
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
          //跳过带 precedence 的 style 资源；其他 style 不比较规则文本，直接作为候选。
          if (element.hasAttribute('data-precedence')) {
            //这是共享 style 资源。
            break;
          }
          return element;
        }
        case 'script': {
          //用 src/type/crossOrigin 识别不匹配的异步脚本资源并跳过；普通或内联 script 不比较其文本内容。
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
          //其他同标签元素不做额外属性筛选，直接作为候选。
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
  //遇到边界/文本，或已经没有候选元素时，返回匹配失败；不能越过这些 hydration 游标位置继续寻找同标签元素。
  return null;
}

/** `canHydrateTextInstance` 为非空客户端文本寻找 Text 节点；普通父节点只容忍额外隐藏 input，根/单例可继续扫描。 */
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
  //候选已经确认为 Text。
  return instance as any as TextInstance;
}

/** `canHydrateHydrationBoundary` 寻找可认领的边界注释；普通父节点遇到非注释且非隐藏 input 时匹配失败。 */
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
  //候选已经确认为边界注释。
  return instance as any;
}

/** `canHydrateActivityInstance` 认领候选边界注释，但只接受 Activity 起始标记。 */
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

/** `canHydrateSuspenseInstance` 认领非 Activity 的候选边界注释；候选已经由 hydration 游标筛选。 */
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

/** `isSuspenseInstancePending` pending 或 queued 标记表示边界仍需等待 Fizz。 */
export function isSuspenseInstancePending(instance: SuspenseInstance): boolean {
  return (
    instance.data === SUSPENSE_PENDING_START_DATA ||
    instance.data === SUSPENSE_QUEUED_START_DATA
  );
}

/** `isSuspenseInstanceFallback` 显式 fallback，或文档已解析完却仍 pending 的边界，需要客户端渲染。 */
export function isSuspenseInstanceFallback(
  instance: SuspenseInstance,
): boolean {
  return (
    instance.data === SUSPENSE_FALLBACK_START_DATA ||
    (instance.data === SUSPENSE_PENDING_START_DATA &&
      instance.ownerDocument.readyState !== DOCUMENT_READY_STATE_LOADING)
  );
}

/** `getSuspenseInstanceFallbackErrorDetails` 从起始标记后的元素 dataset 读取服务器错误摘要；详细消息与堆栈只在开发构建返回。 */
export function getSuspenseInstanceFallbackErrorDetails(
  instance: SuspenseInstance,
): {
  /** `getSuspenseInstanceFallbackErrorDetails.digest` 服务器错误的摘要标识 dgst。 */
  digest: ?string,
  /** `getSuspenseInstanceFallbackErrorDetails.message` 开发构建读取的服务器错误消息 msg。 */
  message?: string,
  /** `getSuspenseInstanceFallbackErrorDetails.stack` 开发构建读取的服务器错误堆栈 stck。 */
  stack?: string,
  /** `getSuspenseInstanceFallbackErrorDetails.componentStack` 开发构建读取的服务器组件堆栈 cstck。 */
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

/** `registerSuspenseInstanceRetry` 按 Fizz 边界状态立即重试、登记 _reactRetry，或同时监听 DOMContentLoaded 以结束未完成的服务器等待。 */
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
    /** `registerSuspenseInstanceRetry.listener` 调用边界重试后移除 DOMContentLoaded 监听；也作为 _reactRetry 供 Fizz 调用。 */
    const listener = () => {
      callback();
      ownerDocument.removeEventListener('DOMContentLoaded', listener);
    };
    ownerDocument.addEventListener('DOMContentLoaded', listener);
    instance._reactRetry = listener;
  }
}

/** `canHydrateFormStateMarker` 寻找并认领 F!/F 表单状态注释；只有根或单例作用域可跳过其他候选节点。 */
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

/** `isFormStateMarkerMatching` 判断表单状态标记是否为匹配当前 action 状态槽的 F!。 */
export function isFormStateMarkerMatching(
  markerInstance: FormStateMarkerInstance,
): boolean {
  return markerInstance.data === FORM_STATE_IS_MATCHING;
}

/** `getNextHydratable` 沿兄弟跳过普通注释等不可认领节点；返回元素、文本或协议起始标记，遇到边界结束标记返回 null。 */
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

/** `getNextHydratableSibling` 从下一个兄弟开始寻找 hydration 候选，遵守边界结束标记。 */
export function getNextHydratableSibling(
  instance: HydratableInstance,
): null | HydratableInstance {
  return getNextHydratable(instance.nextSibling);
}

/** `getFirstHydratableChild` 从宿主元素的第一个子节点开始寻找 hydration 候选。 */
export function getFirstHydratableChild(
  parentInstance: Instance,
): null | HydratableInstance {
  return getNextHydratable(parentInstance.firstChild);
}

/** `getFirstHydratableChildWithinContainer` Document/html 从 body 开始，其余容器从自身首个子节点寻找 hydration 候选。 */
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

/** `getFirstHydratableChildWithinActivityInstance` 从 Activity 起始注释后的兄弟寻找范围内第一个 hydration 候选。 */
export function getFirstHydratableChildWithinActivityInstance(
  parentInstance: ActivityInstance,
): null | HydratableInstance {
  return getNextHydratable(parentInstance.nextSibling);
}

/** `getFirstHydratableChildWithinSuspenseInstance` 从 Suspense 起始注释后的兄弟寻找范围内第一个 hydration 候选。 */
export function getFirstHydratableChildWithinSuspenseInstance(
  parentInstance: SuspenseInstance,
): null | HydratableInstance {
  return getNextHydratable(parentInstance.nextSibling);
}

//如果在 DOM 树中可能存在多个作用域单例，我们需要将其建模为一个堆栈，但由于你只能有一个 <head>，并且 head 是 DOM 中唯一作为作用域的单例，我们可以仅通过跟踪单个值来解决这个问题。
let previousHydratableOnEnteringScopedSingleton: null | HydratableInstance =
  null;

/** `getFirstHydratableChildWithinSingleton` 进入 head 时保存外部 hydration 游标并切换到 head 子节点；其他单例沿用当前游标。 */
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

/** `getNextHydratableSiblingAfterSingleton` 退出 head 时恢复并清空外部游标；其他单例沿用当前游标。 */
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

/** `describeHydratableInstanceForDevWarnings` 把现有 DOM 还原为开发期 diff 展示用的标签/props、边界名称或文本。 */
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

/** `validateHydratableInstance` 开发构建返回元素嵌套是否合法，供 hydration 判定是否在此处报告匹配错误；生产构建返回 true。 */
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

/** `hydrateInstance` completeWork 将服务器元素关联到 Fiber/props，再通过 hydrateProperties 初始化监听和表单状态并检查内容匹配。 */
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
/** `diffHydratedPropsForDevWarnings` 返回服务器 DOM 与客户端 props 的差异，供开发期 hydration 警告展示。 */
export function diffHydratedPropsForDevWarnings(
  instance: Instance,
  type: string,
  props: Props,
  hostContext: HostContext,
): null | $ReadOnly<Props> {
  return diffHydratedProperties(instance, type, props, hostContext);
}

/** `validateHydratableTextInstance` 开发构建校验文本与宿主祖先的嵌套合法性，生产构建返回 true。 */
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

/** `hydrateTextInstance` 将服务器 Text 关联到 Fiber，并通过 hydrateText 检查它与客户端文本是否匹配。 */
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
/** `diffHydratedTextForDevWarnings` 未 suppressHydrationWarning 时返回有差异的服务器文本，否则返回 null。 */
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

/** `hydrateActivityInstance` 将服务器 Activity 起始注释关联到其 Fiber。 */
export function hydrateActivityInstance(
  activityInstance: ActivityInstance,
  internalInstanceHandle: Object,
) {
  precacheFiberNode(internalInstanceHandle, activityInstance);
}

/** `hydrateSuspenseInstance` 将服务器 Suspense 起始注释关联到其 Fiber。 */
export function hydrateSuspenseInstance(
  suspenseInstance: SuspenseInstance,
  internalInstanceHandle: Object,
) {
  precacheFiberNode(internalInstanceHandle, suspenseInstance);
}

/** `getNextHydratableInstanceAfterHydrationBoundary` 按嵌套深度跨过整个 Activity/Suspense 标记范围，返回结束标记后的 hydration 候选。 */
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

/** `getNextHydratableInstanceAfterActivityInstance` 跳过 Activity 标记范围及嵌套边界，取得后续候选。 */
export function getNextHydratableInstanceAfterActivityInstance(
  activityInstance: ActivityInstance,
): null | HydratableInstance {
  return getNextHydratableInstanceAfterHydrationBoundary(activityInstance);
}

/** `getNextHydratableInstanceAfterSuspenseInstance` 跳过 Suspense 标记范围及嵌套边界，取得后续候选。 */
export function getNextHydratableInstanceAfterSuspenseInstance(
  suspenseInstance: SuspenseInstance,
): null | HydratableInstance {
  return getNextHydratableInstanceAfterHydrationBoundary(suspenseInstance);
}

//边界由同一 DOM 父节点下的注释范围表示；向前扫描兄弟节点，找出包住目标的最近起始标记。
/** `getParentHydrationBoundary` 向前扫描兄弟注释并配对嵌套起止标记，找出包住该节点的 Activity/Suspense 起始标记。 */
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

/** `commitHydratedContainer` 容器 hydration 提交后，重试被该容器阻塞的事件重放和显式 hydration 目标。 */
export function commitHydratedContainer(container: Container): void {
  //如果此处的任何事件重放被阻止，请重试。
  retryIfBlockedOn(container);
}

/** `commitHydratedActivityInstance` Activity hydration 提交后，重试被该起始标记阻塞的事件与目标。 */
export function commitHydratedActivityInstance(
  activityInstance: ActivityInstance,
): void {
  //如果此处的任何事件重放被阻止，请重试。
  retryIfBlockedOn(activityInstance);
}

/** `commitHydratedSuspenseInstance` Suspense hydration 提交后，重试被该起始标记阻塞的事件与目标。 */
export function commitHydratedSuspenseInstance(
  suspenseInstance: SuspenseInstance,
): void {
  //如果此处的任何事件重放被阻止，请重试。
  retryIfBlockedOn(suspenseInstance);
}

/** `flushHydrationEvents` 开启 hydration change event 时，冲刷等待的表单控件 hydration 事件重放。 */
export function flushHydrationEvents(): void {
  if (enableHydrationChangeEvent) {
    flushEventReplaying();
  }
}

/** `shouldDeleteUnhydratedTailInstances` form/button 保留未认领的尾部节点；其他宿主父类型允许 hydration 清理尾部。 */
export function shouldDeleteUnhydratedTailInstances(
  parentType: string,
): boolean {
  return parentType !== 'form' && parentType !== 'button';
}

// -------------------
//测试选择器
// -------------------

/** `supportsTestSelectors` 提供 reconciler 测试选择器需要的 DOM 查询和观察能力。 */
export const supportsTestSelectors = true;

/** `findFiberRoot` 广度优先搜索元素及后代，找到根容器后返回关联的 HostRoot Fiber，供测试选择器继续遍历。 */
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

/** `getBoundingRect` 将 DOMRect 转为测试选择器使用的 x/y/width/height。 */
export function getBoundingRect(node: Instance): BoundingRect {
  const rect = node.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/** `matchAccessibilityRole` 委托 hasRole 判断元素是否具有目标无障碍角色。 */
export function matchAccessibilityRole(node: Instance, role: string): boolean {
  if (hasRole(node, role)) {
    return true;
  }

  return false;
}

/** `getTextContent` 元素只汇总直接 Text 子节点；HostText 返回自身文本，其他 Fiber 返回 null。 */
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

/** `isHiddenSubtree` 测试选择器将 hidden=true 的 HostComponent 视为隐藏子树。 */
export function isHiddenSubtree(fiber: Fiber): boolean {
  return fiber.tag === HostComponent && fiber.memoizedProps.hidden === true;
}

/** `setFocusIfFocusable` 尝试实际聚焦元素，用 document 捕获 focus 确认成功，包含 label/shadow host 的焦点委托。 */
export function setFocusIfFocusable(
  node: Instance,
  focusOptions?: FocusOptions,
): boolean {
  //确定一个元素是否可聚焦的逻辑有点复杂，而且由于我们无论如何都想实际更改焦点——我们可以直接跳过它。相反，我们只需监听“focus”事件来验证焦点是否已设置。
  //
  //直接比较 activeElement 无法识别焦点事件回调里立即 blur 或重定向焦点的情况。
  const element = node as any as HTMLElement;

  //如果这个元素已经是活动元素，它是可聚焦的并且已经获得焦点。对它调用 .focus() 将不会有任何操作（不会触发焦点事件），所以我们在这里短路处理。
  if (element.ownerDocument.activeElement === element) {
    return true;
  }

  let didFocus = false;
  /** `setFocusIfFocusable.handleFocus` 记录这次 focus 调用期间确实发生了焦点事件。 */
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

/** `RectRatio` 测试选择器缓存的目标矩形和交叉可见比例。 */
type RectRatio = {
  /** `RectRatio.ratio` 目标的交叉可见比例。 */
  ratio: number,
  /** `RectRatio.rect` 目标最近一次观测到的边界矩形。 */
  rect: BoundingRect,
};

/** `setupIntersectionObserver` 观察目标元素并维护完整矩形/比例缓存；每次通知将当前所有目标快照传给 callback。 */
export function setupIntersectionObserver(
  targets: Array<Instance>,
  callback: ObserveVisibleRectsCallback,
  options?: IntersectionObserverOptions,
): {
  /** `setupIntersectionObserver.disconnect` 停止观察全部目标。 */
  disconnect: () => void,
  /** `setupIntersectionObserver.observe` 以当前矩形和零比例加入缓存，再开始观察目标。 */
  observe: (instance: Instance) => void,
  /** `setupIntersectionObserver.unobserve` 从缓存移除目标并停止观察它。 */
  unobserve: (instance: Instance) => void,
} {
  const rectRatioCache: Map<Instance, RectRatio> = new Map();
  targets.forEach(target => {
    rectRatioCache.set(target, {
      rect: getBoundingRect(target),
      ratio: 0,
    });
  });

  /** `setupIntersectionObserver.handleIntersection` 更新本次通知涉及的目标快照，再向调用者报告完整缓存。 */
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
    /** `setupIntersectionObserver.disconnect` 停止观察全部目标。 */
    disconnect: () => observer.disconnect(),
    /** `setupIntersectionObserver.observe` 以当前矩形和零比例加入缓存，再开始观察目标。 */
    observe: target => {
      rectRatioCache.set(target, {
        rect: getBoundingRect(target),
        ratio: 0,
      });
      observer.observe(target as any);
    },
    /** `setupIntersectionObserver.unobserve` 从缓存移除目标并停止观察它。 */
    unobserve: target => {
      rectRatioCache.delete(target);
      observer.unobserve(target as any);
    },
  };
}

/**
 * 经两次 requestAnimationFrame 把回调安排到后续帧，提供第二次的帧时间戳，供提交日志归入绘制后工作。
 * 不可用时两层调用均使用 scheduleTimeout；定时器备用路径不会生成帧时间戳。
 */
export function requestPostPaintCallback(callback: (time: number) => void) {
  localRequestAnimationFrame(() => {
    localRequestAnimationFrame(time => callback(time));
  });
}

// -------------------
//单例
// -------------------

/** `supportsSingletons` 允许 reconciler 复用文档既有的 html/head/body 单例。 */
export const supportsSingletons = true;

/** `isHostSingletonType` 将 html、head、body 识别为文档单例宿主类型。 */
export function isHostSingletonType(type: string): boolean {
  return type === 'html' || type === 'head' || type === 'body';
}

/** `resolveSingletonInstance` 取得所属文档已有的 html/head/body；缺少应有元素或类型不支持时抛错。 */
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

/** `acquireSingletonInstance` mutation 中清空既有单例属性、设置当前初始 props 并绑定 Fiber；开发期检查重复占用。 */
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

/** `releaseSingletonInstance` 清除该 Fiber props 拥有的单例状态和关联，保留单例 DOM 本身及额外命令式属性。 */
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

/** `clearSingletonPreambleContribution` dehydrated 边界只有 Fizz 贡献标记、没有 props 时清空单例全部属性并解除关联。 */
function clearSingletonPreambleContribution(instance: Instance): void {
  //Fizz 标记只说明边界贡献了哪个单例，不携带属性列表，也没有 HostSingleton Fiber 的 props 可供筛选，所以这里清除全部属性。TODO：让标记携带属性信息，只清理边界贡献的属性。
  const attributes = instance.attributes;
  while (attributes.length) {
    instance.removeAttributeNode(attributes[0]);
  }
  detachDeletedInstance(instance);
}

// -------------------
//资源
// -------------------

/** `supportsResources` 允许 reconciler 管理可提升、去重的样式和脚本资源。 */
export const supportsResources = true;

/** `HoistableTagType` 作为普通 hoistable 实例管理的 link/meta/title 标签。 */
type HoistableTagType = 'link' | 'meta' | 'title';
/** `TResource` 共享资源记录：类别、复用 DOM、引用数及类别专属状态；引用归零不代表移除 DOM。 */
type TResource<
  T: 'stylesheet' | 'style' | 'script' | 'void',
  S: null | {...},
> = {
  /** `TResource.type` 区分 stylesheet/style/script/void 的资源类别。 */
  type: T,
  /** `TResource.instance` 复用的 DOM 实例；尚未创建或为 void 时为 null。 */
  instance: null | Instance,
  /** `TResource.count` 当前资源引用数；归零时本实现仍保留实例。 */
  count: number,
  /** `TResource.state` 类别专属状态；只有 stylesheet 需要加载与插入状态。 */
  state: S,
};
/** `StylesheetResource` 外部 stylesheet 资源，带预加载及插入状态。 */
type StylesheetResource = TResource<'stylesheet', StylesheetState>;
/** `StyleTagResource` 内联 style 资源，使用 href 标识并按 precedence 插入。 */
type StyleTagResource = TResource<'style', null>;
/** `StyleResource` 共享样式缓存中的内联 style 或外部 stylesheet 资源。 */
type StyleResource = StyleTagResource | StylesheetResource;
/** `ScriptResource` 按 src 复用的异步脚本资源。 */
type ScriptResource = TResource<'script', null>;
/** `VoidResource` 不能作为实际共享资源挂载的占位记录，acquireResource 返回 null。 */
type VoidResource = TResource<'void', null>;
/** `Resource` DOM renderer 支持的共享样式、异步脚本或占位资源。 */
export type Resource = StyleResource | ScriptResource | VoidResource;

/** `LoadingState` stylesheet 的加载结果与插入状态位掩码。 */
type LoadingState = number;
/** `NotLoaded` 尚无加载结果且未标记插入的零值，也用作掩码比较值。 */
const NotLoaded = /*       */ 0b000;
/** `Loaded` 加载成功位；预加载完成也可设置此位。 */
const Loaded = /*          */ 0b001;
/** `Errored` 加载失败位；失败同样解除资源等待。 */
const Errored = /*         */ 0b010;
/** `Settled` Loaded/Errored 掩码，任一结果表示加载等待已结束。 */
const Settled = /*         */ 0b011;
/** `Inserted` stylesheet 实例已经插入宿主树的状态位。 */
const Inserted = /*        */ 0b100;

/** `StylesheetState` stylesheet 的加载/插入位和可复用 preload 元素。 */
type StylesheetState = {
  /** `StylesheetState.loading` Loaded/Errored/Inserted 位的组合。 */
  loading: LoadingState,
  /** `StylesheetState.preload` 用于等待预加载完成的 link，未关联时为 null。 */
  preload: null | HTMLLinkElement,
};

/** `StyleTagProps` style 实例使用的 DOM props，将资源标识和优先级写为 data 属性。 */
type StyleTagProps = {
  /** `StyleTagProps.data-href` 内联样式的资源标识，供缓存和服务器 style 匹配使用。 */
  'data-href': string,
  /** `StyleTagProps.data-precedence` 写入 DOM 的样式顺序组名，同组实例按插入顺序排列。 */
  'data-precedence': string,
  /** `StyleTagProps.string` 其余 DOM 属性或资源选项，保留原始值。 */
  [string]: mixed,
};
/** `StylesheetProps` 外部 stylesheet link 实例使用的 DOM props。 */
type StylesheetProps = {
  /** `StylesheetProps.rel` 固定为 stylesheet，声明外部样式表。 */
  rel: 'stylesheet',
  /** `StylesheetProps.href` 样式表 URL，同时生成共享资源键。 */
  href: string,
  /** `StylesheetProps.data-precedence` 写入 DOM 的样式顺序组名，同组实例按插入顺序排列。 */
  'data-precedence': string,
  /** `StylesheetProps.string` 其余 DOM 属性或资源选项，保留原始值。 */
  [string]: mixed,
};

/** `ScriptProps` 可共享的异步外部脚本实例 props。 */
type ScriptProps = {
  /** `ScriptProps.src` 异步脚本 URL，同时生成共享资源键。 */
  src: string,
  /** `ScriptProps.async` 共享脚本必须采用异步执行。 */
  async: true,
  /** `ScriptProps.string` 其余 DOM 属性或资源选项，保留原始值。 */
  [string]: mixed,
};

/** `PreloadProps` 普通 preload link 的 DOM props。 */
type PreloadProps = {
  /** `PreloadProps.rel` 固定为 preload。 */
  rel: 'preload',
  /** `PreloadProps.href` 待预加载 URL；响应式图片使用 imageSrcSet 时可省略。 */
  href: ?string,
  /** `PreloadProps.string` 其余 DOM 属性或资源选项，保留原始值。 */
  [string]: mixed,
};
/** `PreloadModuleProps` modulepreload link 的 DOM props。 */
type PreloadModuleProps = {
  /** `PreloadModuleProps.rel` 固定为 modulepreload。 */
  rel: 'modulepreload',
  /** `PreloadModuleProps.href` 待预加载模块的 URL。 */
  href: string,
  /** `PreloadModuleProps.string` 其余 DOM 属性或资源选项，保留原始值。 */
  [string]: mixed,
};

/** `RootResources` HoistableRoot 上共享的样式和脚本去重缓存，不按单个 React FiberRoot 划分。 */
export type RootResources = {
  /** `RootResources.hoistableStyles` 按 href 键共享的 style/stylesheet 资源缓存。 */
  hoistableStyles: Map<string, StyleResource>,
  /** `RootResources.hoistableScripts` 按 src 键共享的异步 script 资源缓存。 */
  hoistableScripts: Map<string, ScriptResource>,
};

/** `prepareToCommitHoistables` 重置本次提交用于认领普通 hoistable 标签的临时 DOM 查询缓存。 */
export function prepareToCommitHoistables() {
  tagCaches = null;
}

/** 模块级缓存preload/preloadModule首次属性，style/script用实际资源键、其它类型用选择器键；后续真实资源补用这些属性且同键预加载去重，缓存不会随一次提交重置。 */
const preloadPropsMap: Map<string, PreloadProps | PreloadModuleProps> =
  new Map();
/** `preconnectsSet` 全局记录已处理的 dns-prefetch/preconnect 选择器，避免重复插入提示。 */
const preconnectsSet: Set<string> = new Set();

/** `HoistableRoot` 资源共享与查询所在的 Document 或 ShadowRoot。 */
export type HoistableRoot = Document | ShadowRoot;

//IE 和旧版本 jsdom 缺少 getRootNode
/** `getHoistableRoot` 优先取容器 getRootNode 的 Document/DocumentFragment；否则回退所属文档。 */
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

/** `getCurrentResourceRoot` 从 render 当前根容器确定资源根；没有当前容器时返回 null。 */
function getCurrentResourceRoot(): null | HoistableRoot {
  const currentContainer = getCurrentRootHostContainer();
  return currentContainer ? getHoistableRoot(currentContainer) : null;
}

/** `getDocumentFromRoot` Document 直接使用自身，ShadowRoot 使用 ownerDocument。 */
function getDocumentFromRoot(root: HoistableRoot): Document {
  return root.ownerDocument || root;
}

/** `previousDispatcher` 保留安装 DOM dispatcher 前的实现，使多个 ReactDOM renderer 的入口可以串联。 */
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

/** `flushSyncWork` 先调用既有 dispatcher 再刷新当前 renderer 的全部同步根，汇总是否处于渲染中。 */
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

/** `requestFormReset` 对当前 renderer 的 form Fiber 请求重置；其他实例交由既有 dispatcher 处理。 */
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

/** 模块初始化时缓存全局document或null；render外的ReactDOM.pre*没有当前容器上下文而使用它，之后补装document不会改写该引用。 */
const globalDocument = typeof document === 'undefined' ? null : document;
/** `getGlobalDocument` 返回模块初始化时可用的全局 document，供 render 外的 ReactDOM.pre* 调用使用。 */
function getGlobalDocument(): ?Document {
  return globalDocument;
}

/** `preconnectAs` 按 rel/href/crossOrigin 去重，在全局文档 head 插入缺失的连接提示 link。 */
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

/** `prefetchDNS` 串联既有 dispatcher，并插入去重的 dns-prefetch 提示。 */
function prefetchDNS(href: string) {
  previousDispatcher.D(/*预取DNS*/ href);
  preconnectAs('dns-prefetch', href, null);
}

/** `preconnect` 串联既有 dispatcher，并按 crossOrigin 插入去重的 preconnect 提示。 */
function preconnect(href: string, crossOrigin?: ?CrossOriginEnum) {
  previousDispatcher.C(/*预连接*/ href, crossOrigin);
  preconnectAs('preconnect', href, crossOrigin);
}

/** `preload` 串联既有 dispatcher，缓存预加载 props 并插入缺失 link；样式/脚本已有实际资源时跳过插入。 */
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
    //style/script 复用实际资源键；其他类型使用包含 as 和 URL/响应式图片信息的选择器作为去重键。
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
          /** load/error 任一结果都清除 React pending 标记，后续资源复用可据此判断 preload 已结束。 */
          instance.onload = /** error 与 load 共用此结束回调，错误结果也应清掉节点 pending 标记。 */ instance.onerror = () => {
            clearPendingLoadOnNode(instance);
          };
        }
        markNodeAsHoistable(instance);
        (ownerDocument.head as any).appendChild(instance);
      }
    }
  }
}

/** `preloadModule` 串联既有 dispatcher，缓存 modulepreload props 并在缺少预加载和实际脚本时插入 link。 */
function preloadModule(href: string, options?: ?PreloadModuleImplOptions) {
  previousDispatcher.m(/*预加载模块*/ href, options);
  const ownerDocument = getGlobalDocument();
  if (ownerDocument && href) {
    const as =
      options && typeof options.as === 'string' ? options.as : 'script';
    const preloadSelector = `link[rel="modulepreload"][as="${escapeSelectorAttributeValueInsideDoubleQuotes(
      as,
    )}"][href="${escapeSelectorAttributeValueInsideDoubleQuotes(href)}"]`;
    //脚本和 worker/worklet 类型复用脚本资源键；其他模块类型使用完整选择器作为去重键。
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

/** `preinitStyle` 在全局文档缓存 stylesheet 资源，复用已有 link 或立即按 precedence 创建插入并跟踪加载。 */
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

/** `preinitScript` 在全局文档缓存异步脚本资源，复用已有 script 或继承 preload props 后创建插入。 */
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

/** `preinitModuleScript` 在全局文档缓存异步 module 脚本，复用已有 script 或创建插入。 */
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

/** `StyleTagQualifyingProps` 内联 style 成为共享资源所需的原始 href/precedence props。 */
type StyleTagQualifyingProps = {
  /** `StyleTagQualifyingProps.href` 资源的 href 标识，用于样式缓存和 DOM 匹配。 */
  href: string,
  /** `StyleTagQualifyingProps.precedence` 样式顺序组名，创建 DOM 时转为 data-precedence。 */
  precedence: string,
  /** `StyleTagQualifyingProps.string` 其余 DOM 属性或资源选项，保留原始值。 */
  [string]: mixed,
};

/** `StylesheetQualifyingProps` 外部 stylesheet 成为共享资源所需的 rel/href/precedence props。 */
type StylesheetQualifyingProps = {
  /** `StylesheetQualifyingProps.rel` 固定为 stylesheet。 */
  rel: 'stylesheet',
  /** `StylesheetQualifyingProps.href` 资源的 href 标识，用于样式缓存和 DOM 匹配。 */
  href: string,
  /** `StylesheetQualifyingProps.precedence` 样式顺序组名，创建 DOM 时转为 data-precedence。 */
  precedence: string,
  /** `StylesheetQualifyingProps.string` 其余 DOM 属性或资源选项，保留原始值。 */
  [string]: mixed,
};

//beginWork 调用此函数时，当前宿主根容器已经压入上下文。
/**
 * beginWork 按当前 Document/ShadowRoot 的 href/src 键取得共享资源记录；这里不增加提交引用数。
 * style/script 先建 instance=null 的记录，stylesheet 还尝试复用已加载 DOM，否则启动可追踪的 preload。
 * acquireResource 在提交时创建或认领实际节点；stylesheet 的提前等待由 suspendResource 另行收集。
 * 当前同一 link 槽位不能在普通实例与 precedence stylesheet 资源间互转，这两种更新直接抛错。
 */
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
          //上面的条件已确认 stylesheet 的 href/precedence，下面显式细化资源类型。
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
              //既有实例带有加载 Promise，留给 suspendResource 跟踪其完成结果。
            } else {
              //没有可追踪的 Promise，按已加载且已插入处理。
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

/** `describeLinkForResourceErrorDEV` 格式化 link 的 rel/href/precedence 差异，供资源类别转换错误使用。 */
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

/** `styleTagPropsFromRawProps` 复制原始 props，把 href/precedence 转成 data-href/data-precedence 并清空原属性。 */
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

/** `getStyleKey` 将 href 转为经过属性转义的样式缓存键及选择器片段。 */
function getStyleKey(href: string) {
  const limitedEscapedHref =
    escapeSelectorAttributeValueInsideDoubleQuotes(href);
  return `href="${limitedEscapedHref}"`;
}

/** `getStyleTagSelector` 构造 data-href 词项包含目标 href 的 style 选择器。 */
function getStyleTagSelector(href: string) {
  const limitedEscapedHref =
    escapeSelectorAttributeValueInsideDoubleQuotes(href);
  return `style[data-href~="${limitedEscapedHref}"]`;
}

/** `getStylesheetSelectorFromKey` 以样式键构造 rel=stylesheet 的 link 选择器。 */
function getStylesheetSelectorFromKey(key: string) {
  return `link[rel="stylesheet"][${key}]`;
}

/** `getPreloadStylesheetSelectorFromKey` 以样式键构造 as=style 的 preload link 选择器。 */
function getPreloadStylesheetSelectorFromKey(key: string) {
  return `link[rel="preload"][as="style"][${key}]`;
}

/** `stylesheetPropsFromRawProps` 复制原始 props，将 precedence 转为 data-precedence 并清空原属性。 */
function stylesheetPropsFromRawProps(
  rawProps: StylesheetQualifyingProps,
): StylesheetProps {
  return {
    ...rawProps,
    'data-precedence': rawProps.precedence,
    precedence: null,
  };
}
/** `preloadStylesheet` 复用或创建样式 preload link，并用 load/error 更新资源加载位；无法跟踪的既有 preload 视为已加载。 */
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
      //既有 preload 没有 React 的 pending 标记，无法追踪它的实际结果；这里按已加载处理。
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

/** `preloadPropsFromStylesheet` 从 stylesheet props 构造对应的 preload props，本函数不创建 DOM 或启动请求。 */
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

/** `getScriptKey` 将 src 转为经过属性转义的脚本缓存键及选择器片段。 */
function getScriptKey(src: string): string {
  const limitedEscapedSrc = escapeSelectorAttributeValueInsideDoubleQuotes(src);
  return `[src="${limitedEscapedSrc}"]`;
}

/** `getScriptSelectorFromKey` 以脚本键构造 async 外部 script 的选择器。 */
function getScriptSelectorFromKey(key: string): string {
  return 'script[async]' + key;
}

/** `acquireResource` 提交时增加资源引用数，复用或创建 DOM；为已准备但未插入的 stylesheet 补做插入。 */
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

        //内联 style 没有 stylesheet 的加载状态位，插入后直接缓存 instance。
        insertStylesheet(instance, qualifiedProps.precedence, hoistableRoot);
        resource.instance = instance;

        return instance;
      }
      case 'stylesheet': {
        //getResource 已确认此记录来自带 href/precedence 的 stylesheet link。
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
        //getResource 已确认此记录来自带 async 和字符串 src 的 script。
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
    //suspendResource 可以只准备实例而未插入；acquireResource 接手时要补做插入。
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

/** `releaseResource` 只减少资源引用数；本版不在引用归零时移除资源 DOM 或删除缓存。 */
export function releaseResource(resource: Resource): void {
  resource.count--;
}

/** `insertStylesheet` 将样式插在同 precedence 组末尾；新组接在已有样式后，无已有样式时放到 head/ShadowRoot 首部。 */
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
    //prior 来自当前资源根的 DOM 查询，直接插到它的后一个兄弟位置。
    (prior.parentNode as any as Node).insertBefore(instance, prior.nextSibling);
  } else {
    const parent =
      root.nodeType === DOCUMENT_NODE
        ? ((root as any as Document).head as any as Element)
        : (root as any as ShadowRoot);
    parent.insertBefore(instance, parent.firstChild);
  }
}

/** `adoptPreloadPropsForStylesheet` 将 preload 的 crossOrigin/referrerPolicy/title 补到 stylesheet 未指定的 props。 */
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

/** `adoptPreloadPropsForScript` 将 preload 的 crossOrigin/referrerPolicy/integrity 补到 script 未指定的 props。 */
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

/** `KeyedTagCache` 按标签及关键属性分组的可认领 DOM 候选；标签名本身也用作已扫描哨兵键。 */
type KeyedTagCache = Map<string, Array<Element>>;
/** `DocumentTagCaches` 一次提交内按 Document 隔离的普通 hoistable 标签候选缓存。 */
type DocumentTagCaches = Map<Document, KeyedTagCache>;
let tagCaches: null | DocumentTagCaches = null;

/** `hydrateHoistable` 提交时按属性认领未被占用的 title/link/meta；没有匹配时创建并插入 head，然后绑定 Fiber。 */
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

/** `getHydratableHoistableCache` 为当前提交懒创建文档候选缓存，扫描未占用的同类标签；stylesheet link 和 SVG 节点排除。 */
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

/** `mountHoistable` 把普通 hoistable 实例插入文档 head；title 放在已有 title 前。 */
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

/** `unmountHoistable` 移除普通 hoistable 实例，区别于只减引用数的共享资源释放。 */
export function unmountHoistable(instance: Instance): void {
  (instance.parentNode as any).removeChild(instance);
}

/** `isHostHoistableType` 根据命名空间、itemProp 及标签 props 决定是否提升；开发期诊断缺失资源标识或不支持的监听器。 */
export function isHostHoistableType(
  type: string,
  props: RawProps,
  hostContext: HostContext,
): boolean {
  let outsideHostContainerContext: boolean;
  let hostContextProd: HostContextProd;
  if (__DEV__) {
    const hostContextDev: HostContextDev = hostContext as any;
    //记录当前位置是否缺少普通宿主容器，用于下面无法提升标签的开发期诊断。
    outsideHostContainerContext =
      !hostContextDev.ancestorInfo.containerTagInScope;
    hostContextProd = hostContextDev.context;
  } else {
    hostContextProd = hostContext as any;
  }

  //SVG 命名空间中的元素，以及带 itemProp 的元素都保留在普通宿主树中。
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

/** `maySuspendCommit` 启用图片或 View Transition 功能时，非 lazy、无 onLoad 且有 src 的 img 可以参与提交等待。 */
export function maySuspendCommit(type: Type, props: Props): boolean {
  if (!enableSuspenseyImages && !enableViewTransition) {
    return false;
  }
  //非 lazy 且没有 onLoad 的图片参与自动提交等待；有 onLoad 表明应用自行处理加载。
  return (
    type === 'img' &&
    props.src != null &&
    props.src !== '' &&
    props.onLoad == null &&
    props.loading !== 'lazy'
  );
}

/** `maySuspendCommitOnUpdate` 图片满足等待条件且 src/srcSet 改变时，更新可以参与提交等待。 */
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

/** `maySuspendCommitInSyncRender` 当前实现不让同步 render 因普通宿主实例挂起。 */
export function maySuspendCommitInSyncRender(
  type: Type,
  props: Props,
): boolean {
  //待办：允许同步通道也可以挂起，需选择加入。
  return false;
}

/** `mayResourceSuspendCommit` 只有尚未标记 Inserted 的 stylesheet 资源可能阻塞提交。 */
export function mayResourceSuspendCommit(resource: Resource): boolean {
  return (
    resource.type === 'stylesheet' &&
    (resource.state.loading & Inserted) === NotLoaded
  );
}

/** `preloadInstance` 图片请求已由设置 src 启动，此处只返回 complete；未完成返回 false，后续预提交仍可检查解码。 */
export function preloadInstance(
  instance: Instance,
  type: Type,
  props: Props,
): boolean {
  //设置 src 已经开始请求，complete 决定 render 是否因图片未加载而挂起。即使返回 true，预提交仍会调用 suspendInstance 等待 decode。
  return !!(instance as any).complete;
}

/** `preloadResource` 只检查 stylesheet 加载结果位；尚无成功或失败结果时返回 false，其他资源返回 true。 */
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

/** `SuspendedState` 一次预提交的 CSS/动画与图片等待计数、待插入样式和唤醒入口。 */
export opaque type SuspendedState = {
  /** `SuspendedState.stylesheets` 等待按 precedence 插入的 stylesheet 及其资源根。 */
  stylesheets: null | Map<StylesheetResource, HoistableRoot>,
  /** `SuspendedState.count` 未完成的 CSS/preload 和既有 View Transition 等待数。 */
  count: number, //未完成的 CSS/preload 和已有视图过渡。
  /** 尚未结束的 decode Promise 数；decode 拒绝也减少计数。 */
  imgCount: number, //尚未结束的图片 decode。
  /** 收集时未 complete 图片的启发式下载字节，用于选择 50ms 或通常图片等待上限。 */
  imgBytes: number, //未 complete 图片的估计下载字节数。
  /** 捕获 View Transition 新快照前再次检查的未 complete 图片列表，按视口和预算决定是否等待。 */
  suspenseyImages: Array<HTMLImageElement>, //收集时尚未 complete 的图片；捕获快照前会再次检查。
  /** 图片超时后置 false，使尚未结束的 decode 不再独自阻止提交；计数仍可在其完成后递减。 */
  waitingForImages: boolean, //图片等待超时后为 false，即使 decode 尚未结束也可提交。
  /** 收集时是否遇到当前文档已有 View Transition，供 Profiler 说明优先报告动画等待。 */
  waitingForViewTransition: boolean,
  /** `SuspendedState.unsuspend` 收集时为 noop，等待时为 commit；调用或取消前设为 null 防止再次唤醒。 */
  unsuspend: null | (() => void),
};

/** `startSuspendingCommit` 初始化本次等待状态；先用 noop 唤醒入口收集资源，真正等待时再注册 commit 回调。 */
export function startSuspendingCommit(): SuspendedState {
  return {
    stylesheets: null,
    count: 0,
    imgCount: 0,
    imgBytes: 0,
    suspenseyImages: [],
    waitingForImages: true,
    waitingForViewTransition: false,
    //收集资源时尚未注册真正的 commit 回调；同步完成只调用 noop。waitForCommitToBeReady 确认需要等待后再注册唤醒和取消入口。
    unsuspend: noop,
  };
}

/** `estimateImageBytes` 按元素宽高、devicePixelRatio 和每像素 0.25 字节估算下载量；缺失宽高使用 100。 */
function estimateImageBytes(instance: HTMLImageElement): number {
  const width: number = instance.width || 100;
  const height: number = instance.height || 100;
  const pixelRatio: number =
    typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  const pixelsToDownload = width * height * pixelRatio;
  const AVERAGE_BYTE_PER_PIXEL = 0.25;
  return pixelsToDownload * AVERAGE_BYTE_PER_PIXEL;
}

/** `suspendInstance` 支持 decode 时增加图片等待数并监听成功/失败；未 complete 的图片计入字节估算和过渡候选。 */
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
    //支持 decode 时等待图片可解码，成功和失败都解除等待；请求已经由 src 启动。
    state.imgCount++;
    //根据元素当前 width/height 估算未完成图片的字节量，缺失尺寸时使用 100x100；complete 的图片只等 decode，不估计下载量。
    if (!(instance as any).complete) {
      state.imgBytes += estimateImageBytes(instance as any);
      state.suspenseyImages.push(instance as any);
    }
    const ping = onUnsuspendImg.bind(state);
    // $FlowFixMe[prop-missing]
    instance.decode().then(ping, ping);
  }
}

/** `suspendResource` 准备匹配 media 的 stylesheet 实例和插入队列；等待未完成 preload 或 Fizz link 的加载，但新 link 暂不插入。 */
export function suspendResource(
  state: SuspendedState,
  hoistableRoot: HoistableRoot,
  resource: Resource,
  props: any,
): void {
  if (resource.type === 'stylesheet') {
    if (typeof props.media === 'string') {
      //media 当前不匹配时不让样式阻塞提交，后续 mutation 的 acquireResource 仍可插入它。
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
          //既有 stylesheet 的 _p Promise 可追踪 Fizz 加载；没有此 Promise 时按已加载处理，不再增加等待数。
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

        //先构建实例并设置属性，实际插入留给后面的样式队列。
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

/** `suspendOnActiveViewTransition` 把所属文档当前 React View Transition 的 finished 纳入提交等待，成功或失败都减少计数。 */
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

/** `SUSPENSEY_STYLESHEET_TIMEOUT` CSS 等待的 60 秒上限；到时插入剩余样式并放行提交。 */
const SUSPENSEY_STYLESHEET_TIMEOUT = 60000;

/** `SUSPENSEY_IMAGE_TIMEOUT` 图片等待的通常上限为 800 毫秒，调用处再加 timeoutOffset。 */
const SUSPENSEY_IMAGE_TIMEOUT = 800;

/** `SUSPENSEY_IMAGE_TIME_ESTIMATE` 以 500 毫秒下载预算估算图片等待是否划算，超预算则缩短实际等待。 */
const SUSPENSEY_IMAGE_TIME_ESTIMATE = 500;

let estimatedBytesWithinLimit: number = 0;

/**
 * 收集完资源后先插入无需继续等 preload 的样式，重新检查 count/imgCount，决定提交是否需要挂起。
 * 需要等待则返回注册 commit 的函数：CSS/既有动画最长等 60 秒，图片通常等 800ms，下载预算超出时只等 50ms。
 * 图片超时仅解除图片阻塞，CSS 仍需完成；总等待超时清空 unsuspend 后放行，取消函数清空入口并清掉两只定时器。
 *
 * @param timeoutOffset - 等待上限附加的毫秒数，由 reconciler 根据已用渲染时间等调度条件计算。
 */
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
      //达到 CSS 等待上限后插入剩余样式并放行提交，即使样式尚未加载；资源后续完成时 unsuspend 已清空。
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

/** `getSuspendedCommitReason` 根据动画、CSS 和图片等待状态生成 Profiler 的阻塞原因说明。 */
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

/** `checkIfFullyUnsuspended` CSS/动画计数归零且图片完成或停止等待时，插入排队样式；无需再插入时取出并清空唤醒回调。 */
function checkIfFullyUnsuspended(state: SuspendedState) {
  if (state.count === 0 && (state.imgCount === 0 || !state.waitingForImages)) {
    if (state.stylesheets) {
      //先插入排队的匹配 media 样式，再等实际 stylesheet 的 load/error；插入时可能重新增加 count，所以此分支不直接调用 commit。
      insertSuspendedStylesheets(state, state.stylesheets);
    } else if (state.unsuspend) {
      const unsuspend = state.unsuspend;
      state.unsuspend = null;
      unsuspend();
    }
  }
}

/** `onUnsuspend` CSS、preload 或动画完成时减少 count，再检查是否可插入样式或提交。 */
function onUnsuspend(this: SuspendedState) {
  this.count--;
  checkIfFullyUnsuspended(this);
}

/** `onUnsuspendImg` 图片 decode 成功或失败时减少 imgCount，再检查是否可以提交。 */
function onUnsuspendImg(this: SuspendedState) {
  this.imgCount--;
  checkIfFullyUnsuspended(this);
}

/** 每个资源根的临时precedence Map用null键记录所有样式组的最后节点；字符串键仍记录各组尾部，两者分开以便新组接到现有样式末尾。 */
const LAST_PRECEDENCE = null;

//只在 insertSuspendedStylesheets 的同步调用期间创建并读取，批量插入后立即清空。
let precedencesByRoot: Map<
  HoistableRoot,
  Map<string | typeof LAST_PRECEDENCE, Instance>,
> = null as any;

/** `insertSuspendedStylesheets` 取走样式队列，取消状态则跳过；用临时 count 防止同步加载在整批插入完成前唤醒提交。 */
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

/** `insertStylesheetIntoRoot` 按资源根的 precedence 顺序插入尚未插入的 stylesheet，登记 load/error 等待并设置 Inserted 位。 */
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
  //从已准备的 stylesheet 实例读取其顺序组名。
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

/** `NotPendingTransition` form action 没有 pending 工作时的默认 FormStatus。 */
export const NotPendingTransition: TransitionStatus = NotPending;
/** `HostTransitionContext` 向 form 后代提供 action 状态的 React context，两个 renderer 槽都初始化为 NotPending。 */
export const HostTransitionContext: ReactContext<TransitionStatus> = {
  $$typeof: REACT_CONTEXT_TYPE,
  Provider: null as any,
  Consumer: null as any,
  _currentValue: NotPendingTransition,
  _currentValue2: NotPendingTransition,
  _threadCount: 0,
};

/** `FormInstance` 宿主表单的原生 HTMLFormElement。 */
export type FormInstance = HTMLFormElement;
/** `resetFormInstance` mutation 中临时开启 React 事件分发，调用 form.reset 后再次关闭，允许 reset 事件处理。 */
export function resetFormInstance(form: FormInstance): void {
  ReactBrowserEventEmitterSetEnabled(true);
  form.reset();
  ReactBrowserEventEmitterSetEnabled(false);
}
