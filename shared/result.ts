export interface Ok<T> {
  ok: true;
  value: T;
}

export interface Error<E> {
  ok: false;
  error: E;
}

export type Result<T, E> = Ok<T> | Error<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function error<E>(err: E): Error<E> {
  return { ok: false, error: err };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isError<T, E>(result: Result<T, E>): result is Error<E> {
  return !result.ok;
}
