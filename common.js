const { execSync } = require('child_process'),
      { readFileSync, writeFileSync } = require('fs'),
      { parseString } = require('xml2js'),
      { join } = require('path'),
      { randomFillSync } = require('crypto');

// Tizen Studio CLIs
const sdb = './tizen-studio/tools/sdb',
      cli = './tizen-studio/tools/ide/bin/tizen';

// Check if a target device is connected
const target = exec(`${sdb} devices | awk '/:/ {print $1; exit}'`).trim();
if (!target) {
  throw new Error('Failed to find a target device.');
}

// Check if a security profile is active
let active = '';

parseString(
  readFileSync('./tizen-studio-data/profile/profiles.xml', {encoding: 'utf-8'}),
  {
    mergeAttrs: true,
    explicitArray: false
  },
  (err, result) => {
    if (err) {
      throw new Error(err);
    }

    ({ profiles: { active } } = result);
  }
);

if (!active) {
  throw new Error('Failed to find an active security profile.');
}

// Load db
const dbPath = './db.json',
      db =  {
              rootfs: './rootfs/', // Default value
              ...JSON.parse(readFileSync(dbPath, {encoding: 'utf-8'}))
            };


const localWd = './tmp/',                           // Working directory on the local machine

      shName = 'dan_cmd.sh',                        // Batch command: file name
      localSh = join(localWd, shName),              // ...          : file path

      outName = 'dan_cmd.out',                      // Decompressed result: file name
      localOut = join(localWd, outName),            // ...                : file path

      gzName = 'dan_cmd.gz',                        // Compressed result: file name
      localGz = join(localWd, gzName),              // ...              : file path

      pjName = 'dan_cmd',                           // User::Pkg: project name
      localPj = join(localWd, pjName),              // ...      : project directory
      localC = join(localPj, 'src', `${pjName}.c`), // ...      : source code file path

      buildConf = 'Release',                        // ...      : build configuration
      localBuild = join(localPj, buildConf),        // ...      : build output path
      
      pkgID = `org.example.${pjName}`,              // ...      : package id
      pkgName = `${pkgID}-1.0.0-arm.tpk`;           // ...      : package file name

function exec() {
  console.log([...arguments]);
  const result = execSync.apply(this, arguments).toString();
  console.log(result);
  return result;
}

function clean() {
  exec(`rm -rf ${localWd}`);
  exec(`mkdir -p ${localWd}`);
}

async function connect() {
  let test = '';
  do {
    try {
      test = exec(`${sdb} -s "${target}" shell echo 1`);
    } catch (e) {
      console.error(e.message);
      console.warn(`Waiting for the device ${target}...`);
      await new Promise(cb => setTimeout(cb, 5000));
    }
  } while (test.trim() != '1');
}

