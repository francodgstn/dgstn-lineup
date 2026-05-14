import type { PaymentGatewayConfig } from '@lineup/shared'
import type { GatewayAdapter } from './interface'
import { StripeAdapter } from './stripe'
import { PayrexxAdapter } from './payrexx'

export type { GatewayAdapter, WebhookEvent, WebhookEventType, CheckoutSession, Invoice } from './interface'

export function getGatewayAdapter(
  config: PaymentGatewayConfig,
  secretKey: string
): GatewayAdapter {
  switch (config.type) {
    case 'stripe':
      return StripeAdapter.withSecretKey(config, secretKey)
    case 'payrexx':
      return new PayrexxAdapter(config)
  }
}
