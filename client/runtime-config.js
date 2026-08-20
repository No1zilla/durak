/* Same-origin when Express serves the client. GitHub Pages: set DURAK_API_ORIGIN
   in repo Secrets and the Pages workflow writes the Railway HTTPS URL here. */
/* Same-origin when Express serves the client. GitHub Pages uses DEFAULT_PAGES_API
   in apiOrigin.js; Actions can overwrite this from DURAK_API_ORIGIN. */
window.DURAK_API_ORIGIN = '';
