import { StorageKey, WordMap, ContextMap } from '../../constant'
import { mergeKnowns, mergeContexts, cleanupContexts, getAllKnownSync, getLocalValue, getSyncValue, syncUpKnowns } from '../storage'
import { SettingType, mergeSetting, settings, getGithubToken, getGithubGistId, restoreSettings, sanitizeSettings } from '../settings'
import * as GDrive from './drive'
import { getGistData, updateGist } from './github'
import * as WebDAV from './webdav'

export type BackupData = {
  known: WordMap
  context: ContextMap
  settings: SettingType
  knwon_update_timestamp: number
  context_update_timestamp: number
  settings_update_timestamp: number
}

export async function getBackupData(): Promise<BackupData> {
  const locals = await chrome.storage.local.get([StorageKey.context, StorageKey.context_update_timestamp])
  const syncs = await chrome.storage.sync.get([
    StorageKey.settings,
    StorageKey.knwon_update_timestamp,
    StorageKey.settings_update_timestamp
  ])
  const knowns = await getAllKnownSync()
  const settings = syncs[StorageKey.settings] || {}
  // Sanitize settings to remove sensitive data if it exists from old versions
  delete (settings as any).githubToken
  delete (settings as any).githubGistId

  return {
    [StorageKey.known]: knowns,
    [StorageKey.settings]: settings,
    [StorageKey.context]: cleanupContexts(locals[StorageKey.context] || {}, knowns),
    [StorageKey.knwon_update_timestamp]: syncs[StorageKey.knwon_update_timestamp] ?? 0,
    [StorageKey.settings_update_timestamp]: syncs[StorageKey.settings_update_timestamp] ?? 0,
    [StorageKey.context_update_timestamp]: locals[StorageKey.context_update_timestamp] ?? 0
  }
}

export async function getMergedData(appData: BackupData, remoteData: BackupData) {
  const [mergedSettings, setting_update_time] = await mergeSetting(
    appData[StorageKey.settings] ?? {},
    remoteData[StorageKey.settings] ?? {},
    appData[StorageKey.settings_update_timestamp],
    remoteData[StorageKey.settings_update_timestamp]
  )
  const [mergedKnowns, knwon_update_timestamp] = await mergeKnowns(
    remoteData[StorageKey.known],
    remoteData[StorageKey.knwon_update_timestamp]
  )
  const [mergedContexts, context_update_timestamp] = await mergeContexts(
    remoteData[StorageKey.context],
    remoteData[StorageKey.context_update_timestamp]
  )

  return {
    [StorageKey.known]: mergedKnowns,
    [StorageKey.context]: cleanupContexts(mergedContexts, mergedKnowns),
    [StorageKey.settings]: mergedSettings,
    [StorageKey.settings_update_timestamp]: setting_update_time,
    [StorageKey.knwon_update_timestamp]: knwon_update_timestamp,
    [StorageKey.context_update_timestamp]: context_update_timestamp
  }
}

export async function restoreBackupData(json: BackupData) {
  const updateTime = Date.now()
  await chrome.storage.local.set({
    [StorageKey.context]: json[StorageKey.context] ?? {},
    [StorageKey.context_update_timestamp]: updateTime
  })
  syncUpKnowns(Object.keys(json[StorageKey.known] ?? {}), json[StorageKey.known], updateTime)
  await restoreSettings(json[StorageKey.settings])
}

export async function _syncWithDrive(interactive: boolean = true) {
  await GDrive.auth(interactive)
  let dirId = await GDrive.findDirId()
  let fileId = ''
  if (!dirId) {
    dirId = await GDrive.createFolder(GDrive.FOLDER_NAME)
  } else {
    fileId = await GDrive.findFileId(dirId)
  }

  if (fileId) {
    // merge and sync
    const appData = await getBackupData()
    const gdriveData = (await GDrive.downloadFile(fileId)) as BackupData
    const mergedData = await getMergedData(appData, gdriveData)
    mergedData.settings = sanitizeSettings(mergedData.settings)
    const file = new File([JSON.stringify(mergedData)], GDrive.FILE_NAME, { type: 'application/json' })
    await GDrive.uploadFile(file, 'application/json', dirId, fileId)
  } else {
    // just upload
    const localData = await getBackupData()
    localData.settings = sanitizeSettings(localData.settings)
    const file = new File([JSON.stringify(localData)], GDrive.FILE_NAME, { type: 'application/json' })
    await GDrive.uploadFile(file, 'application/json', dirId)
  }
}

