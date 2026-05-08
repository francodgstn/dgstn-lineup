import { SecretManagerServiceClient } from '@google-cloud/secret-manager'

const client = new SecretManagerServiceClient()

const secretCache = new Map<string, { value: string; timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000

export async function getSecret(secretName: string, version = 'latest'): Promise<string> {
  const cacheKey = `${secretName}:${version}`
  const now = Date.now()

  if (secretCache.has(cacheKey)) {
    const cached = secretCache.get(cacheKey)!
    if (now - cached.timestamp < CACHE_TTL) return cached.value
    secretCache.delete(cacheKey)
  }

  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
  if (!projectId) throw new Error('Project ID not found in environment')

  const name = `projects/${projectId}/secrets/${secretName}/versions/${version}`

  try {
    const [accessResponse] = await client.accessSecretVersion({ name })
    const secretValue = accessResponse.payload!.data!.toString()
    secretCache.set(cacheKey, { value: secretValue, timestamp: now })
    return secretValue
  } catch (error) {
    console.error(`Error accessing secret ${secretName}:`, error) // eslint-disable-line no-console
    throw new Error(`Failed to access secret: ${secretName}`)
  }
}

export async function getSMTPConfig(appSettings: Record<string, unknown>) {
  if (!appSettings?.nodemailer_smtp) {
    throw new Error('SMTP configuration not found in app_settings/global_settings')
  }

  const smtpSettings = appSettings.nodemailer_smtp as Record<string, unknown>
  if (!smtpSettings.auth) {
    throw new Error('SMTP auth configuration not found in app settings')
  }

  const smtpPassword = await getSecret('smtp-password')

  return {
    ...smtpSettings,
    auth: {
      ...(smtpSettings.auth as Record<string, unknown>),
      pass: smtpPassword,
    },
  }
}
