import { defineManifest } from '@crxjs/vite-plugin';

const manifest = defineManifest({
  manifest_version: 3,
  name: 'Sleepy Tabs Guardian',
  version: '0.1.0',
  description:
    'Automatically pauses inactive tabs, refreshes memory hogs, and surfaces tab health insights with customizable controls.',
  action: {
    default_title: 'Sleepy Tabs Guardian',
    default_popup: 'src/pages/popup/index.html'
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module'
  },
  options_page: 'src/pages/options/index.html',
  side_panel: {
    default_path: 'src/pages/dashboard/index.html'
  },
  permissions: [
    'alarms',
    'storage',
    'tabs',
    'scripting',
    'windows',
    'sidePanel',
    'nativeMessaging',
    'debugger',
    'processes'
  ],
  host_permissions: ['<all_urls>'],
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/reminderModal.ts'],
      run_at: 'document_idle'
    },
    {
      matches: ['<all_urls>'],
      js: ['src/content/memoryProbe.ts'],
      run_at: 'document_idle'
    }
  ],
  web_accessible_resources: [
    {
      resources: ['src/pages/reminder/index.html', 'src/pages/consent/index.html'],
      matches: ['<all_urls>']
    }
  ],
  icons: {
    '16': 'public/icon-16.png',
    '32': 'public/icon-32.png',
    '48': 'public/icon-48.png',
    '128': 'public/icon-128.png',
    '256': 'public/icon-256.png',
    '512': 'public/icon-512.png'
  }
});

export default manifest;
