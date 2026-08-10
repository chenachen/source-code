/*!
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * React DOM Client 测试使用的 TypeScript 声明文件。
 *
 * 这里并非正式、完整的公共类型定义，只提供单元测试所需的最小表面。
 */

declare module 'react-dom/client' {
  /** 为容器创建并发根。 */
  export function createRoot(container : any, options?: any) : any
  /** 为已有服务端标记的容器创建水合根。 */
  export function hydrateRoot(container : any, children: any, options?: any) : any
}
