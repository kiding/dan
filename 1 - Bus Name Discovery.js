const { getData, setData, runAsShell, runAsPkg } = require('./common');

const { join } = require('path'),
      { readFileSync, statSync, readdirSync } = require('fs');

function getNamesFromRootfs(parentPath, result = []) {
  console.log(`getNamesFromRootfs: parent: ${parentPath}`);

  readdirSync(parentPath).forEach(child => {
    const childPath = join(parentPath, child),
          stat = statSync(childPath);

    if (stat.isDirectory()) {
      getNamesFromRootfs(childPath, result); // Recursive!
      return;
    }

    if (!stat.isFile()) {
      return;
    }

    console.log(`getNamesFromRootfs: child: ${childPath}`);

    const content = readFileSync(childPath, {encoding: 'utf-8'});
    if (!/\[D-BUS Service\]/i.test(content)) {
      return;
    }

    const [_, name] = content.match(/Name\s*=\s*([^\s]+)$/im) || [];
    if (name === undefined) {
      return;
    }

    result.push(name);
  });

  return result;
}

function getNamesFromTarget() {
  const result = runAsShell('dbus-send --system --dest=org.freedesktop.DBus --type=method_call --print-reply /org/freedesktop/DBus org.freedesktop.DBus.ListNames');
  return result.match(/string "[^"]+"/g).map(v => v.split('"')[1]);
}

function deduplicate(result = []) {
  const dict = {};
  result.forEach(v => dict[v] = true);
  return Object.keys(dict);
}

async function main() {
  // Recursively grab the names from D-Bus service files
  let names = getNamesFromRootfs(join(getData('rootfs'), '/usr/share/dbus-1/'));

  // Grab the names of the running bus names
  names.push(...getNamesFromTarget());

  // Remove duplicates from an array
  names = deduplicate(names);

  // Log
  console.log(`#${names.length}: ${names}`);

  // Save names
  setData('names', names);
}

main();
