import type { EmailAdapter } from './adapter.js'

const RESEND_API_URL = 'https://api.resend.com/emails'

export interface ResendAdapterOptions {
  apiKey: string
  from: string
  /** Overridable for tests; defaults to the real Resend API. */
  apiUrl?: string
}

/** Ships first per docs/BUILD_PLAN.md phase 4; `postmarkAdapter`/`sesAdapter` follow once this interface has a second real consumer. */
export function resendAdapter(options: ResendAdapterOptions): EmailAdapter {
  const apiUrl = options.apiUrl ?? RESEND_API_URL

  return {
    async send(message) {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: options.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      })

      if (!res.ok) {
        throw new Error(`Resend API error (${res.status}): ${await resendErrorMessage(res)}`)
      }
    },
  }
}

async function resendErrorMessage(res: Response): Promise<string> {
  const body = await res.text()
  try {
    const parsed = JSON.parse(body) as { message?: string }
    return parsed.message ?? body
  } catch {
    return body
  }
}
