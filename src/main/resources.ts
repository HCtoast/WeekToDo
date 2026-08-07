import { join } from 'node:path'
import { app } from 'electron'

/**
 * 아이콘 등 정적 리소스 경로.
 * 개발 중에는 프로젝트의 `resources/`, 패키징 후에는 앱 리소스 폴더를 본다
 * (electron-builder의 `extraResources`가 그쪽으로 복사한다).
 */
export function resourcePath(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, name)
    : join(app.getAppPath(), 'resources', name)
}

export const trayIconPath = (): string => resourcePath('tray.png')
export const appIconPath = (): string => resourcePath('icon.png')
