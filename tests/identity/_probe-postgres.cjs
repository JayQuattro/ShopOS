// Standalone synchronous TCP probe used by the auth integration test to decide
// whether the throwaway PostgreSQL database is reachable. Invoked via
// execFileSync so the result is known at vitest describe-registration time.
const net = require("node:net");

const url = new URL(process.env.SHOPOS_PROBE_URL ?? "postgres://localhost:5432");
const socket = net.createConnection({ host: url.hostname, port: Number(url.port) || 5432 }, () => {
  socket.destroy();
  process.exit(0);
});
socket.on("error", () => process.exit(1));
setTimeout(() => {
  socket.destroy();
  process.exit(1);
}, 2000);
