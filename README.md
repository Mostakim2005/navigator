# Navigator

> **Status:** Kept for documentation. This repo is part of a Navigation Suite split — see `vault-engine` and `power-tools`.

Fast, focused vault navigation and file-management UI.

## Intended features (from manifest + src)

- **NavigatorView** (`src/NavigatorView.ts`): primary navigation surface
- **VaultEngineClient** (`src/VaultEngineClient.ts`): talks to `vault-engine` for indexed search
- **PowerToolsClient** (`src/PowerToolsClient.ts`): optional hooks to `power-tools` (calendar, folder notes, icons)
- **SettingsTab** (`src/SettingsTab.ts`): navigation preferences
- Folder tree, file preview, keyboard navigation (planned)
- No archival mirror in `Obsidian Extensions\` or live `Nihon\.obsidian\plugins\` — superseded by third-party `notebook-navigator` / `notes-explorer` in the live vault

## License

Code is licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE). Documentation is under CC BY-NC 4.0. This is source-available, not OSI open-source: free non-commercial use with credit, no commercial use.

Copyright © Mostakim2005 (GitHub) / Mostakim 4 Argon
