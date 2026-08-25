import "@testing-library/jest-dom/vitest"
import { configure, cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

const realSetTimeout = globalThis.setTimeout.bind(globalThis)

configure({
  asyncWrapper: async (cb) => {
    const result = await cb()
    await new Promise<void>((resolve) => realSetTimeout(resolve, 0))
    return result
  },
})

afterEach(() => cleanup())
