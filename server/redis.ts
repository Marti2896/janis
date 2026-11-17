import net from "node:net";

/** Health check Redis senza dipendenze: invia PING e attende +PONG. */
export function checkRedis(redisUrl: string, timeoutMs = 2000): Promise<void> {
  const url = new URL(redisUrl);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(url.port || 6379), url.hostname);
    const done = (err?: Error) => {
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };
    socket.setTimeout(timeoutMs, () => done(new Error("Redis timeout")));
    socket.on("error", done);
    socket.on("connect", () => socket.write("PING\r\n"));
    socket.on("data", (d) =>
      d.toString().startsWith("+PONG") ? done() : done(new Error("Risposta Redis inattesa")),
    );
  });
}
