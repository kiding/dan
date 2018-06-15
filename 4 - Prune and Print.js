const fs = require('fs')
      dbPath = './db.json';

function pruneRoot(_root) {
  Object.entries(_root).forEach(([dest, v]) => {
    Object.entries(v).forEach(([object, vv]) => {
      Object.entries(vv).forEach(([interface, vvv]) => {
        if (
          // Remove org.freeDesktop.DBus.* interfaces
          /^org.freeDesktop.DBus/i.exec(interface)
          // Remove interfaces with no method
          || Object.values(vvv['method'] || {}).length == 0
        ) {
          delete vv[interface];
        }
      });

      // Remove empty objects in a dest
      if (Object.entries(vv).length == 0) {
        delete v[object];
      }
    });

    // Remove empty dests
    if (Object.entries(v).length == 0) {
      delete _root[dest];
    }
  });
  return _root;
}

function dedupBusNames(_root) {
  let hash = {}; // <JSON.stringify(v), dest>
  Object.entries(_root).forEach(([dest, v]) => {
    const key = JSON.stringify(v),
          value = hash[key];
    // Prefer non-":" bus name
    if ((value && value[0] == ':') || !value) {
      hash[key] = dest;
    }
  });
 
  const legits = {};
  Object.values(hash).forEach(dest => legits[dest] = true);
    
  Object.keys(_root).forEach(dest => {
    if (!(dest in legits)) {
      delete _root[dest];
    }
  });

  return _root;
}

function printProperties(_root, long = true) {
  let msg = ``;

  Object.entries(_root).forEach(([dest, v]) => {
    Object.entries(v).forEach(([object, vv]) => {
      Object.entries(vv).forEach(([interface, vvv]) => {
        Object.entries(vvv['property']).forEach(([name, vvvv]) => {
          if (long) {
            msg += `${dest} ${object} `;
          }
            
          msg += `${interface}.${name} =  ${JSON.stringify(vvvv)}\n\n`;
        })
      });
    });
  });

  const filename = `./properties.log`;
  fs.writeFileSync(filename, msg);
  console.log(`Properties saved to ${filename}`);
}

function pruneCallable(_callable) {
  return _callable.filter(({interface}) => !(/^org.freedesktop.DBus/i.exec(interface)));
}

function printCallables(_root, _callable, long = true) {
  let msg = ``;
  _callable.forEach(({dest, object, interface, method}) => {
    // If not round in _root, skip
    if (!(dest in _root)) {
      return;
    }
      
    if (long) {
      msg += `dbus-send --system --type=method_call --print-reply --dest=${dest} ${object} `;
    }
      
  msg += `${interface}.${method}`;

    if (long) {
      msg += `\n${JSON.stringify(_root[dest][object][interface]['method'][method])}`;
    }

    msg += '\n\n';
  });

    
  const filename = `./callables.log`;
  fs.writeFileSync(filename, msg);
  console.log(`Callable methods saved to ${filename}`);
}

function main() {
  db = JSON.parse(fs.readFileSync(dbPath, {encoding: 'utf-8'}));

  _root = db.root;
  _root = pruneRoot(_root);
  _root = dedupBusNames(_root);
  printProperties(_root, true);

  _callable = db.callable;
  _callable = pruneCallable(_callable);
  printCallables(_root, _callable, true);

}

main();
: