/**
 * HTMLLoader 的普通入口输入，包含原生 head/body、内联 CSS、普通/nomodule/module 和远程 UMD 四个脚本。
 * fetch stub 原样提供此字符串；格式化阶段只改容器，脚本提取与过滤由后续 source/index 完成。
 */
export const MOCK_BASIC_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      background: #f5f5f5;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <div id='top-level'></div>
  <script src="./script1.js"></script>
  <script src="./nomodule.js" nomodule></script>
  <script src="./module.js" type='module'></script>
  <script src="https://storage.360buyimg.com/launch/zeromock/umd-module.js"></script>
</body>
</html>
`

/**
 * 旧 HTMLLoader 预期：改写 head/body 并省略 zeromock 外链，当前内置格式化实际会保留该脚本。
 * 保留字符串原文以说明历史断言差异，不能将它作为 rc.32 容器转换后的正确逐字输出。
 */
export const MOCK_APP_HTML = `
<!DOCTYPE html>
<html lang="en">
<micro-app-head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      background: #f5f5f5;
    }
  </style>
</micro-app-head>
<micro-app-body>
  <div id="root"></div>
  <div id='top-level'></div>
  <script src="./script1.js"></script>
  <script src="./nomodule.js" nomodule></script>
  <script src="./module.js" type='module'></script>
</micro-app-body>
</html>
`
