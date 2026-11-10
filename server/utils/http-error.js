export class HttpError extends Error {
  constructor(status, detail, fields) {
    super(detail)
    this.status = status
    this.fields = fields
  }
}

export function validationError(fields) {
  throw new HttpError(400, undefined, fields)
}
