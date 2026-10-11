/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  RenderState as BaseRenderState,
  ResumableState,
  HoistableState,
  StyleQueue,
  Resource,
  HeadersDescriptor,
  PreambleState,
  FormatContext,
} from './ReactFizzConfigDOM';

import {
  createRenderState as createRenderStateImpl,
  pushTextInstance as pushTextInstanceImpl,
  pushSegmentFinale as pushSegmentFinaleImpl,
  pushStartActivityBoundary as pushStartActivityBoundaryImpl,
  pushEndActivityBoundary as pushEndActivityBoundaryImpl,
  writeStartCompletedSuspenseBoundary as writeStartCompletedSuspenseBoundaryImpl,
  writeStartClientRenderedSuspenseBoundary as writeStartClientRenderedSuspenseBoundaryImpl,
  writeEndCompletedSuspenseBoundary as writeEndCompletedSuspenseBoundaryImpl,
  writeEndClientRenderedSuspenseBoundary as writeEndClientRenderedSuspenseBoundaryImpl,
  writePreambleStart as writePreambleStartImpl,
} from './ReactFizzConfigDOM';

import type {
  Destination,
  Chunk,
  PrecomputedChunk,
} from 'react-server/src/ReactServerStreamConfig';

import type {FormStatus} from '../shared/ReactDOMFormActions';

import {NotPending} from '../shared/ReactDOMFormActions';

/** Legacy Fizz 作为次级渲染器，不占用主渲染器的 Context 槽位。 */
export const isPrimaryRenderer = false;

/** Legacy 渲染状态：复用现代 DOM 状态，并追加静态标记模式开关。 */
export type RenderState = {
  /** 与 ReactFizzConfigDOM 同步的 placeholder id 前缀。 */
  placeholderPrefix: PrecomputedChunk,
  /** 流式 segment id 前缀。 */
  segmentPrefix: PrecomputedChunk,
  /** Suspense boundary id 前缀。 */
  boundaryPrefix: PrecomputedChunk,
  /** 可复用的内联 script 起始块。 */
  startInlineScript: PrecomputedChunk,
  /** 可复用的内联 style 起始块。 */
  startInlineStyle: PrecomputedChunk,
  /** 文档前导资源与标签状态。 */
  preamble: PreambleState,
  /** Legacy 模式不安装的外部 runtime 描述。 */
  externalRuntimeScript: null | any,
  /** 启动脚本输出块。 */
  bootstrapChunks: Array<Chunk | PrecomputedChunk>,
  /** import map 输出块。 */
  importMapChunks: Array<Chunk | PrecomputedChunk>,
  /** 可选响应头回调。 */
  onHeaders: void | ((headers: HeadersDescriptor) => void),
  /** 尚未输出的资源提示响应头状态。 */
  headers: null | {
    /** 已编码的 preconnect Link 头。 */
    preconnects: string,
    /** 已编码的字体 preload Link 头。 */
    fontPreloads: string,
    /** 已编码的高优先级图片 preload Link 头。 */
    highImagePreloads: string,
    /** 当前Link响应头UTF-16码元预算。 */
    remainingCapacity: number,
  },
  /** 需要在阶段边界复位的资源状态集合。 */
  resets: BaseRenderState['resets'],
  /** charset 元数据块。 */
  charsetChunks: Array<Chunk | PrecomputedChunk>,
  /** viewport 元数据块。 */
  viewportChunks: Array<Chunk | PrecomputedChunk>,
  /** 可提升到文档前部的通用块。 */
  hoistableChunks: Array<Chunk | PrecomputedChunk>,
  /** 当前等待输出的preconnect资源集合，是否已flush由资源状态另行跟踪。 */
  preconnects: Set<Resource>,
  /** 等待写出的字体preload资源集合。 */
  fontPreloads: Set<Resource>,
  /** 等待写出的高优先级图片preload资源集合。 */
  highImagePreloads: Set<Resource>,
  // usedImagePreloads: Set<Resource>,
  /** 按 precedence 分组的样式队列。 */
  styles: Map<string, StyleQueue>,
  /** 已注册的 bootstrap 脚本资源。 */
  bootstrapScripts: Set<Resource>,
  /** 已注册的普通脚本资源。 */
  scripts: Set<Resource>,
  /** 延后批量输出的 preload 资源。 */
  bulkPreloads: Set<Resource>,
  /** 按资源类别保存的 preload 去重映射。 */
  preloads: {
    /** 图片 preload 键到资源。 */
    images: Map<string, Resource>,
    /** 样式表 preload 键到资源。 */
    stylesheets: Map<string, Resource>,
    /** 普通脚本 preload 键到资源。 */
    scripts: Map<string, Resource>,
    /** 模块脚本 preload 键到资源。 */
    moduleScripts: Map<string, Resource>,
  },
  /** 两类内联内容使用的 CSP nonce。 */
  nonce: {
    /** 写入脚本标签的CSP nonce。 */
    script: string | void,
    /** 写入样式标签的CSP nonce。 */
    style: string | void,
  },
  /** 当前是否存在需要提升的样式。 */
  stylesToHoist: boolean,
  /** Legacy 独有开关：仅生成不可水合的静态标记。 */
  generateStaticMarkup: boolean,
};

