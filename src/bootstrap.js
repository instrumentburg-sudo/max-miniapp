window.onerror = function(msg, src, line, col, err) {
        var el = document.getElementById('error-box');
        if (el) { el.style.display = 'block'; el.textContent = 'Error: ' + msg + ' at ' + src + ':' + line; }
      };
      window.addEventListener('unhandledrejection', function(e) {
        var el = document.getElementById('error-box');
        if (el) { el.style.display = 'block'; el.textContent = 'Promise: ' + (e.reason ? e.reason.message || e.reason : 'unknown'); }
      });
