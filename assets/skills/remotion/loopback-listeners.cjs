'use strict';
const net = require('node:net');
/** Compatibility guard for the two inspected Remotion 4.0.484 listen call sites.
 * Scoped to an owned worker. This is NOT an OS sandbox for arbitrary project code.
 */
function restrictListenersToLoopback() {
  const original = net.Server.prototype.listen;
  function listen(options, callback) {
    if (!options || typeof options !== 'object' || !Object.hasOwn(options, 'port') ||
        !Number.isInteger(options.port) || options.port < 0 || options.port > 65535 ||
        Object.keys(options).some(key => !['port', 'host'].includes(key)) ||
        (callback !== undefined && typeof callback !== 'function')) {
      throw new Error('Unsupported listener configuration; compatibility review required');
    }
    return original.call(this, { port: options.port, host: '127.0.0.1' }, callback);
  }
  net.Server.prototype.listen = listen;
  return () => { if (net.Server.prototype.listen === listen) net.Server.prototype.listen = original; };
}
module.exports = { restrictListenersToLoopback };
