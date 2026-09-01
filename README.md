# alfred-workflow-switch

Safely switch one Alfred workflow slot between an installed release and local source. The installed release is preserved while development source is active, so Alfred shows only one workflow.

## Install

```bash
npm install --save-dev alfred-workflow-switch
```

Add the production and development bundle IDs to the workflow's `package.json`:

```json
{
  "alfredWorkflowSwitch": {
    "releaseBundleId": "com.example.alfred-workflow",
    "developmentBundleId": "com.example.alfred-workflow.dev"
  },
  "scripts": {
    "dev": "alfred-workflow-switch dev",
    "prod": "alfred-workflow-switch prod",
    "mode": "alfred-workflow-switch status",
    "doctor": "alfred-workflow-switch doctor"
  }
}
```

`developmentBundleId` is optional and defaults to `releaseBundleId`. Set `workflowPath` when `info.plist` is not in the package root.

## Commands

```bash
npm run dev      # preserve the installed release and link local source
npm run prod     # remove the matching development link and restore the release
npm run mode     # print the current mode
npm run doctor   # print paths, bundle IDs, and recovery details
```

Append `-- --json` to `mode` or `doctor` for machine-readable output.

The first `dev` command requires an installed release whose `info.plist` contains the configured `releaseBundleId`. The tool discovers its real Alfred workflow slot instead of deriving a destination from the npm package name.

## Safety model

- Release backups live under `<Alfred Preferences>/.workflow-switch/`, normally on the same filesystem as the workflow slot.
- Moves use `rename` and failed link or restore operations are rolled back.
- Only a symbolic link resolving to the configured local source can be removed.
- Foreign links, duplicate release bundle IDs, invalid destinations, and backup conflicts are never overwritten automatically.
- A per-workflow lock prevents concurrent switch operations.
- Interrupted operations remain recoverable with either `dev` or `prod`.

This package does not build, publish, install, or refresh Alfred workflows. It only manages the development/production switch.
