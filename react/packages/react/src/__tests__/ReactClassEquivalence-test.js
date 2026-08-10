/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** 同步子进程入口，用于在隔离环境中比较不同构建模式。 */
const spawnSync = require('child_process').spawnSync;

describe('ReactClassEquivalence', () => {
  /**
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“tests the same thing for es6 classes and CoffeeScript”场景的唯一关键操作。
   * Then：断言 class 组件在开发与生产构建间的行为等价性 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
  it('tests the same thing for es6 classes and CoffeeScript', () => {
    const result1 = runJest('ReactCoffeeScriptClass-test.coffee');
    const result2 = runJest('ReactES6Class-test.js');
    compareResults(result1, result2);
  });

  /**
   * 场景：“tests the same thing for es6 classes and TypeScript”。
   * 机制：验证class 组件在开发与生产构建间的行为等价性，锁定可观察结果与失败边界。
   */
  it('tests the same thing for es6 classes and TypeScript', () => {
    const result1 = runJest('ReactTypeScriptClass-test.ts');
    const result2 = runJest('ReactES6Class-test.js');
    compareResults(result1, result2);
  });
});

/** 在指定环境变量下启动子 Jest 进程并返回可比较结果。 */
function runJest(testFile) {
  const cwd = process.cwd();
  const extension = process.platform === 'win32' ? '.cmd' : '';
  const command = process.env.npm_lifecycle_event;
  const defaultReporter = '--reporters=default';
  const equivalenceReporter =
    '--reporters=<rootDir>/scripts/jest/spec-equivalence-reporter/equivalenceReporter.js';
  if (!command.startsWith('test')) {
    throw new Error(
      'Expected this test to run as a result of one of test commands.',
    );
  }
  const result = spawnSync(
    'yarn' + extension,
    [command, testFile, defaultReporter, equivalenceReporter],
    {
      cwd,
      env: Object.assign({}, process.env, {
        REACT_CLASS_EQUIVALENCE_TEST: 'true',
      }),
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      'jest process exited with: ' +
        result.status +
        '\n' +
        'stdout: ' +
        result.stdout.toString() +
        'stderr: ' +
        result.stderr.toString(),
    );
  }

  return result.stdout.toString() + result.stderr.toString();
}

/** 比较开发与生产构建的测试结果，验证 class 行为等价。 */
function compareResults(a, b) {
  const regexp = /EQUIVALENCE.*$/gm;
  const aSpecs = (a.match(regexp) || []).sort().join('\n');
  const bSpecs = (b.match(regexp) || []).sort().join('\n');

  if (aSpecs.length === 0 && bSpecs.length === 0) {
    throw new Error('No spec results found in the output');
  }

  expect(aSpecs).toEqual(bSpecs);
}
