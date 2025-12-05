import { createClient, WebDAVClient } from 'webdav'
import { settings } from '../settings'
import { BackupData } from './sync'

const FOLDER_NAME = 'word-hunter'
export const FILE_NAME = 'word_hunter_backup.json'

function validateUrl(url: string) {
  if (!url) throw new Error('WebDAV URL is required')
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('WebDAV URL must start with http:// or https://')
  }
}

function getBaseUrl(): string {
  const { url } = settings().webdav
  // 如果 URL 以文件名结尾，提取目录；否则使用完整 URL 作为目录
  if (url.endsWith(FILE_NAME)) {
    return url.slice(0, url.lastIndexOf('/') + 1)
  }
  // 如果不是以 / 结尾，添加 /
  return url.endsWith('/') ? url : url + '/'
}

function getClient(): WebDAVClient {
  const { url, username, password } = settings().webdav
  validateUrl(url)

  const baseUrl = getBaseUrl()
  return createClient(baseUrl, {
    username: username || undefined,
    password: password || undefined
  })
}

function getFilePath(): string {
  // 返回相对于 baseUrl 的路径，不要完整 URL
  return `${FOLDER_NAME}/${FILE_NAME}`
}

async function ensureFolderExists(client: WebDAVClient): Promise<void> {
  const folderExists = await client.exists(FOLDER_NAME)
  if (!folderExists) {
    await client.createDirectory(FOLDER_NAME)
  }
}

export async function checkConnection(): Promise<boolean> {
  const client = getClient()
  // 检查根目录是否可访问
  const exists = await client.exists('/')
  if (!exists) {
    throw new Error('WebDAV connection failed: root directory not accessible')
  }

  await ensureFolderExists(client)
  return true
}

export async function uploadFile(data: BackupData): Promise<void> {
  const client = getClient()
  await ensureFolderExists(client)

  const filePath = getFilePath()
  await client.putFileContents(filePath, JSON.stringify(data), {
    overwrite: true
  })
}

export async function downloadFile(): Promise<BackupData | null> {
  const client = getClient()
  await ensureFolderExists(client)

  const filePath = getFilePath()
  const exists = await client.exists(filePath)
  if (!exists) {
    return null
  }

  const content = await client.getFileContents(filePath, { format: 'text' })
  return JSON.parse(content as string)
}
