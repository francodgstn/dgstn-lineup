// Vertex AI client for the in-app assistant. Auth is via ADC — in production the
// Cloud Functions runtime service account (granted roles/aiplatform.user in
// infra/modules/iam) is used automatically; locally you need developer ADC
// (`gcloud auth application-default login`). No API key is stored.
import { VertexAI, type GenerativeModel } from '@google-cloud/vertexai'
import { getVertexLocation } from './env'

// Default model for a help/navigation copilot: cheap + fast, good enough for
// grounded Q&A. Swap for a Pro/Claude-on-Vertex model here if quality demands it.
export const ASSISTANT_MODEL = 'gemini-2.5-flash'

let cached: GenerativeModel | null = null

export function getAssistantModel(): GenerativeModel {
  if (cached) return cached
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
  if (!project) throw new Error('GCLOUD_PROJECT not set — cannot init Vertex AI')
  const vertex = new VertexAI({ project, location: getVertexLocation() })
  cached = vertex.getGenerativeModel({ model: ASSISTANT_MODEL })
  return cached
}
