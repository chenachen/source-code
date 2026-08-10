/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// server 构建会 fork 此占位值，因为服务端默认 stack frame 可能已经过 source map。

export default undefined as any as (Error, Array<CallSite>) => string;