/** 以nonce/runtime/importMap/header均缺省调用现代createRenderState，再共享其数组/Set/Map字段并追加generateStaticMarkup；这是浅投影，不克隆资源记录。static开关让下方覆盖器省略hydration标记，其余宿主标签/资源编码沿用现代实现。 */
export function createRenderState(
  resumableState: ResumableState,
  generateStaticMarkup: boolean,
): RenderState {
  const renderState = createRenderStateImpl(
    resumableState,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  );
  return {
    // 这些字段必须与 ReactFizzConfigDOM 保持同步。
    placeholderPrefix: renderState.placeholderPrefix,
    segmentPrefix: renderState.segmentPrefix,
    boundaryPrefix: renderState.boundaryPrefix,
    startInlineScript: renderState.startInlineScript,
    startInlineStyle: renderState.startInlineStyle,
    preamble: renderState.preamble,
    externalRuntimeScript: renderState.externalRuntimeScript,
    bootstrapChunks: renderState.bootstrapChunks,
    importMapChunks: renderState.importMapChunks,
    onHeaders: renderState.onHeaders,
    headers: renderState.headers,
    resets: renderState.resets,
    charsetChunks: renderState.charsetChunks,
    viewportChunks: renderState.viewportChunks,
    hoistableChunks: renderState.hoistableChunks,
    preconnects: renderState.preconnects,
    fontPreloads: renderState.fontPreloads,
    highImagePreloads: renderState.highImagePreloads,
    // usedImagePreloads: renderState.usedImagePreloads,
    styles: renderState.styles,
    bootstrapScripts: renderState.bootstrapScripts,
    scripts: renderState.scripts,
    bulkPreloads: renderState.bulkPreloads,
    preloads: renderState.preloads,
    nonce: renderState.nonce,
    stylesToHoist: renderState.stylesToHoist,

    // Legacy 渲染器的额外状态。
    generateStaticMarkup,
  };
}

import {
  stringToChunk,
  stringToPrecomputedChunk,
} from 'react-server/src/ReactServerStreamConfig';

/** Legacy 模式有意使用空块，因为它不应输出 DOCTYPE。 */
export const doctypeChunk: PrecomputedChunk = stringToPrecomputedChunk('');

export type {
  ResumableState,
  HoistableState,
  PreambleState,
  FormatContext,
} from './ReactFizzConfigDOM';

export {
  getChildFormatContext,
  getSuspenseFallbackFormatContext,
  getSuspenseContentFormatContext,
  makeId,
  pushStartInstance,
  pushEndInstance,
  pushFormStateMarkerIsMatching,
  pushFormStateMarkerIsNotMatching,
  writeStartSegment,
  writeEndSegment,
  writeCompletedSegmentInstruction,
  writeCompletedBoundaryInstruction,
  writeClientRenderBoundaryInstruction,
  writeStartPendingSuspenseBoundary,
  writeEndPendingSuspenseBoundary,
  writeHoistablesForBoundary,
  writePlaceholder,
  writeCompletedRoot,
  createRootFormatContext,
  createResumableState,
  createPreambleState,
  createHoistableState,
  writePreambleEnd,
  writeHoistables,
  writePostamble,
  hoistHoistables,
  resetResumableState,
  completeResumableState,
  emitEarlyPreloads,
  supportsClientAPIs,
  hoistPreambleState,
  isPreambleReady,
  isPreambleContext,
} from './ReactFizzConfigDOM';

import escapeTextForBrowser from './escapeTextForBrowser';

/** Legacy 渲染不支持 ViewTransition 揭示，始终继承父格式上下文。 */
export function getViewTransitionFormatContext(
  resumableState: ResumableState,
  parentContext: FormatContext,
  update: void | null | 'none' | 'auto' | string,
  enter: void | null | 'none' | 'auto' | string,
  exit: void | null | 'none' | 'auto' | string,
  share: void | null | 'none' | 'auto' | string,
  parentEnter: void | null | 'none' | 'auto' | string,
  parentExit: void | null | 'none' | 'auto' | string,
  hasParentEnterHandler: boolean,
  hasParentExitHandler: boolean,
  name: void | null | 'auto' | string,
  autoName: string, // 显式名称或自动生成的唯一名称。
): FormatContext {
  // Legacy 渲染不支持 ViewTransition 揭示。
  return parentContext;
}

/** Legacy 输出不建立文档 preamble。 */
export function canHavePreamble(formatContext: FormatContext): boolean {
  return false;
}

