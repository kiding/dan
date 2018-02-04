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

function connect() {
  let test = '';
  do {
    try {
      test = exec(`${sdb} -s "${target}" shell echo 1`);
    } catch (e) {
      console.error(e.message);
    }
  } while (test.trim() != '1');
}

module.exports = {
  getData: key => db[key],

  setData: (key, value) => {
    db[key] = value;
    writeFileSync(dbPath, JSON.stringify(db));
  },

  // Run command as User::Shell
  runAsShell: cmd => {
    // Clean localWd folder
    clean();

    // Connect to the target device
    connect();

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
  runAsPkg: async cmd => {
    // Clean localWd folder
    clean();

    // Connect to the target device
    connect();

    // cmd should be always string
    cmd + '';

    // Escape cmd; change `\` to `\\`
    cmd = cmd.replace(/\\/g, '\\\\');

    // Escape cmd; change `"` to `\"`
    cmd = cmd.replace(/"/g, '\\"');

    // Change `\n` to `"\n"`
    cmd = cmd.replace(/\n/g, '"\n"');

    // Create a random tag for dlog parsing
    const tag = randomFillSync(Buffer.alloc(9)).toString('base64');

    // Create the source code
    const main = `
#include <stdio.h>
#include <stdlib.h>
#include <dlog.h>
#include <app_common.h>

#define TAG "${tag}"
#define BUF_MAX 2048

const char *cmd = "${cmd}";

int main(void) {
  dlog_print(DLOG_FATAL, TAG, "Launched!");

  const char *dataPath = app_get_data_path();

  char remoteSh[BUF_MAX] = {0};
  snprintf(remoteSh, BUF_MAX, "%s${shName}", dataPath);

  char remoteOut[BUF_MAX] = {0};
  snprintf(remoteOut, BUF_MAX, "%s${outName}", dataPath);

  char remoteGz[BUF_MAX] = {0};
  snprintf(remoteGz, BUF_MAX, "%s${gzName}", dataPath);

  // Create remoteSh
  FILE *fp = fopen(remoteSh, "w");
  fputs(cmd, fp);
  fclose(fp);

  char _cmd[BUF_MAX] = {0};

  // Execute remoteSh, output to remoteOut
  snprintf(_cmd, BUF_MAX, "bash -c 'sh \\"%s\\" > \\"%s\\" 2>&1'", remoteSh, remoteOut);
  system(_cmd);

  // Gzip remoteOut into remoteGz
  snprintf(_cmd, BUF_MAX, "bash -c 'gzip -c \\"%s\\" > \\"%s\\"'", remoteOut, remoteGz);
  system(_cmd);

  // Signal the finish with remoteGz
  dlog_print(DLOG_FATAL, TAG, ":>%s", remoteGz);

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

    // Install the package
    exec(`${cli} install -n "${pkgName}" -s "${target}" -- "${localBuild}"`);

    // Clear the entire dlog
    exec(`${sdb} -s "${target}" dlog -c`);

    // Run the package
    exec(`${cli} run -p "${pkgID}" -s "${target}"`);

    return new Promise(resolve => {
      const wait = _ => {
        console.log('Waiting for the process to end...');

        // Fetch the log
        const log = exec(`${sdb} -s "${target}" dlog -d -v raw ${tag}:F`);

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
