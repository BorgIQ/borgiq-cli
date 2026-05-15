# Changelog

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
