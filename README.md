# LeetWithGit

Automatically save accepted LeetCode submissions to a GitHub repository with a Chrome extension.

## Install in Chrome

1. Download the latest `LeetWithGit-v*.zip` from [Releases](https://github.com/KanishkValechha/LeetWithGit/releases) and extract it, or build it from source (see below) and use `.output/chrome-mv3`.
2. Keep the folder somewhere permanent. It should contain `manifest.json` directly.
3. Open `chrome://extensions` and turn on **Developer mode**.
4. Select **Load unpacked** and choose the folder.
5. Pin the extension, open its settings, and complete the setup below.

Chrome does not automatically update a manually loaded extension; download a newer release and use **Reload** on the extension card after replacing its files.

## Develop

The extension is built with [WXT](https://wxt.dev). Requires Node.js 22 or newer.

```sh
npm install
npm run dev        # opens Chrome with the extension loaded and reloads on change
npm run typecheck
npm run build      # writes the unpacked extension to .output/chrome-mv3
npm run zip        # writes the store-ready .output/LeetWithGit-v<version>.zip
```

- `entrypoints/` holds the background service worker, the two LeetCode content scripts and the popup. WXT generates `manifest.json` from these files and `wxt.config.ts`.
- `lib/` holds code shared between entrypoints: Zod schemas for submissions and runtime messages, typed storage items, and the GitHub client.
- The version comes from `package.json`.

## Configure GitHub sync

1. Create a repository for your LeetCode solutions, or use an existing repository. The selected branch must already exist.
2. Create a GitHub fine-grained personal access token. Limit it to the repository that will receive solutions and grant **Contents: Read and write**. The token is used by this extension to check repository access and write solution files.
3. Open the extension popup and enter the token, repository as `OWNER/REPOSITORY`, and branch (usually `main`).
4. Select **Test connection**. It checks token access, repository access, and branch existence. This read-only check cannot prove write permission; the token still needs **Contents: Read and write**.
5. Select **Save settings**. The token is stored in this browser's local extension storage. Repository and branch preferences use Chrome sync storage.

When LeetCode marks a submission accepted, the extension saves it under `leetcode/` in your repository. Temporary network or GitHub errors are queued and retried automatically. The popup shows the latest sync result.

## Privacy and permissions

- The extension reads the LeetCode submission request and accepted result on `leetcode.com` to capture the solution and identify the problem.
- It checks repository/branch access and sends the solution and problem metadata to the repository configured in the popup.
- Your GitHub token is stored in local extension storage and is not copied into Chrome sync settings.
- The extension needs LeetCode page access, GitHub API access, storage, notifications, and alarms for queued retries.

## Known overwrite behavior

If a solution file with the same question and language already exists, the current implementation responds to GitHub's `422` by deleting that file and retrying the upload. If the retry fails, the previous solution may already be gone. Back up important files before retrying an overwrite. A safer future change is to update the existing file using its SHA or let the user choose to skip/overwrite.

## Create a release

Every push to `main` and every pull request type-checks the code and builds the ZIP, which is kept as a workflow artifact for 14 days. Publishing a GitHub Release runs the same build and attaches the ZIP to the release.

## Permissions

| Permission | Purpose |
| --- | --- |
| `storage` | Save the token locally and sync repository/branch preferences |
| `notifications` | Report successful uploads and queued failures |
| `alarms` | Retry queued uploads while the service worker is suspended |
| `leetcode.com` host access | Observe LeetCode submissions and retrieve problem details |
| `api.github.com` host access | Check configuration and upload solution files |

## License

MIT. See [LICENSE](LICENSE).
