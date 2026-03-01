export class SinasError extends Error {
  public readonly status: number;
  public readonly detail: string;

  constructor(message: string, status: number = 0, detail?: string) {
    super(message);
    this.name = 'SinasError';
    this.status = status;
    this.detail = detail || message;
  }
}

export class SinasAuthError extends SinasError {
  constructor(message: string = 'Authentication required') {
    super(message, 401);
    this.name = 'SinasAuthError';
  }
}

export class SinasPermissionError extends SinasError {
  constructor(message: string = 'Permission denied') {
    super(message, 403);
    this.name = 'SinasPermissionError';
  }
}

export class SinasNotFoundError extends SinasError {
  constructor(resource: string) {
    super(`${resource} not found`, 404);
    this.name = 'SinasNotFoundError';
  }
}

export class SinasTimeoutError extends SinasError {
  constructor(message: string = 'Request timed out') {
    super(message, 408);
    this.name = 'SinasTimeoutError';
  }
}