export async function syncWithDrive(interactive: boolean): Promise<number> {
  try {
    await _syncWithDrive(interactive)
    const latest_sync_time = Date.now()
    await chrome.storage.local.set({
      [StorageKey.latest_sync_time]: latest_sync_time,
      [StorageKey.sync_failed_message]: ''
    })
    return latest_sync_time
  } catch (e: any) {
    await chrome.storage.local.set({ [StorageKey.sync_failed_message]: e.message })
    throw e
  }
}

export async function _syncWithGist(token: string, gistId: string) {
  const appData = await getBackupData()
  const gistData = await getGistData(token, gistId)
  const mergedData = await getMergedData(appData, gistData)
  mergedData.settings = sanitizeSettings(mergedData.settings)
  await updateGist(token, gistId, mergedData)
}

export async function syncWithGist(token: string, gistId: string): Promise<number> {
  try {
    await _syncWithGist(token, gistId)
    const latest_gist_sync_time = Date.now()
    await chrome.storage.local.set({
      [StorageKey.latest_gist_sync_time]: latest_gist_sync_time,
      [StorageKey.gist_sync_failed_message]: ''
    })
    return latest_gist_sync_time
  } catch (e: any) {
    await chrome.storage.local.set({ [StorageKey.gist_sync_failed_message]: e.message })
    throw e
  }
}

export async function triggerWebDAVSyncJob() {
  if (settings().syncType !== 'webdav') return
  if (!(await getLocalValue(StorageKey.latest_webdav_sync_time))) return
  chrome.alarms.clear(WEBDAV_SYNC_ALARM_NAME)
  chrome.alarms.create(WEBDAV_SYNC_ALARM_NAME, {
    delayInMinutes: 1
  })
}

export async function _syncWithWebDAV() {
  const appData = await getBackupData()
  const webdavData = await WebDAV.downloadFile()
  if (webdavData) {
    const mergedData = await getMergedData(appData, webdavData)
    mergedData.settings = sanitizeSettings(mergedData.settings)
    await WebDAV.uploadFile(mergedData)
    await restoreBackupData(mergedData)
  } else {
    appData.settings = sanitizeSettings(appData.settings)
    await WebDAV.uploadFile(appData)
  }
}

export async function syncWithWebDAV(): Promise<number> {
  try {
    await _syncWithWebDAV()
    const latest_webdav_sync_time = Date.now()
    await chrome.storage.local.set({
      [StorageKey.latest_webdav_sync_time]: latest_webdav_sync_time,
      [StorageKey.webdav_sync_failed_message]: ''
    })
    return latest_webdav_sync_time
  } catch (e: any) {
    await chrome.storage.local.set({ [StorageKey.webdav_sync_failed_message]: e.message })
    throw e
  }
}

const SYNC_ALARM_NAME = 'SYNC_WITH_GDRIVE'
const GIST_SYNC_ALARM_NAME = 'SYNC_WITH_GIST'
const WEBDAV_SYNC_ALARM_NAME = 'SYNC_WITH_WEBDAV'

export async function triggerGoogleDriveSyncJob() {
  if (settings().syncType !== 'google_drive') return
  if (!(await getLocalValue(StorageKey.latest_sync_time)) || !(await getSyncValue(StorageKey.latest_sync_time))) return
  chrome.alarms.clear(SYNC_ALARM_NAME)
  chrome.alarms.create(SYNC_ALARM_NAME, {
    delayInMinutes: 1
  })
}

export async function triggerGithubGistSyncJob() {
  if (settings().syncType !== 'github_gist') return
  if (!(await getLocalValue(StorageKey.latest_gist_sync_time))) return
  chrome.alarms.clear(GIST_SYNC_ALARM_NAME)
  chrome.alarms.create(GIST_SYNC_ALARM_NAME, {
    delayInMinutes: 1
  })
}

export async function triggerSyncJob() {
  triggerGoogleDriveSyncJob()
  triggerGithubGistSyncJob()
  triggerWebDAVSyncJob()
}

chrome.alarms?.onAlarm?.addListener(async ({ name }) => {
  const syncType = settings().syncType
  if (name === SYNC_ALARM_NAME) {
    if (syncType === 'google_drive') {
      syncWithDrive(false)
    }
  }
  if (name === GIST_SYNC_ALARM_NAME) {
    const token = await getGithubToken()
    const gistId = await getGithubGistId()
    if (syncType === 'github_gist' && token && gistId) {
      syncWithGist(token, gistId)
    }
  }
  if (name === WEBDAV_SYNC_ALARM_NAME) {
    if (syncType === 'webdav' && settings().webdav.url) {
      syncWithWebDAV()
    }
  }
})
