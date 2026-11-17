'use strict';

async function startDashboard() {
 await showTarget();
 if (!targetTabId || !new URLSearchParams(location.search).has('auto')) return;
 if (await chrome.permissions.contains({origins: HOSTS})) await scanSelected();
 else {
  $('status').textContent = 'Click “Open URL & scan” to grant website access and start scanning.';
 }
}
startDashboard().catch(error => { $('status').textContent = error.message; });
