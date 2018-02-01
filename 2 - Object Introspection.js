const { getData, setData, runAsShell, runAsPkg } = require('./common'),
      { randomFillSync } = require('crypto'),
      { parseString } = require('xml2js'),
      { parse: parseGetAll } = require('./GetAll');

const cnames = ['INVALID', 'BYTE', 'BOOLEAN', 'INT16', 'UINT16', 'INT32', 'UINT32', 'INT64', 'UINT64', 'DOUBLE', 'STRING', 'OBJECT_PATH', 'SIGNATURE', 'ARRAY', 'STRUCT', 'VARIANT', 'DICT ENTRY', 'UNIX FD'];

async function parseXML(xml) {
  return new Promise((resolve, reject) => {
    parseString(xml, {
      mergeAttrs: true,
     // explicitArray: false
    }, (err, result) => {
      if (err) {
        return reject(err);
      } else {
        return resolve(result);
      }
    });
  });
}

async function introspect(runner) {
/*
  _root = {
    bus.na.me: {          // Level 1: Destination
      /obj/ect: {         // Level 2: Object
        in.ter.face: {    // Level 3: Interface
          'method': {     // Level 4: 'method'
            MethodName: [
              {name: "argument_name", type: "a{type}", direction: "in/out"},
              ...
            ],
            ...
          },
          'signal': {     // Level 4: 'signal'
            SignalName: [
              {name: "argument_name", type: "a{type}"},
              ...
            ],
            ...
          },
          'property': {   // Level 4: 'property'
            PropertyName1: "property_value",
            PropertyName2: null,
            ...
          }
        }
      },
      ...
    },
    ...
  }
*/
  const _root = {};

/*
  shelf = [
    {dest: "bus.na.me", object: "/", interface: null},
    {dest: "bus.na.me", object: "/", interface: "in.ter.face"},
  ]

  Temporary shelf for a batch of commands
  - If interface is null, call Introspectable.Introspect
  - If interface is not null, call Properties.GetAll
*/

  let shelf = getData('names').map(name => ({ dest: name, object: '/', interface: null }));

  while (shelf.length) {
    console.log(JSON.stringify(shelf));

    // A random delimiter for this iteration
    const delimiter = `[:${randomFillSync(Buffer.alloc(20)).toString('base64')}:]`;

    const cmd = shelf.reduce((cmd, v) => {
      const { dest, object, interface } = v;

      // Delimiter
      cmd += `\necho '${delimiter}';\n`;

      // Metadata
      cmd += `echo '${JSON.stringify(v)}';\n`;

      // If interface is null, call Introspectable.Introspect
      if (interface == null) {
        return cmd + `dbus-send --system --type=method_call --print-reply --dest=${dest} ${object} org.freedesktop.DBus.Introspectable.Introspect;\n`;
      }

      // If interface is not null, call Properties.GetAll
      else {
        return cmd + `dbus-send --system --type=method_call --print-reply --dest=${dest} ${object} org.freedesktop.DBus.Properties.GetAll string:${interface};\n`;
      }
    }, '');

    // Run the command
    const res = await runner(cmd);

    // Flush shelf
    shelf = [];

    // Split by delimiter 
    for (const block of res.split(delimiter)) {
      // Parse metadata
      const [, metadata] = /^({.+})$/m.exec(block) || [, '{}'],
            { dest, object, interface } = JSON.parseXML(metadata);
      if (!dest) {
        continue;
      }

      // Initialize _root[dest] (Level 1)
      if (!_root[dest]) {
        _root[dest] = {};
      }

      // Initialize _root[dest][object] (Level 2)
      if (!_root[dest][object]) {
        _root[dest][object] = {};
      }

      // Parse the message
      const [, string] = /\n\s+string "(.+)"[\n\s]*$/s.exec(block) || [], // Introspect
            [, array] = /\n\s+array \[(.+)\][\n\s]*$/s.exec(block) || []; // GetAll
      
      // If interface is null, Introspect is expected
      if (interface == null && string) {
        // Parse XML, grab interfaces and children
        const {
          node: {
            interface: interfaces,
            node: children
          } = {}
        } = await parseXML(string) || {};
        
        // interfaces: Enumerate and register
        (interfaces || []).forEach(v => {
          const { 
            name: [ interface ],
            method: methods,
            signal: signals,
            property
          } = v;

          // Initialize _root[dest][object][interface] (Level 3)
          _root[dest][object][interface] = {};

          // Found methods,
          if (methods) {
            // Initialize _root[dest][object][interface]['method'] (Level 4)
            _root[dest][object][interface]['method'] = {};

            // methods: Enumerate and register
            methods.forEach(v => {
              const {
                name: [ method ],
                arg
              } = v;

              _root[dest][object][interface]['method'][method] = arg;
            });
          }

          // Found signals,
          if (signals) {
            // Initialize _root[dest][object][interface]['signal'] (Level 4)
            _root[dest][object][interface]['signal'] = {};

            // signals: Enumerate and register
            signals.forEach(v => {
              const {
                name: [ signal ],
                arg
              } = v;
              
              _root[dest][object][interface]['signal'][signal] = arg;
            });
          }

          // Found property,
          if (property) {
            // Initialize _root[dest][object][interface]['property'] (Level 4)
            _root[dest][object][interface]['property'] = {};

            // Put it on shelf for later GetAll
            shelf.push({dest: dest, object: object, interface: interface});
          }
        });

        // children: Enumerate and register
        (children || []).forEach(v => {
          const {
            name: [ child ]
          } = v;

          // Put it on shelf for later Introspect
          shelf.push({
            dest: dest,
            object: `${object}${object == '/' ? '' : '/'}${child}`,
            interface: null
          });
        });
      }
      // If interface is not null, GetAll is expected
      else if (array) {
        // FIXME: Use GetAll.jison
      }
      // Else: Invalid
      else {
        console.log(`Invalid: ${block}`);
      }
    }
  }

  return _root;
}

async function main() {
  // Introspect and acquire root objects
  const shell = await introspect(runAsShell),
        pkg   = await introspect(runAsPkg);

  // Save root
  setData('root.shell', shell);
  setData('root.pkg', pkg);
}

main();
