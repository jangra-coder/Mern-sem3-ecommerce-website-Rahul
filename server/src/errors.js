// An error with a message that is safe to show to the person using the site.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
