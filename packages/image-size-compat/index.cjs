// Expo SDK 54's Metro still passes paths to the legacy synchronous API.
// Keep that API while using the patched 2.x buffer parsers; never mutate node_modules.
const fs = require('node:fs');
const upstream = require('image-size-upstream');
function imageSize(input, callback) {
  const read = () => {
    if (typeof input === 'string') {
      if (fs.statSync(input).size > 32 * 1024 * 1024) throw new RangeError('Image exceeds build asset limit');
      input = fs.readFileSync(input);
    }
    return upstream.imageSize(input);
  };
  if (typeof callback === 'function') {
    process.nextTick(() => { try { callback(null, read()); } catch (error) { callback(error); } });
    return;
  }
  return read();
}
module.exports = Object.assign(imageSize, upstream, {default:imageSize, imageSize});
