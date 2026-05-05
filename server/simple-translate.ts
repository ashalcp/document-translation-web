/**
 * Simple Translate — self-contained Express router
 *
 * Uses Azure Document Translation Async Batch API + Azure Blob Storage.
 * Replicates the flow in pdf-translator/translate_pdf.py but with:
 *  - Dynamic SAS token generation (no hardcoded tokens)
 *  - Credentials read from environment variables
 *
 * Environment variables required:
 *   SIMPLE_TRANSLATE_API_KEY          — Translator resource API key
 *   AZURE_STORAGE_ACCOUNT_NAME        — e.g. ashaltranslatorstorage
 *   AZURE_STORAGE_ACCOUNT_KEY         — Storage account key (from Azure Portal)
 *   SIMPLE_TRANSLATE_ENDPOINT         — optional, defaults to ashal-translator endpoint
 */

import express from 'express'
import multer from 'multer'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} from '@azure/storage-blob'

export const simpleTranslateRouter = express.Router()

const upload = multer({ dest: os.tmpdir() })

// ── Constants ─────────────────────────────────────────────────────────────────
const TRANSLATOR_ENDPOINT =
  process.env.SIMPLE_TRANSLATE_ENDPOINT ??
  'https://ashal-translator.cognitiveservices.azure.com'
const SOURCE_CONTAINER = 'source'
const TARGET_CONTAINER = 'target'

// ── In-memory job store ───────────────────────────────────────────────────────
interface SimpleJob {
  operationLocation: string
  targetBlobName: string
  originalFileName: string
  targetLang: string
}
const jobStore = new Map<string, SimpleJob>()

// ── Helpers ───────────────────────────────────────────────────────────────────
function getCredentials(): { accountName: string; accountKey: string } {
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY
  if (!accountName || !accountKey) {
    throw new Error(
      'AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY environment variables are required.'
    )
  }
  return { accountName, accountKey }
}

function getApiKey(): string {
  const key = process.env.SIMPLE_TRANSLATE_API_KEY
  if (!key) {
    throw new Error('SIMPLE_TRANSLATE_API_KEY environment variable is required.')
  }
  return key
}

/** Generate a SAS URL for a specific blob, valid for 1 hour */
function buildSasUrl(
  accountName: string,
  accountKey: string,
  containerName: string,
  blobName: string,
  permissions: string // e.g. 'r' or 'rcw'
): string {
  const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey)
  const expiresOn = new Date(Date.now() + 60 * 60 * 1000) // 1 hour
  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse(permissions),
      expiresOn,
    },
    sharedKeyCredential
  ).toString()
  return `https://${accountName}.blob.core.windows.net/${containerName}/${encodeURIComponent(blobName)}?${sasToken}`
}

