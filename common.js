const { execSync } = require('child_process'),
      { readFileSync, writeFileSync } = require('fs'),
      { join } = require('path'),
      { randomFillSync } = require('crypto');

// Tizen Studio CLIs
const sdb = './tizen-studio/tools/sdb';

// Check if a target device is connected
const target = exec(`${sdb} devices | awk '/:/ {print $1; exit}'`).trim();
if (!target) {
  throw new Error('Failed to find a target device.');
}

// Load db
const db =  {
              rootfs: './rootfs/', // Default value
              ...JSON.parse(readFileSync('./db.json', {encoding: 'utf-8'}))
            };

// Temp folder
const tmp = './tmp/';

// Batch command
const shName = 'cmd.sh',
      localSh = join(tmp, shName);

// (Decompressed) result from the batch command
const outName = 'cmd.out',
      localOut = join(tmp, outName);

// Compressed result
const gzName = 'cmd.gz',
      localGzCwd = tmp,
      localGz = join(localGzCwd, gzName);

// Source code of the helper Gear application
const cName = 'main.c',
      localC = join(tmp, cName);


function exec() {
  console.log([...arguments]);
  const result = execSync.apply(this, arguments).toString();
  console.log(result);
  return result;
}

function clean() {
  exec(`rm -rf ${tmp}`);
  exec(`mkdir -p ${tmp}`);
}

function connect() {
  console.log(`Connecting to ${target}...`);

  let test = '';
  do {
    try {
      test = exec(`${sdb} -s ${target} shell echo 1`);
    } catch (e) {
      console.error(e.message);
    }
  } while (test.trim() != '1');
}

module.exports = {
  getData: key => db[key],

  setData: (key, value) => {
    db[key] = value;
    writeFileSync(cfg.db, JSON.stringify(db));
  },

  // Run command as User::Shell
  runAsShell: cmd => {
    // Clean tmp folder
    clean();

    // Connect to the target device
    connect();

    // cmd should be always string
    cmd += '';

    // Create cmd.sh
    writeFileSync(localSh, cmd);

    /**
     * Folder path on the remote target
     * A safe place that:
     * - User::Shell can read/write
     * - sdb can push/pull
     */
    const remotePwd = '/opt/usr/home/owner/data/';

    // Batch command
    const remoteSh = join(remotePwd, shName);

    // (Decompressed) result from the batch command
    const remoteOut = join(remotePwd, outName);

    // Compressed result
    const remoteGz = join(remotePwd, gzName);
          
    // Push cmd.sh to /tmp/
    exec(`${sdb} -s ${target} push "${localSh}" "${remoteSh}"`);

    // Execute /tmp/cmd.sh, output to /tmp/cmd.out
    exec(`${sdb} -s ${target} shell bash -c 'sh "${remoteSh}" > "${remoteOut}" 2>&1'`);

    // Tarball /tmp/cmd.out into /tmp/cmd.gz
    exec(`${sdb} -s ${target} shell bash -c 'gzip -c "${remoteOut}" > "${remoteGz}"'`);

    // Pull /tmp/cmd.gz
    exec(`${sdb} -s ${target} pull "${remoteGz}" "${localGz}"`);

    // Remove all the remote files
    exec(`${sdb} -s ${target} shell rm -rf "${remoteSh}"`);
    exec(`${sdb} -s ${target} shell rm -rf "${remoteOut}"`);
    exec(`${sdb} -s ${target} shell rm -rf "${remoteGz}"`);

    // Extract cmd.gz
    exec(`gzip -d -c "${localGz}" > "${localOut}"`, {cwd: localGzCwd});

    // Read cmd.out
    const res = readFileSync(localOut, {encoding: 'utf-8'});

    // Clean tmp folder
    clean();

    return res;
  },

  // Run command as User::Pkg
  runAsPkg: async cmd => {
    // Clean tmp folder
    clean();

    // Connect to the target device
    connect();

    // cmd should be always string
    cmd + '';

    // Escape cmd; change `"` to ` \"`
    cmd = cmd.replace(/"/g, ' \"');

    // Change `\n` to `"\n"`
    cmd = cmd.replace(/\n/g, '"\n"');

    // Create a random tag for dlog parsing
    const tag = randomFillSync(Buffer.alloc(9)).toString('base64');

    // Create main.c
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

  FILE *fp = fopen(remoteSh, "w");
  fputs(cmd, fp);
  fclose(fp);

  char _cmd[BUF_MAX] = {0};

  snprintf(_cmd, BUF_MAX, "bash -c 'sh \\"%s\\" > \\"%s\\" 2>&1'", remoteSh, remoteOut);
  system(_cmd);

  snprintf(_cmd, BUF_MAX, "bash -c 'gzip -c \\"%s\\" > \\"%s\\"'", remoteOut, remoteGz);
  system(_cmd);

  dlog_print(DLOG_FATAL, TAG, ":>%s", remoteGz);

  return 0;
}
    `;

    writeFileSync(localC, main);

    // Clear the entire dlog
    exec(`${sdb} -s ${target} dlog -c`);

    // Instruct to compile main.c
    console.log(`
===============================================
Compile and run ${localC} on the target device.
Waiting for the result...
===============================================
`);

    return new Promise(resolve => {
      const wait = _ => {
        // Fetch the log
        const log = exec(`${sdb} -s ${target} dlog -d -v raw ${tag}:F`);

        // Search for :>${remoteGz}
        const [__, remoteGz] = new RegExp(`:>(\/[^\n]+?${gzName})`).exec(log) || [];
        if (remoteGz === undefined) {
          setTimeout(wait, 5000);
          return;
        }

        // Pull ${remoteGz}
        exec(`${sdb} -s ${target} pull "${remoteGz}" "${localGz}"`);

        // Extract cmd.gz
        exec(`gzip -d -c "${localGz}" > "${localOut}"`, {cwd: localGzCwd});

        // Read cmd.out
        const res = readFileSync(localOut, {encoding: 'utf-8'});

        // Clean tmp folder
        clean();

        // Return res
        resolve(res);
      }

      wait();
    });
  }
};
