import { createSignal, Show } from 'solid-js'
import { StorageKey } from '../constant'
import { downloadAsJsonFile, restoreSettings, settings, setSetting } from '../lib'
import {
  getGithubToken as getGithubTokenFromStorage,
  setGithubToken as setGithubTokenToStorage,
  getGithubGistId as getGithubGistIdFromStorage,
  setGithubGistId as setGithubGistIdToStorage
} from '../lib/settings'
import { syncUpKnowns, getLocalValue } from '../lib/storage'
import { Note } from './note'
import { syncWithDrive, getBackupData, syncWithGist, syncWithWebDAV, restoreBackupData } from '../lib/backup/sync'
import { formatTime } from '../lib/utils'
import { isMobile, isValidAuthToken } from '../lib/backup/drive'

import { SyncType } from '../lib/settings'

export const Backup = () => {
  const [toastSuccess, setToastSuccess] = createSignal('')
  const [toastError, setToastError] = createSignal('')
  const [syncing, setSyncing] = createSignal(false)
  const [latestSyncTime, setLatestSyncTime] = createSignal(0)
  const [syncFailedMessage, setSyncFailedMessage] = createSignal('')
  const [gdriveToken, setGdriveToken] = createSignal('')
  const [githubSyncing, setGithubSyncing] = createSignal(false)
  const [latestGistSyncTime, setLatestGistSyncTime] = createSignal(0)
  const [gistSyncFailedMessage, setGistSyncFailedMessage] = createSignal('')
  const [githubToken, setGithubToken] = createSignal('')
  const [githubGistId, setGithubGistId] = createSignal('')
  const [webdavSyncing, setWebdavSyncing] = createSignal(false)
  const [latestWebDAVSyncTime, setLatestWebDAVSyncTime] = createSignal(0)
  const [webdavSyncFailedMessage, setWebdavSyncFailedMessage] = createSignal('')

  const onGDriveTokenInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement
    setGdriveToken(target.value)
    if (target.value.trim() === '') {
      chrome.storage.local.remove([StorageKey.mobile_auth_token])
    } else {
      if (isValidAuthToken(target.value)) {
        chrome.storage.local.set({ [StorageKey.mobile_auth_token]: target.value })
      } else {
        toastE('invalid auth token')
      }
    }
  }

  const onGithubTokenInput = (e: Event) => {
    const target = e.target as HTMLInputElement
    const value = target.value
    setGithubToken(value)
    setGithubTokenToStorage(value)
  }

  const onGithubGistIdInput = (e: Event) => {
    const target = e.target as HTMLInputElement
    const value = target.value
    setGithubGistId(value)
    setGithubGistIdToStorage(value)
  }

  const onWebDAVUrlInput = (e: Event) => {
    const target = e.target as HTMLInputElement
    setSetting('webdav', { ...settings().webdav, url: target.value })
  }

  const onWebDAVUsernameInput = (e: Event) => {
    const target = e.target as HTMLInputElement
    setSetting('webdav', { ...settings().webdav, username: target.value })
  }

  const onWebDAVPasswordInput = (e: Event) => {
    const target = e.target as HTMLInputElement
    setSetting('webdav', { ...settings().webdav, password: target.value })
  }

  const onSyncTypeChange = (e: Event) => {
    const target = e.target as HTMLSelectElement
    setSetting('syncType', target.value as SyncType)
  }

  getLocalValue(StorageKey.latest_sync_time).then(time => {
    if (time) {
      setLatestSyncTime(time)
    }
  })

  getLocalValue(StorageKey.sync_failed_message).then(message => {
    if (message) {
      setSyncFailedMessage(message)
    }
  })

  getLocalValue(StorageKey.mobile_auth_token).then(token => {
    if (token) {
      setGdriveToken(token)
    }
  })

  getLocalValue(StorageKey.latest_gist_sync_time).then(time => {
    if (time) {
      setLatestGistSyncTime(time)
    }
  })

  getLocalValue(StorageKey.gist_sync_failed_message).then(message => {
    if (message) {
      setGistSyncFailedMessage(message)
    }
  })

  getLocalValue(StorageKey.latest_webdav_sync_time).then(time => {
    if (time) {
      setLatestWebDAVSyncTime(time)
    }
  })

  getLocalValue(StorageKey.webdav_sync_failed_message).then(message => {
    if (message) {
      setWebdavSyncFailedMessage(message)
    }
  })

  // Load and migrate github token/gistId
  Promise.all([getGithubTokenFromStorage(), getGithubGistIdFromStorage()]).then(([token, gistId]) => {
    // Migration: check if they exist in old settings
    const currentSettings = settings() as any
    if (!token && currentSettings.githubToken) {
      token = currentSettings.githubToken
      setGithubTokenToStorage(token)
    }
    if (!gistId && currentSettings.githubGistId) {
      gistId = currentSettings.githubGistId
      setGithubGistIdToStorage(gistId)
    }

    if (token) setGithubToken(token)
    if (gistId) setGithubGistId(gistId)
  })

  const toastS = (message: string) => {
    setToastSuccess('✅ ' + message)
    setTimeout(() => {
      setToastSuccess('')
    }, 5000)
  }

  const toastE = (message: string) => {
    setToastError('❌ ' + message)
    setTimeout(() => {
      setToastError('')
    }, 5000)
  }

  const onRestore = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async e => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) {
        toastE('no files')
        return false
      }

      const reader = new FileReader()
      reader.onload = async () => {
        const data = reader.result
        try {
          await restoreData(data as string)
          toastS('restore success')
        } catch (e) {
          toastE('invalid file')
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  const restoreData = async (data: string) => {
    if (typeof data !== 'string') return
    const json = JSON.parse(data)
    if (!json[StorageKey.known]) {
      toastE('invalid file️')
      return
    }
    await restoreBackupData(json)
    toastS('restore success')
  }

  const onBackup = async () => {
    const now = Date.now()
    const fileName = `word_hunter_backup_${formatTime(now).replaceAll('/', '_')}_${now}.json`
    const backupData = await getBackupData()
    downloadAsJsonFile(JSON.stringify(backupData), fileName)
  }

  const onDriveSync = async () => {
    if (syncing()) return
    setSyncing(true)
    try {
      const latestSyncTime = await syncWithDrive(true)
      setLatestSyncTime(latestSyncTime)
      setSyncFailedMessage('')
      setSyncing(false)
      toastS('sync success')
    } catch (e: any) {
      setSyncing(false)
      setSyncFailedMessage(e.message)
      toastE('sync failed: ️' + e.message)
    }
  }

  const onGithubGistSync = async () => {
    if (githubSyncing()) return
    const token = githubToken()
    const gistId = githubGistId()
    if (!token || !gistId) {
      toastE('invalid token or gist id')
      return
    }
    setGithubSyncing(true)
    try {
      const latestSyncTime = await syncWithGist(token, gistId)
      setLatestGistSyncTime(latestSyncTime)
      setGistSyncFailedMessage('')
      toastS('sync success')
    } catch (e: any) {
      setGistSyncFailedMessage(e.message)
      toastE('Error during sync settings: ' + e.message)
    } finally {
      setGithubSyncing(false)
    }
  }

  const onWebDAVSync = async () => {
    if (webdavSyncing()) return
    const { url } = settings().webdav
    if (!url) {
      toastE('invalid webdav url')
      return
    }
    setWebdavSyncing(true)
    try {
      const latestSyncTime = await syncWithWebDAV()
      setLatestWebDAVSyncTime(latestSyncTime)
      setWebdavSyncFailedMessage('')
      toastS('sync success')
    } catch (e: any) {
      setWebdavSyncFailedMessage(e.message)
      toastE('Error during sync settings: ' + e.message)
    } finally {
      setWebdavSyncing(false)
    }
  }

  return (
    <>
      <section class="section">
        <h2 class="h2">
          Backup<Note>Automatically sync between Chromes (without context data)</Note>
        </h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <button onclick={onRestore} class="btn btn-block btn-lg capitalize text-xs">
            ️<img src={chrome.runtime.getURL('icons/upload.png')} class="w-8 h-8" alt="upload" />
            restore
          </button>
          <button onclick={onBackup} class="btn btn-block btn-lg capitalize text-xs">
            ️<img src={chrome.runtime.getURL('icons/download.png')} class="w-8 h-8" alt="backup" />
            backup
          </button>
        </div>

        <div class="divider">Sync Method</div>

        <select
          class="select select-bordered w-full mb-4"
          style={{
            'margin-left': 'var(--px-block)',
            'margin-right': 'var(--px-block)',
            width: 'calc(100% - 2 * var(--px-block))'
          }}
          onchange={onSyncTypeChange}
        >
          <option value="google_drive" selected={settings().syncType === 'google_drive'}>
            Google Drive
          </option>
          <option value="github_gist" selected={settings().syncType === 'github_gist'}>
            Github Gist
          </option>
          <option value="webdav" selected={settings().syncType === 'webdav'}>
            WebDAV
          </option>
        </select>

        <Show when={settings().syncType === 'google_drive'}>
          <div class="grid gap-4 mt-1 mb-2">
            <Show when={isMobile}>
              <textarea
                placeholder="Only for Mobile browser:\n Run `await chrome.identity.getAuthToken()` in Desktop Chrome console in option page to get the token, then paste it here."
                class="textarea textarea-bordered textarea-lg w-full h-24 text-sm leading-5"
                classList={{ 'textarea-error': !!gdriveToken() && !isValidAuthToken(gdriveToken()) }}
                value={gdriveToken()}
                oninput={onGDriveTokenInput}
              />
            </Show>
            <button onclick={onDriveSync} class="btn btn-block btn-lg capitalize text-xs">
              <img
                src={chrome.runtime.getURL('icons/gdrive.png')}
                classList={{ 'animate-spin': syncing() }}
                class="w-8 h-8"
                alt="upload"
              />
              Google Drive Sync
            </button>

            <Show when={latestSyncTime() > 0 && !syncFailedMessage()}>
              <div class="text-center text-accent">Latest sync: {formatTime(latestSyncTime())}</div>
            </Show>
            <Show when={!!syncFailedMessage()}>
              <div class="text-center text-error">❌ Sync Failed: {syncFailedMessage()}</div>
            </Show>
          </div>
        </Show>

        <Show when={settings().syncType === 'github_gist'}>
          <div class="grid gap-4 mt-1 mb-2">
            <input
              type="text"
              class="input input-bordered text-sm"
              placeholder="Github Token"
              value={githubToken()}
              oninput={onGithubTokenInput}
            />
            <input
              type="text"
              class="input input-bordered text-sm"
              placeholder="GitHub Gist Id"
              value={githubGistId()}
              oninput={onGithubGistIdInput}
            />
            <button class="btn btn-block btn-lg capitalize text-xs" onclick={onGithubGistSync}>
              <img
                src={chrome.runtime.getURL('icons/github.png')}
                classList={{ 'animate-spin': githubSyncing() }}
                class="w-8 h-8"
                alt="github"
              />
              Github Gist Sync
            </button>
            <Show when={latestGistSyncTime() > 0 && !gistSyncFailedMessage()}>
              <div class="text-center text-accent">Latest sync: {formatTime(latestGistSyncTime())}</div>
            </Show>
            <Show when={githubToken() && githubGistId() && !!gistSyncFailedMessage()}>
              <div class="text-center text-error">❌ Sync Failed: {gistSyncFailedMessage()}</div>
            </Show>
          </div>
        </Show>

        <Show when={settings().syncType === 'webdav'}>
          <div class="grid gap-4 mt-1 mb-2">
            <input
              type="text"
              class="input input-bordered text-sm"
              placeholder="WebDAV URL (directory, not file)"
              value={settings().webdav.url}
              oninput={onWebDAVUrlInput}
            />
            <div class="text-xs text-base-content/60">
              <span>Example: </span>
              <code class="bg-base-200 px-1 rounded">https://dav.jianguoyun.com/dav/</code>
            </div>
            <input
              type="text"
              class="input input-bordered text-sm"
              placeholder="WebDAV Username"
              value={settings().webdav.username}
              oninput={onWebDAVUsernameInput}
            />
            <input
              type="password"
              class="input input-bordered text-sm"
              placeholder="WebDAV Password"
              value={settings().webdav.password}
              oninput={onWebDAVPasswordInput}
            />
            <button class="btn btn-block btn-lg capitalize text-xs" onclick={onWebDAVSync}>
              <img
                src={chrome.runtime.getURL('icons/webdav.png')}
                classList={{ 'animate-spin': webdavSyncing() }}
                class="w-8 h-8"
                alt="webdav"
                onerror={(e) => (e.currentTarget.src = chrome.runtime.getURL('icons/upload.png'))}
              />
              WebDAV Sync
            </button>
            <Show when={latestWebDAVSyncTime() > 0 && !webdavSyncFailedMessage()}>
              <div class="text-center text-accent">Latest sync: {formatTime(latestWebDAVSyncTime())}</div>
            </Show>
            <Show when={settings().webdav.url && !!webdavSyncFailedMessage()}>
              <div class="text-center text-error">❌ Sync Failed: {webdavSyncFailedMessage()}</div>
            </Show>
          </div>
        </Show>
      </section>
      <Show when={toastSuccess()}>
        <div class="toast toast-end toast-bottom">
          <div class="alert alert-success">
            <span>{toastSuccess()}</span>
          </div>
        </div>
      </Show>
      <Show when={toastError()}>
        <div class="toast toast-end toast-bottom">
          <div class="alert alert-error">
            <span>{toastError()}</span>
          </div>
        </div>
      </Show>
    </>
  )
}