function generateTag() {
  let tag = randomFillSync(Buffer.alloc(12)).toString('base64');
  tag = tag.replace(/\+/g, '0');
  tag = tag.replace(/\//g, '0');
  tag = tag.replace(/=/g, '0');
  return tag;
}

module.exports = {
  getData: (key) => {
    if (key in db) {
      return db[key];
    } else {
      throw new Error(`${key} not found in the database. Try executing the prior steps.`);
    }
  },

  setData: (key, value) => {
    db[key] = value;
    writeFileSync(dbPath, JSON.stringify(db));
  },

  generateTag: generateTag,

  // Run command as User::Shell
  runAsShell: async cmd => {
    // Clean localWd folder
    clean();

    // Connect to the target device
    await connect();

    // cmd should be always string
    cmd += '';

    // Create localSh
    writeFileSync(localSh, cmd);

    /**
     * Working directory on the remote target
     * A safe place that:
     * - User::Shell can read/write
     * - sdb can push/pull
     */
    const remoteWd = '/opt/usr/home/owner/data/',
          remoteSh = join(remoteWd, shName),   // Batch command: file path
          remoteOut = join(remoteWd, outName), // Decompressed result: file path
          remoteGz = join(remoteWd, gzName);   // Compressed result: file path
          
    // Push localSh to remoteSh
    exec(`${sdb} -s "${target}" push "${localSh}" "${remoteSh}"`);

    // Execute remoteSh, output to remoteOut
    exec(`${sdb} -s "${target}" shell bash -c 'sh "${remoteSh}" > "${remoteOut}" 2>&1'`);

    // Gzip remoteOut into remoteGz
    exec(`${sdb} -s "${target}" shell bash -c 'gzip -c "${remoteOut}" > "${remoteGz}"'`);

    // Pull remoteGz to localGz
    exec(`${sdb} -s "${target}" pull "${remoteGz}" "${localGz}"`);

    // Remove all the remote files
    exec(`${sdb} -s "${target}" shell rm -rf "${remoteSh}"`);
    exec(`${sdb} -s "${target}" shell rm -rf "${remoteOut}"`);
    exec(`${sdb} -s "${target}" shell rm -rf "${remoteGz}"`);

    // Extract localGz into localOut
    exec(`gzip -d -c "${gzName}" > "${outName}"`, {cwd: localWd});

    // Read localOut
    const res = readFileSync(localOut, {encoding: 'utf-8'});

    // Clean localWd folder
    clean();

    return res;
  },

  // Run command as User::Pkg
  runAsPkg: async (cmd, tag) => {
    // Clean localWd folder
    clean();

    // Connect to the target device
    await connect();

    // cmd should be always string
    cmd + '';

    // Working directory: app_get_data_path()
    const remoteWd = `/opt/usr/home/owner/apps_rw/${pkgID}/data/`,
          remoteSh = join(remoteWd, shName),   // Batch command: file path
          remoteOut = join(remoteWd, outName), // Decompressed result: file path
          remoteGz = join(remoteWd, gzName);   // Compressed result: file path

    // If not given, generate a random tag for dlog parsing
    tag = tag || generateTag();

    // Add control commands to cmd
    cmd = cmd + `

# Gzip remoteOut into remoteGz
gzip -c "${remoteOut}" > "${remoteGz}";

# Signal the finish with remoteGz
echo -n -e '\\x03${tag}\\x00:>${remoteGz}\\x00' >> /dev/log_main;
`;

    // Escape cmd; change `\` to `\\`
    cmd = cmd.replace(/\\/g, '\\\\');

    // Escape cmd; change `"` to `\"`
    cmd = cmd.replace(/"/g, '\\"');

    // Change `\n` to `"\n"`
    cmd = cmd.replace(/\n/g, '\\n"\n"');

    // Create the source code
    const main = `
#include <stdio.h>
#include <stdlib.h>
#include <dlog.h>
#include <app_common.h>
#include <sys/types.h>
#include <unistd.h>

#define TAG "${tag}"
#define BUF_MAX 2048

const char *cmd = "${cmd}";

int main(void) {
  dlog_print(DLOG_FATAL, TAG, "Launched! Check aliveness at /proc/%d", getpid());

  // Create remoteSh
  FILE *fp = fopen("${remoteSh}", "w");
  fputs(cmd, fp);
  fclose(fp);

  // Execute remoteSh, output to remoteOut
  system("bash -c 'bash \\"${remoteSh}\\" > \\"${remoteOut}\\" 2>&1'");

  return 0;
}
    `;

    // Create a new project
    exec(`${cli} create native-project -p wearable-3.0 -t basic-ui -n "${pjName}" -- "${localWd}"`);

    // Write to the source code file
    writeFileSync(localC, main);

    // Build the project
    exec(`${cli} build-native -a arm -C "${buildConf}" -- "${localPj}"`);

    // Package the project
    exec(`${cli} package -t tpk -S on -s "${active}" -- "${localBuild}"`);

    // Try uninstalling the package first
    try {
      exec(`${cli} uninstall -p "${pkgID}" -s "${target}"`);
    } catch (e) {}

    // Install the package
    exec(`${cli} install -n "${pkgName}" -s "${target}" -- "${localBuild}"`);

    // Clear the entire dlog
    exec(`${sdb} -s "${target}" dlog -c`);

    // Run the package
    exec(`${cli} run -p "${pkgID}" -s "${target}"`);

    return new Promise(resolve => {
      const wait = _ => {
        console.log('Waiting for a completion signal from the process...');

        // Fetch the log
        const log = exec(`${sdb} -s "${target}" dlog -d -v raw ${tag}:* | tail -n 10`);

        // Search for :>${remoteGz}
        const [, remoteGz] = new RegExp(`:>(\/[^\n]+?${gzName})`).exec(log) || [];
        if (remoteGz === undefined) {
          setTimeout(wait, 5000);
          return;
        }

        // Pull remoteGz to localGz
        exec(`${sdb} -s "${target}" pull "${remoteGz}" "${localGz}"`);

        // Extract localGz into localOut
        exec(`gzip -d -c "${gzName}" > "${outName}"`, {cwd: localWd});

        // Read localOut
        const res = readFileSync(localOut, {encoding: 'utf-8'});

        // Clean localWd folder
        clean();

        // Uninstall the package
        exec(`${cli} uninstall -p "${pkgID}" -s "${target}"`);

        // Return res
        resolve(res);
      }

      wait();
    });
  }
};
