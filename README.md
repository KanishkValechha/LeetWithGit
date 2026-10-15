# LeetWithGit

Automatically save accepted LeetCode submissions to a GitHub repository with a Chrome extension.

## Install in Chrome

1. Download the latest `LeetWithGit-v*-chrome.zip` from [Releases](https://github.com/KanishkValechha/LeetWithGit/releases) and extract it, or build it from source (see below) and use `.output/chrome-mv3`.
2. Keep the folder somewhere permanent. It should contain `manifest.json` directly.
3. Open `chrome://extensions` and turn on **Developer mode**.
4. Select **Load unpacked** and choose the folder.
5. Pin the extension, open its settings, and complete the setup below.

Chrome does not automatically update a manually loaded extension; download a newer release and use **Reload** on the extension card after replacing its files.

## Install in Firefox

Firefox 128 or newer (or a Firefox-based browser such as Zen) is required.

1. Run `npm run build:firefox`.
2. Open `about:debugging#/runtime/this-firefox` and select **Load Temporary Add-on**.
3. Choose `.output/firefox-mv3/manifest.json`.

Temporary add-ons are removed when the browser restarts. If submissions are not saved, check that `leetcode.com` and `api.github.com` are allowed under the add-on's **Permissions** tab in `about:addons`.

## Develop

The extension is built with [WXT](https://wxt.dev). Requires Node.js 22 or newer.

```sh
npm install
npm run dev        # opens Chrome with the extension loaded and reloads on change
npm run typecheck
npm run build      # writes the unpacked extension to .output/chrome-mv3
npm run zip        # writes the store-ready .output/LeetWithGit-v<version>-chrome.zip
```

`dev`, `build` and `zip` have `:firefox` variants, e.g. `npm run dev:firefox`. To make `dev:firefox` open a Firefox-based browser other than Firefox, add a gitignored `web-ext.config.ts`:

```ts
import { defineWebExtConfig } from 'wxt';

export default defineWebExtConfig({
  binaries: { firefox: '/Applications/Zen.app/Contents/MacOS/zen' },
});
```

- `entrypoints/` holds the background service worker, the two LeetCode content scripts and the popup. WXT generates `manifest.json` from these files and `wxt.config.ts`.
- `lib/` holds code shared between entrypoints: Zod schemas for submissions and runtime messages, typed storage items, and the GitHub client.
- The version comes from `package.json`.

## Configure GitHub sync

1. Create a repository for your LeetCode solutions, or use an existing repository. The selected branch must already exist.
2. Create a GitHub fine-grained personal access token. Limit it to the repository that will receive solutions and grant **Contents: Read and write**. The token is used by this extension to check repository access and write solution files.
3. Open the extension popup, paste the token and select **Continue**.
4. Pick the repository from the list (or type `OWNER/REPOSITORY` if the token cannot list repositories) and check the branch.
5. Select **Connect repository**. It checks token access, repository access, branch existence and push permission before saving. The token is stored in this browser's local extension storage. Repository and branch preferences use Chrome sync storage.

When LeetCode marks a submission accepted, the extension saves it under `leetcode/` in your repository. Temporary network or GitHub errors are queued and retried automatically. The popup shows upload progress while a solution is being committed, queued uploads with a **Retry now** button, your solved counts from LeetCode and your five most recently saved solutions. The toolbar badge shows ↑ while uploading, ✓ after a save and the number of queued uploads while they wait to retry. Repository, branch and token can be changed under the popup's settings.

## Privacy and permissions

- The extension reads the LeetCode submission request and accepted result on `leetcode.com` to capture the solution and identify the problem.
- It checks repository/branch access and sends the solution and problem metadata to the repository configured in the popup.
- While you are signed in on `leetcode.com`, it reads your username and solved counts from LeetCode to show them in the popup. They are kept in local extension storage.
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
| `leetcode.com` host access | Observe LeetCode submissions and retrieve problem details and your solved counts |
| `api.github.com` host access | Check configuration and upload solution files |

## License

MIT. See [LICENSE](LICENSE).
