/// <reference path="./importMeta.d.ts" />

// https://github.com/microsoft/TypeScript/issues/45096 导致用户侧无法可靠使用
// `<reference types="vite/types/importMeta" />`；这个连字符文件只做路径转接，为
// `vite/types/import-meta` 提供可工作的声明入口。
