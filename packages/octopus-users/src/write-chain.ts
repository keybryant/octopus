/** 后端契约要求调用方保证写序：所有 put/delete 经此链串行执行 */
export class WriteChain {
  private tail: Promise<void> = Promise.resolve()

  run<T>(job: () => Promise<T>): Promise<T> {
    const result = this.tail.then(job)
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