/** 静态模式直接将转义文本加入target并返回false，不添加相邻文本分隔；可水合模式把textEmbedded交给现代编码器并保留其尾文本状态返回值，供后续segment结尾处理。 */
export function pushTextInstance(
  target: Array<Chunk | PrecomputedChunk>,
  text: string,
  renderState: RenderState,
  textEmbedded: boolean,
): boolean {
  if (renderState.generateStaticMarkup) {
    target.push(stringToChunk(escapeTextForBrowser(text)));
    return false;
  } else {
    return pushTextInstanceImpl(target, text, renderState, textEmbedded);
  }
}

/** 静态标记无需 segment 尾标记；可水合模式委托现代实现。 */
export function pushSegmentFinale(
  target: Array<Chunk | PrecomputedChunk>,
  renderState: RenderState,
  lastPushedText: boolean,
  textEmbedded: boolean,
): void {
  if (renderState.generateStaticMarkup) {
    return;
  } else {
    return pushSegmentFinaleImpl(
      target,
      renderState,
      lastPushedText,
      textEmbedded,
    );
  }
}

/** 静态标记省略 Activity 边界表示，否则写入边界起始块。 */
export function pushStartActivityBoundary(
  target: Array<Chunk | PrecomputedChunk>,
  renderState: RenderState,
): void {
  if (renderState.generateStaticMarkup) {
    // 不会水合时，已完成边界无需在 HTML 中保留表示。
    return;
  }
  pushStartActivityBoundaryImpl(target, renderState);
}

/** 静态标记省略 Activity 结束表示，否则写入结束块。 */
export function pushEndActivityBoundary(
  target: Array<Chunk | PrecomputedChunk>,
  renderState: RenderState,
): void {
  if (renderState.generateStaticMarkup) {
    return;
  }
  pushEndActivityBoundaryImpl(target, renderState);
}

/** 静态标记把已完成 Suspense 视为已写出，否则委托现代边界起始编码。 */
export function writeStartCompletedSuspenseBoundary(
  destination: Destination,
  renderState: RenderState,
): boolean {
  if (renderState.generateStaticMarkup) {
    // 不会水合时，已完成边界无需在 HTML 中保留表示。
    return true;
  }
  return writeStartCompletedSuspenseBoundaryImpl(destination, renderState);
}
/**
 * 静态标记无法客户端恢复，直接把 client-rendered 边界视为完成；可水合标记模式委托现代编码。
 */
export function writeStartClientRenderedSuspenseBoundary(
  destination: Destination,
  renderState: RenderState,
  // 静态标记模式忽略错误元数据；可水合模式向现代编码器完整转交。
  errorDigest: ?string,
  errorMessage: ?string,
  errorStack: ?string,
  errorComponentStack: ?string,
): boolean {
  if (renderState.generateStaticMarkup) {
    // 永不水合时，client-rendered 边界无需 HTML 表示；在静态生成中这本身近似错误状态。
    return true;
  }
  return writeStartClientRenderedSuspenseBoundaryImpl(
    destination,
    renderState,
    errorDigest,
    errorMessage,
    errorStack,
    errorComponentStack,
  );
}
/** 静态标记无需已完成边界尾块，否则委托现代实现。 */
export function writeEndCompletedSuspenseBoundary(
  destination: Destination,
  renderState: RenderState,
): boolean {
  if (renderState.generateStaticMarkup) {
    return true;
  }
  return writeEndCompletedSuspenseBoundaryImpl(destination, renderState);
}
/** 静态标记无需客户端边界尾块，否则委托现代实现。 */
export function writeEndClientRenderedSuspenseBoundary(
  destination: Destination,
  renderState: RenderState,
): boolean {
  if (renderState.generateStaticMarkup) {
    return true;
  }
  return writeEndClientRenderedSuspenseBoundaryImpl(destination, renderState);
}

/** 委托现代preamble写出但固定skipBlockingShell=true，忽略调用方传入值；legacy同步字符串不能等待异步shell前导依赖。canHavePreamble=false另控制遍历时不收集完整文档preamble。 */
export function writePreambleStart(
  destination: Destination,
  resumableState: ResumableState,
  renderState: RenderState,
  skipBlockingShell: boolean,
): void {
  return writePreambleStartImpl(
    destination,
    resumableState,
    renderState,
    true, // 跳过阻塞 shell。
  );
}

/** Legacy 不因 stylesheet/图片等待要求把边界单独输出。 */
export function hasSuspenseyContent(
  hoistableState: HoistableState,
  flushingInShell: boolean,
): boolean {
  // 不因 suspensey 资源要求 outline；大小等其他条件仍由 Fizz 判断。
  return false;
}

/** Legacy DOM 复用共享表单 transition 状态。 */
export type TransitionStatus = FormStatus;
/** Legacy 表单 transition 的稳定非 pending 值。 */
export const NotPendingTransition: TransitionStatus = NotPending;
