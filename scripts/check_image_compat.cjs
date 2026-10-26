const assert=require('node:assert/strict');
const fs=require('node:fs');
const size=require('image-size');
const image='node_modules/expo-router/assets/pkg.png';
const bytes=fs.readFileSync(image);
assert.deepEqual(size(image),size(bytes));
assert.ok(size(bytes).width>0);
assert.throws(()=>size(Buffer.from('bad image')));
console.log('Patched image parser legacy API compatibility passed');
