// 包没有 exports，目录入口应解析到 entries/dir/index.js。
import dirEntry from '@vitejs/test-entries/dir'
// 包没有 exports，文件入口应解析到 entries/file.js。
import fileEntry from '@vitejs/test-entries/file'
// 包有 exports，入口应按其映射解析到 pkg-exports/entry。
import pkgExportsEntry from '@vitejs/test-resolve-pkg-exports/entry'
import deepFoo from '@vitejs/test-deep-import/foo'
// import deepBar from '@vitejs/test-deep-import/bar'
import moduleSync from '@vitejs/test-module-sync'
import { used } from './util'

export default `
  entries/dir: ${dirEntry}
  entries/file: ${fileEntry}
  pkg-exports/entry: ${pkgExportsEntry}
  deep-import/foo: ${deepFoo}
  ${/* `deep-import/bar: ${deepBar}` */ ''}
  module-sync: ${moduleSync}
  util: ${used(['[success]'])}
`
