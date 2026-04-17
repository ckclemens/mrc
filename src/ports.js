import { createServer } from 'node:net'

/** Find a free TCP port starting from `base`, incrementing until one is available. */
export function findFreePort(base) {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', () => {
      // Port in use, try next
      resolve(findFreePort(base + 1))
    })
    server.listen(base, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}
