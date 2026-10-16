import { defineConfig } from 'wxt';

export default defineConfig({
  imports: false,
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'LeetWithGit',
    description: 'Automatically push successful LeetCode solutions to GitHub',
    permissions: ['storage', 'notifications', 'alarms', 'scripting'],
    host_permissions: ['https://leetcode.com/*', 'https://api.github.com/*'],
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        // 128 is the first Firefox with `world: "MAIN"` content scripts.
        gecko: { id: 'leetwithgit@kanishkvalechha', strict_min_version: '128.0' },
      },
    }),
  }),
  zip: {
    artifactTemplate: 'LeetWithGit-v{{version}}-{{browser}}.zip',
  },
});
