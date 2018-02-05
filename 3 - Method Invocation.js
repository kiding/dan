const { getData, setData, generateTag, runAsShell, runAsPkg } = require('./common');

// Avoid actually executing the method
const fake = `string:1 string:1 string:1 string:1 string:1 string:1 string:1 string:1 string:1 string:1 string:1 string:1 string:1 string:1 string:1 string:1`;

async function invoke(_root, runner) {
  /*
    shelf = [
      {dest: "bus.na.me", object: "/", interface: "in.ter.face", method: "MethodName"},
      ...
    ]

    See 2 - Object Introspection.js for _root structure.
  */

  let shelf = [];
  Object.entries(_root).forEach(([dest, v]) => {
    Object.entries(v).forEach(([object, v]) => {
      Object.entries(v).forEach(([interface, v]) => {
        Object.entries(v['method'] || {}).forEach(([method, v]) => {
          shelf.push({dest, object, interface, method});
        });
      });
    });
  });

  let callable = []; // metadata shelf array

  // Too many methods; do it step by step
  const step = 300,
        limit = shelf.length;

  for(let i=0; i<limit; i+=step) {
    console.log(`#${i}/${limit}`);

    const sh = shelf.slice(i, i+step),
          l = sh.length;

    // A random tag and delimiter for this iteration
    const tag = generateTag(),
          delimiter = `[:${tag}:]`;

    const cmd = sh.reduce((cmd, v, i) => {
      const { dest, object, interface, method } = v;

      // Delimiter
      cmd += `\necho '${delimiter}';\n`;

      // Metadata
      const m = JSON.stringify(v);
      cmd += `echo '${m}';\n`;

      // dlog where we are
      cmd += `echo -n -e '\\x03${tag}\\x00${i}/${l} ${m}\\x00' >> /dev/log_main;\n`;

      // Call the method
      return cmd + `dbus-send --system --type=method_call --print-reply --reply-timeout=5000 --dest=${dest} ${object} ${interface}.${method} ${fake};\n`;
    }, '');

    const c = (await runner(cmd, tag)) // Run the command
              .split(delimiter) // Split by delimiter 
              .map(block => {
                // Parse metadata
                let [, m] = /^({.+})$/m.exec(block) || [, '{}'],
                    v     = JSON.parse(m);
                if (!v.dest) {
                  return;
                }

                // Check the error type
                let [, type] = /\nError .+\.([A-Za-z]+):/s.exec(block) || [, 'Errortype'];

                switch (type) {
                  // Ignore
                  case 'ServiceUnknown':
                  case 'UnknownObject':
                  case 'UnknownInterface':
                  case 'UnknownMethod':
                  case 'UnknownProperty':
                  case 'AccessDenied':
                  case 'NoReply':
                    return;
                }

                // Assumes callable
                v.type = type;
                return v;
              })
              .filter(m => !!m);

    callable.push(...c);
  }

  return callable;
}

async function main() {
  // Call every method to determine callable
  setData('callable.shell', await invoke(getData('root.shell'), runAsShell));
  setData('callable.pkg', await invoke(getData('root.pkg'), runAsPkg));
}

main();
