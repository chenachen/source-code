import json from './data.json' with { type: 'json' }

/** 带 type:json import attribute 导入后的字段，重导出以验证依赖转换保留 JSON 值。 */
export const hello = json.hello
