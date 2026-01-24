# bz2api.js

A lightweight, zero-dependency JavaScript library for querying Battlezone 2: Combat Commander multiplayer session data. Works in browsers and Node.js with automatic CORS handling.

## Links

- **Live Demo:** [sevsunday.github.io/bz2api.js/demo/](https://sevsunday.github.io/bz2api.js/demo/)
- **Documentation:** [sevsunday.github.io/bz2api.js/docs/](https://sevsunday.github.io/bz2api.js/docs/)
- **Download:** [bz2api.js](https://github.com/sevsunday/bz2api.js/blob/main/bz2api.js)

## Features

- **Zero dependencies** — Pure vanilla JavaScript
- **Automatic CORS handling** — Falls back through multiple public proxies
- **Full data parsing** — Decodes Base64 names, RakNet GUIDs, game modes, team assignments
- **Steam/GOG integration** — Profile URLs, Workshop URLs, direct join protocol URLs
- **Map data enrichment** — Optional integration with GameListAssets API for map names, images, descriptions
- **VSR support** — Built-in metadata for 143+ VSR maps (pools, loose scrap, author, size)

## Quick Start

### Browser

```html
<script src="bz2api.js"></script>
<script>
  BZ2API.fetchSessions().then(result => {
    console.log('Sessions:', result.sessions);
    console.log('Players:', result.dataCache.players);
  });
</script>
```

### Node.js

```javascript
const BZ2API = require('./bz2api.js');

const result = await BZ2API.fetchSessions();
console.log(result.sessions);
```

### With Enrichment

```javascript
const result = await BZ2API.fetchSessions({
  enrichMaps: true,      // Fetch map names, images, descriptions
  enrichVsrMaps: true    // Add VSR map metadata (pools, loose, etc.)
});

result.sessions.forEach(session => {
  console.log(session.mapName);       // "VSR DM: Rocky Canyon"
  console.log(session.vsrPools);      // 7
  console.log(session.steamJoinUrl);  // "steam://rungame/..."
});
```

## Installation

**Download:** Grab [bz2api.js](https://github.com/sevsunday/bz2api.js/blob/main/bz2api.js) and include it in your project.

**CDN:** TBD

## Documentation

For complete documentation, visit the [docs site](https://sevsunday.github.io/bz2api.js/docs/), which includes:

- **API Reference** — All functions with parameters and return types
- **Data Structures** — Complete Session, Player, and DataCache object schemas
- **Technical Details** — Character encoding, RakNet GUID format, game mode bit packing
- **Server-Side Examples** — Node.js examples with Steam API enrichment for avatars/nicknames

## License

MIT
