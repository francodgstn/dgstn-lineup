/*
 * Linyup embed resizer.
 *
 * Include once on any page that hosts a Linyup section embed:
 *   <iframe src="https://app.linyup.com/embed/<slug>/<sectionId>" data-linyup-embed ...></iframe>
 *   <script src="https://app.linyup.com/embed.js" async></script>
 *
 * Each embedded section posts its content height to the parent window; this
 * script resizes the matching iframe so there is no inner scrollbar or clipping.
 * Safe to load more than once.
 */
(function () {
  if (window.__linyupEmbedResizer) return
  window.__linyupEmbedResizer = true

  window.addEventListener('message', function (event) {
    var data = event.data
    if (!data || data.type !== 'linyup:embed:height' || typeof data.height !== 'number') return

    var frames = document.querySelectorAll('iframe[data-linyup-embed]')
    for (var i = 0; i < frames.length; i++) {
      // Match the iframe whose document sent the message (handles multiple
      // embeds on one page).
      if (frames[i].contentWindow === event.source) {
        frames[i].style.height = data.height + 'px'
        break
      }
    }
  })
})()
