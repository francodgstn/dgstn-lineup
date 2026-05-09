export function to<T>(promise: Promise<T>): Promise<[Error, null] | [null, T]> {
  return promise
    .then((data): [null, T] => [null, data])
    .catch((err): [Error, null] => [err instanceof Error ? err : new Error(String(err)), null])
}
