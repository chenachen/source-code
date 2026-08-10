/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** 服务端为限制 console 传输量而省略大对象时使用的稳定占位消息。 */
export const OMITTED_PROP_ERROR =
  'This object has been omitted by React in the console log ' +
  'to avoid sending too much data from the server. Try logging smaller ' +
  'or more specific objects.';