// ── POST /api/simple-translate/start ─────────────────────────────────────────
// Accepts: multipart form with fields: file (binary), targetLang (string)
// Returns: { jobId }
simpleTranslateRouter.post('/start', upload.single('file'), async (req, res) => {
  const file = req.file
  const targetLang = (req.body.targetLang as string)?.trim()

  if (!file) return res.status(400).json({ error: 'No file uploaded.' })
  if (!targetLang) return res.status(400).json({ error: 'targetLang is required.' })

  let { accountName, accountKey } = (() => {
    try { return getCredentials() }
    catch (e: any) { return { accountName: '', accountKey: '' } }
  })()

  let apiKey = ''
  try { apiKey = getApiKey() }
  catch (e: any) {
    fs.unlinkSync(file.path)
    return res.status(500).json({ error: (e as Error).message })
  }

  if (!accountName || !accountKey) {
    fs.unlinkSync(file.path)
    return res.status(500).json({ error: 'Azure storage credentials not configured (AZURE_STORAGE_ACCOUNT_NAME / AZURE_STORAGE_ACCOUNT_KEY).' })
  }

  const ts = Date.now()
  const safeName = file.originalname.replace(/[^a-zA-Z0-9._\-]/g, '_')
  const sourceBlobName = `src-${ts}-${safeName}`
  const targetBlobName = `tgt-${ts}-${targetLang}-${safeName}`
  const jobId = `stj-${ts}-${Math.random().toString(36).slice(2, 7)}`

  try {
    // ── 1. Upload file to source container ──────────────────────────────────
    const blobServiceClient = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      new StorageSharedKeyCredential(accountName, accountKey)
    )
    const sourceContainer = blobServiceClient.getContainerClient(SOURCE_CONTAINER)
    const blockBlob = sourceContainer.getBlockBlobClient(sourceBlobName)
    await blockBlob.uploadFile(file.path)
    console.log(`[SimpleTranslate] ✅ Uploaded source blob: ${sourceBlobName}`)

    // ── 2. Build SAS URLs ────────────────────────────────────────────────────
    const sourceUrl = buildSasUrl(accountName, accountKey, SOURCE_CONTAINER, sourceBlobName, 'r')
    const targetUrl = buildSasUrl(accountName, accountKey, TARGET_CONTAINER, targetBlobName, 'rcw')

    // ── 3. Submit async batch translation job ────────────────────────────────
    const body = {
      inputs: [{
        storageType: 'File',
        source: { sourceUrl, language: 'en' },
        targets: [{ targetUrl, language: targetLang }],
      }],
    }

    const submitRes = await fetch(
      `${TRANSLATOR_ENDPOINT}/translator/document/batches?api-version=2024-05-01`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    )

    if (submitRes.status !== 202) {
      const txt = await submitRes.text()
      throw new Error(`Translation submit failed (${submitRes.status}): ${txt}`)
    }

    const operationLocation = submitRes.headers.get('Operation-Location')
    if (!operationLocation) throw new Error('No Operation-Location header in response.')

    console.log(`[SimpleTranslate] ✅ Job submitted. jobId=${jobId}`)

    // ── 4. Store job metadata ────────────────────────────────────────────────
    jobStore.set(jobId, { operationLocation, targetBlobName, originalFileName: safeName, targetLang })

  } catch (e: any) {
    console.error('[SimpleTranslate] start error:', e.message)
    return res.status(500).json({ error: e.message })
  } finally {
    try { fs.unlinkSync(file.path) } catch {}
  }

  res.json({ jobId })
})

// ── GET /api/simple-translate/status/:jobId ───────────────────────────────────
// Returns: { status: 'Running'|'Succeeded'|'Failed'|'Cancelled', error? }
simpleTranslateRouter.get('/status/:jobId', async (req, res) => {
  const { jobId } = req.params
  const job = jobStore.get(jobId)
  if (!job) return res.status(404).json({ error: 'Job not found.' })

  let apiKey = ''
  try { apiKey = getApiKey() }
  catch (e: any) { return res.status(500).json({ error: (e as Error).message }) }

  try {
    const pollRes = await fetch(job.operationLocation, {
      headers: { 'Ocp-Apim-Subscription-Key': apiKey },
    })
    const data = await pollRes.json() as any
    const status: string = data?.status ?? 'Unknown'
    console.log(`[SimpleTranslate] status poll jobId=${jobId}: ${status}`)

    if (status === 'Failed') {
      const errDetail = data?.error?.message ?? JSON.stringify(data?.error ?? data)
      return res.json({ status, error: errDetail })
    }
    return res.json({ status })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
})

// ── GET /api/simple-translate/download/:jobId ─────────────────────────────────
// Streams the translated file back to the browser
simpleTranslateRouter.get('/download/:jobId', async (req, res) => {
  const { jobId } = req.params
  const job = jobStore.get(jobId)
  if (!job) return res.status(404).json({ error: 'Job not found.' })

  let { accountName, accountKey } = (() => {
    try { return getCredentials() }
    catch { return { accountName: '', accountKey: '' } }
  })()
  if (!accountName || !accountKey) {
    return res.status(500).json({ error: 'Azure storage credentials not configured.' })
  }

  try {
    const blobServiceClient = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      new StorageSharedKeyCredential(accountName, accountKey)
    )
    const targetContainer = blobServiceClient.getContainerClient(TARGET_CONTAINER)
    const blobClient = targetContainer.getBlobClient(job.targetBlobName)

    const downloadResponse = await blobClient.download()
    if (!downloadResponse.readableStreamBody) {
      throw new Error('Empty response from blob storage.')
    }

    const ext = path.extname(job.originalFileName) || '.pdf'
    const downloadName = `translated_${job.targetLang}_${job.originalFileName}`
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`)
    res.setHeader('Content-Type', 'application/octet-stream')

    downloadResponse.readableStreamBody.pipe(res)
    console.log(`[SimpleTranslate] ✅ Download started: ${downloadName}`)

    // Clean up job from memory after download
    res.on('finish', () => jobStore.delete(jobId))
  } catch (e: any) {
    console.error('[SimpleTranslate] download error:', e.message)
    return res.status(500).json({ error: e.message })
  }
})
