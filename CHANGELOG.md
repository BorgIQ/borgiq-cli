# Changelog

## [0.8.0](https://github.com/BorgIQ/borgiq-cli/compare/cli-v0.7.0...cli-v0.8.0) (2026-07-16)


### Features

* borgiq scaffold — schema-driven actor/canvas/batch scaffolding ([#33](https://github.com/BorgIQ/borgiq-cli/issues/33)) ([72dc2e0](https://github.com/BorgIQ/borgiq-cli/commit/72dc2e0f22cbca22ac315632c9e002697c62c28e))
* **bundle:** add canvas bundle init/unpack/pack/validate/pull/push commands ([#37](https://github.com/BorgIQ/borgiq-cli/issues/37)) ([27b4f4b](https://github.com/BorgIQ/borgiq-cli/commit/27b4f4b679a4766bf97d7c3758ecdfe7e5edee81))

## [0.7.0](https://github.com/BorgIQ/borgiq-cli/compare/cli-v0.6.0...cli-v0.7.0) (2026-06-16)


### ⚠ BREAKING CHANGES

* minimum supported Node.js is now 22 (was 20).

### Features

* accept canvas slug or id via new --canvas flag ([#32](https://github.com/BorgIQ/borgiq-cli/issues/32)) ([abc1296](https://github.com/BorgIQ/borgiq-cli/commit/abc129613eb08689eba0eab47c64039f90744c67))
* usage examples in list --help (discoverable pagination/sort for agents) ([#31](https://github.com/BorgIQ/borgiq-cli/issues/31)) ([16b8c02](https://github.com/BorgIQ/borgiq-cli/commit/16b8c02c652333aa1d8965c6fd790b916515a8cc))


### Bug Fixes

* **lib:** recognize new actor types in canvas validation ([#28](https://github.com/BorgIQ/borgiq-cli/issues/28)) ([140ce08](https://github.com/BorgIQ/borgiq-cli/commit/140ce08b5171cc76e65ba4a3c8bf699ee9393b08))


### Build System

* require Node.js &gt;= 22 (drop EOL Node 20) ([#30](https://github.com/BorgIQ/borgiq-cli/issues/30)) ([c62a849](https://github.com/BorgIQ/borgiq-cli/commit/c62a849386c502036bd4bf1b251261eadcb23f80))

## [0.6.0](https://github.com/BorgIQ/borgiq-cli/compare/cli-v0.5.0...cli-v0.6.0) (2026-06-04)


### ⚠ BREAKING CHANGES

* structured errors, exit codes, --all, and confirmation prompts ([#22](https://github.com/BorgIQ/borgiq-cli/issues/22))

### Features

* add offline generate/validate commands and parse piped stdin as YAML ([#23](https://github.com/BorgIQ/borgiq-cli/issues/23)) ([ac106ba](https://github.com/BorgIQ/borgiq-cli/commit/ac106baa08aab1e25c0c5e8e43a9db645a4b9b4a))
* structured errors, exit codes, --all, and confirmation prompts ([#22](https://github.com/BorgIQ/borgiq-cli/issues/22)) ([7c710a0](https://github.com/BorgIQ/borgiq-cli/commit/7c710a0227c7565e5694e74447f9f924a64bc80b))

## [0.5.0](https://github.com/BorgIQ/borgiq-cli/compare/cli-v0.4.0...cli-v0.5.0) (2026-05-27)


### Features

* expose pagination, search, sort options in subcommand --help ([#16](https://github.com/BorgIQ/borgiq-cli/issues/16)) ([ced111c](https://github.com/BorgIQ/borgiq-cli/commit/ced111ca427f56747b8e272bccc84da4ce68ff35))

## [0.4.0](https://github.com/BorgIQ/borgiq-cli/compare/cli-v0.3.0...cli-v0.4.0) (2026-05-26)


### Features

* **connections:** expose authType + --search filter in `connections types` ([#14](https://github.com/BorgIQ/borgiq-cli/issues/14)) ([7da9fab](https://github.com/BorgIQ/borgiq-cli/commit/7da9fab8e4e9e567163971b710e31bd8d44b19a4))
* **templates:** add command group for browsing and searching templates ([#13](https://github.com/BorgIQ/borgiq-cli/issues/13)) ([d056557](https://github.com/BorgIQ/borgiq-cli/commit/d056557b1b7277d2634681de965113d8abad5335))

## [0.3.0](https://github.com/BorgIQ/borgiq-cli/compare/cli-v0.2.0...cli-v0.3.0) (2026-05-15)


### Features

* add 'auth handoff-url' command for headless browser auth ([aa41cc4](https://github.com/BorgIQ/borgiq-cli/commit/aa41cc4d9a7dae9b9832cbb844af5f0217244d7d))
* add 'auth select' to set default org and workspace ([d430267](https://github.com/BorgIQ/borgiq-cli/commit/d4302675ad2c8fcdc5ced3f591e6bc8a61399bea))
* add canvas-actors command group with single-actor CRUD, batch, flow, and verify ([c197221](https://github.com/BorgIQ/borgiq-cli/commit/c197221eb715c4a82fe94b9d0f460797801d7da0))
* add canvas-actors command group with single-actor CRUD, batch, flow, and verify ([11747cf](https://github.com/BorgIQ/borgiq-cli/commit/11747cf9cbb60e2cc38ee450ac74f6e3f65fbfd9))
* add canvas-actors command group with single-actor CRUD, batch, flow, and verify ([5add3fc](https://github.com/BorgIQ/borgiq-cli/commit/5add3fcdc550934a1fff3ab9e7fa2c264409365f))
* add create/edit commands for assets, secrets, and connections ([7e10000](https://github.com/BorgIQ/borgiq-cli/commit/7e10000dab6497fb3eba2869a29dc393cb614e33))
* add YAML input support for file-based commands ([0721147](https://github.com/BorgIQ/borgiq-cli/commit/0721147cd2252d5a3622c4a7f88c27669a2a7e08))
* add YAML input support for file-based commands ([d1d6a77](https://github.com/BorgIQ/borgiq-cli/commit/d1d6a7793a00e2d71f1f920281ecad9a4e5087b9))
* **auth:** warn that handoff URL is sensitive ([9bfa4f3](https://github.com/BorgIQ/borgiq-cli/commit/9bfa4f31c5d1f76717b9cebdc1bd560dfb67764d))
* update layout command to support multiple source actors ([b465d9f](https://github.com/BorgIQ/borgiq-cli/commit/b465d9f14b48c136aeec3fc979a3d16fddf4d205))


### Bug Fixes

* add node types to tsconfig to resolve TS2591 errors ([570b94f](https://github.com/BorgIQ/borgiq-cli/commit/570b94f8c34a3e0882a56280967f0b13d1709650))
* align CLI with current platform API surface ([3f03351](https://github.com/BorgIQ/borgiq-cli/commit/3f03351ab260a552aad4fbb98b1a93fd9809c981))
* critical runtime issues in new create/edit commands ([9ee8329](https://github.com/BorgIQ/borgiq-cli/commit/9ee8329f50ba212288982b0a8a5d330be52f1282))
* don't echo pasted API tokens in `borgiq auth login` ([82f49f0](https://github.com/BorgIQ/borgiq-cli/commit/82f49f0850b39eaeba447548a07d283c2cb9f2ec))
* don't echo pasted API tokens in `borgiq auth login` ([525ae3f](https://github.com/BorgIQ/borgiq-cli/commit/525ae3faf01b3d1fce68283facf208222c6e7f70))
* drop imapPlain and smtpPlain from creatable secret types ([e5afba4](https://github.com/BorgIQ/borgiq-cli/commit/e5afba41f9635b70f0dccc8df23c0e8447efecdd))
* honor program-level flags on 'auth login' and add --web-url/--org/--workspace ([543723a](https://github.com/BorgIQ/borgiq-cli/commit/543723acc0c5dfb041c2e461343776a48f87d711))
* polish for webUrl, openUrl, and error messages ([f8061f0](https://github.com/BorgIQ/borgiq-cli/commit/f8061f0bd5b5ccce20ad3dd21d3f4e8efdb63c66))
* route validation errors through handleError ([318ebd9](https://github.com/BorgIQ/borgiq-cli/commit/318ebd9ef0e5ffcdb6e6862d07e2887970b1c9d0))


### Refactors

* tighten asset and connection types with discriminated unions ([2836a72](https://github.com/BorgIQ/borgiq-cli/commit/2836a72995f73ccf1ef5b3220ad0bf45be8d5b9a))
