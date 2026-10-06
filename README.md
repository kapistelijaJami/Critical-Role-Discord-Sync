# Critical Role Video ↔ Discord Sync

A userscript that replays a Discord channel's chat in sync with a Beacon video, so you can watch a Campaign 4 episode and see the chat as it appeared when the episode aired.

It runs on both sites. The Beacon tab reports the video's playback position, and the Discord tab scrolls the chat to the messages that were posted at that moment, so you can watch how people reacted as if it were live right now.

## Requirements

- A userscript manager such as [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)
- A desktop browser (Chrome, Edge, Firefox etc.)
- Access to Beacon and the Discord server

## Installation

1. Install a userscript manager in your browser.
2. Create a new script in the manager and paste in the contents of `Critical Role Video ↔ Discord Sync.user.js` (or open the file's raw URL, and click Install).
3. Save. The script activates on `beacon.tv` and `discord.com`.
4. Reload any open Beacon and Discord tabs.

## Setup

Default settings should work, but you can choose the channel you want to sync with. The main channel for chatting live while watching it on Beacon is campaign-4-live-chat, which is the sync channel by default.

To change the channel:
1. Open the Discord channel you want to sync with.
2. In the userscript manager's menu in the Discord tab, run **Use current channel as sync target**.

## Usage

1. Put the [Beacon](https://beacon.tv/) and [Discord](https://discord.com/app) (browser version) tabs side by side in separate windows.
2. On Beacon, open a Campaign 4 episode page. A **Start Discord sync** button appears in the bottom-left corner.
3. Click it, then play the video. The Discord tab jumps to the matching point in the channel and follows along.
4. Click **Stop Discord sync** on Beacon when you're done.

A small badge in the bottom right of Discord tab shows the episode title, the video time, and the sync state. Click it to resume or turn off sync, or to jump to the target channel if you're elsewhere in Discord.

While sync is driving the chat, the script hides Discord's "Jump to Present" bar, the "new messages" bar, the typing indicator, and the bottom gradient for cleaner user experience. They come back when the video is paused or you scroll manually.

Scrolling the chat yourself pauses auto-follow. Seeking, pressing play, or clicking the badge resumes it.

If you want to watch cooldowns as well you have to manually set the start time in the settings by adding the episode length to the original start time, so you get the start time of when people started watching the cooldown.

## Menu commands (Discord tab)

Under the Tampermonkey icon you can find quick settings buttons for the script in the Discord tab.

| Command | What it does |
| --- | --- |
| Use current channel as sync target | Sets the channel the script syncs |
| Set stream start for this episode | Overrides the episode's start time (UTC, ISO format) |
| Clear stream start override | Goes back to the start time read from Beacon |
| Set offset for this episode | Shifts the chat by a number of seconds |
| Nudge +5s / Nudge -5s | Quick offset adjustments for this episode |

Offsets and overrides are stored per episode title. The menu commands only work while a sync session is running.

## Notes and limitations

- The start time is read from the episode page's structured data, so it follows daylight saving changes automatically. If the chat is a few minutes off, use the nudge commands, set an offset, or set the start time manually.
- Only Campaign 4 episodes are detected (titles like `C4 E037 | Title`). Other series would need changes to the title check and the channel.
- Beacon and Discord can change their page structure at any time, which may break the script. The Discord class-name selectors in particular may need updating.

## Troubleshooting

- **No menu commands:** You're probably on the Beacon tab. They only appear on Discord, so reload that tab.
- **Chat is on the wrong day:** Run **Set stream start for this episode** and enter the correct UTC time.
- **Nothing happens when you press Start:** Make sure you're on an episode page and the video has loaded.
