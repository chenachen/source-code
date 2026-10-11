import { execSync } from 'node:child_process'
import path from 'node:path'

/** 用 Windows COM 查询文件短路径；仅接受与原路径不同且含 ~ 的结果，平台不支持或命令失败时返回 undefined。 */
function getWindows83ShortName(inputPath: string): string | undefined {
  try {
    const result = execSync(
      `powershell -Command "(New-Object -ComObject Scripting.FileSystemObject).GetFile('${inputPath}').ShortPath"`,
      { encoding: 'utf-8', stdio: 'pipe' },
    ).trim()
    return result !== inputPath && result.includes('~') ? result : undefined
  } catch {
    return undefined
  }
}

/** 读取夹具 .env 的可用 8.3 短文件名，供页面构造 deny 绕过请求；不可用时跳过该变体。 */
export function getWindows83ShortNameForDotEnv(): string | undefined {
  const dotEnvPath = path.resolve(import.meta.dirname, '../root/src/.env')
  const dotEnvWindows83ShortName = getWindows83ShortName(dotEnvPath)
  if (dotEnvWindows83ShortName === undefined) {
    return undefined
  }
  return path.basename(dotEnvWindows83ShortName)
}
