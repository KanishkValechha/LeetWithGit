import { defineConfig } from 'wxt';

export default defineConfig({
  imports: false,
  manifest: {
    name: 'LeetWithGit',
    description: 'Automatically push successful LeetCode solutions to GitHub',
    permissions: ['storage', 'notifications', 'alarms'],
    host_permissions: ['https://leetcode.com/*', 'https://api.github.com/*'],
  },
  zip: {
    artifactTemplate: 'LeetWithGit-v{{version}}.zip',
  },
});
