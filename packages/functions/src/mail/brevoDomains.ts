import { getBrevoClient } from './brevoClient'
import type { EmailDnsRecord } from '@linyup/shared'

// Adapter around Brevo's sender-domains API. BYO domains live on the single
// Linyup Brevo account (no sub-accounts) and are authenticated via the studio's
// own DNS (DKIM + Brevo code + DMARC). Brevo manages SPF via its envelope sender,
// so studios do not add an SPF record.

interface BrevoDnsRecord {
  host_name: string
  type: string
  value: string
  status: boolean
}

function mapRecords(records?: {
  brevo_code: BrevoDnsRecord
  dkim_record: BrevoDnsRecord
  dmarc_record: BrevoDnsRecord
}): EmailDnsRecord[] {
  if (!records) return []
  const map: [EmailDnsRecord['purpose'], BrevoDnsRecord][] = [
    ['brevo_code', records.brevo_code],
    ['dkim', records.dkim_record],
    ['dmarc', records.dmarc_record],
  ]
  return map
    .filter(([, r]) => !!r)
    .map(([purpose, r]) => ({
      purpose,
      type: r.type,
      host: r.host_name,
      value: r.value,
      verified: r.status,
    }))
}

export interface CreatedDomain {
  brevoDomainId: number
  dnsRecords: EmailDnsRecord[]
}

export async function createSenderDomain(domain: string): Promise<CreatedDomain> {
  const client = await getBrevoClient()
  const res = await client.domains.createDomain({ name: domain })
  return { brevoDomainId: res.id, dnsRecords: mapRecords(res.dns_records) }
}

export interface DomainStatus {
  verified: boolean
  authenticated: boolean
  dnsRecords: EmailDnsRecord[]
}

export async function getSenderDomainStatus(domain: string): Promise<DomainStatus> {
  const client = await getBrevoClient()
  const res = await client.domains.getDomainConfiguration({ domainName: domain })
  return {
    verified: res.verified,
    authenticated: res.authenticated,
    dnsRecords: mapRecords(res.dns_records),
  }
}

// Asks Brevo to (re)check the DNS records and complete authentication. Safe to
// call repeatedly while the studio is propagating their DNS.
export async function authenticateSenderDomain(domain: string): Promise<void> {
  const client = await getBrevoClient()
  await client.domains.authenticateDomain({ domainName: domain })
}

export async function deleteSenderDomain(domain: string): Promise<void> {
  const client = await getBrevoClient()
  await client.domains.deleteDomain({ domainName: domain })
}
