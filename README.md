# LeetWithGit

Automatically save accepted LeetCode submissions to a GitHub repository with a Chrome extension.

## Install in Chrome

1. Download the latest `LeetWithGit-v*.zip` from [Releases](https://github.com/KanishkValechha/LeetWithGit/releases) and extract it, or clone this repository. The built JavaScript files are committed, so a clone loads as is.
2. Keep the folder somewhere permanent. It should contain `manifest.json` directly.
3. Open `chrome://extensions` and turn on **Developer mode**.
4. Select **Load unpacked** and choose the extracted folder.
5. Pin the extension, open its settings, and complete the setup below.

The ZIP has no build or dependency-install step for users. Chrome does not automatically update a manually loaded extension; download a newer release and use **Reload** on the extension card after replacing its files.

## Develop with TypeScript

The TypeScript sources in `src/` are the development source of truth. The root-level JavaScript files are generated build outputs and remain the files loaded by Chrome, so the manifest and packaged extension keep the same runtime entry points.

```powershell
npm install
npm run typecheck
npm run build
```

The compiler is a pinned development-only dependency; the extension has no JavaScript runtime dependencies. The release workflow type-checks and compiles the TypeScript sources before packaging the same root-level JavaScript files.

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
- The extension needs LeetCode page access, GitHub API access, local storage, scripting, notifications, and alarms for queued retries.

## Known overwrite behavior

If a solution file with the same question and language already exists, the current implementation responds to GitHub's `422` by deleting that file and retrying the upload. If the retry fails, the previous solution may already be gone. Back up important files before retrying an overwrite. A safer future change is to update the existing file using its SHA or let the user choose to skip/overwrite.

## Create a release

Every push and pull request runs the TypeScript type-check, build, and packaging workflow. It publishes the versioned ZIP as a downloadable workflow artifact for 14 days. Publishing a GitHub Release runs that same reusable workflow and attaches its generated ZIP to the release, so validation and release use the same build and packaging steps. The ZIP is ready to extract and load unpacked; it does not install the extension automatically.

## Permissions

| Permission | Purpose |
| --- | --- |
| `storage` | Save the token locally and sync repository/branch preferences |
| `scripting` | Attach submission capture to LeetCode pages |
| `notifications` | Report successful uploads and queued failures |
| `alarms` | Retry queued uploads while the service worker is suspended |
| `leetcode.com` host access | Observe LeetCode submissions and retrieve problem details |
| `api.github.com` host access | Check configuration and upload solution files |

## License

MIT. See [LICENSE](LICENSE).
