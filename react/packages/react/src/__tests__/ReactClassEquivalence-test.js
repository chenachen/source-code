/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** 同步启动独立 Jest 进程，隔离三种语言的 class 测试及其模块状态。 */
const spawnSync = require('child_process').spawnSync;

describe('ReactClassEquivalence', () => {
  /** 分别运行 CoffeeScript 与 ES6 class 套件，比较排序后的 EQUIVALENCE 用例标识；检查两套夹具覆盖相同场景，而非只比较进程是否成功。 */
  it('tests the same thing for es6 classes and CoffeeScript', () => {
    const result1 = runJest('ReactCoffeeScriptClass-test.coffee');
    const result2 = runJest('ReactES6Class-test.js');
    compareResults(result1, result2);
  });

  /** 分别运行 TypeScript 与 ES6 class 套件，比较 EQUIVALENCE 用例标识集合；若任何子套件失败或未产出标识，不能将其误判为语言行为等价。 */
  it('tests the same thing for es6 classes and TypeScript', () => {
    const result1 = runJest('ReactTypeScriptClass-test.ts');
    const result2 = runJest('ReactES6Class-test.js');
    compareResults(result1, result2);
  });
});

/**
 * 用当前 npm test 命令在独立进程运行指定语言的 class 套件，并启用等价场景 reporter。
 * REACT_CLASS_EQUIVALENCE_TEST 让子进程选择对应等价测试路径；拼接 stdout/stderr 后交给 compareResults 提取标识。
 * 非 test 命令、启动错误和非零退出码均抛错，避免把缺失或失败的子套件当成可比较结果。
 * @param testFile - 要交给 Jest 选择的语言测试文件名。
 * @returns 子进程的标准输出和错误输出文本。
 */
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

/**
 * 从两个语言套件的输出中提取、排序并比较 EQUIVALENCE 场景标识。
 * 排序消除 reporter 输出顺序差异；两个输出都无标识时显式失败，防止空集合相等掩盖没有运行场景。
 * 此处比较测试场景清单，具体行为仍由各子套件自己的断言验证。
 */
function compareResults(a, b) {
  const regexp = /EQUIVALENCE.*$/gm;
  const aSpecs = (a.match(regexp) || []).sort().join('\n');
  const bSpecs = (b.match(regexp) || []).sort().join('\n');

  if (aSpecs.length === 0 && bSpecs.length === 0) {
    throw new Error('No spec results found in the output');
  }

  expect(aSpecs).toEqual(bSpecs);
}
