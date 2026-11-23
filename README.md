# STARs

A small browser hangout for friends, built with Node.js, Express, Socket.IO, and browser WebRTC.

## Run it on your computer

1. Install Node.js 20 or newer.
2. Open this folder in VS Code and open its terminal.
3. Run `npm install` once, then `npm start`.
4. Visit [http://localhost:3000](http://localhost:3000).
5. Pick your display name and room. Open the same address in another browser window to try the room.

In VS Code, open this project folder (the one containing `package.json`), select **Run STARs** in **Run and Debug**, and press **F5**. VS Code starts the server and opens the app in your browser.

The server keeps chat history in memory, so messages disappear when it restarts. Room names are the only access control in this starter; share them only with people you trust.

## Let friends join remotely

The invite link works for friends only after STARs is hosted at a public HTTPS address. Host this Node.js app on a service that supports a long-running Node server and WebSocket connections, then share the room link. Production calling will also need a TURN relay (for example, coturn or a managed TURN provider) and its credentials added to `rtcConfig` in `public/app.js`; the included public STUN server alone cannot connect every pair of networks. Avoid putting long-lived TURN credentials in frontend code; for a public release, issue short-lived credentials from the server.

## Current scope

- Room chat and live member list
- Direct peer-to-peer microphone, camera, and screen sharing
- Red LIVE badges for screen shares, with a clickable preview card and Watch Stream view
- A wide screen-sharing stage with participant tiles and call controls along the bottom
- Click a video or screen-share tile to open a resizable viewing window
- Live speaking glow on participant avatars and video tiles
- Responsive browser layout and room invite links

There are no accounts, message database, file uploads, moderation tools, or private-room passwords yet. Media connections are a small-group mesh, which is suitable for a few friends but becomes bandwidth-heavy as the group grows.
