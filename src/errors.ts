// Lỗi có mã HTTP và mã máy đọc được; server.ts đổi thành phản hồi JSON `{ error: code }`.
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers: Record<string, string>;
  constructor(status: number, code: string, headers: Record<string, string> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}
