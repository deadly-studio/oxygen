/** See docs/SPEC.md#email-adapters. OTP delivery is the only v1 caller. */
export interface EmailMessage {
  to: string
  subject: string
  text?: string
  html?: string
}

export interface EmailAdapter {
  send(message: EmailMessage): Promise<void>
}
