# YouTube Like Preview

Chrome extension that displays like counts in video metadata across YouTube.

## Installation

1. Clone or download this repository
2. Open `chrome://extensions/` in Chrome
3. Enable "Developer mode"
4. Click "Load unpacked" and select the extension folder

## How it works

Uses YouTube's internal player API to fetch like counts, then injects them into the video metadata row alongside existing view counts.

## Permissions

- `host_permissions`: YouTube only, required for API access and content script injection
