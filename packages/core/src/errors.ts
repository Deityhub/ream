/** An error whose message is safe and useful to show the user as-is. Anything else is shown as a generic failure. */
export class UserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserError'
  }
}
