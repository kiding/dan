# Dan the D-Bus Analyzer

![The Icon](icon.png)

Automatic privilege evaluation of D-Bus services on a remote device.

Presented at DEF CON 26 ([slide](https://media.defcon.org/DEF%20CON%2026/DEF%20CON%2026%20presentations/Dongsung%20Kim%20and%20Hyoung%20Kee%20Choi%20-%20Updated/DEFCON-26-Dongsung-Kim-and-Hyoung-Kee-Choi-Your-Watch-Can-Watch-You-Updated.pdf), [video](https://youtu.be/3IdgBwbOT-g))

## Supported Platforms

> See branches of this Git repository.

* tizen-wearable-2.3.2
* tizen-wearable-3.0

## Requirements

* [node.js](https://nodejs.org/en/download/current/)
* [yarn](https://yarnpkg.com/en/docs/install)

## Usage

```bash
yarn install
yarn run all
```

Dan spawns a test process with no privilege on a remote device. The process recursively scans through its D-Bus tree to acquire its structure; bus names, objects, interfaces, properties, methods, and signals. The analyzer tries to gather every property of every object, and to call every method of every interface for privilege evaluation. Finally, the data is written into the files for further analysis.

* `db.json`: A simple JSON database for the analyzer, containing the D-Bus tree structure
* `properties.log`: A list of properties accessible from the test process
* `callables.log`: A list of methods callable from the test process, formatted as shell commands

## License

GPLv3
