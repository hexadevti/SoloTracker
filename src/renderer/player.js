'use strict';

// player.html?v=<videoId>&start=<segundos>[&st_paused=1]
(function () {
  const q = new URLSearchParams(location.search);
  const id = q.get('v') || '';
  if (!/^[\w-]{11}$/.test(id)) return;
  const start = Math.max(0, Number(q.get('start')) || 0);
  document.getElementById('v').src = `/media/${id}${start > 0 ? `#t=${start}` : ''}`;
})();
